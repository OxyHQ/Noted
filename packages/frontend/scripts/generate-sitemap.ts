/** Generate the public sitemap with `bun run generate-sitemap`. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Notes, collections and settings belong to signed-in accounts. The welcome
// page is the only public destination; a build date is not a content lastmod.
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://noted.oxy.so/</loc>
  </url>
</urlset>
`;

function writeIfChanged(file: string): void {
  if (!existsSync(file) || readFileSync(file, 'utf8') !== sitemap) {
    writeFileSync(file, sitemap, 'utf8');
  }
}

writeIfChanged(resolve(import.meta.dirname, '../public/sitemap.xml'));
const dist = resolve(import.meta.dirname, '../dist');
if (existsSync(dist)) writeIfChanged(resolve(dist, 'sitemap.xml'));
console.log('Sitemap ready: 1 public page.');
