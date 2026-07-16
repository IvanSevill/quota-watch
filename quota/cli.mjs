import { collectQuota, evaluateQuota } from './index.mjs';

export function parseQuotaArgs(argv) {
  const options = { provider: 'claude', source: 'auto', json: false, schema: false, quiet: false, min: 10 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--schema') options.schema = true;
    else if (arg === '--quiet') options.quiet = true;
    else if (['--provider', '--source', '--min'].includes(arg)) {
      if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) throw new TypeError(`${arg} needs a value`);
      options[arg.slice(2)] = argv[++i];
    } else throw new TypeError(`unknown quota option: ${arg}`);
  }
  options.min = Number(options.min);
  if (!['claude', 'codex'].includes(options.provider)) throw new TypeError('--provider must be claude or codex');
  if (!['auto', 'app-server', 'rollout'].includes(options.source)) {
    throw new TypeError('--source must be auto, app-server or rollout');
  }
  if (options.provider === 'claude' && options.source !== 'auto') throw new TypeError('--source applies only to codex');
  if (!Number.isFinite(options.min) || options.min < 0 || options.min > 100) {
    throw new TypeError('--min must be between 0 and 100');
  }
  return options;
}

export function formatQuota(snapshot) {
  const lines = [`${snapshot.provider}: ${snapshot.status}`];
  for (const limit of Object.values(snapshot.limits || {})) {
    for (const name of ['primary', 'secondary']) {
      const window = limit[name];
      if (!window) continue;
      lines.push(`  ${limit.id}/${name}: ${window.remainingPercent ?? 'unknown'}% remaining${window.resetAt ? `, resets ${window.resetAt}` : ''}`);
    }
  }
  if (snapshot.source?.stale) lines.push('  stale last-known reading');
  for (const error of snapshot.errors || []) lines.push(`  ${error.code}${error.message ? `: ${error.message}` : ''}`);
  return lines.join('\n');
}

export async function runQuotaCLI(argv, {
  collect = collectQuota, stdout = process.stdout, stderr = process.stderr,
} = {}) {
  let options;
  try { options = parseQuotaArgs(argv); }
  catch (error) { stderr.write(`Error: ${error.message}\n`); return 2; }
  const snapshot = await collect(options);
  const guard = evaluateQuota(snapshot, options);
  if (!options.quiet) stdout.write(`${options.json || options.schema ? JSON.stringify(snapshot, null, 2) : formatQuota(snapshot)}\n`);
  return guard.exitCode;
}
