// Vérifie la version « aperçu en une page » telle qu'un visualiseur l'affiche : dans une fenêtre intégrée sans boîtes de dialogue du navigateur,
// avec un serveur simulé. Prérequis : `npm run apercu`.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const html = await readFile(fileURLToPath(new URL('../dist-apercu/apercu.html', import.meta.url)), 'utf8');
const navigateur = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium' });
const contexte = await navigateur.newContext({ viewport: { width: 400, height: 900 }, serviceWorkers: 'block' });
const page = await contexte.newPage();
page.setDefaultTimeout(10000);
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(e.message));
await page.route('http://apercu.test/app', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
await page.route('http://apercu.test/cadre', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<iframe id="f" sandbox="allow-scripts allow-same-origin allow-forms" src="http://apercu.test/app" style="width:390px;height:880px"></iframe>' }));
const etape = (n) => console.log('→', n);

try {
  await page.goto('http://apercu.test/cadre');
  const app = page.frameLocator('#f');

  etape('1 données d’exemple depuis l’écran de démarrage');
  await app.getByText('Essayer avec des données d’exemple').first().click();
  await app.getByRole('heading', { name: 'Tableau de bord' }).waitFor();

  etape('2 « Ajouter des données d’exemple » répond, même sans boîte de dialogue du navigateur');
  await app.getByRole('banner').getByRole('link', { name: 'Réglages' }).click();
  await app.getByRole('button', { name: 'Ajouter des données d’exemple' }).click();
  await app.getByRole('alertdialog').getByRole('button', { name: 'Oui' }).click();
  await app.getByText('Exemple chargé').waitFor();

  etape('3 « Gestion des utilisateurs » est visible dans les réglages');
  await app.getByRole('link', { name: /Gestion des utilisateurs/ }).click();
  await app.getByRole('link', { name: 'Créer ou relier un compte' }).click();
  await app.getByText('Démonstration').first().waitFor();
  await app.getByLabel('Votre numéro de téléphone').fill('77 000 00 01');
  await app.getByRole('button', { name: 'Recevoir un code' }).click();
  await app.getByText(/Mode démonstration/).waitFor();
  await app.getByLabel('Code reçu').fill('123456');
  await app.getByRole('button', { name: 'Valider' }).click();
  await app.getByRole('heading', { name: 'Tableau de bord' }).waitFor();

  etape('4 ajout d’un utilisateur avec ses droits et son code');
  await app.getByRole('banner').getByRole('link', { name: 'Réglages' }).click();
  await app.getByRole('link', { name: /Gestion des utilisateurs/ }).click();
  await app.getByRole('link', { name: '+ Ajouter un utilisateur' }).click();
  await app.getByLabel('Nom de la personne').fill('Moussa Ndiaye');
  await app.getByLabel('Fonction dans la ferme').fill('Responsable bâtiment A');
  await app.getByLabel('Téléphone', { exact: true }).fill('77 111 22 33');
  await app.getByLabel('Profil de départ').selectOption({ label: 'Caissier' });
  await app.getByLabel('Tout cocher : Salaires').check();
  await app.getByRole('button', { name: 'Ajouter et obtenir le code' }).click();
  await app.getByRole('heading', { name: 'Code de connexion' }).waitFor();
  assert.match((await app.locator('.gros-code').innerText()).trim(), /^\d{6}$/);
  await app.getByRole('link', { name: 'Terminé' }).click();
  await app.getByText('Moussa Ndiaye').waitFor();
  assert.match(await app.locator('body').innerText(), /Responsable bâtiment A/);

  etape('5 journal d’activité');
  await app.getByRole('banner').getByRole('link', { name: 'Réglages' }).click();
  await app.getByRole('link', { name: /Journal d’activité/ }).click();
  await app.getByText(/a ajouté Moussa Ndiaye/).waitFor();
  await app.getByText(/a ajouté une ponte : 48 œufs/).waitFor();
  await app.getByText(/fait sans réseau/).waitFor();
  if (process.env.CAPTURES) await page.screenshot({ path: `${process.env.CAPTURES}/j1.png` });

  assert.deepEqual(erreurs, []);
  console.log('E2E APERÇU OK : confirmations utilisables, gestion des utilisateurs visible et essayable');
} catch (e) {
  await page.screenshot({ path: new URL('./echec-apercu.png', import.meta.url).pathname }).catch(() => {});
  console.error(e);
  process.exitCode = 1;
} finally {
  await Promise.race([navigateur.close(), new Promise((r) => setTimeout(r, 5000))]);
  process.exit(process.exitCode ?? 0);
}
