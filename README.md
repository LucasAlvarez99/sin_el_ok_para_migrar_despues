# YogaPop Up

Sitio de yoga (cursos, clases en vivo, tienda y **videoteca**) al que se le suma un sistema profesional de
videos: los videos viven en **Cloudflare R2**, los usuarios, clases, permisos y progreso en **Supabase**, y la
web sigue siendo el sitio estático actual alojado en **Hostinger** (sin videos en el hosting).

> ## Estado actual (25/09/2026) · Fase 0 cumplida, migrado el video de Bunny Stream a Cloudflare R2
>
> **Poner el sitio a andar con cuentas reales:** [`docs/PUESTA-EN-MARCHA.md`](docs/PUESTA-EN-MARCHA.md) ·
> Reglas del proyecto: [`CLAUDE.md`](CLAUDE.md) · Encargo original: [`docs/ENCARGO-ORIGINAL.md`](docs/ENCARGO-ORIGINAL.md) ·
> Auditoría y plan por fases: [`docs/AUDITORIA-Y-PLAN.md`](docs/AUDITORIA-Y-PLAN.md) · Hoja de ruta hasta la
> entrega: [`Fases`](#fases) más abajo (Fase 0 = hoy, Fase 7 = día de entrega).
>
> **Probado:** 47 pruebas de backend (roles, auditoría, contratos, firmas R2) · 25 unitarias del frontend y de `doctor` ·
> **pruebas de base de datos** (`npm run test:db`: migraciones en orden, matriz de permisos por rol, historial inmutable,
> verificadas rompiendo la migración a propósito) · **25 pruebas E2E** en Chromium real, todas en verde.
>
> **Roles hechos:** `user` / `owner` / `developer` (el desarrollador es superconjunto del propietario), historial de
> auditoría que nadie puede editar ni borrar, cambios de rol solo por desarrolladores y protección del último desarrollador.
> **Cuentas reales preparadas:** guía, `npm run doctor[:online]` y una prueba de integración real que se ejecuta
> sola cuando existan las credenciales (`npm run test:integration`). **Falta que el cliente cree las cuentas** (ver
> "Tareas externas pendientes" en la hoja de ruta).
> **Panel de negocio (`panel.html`), primera parte:** listar clases, crear, subir el video a R2 (con progreso), publicar,
> despublicar y eliminar, protegido por rol y con auditoría. **Identidad visual:** logo real (`assets/logo-claro.png` /
> `logo-oscuro.png`) en navbar, pie y favicon; paleta verificada contra el manual de marca; redes sociales reales
> (WhatsApp, Instagram, YouTube) en los pies de página.
>
> **Aún no existe:** reproductor de video terminado (Fase 1), panel técnico interno (solo desarrolladores),
> reconciliación programada, pagos y tienda.
>
> ```bash
> nvm use && npm ci                              # instalación reproducible
> npm run verify                                 # formato + lint + tipos + pruebas de backend y frontend
> npm run test:db                                # base de datos (requiere PostgreSQL y bash)
> npm run doctor                                 # ¿la configuración está lista para producción?
> CHROME_PATH=/ruta/a/chrome npm run test:e2e    # 25 pruebas E2E (requiere Chrome/Chromium y ffmpeg)
> npm run dev                                    # sitio en http://localhost:3000
> npm run build                                  # arma dist/ (lo único que se sube a Hostinger)
> ```

## Estado del proyecto

Leyenda: ✅ cumplida · 🟡 código listo, falta validarla con cuentas reales · ⬜ sin empezar

| Fase | Qué es | Estado |
|---|---|---|
| 0 | Auditoría + modelo de datos + backend de video (R2) | ✅ |
| 1 | Reproductor `VideoPlayer` | ⬜ |
| 2 | Progreso del usuario (frontend) | ⬜ |
| 3 | Autenticación y permisos (frontend) | ⬜ |
| 4 | Panel administrativo | ⬜ |
| 5 | Prueba con un solo video (cuentas reales) | ⬜ |
| 6 | Escalado a ~40 videos | ⬜ |
| 7 | Entrega | ⬜ |

Detalle de cada fase, con sus tareas, más abajo en [Fases](#fases).

---

## Arquitectura

```
                 ┌─────────────────────────┐
                 │  Web estática (Hostinger)│   index.html · css/ · js/
                 └────────────┬────────────┘
                              │ HTTPS
                              ▼
                 ┌─────────────────────────┐
                 │ Supabase Edge Functions  │   supabase/functions/
                 │  (TypeScript / Deno)     │
                 └───────┬─────────┬───────┘
                         │         │
             ┌───────────┘         └────────────┐
             ▼                                  ▼
   ┌──────────────────┐               ┌──────────────────┐
   │ Supabase          │               │ Cloudflare R2     │
   │ Auth · Postgres   │               │ Videos (bucket)   │
   │ RLS · progreso    │               │                   │
   └──────────────────┘               └──────────────────┘

   El navegador sube el video DIRECTO a R2 (PUT prefirmado) y lo reproduce con una URL
   firmada que vence. El archivo nunca pasa por Hostinger ni por las funciones.
   R2 no transcodifica: se sirve el archivo tal cual se subió (progresivo, sin HLS
   adaptativo), con soporte de Range requests nativo para buscar/adelantar.
```

## Estructura del repositorio

```
yogapopup/
├── index.html · css/ · js/ · assets/    Sitio actual (diseño intacto)
│   └── js/config.js                     Config PÚBLICA del frontend (placeholders)
├── supabase/
│   ├── migrations/                      Base de datos: tablas, RLS, permisos (Fase 2)
│   ├── functions/
│   │   ├── _shared/                     Capa R2, auth, repositorio, HTTP (Fase 3)
│   │   ├── _tests/                      47 pruebas automáticas
│   │   ├── admin-create-upload/  admin-sync-video/  admin-delete-class/
│   │   └── playback/  health/
│   ├── .env  ·  .env.example            Secretos del BACKEND (R2)
│   ├── config.toml · promote_role.example.sql · README.md
├── scripts/                             supabase.mjs (atajos CLI) · build-site.mjs (arma dist/)
├── .env  ·  .env.example                Variables de las herramientas locales
├── .htaccess                            Bloquea archivos sensibles en Hostinger
└── package.json                         Scripts y herramientas de desarrollo
```

---

## Puesta en marcha

### ¿Dónde se hace `npm install`?

**Una sola vez, en la raíz del proyecto**: la carpeta que contiene `package.json`, `index.html` y `supabase/`.

```bash
cd yogapopup          # la carpeta raíz, junto a package.json
npm install
```

- **No** hay que hacer `npm install` dentro de `supabase/`, `supabase/functions/` ni `js/`.
- Requisito: **Node.js 20 o superior**. El resto (CLI de Supabase, Deno para las pruebas y un servidor local)
  se instala solo con ese comando.
- El sitio en sí **no tiene build ni dependencias de npm**: Bootstrap y las fuentes se cargan por CDN.

### Pasos

1. `npm install` (raíz).
2. Completar `.env` (raíz) y `supabase/.env` (ver [Variables de entorno](#variables-de-entorno)). Ya existen
   con los campos vacíos; **no están en Git**.
3. Ver el sitio en local: `npm run dev` → http://localhost:3000
4. Comprobar que todo el código está sano: `npm run verify`
5. Con las cuentas creadas (ver [Tareas externas](#tareas-externas-pendientes)):
   `npm run sb:login` → `npm run sb:link` → `npm run sb:db-push` → `npm run sb:secrets` → `npm run sb:deploy`.
   Guía completa en [`supabase/README.md`](supabase/README.md).

### Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Sitio en http://localhost:3000 |
| `npm run build` | Arma `dist/` con **solo** los archivos públicos |
| `npm run preview` | Construye y sirve `dist/` en http://localhost:3001 |
| `npm test` | 46 pruebas de las funciones (sin red) |
| `npm run verify` | Formato + lint + tipos + pruebas |
| `npm run sb:login` / `sb:link` | Iniciar sesión / vincular el proyecto Supabase |
| `npm run sb:db-push` | Aplica las migraciones a la base |
| `npm run sb:secrets` | Sube `supabase/.env` como secretos de las funciones |
| `npm run sb:deploy` | Publica las Edge Functions |
| `npm run sb -- <comando>` | Cualquier otro comando del CLI de Supabase |

Los comandos `sb:*` aceptan `--dry-run` para ver qué ejecutarían.

### Publicar el sitio en Hostinger

1. `npm run build`
2. Subir a `public_html` el **contenido** de `dist/` (no la carpeta del proyecto).

`dist/` contiene solo `index.html`, `css/`, `js/`, `assets/` y `.htaccess`: por construcción no puede llevarse
`.env`, `supabase/` ni `scripts/`. Si por error se subiera todo el proyecto, el `.htaccess` sigue bloqueando
esos archivos (comprobado en Apache).

---

## Variables de entorno

Ninguna credencial real está en este repositorio: todos los archivos vienen con campos vacíos o de ejemplo.

| Archivo | ¿Va a Git? | Variable | ¿Secreta? | Para qué / de dónde sale |
|---|---|---|---|---|
| `.env` | No | `SUPABASE_PROJECT_REF` | No | Supabase → Project Settings → General → *Reference ID* |
| `.env` | No | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` | **Sí** | Opcionales (CI). Con `npm run sb:login` no hacen falta |
| `supabase/.env` | No | `R2_ACCOUNT_ID` | No | Cloudflare dashboard → R2 → Overview |
| `supabase/.env` | No | `R2_ACCESS_KEY_ID` | **Sí** | R2 → Manage API Tokens (permiso Object Read & Write, solo sobre el bucket de videos) |
| `supabase/.env` | No | `R2_SECRET_ACCESS_KEY` | **Sí** | Ídem. Nunca sale del backend |
| `supabase/.env` | No | `R2_BUCKET` | No | Nombre del bucket (ej. `yogapopup-videos`) |
| `supabase/.env` | No | `ALLOWED_ORIGINS` | No | Dominios que pueden llamar a las funciones (CORS) |
| `supabase/.env` | No | `PLAYBACK_TTL_SECONDS`, `UPLOAD_TTL_SECONDS` | No | Opcionales (por defecto 2 h y 4 h) |
| `js/config.js` | **Sí** | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `FUNCTIONS_URL` | **No** (públicas) | Supabase → Project Settings → API |

- `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` dentro de las Edge Functions las inyecta
  Supabase automáticamente: no hay que cargarlas.
- La *anon key* es pública por diseño (la protegen las políticas RLS). **La service role key y las claves de
  R2 jamás van en el frontend ni en `js/config.js`.**
- El proyecto no tenía convención previa de variables (era una maqueta estática), por eso estos nombres son propios.

---

## Seguridad (resumen)

- Ninguna clave privada llega al navegador; viven solo como *secrets* de las Edge Functions.
- RLS activado en todas las tablas y privilegios por columna: la key del objeto en R2 no es legible desde el
  navegador y un usuario no puede volverse admin.
- El acceso a un video se decide en un único lugar (`can_access_class`) y se entrega una URL **firmada (SigV4)
  con vencimiento**: conocer la URL de una clase no permite verla.
- El progreso se guarda por una función de servidor que valida permisos y calcula "completada".
- Sin webhooks: la confirmación de subida la dispara el propio navegador (`admin-sync-video`), que siempre
  comprueba con un HEAD directo a R2 antes de marcar el video como listo — nunca confía en lo que diga el cliente.

## Costos de referencia (USD; verificar en la página oficial de Cloudflare)

Cloudflare R2: primeros 10 GB de almacenamiento gratis por mes, sin cargo por egreso (salida de datos) nunca,
1 millón de operaciones Class A y 10 millones Class B gratis por mes. Pasado eso: ~0,015 USD/GB/mes de storage,
sin costo de tráfico.
Supuesto: 40 clases de ~45 min ≈ 80 GB (**a validar en la Fase 8**); al no cobrar egreso, el costo de R2 casi no
depende de cuánto se reproduzcan las clases (a diferencia de un proveedor con CDN por tráfico).

| Almacenamiento | R2 aprox./mes |
|---|---|
| 80 GB (40 clases) | ~1 USD (10 GB gratis + 70 GB pagos) |
| 200 GB | ~3 USD |

Supabase (plan gratuito): alcanza para empezar; los proyectos se pausan tras 1 semana sin actividad (por eso el
ping de UptimeRobot a `/functions/v1/health` cada 5 min) y **no incluye copias de seguridad**.

---

## Fases

> Hoja de ruta puesta al día el 25/09/2026, después de migrar el proveedor de video de Bunny Stream a
> Cloudflare R2. La **Fase 0** es una foto de "hasta acá se llegó" (no queda nada pendiente adentro, salvo
> lo que depende de cuentas del cliente); las fases siguientes son el trabajo que falta, y la última
> (**Fase 7**) es el día de entrega.

### Fase 0 · Estado actual — auditoría + modelo de datos + backend de video

- [x] Auditoría inicial: estructura del proyecto, arquitectura propuesta, decisiones con el cliente
      (reproductor propio, Supabase Edge Functions como backend, UptimeRobot, precios en euros)
- [x] Modelo de datos: tablas `classes`, `video_progress`, `profiles`, `entitlements`; RLS y privilegios
      por columna; `can_access_class()` y `save_progress()`; migración probada en PostgreSQL local
- [x] Backend de video sobre **Cloudflare R2**: capa `_shared/r2/` (SigV4 vía `aws4fetch`), subida por PUT
      prefirmado directo desde el navegador, confirmación sin webhooks (`admin-sync-video` hace HEAD
      directo al bucket), borrado seguro (si R2 falla no se borra la clase), URLs de reproducción firmadas
      con vencimiento
- [x] `playback` entrega la URL firmada + punto donde retomar; nunca revela si una clase existe a quien
      no tiene acceso
- [x] 47 pruebas automáticas (firmas, permisos, flujos y casos de error, sin red) + tipos y lint limpios:
      `npm run verify` en verde
- [x] Precios de referencia verificados: R2 (gratis hasta 10 GB, sin costo de egreso) y límites del plan
      gratuito de Supabase

- [x] **FASE 0 CUMPLIDA** — el código del backend está completo y probado con simulaciones. Lo único que
      falta para darla por *cerrada en producción* son las cuentas reales del cliente, listadas abajo en
      **Tareas externas pendientes**; se valida con el primer video real en la Fase 5.

### Fase 1 · Reproductor `VideoPlayer`

- [ ] Componente reutilizable sobre `<video>` (reproducción progresiva desde R2) con el diseño de YogaPop Up
- [ ] Play/Pause · barra de progreso · volumen · pantalla completa · duración
- [ ] Continuar desde el último punto guardado
- [ ] Renovar la URL firmada si vence durante la reproducción
- [ ] Estados de carga, error y vacío

- [ ] **FASE 1 CUMPLIDA**

### Fase 2 · Progreso del usuario (frontend)

- [x] Función SQL `save_progress()` y tabla `video_progress` (hechas en la Fase 0)
- [ ] Guardar cada X segundos y al salir/pausar (no una petición por segundo)
- [ ] Mostrar porcentaje y "Continuar clase → 27:43"
- [ ] Sección "Continuar viendo"

- [ ] **FASE 2 CUMPLIDA**

### Fase 3 · Autenticación y permisos (frontend)

- [x] Autorización en el servidor: `can_access_class()` + `playback` (hechas en la Fase 0)
- [x] Estructura extensible a gratuito / premium / curso / suscripción (`entitlements`)
- [ ] Login / registro / cierre de sesión con Supabase Auth (activar el ícono "Mi cuenta")
- [ ] Páginas `videos.html` y `clase.html?id=…` protegidas (sin sesión → login)
- [ ] Conectar las tarjetas de la sección "Videoteca" de la home

- [ ] **FASE 3 CUMPLIDA**

### Fase 4 · Panel administrativo

- [ ] Listado de clases: clase, video, estado, fecha y acciones
- [ ] Formulario: título, descripción, categoría, nivel, miniatura, video y estado
- [ ] Subida del video con barra de progreso (PUT directo a R2) y confirmación automática al terminar
- [ ] Editar · publicar · despublicar · eliminar
- [ ] Acceso solo para propietario y desarrolladores (rol `owner` o `developer`)

- [ ] **FASE 4 CUMPLIDA**

### Fase 5 · Prueba con un solo video (cuentas reales)

- [ ] Upload a R2 real · confirmación de subida (`admin-sync-video`) · asociación con Supabase
- [ ] Reproducción · autenticación · seguridad (probar que una URL suelta no sirve)
- [ ] Progreso y "continuar"
- [ ] Responsive: escritorio y móvil
- [ ] Validar el costo real de almacenamiento y ajustar la estimación

- [ ] **FASE 5 CUMPLIDA**

### Fase 6 · Escalado

- [ ] 1 → 3 → 10 → 40 videos, cargados desde el panel sin tocar código
- [ ] Revisar costos con uso real

- [ ] **FASE 6 CUMPLIDA**

### Fase 7 · Entrega (día de entrega del proyecto)

- [ ] Dominio propio conectado y `ALLOWED_ORIGINS` con el dominio final (sin `localhost` ni comodines)
- [ ] SMTP propio configurado para la recuperación de contraseña (ver sección más abajo) + SPF/DKIM/DMARC
- [ ] Monitor de UptimeRobot activo y probado (que el proyecto gratuito de Supabase no se pause)
- [ ] Copia de seguridad manual de la base antes de abrir el registro al público (el plan gratuito no la incluye)
- [ ] Recorrido completo con el cliente: subir un video, publicarlo, verlo como usuario, borrar de prueba
- [ ] Traspaso de accesos: quién queda con las claves de Supabase, Cloudflare y Hostinger
- [ ] Documentación de puesta en marcha entregada y revisada (`docs/PUESTA-EN-MARCHA.md`)

- [ ] **FASE 7 CUMPLIDA — PROYECTO ENTREGADO**

---

## Tareas externas pendientes

Dependen de las cuentas del cliente (yo no tengo acceso a ellas); bloquean el cierre de la Fase 5 en
adelante:

- [ ] Crear el proyecto en **Supabase** y aplicar la migración
- [ ] Crear el **bucket en Cloudflare R2** y el token de API con permiso de Object Read & Write
- [ ] Acceso a **Hostinger** (FTP o Git) para publicar `dist/`
- [ ] Crear el monitor de **UptimeRobot** hacia `/functions/v1/health`
- [ ] Confirmar con el cliente los **precios reales** y los textos para España
- [ ] Definir el **dominio** (para `ALLOWED_ORIGINS`)

## Hallazgos de la revisión

**Corregidos**

- La migración de la Fase 2 había desaparecido del repositorio (un commit la borró por cómo se empaquetó una entrega
  anterior). Restaurada; este proyecto completo la incluye.
- Un servidor estático sirve `/.env` por defecto: si se subiera la carpeta entera a Hostinger quedaría descargable.
  Ahora se publica solo `dist/` y el `.htaccess` bloquea archivos sensibles (probado en Apache).

**A tener en cuenta (no modifiqué el diseño ni la web existente)**

- Regla para el frontend: con `classes` **no usar `select('*')`** (la key de R2 está restringida);
  listar las columnas explícitamente.
- La web usa imágenes de Unsplash enlazadas directamente y Bootstrap/fuentes por CDN sin SRI: conviene alojarlas o
  fijarlas antes de producción.
- 16 enlaces `href="#"` y el ícono de cuenta sin acción (se resuelven en las Fases 6 y 7); la navegación no tiene
  enlace a "Videoteca".
- Los textos usan voseo argentino y "Envíos a todo el país": revisar para España.
- Sin límite de frecuencia (rate limiting) en las funciones; suficiente para ~40 videos, revisar si crece.
- Aún no verificado con servicios reales: CORS del bucket de R2 y los adaptadores de Supabase.
