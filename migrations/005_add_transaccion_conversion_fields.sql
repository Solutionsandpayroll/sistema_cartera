-- =========================================================
-- Migracion 005: agregar campos de conversion a transaccion
-- =========================================================
-- Esta migracion corrige bases existentes que aun no tienen las columnas
-- necesarias para guardar la tasa de cambio y su equivalente.

ALTER TABLE public.transaccion
    ADD COLUMN IF NOT EXISTS tipo_cambio NUMERIC(18,6),
    ADD COLUMN IF NOT EXISTS moneda_referencia TEXT,
    ADD COLUMN IF NOT EXISTS valor_equivalente NUMERIC(15,2);

UPDATE public.transaccion
   SET tipo_cambio = COALESCE(tipo_cambio, 1),
       moneda_referencia = COALESCE(moneda_referencia, moneda, 'COP'),
       valor_equivalente = COALESCE(valor_equivalente, valor)
 WHERE tipo_cambio IS NULL
    OR moneda_referencia IS NULL
    OR valor_equivalente IS NULL;
