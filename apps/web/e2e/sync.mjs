// Deux appareils, un vrai serveur et une vraie base PostgreSQL : le propriétaire saisit, le vétérinaire consulte.
// Prérequis : `npm run build` ; TEST_DATABASE_URL (un PostgreSQL où l'on peut créer une base) ; Chromium.
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import pg from 'pg';
import { preview } from 'vite';
import { chromium } from 'playwright-core';

const base = process.env.TEST_DATABASE_URL;
if (!base) {
  console.log('E2E synchronisation ignoré : définissez TEST_DATABASE_URL.');
  process.exit(0);
}
const nomBase = `digitalab_e2e_${Date.now()}`;
const admin = new pg.Client({ connectionString: base });
await admin.connect();
await admin.query(`CREATE DATABASE ${nomBase}`);
const urlBase = new URL(base);
urlBase.pathname = `/${nomBase}`;

const CLE_INSTALLATION = 'e2e-cle-0001';
const PORT_API = 8099;
const PORT_WEB = 4174;
const URL_API = `http://localhost:${PORT_API}`;
const racine = fileURLToPath(new URL('../../..', import.meta.url));
const api = spawn(process.execPath, ['--import', 'tsx', 'apps/api/src/main.ts'], {
  cwd: racine,
  env: { ...process.env, DATABASE_URL: urlBase.toString(), PORT: String(PORT_API), DIGITALAB_CLE_INSTALLATION: CLE_INSTALLATION, DIGITALAB_SECRET: 'secret-e2e-0123456789' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((resolve, reject) => {
  api.stdout.on('data', (d) => String(d).includes('serveur prêt') && resolve());
  api.on('exit', (c) => reject(new Error(`le serveur s'est arrêté (${c})`)));
  setTimeout(() => reject(new Error('le serveur ne démarre pas')), 30000);
});

const web = await preview({ root: fileURLToPath(new URL('..', import.meta.url)), preview: { port: PORT_WEB, strictPort: true }, logLevel: 'error' });
const navigateur = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium' });
const erreurs = [];

async function appareil(nom) {
  const contexte = await navigateur.newContext({ viewport: { width: 390, height: 800 }, serviceWorkers: 'block' });
  const page = await contexte.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', (e) => erreurs.push(`${nom}: ${e.message}`));
  return { page, texte: () => page.locator('body').innerText() };
}

/** Attend qu'un texte apparaisse dans la page (même réparti sur plusieurs éléments). */
const voir = (page, re) => page.waitForFunction(([src, fl]) => new RegExp(src, fl).test(document.body.innerText), [re.source, re.flags]);

/** Après une première connexion, l'application impose de choisir un code de verrouillage. */
async function choisirCode(page) {
  await page.getByRole('heading', { name: 'Choisissez votre code' }).waitFor();
  await page.getByLabel('Votre code (4 à 6 chiffres)').fill('2580');
  await page.getByLabel('Confirmez le code').fill('2580');
  await page.getByRole('button', { name: 'Enregistrer mon code' }).click();
}

const MOT_DE_PASSE_ADMIN = 'Poule-Pondeuse-7';
const MOT_DE_PASSE_VETO = 'Veto-Du-Village-42';

/** Premier lancement : le serveur n'a pas d'administrateur, la page de connexion propose de le créer. Renvoie les codes de secours. */
async function creerAdministrateur(page) {
  await page.getByLabel('Adresse du serveur').fill(URL_API);
  await page.getByRole('heading', { name: 'Créer l’administrateur' }).waitFor();
  // Sans la bonne clé affichée dans la console du serveur, la création est refusée.
  await page.getByLabel('Clé d’installation').fill('mauvaise-cle');
  await page.getByLabel('Nom de l’élevage').fill('Ferme sync');
  await page.getByLabel('Votre nom').fill('Aminata Sow');
  await page.getByLabel('Mot de passe', { exact: true }).fill(MOT_DE_PASSE_ADMIN);
  await page.getByLabel('Confirmez le mot de passe').fill(MOT_DE_PASSE_ADMIN);
  await page.getByRole('button', { name: 'Créer l’administrateur' }).click();
  await page.getByText(/Clé d’installation incorrecte/).waitFor();
  await page.getByLabel('Clé d’installation').fill(CLE_INSTALLATION);
  // Un mot de passe qui contient l'identifiant est refusé avant même d'appeler le serveur.
  await page.getByLabel('Mot de passe', { exact: true }).fill('admin 1234');
  await page.getByLabel('Confirmez le mot de passe').fill('admin 1234');
  await page.getByRole('button', { name: 'Créer l’administrateur' }).click();
  await page.getByText(/ne doit pas contenir votre identifiant/).waitFor();
  await page.getByLabel('Mot de passe', { exact: true }).fill(MOT_DE_PASSE_ADMIN);
  await page.getByLabel('Confirmez le mot de passe').fill(MOT_DE_PASSE_ADMIN);
  await page.getByRole('button', { name: 'Créer l’administrateur' }).click();
  await page.getByRole('heading', { name: 'Vos codes de secours' }).waitFor();
  const codes = await page.locator('.codes-secours code').allInnerTexts();
  assert.equal(codes.length, 8);
  assert.match(codes[0], /^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/);
  // On ne peut pas continuer sans avoir confirmé qu'on les a notés.
  assert.equal(await page.getByRole('button', { name: 'Entrer dans l’application' }).isDisabled(), true);
  await page.getByLabel('J’ai noté mes codes de secours en lieu sûr').check();
  await page.getByRole('button', { name: 'Entrer dans l’application' }).click();
  await choisirCode(page);
  return codes;
}

/** Connexion d'une personne ajoutée par l'administrateur : mot de passe provisoire, puis choix de son propre mot de passe. */
async function connecterAvecProvisoire(page, identifiant, provisoire, nouveau) {
  await page.getByLabel('Identifiant', { exact: true }).fill(identifiant);
  await page.getByLabel('Mot de passe', { exact: true }).fill(provisoire);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.getByRole('heading', { name: 'Choisissez votre mot de passe' }).waitFor();
  await page.getByLabel('Nouveau mot de passe', { exact: true }).fill(nouveau);
  await page.getByLabel('Confirmez le nouveau mot de passe').fill(nouveau);
  await page.getByRole('button', { name: 'Enregistrer et continuer' }).click();
}

async function synchroniser(page) {
  await page.getByRole('banner').getByRole('link', { name: /Compte et synchronisation/ }).click();
  await page.getByRole('button', { name: 'Synchroniser maintenant' }).click();
  await page.getByText(/Tout est à jour|Synchronisé ✓/).waitFor();
}

const a = await appareil('proprietaire');
const v = await appareil('veterinaire');
try {
  console.log('→ 1 propriétaire : démarrage, création de l’administrateur (clé d’installation, codes de secours)');
  await a.page.goto(`http://localhost:${PORT_WEB}/`);
  await a.page.getByText('Bienvenue sur AviMaster').waitFor();
  await a.page.getByLabel('Nom de votre élevage (facultatif)').fill('Ferme sync');
  await a.page.getByLabel('Combien de poules ?').fill('20');
  await a.page.getByRole('button', { name: 'Commencer' }).click();
  await a.page.getByText('Ferme sync').waitFor();
  await a.page.getByRole('banner').getByRole('link', { name: 'Réglages' }).click();
  await a.page.getByRole('link', { name: /Partager avec mes aides/ }).click();
  const codesSecours = await creerAdministrateur(a.page);
  await a.page.getByRole('heading', { name: 'Tableau de bord' }).waitFor();
  await a.page.getByRole('banner').getByRole('link', { name: 'Compte et synchronisation' }).click();
  await a.page.getByRole('banner').getByRole('link', { name: 'Compte et synchronisation' }).click();
  await a.page.getByRole('button', { name: 'Synchroniser maintenant' }).waitFor();
  assert.match(await a.texte(), /Élevage\s+Ferme sync/);
  await a.page.getByRole('button', { name: 'Synchroniser maintenant' }).click();
  await a.page.getByText(/Tout est à jour|Synchronisé ✓/).waitFor();

  console.log('→ 2 propriétaire ajoute le vétérinaire : identifiant nom.prénom et mot de passe provisoire montré une fois');
  await a.page.getByRole('link', { name: /Gestion des utilisateurs/ }).click();
  await a.page.getByRole('heading', { name: 'Gestion des utilisateurs' }).waitFor();
  await a.page.getByRole('link', { name: '+ Ajouter un utilisateur' }).click();
  await a.page.getByLabel('Prénom').fill('Dr');
  await a.page.getByLabel('Nom', { exact: true }).fill('Sy');
  await a.page.getByText(/L’identifiant sera créé automatiquement : sy\.dr/).waitFor();
  await a.page.getByLabel('Fonction dans la ferme').fill('Vétérinaire');
  await a.page.getByLabel('Téléphone (facultatif)').fill('77 000 00 02');
  await a.page.getByLabel('Profil de départ').selectOption({ label: 'Vétérinaire' });
  // Le profil coche des fonctions ; on en décoche une pour vérifier que les cases sont libres.
  await a.page.getByLabel('Tout cocher : Finances').check();
  await a.page.getByLabel('Tout cocher : Finances').uncheck();
  if (process.env.CAPTURES) await a.page.screenshot({ path: `${process.env.CAPTURES}/u1.png`, fullPage: true });
  await a.page.getByRole('button', { name: 'Ajouter et obtenir le mot de passe provisoire' }).click();
  await a.page.getByRole('heading', { name: 'Compte créé' }).waitFor();
  const identifiantVeto = (await a.page.locator('.carte .ligne b').first().innerText()).trim();
  const provisoireVeto = (await a.page.locator('.gros-mdp').innerText()).trim();
  if (process.env.CAPTURES) await a.page.screenshot({ path: `${process.env.CAPTURES}/u2.png`, fullPage: true });
  assert.equal(identifiantVeto, 'sy.dr');
  assert.match(provisoireVeto, /^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/);
  // Le mot de passe provisoire n'est montré qu'une fois : la liste n'en garde aucune trace.
  await a.page.getByRole('link', { name: 'Terminé' }).click();
  await a.page.getByText('Dr Sy').waitFor();
  assert.match(await a.texte(), /mot de passe provisoire pas encore changé/);
  assert.ok(!(await a.texte()).includes(provisoireVeto));

  console.log('→ 3 vétérinaire : se connecte sur un autre téléphone, doit choisir son propre mot de passe');
  await v.page.goto(`http://localhost:${PORT_WEB}/`);
  await v.page.getByText('Bienvenue sur AviMaster').waitFor();
  await v.page.getByRole('link', { name: /J’ai déjà un compte/ }).click();
  await v.page.getByLabel('Adresse du serveur').fill(URL_API);
  // Un mauvais mot de passe reçoit un message qui ne dit pas si l'identifiant existe.
  await v.page.getByLabel('Identifiant', { exact: true }).fill('sy.dr');
  await v.page.getByLabel('Mot de passe', { exact: true }).fill('pas-le-bon-mot-de-passe');
  await v.page.getByRole('button', { name: 'Se connecter' }).click();
  await v.page.getByText('Identifiant ou mot de passe incorrect.').waitFor();
  await connecterAvecProvisoire(v.page, 'sy.dr', provisoireVeto.toUpperCase(), MOT_DE_PASSE_VETO);
  await choisirCode(v.page);
  await v.page.getByRole('heading', { name: 'Tableau de bord' }).waitFor();
  await voir(v.page, /20\s+animaux/);
  // Son menu ne montre que ses modules : pas de finances, pas de quarantaine d'arrivée.
  assert.equal(await v.page.getByRole('navigation').getByRole('link', { name: /Finances/ }).count(), 0);
  assert.equal(await v.page.getByRole('banner').getByRole('link', { name: 'Finances' }).count(), 0);

  console.log('→ 4 la saisie du propriétaire arrive chez le vétérinaire');
  await a.page.getByRole('navigation').getByRole('link', { name: /Saisie/ }).click();
  await a.page.getByRole('link', { name: /Ponte du jour/ }).click();
  await a.page.locator('.nombre input').first().fill('9');
  await a.page.getByRole('button', { name: 'Enregistrer' }).click();
  await a.page.getByText('Ponte enregistrée').waitFor();
  await synchroniser(a.page);
  await synchroniser(v.page);
  await v.page.getByRole('navigation').getByRole('link', { name: /Accueil/ }).click();
  await voir(v.page, /9\s+œufs aujourd’hui/);

  console.log('→ 5 les droits sont appliqués : pas de saisie de ponte, pas de finances, et les chiffres ne lui sont même pas envoyés');
  await v.page.getByRole('navigation').getByRole('link', { name: /Saisie/ }).click();
  await v.page.getByRole('heading', { name: 'Que voulez-vous noter ?' }).waitFor();
  assert.doesNotMatch(await v.texte(), /Ponte du jour|Dépense|Recette/);
  assert.match(await v.texte(), /Problème de santé/);
  await v.page.evaluate(() => { window.location.hash = '#/saisie/ponte'; });
  await v.page.getByRole('heading', { name: 'Accès non autorisé' }).waitFor();
  await v.page.evaluate(() => { window.location.hash = '#/finances'; });
  await v.page.getByRole('heading', { name: 'Accès non autorisé' }).waitFor();
  // Le propriétaire note une recette ; elle ne doit jamais arriver sur le téléphone du vétérinaire.
  await a.page.getByRole('navigation').getByRole('link', { name: /Saisie/ }).click();
  await a.page.getByRole('link', { name: /Recette/ }).click();
  await a.page.getByLabel('Montant (FCFA)').fill('5000');
  await a.page.getByRole('button', { name: 'Enregistrer' }).click();
  await a.page.getByText('Résultat du mois').waitFor();
  await synchroniser(a.page);
  await synchroniser(v.page);
  const compte = (page, table) => page.evaluate((t) => new Promise((resolve) => {
    const r = indexedDB.open('digitalab');
    r.onsuccess = () => { const q = r.result.transaction(t).objectStore(t).count(); q.onsuccess = () => resolve(q.result); };
  }), table);
  assert.equal(await compte(a.page, 'operations'), 1);
  assert.equal(await compte(v.page, 'operations'), 0);
  assert.equal(await compte(v.page, 'paiements'), 0);

  // (le vétérinaire ne saisit pas de ponte : 9 + 2 = 11)
  console.log('→ 6 hors connexion, la saisie du propriétaire attend le retour du réseau');
  await a.page.context().setOffline(true);
  await a.page.getByRole('navigation').getByRole('link', { name: /Saisie/ }).click();
  await a.page.getByRole('link', { name: /Ponte du jour/ }).click();
  await a.page.locator('.nombre input').first().fill('2');
  await a.page.getByRole('button', { name: 'Enregistrer' }).click();
  await a.page.getByText('Ponte enregistrée').waitFor();
  await a.page.context().setOffline(false);
  await synchroniser(a.page);
  await synchroniser(v.page);
  await v.page.getByRole('navigation').getByRole('link', { name: /Accueil/ }).click();
  await voir(v.page, /11\s+œufs aujourd’hui/);

  console.log('→ 7 le journal d’activité note qui a fait quoi');
  await a.page.getByRole('banner').getByRole('link', { name: 'Réglages' }).click();
  await a.page.getByRole('link', { name: /Journal d’activité/ }).click();
  await a.page.getByRole('heading', { name: 'Journal d’activité' }).waitFor();
  await voir(a.page, /a ajouté une ponte : 9 œufs/);
  await voir(a.page, /a ajouté Dr Sy \(Vétérinaire\)/);
  await voir(a.page, /a choisi son mot de passe personnel/);
  assert.doesNotMatch(await a.texte(), new RegExp(provisoireVeto));
  assert.match(await a.texte(), /a ajouté une opération financière : recette/);
  // Le vétérinaire n'a pas ce droit : la page lui répond clairement.
  await v.page.evaluate(() => { window.location.hash = '#/journal'; });
  await v.page.getByText('Votre profil ne permet pas de consulter le journal d’activité.').waitFor();

  console.log('→ 8 mot de passe oublié par le vétérinaire : l’administrateur en génère un nouveau, l’ancien ne marche plus');
  await a.page.getByRole('banner').getByRole('link', { name: 'Réglages' }).click();
  await a.page.getByRole('link', { name: /Gestion des utilisateurs/ }).click();
  await a.page.getByRole('link', { name: /Dr Sy/ }).click();
  await a.page.getByRole('button', { name: 'Réinitialiser son mot de passe' }).click();
  await a.page.getByRole('alertdialog').getByRole('button', { name: 'Oui' }).click();
  await a.page.getByRole('heading', { name: 'Nouveau mot de passe provisoire' }).waitFor();
  const nouveauProvisoire = (await a.page.locator('.gros-mdp').innerText()).trim();
  assert.notEqual(nouveauProvisoire, provisoireVeto);
  // Ses appareils sont déconnectés : sa prochaine synchronisation est refusée.
  await v.page.getByRole('banner').getByRole('link', { name: /Compte et synchronisation/ }).click();
  await v.page.getByRole('button', { name: 'Synchroniser maintenant' }).click();
  await v.page.getByRole('status').filter({ hasText: 'Votre session a expiré.' }).waitFor();
  await v.page.getByRole('button', { name: 'Se déconnecter de cet appareil' }).click();
  await v.page.getByRole('alertdialog').getByRole('button', { name: 'Oui' }).click();
  await v.page.getByRole('heading', { name: 'Connexion' }).waitFor();
  // L'adresse du serveur est reprise : il n'a pas à la retaper.
  await v.page.getByLabel('Identifiant', { exact: true }).fill('sy.dr');
  await v.page.getByLabel('Mot de passe', { exact: true }).fill(MOT_DE_PASSE_VETO);
  await v.page.getByRole('button', { name: 'Se connecter' }).click();
  await v.page.getByText('Identifiant ou mot de passe incorrect.').waitFor();
  await connecterAvecProvisoire(v.page, 'sy.dr', nouveauProvisoire, 'Nouveau-Veto-Du-Village-43');
  await v.page.getByRole('heading', { name: 'Tableau de bord' }).waitFor();

  console.log('→ 9 mot de passe oublié par le propriétaire : un code de secours, qui ne sert qu’une fois');
  await a.page.evaluate(() => { window.location.hash = '#/compte'; });
  await a.page.getByRole('button', { name: 'Se déconnecter de cet appareil' }).click();
  await a.page.getByRole('alertdialog').getByRole('button', { name: 'Oui' }).click();
  await a.page.getByRole('heading', { name: 'Connexion' }).waitFor();
  await a.page.getByText('J’ai oublié mon mot de passe').click();
  await a.page.getByRole('button', { name: 'Utiliser un code de secours' }).click();
  await a.page.getByLabel('Identifiant', { exact: true }).fill('admin');
  await a.page.getByLabel('Code de secours').fill(codesSecours[0].toUpperCase());
  await a.page.getByLabel('Nouveau mot de passe', { exact: true }).fill('Mon-Mot-De-Passe-Retrouve-5');
  await a.page.getByLabel('Confirmez le nouveau mot de passe').fill('Mon-Mot-De-Passe-Retrouve-5');
  await a.page.getByRole('button', { name: 'Choisir ce mot de passe' }).click();
  await a.page.getByText('Votre mot de passe est changé.').waitFor();
  await a.page.getByLabel('Mot de passe', { exact: true }).fill(MOT_DE_PASSE_ADMIN);
  await a.page.getByRole('button', { name: 'Se connecter' }).click();
  await a.page.getByText('Identifiant ou mot de passe incorrect.').waitFor();
  await a.page.getByLabel('Mot de passe', { exact: true }).fill('Mon-Mot-De-Passe-Retrouve-5');
  await a.page.getByRole('button', { name: 'Se connecter' }).click();
  await a.page.getByRole('heading', { name: 'Tableau de bord' }).waitFor();
  assert.doesNotMatch(await a.texte(), /Choisissez votre code/);

  assert.deepEqual(erreurs, []);
  console.log('E2E SYNCHRO OK : administrateur créé avec clé d’installation et codes de secours, utilisateur avec mot de passe provisoire à changer, réinitialisation, code de secours, droits appliqués (menus, pages, données non envoyées), saisie partagée, reprise après coupure, journal d’activité');
} catch (e) {
  await a.page.screenshot({ path: new URL('./echec-a.png', import.meta.url).pathname }).catch(() => {});
  await v.page.screenshot({ path: new URL('./echec-v.png', import.meta.url).pathname }).catch(() => {});
  console.error('--- propriétaire ---\n', await a.texte().catch(() => ''));
  console.error('--- vétérinaire ---\n', await v.texte().catch(() => ''));
  console.error(e);
  process.exitCode = 1;
} finally {
  await Promise.race([navigateur.close(), new Promise((r) => setTimeout(r, 5000))]);
  await web.close();
  api.removeAllListeners('exit');
  const arrete = new Promise((r) => api.once('exit', r));
  api.kill('SIGTERM');
  await Promise.race([arrete, new Promise((r) => setTimeout(r, 5000))]);
  await admin.query(`DROP DATABASE IF EXISTS ${nomBase} WITH (FORCE)`).catch(() => {});
  await admin.end().catch(() => {});
  process.exit(process.exitCode ?? 0);
}
