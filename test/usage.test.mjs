// claude-usage: el statusline vuelca los rate_limits a un archivo y esta CLI los lee.
// Se prueba por proceso (spawn) porque es como se usa de verdad: en una tubería.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'usage.mjs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cu-'));
const FILE = path.join(TMP, 'usage.json');

const run = (args = [], input = '') => {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    input, encoding: 'utf8', env: { ...process.env, CLAUDE_USAGE_FILE: FILE },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

/** Payload como el que Claude Code pasa al statusline. */
const payload = (fiveUsed, weekUsed, { fiveIn = 7200, weekIn = 200000 } = {}) => JSON.stringify({
  model: { display_name: 'Opus' },
  rate_limits: {
    five_hour: { used_percentage: fiveUsed, resets_at: Math.floor(Date.now() / 1000) + fiveIn },
    seven_day: { used_percentage: weekUsed, resets_at: Math.floor(Date.now() / 1000) + weekIn },
  },
});

const reset = () => fs.rmSync(FILE, { force: true });

test('dump: guarda los límites y DEJA PASAR stdin (para encadenar en el statusline)', () => {
  reset();
  const raw = payload(42, 50);
  const r = run(['dump'], raw);

  assert.equal(r.code, 0);
  assert.equal(r.out, raw, 'debe reemitir la entrada tal cual o rompería la tubería');
  const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  assert.equal(saved.rate_limits.five_hour.used_percentage, 42);
  assert.ok(saved.updatedAt, 'guarda cuándo se tomó el dato');
});

test('dump: un payload SIN rate_limits no rompe ni borra lo anterior', () => {
  reset();
  run(['dump'], payload(10, 20));
  const antes = fs.readFileSync(FILE, 'utf8');

  const r = run(['dump'], JSON.stringify({ model: { display_name: 'Opus' } }));

  assert.equal(r.code, 0);
  assert.equal(fs.readFileSync(FILE, 'utf8'), antes, 'conserva el último dato bueno');
});

test('dump: stdin basura no rompe (el statusline nunca debe caerse)', () => {
  const r = run(['dump'], 'no soy json');
  assert.equal(r.code, 0);
});

test('--json: forma legible por un agente, con lo que queda', () => {
  reset();
  run(['dump'], payload(42, 50));

  const { code, out } = run(['--json']);
  const j = JSON.parse(out);

  assert.equal(code, 0);
  assert.equal(j.ok, true);
  assert.equal(j.session.used, 42);
  assert.equal(j.session.left, 58, 'lo que queda = 100 - usado');
  assert.equal(j.week.left, 50);
  assert.equal(j.stale, false);
  assert.ok(j.session.resetsIn > 0);
});

test('--json sin datos aún: ok=false, sin reventar', () => {
  reset();
  const j = JSON.parse(run(['--json']).out);
  assert.equal(j.ok, false);
  assert.equal(j.session, null);
});

test('detecta el dato caducado (el statusline lleva sin refrescar)', () => {
  reset();
  fs.writeFileSync(FILE, JSON.stringify({
    updatedAt: Math.floor(Date.now() / 1000) - 3600,      // hace una hora
    rate_limits: { five_hour: { used_percentage: 10, resets_at: 0 } },
  }));
  const j = JSON.parse(run(['--json']).out);
  assert.equal(j.stale, true, 'un dato viejo debe avisarse, no darse por bueno');
  assert.ok(j.ageSeconds >= 3600);
});

test('informe humano: muestra barra, % restante y el reset', () => {
  reset();
  run(['dump'], payload(42, 50));
  const { out } = run([]);
  assert.match(out, /session/);
  assert.match(out, /58% left/);
  assert.match(out, /resets in/);
  assert.match(out, /█/);
});

test('--quiet + --min: código de salida usable como guarda en scripts', () => {
  reset();
  run(['dump'], payload(95, 20));            // solo 5% de sesión → por debajo del umbral

  assert.equal(run(['--quiet', '--min', '10']).code, 1, 'poco cupo → exit 1');
  assert.equal(run(['--quiet', '--min', '10']).out, '', '--quiet no imprime nada');
  assert.equal(run(['--quiet', '--min', '1']).code, 0, 'umbral bajo → exit 0');
});

test('--quiet mira la ventana MÁS restrictiva (sesión o semana)', () => {
  reset();
  run(['dump'], payload(10, 97));            // sesión sobrada, pero la semana casi agotada
  assert.equal(run(['--quiet', '--min', '10']).code, 1, 'debe fijarse en la peor de las dos');
});

test('statusline: se puede usar como statusline y pinta el resumen', () => {
  reset();
  const { code, out } = run(['statusline'], payload(42, 50));
  assert.equal(code, 0);
  assert.match(out, /session/);
  assert.match(out, /week/);
  assert.match(out, /58%/);
  assert.ok(fs.existsSync(FILE), 'y de paso guarda el dato');
});
