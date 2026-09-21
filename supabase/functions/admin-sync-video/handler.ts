import { createEndpoint, HttpError, readJson } from "../_shared/http.ts";
import { parseUuid } from "../_shared/validate.ts";
import { type HandlerDeps, toPublicClass } from "../_shared/ports.ts";
import { applyVideoState } from "../_shared/video-sync.ts";

/**
 * POST { class_id }
 * Solo admin. Consulta a Bunny el estado real del video (procesamiento, duración) y lo
 * refleja en la clase. El panel la llama mientras el video se procesa; el webhook hace lo
 * mismo automáticamente, así que esto es la red de seguridad.
 */
export function createHandler(deps: HandlerDeps) {
  const { bunny, repo, auth, config } = deps;

  return createEndpoint({
    methods: ["POST"],
    allowedOrigins: config.allowedOrigins,
    run: async (req) => {
      await auth.requireOwner(req);
      const classId = parseUuid((await readJson(req)).class_id, "class_id");

      const row = await repo.getClass(classId);
      if (!row) throw new HttpError(404, "class_not_found", "Class not found");
      if (!row.bunny_video_id) throw new HttpError(409, "no_video", "This class has no video yet");

      const video = await bunny.getVideoOrNull(row.bunny_video_id);
      const updated = await applyVideoState(repo, row, video);
      return { class: toPublicClass(updated), bunny_found: video !== null };
    },
  });
}
