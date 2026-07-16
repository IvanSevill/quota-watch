import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { normalizeCodexRateLimits } from './codex-app-server.mjs';
import { unavailableSnapshot } from './schema.mjs';

export const codexSessionsDir = (home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')) => path.join(home, 'sessions');

export function rateLimitsFromRolloutEvent(event) {
  if (!event || event.type !== 'event_msg') return null;
  const payload = event.payload;
  if (!payload || payload.type !== 'token_count') return null;
  const rateLimits = payload.rate_limits ?? payload.rateLimits;
  if (!rateLimits || typeof rateLimits !== 'object') return null;
  return { rateLimits, observedAt: event.timestamp ?? payload.timestamp ?? null };
}

async function newestFiles(root, { maxFiles, maxEntries, maxDepth }) {
  const found = [];
  let visited = 0;
  async function walk(dir, depth) {
    if (depth > maxDepth || visited >= maxEntries) return;
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (++visited > maxEntries) break;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file, depth + 1);
      else if (entry.isFile() && /^rollout-.*\.jsonl$/.test(entry.name)) {
        try { found.push({ file, mtime: (await fs.promises.stat(file)).mtimeMs }); } catch { /* vanished */ }
      }
    }
  }
  await walk(root, 0);
  return found.sort((a, b) => b.mtime - a.mtime).slice(0, maxFiles);
}

async function parseFile(file, maxBytes) {
  let handle;
  try {
    handle = await fs.promises.open(file, 'r');
    const stat = await handle.stat();
    const size = Math.min(stat.size, maxBytes);
    const buffer = Buffer.alloc(size);
    await handle.read(buffer, 0, size, stat.size - size);
    let text = buffer.toString('utf8');
    if (stat.size > size) text = text.slice(Math.max(0, text.indexOf('\n') + 1));
    let latest = null;
    for (const line of text.split('\n')) {
      try { latest = rateLimitsFromRolloutEvent(JSON.parse(line)) ?? latest; } catch { /* unrelated/incomplete */ }
    }
    return latest;
  } catch { return null; }
  finally { await handle?.close().catch(() => {}); }
}

export async function collectCodexRollout({
  sessionsDir = codexSessionsDir(), maxFiles = 20, maxEntries = 5000, maxDepth = 8,
  maxBytesPerFile = 2 * 1024 * 1024, now = Date.now(), freshnessMs,
} = {}) {
  for (const candidate of await newestFiles(sessionsDir, { maxFiles, maxEntries, maxDepth })) {
    const result = await parseFile(candidate.file, maxBytesPerFile);
    if (!result) continue;
    const snapshot = normalizeCodexRateLimits(result, { now, freshnessMs });
    return { ...snapshot, source: { ...snapshot.source, kind: 'rollout', official: false } };
  }
  return unavailableSnapshot('codex', 'unavailable', { kind: 'rollout', official: false, now });
}
