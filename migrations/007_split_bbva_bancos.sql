BEGIN;

-- Migracion 007: dividir BBVA en dos bancos
-- - BBVA actual pasa a ser BBVA 1819
-- - Se agrega BBVA 0605

UPDATE public.banco
   SET codigo = 'BBVA1819',
       nombre = 'BBVA 1819'
 WHERE codigo = 'BBVA';

INSERT INTO public.banco (codigo, nombre)
VALUES ('BBVA0605', 'BBVA 0605')
ON CONFLICT (codigo) DO UPDATE
SET nombre = EXCLUDED.nombre;

COMMIT;