# Auditoría y plan por fases

Fecha de la auditoría: 20/09/2026 · Base: repositorio `sin_el_ok_para_migrar_despues` (commit `3c25ac4`) + trabajo en curso.
Reglas de trabajo: [`CLAUDE.md`](../CLAUDE.md).

Leyenda: ✅ hecho y probado · 🟡 parcial / en curso · ⬜ no existe

## 1. Qué existe hoy

| Área | Estado real |
|---|---|
| Base de datos | `profiles`, `classes`, `entitlements`, `video_progress`; RLS en todas; privilegios por columna (los IDs de Bunny no son legibles); `can_access_class()`, `save_progress()`; bucket de miniaturas. **Probado en PostgreSQL** con esquema de Supabase simulado |
| Backend | 6 Edge Functions (`admin-create-upload`, `admin-sync-video`, `admin-delete-class`, `playback`, `bunny-webhook`, `health`) con puertos/adaptadores; **43 pruebas** (firma idéntica a la oficial de Bunny, permisos, errores) |
| Frontend | Sitio estático original. **En curso**: cliente Supabase, sesión, modal de acceso, reproductor HLS, tarjetas, guardado de progreso (código escrito, aún sin pruebas de navegador) |
| Pagos / tienda | No existe nada |

## 2. Huecos concretos frente a los 17 puntos

| # | Requisito | Estado | Hueco concreto |
|---|---|---|---|
| 1 | Registro, login, logout, perfil, recuperación, sesión persistente | ✅ | Probado en navegador. Falta solo probar el cambio de contraseña desde el enlace del correo |
| 2 | Catálogo real desde Supabase | ✅ | Home y videoteca con datos reales; carga, error, vacío y filtros probados |
| 3 | Videoteca protegida | ✅ | `playback` protege en servidor; sin sesión, sin acceso y con acceso probados |
| 4 | Reproductor hls.js | ✅ | Probado en Chromium con HLS real de 2 calidades |
| 5 | URLs firmadas y renovación | ✅ | Firma verificada contra Bunny; renovación probada (vencida al cargar, siempre vencida y preventiva) |
| 6 | Progreso (debounce, pausa, cambio de página, fin) | ✅ | 11 pruebas unitarias + E2E de guardado periódico, al pausar, al salir (keepalive) y al terminar |
| 7 | "Continuar viendo" | ✅ | Sección en la videoteca, probada |
| 8 | Panel de negocio y panel técnico separados | 🟡 | `/panel` existe (rol `owner`/`developer`) con listado y publicar/despublicar; **falta** `/interno` |
| 9 | Crear, editar, publicar, despublicar, eliminar clases | 🟡 | Crear + subir video ✅, publicar/despublicar ✅ (todo con interfaz y auditado); **falta** editar metadatos de una clase ya creada; **borrado sigue siendo físico** (contra la regla, aunque ya tiene botón en el panel) |
| 10 | Subida directa a Bunny con progreso | ✅ | Interfaz en `/panel` con barra de progreso, cancelar, reintentar y subida reanudable (TUS) |
| 11 | Estados de vídeo | 🟡 | Hay 5 (`pending, uploading, processing, ready, failed`); **falta `abandoned`** |
| 12 | Reintentos y reconciliación | 🟡 | Webhook + sincronización manual + retomar/reemplazar; **falta la reconciliación programada** y detectar subidas abandonadas y huérfanos en Bunny |
| 13 | Base para pagos y entitlements | 🟡 | `entitlements` y `can_access_class()` ✅; **sin altas/bajas por casos de uso ni auditoría** |
| 14 | Tests unitarios, integración y E2E | 🟡 | 46 de backend (con contrato), 16 del frontend y 23 E2E; **faltan** integración entre módulos y contratos del resto |
| 15 | Tres niveles de acceso | 🟡 | **Hecho y probado:** roles `user`/`owner`/`developer`, guardas `requireOwner`/`requireDeveloper`, cambios de rol solo por desarrolladores, historial de auditoría inmutable. **Falta:** las superficies (paneles `/panel` e `/interno`) |
| 16 | Modularización con contratos | 🟡 | Patrón puertos/adaptadores en backend; **sin contratos formales, sin pruebas de contrato, sin regla anti-ciclos** |
| 17 | Cobros digitales y físicos | ⬜ | Sin productos, pedidos, stock, envíos, devoluciones, proveedores ni webhooks de pago |

**Transversales que faltan:** rate limiting · idempotencia de operaciones administrativas · historial de auditoría ·
reproducibilidad (Deno sin versión exacta, `deno.lock` no versionado, sin `.nvmrc`, sin CI) ·
12 enlaces `href="#"` y datos de ejemplo (cursos, clases en vivo, tienda, carrito, 14 imágenes de Unsplash) ·
sin CSP ni cabeceras de seguridad en producción.

## 3. Plan por fases

Cada fase se cierra con formato + lint + typecheck + tests + build, y una prueba ejecutable de su alcance.

### Fase 0 · Reproducibilidad (parte de la primera entrega)
- **Archivos:** `.nvmrc` (Node 22), `package.json` (`engines` y `deno` con versión exacta, sin `^`), `supabase/functions/deno.lock` versionado y `--frozen` en los scripts, `.github/workflows/ci.yml`.
- **Migraciones:** ninguna.
- **Pruebas:** en un clon limpio, `nvm use && npm ci && npm run verify` da el mismo resultado; CI en verde.

### Fase 1 · Frontend público (resto de la primera entrega)
- **Archivos:** `js/lib/*`, `js/ui/*`, `js/components/*` (escritos), `js/pages/{home,videoteca,clase,cuenta}.js`, `videoteca.html`, `clase.html`, `cuenta.html`, `css/app.css`; cambios mínimos en `index.html` ya aplicados (enlaces reales, sin manejadores inline).
- **Migraciones:** ninguna.
- **Pruebas:** unitarias (`ProgressReporter`, formato, errores, configuración) y E2E en navegador real con backend simulado y HLS real: **carga, error, catálogo vacío, acceso denegado, video no listo, URL expirada con renovación, guardado de progreso y retomar**.

### Fase 2 · Roles, modularización base y controles transversales  _(roles y auditoría: hechos · pendiente: rate limiting, idempotencia y contratos formales)_
- **Archivos:** `supabase/functions/_modules/*` (contratos `index.ts`), `_modules/common` (rate limiting, idempotencia, auditoría), guardas `requireOwner/requireDeveloper`, regla anti-ciclos verificada en CI.
- **Migración:** roles `user | owner | developer`; `is_owner()`, `is_developer()` (`is_admin()` queda como alias temporal); tabla `audit_log` (solo inserción); tabla `idempotency_keys`; contadores de `rate_limits`.
- **Pruebas:** matriz de permisos por rol en SQL; pruebas de contrato de cada módulo; de "acceso denegado" por nivel; de rate limit e idempotencia.

### Fase 3 · Ciclo de vida del vídeo y reconciliación
- **Migración:** estado `abandoned`; `classes.deleted_at` (borrado lógico); `video_events`; `reconciliation_runs`.
- **Archivos:** función programada `reconcile-videos` (Supabase cron): marca subidas abandonadas (pendientes > 24 h), detecta videos huérfanos en Bunny y filas sin video, purga tras un período de gracia.
- **Pruebas:** unitarias con Bunny simulado (huérfano, faltante, abandonado, reintento) y de integración separada, omitida sin credenciales.

### Fase 4 · Panel de negocio (`/panel`, rol `owner`)  _(hecha: catálogo, crear clase, subir video, publicar/despublicar, eliminar)_
- **Archivos:** `panel.html` + `js/pages/panel.js` + `js/ui/class-form-modal.js` (crear/reintentar con barra de progreso vía TUS); todo reutiliza funciones ya escritas en `js/lib/api.js` (`adminListClasses/CreateUpload/SyncVideo/UpdateClass/DeleteClass`, `uploadVideoToBunny`, `resizeImage`, `uploadThumbnail`) — no hizo falta backend nuevo. Auditoría de publicar/despublicar por trigger de base (`classes_audit_publish_change`, mismo patrón que `profiles_audit_role_change`) en vez de una Edge Function, porque RLS + privilegio por columna sobre `is_published` ya alcanzaban.
- **Pendiente:** editar metadatos de una clase ya creada, borrado lógico (hoy `adminDeleteClass` borra físico), usuarios, entitlements (conceder/revocar con auditoría), métricas.
- **Pruebas:** `supabase/tests/classes_publish_audit.test.sql` (publicar sin video listo rechazado, publicar/despublicar audita con el actor real, editar otro campo no audita publicación, un usuario común no puede tocarlo). **Falta:** prueba E2E en navegador del flujo completo (crear → subir → publicar) — este entorno no tiene Chrome para escribirla contra un caso real; queda para la próxima sesión con navegador disponible.

### Fase 5 · Panel técnico interno (`/interno`, rol `developer`)
- **Archivos:** `interno/index.html` + `js/interno/*`; funciones `tech-*`; tabla `app_settings`.
- **Alcance:** diagnóstico, reconciliación manual, configuración, mantenimiento.
- **Pruebas:** el propietario es **denegado** en toda ruta técnica (prueba de separación); todo queda auditado.

### Fase 6 · Cobros digitales (Paddle)
- **Migración:** `products`, `prices`, `orders`, `payments`, `subscriptions`, `payment_events` (idempotente, con identificador externo y estado).
- **Archivos:** módulo `payments` agnóstico + adaptador `paddle`; `paddle-webhook` (firma verificada); reconciliación Paddle ↔ base.
- **Regla:** el acceso se concede o revoca **solo** por webhook verificado, nunca por la redirección del navegador.
- **Pruebas:** fixtures firmados (pago, renovación, reembolso, cancelación, duplicado); "cobrado sin acceso" y "acceso sin pago" detectados por la reconciliación.

### Fase 7 · Tienda física
- **Migración:** productos físicos, variantes (talla/color), stock y reservas, pedidos con máquina de estados, direcciones, impuestos, envíos, devoluciones, reembolsos, cancelaciones.
- **Archivos:** puerto `commerce` + adaptador (Stripe o Shopify, ver decisiones), webhook firmado, reconciliación.
- **Pruebas:** stock concurrente (sin sobreventa), estados válidos e inválidos, webhooks duplicados, reembolso parcial.

### Fase 8 · Cierre para producción
- CSP y cabeceras de seguridad, observabilidad, textos legales (RGPD/LOPDGDD), eliminar cualquier dato de ejemplo restante, ensayo de despliegue y de restauración.

## 4. Decisiones que necesito de ti (bloquean fases concretas)

1. **Desarrolladores vs. propietario (Fase 2).** ¿El rol `developer` incluye también los permisos de negocio del propietario, o solo el panel técnico? Propuesta: el desarrollador es un **superconjunto** (soporte), con todo auditado.
2. **Tienda física (Fase 7).** **Shopify** trae de fábrica inventario, envíos, impuestos y devoluciones (menos código, pero el catálogo físico vive allí); **Stripe** deja todo en nuestra base (control total, pero hay que construir stock, envíos y devoluciones). Ojo: **Paddle solo sirve para productos digitales**. Mi recomendación: Shopify si quieren gestionar la tienda sin programador.
3. **Modelo comercial (Fase 6).** ¿Qué se vende exactamente: clase suelta, curso, suscripción mensual/anual? ¿Precios y período de prueba?
4. **Envíos (Fase 7).** ¿Solo España peninsular o también islas/UE?
5. **Datos de ejemplo.** Hasta que existan pagos y tienda, las secciones "Cursos" y "Merchandising" muestran contenido inventado. Regla del proyecto: **no dejar datos falsos**. ¿Las oculto o las marco como "Próximamente"?
6. **Legales.** Política de privacidad, términos y cookies (los redacta el cliente o su asesor); necesarios antes de abrir el registro.
7. **Información del negocio (retoque de estilos, 22/09/2026).** El manual de marca ("Pautas para la web") sugiere una
   estructura distinta a la actual: Inicio · Clases (privadas y online) · Ropa (líneas "Set Marea", "Set Duna") ·
   Dónde encontrarme (feria Las Dalias, lunes y martes de 19 a 00 h; envíos por Europa) · Contacto. Eso es contenido
   y arquitectura de información, no un estilo, así que no lo apliqué sin tu confirmación: cambiaría "Cursos" y
   "Merchandising" por productos y una feria física concretos. Si el negocio real es así, decímelo y lo sumo en una
   fase aparte (con fotos y datos reales, no inventados). Lo que sí se aplicó ya de esa guía: logo, paleta, botones
   (secundario en salvia, destacado en tinta), separadores finos y las redes sociales reales.

## 5. Riesgos

- **Integraciones sin credenciales:** Bunny, Supabase real, Paddle y la tienda no se pueden validar aquí; hay simulaciones fieles (la firma de Bunny se comparó con su código oficial) y pruebas de integración aparte, pero la primera prueba real con cuentas puede mostrar ajustes.
- **Alcance:** los puntos 15–17 son del tamaño de un producto entero; por eso van en fases y ninguna arranca sin cerrar la anterior.
- **Coste:** con Paddle (comisión como comerciante de registro) y una tienda, el costo mensual deja de ser solo Bunny + Supabase; conviene estimarlo tras la decisión 3.
