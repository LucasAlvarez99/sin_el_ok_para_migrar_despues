import assert from "node:assert/strict";
import {
  checkBackendEnv,
  checkFrontendConfig,
  describeAuthSettings,
  jwtPayload,
  summarize,
} from "../../scripts/lib/doctor-checks.mjs";

const levels = (r) => Object.fromEntries(r.map((x) => [x.name, x.level]));
const jwt = (payload) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;

Deno.test("doctor · frontend: los valores de ejemplo son errores", () => {
  const r = levels(
    checkFrontendConfig({ SUPABASE_URL: "https://TU-PROYECTO.supabase.co", SUPABASE_ANON_KEY: "TU-ANON-KEY-PUBLICA" }),
  );
  assert.equal(r["js/config.js · SUPABASE_URL"], "fail");
  assert.equal(r["js/config.js · SUPABASE_ANON_KEY"], "fail");
});

Deno.test("doctor · frontend: una configuración real y pública está bien", () => {
  const r = levels(
    checkFrontendConfig({
      SUPABASE_URL: "https://abcdwxyz.supabase.co",
      SUPABASE_ANON_KEY: jwt({ role: "anon" }),
      PRIVACY_URL: "https://x.com/privacidad",
    }),
  );
  assert.equal(r["js/config.js · SUPABASE_URL"], "ok");
  assert.equal(r["js/config.js · SUPABASE_ANON_KEY"], "ok");
  assert.equal(r["js/config.js · PRIVACY_URL"], undefined, "con política de privacidad no hay aviso");
});

Deno.test("doctor · frontend: detecta una clave SECRETA pegada en el navegador (service role / sb_secret_)", () => {
  const a = checkFrontendConfig({
    SUPABASE_URL: "https://abcdwxyz.supabase.co",
    SUPABASE_ANON_KEY: jwt({ role: "service_role" }),
  });
  const b = checkFrontendConfig({
    SUPABASE_URL: "https://abcdwxyz.supabase.co",
    SUPABASE_ANON_KEY: "sb_secret_abc123",
  });
  for (const r of [a, b]) {
    const key = r.find((x) => x.name.includes("ANON_KEY"));
    assert.equal(key.level, "fail");
    assert.match(key.detail, /CLAVE SECRETA/);
  }
});

Deno.test("doctor · frontend: avisa si falta la política de privacidad", () => {
  const r = levels(
    checkFrontendConfig({ SUPABASE_URL: "https://abcdwxyz.supabase.co", SUPABASE_ANON_KEY: jwt({ role: "anon" }) }),
  );
  assert.equal(r["js/config.js · PRIVACY_URL"], "warn");
});

Deno.test("doctor · backend: variables faltantes y mal formadas", () => {
  const r = levels(
    checkBackendEnv({ BUNNY_LIBRARY_ID: "abc", BUNNY_CDN_HOSTNAME: "https://vz-1.b-cdn.net", ALLOWED_ORIGINS: "" }),
  );
  assert.equal(r.BUNNY_LIBRARY_ID, "fail");
  assert.equal(r.BUNNY_API_KEY, "fail");
  assert.equal(r.BUNNY_CDN_HOSTNAME, "fail");
  assert.equal(r.ALLOWED_ORIGINS, "fail");
});

Deno.test("doctor · backend: configuración correcta", () => {
  const r = checkBackendEnv({
    BUNNY_LIBRARY_ID: "12345",
    BUNNY_API_KEY: "a",
    BUNNY_READONLY_API_KEY: "b",
    BUNNY_TOKEN_AUTH_KEY: "c",
    BUNNY_CDN_HOSTNAME: "vz-abc-123.b-cdn.net",
    ALLOWED_ORIGINS: "https://yogapopup.es,https://www.yogapopup.es",
  });
  assert.equal(summarize(r).fail, 0);
  assert.equal(summarize(r).warn, 0);
});

Deno.test("doctor · backend: ALLOWED_ORIGINS peligrosos (*, ejemplo, con ruta, localhost)", () => {
  const base = {
    BUNNY_LIBRARY_ID: "1",
    BUNNY_API_KEY: "a",
    BUNNY_READONLY_API_KEY: "b",
    BUNNY_TOKEN_AUTH_KEY: "c",
    BUNNY_CDN_HOSTNAME: "vz-a.b-cdn.net",
  };
  const of = (o) => checkBackendEnv({ ...base, ALLOWED_ORIGINS: o }).filter((x) => x.name === "ALLOWED_ORIGINS");
  assert.equal(of("*")[0].level, "fail");
  assert.equal(of("https://TU-DOMINIO.com")[0].level, "fail");
  assert.equal(of("https://yogapopup.es/")[0].level, "fail");
  assert.ok(
    of("https://yogapopup.es,http://localhost:3000").some((x) => x.level === "warn" && /localhost/.test(x.detail)),
  );
});

Deno.test("doctor · backend: la clave de solo lectura no puede ser la de escritura", () => {
  const r = checkBackendEnv({
    BUNNY_LIBRARY_ID: "1",
    BUNNY_API_KEY: "igual",
    BUNNY_READONLY_API_KEY: "igual",
    BUNNY_TOKEN_AUTH_KEY: "c",
    BUNNY_CDN_HOSTNAME: "vz-a.b-cdn.net",
    ALLOWED_ORIGINS: "https://a.es",
  });
  assert.ok(r.some((x) => x.name === "BUNNY_READONLY_API_KEY" && x.level === "warn"));
});

Deno.test("doctor · ajustes de Auth: avisa si no se exige confirmar el correo o si el registro está apagado", () => {
  assert.equal(
    levels(
      describeAuthSettings({ external: { email: true }, mailer_autoconfirm: true }),
    )["Auth · confirmación de correo"],
    "warn",
  );
  assert.equal(
    levels(
      describeAuthSettings({ external: { email: true }, mailer_autoconfirm: false }),
    )["Auth · confirmación de correo"],
    "ok",
  );
  assert.equal(levels(describeAuthSettings({ external: { email: false } }))["Auth · registro por correo"], "fail");
  assert.equal(
    levels(describeAuthSettings({ external: { email: true }, disable_signup: true }))["Auth · altas nuevas"],
    "warn",
  );
});

Deno.test("doctor · jwtPayload no revienta con basura", () => {
  assert.equal(jwtPayload("no-es-un-jwt"), null);
  assert.equal(jwtPayload(undefined), null);
  assert.deepEqual(jwtPayload(jwt({ role: "anon" })), { role: "anon" });
});
