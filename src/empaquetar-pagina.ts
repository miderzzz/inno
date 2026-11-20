/**
 * Copia public/index.html y public/img/* dentro de src/pagina-empaquetada.ts.
 *   npm run empaquetar   (también lo hacen npm test, npm run server y npm run dev)
 *
 * En Vercel la función de la app no recibe la carpeta public/, así que la página
 * y las imágenes viajan dentro del código. En el computador se leen del disco.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";

const TIPOS: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".webp": "image/webp", ".ico": "image/x-icon" };

export function contenidoEmpaquetado(raiz = "."): string {
  const pagina = readFileSync(join(raiz, "public", "index.html"), "utf8");
  const dirImg = join(raiz, "public", "img");
  const imagenes: Record<string, { tipo: string; base64: string }> = {};
  for (const nombre of readdirSync(dirImg).sort()) {
    const tipo = TIPOS[extname(nombre).toLowerCase()];
    if (tipo) imagenes[nombre] = { tipo, base64: readFileSync(join(dirImg, nombre)).toString("base64") };
  }
  return [
    "// ARCHIVO GENERADO por src/empaquetar-pagina.ts a partir de public/. No lo edites a mano: edita public/ y ejecuta npm run empaquetar.",
    `export const PAGINA: string = ${JSON.stringify(pagina)};`,
    `export const IMAGENES: Record<string, { tipo: string; base64: string }> = ${JSON.stringify(imagenes)};`,
    "",
  ].join("\n");
}

if (process.argv[1] && /empaquetar-pagina\.[tj]s$/.test(process.argv[1])) {
  writeFileSync("src/pagina-empaquetada.ts", contenidoEmpaquetado());
  console.log("public/ empaquetado en src/pagina-empaquetada.ts");
}
