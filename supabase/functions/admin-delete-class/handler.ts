import { createEndpoint, HttpError, readJson } from "../_shared/http.ts";
import { parseUuid } from "../_shared/validate.ts";
import type { HandlerDeps } from "../_shared/ports.ts";

/**
 * POST { class_id }
 * Solo admin. Borra el video en Bunny y luego la clase (el progreso y los permisos
 * asociados se eliminan en cascada). Si Bunny falla, NO se borra la clase: el admin puede
 * reintentar y no quedan videos huérfanos ocupando (y cobrando) almacenamiento.
 */
export function createHandler(deps: HandlerDeps) {
  const { bunny, repo, auth, config } = deps;

  return createEndpoint({
    methods: ["POST"],
    allowedOrigins: config.allowedOrigins,
    run: async (req) => {
      await auth.requireAdmin(req);
      const classId = parseUuid((await readJson(req)).class_id, "class_id");

      const row = await repo.getClass(classId);
      if (!row) throw new HttpError(404, "class_not_found", "Class not found");

      let videoDeleted = false;
      if (row.bunny_video_id) videoDeleted = await bunny.deleteVideo(row.bunny_video_id);

      await repo.deleteClass(row.id);
      return { deleted: true, class_id: row.id, video_deleted: videoDeleted };
    },
  });
}
