import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cambiarEstado, crearPedido, obtenerPedido, registrarMensaje, type Pedido } from "../src/almacen.js";
import { esAfirmativo, validarCliente } from "../src/cliente.js";
import { mapearTabla } from "../src/lector.js";
import { validarPedido } from "../src/validador.js";
import { enviarAviso, modoWhatsapp, textoAviso } from "../src/whatsapp.js";

const base = { organizacion: "Colegio San José", tipo: "colegio", contacto: "Ana Ruiz", email: "ana@sj.co", whatsapp: "300 123 4567", aceptaWhatsapp: "si" };

function nuevoPedido(extra: Record<string, unknown> = {}, filas: string[][] = [["Juan", "10", "M"]]): Pedido {
  const c = validarCliente({ ...base, ...extra });
  if (!c.ok) throw new Error("cliente inválido en la prueba");
  const lectura = mapearTabla([["Nombre", "Número", "Talla"], ...filas]);
  return crearPedido(c.cliente, "lista.xlsx", lectura, validarPedido(lectura));
}

const ENTORNO = ["WHATSAPP_TOKEN", "WHATSAPP_PHONE_ID", "WHATSAPP_API_URL", "WHATSAPP_TEMPLATE_EN_PRODUCCION", "WHATSAPP_LANG"];
beforeEach(() => {
  process.env.PSC_DATA = join(mkdtempSync(join(tmpdir(), "psc-")), "pedidos.json");
  ENTORNO.forEach((k) => delete process.env[k]);
});
afterEach(() => ENTORNO.forEach((k) => delete process.env[k]));

// ---------- Estados ----------
test("un pedido válido nace 'por aprobar' y uno con errores 'borrador'", () => {
  assert.equal(nuevoPedido().estado, "por_aprobar");
  assert.equal(nuevoPedido({}, [["Juan", "10", "XXXXL"]]).estado, "borrador");
});

test("avanza por_aprobar -> en_produccion -> finalizado y guarda el historial", () => {
  const p = nuevoPedido();
  const a = cambiarEstado(p.codigo, "en_produccion");
  assert.ok(a.ok && a.pedido.estado === "en_produccion");
  const b = cambiarEstado(p.codigo, "finalizado");
  assert.ok(b.ok);
  assert.deepEqual(obtenerPedido(p.codigo)?.historial.map((h) => h.estado), ["por_aprobar", "en_produccion", "finalizado"]);
});

test("no permite saltar estados, repetirlos ni avanzar un borrador o un finalizado", () => {
  const p = nuevoPedido();
  const salto = cambiarEstado(p.codigo, "finalizado");
  assert.ok(!salto.ok && salto.status === 409 && /solo puedes pasar a "En producción"/.test(salto.error));
  assert.ok(!cambiarEstado(p.codigo, "por_aprobar").ok);
  cambiarEstado(p.codigo, "en_produccion");
  cambiarEstado(p.codigo, "finalizado");
  const fin = cambiarEstado(p.codigo, "en_produccion");
  assert.ok(!fin.ok && /finalizado/.test(fin.error));

  const borrador = nuevoPedido({}, [["Juan", "10", "XXXXL"]]);
  const r = cambiarEstado(borrador.codigo, "en_produccion");
  assert.ok(!r.ok && /errores/.test(r.error));
  const nada = cambiarEstado("PSC-0000-00000", "en_produccion");
  assert.ok(!nada.ok && nada.status === 404);
});

// ---------- Autorización ----------
test("esAfirmativo entiende Sí, si, yes y rechaza lo demás", () => {
  for (const v of ["Sí", "si", " SI ", "yes", "x", "1", "true"]) assert.equal(esAfirmativo(v), true, v);
  for (const v of ["No", "", "tal vez", "0"]) assert.equal(esAfirmativo(v), false, v);
});

// ---------- Textos ----------
test("cada estado tiene su texto con el código y el nombre; borrador no avisa", () => {
  const p = nuevoPedido();
  assert.match(textoAviso(p, "por_aprobar")!, /Hola Ana.*PSC-\d{4}-00001.*por aprobar/);
  assert.match(textoAviso(p, "en_produccion")!, /en producción/);
  assert.match(textoAviso(p, "finalizado")!, /finalizado/);
  assert.equal(textoAviso(p, "borrador"), null);
});

// ---------- Envío: simulado y omitido ----------
test("sin credenciales el modo es simulado y el aviso queda registrado", async () => {
  assert.equal(modoWhatsapp(), "simulado");
  const p = nuevoPedido();
  const m = await enviarAviso(p, "por_aprobar");
  assert.equal(m?.resultado, "simulado");
  assert.equal(m?.para, "+573001234567");
  registrarMensaje(p.codigo, m!);
  assert.equal(obtenerPedido(p.codigo)?.mensajes.length, 1);
});

test("no envía sin número, sin autorización ni para borradores", async () => {
  const sinNumero = await enviarAviso(nuevoPedido({ whatsapp: "" }), "por_aprobar");
  assert.equal(sinNumero?.resultado, "omitido");
  assert.match(sinNumero!.detalle!, /número/);
  const sinAutorizar = await enviarAviso(nuevoPedido({ aceptaWhatsapp: "no" }), "por_aprobar");
  assert.equal(sinAutorizar?.resultado, "omitido");
  assert.match(sinAutorizar!.detalle!, /autorizado/);
  assert.equal(await enviarAviso(nuevoPedido({}, [["Juan", "10", "XXXXL"]]), "borrador"), null);
});

// ---------- Envío real contra un servidor falso que imita la API de Meta ----------
async function conServidorFalso(
  responder: (cuerpo: any) => { status: number; json: unknown },
  prueba: (url: string, recibidas: { headers: Record<string, unknown>; url?: string; cuerpo: any }[]) => Promise<void>,
) {
  const recibidas: { headers: Record<string, unknown>; url?: string; cuerpo: any }[] = [];
  const servidor: Server = createServer((req, res) => {
    let datos = "";
    req.on("data", (d) => (datos += d));
    req.on("end", () => {
      const cuerpo = JSON.parse(datos);
      recibidas.push({ headers: req.headers, url: req.url, cuerpo });
      const r = responder(cuerpo);
      res.writeHead(r.status, { "Content-Type": "application/json" }).end(JSON.stringify(r.json));
    });
  });
  await new Promise<void>((ok) => servidor.listen(0, "127.0.0.1", ok));
  const { port } = servidor.address() as { port: number };
  process.env.WHATSAPP_TOKEN = "TOKEN_DE_PRUEBA";
  process.env.WHATSAPP_PHONE_ID = "1234567890";
  process.env.WHATSAPP_API_URL = `http://127.0.0.1:${port}/v21.0`;
  try {
    await prueba(process.env.WHATSAPP_API_URL, recibidas);
  } finally {
    await new Promise((ok) => servidor.close(ok));
  }
}

test("modo real con texto libre: manda el POST correcto a la API y guarda el id", async () => {
  await conServidorFalso(() => ({ status: 200, json: { messages: [{ id: "wamid.ABC123" }] } }), async (_url, recibidas) => {
    assert.equal(modoWhatsapp(), "real");
    const m = await enviarAviso(nuevoPedido(), "en_produccion");
    assert.equal(m?.resultado, "enviado");
    assert.equal(m?.detalle, "wamid.ABC123");
    assert.equal(recibidas.length, 1);
    assert.equal(recibidas[0].url, "/v21.0/1234567890/messages");
    assert.equal(recibidas[0].headers.authorization, "Bearer TOKEN_DE_PRUEBA");
    assert.equal(recibidas[0].cuerpo.to, "573001234567"); // solo dígitos, sin "+"
    assert.equal(recibidas[0].cuerpo.type, "text");
    assert.match(recibidas[0].cuerpo.text.body, /en producción/);
  });
});

test("modo real con plantilla: envía el nombre de la plantilla y las 3 variables", async () => {
  process.env.WHATSAPP_TEMPLATE_EN_PRODUCCION = "pedido_en_produccion";
  await conServidorFalso(() => ({ status: 200, json: { messages: [{ id: "wamid.T1" }] } }), async (_u, recibidas) => {
    const p = nuevoPedido();
    const m = await enviarAviso(p, "en_produccion");
    assert.equal(m?.resultado, "enviado");
    const t = recibidas[0].cuerpo;
    assert.equal(t.type, "template");
    assert.equal(t.template.name, "pedido_en_produccion");
    assert.equal(t.template.language.code, "es");
    assert.deepEqual(t.template.components[0].parameters.map((x: any) => x.text), ["Ana", p.codigo, "Colegio San José"]);
  });
});

test("si WhatsApp rechaza el envío, queda 'fallido' con el motivo y no se rompe nada", async () => {
  await conServidorFalso(() => ({ status: 400, json: { error: { message: "Recipient phone number not in allowed list" } } }), async () => {
    const m = await enviarAviso(nuevoPedido(), "finalizado");
    assert.equal(m?.resultado, "fallido");
    assert.match(m!.detalle!, /not in allowed list/);
    assert.ok(!JSON.stringify(m).includes("TOKEN_DE_PRUEBA")); // el token nunca se guarda
  });
});

test("si no hay conexión con WhatsApp, queda 'fallido' sin lanzar error", async () => {
  process.env.WHATSAPP_TOKEN = "x";
  process.env.WHATSAPP_PHONE_ID = "1";
  process.env.WHATSAPP_API_URL = "http://127.0.0.1:1/v21.0"; // nadie escucha ahí
  const m = await enviarAviso(nuevoPedido(), "por_aprobar");
  assert.equal(m?.resultado, "fallido");
});
