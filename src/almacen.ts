/**
 * Almacén de pedidos en un archivo JSON (data/pedidos.json).
 * Sirve para probar el flujo sin instalar una base de datos. En producción
 * esto se reemplaza por PostgreSQL con el esquema de schema.sql.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Cliente } from "./cliente.js";
import type { ResultadoLectura } from "./lector.js";
import type { Hallazgo, Prenda, ResultadoValidacion } from "./validador.js";

/** borrador = el archivo tiene errores; el resto es el ciclo normal del pedido. */
export type EstadoPedido = "borrador" | "por_aprobar" | "en_produccion" | "finalizado";

export const ETIQUETA_ESTADO: Record<EstadoPedido, string> = {
  borrador: "Borrador (con errores)",
  por_aprobar: "Por aprobar",
  en_produccion: "En producción",
  finalizado: "Finalizado",
};

/** Cada estado solo puede avanzar al siguiente. */
export const SIGUIENTE_ESTADO: Partial<Record<EstadoPedido, EstadoPedido>> = {
  por_aprobar: "en_produccion",
  en_produccion: "finalizado",
};

export interface CambioEstado {
  estado: EstadoPedido;
  fecha: string; // ISO
}

export type Canal = "whatsapp" | "correo";

/** Registro de cada aviso (WhatsApp o correo) que el sistema intentó enviar. */
export interface Aviso {
  id: string;
  canal: Canal;
  fecha: string; // ISO
  paraEstado: EstadoPedido; // el estado que originó el aviso
  para: string; // número de WhatsApp (+57...) o dirección de correo
  texto: string;
  resultado: "enviado" | "simulado" | "fallido" | "omitido";
  detalle?: string; // motivo del fallo u omisión, o id del mensaje enviado
}

export interface Pedido {
  codigo: string; // PSC-2026-00001
  creadoEn: string; // ISO
  estado: EstadoPedido;
  historial: CambioEstado[];
  mensajes: Aviso[];
  cliente: Cliente;
  archivo: { nombre: string; filasTotal: number };
  mapaColumnas: ResultadoLectura["mapaColumnas"];
  resumen: ResultadoValidacion["resumen"];
  prendas: Prenda[];
  hallazgos: Hallazgo[];
}

export interface PedidoResumen {
  codigo: string;
  creadoEn: string;
  estado: EstadoPedido;
  organizacion: string;
  contacto: string;
  prendas: number;
  errores: number;
}

interface BaseDatos {
  secuencia: number;
  pedidos: Pedido[];
}

const ruta = () => process.env.PSC_DATA ?? "data/pedidos.json";

function leer(): BaseDatos {
  if (!existsSync(ruta())) return { secuencia: 0, pedidos: [] };
  const db = JSON.parse(readFileSync(ruta(), "utf8")) as BaseDatos;
  // Compatibilidad con archivos guardados por versiones anteriores.
  for (const p of db.pedidos) {
    if ((p.estado as string) === "validado") p.estado = "por_aprobar";
    p.historial ??= [{ estado: p.estado, fecha: p.creadoEn }];
    p.mensajes ??= [];
    for (const m of p.mensajes) m.canal ??= "whatsapp"; // versiones anteriores solo avisaban por WhatsApp
    p.cliente.aceptaWhatsapp ??= false;
  }
  return db;
}

function guardar(db: BaseDatos): void {
  mkdirSync(dirname(ruta()), { recursive: true });
  const temporal = `${ruta()}.tmp`;
  writeFileSync(temporal, JSON.stringify(db, null, 2), "utf8");
  renameSync(temporal, ruta()); // escritura atómica: no deja el archivo a medias
}

export function crearPedido(
  cliente: Cliente,
  nombreArchivo: string,
  lectura: ResultadoLectura,
  r: ResultadoValidacion,
): Pedido {
  const db = leer();
  db.secuencia += 1;
  const ahora = new Date().toISOString();
  const estado: EstadoPedido = r.valido ? "por_aprobar" : "borrador";
  const pedido: Pedido = {
    codigo: `PSC-${new Date().getFullYear()}-${String(db.secuencia).padStart(5, "0")}`,
    creadoEn: ahora,
    estado,
    historial: [{ estado, fecha: ahora }],
    mensajes: [],
    cliente,
    archivo: { nombre: nombreArchivo, filasTotal: lectura.filas.length },
    mapaColumnas: lectura.mapaColumnas,
    resumen: r.resumen,
    prendas: r.prendas,
    hallazgos: r.hallazgos,
  };
  db.pedidos.push(pedido);
  guardar(db);
  return pedido;
}

export type ResultadoCambio =
  | { ok: true; pedido: Pedido }
  | { ok: false; status: 404 | 409; error: string };

/** Avanza el pedido al estado indicado, solo si es el siguiente permitido. */
export function cambiarEstado(codigo: string, nuevo: EstadoPedido): ResultadoCambio {
  const db = leer();
  const pedido = db.pedidos.find((p) => p.codigo === codigo);
  if (!pedido) return { ok: false, status: 404, error: "No existe ese pedido." };
  if (pedido.estado === nuevo) return { ok: false, status: 409, error: `El pedido ya está en "${ETIQUETA_ESTADO[nuevo]}".` };
  if (pedido.estado === "borrador") {
    return { ok: false, status: 409, error: "El archivo tiene errores: corrígelos y crea el pedido de nuevo antes de avanzarlo." };
  }
  const permitido = SIGUIENTE_ESTADO[pedido.estado];
  if (!permitido) return { ok: false, status: 409, error: "El pedido ya está finalizado." };
  if (permitido !== nuevo) {
    return { ok: false, status: 409, error: `Desde "${ETIQUETA_ESTADO[pedido.estado]}" solo puedes pasar a "${ETIQUETA_ESTADO[permitido]}".` };
  }
  pedido.estado = nuevo;
  pedido.historial.push({ estado: nuevo, fecha: new Date().toISOString() });
  guardar(db);
  return { ok: true, pedido };
}

export function registrarMensaje(codigo: string, mensaje: Aviso): void {
  const db = leer();
  const pedido = db.pedidos.find((p) => p.codigo === codigo);
  if (!pedido) return;
  pedido.mensajes.push(mensaje);
  guardar(db);
}

export function listarPedidos(): PedidoResumen[] {
  return leer()
    .pedidos.map((p) => ({
      codigo: p.codigo,
      creadoEn: p.creadoEn,
      estado: p.estado,
      organizacion: p.cliente.organizacion,
      contacto: p.cliente.contacto,
      prendas: p.prendas.length,
      errores: p.hallazgos.filter((h) => h.severidad === "error").length,
    }))
    .reverse(); // más recientes primero
}

export function obtenerPedido(codigo: string): Pedido | undefined {
  return leer().pedidos.find((p) => p.codigo === codigo);
}

export function eliminarPedido(codigo: string): boolean {
  const db = leer();
  const antes = db.pedidos.length;
  db.pedidos = db.pedidos.filter((p) => p.codigo !== codigo);
  if (db.pedidos.length === antes) return false;
  guardar(db);
  return true;
}
