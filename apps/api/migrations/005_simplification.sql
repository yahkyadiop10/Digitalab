-- Accès simplifié. La table des codes de secours n'est plus utilisée mais elle est gardée : revenir à la version précédente reste possible.
-- Blocages répétés d'un même identifiant : chaque nouveau blocage dure deux fois plus longtemps (jusqu'à 24 heures).
ALTER TABLE echecs_connexion ADD COLUMN blocages int NOT NULL DEFAULT 0;
