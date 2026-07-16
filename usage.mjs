#!/usr/bin/env node
// claude-usage — let an AI agent (or you) see how much Claude Code quota is left.
//
// Why this exists
// ---------------
// Claude Code exposes your rate limits (`rate_limits`) in exactly ONE place: the
// JSON it pipes to the **status line** command. An agent running inside Claude Code
// cannot read that. So this tool tees it to a file the agent *can* read.
//
//   dump         read the status-line JSON on stdin, save it, and pass stdin through
//                (so it chains: `usage.mjs dump | your-statusline.sh`)
//   statusline   same, plus render a compact usage bar (use it AS your status line)
//   (no args)    human-readable report of what's left
//   --json       machine-readable, for agents/scripts
//   --schema     provider-neutral canonical snapshot (Claude or Codex)
//   --provider   claude (default) or codex
//   --source     Codex source: auto, app-server, or rollout
//   --quiet      only the exit code (0 = above threshold, 1 = below)
//   --min <n>    threshold in % remaining for --quiet (default 10)
//
// Zero dependencies. Data file: ~/.claude/usage.json

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runQuotaCLI } from './quota/cli.mjs';

// Overridable so tests (and unusual setups) don't touch the real file.
const FILE = process.env.CLAUDE_USAGE_FILE || path.join(os.homedir(), '.claude', 'usage.json');

const readStdin = () => { try { return fs.readFileSync(0, 'utf8'); } catch { return ''; } };
const pct = (n) => Math.max(0, Math.min(100, Math.round(n)));

/** Persist the rate limits found in a status-line payload. Returns what it saved. */
function save(raw) {
  let payload;
  try { payload = JSON.parse(raw || '{}'); } catch { return null; }
  const rl = payload.rate_limits;
  if (!rl) return null;                       // absent until the first API reply of a session
  const data = { updatedAt: Math.floor(Date.now() / 1000), rate_limits: rl };
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(data) + '\n');
  } catch { /* never break the status line over this */ }
  return data;
}

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return null; }
}

/** Normalise a window into { used, left, resetsAt, resetsIn } — or null. */
function windowOf(data, key) {
  const w = data?.rate_limits?.[key];
  if (!w || typeof w.used_percentage !== 'number') return null;
  const resetsAt = w.resets_at ? w.resets_at * 1000 : null;
  return {
    used: pct(w.used_percentage),
    left: pct(100 - w.used_percentage),
    resetsAt,
    resetsIn: resetsAt ? Math.max(0, resetsAt - Date.now()) : null,
  };
}

const dur = (ms) => {
  if (ms == null) return '—';
  const s = Math.floor(ms / 1000);
  if (s >= 86400) return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 60)}m`;
};

const bar = (left, len = 20) => {
  const fill = Math.round((left / 100) * len);
  return '█'.repeat(fill) + '░'.repeat(len - fill);
};

function report({ json, quiet, min }) {
  const data = load();
  const five = windowOf(data, 'five_hour');
  const week = windowOf(data, 'seven_day');
  // Stale data means the status line hasn't rendered lately (e.g. the machine slept).
  const age = data ? Math.floor(Date.now() / 1000) - data.updatedAt : null;

  if (json) {
    console.log(JSON.stringify({
      ok: Boolean(data), ageSeconds: age, stale: age != null && age > 900,
      session: five, week,
    }, null, 2));
  } else if (!quiet) {
    if (!data) {
      console.log('No usage data yet.\n'
        + 'Wire the dump into your status line (see README) and send one message.');
    } else {
      const line = (name, w) => w
        ? `  ${name.padEnd(10)} ${bar(w.left)}  ${String(w.left).padStart(3)}% left   `
          + `resets in ${dur(w.resetsIn)}`
        : `  ${name.padEnd(10)} (no data)`;
      console.log('Claude Code quota');
      console.log(line('session', five));
      console.log(line('week', week));
      if (age > 900) console.log(`\n  ⚠ data is ${dur(age * 1000)} old (status line hasn't refreshed)`);
    }
  }

  const worst = Math.min(five?.left ?? 100, week?.left ?? 100);
  return worst >= min ? 0 : 1;         // exit code: usable as a guard in scripts
}

// --- dispatch ----------------------------------------------------------------
const argv = process.argv.slice(2);
const cmd = argv.find((a) => !a.startsWith('--'));
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i !== -1 ? argv[i + 1] : d; };

if (cmd === 'dump' || cmd === 'statusline') {
  const raw = readStdin();
  const data = save(raw);
  if (cmd === 'dump') {
    process.stdout.write(raw);                 // pass through so it can be chained
  } else {
    const five = windowOf(data, 'five_hour');
    const week = windowOf(data, 'seven_day');
    const seg = (n, w) => (w ? `${n} ${bar(w.left, 10)} ${w.left}%` : `${n} —`);
    console.log([seg('session', five), seg('week', week)].join('  |  '));
  }
  process.exit(0);
}

// The historical Claude interface remains the default. Canonical schema output is explicit,
// while Codex always uses it because the old session/week object is Claude-specific.
const provider = val('--provider', 'claude');
if (has('--schema') || provider !== 'claude' || has('--source')) {
  process.exit(await runQuotaCLI(argv));
}

process.exit(report({
  json: has('--json'),
  quiet: has('--quiet'),
  min: Number(val('--min', 10)),
}));
