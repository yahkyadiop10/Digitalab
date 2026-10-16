-- Digitalab : comptes, organisations et enregistrements synchronisés.

CREATE TABLE utilisateurs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telephone  text NOT NULL UNIQUE,
  nom        text,
  cree_le    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organisations (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nom      text NOT NULL,
  cree_le  timestamptz NOT NULL DEFAULT now()
);

-- Une ligne par personne invitée ou présente : `utilisateur_id` se remplit à sa première connexion.
CREATE TABLE membres (
  organisation_id  uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  telephone        text NOT NULL,
  utilisateur_id   uuid REFERENCES utilisateurs(id) ON DELETE SET NULL,
  role             text NOT NULL CHECK (role IN ('proprietaire','soigneur','veterinaire','lecteur')),
  invite_par       uuid REFERENCES utilisateurs(id) ON DELETE SET NULL,
  cree_le          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organisation_id, telephone)
);
CREATE INDEX membres_telephone ON membres (telephone);
CREATE INDEX membres_utilisateur ON membres (utilisateur_id);

-- Code à usage unique envoyé par SMS : on ne garde que son empreinte.
CREATE TABLE codes_connexion (
  telephone  text PRIMARY KEY,
  code_hash  text NOT NULL,
  expire_le  timestamptz NOT NULL,
  essais     int NOT NULL DEFAULT 0,
  cree_le    timestamptz NOT NULL DEFAULT now()
);

-- Jeton de session : on ne garde que son empreinte.
CREATE TABLE sessions (
  jeton_hash      text PRIMARY KEY,
  utilisateur_id  uuid NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  appareil        text,
  expire_le       timestamptz NOT NULL,
  cree_le         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_utilisateur ON sessions (utilisateur_id);

CREATE SEQUENCE enregistrements_seq;

-- Tous les enregistrements de l'élevage, tous types confondus. `seq` croît à chaque écriture : les appareils
-- redemandent « tout ce qui a changé depuis tel numéro ». Rien n'est effacé : `supprime_le` marque une suppression logique.
CREATE TABLE enregistrements (
  organisation_id  uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  table_nom        text NOT NULL,
  id               text NOT NULL,
  donnees          jsonb NOT NULL,
  mis_a_jour       bigint NOT NULL,
  supprime_le      bigint,
  seq              bigint NOT NULL DEFAULT nextval('enregistrements_seq'),
  PRIMARY KEY (organisation_id, table_nom, id)
);
CREATE INDEX enregistrements_seq_idx ON enregistrements (organisation_id, seq);
