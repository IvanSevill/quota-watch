import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  flattenQuotaWindows,
  formatReset,
  isQuotaProvider,
  loadingQuotaDisplay,
  quotaBarRgb,
  quotaDisplay,
  selectedQuotaProvider,
  toggleQuotaProvider,
  unavailableQuotaDisplay,
} from '../opencode/quota-display.mjs';

const NOW = Date.parse('2026-07-16T12:00:00Z');
const snapshot = (limits, source = {}) => ({
  status: 'available',
  limits,
  source: { observedAt: new Date(NOW).toISOString(), stale: false, ...source },
});

test('rowless displays retain explicit provider identity', () => {
  for (const provider of ['claude', 'codex']) {
    assert.deepEqual(loadingQuotaDisplay(provider), { provider, state: 'loading', rows: [] });
    assert.deepEqual(unavailableQuotaDisplay(provider), { provider, state: 'unavailable', rows: [] });
  }
});

test('provider selection accepts only exact values, defaults to Codex, and toggles deterministically', () => {
  assert.equal(isQuotaProvider('claude'), true);
  assert.equal(isQuotaProvider('codex'), true);
  for (const value of ['Claude', 'other', '', null, undefined, 1, {}]) {
    assert.equal(isQuotaProvider(value), false);
    assert.equal(selectedQuotaProvider(value), 'codex');
  }
  assert.equal(toggleQuotaProvider('claude'), 'codex');
  assert.equal(toggleQuotaProvider('codex'), 'claude');
  assert.throws(() => loadingQuotaDisplay('other'), /Invalid quota provider/);
});

test('Claude selects recognized primary windows in semantic order', () => {
  const model = quotaDisplay('claude', snapshot({
    unrelated: { primary: { remainingPercent: 1, durationMinutes: 60 } },
    seven_day: {
      primary: { remainingPercent: 85, resetAt: NOW + 5 * 86_400_000 + 8 * 3_600_000 },
      secondary: { remainingPercent: 2 },
    },
    five_hour: { primary: { remainingPercent: 62, resetAt: NOW + 2 * 3_600_000 + 15 * 60_000 } },
  }), { now: NOW });

  assert.deepEqual(model, {
    provider: 'claude',
    state: 'fresh',
    rows: [
      { remainingPercent: 62, percentText: '62%', filledCells: 8, resetText: '2h 15m', gradient: 'green-red' },
      { remainingPercent: 85, percentText: '85%', filledCells: 11, resetText: '5d 8h', gradient: 'blue-red' },
    ],
  });
});

test('Claude degrades recognized windows independently and ignores unknown percentages', () => {
  const partial = quotaDisplay('claude', snapshot({
    five_hour: { primary: { remainingPercent: null } },
    seven_day: { primary: { remainingPercent: 85 } },
    other: { primary: { remainingPercent: 50 } },
  }), { now: NOW });
  assert.deepEqual(partial.rows, [
    { remainingPercent: 85, percentText: '85%', filledCells: 11, resetText: '—', gradient: 'blue-red' },
  ]);
  assert.deepEqual(quotaDisplay('claude', snapshot({ other: {
    primary: { remainingPercent: 50 },
  } }), { now: NOW }), { provider: 'claude', state: 'unavailable', rows: [] });
});

test('current Codex seven-day window renders as one generic row', () => {
  const model = quotaDisplay('codex', snapshot({ codex: {
    primary: { remainingPercent: 72, durationMinutes: 10_080, resetAt: NOW + 2 * 3_600_000 + 15 * 60_000 },
  } }), { now: NOW });
  assert.deepEqual(model, {
    provider: 'codex',
    state: 'fresh',
    rows: [
      { remainingPercent: 72, percentText: '72%', filledCells: 9, resetText: '2h 15m', gradient: 'green-red' },
    ],
  });
  assert.equal(JSON.stringify(model).includes('monthly'), false);
});

test('Codex sorts generic windows by duration, sanitized ID, and explicit window order', () => {
  const input = snapshot({
    zeta: { primary: { remainingPercent: 10 } },
    'beta\n': { secondary: { remainingPercent: 20, durationMinutes: 300 } },
    alpha: {
      secondary: { remainingPercent: 30, durationMinutes: 300 },
      primary: { remainingPercent: 40, durationMinutes: 300 },
    },
    omega: { primary: { remainingPercent: 50, durationMinutes: 60 } },
  });
  assert.deepEqual(flattenQuotaWindows(input).map(({ limitId, windowName, durationMinutes }) => (
    [limitId, windowName, durationMinutes]
  )), [
    ['omega', 'primary', 60],
    ['alpha', 'primary', 300],
    ['alpha', 'secondary', 300],
    ['beta?', 'secondary', 300],
    ['zeta', 'primary', null],
  ]);
  assert.deepEqual(quotaDisplay('codex', input, { now: NOW }).rows.map((row) => row.gradient), [
    'green-red', 'blue-red', 'blue-red', 'blue-red', 'blue-red',
  ]);
});

test('percentages clamp before integer display and half-up 13-cell rounding', () => {
  const limits = Object.fromEntries([-10, 3.84, 50, 72, 100, 120, 41.5].map((remainingPercent, index) => [
    `limit-${index}`,
    { primary: { remainingPercent, durationMinutes: index + 1 } },
  ]));
  const rows = quotaDisplay('codex', snapshot(limits), { now: NOW }).rows;
  assert.deepEqual(rows.map(({ remainingPercent, percentText, filledCells }) => (
    [remainingPercent, percentText, filledCells]
  )), [
    [0, '0%', 0],
    [3.84, '4%', 0],
    [50, '50%', 7],
    [72, '72%', 9],
    [100, '100%', 13],
    [100, '100%', 13],
    [41.5, '42%', 5],
  ]);
});

test('reset formatting handles compact future, elapsed, and unknown values', () => {
  assert.equal(formatReset(NOW + 2 * 3_600_000 + 15 * 60_000, NOW), '2h 15m');
  assert.equal(formatReset(NOW + 5 * 86_400_000 + 8 * 3_600_000 + 59 * 60_000, NOW), '5d 8h');
  assert.equal(formatReset(NOW + 30_000, NOW), '<1m');
  assert.equal(formatReset(NOW - 1, NOW), 'now');
  assert.equal(formatReset('not-a-date', NOW), '—');
  assert.equal(formatReset(null, NOW), '—');
});

test('stale usable rows prefix only known reset tokens', () => {
  const model = quotaDisplay('claude', snapshot({
    five_hour: { primary: { remainingPercent: 62, resetAt: NOW + 2 * 3_600_000 + 15 * 60_000 } },
    seven_day: { primary: { remainingPercent: 85, resetAt: 'invalid' } },
  }, { stale: true }), { now: NOW });
  assert.equal(model.state, 'stale');
  assert.deepEqual(model.rows.map((row) => row.resetText), ['~2h 15m', '—']);

  const elapsed = quotaDisplay('claude', snapshot({
    five_hour: { primary: { remainingPercent: 50, resetAt: NOW - 1 } },
  }, { stale: true }), { now: NOW });
  assert.equal(elapsed.rows[0].resetText, '~now');
});

test('unavailable and error snapshots remain rowless', () => {
  for (const status of ['unavailable', 'error']) {
    assert.deepEqual(quotaDisplay('claude', { status, limits: {}, source: {} }, { now: NOW }), {
      provider: 'claude', state: 'unavailable', rows: [],
    });
  }
  assert.deepEqual(quotaDisplay('codex', null, { now: NOW }), {
    provider: 'codex', state: 'unavailable', rows: [],
  });
});

test('quota bar RGB interpolation uses exact floor-based ramps', () => {
  assert.deepEqual(quotaBarRgb('green-red', 100), [0, 255, 80]);
  assert.deepEqual(quotaBarRgb('green-red', 50), [110, 127, 40]);
  assert.deepEqual(quotaBarRgb('green-red', 0), [220, 0, 0]);
  assert.deepEqual(quotaBarRgb('blue-red', 100), [30, 90, 230]);
  assert.deepEqual(quotaBarRgb('blue-red', 50), [125, 45, 115]);
  assert.deepEqual(quotaBarRgb('blue-red', 0), [220, 0, 0]);
  assert.deepEqual(quotaBarRgb('green-red', 120), [0, 255, 80]);
  assert.deepEqual(quotaBarRgb('blue-red', -10), [220, 0, 0]);
});

test('display ignores unrelated secret-bearing fixture fields', () => {
  const input = {
    ...snapshot({ codex: { primary: { remainingPercent: 75, durationMinutes: 300 } } }),
    credential: 'SECRET_CREDENTIAL',
    auth: 'SECRET_AUTH',
    token: 'SECRET_TOKEN',
    prompt: 'SECRET_PROMPT',
  };
  assert.doesNotMatch(JSON.stringify(quotaDisplay('codex', input, { now: NOW })), /SECRET|credential|auth|token|prompt/i);
});
