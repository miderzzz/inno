/**
 * Contraseña de acceso a la app.
 *
 *   APP_CLAVE    contraseña única del equipo. Si existe, todo /api exige haber ingresado.
 *   APP_SECRETO  (opcional) clave para firmar la sesión; si no está se deriva de APP_CLAVE,
 *                así que cambiar APP_CLAVE cierra todas las sesiones abiertas.
 *
 * Sin APP_CLAVE la app queda abierta, salvo en Vercel, donde se bloquea hasta configurarla
 * (en internet cualquiera con el enlace vería los datos de los clientes).
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const COOKIE = "psc_sesion";
const DURACION_MS = 7 * 24 * 60 * 60 * 1000; // 7 días
const MAX_FALLOS = 10;
const VENTANA_MS = 15 * 60 * 1000;

const clave = () => process.env.APP_CLAVE ?? "";
export const accesoProtegido = () => clave() !== "";
const bloqueadoSinClave = () => !accesoProtegido() && Boolean(process.env.VERCEL);

const sha = (t: string) => createHash("sha256").update(t).digest();
const secreto = () => process.env.APP_SECRETO || createHash("sha256").update(`psc-sesion:${clave()}`).digest("hex");
const firmar = (texto: string) => createHmac("sha256", secreto()).update(texto).digest("base64url");

export function claveCorrecta(intento: string): boolean {
  return accesoProtegido() && timingSafeEqual(sha(intento), sha(clave()));
}

export function crearToken(ahora = Date.now()): string {
  const vence = String(ahora + DURACION_MS);
  return `${vence}.${firmar(vence)}`;
}

export function tokenValido(token: string | undefined, ahora = Date.now()): boolean {
  if (!token) return false;
  const [vence, firma] = token.split(".");
  if (!vence || !firma || Number(vence) < ahora) return false;
  const esperada = Buffer.from(firmar(vence));
  const recibida = Buffer.from(firma);
  return esperada.length === recibida.length && timingSafeEqual(esperada, recibida);
}

function leerCookie(req: Request): string | undefined {
  for (const parte of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = parte.trim().split("=");
    if (k === COOKIE) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

const esHttps = (req: Request) => req.secure || req.headers["x-forwarded-proto"] === "https" || Boolean(process.env.VERCEL);

function ponerCookie(req: Request, res: Response, valor: string, maxAgeMs: number) {
  const partes = [`${COOKIE}=${encodeURIComponent(valor)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
  if (esHttps(req)) partes.push("Secure");
  res.setHeader("Set-Cookie", partes.join("; "));
}

export const sesionActiva = (req: Request) => !accesoProtegido() || tokenValido(leerCookie(req));

// Freno simple contra quien prueba contraseñas (por instancia del servidor).
const fallos = new Map<string, { n: number; desde: number }>();
/** Solo para pruebas. */
export const reiniciarIntentos = () => fallos.clear();
const ipDe = (req: Request) => String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0].trim();

/** GET /api/sesion: ¿hay que ingresar? ¿ya ingresó? */
export function estadoSesion(req: Request, res: Response) {
  res.json({ requiere: accesoProtegido(), activa: sesionActiva(req), sinConfigurar: bloqueadoSinClave() });
}

/** POST /api/sesion { clave } */
export function ingresar(req: Request, res: Response) {
  if (!accesoProtegido()) {
    res.status(bloqueadoSinClave() ? 503 : 400).json({ error: bloqueadoSinClave() ? "Falta configurar APP_CLAVE en Vercel." : "Esta instalación no usa contraseña." });
    return;
  }
  const ip = ipDe(req);
  const registro = fallos.get(ip);
  if (registro && Date.now() - registro.desde < VENTANA_MS && registro.n >= MAX_FALLOS) {
    res.status(429).json({ error: "Demasiados intentos. Espera 15 minutos e inténtalo de nuevo." });
    return;
  }
  if (!claveCorrecta(String(req.body?.clave ?? ""))) {
    const vigente = registro && Date.now() - registro.desde < VENTANA_MS ? registro : { n: 0, desde: Date.now() };
    vigente.n += 1;
    fallos.set(ip, vigente);
    res.status(401).json({ error: "Contraseña incorrecta." });
    return;
  }
  fallos.delete(ip);
  ponerCookie(req, res, crearToken(), DURACION_MS);
  res.json({ ok: true });
}

/** DELETE /api/sesion */
export function salir(req: Request, res: Response) {
  ponerCookie(req, res, "", 0);
  res.status(204).end();
}

/** Protege el resto de /api. */
export function exigirSesion(req: Request, res: Response, next: NextFunction) {
  if (bloqueadoSinClave()) {
    res.status(503).json({ error: "La app está bloqueada: falta configurar APP_CLAVE en las variables de entorno de Vercel.", login: true });
    return;
  }
  if (!sesionActiva(req)) {
    res.status(401).json({ error: "Ingresa la contraseña para continuar.", login: true });
    return;
  }
  next();
}
