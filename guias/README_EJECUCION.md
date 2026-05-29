# Sistema Cartera - Guía de Ejecución

## Descripción General

Sistema web para gestión de cartera con carga de datos desde Excel e integración con PostgreSQL en Neon.

**Stack:**
- Frontend: HTML5 + CSS3 + JavaScript (Tailwind CSS)
- Backend: Node.js + Express
- Base de Datos: PostgreSQL en Neon

---

## Requisitos Previos

- Node.js v14+ (incluye npm)
- PostgreSQL en Neon (configurado)
- Un navegador moderno

---

## Instalación y Ejecución

### 1. Instalar dependencias

```bash
npm install
```

Las dependencias ya incluyen:
- `express` - Framework web
- `pg` - Driver de PostgreSQL
- `cors` - Manejo de CORS

### 2. Inicializar Base de Datos

Ejecutar el script SQL en tu instancia de Neon:

```bash
# En pgAdmin o línea de comandos:
psql "$DATABASE_URL" < 001_init_schema.sql
psql "$DATABASE_URL" < 002_auth_users.sql
psql "$DATABASE_URL" < 003_currency_conversion.sql
```

Si prefieres, también puedes usar `NEON_DATABASE_URL` en lugar de `DATABASE_URL`.

Esto creará las tablas:
- `cliente`
- `venta`
- `transaccion`
- `aplicacion_pago`
- `users`
- `aplicacion_pago` recibe campos para conversión entre monedas

### 3. Iniciar el Servidor

```bash
npm start
```

Verás:
```
Servidor escuchando en puerto 3000
Abre http://localhost:3000/home.html en tu navegador
```

Si quieres crear un usuario nuevo para el login, ejecuta:

```bash
node crear_usuario.js <username> <password> [nombre visible]
```

El script usa `DATABASE_URL` o `NEON_DATABASE_URL` y guarda la contraseña con `scrypt`.

### 4. Acceder a la Aplicación

Abre tu navegador en: **http://localhost:3000/home.html**

---

## Flujo de Trabajo - Pestaña Ventas

1. **Cargar archivo Excel**
   - Botón "Cargar archivo" en la esquina superior derecha
   - Arrastra un .xlsx o haz clic para seleccionar
   - El sistema detectará automáticamente los headers

2. **Previsualizar datos**
   - Los registros se mostrarán en la sección "Preview de registros extraidos"
   - Verifica que los datos sean correctos

3. **Importar a Base de Datos**
   - Click en "Agregar al listado"
   - Se abrirá un modal de **progreso**
   - El sistema:
     - Crea clientes si no existen (basado en NIT)
     - Inserta registros en tabla `venta`
     - Muestra errores por fila si los hay

4. **Ver Resultados**
   - Modal con:
     - Total de registros procesados
     - Cantidad importada exitosamente
     - Errores encontrados (fila por fila)

5. **Filtrar y Visualizar**
   - Los datos importados aparecen en la tabla principal
   - Filtros por empleado, NIT y búsqueda global

---

## Estructura de Archivos

```
proyecto/
├── server.js              # Backend Express + APIs
├── app.js                 # Frontend JavaScript
├── styles.css             # Estilos CSS
├── home.html              # Página de inicio
├── ventas.html            # Pestaña de Ventas (importación)
├── transacciones.html     # Pestaña Transacciones (próxima)
├── reportes.html          # Pestaña Reportes (próxima)
├── 001_init_schema.sql    # Script de BD
├── package.json           # Dependencias Node
└── README.md              # Este archivo
```

---

## APIs Disponibles

### 1. Health Check
```
GET /api/health
Respuesta: { status: "ok", timestamp: "..." }
```

### 2. Importar Ventas
```
POST /api/ventas/import
Body: { records: [...] }
Respuesta: {
  success: true,
  total: 10,
  imported: 9,
  failed: 1,
  errors: [{ row: 5, error: "Comprobante es requerido" }]
}
```

### 3. Listar Ventas
```
GET /api/ventas
Respuesta: {
  success: true,
  total: 25,
  data: [{ id_venta, cliente_nombre, total, ... }]
}
```

---

## Mapeo de Campos Excel → Tabla Venta

El sistema detecta automáticamente estas columnas:

| Columna Excel | Campo BD | Requerido | Notas |
|---|---|---|---|
| NIT, Identificacion, Documento | cliente.identificacion | ✓ | Clave para crear/encontrar cliente |
| Cliente, Nombre, Empresa | cliente.nombre | ✓ | Se crea automáticamente |
| Tipo, Tipo Transaccion | venta.tipo_transaccion | - | |
| Comprobante, Referencia, Numero | venta.comprobante | ✓ | UNIQUE en BD |
| Fecha, Fecha Elaboracion | venta.fecha_elaboracion | - | Se intenta parsear a DATE |
| Total, Monto, Valor | venta.total | ✓ | Numérico > 0 |
| Sucursal | venta.sucursal | - | Se convierte a INTEGER |
| Estado, Estado Envio | venta.estado_envio_correo | - | |
| Moneda | venta.moneda | - | Default: COP |

---

## Validaciones de Negocio

- **NIT + Nombre requeridos**: Sin estos no se puede crear cliente
- **Comprobante requerido**: UNIQUE, no puede haber duplicados
- **Total > 0**: Montos negativos o cero se rechazan
- **Clientes reutilizables**: Si el NIT existe, se reutiliza el cliente
- **Transacciones atómicas**: Si hay error, se revierte todo

---

## Troubleshooting

### Conexión a Neon rechazada
```
Error: connect ECONNREFUSED
```
- Verifica la connection string en `server.js`
- Asegúrate de que el firewall permite la conexión
- Revisa que Neon esté activo en el proyecto

### Puerto 3000 en uso
```
Error: listen EADDRINUSE: address already in use :::3000
```
- Cambia el puerto en `server.js`: `const PORT = 3001;`
- O detén el proceso que usa 3000

### Tabla no existe
```
error: relation "venta" does not exist
```
- Ejecuta el script `001_init_schema.sql` en Neon
- Verifica que estés en la BD correcta (`neondb`)

---

## Próximos Pasos

- [ ] Importar Transacciones
- [ ] Crear aplicaciones de pago
- [ ] Generar reportes
- [ ] Dashboard de KPIs
- [ ] Autenticación de usuarios

---

## Contacto

Desarrollado para Sistema Cartera - Juan C.
