/* Registro de accesos (solo UVEH): GET /api/registro?n=500&formato=csv
 * Requiere sesión válida Y el encabezado x-admin-token igual a la variable ACCESO_ADMIN_TOKEN. */
const S = require('../lib/sesion');
const A = require('../lib/almacen');

const csv = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';

async function manejar(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });

  if (process.env.ACCESO_ACTIVO === '1' && !S.sesionDeRequest(req)) {
    return res.status(401).json({ error: 'Sesión requerida.', sesion: false });
  }
  const esperado = process.env.ACCESO_ADMIN_TOKEN;
  if (!esperado) return res.status(403).json({ error: 'El token de administración no está configurado.' });
  const dado = String((req.headers && req.headers['x-admin-token']) || '');
  if (!S.iguales(dado, esperado)) return res.status(403).json({ error: 'Token de administración incorrecto.' });

  const entradas = await A.listar(req.query && req.query.n);
  if (req.query && req.query.formato === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="registro_accesos_uveh.csv"');
    return res.status(200).send('\ufefffecha_hora_utc,cedula,nombre\n' + entradas.map(e => [e.t, e.cedula, e.nombre].map(csv).join(',')).join('\n'));
  }
  return res.status(200).json({ almacen: A.modo(), total: entradas.length, entradas });
}

module.exports = async (req, res) => {
  try {
    return await manejar(req, res);
  } catch (e) {
    console.error('[registro] error no controlado:', (e && e.stack) || e);
    if (!res.headersSent) return res.status(500).json({ error: 'Error interno.' });
  }
};
