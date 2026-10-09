-- Journal d'activité : qui a fait quoi. Les noms sont copiés au moment de l'action : changer le nom d'une personne ne réécrit pas l'historique.

CREATE TABLE journal (
  id               bigserial PRIMARY KEY,
  organisation_id  uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  recu_le          timestamptz NOT NULL DEFAULT now(),
  -- Instant de l'action sur le téléphone (peut précéder de longtemps la réception si la personne travaillait sans réseau).
  fait_le          bigint NOT NULL,
  utilisateur_id   uuid REFERENCES utilisateurs(id) ON DELETE SET NULL,
  telephone        text NOT NULL,
  nom              text,
  fonction         text,
  action           text NOT NULL,
  table_nom        text NOT NULL,
  enregistrement_id text NOT NULL,
  description      text NOT NULL DEFAULT ''
);
CREATE INDEX journal_organisation ON journal (organisation_id, id DESC);
