# psc-ingesta · Pedido Seguro Sport Champion

Lectura de hojas de cálculo (.xlsx / .csv) y validación de tallas, nombres y
dorsales para pedidos masivos de uniformes. Incluye una pantalla web de carga.

## Inicio rápido en Windows
1. Instala Node.js 20 o superior (https://nodejs.org, versión LTS).
2. Extrae el .zip y entra a la carpeta `psc-ingesta` (la que contiene `package.json`).
3. Haz doble clic en **INICIAR.bat**. Instala lo necesario la primera vez y abre
   http://localhost:3000 en el navegador.
4. En **Nuevo pedido** elige `ejemplos/pedido_colegio_sanjose.csv`: el formulario se llena solo con los
   datos del cliente que trae el archivo. Pulsa "Validar y crear pedido".
5. Pulsa **Aprobar y pasar a producción** y luego **Marcar como finalizado**: en cada cambio de
   estado el cliente recibe un aviso por correo y por WhatsApp (ver más abajo).
6. Se abre el detalle del pedido: de quién es, su estado, la curva de tallas, las prendas y los errores.
   En **Pedidos** ves la lista de todos, con buscador. En el computador los pedidos se guardan en `data/pedidos.json`;
   en Vercel, en la base de datos (ver "Publicar en Vercel").

## Inicio rápido desde la terminal
```bash
npm install
npm test                         # 35 pruebas
npm run server                   # http://localhost:3000 (pantalla de carga)
npm run dev                      # igual, pero se reinicia al editar código
npm run validar -- ejemplos/pedido_con_errores.csv    # reporte en consola
```
Probar la API (en PowerShell usa `curl.exe`, no `curl`):
```bash
curl.exe -F "archivo=@ejemplos/pedido_correcto.xlsx" http://localhost:3000/api/pedidos/validar
```

## Estados del pedido y avisos (correo y WhatsApp)
| Estado | Cuándo | Aviso al cliente |
| --- | --- | --- |
| **Por aprobar** | Al crear un pedido sin errores | "Recibimos tu pedido, está por aprobar..." |
| **En producción** | Al pulsar "Aprobar y pasar a producción" | "Tu pedido ya está en producción..." |
| **Finalizado** | Al pulsar "Marcar como finalizado" | "Tu pedido está finalizado y listo para entrega..." |
| Borrador | El archivo tiene errores | No se avisa; no se puede avanzar |

- Los estados solo avanzan de uno en uno (no se puede saltar ni devolver).
- Cada aviso queda registrado en el pedido (fecha, número, texto y resultado: enviado, simulado, fallido o no enviado) y se puede reenviar.
- El aviso va al WhatsApp registrado del contacto **solo si autorizó** recibirlos (casilla del formulario o línea `Autoriza WhatsApp;Sí` en el archivo).
- Si WhatsApp falla, el cambio de estado se guarda igual y el fallo queda anotado.
- Aún no hay inicio de sesión: cualquiera con acceso a la pantalla puede cambiar estados. Antes de publicarlo, agrega autenticación.

### Avisos por correo

Cada cambio de estado (por aprobar al crear el pedido, en producción, finalizado) envía un correo con el
resumen del pedido al **Correo** del cliente, firmado como `SPORT CHAMPION` y cerrando con "A tu servicio".
El correo no necesita autorización aparte (es un aviso del pedido que el cliente mismo registró); WhatsApp sí.

Para que salgan de verdad (se envían desde `amiderosespana@gmail.com`):
1. En tu cuenta de Google activa la **verificación en 2 pasos** y crea una **contraseña de aplicación**
   (Cuenta de Google → Seguridad → Contraseñas de aplicaciones). Son 16 letras; la normal de Gmail no sirve.
2. Copia `correo-config.EJEMPLO.bat` como `correo-config.bat` y pega esa contraseña en `CORREO_CLAVE`.
3. Abre `INICIAR.bat`. La franja de arriba dirá que el correo es real.

Notas:
- La contraseña vive solo en tu `correo-config.bat`; no se guarda en los pedidos ni se muestra. No la compartas.
- `CORREO_COPIA` manda copia oculta de cada aviso a tu correo; bórrala del archivo si no la quieres.
- Gmail permite unos 500 correos al día desde una cuenta personal.
- Si el cliente responde el correo, la respuesta te llega a ti (`Reply-To`).
- Si el envío falla (clave mala, sin internet) el estado se cambia igual y el fallo queda en la tabla "Avisos al cliente", con botón para reenviar.
- Otras variables: `CORREO_SERVIDOR` (smtp.gmail.com), `CORREO_PUERTO` (465).

### Enviar WhatsApp de verdad
Sin configuración, el sistema funciona en **modo simulación** (aviso amarillo arriba): registra los mensajes pero no salen al celular.
Para envíos reales necesitas una cuenta de WhatsApp Business Cloud API de Meta (token y "Phone number ID").
1. Copia `whatsapp-config.EJEMPLO.bat` como `whatsapp-config.bat` y pon tu token y tu Phone number ID.
2. Abre `INICIAR.bat`. El aviso de arriba pasará a verde ("WhatsApp conectado").

Desde la terminal (PowerShell): `$env:WHATSAPP_TOKEN="..."; $env:WHATSAPP_PHONE_ID="..."; npm run server`.

Dos reglas de Meta que debes conocer:
- Para escribirle a un cliente por iniciativa tuya hay que usar **plantillas aprobadas** por Meta. Crea tres (por aprobar, en producción, finalizado) con las variables `{{1}}` contacto, `{{2}}` código del pedido y `{{3}}` organización, y configura sus nombres con `WHATSAPP_TEMPLATE_POR_APROBAR`, `WHATSAPP_TEMPLATE_EN_PRODUCCION` y `WHATSAPP_TEMPLATE_FINALIZADO`. Sin plantillas se envía texto libre, que solo llega a números de prueba o dentro de las 24 h siguientes a un mensaje del cliente.
- Con una cuenta de prueba, Meta solo permite escribir a los números que registres como destinatarios de prueba.

## Formato del archivo (CSV o Excel)
Arriba van los datos del cliente y el equipo del pedido (etiqueta y valor), luego una fila en blanco y después la tabla:

```text
Organización;Colegio San José
Tipo;colegio
NIT;900.123.456-7
Contacto;Ana Ruiz
Correo;ana.ruiz@example.com
WhatsApp;300 123 4567
Autoriza WhatsApp;Sí
Equipo;FC Barcelona Visitante

Nombre;Número;Talla;Categoría
Juan Pérez;10;M;Sub-15
Andrés Gómez;7;L;Sub-15
```

- Obligatorios: **Organización**, **Contacto**, **Correo** y **Equipo** (equipo y versión del uniforme de todo el pedido, por ejemplo *FC Barcelona Visitante*; también se acepta la etiqueta *Uniforme*). Opcionales: Tipo, NIT, WhatsApp y Autoriza WhatsApp (Sí/No). Sin autorización no se envían avisos.
- Al elegir el archivo, el formulario se llena solo. Lo que escribas a mano en el formulario manda sobre el archivo.
- También se entienden etiquetas como Cliente, Colegio, Club, Persona de contacto, Correo electrónico, E-mail o Celular.
- El separador puede ser `;` (Excel en español), `,` o tabulador. Si el archivo no trae el bloque, se escriben los datos en el formulario.
- La tabla necesita las columnas Nombre, Número (o Dorsal) y Talla. Categoría (o Equipo) es opcional: agrupa a los jugadores (Sub-15, Sub-17…) y un dorsal no se puede repetir dentro de la misma categoría.

## Ejemplos incluidos (`ejemplos/`)
Los correos de los ejemplos usan el dominio reservado `example.com`, así que una prueba nunca le escribe a una persona real.

| Archivo | Para qué sirve |
| --- | --- |
| `plantilla_pedido.xlsx` / `.csv` | Plantilla vacía para entregar a los clientes (el Excel trae listas desplegables de tipo y talla) |
| `pedido_correcto.xlsx` | Excel con datos del cliente y 6 prendas sin errores |
| `pedido_colegio_sanjose.csv` | CSV con `;` y datos del cliente, sin errores |
| `pedido_club_tigres.csv` | CSV con `,`, otras etiquetas (Cliente, Celular) y tallas escritas distinto |
| `pedido_con_errores.xlsx` / `.csv` | Datos del cliente completos y 7 filas con errores de nombre, dorsal y talla |
| `pedido_fc_barcelona_visitante.csv` / `.xlsx` | Pedido del equipo **FC Barcelona Visitante**: 8 prendas sin errores, dos categorías |
| `pedido_sin_datos_cliente.csv` | No trae datos del cliente ni el equipo: hay que escribirlos en el formulario |

## Estructura
| Archivo | Qué hace |
| --- | --- |
| `src/catalogo.ts` | Tallas válidas, alias ("Mediana" → M), reglas de nombre y dorsal, encabezados aceptados |
| `src/normalizar.ts` | Limpieza de celdas, tallas, números y nombres |
| `src/lector.ts` | Lee .xlsx (ExcelJS) y .csv (Papa Parse), lee el bloque del cliente, encuentra la fila de encabezados y mapea columnas |
| `src/validador.ts` | Reglas por fila y entre filas (dorsal repetido por equipo, filas duplicadas) |
| `src/server.ts` | Pantalla web y API de pedidos (crear, listar, consultar, cambiar estado, reenviar aviso, eliminar) |
| `src/correo.ts` | Correo de cada estado (texto y HTML) y envío por SMTP (real o simulado) |
| `src/whatsapp.ts` | Textos de los avisos y envío por la API de WhatsApp (real o simulado) |
| `public/index.html` | Pantalla: ingreso, nuevo pedido, lista y detalle |
| `public/img/` | Logo de Champions Sport y banner de la pantalla de ingreso |
| `src/pagina-empaquetada.ts` | Copia de `public/` dentro del código, para Vercel. **Se genera sola** con `npm test`, `npm run server` o `npm run empaquetar`: después de editar `public/`, ejecuta uno de ellos antes del commit |
| `src/acceso.ts` | Contraseña de acceso (`APP_CLAVE`) y sesión con cookie firmada |
| `src/cliente.ts` | Validación de los datos del cliente (organización, contacto, correo, WhatsApp) |
| `src/almacen.ts` | Guarda los pedidos, su historial y los avisos: en PostgreSQL si existe `DATABASE_URL` (tabla `app_pedidos`, se crea sola) o en `data/pedidos.json` |
| `src/cli.ts` | Validación desde la terminal |
| `schema.sql` | Esquema PostgreSQL de la plataforma |

## Publicar en Vercel

La app corre en Vercel sin cambios de código (`src/server.ts` exporta la app de Express y `public/index.html`
lo sirve el CDN de Vercel). Necesita:

1. **Repositorio en GitHub** (privado si `correo-config.bat` lleva la contraseña de Gmail).
2. **Proyecto en Vercel:** https://vercel.com/new → importar el repositorio → Deploy (Vercel detecta Express solo;
   no se configura comando de build ni carpeta de salida).
3. **Base de datos:** en el proyecto, pestaña **Storage** → **Neon** (Postgres) → crear y conectar al proyecto.
   Vercel agrega `DATABASE_URL`. La tabla `app_pedidos` se crea sola con el primer pedido.
4. **Variables de entorno** (Settings → Environment Variables):

   | Variable | Valor |
   | --- | --- |
   | `APP_CLAVE` | Contraseña para entrar a la app (obligatoria en Vercel; sin ella la app queda bloqueada) |
   | `CORREO_USUARIO` | `amiderosespana@gmail.com` |
   | `CORREO_CLAVE` | Contraseña de aplicación de Google (16 letras) |
   | `CORREO_NOMBRE` | `SPORT CHAMPION` |
   | `CORREO_PIE` | `A tu servicio` |
   | `CORREO_COPIA` | (opcional) copia oculta de cada aviso |
   | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID` | (opcional) ver `WHATSAPP-PENDIENTE.md` |

5. **Volver a desplegar** (Deployments → ⋯ → Redeploy) para que tome las variables.

En Vercel no se leen los archivos `.bat`; esas claves van en las variables de entorno. Los archivos subidos
pueden pesar hasta 4 MB (límite de Vercel). Para usar la misma base de datos desde el computador, pon
`set DATABASE_URL=...` en `correo-config.bat`; si no, en el computador se sigue usando `data/pedidos.json`.

## Endpoints
| Método y ruta | Qué hace |
| --- | --- |
| `GET/POST/DELETE /api/sesion` | Estado de la sesión, ingresar con `{"clave":"..."}`, salir. Con `APP_CLAVE` el resto de `/api` exige haber ingresado |
| `POST /api/pedidos` | Crea un pedido. Va el archivo en `archivo`; el cliente y el equipo se toman del bloque del archivo, y los campos `organizacion`, `tipo`, `nit`, `contacto`, `email`, `whatsapp`, `equipo` del formulario completan o corrigen. El equipo es obligatorio |
| `GET /api/pedidos` | Lista de pedidos, los más recientes primero |
| `GET /api/pedidos/:codigo` | Detalle de un pedido (con historial y avisos) |
| `PATCH /api/pedidos/:codigo/estado` | Avanza el estado (`{"estado":"en_produccion"}`) y avisa por correo y WhatsApp |
| `POST /api/pedidos/:codigo/avisos` | Reenvía el aviso del estado actual |
| `GET /api/canales` | Modo de cada canal: `{"whatsapp":"simulado","correo":"real"}` |
| `DELETE /api/pedidos/:codigo` | Elimina un pedido |
| `POST /api/pedidos/validar` | Lee y valida el archivo sin guardar; devuelve también `datosCliente` |

## Respuesta de validación
- `200` pedido válido, `422` hay errores bloqueantes, `400` archivo ilegible.
- `hallazgos[]`: `{ fila, campo, codigo, severidad, mensaje, valorOriginal, sugerencia }`.
  La `fila` coincide con el número de fila que el cliente ve en Excel.
- `prendas[]`: filas limpias, listas para cotizar.

## Ajustar reglas
Todo está en `src/catalogo.ts` (tallas, máximo de caracteres del nombre, rango de dorsales).

## Problemas comunes
- `Cannot GET /` o `npm run dev` no existe: estás usando una versión anterior; extrae el zip nuevo.
- Para empezar con la lista vacía, borra la carpeta `data`.
- Puerto 3000 ocupado: en PowerShell `$env:PORT=3999; npm run server`.
