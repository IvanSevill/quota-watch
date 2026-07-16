import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { withStaleness } from './schema.mjs';

export const quotaCacheFile = (home = process.env.CLAUDE_USAGE_HOME || path.join(os.homedir(), '.claude')) => (
  process.env.CLAUDE_USAGE_CACHE_FILE || path.join(home, 'quota-cache.json')
);

export async function readQuotaCache(provider, { file = quotaCacheFile(), now = Date.now(), freshnessMs = 15 * 60_000 } = {}) {
  try {
    const values = JSON.parse(await fs.promises.readFile(file, 'utf8'));
    const snapshot = values?.[provider];
    if (!snapshot || snapshot.provider !== provider) return null;
    return withStaleness({
      ...snapshot,
      source: {
        ...snapshot.source,
        kind: `cache:${snapshot.source?.kind ?? 'unknown'}`,
        official: snapshot.source?.official ?? null,
      },
    }, { now, freshnessMs });
  } catch { return null; }
}

export async function writeQuotaCache(snapshot, { file = quotaCacheFile() } = {}) {
  if (!snapshot || snapshot.status !== 'available' || !Object.keys(snapshot.limits || {}).length) return false;
  let values = {};
  try { values = JSON.parse(await fs.promises.readFile(file, 'utf8')); } catch { /* first write */ }
  values[snapshot.provider] = snapshot;
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(temporary, `${JSON.stringify(values, null, 2)}\n`, { flag: 'wx' });
  try { await fs.promises.rename(temporary, file); }
  catch (error) {
    if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
    await fs.promises.rm(file, { force: true });
    await fs.promises.rename(temporary, file);
  }
  return true;
}
