/** Datos de quién hace el pedido (tablas `organizaciones` + `contactos` en schema.sql). */
import { sinTildes } from "./normalizar.js";

export const TIPOS_ORGANIZACION = ["colegio", "club", "liga", "empresa", "otro"] as const;
export type TipoOrganizacion = (typeof TIPOS_ORGANIZACION)[number];

export interface Cliente {
  organizacion: string;
  tipo: TipoOrganizacion;
  nit: string;
  contacto: string;
  email: string;
  whatsapp: string; // formato internacional (+573001234567) o vacío
  aceptaWhatsapp: boolean; // el contacto autorizó recibir avisos por WhatsApp (opt-in)
}

export type ResultadoCliente =
  | { ok: true; cliente: Cliente }
  | { ok: false; errores: Partial<Record<keyof Cliente, string>> };

/** Valida y normaliza el formulario del cliente. */
export function validarCliente(entrada: Record<string, unknown>): ResultadoCliente {
  const t = (k: string) => String(entrada[k] ?? "").trim().replace(/\s+/g, " ");
  const errores: Partial<Record<keyof Cliente, string>> = {};

  const organizacion = t("organizacion");
  if (organizacion.length < 2) errores.organizacion = "Escribe el nombre del colegio, club o empresa.";
  else if (organizacion.length > 80) errores.organizacion = "Máximo 80 caracteres.";

  // Acepta "Colegio", "club deportivo", "Empresa privada"...: vale si empieza por un tipo conocido.
  const tipoCrudo = sinTildes(t("tipo")).toLowerCase();
  const tipo = tipoCrudo ? TIPOS_ORGANIZACION.find((x) => tipoCrudo === x || tipoCrudo.startsWith(x)) : "otro";
  if (!tipo) errores.tipo = `Tipo no válido. Usa: ${TIPOS_ORGANIZACION.join(", ")}.`;

  const nit = t("nit");
  if (nit && !/^[0-9][0-9.\-]{4,15}$/.test(nit)) errores.nit = "El NIT solo lleva números, puntos y guion.";

  const contacto = t("contacto");
  if (contacto.length < 2) errores.contacto = "Escribe el nombre de la persona de contacto.";
  else if (contacto.length > 80) errores.contacto = "Máximo 80 caracteres.";

  const email = t("email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errores.email = "Escribe un correo válido.";

  const whatsapp = normalizarWhatsapp(t("whatsapp"));
  if (whatsapp === null) errores.whatsapp = "Número no válido. Ejemplo: 300 123 4567 o +57 300 123 4567.";

  const aceptaWhatsapp = esAfirmativo(t("aceptaWhatsapp"));

  if (Object.keys(errores).length > 0) return { ok: false, errores };
  return {
    ok: true,
    cliente: { organizacion, tipo: tipo as TipoOrganizacion, nit, contacto, email, whatsapp: whatsapp ?? "", aceptaWhatsapp },
  };
}

/** Equipo y versión del uniforme del pedido, p. ej. "FC Barcelona Visitante". Obligatorio. */
export function validarEquipo(valor: unknown): { ok: true; equipo: string } | { ok: false; error: string } {
  const equipo = String(valor ?? "").trim().replace(/\s+/g, " ");
  if (equipo.length < 2) return { ok: false, error: "Escribe el equipo del pedido. Ejemplo: FC Barcelona Visitante." };
  if (equipo.length > 80) return { ok: false, error: "Máximo 80 caracteres." };
  return { ok: true, equipo };
}

/** "Sí", "si", "yes", "x", "1", "true" -> true. Cualquier otra cosa (o vacío) -> false. */
export function esAfirmativo(valor: string): boolean {
  return ["si", "yes", "true", "1", "x", "ok", "acepta", "autoriza"].includes(sinTildes(valor).trim().toLowerCase());
}

/** "300 123 4567" -> "+573001234567"; vacío -> ""; inválido -> null. */
export function normalizarWhatsapp(valor: string): string | null {
  const limpio = valor.replace(/[\s().\-]/g, "");
  if (!limpio) return "";
  if (/^3\d{9}$/.test(limpio)) return `+57${limpio}`; // celular colombiano
  if (/^\+[1-9]\d{7,14}$/.test(limpio)) return limpio;
  return null;
}

/**
 * Une los datos que trae el archivo con los del formulario. Lo que la persona
 * escribió (o corrigió) en el formulario manda; el archivo llena lo que falta.
 */
export function combinarCliente(
  delArchivo: Partial<Record<keyof Cliente, string>>,
  delFormulario: Record<string, unknown>,
): Record<string, unknown> {
  const salida: Record<string, unknown> = { ...delArchivo };
  for (const [clave, valor] of Object.entries(delFormulario)) {
    if (String(valor ?? "").trim()) salida[clave] = valor;
  }
  return salida;
}
