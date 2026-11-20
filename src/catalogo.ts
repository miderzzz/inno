/**
 * Catálogo de reglas de negocio.
 * En producción estos valores salen de las tablas `tallas`, `productos`
 * y `recargos`; aquí van como constantes para que el módulo sea autocontenido.
 */

export const TALLAS_VALIDAS = [
  // Infantil
  "4", "6", "8", "10", "12", "14", "16",
  // Adulto
  "XS", "S", "M", "L", "XL", "XXL", "XXXL",
] as const;

export type Talla = (typeof TALLAS_VALIDAS)[number];

/**
 * Variantes que la gente escribe en la vida real -> talla canónica.
 * Las claves ya vienen normalizadas (mayúsculas, sin tildes ni espacios).
 */
export const ALIAS_TALLAS: Record<string, Talla> = {
  EXTRASMALL: "XS", XSMALL: "XS",
  SMALL: "S", PEQUENA: "S", PEQUENO: "S", P: "S",
  MEDIUM: "M", MEDIANA: "M", MEDIANO: "M", MED: "M",
  LARGE: "L", GRANDE: "L", G: "L",
  XLARGE: "XL", EXTRALARGE: "XL", EXTRAGRANDE: "XL", XG: "XL",
  "2XL": "XXL", XXG: "XXL",
  "3XL": "XXXL", XXXG: "XXXL",
  T4: "4", T6: "6", T8: "8", T10: "10", T12: "12", T14: "14", T16: "16",
};

export const REGLAS = {
  nombre: {
    obligatorio: true,
    maxCaracteres: 12,
    // Letras (incluye tildes y Ñ), espacio, punto, guion y apóstrofe.
    patronPermitido: /^[A-ZÁÉÍÓÚÜÑ .'-]+$/,
  },
  numero: {
    obligatorio: true,
    min: 0,
    max: 99,
  },
  maxFilas: 2000,
} as const;

/**
 * Encabezados aceptados por columna. Se comparan ya normalizados
 * (minúsculas, sin tildes, sin signos), así "N°", "No.", "Dorsal" o
 * "Número" apuntan todos a `numero`.
 */
export const ENCABEZADOS: Record<"nombre" | "numero" | "talla" | "equipo" | "producto", string[]> = {
  nombre: ["nombre", "nombre camiseta", "nombre estampado", "jugador", "name"],
  numero: ["numero", "n", "no", "nro", "num", "dorsal", "number", "#"],
  talla: ["talla", "size", "talla camiseta"],
  equipo: ["equipo", "categoria", "team", "grupo"],
  producto: ["producto", "prenda", "item", "referencia"],
};

/**
 * Etiquetas del bloque de datos del cliente que va ANTES de la tabla de
 * prendas, en dos columnas: etiqueta | valor. Se comparan normalizadas
 * (sin tildes ni signos), así "Correo electrónico:" y "E-mail" valen igual.
 */
export const ETIQUETAS_CLIENTE: Record<
  "organizacion" | "tipo" | "nit" | "contacto" | "email" | "whatsapp" | "aceptaWhatsapp" | "equipo",
  string[]
> = {
  organizacion: ["organizacion", "colegio", "club", "empresa", "cliente", "institucion", "colegio club o empresa", "colegio club empresa"],
  tipo: ["tipo", "tipo de organizacion", "tipo de cliente"],
  nit: ["nit", "nit o cedula"],
  contacto: ["contacto", "persona de contacto", "responsable", "nombre del contacto"],
  email: ["correo", "email", "e mail", "correo electronico", "mail"],
  whatsapp: ["whatsapp", "celular", "telefono", "telefono whatsapp", "movil"],
  // Equipo y versión del uniforme de todo el pedido (p. ej. "FC Barcelona Visitante").
  // Va en el bloque de arriba; la columna "Equipo" de la tabla es la categoría de cada jugador.
  equipo: ["equipo", "equipo del pedido", "uniforme", "equipo uniforme", "equipacion", "modelo", "modelo de uniforme", "camiseta"],
  aceptaWhatsapp: ["autoriza whatsapp", "acepta whatsapp", "autorizacion whatsapp", "autoriza avisos por whatsapp", "autoriza avisos"],
};

export const COLUMNAS_OBLIGATORIAS = ["nombre", "numero", "talla"] as const;
