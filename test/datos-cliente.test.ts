import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { leerHojaDeCalculo, mapearTabla } from "../src/lector.js";
import { combinarCliente, validarCliente } from "../src/cliente.js";
import { validarPedido } from "../src/validador.js";

const leer = async (nombre: string) => leerHojaDeCalculo(await readFile(`ejemplos/${nombre}`), nombre);

test("lee el bloque del cliente que va encima de la tabla", () => {
  const l = mapearTabla([
    ["Organización:", "Colegio Sol"], ["Tipo", "colegio"], ["Contacto", "Ana"], ["Correo", "a@sol.co"],
    [], ["Nombre", "Número", "Talla"], ["Juan", "10", "M"],
  ]);
  assert.deepEqual(l.datosCliente, { organizacion: "Colegio Sol", tipo: "colegio", contacto: "Ana", email: "a@sol.co" });
  assert.equal(l.filas.length, 1); // el bloque del cliente no se cuenta como prendas
});

test("acepta etiquetas alternativas y ignora las que no tienen valor", () => {
  const l = mapearTabla([
    ["Cliente", "Club Tigres"], ["Persona de contacto", "Luis"], ["Correo electrónico", "l@t.co"], ["Celular", "311 765 4321"],
    ["NIT", ""], [], ["Nombre", "Número", "Talla"], ["Juan", "10", "M"],
  ]);
  assert.deepEqual(l.datosCliente, { organizacion: "Club Tigres", contacto: "Luis", email: "l@t.co", whatsapp: "311 765 4321" });
});

test("un archivo sin bloque devuelve datosCliente vacío", () => {
  assert.deepEqual(mapearTabla([["Nombre", "Número", "Talla"], ["Juan", "10", "M"]]).datosCliente, {});
});

test("CSV con ';' y BOM: trae al cliente y 6 prendas válidas", async () => {
  const l = await leer("pedido_colegio_sanjose.csv");
  assert.equal(l.datosCliente.organizacion, "Colegio San José");
  assert.equal(l.datosCliente.whatsapp, "300 123 4567");
  const r = validarPedido(l);
  assert.equal(r.valido, true);
  assert.equal(r.resumen.filasValidas, 6);
});

test("CSV con coma y etiquetas distintas se lee igual", async () => {
  const l = await leer("pedido_club_tigres.csv");
  assert.equal(l.datosCliente.organizacion, "Club Deportivo Los Tigres");
  assert.equal(l.datosCliente.email, "luis@lostigres.co");
  assert.equal(l.datosCliente.whatsapp, "311 765 4321");
  assert.equal(validarPedido(l).resumen.filasValidas, 4);
});

test("Excel con bloque del cliente (.xlsx) también se lee", async () => {
  const l = await leer("pedido_correcto.xlsx");
  assert.equal(l.datosCliente.contacto, "Ana Ruiz");
  assert.equal(validarPedido(l).valido, true);
});

test("CSV con datos del cliente y errores en prendas: lee ambos", async () => {
  const l = await leer("pedido_con_errores.csv");
  assert.equal(l.datosCliente.organizacion, "Club Deportivo Los Tigres");
  const r = validarPedido(l);
  assert.equal(r.valido, false);
  assert.equal(r.resumen.filasConError, 7);
});

test("la plantilla vacía solo trae el tipo y avisa que no hay filas", async () => {
  const l = await leer("plantilla_pedido.csv");
  assert.deepEqual(l.datosCliente, { tipo: "colegio" });
  assert.match(validarPedido(l).hallazgos[0].mensaje, /no tiene filas/);
});

test("combinar: lo escrito en el formulario manda y el archivo llena lo que falta", () => {
  const mezcla = combinarCliente(
    { organizacion: "Del archivo", contacto: "Ana", email: "ana@a.co" },
    { organizacion: "", contacto: "Corregido", whatsapp: "  " },
  );
  assert.deepEqual(mezcla, { organizacion: "Del archivo", contacto: "Corregido", email: "ana@a.co" });
});

test("tipo: 'Club deportivo' se entiende como club; uno desconocido es error", () => {
  const base = { organizacion: "X Club", contacto: "Ana", email: "a@a.co" };
  const ok = validarCliente({ ...base, tipo: "Club deportivo" });
  assert.ok(ok.ok && ok.cliente.tipo === "club");
  const mal = validarCliente({ ...base, tipo: "fundación" });
  assert.equal(mal.ok, false);
});
