import {
  type BunnyConfig,
  type BunnyVideo,
  BunnyVideoStatus,
  type ClassVideoStatus,
  type SignedPlayback,
  type TusUploadCredentials,
} from "./bunny.types.ts";
import { signBunnyDirectoryUrl, signTusUpload } from "./bunny.signing.ts";

const DEFAULT_API_BASE = "https://video.bunnycdn.com";
const DEFAULT_TUS_ENDPOINT = "https://video.bunnycdn.com/tusupload";
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Error de la capa Bunny. Nunca incluye credenciales en el mensaje. */
export class BunnyError extends Error {
  constructor(message: string, public readonly status: number, public readonly operation: string) {
    super(message);
    this.name = "BunnyError";
  }
}

/**
 * Único punto del sistema que habla con Bunny Stream.
 * Corre solo en el backend (Edge Functions): la API key nunca llega al navegador.
 */
export class BunnyService {
  private readonly cfg: Required<Pick<BunnyConfig, "apiBaseUrl" | "tusEndpoint" | "requestTimeoutMs">> & BunnyConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(config: BunnyConfig) {
    if (!/^\d+$/.test(config.libraryId)) throw new Error("BUNNY_LIBRARY_ID must be numeric");
    if (!config.apiKey) throw new Error("BUNNY_API_KEY is required");
    if (!config.tokenAuthKey) throw new Error("BUNNY_TOKEN_AUTH_KEY is required");
    if (!config.cdnHostname || /^https?:\/\//.test(config.cdnHostname) || config.cdnHostname.includes("/")) {
      throw new Error("BUNNY_CDN_HOSTNAME must be a bare hostname like vz-xxxx.b-cdn.net");
    }
    this.cfg = {
      apiBaseUrl: DEFAULT_API_BASE,
      tusEndpoint: DEFAULT_TUS_ENDPOINT,
      requestTimeoutMs: 10_000,
      ...config,
    };
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.now = config.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  }

  get libraryId(): string {
    return this.cfg.libraryId;
  }

  // ---------------------------------------------------------------- videos

  /** Crea el objeto de video (vacío) en Bunny. El archivo se sube después con TUS. */
  async createVideo(title: string): Promise<BunnyVideo> {
    return await this.request<BunnyVideo>("createVideo", "POST", `/library/${this.cfg.libraryId}/videos`, { title });
  }

  async getVideo(videoId: string): Promise<BunnyVideo> {
    assertGuid(videoId);
    return await this.request<BunnyVideo>("getVideo", "GET", `/library/${this.cfg.libraryId}/videos/${videoId}`);
  }

  /** Igual que getVideo pero devuelve null si Bunny responde 404. */
  async getVideoOrNull(videoId: string): Promise<BunnyVideo | null> {
    try {
      return await this.getVideo(videoId);
    } catch (e) {
      if (e instanceof BunnyError && e.status === 404) return null;
      throw e;
    }
  }

  /** Borra el video en Bunny. Idempotente: si ya no existe (404) devuelve false sin error. */
  async deleteVideo(videoId: string): Promise<boolean> {
    assertGuid(videoId);
    try {
      await this.request<unknown>("deleteVideo", "DELETE", `/library/${this.cfg.libraryId}/videos/${videoId}`);
      return true;
    } catch (e) {
      if (e instanceof BunnyError && e.status === 404) return false;
      throw e;
    }
  }

  // ---------------------------------------------------------------- upload (TUS prefirmado)

  /**
   * Credenciales para que el navegador suba el archivo DIRECTO a Bunny con tus-js-client.
   * El archivo no pasa por Supabase ni por Hostinger. Headers a enviar desde el cliente:
   *   AuthorizationSignature, AuthorizationExpire, LibraryId, VideoId.
   */
  async createUploadCredentials(videoId: string, ttlSeconds = 4 * 3600): Promise<TusUploadCredentials> {
    assertGuid(videoId);
    const expire = this.now() + ttlSeconds;
    const signature = await signTusUpload(this.cfg.libraryId, this.cfg.apiKey, expire, videoId);
    return { endpoint: this.cfg.tusEndpoint, libraryId: this.cfg.libraryId, videoId, expire, signature };
  }

  // ---------------------------------------------------------------- reproducción

  /**
   * URL HLS firmada, con vencimiento, para UN video. El token cubre el directorio /<guid>/,
   * así que sirve para el manifiesto y todos los segmentos.
   */
  async signPlayback(videoId: string, ttlSeconds = 2 * 3600): Promise<SignedPlayback> {
    assertGuid(videoId);
    const expiresAt = this.now() + ttlSeconds;
    const hlsUrl = await signBunnyDirectoryUrl({
      url: `https://${this.cfg.cdnHostname}/${videoId}/playlist.m3u8`,
      securityKey: this.cfg.tokenAuthKey,
      tokenPath: `/${videoId}/`,
      expires: expiresAt,
    });
    return { hlsUrl, expiresAt };
  }

  // ---------------------------------------------------------------- estado

  /** Traduce el estado de Bunny al que guardamos en public.classes.video_status. */
  static mapStatus(status: BunnyVideoStatus): ClassVideoStatus {
    switch (status) {
      case BunnyVideoStatus.Created:
        return "pending";
      case BunnyVideoStatus.Uploaded:
      case BunnyVideoStatus.Processing:
      case BunnyVideoStatus.Transcoding:
      case BunnyVideoStatus.JitSegmenting:
        return "processing";
      case BunnyVideoStatus.Finished:
      case BunnyVideoStatus.JitPlaylistsCreated:
        return "ready";
      case BunnyVideoStatus.Error:
      case BunnyVideoStatus.UploadFailed:
        return "failed";
      default:
        // Estado desconocido: no lo marcamos "ready" por las dudas.
        return "processing";
    }
  }

  // ---------------------------------------------------------------- HTTP

  private async request<T>(operation: string, method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.cfg.apiBaseUrl}${path}`, {
        method,
        headers: {
          AccessKey: this.cfg.apiKey,
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.cfg.requestTimeoutMs),
      });
    } catch (e) {
      const timedOut = e instanceof DOMException && e.name === "TimeoutError";
      throw new BunnyError(timedOut ? "Bunny request timed out" : "Bunny request failed", 0, operation);
    }
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      throw new BunnyError(`Bunny ${operation} failed (${res.status}) ${detail}`.trim(), res.status, operation);
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : {}) as T;
  }
}

function assertGuid(id: string): void {
  if (!GUID_RE.test(id)) throw new BunnyError("Invalid Bunny video id", 400, "validate");
}
