/* Acceso del personal hospitalario: inicio y cierre de sesión.
 *   GET  /api/acceso            -> estado de la sesión { activo, sesion, nombre }
 *   GET  /api/acceso?salud=1    -> prueba de configuración (solo indicadores, sin secretos)
 *   POST /api/acceso            -> { cedula, nombre, codigo }  inicia sesión
 *   POST /api/acceso            -> { accion: "salir" }         cierra sesión
 * El candado se activa con ACCESO_ACTIVO=1. Mientras no esté activo, el sitio funciona abierto como antes.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as S from '../lib/sesion.js';
import * as A from '../lib/almacen.js';

// Lista autorizada (solo huellas). Se lee del archivo incluido en la función (vercel.json -> includeFiles).
let LISTA = null, ERROR_LISTA = null;
try { LISTA = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'datos', 'acceso.json'), 'utf8')); } catch (e) { ERROR_LISTA = e; }

const FALLOS_IP_MAX = 20, FALLOS_IP_SEG = 15 * 60;     // por dirección IP (varias personas pueden compartir la red del hospital)
const FALLOS_ID_MAX = 8, FALLOS_ID_SEG = 15 * 60;      // por cédula: frena adivinar códigos de una persona concreta (ventana corta: quien conozca la cédula de un colega puede bloquearlo, pero solo 15 min)
const activo = () => process.env.ACCESO_ACTIVO === '1';
const horas = () => Math.max(1, Math.min(Number(process.env.ACCESO_HORAS) || 12, 72));
const pausa = ms => new Promise(r => setTimeout(r, ms));
const limpiarTexto = (s, max) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);

async function manejar(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    if (req.query && req.query.salud) {
      return res.status(200).json({
        activo: activo(),
        secreto_configurado: !!process.env.ACCESO_SECRETO,
        pepper_configurado: !!process.env.ACCESO_PEPPER,
        token_admin_configurado: !!process.env.ACCESO_ADMIN_TOKEN,
        lista_cargada: !!LISTA,
        personas: LISTA ? (LISTA.personas || []).length : 0,
        almacen: A.modo(),
        horas_sesion: horas()
      });
    }
    const ses = S.sesionDeRequest(req);
    return res.status(200).json({ activo: activo(), sesion: !!ses, nombre: ses ? ses.n : null });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  // Solo desde este mismo sitio
  try {
    if (new URL(req.headers.origin || '').host !== req.headers.host) throw new Error();
  } catch {
    return res.status(403).json({ error: 'Origen no permitido' });
  }

  const body = req.body || {};

  if (body.accion === 'salir') {
    res.setHeader('Set-Cookie', S.cookieBorrar());
    return res.status(200).json({ ok: true });
  }

  if (!activo()) return res.status(200).json({ ok: true, desactivado: true });

  if (!process.env.ACCESO_SECRETO || !process.env.ACCESO_PEPPER || !LISTA) {
    console.error('[acceso] configuración incompleta', { secreto: !!process.env.ACCESO_SECRETO, pepper: !!process.env.ACCESO_PEPPER, lista: !!LISTA, error: ERROR_LISTA && ERROR_LISTA.message });
    return res.status(500).json({ error: 'El acceso no está configurado. Avise a la UVEH.' });
  }

  if (!(LISTA.personas || []).length) {
    return res.status(500).json({ error: 'La lista de personal está vacía. Avise a la UVEH: falta cargar datos/acceso.json.' });
  }

  const cedula = limpiarTexto(body.cedula, 30);
  const nombre = limpiarTexto(body.nombre, 120);
  const codigo = limpiarTexto(body.codigo, 30);
  if (cedula.length < 3 || nombre.length < 5 || codigo.length < 6) {
    return res.status(400).json({ error: 'Complete cédula, nombre completo y código.' });
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x';
  const idHash = S.hashId(process.env.ACCESO_PEPPER, cedula);
  const claveIp = 'uveh:fallos:ip:' + ip;
  const claveId = 'uveh:fallos:id:' + idHash.slice(0, 24);
  try {
    if ((await A.leer(claveIp)) >= FALLOS_IP_MAX || (await A.leer(claveId)) >= FALLOS_ID_MAX) {
      return res.status(429).json({ error: 'Demasiados intentos. Espere unos minutos o solicite ayuda a la UVEH.' });
    }
  } catch (e) { console.error('[acceso] almacén (lectura)', e.message); }

  const persona = await S.buscarPersona(LISTA, process.env.ACCESO_PEPPER, { cedula, nombre, codigo });
  if (!persona) {
    try { await A.sumar(claveIp, FALLOS_IP_SEG); await A.sumar(claveId, FALLOS_ID_SEG); } catch (e) { console.error('[acceso] almacén (conteo)', e.message); }
    await pausa(500);
    return res.status(401).json({ error: 'No se pudo verificar. Revise la cédula, el nombre completo como aparece en su cédula y el código, o solicite su código a la UVEH.' });
  }

  const seg = horas() * 3600;
  const token = S.firmar({ i: persona.id.slice(0, 12), n: nombre, e: Math.floor(Date.now() / 1000) + seg }, process.env.ACCESO_SECRETO);
  try {
    await A.registrar({ t: new Date().toISOString(), cedula: cedula.toUpperCase(), nombre });
  } catch (e) { console.error('[acceso] almacén (registro)', e.message); }
  res.setHeader('Set-Cookie', S.cookieSesion(token, seg));
  return res.status(200).json({ ok: true, nombre });
}

export default async function handler(req, res) {
  try {
    return await manejar(req, res);
  } catch (e) {
    console.error('[acceso] error no controlado:', (e && e.stack) || e);
    if (!res.headersSent) return res.status(500).json({ error: 'Error interno. Intente de nuevo en unos segundos.' });
  }
}
