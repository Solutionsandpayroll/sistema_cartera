# Inicio rapido - Levantar todo

Guia breve para levantar el sistema completo sin entrar en instalacion ni detalles extra.

## 1. Antes de arrancar

Verifica que ya tengas:

- Dependencias instaladas con `npm install`
- Base de datos creada con `001_init_schema.sql`
- Connection string configurada en `server.js`

## 2. Levantar el backend y el front

```bash
npm start
```

Eso levanta Express, sirve los archivos estaticos del proyecto y deja disponible la app en:

```text
http://localhost:3000/home.html
```

## 3. Orden recomendado para validar que todo quedo arriba

1. Abre `http://localhost:3000/api/health` y confirma que responde `status: ok`.
2. Abre `http://localhost:3000/home.html` en el navegador.
3. Entra a la pestaña de ventas.
4. Descarga la plantilla de prueba si la necesitas desde `/api/ventas/descargar-plantilla`.
5. Importa un archivo y revisa que el flujo termine sin errores.

## 4. Que esta levantando cada parte

- Frontend: `index.html`, `home.html`, `ventas.html`, `transacciones.html`, `reportes.html`
- Estilos y comportamiento: `styles.css` y `app.js`
- Backend: `server.js`
- Base de datos: `001_init_schema.sql`

## 5. Si algo falla

- Si no responde la API, revisa `server.js`.
- Si falla la conexion a BD, revisa la connection string y Neon.
- Si falta una tabla, vuelve a ejecutar `001_init_schema.sql`.