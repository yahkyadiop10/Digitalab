// Commandes pour la personne qui installe ou entretient le serveur, à lancer sur l'ordinateur du serveur :
//   npm run admin -- reinitialiser admin                    nouveau mot de passe provisoire pour un compte (propriétaire compris)
//   npm run admin -- creer-elevage <identifiant> "<nom de l'élevage>" "<nom du propriétaire>"
import { lireConfig } from './config.js';
import { creerPool, migrer } from './db.js';
import { creerElevage, reinitialiserDepuisLeServeur } from './installation.js';

const [commande, ...args] = process.argv.slice(2);
const config = lireConfig();
const pool = creerPool(config.databaseUrl);
const jour = (d: Date) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });

try {
  await migrer(pool);
  if (commande === 'reinitialiser' && args[0]) {
    const r = await reinitialiserDepuisLeServeur(pool, config.coutMotDePasse, args[0]);
    console.log(`Identifiant : ${r.identifiant}\nMot de passe provisoire : ${r.motDePasseProvisoire} (valable jusqu’au ${jour(r.expireLe)})\nLa personne choisira son propre mot de passe à la connexion. Ses appareils ont été déconnectés.`);
  } else if (commande === 'creer-elevage' && args[0]) {
    const r = await creerElevage(pool, config.coutMotDePasse, { identifiant: args[0], ...(args[1] ? { nomElevage: args[1] } : {}), ...(args[2] ? { nom: args[2] } : {}) });
    console.log(`Élevage créé.\nIdentifiant : ${r.identifiant}\nMot de passe provisoire : ${r.motDePasseProvisoire} (valable jusqu’au ${jour(r.expireLe)})`);
  } else {
    console.log('Utilisation :\n  npm run admin -- reinitialiser <identifiant>\n  npm run admin -- creer-elevage <identifiant> "<nom de l’élevage>" "<nom du propriétaire>"');
    process.exitCode = 1;
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await pool.end();
}
