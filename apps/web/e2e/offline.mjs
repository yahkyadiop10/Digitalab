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

  // 7. Incubation (toujours hors connexion) : couveuse de 150 œufs, contrôle de la place, éclosion
  etape(7);
  const il_y_a = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  await page.getByRole('navigation').getByRole('link', { name: /Couveuse/ }).click();
  await page.getByLabel('Nom de la couveuse').fill('Ma couveuse');
  await page.getByLabel('Capacité en œufs de poule').fill('150');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await page.getByText('Mes couveuses').waitFor();
  await page.getByRole('link', { name: /Mettre des œufs en incubation/ }).click();
  await page.getByLabel('Nombre d’œufs').fill('100');
  await page.getByRole('button', { name: 'Mettre en incubation' }).click();
  await page.getByRole('heading', { name: 'Calendrier' }).waitFor();
  assert.match(await texte(), /Mirage J7/);
  assert.match(await texte(), /Éclosion J21/);
  await page.getByRole('navigation').getByRole('link', { name: /Couveuse/ }).click();
  await page.getByText(/50 places libres sur 150/).waitFor();
  await page.getByRole('link', { name: /Mettre des œufs en incubation/ }).click();
  await page.getByLabel('Nombre d’œufs').fill('60');
  await page.getByRole('button', { name: 'Mettre en incubation' }).click();
  await page.getByText(/Il ne reste que 50 places/).waitFor();

  // Œufs mis il y a 21 jours : l'éclosion peut être notée et crée un lot de poussins
  await page.getByLabel('Nombre d’œufs').fill('40');
  await page.getByLabel('Date de mise en place').fill(il_y_a(21));
  await page.getByLabel('Nom (facultatif)').fill('Lot ancien');
  await page.getByRole('button', { name: 'Mettre en incubation' }).click();
  await page.getByRole('heading', { name: 'Calendrier' }).waitFor();
  // Les alarmes d'une mise en incubation ancienne : arrêt du retournement automatique et mirage en retard
  await page.getByRole('link', { name: /^Alertes/ }).click();
  await page.getByText(/Arrêt du retournement automatique en retard : Lot ancien/).waitFor();
  assert.match(await texte(), /Mirage en retard : Lot ancien/);
  await page.getByRole('navigation').getByRole('link', { name: /Couveuse/ }).click();
  await page.locator('a.gros', { hasText: 'Lot ancien' }).click();
  await page.getByRole('heading', { name: 'Calendrier' }).waitFor();
  await page.getByText('Noter l’éclosion').first().click();
  await page.getByLabel('Poussins nés vivants').fill('31');
  await page.getByRole('button', { name: 'Enregistrer l’éclosion' }).click();
  await page.getByText(/Issu de l’incubation/).waitFor();
  assert.match(await texte(), /Lot ancien – poussins/);
  assert.match(await texte(), /Animaux\s*31/);

  // 8. Santé : symptômes graves, pistes, traitement avec délai d'attente, fiche de suivi partagée
  etape(8);
  await page.getByRole('navigation').getByRole('link', { name: /Santé/ }).click();
  await page.getByRole('link', { name: /Noter un problème de santé/ }).click();
  await page.getByLabel('Lot concerné').selectOption({ label: 'Mes poules' });
  await page.getByLabel('Diarrhée avec du sang').check();
  await page.getByLabel('Abattu, immobile').check();
  await page.getByRole('button', { name: 'Grave' }).click();
  await page.getByText('Coccidiose').first().waitFor();
  assert.match(await texte(), /pas un diagnostic/);
  await page.getByLabel('Je soupçonne cette maladie').first().check();
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await page.getByRole('heading', { name: 'Traitement ou remède' }).waitFor();
  await page.getByLabel('Produit ou remède').fill('Tisane');
  await page.getByLabel('Délai d’attente après le traitement (jours)').fill('3');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await page.getByText('Œufs et viande à ne pas consommer').first().waitFor();
  await page.getByRole('link', { name: /^Alertes/ }).click();
  await page.getByText(/Symptômes graves : Mes poules/).waitFor();

  await page.getByRole('navigation').getByRole('link', { name: /Cheptel/ }).click();
  await page.getByRole('link', { name: /Mes poules/ }).click();
  await page.getByRole('link', { name: 'Partager la fiche de suivi' }).click();
  await page.getByText('Traitement : Tisane').first().waitFor();
  assert.match(await texte(), /non vérifiées/);
  const lien = await page.getByLabel('Lien de la fiche').inputValue();
  assert.match(lien, /#\/fiche\/[A-Za-z0-9_-]+$/);
  const acheteur = await contexte.newPage();
  await acheteur.goto(lien);
  await acheteur.getByText('Fiche de suivi d’un élevage').waitFor();
  await acheteur.getByText('Traitement : Tisane').waitFor();
  assert.equal(await acheteur.getByRole('navigation').count(), 0);
  assert.doesNotMatch(await acheteur.locator('body').innerText(), /Saisie|Réglages/);
  await acheteur.close();

  assert.deepEqual(erreurs, []);
  console.log('E2E OK : démarrage, hors ligne, saisie, alerte, annulation, persistance, incubation, santé, fiche partagée');
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
