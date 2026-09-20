import { BunnyService } from "./bunny/bunny.service.ts";
import type { BunnyVideo } from "./bunny/bunny.types.ts";
import type { ClassRepo, ClassRow, VideoStatePatch } from "./ports.ts";

/**
 * Lleva a la fila de public.classes lo que Bunny dice del video.
 * La usan la sincronización manual (admin-sync-video) y el webhook.
 *
 * Reglas:
 *  - "ready" solo cuando Bunny terminó de procesar (Finished / JitPlaylistsCreated).
 *  - Un video que deja de estar listo nunca queda publicado (lo exige un CHECK en la base).
 *  - Nunca publica solo: publicar es una decisión explícita del admin.
 *  - No degrada "uploading" a "pending" (Bunny sigue diciendo "Created" durante la subida).
 */
export async function applyVideoState(
  repo: ClassRepo,
  row: ClassRow,
  video: BunnyVideo | null,
  hint?: { uploadStarted?: boolean; uploadFailed?: boolean },
): Promise<ClassRow> {
  let status = video ? BunnyService.mapStatus(video.status) : "failed" as const;

  if (hint?.uploadFailed) status = "failed";
  if (status === "pending" && (hint?.uploadStarted || row.video_status === "uploading")) status = "uploading";

  const duration = video && video.length > 0 ? Math.round(video.length) : row.duration_seconds;

  const patch: VideoStatePatch = {};
  if (status !== row.video_status) patch.video_status = status;
  if (duration !== row.duration_seconds) patch.duration_seconds = duration;
  if (status !== "ready" && row.is_published) patch.is_published = false;

  if (Object.keys(patch).length === 0) return row;
  return await repo.updateVideoState(row.id, patch);
}
