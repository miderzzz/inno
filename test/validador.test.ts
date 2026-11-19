import { test } from "node:test";
import assert from "node:assert/strict";
import { mapearTabla, leerHojaDeCalculo } from "../src/lector.js";
import { validarPedido } from "../src/validador.js";
import { normalizarNumero, normalizarTalla, normalizarNombre } from "../src/normalizar.js";

const tabla = (filas: string[][]) => mapearTabla([["Nombre", "Número", "Talla", "Equipo"], ...filas]);
const codigos = (r: ReturnType<typeof validarPedido>) => r.hallazgos.map((h) => `${h.fila}:${h.codigo}`);

test("normaliza tallas comunes", () => {
  assert.deepEqual(normalizarTalla(" m "), { ok: true, talla: "M", corregida: true });
  assert.deepEqual(normalizarTalla("2XL"), { ok: true, talla: "XXL", corregida: true });
  assert.deepEqual(normalizarTalla("Pequeña"), { ok: true, talla: "S", corregida: true });
  assert.deepEqual(normalizarTalla("XL"), { ok: true, talla: "XL", corregida: false });
  assert.deepEqual(normalizarTalla("XXXXL"), { ok: false });
});

test("normaliza números de Excel", () => {
  assert.deepEqual(normalizarNumero("10.0"), { ok: true, numero: 10, corregido: false });
  assert.deepEqual(normalizarNumero("07"), { ok: true, numero: 7, corregido: true });
  assert.deepEqual(normalizarNumero("0"), { ok: true, numero: 0, corregido: false });
  assert.deepEqual(normalizarNumero("7.5"), { ok: false, motivo: "decimal" });
  assert.deepEqual(normalizarNumero("diez"), { ok: false, motivo: "no_numerico" });
});

test("conserva la Ñ y quita tildes en nombres", () => {
  assert.equal(normalizarNombre("  josé   muñoz "), "JOSE MUÑOZ");
});

test("avisa que el cero inicial no se estampa", () => {
  const r = validarPedido(tabla([["Luis", "07", "M", "A"]]));
  assert.equal(r.valido, true);
  assert.equal(r.prendas[0].numero, 7);
  assert.match(r.hallazgos[0].mensaje, /sin cero inicial/);
});

test("pedido limpio es válido y arma la curva de tallas", () => {
  const r = validarPedido(tabla([["Juan", "10", "M", "A"], ["Pedro", "11", "M", "A"], ["Ana", "10", "S", "B"]]));
  assert.equal(r.valido, true);
  assert.equal(r.resumen.filasValidas, 3);
  assert.deepEqual(r.resumen.curvaTallas, { M: 2, S: 1 });
});

test("detecta dorsal repetido solo dentro del mismo equipo", () => {
  const r = validarPedido(tabla([["Juan", "10", "M", "A"], ["Pedro", "10", "L", "A"], ["Ana", "10", "S", "B"]]));
  assert.equal(r.valido, false);
  assert.deepEqual(codigos(r), ["2:NUMERO_DUPLICADO", "3:NUMERO_DUPLICADO"]);
  assert.equal(r.resumen.filasValidas, 1);
});

test("rechaza nombres largos, vacíos o con símbolos", () => {
  const r = validarPedido(tabla([["María Fernanda Rodríguez", "5", "S", ""], ["", "6", "S", ""], ["Pipe ⚽", "8", "S", ""]]));
  assert.deepEqual(codigos(r), ["2:NOMBRE_LARGO", "3:NOMBRE_VACIO", "4:NOMBRE_CARACTERES"]);
  assert.equal(r.hallazgos[0].sugerencia, "M. RODRIGUEZ");
});

test("falla con mensaje claro si faltan columnas", () => {
  const r = validarPedido(mapearTabla([["Nombre", "Talla"], ["Juan", "M"]]));
  assert.equal(r.valido, false);
  assert.match(r.hallazgos[0].mensaje, /numero/);
});

test("lee CSV con punto y coma en Windows-1252", async () => {
  const csv = Buffer.from("Nombre;Dorsal;Talla\r\nJosé Muñoz;9;2XL\r\n", "latin1");
  const r = validarPedido(await leerHojaDeCalculo(csv, "lista.csv"));
  assert.equal(r.valido, true);
  assert.deepEqual(r.prendas[0], { fila: 2, nombre: "JOSE MUÑOZ", numero: 9, talla: "XXL", equipo: "GENERAL", producto: undefined });
});
