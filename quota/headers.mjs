import { createSnapshot } from './schema.mjs';

function entries(headers) {
  if (headers?.entries) return [...headers.entries()];
  return Object.entries(headers || {});
}

export function quotaFromHeaders(headers, { now = Date.now(), status = null } = {}) {
  const limits = {};
  for (const [rawName, value] of entries(headers)) {
    const name = String(rawName).toLowerCase();
    const match = name.match(/^x-(.+)-(primary|secondary)-(used-percent|remaining-percent|window-minutes|reset-at)$/);
    if (!match) continue;
    const [, id, window, field] = match;
    const target = (limits[id] ??= { primary: {}, secondary: {} })[window];
    if (field === 'used-percent') target.usedPercent = value;
    else if (field === 'remaining-percent') target.remainingPercent = value;
    else if (field === 'window-minutes') target.durationMinutes = value;
    else target.resetAt = value;
  }
  const snapshot = createSnapshot({
    provider: 'codex',
    limits,
    reached: status === 429 ? 'rate_limit' : null,
    source: { kind: 'headers', official: true, observedAt: now, stale: false },
    now,
  });
  return Object.keys(snapshot.limits).length ? snapshot : null;
}
