export type QuotaProvider = 'claude' | 'codex';

export type QuotaGradient = 'green-red' | 'blue-red';

export type QuotaDisplayRow = {
  remainingPercent: number;
  percentText: string;
  filledCells: number;
  resetText: string;
  gradient: QuotaGradient;
};

export type QuotaDisplayModel = {
  provider: QuotaProvider;
  state: 'loading' | 'fresh' | 'stale' | 'unavailable';
  rows: QuotaDisplayRow[];
};

export type CanonicalQuotaWindow = {
  remainingPercent?: unknown;
  durationMinutes?: unknown;
  resetAt?: unknown;
};

export type CanonicalQuotaSnapshot = {
  status?: unknown;
  limits?: Record<string, {
    primary?: CanonicalQuotaWindow | null;
    secondary?: CanonicalQuotaWindow | null;
  }>;
  source?: {
    stale?: unknown;
    observedAt?: unknown;
  };
};

export function formatReset(resetAt: unknown, now?: number): string;
export function flattenQuotaWindows(snapshot: CanonicalQuotaSnapshot | null | undefined): Array<{
  limitId: string;
  windowName: 'primary' | 'secondary';
  durationMinutes: number | null;
  remainingPercent: number;
  resetAt: unknown;
}>;
export function quotaBarRgb(
  gradient: QuotaGradient,
  remainingPercent: number,
): [number, number, number];
export function isQuotaProvider(value: unknown): value is QuotaProvider;
export function selectedQuotaProvider(value: unknown): QuotaProvider;
export function toggleQuotaProvider(provider: QuotaProvider): QuotaProvider;
export function loadingQuotaDisplay(provider: QuotaProvider): QuotaDisplayModel;
export function unavailableQuotaDisplay(provider: QuotaProvider): QuotaDisplayModel;
export function quotaDisplay(
  provider: QuotaProvider,
  snapshot: CanonicalQuotaSnapshot | null | undefined,
  options?: { now?: number },
): QuotaDisplayModel;
