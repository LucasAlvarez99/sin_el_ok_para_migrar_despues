import { createEndpoint, HttpError, readJson } from "../_shared/http.ts";
import { parseCreateClassInput } from "../_shared/validate.ts";
import { type ClassRow, type HandlerDeps, toPublicClass } from "../_shared/ports.ts";

/**
 * POST { title, description?, category?, level?, access_level?, sort_order?, class_id? }
 *
 * Solo admin. Crea el video en Bunny, crea (o completa) la clase en la base y devuelve
 * las credenciales prefirmadas para que el NAVEGADOR suba el archivo directo a Bunny (TUS).
 *  - Sin class_id: crea una clase nueva con su video.
 *  - Con class_id: asocia un video nuevo a una clase existente que todavía no tiene uno.
 */
export function createHandler(deps: HandlerDeps) {
  const { bunny, repo, auth, config } = deps;

  return createEndpoint({
    methods: ["POST"],
    allowedOrigins: config.allowedOrigins,
    run: async (req) => {
      const admin = await auth.requireAdmin(req);
      const input = parseCreateClassInput(await readJson(req));

      let row: ClassRow;

      if (input.classId) {
        const existing = await repo.getClass(input.classId);
        if (!existing) throw new HttpError(404, "class_not_found", "Class not found");
        if (existing.bunny_video_id) {
          throw new HttpError(409, "video_already_attached", "This class already has a video");
        }
        const video = await bunny.createVideo(existing.title);
        let attached: ClassRow | null;
        try {
          attached = await repo.attachVideo(existing.id, {
            bunny_video_id: video.guid,
            bunny_library_id: bunny.libraryId,
          });
        } catch (e) {
          await cleanupVideo(bunny, video.guid);
          throw e;
        }
        if (!attached) {
          // Otra petición se adelantó: no dejamos un video huérfano en Bunny.
          await cleanupVideo(bunny, video.guid);
          throw new HttpError(409, "video_already_attached", "This class already has a video");
        }
        row = attached;
      } else {
        const video = await bunny.createVideo(input.title);
        try {
          row = await repo.insertClass({
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

      const upload = await bunny.createUploadCredentials(row.bunny_video_id!, config.uploadTtlSeconds);
      return { class: toPublicClass(row), upload };
    },
  });
}

/** Compensación: si falla la base, borramos el video recién creado (best effort). */
async function cleanupVideo(bunny: HandlerDeps["bunny"], videoId: string): Promise<void> {
  try {
    await bunny.deleteVideo(videoId);
  } catch (e) {
    console.error("[cleanup] could not delete orphan Bunny video", videoId, e instanceof Error ? e.message : e);
  }
}
