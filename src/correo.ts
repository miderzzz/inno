/**
 * Avisos por correo cuando cambia el estado de un pedido.
 *
 * Dos modos, según las variables de entorno:
 *   - SIMULADO (por defecto): no sale ningún correo; el aviso queda registrado.
 *   - REAL: si existen CORREO_USUARIO y CORREO_CLAVE, se envía por SMTP.
 *
 * Variables (modo real):
 *   CORREO_USUARIO   cuenta que envía, p. ej. amiderosespana@gmail.com
 *   CORREO_CLAVE     contraseña de aplicación de Gmail (16 letras; los espacios se ignoran)
 *   CORREO_SERVIDOR  por defecto smtp.gmail.com
 *   CORREO_PUERTO    por defecto 465 (conexión segura). Con otro puerto se usa STARTTLS si el servidor lo ofrece.
 *   CORREO_NOMBRE    nombre que ve el cliente, por defecto SPORT CHAMPION
 *   CORREO_PIE       frase final del correo, por defecto "A tu servicio"
 *   CORREO_COPIA     (opcional) recibe copia oculta de cada aviso
 */
import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import { ETIQUETA_ESTADO, type Aviso, type EstadoPedido, type Pedido } from "./almacen.js";

export type ModoCorreo = "real" | "simulado";

export function modoCorreo(): ModoCorreo {
  return process.env.CORREO_USUARIO && process.env.CORREO_CLAVE ? "real" : "simulado";
}

const marca = () => process.env.CORREO_NOMBRE?.trim() || "SPORT CHAMPION";
const pie = () => process.env.CORREO_PIE?.trim() || "A tu servicio";

const html = (t: unknown) =>
  String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const ESTILO: Record<string, { titulo: string; color: string; fondo: string }> = {
  por_aprobar: { titulo: "Tu pedido está por aprobar", color: "#1e40af", fondo: "#dbeafe" },
  en_produccion: { titulo: "Tu pedido está en producción", color: "#9a3412", fondo: "#ffedd5" },
  finalizado: { titulo: "Tu pedido está finalizado", color: "#166534", fondo: "#dcfce7" },
};

function parrafos(p: Pedido, estado: EstadoPedido): string[] {
  const nombre = p.cliente.contacto.split(" ")[0];
  switch (estado) {
    case "por_aprobar":
      return [
        `Hola ${nombre}, recibimos el pedido ${p.codigo} de ${p.cliente.organizacion} con ${p.prendas.length} prendas.`,
        "Revisa el resumen de abajo. Para aprobarlo y pasarlo a producción, responde a este correo confirmándolo, o escríbenos si necesitas cambiar algo.",
      ];
    case "en_produccion":
      return [`Hola ${nombre}, tu pedido ${p.codigo} ya está en producción.`, "Te avisaremos por este medio apenas esté finalizado."];
    case "finalizado":
      return [
        `Hola ${nombre}, tu pedido ${p.codigo} está finalizado y listo para entrega.`,
        `Gracias por confiar en ${marca()}. Si algo no está como esperabas, responde a este correo.`,
      ];
    default:
      return [];
  }
}

/** Asunto, texto plano y HTML del correo de cada estado. `null` si ese estado no genera aviso. */
export function contenidoCorreo(p: Pedido, estado: EstadoPedido): { asunto: string; texto: string; html: string } | null {
  const estilo = ESTILO[estado];
  if (!estilo) return null;
  const tallas = Object.entries(p.resumen.curvaTallas).map(([t, n]) => `${t} × ${n}`).join(", ") || "—";
  const filas: [string, string][] = [
    ["Pedido", p.codigo],
    ["Cliente", p.cliente.organizacion],
    ["Prendas", String(p.prendas.length)],
    ["Tallas", tallas],
    ["Estado", ETIQUETA_ESTADO[estado]],
  ];
  const parrs = parrafos(p, estado);
  const asunto = `Pedido ${p.codigo} · ${ETIQUETA_ESTADO[estado]} | ${marca()}`;

  const texto = [estilo.titulo.toUpperCase(), "", ...parrs.flatMap((x) => [x, ""]), ...filas.map(([k, v]) => `${k}: ${v}`), "", `${pie()}`, marca()].join("\n");

  const cuerpo = `<!doctype html><html lang="es"><body style="margin:0;background:#f5f6f8;font-family:Arial,Helvetica,sans-serif;color:#1c1c1c">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:10px;border:1px solid #e2e2e2">
<tr><td style="padding:18px 24px;border-bottom:1px solid #e2e2e2;font-size:18px;font-weight:bold;letter-spacing:1px">${html(marca())}</td></tr>
<tr><td style="padding:24px">
<div style="display:inline-block;background:${estilo.fondo};color:${estilo.color};font-weight:bold;font-size:13px;padding:4px 12px;border-radius:999px">${html(ETIQUETA_ESTADO[estado])}</div>
<h1 style="font-size:21px;margin:14px 0 12px">${html(estilo.titulo)}</h1>
${parrs.map((x) => `<p style="font-size:15px;line-height:1.5;margin:0 0 12px">${html(x)}</p>`).join("\n")}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;border-top:1px solid #e2e2e2">
${filas.map(([k, v]) => `<tr><td style="padding:8px 0;border-bottom:1px solid #eee;font-size:13px;color:#666;width:110px">${html(k)}</td><td style="padding:8px 0;border-bottom:1px solid #eee;font-size:14px;font-weight:bold">${html(v)}</td></tr>`).join("\n")}
</table>
</td></tr>
<tr><td style="padding:16px 24px;background:#fafafa;border-top:1px solid #e2e2e2;font-size:13px;color:#666;border-radius:0 0 10px 10px">${html(pie())}<br><b>${html(marca())}</b></td></tr>
</table></td></tr></table></body></html>`;

  return { asunto, texto, html: cuerpo };
}

/**
 * Intenta avisar por correo al contacto del pedido y devuelve el registro del intento.
 * Nunca lanza: un fallo del correo no debe impedir el cambio de estado.
 */
export async function enviarCorreo(p: Pedido, estado: EstadoPedido): Promise<Aviso | null> {
  const contenido = contenidoCorreo(p, estado);
  if (!contenido) return null;

  const registro = (resultado: Aviso["resultado"], detalle?: string): Aviso => ({
    id: randomUUID(),
    canal: "correo",
    fecha: new Date().toISOString(),
    paraEstado: estado,
    para: p.cliente.email,
    texto: `Asunto: ${contenido.asunto}\n${parrafos(p, estado)[0]}`,
    resultado,
    detalle,
  });

  if (!p.cliente.email) return registro("omitido", "El cliente no registró un correo.");
  if (modoCorreo() === "simulado") {
    return registro("simulado", "Modo simulación: el correo no se envía. Configura CORREO_USUARIO y CORREO_CLAVE para enviarlo de verdad.");
  }

  try {
    const usuario = process.env.CORREO_USUARIO!.trim();
    const puerto = Number(process.env.CORREO_PUERTO ?? 465);
    const transporte = nodemailer.createTransport({
      host: process.env.CORREO_SERVIDOR ?? "smtp.gmail.com",
      port: puerto,
      secure: puerto === 465,
      auth: { user: usuario, pass: process.env.CORREO_CLAVE!.replace(/\s+/g, "") },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    const copia = process.env.CORREO_COPIA?.trim();
    const info = await transporte.sendMail({
      from: { name: marca(), address: usuario },
      to: p.cliente.email,
      bcc: copia || undefined,
      replyTo: usuario,
      subject: contenido.asunto,
      text: contenido.texto,
      html: contenido.html,
    });
    transporte.close();
    const rechazados = info.rejected.length ? ` Rechazados: ${info.rejected.join(", ")}.` : "";
    if (info.accepted.length === 0) return registro("fallido", `El servidor no aceptó el destinatario.${rechazados}`);
    return registro("enviado", `${info.messageId}${copia ? ` · copia a ${copia}` : ""}${rechazados}`);
  } catch (e) {
    const err = e as { code?: string; responseCode?: number; message?: string };
    if (err.code === "EAUTH" || err.responseCode === 535) {
      return registro("fallido", "El servidor rechazó el usuario o la contraseña. Con Gmail hay que usar una contraseña de aplicación (no la normal).");
    }
    return registro("fallido", err.message ?? "No se pudo enviar el correo.");
  }
}
