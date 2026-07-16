const BAR_CELLS = 13;

const PROVIDER_LABELS = new Map([
  ['claude', 'Claude'],
  ['codex', 'Codex'],
]);

export function isQuotaProvider(value) {
  return PROVIDER_LABELS.has(value);
}

export function selectedQuotaProvider(value) {
  return isQuotaProvider(value) ? value : 'codex';
}

export function toggleQuotaProvider(provider) {
  return requireProvider(provider) === 'claude' ? 'codex' : 'claude';
}

function requireProvider(provider) {
  if (!isQuotaProvider(provider)) throw new TypeError(`Invalid quota provider: ${String(provider)}`);
  return provider;
}

const finiteNumber = (value) => {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const safeIdentifier = (value) => String(value)
  .replace(/[^\x20-\x7e]/g, '?')
  .trim()
  .replace(/\s+/g, '-');

function clampedRemaining(value) {
  const parsed = finiteNumber(value);
  return parsed === null ? null : Math.max(0, Math.min(100, parsed));
}

function compactDuration(milliseconds) {
  const totalMinutes = Math.max(0, Math.floor(milliseconds / 60_000));
  if (totalMinutes < 1) return '<1m';
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

export function formatReset(resetAt, now = Date.now()) {
  const reset = typeof resetAt === 'number' ? resetAt : Date.parse(String(resetAt ?? ''));
  if (!Number.isFinite(reset)) return '—';
  if (reset <= now) return 'now';
  return compactDuration(reset - now);
}

export function flattenQuotaWindows(snapshot) {
  const windows = [];
  for (const [rawLimitId, limit] of Object.entries(snapshot?.limits ?? {})) {
    const limitId = safeIdentifier(rawLimitId);
    for (const windowName of ['primary', 'secondary']) {
      const window = limit?.[windowName];
      const remainingPercent = clampedRemaining(window?.remainingPercent);
      if (!window || remainingPercent === null) continue;
      const rawDuration = finiteNumber(window.durationMinutes);
      windows.push({
        limitId,
        windowName,
        durationMinutes: rawDuration !== null && rawDuration > 0 ? rawDuration : null,
        remainingPercent,
        resetAt: window.resetAt ?? null,
      });
    }
  }
  return windows.sort((left, right) => {
    const leftKnown = left.durationMinutes !== null;
    const rightKnown = right.durationMinutes !== null;
    if (leftKnown !== rightKnown) return leftKnown ? -1 : 1;
    return (left.durationMinutes ?? 0) - (right.durationMinutes ?? 0)
      || left.limitId.localeCompare(right.limitId)
      || (left.windowName === right.windowName ? 0 : left.windowName === 'primary' ? -1 : 1);
  });
}

function claudeWindows(snapshot) {
  return [
    ['five_hour', 'green-red'],
    ['seven_day', 'blue-red'],
  ].flatMap(([limitId, gradient]) => {
    const window = snapshot?.limits?.[limitId]?.primary;
    const remainingPercent = clampedRemaining(window?.remainingPercent);
    return window && remainingPercent !== null
      ? [{ remainingPercent, resetAt: window.resetAt ?? null, gradient }]
      : [];
  });
}

function displayRow(window, stale, now, gradient) {
  const reset = formatReset(window.resetAt, now);
  return {
    remainingPercent: window.remainingPercent,
    percentText: `${Math.round(window.remainingPercent)}%`,
    filledCells: Math.floor((window.remainingPercent / 100) * BAR_CELLS + 0.5),
    resetText: stale && reset !== '—' ? `~${reset}` : reset,
    gradient,
  };
}

export function quotaBarRgb(gradient, remainingPercent) {
  const remaining = clampedRemaining(remainingPercent);
  if (remaining === null) throw new TypeError(`Invalid remaining percentage: ${String(remainingPercent)}`);
  const usage = 1 - remaining / 100;
  if (gradient === 'green-red') {
    return [
      Math.floor(220 * usage),
      Math.floor(255 * (1 - usage)),
      Math.floor(80 * (1 - usage)),
    ];
  }
  if (gradient === 'blue-red') {
    return [
      Math.floor(30 + 190 * usage),
      Math.floor(90 * (1 - usage)),
      Math.floor(230 * (1 - usage)),
    ];
  }
  throw new TypeError(`Invalid quota gradient: ${String(gradient)}`);
}

export function loadingQuotaDisplay(provider) {
  return { provider: requireProvider(provider), state: 'loading', rows: [] };
}

export function unavailableQuotaDisplay(provider) {
  return { provider: requireProvider(provider), state: 'unavailable', rows: [] };
}

export function quotaDisplay(provider, snapshot, { now = Date.now() } = {}) {
  const validProvider = requireProvider(provider);
  if (snapshot?.status !== 'available') return unavailableQuotaDisplay(validProvider);

  const stale = snapshot?.source?.stale === true;
  const windows = validProvider === 'claude'
    ? claudeWindows(snapshot)
    : flattenQuotaWindows(snapshot).map((window, index) => ({
      ...window,
      gradient: index === 0 ? 'green-red' : 'blue-red',
    }));
  if (windows.length === 0) return unavailableQuotaDisplay(validProvider);

  return {
    provider: validProvider,
    state: stale ? 'stale' : 'fresh',
    rows: windows.map((window) => displayRow(window, stale, now, window.gradient)),
  };
}
