/*
 * Configuración PÚBLICA del frontend (se descarga en el navegador de cualquier visitante).
 *
 * Estos valores NO son secretos: la "anon key" está pensada para el navegador y la protegen
 * las políticas RLS de la base. NUNCA pegar acá la service role key ni claves de Bunny:
 * esas viven solo en supabase/.env (backend).
 *
 * Completar con: Supabase > Project Settings > API.
 */
window.YOGAPOPUP_CONFIG = Object.freeze({
  SUPABASE_URL: 'https://TU-PROYECTO.supabase.co',
  SUPABASE_ANON_KEY: 'TU-ANON-KEY-PUBLICA',
  // Opcional (por defecto: SUPABASE_URL + '/functions/v1')
  FUNCTIONS_URL: 'https://TU-PROYECTO.supabase.co/functions/v1',
  // URL de la política de privacidad. Si se completa, el registro exige aceptarla (RGPD/LOPDGDD).
  PRIVACY_URL: '',
  // Cada cuántos segundos de reproducción se guarda el progreso.
  PROGRESS_INTERVAL_SECONDS: 15,
});
