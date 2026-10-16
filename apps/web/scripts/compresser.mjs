// Prépare une version brotli (.br) et gzip (.gz) de chaque fichier texte de l'application construite :
// le serveur les envoie aux téléphones qui les acceptent (environ trois fois moins à télécharger).
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const dossier = process.argv[2] ?? new URL('../dist', import.meta.url).pathname;
const TEXTE = /\.(js|css|html|svg|json|webmanifest|txt)$/;

async function* fichiers(d) {
  for (const e of await readdir(d, { withFileTypes: true })) {
    const chemin = join(d, e.name);
    if (e.isDirectory()) yield* fichiers(chemin);
    else if (TEXTE.test(e.name)) yield chemin;
  }
}

let avant = 0;
let apres = 0;
for await (const f of fichiers(dossier)) {
  if ((await stat(f)).size < 1024) continue;
  const contenu = await readFile(f);
  const br = brotliCompressSync(contenu, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } });
  await writeFile(`${f}.br`, br);
  await writeFile(`${f}.gz`, gzipSync(contenu, { level: 9 }));
  avant += contenu.length;
  apres += br.length;
}
console.log(`Compression : ${Math.round(avant / 1024)} Ko → ${Math.round(apres / 1024)} Ko (brotli)`);
