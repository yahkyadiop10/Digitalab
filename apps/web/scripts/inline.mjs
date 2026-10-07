// Fabrique dist-apercu/apercu.html : toute l'application dans un seul fichier HTML (script et styles intégrés).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dossier = new URL('../dist-apercu/', import.meta.url).pathname;
let html = readFileSync(join(dossier, 'index.html'), 'utf8');

const lire = (chemin) => readFileSync(join(dossier, chemin.replace(/^\.\//, '')), 'utf8');

const styles = [];
html = html.replace(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (_, href) => {
  styles.push(lire(href));
  return '';
});
let script = '';
html = html.replace(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g, (_, src) => {
  script += lire(src);
  return '';
});
if (!script || styles.length === 0) throw new Error('Script ou styles introuvables dans dist-apercu/index.html');

const corps = html.match(/<body[^>]*>([\s\S]*)<\/body>/)?.[1]?.trim() ?? '<div id="root"></div>';
const page = [
  '<title>Digitalab</title>',
  `<style>${styles.join('\n')}</style>`,
  corps,
  `<script type="module">${script.replace(/<\/script/gi, '<\\/script')}</script>`,
].join('\n');
writeFileSync(join(dossier, 'apercu.html'), page);
console.log(`apercu.html : ${(page.length / 1024).toFixed(0)} Ko`);
