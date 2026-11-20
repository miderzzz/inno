/**
 * Carga correo-config.bat y whatsapp-config.bat (líneas "set NOMBRE=valor") al arrancar,
 * para que la configuración funcione igual con INICIAR.bat, `npm run server` o `npm run dev`.
 * Una variable que ya venga del entorno tiene prioridad. Los valores nunca se imprimen.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const MARCADOR = /^PEGA[-_]AQUI/i;

export interface CargaConfig { archivo: string; existe: boolean; cargadas: string[]; avisos: string[] }

export function leerArchivoSet(texto: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const bruta of texto.replace(/^﻿/, "").split(/\r?\n/)) {
    const linea = bruta.trim();
    const m = /^set\s+"?([A-Za-z_][A-Za-z0-9_]*)=(.*?)"?$/i.exec(linea);
    if (m) vars[m[1].toUpperCase()] = m[2].trim();
  }
  return vars;
}

export function cargarConfigLocal(raiz = RAIZ): CargaConfig[] {
  return ["correo-config.bat", "whatsapp-config.bat"].map((nombre) => {
    const ruta = join(raiz, nombre);
    const r: CargaConfig = { archivo: nombre, existe: existsSync(ruta), cargadas: [], avisos: [] };
    if (!r.existe) return r;
    const vars = leerArchivoSet(readFileSync(ruta, "latin1"));
    if (Object.keys(vars).length === 0) r.avisos.push(`${nombre} está vacío o no tiene líneas "set NOMBRE=valor".`);
    for (const [k, v] of Object.entries(vars)) {
      if (!v || MARCADOR.test(v)) {
        r.avisos.push(`${k} no tiene valor en ${nombre} (todavía dice PEGA-AQUI...).`);
        continue;
      }
      if (process.env[k] === undefined || process.env[k] === "") {
        process.env[k] = v;
        r.cargadas.push(k);
      }
    }
    return r;
  });
}

