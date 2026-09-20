import { createEndpoint, HttpError, readJson } from "../_shared/http.ts";
import { parseCreateClassInput } from "../_shared/validate.ts";
import { type ClassRow, type HandlerDeps, toPublicClass } from "../_shared/ports.ts";

/**
 * POST { title, description?, category?, level?, access_level?, sort_order?, class_id? }
 *
 * Solo admin. Deja todo listo para que el NAVEGADOR suba el archivo directo a Bunny (TUS):
 *  - Sin class_id: crea el video en Bunny + una clase nueva.
 *  - Con class_id, según el estado del video de esa clase:
 *      · sin video          -> crea el video en Bunny y lo asocia
 *      · pending/uploading  -> REANUDA: mismo video, credenciales nuevas (subida interrumpida)
 *      · failed             -> REEMPLAZA: video nuevo (y borra el fallido)
 *      · processing/ready   -> 409, ya tiene un video en uso
 */
export function createHandler(deps: HandlerDeps) {
  const { bunny, repo, auth, config } = deps;

  return createEndpoint({
    methods: ["POST"],
    allowedOrigins: config.allowedOrigins,
    run: async (req) => {
      const admin = await auth.requireAdmin(req);
      const input = parseCreateClassInput(await readJson(req));

      const { row, resumed } = input.classId
        ? await prepareExistingClass(input.classId)
        : { row: await createNewClass(), resumed: false };
      const upload = await bunny.createUploadCredentials(row.bunny_video_id!, config.uploadTtlSeconds);
      return { class: toPublicClass(row), upload, resumed };

      // ------------------------------------------------------------------ clase nueva
      async function createNewClass(): Promise<ClassRow> {
        const video = await bunny.createVideo(input.title);
        try {
          return await repo.insertClass({
            title: input.title,
            description: input.description,
            category: input.category,
            level: input.level,
            access_level: input.accessLevel,
            sort_order: input.sortOrder,
            created_by: admin.id,
            bunny_video_id: video.guid,
            bunny_library_id: bunny.libraryId,
          });
        } catch (e) {
          await cleanupVideo(bunny, video.guid);
          throw e;
        }
      }

      // ------------------------------------------------------------------ clase existente
      async function prepareExistingClass(classId: string): Promise<{ row: ClassRow; resumed: boolean }> {
        const existing = await repo.getClass(classId);
        if (!existing) throw new HttpError(404, "class_not_found", "Class not found");

        const inUse = existing.video_status === "processing" || existing.video_status === "ready";
        if (existing.bunny_video_id && inUse) {
          throw new HttpError(409, "video_already_attached", "This class already has a video");
        }

        // Subida interrumpida: se reutiliza el mismo video de Bunny (TUS permite retomar).
        if (existing.bunny_video_id && existing.video_status !== "failed") {
          return { row: existing, resumed: true };
        }

        const previousVideoId = existing.bunny_video_id; // se captura ANTES de actualizar la fila
        const video = await bunny.createVideo(existing.title);
        const target = { bunny_video_id: video.guid, bunny_library_id: bunny.libraryId };
        let saved: ClassRow | null;
        try {
          saved = previousVideoId
            ? await repo.replaceFailedVideo(existing.id, target)
            : await repo.attachVideo(existing.id, target);
        } catch (e) {
          await cleanupVideo(bunny, video.guid);
          throw e;
        }
        if (!saved) {
          // Otra petición se adelantó: no dejamos un video huérfano en Bunny.
          await cleanupVideo(bunny, video.guid);
          throw new HttpError(409, "video_already_attached", "This class already has a video");
        }
        if (previousVideoId) await cleanupVideo(bunny, previousVideoId); // el video fallido anterior
        return { row: saved, resumed: false };
      }
    },
  });
}

/** Compensación: si algo falla después de crear el video, se borra (mejor esfuerzo). */
async function cleanupVideo(bunny: HandlerDeps["bunny"], videoId: string): Promise<void> {
  try {
    await bunny.deleteVideo(videoId);
  } catch (e) {
    console.error("[cleanup] could not delete orphan Bunny video", videoId, e instanceof Error ? e.message : e);
  }
}
