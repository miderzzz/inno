-- Pedido Seguro Sport Champion - esquema base (PostgreSQL 16)
-- Núcleo para el MVP. En el proyecto real se gestiona con migraciones de Prisma.

-- gen_random_uuid() viene incluido desde PostgreSQL 13.

-- ---------- Catálogos y actores ----------
CREATE TABLE organizaciones (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nit           text UNIQUE NOT NULL,
  razon_social  text NOT NULL,
  tipo          text NOT NULL CHECK (tipo IN ('colegio','club','liga','empresa','otro')),
  ciudad        text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE contactos (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizacion_id    uuid NOT NULL REFERENCES organizaciones(id),
  nombre             text NOT NULL,
  email              text NOT NULL,
  whatsapp_e164      text CHECK (whatsapp_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  rol                text,
  acepta_whatsapp    boolean NOT NULL DEFAULT false,
  consentimiento_at  timestamptz,           -- evidencia de autorización (habeas data)
  UNIQUE (organizacion_id, email)
);

CREATE TABLE usuarios_internos (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre  text NOT NULL,
  email   text UNIQUE NOT NULL,
  rol     text NOT NULL CHECK (rol IN ('admin','comercial','produccion','empaque'))
);

CREATE TABLE productos (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku                    text UNIQUE NOT NULL,
  nombre                 text NOT NULL,
  precio_base            numeric(12,2) NOT NULL,
  permite_nombre         boolean NOT NULL DEFAULT true,
  permite_numero         boolean NOT NULL DEFAULT true,
  max_caracteres_nombre  smallint NOT NULL DEFAULT 12,
  activo                 boolean NOT NULL DEFAULT true
);

CREATE TABLE tallas (
  codigo   text PRIMARY KEY,                 -- '4'..'16', 'XS'..'XXXL'
  grupo    text NOT NULL CHECK (grupo IN ('infantil','adulto','dama')),
  recargo  numeric(12,2) NOT NULL DEFAULT 0,
  orden    smallint NOT NULL
);

CREATE TABLE escalas_precio (
  producto_id      uuid NOT NULL REFERENCES productos(id),
  cantidad_min     int NOT NULL,
  cantidad_max     int,                      -- NULL = sin tope
  precio_unitario  numeric(12,2) NOT NULL,
  PRIMARY KEY (producto_id, cantidad_min)
);

CREATE TABLE recargos (
  tipo   text PRIMARY KEY CHECK (tipo IN ('nombre','numero','talla_especial')),
  valor  numeric(12,2) NOT NULL
);

-- ---------- Pedido ----------
CREATE TABLE pedidos (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo                   text UNIQUE NOT NULL,          -- PSC-2026-00042
  organizacion_id          uuid NOT NULL REFERENCES organizaciones(id),
  contacto_id              uuid NOT NULL REFERENCES contactos(id),
  estado                   text NOT NULL DEFAULT 'borrador' CHECK (estado IN (
                             'borrador','por_aprobar','validado','cotizado','en_aprobacion','aprobado',
                             'en_produccion','finalizado','empacado','despachado','entregado','cerrado','cancelado')),
  version_actual           int NOT NULL DEFAULT 1,
  diseno                   jsonb,                          -- colores, escudo, plantilla
  fecha_entrega_requerida  date,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cargas_archivo (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id       uuid NOT NULL REFERENCES pedidos(id),
  nombre_archivo  text NOT NULL,
  storage_key     text NOT NULL,
  sha256          text NOT NULL,
  filas_total     int NOT NULL,
  filas_validas   int NOT NULL,
  filas_error     int NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pedido_id, sha256)
);

CREATE TABLE errores_validacion (
  id              bigserial PRIMARY KEY,
  carga_id        uuid NOT NULL REFERENCES cargas_archivo(id) ON DELETE CASCADE,
  fila            int NOT NULL,
  campo           text NOT NULL,
  codigo          text NOT NULL,
  severidad       text NOT NULL CHECK (severidad IN ('error','advertencia')),
  mensaje         text NOT NULL,
  valor_original  text,
  sugerencia      text
);

CREATE TABLE cajas (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id    uuid NOT NULL REFERENCES pedidos(id),
  codigo_caja  text UNIQUE NOT NULL,
  peso_kg      numeric(6,2),
  cerrada_at   timestamptz
);

CREATE TABLE items_pedido (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id            uuid NOT NULL REFERENCES pedidos(id),
  producto_id          uuid NOT NULL REFERENCES productos(id),
  talla                text NOT NULL REFERENCES tallas(codigo),
  equipo               text NOT NULL DEFAULT 'GENERAL',
  nombre_estampado     text,
  numero               smallint CHECK (numero BETWEEN 0 AND 99),
  fila_origen          int,
  codigo_trazabilidad  text UNIQUE,          -- se asigna al aprobar: SC-26-00042-017-4
  estado_produccion    text NOT NULL DEFAULT 'pendiente',
  caja_id              uuid REFERENCES cajas(id),
  UNIQUE (pedido_id, producto_id, equipo, numero)   -- sin dorsales repetidos por equipo
);

CREATE TABLE cotizaciones (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id     uuid NOT NULL REFERENCES pedidos(id),
  version       int NOT NULL,
  subtotal      numeric(14,2) NOT NULL,
  descuento     numeric(14,2) NOT NULL DEFAULT 0,
  iva           numeric(14,2) NOT NULL,
  total         numeric(14,2) NOT NULL,
  moneda        char(3) NOT NULL DEFAULT 'COP',
  valida_hasta  date NOT NULL,
  detalle       jsonb NOT NULL,             -- instantánea de líneas y precios usados
  pdf_key       text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pedido_id, version)
);

CREATE TABLE aprobaciones (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id         uuid NOT NULL REFERENCES pedidos(id),
  cotizacion_id     uuid NOT NULL REFERENCES cotizaciones(id),
  snapshot_sha256   text NOT NULL,          -- hash del contenido exacto mostrado
  token_hash        text UNIQUE NOT NULL,   -- nunca se guarda el token en claro
  expira_at         timestamptz NOT NULL,
  estado            text NOT NULL DEFAULT 'pendiente' CHECK (estado IN
                      ('pendiente','aprobado','cambios_solicitados','expirado','revocado')),
  nombre_aprobador  text,
  comentario        text,
  ip                inet,
  user_agent        text,
  decidido_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- ---------- Trazabilidad (solo inserciones) ----------
CREATE TABLE eventos_trazabilidad (
  id           bigserial PRIMARY KEY,
  item_id      uuid NOT NULL REFERENCES items_pedido(id),
  etapa        text NOT NULL CHECK (etapa IN
                 ('corte','sublimacion_estampado','confeccion','control_calidad','empaque')),
  resultado    text NOT NULL CHECK (resultado IN ('ok','rechazo')),
  estacion     text,
  usuario_id   uuid REFERENCES usuarios_internos(id),
  observacion  text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON eventos_trazabilidad (item_id, created_at DESC);

-- ---------- Despacho y postventa ----------
CREATE TABLE envios (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id       uuid NOT NULL REFERENCES pedidos(id),
  transportadora  text,
  guia            text,
  despachado_at   timestamptz,
  entregado_at    timestamptz
);

CREATE TABLE mensajes_whatsapp (
  id             bigserial PRIMARY KEY,
  pedido_id      uuid REFERENCES pedidos(id),
  contacto_id    uuid NOT NULL REFERENCES contactos(id),
  plantilla      text,
  wa_message_id  text UNIQUE,
  direccion      text NOT NULL CHECK (direccion IN ('saliente','entrante')),
  estado         text NOT NULL,               -- enviado, entregado, leido, fallido, recibido
  payload        jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE retroalimentacion (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id    uuid NOT NULL REFERENCES pedidos(id),
  contacto_id  uuid NOT NULL REFERENCES contactos(id),
  nps          smallint CHECK (nps BETWEEN 0 AND 10),
  calidad      smallint CHECK (calidad BETWEEN 1 AND 5),
  comentario   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Outbox: el evento se escribe en la misma transacción que el cambio de estado.
CREATE TABLE eventos_salida (
  id            bigserial PRIMARY KEY,
  tipo          text NOT NULL,              -- pedido.aprobado, pedido.entregado, ...
  payload       jsonb NOT NULL,
  intentos      int NOT NULL DEFAULT 0,
  procesado_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON eventos_salida (created_at) WHERE procesado_at IS NULL;
