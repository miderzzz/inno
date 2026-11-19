/**
 * API + pantalla web. En la arquitectura final esto vive en controladores
 * de NestJS; aquí se usa Express para que el ejemplo corra solo.
 *
 *   GET    /                       pantalla web
 *   POST   /api/pedidos            crea un pedido (archivo; el cliente viene en el archivo y/o el formulario)
 *   GET    /api/pedidos            lista de pedidos
 *   GET    /api/pedidos/:codigo    detalle de un pedido
 *   PATCH  /api/pedidos/:codigo/estado   avanza el estado y avisa por WhatsApp y correo
 *   POST   /api/pedidos/:codigo/avisos   reenvía el aviso del estado actual
 *   GET    /api/canales            modo de WhatsApp y de correo (real o simulado)
 *   DELETE /api/pedidos/:codigo    elimina un pedido
 *   POST   /api/pedidos/validar    solo lee y valida el archivo (devuelve también los datos del cliente)
 */
import { readFileSync } from "node:fs";
import express from "express";
import multer from "multer";
import {
  cambiarEstado, crearPedido, eliminarPedido, ETIQUETA_ESTADO, listarPedidos, obtenerPedido, registrarMensaje,
  type EstadoPedido, type Pedido,
} from "./almacen.js";
import { combinarCliente, validarCliente } from "./cliente.js";
import { ErrorArchivo, leerHojaDeCalculo } from "./lector.js";
import { validarPedido } from "./validador.js";
import { enviarCorreo, modoCorreo } from "./correo.js";
import { enviarAviso, modoWhatsapp } from "./whatsapp.js";

const MAX_MB = 5;
const subida = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, /\.(xlsx|csv)$/i.test(file.originalname)),
});

const PAGINA = readFileSync(new URL("./public/index.html", import.meta.url), "utf8");
const MSG_ARCHIVO = `Adjunta un archivo .xlsx o .csv de máximo ${MAX_MB} MB en el campo "archivo".`;

const app = express();
app.use(express.json());

/** Avisa por WhatsApp y por correo, deja ambos intentos registrados en el pedido y lo devuelve al día. */
async function notificar(pedido: Pedido, estado: EstadoPedido): Promise<Pedido> {
  const avisos = await Promise.all([enviarAviso(pedido, estado), enviarCorreo(pedido, estado)]);
  for (const aviso of avisos) if (aviso) registrarMensaje(pedido.codigo, aviso);
  return obtenerPedido(pedido.codigo) ?? pedido;
}

app.get("/", (_req, res) => {
  res.type("html").send(PAGINA);
});

// ---- Crear pedido: datos del cliente + archivo --------------------------
app.post("/api/pedidos", subida.single("archivo"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: MSG_ARCHIVO });
    return;
  }
  try {
    const lectura = await leerHojaDeCalculo(req.file.buffer, req.file.originalname);
    // Los datos del cliente pueden venir en el archivo, en el formulario o en ambos.
    const cliente = validarCliente(combinarCliente(lectura.datosCliente, req.body ?? {}));
    if (!cliente.ok) {
      res.status(400).json({
        error: "Faltan datos del cliente: complétalos en el formulario o en el bloque superior del archivo.",
        errores: cliente.errores,
      });
      return;
    }
    const resultado = validarPedido(lectura);
    const pedido = crearPedido(cliente.cliente, req.file.originalname, lectura, resultado);
    res.status(201).json(await notificar(pedido, pedido.estado)); // por_aprobar avisa; borrador no
  } catch (e) {
    if (e instanceof ErrorArchivo) {
      res.status(400).json({ error: e.message });
      return;
    }
    console.error(e);
    res.status(500).json({ error: "Error inesperado procesando el archivo." });
  }
});

app.get("/api/pedidos", (_req, res) => {
  res.json(listarPedidos());
});

app.get("/api/pedidos/:codigo", (req, res) => {
  const pedido = obtenerPedido(req.params.codigo);
  if (!pedido) {
    res.status(404).json({ error: "No existe ese pedido." });
    return;
  }
  res.json(pedido);
});

app.patch("/api/pedidos/:codigo/estado", async (req, res) => {
  const nuevo = String(req.body?.estado ?? "") as EstadoPedido;
  if (!(["por_aprobar", "en_produccion", "finalizado"] as string[]).includes(nuevo)) {
    res.status(400).json({ error: `Estado no válido. Usa: ${Object.keys(ETIQUETA_ESTADO).slice(1).join(", ")}.` });
    return;
  }
  const cambio = cambiarEstado(req.params.codigo, nuevo);
  if (!cambio.ok) {
    res.status(cambio.status).json({ error: cambio.error });
    return;
  }
  res.json(await notificar(cambio.pedido, nuevo));
});

app.post("/api/pedidos/:codigo/avisos", async (req, res) => {
  const pedido = obtenerPedido(req.params.codigo);
  if (!pedido) {
    res.status(404).json({ error: "No existe ese pedido." });
    return;
  }
  if (pedido.estado === "borrador") {
    res.status(409).json({ error: "Un pedido con errores no genera avisos." });
    return;
  }
  res.json(await notificar(pedido, pedido.estado));
});

app.get("/api/canales", (_req, res) => {
  res.json({ whatsapp: modoWhatsapp(), correo: modoCorreo() });
});

app.delete("/api/pedidos/:codigo", (req, res) => {
  if (!eliminarPedido(req.params.codigo)) {
    res.status(404).json({ error: "No existe ese pedido." });
    return;
  }
  res.status(204).end();
});

// ---- Solo validar (sin guardar) -------------------------------------------
app.post("/api/pedidos/validar", subida.single("archivo"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: MSG_ARCHIVO });
    return;
  }
  try {
    const lectura = await leerHojaDeCalculo(req.file.buffer, req.file.originalname);
    const resultado = validarPedido(lectura);
    res.status(resultado.valido ? 200 : 422).json({
      datosCliente: lectura.datosCliente,
      mapaColumnas: lectura.mapaColumnas,
      columnasIgnoradas: lectura.columnasIgnoradas,
      ...resultado,
    });
  } catch (e) {
    if (e instanceof ErrorArchivo) {
      res.status(400).json({ error: e.message });
      return;
    }
    console.error(e);
    res.status(500).json({ error: "Error inesperado procesando el archivo." });
  }
});

const puerto = Number(process.env.PORT ?? 3000);
app.listen(puerto, () => console.log(`Pedido Seguro en http://localhost:${puerto}`));
