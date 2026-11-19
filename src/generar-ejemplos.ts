/**
 * Genera en ./ejemplos los archivos de prueba y la plantilla.
 *   npx tsx src/generar-ejemplos.ts
 *
 * Formato de cada archivo (CSV o Excel):
 *   - Arriba: bloque "etiqueta | valor" con los datos del cliente.
 *   - Una fila en blanco.
 *   - La tabla: Nombre | Número | Talla | Equipo.
 */
import ExcelJS from "exceljs";
import { mkdir, writeFile } from "node:fs/promises";

type Fila = (string | number)[];
const DIR = "ejemplos";
await mkdir(DIR, { recursive: true });

const TIPOS = "colegio,club,liga,empresa,otro";
const TALLAS = "4,6,8,10,12,14,16,XS,S,M,L,XL,XXL,XXXL";

interface DatosCliente {
  organizacion: string; tipo: string; nit: string; contacto: string; email: string; whatsapp: string; autoriza: string;
}

const bloque = (c: DatosCliente): Fila[] => [
  ["Organización", c.organizacion],
  ["Tipo", c.tipo],
  ["NIT", c.nit],
  ["Contacto", c.contacto],
  ["Correo", c.email],
  ["WhatsApp", c.whatsapp],
  ["Autoriza WhatsApp", c.autoriza],
];
const ENCABEZADO: Fila = ["Nombre", "Número", "Talla", "Equipo"];

// ---------- CSV ----------
function celdaCsv(v: string | number, sep: string): string {
  const t = String(v);
  return t.includes(sep) || t.includes('"') || t.includes("\n") ? `"${t.replace(/"/g, '""')}"` : t;
}
async function crearCsv(nombre: string, filas: Fila[], opciones: { sep: ";" | ","; bom?: boolean }) {
  const texto = filas.map((f) => f.map((c) => celdaCsv(c, opciones.sep)).join(opciones.sep)).join("\r\n") + "\r\n";
  await writeFile(`${DIR}/${nombre}`, (opciones.bom ? "﻿" : "") + texto, "utf8");
}

// ---------- Excel ----------
async function crearXlsx(nombre: string, filas: Fila[]) {
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet("Pedido");
  filas.forEach((f) => hoja.addRow(f));
  formatear(hoja);
  agregarAyuda(libro);
  await libro.xlsx.writeFile(`${DIR}/${nombre}`);
}
function formatear(hoja: ExcelJS.Worksheet) {
  hoja.columns = [{ width: 26 }, { width: 28 }, { width: 10 }, { width: 16 }];
  for (let r = 1; r <= 7; r++) hoja.getCell(`A${r}`).font = { bold: true };
  hoja.getRow(9).font = { bold: true };
  hoja.getRow(9).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF9" } };
  hoja.getCell("B2").dataValidation = { type: "list", allowBlank: true, formulae: [`"${TIPOS}"`] };
  hoja.getCell("B7").dataValidation = { type: "list", allowBlank: true, formulae: ['"Sí,No"'] };
  for (let r = 10; r <= 309; r++) {
    hoja.getCell(`C${r}`).dataValidation = { type: "list", allowBlank: true, formulae: [`"${TALLAS}"`] };
  }
}
function agregarAyuda(libro: ExcelJS.Workbook) {
  const ayuda = libro.addWorksheet("Ayuda");
  ayuda.columns = [{ width: 100 }];
  [
    "CÓMO LLENAR ESTE ARCHIVO",
    "1. Arriba (filas 1 a 7) escribe los datos del cliente: organización, tipo, NIT, contacto, correo, WhatsApp y si autoriza avisos por WhatsApp (Sí/No).",
    "2. Deja la fila 8 en blanco.",
    "3. Desde la fila 10 escribe una prenda por fila: Nombre, Número (0 a 99), Talla y Equipo.",
    "4. Tallas válidas: 4, 6, 8, 10, 12, 14, 16, XS, S, M, L, XL, XXL, XXXL.",
    "5. El nombre se estampa en mayúsculas, máximo 12 caracteres, sin símbolos ni emojis.",
    "6. El número de camiseta no puede repetirse dentro del mismo equipo.",
    "7. Al subir el archivo, el formulario se llena solo con los datos del cliente.",
    "8. Solo se envían avisos por WhatsApp (por aprobar, en producción, finalizado) si el contacto autoriza: escribe Sí en la fila 7.",
  ].forEach((t, i) => { const c = ayuda.addRow([t]); if (i === 0) c.font = { bold: true }; });
}

// ---------- Datos de ejemplo ----------
const sanJose: DatosCliente = {
  organizacion: "Colegio San José", tipo: "colegio", nit: "900.123.456-7",
  contacto: "Ana Ruiz", email: "ana.ruiz@sanjose.edu.co", whatsapp: "300 123 4567", autoriza: "Sí",
};
const tigres: DatosCliente = {
  organizacion: "Club Deportivo Los Tigres", tipo: "club", nit: "800.555.321-0",
  contacto: "Luis Mora", email: "luis@lostigres.co", whatsapp: "+57 311 765 4321", autoriza: "Sí",
};

const prendasSanJose: Fila[] = [
  ["Juan Pérez", 10, "M", "Sub-15"],
  ["Andrés Gómez", 7, "L", "Sub-15"],
  ["Camilo Núñez", 1, "S", "Sub-15"],
  ["Mateo Rojas", 9, "M", "Sub-15"],
  ["Sofía Peña", 10, "14", "Sub-12"],
  ["Laura Ríos", 5, "12", "Sub-12"],
];

const prendasConErrores: Fila[] = [
  ["Juan Pérez", 10, "m", "Sub-15"], // talla en minúscula -> advertencia
  ["Andrés Gómez", 10, "L", "Sub-15"], // dorsal repetido con la fila anterior
  ["María Fernanda Rodríguez", 5, "S", "Sub-15"], // nombre largo
  ["Pipe ⚽", 23, "XL", "Sub-15"], // emoji no estampable
  ["Luis Díaz", "07", "Mediana", "Sub-15"], // cero inicial + alias de talla
  ["Carlos Ruiz", 120, "M", "Sub-15"], // fuera de rango
  ["Tomás Ríos", "diez", "XXXXL", "Sub-15"], // número y talla inválidos
  ["", 9, "L", "Sub-15"], // nombre vacío
  ["Sofía Peña", 10, "14", "Sub-12"], // mismo dorsal, otro equipo -> correcto
];

const prendasTigres: Fila[] = [
  ["José Muñoz", 9, "2XL", "Mayores"],
  ["Iván Ortiz", 11, "xg", "Mayores"],
  ["Diego Salas", 1, "L", "Mayores"],
  ["Nicolás Vega", 23, "M", "Mayores"],
];

// 1) Excel con datos del cliente, todo correcto
await crearXlsx("pedido_correcto.xlsx", [...bloque(sanJose), [], ENCABEZADO, ...prendasSanJose]);

// 2) Excel con datos del cliente y errores variados en las prendas
await crearXlsx("pedido_con_errores.xlsx", [...bloque(tigres), [], ENCABEZADO, ...prendasConErrores]);

// 3) CSV de Excel en español: separador ";" y UTF-8 con BOM
await crearCsv("pedido_colegio_sanjose.csv", [...bloque(sanJose), [], ENCABEZADO, ...prendasSanJose], { sep: ";", bom: true });

// 4) CSV con coma, otras etiquetas (Correo electrónico, Celular) y tallas escritas distinto
await crearCsv(
  "pedido_club_tigres.csv",
  [
    ["Cliente", tigres.organizacion],
    ["Tipo de organización", "Club deportivo"],
    ["NIT", tigres.nit],
    ["Persona de contacto", tigres.contacto],
    ["Correo electrónico", tigres.email],
    ["Celular", "311 765 4321"],
    ["Acepta WhatsApp", "Sí"],
    [],
    ENCABEZADO,
    ...prendasTigres,
  ],
  { sep: "," },
);

// 5) CSV con datos del cliente Y errores en las prendas
await crearCsv("pedido_con_errores.csv", [...bloque(tigres), [], ENCABEZADO, ...prendasConErrores], { sep: ";", bom: true });

// 6) CSV sin datos del cliente: hay que escribirlos en el formulario
await crearCsv(
  "pedido_sin_datos_cliente.csv",
  [["Nombre", "Dorsal", "Talla", "Equipo"], ["José Muñoz", 9, "2XL", "Mayores"], ["Iván Ortiz", 11, "xg", "Mayores"]],
  { sep: ";", bom: true },
);

// 7) Plantillas vacías para entregar a los clientes
const plantilla: Fila[] = [
  ["Organización", ""], ["Tipo", "colegio"], ["NIT", ""], ["Contacto", ""], ["Correo", ""], ["WhatsApp", ""], ["Autoriza WhatsApp", ""],
  [], ENCABEZADO,
];
await crearCsv("plantilla_pedido.csv", plantilla, { sep: ";", bom: true });
await crearXlsx("plantilla_pedido.xlsx", plantilla);

console.log(`Ejemplos y plantillas generados en ./${DIR}`);
