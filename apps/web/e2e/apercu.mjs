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

  etape('3 « Gestion des utilisateurs » est visible ; connexion avec le compte de démonstration, puis choix du mot de passe');
  await app.getByRole('link', { name: /Gestion des utilisateurs/ }).click();
  await app.getByRole('link', { name: 'Créer ou relier un compte' }).click();
  await app.getByText('Démonstration').first().waitFor();
  // Seulement deux cases : identifiant et mot de passe. Pas d'adresse, pas de code à chiffres, pas de codes de secours.
  assert.equal(await app.getByLabel('Adresse du serveur').count(), 0);
  await app.getByLabel('Identifiant', { exact: true }).fill('admin');
  await app.getByLabel('Mot de passe', { exact: true }).fill('123456');
  await app.getByRole('button', { name: 'Se connecter' }).click();
  await app.getByRole('heading', { name: 'Choisissez votre mot de passe' }).waitFor();
  await app.getByLabel('Nouveau mot de passe', { exact: true }).fill('court');
  await app.getByLabel('Confirmez le nouveau mot de passe').fill('court');
  await app.getByRole('button', { name: 'Enregistrer et continuer' }).click();
  await app.getByText(/au moins 6 caractères/).waitFor();
  await app.getByLabel('Nouveau mot de passe', { exact: true }).fill('ferme2026');
  await app.getByLabel('Confirmez le nouveau mot de passe').fill('ferme2026');
  await app.getByRole('button', { name: 'Enregistrer et continuer' }).click();
  await app.getByRole('heading', { name: 'Tableau de bord' }).waitFor();

  etape('4 ajout d’un utilisateur : identifiant nom.prénom et mot de passe provisoire');
  await app.getByRole('banner').getByRole('link', { name: 'Réglages' }).click();
  await app.getByRole('link', { name: /Gestion des utilisateurs/ }).click();
  await app.getByRole('link', { name: '+ Ajouter un utilisateur' }).click();
  await app.getByLabel('Prénom').fill('Moussa');
  await app.getByLabel('Nom', { exact: true }).fill('Ndiaye');
  await app.getByLabel('Fonction dans la ferme').fill('Responsable bâtiment A');
  await app.getByLabel('Profil de départ').selectOption({ label: 'Caissier' });
  await app.getByLabel('Tout cocher : Salaires').check();
  await app.getByRole('button', { name: 'Ajouter et obtenir le mot de passe provisoire' }).click();
  await app.getByRole('heading', { name: 'Compte créé' }).waitFor();
  const identifiantMoussa = (await app.locator('.ligne', { hasText: 'Identifiant' }).locator('b').innerText()).trim();
  const provisoireMoussa = (await app.locator('.gros-code').innerText()).trim();
  assert.equal(identifiantMoussa, 'ndiaye.moussa');
  assert.match(provisoireMoussa, /^\d{6}$/);
  assert.match(await app.locator('.ligne', { hasText: 'Lien de connexion' }).innerText(), /mon-elevage\.avimaster\.demo/);
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

  etape('6 après 10 minutes sans utilisation, le mot de passe est redemandé ; l’application est masquée');
  await app.getByRole('banner').getByRole('link', { name: 'Réglages' }).click();
  await app.getByRole('heading', { name: 'Session et sécurité' }).waitFor();
  if (process.env.CAPTURES) await page.screenshot({ path: `${process.env.CAPTURES}/v0.png`, fullPage: true });
  await page.clock.fastForward('09:30');
  assert.equal(await app.getByRole('heading', { name: 'Session verrouillée' }).count(), 0);
  await page.clock.fastForward('01:00');
  await app.getByRole('heading', { name: 'Session verrouillée' }).waitFor();
  if (process.env.CAPTURES) await page.screenshot({ path: `${process.env.CAPTURES}/v1.png` });
  assert.doesNotMatch(await app.locator('body').innerText(), /Réglages|Tableau de bord|Journal/);
  assert.match(await app.locator('body').innerText(), /Identifiant\s+admin/);
  await app.getByLabel('Votre mot de passe').fill('pas-le-bon');
  await app.getByRole('button', { name: 'Déverrouiller' }).click();
  await app.getByText(/Mot de passe incorrect\. Il vous reste 9 essais\./).waitFor();
  await app.getByLabel('Votre mot de passe').fill('ferme2026');
  await app.getByRole('button', { name: 'Déverrouiller' }).click();
  await app.getByRole('heading', { name: 'Session et sécurité' }).waitFor();

  etape('7 verrouillage immédiat par le bouton');
  await app.getByRole('button', { name: 'Verrouiller l’application' }).click();
  await app.getByRole('heading', { name: 'Session verrouillée' }).waitFor();
  await app.getByLabel('Votre mot de passe').fill('ferme2026');
  await app.getByRole('button', { name: 'Déverrouiller' }).click();
  await app.getByRole('heading', { name: 'Session et sécurité' }).waitFor();

  etape('8 même après une longue absence, il suffit du mot de passe (pas de déconnexion, cela marche sans réseau)');
  await page.clock.fastForward('02:00:00');
  await app.getByRole('heading', { name: 'Session verrouillée' }).waitFor();
  await app.getByLabel('Votre mot de passe').fill('ferme2026');
  await app.getByRole('button', { name: 'Déverrouiller' }).click();
  await app.getByRole('heading', { name: 'Session et sécurité' }).waitFor();

  etape('9 déconnexion volontaire, puis une autre personne sur le même appareil');
  await app.getByRole('button', { name: 'Se déconnecter' }).click();
  await app.getByRole('alertdialog').getByRole('button', { name: 'Oui' }).click();
  await app.getByRole('heading', { name: 'Connexion' }).waitFor();
  if (process.env.CAPTURES) await page.screenshot({ path: `${process.env.CAPTURES}/v2.png` });
  await app.getByLabel('Identifiant', { exact: true }).fill(identifiantMoussa);
  await app.getByLabel('Mot de passe', { exact: true }).fill(provisoireMoussa);
  await app.getByRole('button', { name: 'Se connecter' }).click();
  // Mot de passe provisoire : il faut en choisir un à soi avant d'entrer.
  await app.getByRole('heading', { name: 'Choisissez votre mot de passe' }).waitFor();
  await app.getByLabel('Nouveau mot de passe', { exact: true }).fill('moussa-poules');
  await app.getByLabel('Confirmez le nouveau mot de passe').fill('moussa-poules');
  await app.getByRole('button', { name: 'Enregistrer et continuer' }).click();
  // Le téléphone était celui d'admin : l'écran explique simplement ce qui va se passer.
  await app.getByRole('heading', { name: /Ce téléphone était utilisé par admin/ }).waitFor();
  await app.getByText(/Elles restent en sécurité sur le serveur/).waitFor();
  await app.getByText(/un téléphone par personne/).waitFor();
  if (process.env.CAPTURES) await page.screenshot({ path: `${process.env.CAPTURES}/autre.png`, fullPage: true });
  await app.getByRole('button', { name: 'Continuer avec mon compte' }).click();
  // Les données de la personne précédente ont disparu.
  await app.getByRole('heading', { name: 'Tableau de bord' }).waitFor();
  assert.doesNotMatch(await app.locator('body').innerText(), /Brahma|Soie/);
  await app.getByRole('button', { name: 'Verrouiller l’application' }).click();
  await app.getByLabel('Votre mot de passe').fill('moussa-poules');
  await app.getByRole('button', { name: 'Déverrouiller' }).click();
  await app.getByRole('heading', { name: 'Tableau de bord' }).waitFor();

  assert.deepEqual(erreurs, []);
  console.log('E2E APERÇU OK : connexion par identifiant et mot de passe, mot de passe provisoire à 6 chiffres à changer, mot de passe redemandé après 10 minutes, gestion des utilisateurs');
} catch (e) {
  await page.screenshot({ path: new URL('./echec-apercu.png', import.meta.url).pathname }).catch(() => {});
  console.error(e);
  process.exitCode = 1;
} finally {
  await Promise.race([navigateur.close(), new Promise((r) => setTimeout(r, 5000))]);
  process.exit(process.exitCode ?? 0);
}
