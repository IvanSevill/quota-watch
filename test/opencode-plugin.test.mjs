import { test } from 'node:test';
import assert from 'node:assert/strict';

import plugin, { plugin as makePlugin, contextSnapshot, createQuotaScanner, installFetchObserver, isCodexResponsesURL } from '../opencode/usage-metrics.mjs';

async function harness(options) {
  const hooks = {};
  let tool;
  let event;
  let aborted;
  const instance = makePlugin(options);
  const cleanup = await instance.setup({
    session: { hook: async (name, callback) => { hooks[name] = callback; } },
    model: { list: async () => ({ data: [{ providerID: 'openai', id: 'm1', limit: { context: 1000 } }] }) },
    tool: { transform: async (callback) => callback({ add: (value) => { tool = value; } }) },
    event: { subscribe: ({ signal }) => {
      aborted = signal;
      return { async *[Symbol.asyncIterator]() {
        while (!signal.aborted) {
          if (event) { const next = event; event = null; yield next; }
          else await new Promise((resolve) => setTimeout(resolve, 2));
        }
      } };
    } },
  });
  return { hooks, tool, cleanup, aborted: () => aborted, send: async (value) => {
    event = value;
    await new Promise((resolve) => setTimeout(resolve, 15));
  } };
}

test('fetch observer records all header families even on a non-2xx Codex response', async () => {
  const target = {
    fetch: async () => ({
      ok: false,
      status: 429,
      headers: new Headers({
        'x-codex-primary-used-percent': '100',
        'x-codex-primary-window-minutes': '300',
        'x-other-secondary-used-percent': '15',
        'x-other-secondary-window-minutes': '43200',
      }),
    }),
  };
  const state = installFetchObserver(target);
  await target.fetch('https://chatgpt.com/backend-api/codex/responses');
  assert.equal(state.latest.reached, 'rate_limit');
  assert.equal(state.latest.limits.codex.primary.remainingPercent, 0);
  assert.equal(state.latest.limits.other.secondary.durationMinutes, 43200);
  assert.equal(isCodexResponsesURL('https://evil.example/backend-api/codex/responses'), false);
});

test('V2 plugin keeps quota and context occupancy as separate snapshots', async () => {
  const quota = { provider: 'codex', status: 'unavailable', limits: {}, source: {}, errors: [] };
  const h = await harness({ scan: async () => quota });
  await h.hooks.context({ sessionID: 's1', model: { providerID: 'openai', id: 'm1' } });
  await h.send({ type: 'session.step.ended', created: 100, data: {
    assistantMessageID: 'm', sessionID: 's1', tokens: { input: 100, output: 50 },
  } });
  const result = JSON.parse((await h.tool.execute({}, { sessionID: 's1' })).content);
  assert.deepEqual(result.codex, quota);
  assert.equal(result.context.occupancy.percent, 15);
  assert.equal(result.context.occupancy.basis, 'tokens.input + tokens.output');
  h.cleanup();
  assert.equal(h.aborted().aborted, true);
});

test('context occupancy remains null when the context limit is unknown', () => {
  const snapshot = contextSnapshot({ provider_id: 'p', model_id: 'm', context_limit: null }, {
    providerID: 'p', modelID: 'm', tokens: { input: 4, output: 2 },
  });
  assert.equal(snapshot.occupancy.tokens, 6);
  assert.equal(snapshot.occupancy.percent, null);
  assert.equal(snapshot.remaining_tokens, null);
});

test('plugin background scanner prefers the aggregate auto collector and caches it', async () => {
  const calls = [];
  const snapshot = { provider: 'codex', status: 'available' };
  const scan = createQuotaScanner({ cacheMs: 1000, collect: async (options) => {
    calls.push(options);
    return snapshot;
  } });
  assert.equal(await scan(100), snapshot);
  assert.equal(await scan(200), snapshot);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].source, 'auto');
});

test('expired V2 response-header quota is rescanned instead of remaining fresh forever', async () => {
  const now = Date.now() + 16 * 60_000;
  const scanned = { provider: 'codex', status: 'available', limits: {}, source: { stale: false } };
  let scans = 0;
  const h = await harness({ now: () => now, scan: async () => { scans += 1; return scanned; } });
  await h.hooks['http.response']({
    request: new Request('https://chatgpt.com/backend-api/codex/responses'),
    response: new Response('', { headers: { 'x-codex-primary-used-percent': '10' } }),
  });
  const result = JSON.parse((await h.tool.execute({}, { sessionID: 's1' })).content);
  h.cleanup();
  assert.equal(scans, 1);
  assert.deepEqual(result.codex, scanned);
});
