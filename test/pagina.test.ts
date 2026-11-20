import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { contenidoEmpaquetado } from "../src/empaquetar-pagina.js";

test("la copia empaquetada de public/ (la que usa Vercel) está al día", () => {
  assert.equal(
    readFileSync("src/pagina-empaquetada.ts", "utf8"),
    contenidoEmpaquetado(),
    "Ejecuta npm run empaquetar y vuelve a hacer commit.",
  );
});
