# Plan de Implementación - Plataforma de Control de Cartera

## 1) Objetivo del proyecto
Construir una plataforma web (dashboard) para gestionar cartera con:
- CRUD de clientes, ventas, transacciones y aplicaciones de pago
- Carga de transacciones bancarias mediante archivos planos
- Reglas de negocio financieras estrictas
- Reportes operativos y financieros por cliente y fecha de corte
- Consulta clara de abonos y deudas
- Arquitectura estable, escalable y no monolítica

Stack base:
- Frontend: HTML + CSS (Tailwind recomendado; Bootstrap opcional)
- Backend: Node.js + Express
- Base de datos: PostgreSQL en Neon

---

## 2) Principios de arquitectura (NO monolítica)
Para evitar un monolito rígido, se propone iniciar con un **monolito modular** (modular monolith) con límites de dominio claros. Esto da velocidad al inicio y permite extraer servicios después sin reescribir todo.

Dominios (módulos) sugeridos:
- modulo-clientes
- modulo-ventas
- modulo-transacciones
- modulo-importacion-bancaria
- modulo-aplicaciones
- modulo-reportes
- modulo-auth (si aplica control de usuarios/roles)
- modulo-auditoria (bitácora de cambios)

Regla técnica clave:
- Cada módulo expone interfaces (servicios/casos de uso) y no accede directamente a internals de otros módulos.

---

## 3) Diseño de datos para Neon (basado en README)
Modelo confirmado en README:
- cliente
- venta
- transaccion
- aplicacion_pago

Reglas de negocio críticas a implementar en backend y reforzar en BD cuando aplique:
1. Consistencia por cliente: transacción y venta deben pertenecer al mismo cliente.
2. Límite por transacción: suma aplicada <= valor de transacción.
3. Límite por venta: suma aplicada <= total de venta.
4. Sobrepago permitido: saldo a favor se calcula, no se persiste.

Decisiones para Neon/Postgres:
- Tipos monetarios: NUMERIC(15,2)
- PKs: BIGINT GENERATED ALWAYS AS IDENTITY
- Timestamps: TIMESTAMPTZ
- Índices para consultas de saldo y reportes
- Views para saldos derivados (opcional en v1, recomendado en v1.1)
- Migraciones versionadas desde el día 1

---

## 4) Estructura sugerida del repositorio
```text
sistema_cartera/
  apps/
    web/                      # Dashboard (Tailwind o Bootstrap)
    api/                      # Express API
  packages/
    domain/                   # Entidades, reglas y casos de uso
    data-access/              # Repositorios SQL (Postgres)
    shared/                   # Utilidades comunes, tipos, errores
  infra/
    db/
      migrations/             # SQL versionado
      seeds/                  # Datos base/pruebas
      views/                  # Vistas de reportes
  docs/
    arquitectura/
    api/
    decisiones-tecnicas/
```

---

## 5) Plan paso a paso (implementación minuciosa)

## Fase 0 - Alineación funcional (1-2 días)
Entregables:
- Catálogo de procesos (crear/modificar/anular ventas, importar transacciones bancarias en plano, aplicar pagos)
- Definición de estados de negocio (venta vigente, pagada parcial, pagada total, etc.)
- Definición de formatos de archivo plano bancario (columnas, separador, codificación, validaciones)
- Priorización MVP vs Fase 2

Criterio de salida:
- Historias de usuario priorizadas y validadas.

## Fase 1 - Base técnica y repositorio (1 día)
Entregables:
- Estructura de carpetas modular
- Estándares: lint, format, manejo de errores, variables de entorno
- Pipeline básico CI (build + tests)

Criterio de salida:
- Proyecto ejecutable localmente con comandos únicos.

## Fase 2 - Base de datos Neon v1 (2-3 días)
Entregables:
- Script SQL de creación de tablas y constraints
- Índices iniciales
- Migración inicial y rollback
- Seed mínimo para pruebas funcionales

Criterio de salida:
- Esquema desplegado en Neon dev y consultas básicas OK.

## Fase 3 - Núcleo de dominio (2-4 días)
Entregables:
- Casos de uso por módulo
- Validaciones de reglas de negocio del README
- Cálculo de saldos en tiempo real (sin persistencia de derivados)
- Reglas de idempotencia para evitar duplicados al importar planos

Criterio de salida:
- Pruebas unitarias de reglas financieras críticas.

## Fase 4 - API REST (3-5 días)
Entregables:
- Endpoints CRUD:
  - /clientes
  - /ventas
  - /transacciones
  - /aplicaciones
- Endpoints de importación:
  - POST /transacciones/importar-plano
  - GET /transacciones/importaciones/:id
- Endpoints de consulta:
  - saldo pendiente por venta
  - historial de pagos de venta
  - distribución de transacción
  - saldo a favor por cliente
  - abonos y deuda por cliente a fecha de corte
- Validación, paginación y filtros

Criterio de salida:
- Contrato API documentado y validado con tests de integración.

## Fase 5 - Dashboard web MVP (4-6 días)
Entregables:
- Vistas de gestión para clientes, ventas, transacciones y aplicaciones
- Flujo de carga y validación de archivo plano bancario
- Flujo guiado para aplicar transacciones a ventas
- Vista de reportes iniciales
- Feedback visual de validaciones y errores

Criterio de salida:
- Usuario operativo puede registrar ciclo completo sin usar Postman.

## Fase 6 - Reportería y trazabilidad (2-4 días)
Entregables:
- Reportes exportables (CSV/Excel en v1)
- Filtros por fecha de corte, cliente, sucursal, estado
- Reporte de abonos y deudas por cliente
- Bitácora de eventos clave (auditoría)

Criterio de salida:
- Reportes consistentes con cifras del sistema.

## Fase 7 - Seguridad y hardening (2-3 días)
Entregables:
- Autenticación (JWT o sesión)
- Autorización por rol
- Protección básica: rate limit, validación de payload, CORS, headers

Criterio de salida:
- Checklist OWASP básico cubierto para MVP.

## Fase 8 - QA, performance y salida a producción (2-4 días)
Entregables:
- Tests E2E críticos
- Afinación de consultas SQL e índices
- Estrategia backup/restore
- Despliegue de entornos dev/stg/prod

Criterio de salida:
- Go-live con monitoreo y plan de rollback.

---

## 6) Diseño de API inicial (borrador)
Recursos principales:
- GET/POST/PUT/DELETE /clientes
- GET/POST/PUT/DELETE /ventas
- GET/POST/PUT/DELETE /transacciones
- GET/POST/DELETE /aplicaciones
- POST /transacciones/importar-plano
- GET /transacciones/importaciones/:id

Consultas de negocio:
- GET /reportes/saldo-venta/:id_venta
- GET /reportes/historial-pagos/:id_venta
- GET /reportes/distribucion-transaccion/:id_transaccion
- GET /reportes/saldo-cliente/:id_cliente
- GET /reportes/cliente/:id_cliente/corte/:fecha_corte
- GET /reportes/cartera/corte/:fecha_corte

---

## 7) Reglas técnicas obligatorias
- No guardar saldos derivados en tablas transaccionales.
- Toda aplicación de pago debe ejecutarse en transacción SQL (BEGIN/COMMIT/ROLLBACK).
- Validaciones de límites de pago deben ser atómicas para evitar race conditions.
- Registrar timestamps de creación/modificación.
- Centralizar manejo de errores con códigos de negocio.

---

## 8) Roadmap sugerido (sprints)
- Sprint 1: Fases 0, 1 y 2
- Sprint 2: Fases 3 y 4
- Sprint 3: Fase 5
- Sprint 4: Fases 6, 7 y 8

---

## 9) Criterios de aceptación MVP
- Se puede registrar una venta y cargar transacciones bancarias desde archivo plano.
- Se puede aplicar una transacción parcial o total a una o varias ventas.
- El sistema bloquea sobreaplicaciones inválidas.
- El sistema permite sobrepago de transacción como saldo disponible.
- Se puede consultar saldo por venta, saldo por cliente y estado de cartera a fecha de corte.
- Se pueden consultar abonos y deudas por cliente.
- Reportes básicos funcionales.

---

## 10) Siguiente paso propuesto
Con tu aprobación de este plan, el siguiente entregable sería:
1. Crear migración SQL v1 para Neon (tablas, constraints, índices).
2. Definir especificación del archivo plano bancario e importador inicial.
3. Levantar esqueleto de API Express modular.
4. Construir primer flujo end-to-end: cliente -> venta -> importación de transacciones -> aplicación -> reporte de saldo y corte.
