// =============================================================
// Bitácora automática por WhatsApp — función serverless (Vercel)
// Usa Twilio (WhatsApp Sandbox / número de Twilio) para recibir
// los mensajes — no Meta WhatsApp Cloud API.
// =============================================================
// Recibe los mensajes que llegan al número de WhatsApp conectado con
// Twilio y arma entradas de bitácora solas, sin que nadie tenga que
// abrir la app:
//
//   1) El equipo manda una o varias FOTOS al número → cada una se
//      guarda en un "buzón" temporal (tabla wa_bitacora_inbox), sin
//      proyecto asignado todavía. Twilio contesta confirmando que
//      recibió la(s) foto(s).
//   2) Luego mandan un mensaje de TEXTO que empieza con el nombre
//      exacto del proyecto seguido de ":", ej.:
//          "Casa Romor: se coló la losa de la planta alta"
//      → se busca ese proyecto, se juntan las fotos recientes (de
//      las últimas 3 horas) de ese mismo número que seguían sin
//      usar, y se crea UNA sola entrada en "bitacora" con la fecha
//      de hoy, la nota y esas fotos.
//   3) Se contesta en el momento (Twilio te deja responder dentro de
//      la misma conexión del webhook, con un mensaje de TwiML — no
//      hace falta llamar a otra API aparte para eso) confirmando
//      ("✅ Bitácora agregada a ..."), o pidiendo aclarar si no se
//      reconoció el proyecto, o avisando si el número no es de nadie
//      registrado en el equipo.
//
// Ver la sección 6.6 de README.md para la guía paso a paso de cómo
// crear la cuenta de Twilio, activar el WhatsApp Sandbox y conectar
// el webhook.
//
// Variables de entorno que necesita esta función (se configuran en
// Vercel → Project Settings → Environment Variables — NUNCA se
// escriben aquí en el código ni se suben a GitHub):
//
//   TWILIO_ACCOUNT_SID        Empieza con "AC..." — Twilio Console,
//                             en la portada del dashboard.
//   TWILIO_AUTH_TOKEN         Justo debajo del Account SID en la
//                             misma pantalla ("Show" para verlo).
//   TWILIO_WEBHOOK_URL        La URL pública completa de ESTA función
//                             tal cual la vas a poner en Twilio, ej.
//                             "https://romor-gastos.vercel.app/api/whatsapp-bitacora"
//                             (sin "/" al final). Se usa para comprobar
//                             que cada mensaje que llega sí viene de
//                             Twilio y no de un impostor — tiene que
//                             coincidir EXACTO con lo que configuraste
//                             en la consola de Twilio.
//   SUPABASE_URL              La misma URL que usa js/config.js.
//   SUPABASE_SERVICE_ROLE_KEY La llave "service_role" de Supabase
//                             (Project Settings → API → Project API
//                             keys). Es DISTINTA de la "anon" que usa
//                             la app en el navegador — esta llave se
//                             salta todos los permisos (RLS), por eso
//                             solo debe vivir aquí, nunca en el
//                             navegador ni en ningún archivo que se
//                             suba a GitHub.
// =============================================================

const crypto = require("crypto");
const twilio = require("twilio");

const VENTANA_BUZON_MS = 3 * 60 * 60 * 1000; // 3 horas: cuánto esperamos fotos antes de "olvidarlas" del buzón

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

// -------------------- Supabase (vía REST, con la llave de servicio) --------------------
function sbHeaders(extra) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...extra };
}

async function sbSelect(tabla, query) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/${tabla}?${query}`;
  const res = await fetch(url, { headers: sbHeaders() });
  if (!res.ok) throw new Error(`Supabase select ${tabla} falló: ${res.status} ${await res.text()}`);
  return res.json();
}

async function sbInsert(tabla, body) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/${tabla}`;
  const res = await fetch(url, {
    method: "POST",
    headers: sbHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase insert ${tabla} falló: ${res.status} ${await res.text()}`);
  return res.json();
}

async function sbDelete(tabla, query) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/${tabla}?${query}`;
  const res = await fetch(url, { method: "DELETE", headers: sbHeaders() });
  if (!res.ok) throw new Error(`Supabase delete ${tabla} falló: ${res.status} ${await res.text()}`);
}

async function subirFotoAStorage(bytes, contentType, nombreArchivo) {
  const url = `${process.env.SUPABASE_URL}/storage/v1/object/comprobantes/${nombreArchivo}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": contentType || "application/octet-stream",
    },
    body: bytes,
  });
  if (!res.ok) throw new Error(`Storage upload falló: ${res.status} ${await res.text()}`);
  return `${process.env.SUPABASE_URL}/storage/v1/object/public/comprobantes/${nombreArchivo}`;
}

// -------------------- Twilio --------------------
async function descargarMediaDeTwilio(url) {
  const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
  if (!res.ok) throw new Error(`No se pudo descargar media de Twilio: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function escaparXml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
}

// Arma la respuesta en formato TwiML — es lo que Twilio espera como
// cuerpo de la respuesta HTTP para saber qué contestarle al usuario.
// No hace falta llamar a ninguna otra API para "mandar" este mensaje.
function respuestaTwiml(texto) {
  const mensaje = texto ? `<Message>${escaparXml(texto)}</Message>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${mensaje}</Response>`;
}

// -------------------- Lógica de negocio --------------------
function extensionPara(mimeType) {
  if (!mimeType) return "jpg";
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("pdf")) return "pdf";
  return "jpg";
}

function fechaHoyMexico() {
  // Fecha de hoy en la zona horaria de la obra (Sinaloa / Pacífico de
  // México), en formato YYYY-MM-DD, tal como lo espera la columna "fecha".
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mazatlan" }).format(new Date());
}

function quitarAcentos(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Busca, dentro del texto del mensaje, el nombre del proyecto que
// aparece antes de los ":" (convención: "Nombre del proyecto: nota
// del avance"). Regresa { proyecto, nota } o null si no se reconoció
// ningún proyecto.
function parsearMensaje(texto, proyectos) {
  const idx = texto.indexOf(":");
  const candidato = idx === -1 ? texto : texto.slice(0, idx);
  const nota = idx === -1 ? "" : texto.slice(idx + 1).trim();
  const candidatoNorm = quitarAcentos(candidato).trim().toLowerCase();
  const matchExacto = proyectos.find((p) => quitarAcentos(p.nombre).trim().toLowerCase() === candidatoNorm);
  if (matchExacto) return { proyecto: matchExacto, nota };
  // Si no hubo match exacto antes de los ":", probamos si el nombre de
  // algún proyecto aparece en cualquier parte del mensaje completo (por
  // si alguien no siguió el formato al pie de la letra).
  const textoNorm = quitarAcentos(texto).toLowerCase();
  const matchParcial = proyectos.find((p) => textoNorm.includes(quitarAcentos(p.nombre).toLowerCase()));
  if (matchParcial) return { proyecto: matchParcial, nota: texto };
  return null;
}

async function procesarMensajeDeTexto(telefono, texto, integrante) {
  const proyectos = await sbSelect("proyectos", "select=id,nombre");
  const parsed = parsearMensaje(texto, proyectos);
  if (!parsed) {
    const nombres = proyectos.map((p) => p.nombre).join(", ");
    return respuestaTwiml(
      `No reconocí a qué proyecto pertenece 🤔. Empieza tu mensaje con el nombre exacto de un proyecto seguido de ":". Proyectos disponibles: ${nombres}`
    );
  }

  const desde = new Date(Date.now() - VENTANA_BUZON_MS).toISOString();
  const pendientes = await sbSelect(
    "wa_bitacora_inbox",
    `telefono=eq.${encodeURIComponent(telefono)}&created_at=gte.${encodeURIComponent(desde)}&order=created_at.asc`
  );
  const fotos = pendientes.map((p) => p.foto_url);

  await sbInsert("bitacora", {
    proyecto_id: parsed.proyecto.id,
    fecha: fechaHoyMexico(),
    nota: parsed.nota || null,
    fotos,
    capturado_por: integrante.nombre,
  });

  if (pendientes.length > 0) {
    const ids = pendientes.map((p) => p.id);
    await sbDelete("wa_bitacora_inbox", `id=in.(${ids.join(",")})`);
  }

  const fotosTxt = fotos.length > 0 ? ` con ${fotos.length} foto(s)` : " (sin fotos)";
  return respuestaTwiml(`✅ Bitácora agregada a "${parsed.proyecto.nombre}"${fotosTxt}.`);
}

async function procesarMedia(telefono, params, numMedia) {
  let guardadas = 0;
  for (let i = 0; i < numMedia; i++) {
    const mediaUrl = params[`MediaUrl${i}`];
    const mimeType = params[`MediaContentType${i}`] || "";
    if (!mediaUrl || !mimeType.startsWith("image/")) continue; // audios, video, vCards, etc. se ignoran aquí
    const bytes = await descargarMediaDeTwilio(mediaUrl);
    const nombreArchivo = `wa-${crypto.randomUUID()}.${extensionPara(mimeType)}`;
    const url = await subirFotoAStorage(bytes, mimeType, nombreArchivo);
    await sbInsert("wa_bitacora_inbox", { telefono, foto_url: url });
    guardadas++;
  }

  if (guardadas === 0) {
    return respuestaTwiml("Ese archivo no lo pude usar para la bitácora (solo acepto fotos). Manda una foto, o el nombre del proyecto seguido de \":\" y tu nota.");
  }
  const palabra = guardadas === 1 ? "Foto recibida" : `${guardadas} fotos recibidas`;
  return respuestaTwiml(`📷 ${palabra}. Ahora mándame el nombre del proyecto seguido de ":" y tu nota para terminar la bitácora.`);
}

async function procesarWebhook(params) {
  const from = params.From || ""; // ej. "whatsapp:+5216671234567"
  const telefono = from.replace(/^whatsapp:/, "").trim();
  if (!telefono) return respuestaTwiml("");

  const integrantes = await sbSelect("integrantes", `telefono=eq.${encodeURIComponent(telefono)}&select=nombre`);
  const integrante = integrantes[0] || null;
  if (!integrante) {
    return respuestaTwiml(
      "Este número no está registrado en el equipo de ROMOR — pídele a Santiago que lo agregue para poder usar la bitácora por WhatsApp."
    );
  }

  const numMedia = parseInt(params.NumMedia || "0", 10);
  if (numMedia > 0) {
    return await procesarMedia(telefono, params, numMedia);
  }

  const body = (params.Body || "").trim();
  if (body) {
    return await procesarMensajeDeTexto(telefono, body, integrante);
  }

  return respuestaTwiml("");
}

async function handler(req, res) {
  if (req.method === "GET") {
    res.status(200).send("Webhook de bitácora por WhatsApp (Twilio) — listo para recibir mensajes.");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }

  const rawBody = await readRawBody(req);
  const params = Object.fromEntries(new URLSearchParams(rawBody.toString("utf8")));

  const firmaValida = twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN,
    req.headers["x-twilio-signature"] || "",
    process.env.TWILIO_WEBHOOK_URL,
    params
  );
  if (!firmaValida) {
    res.status(401).send("Firma inválida");
    return;
  }

  let twiml;
  try {
    twiml = await procesarWebhook(params);
  } catch (err) {
    // No dejamos que un error tumbe la respuesta: si Twilio no recibe
    // una respuesta válida, el usuario ve un error genérico en WhatsApp
    // sin ninguna pista de qué pasó. Mejor contestarle algo útil.
    console.error("Error procesando webhook de WhatsApp (Twilio):", err);
    twiml = respuestaTwiml("Ocurrió un error guardando tu mensaje — intenta de nuevo en un momento.");
  }

  res.setHeader("Content-Type", "text/xml");
  res.status(200).send(twiml);
}

// Le dice a Vercel que NO intente parsear el body solo — necesitamos
// los bytes originales (sin tocar) para poder reconstruir los
// parámetros exactamente como los mandó Twilio y comprobar la firma.
// Tiene que ir colgado de la función que de verdad se exporta (si se
// pone en un objeto aparte y luego se reasigna module.exports, esta
// bandera se pierde).
handler.config = { api: { bodyParser: false } };
module.exports = handler;
