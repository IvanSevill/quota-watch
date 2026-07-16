export function evaluateQuota(snapshot, { min = 0 } = {}) {
  if (!snapshot || snapshot.status !== 'available') {
    return { ok: false, exitCode: 2, reason: snapshot?.status ?? 'unavailable' };
  }
  if (snapshot.source?.stale) return { ok: false, exitCode: 2, reason: 'stale' };
  const remaining = [];
  for (const limit of Object.values(snapshot.limits || {})) {
    for (const window of [limit.primary, limit.secondary]) {
      if (window?.remainingPercent !== null && window?.remainingPercent !== undefined) {
        remaining.push(window.remainingPercent);
      }
    }
  }
  if (!remaining.length && !snapshot.reached) return { ok: false, exitCode: 2, reason: 'unknown' };
  const lowest = remaining.length ? Math.min(...remaining) : null;
  const blocked = snapshot.reached !== null || (lowest !== null && (lowest <= 0 || lowest < min));
  return {
    ok: !blocked,
    exitCode: blocked ? 1 : 0,
    reason: blocked ? (snapshot.reached ?? 'below-minimum') : null,
    remainingPercent: lowest,
  };
}
