import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { creerApp } from './app.js';
import { lireConfig } from './config.js';
import { creerPool, migrer } from './db.js';
import { creerElevage, sansAdministrateur } from './installation.js';

const config = lireConfig();
// Par défaut, le serveur distribue l'application construite à côté de lui (npm run build).
const webParDefaut = fileURLToPath(new URL('../../web/dist/', import.meta.url));
const dossierWeb = config.dossierWeb ?? (existsSync(`${webParDefaut}index.html`) ? webParDefaut : null);
const pool = creerPool(config.databaseUrl);
const appliquees = await migrer(pool);
if (appliquees.length) console.log(`[digitalab] migrations appliquées : ${appliquees.join(', ')}`);

/** Les adresses par lesquelles les téléphones du réseau peuvent joindre ce serveur. */
function liens(port: number): string[] {
  const adresses = Object.values(networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => `http://${a!.address}:${port}`);
  return adresses.length ? adresses : [`http://localhost:${port}`];
}

const app = await creerApp({ pool, config: { ...config, dossierWeb } });
await app.listen({ port: config.port, host: config.hote });
console.log(`[digitalab] serveur prêt sur le port ${config.port}`);
if (!dossierWeb) console.log('[digitalab] application non trouvée : lancez « npm run build » pour que le lien affiche l’application.');
console.log(`[digitalab] lien de connexion : ${liens(config.port).join('  ou  ')}`);

// Premier démarrage : le serveur crée le compte administrateur et affiche son mot de passe provisoire, à remettre au propriétaire.
if (await sansAdministrateur(pool)) {
  const acces = await creerElevage(pool, config.coutMotDePasse);
  console.log('');
  console.log('[digitalab] ┌──────────────────────────────────────────────────────────────┐');
  console.log('[digitalab] │  PREMIER DÉMARRAGE : compte administrateur créé               │');
  console.log(`[digitalab] │    Identifiant : ${acces.identifiant.padEnd(44)}│`);
  console.log(`[digitalab] │    Mot de passe provisoire : ${acces.motDePasseProvisoire.padEnd(32)}│`);
  console.log('[digitalab] │  À remettre au propriétaire avec le lien de connexion.        │');
  console.log('[digitalab] │  Il choisira son propre mot de passe à la première connexion. │');
  console.log('[digitalab] └──────────────────────────────────────────────────────────────┘');
  console.log('');
}

const arreter = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGINT', arreter);
process.on('SIGTERM', arreter);
