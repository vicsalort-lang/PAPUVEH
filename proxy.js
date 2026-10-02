/* Candado del sitio UVEH UPAEP (Routing Middleware de Vercel).
 * Vercel exige que este archivo termine en .js o .ts; por eso el proyecto declara "type": "module" en package.json.
 * Corre en el servidor ANTES de entregar cualquier archivo o función: sin sesión válida no sale nada
 * (ni index.html, ni los módulos, ni kb.json).
 *
 * - Interruptor: solo actúa si la variable ACCESO_ACTIVO vale "1". Sin ella, el sitio funciona abierto.
 * - Si devuelve undefined, la petición continúa con normalidad.
 * - Si cambia la forma de firmar la sesión, debe cambiar igual en lib/sesion.js.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const NOMBRE_COOKIE = 'uveh_sesion';
// Lo único accesible sin sesión: la pantalla de ingreso y su API.
const PUBLICAS = new Set(['/acceso.html', '/api/acceso', '/favicon.ico']);

function leerCookie(cabecera, nombre) {
  if (!cabecera) return null;
  for (const parte of cabecera.split(';')) {
    const i = parte.indexOf('=');
    if (i > 0 && parte.slice(0, i).trim() === nombre) return parte.slice(i + 1).trim();
  }
  return null;
}

function sesionValida(token, secreto) {
  if (!token || !secreto) return false;
  const i = token.indexOf('.');
  if (i < 1) return false;
  const cuerpo = token.slice(0, i), firma = token.slice(i + 1);
  const esperada = createHmac('sha256', secreto).update(cuerpo).digest('base64url');
  const A = Buffer.from(firma), B = Buffer.from(esperada);
  if (A.length !== B.length || !timingSafeEqual(A, B)) return false;
  try {
    const p = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'));
    return !!p && typeof p.e === 'number' && p.e * 1000 > Date.now();
  } catch {
    return false;
  }
}

export default function proxy(request) {
  if (process.env.ACCESO_ACTIVO !== '1') return;             // candado apagado: sitio abierto

  const url = new URL(request.url);
  if (PUBLICAS.has(url.pathname)) return;

  const token = leerCookie(request.headers.get('cookie'), NOMBRE_COOKIE);
  if (sesionValida(token, process.env.ACCESO_SECRETO)) return;

  const esPagina = (request.method === 'GET' || request.method === 'HEAD') &&
    (request.headers.get('sec-fetch-dest') === 'document' || (request.headers.get('accept') || '').includes('text/html'));
  if (esPagina) {
    // El navegador conserva la parte "#/modulo/subpagina" de la dirección original al seguir esta redirección.
    return new Response(null, {
      status: 302,
      headers: { Location: '/acceso.html?volver=' + encodeURIComponent(url.pathname), 'Cache-Control': 'no-store' }
    });
  }
  return new Response(JSON.stringify({ error: 'Sesión requerida. Inicie sesión de nuevo.', sesion: false }), {
    status: 401,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}
