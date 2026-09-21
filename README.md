# YogaPop Up

Sitio de yoga (cursos, clases en vivo, tienda y **videoteca**) al que se le suma un sistema profesional de
videos: los videos viven en **Bunny Stream**, los usuarios, clases, permisos y progreso en **Supabase**, y la
web sigue siendo el sitio estático actual alojado en **Hostinger** (sin videos en el hosting).

> ## Estado actual (20/09/2026) · primera entrega casi cerrada
>
> Reglas del proyecto: [`CLAUDE.md`](CLAUDE.md) · Encargo original: [`docs/ENCARGO-ORIGINAL.md`](docs/ENCARGO-ORIGINAL.md) ·
> Auditoría y plan por fases: [`docs/AUDITORIA-Y-PLAN.md`](docs/AUDITORIA-Y-PLAN.md)
>
> **Probado:** 46 pruebas de backend · 16 unitarias del frontend · **24 pruebas E2E en Chromium real, todas en verde**
> (catálogo, acceso, reproducción HLS con URL firmada, URL expirada, progreso, cuenta y **recuperación de contraseña
> de punta a punta**: el enlace del correo abre el formulario, guarda la contraseña nueva, la vieja deja de servir).
>
> La recuperación se probó contra un backend local que habla el mismo protocolo que Supabase, **no** contra un
> Supabase ni un correo reales. Para producción ver "Recuperación de contraseña" en [`supabase/README.md`](supabase/README.md).
>
> **Aún no existe:** paneles (negocio y técnico), roles `owner`/`developer`, reconciliación programada, pagos y tienda.
>
> ```bash
> nvm use && npm ci                              # instalación reproducible
> npm run verify                                 # formato + lint + tipos + 46 pruebas de backend + 16 del frontend
> CHROME_PATH=/ruta/a/chrome npm run test:e2e    # 24 pruebas E2E (requiere Chrome/Chromium y ffmpeg)
> npm run dev                                    # sitio en http://localhost:3000
> npm run build                                  # arma dist/ (lo único que se sube a Hostinger)
> ```

## Estado del proyecto

Leyenda: ✅ cumplida · 🟡 código listo, falta validarla con cuentas reales · ⬜ sin empezar

| Fase | Qué es | Estado |
|---|---|---|
| 1 | Auditoría | ✅ |
| 2 | Modelo de datos | ✅ |
| 3 | Integración con Bunny Stream (backend) | 🟡 |
| 4 | Reproductor `VideoPlayer` | ⬜ |
| 5 | Progreso del usuario (frontend) | ⬜ |
| 6 | Autenticación y permisos (frontend) | ⬜ |
| 7 | Panel administrativo | ⬜ |
| 8 | Prueba con un solo video | ⬜ |
| 9 | Escalado a ~40 videos | ⬜ |

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
   │ Supabase          │               │ Bunny Stream      │
   │ Auth · Postgres   │               │ Videos · HLS · CDN│
   │ RLS · progreso    │               │                   │
   └──────────────────┘               └──────────────────┘

   El navegador sube el video DIRECTO a Bunny (firma temporal) y lo reproduce con una URL
   firmada que vence. El archivo nunca pasa por Hostinger ni por las funciones.
```

## Estructura del repositorio

```
yogapopup/
├── index.html · css/ · js/ · assets/    Sitio actual (diseño intacto)
│   └── js/config.js                     Config PÚBLICA del frontend (placeholders)
├── supabase/
│   ├── migrations/                      Base de datos: tablas, RLS, permisos (Fase 2)
│   ├── functions/
│   │   ├── _shared/                     Capa Bunny, auth, repositorio, HTTP (Fase 3)
│   │   ├── _tests/                      46 pruebas automáticas
│   │   ├── admin-create-upload/  admin-sync-video/  admin-delete-class/
│   │   └── playback/  bunny-webhook/  health/
│   ├── .env  ·  .env.example            Secretos del BACKEND (Bunny)
│   ├── config.toml · promote_admin.example.sql · README.md
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
| `supabase/.env` | No | `BUNNY_LIBRARY_ID` | Sí | Bunny → Stream → tu librería → API |
| `supabase/.env` | No | `BUNNY_API_KEY` | **Sí** | Ídem. Nunca sale del backend |
| `supabase/.env` | No | `BUNNY_READONLY_API_KEY` | **Sí** | Ídem. Firma los webhooks de Bunny |
| `supabase/.env` | No | `BUNNY_CDN_HOSTNAME` | No | `vz-xxxxxxxx-xxx.b-cdn.net` (Pull Zone de la librería) |
| `supabase/.env` | No | `BUNNY_TOKEN_AUTH_KEY` | **Sí** | Pull Zone → Security → Token Authentication |
| `supabase/.env` | No | `ALLOWED_ORIGINS` | No | Dominios que pueden llamar a las funciones (CORS) |
| `supabase/.env` | No | `PLAYBACK_TTL_SECONDS`, `UPLOAD_TTL_SECONDS` | No | Opcionales (por defecto 2 h y 4 h) |
| `js/config.js` | **Sí** | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `FUNCTIONS_URL` | **No** (públicas) | Supabase → Project Settings → API |

- `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` dentro de las Edge Functions las inyecta
  Supabase automáticamente: no hay que cargarlas.
- La *anon key* es pública por diseño (la protegen las políticas RLS). **La service role key y las claves de
  Bunny jamás van en el frontend ni en `js/config.js`.**
- El proyecto no tenía convención previa de variables (era una maqueta estática), por eso estos nombres son propios.

---

## Seguridad (resumen)

- Ninguna clave privada llega al navegador; viven solo como *secrets* de las Edge Functions.
- RLS activado en todas las tablas y privilegios por columna: los IDs de Bunny no son legibles desde el navegador
  y un usuario no puede volverse admin.
- El acceso a un video se decide en un único lugar (`can_access_class`) y se entrega una URL **firmada con
  vencimiento**: conocer la URL de una clase no permite verla.
- El progreso se guarda por una función de servidor que valida permisos y calcula "completada".
- El webhook de Bunny se valida con firma HMAC; los errores nunca devuelven claves ni detalles internos.

## Costos de referencia (USD; verificar en las páginas oficiales)

Bunny Stream (página oficial de precios, 19/09/2026): codificación gratis · almacenamiento 0,01 USD/GB/mes ·
tráfico 0,010 USD/GB en Europa/Norteamérica (0,045 en Sudamérica) · mínimo 1 USD/mes.
Supuesto: 40 clases de ~45 min ≈ 80 GB; una reproducción completa a 720p ≈ 0,85 GB (**a validar en la Fase 8**).

| Reproducciones completas / mes | Bunny aprox. |
|---|---|
| 100 | ~1,7 USD |
| 500 | ~5 USD |
| 2.000 | ~18 USD |

Supabase (plan gratuito): alcanza para empezar; los proyectos se pausan tras 1 semana sin actividad (por eso el
ping de UptimeRobot a `/functions/v1/health` cada 5 min) y **no incluye copias de seguridad**.

---

## Fases

### Fase 1 · Auditoría

- [x] Analizar la estructura del proyecto (HTML estático, Bootstrap 5.3.3, JS vanilla, sin backend/BD/auth)
- [x] Informar arquitectura actual, integración propuesta y archivos a modificar
- [x] Definir decisiones con el cliente: reproductor propio (HLS), Supabase Edge Functions como backend,
      UptimeRobot para evitar la pausa, precios en euros

- [x] **FASE 1 CUMPLIDA**

### Fase 2 · Modelo de datos

- [x] Tablas `classes`, `video_progress` (con `UNIQUE(user_id, class_id)`), `profiles` y `entitlements`
- [x] `entitlements` y `can_access_class()`: base para premium / cursos / suscripciones sin rehacer nada
- [x] RLS en todas las tablas y privilegios por columna (IDs de Bunny ocultos, rol no editable)
- [x] Función `save_progress()` (una llamada por guardado, validada en el servidor)
- [x] Migración probada en PostgreSQL local (permisos, acceso, progreso)
- [x] Precios de la web pasados a euros (valores de ejemplo: dividir por 1000; confirmar con el cliente)
- [ ] Aplicar la migración en el proyecto Supabase real (`npm run sb:db-push`; depende de crear la cuenta)

- [x] **FASE 2 CUMPLIDA** (el diseño y su verificación están hechos; aplicarla en Supabase real es un paso de despliegue)

### Fase 3 · Integración con Bunny Stream (backend)

- [x] Capa de servicio `_shared/bunny/` (`bunny.service`, `bunny.types`, `bunny.signing`)
- [x] Admin: crear clase + subir video (TUS directo a Bunny) · asociar video a una clase existente
- [x] Admin: obtener estado/duración del video (`admin-sync-video` + webhook firmado)
- [x] Admin: eliminar clase (borra el video en Bunny primero; si falla, no borra nada)
- [x] Admin: publicar / despublicar (directo a la tabla; no se puede publicar sin video listo)
- [x] Usuario: `playback` entrega URL HLS firmada con vencimiento + punto donde retomar
- [x] Firma de URLs idéntica a la implementación oficial de Bunny (verificado contra su código)
- [x] 46 pruebas automáticas, tipos y lint limpios (`npm run verify`)
- [x] Verificados los precios oficiales de Bunny y los límites de Supabase
- [ ] Probar contra la API real de Bunny y un proyecto Supabase real (subida TUS, CORS del Pull Zone con hls.js)
- [ ] Decidir miniaturas (propuesta: el admin sube una imagen por clase → Supabase Storage)

- [ ] **FASE 3 CUMPLIDA** — el código está completo y probado con simulaciones; falta validarlo con cuentas reales (se cierra en la Fase 8)

### Fase 4 · Reproductor `VideoPlayer`

- [ ] Componente reutilizable sobre hls.js con el diseño de YogaPop Up (no un reproductor genérico)
- [ ] Play/Pause · barra de progreso · volumen · pantalla completa · duración
- [ ] Control de calidad (cuando Bunny lo permita)
- [ ] Continuar desde el último punto guardado
- [ ] Renovar la URL firmada si vence durante la reproducción
- [ ] Estados de carga, error y vacío

- [ ] **FASE 4 CUMPLIDA**

### Fase 5 · Progreso del usuario (frontend)

- [x] Función SQL `save_progress()` y tabla `video_progress` (hechas en la Fase 2)
- [ ] Guardar cada X segundos y al salir/pausar (no una petición por segundo)
- [ ] Mostrar porcentaje y "Continuar clase → 27:43"
- [ ] Sección "Continuar viendo"

- [ ] **FASE 5 CUMPLIDA**

### Fase 6 · Autenticación y permisos (frontend)

- [x] Autorización en el servidor: `can_access_class()` + `playback` (hechas en las Fases 2 y 3)
- [x] Estructura extensible a gratuito / premium / curso / suscripción (`entitlements`)
- [ ] Login / registro / cierre de sesión con Supabase Auth (activar el ícono "Mi cuenta")
- [ ] Páginas `videos.html` y `clase.html?id=…` protegidas (sin sesión → login)
- [ ] Conectar las tarjetas de la sección "Videoteca" de la home

- [ ] **FASE 6 CUMPLIDA**

### Fase 7 · Panel administrativo

- [ ] Listado de clases: clase, video, estado, fecha y acciones
- [ ] Formulario: título, descripción, categoría, nivel, miniatura, video y estado
- [ ] Subida del video con barra de progreso y espera de procesamiento
- [ ] Editar · publicar · despublicar · eliminar
- [ ] Acceso solo para administradores

- [ ] **FASE 7 CUMPLIDA**

### Fase 8 · Prueba con un solo video

- [ ] Upload · procesamiento de Bunny · asociación con Supabase
- [ ] Reproducción · autenticación · seguridad (probar que una URL suelta no sirve)
- [ ] Progreso y "continuar"
- [ ] Responsive: escritorio y móvil
- [ ] Validar el costo real por reproducción y ajustar la estimación

- [ ] **FASE 8 CUMPLIDA**

### Fase 9 · Escalado

- [ ] 1 → 3 → 10 → 40 videos, cargados desde el panel sin tocar código
- [ ] Revisar costos con uso real y limitar resoluciones si conviene

- [ ] **FASE 9 CUMPLIDA**

---

## Tareas externas pendientes

Dependen de las cuentas del cliente (yo no tengo acceso a ellas):

- [ ] Crear el proyecto en **Supabase** y aplicar la migración
- [ ] Crear la **Video Library** en Bunny (activar Token Authentication en su Pull Zone, webhook, resoluciones)
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

- Regla para el frontend: con `classes` **no usar `select('*')`** (las columnas de Bunny están restringidas);
  listar las columnas explícitamente.
- La web usa imágenes de Unsplash enlazadas directamente y Bootstrap/fuentes por CDN sin SRI: conviene alojarlas o
  fijarlas antes de producción.
- 16 enlaces `href="#"` y el ícono de cuenta sin acción (se resuelven en las Fases 6 y 7); la navegación no tiene
  enlace a "Videoteca".
- Los textos usan voseo argentino y "Envíos a todo el país": revisar para España.
- Sin límite de frecuencia (rate limiting) en las funciones; suficiente para ~40 videos, revisar si crece.
- Aún no verificado con servicios reales: CORS del Pull Zone de Bunny con hls.js y los adaptadores de Supabase.
