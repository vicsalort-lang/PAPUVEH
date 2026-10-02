/* Núcleo común del Consultor experto de cada módulo (UVEH UPAEP).
 *
 * Cada módulo tiene su propio archivo en /api (por ejemplo api/profilaxis.js) que llama a crearManejador()
 * con SU base de conocimiento, SUS instrucciones y SU esquema de respuesta. Así la IA de un módulo nunca
 * ve la bibliografía de otro y un fallo en uno no afecta a los demás.
 *
 * Este archivo está fuera de /api a propósito: todo archivo dentro de /api se convierte en una función de Vercel.
 */
const crypto = require('crypto');

// Modelos, en orden de preferencia. GEMINI_MODEL = principal; GEMINI_MODEL_FALLBACK = uno o varios de respaldo separados por coma.
// Si un modelo no existe (404), se omite y se sigue con el siguiente.
const MODELO = (process.env.GEMINI_MODEL || 'gemini-flash-latest').trim();
const RESPALDOS = (process.env.GEMINI_MODEL_FALLBACK || 'gemini-3.6-flash,gemini-3.5-flash-lite')
  .split(',').map(m => m.trim()).filter(Boolean);
const MODELOS = [MODELO].concat(RESPALDOS).filter((m, i, a) => a.indexOf(m) === i);

const TRANSITORIOS = [429, 500, 503, 504];

// Fragmentos que solo aparecen si el modelo copió la entrada (etiquetas o nombres internos)
const MARCADORES_COMUNES = [
  /<\/?(calculo_institucional|caso|base_de_conocimiento)[^>]*>/i,
  /c[aá]lculo_institucional/i
];

function crearManejador(cfg) {
  const nombre = cfg.modulo || 'modulo';
  const tareas = cfg.tareas || ['consulta'];
  const limites = cfg.limites || {};
  const marcadores = MARCADORES_COMUNES.concat(cfg.marcadores || []);
  const porMinuto = cfg.porMinuto || 8;
  const maxCaso = cfg.maxCaso || 1500;
  const maxCalculo = cfg.maxCalculo || 1500;

  // Caché de respuestas idénticas (mejor esfuerzo; se pierde si la función se reinicia): evita llamadas repetidas a Gemini
  const CACHE_MS = 10 * 60 * 1000;
  const cache = new Map();
  const claveCache = (tarea, caso, calculo, version) =>
    crypto.createHash('sha256').update([nombre, tarea, caso, calculo, version].join('\u0001')).digest('hex');
  function cacheGet(k) {
    const e = cache.get(k);
    if (!e) return null;
    if (Date.now() - e.t > CACHE_MS) { cache.delete(k); return null; }
    return e.v;
  }
  function cacheSet(k, v) {
    if (cache.size > 200) cache.clear();
    cache.set(k, { t: Date.now(), v });
  }

  // Límite simple por IP (mejor esfuerzo; se reinicia si la función se reinicia)
  const hits = new Map();
  function limitado(ip) {
    const ahora = Date.now();
    const lista = (hits.get(ip) || []).filter(t => ahora - t < 60000);
    lista.push(ahora);
    hits.set(ip, lista);
    if (hits.size > 5000) hits.clear();
    return lista.length > porMinuto;
  }

  // Devuelve la salida sin texto copiado de la entrada. invalida=true si no es salvable.
  function depurarSalida(salida) {
    let contaminada = false, invalida = false;
    const limpia = { ...salida };
    for (const campo of Object.keys(limites)) {
      let t = limpia[campo];
      if (typeof t !== 'string') continue;
      let corte = t.length;
      for (const m of marcadores) {
        const i = t.search(m);
        if (i >= 0 && i < corte) corte = i;
      }
      if (corte < t.length) {
        contaminada = true;
        t = t.slice(0, corte).trim();
        if (t.length < 10) { invalida = true; t = ''; }
      }
      if (t.length > limites[campo]) { contaminada = true; invalida = true; }
      limpia[campo] = t;
    }
    return { limpia, contaminada, invalida };
  }

  const cargarBase = () => (typeof cfg.kb === 'function' ? cfg.kb() : cfg.kb);
  const esVago = cfg.esVago || (() => false);

  async function manejar(req, res) {
    // Prueba de salud: abrir /api/<modulo> en el navegador. No expone la clave ni datos clínicos.
    if (req.method === 'GET') {
      let kb = null, errorKb = null;
      try { kb = cargarBase(); } catch (e) { errorKb = String(e && e.message).slice(0, 120); }
      return res.status(200).json(Object.assign({
        ok: !!kb && !!(process.env.GEMINI_API_KEY || '').trim(),
        modulo: nombre,
        base_cargada: !!kb,
        error_base: errorKb,
        version_base: kb ? kb.version : null,
        clave_configurada: !!(process.env.GEMINI_API_KEY || '').trim(),
        modelos: MODELOS
      }, kb && cfg.resumenSalud ? cfg.resumenSalud(kb) : {}));
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

    // Solo acepta llamadas desde el mismo sitio
    try {
      if (new URL(req.headers.origin || '').host !== req.headers.host) throw new Error();
    } catch {
      return res.status(403).json({ error: 'Origen no permitido' });
    }

    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x';
    if (limitado(ip)) return res.status(429).json({ error: 'Demasiadas solicitudes. Espere un minuto.' });

    const body = req.body || {};
    const tarea = body.tarea;
    const caso = String(body.caso || '').slice(0, maxCaso);
    const calculo = String(body.calculo || '').slice(0, maxCalculo);
    if (!tareas.includes(tarea) || caso.length < 10) {
      return res.status(400).json({ error: 'Solicitud inválida' });
    }

    let KB;
    try { KB = cargarBase(); } catch { return res.status(500).json({ error: 'Base de conocimiento no disponible' }); }

    const payload = {
      systemInstruction: { parts: [{ text: cfg.sistema(KB) }] },
      contents: [{ role: 'user', parts: [{ text: JSON.stringify({ instruccion: cfg.instruccion(tarea), calculo_institucional: calculo, caso }) }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json',
        responseSchema: cfg.schema
      }
    };

    const kCache = claveCache(tarea, caso, calculo, KB.version);
    const enCache = cacheGet(kCache);
    if (enCache) return res.status(200).json(enCache);

    const inicio = Date.now();
    const espera = ms => new Promise(ok => setTimeout(ok, ms));
    let disponibles = MODELOS.slice();
    let r = null;
    let ultimoTransitorio = false;
    let salida = null;         // respuesta válida
    let respaldoLimpio = null; // respuesta salvable tras quitar texto copiado
    let respaldoVago = null;   // respuesta correcta pero sin cifras (último recurso)

    try {
      // Hasta 5 intentos alternando modelos: ante un 503 o una respuesta defectuosa se prueba otro modelo
      for (let intento = 0; intento < 5 && disponibles.length; intento++) {
        if (Date.now() - inicio > 35000) break; // no iniciar otro intento: la función termina a los 60 s (vercel.json)
        const modelo = disponibles[intento % disponibles.length];
        r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': (process.env.GEMINI_API_KEY || '').trim() },
            body: JSON.stringify(payload)
          }
        );
        if (r.ok) {
          let candidata = null;
          try {
            const data = await r.json();
            const parts = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
            const texto = parts && parts[0] && parts[0].text;
            if (texto) candidata = JSON.parse(texto);
            else console.error(`[${nombre}] Gemini sin contenido`, modelo, JSON.stringify(data.promptFeedback || data.candidates || {}).slice(0, 200));
          } catch (e) {
            console.error(`[${nombre}] Gemini JSON no válido`, modelo, e && e.message);
          }
          if (candidata && typeof candidata === 'object') {
            const d = depurarSalida(candidata);
            const vago = esVago(d.limpia, calculo);
            if (!d.contaminada && !vago) { salida = candidata; break; }
            if (d.contaminada) {
              console.error(`[${nombre}] Gemini devolvió texto copiado de la entrada`, modelo, 'intento', intento + 1);
              if (!d.invalida && !respaldoLimpio) respaldoLimpio = d.limpia;
            }
            if (vago) {
              console.error(`[${nombre}] Gemini respondió sin cifras concretas`, modelo, 'intento', intento + 1);
              if (!d.invalida && !respaldoVago) respaldoVago = d.limpia;
            }
          }
          ultimoTransitorio = true; // respuesta defectuosa: probar de nuevo
          continue;
        }
        if (r.status === 404 && disponibles.length > 1) { // modelo inexistente o retirado: omitirlo
          console.error(`[${nombre}] Gemini 404, modelo omitido:`, modelo);
          disponibles = disponibles.filter(m => m !== modelo);
          intento--; // este intento no cuenta
          continue;
        }
        ultimoTransitorio = TRANSITORIOS.includes(r.status);
        if (!ultimoTransitorio) break; // 400/401/403: reintentar no sirve
        console.error(`[${nombre}] Gemini transitorio`, r.status, modelo, 'intento', intento + 1);
        // Tras probar todos los modelos una vez, esperar con espera creciente y algo de azar
        if ((intento + 1) % disponibles.length === 0) await espera(1000 * Math.ceil((intento + 1) / disponibles.length) + Math.random() * 500);
      }

      let desdeRespaldo = false, sinCifras = false;
      if (!salida && (respaldoLimpio || respaldoVago)) { // mejor una respuesta depurada que ninguna
        salida = respaldoLimpio || respaldoVago;
        desdeRespaldo = true;
        sinCifras = esVago(salida, calculo);
      }

      if (!salida) {
        const estado = r ? r.status : 0;
        const txt = r && !r.ok ? await r.text() : '';
        let msg = txt.slice(0, 300);
        try { msg = JSON.parse(txt).error.message; } catch {}
        console.error(`[${nombre}] Gemini`, estado, msg); // el detalle queda solo en los logs de Vercel
        if (r && r.ok) {
          return res.status(502).json({ error: 'La respuesta de la IA no fue válida. Intente de nuevo en unos segundos.' });
        }
        if (ultimoTransitorio || estado === 0) {
          return res.status(503).json({
            saturado: true,
            reintentar_en: 30,
            error: 'El servicio de IA está recibiendo muchas solicitudes en este momento. Espere unos segundos para que se refresque e intente de nuevo. (código ' + estado + ')'
          });
        }
        return res.status(502).json({ error: 'El servicio de IA no está disponible por el momento. (código ' + estado + ')' });
      }

      let respuesta;
      if (!salida.en_alcance) {
        respuesta = { en_alcance: false, mensaje: cfg.mensajeFuera };
      } else if (salida.fuera_de_base) {
        // Si el dato no está en la base, no se deja pasar ningún texto generado por la IA
        respuesta = { en_alcance: true, fuera_de_base: true, mensaje: cfg.mensajeFueraBase, kb_version: KB.version };
      } else {
        salida.kb_version = KB.version;
        if (sinCifras) salida.aviso_sin_cifras = true; // la página avisa que se usen las cifras del calculador
        respuesta = salida;
      }
      // Solo se guarda en caché lo que salió limpio a la primera
      if (!desdeRespaldo) cacheSet(kCache, respuesta);
      return res.status(200).json(respuesta);
    } catch (e) {
      console.error(`[${nombre}]`, e && e.message);
      return res.status(502).json({ error: 'Respuesta no válida del servicio de IA. Intente de nuevo.' });
    }
  }

  // Pase lo que pase, la respuesta siempre es JSON con un mensaje legible (y el detalle queda en los logs)
  return async (req, res) => {
    try {
      return await manejar(req, res);
    } catch (e) {
      console.error(`[${nombre}] error no controlado:`, (e && e.stack) || e);
      if (!res.headersSent) return res.status(500).json({ error: 'Error interno del servidor. Intente de nuevo en unos segundos.' });
    }
  };
}

module.exports = { crearManejador, MODELOS };
