BEGIN;

-- =========================================================
-- Migracion 006: agregar comisiones a transaccion y fecha de vencimiento a venta
-- =========================================================
-- Cambios para bases existentes:
-- - transaccion.comisiones: valor monetario de comisiones asociadas a la transaccion
-- - venta.fecha_vencimiento: fecha limite de pago o vencimiento de la venta

ALTER TABLE public.transaccion
    ADD COLUMN IF NOT EXISTS comisiones NUMERIC(15,2);

ALTER TABLE public.venta
    ADD COLUMN IF NOT EXISTS fecha_vencimiento DATE;

UPDATE public.transaccion
   SET comisiones = COALESCE(comisiones, 0)
 WHERE comisiones IS NULL;

ALTER TABLE public.transaccion
    ALTER COLUMN comisiones SET DEFAULT 0,
    ALTER COLUMN comisiones SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transaccion_comisiones ON public.transaccion(comisiones);
CREATE INDEX IF NOT EXISTS idx_venta_fecha_vencimiento ON public.venta(fecha_vencimiento);

COMMIT;
