# Digitalab

Système de gestion d'élevage, simple et adaptatif, destiné aux éleveurs du Sénégal puis de l'Afrique de l'Ouest. Volailles d'abord (poules de toutes races, cailles), puis ovins, caprins et bovins.

Promesse : un carnet de santé pour chaque animal ou groupe, que le vendeur peut partager avec un acheteur.

## État du projet

Phase de cadrage terminée. Phase 1 (« Socle ») : l'application fonctionne déjà seule sur un appareil, sans connexion.

Déjà disponible : santé (symptômes et pistes à vérifier, traitements avec délais d'attente, vaccins selon un calendrier modifiable, quarantaine, remèdes essayés), fiche de suivi partageable avec un acheteur, couveuse (calendrier de mirage, arrêt du retournement, transfert vers l'éclosoir et éclosion avec avertissements, contrôle de la place, lot de poussins créé à l'éclosion, taux de fertilité et d'éclosion), lots et effectifs (déduits d'un journal de mouvements), locaux, ponte, aliment et stock, décès, ventes et réformes, annulation de toute saisie, alertes à quatre niveaux (densité, mortalité, chute de ponte, stock d'aliment, étapes d'incubation, vaccins, délais d'attente, symptômes graves, foyer possible), seuils réglables, sauvegarde et restauration, installation sur téléphone (PWA).

À venir dans la phase 1 : comptes et synchronisation entre appareils (aides, vétérinaire), notifications push et e-mail. Les phases suivantes sont décrites dans la feuille de route.

| Élément | Emplacement |
| --- | --- |
| Application (React, PWA, base locale IndexedDB) | [apps/web](apps/web) |
| Logique métier testée (effectifs, alertes) | [packages/core](packages/core) |
| Cahier des charges (synthèse) | [docs/cahier-des-charges.md](docs/cahier-des-charges.md) |
| Modèle de données du futur serveur (PostgreSQL) | [docs/modele-de-donnees.sql](docs/modele-de-donnees.sql) |
| Premier prototype cliquable | [prototype/index.html](prototype/index.html) |

## Lancer l'application

Prérequis : Node 20 ou plus.

```sh
npm install
npm run dev        # http://localhost:5173
```

Sur l'écran d'accueil, « Essayer avec des données d'exemple » remplit un petit élevage.

Pour l'essayer sur un téléphone avec le mode hors ligne, construisez puis servez la version de production (le service worker n'est actif qu'en production) :

```sh
npm run build
npm run preview -- --host
```

## Aperçu en une page

```sh
npm run apercu     # fabrique apps/web/dist-apercu/apercu.html, toute l'application dans un seul fichier
```

Cette version n'a pas de service worker (donc pas de mode hors ligne) : elle sert à montrer l'application dans un visualiseur.

## Vérifications

```sh
npm run typecheck   # types
npm test            # tests unitaires (noyau et données locales)
npm run build       # construction de production
npm run e2e         # parcours complet dans Chromium, dont rechargement hors connexion (après build)
```

`npm run e2e` utilise Chromium (variable `CHROMIUM_PATH`, par défaut `/opt/pw-browsers/chromium`).

## Choix techniques

- Les effectifs ne sont jamais saisis à la main : ils se déduisent du journal de mouvements ; toute saisie s'annule par suppression logique.
- Le moteur d'alertes (`packages/core`) ne renvoie que des codes et des chiffres ; les phrases sont dans `apps/web/src/i18n`, ce qui prépare d'autres langues.
- Les seuils d'alerte et de place par animal sont des valeurs de départ, à valider avec un vétérinaire.
