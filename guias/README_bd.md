# Sistema de Gestión de Ventas, Transacciones y Aplicación de Pagos

## Descripción General

Este sistema modela un flujo financiero donde existen:

- Ventas: representan deudas de los clientes
- Transacciones: representan pagos realizados por los clientes
- Aplicaciones de pago: representan la distribución de un pago sobre una o varias ventas

El modelo permite manejar:

- Pagos parciales
- Pagos distribuidos entre múltiples ventas
- Múltiples pagos sobre una misma venta
- Sobrepagos (saldos a favor del cliente)

---

## Modelo Relacional

### Entidad: cliente

- id_cliente: entero, clave primaria  
- identificacion: texto, único, obligatorio  
- nombre: texto, obligatorio  

---

### Entidad: venta

- id_venta: entero, clave primaria  
- id_cliente: entero, clave foránea hacia cliente  
- tipo_transaccion: texto  
- comprobante: texto, único  
- fecha_elaboracion: fecha  
- sucursal: entero  
- estado_envio_correo: texto  
- total: decimal (15,2), obligatorio  
- moneda: texto  

---

### Entidad: transaccion

- id_transaccion: entero, clave primaria  
- id_cliente: entero, clave foránea hacia cliente  
- fecha: fecha/hora, obligatorio  
- nombre: texto  
- descripcion: texto  
- referencia: texto, opcional  
- documento: texto  
- valor: decimal (15,2), obligatorio  
- moneda: texto  
- soporte: booleano  

---

### Entidad: aplicacion_pago

- id_aplicacion: entero, clave primaria  
- id_transaccion: entero, clave foránea hacia transaccion  
- id_venta: entero, clave foránea hacia venta  
- valor_aplicado: decimal (15,2), obligatorio  

---

## Relaciones

- Un cliente puede tener múltiples ventas  
- Un cliente puede tener múltiples transacciones  
- Una transacción puede aplicarse a múltiples ventas  
- Una venta puede recibir pagos de múltiples transacciones  
- La relación entre transacción y venta se gestiona mediante la tabla aplicacion_pago  

---

## Reglas de Negocio

### 1. Consistencia por cliente

Toda transacción solo puede aplicarse a ventas del mismo cliente.

Regla:
transaccion.id_cliente debe ser igual a venta.id_cliente

---

### 2. Límite de aplicación por transacción

La suma de los valores aplicados desde una transacción no puede exceder el valor total de dicha transacción.

Regla:
SUM(valor_aplicado por transacción) <= transaccion.valor

---

### 3. Límite de pago por venta

La suma de los valores aplicados a una venta no puede exceder el total de la venta.

Regla:
SUM(valor_aplicado por venta) <= venta.total

---

### 4. Manejo de sobrepagos (saldo a favor)

Se permite que una transacción tenga un valor mayor al total aplicado a ventas.

La diferencia se considera saldo a favor del cliente y puede utilizarse en futuras aplicaciones.

---

## Campos Derivados (No Persistentes)

Los siguientes valores no deben almacenarse en la base de datos. Deben calcularse dinámicamente.

### Saldo de una venta

saldo_venta = venta.total - SUM(valor_aplicado a esa venta)

---

### Saldo disponible de una transacción

saldo_transaccion = transaccion.valor - SUM(valor_aplicado desde esa transacción)

---

### Saldo a favor por cliente

saldo_cliente = SUM(transacciones del cliente) - SUM(aplicaciones del cliente)

---

## Comportamiento del Sistema

- Una transacción puede crearse sin aplicaciones iniciales  
- Las aplicaciones de pago se registran progresivamente  
- El sistema debe validar todas las reglas de integridad antes de persistir datos  
- El saldo a favor se calcula, no se almacena  
- El sistema debe permitir consultas como:
  - saldo pendiente por venta  
  - historial de pagos de una venta  
  - distribución de una transacción  
  - saldo a favor por cliente  

---

## Consideraciones Técnicas

- Usar tipo DECIMAL para valores monetarios  
- Evitar almacenar datos derivados  
- Implementar validaciones en backend  
- Opcionalmente, usar vistas en base de datos para consultas frecuentes  

---

## Objetivo del Diseño

Este modelo busca:

- Mantener consistencia de datos  
- Evitar redundancia  
- Permitir flexibilidad en pagos  
- Soportar escenarios reales de negocio (pagos parciales, cruzados y sobrepagos)  
- Facilitar consultas financieras y trazabilidad completa  