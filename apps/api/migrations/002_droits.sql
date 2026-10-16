-- Droits fins par personne : fonction occupée, droits cochés un par un, zones réservées, code d'invitation.

ALTER TABLE membres DROP CONSTRAINT membres_role_check;
ALTER TABLE membres ADD CONSTRAINT membres_role_check
  CHECK (role IN ('proprietaire','gerant','soigneur','caissier','veterinaire','lecteur','personnalise'));

ALTER TABLE membres
  ADD COLUMN nom_affiche        text,
  ADD COLUMN fonction           text,
  -- NULL : les droits suivent le profil (anciens membres). Sinon : liste explicite.
  ADD COLUMN droits             text[],
  ADD COLUMN zones              text[] NOT NULL DEFAULT '{}',
  ADD COLUMN invitation_hash    text,
  ADD COLUMN invitation_expire  timestamptz,
  ADD COLUMN invitation_essais  int NOT NULL DEFAULT 0;
