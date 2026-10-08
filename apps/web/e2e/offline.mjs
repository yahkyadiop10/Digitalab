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

  // 9. Finances simples : une recette à encaisser, une dépense, le résultat du mois
  etape(9);
  await page.getByRole('navigation').getByRole('link', { name: /Saisie/ }).click();
  await page.getByRole('link', { name: /Recette/ }).click();
  await page.getByLabel('Montant (FCFA)').fill('45000');
  await page.getByLabel('Client (facultatif)').fill('M. Diop');
  await page.getByLabel('Pas encore encaissé').check();
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await page.getByText('Recette notée').waitFor();
  await page.getByRole('navigation').getByRole('link', { name: /Saisie/ }).click();
  await page.getByRole('link', { name: /Dépense/ }).click();
  await page.getByLabel('Montant (FCFA)').fill('12000');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await page.getByText('Résultat du mois').waitFor();
  assert.match(await texte(), /Résultat du mois : \+\s33\s000\sFCFA/);
  assert.match(await texte(), /On vous doit 45\s000\sFCFA/);
  await page.getByRole('link', { name: 'Enregistrer un encaissement' }).click();
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await page.getByText('Encaissement noté').waitFor();
  await page.getByText('Soldé ✓').waitFor();
  await page.getByRole('link', { name: /Retour/ }).click();
  await page.getByText('Résultat du mois').waitFor();
  assert.doesNotMatch(await texte(), /On vous doit/);

  // 9b. Facture détaillée avec remise et acompte, facture imprimable, puis salaires et avance
  etape('9b');
  await page.getByRole('link', { name: /Recette/ }).click();
  await page.getByRole('button', { name: /Faire une facture détaillée/ }).click();
  await page.getByLabel('Article 1').fill('Plateaux d’œufs');
  await page.getByLabel('Quantité').nth(0).fill('10');
  await page.getByLabel('Prix unitaire (FCFA)').nth(0).fill('2500');
  await page.getByRole('button', { name: '+ Ajouter une ligne' }).click();
  await page.getByLabel('Article 2').fill('Poulets');
  await page.getByLabel('Quantité').nth(1).fill('2');
  await page.getByLabel('Prix unitaire (FCFA)').nth(1).fill('3000');
  await page.getByLabel('Remise (FCFA, facultatif)').fill('1000');
  assert.match(await texte(), /Total\s+30\s000\sFCFA/);
  await page.getByLabel('Client (facultatif)').fill('Boutique Awa');
  await page.getByLabel('Un acompte reçu').check();
  await page.getByLabel('Montant de l’acompte (FCFA)').fill('10000');
  await page.getByLabel('Moyen de paiement').selectOption({ label: 'Wave' });
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await page.getByRole('heading', { name: /Facture F-\d{4}-0001/ }).waitFor();
  assert.match(await texte(), /Reste\s+20\s000\sFCFA/);
  assert.match(await texte(), /Wave/);
  await page.getByRole('link', { name: 'Voir et imprimer la facture' }).click();
  await page.getByRole('heading', { name: 'FACTURE' }).waitFor();
  const facture = await page.locator('.document').innerText();
  assert.match(facture, /Boutique Awa/);
  assert.match(facture, /Reste à payer\s+20\s000\sFCFA/);
  await page.getByRole('banner').getByRole('link', { name: 'Finances' }).click();
  await page.getByRole('link', { name: /Salaires/ }).click();
  await page.getByRole('link', { name: '+ Ajouter un employé' }).click();
  await page.getByLabel('Nom', { exact: true }).fill('Moussa');
  await page.locator('.nombre input').first().fill('45000');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await page.getByText('Moussa').first().waitFor();
  await page.getByRole('link', { name: 'Avance' }).click();
  await page.locator('.nombre input').first().fill('15000');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await page.getByText('Partiellement versé').waitFor();
  assert.match(await texte(), /reste 30\s000\sFCFA/);
  await page.getByRole('link', { name: 'Bulletin du mois' }).click();
  await page.getByRole('heading', { name: 'RÉCAPITULATIF DE PAIE' }).waitFor();
  assert.match(await page.locator('.document').innerText(), /Avance sur salaire/);
  await page.getByRole('link', { name: /Retour/ }).click();
  await page.getByRole('link', { name: /Retour|Finances/ }).first().click();

  // 10. Zone de quarantaine : arrivée, fiche, note du jour, décision de fin, tableau de bord
  etape(10);
  await page.getByRole('navigation').getByRole('link', { name: /Saisie/ }).click();
  await page.getByRole('link', { name: /Nouvelle arrivée/ }).click();
  await page.getByLabel('Race ou variété (facultatif)').fill('Padoue');
  await page.getByLabel('Nombre d’animaux').fill('6');
  await page.getByLabel('Âge approximatif (facultatif)').fill('8');
  await page.getByLabel('Vendeur ou provenance (facultatif)').fill('M. Sow');
  await page.getByLabel('Alimentation donnée (facultatif)').fill('Aliment ponte');
  await page.getByRole('button', { name: 'Commencer la quarantaine' }).click();
  await page.getByText('Animaux arrivés').waitFor();
  assert.match(await texte(), /Âge à l’arrivée \(environ\)\s*8 semaines/);
  assert.match(await texte(), /Provenance\s*M\. Sow/);
  assert.match(await texte(), /Quarantaine prévue\s*21 jours/);
  await page.getByRole('button', { name: '+ Ajouter une note' }).click();
  await page.getByLabel('Tousse ou éternue').check();
  await page.getByLabel('Poids moyen en grammes (facultatif)').fill('1400');
  await page.getByRole('button', { name: 'Inquiétant' }).click();
  await page.getByRole('button', { name: 'Enregistrer la note' }).click();
  await page.getByText(/Poids moyen : 1400 g/).waitFor();
  await page.getByRole('link', { name: /^Alertes/ }).click();
  await page.getByText(/Quarantaine inquiétante/).waitFor();
  await page.getByRole('navigation').getByRole('link', { name: /Accueil/ }).click();
  await page.getByRole('heading', { name: 'Tableau de bord' }).waitFor();
  const tableau = await page.locator('.tb-grille').innerText();
  assert.match(tableau, /Cheptel/);
  assert.match(tableau, /Bâtiments et cages/);
  assert.match(tableau, /Zone de quarantaine/);
  assert.match(tableau, /Situation financière/);
  assert.match(tableau, /Total des entrées/);
  assert.match(tableau, /Padoue/);
  await page.locator('.tb-grille').getByRole('link', { name: 'Zone de quarantaine' }).click();
  await page.getByRole('heading', { name: 'Zone de quarantaine' }).waitFor();
  await page.locator('a.gros', { hasText: 'Padoue' }).first().click();
  await page.getByRole('heading', { name: 'Fin de la quarantaine' }).waitFor();
  await page.getByRole('button', { name: 'Terminer la quarantaine' }).click();
  await page.getByRole('button', { name: 'Confirmer' }).click();
  await page.getByText(/Les animaux ont rejoint/).waitFor();

  assert.deepEqual(erreurs, []);
  console.log('E2E OK : démarrage, hors ligne, saisie, alerte, annulation, persistance, incubation, santé, fiche partagée, finances, quarantaine, tableau de bord');
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
