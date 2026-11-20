import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SMTPServer } from "smtp-server";
import { simpleParser, type ParsedMail } from "mailparser";
import { crearPedido, type Pedido } from "../src/almacen.js";
import { validarCliente } from "../src/cliente.js";
import { mapearTabla } from "../src/lector.js";
import { validarPedido } from "../src/validador.js";
import { contenidoCorreo, enviarCorreo, modoCorreo } from "../src/correo.js";

const base = { organizacion: "Colegio San José", tipo: "colegio", contacto: "Ana Ruiz", email: "ana@sj.co", whatsapp: "", aceptaWhatsapp: "no" };

async function nuevoPedido(extra: Record<string, unknown> = {}): Promise<Pedido> {
  const c = validarCliente({ ...base, ...extra });
  if (!c.ok) throw new Error("cliente inválido en la prueba");
  const lectura = mapearTabla([["Nombre", "Número", "Talla"], ["Juan", "10", "M"], ["Luis", "7", "M"], ["Eva", "9", "S"]]);
  return crearPedido(c.cliente, "lista.xlsx", lectura, validarPedido(lectura));
}

const ENTORNO = ["CORREO_USUARIO", "CORREO_CLAVE", "CORREO_SERVIDOR", "CORREO_PUERTO", "CORREO_NOMBRE", "CORREO_PIE", "CORREO_COPIA"];
beforeEach(() => {
  process.env.PSC_DATA = join(mkdtempSync(join(tmpdir(), "psc-")), "pedidos.json");
  ENTORNO.forEach((k) => delete process.env[k]);
});
afterEach(() => ENTORNO.forEach((k) => delete process.env[k]));

interface Recibido { usuario?: string; clave?: string; remitente: string; destinatarios: string[]; correo: ParsedMail }

/** Servidor SMTP falso en 127.0.0.1 (sin TLS, solo para pruebas). */
async function conSmtp(aceptar: boolean, prueba: (recibidos: Recibido[]) => Promise<void>) {
  const recibidos: Recibido[] = [];
  let credenciales: { usuario?: string; clave?: string } = {};
  const servidor = new SMTPServer({
    authOptional: false,
    allowInsecureAuth: true,
    disabledCommands: ["STARTTLS"],
    onAuth(auth, _s, cb) {
      credenciales = { usuario: auth.username, clave: auth.password ?? undefined };
      if (!aceptar) return cb(Object.assign(new Error("535 5.7.8 Username and Password not accepted"), { responseCode: 535 }));
      cb(null, { user: auth.username });
    },
    onData(stream, sesion, cb) {
      simpleParser(stream).then((correo) => {
        recibidos.push({ ...credenciales, remitente: sesion.envelope.mailFrom ? sesion.envelope.mailFrom.address : "", destinatarios: sesion.envelope.rcptTo.map((r) => r.address), correo });
        cb();
      });
    },
  });
  await new Promise<void>((ok) => servidor.listen(0, "127.0.0.1", ok));
  const { port } = (servidor.server.address() as { port: number });
  process.env.CORREO_USUARIO = "amiderosespana@gmail.com";
  process.env.CORREO_CLAVE = "abcd efgh ijkl mnop";
  process.env.CORREO_SERVIDOR = "127.0.0.1";
  process.env.CORREO_PUERTO = String(port);
  try {
    await prueba(recibidos);
  } finally {
    await new Promise<void>((ok) => servidor.close(() => ok()));
  }
}

test("sin credenciales el modo es simulación y no sale nada", async () => {
  assert.equal(modoCorreo(), "simulado");
  const a = await enviarCorreo(await nuevoPedido(), "en_produccion");
  assert.equal(a?.canal, "correo");
  assert.equal(a?.resultado, "simulado");
  assert.equal(a?.para, "ana@sj.co");
  assert.match(a!.texto, /Asunto: Pedido PSC-.* En producción \| SPORT CHAMPION/);
});

test("el correo de cada estado trae asunto, resumen y pie", async () => {
  const p = await nuevoPedido();
  for (const e of ["por_aprobar", "en_produccion", "finalizado"] as const) {
    const c = contenidoCorreo(p, e)!;
    assert.ok(c.asunto.includes(p.codigo));
    assert.match(c.texto, /Colegio San José/);
    assert.match(c.texto, /M × 2, S × 1/);
    assert.match(c.html, /A tu servicio/);
  }
  assert.match(contenidoCorreo(p, "por_aprobar")!.texto, /responde a este correo/);
  assert.equal(contenidoCorreo(p, "borrador"), null);
});

test("sin correo del cliente se omite", async () => {
  const p = await nuevoPedido();
  p.cliente.email = "";
  const a = await enviarCorreo(p, "en_produccion");
  assert.equal(a?.resultado, "omitido");
});

test("modo real: autentica, envía a la dirección del cliente con copia oculta", async () => {
  process.env.CORREO_COPIA = "amiderosespana@gmail.com";
  await conSmtp(true, async (recibidos) => {
    assert.equal(modoCorreo(), "real");
    const p = await nuevoPedido();
    const a = await enviarCorreo(p, "en_produccion");
    assert.equal(a?.resultado, "enviado", a?.detalle);
    assert.equal(recibidos.length, 1);
    const r = recibidos[0];
    assert.equal(r.usuario, "amiderosespana@gmail.com");
    assert.equal(r.clave, "abcdefghijklmnop"); // sin los espacios de la clave de Google
    assert.deepEqual(r.destinatarios.sort(), ["amiderosespana@gmail.com", "ana@sj.co"]);
    assert.equal(r.correo.from?.value[0].name, "SPORT CHAMPION");
    assert.equal(r.correo.from?.value[0].address, "amiderosespana@gmail.com");
    assert.equal(r.correo.to && "value" in r.correo.to ? r.correo.to.value[0].address : "", "ana@sj.co");
    assert.equal(r.correo.replyTo?.value[0].address, "amiderosespana@gmail.com");
    assert.equal(r.correo.subject, `Pedido ${p.codigo} · En producción | SPORT CHAMPION`);
    assert.match(r.correo.text ?? "", /ya está en producción/);
    assert.match(String(r.correo.html), /A tu servicio/);
    assert.ok(!JSON.stringify(a).includes("abcdefgh")); // la clave nunca se guarda
  });
});

test("sin CORREO_COPIA solo le llega al cliente", async () => {
  await conSmtp(true, async (recibidos) => {
    await enviarCorreo(await nuevoPedido(), "finalizado");
    assert.deepEqual(recibidos[0].destinatarios, ["ana@sj.co"]);
  });
});

test("el HTML escapa lo que escribe el cliente", async () => {
  const c = contenidoCorreo(await nuevoPedido({ organizacion: "<script>alert(1)</script> & Cía" }), "por_aprobar")!;
  assert.ok(!c.html.includes("<script>"));
  assert.match(c.html, /&lt;script&gt;/);
});

test("clave rechazada: queda 'fallido' con un mensaje claro y no lanza", async () => {
  await conSmtp(false, async () => {
    const a = await enviarCorreo(await nuevoPedido(), "en_produccion");
    assert.equal(a?.resultado, "fallido");
    assert.match(a!.detalle ?? "", /contraseña de aplicación/);
  });
});

test("sin conexión al servidor: 'fallido', no lanza", async () => {
  process.env.CORREO_USUARIO = "x@y.co";
  process.env.CORREO_CLAVE = "clave";
  process.env.CORREO_SERVIDOR = "127.0.0.1";
  process.env.CORREO_PUERTO = "1"; // nadie escucha
  const a = await enviarCorreo(await nuevoPedido(), "en_produccion");
  assert.equal(a?.resultado, "fallido");
});

test("lee correo-config.bat aunque se arranque con npm run server", async () => {
  const { leerArchivoSet, cargarConfigLocal } = await import("../src/config-local.js");
  const bat = "@echo off\r\nrem comentario\r\nset CORREO_USUARIO=amiderosespana@gmail.com\r\nset CORREO_CLAVE=abcd efgh ijkl mnop \r\nset CORREO_NOMBRE=SPORT CHAMPION\r\nset \"CORREO_PIE=A tu servicio\"\r\n";
  assert.deepEqual(leerArchivoSet(bat), { CORREO_USUARIO: "amiderosespana@gmail.com", CORREO_CLAVE: "abcd efgh ijkl mnop", CORREO_NOMBRE: "SPORT CHAMPION", CORREO_PIE: "A tu servicio" });
  const dir = mkdtempSync(join(tmpdir(), "cfg-"));
  const { writeFileSync } = await import("node:fs");
  writeFileSync(join(dir, "correo-config.bat"), bat);
  const r = cargarConfigLocal(dir);
  assert.equal(modoCorreo(), "real");
  assert.ok(r[0].cargadas.includes("CORREO_CLAVE"));
  writeFileSync(join(dir, "correo-config.bat"), "set CORREO_USUARIO=x@y.co\r\nset CORREO_CLAVE=PEGA-AQUI-LA-CONTRASENA-DE-APLICACION\r\n");
  delete process.env.CORREO_CLAVE; delete process.env.CORREO_USUARIO;
  const r2 = cargarConfigLocal(dir);
  assert.equal(modoCorreo(), "simulado");
  assert.match(r2[0].avisos.join(" "), /CORREO_CLAVE no tiene valor/);
});
