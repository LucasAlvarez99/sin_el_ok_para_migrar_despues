import assert from "node:assert/strict";
import { createHandler as createUpload } from "../admin-create-upload/handler.ts";
import { createHandler as createSync } from "../admin-sync-video/handler.ts";
import { createHandler as createDelete } from "../admin-delete-class/handler.ts";
import { createHandler as createPlayback } from "../playback/handler.ts";
import { createHandler as createWebhook } from "../bunny-webhook/handler.ts";
import { createHandler as createHealth } from "../health/handler.ts";
import { ADMIN_ID, hmacHex, LIB, makeDeps, post, USER_ID } from "./fakes.ts";

const ORIGIN = "https://yogapopup.test";
const errCode = async (r: Response) => (await r.json()).error?.code;

// =============================================================== admin-create-upload
Deno.test("create-upload: sin sesión 401, usuario común 403, admin OK", async () => {
  const { deps } = makeDeps();
  const h = createUpload(deps);
  assert.equal((await h(post({ title: "A" }))).status, 401);
  const r = await h(post({ title: "A" }, "user"));
  assert.equal(r.status, 403);
  assert.equal(await errCode(r), "admin_only");
  assert.equal((await h(post({ title: "A" }, "admin"))).status, 200);
});

Deno.test("create-upload: crea clase + video en Bunny + credenciales; nunca expone ids ni la key", async () => {
  const { deps, api, repo } = makeDeps();
  const r = await createUpload(deps)(
    post({ title: "  Yoga para principiantes ", level: "principiante", category: "Vinyasa", sort_order: 3 }, "admin"),
  );
  assert.equal(r.status, 200);
  const text = await r.clone().text();
  const body = await r.json();

  assert.equal(body.class.title, "Yoga para principiantes");
  assert.equal(body.class.is_published, false);
  assert.equal(body.class.video_status, "pending");
  assert.equal("bunny_video_id" in body.class, false);
  assert.equal("bunny_library_id" in body.class, false);
  assert.equal(body.upload.libraryId, LIB);
  assert.match(body.upload.signature, /^[0-9a-f]{64}$/);
  assert.ok(!text.includes("bunny-api-key"));

  const saved = [...repo.classes.values()][0];
  assert.equal((saved as unknown as { created_by: string }).created_by, ADMIN_ID); // queda registrado quién la creó
  assert.equal(saved.bunny_video_id, body.upload.videoId);
  assert.equal(api.videos.size, 1);
});

Deno.test("create-upload: validaciones de entrada (400) y nada llega a Bunny", async () => {
  const { deps, api, repo } = makeDeps();
  const h = createUpload(deps);
  for (
    const bad of [
      {},
      { title: "" },
      { title: 5 },
      { title: "x".repeat(151) },
      { title: "a", level: "experto" },
      { title: "a", access_level: "vip" },
      { title: "a", sort_order: 1.5 },
      { title: "a", class_id: "no-uuid" },
    ]
  ) {
    const r = await h(post(bad, "admin"));
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.equal(await errCode(r), "invalid_input");
  }
  assert.equal((await h(post("no es json", "admin"))).status, 400);
  assert.equal((await h(post("[]", "admin"))).status, 400);
  assert.equal((await h(post("x".repeat(20_000), "admin"))).status, 413);
  assert.equal(api.videos.size, 0);
  assert.equal(repo.classes.size, 0);
});

Deno.test("create-upload: si falla la base se borra el video huérfano de Bunny", async () => {
  const { deps, api, repo } = makeDeps();
  repo.failInsert = true;
  const r = await createUpload(deps)(post({ title: "A" }, "admin"));
  assert.equal(r.status, 500);
  assert.equal(await errCode(r), "internal_error");
  assert.equal(api.videos.size, 0); // compensación
});

Deno.test("create-upload: Bunny caído -> 502 y no se crea la clase", async () => {
  const { deps, api, repo } = makeDeps();
  api.failWith = { method: "POST", status: 503 };
  const r = await createUpload(deps)(post({ title: "A" }, "admin"));
  assert.equal(r.status, 502);
  assert.equal(await errCode(r), "video_provider_error");
  assert.equal(repo.classes.size, 0);
});

Deno.test("create-upload: asociar video a clase existente; 409 si ya tiene; 404 si no existe", async () => {
  const { deps, repo, api } = makeDeps();
  const h = createUpload(deps);
  const c = repo.addClass({ title: "Existente" });
  const ok = await h(post({ title: "ignorado", class_id: c.id }, "admin"));
  assert.equal(ok.status, 200);
  assert.ok(repo.classes.get(c.id)!.bunny_video_id);
  assert.equal(api.videos.size, 1);

  const again = await h(post({ title: "x", class_id: c.id }, "admin"));
  assert.equal(again.status, 409);
  assert.equal(await errCode(again), "video_already_attached");
  assert.equal(api.videos.size, 1); // no creó otro video

  const missing = await h(post({ title: "x", class_id: crypto.randomUUID() }, "admin"));
  assert.equal(missing.status, 404);
});

// =============================================================== admin-sync-video
Deno.test("sync-video: refleja estado y duración de Bunny; solo admin", async () => {
  const { deps, repo, api } = makeDeps();
  const v = await deps.bunny.createVideo("v");
  const c = repo.addClass({ bunny_video_id: v.guid, bunny_library_id: LIB });
  const h = createSync(deps);

  assert.equal((await h(post({ class_id: c.id }, "user"))).status, 403);

  api.videos.get(v.guid)!.status = 3; // Transcoding
  let body = await (await h(post({ class_id: c.id }, "admin"))).json();
  assert.equal(body.class.video_status, "processing");

  api.videos.get(v.guid)!.status = 4; // Finished
  api.videos.get(v.guid)!.length = 2699.6;
  body = await (await h(post({ class_id: c.id }, "admin"))).json();
  assert.equal(body.class.video_status, "ready");
  assert.equal(body.class.duration_seconds, 2700);
  assert.equal(body.class.is_published, false); // nunca publica solo
});

Deno.test("sync-video: si el video falla, una clase publicada se despublica (respeta el CHECK)", async () => {
  const { deps, repo, api } = makeDeps();
  const v = await deps.bunny.createVideo("v");
  const c = repo.addClass({ bunny_video_id: v.guid, video_status: "ready", is_published: true });
  api.videos.get(v.guid)!.status = 5; // Error
  const r = await createSync(deps)(post({ class_id: c.id }, "admin"));
  assert.equal(r.status, 200); // el fake lanzaría si se violara el CHECK
  const body = await r.json();
  assert.equal(body.class.video_status, "failed");
  assert.equal(body.class.is_published, false);
});

Deno.test("sync-video: video desaparecido en Bunny -> failed; sin video -> 409; clase inexistente -> 404", async () => {
  const { deps, repo } = makeDeps();
  const h = createSync(deps);
  const lost = repo.addClass({ bunny_video_id: crypto.randomUUID(), video_status: "ready", is_published: true });
  const body = await (await h(post({ class_id: lost.id }, "admin"))).json();
  assert.equal(body.bunny_found, false);
  assert.equal(body.class.video_status, "failed");
  assert.equal(body.class.is_published, false);

  const none = repo.addClass();
  assert.equal((await h(post({ class_id: none.id }, "admin"))).status, 409);
  assert.equal((await h(post({ class_id: crypto.randomUUID() }, "admin"))).status, 404);
});

// =============================================================== admin-delete-class
Deno.test("delete-class: borra video y clase; solo admin", async () => {
  const { deps, repo, api } = makeDeps();
  const v = await deps.bunny.createVideo("v");
  const c = repo.addClass({ bunny_video_id: v.guid });
  const h = createDelete(deps);
  assert.equal((await h(post({ class_id: c.id }, "user"))).status, 403);
  assert.equal(repo.classes.size, 1);

  const r = await h(post({ class_id: c.id }, "admin"));
  assert.deepEqual(await r.json(), { deleted: true, class_id: c.id, video_deleted: true });
  assert.equal(repo.classes.size, 0);
  assert.equal(api.videos.size, 0);
});

Deno.test("delete-class: si Bunny falla NO se borra la clase (se puede reintentar)", async () => {
  const { deps, repo, api } = makeDeps();
  const v = await deps.bunny.createVideo("v");
  const c = repo.addClass({ bunny_video_id: v.guid });
  api.failWith = { method: "DELETE", status: 500 };
  const r = await createDelete(deps)(post({ class_id: c.id }, "admin"));
  assert.equal(r.status, 502);
  assert.equal(repo.classes.size, 1);
  assert.equal(repo.deleteCalls, 0);
});

Deno.test("delete-class: video ya borrado en Bunny (404) igual limpia la clase; sin video también", async () => {
  const { deps, repo } = makeDeps();
  const h = createDelete(deps);
  const a = repo.addClass({ bunny_video_id: crypto.randomUUID() });
  assert.equal((await (await h(post({ class_id: a.id }, "admin"))).json()).video_deleted, false);
  const b = repo.addClass();
  assert.equal((await h(post({ class_id: b.id }, "admin"))).status, 200);
  assert.equal(repo.classes.size, 0);
  assert.equal((await h(post({ class_id: crypto.randomUUID() }, "admin"))).status, 404);
});

// =============================================================== playback
async function readyClass(access: "free" | "restricted" = "free", extra = {}) {
  const ctx = makeDeps();
  const v = await ctx.deps.bunny.createVideo("v");
  const c = ctx.repo.addClass({
    bunny_video_id: v.guid,
    bunny_library_id: LIB,
    video_status: "ready",
    is_published: true,
    duration_seconds: 2700,
    access_level: access,
    ...extra,
  });
  return { ...ctx, c, guid: v.guid };
}

Deno.test("playback: sin sesión 401; con sesión y acceso -> URL firmada + resume", async () => {
  const { deps, c, guid, repo } = await readyClass();
  const h = createPlayback(deps);
  assert.equal((await h(post({ class_id: c.id }))).status, 401);
  assert.equal((await h(post({ class_id: c.id }, "token-falso"))).status, 401);

  repo.progress.set(`${USER_ID}|${c.id}`, { progress_seconds: 1663, completed: false }); // 27:43
  const r = await h(post({ class_id: c.id }, "user"));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const b = await r.json();
  assert.equal(b.resume_seconds, 1663);
  assert.equal(b.duration_seconds, 2700);
  assert.ok(b.hls_url.includes(`/${guid}/playlist.m3u8`));
  assert.ok(b.hls_url.includes("bcdn_token=HS256-"));
  assert.equal(b.expires_at, 1_800_000_000 + 7200);
});

Deno.test("playback: clase restringida -> 403 sin entitlement, 200 con entitlement", async () => {
  const { deps, c, auth } = await readyClass("restricted");
  const h = createPlayback(deps);
  const denied = await h(post({ class_id: c.id }, "user"));
  assert.equal(denied.status, 403);
  const deniedText = await denied.text();
  assert.equal(JSON.parse(deniedText).error.code, "no_access");
  assert.ok(!deniedText.includes("playlist.m3u8")); // ni rastro de la URL

  auth.entitlements.set(USER_ID, new Set([c.id]));
  assert.equal((await h(post({ class_id: c.id }, "user"))).status, 200);
  assert.equal((await h(post({ class_id: c.id }, "user2"))).status, 403); // otro usuario sigue sin acceso
});

Deno.test("playback: clase no publicada -> 403 (no revela que existe); admin sí puede previsualizar", async () => {
  const { deps, c, repo } = await readyClass("free");
  repo.classes.get(c.id)!.is_published = false;
  const h = createPlayback(deps);
  const r = await h(post({ class_id: c.id }, "user"));
  assert.equal(r.status, 403);
  const ghost = await h(post({ class_id: crypto.randomUUID() }, "user"));
  assert.equal(ghost.status, 403); // misma respuesta que "no publicada"
  assert.equal((await h(post({ class_id: c.id }, "admin"))).status, 200);
});

Deno.test("playback: video no listo -> 409 (caso admin en clase sin video)", async () => {
  const { deps, repo } = makeDeps();
  const c = repo.addClass({ video_status: "processing" });
  const r = await createPlayback(deps)(post({ class_id: c.id }, "admin"));
  assert.equal(r.status, 409);
  assert.equal(await errCode(r), "video_not_ready");
});

Deno.test("playback: reglas de 'continuar' (menos de 5 s o terminada -> desde 0)", async () => {
  const { deps, c, repo } = await readyClass();
  const h = createPlayback(deps);
  const resume = async (s: number, completed = false) => {
    repo.progress.set(`${USER_ID}|${c.id}`, { progress_seconds: s, completed });
    return (await (await h(post({ class_id: c.id }, "user"))).json()).resume_seconds;
  };
  assert.equal(await resume(0), 0);
  assert.equal(await resume(4), 0);
  assert.equal(await resume(5), 5);
  assert.equal(await resume(2564), 2564); // 94.96 %
  assert.equal(await resume(2565, true), 0); // 95 %: vuelve a empezar
  assert.equal(await resume(2700, true), 0);
});

Deno.test("playback: el progreso es por usuario", async () => {
  const { deps, c, repo } = await readyClass();
  repo.progress.set(`${USER_ID}|${c.id}`, { progress_seconds: 900, completed: false });
  const b = await (await createPlayback(deps)(post({ class_id: c.id }, "user2"))).json();
  assert.equal(b.resume_seconds, 0);
});

Deno.test("playback: class_id inválido -> 400", async () => {
  const { deps } = makeDeps();
  assert.equal((await createPlayback(deps)(post({ class_id: "1 OR 1=1" }, "user"))).status, 400);
  assert.equal((await createPlayback(deps)(post({}, "user"))).status, 400);
});

// =============================================================== bunny-webhook
async function webhookReq(body: object, secret = "readonly-key") {
  const raw = JSON.stringify(body);
  return new Request("https://fn.test/w", {
    method: "POST",
    headers: {
      "x-bunnystream-signature": await hmacHex(secret, raw),
      "x-bunnystream-signature-version": "v1",
      "x-bunnystream-signature-algorithm": "hmac-sha256",
    },
    body: raw,
  });
}

Deno.test("webhook: firma inválida o ausente -> 401 y no toca nada", async () => {
  const { deps, repo } = makeDeps();
  const h = createWebhook(deps);
  const c = repo.addClass({ bunny_video_id: crypto.randomUUID(), video_status: "processing" });
  const body = { VideoLibraryId: 12345, VideoGuid: c.bunny_video_id, Status: 3 };
  assert.equal((await h(await webhookReq(body, "otra-clave"))).status, 401);
  assert.equal((await h(post(body))).status, 401);
  assert.equal(repo.classes.get(c.id)!.video_status, "processing");
});

Deno.test("webhook: firma válida sincroniza contra la API (no confía en el número del webhook)", async () => {
  const { deps, repo, api } = makeDeps();
  const v = await deps.bunny.createVideo("v");
  const c = repo.addClass({ bunny_video_id: v.guid, video_status: "processing" });
  api.videos.get(v.guid)!.status = 4;
  api.videos.get(v.guid)!.length = 1800;
  // El webhook dice Status 3 ("Finished" en SU enum) y la API dice 4: manda la API.
  const r = await createWebhook(deps)(await webhookReq({ VideoLibraryId: 12345, VideoGuid: v.guid, Status: 3 }));
  assert.equal(r.status, 200);
  assert.equal(repo.classes.get(c.id)!.video_status, "ready");
  assert.equal(repo.classes.get(c.id)!.duration_seconds, 1800);
});

Deno.test("webhook: subida iniciada -> 'uploading' y no se degrada a 'pending'", async () => {
  const { deps, repo } = makeDeps();
  const v = await deps.bunny.createVideo("v"); // API: status 0 (Created)
  const c = repo.addClass({ bunny_video_id: v.guid, video_status: "pending" });
  const h = createWebhook(deps);
  await h(await webhookReq({ VideoLibraryId: 12345, VideoGuid: v.guid, Status: 6 }));
  assert.equal(repo.classes.get(c.id)!.video_status, "uploading");
  await h(await webhookReq({ VideoLibraryId: 12345, VideoGuid: v.guid, Status: 0 }));
  assert.equal(repo.classes.get(c.id)!.video_status, "uploading");
  await h(await webhookReq({ VideoLibraryId: 12345, VideoGuid: v.guid, Status: 8 })); // subida fallida
  assert.equal(repo.classes.get(c.id)!.video_status, "failed");
});

Deno.test("webhook: ignora otra librería, video desconocido, estados de subtítulos y guid inválido", async () => {
  const { deps, repo } = makeDeps();
  const h = createWebhook(deps);
  const guid = crypto.randomUUID();
  assert.equal(
    (await (await h(await webhookReq({ VideoLibraryId: 999, VideoGuid: guid, Status: 3 }))).json()).ignored,
    "other_library",
  );
  assert.equal(
    (await (await h(await webhookReq({ VideoLibraryId: 12345, VideoGuid: guid, Status: 3 }))).json()).ignored,
    "unknown_video",
  );
  assert.equal(
    (await (await h(await webhookReq({ VideoLibraryId: 12345, VideoGuid: guid, Status: 9 }))).json()).ignored,
    "status_not_relevant",
  );
  assert.equal((await h(await webhookReq({ VideoLibraryId: 12345, VideoGuid: "../x", Status: 3 }))).status, 400);
  assert.equal(repo.classes.size, 0);
});

Deno.test("webhook: sin BUNNY_READONLY_API_KEY configurada -> 500 (no acepta nada)", async () => {
  const { deps } = makeDeps({ webhookSecret: null });
  assert.equal(
    (await createWebhook(deps)(await webhookReq({ VideoLibraryId: 12345, VideoGuid: crypto.randomUUID(), Status: 3 })))
      .status,
    500,
  );
});

// =============================================================== health + CORS + método
Deno.test("health: 200 si la base responde, 503 si no; pública", async () => {
  const { deps, repo } = makeDeps();
  const h = createHealth(deps);
  const get = () => new Request("https://fn.test/h", { method: "GET" });
  assert.equal((await h(get())).status, 200);
  repo.pingFails = true;
  const r = await h(get());
  assert.equal(r.status, 503);
  assert.equal(await errCode(r), "db_unavailable");
});

Deno.test("CORS: preflight y reflejo de origen solo si está permitido", async () => {
  const { deps } = makeDeps();
  const h = createPlayback(deps);
  const pre = await h(new Request("https://fn.test/p", { method: "OPTIONS", headers: { origin: ORIGIN } }));
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), ORIGIN);

  const evil = await h(post({ class_id: crypto.randomUUID() }, "user", { origin: "https://evil.test" }));
  assert.equal(evil.headers.get("access-control-allow-origin"), null);

  const ok = await h(post({ class_id: crypto.randomUUID() }, "user", { origin: ORIGIN }));
  assert.equal(ok.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(ok.headers.get("vary"), "Origin");

  // también en las respuestas de error
  const noAuth = await h(post({}, undefined, { origin: ORIGIN }));
  assert.equal(noAuth.status, 401);
  assert.equal(noAuth.headers.get("access-control-allow-origin"), ORIGIN);
});

Deno.test("método no permitido -> 405", async () => {
  const { deps } = makeDeps();
  assert.equal((await createPlayback(deps)(new Request("https://fn.test/p", { method: "GET" }))).status, 405);
  assert.equal((await createUpload(deps)(new Request("https://fn.test/p", { method: "DELETE" }))).status, 405);
});
