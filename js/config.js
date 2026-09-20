/*
 * Configuración PÚBLICA del frontend (se descarga en el navegador de cualquier visitante).
 *
 * Estos valores NO son secretos: la "anon key" está pensada para el navegador y la protegen
 * las políticas RLS de la base. NUNCA pegar acá la service role key ni claves de Bunny:
 * esas viven solo en supabase/.env (backend).
 *
 * Todavía no la usa index.html: se conecta en las Fases 4 y 6 (reproductor y login).
 * Completar con: Supabase > Project Settings > API.
 */
window.YOGAPOPUP_CONFIG = Object.freeze({
  SUPABASE_URL: 'https://TU-PROYECTO.supabase.co',
  SUPABASE_ANON_KEY: 'TU-ANON-KEY-PUBLICA',
  FUNCTIONS_URL: 'https://TU-PROYECTO.supabase.co/functions/v1',
});
