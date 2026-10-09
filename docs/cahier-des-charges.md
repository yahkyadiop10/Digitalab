# Cahier des charges fonctionnel (synthèse)

Statut : validé dans son principe le 6 octobre 2026. Les points ouverts sont listés en fin de document. La version détaillée (benchmark, tableaux, schémas) est tenue dans le document partagé du projet.

## 1. Vision

Produit commercialisable de gestion d'élevage pour le Sénégal puis l'Afrique de l'Ouest. Le premier élevage utilisateur sert de banc d'essai avant commercialisation.

Principes de conception :

- **Simple** : un non-initié comprend chaque écran sans formation.
- **Adaptatif** : de quelques dizaines à plusieurs milliers d'animaux ; modules activables ; mode simple et mode avancé.
- **Multi-espèces par configuration** : volailles d'abord, ruminants ensuite, sans refonte ; suivi par individu ou par groupe selon l'espèce.
- **Hors ligne d'abord** : couverture réseau moyenne près des bâtiments.
- **Données maîtrisées** : l'éleveur reste propriétaire et choisit ce qu'il partage.

## 2. Modules

Priorité : P1 indispensable, P2 important, P3 confort.

| Module | Contenu | Priorité |
| --- | --- | --- |
| M1 Cheptel, lots, généalogie | Lots et individus, bagues et QR codes, parents, mouvements, référentiel de races | P1 |
| M2 Alimentation | Stocks, plans par stade, distribution, consommation, coût | P1 |
| M3 Ponte et œufs | Collecte, états, traçabilité de l'œuf à couver, courbes | P1 |
| M4 Incubation | Couveuses automatiques et manuelles, calendrier, mirage, fertilité, éclosion | P1 |
| M5 Naissances et jeunes | Éclosion, éleveuse, croissance, protocole du jeune | P1 |
| M6 Santé | Symptômes, base de connaissances, traitements, délais d'attente, prophylaxie, quarantaine | P1 |
| M7 Mortalité | Déclaration en quelques secondes, causes, taux, seuils | P1 |
| M8 Population et densité | Effectifs déduits des mouvements, densité, ratio mâles/femelles, prévisions | P1 |
| M9 Gestion financière simple | Dépenses et recettes en deux touches, marge par lot, factures simples, export | P1 |
| M10 Environnement et tâches | Locaux, entretien, tâches du jour, conformité | P2 |
| M11 Fiche de suivi partageable | Carnet de vie, lien ou QR code, rubriques au choix, mention « déclaratif » ou « validé par un vétérinaire » | P1 |
| M12 Adaptation | Assistant de démarrage, modes simple et avancé, référentiel d'espèces paramétrable | P1 |
| M13 Comptes et abonnement | Organisations, rôles, offres, paiement Wave et Orange Money | P1 |

La gestion financière reste volontairement simple : pas de plan comptable ni d'états officiels en première version.

## 3. Alertes

Quatre niveaux de couleur, toujours accompagnés d'un libellé (jamais la couleur seule) : vert (normal), jaune (à surveiller), orange (action aujourd'hui), rouge (urgence).

Les canaux gratuits (alerte dans l'application, notification push, e-mail) sont toujours actifs. SMS, WhatsApp et appel vocal sont des options facturées. Le niveau rouge est toujours notifié gratuitement.

Les seuils par défaut sont des exemples à valider par un vétérinaire et à régler par lot.

## 4. Offres et déploiement

Trois formules d'abonnement en ligne (Démarrer, Éleveur, Professionnel), plus une option d'installation locale, sur le même produit livré en conteneurs. Les prix restent à fixer après enquête auprès d'éleveurs.

## 5. Feuille de route

1. **Socle** : cheptel, aliment, ponte, mortalité, alertes gratuites, mode hors ligne.
2. **Incubation** : couveuse, calendrier, mirage, naissances, suivi des poussins.
3. **Santé** : santé et remèdes, vaccins, population, densité, fiche de suivi partageable.
4. **Gestion** : finances simples, abonnements, multi-espèces, accès vétérinaire, capteurs.

Chaque phase est validée sur le terrain avant la suivante.

## 6. Points ouverts

- Prix des formules et gratuité éventuelle de « Démarrer ».
- Langues : wolof (écrit ou audio) dès la première version ?
- Vétérinaire partenaire pour relire les protocoles et signer les fiches.
- Éleveurs testeurs après le test interne.
- Région et fournisseur d'hébergement ; matériel recommandé pour l'installation locale.
- Nom du produit, structure juridique, propriété du code.
- Marque et modèle de la couveuse de départ.
- Ordre d'ajout des ovins, caprins et bovins.

## 7. Limites

Les fonctions des logiciels existants viennent de leurs descriptifs publics, non testés. Les paramètres d'incubation, densités et seuils d'alerte sont des valeurs de départ à faire valider. La réglementation sénégalaise (santé animale, données personnelles, comptabilité, fiscalité) a été repérée par recherche web et doit être confirmée auprès des services vétérinaires, de la Commission de protection des données personnelles (CDP) et d'un expert-comptable.
