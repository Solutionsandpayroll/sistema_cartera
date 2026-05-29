# Guía de despliegue en Render

Esta guía explica cómo publicar el sistema en Render usando Neon como base de datos.

## 1. Requisitos previos

- Tener el proyecto subido a GitHub.
- Tener la base de datos ya creada en Neon.
- Tener acceso al panel de Render.
- Tener al menos un usuario creado en la tabla `users` para iniciar sesión.

## 2. Importante antes de desplegar

El backend actual funciona como un servidor Express tradicional y sirve el frontend desde el mismo proceso. Eso sí funciona en Render.

La base de datos se lee desde variables de entorno. No debe quedar ninguna cadena de Neon fija dentro de `server.js` ni en scripts auxiliares.

## 3. Variables de entorno en Render

En tu servicio web de Render configura estas variables:

- `NODE_ENV=production`
- `PORT` no hace falta definirla manualmente; Render la asigna.
- `DATABASE_URL` o `NEON_DATABASE_URL` con la cadena de conexión de Neon.

Si usas solo una, mantén una sola convención en todo el proyecto.

Para el script `crear_usuario.js`, usa la misma variable de entorno antes de ejecutarlo.

## 4. Crear el servicio en Render

1. Entra a Render.
2. Crea un nuevo **Web Service**.
3. Conecta tu repositorio de GitHub.
4. Selecciona la rama principal.
5. Usa estas configuraciones:
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
6. Guarda las variables de entorno.

## 5. Qué hace Render al arrancar

Con la configuración actual del proyecto, Render ejecuta `node server.js` a través de `npm start`, levanta Express y expone la app completa.

La app debe abrir desde la ruta raíz del servicio y redirigir al login si no hay sesión.

## 6. Migraciones de Neon

Antes de usar la app en producción, verifica que Neon tenga aplicados todos los scripts SQL:

1. `001_init_schema.sql`
2. `002_auth_users.sql`
3. `003_currency_conversion.sql`
4. `004_delete_cascade_aplicacion_pago.sql`
5. `005_add_transaccion_conversion_fields.sql`
6. `006_add_comisiones_y_fecha_vencimiento.sql`
7. `007_split_bbva_bancos.sql`
8. `008_add_transaccion_fantasma.sql`

Si falta alguna migración, el frontend puede arrancar pero varias pantallas y reportes fallarán al consultar la BD.

## 7. Crear un usuario de acceso

Si todavía no tienes usuarios en producción, crea uno contra Neon antes de probar el login.

Ejemplo:

```bash
node crear_usuario.js miusuario micontraseña "Nombre Visible"
```

Ese script debe ejecutarse usando la misma conexión a Neon que usarán Render y la aplicación.

## 8. Verificación posterior al despliegue

1. Abre la URL pública del servicio.
2. Revisa que `GET /api/health` responda correctamente.
3. Inicia sesión con el usuario creado.
4. Verifica ventas, transacciones y reportes.
5. Prueba una descarga o exportación para confirmar que los módulos de Excel funcionan.

## 9. Validaciones recomendadas

- Confirmar que el login persiste entre navegación y recarga.
- Confirmar que los reportes muestran montos por moneda y no mezclan COP con USD.
- Confirmar que los saldos positivos se calculan y visualizan sin cruces de moneda.
- Confirmar que la exportación de backup y reportes descarga archivos correctamente.

## 10. Problemas comunes

### Error de conexión a Neon

Revisa que la cadena de conexión esté en `DATABASE_URL` o `NEON_DATABASE_URL` y que tenga SSL habilitado.

### Página carga pero el login falla

Verifica que existan usuarios en la tabla `users` y que la contraseña haya sido generada con el script del proyecto.

### Las rutas HTML redirigen mal

Confirma que Render esté sirviendo el backend Node y no solo archivos estáticos.

### Los reportes muestran valores inesperados

Revisa que todas las migraciones estén aplicadas y que el frontend esté usando la lógica más reciente de separación por moneda.

## 11. Resumen corto

- Neon queda como base de datos.
- Render hospeda el servidor Node/Express.
- `npm install` como build.
- `npm start` como arranque.
- Variables de entorno para la conexión a BD.
- Migraciones completas antes de abrir producción.