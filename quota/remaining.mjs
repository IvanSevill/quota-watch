import { collectQuota } from './index.mjs';
import { evaluateQuota } from './guard.mjs';

const PROVIDERS = new Set(['claude', 'codex']);
const SOURCES = new Set(['auto', 'app-server', 'rollout']);

export function parseRemainingArgs(argv) {
  const [provider, ...args] = argv;
  if (!provider) throw new TypeError('remaining needs a provider: claude or codex');
  if (!PROVIDERS.has(provider)) throw new TypeError('provider must be claude or codex');

  const options = { provider, json: false, min: 0, cache: true, source: 'auto' };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!['--json', '--min', '--no-cache', '--source'].includes(arg)) {
      throw new TypeError(`unexpected argument: ${arg}`);
    }
    if (seen.has(arg)) throw new TypeError(`duplicate option: ${arg}`);
    seen.add(arg);
    if (arg === '--json') options.json = true;
    else if (arg === '--no-cache') options.cache = false;
    else {
      if (args[i + 1] === undefined || args[i + 1].startsWith('--')) {
        throw new TypeError(`${arg} needs a value`);
      }
      options[arg.slice(2)] = args[++i];
    }
  }

  options.min = Number(options.min);
  if (!Number.isFinite(options.min) || options.min < 0 || options.min > 100) {
    throw new TypeError('--min must be between 0 and 100');
  }
  if (!SOURCES.has(options.source)) throw new TypeError('--source must be auto, app-server or rollout');
  if (provider === 'claude' && options.source !== 'auto') {
    throw new TypeError('--source applies only to codex');
  }
  return options;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function buildRemainingResult(snapshot, { min = 0 } = {}) {
  const windows = [];
  for (const limitId of Object.keys(snapshot?.limits || {}).sort(compareText)) {
    const limit = snapshot.limits[limitId];
    for (const name of ['primary', 'secondary']) {
      const window = limit?.[name];
      if (!window) continue;
      windows.push({
        limitId,
        window: name,
        remainingPercent: Number.isFinite(window.remainingPercent) ? window.remainingPercent : null,
        durationMinutes: Number.isFinite(window.durationMinutes) ? window.durationMinutes : null,
        resetAt: typeof window.resetAt === 'string' ? window.resetAt : null,
      });
    }
  }
  const guard = evaluateQuota(snapshot, { min });
  const knownRemaining = windows
    .map((window) => window.remainingPercent)
    .filter((remaining) => remaining !== null);
  const source = snapshot?.source && typeof snapshot.source === 'object' ? snapshot.source : {};
  return {
    schemaVersion: 1,
    provider: snapshot?.provider ?? null,
    result: guard.exitCode === 0 ? 'ok' : guard.exitCode === 1 ? 'low' : 'unknown',
    status: snapshot?.status ?? 'unavailable',
    stale: source.stale === true,
    thresholdPercent: min,
    minimumRemainingPercent: knownRemaining.length ? Math.min(...knownRemaining) : null,
    windows,
    reached: snapshot?.reached ?? null,
    source: {
      kind: typeof source.kind === 'string' ? source.kind : null,
      observedAt: typeof source.observedAt === 'string' ? source.observedAt : null,
    },
    errorCodes: [...new Set((snapshot?.errors || [])
      .map((error) => error?.code)
      .filter((code) => typeof code === 'string'))].sort(compareText),
  };
}

export function formatRemaining(result) {
  const minimum = result.minimumRemainingPercent === null
    ? 'unknown'
    : `${result.minimumRemainingPercent}%`;
  const lines = [
    `${result.provider}: ${result.result}`,
    `status: ${result.status}`,
    `minimum remaining: ${minimum} (threshold: ${result.thresholdPercent}%)`,
  ];
  for (const window of result.windows) {
    const remaining = window.remainingPercent === null ? 'unknown' : `${window.remainingPercent}%`;
    let line = `${window.limitId}/${window.window}: ${remaining} remaining`;
    if (window.durationMinutes !== null) line += `, ${window.durationMinutes} minutes`;
    if (window.resetAt !== null) line += `, resets ${window.resetAt}`;
    lines.push(line);
  }
  if (result.reached !== null) lines.push(`reached: ${result.reached}`);
  if (result.source.kind !== null || result.source.observedAt !== null) {
    lines.push(`source: ${result.source.kind ?? 'unknown'}${result.source.observedAt ? ` at ${result.source.observedAt}` : ''}`);
  }
  for (const code of result.errorCodes) lines.push(`error: ${code}`);
  return lines.join('\n');
}

export async function runRemainingCLI(argv, {
  collect = collectQuota, stdout = process.stdout, stderr = process.stderr,
} = {}) {
  let options;
  try {
    options = parseRemainingArgs(argv);
  } catch (error) {
    stderr.write(`Error: ${error.message}\n`);
    return 64;
  }

  try {
    const snapshot = await collect({
      provider: options.provider,
      source: options.source,
      cache: options.cache,
    });
    const result = buildRemainingResult(snapshot, options);
    stdout.write(`${options.json ? JSON.stringify(result, null, 2) : formatRemaining(result)}\n`);
    return result.result === 'ok' ? 0 : result.result === 'low' ? 1 : 2;
  } catch {
    stderr.write('Unexpected internal error\n');
    return 70;
  }
}
