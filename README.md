# Digitalab

Système de gestion d'élevage, simple et adaptatif, destiné aux éleveurs du Sénégal puis de l'Afrique de l'Ouest. Volailles d'abord (poules de toutes races, cailles), puis ovins, caprins et bovins.

Promesse : un carnet de santé pour chaque animal ou groupe, que le vendeur peut partager avec un acheteur.

## État du projet

Phase de cadrage terminée. Phase 1 (« Socle ») : l'application fonctionne déjà seule sur un appareil, sans connexion.

Déjà disponible : tableau de bord complet sur l'accueil (cheptel par espèce, race et âge, occupation de chaque bâtiment et cage, production, couveuse, santé, finances), zone de quarantaine pour les nouveaux arrivants avec fiche et journal d'observation, finances simples mais complètes (dépenses et recettes en FCFA ; factures détaillées numérotées avec lignes, remise et acompte, reçus de paiement, logo de l'élevage, imprimables en PDF et envoyables par WhatsApp ; règlements partiels par espèces, Wave, Orange Money, virement ou chèque ; dates limites et retards ; carnet de clients et fournisseurs avec relance WhatsApp ; salaires, avances et primes par employé avec récapitulatif de paie ; trésorerie : soldes de la caisse, de Wave, d'Orange Money et de la banque calculés à partir des règlements, transferts d'un compte à l'autre avec frais, comptage avec détection des écarts ; résultat du mois et par lot ; export CSV pour le comptable), menu en barre latérale sur grand écran, santé (symptômes et pistes à vérifier, traitements avec délais d'attente, vaccins selon un calendrier modifiable, quarantaine, remèdes essayés), fiche de suivi partageable avec un acheteur, couveuse (calendrier de mirage, arrêt du retournement, transfert vers l'éclosoir et éclosion avec avertissements, contrôle de la place, lot de poussins créé à l'éclosion, taux de fertilité et d'éclosion), lots et effectifs (déduits d'un journal de mouvements), locaux, ponte, aliment et stock, décès, ventes et réformes, annulation de toute saisie, alertes à quatre niveaux (densité, mortalité, chute de ponte, stock d'aliment, étapes d'incubation, vaccins, délais d'attente, symptômes graves, foyer possible), seuils réglables, sauvegarde et restauration, installation sur téléphone (PWA).

Comptes et droits : connexion par identifiant et mot de passe, élevage partagé entre plusieurs téléphones. Chaque client reçoit un lien de connexion, un identifiant et un mot de passe provisoire ; il n'y a que ces deux cases à remplir. L'administrateur (Réglages › Gestion des utilisateurs) ajoute chaque personne avec son nom et son prénom (l'identifiant `nom.prénom` est proposé, il peut en choisir un plus court) ; elle reçoit un mot de passe provisoire de 6 chiffres propre à elle, montré une seule fois, valable 5 jours, à remplacer dès sa première connexion par un mot de passe qu'elle seule connaît (6 caractères au moins). L'administrateur ne voit jamais un mot de passe : si quelqu'un l'oublie, il en génère un nouveau (action notée dans le journal). Les mots de passe sont gardés sous forme d'empreinte irréversible (scrypt), avec blocage de 15 minutes après 5 échecs. Le téléphone n'est plus qu'une information de contact facultative. L'administrateur choisit aussi, pour chaque personne, sa fonction (« Responsable bâtiment A »), un profil de départ (gérant, soigneur, caissier, vétérinaire, lecteur) et une liste de fonctions à cocher module par module (saisie, cheptel, couveuse, santé, quarantaine, finances, salaires, administration), avec une case « tout cocher » par module et la possibilité de réserver des bâtiments. Le serveur applique ces droits : ce qu'une personne n'a pas le droit de voir (finances, salaires, bâtiments qui ne sont pas les siens) ne lui est même pas envoyé, et ses saisies hors de son périmètre sont refusées. Quand l'appareil est relié à un compte, l'application redemande le mot de passe après 10 minutes sans utilisation, même sans réseau ; ce délai se règle dans Réglages › Session et sécurité. Un journal d'activité écrit par le serveur note qui a ajouté, modifié, annulé ou validé quoi, et quand (Réglages › Journal d'activité). Les dépenses et paiements saisis sans droit de validation attendent un responsable. L'application reste utilisable sans réseau ; tout est envoyé quand la connexion revient. Le serveur est facultatif : sans lui, tout fonctionne sur l'appareil.

À venir : connexion par code QR, code à 4 chiffres sur un téléphone autorisé, double authentification (Google Authenticator), notifications quand l'application est fermée, offre hébergée et abonnements. Les phases suivantes sont décrites dans la feuille de route.

| Élément | Emplacement |
| --- | --- |
| Application (React, PWA, base locale IndexedDB) | [apps/web](apps/web) |
| Serveur (comptes, équipe, synchronisation ; Fastify + PostgreSQL) | [apps/api](apps/api) |
| Logique métier testée (effectifs, alertes, règles de synchronisation) | [packages/core](packages/core) |
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

## Lancer le serveur (facultatif)

Il faut un PostgreSQL (version 14 ou plus) et une base vide.

```sh
export DATABASE_URL=postgres://utilisateur:motdepasse@localhost:5432/digitalab
npm run api                         # http://localhost:8080 ; les tables sont créées au démarrage
```

Lancez d'abord `npm run build` : le serveur distribue alors l'application à sa propre adresse. **Ce lien est le lien de connexion du client** (affiché dans la console, par exemple `http://192.168.1.20:8080`) : l'ouvrir sur un téléphone affiche l'application, sans adresse à taper. Pour une installation locale, fixez l'adresse de l'ordinateur du serveur dans la box Wi‑Fi, sinon elle peut changer. Réglages facultatifs : `DIGITALAB_WEB` (autre dossier de l'application), `DIGITALAB_ORIGINES` (adresses autorisées à appeler le serveur depuis un autre site, séparées par des virgules), `DIGITALAB_DERRIERE_PROXY=1` (seulement si le serveur est derrière un relais https de confiance, chez l'hébergeur : l'adresse du téléphone est alors lue dans `X-Forwarded-For`, ce qui garde le blocage après 5 essais propre à chaque téléphone). La construction prépare aussi des versions compressées des fichiers, que le serveur envoie aux téléphones : environ trois fois moins à télécharger.

**Premier démarrage.** Le serveur crée le compte `admin` et affiche dans sa console un mot de passe provisoire de 6 chiffres. La personne qui installe le remet au propriétaire avec le lien. À sa première connexion, le propriétaire choisit son propre mot de passe (6 caractères au moins). Il n'existe aucun mot de passe connu d'avance.

**Commandes de l'installateur** (sur l'ordinateur du serveur) :

```sh
npm run admin -- reinitialiser admin                                   # le propriétaire a oublié son mot de passe : nouveau mot de passe provisoire
npm run admin -- creer-elevage sow.aminata "Ferme Sow" "Aminata Sow"   # un autre élevage sur le même serveur, avec son propriétaire
```

**Mot de passe perdu.** Un employé : l'administrateur lui génère un nouveau mot de passe provisoire (Réglages › Gestion des utilisateurs). Le propriétaire : la personne qui a installé l'application lance `npm run admin -- reinitialiser admin`.

**À savoir pour le déploiement.** Avec un lien en `http://` sur le réseau local, l'application marche sur le Wi‑Fi de la ferme, mais le téléphone refuse de l'installer et de la rouvrir sans réseau (il exige une adresse sécurisée `https://`), et le mot de passe circule en clair sur le Wi‑Fi. Le vrai déploiement doit donc passer en `https://` (simple avec l'offre hébergée).

## Aperçu en une page

```sh
npm run apercu     # fabrique apps/web/dist-apercu/apercu.html, toute l'application dans un seul fichier
```

Cette version n'a pas de service worker (donc pas de mode hors ligne) : elle sert à montrer l'application dans un visualiseur. Le serveur y est simulé dans la page, pour pouvoir essayer la connexion et la gestion des utilisateurs (compte de démonstration : identifiant `admin`, mot de passe provisoire `123456`) ; rien n'est gardé après un rechargement.

## Vérifications

```sh
npm run typecheck   # types
npm test            # tests unitaires (noyau, données locales, serveur si TEST_DATABASE_URL est défini)
npm run build       # construction de production
npm run e2e         # parcours complet dans Chromium, dont rechargement hors connexion (après build)
npm run e2e:synchro # deux appareils et un vrai serveur (après build ; TEST_DATABASE_URL requis)
npm run e2e:apercu  # l'aperçu en une page, dans une fenêtre intégrée comme celle d'un visualiseur
```

`npm run e2e` utilise Chromium (variable `CHROMIUM_PATH`, par défaut `/opt/pw-browsers/chromium`).

## Choix techniques

- Les effectifs ne sont jamais saisis à la main : ils se déduisent du journal de mouvements ; toute saisie s'annule par suppression logique.
- Le moteur d'alertes (`packages/core`) ne renvoie que des codes et des chiffres ; les phrases sont dans `apps/web/src/i18n`, ce qui prépare d'autres langues.
- Synchronisation : chaque fiche porte l'instant de sa dernière modification et la plus récente l'emporte ; les suppressions sont logiques, donc elles voyagent aussi. Les horloges des téléphones doivent être à l'heure (réglage automatique).
- Les seuils d'alerte et de place par animal sont des valeurs de départ, à valider avec un vétérinaire.
