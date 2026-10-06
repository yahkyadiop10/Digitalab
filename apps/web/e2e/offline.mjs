// Parcours de bout en bout, y compris hors connexion.
// Prérequis : `npm run build` ; Chromium (variable CHROMIUM_PATH ou /opt/pw-browsers/chromium).
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';

const PORT = 4173;
const ADRESSE = `http://localhost:${PORT}/`;
const serveur = await preview({ root: fileURLToPath(new URL('..', import.meta.url)), preview: { port: PORT, strictPort: true }, logLevel: 'error' });

const navigateur = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium' });
const contexte = await navigateur.newContext({ viewport: { width: 390, height: 800 }, serviceWorkers: 'allow' });
const page = await contexte.newPage();
page.setDefaultTimeout(10000);
const erreurs = [];
const etape = (n) => console.log('→', n);
page.on('pageerror', (e) => erreurs.push(e.message));
const texte = () => page.locator('body').innerText();

try {
  etape(1);
  // 1. Démarrage : 20 poules dans un poulailler de 10 m² (5 m² nécessaires)
  await page.goto(ADRESSE);
  await page.getByText('Bienvenue sur Digitalab').waitFor();
  await page.getByLabel('Nom de votre élevage (facultatif)').fill('Ferme test');
  await page.getByLabel('Combien de poules ?').fill('20');
  await page.getByLabel('Surface du poulailler en m² (facultatif)').fill('10');
  await page.getByRole('button', { name: 'Commencer' }).click();
  await page.getByText('Ferme test').waitFor();
  assert.match(await texte(), /Tout va bien/);
  assert.match(await texte(), /20\s+animaux/);

  etape(2);
  // 2. Le service worker doit être actif pour pouvoir travailler hors ligne
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.getByText('Ferme test').waitFor();

  etape(3);
  // 3. Hors connexion : rechargement et saisie
  await contexte.setOffline(true);
  await page.reload();
  await page.getByText('Ferme test').waitFor();
  await page.getByRole('link', { name: /Saisie/ }).click();
  await page.getByRole('link', { name: /Ponte du jour/ }).click();
  await page.locator('.nombre input').first().fill('9');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await page.getByText('Ponte enregistrée').waitFor();
  assert.match(await texte(), /9\s+œufs aujourd’hui/);

  etape(4);
  // 4. Décès : 3 morts sur 20 -> alerte rouge de mortalité
  await page.getByRole('link', { name: /Saisie/ }).click();
  await page.getByRole('link', { name: /Décès/ }).click();
  await page.locator('.nombre input').first().fill('3');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await page.getByText(/Mortalité élevée/).waitFor();
  assert.match(await texte(), /Urgence/);
  assert.match(await texte(), /17\s+animaux/);

  etape(5);
  // 5. Annuler le décès depuis l'historique du lot rétablit l'effectif
  await page.getByRole('link', { name: /Cheptel/ }).click();
  await page.getByRole('link', { name: /Mes poules/ }).click();
  page.once('dialog', (d) => d.accept());
  await page.getByText(/Décès : -3/).locator('..').getByRole('button', { name: 'Annuler' }).click();
  await page.getByText(/Animaux\s*20/).waitFor();

  etape(6);
  // 6. Les données survivent à un rechargement hors ligne
  await page.reload();
  await page.getByRole('link', { name: /Accueil/ }).click();
  await page.locator('.tuiles').waitFor();
  assert.match(await texte(), /20\s+animaux/);
  assert.deepEqual(erreurs, []);
  console.log('E2E OK : démarrage, hors ligne, saisie, alerte, annulation, persistance');
} catch (e) {
  await page.screenshot({ path: new URL('./echec.png', import.meta.url).pathname }).catch(() => {});
  console.error(await texte().catch(() => ''));
  console.error(e);
  process.exitCode = 1;
} finally {
  await Promise.race([navigateur.close(), new Promise((r) => setTimeout(r, 5000))]);
  await serveur.close();
  process.exit(process.exitCode ?? 0);
}
