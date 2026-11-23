import { cp, mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

const url = process.env.SUPABASE_URL ?? '';
const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? '';
const demo = process.env.UTN_DEMO === 'true';
if (Boolean(url) !== Boolean(key)) throw new Error('Configura las dos variables públicas de Supabase.');
if (key && !key.startsWith('sb_publishable_')) throw new Error('Usa la clave publicable de Supabase.');
if (url && !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url)) throw new Error('URL de Supabase inválida.');

await mkdir('dist/vendor', { recursive: true });
for (const item of ['index.html', 'app.js', 'styles.css', 'sw.js', 'manifest.webmanifest', '_headers', 'assets', 'vendor']) {
  await cp(item, 'dist/' + item, { recursive: true });
}
await build({ entryPoints: ['dependencies.mjs'], bundle: true, minify: true, format: 'iife', outfile: 'dist/vendor/dependencies.js' });
await writeFile('dist/config.js', 'window.TARJETON_CONFIG = ' + JSON.stringify({
  demo, supabaseUrl: url, supabasePublishableKey: key,
}) + ';\n');
