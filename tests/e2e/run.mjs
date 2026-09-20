/**
 * Pruebas E2E en un navegador real (Chrome/Chromium) con video HLS real.
 *
 *   CHROME_PATH=/ruta/a/chrome npm run test:e2e
 *
 * Si no se define CHROME_PATH se buscan las rutas habituales de Chrome/Chromium/Edge.
 * Usa el `supabase-js` y `hls.js` reales del proyecto contra el backend de pruebas de fake-backend.mjs.
 * Requiere ffmpeg (genera un video HLS de 12 s con 2 calidades).
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { IDS, startBackend } from './fake-backend.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = CANDIDATES.find((p) => existsSync(p));
if (!chromePath) {
  console.error('No se encontró Chrome/Chromium. Define CHROME_PATH=/ruta/al/ejecutable');
  process.exit(2);
}

const be = await startBackend({ siteRoot: root });
const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: process.env.CHROME_HEADLESS_SHELL ? 'shell' : true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});

const S = be.origin.site;
const PASS = 'clave-segura-123';
const results = [];
const only = process.argv[2];

async function newPage() {
  const context = await browser.createBrowserContext(); // localStorage limpio por prueba
  const page = await context.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|fonts\.g/.test(m.text())) page.errors.push(`console.error: ${m.text()}`); });
  page.ctx = context;
  return page;
}
const waitFor = (page, fn, arg, timeout = 15000) => page.waitForFunction(fn, { timeout, polling: 100 }, arg);
const count = (page, sel) => page.$$eval(sel, (n) => n.length);
const text = (page, sel) => page.$eval(sel, (n) => n.textContent.trim());
const videoTime = (page) => page.$eval('.yp-video', (v) => v.currentTime);

async function signup(email, name = 'Ana Test') {
  const r = await fetch(`${be.origin.api}/auth/v1/signup`, { method: 'POST', body: JSON.stringify({ email, password: PASS, data: { full_name: name } }) });
  assert.equal(r.status, 200);
}
async function loginViaModal(page, email, password = PASS) {
  await page.click('[data-account-toggle]');
  await page.waitForSelector('#authEmail', { visible: true });
  await page.type('#authEmail', email);
  await page.type('#authPass', password);
  await page.click('.yp-auth button[type=submit]');
  // el modal se cierra con una animación: hasta que termina, su fondo intercepta los clics
  await waitFor(page, () => !document.querySelector('.modal-backdrop') && !document.querySelector('.modal.show'), null, 10000);
}
async function openClass(page, id) {
  await page.goto(`${S}/clase.html?id=${id}`);
}
async function playAndWait(page, seconds = 1.5) {
  await page.waitForSelector('.yp-bigplay', { visible: true, timeout: 15000 });
  await page.click('.yp-bigplay');
  await waitFor(page, (s) => document.querySelector('.yp-video')?.currentTime > s, seconds, 20000);
}

async function test(name, fn) {
  if (only && !name.includes(only)) return;
  await be.reset();
  const page = await newPage();
  const t0 = Date.now();
  try {
    await fn(page);
    assert.deepEqual(page.errors, [], `errores inesperados en la página:\n${page.errors.join('\n')}`);
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`  ✓ ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (err) {
    results.push({ name, ok: false, err });
    console.log(`  ✗ ${name}\n      ${String(err.message).split('\n').join('\n      ')}`);
    await page.screenshot({ path: `/tmp/e2e-fail-${results.length}.png` }).catch(() => {});
  } finally {
    await page.ctx.close().catch(() => {});
  }
}

console.log(`\nE2E · ${chromePath}\n`);

// ============================================================ catálogo
await test('home: muestra clases reales (no las tarjetas de ejemplo) y omite borradores', async (page) => {
  await page.goto(S);
  await waitFor(page, () => document.querySelectorAll('#homeVideos .video-card').length > 0);
  const titles = await page.$$eval('#homeVideos .video-info h3', (n) => n.map((x) => x.textContent));
  assert.deepEqual(titles, ['Yoga para principiantes', 'Curso avanzado (restringido)', 'Relajación profunda']);
  assert.ok(!(await page.content()).includes('Morning Yoga Flow'), 'quedaron datos de ejemplo');
  assert.equal(await page.$eval('#homeVideos', (n) => n.getAttribute('aria-busy')), 'false');
});

await test('videoteca: estado de carga (esqueleto) y luego el catálogo', async (page) => {
  await be.behavior({ catalogLatencyMs: 900 });
  await page.goto(`${S}/videoteca.html`);
  await waitFor(page, () => document.querySelectorAll('#catalogGrid .yp-skeleton').length > 0, null, 5000);
  await waitFor(page, () => document.querySelectorAll('#catalogGrid .video-card').length === 3);
  assert.equal(await count(page, '#catalogGrid .yp-skeleton'), 0);
  assert.match(await text(page, 'h1'), /Videoteca/);
  assert.equal(await count(page, '.video-lock'), 1, 'la clase restringida debe mostrar candado');
});

await test('videoteca: error de carga con reintento', async (page) => {
  await be.behavior({ catalogFail: true });
  await page.goto(`${S}/videoteca.html`);
  await page.waitForSelector('#catalogGrid [role=alert]');
  assert.match(await text(page, '#catalogGrid [role=alert]'), /No pudimos cargar/);
  await be.behavior({ catalogFail: false });
  await page.click('#catalogGrid [role=alert] button');
  await waitFor(page, () => document.querySelectorAll('#catalogGrid .video-card').length === 3);
});

await test('videoteca: estado vacío cuando no hay clases publicadas', async (page) => {
  await be.behavior({ catalogFail: false });
  const state = await be.state();
  assert.ok(state);
  await page.goto(`${S}/videoteca.html`);
  await waitFor(page, () => document.querySelectorAll('#catalogGrid .video-card').length === 3);
  // filtros sin resultados
  await page.type('#catalogFilters input[type=search]', 'zzz-no-existe');
  await waitFor(page, () => /No encontramos clases con esos filtros/.test(document.getElementById('catalogGrid').textContent));
});

await test('videoteca: la búsqueda ignora tildes y mayúsculas, y filtra por categoría', async (page) => {
  await page.goto(`${S}/videoteca.html`);
  await waitFor(page, () => document.querySelectorAll('#catalogGrid .video-card').length === 3);
  await page.type('#catalogFilters input[type=search]', 'RELAJACION');
  await waitFor(page, () => document.querySelectorAll('#catalogGrid .video-card').length === 1);
  await page.$eval('#catalogFilters input[type=search]', (i) => { i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.evaluate(() => [...document.querySelectorAll('.yp-chip')].find((b) => b.textContent === 'Fuerza').click());
  await waitFor(page, () => document.querySelectorAll('#catalogGrid .video-card').length === 1);
  assert.match(await text(page, '#catalogGrid .video-info h3'), /Curso avanzado/);
});

// ============================================================ detalle, acceso y reproducción
await test('clase (sin sesión): pide iniciar sesión; un error de contraseña se muestra; al entrar reproduce', async (page) => {
  await signup('ana@test.dev');
  await openClass(page, IDS.free);
  await page.waitForSelector('.clase-gate');
  assert.match(await text(page, '.clase-gate h2'), /Inicia sesión/);
  assert.match(await text(page, '#info h1'), /Yoga para principiantes/);
  assert.match(await text(page, '.clase-desc'), /Sin prisa/);

  await page.click('.clase-gate button');
  await page.waitForSelector('#authEmail', { visible: true });
  await page.type('#authEmail', 'ana@test.dev');
  await page.type('#authPass', 'contraseña-equivocada');
  await page.click('.yp-auth button[type=submit]');
  await page.waitForSelector('.yp-form-error');
  assert.match(await text(page, '.yp-form-error'), /no son correctos/);

  await page.$eval('#authPass', (i) => (i.value = ''));
  await page.type('#authPass', PASS);
  await page.click('.yp-auth button[type=submit]');
  await page.waitForSelector('.yp-player', { timeout: 15000 });
  await playAndWait(page);
  assert.ok((await videoTime(page)) > 1.5);
});

await test('reproductor: controles, calidades reales de HLS, velocidad y teclado', async (page) => {
  await signup('ana@test.dev');
  await openClass(page, IDS.free);
  await loginViaModal(page, 'ana@test.dev');
  await page.waitForSelector('.yp-player');
  await playAndWait(page);
  // calidades: Automática + 2 resoluciones del manifiesto real
  await waitFor(page, () => !document.querySelector('.yp-menu-quality')?.closest('.yp-menuwrap')?.querySelector('.yp-text-btn').hidden);
  const labels = await page.$$eval('.yp-menu-quality .yp-menu-item', (n) => n.map((x) => x.textContent.replace('✓ ', '')));
  assert.deepEqual(labels, ['Automática', '360p', '180p']);
  await page.click('.yp-menuwrap:nth-child(2) .yp-text-btn');
  await page.evaluate(() => [...document.querySelectorAll('.yp-menu-quality .yp-menu-item')].find((b) => b.textContent.includes('180')).click());
  await waitFor(page, () => /180p/.test(document.querySelector('.yp-qlabel').textContent));
  // velocidad
  await page.click('.yp-menuwrap:nth-child(1) .yp-text-btn');
  await page.evaluate(() => [...document.querySelectorAll('.yp-menu-item')].find((b) => b.textContent.includes('1.5')).click());
  assert.equal(await page.$eval('.yp-video', (v) => v.playbackRate), 1.5);
  // teclado: espacio pausa, flechas buscan
  await page.focus('.yp-player');
  await page.keyboard.press('Space');
  await waitFor(page, () => document.querySelector('.yp-video').paused);
  const t = await videoTime(page);
  await page.keyboard.press('ArrowLeft');
  await waitFor(page, (t0) => document.querySelector('.yp-video').currentTime < t0, t);
  assert.equal(await page.$eval('.yp-player', (n) => n.dataset.state), 'paused');
});

await test('acceso denegado: clase restringida sin permiso → mensaje claro; con permiso → reproduce', async (page) => {
  await signup('ana@test.dev');
  await openClass(page, IDS.restricted);
  await loginViaModal(page, 'ana@test.dev');
  await page.waitForSelector('.clase-gate');
  await waitFor(page, () => /no está incluida en tu acceso/.test(document.querySelector('.clase-gate h2')?.textContent || ''));
  assert.equal(await count(page, '.yp-player'), 0, 'no debe existir el reproductor');
  assert.ok(!(await page.content()).includes('playlist.m3u8'), 'no debe filtrarse ninguna URL de video');
  await be.entitle('ana@test.dev', IDS.restricted);
  await page.reload();
  await page.waitForSelector('.yp-player', { timeout: 15000 });
  await playAndWait(page);
});

await test('video en preparación (409) → mensaje y "Comprobar de nuevo"', async (page) => {
  await signup('ana@test.dev');
  await be.behavior({ playbackForce: { status: 409, code: 'video_not_ready' } });
  await openClass(page, IDS.free);
  await loginViaModal(page, 'ana@test.dev');
  await waitFor(page, () => /Estamos preparando este video/.test(document.querySelector('.clase-gate h2')?.textContent || ''));
  await be.behavior({ playbackForce: null });
  await page.click('.clase-gate button');
  await page.waitForSelector('.yp-player');
});

await test('clase inexistente o id inválido → "No encontramos esta clase"', async (page) => {
  await page.goto(`${S}/clase.html?id=no-es-un-uuid`);
  await page.waitForSelector('.clase-gate');
  assert.match(await text(page, '.clase-gate h2'), /No encontramos esta clase/);
  await page.goto(`${S}/clase.html?id=${IDS.hidden}`); // borrador: RLS no lo devuelve
  await waitFor(page, () => /No encontramos esta clase/.test(document.querySelector('.clase-gate h2')?.textContent || ''));
});

await test('error del servicio de video (502) → error con reintento', async (page) => {
  await signup('ana@test.dev');
  await be.behavior({ playbackForce: { status: 502, code: 'video_provider_error' } });
  await openClass(page, IDS.free);
  await loginViaModal(page, 'ana@test.dev');
  await waitFor(page, () => /No pudimos preparar el video/.test(document.querySelector('.clase-gate h2')?.textContent || ''));
  assert.match(await text(page, '.clase-gate p'), /servicio de video no responde/);
  await be.behavior({ playbackForce: null });
  await page.click('.clase-gate button');
  await page.waitForSelector('.yp-player');
});

// ============================================================ URL firmada expirada
await test('URL expirada al cargar: el reproductor pide otra y reproduce (sin intervención)', async (page) => {
  await signup('ana@test.dev');
  await be.behavior({ firstTtl: -30 }); // la primera URL ya viene vencida
  await openClass(page, IDS.free);
  await loginViaModal(page, 'ana@test.dev');
  await page.waitForSelector('.yp-player', { timeout: 15000 });
  await playAndWait(page, 1.5);
  const { log } = await be.state();
  assert.ok(log.playbackCalls.length >= 2, `debía renovar la URL (llamadas: ${log.playbackCalls.length})`);
  assert.ok(log.cdn.some((r) => r.status === 403), 'el CDN debió rechazar la URL vencida');
  assert.ok(log.cdn.some((r) => r.status === 200 && /\.ts$/.test(r.path)), 'debió descargar segmentos con la URL nueva');
});

await test('URL expirada siempre (renovación inútil) → error con reintento que se recupera', async (page) => {
  await signup('ana@test.dev');
  await be.behavior({ playbackTtl: -30 });
  await openClass(page, IDS.free);
  await loginViaModal(page, 'ana@test.dev');
  await page.waitForSelector('.yp-player', { timeout: 15000 });
  await waitFor(page, () => !document.querySelector('.yp-error').hidden, null, 25000);
  assert.match(await text(page, '.yp-error-msg'), /No pudimos reproducir/);
  await be.behavior({ playbackTtl: 120 });
  await page.click('.yp-error button');
  await waitFor(page, () => document.querySelector('.yp-error').hidden, null, 10000);
  await playAndWait(page, 1);
});

await test('renovación PREVENTIVA: con URL de 8 s el video sigue sin cortes y sin error', async (page) => {
  await signup('ana@test.dev');
  await be.behavior({ playbackTtl: 8 });
  await openClass(page, IDS.free);
  await loginViaModal(page, 'ana@test.dev');
  await page.waitForSelector('.yp-player');
  await playAndWait(page, 1);
  await waitFor(page, async () => true);
  // se espera a que ocurra la renovación (a los ~6 s) y se comprueba que la reproducción continúa
  await waitFor(page, () => fetch('http://127.0.0.1:4174/__test/state').then((r) => r.json()).then((s) => s.log.playbackCalls.length >= 2), null, 15000);
  const t1 = await videoTime(page);
  await new Promise((r) => setTimeout(r, 2000));
  const ended = await page.$eval('.yp-player', (n) => n.dataset.state);
  assert.ok(ended === 'ended' || (await videoTime(page)) > t1 + 0.5, 'la reproducción debe continuar tras renovar');
  assert.equal(await page.$eval('.yp-error', (n) => n.hidden), true);
});

// ============================================================ progreso
await test('progreso: se guarda periódicamente y al pausar; al volver retoma y avisa', async (page) => {
  await signup('ana@test.dev');
  await openClass(page, IDS.free);
  await loginViaModal(page, 'ana@test.dev');
  await page.waitForSelector('.yp-player');
  await playAndWait(page, 5);
  await waitFor(page, async () => (await (await fetch('http://127.0.0.1:4174/__test/state')).json()).log.saves.length >= 1, null, 10000);
  await page.evaluate(() => document.querySelector('.yp-video').pause());
  const tPause = await videoTime(page);
  await waitFor(page, async (t) => { const s = (await (await fetch('http://127.0.0.1:4174/__test/state')).json()).log.saves; return s.length && Math.abs(s.at(-1).seconds - t) <= 1.2; }, tPause, 8000);
  const { log } = await be.state();
  assert.ok(log.saves.length < 12, 'no debe haber una petición por segundo');

  await page.reload();
  await page.waitForSelector('.yp-resume:not([hidden])', { timeout: 15000 });
  assert.match(await text(page, '.yp-resume'), /Continuás en 0:0[3-9]/);
  await waitFor(page, (t) => document.querySelector('.yp-video').currentTime >= t - 1.5, tPause, 15000);
  assert.match(await text(page, '#info'), /Llevas \d+ %/);
});

await test('progreso: "Empezar de cero" vuelve al inicio', async (page) => {
  await signup('ana@test.dev');
  await openClass(page, IDS.free);
  await loginViaModal(page, 'ana@test.dev');
  await page.waitForSelector('.yp-player');
  await playAndWait(page, 5);
  await page.evaluate(() => document.querySelector('.yp-video').pause());
  await new Promise((r) => setTimeout(r, 600));
  await page.reload();
  await page.waitForSelector('.yp-resume:not([hidden])', { timeout: 15000 });
  await page.click('.yp-resume .yp-link');
  await waitFor(page, () => document.querySelector('.yp-video').currentTime < 3 && !document.querySelector('.yp-video').paused, null, 10000);
});

await test('progreso: al cambiar de página se guarda (keepalive) y al terminar la clase queda "Vista"', async (page) => {
  await signup('ana@test.dev');
  await openClass(page, IDS.free);
  await loginViaModal(page, 'ana@test.dev');
  await page.waitForSelector('.yp-player');
  await playAndWait(page, 3);
  const before = (await be.state()).log.saves.length;
  const tLeave = await videoTime(page);
  await page.goto(`${S}/videoteca.html`); // dispara pagehide
  await waitFor(page, async (n) => (await (await fetch('http://127.0.0.1:4174/__test/state')).json()).log.saves.length > n, before, 8000);
  const last = (await be.state()).log.saves.at(-1);
  assert.ok(last.seconds >= tLeave - 1.5, `debió guardar cerca de ${tLeave.toFixed(1)}s (guardó ${last.seconds}s)`);

  // terminar: ir casi al final y dejar que acabe
  await openClass(page, IDS.free);
  await page.waitForSelector('.yp-player');
  await page.waitForSelector('.yp-bigplay', { visible: true });
  await page.evaluate(() => { const v = document.querySelector('.yp-video'); v.currentTime = 10.5; });
  await page.click('.yp-bigplay');
  await waitFor(page, () => document.querySelector('.yp-player').dataset.state === 'ended', null, 20000);
  await waitFor(page, async () => (await (await fetch('http://127.0.0.1:4174/__test/state')).json()).progress.some((p) => p.completed), null, 8000);
  await page.goto(`${S}/videoteca.html`);
  await waitFor(page, () => document.querySelectorAll('.tag-light').length > 0 && /Vista/.test(document.querySelector('#catalogGrid').textContent));
});

await test('"Continuar viendo": aparece con clases empezadas y no terminadas', async (page) => {
  await signup('ana@test.dev');
  await openClass(page, IDS.free);
  await loginViaModal(page, 'ana@test.dev');
  await page.waitForSelector('.yp-player');
  await playAndWait(page, 5);
  await page.evaluate(() => document.querySelector('.yp-video').pause());
  await new Promise((r) => setTimeout(r, 800));
  await page.goto(`${S}/videoteca.html`);
  await page.waitForSelector('#continueBlock:not([hidden]) .video-card', { timeout: 15000 });
  assert.match(await text(page, '#continueBlock h2'), /Continuar viendo/);
  assert.match(await text(page, '#continueBlock .tag-mint'), /Continuar · 0:0\d/);
  assert.equal(await count(page, '#continueBlock .video-progress'), 1);
});

// ============================================================ cuenta
await test('cuenta: registro, sesión persistente tras recargar, menú y cierre de sesión', async (page) => {
  await page.goto(S);
  await page.click('[data-account-toggle]');
  await page.waitForSelector('#authEmail', { visible: true });
  await page.evaluate(() => [...document.querySelectorAll('.yp-tab')].find((b) => b.textContent === 'Crear cuenta').click());
  await page.waitForSelector('#authName', { visible: true });
  await page.type('#authName', 'Lucía Prueba');
  await page.type('#authEmail', 'lucia@test.dev');
  await page.type('#authPass', 'corta');
  await page.click('.yp-auth button[type=submit]');
  await page.waitForSelector('.yp-form-error');
  assert.match(await text(page, '.yp-form-error'), /al menos 8 caracteres/);
  await page.$eval('#authPass', (i) => (i.value = ''));
  await page.type('#authPass', PASS);
  await page.click('.yp-auth button[type=submit]');
  await waitFor(page, () => document.querySelector('[data-account-toggle]').classList.contains('has-session'));

  await page.reload(); // sesión persistente
  await waitFor(page, () => document.querySelector('[data-account-toggle]').classList.contains('has-session'));
  await page.click('[data-account-toggle]');
  await page.waitForSelector('.yp-account-menu');
  assert.match(await text(page, '.yp-account-who strong'), /Lucía Prueba/);
  assert.equal(await count(page, '.yp-account-menu a[href*="admin"]'), 0, 'un usuario común no ve el panel');
  await page.evaluate(() => [...document.querySelectorAll('.yp-account-item')].find((b) => /Cerrar sesión/.test(b.textContent)).click());
  await waitFor(page, () => !document.querySelector('[data-account-toggle]').classList.contains('has-session'));
  await page.reload();
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(await page.$eval('[data-account-toggle]', (n) => n.classList.contains('has-session')), false);
});

await test('cuenta: registro que exige confirmar el correo, y recuperación de contraseña', async (page) => {
  await be.behavior({ confirmEmail: true });
  await page.goto(S);
  await page.click('[data-account-toggle]');
  await page.waitForSelector('#authEmail', { visible: true });
  await page.evaluate(() => [...document.querySelectorAll('.yp-tab')].find((b) => b.textContent === 'Crear cuenta').click());
  await page.type('#authName', 'Nuevo');
  await page.type('#authEmail', 'nuevo@test.dev');
  await page.type('#authPass', PASS);
  await page.click('.yp-auth button[type=submit]');
  await waitFor(page, () => /Revisá tu correo|Revisa tu correo/.test(document.querySelector('.yp-auth .modal-title').textContent));
  assert.match(await text(page, '.yp-auth-note'), /nuevo@test\.dev/);
  await page.click('.yp-auth [data-bs-dismiss=modal].btn');
  await new Promise((r) => setTimeout(r, 500));

  await page.click('[data-account-toggle]');
  await page.waitForSelector('#authEmail', { visible: true });
  await page.evaluate(() => [...document.querySelectorAll('.yp-link')].find((b) => /Olvidaste/.test(b.textContent)).click());
  await page.waitForSelector('#authEmail');
  await page.type('#authEmail', 'ana@test.dev');
  await page.click('.yp-auth button[type=submit]');
  await waitFor(page, () => /Si ana@test\.dev tiene una cuenta/.test(document.querySelector('.yp-auth-note')?.textContent || ''));
  assert.deepEqual((await be.state()).recoveries, ['ana@test.dev']);
});

await test('cuenta: editar el nombre y cambiar la contraseña', async (page) => {
  await signup('ana@test.dev', 'Ana Vieja');
  await page.goto(`${S}/cuenta.html`);
  await page.waitForSelector('.yp-state button');
  await page.click('.yp-state button');
  await page.waitForSelector('#authEmail', { visible: true });
  await page.type('#authEmail', 'ana@test.dev');
  await page.type('#authPass', PASS);
  await page.click('.yp-auth button[type=submit]');
  await page.waitForSelector('#accName', { timeout: 10000 });
  assert.equal(await page.$eval('#accName', (i) => i.value), 'Ana Vieja');
  await page.$eval('#accName', (i) => (i.value = ''));
  await page.type('#accName', 'Ana Nueva');
  await page.evaluate(() => [...document.querySelectorAll('button[type=submit]')].find((b) => /Guardar cambios/.test(b.textContent)).click());
  await waitFor(page, async () => (await (await fetch('http://127.0.0.1:4174/__test/state')).json()).users.some((u) => u.name === 'Ana Nueva'), null, 8000);
});

// ============================================================ seguridad básica del frontend
await test('el HTML/JS servido no contiene secretos ni pide columnas privadas', async (page) => {
  const bad = [];
  page.on('response', async (r) => { if (r.status() === 401 && /rest\/v1\/classes/.test(r.url())) bad.push(r.url()); });
  await page.goto(`${S}/videoteca.html`);
  await waitFor(page, () => document.querySelectorAll('#catalogGrid .video-card').length === 3);
  assert.deepEqual(bad, [], 'el frontend pidió columnas privadas de classes');
  for (const path of ['/js/config.js', '/js/lib/api.js', '/js/pages/clase.js']) {
    const body = await (await fetch(S + path)).text();
    assert.ok(!/service_role|BUNNY_API_KEY|AccessKey|token-auth-key/i.test(body), `${path} contiene algo sensible`);
  }
  assert.equal((await fetch(`${S}/.env`)).status, 404);
});

await browser.close();
await be.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} pasaron · ${failed.length} fallaron${only ? ` (filtro: "${only}")` : ''}\n`);
process.exit(failed.length ? 1 : 0);
