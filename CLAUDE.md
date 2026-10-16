# AviMaster (dépôt Digitalab)

Application de gestion d'élevage (volailles d'abord), éditée par AYA BUSINESS. Hors ligne d'abord (PWA), pour des utilisateurs peu familiers du numérique : textes simples, en français.

Ce que fait l'application et comment la lancer : [README.md](README.md). Cahier des charges : [docs/cahier-des-charges.md](docs/cahier-des-charges.md).

## Organisation

- `packages/core` : règles métier pures (TypeScript), sans accès réseau ni stockage.
- `apps/web` : application React + Dexie (IndexedDB) ; `serveur-demo.ts` simule le serveur dans l'aperçu en une page.
- `apps/api` : serveur Fastify + PostgreSQL ; migrations SQL numérotées dans `apps/api/migrations/`. Il distribue aussi l'application construite (`apps/web/dist`) : son adresse est le lien de connexion du client. Commandes de l'installateur : `npm run admin -- reinitialiser <identifiant>` et `npm run admin -- creer-elevage …`.

## Accès (décidé avec le client)

Un lien, un identifiant, un mot de passe donné par l'administrateur (provisoire de 6 chiffres, à changer à la première connexion). Le mot de passe est redemandé après 10 minutes d'inactivité. Pas de code à chiffres séparé, pas de codes de secours : garder ce parcours simple. QR code, code à 4 chiffres et double authentification sont prévus plus tard (`docs/cahier-des-charges.md`, feuille de route).

## Vérifications avant d'envoyer

```sh
npm run typecheck && npm test        # TEST_DATABASE_URL requis pour les tests du serveur
npm run build && npm run e2e         # parcours hors ligne
npm run e2e:synchro                  # deux appareils, vrai serveur (TEST_DATABASE_URL)
npm run e2e:apercu                   # aperçu en une page dans une fenêtre intégrée
```

## Conventions

- Code, noms et textes en français, comme le code existant.
- Tout droit est vérifié par le serveur ; l'application ne fait que masquer ce qui n'est pas permis.
- Les règles partagées par le serveur et l'application vont dans `packages/core`.
