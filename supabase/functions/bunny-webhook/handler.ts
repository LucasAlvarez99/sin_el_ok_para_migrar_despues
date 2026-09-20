import { createEndpoint, HttpError } from "../_shared/http.ts";
import { verifyWebhookSignature } from "../_shared/bunny/bunny.signing.ts";
import type { HandlerDeps } from "../_shared/ports.ts";
import { applyVideoState } from "../_shared/video-sync.ts";

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Estados del WEBHOOK (enum distinto al de la API). */
const WEBHOOK_PRESIGNED_UPLOAD_STARTED = 6;
const WEBHOOK_PRESIGNED_UPLOAD_FAILED = 8;
/** 9 = subtítulos, 10 = título/descripción automáticos: no cambian el estado del video. */
const WEBHOOK_IGNORED = new Set([9, 10]);

/**
 * POST (lo llama Bunny). Se autentica con la firma HMAC del webhook, no con un JWT.
 * El webhook es solo un AVISO: el estado real se consulta a la API de Bunny, porque los
 * números del webhook y los de la API significan cosas distintas.
 */
export function createHandler(deps: HandlerDeps) {
  const { bunny, repo, config } = deps;

  return createEndpoint({
    methods: ["POST"],
    allowedOrigins: [],
    run: async (req) => {
      if (!config.webhookSecret) {
        console.error("[webhook] BUNNY_READONLY_API_KEY is not configured");
        throw new HttpError(500, "server_misconfigured", "Webhook is not configured");
      }

      const rawBody = await req.text();
      if (rawBody.length > 8 * 1024) throw new HttpError(413, "payload_too_large", "Payload too large");

      const valid = await verifyWebhookSignature({
        rawBody,
        signature: req.headers.get("x-bunnystream-signature"),
        version: req.headers.get("x-bunnystream-signature-version"),
        algorithm: req.headers.get("x-bunnystream-signature-algorithm"),
        secret: config.webhookSecret,
      });
      if (!valid) throw new HttpError(401, "invalid_signature", "Invalid signature");

      let payload: { VideoLibraryId?: unknown; VideoGuid?: unknown; Status?: unknown };
      try {
        payload = JSON.parse(rawBody);
      } catch {
        throw new HttpError(400, "invalid_json", "Invalid JSON");
      }

      const guid = typeof payload.VideoGuid === "string" ? payload.VideoGuid : "";
      const status = typeof payload.Status === "number" ? payload.Status : -1;

      if (String(payload.VideoLibraryId) !== bunny.libraryId) return { ok: true, ignored: "other_library" };
      if (!GUID_RE.test(guid)) throw new HttpError(400, "invalid_input", "Invalid VideoGuid");
      if (WEBHOOK_IGNORED.has(status)) return { ok: true, ignored: "status_not_relevant" };

      const row = await repo.getClassByBunnyVideoId(guid.toLowerCase());
      if (!row) return { ok: true, ignored: "unknown_video" }; // p. ej. la clase ya se borró

      const video = await bunny.getVideoOrNull(guid);
      await applyVideoState(repo, row, video, {
        uploadStarted: status === WEBHOOK_PRESIGNED_UPLOAD_STARTED,
        uploadFailed: status === WEBHOOK_PRESIGNED_UPLOAD_FAILED,
      });
      return { ok: true };
    },
  });
}
