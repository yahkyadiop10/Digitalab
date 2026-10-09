import { randomInt } from 'node:crypto';
import { creerApp } from './app.js';
import { lireConfig } from './config.js';
import { creerPool, migrer } from './db.js';
import { sansAdministrateur } from './installation.js';

const ALPHABET = 'acdefghjkmnpqrtuvwxy34679';
const groupe = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

let config = lireConfig();
const pool = creerPool(config.databaseUrl);
const appliquees = await migrer(pool);
if (appliquees.length) console.log(`[digitalab] migrations appliquées : ${appliquees.join(', ')}`);

// Premier lancement : sans administrateur, quiconque atteint le serveur pourrait créer le compte principal. On exige une clé affichée ici seulement.
if (await sansAdministrateur(pool)) {
  const cle = config.cleInstallation ?? `${groupe()}-${groupe()}`;
  config = { ...config, cleInstallation: cle };
  console.log('');
  console.log('[digitalab] ┌─────────────────────────────────────────────────────────────┐');
  console.log('[digitalab] │  PREMIER LANCEMENT : aucun administrateur n’existe encore.  │');
  console.log('[digitalab] │  Ouvrez l’application, choisissez « Créer l’administrateur » │');
  console.log('[digitalab] │  et saisissez cette clé d’installation :                     │');
  console.log(`[digitalab] │      ${cle.padEnd(54)}│`);
  console.log('[digitalab] └─────────────────────────────────────────────────────────────┘');
  console.log('');
}

const app = await creerApp({ pool, config });
await app.listen({ port: config.port, host: config.hote });
console.log(`[digitalab] serveur prêt sur le port ${config.port}`);

const arreter = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGINT', arreter);
process.on('SIGTERM', arreter);
