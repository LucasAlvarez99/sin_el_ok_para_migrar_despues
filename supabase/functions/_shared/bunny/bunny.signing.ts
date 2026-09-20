/**
 * Firmas y tokens de Bunny. Funciones puras, sin red ni Deno: se pueden probar en cualquier runtime.
 * Solo usa WebCrypto (crypto.subtle), disponible en Deno y Node >= 18.
 */

const encoder = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function toBase64Url(buf: ArrayBuffer): string {
  let bin = "";
  for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacSha256(key: string, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
}

/**
 * Firma de subida TUS prefirmada:
 *   SHA256(libraryId + apiKey + expire + videoId) en hex
 * https://docs.bunny.net/stream/tus-resumable-uploads
 */
export async function signTusUpload(
  libraryId: string,
  apiKey: string,
  expire: number,
  videoId: string,
): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`${libraryId}${apiKey}${expire}${videoId}`));
  return toHex(digest);
}

/**
 * URL firmada de directorio (Advanced Token Authentication), con el token en la RUTA.
 * Es lo que necesita HLS: el player resuelve los segmentos relativos contra la URL del
 * manifiesto, así que heredan el token sin tocar hls.js.
 *
 *   token = "HS256-" + Base64URL( HMAC-SHA256(key, tokenPath + expires + "token_path=" + tokenPath) )
 *   URL   = https://host/bcdn_token=<token>&token_path=<enc(tokenPath)>&expires=<exp><pathname>
 *
 * Réplica de la implementación de referencia oficial (BunnyWay/BunnyCDN.TokenAuthentication,
 * nodejs/token.js) para el caso: sin IP, sin países, sin límite de velocidad, sin query params.
 * Los tests comparan el resultado contra ese código oficial.
 */
export async function signBunnyDirectoryUrl(opts: {
  /** URL completa del recurso, ej. https://vz-xxx.b-cdn.net/<guid>/playlist.m3u8 */
  url: string;
  securityKey: string;
  /** Prefijo de directorio autorizado, ej. "/<guid>/" (debe terminar en "/") */
  tokenPath: string;
  /** UNIX timestamp (segundos) de vencimiento */
  expires: number;
}): Promise<string> {
  const { url, securityKey, tokenPath, expires } = opts;
  if (!securityKey) throw new Error("securityKey must not be empty");
  if (!tokenPath.startsWith("/") || !tokenPath.endsWith("/")) {
    throw new Error("tokenPath must start and end with '/'");
  }
  const parsed = new URL(url);
  if (!parsed.pathname.startsWith(tokenPath)) {
    throw new Error("url pathname must be inside tokenPath");
  }

  const signingData = `token_path=${tokenPath}`;
  const digest = await hmacSha256(securityKey, `${tokenPath}${expires}${signingData}`);
  const token = `HS256-${toBase64Url(digest)}`;

  return `${parsed.protocol}//${parsed.host}/bcdn_token=${token}` +
    `&token_path=${encodeURIComponent(tokenPath)}&expires=${expires}${parsed.pathname}`;
}

/**
 * Valida la firma de un webhook de Bunny Stream (v1):
 *   hex( HMAC-SHA256( rawBody, readOnlyApiKey ) ), comparación en tiempo constante.
 * https://docs.bunny.net/stream/webhooks
 */
export async function verifyWebhookSignature(opts: {
  rawBody: string;
  signature: string | null;
  version: string | null;
  algorithm: string | null;
  secret: string;
}): Promise<boolean> {
  const { rawBody, signature, version, algorithm, secret } = opts;
  if (version !== "v1" || algorithm !== "hmac-sha256") return false;
  if (typeof signature !== "string" || !/^[0-9a-f]{64}$/.test(signature)) return false;
  const expected = toHex(await hmacSha256(secret, rawBody));
  return timingSafeEqualStr(expected, signature);
}

/** Comparación en tiempo constante para strings de igual longitud. */
export function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
