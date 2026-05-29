# Brief UX/UI para Stitch

Objetivo
Generar un nuevo proyecto con una experiencia visual y de interacción muy similar al sistema S&P Gestión actual: dashboard operativo corporativo, claro, limpio, con acentos fuertes y visualización de datos.

## 1) Dirección visual general

Estilo base
- Dashboard administrativo corporativo.
- Sensación: profesional, técnico, ordenado, con acentos energéticos.
- Diseño orientado a productividad: mucha legibilidad, jerarquía clara, acciones visibles.

Modo de color
- Base clara (modo principal).
- Existe compatibilidad dark-mode en clases Tailwind, pero la experiencia principal está pensada en claro.

Personalidad visual
- Predominio de fondos neutros muy claros.
- Color primario oscuro para estructura y navegación.
- Color acento vibrante para CTAs, estados importantes y foco.

## 2) Layout de dashboard

Estructura macro
- Sidebar fijo a la izquierda de 256px aprox.
- Área principal a la derecha con header sticky superior.
- Contenido en scroll interno dentro del área principal.

Patrón de navegación
- Sidebar con logo arriba, items de menú al centro, estado de sesión + acción login/logout abajo.
- Item activo destacado con fondo translúcido blanco sobre sidebar primario.
- Íconos Material Symbols + etiquetas cortas.

Header de contenido
- Encabezado con título de módulo + subtítulo contextual.
- Acción primaria en botón destacado (acento).
- Fondo blanco con borde inferior sutil.

Bloques de contenido
- Tarjetas KPI.
- Tablas de gestión con buscador, filtros y paginación.
- Modales centrados para CRUD.
- Badges para estado/rol/prioridad.
- Toasts o banners de feedback.

## 3) Sistema de color (tokens)

Paleta principal detectada
- primary: #102a47
- accent: #e51148
- background-light: #f6f7f8
- background-dark: #13191f

Neutrales y soporte
- Grises tipo Slate para superficies, bordes y texto secundario.
- Uso frecuente de transparencias del primary/accent para capas suaves.

Gradientes usados
- Login y elementos hero: gradientes radiales y overlays suaves.
- Botones CTA y barras de progreso: gradientes lineales con mezcla primary + accent.

Regla de uso
- Primary: estructura, navegación, títulos y elementos de marca.
- Accent: acciones primarias, alertas visuales, indicadores de atención.
- Neutrales: superficie, divisores, estados pasivos.

## 4) Tipografía e iconografía

Fuente principal
- Outfit (Google Fonts), pesos amplios desde regular hasta black.
- Uso notable de pesos altos en títulos, KPIs y CTAs.

Escala visual
- html con base ampliada a 110% para mejor legibilidad.
- Títulos con pesos 800-900.
- Texto de interfaz en 12-16px equivalente Tailwind.

Iconografía
- Material Symbols Outlined.
- Íconos integrados en navegación, botones, labels y feedbacks.

## 5) Tecnología front-end empleada

Stack de UI
- HTML multipágina.
- Tailwind CSS vía CDN con tailwind.config embebido por página.
- CSS custom embebido para refinamientos visuales y animaciones.
- JavaScript vanilla (sin framework SPA).
- Chart.js en el módulo de Ahorros para gráficos.

Patrón técnico
- Design tokens repetidos en Tailwind config local por vista.
- Lógica de estado de sesión/rol para visibilidad de módulos.
- Fetch API para consumo de backend.

## 6) Componentes y patrones UI

Sidebar
- Fondo primary, texto blanco con distintas opacidades.
- Hover con fondo translúcido.
- Activo con contraste más alto.

Cards KPI
- Fondo blanco, borde sutil, sombra leve.
- Hover con incremento de sombra.
- Encabezado con ícono en cápsula de color tenue.

Tablas
- Header en gris claro, texto uppercase pequeño y tracking.
- Filas con separadores finos.
- Hover de fila muy sutil en tono primary translúcido.
- Estado vacío con ícono grande y texto de ayuda.

Formularios
- Inputs con borde suave, fondo claro, foco con ring y/o borde accent.
- Botones primarios robustos, redondeado medio, peso tipográfico alto.

Modales
- Overlay oscuro semitransparente.
- Contenedor white/dark, esquinas redondeadas grandes, sombra marcada.
- Cierre en esquina superior.

Estados y etiquetas
- Badges de rol y estado.
- Chips para filtros en Ahorros.
- Colores semánticos por prioridad/estado con contraste alto.

## 7) Motion y animaciones

Enfoque general
- Microinteracciones funcionales, no decorativas en exceso.
- Énfasis en feedback de acción, carga y transición de componentes.

Animaciones detectadas

  - float-a, float-b, float-c para orbes decorativos.
  - slideUp para entrada de tarjeta.
  - shake para error.
  - spin para loading en botones.

  - pulse-once para adjuntos/descargas.

  - pulseGlow, shimmer, scaleIn, float1, float2.
  - actFadeUp, labelPop, chipPulse, glowLine, scanline.
  - Transiciones de barras de progreso y arcos SVG con easing suave.

Curvas y timing
- Duraciones cortas para hover/active: ~150-200ms.
- Entradas de bloques: ~500-600ms.
- Animaciones de data-viz: ~1.8s a 2.2s para percepción progresiva.

## 8) Data visualization (Ahorros)

Patrones de visualización
- Tarjetas destacadas de ejecutado vs proyectado.
- Barra de progreso con marcador y shimmer.
- Radial SVG en anillos con gradientes y efectos glow.
- Leyendas compactas y jerarquía numérica fuerte.

Tratamiento numérico
- Monoespaciada para algunos labels de monto (estética tipo panel técnico).
- Números grandes con peso alto para impacto.

## 9) Reglas de consistencia para replicar en proyecto nuevo

Espaciado y forma
- Espaciado generoso en layout principal.
- Border radius consistente: 8px, 12px, 16px, full para pills.

Bordes y sombras
- Bordes finos en neutros claros.
- Sombras suaves por defecto y una sombra más intensa en CTA/KPI relevantes.

Interactividad
- Todo control clicable debe tener feedback visual inmediato: hover, active o focus.
- Foco accesible con ring visible.

Jerarquía
- Título de módulo siempre arriba y visible.
- Acción primaria en header.
- Datos críticos en cards superiores.
- Listados y detalle debajo.

## 10) Prompt sugerido para Stitch

Construye una interfaz web de dashboard administrativo corporativo en español, con layout de sidebar fija izquierda y main content con header sticky. Usa una estética clara y profesional con alto contraste y legibilidad.

Sistema visual obligatorio:
- Colores: primary #102a47, accent #e51148, background #f6f7f8.
- Tipografía: Outfit con pesos altos para títulos y KPIs.
- Iconografía tipo Material Symbols Outlined.
- Componentes: sidebar navegable, cards KPI, tablas con buscador y paginación, modales CRUD, badges de estado, toasts.
- Interacciones: hover y active claros en botones, foco visible en inputs, microanimaciones suaves.
- Motion: entrada de tarjetas (scale/slide), shimmer en barras de progreso, pulsos sutiles en elementos destacados, loading spinner en acciones async.
- Visualización (pestañas): Ventas, Transacciones, Reportes
Lineamientos UX:
- Priorizar productividad y escaneo rápido de información.
- Mantener jerarquía clara y consistencia de espaciado/radios/bordes.
- Mostrar estados vacíos y mensajes de ayuda.
- Mantener diseño responsive desktop-first con adaptación a mobile.

Tecnología objetivo sugerida para el nuevo proyecto:
- Tailwind CSS + JavaScript/TypeScript.
- Posibilidad de usar Chart.js o librería equivalente para gráficas.

