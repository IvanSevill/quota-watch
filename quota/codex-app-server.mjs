import { spawn as nodeSpawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { createSnapshot, unavailableSnapshot, withStaleness } from './schema.mjs';

export function normalizeCodexRateLimits(result, { now = Date.now(), freshnessMs } = {}) {
  const limits = {};
  const byId = result?.rateLimitsByLimitId ?? result?.rate_limits_by_limit_id;
  if (byId && typeof byId === 'object') Object.assign(limits, byId);
  const defaultLimits = result?.rateLimits ?? result?.rate_limits;
  const defaultId = defaultLimits?.limitId ?? defaultLimits?.limit_id ?? 'codex';
  if (defaultLimits && typeof defaultLimits === 'object') {
    const looksLikeWindows = defaultLimits.primary !== undefined || defaultLimits.secondary !== undefined;
    if (looksLikeWindows) limits[defaultId] ??= defaultLimits;
    else for (const [id, value] of Object.entries(defaultLimits)) limits[id] ??= value;
  }
  const metadata = defaultLimits && typeof defaultLimits === 'object' ? defaultLimits : {};
  const credits = result?.credits ?? metadata.credits ?? {};
  const snapshot = createSnapshot({
    provider: 'codex',
    limits,
    plan: result?.plan ?? result?.planType ?? result?.plan_type ?? metadata.planType ?? metadata.plan_type ?? null,
    credits: {
      ...credits,
      balance: result?.creditBalance ?? result?.credit_balance ?? credits.balance,
      hasCredits: result?.hasCredits ?? result?.has_credits ?? credits.hasCredits ?? credits.has_credits,
      unlimited: result?.unlimited ?? credits.unlimited,
      resetAt: result?.creditsResetAt ?? result?.credits_reset_at ?? credits.resetAt ?? credits.reset_at,
      spendControl: result?.spendControl ?? result?.spend_control ?? metadata.individualLimit
        ?? metadata.individual_limit ?? credits.spendControl ?? credits.spend_control,
      resetCredits: result?.rateLimitResetCredits ?? result?.rate_limit_reset_credits
        ?? credits.resetCredits ?? credits.reset_credits,
    },
    reached: result?.reached ?? result?.reachedType ?? result?.reached_type
      ?? metadata.rateLimitReachedType ?? metadata.rate_limit_reached_type
      ?? ((metadata.spendControlReached ?? metadata.spend_control_reached) === true ? 'spend_control' : null),
    source: { kind: 'app-server', official: true, observedAt: result?.observedAt ?? now, stale: false },
    now,
  });
  return Object.keys(snapshot.limits).length || snapshot.credits
    ? withStaleness(snapshot, { now, freshnessMs })
    : unavailableSnapshot('codex', 'unsupported', { kind: 'app-server', official: true, now });
}

export function resolveCodexExecutable(command, {
  platform = process.platform, env = process.env, cwd = process.cwd(),
  isFile = (file) => fs.statSync(file).isFile(),
} = {}) {
  if (platform !== 'win32' || path.win32.basename(command) !== command) return command;
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path');
  const pathValue = pathKey ? env[pathKey] : '';
  const extensionKey = Object.keys(env).find((key) => key.toLowerCase() === 'pathext');
  const extensions = path.win32.extname(command)
    ? ['']
    : String(extensionKey ? env[extensionKey] : '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  const current = path.win32.resolve(cwd).toLowerCase();
  for (const rawDirectory of String(pathValue).split(';')) {
    const directory = rawDirectory.replace(/^"|"$/g, '').trim();
    if (!directory || path.win32.resolve(directory).toLowerCase() === current) continue;
    for (const extension of extensions) {
      const candidate = path.win32.resolve(directory, `${command}${extension}`);
      try { if (isFile(candidate)) return candidate; } catch { /* inaccessible PATH entry */ }
    }
  }
  throw Object.assign(new Error('codex app-server is unavailable'), { code: 'ENOENT' });
}

export function requestCodexRateLimits({
  spawn = nodeSpawn, command = 'codex', timeoutMs = 5000,
  resolveCommand = resolveCodexExecutable,
} = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      const executable = resolveCommand(command);
      child = spawn(executable, ['app-server'], {
        stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
        shell: process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(executable),
        env: process.platform === 'win32' ? { ...process.env, NoDefaultCurrentDirectoryInExePath: '1' } : undefined,
      });
    }
    catch (error) {
      reject(Object.assign(new Error('codex app-server is unavailable'), { code: error.code || 'spawn-error' }));
      return;
    }
    let settled = false;
    let buffer = '';
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill(); } catch { /* already gone */ }
      if (error) reject(error); else resolve(value);
    };
    const send = (message) => {
      try { child.stdin.write(`${JSON.stringify(message)}\n`); } catch (error) { finish(error); }
    };
    const timer = setTimeout(() => {
      finish(Object.assign(new Error('codex app-server timed out'), { code: 'timeout' }));
    }, timeoutMs);
    child.once?.('error', (error) => {
      finish(Object.assign(new Error('codex app-server is unavailable'), { code: error.code || 'spawn-error' }));
    });
    child.once?.('exit', (code) => {
      if (!settled) finish(Object.assign(new Error(`codex app-server exited (${code ?? 'unknown'})`), { code: 'app-server-exit' }));
    });
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      for (;;) {
        const newline = buffer.indexOf('\n');
        if (newline < 0) break;
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.id === 1) {
          if (message.error) return finish(Object.assign(new Error('codex initialization failed'), { code: 'auth-or-unsupported' }));
          send({ method: 'initialized', params: {} });
          send({ id: 2, method: 'account/rateLimits/read', params: {} });
        } else if (message.id === 2) {
          if (message.error) finish(Object.assign(new Error('codex rate limits unavailable'), { code: 'auth-or-unsupported' }));
          else finish(null, message.result ?? {});
        }
      }
    });
    send({
      id: 1,
      method: 'initialize',
      params: { clientInfo: { name: 'claude-usage', title: 'claude-usage', version: '1.1.0' }, capabilities: {} },
    });
  });
}

export async function collectCodexAppServer(options = {}) {
  const now = options.now ?? Date.now();
  try {
    return normalizeCodexRateLimits(await requestCodexRateLimits(options), { now, freshnessMs: options.freshnessMs });
  } catch (error) {
    return unavailableSnapshot('codex', error?.code || 'app-server-error', {
      kind: 'app-server', official: true, now,
    });
  }
}
