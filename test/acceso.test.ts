import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crearToken, reiniciarIntentos, tokenValido } from "../src/acceso.js";
import { usarBaseDatos } from "../src/almacen.js";
import app from "../src/server.js";

let servidor: Server;
let base = "";
before(async () => {
  servidor = app.listen(0);
  await new Promise((ok) => servidor.once("listening", ok));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
after(() => servidor.close());
beforeEach(() => {
  process.env.PSC_DATA = join(mkdtempSync(join(tmpdir(), "psc-")), "pedidos.json");
  for (const k of ["APP_CLAVE", "APP_SECRETO", "VERCEL", "DATABASE_URL", "POSTGRES_URL"]) delete process.env[k];
  usarBaseDatos(null);
  reiniciarIntentos();
});

const pedir = (ruta: string, opciones: RequestInit = {}) => fetch(base + ruta, opciones);
const ingresar = (clave: string) =>
  pedir("/api/sesion", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clave }) });

test("sin APP_CLAVE (en el computador) la app queda abierta", async () => {
  assert.equal((await pedir("/api/pedidos")).status, 200);
  assert.deepEqual(await (await pedir("/api/sesion")).json(), { requiere: false, activa: true, sinConfigurar: false });
});

test("con APP_CLAVE pide ingresar; clave mala 401, buena deja entrar con cookie", async () => {
  process.env.APP_CLAVE = "Tigres-2026";
  const sin = await pedir("/api/pedidos");
  assert.equal(sin.status, 401);
  assert.equal((await sin.json()).login, true);
  assert.equal((await ingresar("otra")).status, 401);
  const ok = await ingresar("Tigres-2026");
  assert.equal(ok.status, 200);
  const cookie = ok.headers.get("set-cookie") ?? "";
  assert.match(cookie, /psc_sesion=.*HttpOnly.*SameSite=Lax/);
  const conCookie = await pedir("/api/pedidos", { headers: { cookie: cookie.split(";")[0] } });
  assert.equal(conCookie.status, 200);
  assert.equal((await (await pedir("/api/sesion", { headers: { cookie: cookie.split(";")[0] } })).json()).activa, true);
  // La pantalla en sí se puede cargar (pide la clave al abrir), los datos no.
  assert.equal((await pedir("/")).status, 200);
  // Cambiar la clave invalida las sesiones abiertas.
  process.env.APP_CLAVE = "nueva";
  assert.equal((await pedir("/api/pedidos", { headers: { cookie: cookie.split(";")[0] } })).status, 401);
});

test("la sesión firmada no se puede inventar ni usar vencida", () => {
  process.env.APP_CLAVE = "x";
  const t = crearToken();
  assert.ok(tokenValido(t));
  assert.ok(!tokenValido(t.replace(/^\d+/, String(Date.now() + 10 ** 12))));
  assert.ok(!tokenValido(crearToken(0)));
  assert.ok(!tokenValido("basura"));
});

test("frena a quien prueba muchas claves", async () => {
  process.env.APP_CLAVE = "correcta";
  let ultimo = 0;
  for (let i = 0; i < 11; i++) ultimo = (await ingresar("mala" + i)).status;
  assert.equal(ultimo, 429);
});

test("en Vercel sin APP_CLAVE se bloquea, y sin base de datos lo dice claro", async () => {
  process.env.VERCEL = "1";
  const r = await pedir("/api/pedidos");
  assert.equal(r.status, 503);
  assert.match((await r.json()).error, /APP_CLAVE/);
  process.env.APP_CLAVE = "c";
  const login = await ingresar("c");
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
  assert.match(login.headers.get("set-cookie") ?? "", /Secure/);
  const sinBase = await pedir("/api/pedidos", { headers: { cookie } });
  assert.equal(sinBase.status, 503);
  assert.match((await sinBase.json()).error, /Neon/);
});
