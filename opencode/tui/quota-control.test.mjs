import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';
import { fg, RGBA, StyledText, TextNodeRenderable } from '@opentui/core';
import { insert, setProp } from '@opentui/solid';

import {
  createQuotaControlInteraction,
  quotaControlLayout,
  quotaRowLayout,
} from './quota-control.mjs';

const directory = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(.:)/, '$1'));
const sourceFile = path.join(directory, 'codex-quota-indicator.tsx');
const runtimeFile = path.join(directory, '.codex-quota-indicator.test-runtime.mjs');
const source = fs.readFileSync(sourceFile, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    jsx: ts.JsxEmit.ReactJSX,
    jsxImportSource: '@opentui/solid',
  },
  fileName: sourceFile,
}).outputText;
fs.writeFileSync(runtimeFile, compiled);
const {
  createQuotaTui,
  quotaRowParts,
  SELECTED_PROVIDER_KEY,
} = await import(`${pathToFileURL(runtimeFile).href}?test=${Date.now()}`);
fs.unlinkSync(runtimeFile);

const colors = {
  text: '#f0f0f0',
  textMuted: '#808080',
  warning: '#ffff00',
  error: '#ff0000',
  backgroundElement: '#112233',
  backgroundPanel: '#223344',
  backgroundMenu: '#334455',
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function available(provider, remainingPercent = 75) {
  const limitId = provider === 'claude' ? 'five_hour' : 'codex';
  return {
    provider,
    status: 'available',
    limits: { [limitId]: { primary: { remainingPercent, durationMinutes: 300 } } },
    source: { stale: false, observedAt: new Date().toISOString() },
  };
}

function createHarness({ stored, kvReady = true, readThrows = false, writeThrows = false, scans } = {}) {
  const writes = [];
  const intervals = [];
  const cleared = [];
  const disposeCallbacks = [];
  const interactions = [];
  let slotPlugin;
  let scannerIndex = 0;
  const scannerCalls = [0, 0];
  const scanFunctions = scans ?? [
    () => Promise.resolve(available('claude')),
    () => Promise.resolve(available('codex')),
  ];
  const dependencies = {
    createScanner() {
      const index = scannerIndex++;
      return () => {
        scannerCalls[index] += 1;
        return scanFunctions[index]();
      };
    },
    collectClaude: () => Promise.resolve(available('claude')),
    createInteraction(options) {
      const interaction = createQuotaControlInteraction(options);
      interactions.push(interaction);
      return interaction;
    },
    setInterval(callback, milliseconds) {
      const timer = { callback, milliseconds };
      intervals.push(timer);
      return timer;
    },
    clearInterval(timer) {
      cleared.push(timer);
    },
  };
  const api = {
    kv: {
      ready: kvReady,
      get(key) {
        assert.equal(key, SELECTED_PROVIDER_KEY);
        if (readThrows) throw new Error('read failed');
        return stored;
      },
      set(key, value) {
        writes.push([key, value]);
        if (writeThrows) throw new Error('write failed');
      },
    },
    slots: {
      register(plugin) {
        slotPlugin = plugin;
        return 'quota-slot';
      },
    },
    lifecycle: {
      onDispose(callback) {
        disposeCallbacks.push(callback);
        return () => {};
      },
    },
    theme: { current: colors },
  };
  return {
    api,
    dependencies,
    writes,
    intervals,
    cleared,
    scannerCalls,
    mountControl() {
      assert.throws(() => slotPlugin.slots.app_bottom(), /No renderer found/);
      assert.ok(interactions.length > 0);
    },
    clickControl() {
      if (interactions.length === 0) this.mountControl();
      const interaction = interactions.at(-1);
      interaction.onMouseDown({ button: 0 });
      interaction.onMouseUp({ button: 0 });
    },
    dispose() {
      for (const callback of disposeCallbacks) callback();
    },
  };
}

async function initialize(harness) {
  await createQuotaTui(harness.dependencies)(harness.api);
  return harness;
}

async function settle() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

test('hydrates validated global KV state and switches through the visible click control', async () => {
  const harness = await initialize(createHarness({ stored: 'claude' }));
  harness.clickControl();
  assert.deepEqual(harness.writes, [[SELECTED_PROVIDER_KEY, 'codex']]);
  harness.dispose();
  assert.equal(harness.cleared.length, 2);
});

test('defaults unreadable or invalid state to Codex and isolates KV write failures', async () => {
  const invalid = await initialize(createHarness({ stored: 'other' }));
  assert.deepEqual(invalid.writes, [[SELECTED_PROVIDER_KEY, 'codex']]);

  const absent = await initialize(createHarness({ stored: undefined }));
  assert.deepEqual(absent.writes, []);

  const unreadable = await initialize(createHarness({ readThrows: true, writeThrows: true }));
  unreadable.clickControl();
  assert.deepEqual(unreadable.writes, [[SELECTED_PROVIDER_KEY, 'claude']]);
});

test('refreshes providers concurrently with provider-scoped overlap and failure isolation', async () => {
  const claudeFirst = deferred();
  const codexFirst = deferred();
  const claudeSecond = deferred();
  const codexSecond = deferred();
  const harness = await initialize(createHarness({
    scans: [
      (() => {
        const results = [claudeFirst.promise, claudeSecond.promise];
        return () => results.shift();
      })(),
      (() => {
        const results = [codexFirst.promise, codexSecond.promise];
        return () => results.shift();
      })(),
    ],
  }));

  assert.deepEqual(harness.scannerCalls, [1, 1]);
  harness.intervals[0].callback();
  harness.intervals[1].callback();
  assert.deepEqual(harness.scannerCalls, [1, 1]);

  claudeFirst.resolve(available('claude', 61));
  codexFirst.reject(new Error('codex unavailable'));
  await settle();
  harness.intervals[0].callback();
  harness.intervals[1].callback();
  assert.deepEqual(harness.scannerCalls, [2, 2]);

  harness.clickControl();
  assert.deepEqual(harness.scannerCalls, [2, 2]);
  assert.deepEqual(harness.writes.at(-1), [SELECTED_PROVIDER_KEY, 'claude']);

  harness.dispose();
  claudeSecond.resolve(available('claude', 10));
  codexSecond.resolve(available('codex', 10));
  await settle();
  harness.intervals[0].callback();
  harness.intervals[1].callback();
  assert.deepEqual(harness.scannerCalls, [2, 2]);
});

test('control geometry is a right-aligned full row with one content-width target', () => {
  assert.deepEqual(quotaRowLayout, {
    width: '100%', flexDirection: 'row', justifyContent: 'flex-end',
  });
  assert.deepEqual(quotaControlLayout, { width: 'auto', focusable: true });
});

test('row parts preserve exact columns, cells, and continuation alignment', () => {
  const codex = quotaRowParts('codex', {
    remainingPercent: 72,
    percentText: '72%',
    filledCells: 9,
    resetText: '2h 15m',
    gradient: 'green-red',
  }, 0);
  assert.deepEqual(codex, {
    provider: 'Codex ',
    filled: '█████████',
    empty: '░░░░',
    percent: ' 72%',
    reset: '2h 15m',
  });
  assert.equal(codex.filled.length + codex.empty.length, 13);
  assert.equal(`${codex.provider} ${codex.filled}${codex.empty} ${codex.percent} ${codex.reset}`,
    'Codex  █████████░░░░  72% 2h 15m');

  const continuation = quotaRowParts('claude', {
    remainingPercent: 85,
    percentText: '85%',
    filledCells: 11,
    resetText: '5d 8h',
    gradient: 'blue-red',
  }, 1);
  assert.equal(continuation.provider, '      ');
  assert.equal(`${continuation.provider} ${continuation.filled}${continuation.empty} ${continuation.percent} ${continuation.reset}`,
    '       ███████████░░  85% 5d 8h');
});

test('renderer uses exact RGB construction and the active muted theme for empty cells', () => {
  assert.match(source, /RGBA\.fromInts\(red, green, blue, 255\)/);
  assert.match(source, /style=\{\{ fg: filledColor \}\}>\{parts\.filled\}/);
  assert.match(source, /style=\{\{ fg: api\.theme\.current\.textMuted \}\}>\{parts\.empty\}/);
  assert.match(source, /flexDirection="column"/);
});

test('styled span rows use the renderer child contract without object stringification', () => {
  const styled = new StyledText([
    fg(colors.text)('Codex  '),
    fg(RGBA.fromInts(0, 255, 80, 255))('██████████'),
    fg(colors.textMuted)('░░░'),
    fg(colors.text)('  75% 2h 15m'),
  ]);
  const textParent = new TextNodeRenderable({ id: 'quota-row-test' });
  const spans = [
    [colors.text, 'Codex  '],
    [RGBA.fromInts(0, 255, 80, 255), '██████████'],
    [colors.textMuted, '░░░'],
    [colors.text, '  75% 2h 15m'],
  ];
  for (const [color, text] of spans) {
    const span = new TextNodeRenderable({ id: `quota-row-span-${text.length}` });
    setProp(span, 'style', { fg: color });
    insert(span, text);
    insert(textParent, span);
  }
  const rendered = textParent.toChunks().map(({ text }) => text).join('');
  assert.equal(rendered, 'Codex  ██████████░░░  75% 2h 15m');
  assert.doesNotMatch(rendered, /\[?object Object\]?/);

  const contentPropProbe = {};
  setProp(contentPropProbe, 'content', styled);
  assert.equal(contentPropProbe.content, '[object Object]');
  assert.doesNotMatch(source, /<text\s+content=/);
  assert.match(source, /<span style=\{\{ fg: filledColor \}\}>\{parts\.filled\}<\/span>/);
});

test('control activates only after a complete left press and release', () => {
  const state = { hovered: false, pressed: false, focused: false, toggles: 0 };
  const interaction = createQuotaControlInteraction({
    toggle: () => { state.toggles += 1; },
    hovered: () => state.hovered,
    pressed: () => state.pressed,
    focused: () => state.focused,
    setHovered: (value) => { state.hovered = value; },
    setPressed: (value) => { state.pressed = value; },
    setFocused: (value) => { state.focused = value; },
    theme: colors,
  });

  for (const button of [1, 2, 4, 5, 64, 65]) {
    interaction.onMouseDown({ button });
    interaction.onMouseUp({ button });
  }
  assert.equal(state.toggles, 0);
  interaction.onMouseUp({ button: 0 });
  assert.equal(state.toggles, 0);

  interaction.onMouseDown({ button: 0 });
  interaction.onMouseUp({ button: 0 });
  assert.equal(state.toggles, 1);

  interaction.onMouseDown({ button: 0 });
  interaction.onMouseOut();
  interaction.onMouseUp({ button: 0 });
  assert.equal(state.toggles, 1);
  assert.equal(state.pressed, false);
});

test('hover, focus, and pressed styling use distinct theme tokens without activation', () => {
  const state = { hovered: false, pressed: false, focused: false, toggles: 0 };
  const interaction = createQuotaControlInteraction({
    toggle: () => { state.toggles += 1; },
    hovered: () => state.hovered,
    pressed: () => state.pressed,
    focused: () => state.focused,
    setHovered: (value) => { state.hovered = value; },
    setPressed: (value) => { state.pressed = value; },
    setFocused: (value) => { state.focused = value; },
    theme: colors,
  });

  assert.equal(interaction.background(), undefined);
  interaction.onMouseOver();
  assert.equal(interaction.background(), colors.backgroundElement);
  interaction.onFocus();
  assert.equal(interaction.background(), colors.backgroundPanel);
  interaction.onMouseDown({ button: 0 });
  assert.equal(interaction.background(), colors.backgroundMenu);
  interaction.onMouseOut();
  assert.equal(interaction.background(), colors.backgroundPanel);
  interaction.onBlur();
  assert.equal(interaction.background(), undefined);
  assert.equal(state.toggles, 0);
});
