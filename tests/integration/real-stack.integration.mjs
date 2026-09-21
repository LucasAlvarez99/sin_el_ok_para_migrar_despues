/**
 * PRUEBA DE INTEGRACIÓN CONTRA LOS SERVICIOS REALES (Supabase + Bunny). Se OMITE sola si faltan variables.
 *
 *   YP_SUPABASE_URL=https://xxxx.supabase.co  YP_ANON_KEY=...            (Project Settings → API)
 *   YP_TEST_EMAIL=prueba@tudominio.com  YP_TEST_PASSWORD=...             (una cuenta de prueba YA confirmada)
 *   YP_CLASS_ID=<uuid de una clase gratuita, publicada y con video listo>
 *   npm run test:integration
 *
 * Comprueba lo que ninguna simulación puede: que Bunny REAL acepta la URL firmada (token en la ruta) también para
 * el manifiesto de calidades y los segmentos, que sin token responde 403, y que Supabase REAL guarda el progreso.
 */
import assert from 'node:assert/strict';

const E = process.env;
const need = ['YP_SUPABASE_URL', 'YP_ANON_KEY', 'YP_TEST_EMAIL', 'YP_TEST_PASSWORD', 'YP_CLASS_ID'];
const missing = need.filter((k) => !E[k]);
if (missing.length) {
  console.log(`OMITIDA · prueba de integración real. Faltan variables: ${missing.join(', ')}`);
  console.log('Ver el encabezado de tests/integration/real-stack.integration.mjs y docs/PUESTA-EN-MARCHA.md');
  process.exit(0);
}

const base = E.YP_SUPABASE_URL.replace(/\/+$/, '');
const fnBase = (E.YP_FUNCTIONS_URL || `${base}/functions/v1`).replace(/\/+$/, '');
const anon = { apikey: E.YP_ANON_KEY, Authorization: `Bearer ${E.YP_ANON_KEY}` };
const json = { 'Content-Type': 'application/json' };
let step = 0;
const check = async (name, fn) => { step++; try { await fn(); console.log(`  ✓ ${step}. ${name}`); } catch (e) { console.log(`  ✗ ${step}. ${name}\n      ${e.message}`); process.exitCode = 1; throw e; } };
const state = {};

console.log('\nIntegración real · Supabase + Bunny\n');
try {
  await check('El catálogo público se lee sin sesión', async () => {
    const r = await fetch(`${base}/rest/v1/classes?select=id,title&is_published=eq.true&limit=5`, { headers: anon });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(await r.json()));
  });

  await check('Las columnas de Bunny NO son legibles desde el navegador', async () => {
    const r = await fetch(`${base}/rest/v1/classes?select=bunny_video_id&limit=1`, { headers: anon });
    assert.ok([401, 403].includes(r.status), `estado ${r.status}: el navegador puede leer bunny_video_id`);
  });

  await check('playback sin sesión responde 401', async () => {
    const r = await fetch(`${fnBase}/playback`, { method: 'POST', headers: json, body: JSON.stringify({ class_id: E.YP_CLASS_ID }) });
    assert.equal(r.status, 401);
  });

  await check('Inicio de sesión con la cuenta de prueba', async () => {
    const r = await fetch(`${base}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { ...anon, ...json }, body: JSON.stringify({ email: E.YP_TEST_EMAIL, password: E.YP_TEST_PASSWORD }) });
    assert.equal(r.status, 200, `estado ${r.status} (¿la cuenta existe y está confirmada?)`);
    state.token = (await r.json()).access_token;
    assert.ok(state.token);
  });

  const auth = () => ({ ...json, apikey: E.YP_ANON_KEY, Authorization: `Bearer ${state.token}` });

  await check('playback con sesión devuelve una URL firmada con todos los campos del contrato', async () => {
    const r = await fetch(`${fnBase}/playback`, { method: 'POST', headers: auth(), body: JSON.stringify({ class_id: E.YP_CLASS_ID }) });
    const raw = await r.text(); // se lee UNA vez: el cuerpo no se puede consumir dos veces
    assert.equal(r.status, 200, `estado ${r.status}: ${raw}`);
    const body = JSON.parse(raw);
    assert.deepEqual(Object.keys(body).sort(), ['class_id', 'completed', 'duration_seconds', 'expires_at', 'hls_url', 'resume_seconds', 'title']);
    assert.match(body.hls_url, /bcdn_token=/);
    assert.ok(body.expires_at > Date.now() / 1000, 'la URL ya vino vencida');
    state.hls = body.hls_url;
  });

  await check('BUNNY acepta la URL firmada: manifiesto maestro (200, #EXTM3U)', async () => {
    const r = await fetch(state.hls);
    assert.equal(r.status, 200, `estado ${r.status}: revisa BUNNY_TOKEN_AUTH_KEY y que el Pull Zone use autenticación por token (Advanced)`);
    const text = await r.text();
    assert.ok(text.startsWith('#EXTM3U'));
    state.variant = new URL(text.split('\n').find((l) => l && !l.startsWith('#')), state.hls).href;
  });

  await check('El token en la RUTA se hereda: manifiesto de una calidad y su primer segmento (200)', async () => {
    const r = await fetch(state.variant);
    assert.equal(r.status, 200, `estado ${r.status} en la lista de la calidad`);
    const text = await r.text();
    const seg = new URL(text.split('\n').find((l) => l && !l.startsWith('#')), state.variant).href;
    const s = await fetch(seg, { headers: { Range: 'bytes=0-1023' } });
    assert.ok([200, 206].includes(s.status), `estado ${s.status} en el segmento: los segmentos NO heredaron el token`);
  });

  await check('Sin token, Bunny rechaza el mismo video (403)', async () => {
    const naked = state.hls.replace(/\/bcdn_token=[^/]*/, '');
    assert.notEqual(naked, state.hls);
    const r = await fetch(naked);
    assert.equal(r.status, 403, `estado ${r.status}: ¡el video se puede ver SIN token! Activa Token Authentication en el Pull Zone`);
  });

  await check('El progreso se guarda en Supabase real (save_progress)', async () => {
    const r = await fetch(`${base}/rest/v1/rpc/save_progress`, { method: 'POST', headers: auth(), body: JSON.stringify({ p_class_id: E.YP_CLASS_ID, p_seconds: 7 }) });
    const raw = await r.text();
    assert.equal(r.status, 200, `estado ${r.status}: ${raw}`);
    assert.equal(JSON.parse(raw).progress_seconds, 7);
  });
} catch { /* el detalle ya se imprimió en check() */ }

console.log(process.exitCode ? '\nHay pasos en rojo.\n' : '\nTodo en verde: la integración real funciona.\n');
