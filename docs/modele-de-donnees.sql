-- Digitalab : modèle de données du noyau (phases 1 et 2), PostgreSQL.
-- Principes (cahier des charges, section 8) :
--   * les effectifs ne sont jamais saisis à la main : ils se déduisent du journal de mouvements ;
--   * espèces, races, protocoles et seuils sont des données, pas du code ;
--   * multi-organisation : chaque table métier porte organisation_id ;
--   * l'historique sanitaire et de mortalité n'est jamais supprimé (suppression logique + audit).

CREATE TABLE organisation (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nom           text NOT NULL,
  devise        char(3) NOT NULL DEFAULT 'XOF',
  cree_le       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE utilisateur (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisation(id),
  nom              text NOT NULL,
  telephone        text UNIQUE,
  email            text UNIQUE,
  role             text NOT NULL CHECK (role IN ('proprietaire','soigneur','veterinaire','lecteur')),
  CHECK (telephone IS NOT NULL OR email IS NOT NULL)
);

-- Référentiels paramétrables ---------------------------------------------------
CREATE TABLE espece (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid REFERENCES organisation(id),       -- NULL = référentiel commun
  nom             text NOT NULL,                           -- poule, caille, ovin...
  suivi_defaut    text NOT NULL CHECK (suivi_defaut IN ('groupe','individu')),
  incubation_jours int,                                    -- 21 poule, 17-18 caille japonaise (valeurs de départ)
  m2_par_animal   numeric(8,4),                            -- seuil de densité de départ, modifiable
  parametres      jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE race (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  espece_id  uuid NOT NULL REFERENCES espece(id),
  nom        text NOT NULL,
  UNIQUE (espece_id, nom)
);

-- Locaux ------------------------------------------------------------------------
CREATE TABLE logement (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisation(id),
  parent_id       uuid REFERENCES logement(id),            -- bâtiment > cage / volière
  nom             text NOT NULL,
  type            text NOT NULL,                           -- batiment, cage, voliere, parc
  surface_m2      numeric(10,3)
);

-- Cheptel : un lot (groupe) ou un individu -------------------------------------
CREATE TABLE lot (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisation(id),
  espece_id       uuid NOT NULL REFERENCES espece(id),
  race_id         uuid REFERENCES race(id),
  nom             text NOT NULL,
  individuel      boolean NOT NULL DEFAULT false,          -- true = un seul animal (bague)
  bague           text,
  naissance       date,
  mere_id         uuid REFERENCES lot(id),                 -- généalogie
  pere_id         uuid REFERENCES lot(id),
  statut          text NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif','vendu','reforme','mort')),
  cree_le         timestamptz NOT NULL DEFAULT now()
);

-- Journal de mouvements : source de vérité des effectifs
CREATE TABLE mouvement (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisation(id),
  lot_id          uuid NOT NULL REFERENCES lot(id),
  logement_id     uuid REFERENCES logement(id),
  date            date NOT NULL,
  type            text NOT NULL CHECK (type IN ('naissance','arrivee','transfert_entree','transfert_sortie','vente','deces','reforme','correction')),
  quantite        int NOT NULL CHECK (quantite <> 0),      -- signée : entrées > 0, sorties < 0
  cause           text,
  saisi_par       uuid REFERENCES utilisateur(id),
  cree_le         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON mouvement (lot_id, date);

CREATE VIEW effectif_lot AS
  SELECT lot_id, SUM(quantite)::int AS effectif FROM mouvement GROUP BY lot_id;

-- Production et alimentation -----------------------------------------------------
CREATE TABLE ponte (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id      uuid NOT NULL REFERENCES lot(id),
  date        date NOT NULL,
  nombre      int NOT NULL CHECK (nombre >= 0),
  casses      int NOT NULL DEFAULT 0,
  destination text,                                        -- consommation, vente, incubation
  UNIQUE (lot_id, date)
);

CREATE TABLE aliment (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisation(id),
  nom             text NOT NULL,
  prix_kg         numeric(12,2),                           -- FCFA
  stock_kg        numeric(12,2) NOT NULL DEFAULT 0
);

CREATE TABLE distribution (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id      uuid NOT NULL REFERENCES lot(id),
  aliment_id  uuid NOT NULL REFERENCES aliment(id),
  date        date NOT NULL,
  quantite_kg numeric(10,2) NOT NULL CHECK (quantite_kg >= 0)
);

-- Santé : événements, jamais supprimés ---------------------------------------------
CREATE TABLE evenement_sante (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id          uuid NOT NULL REFERENCES lot(id),
  type            text NOT NULL CHECK (type IN ('vaccin','traitement','observation','quarantaine','autopsie')),
  date            date NOT NULL,
  echeance        date,                                    -- rappel
  fait_le         date,
  produit         text,
  dose            text,
  symptomes       text[],
  delai_attente_jours int,                                 -- bloque la vente des œufs ou de la viande
  resultat        text,
  valide_par      uuid REFERENCES utilisateur(id),         -- vétérinaire
  supprime_le     timestamptz                              -- suppression logique
);

-- Alertes ------------------------------------------------------------------------------
CREATE TABLE regle_alerte (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid REFERENCES organisation(id),        -- NULL = règle par défaut
  code            text NOT NULL,                           -- densite, mortalite_24h, chute_ponte, vaccin, stock_aliment
  niveau          text NOT NULL CHECK (niveau IN ('jaune','orange','rouge')),
  seuil           numeric NOT NULL,
  actif           boolean NOT NULL DEFAULT true
);

CREATE TABLE alerte (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisation(id),
  regle_id        uuid REFERENCES regle_alerte(id),
  lot_id          uuid REFERENCES lot(id),
  niveau          text NOT NULL CHECK (niveau IN ('jaune','orange','rouge')),
  titre           text NOT NULL,
  detail          text,
  statut          text NOT NULL DEFAULT 'nouvelle' CHECK (statut IN ('nouvelle','vue','prise_en_charge','reportee','resolue')),
  cree_le         timestamptz NOT NULL DEFAULT now()
);

-- Fiche de suivi partageable (M11) -----------------------------------------------------------
CREATE TABLE fiche_partagee (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id        uuid NOT NULL REFERENCES lot(id),
  jeton         text NOT NULL UNIQUE,                      -- dans le lien / QR code
  rubriques     text[] NOT NULL,                           -- ce que le vendeur choisit de montrer
  instantane    jsonb NOT NULL,                            -- contenu figé au moment du partage
  mention       text NOT NULL DEFAULT 'declaratif' CHECK (mention IN ('declaratif','valide_veterinaire')),
  expire_le     timestamptz,
  revoquee_le   timestamptz,
  cree_le       timestamptz NOT NULL DEFAULT now()
);

-- Journal d'audit des modifications sanitaires et de mortalité ---------------------------
CREATE TABLE audit (
  id            bigserial PRIMARY KEY,
  table_nom     text NOT NULL,
  ligne_id      uuid NOT NULL,
  utilisateur_id uuid,
  avant         jsonb,
  apres         jsonb,
  date          timestamptz NOT NULL DEFAULT now()
);
