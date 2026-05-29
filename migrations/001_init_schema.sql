BEGIN;

-- =========================
-- Tablas base
-- =========================

CREATE TABLE IF NOT EXISTS cliente (
    id_cliente BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    identificacion TEXT NOT NULL UNIQUE,
    nombre TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS venta (
    id_venta BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_cliente BIGINT NOT NULL REFERENCES cliente(id_cliente),
    tipo_transaccion TEXT,
    comprobante TEXT UNIQUE,
    fecha_elaboracion DATE,
    fecha_vencimiento DATE,
    sucursal INTEGER,
    estado_envio_correo TEXT,
    total NUMERIC(15,2) NOT NULL CHECK (total >= 0),
    moneda TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transaccion (
    id_transaccion BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_cliente BIGINT NOT NULL REFERENCES cliente(id_cliente),
    fecha TIMESTAMPTZ NOT NULL,
    nombre TEXT,
    descripcion TEXT,
    referencia TEXT,
    documento TEXT,
    valor NUMERIC(15,2) NOT NULL CHECK (valor >= 0),
    comisiones NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (comisiones >= 0),
    moneda TEXT,
    id_banco BIGINT,
    soporte BOOLEAN,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tabla de bancos soportados
CREATE TABLE IF NOT EXISTS banco (
        id_banco BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        codigo TEXT NOT NULL UNIQUE,
        nombre TEXT NOT NULL
);

-- Insertar bancos iniciales
INSERT INTO banco (codigo, nombre)
VALUES
    ('BBVA1819', 'BBVA 1819'),
    ('BBVA0605', 'BBVA 0605'),
    ('BCOL', 'Bancolombia'),
    ('BAP', 'Banco De Panamá')
ON CONFLICT (codigo) DO NOTHING;

-- Opcional: tabla de monedas soportadas (puede usarse para listas desplegables)
CREATE TABLE IF NOT EXISTS moneda (
        codigo TEXT PRIMARY KEY,
        nombre TEXT NOT NULL
);

INSERT INTO moneda (codigo, nombre) VALUES
    ('COP', 'Peso Colombiano'),
    ('USD', 'Dólar estadounidense'),
    ('EUR', 'Euro'),
    ('PAB', 'Balboa (Panamá)')
ON CONFLICT (codigo) DO NOTHING;

CREATE TABLE IF NOT EXISTS aplicacion_pago (
    id_aplicacion BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_transaccion BIGINT NOT NULL REFERENCES transaccion(id_transaccion) ON DELETE CASCADE,
    id_venta BIGINT NOT NULL REFERENCES venta(id_venta),
    valor_aplicado NUMERIC(15,2) NOT NULL CHECK (valor_aplicado > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================
-- Indices
-- =========================

CREATE INDEX IF NOT EXISTS idx_venta_id_cliente ON venta(id_cliente);
CREATE INDEX IF NOT EXISTS idx_venta_fecha_elaboracion ON venta(fecha_elaboracion);
CREATE INDEX IF NOT EXISTS idx_venta_fecha_vencimiento ON venta(fecha_vencimiento);

CREATE INDEX IF NOT EXISTS idx_transaccion_id_cliente ON transaccion(id_cliente);
CREATE INDEX IF NOT EXISTS idx_transaccion_fecha ON transaccion(fecha);
CREATE INDEX IF NOT EXISTS idx_transaccion_comisiones ON transaccion(comisiones);

CREATE INDEX IF NOT EXISTS idx_aplicacion_id_transaccion ON aplicacion_pago(id_transaccion);
CREATE INDEX IF NOT EXISTS idx_aplicacion_id_venta ON aplicacion_pago(id_venta);
CREATE INDEX IF NOT EXISTS idx_aplicacion_transaccion_venta ON aplicacion_pago(id_transaccion, id_venta);

-- =========================
-- Manejo de updated_at
-- =========================
-- Sin triggers: updated_at se actualiza desde el backend en cada UPDATE.

-- =========================
-- Validaciones de negocio
-- =========================
-- 1) Transaccion y venta deben ser del mismo cliente.
-- 2) SUM(aplicaciones por transaccion) <= transaccion.valor.
-- 3) SUM(aplicaciones por venta) <= venta.total.
-- Validacion sin triggers: estas reglas se ejecutan desde el backend
-- dentro de una transaccion SQL para mantener atomicidad y evitar carreras.

-- =========================
-- Vistas de saldos derivados
-- =========================

CREATE OR REPLACE VIEW vw_saldo_venta AS
SELECT
    v.id_venta,
    v.id_cliente,
    v.total,
    COALESCE(SUM(a.valor_aplicado), 0)::NUMERIC(15,2) AS total_aplicado,
    (v.total - COALESCE(SUM(a.valor_aplicado), 0))::NUMERIC(15,2) AS saldo_venta
FROM venta v
LEFT JOIN aplicacion_pago a ON a.id_venta = v.id_venta
GROUP BY v.id_venta, v.id_cliente, v.total;

CREATE OR REPLACE VIEW vw_saldo_transaccion AS
SELECT
    t.id_transaccion,
    t.id_cliente,
    t.valor,
    COALESCE(SUM(a.valor_aplicado), 0)::NUMERIC(15,2) AS total_aplicado,
    (t.valor - COALESCE(SUM(a.valor_aplicado), 0))::NUMERIC(15,2) AS saldo_transaccion
FROM transaccion t
LEFT JOIN aplicacion_pago a ON a.id_transaccion = t.id_transaccion
GROUP BY t.id_transaccion, t.id_cliente, t.valor;

CREATE OR REPLACE VIEW vw_saldo_cliente AS
SELECT
    c.id_cliente,
    c.identificacion,
    c.nombre,
    COALESCE(tt.total_transacciones, 0)::NUMERIC(15,2) AS total_transacciones,
    COALESCE(ta.total_aplicado, 0)::NUMERIC(15,2) AS total_aplicado,
    (COALESCE(tt.total_transacciones, 0) - COALESCE(ta.total_aplicado, 0))::NUMERIC(15,2) AS saldo_cliente
FROM cliente c
LEFT JOIN (
    SELECT
        t.id_cliente,
        SUM(t.valor) AS total_transacciones
    FROM transaccion t
    GROUP BY t.id_cliente
) tt ON tt.id_cliente = c.id_cliente
LEFT JOIN (
    SELECT
        t.id_cliente,
        SUM(a.valor_aplicado) AS total_aplicado
    FROM transaccion t
    JOIN aplicacion_pago a ON a.id_transaccion = t.id_transaccion
    GROUP BY t.id_cliente
) ta ON ta.id_cliente = c.id_cliente;

COMMIT;
