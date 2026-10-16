# Digitalab — consignes pour Claude

Digitalab crée des sites, des applications et des outils. Le projet attend trois choses de chaque livraison :
un design moderne et fidèle à la charte graphique, une sécurité à l'état de l'art, et une vérification
approfondie avant toute remise. Réponds en français.

## Méthode de travail (obligatoire, dans cet ordre)

1. **Cadrer** — reformuler le besoin, la cible (site, app, outil), les écrans, les données manipulées.
   Si un point bloque une décision, poser la question avant d'écrire du code.
2. **Inventorier les outils** — avant chaque tâche, consulter les skills, agents, plugins et serveurs MCP
   réellement disponibles dans la session (ils varient d'une session à l'autre) et retenir les plus
   adaptés. Voir « Choix des outils » plus bas. Dire en une ligne lesquels sont retenus et pourquoi.
3. **Comparer les options** — pour toute décision technique structurante (framework, hébergement,
   authentification, base de données, bibliothèque UI, stockage des secrets), étudier au moins deux
   options sur : sécurité, maintenance, performances, accessibilité, coût. Vérifier la documentation
   à jour (`ecc:documentation-lookup`, `ecc:search-first`) plutôt que la mémoire.
   Choisir la meilleure, puis consigner la décision dans `docs/decisions/` (une ADR par décision).
4. **Planifier** — découper en étapes vérifiables (`ecc:plan` ou `ecc:blueprint`).
5. **Implémenter** — tests d'abord quand c'est pertinent (`ecc:tdd-workflow`), petits commits clairs.
6. **Re-vérifier en profondeur avant de livrer** — voir « Porte de livraison ». Aucune livraison
   sans que chaque point soit coché ou explicitement justifié.
7. **Livrer** — résumer ce qui a été fait, les choix retenus, les résultats des vérifications
   et ce qui reste à tester sur un appareil réel.

## Design

- **Charte graphique** : la source de vérité est `docs/charte-graphique.md` (couleurs, typographies,
  logo, espacements, ton). Si elle n'existe pas encore, la demander avant tout travail visuel ;
  ne jamais inventer une identité de marque sans validation.
- **Design tokens** : traduire la charte en tokens (format W3C Design Tokens) puis en variables CSS.
  Aucune couleur, taille ou police codée en dur dans les composants.
- **Techniques modernes à privilégier** : couleurs en `oklch()`, typographie fluide avec `clamp()`,
  polices variables, container queries, `:has()`, cascade layers (`@layer`), propriétés logiques,
  View Transitions, animations pilotées par le scroll, thème clair/sombre (`prefers-color-scheme`).
- **Responsive** : conception mobile d'abord. Contrôler au minimum à 360, 768, 1280 et 1920 px,
  sans défilement horizontal. Images responsives (`srcset`, AVIF/WebP, dimensions explicites).
- **Accessibilité** : WCAG 2.2 niveau AA au minimum — contrastes, navigation clavier, focus visible,
  libellés ARIA corrects, textes alternatifs, `prefers-reduced-motion` respecté.
- **Performance** : Core Web Vitals au vert (LCP < 2,5 s, INP < 200 ms, CLS < 0,1).
- **SEO** : balises meta, données structurées, sitemap, robots.txt, HTML sémantique.

## Sécurité

Référentiels : OWASP Top 10 (dernière édition), OWASP ASVS, recommandations ANSSI, RGPD.

- **Secrets** : jamais dans le code ni dans git. Variables d'environnement ou gestionnaire de secrets ;
  fournir un `.env.example` sans valeurs réelles. Jamais de secret dans les logs.
- **Entrées** : valider côté serveur avec un schéma (ex. Zod), requêtes paramétrées uniquement,
  encodage des sorties, protection contre XSS, CSRF, SSRF et injections.
- **En-têtes HTTP** : CSP stricte (nonces, pas d'`unsafe-inline`), HSTS, `X-Content-Type-Options`,
  `Referrer-Policy`, `Permissions-Policy`, COOP/CORP ; Trusted Types quand c'est possible.
- **Authentification** : passkeys/WebAuthn ou fournisseur éprouvé ; mots de passe hachés en Argon2id ;
  MFA proposée ; cookies `Secure`, `HttpOnly`, `SameSite` ; limitation de débit sur les points sensibles.
- **Autorisations** : moindre privilège, contrôle d'accès vérifié côté serveur sur chaque route.
- **Dépendances** : versions épinglées, lockfile commité, audit (`npm audit` / `osv-scanner`) avant
  livraison, pas de paquet récent ou peu maintenu sans justification. Se méfier des typosquats.
- **Données personnelles** : minimisation, consentement aux cookies, durée de conservation définie.

## Porte de livraison (re-vérification profonde)

Avant toute remise, exécuter et rapporter les résultats réels (jamais supposés) :

- [ ] Tests unitaires et d'intégration passent ; tests E2E des parcours critiques (`ecc:e2e-testing`).
- [ ] Lint, formatage et typage sans erreur.
- [ ] Revue de sécurité du diff (`security-review`, `ecc:security-review`, agent `ecc:security-reviewer`) ;
      scan complet (`claude-security:scan`) avant une mise en production.
- [ ] Audit des dépendances sans vulnérabilité haute ou critique.
- [ ] Accessibilité vérifiée (`ecc:accessibility` / `design:accessibility-review`).
- [ ] Lighthouse : performance, accessibilité, bonnes pratiques et SEO ≥ 90.
- [ ] Captures responsives aux quatre largeurs, thèmes clair et sombre.
- [ ] Conformité à la charte graphique contrôlée.
- [ ] Relecture du code dans un contexte neuf (`code-review` ou agent `ecc:code-reviewer`).
- [ ] Boucle finale `ecc:verification-loop` / `ecc:quality-gate`.

Si un point ne peut pas être vérifié dans l'environnement, le dire clairement et indiquer comment
le vérifier.

## Choix des outils

Chercher d'abord dans la liste disponible de la session ; à défaut, ceux-ci sont recommandés :

| Besoin | Skills / agents |
| --- | --- |
| Direction artistique, UI | `ecc:frontend-design-direction`, `design-superpowers:design`, `ecc:make-interfaces-feel-better` |
| Design system, tokens | `ecc:design-system`, `design:design-system`, `design-drift:lock` |
| Maquettes Figma / Canva | `figma:figma-design-to-code`, `figma:figma-use`, `canva:brand-check` |
| Animations | `ecc:motion-foundations`, `ecc:motion-patterns` |
| Frameworks | `ecc:nextjs-turbopack`, `ecc:react-patterns`, `ecc:vue-patterns`, `ecc:vite-patterns` |
| Backend, API, BDD | `ecc:backend-patterns`, `ecc:api-design`, `ecc:postgres-patterns`, `ecc:database-migrations` |
| Sécurité | `security-review`, `ecc:security-review`, `ecc:security-scan`, `claude-security:scan` |
| Tests | `ecc:tdd-workflow`, `ecc:e2e-testing`, `ecc:browser-qa` |
| Performance, audit navigateur | outils MCP `chrome-devtools` (Lighthouse, traces), `ecc:react-performance` |
| SEO | `searchfit-seo:technical-seo`, `ecc:seo` |
| Décisions | `ecc:architecture-decision-records` |

## Organisation des fichiers

- `CLAUDE.md` — ces consignes (règles, pas d'informations de projet détaillées).
- `docs/charte-graphique.md` — identité visuelle.
- `docs/decisions/` — une ADR par choix technique.
- `README.md` — présentation du projet, installation, commandes.

Chaque information vit dans un seul fichier ; les autres y renvoient.
