/**
 * API + pantalla web. En la arquitectura final esto vive en controladores
 * de NestJS; aquí se usa Express para que el ejemplo corra solo.
 *
 * Corre igual en el computador (npm run server) y en Vercel, que usa el `export default app`.
 *
 *   GET    /                       pantalla web (public/index.html)
 *   GET    /api/sesion             ¿pide contraseña? ¿ya se ingresó?
 *   POST   /api/sesion             ingresar con { clave }
 *   DELETE /api/sesion             salir
 *   POST   /api/pedidos            crea un pedido (archivo; el cliente viene en el archivo y/o el formulario)
 *   GET    /api/pedidos            lista de pedidos
 *   GET    /api/pedidos/:codigo    detalle de un pedido
 *   PATCH  /api/pedidos/:codigo/estado   avanza el estado y avisa por WhatsApp y correo
 *   POST   /api/pedidos/:codigo/avisos   reenvía el aviso del estado actual
 *   GET    /api/canales            modo de WhatsApp y de correo (real o simulado)
 *   DELETE /api/pedidos/:codigo    elimina un pedido
 *   POST   /api/pedidos/validar    solo lee y valida el archivo (devuelve también los datos del cliente)
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import multer from "multer";
import {
  cambiarEstado, crearPedido, eliminarPedido, ETIQUETA_ESTADO, listarPedidos, obtenerPedido, registrarMensaje,
  modoAlmacen, type EstadoPedido, type Pedido,
} from "./almacen.js";
import { accesoProtegido, estadoSesion, exigirSesion, ingresar, salir } from "./acceso.js";
import { combinarCliente, validarCliente } from "./cliente.js";
import { ErrorArchivo, leerHojaDeCalculo } from "./lector.js";
import { validarPedido } from "./validador.js";
import { enviarCorreo, modoCorreo } from "./correo.js";
import { enviarAviso, modoWhatsapp } from "./whatsapp.js";
import { cargarConfigLocal } from "./config-local.js";

// En el computador lee correo-config.bat y whatsapp-config.bat. En Vercel las claves van en Environment Variables.
const cargaLocal = process.env.VERCEL ? [] : cargarConfigLocal();

const MAX_MB = 4; // Vercel acepta peticiones de hasta 4.5 MB
const subida = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, /\.(xlsx|csv)$/i.test(file.originalname)),
});

/** Busca public/index.html (en Vercel, además, la sirve directamente su CDN). */
function leerPagina(): string | null {
  const candidatos = [join(process.cwd(), "public", "index.html"), fileURLToPath(new URL("../public/index.html", import.meta.url))];
  const ruta = candidatos.find((r) => existsSync(r));
  return ruta ? readFileSync(ruta, "utf8") : null;
}
let pagina: string | null = null;
const MSG_ARCHIVO = `Adjunta un archivo .xlsx o .csv de máximo ${MAX_MB} MB en el campo "archivo".`;

/** Express 4 no atrapa errores de funciones async: esto los manda al manejador de errores. */
const asincrono =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

const app = express();
app.set("trust proxy", true);
app.use(express.json());

/** Avisa por WhatsApp y por correo, deja ambos intentos registrados en el pedido y lo devuelve al día. */
async function notificar(pedido: Pedido, estado: EstadoPedido): Promise<Pedido> {
  const avisos = await Promise.all([enviarAviso(pedido, estado), enviarCorreo(pedido, estado)]);
  for (const aviso of avisos) if (aviso) await registrarMensaje(pedido.codigo, aviso);
  return (await obtenerPedido(pedido.codigo)) ?? pedido;
}

app.get(["/", "/index.html"], (_req, res) => {
  pagina ??= leerPagina();
  if (pagina) res.type("html").send(pagina);
  else res.status(500).send("No se encontró public/index.html.");
});

// ---- Acceso ----------------------------------------------------------------
app.get("/api/sesion", estadoSesion);
app.post("/api/sesion", ingresar);
app.delete("/api/sesion", salir);
app.use("/api", exigirSesion); // todo lo de abajo exige haber ingresado

// ---- Crear pedido: datos del cliente + archivo --------------------------
app.post("/api/pedidos", subida.single("archivo"), asincrono(async (req, res) => {
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
    const pedido = await crearPedido(cliente.cliente, req.file.originalname, lectura, resultado);
    res.status(201).json(await notificar(pedido, pedido.estado)); // por_aprobar avisa; borrador no
  } catch (e) {
    if (e instanceof ErrorArchivo) {
      res.status(400).json({ error: e.message });
      return;
    }
    throw e;
  }
}));

app.get("/api/pedidos", asincrono(async (_req, res) => {
  res.json(await listarPedidos());
}));

app.get("/api/pedidos/:codigo", asincrono(async (req, res) => {
  const pedido = await obtenerPedido(String(req.params.codigo));
  if (!pedido) {
    res.status(404).json({ error: "No existe ese pedido." });
    return;
  }
  res.json(pedido);
}));

app.patch("/api/pedidos/:codigo/estado", asincrono(async (req, res) => {
  const nuevo = String(req.body?.estado ?? "") as EstadoPedido;
  if (!(["por_aprobar", "en_produccion", "finalizado"] as string[]).includes(nuevo)) {
    res.status(400).json({ error: `Estado no válido. Usa: ${Object.keys(ETIQUETA_ESTADO).slice(1).join(", ")}.` });
    return;
  }
  const cambio = await cambiarEstado(String(req.params.codigo), nuevo);
  if (!cambio.ok) {
    res.status(cambio.status).json({ error: cambio.error });
    return;
  }
  res.json(await notificar(cambio.pedido, nuevo));
}));

app.post("/api/pedidos/:codigo/avisos", asincrono(async (req, res) => {
  const pedido = await obtenerPedido(String(req.params.codigo));
  if (!pedido) {
    res.status(404).json({ error: "No existe ese pedido." });
    return;
  }
  if (pedido.estado === "borrador") {
    res.status(409).json({ error: "Un pedido con errores no genera avisos." });
    return;
  }
  res.json(await notificar(pedido, pedido.estado));
}));

app.get("/api/canales", (_req, res) => {
  res.json({ whatsapp: modoWhatsapp(), correo: modoCorreo() });
});

app.delete("/api/pedidos/:codigo", asincrono(async (req, res) => {
  if (!(await eliminarPedido(String(req.params.codigo)))) {
    res.status(404).json({ error: "No existe ese pedido." });
    return;
  }
  res.status(204).end();
}));

// ---- Solo validar (sin guardar) -------------------------------------------
app.post("/api/pedidos/validar", subida.single("archivo"), asincrono(async (req, res) => {
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
    throw e;
  }
}));

// ---- Errores no previstos (base de datos caída, etc.) ----------------------
app.use((e: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) return;
  if (e instanceof multer.MulterError) {
    res.status(400).json({ error: e.code === "LIMIT_FILE_SIZE" ? `El archivo pesa más de ${MAX_MB} MB.` : MSG_ARCHIVO });
    return;
  }
  console.error(e);
  const sinBase = e.message.startsWith("Falta conectar la base de datos");
  res.status(sinBase ? 503 : 500).json({ error: sinBase ? e.message : "Error inesperado en el servidor. Revisa los registros (logs)." });
});

export default app;

// En Vercel no se abre un puerto: Vercel usa el `export default app`.
// Tampoco cuando otro archivo importa este (pruebas): solo al ejecutarlo directamente.
const esPrincipal = Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (!process.env.VERCEL && esPrincipal) iniciarLocal();

function iniciarLocal() {
  const puerto = Number(process.env.PORT ?? 3000);
  const servidor = app.listen(puerto, () => {
    console.log(`Pedido Seguro en http://localhost:${puerto}`);
    for (const c of cargaLocal) {
      if (c.existe) console.log(`  ${c.archivo}: ${c.cargadas.length ? "cargado" : "sin datos útiles"}`);
      c.avisos.forEach((a) => console.log(`  ATENCIÓN: ${a}`));
    }
    const correo = modoCorreo();
    console.log(`  Correo:   ${correo === "real" ? `REAL (envía desde ${process.env.CORREO_USUARIO})` : "simulación (falta CORREO_USUARIO o CORREO_CLAVE en correo-config.bat)"}`);
    console.log(`  WhatsApp: ${modoWhatsapp() === "real" ? "REAL" : "simulación"}`);
    console.log(`  Pedidos:  ${modoAlmacen() === "postgres" ? "base de datos Postgres (DATABASE_URL)" : "archivo data/pedidos.json"}`);
    console.log(`  Acceso:   ${accesoProtegido() ? "con contraseña (APP_CLAVE)" : "abierto, sin contraseña"}`);
  });
  servidor.on("error", (e: NodeJS.ErrnoException) => {
    if (e.code === "EADDRINUSE") {
      console.error(`\nEl puerto ${puerto} ya está ocupado: la app ya está abierta en otra ventana o terminal.`);
      console.error("Ciérrala (o presiona Ctrl+C en ella) y vuelve a arrancar. Si no la encuentras, en PowerShell:");
      console.error(`  Get-NetTCPConnection -LocalPort ${puerto} -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }\n`);
      process.exit(1);
    }
    throw e;
  });
}
