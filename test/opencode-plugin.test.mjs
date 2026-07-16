import { test } from 'node:test';
import assert from 'node:assert/strict';

import plugin, { contextSnapshot, createQuotaScanner, installFetchObserver, isCodexResponsesURL } from '../opencode/usage-metrics.mjs';

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

test('direct plugin keeps quota and context occupancy as separate snapshots', async () => {
  const target = { fetch: async () => ({ ok: true, status: 200, headers: new Headers() }) };
  const quota = { provider: 'codex', status: 'unavailable', limits: {}, source: {}, errors: [] };
  const hooks = await plugin({ target, scan: async () => quota });
  await hooks['chat.params']({
    sessionID: 's1', model: { providerID: 'openai', modelID: 'm1', limit: { context: 1000 } },
  }, {});
  await hooks.event({ event: { type: 'message.updated', properties: { info: {
    id: 'm', role: 'assistant', sessionID: 's1', providerID: 'openai', modelID: 'm1',
    tokens: { input: 100, output: 50 }, time: { created: '2026-07-15T12:00:00Z' },
  } } } });
  const result = JSON.parse(await hooks.tool.usage_metrics.execute({}, { sessionID: 's1' }));
  assert.deepEqual(result.codex, quota);
  assert.equal(result.context.occupancy.percent, 15);
  assert.equal(result.context.occupancy.basis, 'tokens.input + tokens.output');
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

test('expired response-header quota is rescanned instead of remaining fresh forever', async () => {
  const now = Date.parse('2026-07-16T12:00:00Z');
  const target = { fetch: async () => ({
    status: 200,
    headers: new Headers({ 'x-codex-primary-used-percent': '10' }),
  }) };
  const state = installFetchObserver(target);
  await target.fetch('https://chatgpt.com/backend-api/codex/responses');
  state.latest.source.observedAt = new Date(now - 16 * 60_000).toISOString();
  const scanned = { provider: 'codex', status: 'available', limits: {}, source: { stale: false } };
  let scans = 0;
  const hooks = await plugin({ target, now: () => now, scan: async () => { scans += 1; return scanned; } });
  const result = JSON.parse(await hooks.tool.usage_metrics.execute({}, {}));
  assert.equal(scans, 1);
  assert.deepEqual(result.codex, scanned);
});
