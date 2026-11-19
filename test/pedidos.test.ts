import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validarCliente, normalizarWhatsapp } from "../src/cliente.js";
import { crearPedido, eliminarPedido, listarPedidos, obtenerPedido } from "../src/almacen.js";
import { mapearTabla } from "../src/lector.js";
import { validarPedido } from "../src/validador.js";

const clienteOk = { organizacion: "Colegio San José", tipo: "colegio", nit: "900.123.456-7", contacto: "Ana Ruiz", email: "ANA@colegio.edu.co", whatsapp: "300 123 4567" };

beforeEach(() => {
  process.env.PSC_DATA = join(mkdtempSync(join(tmpdir(), "psc-")), "pedidos.json");
});

function nuevoPedido(filas: string[][]) {
  const cliente = validarCliente(clienteOk);
  assert.equal(cliente.ok, true);
  if (!cliente.ok) throw new Error();
  const lectura = mapearTabla([["Nombre", "Número", "Talla"], ...filas]);
  return crearPedido(cliente.cliente, "lista.xlsx", lectura, validarPedido(lectura));
}

test("normaliza el cliente: correo en minúsculas y WhatsApp con +57", () => {
  const r = validarCliente(clienteOk);
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.cliente.email, "ana@colegio.edu.co");
    assert.equal(r.cliente.whatsapp, "+573001234567");
  }
});

test("rechaza cliente sin organización, con correo malo o WhatsApp inválido", () => {
  const r = validarCliente({ ...clienteOk, organizacion: "", email: "ana@", whatsapp: "123" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.deepEqual(Object.keys(r.errores).sort(), ["email", "organizacion", "whatsapp"]);
});

test("WhatsApp: vacío es válido, internacional se respeta", () => {
  assert.equal(normalizarWhatsapp(""), "");
  assert.equal(normalizarWhatsapp("+1 (305) 555-0100"), "+13055550100");
  assert.equal(normalizarWhatsapp("abc"), null);
});

test("crea pedidos con código consecutivo y estado según la validación", () => {
  const a = nuevoPedido([["Juan", "10", "M"]]);
  const b = nuevoPedido([["Pedro", "10", "XXXXL"]]);
  assert.match(a.codigo, /^PSC-\d{4}-00001$/);
  assert.match(b.codigo, /^PSC-\d{4}-00002$/);
  assert.equal(a.estado, "por_aprobar");
  assert.equal(b.estado, "borrador");
});

test("lista (recientes primero), consulta y elimina", () => {
  const a = nuevoPedido([["Juan", "10", "M"]]);
  const b = nuevoPedido([["Pedro", "11", "L"]]);
  assert.deepEqual(listarPedidos().map((p) => p.codigo), [b.codigo, a.codigo]);
  assert.equal(obtenerPedido(a.codigo)?.cliente.organizacion, "Colegio San José");
  assert.equal(eliminarPedido(a.codigo), true);
  assert.equal(eliminarPedido(a.codigo), false);
  assert.equal(listarPedidos().length, 1);
});
