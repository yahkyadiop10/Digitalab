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
  await page.clock.install();
  await page.goto('http://apercu.test/cadre');
  const app = page.frameLocator('#f');

  etape('1 données d’exemple depuis l’écran de démarrage');
  await app.getByText('Essayer avec des données d’exemple').first().click();
  await app.getByRole('heading', { name: 'Tableau de bord' }).waitFor();

  etape('1b trésorerie : comptes et écart à expliquer, avec les données d’exemple');
  await app.getByRole('banner').getByRole('link', { name: 'Finances' }).click();
  await app.getByText('Liquidités').first().waitFor();
  await app.getByText(/1 écart de trésorerie à expliquer/).waitFor();
  await app.locator('.tresorerie-resume').click();
  await app.getByRole('heading', { name: 'Trésorerie' }).waitFor();
  assert.equal(await app.locator('a.compte').count(), 4);

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
  // Une personne connectée choisit d'abord son code de verrouillage.
  await app.getByRole('heading', { name: 'Choisissez votre code' }).waitFor();
  await app.getByLabel('Votre code (4 à 6 chiffres)').fill('1234');
  await app.getByLabel('Confirmez le code').fill('1234');
  await app.getByText(/suite de chiffres/).or(app.getByRole('button', { name: 'Enregistrer mon code' })).first().waitFor();
  await app.getByRole('button', { name: 'Enregistrer mon code' }).click();
  await app.getByText('Évitez une suite de chiffres comme 1234.').waitFor();
  await app.getByLabel('Votre code (4 à 6 chiffres)').fill('2580');
  await app.getByLabel('Confirmez le code').fill('2580');
  await app.getByRole('button', { name: 'Enregistrer mon code' }).click();
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
  const codeMoussa = (await app.locator('.gros-code').innerText()).trim();
  assert.match(codeMoussa, /^\d{6}$/);
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

  etape('6 verrouillage après 10 minutes, code à saisir, application masquée');
  await app.getByRole('banner').getByRole('link', { name: 'Réglages' }).click();
  await app.getByRole('heading', { name: 'Session et sécurité' }).waitFor();
  if (process.env.CAPTURES) await page.screenshot({ path: `${process.env.CAPTURES}/v0.png`, fullPage: true });
  await page.clock.fastForward('09:30');
  assert.equal(await app.getByRole('heading', { name: 'Session verrouillée' }).count(), 0);
  await page.clock.fastForward('01:00');
  await app.getByRole('heading', { name: 'Session verrouillée' }).waitFor();
  if (process.env.CAPTURES) await page.screenshot({ path: `${process.env.CAPTURES}/v1.png` });
  assert.doesNotMatch(await app.locator('body').innerText(), /Réglages|Tableau de bord|Journal/);
  await app.getByLabel('Votre code').fill('0000');
  await app.getByRole('button', { name: 'Déverrouiller' }).click();
  await app.getByText('Code incorrect. Il vous reste 9 essais.').waitFor();
  await app.getByLabel('Votre code').fill('2580');
  await app.getByRole('button', { name: 'Déverrouiller' }).click();
  await app.getByRole('heading', { name: 'Session et sécurité' }).waitFor();

  etape('7 verrouillage immédiat par le bouton');
  await app.getByRole('button', { name: 'Verrouiller l’application' }).click();
  await app.getByRole('heading', { name: 'Session verrouillée' }).waitFor();
  await app.getByLabel('Votre code').fill('2580');
  await app.getByRole('button', { name: 'Déverrouiller' }).click();
  await app.getByRole('heading', { name: 'Session et sécurité' }).waitFor();

  etape('8 déconnexion après 30 minutes d’inactivité, puis page de connexion');
  await page.clock.fastForward('31:00');
  await app.getByRole('heading', { name: 'Connexion' }).waitFor();
  await app.getByText('Vous avez été déconnecté').waitFor();
  if (process.env.CAPTURES) await page.screenshot({ path: `${process.env.CAPTURES}/v2.png` });
  assert.doesNotMatch(await app.locator('body').innerText(), /Réglages|Tableau de bord/);
  await app.getByLabel('Votre numéro de téléphone').fill('77 000 00 01');
  await app.getByRole('button', { name: 'Recevoir un code' }).click();
  await app.getByLabel('Code reçu').fill('123456');
  await app.getByRole('button', { name: 'Valider' }).click();
  // Même personne, même appareil : ses données et son code sont toujours là.
  await app.getByRole('heading', { name: 'Tableau de bord' }).waitFor();
  assert.doesNotMatch(await app.locator('body').innerText(), /Choisissez votre code/);

  etape('9 déconnexion volontaire, puis une autre personne sur le même appareil');
  await app.getByRole('banner').getByRole('link', { name: 'Réglages' }).click();
  await app.getByRole('button', { name: 'Se déconnecter' }).click();
  await app.getByRole('alertdialog').getByRole('button', { name: 'Oui' }).click();
  await app.getByRole('heading', { name: 'Connexion' }).waitFor();
  assert.equal(await app.getByText('Vous avez été déconnecté').count(), 0);
  await app.getByLabel('Votre numéro de téléphone').fill('77 111 22 33');
  await app.getByRole('button', { name: 'J’ai déjà un code donné par mon administrateur' }).click();
  await app.getByLabel('Code reçu').fill(codeMoussa);
  await app.getByRole('button', { name: 'Valider' }).click();
  await app.getByText(/Cet appareil contient les données de/).waitFor();
  await app.getByRole('button', { name: 'Effacer cet appareil et continuer' }).click();
  // Les données de la personne précédente ont disparu, et son code aussi : la nouvelle personne choisit le sien.
  await app.getByRole('heading', { name: 'Choisissez votre code' }).waitFor();
  await app.getByLabel('Votre code (4 à 6 chiffres)').fill('7391');
  await app.getByLabel('Confirmez le code').fill('7391');
  await app.getByRole('button', { name: 'Enregistrer mon code' }).click();
  await app.getByRole('heading', { name: 'Tableau de bord' }).waitFor();
  assert.doesNotMatch(await app.locator('body').innerText(), /Brahma|Soie/);

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
