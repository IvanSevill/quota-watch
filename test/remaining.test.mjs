import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildRemainingResult, parseRemainingArgs, runRemainingCLI,
} from '../quota/remaining.mjs';
import { createSnapshot } from '../quota/schema.mjs';

const NOW = Date.parse('2026-07-22T12:00:00Z');
const RESET = '2026-07-22T17:00:00.000Z';
const stream = () => ({ text: '', write(value) { this.text += value; } });

function snapshot(overrides = {}) {
  return createSnapshot({
    provider: 'codex',
    limits: {
      zeta: {
        secondary: { remainingPercent: 64, durationMinutes: 10080 },
        primary: { remainingPercent: 12.5, durationMinutes: 300, resetAt: RESET },
      },
      alpha: { primary: { durationMinutes: 60 } },
    },
    source: { kind: 'app-server', official: true, observedAt: NOW, stale: false },
    now: NOW,
    ...overrides,
  });
}

test('remaining parser requires a supported provider and validates command options', () => {
  assert.deepEqual(parseRemainingArgs(['codex', '--json', '--min', '12.5', '--no-cache', '--source', 'rollout']), {
    provider: 'codex', json: true, min: 12.5, cache: false, source: 'rollout', timeoutMs: 5000,
  });
  assert.deepEqual(parseRemainingArgs(['claude']), {
    provider: 'claude', json: false, min: 0, cache: true, source: 'auto',
  });
  assert.equal(parseRemainingArgs(['codex', '--app-server-timeout-ms', '15000']).timeoutMs, 15000);
  assert.throws(() => parseRemainingArgs([]), /provider/);
  assert.throws(() => parseRemainingArgs(['gemini']), /claude or codex/);
  assert.throws(() => parseRemainingArgs(['claude', '--source', 'rollout']), /only to codex/);
  assert.throws(() => parseRemainingArgs(['claude', '--app-server-timeout-ms', '15000']), /only to codex/);
  assert.throws(() => parseRemainingArgs(['codex', '--min', '101']), /between 0 and 100/);
  assert.throws(() => parseRemainingArgs(['codex', '--app-server-timeout-ms', '999']), /between 1000 and 60000/);
  assert.throws(() => parseRemainingArgs(['codex', '--app-server-timeout-ms', '60001']), /between 1000 and 60000/);
  assert.throws(() => parseRemainingArgs(['codex', '--app-server-timeout-ms', 'slow']), /integer between 1000 and 60000/);
  assert.throws(() => parseRemainingArgs(['codex', '--json', 'extra']), /unexpected argument/);
});

test('schema v1 always exposes only stable keys, exact minimum, and deterministic windows', () => {
  const result = buildRemainingResult(snapshot(), { min: 12.5 });
  assert.deepEqual(Object.keys(result), [
    'schemaVersion', 'provider', 'result', 'status', 'stale', 'thresholdPercent',
    'minimumRemainingPercent', 'windows', 'reached', 'source', 'errorCodes',
  ]);
  assert.deepEqual(result, {
    schemaVersion: 1,
    provider: 'codex',
    result: 'ok',
    status: 'available',
    stale: false,
    thresholdPercent: 12.5,
    minimumRemainingPercent: 12.5,
    windows: [
      {
        limitId: 'alpha', window: 'primary', remainingPercent: null,
        durationMinutes: 60, resetAt: null,
      },
      {
        limitId: 'zeta', window: 'primary', remainingPercent: 12.5,
        durationMinutes: 300, resetAt: RESET,
      },
      {
        limitId: 'zeta', window: 'secondary', remainingPercent: 64,
        durationMinutes: 10080, resetAt: null,
      },
    ],
    reached: null,
    source: { kind: 'app-server', observedAt: new Date(NOW).toISOString() },
    errorCodes: [],
  });
  assert.doesNotMatch(JSON.stringify(result), /official|usedPercent|credits|plan|message/);
});

test('low, reached, stale, unavailable, and unknown quota map to stable results', () => {
  assert.equal(buildRemainingResult(snapshot(), { min: 13 }).result, 'low');
  assert.equal(buildRemainingResult(snapshot({ reached: 'rate_limit' }), { min: 0 }).result, 'low');

  const stale = snapshot();
  stale.source.stale = true;
  assert.equal(buildRemainingResult(stale, { min: 0 }).result, 'unknown');
  assert.equal(buildRemainingResult(stale, { min: 0 }).minimumRemainingPercent, 12.5);

  const unknown = snapshot({ limits: { only: { primary: { durationMinutes: 300 } } } });
  assert.equal(buildRemainingResult(unknown, { min: 0 }).minimumRemainingPercent, null);
  assert.equal(buildRemainingResult(unknown, { min: 0 }).result, 'unknown');

  const unavailable = {
    provider: 'claude', status: 'unavailable', limits: {}, reached: null,
    source: null, errors: [{ code: 'unavailable', message: 'SECRET raw collector response' }],
  };
  assert.deepEqual(buildRemainingResult(unavailable, { min: 0 }).source, {
    kind: null, observedAt: null,
  });
  assert.deepEqual(buildRemainingResult(unavailable, { min: 0 }).errorCodes, ['unavailable']);
  assert.doesNotMatch(JSON.stringify(buildRemainingResult(unavailable, { min: 0 })), /SECRET|message/);
});

test('runner forwards cache and source, emits JSON, and returns 0/1/2', async () => {
  const output = stream();
  let collected;
  const collect = async (options) => { collected = options; return snapshot(); };
  assert.equal(await runRemainingCLI(['codex', '--json', '--min', '12.5', '--no-cache', '--source', 'rollout'], {
    collect, stdout: output, stderr: output,
  }), 0);
  assert.deepEqual(collected, { provider: 'codex', source: 'rollout', cache: false, timeoutMs: 5000 });
  assert.equal(JSON.parse(output.text).minimumRemainingPercent, 12.5);

  assert.equal(await runRemainingCLI(['codex', '--min', '13'], {
    collect: async () => snapshot(), stdout: stream(), stderr: stream(),
  }), 1);
  assert.equal(await runRemainingCLI(['claude'], {
    collect: async () => snapshot({ provider: 'claude', limits: {} }), stdout: stream(), stderr: stream(),
  }), 2);
});

test('runner forwards the Codex app-server timeout override', async () => {
  let collected;
  assert.equal(await runRemainingCLI(['codex', '--app-server-timeout-ms', '15000'], {
    collect: async (options) => { collected = options; return snapshot(); },
    stdout: stream(), stderr: stream(),
  }), 0);
  assert.equal(collected.timeoutMs, 15000);
});

test('plain output is allow-listed and contains no ANSI, emoji, secrets, or raw messages', async () => {
  const output = stream();
  const unsafe = snapshot({
    errors: [{ code: 'read-error', message: '\u001b[31m SECRET raw response' }],
    credits: { balance: 'SECRET' },
  });
  assert.equal(await runRemainingCLI(['codex'], {
    collect: async () => unsafe, stdout: output, stderr: output,
  }), 0);
  assert.match(output.text, /codex: ok/);
  assert.match(output.text, /minimum remaining: 12\.5%/);
  assert.match(output.text, /error: read-error/);
  assert.doesNotMatch(output.text, /\u001b|SECRET|raw response|[\u{1F300}-\u{1FAFF}]/u);
});

test('invalid invocation exits 64 and unexpected collector failures exit 70 safely', async () => {
  const invalid = stream();
  assert.equal(await runRemainingCLI(['gemini'], { stdout: invalid, stderr: invalid }), 64);
  assert.match(invalid.text, /claude or codex/);

  for (const value of ['999', '60001', 'slow']) {
    const timeout = stream();
    assert.equal(await runRemainingCLI(['codex', '--app-server-timeout-ms', value], {
      stdout: timeout, stderr: timeout,
    }), 64);
    assert.match(timeout.text, /--app-server-timeout-ms must be an integer between 1000 and 60000/);
  }

  const internal = stream();
  assert.equal(await runRemainingCLI(['claude'], {
    collect: async () => { throw new Error('SECRET collector failure'); },
    stdout: internal,
    stderr: internal,
  }), 70);
  assert.equal(internal.text, 'Unexpected internal error\n');
});
