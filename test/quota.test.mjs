import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readQuotaCache, writeQuotaCache } from '../quota/cache.mjs';
import { collectClaudeQuota, normalizeClaudeUsage } from '../quota/claude.mjs';
import {
  collectCodexAppServer, normalizeCodexRateLimits, requestCodexRateLimits, resolveCodexExecutable,
} from '../quota/codex-app-server.mjs';
import { collectCodexRollout, rateLimitsFromRolloutEvent } from '../quota/codex-rollout.mjs';
import { quotaFromHeaders } from '../quota/headers.mjs';
import { collectCodexQuota } from '../quota/index.mjs';
import { evaluateQuota } from '../quota/guard.mjs';
import { createSnapshot, normalizeWindow } from '../quota/schema.mjs';
import { parseQuotaArgs, runQuotaCLI } from '../quota/cli.mjs';

const NOW = Date.parse('2026-07-15T12:00:00Z');
const RESET = '2026-08-14T12:00:00.000Z';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'quota-watch-'));

test('normalization preserves arbitrary IDs, arbitrary duration, and null rather than false zero', () => {
  const snapshot = normalizeCodexRateLimits({
    rateLimitsByLimitId: {
      'review-model': {
        primary: { usedPercent: 27, windowDurationMins: 43200, resetsAt: RESET },
        secondary: { windowDurationMins: 60 },
      },
    },
    planType: 'team',
    credits: { balance: 12.5, resetAt: RESET, spendControl: { limit: 20 } },
    reachedType: 'secondary',
  }, { now: NOW });
  assert.equal(snapshot.limits['review-model'].primary.durationMinutes, 43200);
  assert.equal(snapshot.limits['review-model'].primary.remainingPercent, 73);
  assert.equal(snapshot.limits['review-model'].secondary.usedPercent, null);
  assert.equal(snapshot.limits['review-model'].secondary.remainingPercent, null);
  assert.equal(snapshot.plan, 'team');
  assert.deepEqual(snapshot.credits.spendControl, {
    limit: 20, used: null, remainingPercent: null, resetAt: null,
  });
  assert.equal(snapshot.reached, 'secondary');
  assert.equal(normalizeWindow({ usedPercent: null, windowDurationMins: null, resetAt: null }), null);
});

test('documented app-server metadata preserves reset credits, spend control, plan, and reached type', () => {
  const snapshot = normalizeCodexRateLimits({
    rateLimits: {
      limitId: 'codex-review',
      primary: { usedPercent: 40, windowDurationMins: 300, resetsAt: NOW / 1000 + 300 },
      credits: { hasCredits: true, unlimited: false, balance: '8.5' },
      individualLimit: { limit: '100', used: '25', remainingPercent: 75, resetsAt: NOW / 1000 + 600 },
      spendControlReached: false,
      planType: 'pro',
      rateLimitReachedType: 'workspace_member_usage_limit_reached',
    },
    rateLimitResetCredits: { availableCount: 3, credits: [{ id: 'opaque-not-exported' }] },
  }, { now: NOW });
  assert.ok(snapshot.limits['codex-review']);
  assert.equal(snapshot.plan, 'pro');
  assert.equal(snapshot.credits.balance, 8.5);
  assert.equal(snapshot.credits.spendControl.remainingPercent, 75);
  assert.equal(snapshot.credits.resetCredits.availableCount, 3);
  assert.equal(snapshot.reached, 'workspace_member_usage_limit_reached');
  assert.doesNotMatch(JSON.stringify(snapshot), /opaque-not-exported/);
});

test('Claude collector defensively normalizes every current usage limit ID', async () => {
  const dir = tmp();
  const file = path.join(dir, 'usage.json');
  fs.writeFileSync(file, JSON.stringify({
    updatedAt: NOW,
    rate_limits: {
      five_hour: { used_percentage: 45, resets_at: RESET },
      custom_monthly: { used_percentage: null, resets_at: RESET },
    },
  }));
  const snapshot = await collectClaudeQuota({ file, now: NOW });
  assert.equal(snapshot.limits.five_hour.primary.remainingPercent, 55);
  assert.equal(snapshot.limits.custom_monthly.primary.usedPercent, null);
  assert.equal(snapshot.source.kind, 'usage-file');
  assert.equal((await collectClaudeQuota({ file: path.join(dir, 'missing') })).status, 'unavailable');
  assert.equal(normalizeClaudeUsage(null, { now: NOW }).status, 'error');
});

function fakeAppServer(result, { reply = true } = {}) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => { child.killed = true; };
  child.stdin.on('data', (chunk) => {
    const message = JSON.parse(chunk.toString('utf8'));
    child.sent ??= [];
    child.sent.push(message);
    if (!reply) return;
    if (message.id === 1) child.stdout.write(`${JSON.stringify({ id: 1, result: {} })}\n`);
    if (message.id === 2) child.stdout.write(`${JSON.stringify({ id: 2, result })}\n`);
  });
  return child;
}

test('Codex app-server performs initialize/initialized/read with IDs and kills the child', async () => {
  const child = fakeAppServer({ rateLimits: { primary: { usedPercent: 10, windowDurationMins: 300 } } });
  const result = await requestCodexRateLimits({ resolveCommand: (command) => command, spawn: (command, args, options) => {
    assert.equal(command, 'codex');
    assert.deepEqual(args, ['app-server']);
    assert.deepEqual(options.stdio, ['pipe', 'pipe', 'pipe']);
    assert.equal(options.env.NoDefaultCurrentDirectoryInExePath, '1');
    return child;
  } });
  assert.equal(result.rateLimits.primary.usedPercent, 10);
  assert.deepEqual(child.sent.map(({ id, method }) => ({ id, method })), [
    { id: 1, method: 'initialize' },
    { id: undefined, method: 'initialized' },
    { id: 2, method: 'account/rateLimits/read' },
  ]);
  assert.equal(child.killed, true);
});

test('Windows Codex resolution ignores cwd and selects an absolute PATH executable', () => {
  const existing = new Set(['c:\\trusted\\codex.cmd']);
  const resolved = resolveCodexExecutable('codex', {
    platform: 'win32', cwd: 'C:\\work',
    env: { Path: 'C:\\work;C:\\trusted', PATHEXT: '.EXE;.CMD' },
    isFile: (file) => existing.has(file.toLowerCase()),
  });
  assert.equal(resolved.toLowerCase(), 'c:\\trusted\\codex.cmd');
});

test('Codex app-server timeout is an expected error state and kills its child', async () => {
  const child = fakeAppServer({}, { reply: false });
  const snapshot = await collectCodexAppServer({ spawn: () => child, timeoutMs: 10, now: NOW });
  assert.equal(snapshot.status, 'error');
  assert.equal(snapshot.errors[0].code, 'timeout');
  assert.equal(child.killed, true);
});

test('header parser accepts multiple arbitrary limit families, null fields, and 429 snapshots', () => {
  const headers = new Headers({
    'x-codex-primary-used-percent': '100',
    'x-codex-primary-window-minutes': '300',
    'x-review-primary-used-percent': '25',
    'x-review-primary-window-minutes': '43200',
    'x-review-secondary-reset-at': RESET,
  });
  const snapshot = quotaFromHeaders(headers, { now: NOW, status: 429 });
  assert.deepEqual(Object.keys(snapshot.limits).sort(), ['codex', 'review']);
  assert.equal(snapshot.limits.review.primary.durationMinutes, 43200);
  assert.equal(snapshot.limits.review.secondary.usedPercent, null);
  assert.equal(snapshot.reached, 'rate_limit');
  assert.equal(quotaFromHeaders(new Headers(), { now: NOW }), null);
});

test('rollout parser allow-lists event_msg/token_count and never returns prompt or raw content', async () => {
  const sessions = path.join(tmp(), 'sessions', '2026', '07', '15');
  fs.mkdirSync(sessions, { recursive: true });
  const file = path.join(sessions, 'rollout-test.jsonl');
  fs.writeFileSync(file, [
    JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'SECRET PROMPT' } }),
    JSON.stringify({ timestamp: new Date(NOW).toISOString(), type: 'event_msg', payload: {
      type: 'token_count', raw_response: 'SECRET TOKEN', rate_limits: {
        primary: { used_percent: 20, window_minutes: 43200, reset_at: RESET },
      },
    } }),
  ].join('\n'));
  assert.equal(rateLimitsFromRolloutEvent({ type: 'token_count', rate_limits: {} }), null);
  const snapshot = await collectCodexRollout({ sessionsDir: path.join(sessions, '..', '..', '..'), now: NOW });
  assert.equal(snapshot.limits.codex.primary.durationMinutes, 43200);
  assert.doesNotMatch(JSON.stringify(snapshot), /SECRET|raw_response|message/);
});

test('explicit app-server can fall back to a same-source last-known-good cache', async () => {
  const file = path.join(tmp(), 'quota.json');
  const good = createSnapshot({
    provider: 'codex', limits: { codex: { primary: { usedPercent: 10 } } },
    source: { kind: 'app-server', official: true, observedAt: NOW }, now: NOW,
  });
  await writeQuotaCache(good, { file });
  await writeQuotaCache(good, { file });
  const stale = await readQuotaCache('codex', { file, now: NOW + 16 * 60_000, freshnessMs: 15 * 60_000 });
  assert.equal(stale.source.stale, true);
  assert.equal(evaluateQuota(stale).exitCode, 2);
  assert.equal(stale.source.kind, 'cache:app-server');
  const snapshot = await collectCodexQuota({
    source: 'app-server',
    spawn: () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); },
    cacheFile: file,
    now: NOW + 1000,
  });
  assert.equal(snapshot.status, 'available');
  assert.equal(snapshot.source.kind, 'cache:app-server');
});

test('explicit rollout never returns a fresher app-server cache', async () => {
  const root = tmp();
  const sessions = path.join(root, 'sessions');
  const file = path.join(sessions, 'rollout-stale.jsonl');
  const cacheFile = path.join(root, 'quota.json');
  fs.mkdirSync(sessions, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    timestamp: new Date(NOW - 20 * 60_000).toISOString(), type: 'event_msg',
    payload: { type: 'token_count', rate_limits: { primary: { used_percent: 90 } } },
  }));
  const fresh = createSnapshot({
    provider: 'codex', limits: { codex: { primary: { usedPercent: 20 } } },
    source: { kind: 'app-server', official: true, observedAt: NOW - 60_000 }, now: NOW,
  });
  await writeQuotaCache(fresh, { file: cacheFile });
  const selected = await collectCodexQuota({ source: 'rollout', sessionsDir: sessions, cacheFile, now: NOW });
  assert.equal(selected.limits.codex.primary.remainingPercent, 10);
  assert.equal(selected.source.kind, 'rollout');
  assert.equal((await readQuotaCache('codex', { file: cacheFile, now: NOW })).source.observedAt, fresh.source.observedAt);
});

test('explicit app-server never returns a rollout cache', async () => {
  const cacheFile = path.join(tmp(), 'quota.json');
  const rollout = createSnapshot({
    provider: 'codex', limits: { codex: { primary: { usedPercent: 20 } } },
    source: { kind: 'rollout', official: false, observedAt: NOW }, now: NOW,
  });
  await writeQuotaCache(rollout, { file: cacheFile });
  const selected = await collectCodexQuota({
    source: 'app-server', cacheFile, now: NOW,
    spawn: () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); },
  });
  assert.equal(selected.status, 'error');
  assert.equal(selected.source.kind, 'app-server');
});

test('CLI validates options and returns planned 0/1/2 exits without leaking data', async () => {
  assert.equal(parseQuotaArgs(['--provider', 'codex', '--source', 'rollout', '--min', '15']).provider, 'codex');
  assert.throws(() => parseQuotaArgs(['--provider', 'other']), /claude or codex/);
  const output = { text: '', write(value) { this.text += value; } };
  const snapshot = createSnapshot({
    provider: 'codex', limits: { codex: { primary: { remainingPercent: 20 } } },
    source: { kind: 'test', official: false, observedAt: NOW }, now: NOW,
  });
  assert.equal(await runQuotaCLI(['--json', '--min', '20'], { collect: async () => snapshot, stdout: output, stderr: output }), 0);
  assert.equal(await runQuotaCLI(['--quiet', '--min', '21'], { collect: async () => snapshot, stdout: output, stderr: output }), 1);
  const empty = createSnapshot({
    provider: 'codex', limits: { codex: { primary: { remainingPercent: 0 } } },
    source: { kind: 'test', official: false, observedAt: NOW }, now: NOW,
  });
  assert.equal(await runQuotaCLI(['--quiet'], { collect: async () => empty, stdout: output, stderr: output }), 1);
  assert.equal(await runQuotaCLI([], { collect: async () => ({ ...snapshot, status: 'unavailable' }), stdout: output, stderr: output }), 2);
  assert.doesNotMatch(output.text, /credential|authorization|SECRET/);
});
