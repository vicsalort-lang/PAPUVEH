/* Almacén mínimo para contadores de intentos y registro de accesos.
 * Usa Redis por REST (por ejemplo Upstash, desde el Marketplace de Vercel) si hay variables configuradas;
 * si no, usa memoria (solo para pruebas: se pierde al reiniciar la función y no se comparte entre instancias).
 */
const URL_REDIS = () => process.env.ACCESO_REDIS_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
const TOKEN_REDIS = () => process.env.ACCESO_REDIS_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
const CLAVE_LOG = 'uveh:accesos';
const MAX_LOG = 5000;

const memoria = { contadores: new Map(), log: [] };
const modo = () => (URL_REDIS() && TOKEN_REDIS() ? 'redis' : 'memoria');

async function cmd(args) {
  const r = await fetch(URL_REDIS(), {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN_REDIS(), 'Content-Type': 'application/json' },
    body: JSON.stringify(args)
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error('Almacén: ' + (d.error || r.status));
  return d.result;
}

// Suma 1 al contador (con caducidad en segundos) y devuelve el valor nuevo
async function sumar(clave, segundos) {
  if (modo() === 'redis') {
    const n = await cmd(['INCR', clave]);
    if (Number(n) === 1) await cmd(['EXPIRE', clave, String(segundos)]);
    return Number(n);
  }
  const ahora = Date.now();
  let e = memoria.contadores.get(clave);
  if (!e || e.hasta < ahora) e = { n: 0, hasta: ahora + segundos * 1000 };
  e.n += 1;
  memoria.contadores.set(clave, e);
  if (memoria.contadores.size > 10000) memoria.contadores.clear();
  return e.n;
}

async function leer(clave) {
  if (modo() === 'redis') return Number((await cmd(['GET', clave])) || 0);
  const e = memoria.contadores.get(clave);
  return e && e.hasta >= Date.now() ? e.n : 0;
}

async function registrar(entrada) {
  const linea = JSON.stringify(entrada);
  console.log('[acceso]', linea);                      // copia en los registros de Vercel (duran poco)
  if (modo() === 'redis') {
    await cmd(['LPUSH', CLAVE_LOG, linea]);
    await cmd(['LTRIM', CLAVE_LOG, '0', String(MAX_LOG - 1)]);
    return;
  }
  memoria.log.unshift(linea);
  if (memoria.log.length > MAX_LOG) memoria.log.length = MAX_LOG;
}

async function listar(n) {
  const k = Math.max(1, Math.min(Number(n) || 500, MAX_LOG));
  const filas = modo() === 'redis' ? await cmd(['LRANGE', CLAVE_LOG, '0', String(k - 1)]) : memoria.log.slice(0, k);
  return (filas || []).map(f => { try { return JSON.parse(f); } catch { return null; } }).filter(Boolean);
}

export { sumar, leer, registrar, listar, modo };
