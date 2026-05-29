BEGIN;

-- =========================================================
-- Soporte de conversión entre moneda de transacción y moneda de venta
-- =========================================================
-- Se agregan campos a aplicacion_pago para guardar:
-- - el valor aplicado en la moneda de la venta
-- - el valor equivalente en la moneda de la transacción
-- - la tasa de conversión usada al momento de la aplicación

ALTER TABLE aplicacion_pago
    ADD COLUMN IF NOT EXISTS valor_aplicado_transaccion NUMERIC(15,2),
    ADD COLUMN IF NOT EXISTS tipo_cambio NUMERIC(18,6);

ALTER TABLE transaccion
    ADD COLUMN IF NOT EXISTS tipo_cambio NUMERIC(18,6),
    ADD COLUMN IF NOT EXISTS moneda_referencia TEXT,
    ADD COLUMN IF NOT EXISTS valor_equivalente NUMERIC(15,2);

UPDATE aplicacion_pago
   SET valor_aplicado_transaccion = COALESCE(valor_aplicado_transaccion, valor_aplicado),
       tipo_cambio = COALESCE(tipo_cambio, 1)
 WHERE valor_aplicado_transaccion IS NULL
    OR tipo_cambio IS NULL;


-- La vista de transacciones utiliza valor_aplicado_transaccion cuando existe
-- y, como compatibilidad hacia atrás, cae a valor_aplicado en registros antiguos.

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
    COALESCE(SUM(COALESCE(a.valor_aplicado_transaccion, a.valor_aplicado)), 0)::NUMERIC(15,2) AS total_aplicado,
    (t.valor - COALESCE(SUM(COALESCE(a.valor_aplicado_transaccion, a.valor_aplicado)), 0))::NUMERIC(15,2) AS saldo_transaccion
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
        SUM(COALESCE(a.valor_aplicado_transaccion, a.valor_aplicado)) AS total_aplicado
    FROM transaccion t
    JOIN aplicacion_pago a ON a.id_transaccion = t.id_transaccion
    GROUP BY t.id_cliente
) ta ON ta.id_cliente = c.id_cliente;

COMMIT;
