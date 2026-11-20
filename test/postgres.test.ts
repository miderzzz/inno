import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import {
  cambiarEstado, crearPedido, eliminarPedido, listarPedidos, modoAlmacen, obtenerPedido, registrarMensaje, usarBaseDatos, type Aviso,
} from "../src/almacen.js";
import { validarCliente } from "../src/cliente.js";
import { mapearTabla } from "../src/lector.js";
import { validarPedido } from "../src/validador.js";

let db: PGlite;
before(async () => {
  db = new PGlite();
  usarBaseDatos(db);
});
after(async () => {
  usarBaseDatos(null);
  await db.close();
});

async function nuevo(filas: string[][]) {
  const c = validarCliente({ organizacion: "Club Tigres", tipo: "club", contacto: "Ana Ruiz", email: "ana@tigres.co" });
  if (!c.ok) throw new Error();
  const lectura = mapearTabla([["Nombre", "Número", "Talla"], ...filas]);
  return crearPedido(c.cliente, "lista.csv", lectura, validarPedido(lectura));
}

test("Postgres: crea la tabla sola, numera, guarda y lista con el resumen", async () => {
  assert.equal(modoAlmacen(), "postgres");
  const a = await nuevo([["Juan", "10", "M"], ["Luis", "7", "S"]]);
  const b = await nuevo([["Pedro", "11", "XXXXL"]]);
  assert.match(a.codigo, /^PSC-\d{4}-00001$/);
  assert.match(b.codigo, /^PSC-\d{4}-00002$/);
  const lista = await listarPedidos();
  assert.deepEqual(lista.map((p) => [p.codigo, p.estado, p.prendas, p.errores, p.organizacion]), [
    [b.codigo, "borrador", 0, 1, "Club Tigres"],
    [a.codigo, "por_aprobar", 2, 0, "Club Tigres"],
  ]);
  assert.equal((await obtenerPedido(a.codigo))?.prendas.length, 2);
  const tabla = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM app_pedidos");
  assert.equal(tabla.rows[0].n, 2);
});

test("Postgres: estados, avisos y eliminación", async () => {
  const p = await nuevo([["Eva", "9", "M"]]);
  const r = await cambiarEstado(p.codigo, "en_produccion");
  assert.ok(r.ok);
  const aviso: Aviso = { id: "x", canal: "correo", fecha: new Date().toISOString(), paraEstado: "en_produccion", para: "ana@tigres.co", texto: "t", resultado: "simulado" };
  await registrarMensaje(p.codigo, aviso);
  await registrarMensaje(p.codigo, { ...aviso, id: "y", canal: "whatsapp" });
  const guardado = await obtenerPedido(p.codigo);
  assert.equal(guardado?.estado, "en_produccion");
  assert.deepEqual(guardado?.mensajes.map((m) => m.id), ["x", "y"]);
  assert.deepEqual(guardado?.historial.map((h) => h.estado), ["por_aprobar", "en_produccion"]);
  const salto = await cambiarEstado(p.codigo, "en_produccion");
  assert.ok(!salto.ok && salto.status === 409);
  assert.equal(await eliminarPedido(p.codigo), true);
  assert.equal(await eliminarPedido(p.codigo), false);
  assert.equal(await obtenerPedido(p.codigo), undefined);
});

test("Postgres: dos personas avanzando el mismo pedido a la vez, solo una gana", async () => {
  const p = await nuevo([["Eva", "9", "M"]]);
  const [x, y] = await Promise.all([cambiarEstado(p.codigo, "en_produccion"), cambiarEstado(p.codigo, "en_produccion")]);
  assert.equal([x, y].filter((r) => r.ok).length, 1);
  assert.equal((await obtenerPedido(p.codigo))?.historial.length, 2);
});
