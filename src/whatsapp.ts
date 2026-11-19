/**
 * Avisos por WhatsApp cuando cambia el estado de un pedido.
 *
 * Dos modos, según las variables de entorno:
 *   - SIMULADO (por defecto): no sale ningún mensaje; el aviso queda registrado
 *     en el pedido con resultado "simulado". Sirve para probar el flujo.
 *   - REAL: si existen WHATSAPP_TOKEN y WHATSAPP_PHONE_ID, se envía por la
 *     WhatsApp Business Cloud API de Meta.
 *
 * Variables opcionales (modo real):
 *   WHATSAPP_API_URL                 por defecto https://graph.facebook.com/v21.0
 *   WHATSAPP_LANG                    idioma de las plantillas, por defecto "es"
 *   WHATSAPP_TEMPLATE_POR_APROBAR    nombre de la plantilla aprobada por Meta
 *   WHATSAPP_TEMPLATE_EN_PRODUCCION  (si no se define, se envía texto libre,
 *   WHATSAPP_TEMPLATE_FINALIZADO      que solo llega dentro de las 24 h de una
 *                                     conversación o a números de prueba)
 * Variables de cada plantilla: {{1}} contacto, {{2}} código del pedido, {{3}} organización.
 */
import { randomUUID } from "node:crypto";
import type { Aviso, EstadoPedido, Pedido } from "./almacen.js";

export type ModoWhatsapp = "real" | "simulado";

export function modoWhatsapp(): ModoWhatsapp {
  return process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID ? "real" : "simulado";
}

/** Texto del aviso para cada estado. `null` si ese estado no genera aviso. */
export function textoAviso(p: Pedido, estado: EstadoPedido): string | null {
  const nombre = p.cliente.contacto.split(" ")[0];
  const n = p.prendas.length;
  switch (estado) {
    case "por_aprobar":
      return `Hola ${nombre}, recibimos el pedido ${p.codigo} de ${p.cliente.organizacion} (${n} prendas). Está *por aprobar*: revisa la cotización y la vista previa y confírmanos para pasarlo a producción. — Sport Champion`;
    case "en_produccion":
      return `Hola ${nombre}, tu pedido ${p.codigo} ya está *en producción*. Te avisaremos apenas esté finalizado. — Sport Champion`;
    case "finalizado":
      return `Hola ${nombre}, tu pedido ${p.codigo} está *finalizado* y listo para entrega. ¡Gracias por confiar en Sport Champion!`;
    default:
      return null; // borrador: no se avisa
  }
}

const VARIABLE_PLANTILLA: Partial<Record<EstadoPedido, string>> = {
  por_aprobar: "WHATSAPP_TEMPLATE_POR_APROBAR",
  en_produccion: "WHATSAPP_TEMPLATE_EN_PRODUCCION",
  finalizado: "WHATSAPP_TEMPLATE_FINALIZADO",
};

/**
 * Intenta avisar al contacto del pedido y devuelve el registro del intento.
 * Nunca lanza: un fallo de WhatsApp no debe impedir el cambio de estado.
 */
export async function enviarAviso(p: Pedido, estado: EstadoPedido): Promise<Aviso | null> {
  const texto = textoAviso(p, estado);
  if (!texto) return null;

  const registro = (resultado: Aviso["resultado"], detalle?: string): Aviso => ({
    id: randomUUID(),
    canal: "whatsapp",
    fecha: new Date().toISOString(),
    paraEstado: estado,
    para: p.cliente.whatsapp,
    texto,
    resultado,
    detalle,
  });

  if (!p.cliente.whatsapp) return registro("omitido", "El cliente no registró un número de WhatsApp.");
  if (!p.cliente.aceptaWhatsapp) return registro("omitido", "El contacto no ha autorizado recibir avisos por WhatsApp.");
  if (modoWhatsapp() === "simulado") {
    return registro("simulado", "Modo simulación: el mensaje no sale al celular. Configura WHATSAPP_TOKEN y WHATSAPP_PHONE_ID para enviarlo de verdad.");
  }

  try {
    const base = process.env.WHATSAPP_API_URL ?? "https://graph.facebook.com/v21.0";
    const plantilla = process.env[VARIABLE_PLANTILLA[estado] ?? ""];
    const para = p.cliente.whatsapp.replace(/\D/g, ""); // la API pide solo dígitos
    const cuerpo = plantilla
      ? {
          messaging_product: "whatsapp",
          to: para,
          type: "template",
          template: {
            name: plantilla,
            language: { code: process.env.WHATSAPP_LANG ?? "es" },
            components: [
              {
                type: "body",
                parameters: [p.cliente.contacto.split(" ")[0], p.codigo, p.cliente.organizacion].map((text) => ({ type: "text", text })),
              },
            ],
          },
        }
      : { messaging_product: "whatsapp", to: para, type: "text", text: { body: texto } };

    const respuesta = await fetch(`${base}/${process.env.WHATSAPP_PHONE_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await respuesta.json().catch(() => ({}))) as {
      messages?: { id: string }[];
      error?: { message?: string };
    };
    if (!respuesta.ok) return registro("fallido", json.error?.message ?? `WhatsApp respondió con el código ${respuesta.status}.`);
    return registro("enviado", json.messages?.[0]?.id);
  } catch (e) {
    return registro("fallido", e instanceof Error ? e.message : "No se pudo conectar con WhatsApp.");
  }
}
