# WhatsApp: estado y pasos pendientes

Documento de traspaso. Resume qué está hecho, qué falta y cómo terminarlo.

## Qué ya está hecho (código listo y probado)

- `src/whatsapp.ts` envía un aviso por la **WhatsApp Cloud API de Meta** en cada cambio de estado
  (por aprobar al crear el pedido, en producción, finalizado), en paralelo con el correo.
- Solo se envía si el pedido tiene número de WhatsApp **y** el contacto autorizó los avisos
  (casilla del formulario o línea `Autoriza WhatsApp;Sí` en el archivo).
- Sin credenciales funciona en **modo simulación**: el aviso queda registrado en el pedido pero no sale.
- La app lee las credenciales de `whatsapp-config.bat` al arrancar (con `npm run server`, `npm run dev`
  o `INICIAR.bat`). En la terminal muestra `WhatsApp: REAL` o `WhatsApp: simulación`.
- Si Meta rechaza el envío, la tabla "Avisos al cliente" muestra el motivo en español
  (número no autorizado, token vencido, Phone number ID equivocado, ventana de 24 h cerrada).
- Usa la versión `v25.0` de la Graph API (se puede cambiar con `WHATSAPP_API_URL`).
- Pruebas: `test/estados.test.ts` simula la API de Meta con un servidor falso (`npm test`).

## Estado de la cuenta de Meta (19-nov-2026)

| Dato | Valor |
|---|---|
| App de Meta (ID) | 1087399394343060 |
| Número de prueba | +1 555 156 4410 |
| Phone number ID | 1355037984369131 (ya está en `whatsapp-config.bat`) |
| WhatsApp Business Account ID | 1857123105415618 |
| Destinatario de prueba verificado | (agrega y verifica tu propio celular en API Setup) |
| Token | **no incluido** (se borró del proyecto; el temporal dura 24 h) |

**Bloqueo:** los envíos fallan con el error **131031 "Business Account locked"**: Meta bloqueó la cuenta
de WhatsApp Business. Falla incluso enviando desde el propio panel de Meta, así que no es un problema de la app.

## Pasos para terminar

1. **Desbloquear la cuenta (o usar otra).**
   - Completar la información del negocio en https://business.facebook.com → Configuración →
     Información del negocio (nombre legal, dirección, teléfono y **sitio web**).
   - Abrir Business Support Home → Account Overview, ver la restricción y pulsar **Solicitar revisión**
     (suele tardar 24–48 h).
   - Diagnóstico: en el Explorador de la API Graph consultar `1857123105415618?fields=health_status`.
   - Alternativa: crear una app nueva de Meta con tu propia cuenta y usar su número de prueba;
     en ese caso cambia `WHATSAPP_PHONE_ID` en `whatsapp-config.bat`.
2. **Comprobar en el panel de Meta.** En WhatsApp → API Setup enviar la plantilla `hello_world`
   al número verificado. Si llega, la cuenta ya funciona.
3. **Configurar la app.** Generar el token en API Setup, pegarlo en `whatsapp-config.bat`
   (`WHATSAPP_TOKEN=`) y reiniciar. Debe decir `WhatsApp: REAL`.
4. **Abrir la ventana de 24 h.** Los avisos son texto libre: Meta solo los entrega si el destinatario
   escribió al número de la empresa en las últimas 24 h. Desde el celular abrir https://wa.me/15551564410
   y enviar "hola". Si no, Meta acepta el mensaje pero no lo entrega.
5. **Probar.** Crear un pedido con ese celular en el campo WhatsApp y la casilla de autorización marcada.

## Para producción (clientes reales)

- **Token permanente:** en business.facebook.com → Usuarios del sistema → crear uno con rol de
  administrador, asignarle la app y la cuenta de WhatsApp, y generar un token con los permisos
  `whatsapp_business_messaging` y `whatsapp_business_management`.
- **Número real:** registrar un número propio en WhatsApp Manager. Un número que se pasa a la
  plataforma deja de funcionar en la app de WhatsApp del celular, salvo que se use la "coexistencia"
  con WhatsApp Business (se configura con el registro de Meta, normalmente a través de un proveedor).
- **Verificar el negocio** en Meta y agregar un método de pago (Meta cobra por mensaje de plantilla).
- **Plantillas aprobadas**, necesarias para escribirle al cliente sin que haya escrito antes. Crear tres
  (por aprobar, en producción, finalizado) con las variables `{{1}}` contacto, `{{2}}` código del pedido
  y `{{3}}` organización, y configurar sus nombres en `whatsapp-config.bat`:
  `WHATSAPP_TEMPLATE_POR_APROBAR`, `WHATSAPP_TEMPLATE_EN_PRODUCCION`, `WHATSAPP_TEMPLATE_FINALIZADO`
  (y `WHATSAPP_LANG`, por defecto `es`). Ver `whatsapp-config.EJEMPLO.bat`.

## Mejoras pendientes en el código (opcionales)

- **Webhook de estados:** Meta informa si un mensaje se entregó o falló *después* del envío (así se vio el
  131031). La app todavía no recibe esos avisos, por eso puede marcar "enviado" un mensaje que no llegó.
  Falta un endpoint `GET/POST /api/whatsapp/webhook` (verificación con token y actualización del aviso por
  su `wamid`) y una URL pública HTTPS para registrarlo en Meta.
- **Botón "Enviar por WhatsApp" (wa.me):** alternativa sin Meta que abre el WhatsApp del usuario con el
  mensaje escrito para el cliente; útil mientras la cuenta esté bloqueada.

## Seguridad

- `whatsapp-config.bat` y `correo-config.bat` están en `.gitignore`: no se suben a git.
- No pegar tokens ni contraseñas en chats ni en el código.
