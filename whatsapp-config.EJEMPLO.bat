@echo off
rem ==========================================================================
rem  Configuracion de WhatsApp para enviar avisos reales (opcional).
rem
rem  1. Copia este archivo con el nombre:  whatsapp-config.bat
rem  2. Reemplaza los valores de abajo por los de tu cuenta de WhatsApp Business
rem     (Meta for Developers > tu app > WhatsApp > API Setup).
rem  3. Abre INICIAR.bat: lo detecta solo. Sin este archivo, los avisos se simulan.
rem
rem  No compartas ni subas whatsapp-config.bat a ningun sitio: contiene tu token.
rem ==========================================================================

set WHATSAPP_TOKEN=PEGA_AQUI_TU_TOKEN
set WHATSAPP_PHONE_ID=PEGA_AQUI_EL_ID_DEL_NUMERO

rem Opcional: nombres de las plantillas aprobadas por Meta. Cada una con 3 variables:
rem {{1}} nombre del contacto, {{2}} codigo del pedido, {{3}} organizacion.
rem Si no las defines, se envia texto libre (solo llega a numeros de prueba o
rem dentro de las 24 h siguientes a un mensaje del cliente).
rem set WHATSAPP_TEMPLATE_POR_APROBAR=pedido_por_aprobar
rem set WHATSAPP_TEMPLATE_EN_PRODUCCION=pedido_en_produccion
rem set WHATSAPP_TEMPLATE_FINALIZADO=pedido_finalizado
rem set WHATSAPP_LANG=es
