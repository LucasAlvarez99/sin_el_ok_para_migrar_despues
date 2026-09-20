#!/usr/bin/env node
/**
 * Arma dist/ con SOLO los archivos públicos del sitio. Esa carpeta es lo único que se sube
 * a Hostinger: por construcción no puede llevarse .env, supabase/, scripts/ ni node_modules.
 *
 * Incluye: los *.html de la raíz, y las carpetas css/, js/, assets/ y admin/ (si existen).
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const PUBLIC_DIRS = ["css", "js", "assets", "admin"];

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist);

const copied = [];
for (const f of readdirSync(root)) {
  if (f.endsWith(".html")) {
    cpSync(join(root, f), join(dist, f));
    copied.push(f);
  }
}
for (const d of PUBLIC_DIRS) {
  if (existsSync(join(root, d))) {
    cpSync(join(root, d), join(dist, d), { recursive: true, filter: (src) => !/\.(map|example\.js)$/.test(src) });
    copied.push(`${d}/`);
  }
}
// El .htaccess viaja con el sitio (Hostinger lo lee desde la raíz publicada).
cpSync(join(root, ".htaccess"), join(dist, ".htaccess"));
copied.push(".htaccess");

console.log(`dist/ listo: ${copied.join(", ")}`);
console.log("Subir a Hostinger (public_html) el CONTENIDO de dist/, no la carpeta del proyecto.");
