# Digitalab

Système de gestion d'élevage, simple et adaptatif, destiné aux éleveurs du Sénégal puis de l'Afrique de l'Ouest. Volailles d'abord (poules de toutes races, cailles), puis ovins, caprins et bovins.

Promesse : un carnet de santé pour chaque animal ou groupe, que le vendeur peut partager avec un acheteur.

## État du projet

Phase de cadrage terminée, phase 1 (« Socle ») en démarrage.

| Élément | Fichier |
| --- | --- |
| Cahier des charges (synthèse) | [docs/cahier-des-charges.md](docs/cahier-des-charges.md) |
| Modèle de données du noyau (PostgreSQL) | [docs/modele-de-donnees.sql](docs/modele-de-donnees.sql) |
| Prototype cliquable de la phase 1 | [prototype/index.html](prototype/index.html) |

## Essayer le prototype

Ouvrez `prototype/index.html` dans un navigateur (de préférence sur téléphone), ou lancez un serveur local :

```sh
npx serve prototype
```

Les données sont fictives et restent sur l'appareil. Les seuils d'alerte sont des exemples à valider avec un vétérinaire.
