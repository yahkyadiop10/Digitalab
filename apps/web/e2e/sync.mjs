// Deux appareils, un vrai serveur et une vraie base PostgreSQL : le propriétaire saisit, le vétérinaire consulte.
// L'application est ouverte par le lien du serveur, comme le fera un client. Prérequis : `npm run build` ; TEST_DATABASE_URL ; Chromium.
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import pg from 'pg';
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

const PORT_API = 8099;
// Le lien de connexion du client : le serveur distribue lui-même l'application.
const LIEN = `http://localhost:${PORT_API}`;
const racine = fileURLToPath(new URL('../../..', import.meta.url));
const envServeur = { ...process.env, DATABASE_URL: urlBase.toString(), PORT: String(PORT_API) };
const api = spawn(process.execPath, ['--import', 'tsx', 'apps/api/src/main.ts'], { cwd: racine, env: envServeur, stdio: ['ignore', 'pipe', 'inherit'] });
let console_serveur = '';
api.stdout.on('data', (d) => { console_serveur += String(d); });
await new Promise((resolve, reject) => {
  const t = setInterval(() => console_serveur.includes('Mot de passe provisoire') && (clearInterval(t), resolve()), 100);
  api.on('exit', (c) => reject(new Error(`le serveur s'est arrêté (${c})`)));
  setTimeout(() => reject(new Error(`le serveur ne démarre pas :\n${console_serveur}`)), 30000);
});
// Au premier démarrage, le serveur crée le compte administrateur et affiche son mot de passe provisoire (à remettre au propriétaire).
const provisoireAdmin = console_serveur.match(/Mot de passe provisoire : (\d{6})/)[1];
assert.match(console_serveur, /Identifiant : admin/);
assert.match(console_serveur, /lien de connexion : http:\/\//);

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

const MOT_DE_PASSE_ADMIN = 'ferme2026';
const MOT_DE_PASSE_VETO = 'veto-village';

/** Première connexion d'une personne : identifiant et mot de passe provisoire, puis choix de son propre mot de passe. Aucune adresse à taper. */
async function premiereConnexion(page, identifiant, provisoire, nouveau) {
  assert.equal(await page.getByLabel('Adresse du serveur').count(), 0, 'ouverte par le lien, l’application ne doit pas demander d’adresse');
  await page.getByLabel('Identifiant', { exact: true }).fill(identifiant);
  await page.getByLabel('Mot de passe', { exact: true }).fill(provisoire);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.getByRole('heading', { name: 'Choisissez votre mot de passe' }).waitFor();
  await page.getByLabel('Nouveau mot de passe', { exact: true }).fill(nouveau);
  await page.getByLabel('Confirmez le nouveau mot de passe').fill(nouveau);
  await page.getByRole('button', { name: 'Enregistrer et continuer' }).click();
}

/** Mot de passe provisoire et identifiant affichés à l'administrateur. */
async function accesAffiches(page) {
  return {
    identifiant: (await page.locator('.ligne', { hasText: 'Identifiant' }).locator('b').innerText()).trim(),
    lien: (await page.locator('.ligne', { hasText: 'Lien de connexion' }).locator('b').innerText()).trim(),
    provisoire: (await page.locator('.gros-code').innerText()).trim(),
  };
}

async function synchroniser(page) {
  await page.getByRole('banner').getByRole('link', { name: /Compte et synchronisation/ }).click();
  await page.getByRole('button', { name: 'Synchroniser maintenant' }).click();
  await page.getByText(/Tout est à jour|Synchronisé ✓/).waitFor();
}

const a = await appareil('proprietaire');
const v = await appareil('veterinaire');
try {
  console.log('→ 1 propriétaire : ouvre le lien, démarre, se connecte avec le mot de passe provisoire et choisit le sien');
  await a.page.goto(LIEN);
  // Ouverte par le lien, l'application commence par la connexion ; le propriétaire peut d'abord préparer son élevage.
  await a.page.getByRole('heading', { name: 'Connexion' }).waitFor();
  await a.page.getByRole('link', { name: /Essayer d’abord l’application/ }).click();
  await a.page.getByText('Bienvenue sur AviMaster').waitFor();
  await a.page.getByLabel('Nom de votre élevage (facultatif)').fill('Ferme sync');
  await a.page.getByLabel('Combien de poules ?').fill('20');
  await a.page.getByRole('button', { name: 'Commencer' }).click();
  await a.page.getByText('Ferme sync').waitFor();
  await a.page.getByRole('banner').getByRole('link', { name: 'Réglages' }).click();
  await a.page.getByRole('link', { name: /Partager avec mes aides/ }).click();
  await a.page.getByLabel('Identifiant', { exact: true }).waitFor();
  // Un mot de passe trop simple est refusé avant même d'appeler le serveur.
  await a.page.getByLabel('Identifiant', { exact: true }).fill('admin');
  await a.page.getByLabel('Mot de passe', { exact: true }).fill(provisoireAdmin);
  await a.page.getByRole('button', { name: 'Se connecter' }).click();
  await a.page.getByRole('heading', { name: 'Choisissez votre mot de passe' }).waitFor();
  await a.page.getByLabel('Nouveau mot de passe', { exact: true }).fill('123456');
  await a.page.getByLabel('Confirmez le nouveau mot de passe').fill('123456');
  await a.page.getByRole('button', { name: 'Enregistrer et continuer' }).click();
  await a.page.getByText(/trop courant/).waitFor();
  await a.page.getByLabel('Nouveau mot de passe', { exact: true }).fill(MOT_DE_PASSE_ADMIN);
  await a.page.getByLabel('Confirmez le nouveau mot de passe').fill(MOT_DE_PASSE_ADMIN);
  await a.page.getByRole('button', { name: 'Enregistrer et continuer' }).click();
  // Plus de code à chiffres à choisir : on arrive directement dans l'application.
  await a.page.getByRole('heading', { name: 'Tableau de bord' }).waitFor();
  await a.page.getByRole('banner').getByRole('link', { name: 'Compte et synchronisation' }).click();
  await a.page.getByRole('button', { name: 'Synchroniser maintenant' }).waitFor();
  assert.match(await a.texte(), /Élevage\s+Ferme sync/);
  await a.page.getByRole('button', { name: 'Synchroniser maintenant' }).click();
  await a.page.getByText(/Tout est à jour|Synchronisé ✓/).waitFor();

  console.log('→ 2 propriétaire ajoute le vétérinaire : identifiant nom.prénom, lien et mot de passe provisoire à 6 chiffres');
  await a.page.getByRole('link', { name: /Gestion des utilisateurs/ }).click();
  await a.page.getByRole('heading', { name: 'Gestion des utilisateurs' }).waitFor();
  await a.page.getByRole('link', { name: '+ Ajouter un utilisateur' }).click();
  await a.page.getByLabel('Prénom').fill('Dr');
  await a.page.getByLabel('Nom', { exact: true }).fill('Sy');
  await a.page.getByText(/Laissez vide pour « sy\.dr »/).waitFor();
  await a.page.getByLabel('Fonction dans la ferme').fill('Vétérinaire');
  await a.page.getByLabel('Téléphone (facultatif)').fill('77 000 00 02');
  await a.page.getByLabel('Profil de départ').selectOption({ label: 'Vétérinaire' });
  // Le profil coche des fonctions ; on en décoche une pour vérifier que les cases sont libres.
  await a.page.getByLabel('Tout cocher : Finances').check();
  await a.page.getByLabel('Tout cocher : Finances').uncheck();
  if (process.env.CAPTURES) await a.page.screenshot({ path: `${process.env.CAPTURES}/u1.png`, fullPage: true });
  await a.page.getByRole('button', { name: 'Ajouter et obtenir le mot de passe provisoire' }).click();
  await a.page.getByRole('heading', { name: 'Compte créé' }).waitFor();
  const veto = await accesAffiches(a.page);
  if (process.env.CAPTURES) await a.page.screenshot({ path: `${process.env.CAPTURES}/u2.png`, fullPage: true });
  assert.equal(veto.identifiant, 'sy.dr');
  assert.equal(veto.lien, LIEN);
  assert.match(veto.provisoire, /^\d{6}$/);
  const provisoireVeto = veto.provisoire;
  // Le mot de passe provisoire n'est montré qu'une fois : la liste n'en garde aucune trace.
  await a.page.getByRole('link', { name: 'Terminé' }).click();
  await a.page.getByText('Dr Sy').waitFor();
  assert.match(await a.texte(), /mot de passe provisoire pas encore changé/);
  assert.ok(!(await a.texte()).includes(provisoireVeto));

  console.log('→ 3 vétérinaire : ouvre le lien sur son téléphone, se connecte et choisit son propre mot de passe');
  await v.page.goto(veto.lien);
  // Le lien mène droit à la connexion : rien d'autre à choisir.
  await v.page.getByRole('heading', { name: 'Connexion' }).waitFor();
  assert.equal(await v.page.getByText('Bienvenue sur AviMaster').count(), 0);
  // Un mauvais mot de passe reçoit un message qui ne dit pas si l'identifiant existe.
  await v.page.getByLabel('Identifiant', { exact: true }).fill('sy.dr');
  await v.page.getByLabel('Mot de passe', { exact: true }).fill('pas-le-bon');
  await v.page.getByRole('button', { name: 'Se connecter' }).click();
  await v.page.getByText('Identifiant ou mot de passe incorrect.').waitFor();
  await premiereConnexion(v.page, 'sy.dr', ` ${provisoireVeto} `, MOT_DE_PASSE_VETO);
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

  console.log('→ 8 verrouillage : le mot de passe est redemandé, le bon déverrouille');
  await v.page.getByRole('button', { name: 'Verrouiller l’application' }).click();
  await v.page.getByRole('heading', { name: 'Session verrouillée' }).waitFor();
  assert.doesNotMatch(await v.texte(), /Tableau de bord|Réglages/);
  await v.page.getByLabel('Votre mot de passe').fill('pas-le-bon');
  await v.page.getByRole('button', { name: 'Déverrouiller' }).click();
  await v.page.getByText(/Mot de passe incorrect/).waitFor();
  await v.page.getByLabel('Votre mot de passe').fill(MOT_DE_PASSE_VETO);
  await v.page.getByRole('button', { name: 'Déverrouiller' }).click();
  await v.page.getByRole('heading', { name: 'Journal d’activité' }).or(v.page.getByText('Votre profil ne permet pas de consulter le journal d’activité.')).first().waitFor();

  console.log('→ 9 mot de passe oublié par le vétérinaire : l’administrateur en génère un nouveau, l’ancien ne marche plus');
  await a.page.getByRole('banner').getByRole('link', { name: 'Réglages' }).click();
  await a.page.getByRole('link', { name: /Gestion des utilisateurs/ }).click();
  await a.page.getByRole('link', { name: /Dr Sy/ }).click();
  await a.page.getByRole('button', { name: 'Réinitialiser son mot de passe' }).click();
  await a.page.getByRole('alertdialog').getByRole('button', { name: 'Oui' }).click();
  await a.page.getByRole('heading', { name: 'Nouveau mot de passe provisoire' }).waitFor();
  const nouveauProvisoire = (await accesAffiches(a.page)).provisoire;
  assert.match(nouveauProvisoire, /^\d{6}$/);
  // Ses appareils sont déconnectés : sa prochaine synchronisation est refusée.
  await v.page.getByRole('banner').getByRole('link', { name: /Compte et synchronisation/ }).click();
  await v.page.getByRole('button', { name: 'Synchroniser maintenant' }).click();
  await v.page.getByRole('status').filter({ hasText: 'Votre session a expiré.' }).waitFor();
  await v.page.getByRole('button', { name: 'Se déconnecter de cet appareil' }).click();
  await v.page.getByRole('alertdialog').getByRole('button', { name: 'Oui' }).click();
  await v.page.getByRole('heading', { name: 'Connexion' }).waitFor();
  await v.page.getByLabel('Identifiant', { exact: true }).fill('sy.dr');
  await v.page.getByLabel('Mot de passe', { exact: true }).fill(MOT_DE_PASSE_VETO);
  await v.page.getByRole('button', { name: 'Se connecter' }).click();
  await v.page.getByText('Identifiant ou mot de passe incorrect.').waitFor();
  await premiereConnexion(v.page, 'sy.dr', nouveauProvisoire, 'veto-nouveau');
  await v.page.getByRole('heading', { name: 'Tableau de bord' }).waitFor();

  console.log('→ 10 mot de passe oublié par le propriétaire : l’installateur lui en redonne un depuis l’ordinateur du serveur');
  const sortie = execFileSync(process.execPath, ['--import', 'tsx', 'apps/api/src/admin.ts', 'reinitialiser', 'admin'], { cwd: racine, env: envServeur, encoding: 'utf8' });
  const provisoireRetrouve = sortie.match(/Mot de passe provisoire : (\d{6})/)[1];
  // Son téléphone, verrouillé, ne connaît que l'ancien mot de passe : le serveur reconnaît le provisoire et l'invite à se reconnecter.
  await a.page.getByRole('button', { name: 'Verrouiller l’application' }).click();
  await a.page.getByRole('heading', { name: 'Session verrouillée' }).waitFor();
  await a.page.getByLabel('Votre mot de passe').fill(provisoireRetrouve);
  await a.page.getByRole('button', { name: 'Déverrouiller' }).click();
  await a.page.getByRole('alert').filter({ hasText: 'nouveau mot de passe provisoire' }).waitFor();
  await a.page.getByRole('button', { name: 'Me reconnecter' }).click();
  await a.page.getByRole('alertdialog').getByRole('button', { name: 'Oui' }).click();
  await a.page.getByRole('heading', { name: 'Connexion' }).waitFor();
  await premiereConnexion(a.page, 'admin', provisoireRetrouve, 'ferme-retrouvee');
  await a.page.getByRole('heading', { name: 'Tableau de bord' }).waitFor();

  assert.deepEqual(erreurs, []);
  console.log('E2E SYNCHRO OK : lien de connexion servi par le serveur, administrateur créé au premier démarrage, mot de passe provisoire à 6 chiffres à changer, verrouillage par mot de passe, réinitialisation par l’administrateur et depuis le serveur, droits appliqués, saisie partagée, reprise après coupure, journal d’activité');
} catch (e) {
  await a.page.screenshot({ path: new URL('./echec-a.png', import.meta.url).pathname }).catch(() => {});
  await v.page.screenshot({ path: new URL('./echec-v.png', import.meta.url).pathname }).catch(() => {});
  console.error('--- propriétaire ---\n', await a.texte().catch(() => ''));
  console.error('--- vétérinaire ---\n', await v.texte().catch(() => ''));
  console.error(e);
  process.exitCode = 1;
} finally {
  await Promise.race([navigateur.close(), new Promise((r) => setTimeout(r, 5000))]);
  api.removeAllListeners('exit');
  const arrete = new Promise((r) => api.once('exit', r));
  api.kill('SIGTERM');
  await Promise.race([arrete, new Promise((r) => setTimeout(r, 5000))]);
  await admin.query(`DROP DATABASE IF EXISTS ${nomBase} WITH (FORCE)`).catch(() => {});
  await admin.end().catch(() => {});
  process.exit(process.exitCode ?? 0);
}
