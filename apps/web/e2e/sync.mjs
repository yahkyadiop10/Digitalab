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
  await a.page.getByRole('heading', { name: 'Mon équipe' }).waitFor();
  assert.match(await a.texte(), /Élevage\s+Ferme sync/);
  await a.page.getByRole('button', { name: 'Synchroniser maintenant' }).click();
  await a.page.getByText(/Tout est à jour|Synchronisé ✓/).waitFor();

  console.log('→ 2 propriétaire invite le vétérinaire');
  await a.page.getByLabel('Son numéro de téléphone').fill('77 000 00 02');
  await a.page.getByLabel('Son rôle').selectOption({ label: 'Vétérinaire (lecture)' });
  await a.page.getByRole('button', { name: 'Ajouter' }).click();
  await a.page.getByText('+221770000002').waitFor();

  console.log('→ 3 vétérinaire : retrouve l’élevage sur un autre téléphone');
  await v.page.goto(`http://localhost:${PORT_WEB}/`);
  await v.page.getByText('Bienvenue sur Digitalab').waitFor();
  await v.page.getByRole('link', { name: /J’ai déjà un compte/ }).click();
  await connecter(v.page, '77 000 00 02');
  await v.page.getByRole('heading', { name: 'Tableau de bord' }).waitFor();
  await voir(v.page, /20\s+animaux/);

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

  console.log('→ 5 le vétérinaire est en lecture seule');
  await v.page.getByRole('navigation').getByRole('link', { name: /Saisie/ }).click();
  await v.page.getByRole('link', { name: /Ponte du jour/ }).click();
  await v.page.locator('.nombre input').first().fill('4');
  await v.page.getByRole('button', { name: 'Enregistrer' }).click();
  await v.page.getByText('Ponte enregistrée').waitFor();
  await synchroniser(v.page);
  assert.match(await v.texte(), /consulter l’élevage, pas de le modifier/);
  await synchroniser(a.page);
  await a.page.getByRole('navigation').getByRole('link', { name: /Accueil/ }).click();
  await voir(a.page, /9\s+œufs aujourd’hui/);
  assert.doesNotMatch(await a.texte(), /13\s+œufs/);

  // (le vétérinaire garde chez lui sa propre saisie de 4 œufs : 9 + 4 + 2 = 15)
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
  await voir(v.page, /15\s+œufs aujourd’hui/);

  assert.deepEqual(erreurs, []);
  console.log('E2E SYNCHRO OK : compte par code, invitation, second appareil, saisie partagée, lecture seule, reprise après coupure');
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
