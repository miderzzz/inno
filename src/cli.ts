/**
 * Uso: npm run validar -- ruta/al/archivo.xlsx
 * Imprime el resumen y los hallazgos tal como los vería el cliente.
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { ErrorArchivo, leerHojaDeCalculo } from "./lector.js";
import { validarPedido } from "./validador.js";

const ruta = process.argv[2];
if (!ruta) {
  console.error("Uso: npm run validar -- <archivo.xlsx|archivo.csv>");
  process.exit(1);
}

try {
  const lectura = await leerHojaDeCalculo(await readFile(ruta), basename(ruta));
  const r = validarPedido(lectura);

  console.log(`\nArchivo: ${basename(ruta)}`);
  const dc = Object.entries(lectura.datosCliente);
  console.log(dc.length ? `Datos del cliente: ${dc.map(([k, v]) => `${k}=${v}`).join(" | ")}` : "Datos del cliente: el archivo no los trae");
  console.log(`Columnas reconocidas: ${JSON.stringify(lectura.mapaColumnas)}`);
  if (lectura.columnasIgnoradas.length) console.log(`Columnas ignoradas: ${lectura.columnasIgnoradas.join(", ")}`);
  console.log(
    `\n${r.resumen.filasTotal} filas · ${r.resumen.filasValidas} válidas · ` +
      `${r.resumen.filasConError} con error · ${r.resumen.advertencias} advertencias`,
  );
  console.log(`Curva de tallas: ${JSON.stringify(r.resumen.curvaTallas)}`);
  console.log(r.valido ? "\n✅ Pedido listo para cotizar\n" : "\n❌ Corrige los errores para continuar\n");

  for (const h of r.hallazgos) {
    const icono = h.severidad === "error" ? "✖" : "⚠";
    const sug = h.sugerencia ? `  → sugerencia: ${h.sugerencia}` : "";
    console.log(`${icono} Fila ${String(h.fila).padStart(3)} [${h.campo}] ${h.mensaje}${sug}`);
  }
  process.exit(r.valido ? 0 : 2);
} catch (e) {
  if (e instanceof ErrorArchivo) {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  }
  throw e;
}
