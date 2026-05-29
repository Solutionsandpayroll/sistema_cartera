-- =========================================================
-- Migracion 004: borrar aplicaciones de pago en cascada al eliminar una transaccion
-- =========================================================
-- Esta migracion actualiza la FK existente para que una transaccion pueda eliminarse
-- junto con sus aplicaciones asociadas sin dejar registros huérfanos.

ALTER TABLE public.aplicacion_pago
    DROP CONSTRAINT IF EXISTS fk_aplicacion_pago_transaccion;

DO $$
DECLARE
    fk_name text;
BEGIN
    SELECT c.conname
      INTO fk_name
      FROM pg_constraint c
      JOIN pg_class rel ON rel.oid = c.conrelid
      JOIN pg_namespace ns ON ns.oid = rel.relnamespace
      JOIN pg_class ref ON ref.oid = c.confrelid
      JOIN pg_namespace refns ON refns.oid = ref.relnamespace
     WHERE c.contype = 'f'
       AND ns.nspname = 'public'
       AND rel.relname = 'aplicacion_pago'
       AND ref.relname = 'transaccion'
       AND EXISTS (
             SELECT 1
               FROM unnest(c.conkey) attnum
               JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = attnum
              WHERE att.attname = 'id_transaccion'
       )
       AND EXISTS (
             SELECT 1
               FROM unnest(c.confkey) attnum
               JOIN pg_attribute att ON att.attrelid = ref.oid AND att.attnum = attnum
              WHERE att.attname = 'id_transaccion'
       )
     LIMIT 1;

    IF fk_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.aplicacion_pago DROP CONSTRAINT %I', fk_name);
    END IF;
END $$;

ALTER TABLE public.aplicacion_pago
    ADD CONSTRAINT fk_aplicacion_pago_transaccion
    FOREIGN KEY (id_transaccion)
    REFERENCES public.transaccion(id_transaccion)
    ON DELETE CASCADE;
