import { collectClaudeQuota } from './claude.mjs';
import { readQuotaCache, writeQuotaCache } from './cache.mjs';
import { collectCodexAppServer } from './codex-app-server.mjs';
import { collectCodexRollout } from './codex-rollout.mjs';
import { evaluateQuota } from './guard.mjs';

export { readQuotaCache, writeQuotaCache, quotaCacheFile } from './cache.mjs';
export { collectClaudeQuota, normalizeClaudeUsage, claudeUsageFile } from './claude.mjs';
export { collectCodexAppServer, normalizeCodexRateLimits, requestCodexRateLimits } from './codex-app-server.mjs';
export { collectCodexRollout, rateLimitsFromRolloutEvent, codexSessionsDir } from './codex-rollout.mjs';
export { quotaFromHeaders } from './headers.mjs';
export { evaluateQuota } from './guard.mjs';
export * from './schema.mjs';

function freshestUsable(left, right) {
  if (left?.status !== 'available') return right;
  if (right?.status !== 'available') return left;
  const leftFresh = left.source?.stale !== true;
  const rightFresh = right.source?.stale !== true;
  if (leftFresh !== rightFresh) return leftFresh ? left : right;
  const observed = (snapshot) => Date.parse(snapshot.source?.observedAt ?? '') || -Infinity;
  return observed(left) >= observed(right) ? left : right;
}

export async function collectCodexQuota({ source = 'auto', cache = true, cacheFile, ...options } = {}) {
  let snapshot = source === 'rollout' ? await collectCodexRollout(options) : await collectCodexAppServer(options);
  if (source === 'auto' && snapshot.status !== 'available') snapshot = await collectCodexRollout(options);
  if (!cache) return snapshot;
  const cached = await readQuotaCache('codex', {
    file: cacheFile, now: options.now, freshnessMs: options.freshnessMs,
  });
  const sourceCache = source === 'auto' || cached?.source?.kind === `cache:${source}` ? cached : null;
  const selected = freshestUsable(snapshot, sourceCache) ?? snapshot;
  if (selected === snapshot && snapshot.status === 'available' && snapshot.source?.stale !== true) {
    await writeQuotaCache(snapshot, { file: cacheFile }).catch(() => false);
  }
  return selected;
}

export async function collectQuota({ provider = 'claude', source = 'auto', cache = true, cacheFile, ...options } = {}) {
  let snapshot;
  if (provider === 'claude') snapshot = await collectClaudeQuota(options);
  else if (provider === 'codex') return collectCodexQuota({ source, cache, cacheFile, ...options });
  else throw new TypeError(`unsupported quota provider: ${provider}`);
  if (snapshot.status === 'available') {
    if (cache) await writeQuotaCache(snapshot, { file: cacheFile }).catch(() => false);
    return snapshot;
  }
  if (cache) {
    return await readQuotaCache(provider, {
      file: cacheFile, now: options.now, freshnessMs: options.freshnessMs,
    }) ?? snapshot;
  }
  return snapshot;
}

export async function collectAndEvaluate(options) {
  const snapshot = await collectQuota(options);
  return { snapshot, guard: evaluateQuota(snapshot, options) };
}
