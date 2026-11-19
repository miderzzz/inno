import { z } from "zod";
import { REGLAS, TALLAS_VALIDAS, type Talla } from "./catalogo.js";
import type { FilaCruda, ResultadoLectura } from "./lector.js";
import { normalizarNombre, normalizarNumero, normalizarTalla } from "./normalizar.js";

export type Severidad = "error" | "advertencia";

export interface Hallazgo {
  fila: number;
  campo: "nombre" | "numero" | "talla" | "equipo" | "archivo";
  codigo: string;
  severidad: Severidad;
  mensaje: string;
  valorOriginal?: string;
  sugerencia?: string;
}

/** Prenda ya limpia, lista para cotizar y guardar en `items_pedido`. */
export const PrendaSchema = z.object({
  fila: z.number().int().positive(),
  nombre: z.string().max(REGLAS.nombre.maxCaracteres),
  numero: z.number().int().min(REGLAS.numero.min).max(REGLAS.numero.max),
  talla: z.enum(TALLAS_VALIDAS),
  equipo: z.string(),
  producto: z.string().optional(),
});
export type Prenda = z.infer<typeof PrendaSchema>;

export interface ResultadoValidacion {
  valido: boolean; // true si no hay errores bloqueantes
  resumen: {
    filasTotal: number;
    filasValidas: number;
    filasConError: number;
    advertencias: number;
    curvaTallas: Partial<Record<Talla, number>>;
  };
  prendas: Prenda[]; // solo filas sin errores
  hallazgos: Hallazgo[];
}

export function validarPedido(lectura: ResultadoLectura): ResultadoValidacion {
  const hallazgos: Hallazgo[] = lectura.erroresEstructura.map((mensaje) => ({
    fila: 0, campo: "archivo", codigo: "ESTRUCTURA", severidad: "error", mensaje,
  }));

  const candidatas: Prenda[] = [];
  for (const fila of lectura.filas) {
    const { prenda, hallazgos: h } = validarFila(fila);
    hallazgos.push(...h);
    if (prenda) candidatas.push(prenda);
  }

  hallazgos.push(...detectarDorsalesRepetidos(candidatas));
  hallazgos.push(...detectarNombresRepetidos(candidatas));

  const filasConError = new Set(hallazgos.filter((h) => h.severidad === "error" && h.fila > 0).map((h) => h.fila));
  const prendas = candidatas.filter((p) => !filasConError.has(p.fila));

  const curvaTallas: Partial<Record<Talla, number>> = {};
  for (const p of prendas) curvaTallas[p.talla] = (curvaTallas[p.talla] ?? 0) + 1;

  hallazgos.sort((a, b) => a.fila - b.fila || (a.severidad === "error" ? -1 : 1));

  return {
    valido: !hallazgos.some((h) => h.severidad === "error"),
    resumen: {
      filasTotal: lectura.filas.length,
      filasValidas: prendas.length,
      filasConError: filasConError.size,
      advertencias: hallazgos.filter((h) => h.severidad === "advertencia").length,
      curvaTallas,
    },
    prendas,
    hallazgos,
  };
}

function validarFila({ fila, valores }: FilaCruda): { prenda?: Prenda; hallazgos: Hallazgo[] } {
  const hallazgos: Hallazgo[] = [];
  const add = (h: Omit<Hallazgo, "fila">) => hallazgos.push({ fila, ...h });

  // ---- Talla ----------------------------------------------------------
  const tallaOriginal = valores.talla ?? "";
  const talla = normalizarTalla(tallaOriginal);
  if (!tallaOriginal) {
    add({ campo: "talla", codigo: "TALLA_VACIA", severidad: "error", mensaje: "La talla es obligatoria." });
  } else if (!talla.ok) {
    add({
      campo: "talla", codigo: "TALLA_INVALIDA", severidad: "error", valorOriginal: tallaOriginal,
      mensaje: `"${tallaOriginal}" no es una talla disponible. Tallas válidas: ${TALLAS_VALIDAS.join(", ")}.`,
    });
  } else if (talla.corregida) {
    add({
      campo: "talla", codigo: "TALLA_NORMALIZADA", severidad: "advertencia", valorOriginal: tallaOriginal,
      sugerencia: talla.talla, mensaje: `Talla "${tallaOriginal}" interpretada como ${talla.talla}.`,
    });
  }

  // ---- Nombre ---------------------------------------------------------
  const nombreOriginal = valores.nombre ?? "";
  const nombre = normalizarNombre(nombreOriginal);
  const { maxCaracteres, patronPermitido, obligatorio } = REGLAS.nombre;
  let nombreOk = true;
  if (!nombre) {
    if (obligatorio) {
      nombreOk = false;
      add({ campo: "nombre", codigo: "NOMBRE_VACIO", severidad: "error", mensaje: "El nombre a estampar es obligatorio." });
    }
  } else {
    if (!patronPermitido.test(nombre)) {
      nombreOk = false;
      const raros = [...new Set(nombre.replace(/[A-ZÁÉÍÓÚÜÑ .'-]/g, ""))].join(" ");
      add({
        campo: "nombre", codigo: "NOMBRE_CARACTERES", severidad: "error", valorOriginal: nombreOriginal,
        mensaje: `El nombre tiene caracteres que no se pueden estampar: ${raros}`,
      });
    }
    if (nombre.length > maxCaracteres) {
      nombreOk = false;
      add({
        campo: "nombre", codigo: "NOMBRE_LARGO", severidad: "error", valorOriginal: nombreOriginal,
        sugerencia: sugerirNombreCorto(nombre, maxCaracteres),
        mensaje: `El nombre tiene ${nombre.length} caracteres; el máximo es ${maxCaracteres}.`,
      });
    }
  }

  // ---- Número (dorsal) -----------------------------------------------
  const numeroOriginal = valores.numero ?? "";
  const numero = normalizarNumero(numeroOriginal);
  let numeroOk = false;
  if (!numero.ok) {
    const mensajes = {
      vacio: "El número (dorsal) es obligatorio.",
      no_numerico: `"${numeroOriginal}" no es un número válido.`,
      decimal: `"${numeroOriginal}" tiene decimales; el dorsal debe ser un número entero.`,
    } as const;
    if (numero.motivo !== "vacio" || REGLAS.numero.obligatorio) {
      add({
        campo: "numero", codigo: `NUMERO_${numero.motivo.toUpperCase()}`, severidad: "error",
        valorOriginal: numeroOriginal, mensaje: mensajes[numero.motivo],
      });
    }
  } else if (numero.numero < REGLAS.numero.min || numero.numero > REGLAS.numero.max) {
    add({
      campo: "numero", codigo: "NUMERO_RANGO", severidad: "error", valorOriginal: numeroOriginal,
      mensaje: `El dorsal ${numero.numero} está fuera del rango permitido (${REGLAS.numero.min}–${REGLAS.numero.max}).`,
    });
  } else {
    numeroOk = true;
    if (numero.corregido) {
      add({
        campo: "numero", codigo: "NUMERO_CERO_INICIAL", severidad: "advertencia", valorOriginal: numeroOriginal,
        sugerencia: String(numero.numero),
        mensaje: `"${numeroOriginal}" se estampará como ${numero.numero} (los dorsales se estampan sin cero inicial).`,
      });
    }
  }

  if (!talla.ok || !nombreOk || !numeroOk || !numero.ok) return { hallazgos };

  const resultado = PrendaSchema.safeParse({
    fila,
    nombre,
    numero: numero.numero,
    talla: talla.talla,
    equipo: (valores.equipo ?? "").trim().toUpperCase() || "GENERAL",
    producto: valores.producto?.trim() || undefined,
  });
  // Red de seguridad: si alguna regla anterior se escapó, Zod la detiene.
  if (!resultado.success) {
    for (const issue of resultado.error.issues) {
      add({ campo: "archivo", codigo: "ESQUEMA", severidad: "error", mensaje: issue.message });
    }
    return { hallazgos };
  }
  return { prenda: resultado.data, hallazgos };
}

/** Dos jugadores del mismo equipo no pueden llevar el mismo dorsal. */
function detectarDorsalesRepetidos(prendas: Prenda[]): Hallazgo[] {
  const porClave = new Map<string, Prenda[]>();
  for (const p of prendas) {
    const clave = `${p.equipo}#${p.numero}`;
    porClave.set(clave, [...(porClave.get(clave) ?? []), p]);
  }
  const hallazgos: Hallazgo[] = [];
  for (const grupo of porClave.values()) {
    if (grupo.length < 2) continue;
    const filas = grupo.map((p) => p.fila).join(", ");
    for (const p of grupo) {
      hallazgos.push({
        fila: p.fila, campo: "numero", codigo: "NUMERO_DUPLICADO", severidad: "error",
        valorOriginal: String(p.numero),
        mensaje: `El dorsal ${p.numero} está repetido en el equipo ${p.equipo} (filas ${filas}).`,
      });
    }
  }
  return hallazgos;
}

/** Mismo nombre y número en el mismo equipo suele ser una fila pegada dos veces. */
function detectarNombresRepetidos(prendas: Prenda[]): Hallazgo[] {
  const vistos = new Map<string, number>();
  const hallazgos: Hallazgo[] = [];
  for (const p of prendas) {
    const clave = `${p.equipo}#${p.nombre}`;
    const previa = vistos.get(clave);
    if (previa !== undefined) {
      hallazgos.push({
        fila: p.fila, campo: "nombre", codigo: "NOMBRE_REPETIDO", severidad: "advertencia",
        valorOriginal: p.nombre,
        mensaje: `"${p.nombre}" ya aparece en la fila ${previa} del equipo ${p.equipo}. Confirma que no es una fila duplicada.`,
      });
    } else {
      vistos.set(clave, p.fila);
    }
  }
  return hallazgos;
}

/** "MARIA FERNANDA RODRIGUEZ" -> "M. RODRIGUEZ" o recorte simple. */
function sugerirNombreCorto(nombre: string, max: number): string {
  const partes = nombre.split(" ");
  if (partes.length > 1) {
    const apellido = partes.at(-1)!;
    const conInicial = `${partes[0][0]}. ${apellido}`;
    if (conInicial.length <= max) return conInicial;
    if (apellido.length <= max) return apellido;
  }
  return nombre.slice(0, max).trim();
}
