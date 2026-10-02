/* Sesión y verificación de personal autorizado (UVEH UPAEP).
 *
 * - Sesión: cookie firmada con HMAC-SHA256 (sin base de datos). Caduca sola.
 * - Lista autorizada: NO guarda cédulas ni nombres legibles; guarda huellas (HMAC con un secreto "pepper" que solo está en Vercel)
 *   y una huella lenta (PBKDF2) del código personal. Aunque alguien lea el archivo, no obtiene nombres ni cédulas.
 * - Las mismas huellas las calcula la herramienta herramientas/generar-acceso.html (debe mantenerse idéntica).
 */
import crypto from 'node:crypto';
import { promisify } from 'node:util';
const pbkdf2 = promisify(crypto.pbkdf2);

export const NOMBRE_COOKIE = 'uveh_sesion';
export const ITER_CODIGO = 200000;

// ---------- Sesión firmada ----------
const b64u = x => Buffer.from(x).toString('base64url');

export function iguales(a, b) {
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}

export function firmar(payload, secreto) {
  const cuerpo = b64u(JSON.stringify(payload));
  const firma = crypto.createHmac('sha256', secreto).update(cuerpo).digest('base64url');
  return cuerpo + '.' + firma;
}

export function verificar(token, secreto, ahora) {
  if (!token || !secreto || typeof token !== 'string') return null;
  const i = token.indexOf('.');
  if (i < 1) return null;
  const cuerpo = token.slice(0, i), firma = token.slice(i + 1);
  const esperada = crypto.createHmac('sha256', secreto).update(cuerpo).digest('base64url');
  if (!iguales(firma, esperada)) return null;
  let p;
  try { p = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8')); } catch { return null; }
  if (!p || typeof p.e !== 'number' || p.e * 1000 < (ahora || Date.now())) return null;
  return p;
}

export function leerCookie(cabecera, nombre) {
  if (!cabecera) return null;
  for (const parte of String(cabecera).split(';')) {
    const i = parte.indexOf('=');
    if (i > 0 && parte.slice(0, i).trim() === nombre) return parte.slice(i + 1).trim();
  }
  return null;
}

export const cookieSesion = (token, segundos) =>
  `${NOMBRE_COOKIE}=${token}; Path=/; Max-Age=${segundos}; HttpOnly; Secure; SameSite=Lax`;
export const cookieBorrar = () => `${NOMBRE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

// Sesión válida de una petición (objeto req de Node), o null
export function sesionDeRequest(req) {
  return verificar(leerCookie(req.headers && req.headers.cookie, NOMBRE_COOKIE), process.env.ACCESO_SECRETO);
}

// ---------- Normalización y huellas ----------
const sinAcentos = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
export const normalizarId = s => sinAcentos(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
export const normalizarNombre = s => sinAcentos(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
export const normalizarCodigo = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const hmac = (pepper, etiqueta, valor) => crypto.createHmac('sha256', pepper).update(etiqueta + ':' + valor).digest('hex');
export const hashId = (pepper, cedula) => hmac(pepper, 'id', normalizarId(cedula));
export const hashNombre = (pepper, nombre) => hmac(pepper, 'nombre', normalizarNombre(nombre));
export async function hashCodigo(pepper, idHash, codigo, saltHex) {
  const sal = Buffer.from(saltHex + ':' + pepper + ':' + idHash);
  return (await pbkdf2(Buffer.from(normalizarCodigo(codigo)), sal, ITER_CODIGO, 32, 'sha256')).toString('hex');
}

// Devuelve { id } si cédula + nombre + código coinciden con una persona de la lista; si no, null.
// El cálculo lento se hace siempre, exista o no la persona, para no revelar por tiempo quién está en la lista.
export async function buscarPersona(lista, pepper, { cedula, nombre, codigo }) {
  const id = hashId(pepper, cedula);
  const p = ((lista && lista.personas) || []).find(x => iguales(x.id, id));
  const c = await hashCodigo(pepper, id, codigo, p ? p.s : '00'.repeat(16));
  const nombreOk = p ? iguales(p.n, hashNombre(pepper, nombre)) : false;
  const codigoOk = p ? iguales(p.c, c) : false;
  return p && nombreOk && codigoOk ? { id } : null;
}
