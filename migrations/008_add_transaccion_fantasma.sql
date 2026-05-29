BEGIN;

CREATE TABLE IF NOT EXISTS transaccion_fantasma (
    id_fantasma BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fecha TIMESTAMPTZ NOT NULL,
    nombre TEXT,
    descripcion TEXT,
    referencia TEXT,
    documento TEXT,
    valor NUMERIC(15,2) NOT NULL CHECK (valor > 0),
    moneda TEXT NOT NULL DEFAULT 'COP',
    id_banco BIGINT,
    soporte BOOLEAN,
    tipo_cambio NUMERIC(18,6),
    moneda_referencia TEXT,
    valor_equivalente NUMERIC(15,2),
    id_cliente_resuelto BIGINT REFERENCES cliente(id_cliente) ON DELETE SET NULL,
    id_venta_resuelta BIGINT REFERENCES venta(id_venta) ON DELETE SET NULL,
    id_transaccion_resuelta BIGINT REFERENCES transaccion(id_transaccion) ON DELETE SET NULL,
    estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'resuelto', 'descartado')),
    origen TEXT NOT NULL DEFAULT 'importacion',
    observaciones TEXT,
    raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_transaccion_fantasma_estado
    ON transaccion_fantasma(estado, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transaccion_fantasma_cliente_resuelto
    ON transaccion_fantasma(id_cliente_resuelto);

CREATE INDEX IF NOT EXISTS idx_transaccion_fantasma_venta_resuelta
    ON transaccion_fantasma(id_venta_resuelta);

CREATE INDEX IF NOT EXISTS idx_transaccion_fantasma_transaccion_resuelta
    ON transaccion_fantasma(id_transaccion_resuelta);

COMMIT;