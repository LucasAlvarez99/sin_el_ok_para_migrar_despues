-- PRIMERA CLASE, SIN PANEL (hasta que exista el panel de negocio).
-- Pasos previos, a mano:
--   1. En Bunny: Stream → tu librería → Upload: sube el video y espera a que termine de procesarse.
--   2. Copia su "Video ID" (un GUID) y su duración en segundos.
-- Luego ejecuta esto en Supabase > SQL Editor (ahí sí se pueden escribir las columnas de Bunny).
insert into public.classes (
  title, description, level, category, access_level, sort_order,
  bunny_video_id, bunny_library_id, video_status, duration_seconds, is_published
) values (
  'Yoga para principiantes',                        -- título
  'Una práctica suave para empezar.',               -- descripción
  'principiante',                                   -- principiante | intermedio | avanzado | todos
  'Vinyasa',                                        -- categoría
  'free',                                           -- free (cualquier usuario registrado) | restricted (requiere permiso)
  0,                                                -- orden en la videoteca
  'REEMPLAZAR-GUID-DEL-VIDEO-EN-BUNNY',             -- Video ID de Bunny
  'REEMPLAZAR-ID-DE-LA-LIBRERIA',                   -- Library ID de Bunny
  'ready',                                          -- el video ya está procesado
  2700,                                             -- duración en segundos (45 min)
  true                                              -- publicada
);
-- Miniatura: súbela al bucket "class-thumbnails" (Storage) y guarda su URL pública:
--   update public.classes set thumbnail_url = 'https://<proyecto>.supabase.co/storage/v1/object/public/class-thumbnails/<archivo>.webp'
--   where title = 'Yoga para principiantes';
