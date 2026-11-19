import { ALIAS_TALLAS, TALLAS_VALIDAS, type Talla } from "./catalogo.js";

/** Quita tildes salvo la Ñ (que sí se estampa). */
export function sinTildes(texto: string): string {
  return texto
    .replace(/ñ/g, "\u0000n").replace(/Ñ/g, "\u0000N")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\u0000n/g, "ñ").replace(/\u0000N/g, "Ñ");
}

/** Clave para comparar encabezados: "  N° Dorsal " -> "n dorsal". */
export function claveEncabezado(texto: string): string {
  return sinTildes(texto)
    .toLowerCase()
    .replace(/[°º.:]/g, "")
    .replace(/[^a-z0-9#ñ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Convierte cualquier valor de celda (ExcelJS puede devolver objetos de
 * texto enriquecido, fórmulas o hipervínculos) en texto plano.
 */
export function celdaATexto(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  if (typeof valor === "string") return valor;
  if (typeof valor === "number" || typeof valor === "boolean") return String(valor);
  if (valor instanceof Date) return valor.toISOString();
  if (typeof valor === "object") {
    const v = valor as Record<string, unknown>;
    if (Array.isArray(v.richText)) {
      return (v.richText as { text: string }[]).map((r) => r.text).join("");
    }
    if ("result" in v) return celdaATexto(v.result); // fórmula
    if ("text" in v) return celdaATexto(v.text); // hipervínculo
  }
  return String(valor);
}

/** Nombre a estampar: mayúsculas, sin espacios dobles, sin tildes (salvo Ñ). */
export function normalizarNombre(valor: string): string {
  return sinTildes(valor.normalize("NFC"))
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

export type ResultadoTalla =
  | { ok: true; talla: Talla; corregida: boolean }
  | { ok: false };

/** "m", " Med ", "2XL", "T8" -> talla canónica; indica si hubo corrección. */
export function normalizarTalla(valor: string): ResultadoTalla {
  const original = valor.trim();
  const clave = sinTildes(original).toUpperCase().replace(/[\s.\-_/]/g, "").replace(/Ñ/g, "N");
  if (!clave) return { ok: false };

  if ((TALLAS_VALIDAS as readonly string[]).includes(clave)) {
    return { ok: true, talla: clave as Talla, corregida: clave !== original };
  }
  const alias = ALIAS_TALLAS[clave];
  if (alias) return { ok: true, talla: alias, corregida: true };
  return { ok: false };
}

export type ResultadoNumero =
  | { ok: true; numero: number; corregido: boolean }
  | { ok: false; motivo: "vacio" | "no_numerico" | "decimal" };

/** "07" -> 7 (avisa), "10.0" de Excel -> 10, "diez" -> error. */
export function normalizarNumero(valor: string): ResultadoNumero {
  const limpio = valor.trim().replace(/^#/, "");
  if (limpio === "") return { ok: false, motivo: "vacio" };
  if (!/^\d+([.,]0+)?$/.test(limpio)) {
    return /^\d+[.,]\d+$/.test(limpio)
      ? { ok: false, motivo: "decimal" }
      : { ok: false, motivo: "no_numerico" };
  }
  const entero = limpio.split(/[.,]/)[0];
  const numero = Number.parseInt(entero, 10);
  // "07" se estampa distinto de "7": se acepta pero se avisa.
  return { ok: true, numero, corregido: entero.length > 1 && entero.startsWith("0") };
}
