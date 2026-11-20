/**
 * Almacén de pedidos, con dos motores:
 *   - PostgreSQL (Neon en Vercel) si existe DATABASE_URL o POSTGRES_URL.
 *   - Archivo JSON local (data/pedidos.json) si no: para usar la app en el computador sin instalar nada.
 * En Vercel el disco no se conserva, así que allí la base de datos es obligatoria.
 *
 * En Postgres cada pedido se guarda completo como JSON en la tabla app_pedidos
 * (schema.sql describe el modelo relacional de la arquitectura final).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import pg from "pg";
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

// =====================================================================
//  Motores
// =====================================================================

/** Lo mínimo que se necesita de un cliente SQL (lo cumplen pg.Pool y PGlite). */
export interface ClienteSql {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

interface Motor {
  insertar(armar: (numero: number) => Pedido): Promise<Pedido>;
  obtener(codigo: string): Promise<Pedido | undefined>;
  /** Guarda el pedido solo si su estado sigue siendo `estadoAnterior`. Devuelve false si alguien lo cambió antes. */
  guardarSiEstado(p: Pedido, estadoAnterior: EstadoPedido): Promise<boolean>;
  agregarAviso(codigo: string, aviso: Aviso): Promise<void>;
  listar(): Promise<PedidoResumen[]>;
  eliminar(codigo: string): Promise<boolean>;
}

/** Ajustes para pedidos guardados por versiones anteriores. */
function migrar(p: Pedido): Pedido {
  if ((p.estado as string) === "validado") p.estado = "por_aprobar";
  p.historial ??= [{ estado: p.estado, fecha: p.creadoEn }];
  p.mensajes ??= [];
  for (const m of p.mensajes) m.canal ??= "whatsapp"; // las versiones anteriores solo avisaban por WhatsApp
  p.cliente.aceptaWhatsapp ??= false;
  return p;
}

const resumir = (p: Pedido): PedidoResumen => ({
  codigo: p.codigo,
  creadoEn: p.creadoEn,
  estado: p.estado,
  organizacion: p.cliente.organizacion,
  contacto: p.cliente.contacto,
  prendas: p.prendas.length,
  errores: p.hallazgos.filter((h) => h.severidad === "error").length,
});

// ---- Archivo JSON local ----------------------------------------------------
interface BaseDatos {
  secuencia: number;
  pedidos: Pedido[];
}

function motorArchivo(): Motor {
  const ruta = () => process.env.PSC_DATA ?? "data/pedidos.json";
  const leer = (): BaseDatos => {
    if (!existsSync(ruta())) return { secuencia: 0, pedidos: [] };
    const db = JSON.parse(readFileSync(ruta(), "utf8")) as BaseDatos;
    db.pedidos.forEach(migrar);
    return db;
  };
  const guardar = (db: BaseDatos) => {
    mkdirSync(dirname(ruta()), { recursive: true });
    const temporal = `${ruta()}.tmp`;
    writeFileSync(temporal, JSON.stringify(db, null, 2), "utf8");
    renameSync(temporal, ruta()); // escritura atómica: no deja el archivo a medias
  };
  return {
    async insertar(armar) {
      const db = leer();
      db.secuencia += 1;
      const p = armar(db.secuencia);
      db.pedidos.push(p);
      guardar(db);
      return p;
    },
    async obtener(codigo) {
      return leer().pedidos.find((p) => p.codigo === codigo);
    },
    async guardarSiEstado(p, estadoAnterior) {
      const db = leer();
      const i = db.pedidos.findIndex((x) => x.codigo === p.codigo);
      if (i < 0 || db.pedidos[i].estado !== estadoAnterior) return false;
      db.pedidos[i] = p;
      guardar(db);
      return true;
    },
    async agregarAviso(codigo, aviso) {
      const db = leer();
      const p = db.pedidos.find((x) => x.codigo === codigo);
      if (!p) return;
      p.mensajes.push(aviso);
      guardar(db);
    },
    async listar() {
      return leer().pedidos.map(resumir).reverse(); // más recientes primero
    },
    async eliminar(codigo) {
      const db = leer();
      const antes = db.pedidos.length;
      db.pedidos = db.pedidos.filter((p) => p.codigo !== codigo);
      if (db.pedidos.length === antes) return false;
      guardar(db);
      return true;
    },
  };
}

// ---- PostgreSQL ------------------------------------------------------------
const ESQUEMA = `
CREATE SEQUENCE IF NOT EXISTS app_pedidos_numero_seq;
CREATE TABLE IF NOT EXISTS app_pedidos (
  codigo     text PRIMARY KEY,
  numero     bigint NOT NULL,
  estado     text NOT NULL,
  creado_en  timestamptz NOT NULL,
  datos      jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS app_pedidos_estado_idx ON app_pedidos (estado);
`;

export function motorPostgres(db: ClienteSql): Motor {
  let listo: Promise<void> | null = null;
  const preparar = () => {
    // Crea la tabla la primera vez; si falla se reintenta en la siguiente petición.
    listo ??= (async () => {
      for (const sentencia of ESQUEMA.split(";").map((x) => x.trim()).filter(Boolean)) await db.query(sentencia);
    })().catch((e) => {
      listo = null;
      throw e;
    });
    return listo;
  };
  const datos = (fila: { datos: unknown }) => migrar((typeof fila.datos === "string" ? JSON.parse(fila.datos) : fila.datos) as Pedido);

  return {
    async insertar(armar) {
      await preparar();
      const { rows } = await db.query<{ n: string | number }>("SELECT nextval('app_pedidos_numero_seq') AS n");
      const p = armar(Number(rows[0].n));
      await db.query("INSERT INTO app_pedidos (codigo, numero, estado, creado_en, datos) VALUES ($1, $2, $3, $4, $5::jsonb)", [
        p.codigo, Number(rows[0].n), p.estado, p.creadoEn, JSON.stringify(p),
      ]);
      return p;
    },
    async obtener(codigo) {
      await preparar();
      const { rows } = await db.query<{ datos: unknown }>("SELECT datos FROM app_pedidos WHERE codigo = $1", [codigo]);
      return rows[0] ? datos(rows[0]) : undefined;
    },
    async guardarSiEstado(p, estadoAnterior) {
      await preparar();
      const { rows } = await db.query(
        "UPDATE app_pedidos SET estado = $2, datos = $3::jsonb WHERE codigo = $1 AND estado = $4 RETURNING codigo",
        [p.codigo, p.estado, JSON.stringify(p), estadoAnterior],
      );
      return rows.length === 1;
    },
    async agregarAviso(codigo, aviso) {
      await preparar();
      // Se agrega dentro de la base (no se reescribe el pedido) para no pisar cambios hechos al mismo tiempo.
      await db.query(
        "UPDATE app_pedidos SET datos = jsonb_set(datos, '{mensajes}', COALESCE(datos->'mensajes', '[]'::jsonb) || jsonb_build_array($2::jsonb)) WHERE codigo = $1",
        [codigo, JSON.stringify(aviso)],
      );
    },
    async listar() {
      await preparar();
      const { rows } = await db.query<{
        codigo: string; creado_en: Date | string; estado: EstadoPedido; organizacion: string; contacto: string; prendas: number | string; errores: number | string;
      }>(`SELECT codigo, creado_en, estado,
                 datos->'cliente'->>'organizacion' AS organizacion,
                 datos->'cliente'->>'contacto' AS contacto,
                 jsonb_array_length(COALESCE(datos->'prendas', '[]'::jsonb)) AS prendas,
                 (SELECT count(*) FROM jsonb_array_elements(COALESCE(datos->'hallazgos', '[]'::jsonb)) h WHERE h->>'severidad' = 'error') AS errores
            FROM app_pedidos ORDER BY numero DESC`);
      return rows.map((r) => ({
        codigo: r.codigo,
        creadoEn: new Date(r.creado_en).toISOString(),
        estado: r.estado,
        organizacion: r.organizacion,
        contacto: r.contacto,
        prendas: Number(r.prendas),
        errores: Number(r.errores),
      }));
    },
    async eliminar(codigo) {
      await preparar();
      const { rows } = await db.query("DELETE FROM app_pedidos WHERE codigo = $1 RETURNING codigo", [codigo]);
      return rows.length === 1;
    },
  };
}

// ---- Elección del motor -------------------------------------------------
let motorActual: Motor | null = null;
let motorArchivoUnico: Motor | null = null;

export const urlBaseDatos = () => process.env.DATABASE_URL || process.env.POSTGRES_URL || "";

/** "postgres" si se guarda en base de datos; "archivo" si se guarda en data/pedidos.json. */
export function modoAlmacen(): "postgres" | "archivo" {
  if (motorActual) return motorActual === motorArchivoUnico ? "archivo" : "postgres";
  return urlBaseDatos() ? "postgres" : "archivo";
}

/** Solo para pruebas: usar una base de datos concreta (p. ej. PGlite) o volver a la elección automática con null. */
export function usarBaseDatos(db: ClienteSql | null): void {
  motorActual = db ? motorPostgres(db) : null;
}

function motor(): Motor {
  if (motorActual) return motorActual;
  const url = urlBaseDatos();
  if (url) {
    const pool = new pg.Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 10_000 });
    pool.on("error", (e) => console.error("Base de datos:", e.message));
    motorActual = motorPostgres(pool);
    return motorActual;
  }
  if (process.env.VERCEL) {
    throw new Error("Falta conectar la base de datos: en Vercel agrega Neon (Storage) al proyecto para que exista DATABASE_URL, y vuelve a desplegar.");
  }
  motorArchivoUnico ??= motorArchivo();
  motorActual = motorArchivoUnico;
  return motorActual;
}

// =====================================================================
//  Operaciones
// =====================================================================

export async function crearPedido(
  cliente: Cliente,
  nombreArchivo: string,
  lectura: ResultadoLectura,
  r: ResultadoValidacion,
): Promise<Pedido> {
  const ahora = new Date().toISOString();
  const estado: EstadoPedido = r.valido ? "por_aprobar" : "borrador";
  return motor().insertar((numero) => ({
    codigo: `PSC-${new Date().getFullYear()}-${String(numero).padStart(5, "0")}`,
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
  }));
}

export type ResultadoCambio =
  | { ok: true; pedido: Pedido }
  | { ok: false; status: 404 | 409; error: string };

/** Avanza el pedido al estado indicado, solo si es el siguiente permitido. */
export async function cambiarEstado(codigo: string, nuevo: EstadoPedido): Promise<ResultadoCambio> {
  const pedido = await motor().obtener(codigo);
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
  const anterior = pedido.estado;
  pedido.estado = nuevo;
  pedido.historial.push({ estado: nuevo, fecha: new Date().toISOString() });
  if (!(await motor().guardarSiEstado(pedido, anterior))) {
    return { ok: false, status: 409, error: "Otra persona cambió este pedido al mismo tiempo. Recarga la página." };
  }
  return { ok: true, pedido };
}

export async function registrarMensaje(codigo: string, mensaje: Aviso): Promise<void> {
  await motor().agregarAviso(codigo, mensaje);
}

export async function listarPedidos(): Promise<PedidoResumen[]> {
  return motor().listar();
}

export async function obtenerPedido(codigo: string): Promise<Pedido | undefined> {
  return motor().obtener(codigo);
}

export async function eliminarPedido(codigo: string): Promise<boolean> {
  return motor().eliminar(codigo);
}
