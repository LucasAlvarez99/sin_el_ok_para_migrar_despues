# YogaPop Up · Backend (Supabase + Bunny Stream)

El video vive en **Bunny Stream**; usuarios, clases, permisos y progreso viven en **Supabase**.
Hostinger solo sirve la web estática (no guarda videos). Ningún secreto llega al navegador:
las claves de Bunny y la service role de Supabase solo existen como *secrets* de las Edge Functions.

```
Navegador ──► Edge Functions (Supabase) ──► Bunny Stream (API)
    │                 │
    │                 └──► Postgres (RLS, can_access_class, save_progress)
    └── sube el video DIRECTO a Bunny con una firma prefirmada (TUS)
    └── reproduce HLS con una URL firmada que vence
```

## Funciones

| Función | Quién | Qué hace |
|---|---|---|
| `admin-create-upload` | admin | Crea el video en Bunny + la clase, y devuelve la firma para subir directo a Bunny. Con `class_id` asocia el video a una clase existente. |
| `admin-sync-video` | admin | Consulta a Bunny el estado/duración real y lo refleja en la clase. |
| `admin-delete-class` | admin | Borra el video en Bunny y luego la clase. Si Bunny falla, no borra nada (se reintenta). |
| `playback` | usuario con acceso | Devuelve la URL HLS firmada (vence) + desde dónde retomar. |
| `bunny-webhook` | Bunny | Aviso automático de "video procesado". Firmado con HMAC. |
| `health` | pública | Ping a la base, para UptimeRobot. |

Publicar / despublicar se hace directo contra la tabla `classes` (permitido solo a admin por RLS).
El progreso se guarda con la función SQL `save_progress()` (no pasa por Edge Functions).

## Puesta en marcha

### 1. Bunny Stream
1. Crear una **Video Library**. Anotar el **Library ID**, la **API Key**, la **Read-Only API Key** y el
   **CDN hostname** (`vz-xxxxxxxx-xxx.b-cdn.net`) de la pestaña API de la librería.
2. En el **Pull Zone** de esa librería → *Security → Token Authentication*: activarlo y copiar la
   **URL Token Authentication Key**. (Se usa el modo *Advanced*/directorio: es lo que hace que los
   segmentos HLS hereden la autorización.)
3. En la librería → *Encoding*: dejar solo las resoluciones necesarias (**720p suele alcanzar** para
   yoga; cada resolución extra suma almacenamiento).
4. En la librería → *Webhooks*: URL `https://<PROJECT_REF>.supabase.co/functions/v1/bunny-webhook`.
5. (Opcional) *Security → Allowed domains*: el dominio de la web.

> Los nombres exactos de los menús pueden variar; lo importante es cada dato de la lista.

### 2. Supabase
Desde la **raíz del proyecto** (ver README principal: `npm install` y completar `.env`):
1. Crear el proyecto en supabase.com y copiar el *Reference ID* a `SUPABASE_PROJECT_REF` en `.env`.
2. `npm run sb:login` (abre el navegador) y luego `npm run sb:link`.
3. `npm run sb:db-push` aplica la base (`supabase/migrations/`).
4. Registrar la primera cuenta desde la web y convertirla en admin con
   `supabase/promote_admin.example.sql` (SQL Editor de Supabase).
5. Completar `supabase/.env` con los datos de Bunny y ejecutar `npm run sb:secrets`.
6. `npm run sb:deploy` publica las funciones.

### 3. UptimeRobot (que el proyecto gratuito no se pause)
Monitor **HTTP(s)**, intervalo **5 min**, URL: `https://<PROJECT_REF>.supabase.co/functions/v1/health`.
Además avisa por mail si la base cae. Son ~8.600 llamadas/mes (el plan gratuito incluye 500.000).

## Costos (referencia, USD; verificar en las páginas oficiales)
Precios de Bunny Stream según su página oficial de precios (19/09/2026): codificación **gratis**;
almacenamiento **0,01 USD/GB/mes**; tráfico Standard **0,010 USD/GB** en Europa/Norteamérica
(0,045 en Sudamérica; existe una red "Volume" más barata con menos puntos de presencia). Mínimo
mensual: 1 USD.

Supuestos (a validar con el primer video en la Fase 8): 40 clases de ~45 min ≈ 2 GB c/u con sus
resoluciones → ~80 GB; una clase vista completa a 720p ≈ 0,85 GB.

| Reproducciones completas / mes | Tráfico | Bunny aprox. |
|---|---|---|
| 100 | ~85 GB | ~1,7 USD (incl. almacenamiento) |
| 500 | ~425 GB | ~5 USD |
| 2.000 | ~1,7 TB | ~18 USD |

Supabase plan gratuito (500 MB base, 1 GB storage, 5 GB egress, 500.000 invocaciones): alcanza de
sobra. **Ojo**: no incluye copias de seguridad ni SLA; si la base pasa a ser crítica para el
cliente, el plan Pro es el paso siguiente.

## Pruebas
```
npm test           # 37 pruebas: firmas, permisos, flujos y casos de error (sin red)
npm run verify     # formato + lint + tipos + pruebas
```
Las pruebas viven en `supabase/functions/_tests/` y simulan Bunny y la base en memoria. Lo que **no**
cubren (se valida con el primer video real, Fase 8): la API real de Bunny, la subida TUS desde el
navegador, CORS del Pull Zone con hls.js, y los adaptadores `repo.supabase.ts` / `auth.supabase.ts`
contra un proyecto real.
