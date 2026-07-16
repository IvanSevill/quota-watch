const finite = (value) => {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function timestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value < 1e12 ? value * 1000 : value).toISOString();
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function normalizeWindow(raw, { durationMinutes = null } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const used = finite(raw.usedPercent ?? raw.used_percent ?? raw.used_percentage);
  const remaining = finite(raw.remainingPercent ?? raw.remaining_percent);
  const duration = finite(raw.durationMinutes ?? raw.windowDurationMins ?? raw.window_minutes
    ?? raw.windowMinutes ?? durationMinutes);
  const resetAt = timestamp(raw.resetAt ?? raw.resetsAt ?? raw.reset_at ?? raw.resets_at);
  if (used === null && remaining === null && duration === null && resetAt === null) return null;
  const usedPercent = used === null ? (remaining === null ? null : 100 - remaining) : used;
  const remainingPercent = remaining === null ? (used === null ? null : 100 - used) : remaining;
  return {
    usedPercent: usedPercent === null ? null : Math.max(0, Math.min(100, usedPercent)),
    remainingPercent: remainingPercent === null ? null : Math.max(0, Math.min(100, remainingPercent)),
    durationMinutes: duration,
    resetAt,
  };
}

export function normalizeLimit(id, raw) {
  if (!raw || typeof raw !== 'object') return null;
  const hasWindows = raw.primary !== undefined || raw.secondary !== undefined;
  const primary = normalizeWindow(hasWindows ? raw.primary : raw);
  const secondary = normalizeWindow(raw.secondary);
  if (!primary && !secondary) return null;
  return { id: String(id), primary, secondary };
}

export function normalizeCredits(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const value = (key, ...aliases) => {
    for (const name of [key, ...aliases]) if (raw[name] !== undefined) return raw[name];
    return null;
  };
  const spend = value('spendControl', 'spend_control', 'individualLimit', 'individual_limit');
  const reset = value('resetCredits', 'reset_credits', 'rateLimitResetCredits', 'rate_limit_reset_credits');
  const credits = {
    balance: finite(value('balance', 'creditBalance', 'credits')),
    hasCredits: typeof value('hasCredits', 'has_credits') === 'boolean' ? value('hasCredits', 'has_credits') : null,
    unlimited: typeof value('unlimited', 'isUnlimited') === 'boolean' ? value('unlimited', 'isUnlimited') : null,
    resetAt: timestamp(value('resetAt', 'resetsAt', 'reset_at', 'resets_at')),
    spendControl: spend && typeof spend === 'object' ? {
      limit: spend.limit ?? null,
      used: spend.used ?? null,
      remainingPercent: finite(spend.remainingPercent ?? spend.remaining_percent),
      resetAt: timestamp(spend.resetAt ?? spend.resetsAt ?? spend.reset_at ?? spend.resets_at),
    } : spend,
    resetCredits: reset && typeof reset === 'object' ? {
      availableCount: finite(reset.availableCount ?? reset.available_count),
    } : reset,
  };
  return Object.values(credits).every((item) => item === null) ? null : credits;
}

export function errorInfo(code, message = null) {
  return { code: String(code || 'unknown'), message: message == null ? null : String(message).slice(0, 240) };
}

export function createSnapshot({
  provider, status = 'available', limits = {}, source = {}, plan = null, credits = null,
  reached = null, errors = [], now = Date.now(),
}) {
  const observedAt = timestamp(source.observedAt) ?? new Date(now).toISOString();
  const normalized = {};
  for (const [id, raw] of Object.entries(limits || {})) {
    const limit = normalizeLimit(id, raw);
    if (limit) normalized[id] = limit;
  }
  return {
    provider: String(provider),
    status,
    limits: normalized,
    source: {
      kind: source.kind ?? null,
      official: typeof source.official === 'boolean' ? source.official : null,
      observedAt,
      stale: typeof source.stale === 'boolean' ? source.stale : null,
    },
    plan: plan ?? null,
    credits: normalizeCredits(credits),
    reached: reached ?? null,
    errors: (errors || []).map((error) => error?.code ? errorInfo(error.code, error.message) : errorInfo(error)),
  };
}

export function unavailableSnapshot(provider, code, { kind = null, official = null, message = null, now = Date.now() } = {}) {
  return createSnapshot({
    provider,
    status: code === 'unavailable' ? 'unavailable' : 'error',
    source: { kind, official, observedAt: now, stale: null },
    errors: [errorInfo(code, message)],
    now,
  });
}

export function withStaleness(snapshot, { now = Date.now(), freshnessMs = 15 * 60_000 } = {}) {
  const observed = Date.parse(snapshot?.source?.observedAt ?? '');
  const stale = !Number.isFinite(observed) || now - observed > freshnessMs;
  return { ...snapshot, source: { ...snapshot.source, stale } };
}
