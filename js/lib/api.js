import { cfg } from './env.js';
import { supabase } from './supabase.js';
import { accessToken } from './session.js';
import { AppError } from './errors.js';

/**
 * Acceso a datos y a las Edge Functions.
 * Regla: con `classes` NUNCA usar select('*'): las columnas de Bunny están restringidas en la base
 * (privilegios por columna) y pedirlas falla. Por eso las columnas se listan explícitamente.
 */
export const CLASS_COLUMNS =
  'id,title,description,thumbnail_url,duration_seconds,level,category,access_level,sort_order,is_published,published_at,video_status,created_at,updated_at';
const CARD_COLUMNS = 'id,title,thumbnail_url,duration_seconds,level,category,access_level';

function db() {
  if (!supabase) throw new AppError('not_configured');
  return supabase;
}

function unwrap({ data, error }) {
  if (error) throw new AppError(error.code === 'PGRST301' ? 'unauthenticated' : 'internal_error', error.message);
  return data;
}

// ---------------------------------------------------------------- catálogo (público) y progreso
export async function listPublishedClasses({ limit } = {}) {
  let q = db().from('classes').select(CLASS_COLUMNS).eq('is_published', true)
    .order('sort_order', { ascending: true }).order('published_at', { ascending: false });
  if (limit) q = q.limit(limit);
  return unwrap(await q) ?? [];
}

export async function getClass(id) {
  return unwrap(await db().from('classes').select(CLASS_COLUMNS).eq('id', id).maybeSingle());
}

/** Progreso propio de todas las clases: { [classId]: { progress_seconds, completed } } */
export async function getMyProgressMap() {
  const rows = unwrap(await db().from('video_progress').select('class_id,progress_seconds,completed')) ?? [];
  return Object.fromEntries(rows.map((r) => [r.class_id, { progress_seconds: r.progress_seconds, completed: r.completed }]));
}

/** "Continuar viendo": clases empezadas y no terminadas, la más reciente primero. */
export async function listContinueWatching(limit = 6) {
  const rows = unwrap(await db().from('video_progress')
    .select(`progress_seconds,completed,last_watched_at,classes(${CARD_COLUMNS})`)
    .eq('completed', false).gt('progress_seconds', 4)
    .order('last_watched_at', { ascending: false }).limit(limit)) ?? [];
  return rows.filter((r) => r.classes); // una clase despublicada después ya no se muestra
}

export async function saveProgress(classId, seconds) {
  const { error } = await db().rpc('save_progress', { p_class_id: classId, p_seconds: Math.floor(seconds) });
  if (error) throw new AppError(error.code === '42501' ? 'no_access' : 'internal_error', error.message);
}

/**
 * Guardado al cerrar/ocultar la pestaña: fetch con `keepalive`, que el navegador completa aunque la
 * página se cierre. Usa el token ya cacheado (no se puede esperar a una promesa al descargar la página).
 */
export function saveProgressOnUnload(classId, seconds) {
  const token = accessToken();
  if (!token || !cfg.SUPABASE_URL) return;
  try {
    fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/save_progress`, {
      method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json', apikey: cfg.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ p_class_id: classId, p_seconds: Math.floor(seconds) }),
    }).catch(() => {});
  } catch { /* nada más que hacer al cerrar */ }
}

// ---------------------------------------------------------------- Edge Functions
export async function callFunction(name, body = {}) {
  const token = accessToken();
  if (!token) throw new AppError('unauthenticated');
  let res;
  try {
    res = await fetch(`${cfg.FUNCTIONS_URL}/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: cfg.SUPABASE_ANON_KEY },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AppError('network');
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new AppError(json?.error?.code || 'internal_error', json?.error?.message, res.status);
  return json;
}

/** URL HLS firmada + punto de reanudación. Falla con no_access / video_not_ready / class_not_found. */
export const getPlayback = (classId) => callFunction('playback', { class_id: classId });

// ---------------------------------------------------------------- administración
export async function adminListClasses() {
  return unwrap(await db().from('classes').select(CLASS_COLUMNS).order('created_at', { ascending: false })) ?? [];
}

export const adminCreateUpload = (payload) => callFunction('admin-create-upload', payload);
export const adminSyncVideo = (classId) => callFunction('admin-sync-video', { class_id: classId });
export const adminDeleteClass = (classId) => callFunction('admin-delete-class', { class_id: classId });

const EDITABLE = ['title', 'description', 'thumbnail_url', 'level', 'category', 'access_level', 'sort_order', 'is_published'];

/** Edita metadatos y publica/despublica. La base rechaza publicar una clase sin video listo. */
export async function adminUpdateClass(id, patch) {
  const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => EDITABLE.includes(k)));
  const { data, error } = await db().from('classes').update(clean).eq('id', id).select(CLASS_COLUMNS).single();
  if (error) {
    if (error.code === '23514') throw new AppError('video_not_ready', 'No se puede publicar: el video todavía no está listo.');
    throw new AppError('internal_error', error.message);
  }
  return data;
}

// ---------------------------------------------------------------- miniaturas (Supabase Storage)
export const THUMB_BUCKET = 'class-thumbnails';

/** Sube la miniatura (ya reducida) y devuelve su URL pública. */
export async function uploadThumbnail(classId, blob) {
  const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `${classId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await db().storage.from(THUMB_BUCKET).upload(path, blob, { contentType: blob.type, cacheControl: '31536000' });
  if (error) throw new AppError('internal_error', 'No se pudo subir la miniatura.');
  return db().storage.from(THUMB_BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function deleteThumbnailByUrl(url) {
  const marker = `/storage/v1/object/public/${THUMB_BUCKET}/`;
  const i = String(url || '').indexOf(marker);
  if (i < 0) return;
  await db().storage.from(THUMB_BUCKET).remove([decodeURIComponent(url.slice(i + marker.length).split('?')[0])]);
}

// ---------------------------------------------------------------- subida del video (TUS directo a Bunny)
/**
 * Sube el archivo directo a Bunny con credenciales prefirmadas (el archivo no pasa por el backend).
 * Reanudable: si la subida se corta, al reintentar retoma desde donde quedó.
 * @returns {{ promise: Promise<void>, abort: () => void }}
 */
export function uploadVideoToBunny(file, creds, { title, onProgress } = {}) {
  if (!window.tus) throw new AppError('internal_error', 'Falta la librería de subida.');
  let upload;
  const promise = new Promise((resolve, reject) => {
    upload = new window.tus.Upload(file, {
      endpoint: creds.endpoint,
      retryDelays: [0, 3000, 5000, 10000, 20000, 30000],
      headers: {
        AuthorizationSignature: creds.signature,
        AuthorizationExpire: String(creds.expire),
        VideoId: creds.videoId,
        LibraryId: creds.libraryId,
      },
      metadata: { filetype: file.type || 'video/mp4', title: title || file.name },
      onError: (err) => reject(new AppError('upload_failed', `La subida falló: ${err?.message || 'error de red'}`)),
      onProgress: (sent, total) => onProgress?.(sent, total),
      onSuccess: () => resolve(),
    });
    upload.findPreviousUploads().then((prev) => {
      if (prev.length) upload.resumeFromPreviousUpload(prev[0]);
      upload.start();
    }).catch(() => upload.start());
  });
  return { promise, abort: () => upload?.abort(true) };
}

/** Reduce una imagen a un ancho máximo y la convierte a WebP (ahorra almacenamiento y ancho de banda). */
export async function resizeImage(file, { maxWidth = 1280, quality = 0.82 } = {}) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new AppError('invalid_input', 'La miniatura debe ser JPG, PNG o WebP.');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxWidth / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
  if (!blob) throw new AppError('internal_error', 'No se pudo procesar la imagen.');
  return blob;
}
