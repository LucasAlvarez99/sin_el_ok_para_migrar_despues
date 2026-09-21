# CLAUDE.md · YogaPop Up

Instrucciones permanentes para trabajar en este repositorio. Léelas antes de tocar código.
El detalle de huecos y fases está en [`docs/AUDITORIA-Y-PLAN.md`](docs/AUDITORIA-Y-PLAN.md).

## 1. Qué es esto

YogaPop Up pasa de **prueba técnica a producto real** (MVP comercial). Un sitio de yoga con videoteca protegida,
cursos, suscripciones y tienda física.

| Capa | Tecnología |
|---|---|
| Frontend | HTML + CSS + JavaScript estático (ES modules, sin build ni framework), Bootstrap 5.3.3 |
| Backend | Supabase Edge Functions, TypeScript sobre Deno |
| Datos | Supabase Postgres con RLS + Supabase Auth + Storage |
| Vídeo | Bunny Stream: subida TUS directa desde el navegador, reproducción HLS con URL firmada (hls.js) |
| Pagos (por construir) | Paddle (digital) y Stripe o Shopify (físico), detrás de adaptadores |

**No se reescribe lo que ya funciona.** Ya existen y se conservan: autenticación y permisos en servidor, RLS,
progreso (`save_progress`), firmas Bunny (verificadas contra el código oficial), webhook firmado y pruebas.

## 2. Tres niveles de acceso (deben estar siempre separados)

| Nivel | Superficie | Puede | No puede |
|---|---|---|---|
| **Usuario final** | Sitio público (`index.html`, `videoteca.html`, `clase.html`, cuenta) | Ver catálogo, reproducir lo que tenga permitido, guardar su progreso, editar su perfil, comprar | Ver o llamar nada de administración |
| **Propietario** (`owner`) | Panel de negocio (`/panel`), fuera de la app de usuarios | Clases, publicación, catálogo, usuarios, entitlements, pedidos, métricas | Recibir secretos, service role, API keys de Bunny o acceso directo a Supabase/Bunny/infra |
| **Desarrollador** (`developer`) | Panel técnico interno (`/interno`), separado del de negocio | Diagnóstico, reconciliación, configuración, mantenimiento | — (todo queda auditado) |

- La autorización se valida **siempre en el servidor** (RLS + Edge Functions). Ocultar un botón nunca es un control.
- Cada superficie tiene su propia entrada, sus propias funciones y sus propias pruebas de "acceso denegado".
- Todo cambio de rol, entitlement o dato sensible deja un registro en el historial de auditoría.

## 3. Módulos

Cada módulo tiene **una responsabilidad**, un **contrato público** (`index` con tipos) y **no importa la implementación
interna de otro**. Sin dependencias circulares. Lo compartido vive solo en `common`.

| Módulo | Responsabilidad | Puede depender de |
|---|---|---|
| `common` | HTTP, errores, validación, config, rate limiting, idempotencia, auditoría | — |
| `auth` | Sesión, roles, guardas (`requireUser/Owner/Developer`) | common |
| `profiles` | Perfil propio (lectura/edición) | common, auth |
| `catalog` | Lectura del catálogo publicado | common |
| `classes` | Alta/edición/publicación/borrado lógico de clases | common, auth, catalog, bunny |
| `playback` | Decidir acceso y entregar URL firmada | common, auth, entitlements, bunny |
| `progress` | Guardado y lectura de progreso | common, auth |
| `entitlements` | Derechos de acceso digital (conceder/revocar/consultar) | common, auth |
| `payments` | Pedidos/cobros, agnóstico del proveedor; activa o revoca entitlements | common, entitlements |
| `business-admin` | Casos de uso del panel de negocio | los módulos anteriores vía contrato |
| `tech-tools` | Diagnóstico, reconciliación, configuración | common, auth, bunny, supabase |
| `supabase` | Adaptadores de repositorio y auth (única capa que habla con Supabase) | common |
| `bunny` | Adaptador de Bunny (única capa que habla con Bunny) | common |
| `webhooks` | Recepción firmada e idempotente (Bunny, Paddle, tienda) | common, bunny, payments |

Reglas: la **lógica de negocio no conoce Supabase ni Bunny** (usa puertos/interfaces); los proveedores se enchufan por
**adaptadores**. Hoy el backend vive en `supabase/functions/_shared/` y el frontend en `js/{lib,ui,components,pages}`;
la migración a módulos con contrato es la Fase 2 del plan y se hace **de forma incremental**, sin reescribir.

## 4. Seguridad: reglas no negociables

1. Nunca exponer en el frontend: service role key, API keys de Bunny, secretos de webhooks, claves de pago.
   El propietario tampoco los recibe.
2. **No** usar `select('*')` en tablas con columnas privadas (`classes` tiene `bunny_*` restringidas): listar columnas.
3. **Nunca** conceder acceso por datos que envía el navegador (ni redirecciones de checkout): solo por webhook
   firmado y verificado en servidor.
4. Toda operación sensible: autorización en servidor + **rate limiting** + entrada validada.
5. Webhooks y operaciones administrativas: **idempotentes** (clave de idempotencia / registro de eventos).
6. No borrar filas de Postgres ni vídeos de Bunny sin estrategia de reconciliación (borrado lógico + tarea de limpieza).
7. Conservar y revisar las políticas RLS existentes; toda tabla nueva nace con RLS y privilegios mínimos.
8. Los textos de usuarios se insertan como texto (`el()` / `textContent`), nunca con `innerHTML`.

## 5. Cómo trabajar

1. **Audita** antes de cambiar. 2. **Plan por fases** con archivos, migraciones y pruebas. 3. **Una fase a la vez.**
4. Tras cada cambio corre la **prueba más específica posible**. 5. Al cerrar una fase: formato, lint, typecheck,
tests y build.

**Definición de "hecho"**: una fase no está terminada hasta tener una **prueba ejecutable** que la respalde.
Si una integración externa no se puede probar sin credenciales, hay una prueba de integración **claramente separada**
(`*.integration.*`, se omite sin credenciales) y el paso manual queda documentado.

**Pruebas por módulo**: unitarias + de contrato (su interfaz) + de integración (conexión con otros módulos) + E2E de los
flujos críticos. Un cambio en un módulo debe poder validarse solo y no romper a otro sin que una prueba lo detecte.

**Evitar**: refactors amplios o cambios cosméticos innecesarios; dependencias nuevas sin justificar (anotar el porqué
en el PR); cambiar el diseño visual sin necesidad. **Sí** reemplazar datos falsos por datos reales y eliminar
`href="#"` y acciones simuladas.

## 6. Comandos

```bash
nvm use && npm ci            # instalación reproducible (Node y lockfile fijados)
npm run dev                  # sitio en http://localhost:3000
npm run verify               # formato + lint + tipos + pruebas unitarias
npm run test:web             # pruebas unitarias del frontend y de doctor (Deno, sin dependencias nuevas)
npm run test:db              # base de datos: migraciones + permisos por rol (requiere PostgreSQL)
npm run doctor[:online]      # revisa la configuración para producción
npm run test:integration     # prueba real contra Supabase+Bunny (se omite sin credenciales)
npm run test:e2e             # E2E en navegador (requiere Chrome/Chromium: ver README)
npm run build                # arma dist/ con solo los archivos públicos
npm run sb:db-push | sb:secrets | sb:deploy   # despliegue (ver supabase/README.md)
```

## 7. Trampas conocidas (ya nos mordieron)

- `classes.classes_published_requires_ready`: no se puede publicar sin `video_status = 'ready'`; al fallar un video hay
  que despublicar en la misma operación.
- Los números de estado del **webhook** de Bunny y los de la **API** son distintos: el webhook solo avisa; el estado
  real se consulta a la API.
- Al capturar un valor "anterior" de una fila, hacerlo **antes** de actualizarla (bug real detectado por las pruebas).
- Las carpetas `_tests` y `_shared` empiezan con guion bajo para que el CLI de Supabase no las despliegue como funciones.
- Un `.env` servido por un servidor estático queda público: publicar **solo** `dist/`.
- Bootstrap ignora `show()`/`hide()` y los clics mientras un modal se anima (~300 ms): en las pruebas se espera a que
  termine de abrirse (`modalReady`) y en el código se usa `closeModal()` y se espera `hidden` antes de reabrir.
- `supabase-js` emite `PASSWORD_RECOVERY` durante su inicialización: hay que suscribirse a `onAuthStateChange`
  **antes** de `getSession()`.
- Con `package.json` en la raíz, Deno resuelve desde `node_modules`: los scripts pasan `--config supabase/functions/deno.json`.

## 8. Primera entrega (alcance actual)

Estado a 20/09/2026. Leyenda: [x] hecho y probado · [~] hecho, con algo pendiente · [ ] pendiente.

- [~] Reproducibilidad de npm/Deno: versiones exactas, `deno.lock` congelado, `.nvmrc` y CI escrito
  (**el CI todavía no se ejecutó en GitHub**)
- [x] Autenticación en el frontend: registro, login, logout, sesión persistente, perfil, cambio de contraseña y
  recuperación por enlace del correo (E2E en verde; el bug del evento `PASSWORD_RECOVERY` se detecta con mutación)
- [x] Catálogo real desde Supabase (carga, error, vacío y filtros)
- [x] Página de detalle de clase (sin sesión, sin acceso, no encontrada, en preparación, error y reintento)
- [x] Reproductor de un solo vídeo (HLS real con URL firmada en la ruta, calidades, velocidad, teclado, retomar)
- [x] Pruebas de carga, error, acceso denegado, URL expirada (al cargar, siempre y preventiva) y progreso
  (periódico, al pausar, al salir, al terminar, retomar y empezar de cero)
- [~] README con comandos de instalación y pruebas; faltan los pasos de despliegue definitivos con cuentas reales

- [x] **Roles y auditoría** (`user`/`owner`/`developer`, historial inmutable): base de datos con `npm run test:db` y guardas
  con pruebas de "acceso denegado" por nivel
- [~] **Puesta en marcha con cuentas reales**: guía (`docs/PUESTA-EN-MARCHA.md`), `npm run doctor[:online]` y
  `npm run test:integration` listos; **falta que el cliente cree las cuentas**

Todo lo demás (paneles, reconciliación, pagos, tienda) está planificado por fases en `docs/AUDITORIA-Y-PLAN.md`
y **no** se empieza sin cerrar la fase anterior.
