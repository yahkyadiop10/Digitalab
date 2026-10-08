import { creerApp } from './app.js';
import { lireConfig } from './config.js';
import { creerPool, migrer } from './db.js';
import { notifieurConsole } from './notifieur.js';

const config = lireConfig();
const pool = creerPool(config.databaseUrl);
const appliquees = await migrer(pool);
if (appliquees.length) console.log(`[digitalab] migrations appliquées : ${appliquees.join(', ')}`);

const app = await creerApp({ pool, config, notifieur: notifieurConsole });
await app.listen({ port: config.port, host: config.hote });
console.log(`[digitalab] serveur prêt sur le port ${config.port}`);

const arreter = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGINT', arreter);
process.on('SIGTERM', arreter);
