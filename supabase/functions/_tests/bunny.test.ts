import assert from "node:assert/strict";
import {
  signBunnyDirectoryUrl,
  signTusUpload,
  timingSafeEqualStr,
  verifyWebhookSignature,
} from "../_shared/bunny/bunny.signing.ts";
import { BunnyError, BunnyService } from "../_shared/bunny/bunny.service.ts";
import { BunnyVideoStatus } from "../_shared/bunny/bunny.types.ts";
import { FakeBunnyApi, LIB, makeBunny, NOW } from "./fakes.ts";

const GUID = "0d8e5f3a-1b2c-4d6e-9f70-123456789abc";

Deno.test("firma de URL: idéntica a la implementación oficial de Bunny (nodejs/token.js)", async () => {
  // Vector generado con BunnyWay/BunnyCDN.TokenAuthentication -> nodejs/token.js
  const expected = "https://vz-abc12345-678.b-cdn.net/bcdn_token=HS256-JyKa5mrnRQudeHUkJ--70iCoFW04wEshIlsVetqOMi8" +
    `&token_path=%2F${GUID}%2F&expires=1900000000/${GUID}/playlist.m3u8`;
  const got = await signBunnyDirectoryUrl({
    url: `https://vz-abc12345-678.b-cdn.net/${GUID}/playlist.m3u8`,
    securityKey: "test-security-key-123",
    tokenPath: `/${GUID}/`,
    expires: 1_900_000_000,
  });
  assert.equal(got, expected);
});

Deno.test("firma de URL: valida entradas", async () => {
  const base = { url: `https://h.b-cdn.net/${GUID}/playlist.m3u8`, securityKey: "k", expires: 1 };
  await assert.rejects(signBunnyDirectoryUrl({ ...base, securityKey: "", tokenPath: `/${GUID}/` }));
  await assert.rejects(signBunnyDirectoryUrl({ ...base, tokenPath: `/${GUID}` })); // sin "/" final
  await assert.rejects(signBunnyDirectoryUrl({ ...base, tokenPath: "/otro-video/" })); // fuera del directorio
});

Deno.test("firma TUS: SHA256(libraryId+apiKey+expire+videoId), vector independiente", async () => {
  assert.equal(
    await signTusUpload("12345", "my-api-key", 1_900_000_000, GUID),
    "86b75707e4a482f7f0a192139309ce99d4f2125282ae09c6ef7c6e5fec4f15fd",
  );
});

Deno.test("webhook: vector HMAC independiente + rechazos", async () => {
  const body = `{"VideoLibraryId":12345,"VideoGuid":"${GUID}","Status":3}`;
  const good = "5cbc1f1c0e940cf8d6e833cc82725efe2a05acee26fddcfd9b05f6174bac1558";
  const base = { rawBody: body, signature: good, version: "v1", algorithm: "hmac-sha256", secret: "readonly-key" };
  assert.equal(await verifyWebhookSignature(base), true);
  assert.equal(await verifyWebhookSignature({ ...base, rawBody: body + " " }), false); // body alterado
  assert.equal(await verifyWebhookSignature({ ...base, secret: "otra" }), false);
  assert.equal(await verifyWebhookSignature({ ...base, signature: null }), false);
  assert.equal(await verifyWebhookSignature({ ...base, signature: good.toUpperCase() }), false);
  assert.equal(await verifyWebhookSignature({ ...base, version: "v2" }), false);
  assert.equal(await verifyWebhookSignature({ ...base, algorithm: "sha1" }), false);
  assert.equal(timingSafeEqualStr("abc", "abd"), false);
});

Deno.test("BunnyService: configuración inválida falla al construir", () => {
  const ok = { apiKey: "k", libraryId: "1", cdnHostname: "vz.b-cdn.net", tokenAuthKey: "t" };
  assert.throws(() => new BunnyService({ ...ok, libraryId: "abc" }));
  assert.throws(() => new BunnyService({ ...ok, cdnHostname: "https://vz.b-cdn.net" }));
  assert.throws(() => new BunnyService({ ...ok, apiKey: "" }));
  assert.throws(() => new BunnyService({ ...ok, tokenAuthKey: "" }));
});

Deno.test("BunnyService: crear, consultar y borrar (idempotente) con AccessKey", async () => {
  const api = new FakeBunnyApi();
  const bunny = makeBunny(api);
  const v = await bunny.createVideo("Yoga para principiantes");
  assert.match(v.guid, /^[0-9a-f-]{36}$/);
  assert.equal(api.calls[0].method, "POST");
  assert.equal(api.calls[0].path, `/library/${LIB}/videos`);
  assert.equal(api.calls[0].accessKey, "bunny-api-key");

  assert.equal((await bunny.getVideo(v.guid)).title, "Yoga para principiantes");
  assert.equal(await bunny.deleteVideo(v.guid), true);
  assert.equal(await bunny.deleteVideo(v.guid), false); // ya no existe: sin error
  assert.equal(await bunny.getVideoOrNull(v.guid), null);
});

Deno.test("BunnyService: ids inválidos no llegan a la red (anti path-injection)", async () => {
  const api = new FakeBunnyApi();
  const bunny = makeBunny(api);
  for (const bad of ["../../etc", "abc", `${GUID}/../x`, ""]) {
    await assert.rejects(bunny.getVideo(bad), BunnyError);
    await assert.rejects(bunny.deleteVideo(bad), BunnyError);
    await assert.rejects(bunny.signPlayback(bad), BunnyError);
    await assert.rejects(bunny.createUploadCredentials(bad), BunnyError);
  }
  assert.equal(api.calls.length, 0);
});

Deno.test("BunnyService: errores no filtran la API key", async () => {
  const api = new FakeBunnyApi();
  const bunny = makeBunny(api);
  api.failWith = { method: "POST", status: 500 };
  const err = await bunny.createVideo("x").catch((e) => e);
  assert.ok(err instanceof BunnyError);
  assert.equal(err.status, 500);
  assert.ok(!err.message.includes("bunny-api-key"));

  const netErr = await new BunnyService({
    apiKey: "bunny-api-key",
    libraryId: LIB,
    cdnHostname: "h.b-cdn.net",
    tokenAuthKey: "t",
    fetchImpl: (() => Promise.reject(new TypeError("boom bunny-api-key"))) as typeof fetch,
  }).createVideo("x").catch((e) => e);
  assert.ok(netErr instanceof BunnyError && !netErr.message.includes("bunny-api-key"));
});

Deno.test("BunnyService: credenciales de subida y URL de reproducción", async () => {
  const bunny = makeBunny(new FakeBunnyApi());
  const up = await bunny.createUploadCredentials(GUID, 3600);
  assert.equal(up.expire, NOW + 3600);
  assert.equal(up.libraryId, LIB);
  assert.equal(up.signature, await signTusUpload(LIB, "bunny-api-key", NOW + 3600, GUID));
  assert.ok(!JSON.stringify(up).includes("bunny-api-key")); // la key nunca sale

  const pb = await bunny.signPlayback(GUID, 7200);
  assert.equal(pb.expiresAt, NOW + 7200);
  assert.ok(pb.hlsUrl.startsWith("https://vz-test-000.b-cdn.net/bcdn_token=HS256-"));
  assert.ok(pb.hlsUrl.endsWith(`/${GUID}/playlist.m3u8`));
  assert.ok(!pb.hlsUrl.includes("token-key"));
});

Deno.test("BunnyService.mapStatus: solo Finished y JitPlaylistsCreated son 'ready'", () => {
  const m = BunnyService.mapStatus;
  assert.equal(m(BunnyVideoStatus.Created), "pending");
  assert.equal(m(BunnyVideoStatus.Uploaded), "processing");
  assert.equal(m(BunnyVideoStatus.Processing), "processing");
  assert.equal(m(BunnyVideoStatus.Transcoding), "processing");
  assert.equal(m(BunnyVideoStatus.Finished), "ready");
  assert.equal(m(BunnyVideoStatus.JitPlaylistsCreated), "ready");
  assert.equal(m(BunnyVideoStatus.Error), "failed");
  assert.equal(m(BunnyVideoStatus.UploadFailed), "failed");
  assert.equal(m(99 as BunnyVideoStatus), "processing"); // desconocido: nunca "ready"
});
