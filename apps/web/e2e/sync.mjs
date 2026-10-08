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

const PORT_API = 8099;
const PORT_WEB = 4174;
const URL_API = `http://localhost:${PORT_API}`;
const racine = fileURLToPath(new URL('../../..', import.meta.url));
const api = spawn(process.execPath, ['--import', 'tsx', 'apps/api/src/main.ts'], {
  cwd: racine,
  env: { ...process.env, DATABASE_URL: urlBase.toString(), PORT: String(PORT_API), DIGITALAB_CODE_DEMO: '1', DIGITALAB_SECRET: 'secret-e2e-0123456789' },
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

async function connecter(page, telephone) {
  await page.getByLabel('Votre numéro de téléphone').fill(telephone);
  await page.getByLabel('Adresse du serveur').fill(URL_API);
  await page.getByRole('button', { name: 'Recevoir un code' }).click();
  await page.getByText(/Mode démonstration/).waitFor();
  const code = (await page.locator('form b').last().innerText()).trim();
  await page.getByLabel('Code reçu').fill(code);
  await page.getByRole('button', { name: 'Valider' }).click();
}

async function synchroniser(page) {
  await page.getByRole('banner').getByRole('link', { name: /Compte et synchronisation/ }).click();
  await page.getByRole('button', { name: 'Synchroniser maintenant' }).click();
  await page.getByText(/Tout est à jour|Synchronisé ✓/).waitFor();
}

const a = await appareil('proprietaire');
const v = await appareil('veterinaire');
try {
  console.log('→ 1 propriétaire : démarrage et compte');
  await a.page.goto(`http://localhost:${PORT_WEB}/`);
  await a.page.getByText('Bienvenue sur Digitalab').waitFor();
  await a.page.getByLabel('Nom de votre élevage (facultatif)').fill('Ferme sync');
  await a.page.getByLabel('Combien de poules ?').fill('20');
  await a.page.getByRole('button', { name: 'Commencer' }).click();
  await a.page.getByText('Ferme sync').waitFor();
  await a.page.getByRole('banner').getByRole('link', { name: 'Réglages' }).click();
  await a.page.getByRole('link', { name: /Partager avec mes aides/ }).click();
  await connecter(a.page, '77 000 00 01');
  await a.page.getByRole('heading', { name: 'Tableau de bord' }).waitFor();
  await a.page.getByRole('banner').getByRole('link', { name: 'Compte et synchronisation' }).click();
  await a.page.getByRole('banner').getByRole('link', { name: 'Compte et synchronisation' }).click();
  await a.page.getByRole('button', { name: 'Synchroniser maintenant' }).waitFor();
  assert.match(await a.texte(), /Élevage\s+Ferme sync/);
  await a.page.getByRole('button', { name: 'Synchroniser maintenant' }).click();
  await a.page.getByText(/Tout est à jour|Synchronisé ✓/).waitFor();

  console.log('→ 2 propriétaire ajoute le vétérinaire dans « Gestion des utilisateurs » et reçoit un code');
  await a.page.getByRole('link', { name: /Gestion des utilisateurs/ }).click();
  await a.page.getByRole('heading', { name: 'Gestion des utilisateurs' }).waitFor();
  await a.page.getByRole('link', { name: '+ Ajouter un utilisateur' }).click();
  await a.page.getByLabel('Nom de la personne').fill('Dr Sy');
  await a.page.getByLabel('Fonction dans la ferme').fill('Vétérinaire');
  await a.page.getByLabel('Téléphone', { exact: true }).fill('77 000 00 02');
  await a.page.getByLabel('Profil de départ').selectOption({ label: 'Vétérinaire' });
  // Le profil coche des fonctions ; on en décoche une pour vérifier que les cases sont libres.
  await a.page.getByLabel('Tout cocher : Finances').check();
  await a.page.getByLabel('Tout cocher : Finances').uncheck();
  if (process.env.CAPTURES) await a.page.screenshot({ path: `${process.env.CAPTURES}/u1.png`, fullPage: true });
  await a.page.getByRole('button', { name: 'Ajouter et obtenir le code' }).click();
  await a.page.getByRole('heading', { name: 'Code de connexion' }).waitFor();
  const codeInvitation = (await a.page.locator('.gros-code').innerText()).trim();
  if (process.env.CAPTURES) await a.page.screenshot({ path: `${process.env.CAPTURES}/u2.png`, fullPage: true });
  assert.match(codeInvitation, /^\d{6}$/);

  console.log('→ 3 vétérinaire : se connecte avec le code donné, sans SMS, sur un autre téléphone');
  await v.page.goto(`http://localhost:${PORT_WEB}/`);
  await v.page.getByText('Bienvenue sur Digitalab').waitFor();
  await v.page.getByRole('link', { name: /J’ai déjà un compte/ }).click();
  await v.page.getByLabel('Votre numéro de téléphone').fill('77 000 00 02');
  await v.page.getByLabel('Adresse du serveur').fill(URL_API);
  await v.page.getByRole('button', { name: 'J’ai déjà un code donné par mon administrateur' }).click();
  await v.page.getByLabel('Code reçu').fill(codeInvitation);
  await v.page.getByRole('button', { name: 'Valider' }).click();
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

  assert.deepEqual(erreurs, []);
  console.log('E2E SYNCHRO OK : compte par code, utilisateur ajouté avec code de connexion, droits appliqués (menus, pages, données non envoyées), saisie partagée, reprise après coupure');
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
