/**
 * Tipos de la capa Bunny Stream.
 * Referencia: https://docs.bunny.net/api-reference/stream
 */

/**
 * Estados de un video según la API "Get Video" (VideoModelStatus).
 * OJO: NO son los mismos números que envía el webhook (ese enum es distinto).
 * Por eso el webhook solo se usa como aviso y el estado real se consulta a la API.
 */
export enum BunnyVideoStatus {
  Created = 0,
  Uploaded = 1,
  Processing = 2,
  Transcoding = 3,
  Finished = 4,
  Error = 5,
  UploadFailed = 6,
  JitSegmenting = 7,
  JitPlaylistsCreated = 8,
}

/** Respuesta (parcial) de la API de Bunny para un video. Solo los campos que usamos. */
export interface BunnyVideo {
  guid: string;
  videoLibraryId: number;
  title: string;
  /** Duración en segundos (0 hasta que Bunny procesa el archivo). */
  length: number;
  status: BunnyVideoStatus;
  encodeProgress?: number;
  /** Ej: "240p,360p,720p" */
  availableResolutions?: string | null;
  thumbnailFileName?: string | null;
}

/** Estado de video que guardamos en public.classes.video_status */
export type ClassVideoStatus = "pending" | "uploading" | "processing" | "ready" | "failed";

/** Credenciales prefirmadas para que el NAVEGADOR suba directo a Bunny (TUS). */
export interface TusUploadCredentials {
  endpoint: string;
  libraryId: string;
  videoId: string;
  /** UNIX timestamp (segundos) en que vence la autorización de subida. */
  expire: number;
  /** SHA256(libraryId + apiKey + expire + videoId), hex. */
  signature: string;
}

export interface SignedPlayback {
  /** URL del manifiesto HLS con el token embebido en la ruta. */
  hlsUrl: string;
  /** UNIX timestamp (segundos) en que vence la URL firmada. */
  expiresAt: number;
}

export interface BunnyConfig {
  apiKey: string;
  libraryId: string;
  /** Hostname del Pull Zone de la librería, ej: vz-xxxxxxxx-xxx.b-cdn.net (sin https://) */
  cdnHostname: string;
  /** "URL Token Authentication Key" del Pull Zone (modo Advanced). */
  tokenAuthKey: string;
  /** Clave de solo lectura de la librería: firma los webhooks entrantes. */
  readOnlyApiKey?: string;
  apiBaseUrl?: string;
  tusEndpoint?: string;
  /** Inyectable para tests. */
  fetchImpl?: typeof fetch;
  /** Inyectable para tests (segundos UNIX). */
  nowSeconds?: () => number;
  requestTimeoutMs?: number;
}
