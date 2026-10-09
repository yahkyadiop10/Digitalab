-- Connexion par identifiant et mot de passe créés par l'administrateur (fini le code par SMS).
-- Le téléphone devient une simple information de contact, facultative.

ALTER TABLE utilisateurs DROP CONSTRAINT utilisateurs_telephone_key;
ALTER TABLE utilisateurs ALTER COLUMN telephone DROP NOT NULL;
ALTER TABLE utilisateurs
  ADD COLUMN identifiant              text,
  -- Empreinte irréversible (scrypt) : le mot de passe lui-même n'est jamais gardé.
  ADD COLUMN mot_de_passe_hash        text,
  -- Mot de passe provisoire donné par l'administrateur : à changer dès la première connexion, avant son expiration.
  ADD COLUMN doit_changer             boolean NOT NULL DEFAULT false,
  ADD COLUMN mot_de_passe_expire      timestamptz,
  ADD COLUMN derniere_connexion       timestamptz;
-- Comptes d'avant ce changement : ils n'ont pas de mot de passe et ne peuvent plus se connecter.
UPDATE utilisateurs SET identifiant = 'ancien-' || substr(id::text, 1, 8);
ALTER TABLE utilisateurs ALTER COLUMN identifiant SET NOT NULL;
ALTER TABLE utilisateurs ADD CONSTRAINT utilisateurs_identifiant_key UNIQUE (identifiant);

-- Une personne est ajoutée directement avec son compte : plus d'invitation en attente.
DELETE FROM membres WHERE utilisateur_id IS NULL;
ALTER TABLE membres DROP CONSTRAINT membres_pkey;
ALTER TABLE membres DROP CONSTRAINT membres_utilisateur_id_fkey;
ALTER TABLE membres ADD CONSTRAINT membres_utilisateur_id_fkey FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs(id) ON DELETE CASCADE;
ALTER TABLE membres ALTER COLUMN utilisateur_id SET NOT NULL;
ALTER TABLE membres ADD PRIMARY KEY (organisation_id, utilisateur_id);
DROP INDEX membres_telephone;
ALTER TABLE membres
  DROP COLUMN telephone,
  DROP COLUMN nom_affiche,
  DROP COLUMN invitation_hash,
  DROP COLUMN invitation_expire,
  DROP COLUMN invitation_essais;

ALTER TABLE journal RENAME COLUMN telephone TO identifiant;

DROP TABLE codes_connexion;

-- Essais ratés par identifiant (existant ou non, pour ne rien révéler) : blocage de quelques minutes après trop d'échecs.
CREATE TABLE echecs_connexion (
  cle               text PRIMARY KEY,
  essais            int NOT NULL DEFAULT 0,
  verrouille_jusqua timestamptz,
  dernier_le        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX echecs_connexion_dernier ON echecs_connexion (dernier_le);

-- Codes de secours du propriétaire, à garder sur papier : chacun ne sert qu'une fois. On ne garde que leur empreinte.
CREATE TABLE codes_secours (
  id              bigserial PRIMARY KEY,
  utilisateur_id  uuid NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  code_hash       text NOT NULL,
  utilise_le      timestamptz,
  cree_le         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX codes_secours_utilisateur ON codes_secours (utilisateur_id);
