# YogaPop Up

Sitio de yoga (cursos, clases en vivo, tienda y **videoteca**) al que se le suma un sistema profesional de
videos: los videos viven en **Cloudflare R2**, los usuarios, clases, permisos y progreso en **Supabase**, y la
web sigue siendo el sitio estático actual alojado en **Hostinger** (sin videos en el hosting).

> ## Estado actual (25/09/2026) · Fase 0 cumplida, migrado el video de Bunny Stream a Cloudflare R2
>
> **Poner el sitio a andar con cuentas reales:** [`docs/PUESTA-EN-MARCHA.md`](docs/PUESTA-EN-MARCHA.md) ·
> Reglas del proyecto: [`CLAUDE.md`](CLAUDE.md) · Encargo original: [`docs/ENCARGO-ORIGINAL.md`](docs/ENCARGO-ORIGINAL.md) ·
> Auditoría y plan por fases: [`docs/AUDITORIA-Y-PLAN.md`](docs/AUDITORIA-Y-PLAN.md) · Hoja de ruta hasta la
> entrega: [`Fases`](#fases) más abajo (Fase 0 = hoy, Fase 20 = día de entrega).
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
> **Aún no existe:** guardado periódico de progreso en pantalla (Fase 3-4), panel técnico interno (solo
> desarrolladores), reconciliación programada, pagos y tienda.
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
| 1 | Reproductor — estructura y controles básicos | ✅ |
| 2 | Reproductor — reanudar, renovar y errores | ✅ |
| 3 | Progreso — guardado periódico | ⬜ |
| 4 | Progreso — interfaz | ⬜ |
| 5 | Autenticación — login, registro y sesión | ⬜ |
| 6 | Autenticación — páginas protegidas | ⬜ |
| 7 | Autenticación — conectar la home | ⬜ |
| 8 | Panel administrativo — listado | ⬜ |
| 9 | Panel administrativo — alta y edición | ⬜ |
| 10 | Panel administrativo — subida de video | ⬜ |
| 11 | Panel administrativo — publicar y borrar | ⬜ |
| 12 | Cuentas reales — infraestructura | ⬜ |
| 13 | Prueba con un solo video real | ⬜ |
| 14 | Prueba con un solo video — progreso, responsive y costo | ⬜ |
| 15 | Escalado — varios videos | ⬜ |
| 16 | Escalado — catálogo completo | ⬜ |
| 17 | Entrega — dominio y correo | ⬜ |
| 18 | Entrega — monitoreo y respaldo | ⬜ |
| 19 | Entrega — recorrido y traspaso | ⬜ |
| 20 | Entrega — cierre del proyecto | ⬜ |

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
├── pages/                                Código fuente de las páginas (index, videoteca, clase, cuenta, panel)
├── css/ · js/ · assets/                  Estilos, JS y recursos; los usan las páginas de pages/
│   └── js/config.js                      Config PÚBLICA del frontend (placeholders)
├── supabase/
│   ├── migrations/                       Base de datos: tablas, RLS, permisos (Fase 0)
│   ├── functions/
│   │   ├── _shared/                      Capa R2, auth, repositorio, HTTP (Fase 0)
│   │   ├── _tests/                       47 pruebas automáticas
│   │   ├── admin-create-upload/  admin-sync-video/  admin-delete-class/
│   │   └── playback/  health/
│   ├── .env  ·  .env.example             Secretos del BACKEND (R2)
│   ├── config.toml · promote_role.example.sql · README.md
├── scripts/
│   ├── dev-server.mjs                    Servidor de desarrollo (sirve pages/ en la raíz del sitio)
│   ├── build-site.mjs                    Arma dist/ (pages/*.html aplanados + css/, js/, assets/)
│   └── supabase.mjs                      Atajos del CLI de Supabase
├── .env  ·  .env.example                 Variables de las herramientas locales
├── .htaccess                             Bloquea archivos sensibles en Hostinger (viaja dentro de dist/)
└── package.json                          Scripts y herramientas de desarrollo
```

`pages/` existe solo en el repositorio, para no mezclar el HTML con css/js/assets/admin: tanto en
desarrollo (`npm run dev`) como en el sitio publicado (`npm run build` → `dist/`) las páginas se sirven
igual que antes, en la raíz (`/videoteca.html`, no `/pages/videoteca.html`).


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

> Hoja de ruta puesta al día el 26/09/2026. La **Fase 0** es una foto de "hasta acá se llegó" (no queda
> nada pendiente adentro, salvo lo que depende de cuentas del cliente). A partir de ahí las fases son
> chicas a propósito (una tarde de trabajo cada una, más o menos) para poder cerrar y marcar "cumplida"
> seguido, en vez de tener fases enormes que quedan a medio camino por muchas sesiones. La última
> (**Fase 20**) es el día de entrega.

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
      **Tareas externas pendientes**; se valida con el primer video real en la Fase 13.

### Fase 1 · Reproductor — estructura y controles básicos

- [x] Componente `VideoPlayer` reutilizable sobre `<video>` (reproducción progresiva desde R2) con el
      diseño de YogaPop Up (`js/components/video-player.js`, estilos en `css/app.css`)
- [x] Play/Pause · barra de progreso (click y arrastre) · volumen (slider + silenciar) · pantalla completa
      · duración
- [x] Estados de carga y vacío: spinner mientras carga, botón grande de reproducir antes de empezar,
      página con su propio estado de carga/sin sesión/sin acceso/video no listo/error (`js/pages/clase.js`)
- [x] Cubierto por E2E en Chromium real: duración mostrada, volumen (slider real, no solo la UI), silenciar,
      buscar arrastrando la barra, velocidad, teclado, selector de calidad oculto (R2 no transcodifica)

- [x] **FASE 1 CUMPLIDA** — ya estaba construido de una sesión anterior; esta vuelta se revisó entero,
      se le sumaron las pruebas E2E que le faltaban (duración, volumen, buscar con la barra) y se confirmó
      que sigue funcionando después de la migración a R2.

- [ ] **FASE 1 CUMPLIDA**

### Fase 2 · Reproductor — reanudar, renovar y errores

- [x] Continuar desde el último punto guardado (`resume_seconds` de `playback`), con opción "Empezar de cero"
- [x] Renovar la URL firmada sola si vence durante la reproducción: preventivo (antes de que ocurra) y
      reactivo (ante un 401/403), sin cortar la reproducción
- [x] Estado de error con reintento (video no listo, servicio caído, URL que no logra renovarse tras 2 intentos)
- [x] Cubierto por E2E en Chromium real: URL vencida al cargar, renovación preventiva a mitad de reproducción,
      y el caso límite de que la renovación también falle (error visible + reintento que se recupera)

- [x] **FASE 2 CUMPLIDA** — ídem Fase 1: ya estaba hecho, se revisó y quedó confirmado con las pruebas
      existentes (que también se migraron de Bunny/HLS a R2/progresivo).

### Fase 3 · Progreso — guardado periódico

- [x] Función SQL `save_progress()` y tabla `video_progress` (hechas en la Fase 0)
- [ ] Guardar cada X segundos mientras reproduce (no una petición por segundo)
- [ ] Guardar también al pausar y al salir/cerrar la pestaña (guardado síncrono de salida)
- [ ] No saturar al buscar en la barra (mínimo entre guardados)

- [ ] **FASE 3 CUMPLIDA**

### Fase 4 · Progreso — interfaz

- [ ] Mostrar porcentaje de avance en la tarjeta de cada clase
- [ ] "Continuar clase → 27:43" al volver a entrar
- [ ] Sección "Continuar viendo" con las clases empezadas y no terminadas

- [ ] **FASE 4 CUMPLIDA**

### Fase 5 · Autenticación — login, registro y sesión

- [x] Autorización en el servidor: `can_access_class()` + `playback` (hechas en la Fase 0)
- [ ] Login / registro / cierre de sesión con Supabase Auth
- [ ] Activar el ícono "Mi cuenta" (estado con/sin sesión, nombre del usuario)
- [ ] Recuperar contraseña (depende del SMTP propio, ver Fase 17)

- [ ] **FASE 5 CUMPLIDA**

### Fase 6 · Autenticación — páginas protegidas

- [ ] `videos.html` y `clase.html?id=…` protegidas: sin sesión → modal/redirect a login
- [ ] Volver a la clase que se quería ver después de iniciar sesión
- [ ] Mensaje claro cuando la clase es restringida y el usuario no tiene acceso (`entitlements`)

- [ ] **FASE 6 CUMPLIDA**

### Fase 7 · Autenticación — conectar la home

- [x] Estructura extensible a gratuito / premium / curso / suscripción (`entitlements`, hecha en la Fase 0)
- [ ] Conectar las tarjetas de la sección "Videoteca" de la home al catálogo real
- [ ] Filtros por nivel/categoría (si ya estaban en el diseño estático)

- [ ] **FASE 7 CUMPLIDA**

### Fase 8 · Panel administrativo — listado

- [ ] Listado de clases: título, video, estado, fecha y acciones
- [ ] Acceso solo para propietario y desarrolladores (rol `owner` o `developer`)
- [ ] Filtros/orden básicos (publicadas, borradores, con error de video)

- [ ] **FASE 8 CUMPLIDA**

### Fase 9 · Panel administrativo — alta y edición

- [ ] Formulario: título, descripción, categoría, nivel, acceso (gratis/restringido), orden
- [ ] Miniatura: subida de imagen a Supabase Storage
- [ ] Editar una clase existente

- [ ] **FASE 9 CUMPLIDA**

### Fase 10 · Panel administrativo — subida de video

- [ ] Subida del video con barra de progreso (PUT directo a R2)
- [ ] Confirmación automática al terminar (`admin-sync-video` + duración calculada en el navegador)
- [ ] Reintentar una subida que quedó pendiente o con error

- [ ] **FASE 10 CUMPLIDA**

### Fase 11 · Panel administrativo — publicar y borrar

- [ ] Publicar / despublicar (no se puede publicar sin video listo)
- [ ] Eliminar clase (borra el objeto en R2 primero; si falla, no borra nada)
- [ ] Confirmaciones antes de las acciones destructivas

- [ ] **FASE 11 CUMPLIDA**

### Fase 12 · Cuentas reales — infraestructura

- [ ] Crear el proyecto en Supabase y aplicar la migración (`npm run sb:db-push`)
- [ ] Crear el bucket en Cloudflare R2 y el token de API (permiso Object Read & Write, ver Fase 0)
- [ ] Cargar los secretos del backend (`npm run sb:secrets`) y correr `npm run doctor:online`

- [ ] **FASE 12 CUMPLIDA**

### Fase 13 · Prueba con un solo video real

- [ ] Upload a R2 real · confirmación de subida (`admin-sync-video`) · asociación con Supabase
- [ ] Reproducción · autenticación · seguridad (probar que una URL suelta no sirve)
- [ ] `npm run test:integration` en verde contra las cuentas reales

- [ ] **FASE 13 CUMPLIDA**

### Fase 14 · Prueba con un solo video — progreso, responsive y costo

- [ ] Progreso y "continuar" con el video real
- [ ] Responsive: escritorio y móvil (Chrome, Safari iOS)
- [ ] Validar el costo real de almacenamiento y ajustar la estimación de la Fase 0

- [ ] **FASE 14 CUMPLIDA**

### Fase 15 · Escalado — varios videos

- [ ] 1 → 3 → 10 videos, cargados desde el panel sin tocar código
- [ ] Revisar tiempos de subida y de listado con más contenido

- [ ] **FASE 15 CUMPLIDA**

### Fase 16 · Escalado — catálogo completo

- [ ] Cargar el catálogo completo (~40 videos)
- [ ] Revisar costos con uso real (almacenamiento en R2, base de Supabase)

- [ ] **FASE 16 CUMPLIDA**

### Fase 17 · Entrega — dominio y correo

- [ ] Dominio propio conectado y `ALLOWED_ORIGINS` con el dominio final (sin `localhost` ni comodines)
- [ ] SMTP propio configurado para la recuperación de contraseña + SPF/DKIM/DMARC

- [ ] **FASE 17 CUMPLIDA**

### Fase 18 · Entrega — monitoreo y respaldo

- [ ] Monitor de UptimeRobot activo y probado (que el proyecto gratuito de Supabase no se pause)
- [ ] Copia de seguridad manual de la base antes de abrir el registro al público (el plan gratuito no la incluye)

- [ ] **FASE 18 CUMPLIDA**

### Fase 19 · Entrega — recorrido y traspaso

- [ ] Recorrido completo con el cliente: subir un video, publicarlo, verlo como usuario, borrar de prueba
- [ ] Traspaso de accesos: quién queda con las claves de Supabase, Cloudflare y Hostinger
- [ ] Documentación de puesta en marcha entregada y revisada (`docs/PUESTA-EN-MARCHA.md`)

- [ ] **FASE 19 CUMPLIDA**

### Fase 20 · Entrega — cierre (día de entrega del proyecto)

- [ ] Todas las fases anteriores cumplidas
- [ ] Última pasada de `npm run verify` + `npm run test:e2e` en verde
- [ ] Firma de conformidad / aceptación del cliente

- [ ] **FASE 20 CUMPLIDA — PROYECTO ENTREGADO**

---

## Tareas externas pendientes

Dependen de las cuentas del cliente (yo no tengo acceso a ellas); bloquean el cierre de la Fase 12 en
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
