import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createSnapshot, timestamp, unavailableSnapshot, withStaleness } from './schema.mjs';

export const claudeUsageFile = () => process.env.CLAUDE_USAGE_FILE || path.join(os.homedir(), '.claude', 'usage.json');
export const CLAUDE_USAGE_FILE = path.join(os.homedir(), '.claude', 'usage.json');

export function normalizeClaudeUsage(raw, { now = Date.now(), freshnessMs } = {}) {
  const values = raw?.rate_limits ?? raw?.rateLimits ?? raw;
  if (!values || typeof values !== 'object') {
    return unavailableSnapshot('claude', 'unsupported', { kind: 'usage-file', official: false, now });
  }
  const limits = {};
  for (const [id, value] of Object.entries(values)) {
    if (!value || typeof value !== 'object') continue;
    limits[id] = { primary: {
      ...value,
      usedPercent: value.usedPercent ?? value.used_percentage ?? value.utilization ?? value.used ?? null,
    }, secondary: null };
  }
  const observedAt = timestamp(raw?.updatedAt ?? raw?.updated_at);
  const snapshot = createSnapshot({
    provider: 'claude',
    limits,
    plan: raw?.plan ?? raw?.plan_type ?? null,
    credits: raw?.credits ?? null,
    reached: raw?.reached ?? raw?.reached_type ?? null,
    source: { kind: 'usage-file', official: false, observedAt: observedAt ?? now, stale: null },
    now,
  });
  if (!Object.keys(snapshot.limits).length) {
    return unavailableSnapshot('claude', 'unsupported', { kind: 'usage-file', official: false, now });
  }
  return withStaleness(snapshot, { now, freshnessMs });
}

export async function collectClaudeQuota({ file = claudeUsageFile(), readFile = fs.promises.readFile, now = Date.now(), freshnessMs } = {}) {
  try {
    return normalizeClaudeUsage(JSON.parse(await readFile(file, 'utf8')), { now, freshnessMs });
  } catch (error) {
    const code = error?.code === 'ENOENT' ? 'unavailable' : error instanceof SyntaxError ? 'invalid-data' : 'read-error';
    return unavailableSnapshot('claude', code, { kind: 'usage-file', official: false, now });
  }
}
