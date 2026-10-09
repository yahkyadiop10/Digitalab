import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChangementSync, EntreeJournal, ReponseSync } from '@digitalab/core';
import { creerBanc, creerProprietaire, inviter as inviterBanc, seConnecter, MOT_DE_PASSE_TEST, URL_BASE_TEST, type Banc, type Session } from './test-utils.js';
import { lireConfig } from './config.js';
import { hacherMotDePasse, verifierMotDePasse } from './securite.js';

const MAINTENANT = 1_790_000_000_000;
const enreg = (table: ChangementSync['table'], id: string, misAJour: number, extra: Record<string, unknown> = {}): ChangementSync => ({ table, enregistrement: { id, misAJour, ...extra } });

describe.skipIf(!URL_BASE_TEST)('serveur (PostgreSQL requis : TEST_DATABASE_URL)', () => {
  let banc: Banc;
  beforeAll(async () => { banc = await creerBanc(); });
  afterAll(async () => { await banc.fermer(); });

  const post = (url: string, payload: unknown, s?: Session) => banc.app.inject({ method: 'POST', url, payload: payload as object, ...(s ? { headers: s.entetes } : {}) });
  const get = (url: string, s?: Session) => banc.app.inject({ method: 'GET', url, ...(s ? { headers: s.entetes } : {}) });
  const inviter = (patron: Session, corps: Record<string, unknown> & { telephone: string }) => inviterBanc(banc, patron, corps);
  const sync = async (s: Session, depuisSeq: number, changements: ChangementSync[] = [], org = s.organisationId) => post(`/v1/organisations/${org}/sync`, { depuisSeq, changements }, s);

  const org = (s: Session) => `/v1/organisations/${s.organisationId}`;
  const membres = async (s: Session) => (await get(`${org(s)}/membres`, s)).json().membres as { identifiant: string; nom: string | null; telephone: string | null; role: string; fonction: string | null; droits: string[]; etat: string }[];
  const connexion = (identifiant: string, motDePasse: string) => post('/v1/auth/connexion', { identifiant, motDePasse });

  describe('installation : premier administrateur', () => {
    it('crée l’administrateur, son élevage et des codes de secours, une seule fois', async () => {
      const b = await creerBanc();
      try {
        expect((await b.app.inject({ method: 'GET', url: '/v1/installation' })).json()).toEqual({ aInitialiser: true, cleRequise: false });
        const r = await b.app.inject({ method: 'POST', url: '/v1/installation', payload: { identifiant: 'Admin', motDePasse: 'Poule-Pondeuse-7', nom: 'Aminata Sow', nomElevage: 'Ferme Sow' } });
        expect(r.statusCode).toBe(200);
        const corps = r.json();
        expect(corps.utilisateur).toMatchObject({ identifiant: 'admin', nom: 'Aminata Sow' });
        expect(corps.organisations).toMatchObject([{ nom: 'Ferme Sow', role: 'proprietaire' }]);
        expect(corps.codesSecours).toHaveLength(8);
        expect(corps.codesSecours[0]).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/);
        expect(corps.doitChanger).toBe(false);
        expect((await b.app.inject({ method: 'GET', url: '/v1/installation' })).json().aInitialiser).toBe(false);
        // La session reçue fonctionne tout de suite.
        expect((await b.app.inject({ method: 'GET', url: '/v1/moi', headers: { authorization: `Bearer ${corps.jeton}` } })).statusCode).toBe(200);
        // Une seconde installation est refusée : personne ne peut prendre la place de l'administrateur.
        const encore = await b.app.inject({ method: 'POST', url: '/v1/installation', payload: { identifiant: 'pirate', motDePasse: 'Poule-Pondeuse-7' } });
        expect(encore.statusCode).toBe(409);
      } finally {
        await b.fermer();
      }
    });

    it('n’a aucun identifiant ni mot de passe par défaut', async () => {
      const b = await creerBanc();
      try {
        expect((await b.app.inject({ method: 'POST', url: '/v1/auth/connexion', payload: { identifiant: 'admin', motDePasse: 'admin 1234' } })).statusCode).toBe(401);
        expect((await b.pool.query('SELECT count(*) AS n FROM utilisateurs')).rows[0].n).toBe('0');
      } finally {
        await b.fermer();
      }
    });

    it('refuse un identifiant ou un mot de passe trop faible', async () => {
      const b = await creerBanc();
      try {
        const essai = (identifiant: string, motDePasse: string) => b.app.inject({ method: 'POST', url: '/v1/installation', payload: { identifiant, motDePasse } });
        expect((await essai('ab', 'Poule-Pondeuse-7')).statusCode).toBe(400);
        expect((await essai('admin', 'court')).json().erreur).toMatch(/8 caractères/);
        expect((await essai('admin', 'admin 1234')).json().erreur).toMatch(/identifiant/);
        expect((await essai('admin', '12345678')).json().erreur).toMatch(/courant/);
        expect((await b.app.inject({ method: 'GET', url: '/v1/installation' })).json().aInitialiser).toBe(true);
      } finally {
        await b.fermer();
      }
    });

    it('exige la clé d’installation affichée dans la console du serveur, et bloque les essais répétés', async () => {
      const b = await creerBanc({ cleInstallation: 'k7mq-x9pt' });
      try {
        expect((await b.app.inject({ method: 'GET', url: '/v1/installation' })).json()).toEqual({ aInitialiser: true, cleRequise: true });
        const essai = (cle?: string) => b.app.inject({ method: 'POST', url: '/v1/installation', payload: { identifiant: 'admin', motDePasse: 'Poule-Pondeuse-7', ...(cle ? { cle } : {}) } });
        expect((await essai()).statusCode).toBe(403);
        for (let i = 0; i < 3; i++) expect((await essai('mauvaise-cle')).statusCode).toBe(403);
        // Cinquième échec : la porte se ferme quelques minutes, même pour la bonne clé.
        expect((await essai('mauvaise-cle')).statusCode).toBe(403);
        expect((await essai('k7mq-x9pt')).statusCode).toBe(429);
        b.horloge.maintenant = new Date(b.horloge.maintenant.getTime() + 16 * 60_000);
        // Casse, espaces et tirets sont ignorés.
        expect((await essai(' K7MQ X9PT ')).statusCode).toBe(200);
      } finally {
        await b.fermer();
      }
    });
  });

  describe('connexion par identifiant et mot de passe', () => {
    it('connecte avec le bon mot de passe (identifiant insensible à la casse)', async () => {
      await creerProprietaire(banc, 'sow.aminata');
      const r = await connexion('  Sow.Aminata ', MOT_DE_PASSE_TEST);
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ doitChanger: false, utilisateur: { identifiant: 'sow.aminata' }, organisations: [{ role: 'proprietaire' }] });
      const moi = (await get('/v1/moi', { entetes: { authorization: `Bearer ${r.json().jeton}` } } as Session)).json();
      expect(moi.utilisateur.identifiant).toBe('sow.aminata');
    });

    it('dit la même chose pour un mauvais mot de passe et un identifiant inconnu', async () => {
      await creerProprietaire(banc, 'fall.awa');
      const faux = await connexion('fall.awa', 'Mauvais-mot-de-passe-1');
      const inconnu = await connexion('personne.inconnue', 'Mauvais-mot-de-passe-1');
      expect(faux.statusCode).toBe(401);
      expect(inconnu.statusCode).toBe(401);
      expect(faux.json()).toEqual(inconnu.json());
      expect(faux.json().erreur).toBe('Identifiant ou mot de passe incorrect.');
    });

    it('bloque l’identifiant après 5 échecs, même avec le bon mot de passe, puis le libère au bout de 15 minutes', async () => {
      await creerProprietaire(banc, 'diop.ibou');
      for (let i = 0; i < 5; i++) expect((await connexion('diop.ibou', 'Mauvais-mot-de-passe-1')).statusCode).toBe(401);
      const bloque = await connexion('diop.ibou', MOT_DE_PASSE_TEST);
      expect(bloque.statusCode).toBe(429);
      expect(bloque.json().erreur).toMatch(/Réessayez dans 15 minutes/);
      banc.horloge.maintenant = new Date(banc.horloge.maintenant.getTime() + 16 * 60_000);
      expect((await connexion('diop.ibou', MOT_DE_PASSE_TEST)).statusCode).toBe(200);
    });

    it('bloque de la même façon un identifiant qui n’existe pas (rien ne révèle les comptes)', async () => {
      for (let i = 0; i < 5; i++) await connexion('fantome.fantome', 'Mauvais-mot-de-passe-1');
      const r = await connexion('fantome.fantome', 'Mauvais-mot-de-passe-1');
      expect(r.statusCode).toBe(429);
      expect(r.json().erreur).toMatch(/Trop d’essais/);
    });

    it('un succès remet le compteur d’échecs à zéro', async () => {
      await creerProprietaire(banc, 'ba.mamadou');
      for (let i = 0; i < 4; i++) await connexion('ba.mamadou', 'Mauvais-mot-de-passe-1');
      expect((await connexion('ba.mamadou', MOT_DE_PASSE_TEST)).statusCode).toBe(200);
      for (let i = 0; i < 4; i++) expect((await connexion('ba.mamadou', 'Mauvais-mot-de-passe-1')).statusCode).toBe(401);
      expect((await connexion('ba.mamadou', MOT_DE_PASSE_TEST)).statusCode).toBe(200);
    });

    it('ne garde ni le mot de passe ni le jeton en clair, mais une empreinte scrypt salée', async () => {
      await creerProprietaire(banc, 'sy.fatou');
      const r = (await connexion('sy.fatou', MOT_DE_PASSE_TEST)).json();
      const sessions = (await banc.pool.query('SELECT jeton_hash FROM sessions')).rows.map((x) => x.jeton_hash);
      expect(sessions).not.toContain(r.jeton);
      const hash = (await banc.pool.query('SELECT mot_de_passe_hash AS h FROM utilisateurs WHERE identifiant = $1', ['sy.fatou'])).rows[0].h as string;
      expect(hash).toMatch(/^scrypt\$\d+\$\d+\$\d+\$/);
      expect(hash).not.toContain(MOT_DE_PASSE_TEST);
      // Même mot de passe, deux empreintes différentes (sel aléatoire).
      const a = await hacherMotDePasse('Poule-Pondeuse-7', { N: 1024, r: 8, p: 1 });
      const b = await hacherMotDePasse('Poule-Pondeuse-7', { N: 1024, r: 8, p: 1 });
      expect(a).not.toBe(b);
      expect(await verifierMotDePasse('Poule-Pondeuse-7', a)).toBe(true);
      expect(await verifierMotDePasse('Poule-Pondeuse-8', a)).toBe(false);
    });

    it('exige une session valide, et la déconnexion l’invalide', async () => {
      expect((await get('/v1/moi')).statusCode).toBe(401);
      expect((await banc.app.inject({ method: 'GET', url: '/v1/moi', headers: { authorization: 'Bearer faux' } })).statusCode).toBe(401);
      const s = await seConnecter(banc, '77 100 00 08');
      expect((await post('/v1/auth/deconnexion', {}, s)).statusCode).toBe(200);
      expect((await get('/v1/moi', s)).statusCode).toBe(401);
    });

    it('expire les sessions au bout de 90 jours', async () => {
      const s = await seConnecter(banc, '77 100 00 09');
      banc.horloge.maintenant = new Date(banc.horloge.maintenant.getTime() + 91 * 86_400_000);
      expect((await get('/v1/moi', s)).statusCode).toBe(401);
    });
  });

  describe('mots de passe provisoires et changement de mot de passe', () => {
    async function nouvelleRecrue(etiquette: string, corps: Record<string, unknown> = {}) {
      const patron = await seConnecter(banc, `${etiquette} patron`);
      const r = await post(`${org(patron)}/membres`, { prenom: 'Moussa', nom: 'Ndiaye', role: 'soigneur', ...corps }, patron);
      return { patron, r, corps: r.json() };
    }

    it('crée l’identifiant nom.prénom et un mot de passe provisoire propre à la personne, montré une seule fois', async () => {
      const { r, corps, patron } = await nouvelleRecrue('77 700 00 01');
      expect(r.statusCode).toBe(200);
      expect(corps).toMatchObject({ identifiant: 'ndiaye.moussa', nom: 'Moussa Ndiaye' });
      expect(corps.motDePasseProvisoire).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/);
      expect(new Date(corps.expireLe).getTime()).toBe(banc.horloge.maintenant.getTime() + 5 * 86_400_000);
      // La liste ne montre jamais de mot de passe.
      const liste = await membres(patron);
      expect(JSON.stringify(liste)).not.toContain(corps.motDePasseProvisoire);
      expect(liste.find((m) => m.identifiant === 'ndiaye.moussa')).toMatchObject({ etat: 'provisoire', role: 'soigneur' });
    });

    it('donne un mot de passe différent à chaque personne', async () => {
      const patron = await seConnecter(banc, '77 700 00 02');
      const a = (await post(`${org(patron)}/membres`, { prenom: 'Awa', nom: 'Fall', role: 'lecteur' }, patron)).json();
      const b = (await post(`${org(patron)}/membres`, { prenom: 'Ibrahima', nom: 'Fall', role: 'lecteur' }, patron)).json();
      expect(a.motDePasseProvisoire).not.toBe(b.motDePasseProvisoire);
    });

    it('ajoute un numéro si l’identifiant est déjà pris, sans accents ni majuscules', async () => {
      const patron = await seConnecter(banc, '77 700 00 03');
      const ajouter = async (prenom: string, nom: string) => (await post(`${org(patron)}/membres`, { prenom, nom, role: 'lecteur' }, patron)).json().identifiant;
      expect(await ajouter('Aïssatou', 'Thiam')).toBe('thiam.aissatou');
      expect(await ajouter('Aissatou', 'THIAM')).toBe('thiam.aissatou2');
      expect(await ajouter('aissatou', 'thiam')).toBe('thiam.aissatou3');
    });

    it('refuse un nom sans lettres et un téléphone invalide, accepte un téléphone facultatif', async () => {
      const patron = await seConnecter(banc, '77 700 00 04');
      expect((await post(`${org(patron)}/membres`, { prenom: '???', nom: '...', role: 'lecteur' }, patron)).statusCode).toBe(400);
      expect((await post(`${org(patron)}/membres`, { prenom: 'A', nom: 'B', role: 'lecteur', telephone: '123' }, patron)).statusCode).toBe(400);
      const sans = (await post(`${org(patron)}/membres`, { prenom: 'Sans', nom: 'Telephone', role: 'lecteur' }, patron)).json();
      const avec = (await post(`${org(patron)}/membres`, { prenom: 'Avec', nom: 'Telephone', role: 'lecteur', telephone: '77 123 45 67' }, patron)).json();
      const liste = await membres(patron);
      expect(liste.find((m) => m.identifiant === sans.identifiant)!.telephone).toBeNull();
      expect(liste.find((m) => m.identifiant === avec.identifiant)!.telephone).toBe('+221771234567');
    });

    it('le mot de passe provisoire ouvre une session limitée : tout est refusé tant qu’il n’est pas remplacé', async () => {
      const { corps, patron } = await nouvelleRecrue('77 700 00 05');
      const r = (await connexion(corps.identifiant, corps.motDePasseProvisoire)).json();
      expect(r.doitChanger).toBe(true);
      const s = { entetes: { authorization: `Bearer ${r.jeton}` } } as Session;
      const bloque = await get(`/v1/organisations/${r.organisations[0].id}/membres`, s);
      expect(bloque.statusCode).toBe(403);
      expect(bloque.json().code).toBe('changement_requis');
      expect((await sync({ ...s, organisationId: patron.organisationId }, 0)).statusCode).toBe(403);
      // Elle peut seulement voir son compte, se déconnecter et choisir son mot de passe.
      expect((await get('/v1/moi', s)).json().utilisateur.doitChanger).toBe(true);
      expect((await post('/v1/auth/deconnexion', {}, s)).statusCode).toBe(200);
    });

    it('tolère les majuscules ajoutées par le clavier du téléphone sur un mot de passe provisoire', async () => {
      const { corps } = await nouvelleRecrue('77 700 00 06');
      expect((await connexion(corps.identifiant, ` ${corps.motDePasseProvisoire.toUpperCase()} `)).statusCode).toBe(200);
    });

    it('refuse un mot de passe provisoire expiré après 5 jours', async () => {
      const { corps } = await nouvelleRecrue('77 700 00 07');
      banc.horloge.maintenant = new Date(banc.horloge.maintenant.getTime() + 5 * 86_400_000 + 1000);
      const r = await connexion(corps.identifiant, corps.motDePasseProvisoire);
      expect(r.statusCode).toBe(403);
      expect(r.json().code).toBe('provisoire_expire');
      const patron = await seConnecter(banc, '77 700 00 07 patron');
      expect((await membres(patron)).find((m) => m.identifiant === corps.identifiant)!.etat).toBe('expire');
    });

    it('le changement de mot de passe lève le blocage, vérifie l’ancien et applique la règle des mots de passe', async () => {
      const { corps } = await nouvelleRecrue('77 700 00 08');
      const jeton = (await connexion(corps.identifiant, corps.motDePasseProvisoire)).json().jeton;
      const s = { entetes: { authorization: `Bearer ${jeton}` } } as Session;
      const changer = (ancien: string, nouveau: string) => post('/v1/moi/mot-de-passe', { ancien, nouveau }, s);
      expect((await changer('Mauvais-ancien-1', 'Nouveau-Mot-De-Passe-3')).statusCode).toBe(400);
      expect((await changer(corps.motDePasseProvisoire, 'court')).json().erreur).toMatch(/8 caractères/);
      expect((await changer(corps.motDePasseProvisoire, corps.motDePasseProvisoire)).json().erreur).toMatch(/différent/);
      expect((await changer(corps.motDePasseProvisoire, `${corps.identifiant}!!`)).json().erreur).toMatch(/identifiant/);
      expect((await changer(corps.motDePasseProvisoire, 'Nouveau-Mot-De-Passe-3')).statusCode).toBe(200);
      // L'ancien mot de passe ne marche plus, le nouveau oui, et plus rien n'est limité.
      expect((await connexion(corps.identifiant, corps.motDePasseProvisoire)).statusCode).toBe(401);
      const apres = await connexion(corps.identifiant, 'Nouveau-Mot-De-Passe-3');
      expect(apres.statusCode).toBe(200);
      expect(apres.json().doitChanger).toBe(false);
      expect((await get('/v1/moi', s)).json().utilisateur.doitChanger).toBe(false);
    });

    it('changer son mot de passe déconnecte les autres appareils, pas celui qui change', async () => {
      const a = await seConnecter(banc, '77 700 00 09');
      const b = await seConnecter(banc, '77 700 00 09');
      const r = await post('/v1/moi/mot-de-passe', { ancien: MOT_DE_PASSE_TEST, nouveau: 'Un-Autre-Mot-De-Passe-4' }, a);
      expect(r.statusCode).toBe(200);
      expect((await get('/v1/moi', a)).statusCode).toBe(200);
      expect((await get('/v1/moi', b)).statusCode).toBe(401);
    });

    it('note le changement dans le journal sans jamais écrire le mot de passe', async () => {
      const { corps, patron } = await nouvelleRecrue('77 700 00 10');
      const jeton = (await connexion(corps.identifiant, corps.motDePasseProvisoire)).json().jeton;
      await post('/v1/moi/mot-de-passe', { ancien: corps.motDePasseProvisoire, nouveau: 'Nouveau-Mot-De-Passe-3' }, { entetes: { authorization: `Bearer ${jeton}` } } as Session);
      const entrees = ((await get(`${org(patron)}/journal`, patron)).json() as { entrees: EntreeJournal[] }).entrees;
      expect(entrees.map((x) => x.description)).toContain('a choisi son mot de passe personnel');
      expect(JSON.stringify(entrees)).not.toContain(corps.motDePasseProvisoire);
      expect(JSON.stringify(entrees)).not.toContain('Nouveau-Mot-De-Passe-3');
    });
  });

  describe('réinitialisation par l’administrateur', () => {
    const reset = (patron: Session, identifiant: string) => post(`${org(patron)}/membres/${encodeURIComponent(identifiant)}/mot-de-passe`, {}, patron);

    it('donne un nouveau mot de passe provisoire, déconnecte la personne et note l’action sans le mot de passe', async () => {
      const patron = await seConnecter(banc, '77 710 00 01');
      await inviter(patron, { telephone: '77 710 00 02', role: 'soigneur', nom: 'Awa Fall' });
      const aide = await seConnecter(banc, '77 710 00 02');
      const r = await reset(patron, aide.identifiant);
      expect(r.statusCode).toBe(200);
      const neuf = r.json();
      expect(neuf.motDePasseProvisoire).toMatch(/^[a-z0-9]{4}-/);
      expect((await get('/v1/moi', aide)).statusCode).toBe(401);
      expect((await connexion(aide.identifiant, MOT_DE_PASSE_TEST)).statusCode).toBe(401);
      const relance = (await connexion(aide.identifiant, neuf.motDePasseProvisoire)).json();
      expect(relance.doitChanger).toBe(true);
      const entrees = ((await get(`${org(patron)}/journal`, patron)).json() as { entrees: EntreeJournal[] }).entrees;
      expect(entrees.some((x) => x.description === 'a réinitialisé le mot de passe de Awa Fall' && x.identifiant === patron.identifiant)).toBe(true);
      expect(JSON.stringify(entrees)).not.toContain(neuf.motDePasseProvisoire);
    });

    it('débloque aussi un compte bloqué après trop d’essais', async () => {
      const patron = await seConnecter(banc, '77 710 00 03');
      await inviter(patron, { telephone: '77 710 00 04', role: 'lecteur' });
      const aide = await seConnecter(banc, '77 710 00 04');
      for (let i = 0; i < 5; i++) await connexion(aide.identifiant, 'Mauvais-mot-de-passe-1');
      expect((await connexion(aide.identifiant, MOT_DE_PASSE_TEST)).statusCode).toBe(429);
      const neuf = (await reset(patron, aide.identifiant)).json();
      expect((await connexion(aide.identifiant, neuf.motDePasseProvisoire)).statusCode).toBe(200);
    });

    it('un provisoire expiré se remplace par une réinitialisation', async () => {
      const patron = await seConnecter(banc, '77 710 00 05');
      const cree = (await post(`${org(patron)}/membres`, { prenom: 'Lent', nom: 'Arrivé', role: 'lecteur' }, patron)).json();
      banc.horloge.maintenant = new Date(banc.horloge.maintenant.getTime() + 6 * 86_400_000);
      expect((await connexion(cree.identifiant, cree.motDePasseProvisoire)).statusCode).toBe(403);
      const neuf = (await reset(patron, cree.identifiant)).json();
      expect((await connexion(cree.identifiant, neuf.motDePasseProvisoire)).statusCode).toBe(200);
    });

    it('réserve la réinitialisation aux administrateurs, jamais pour soi-même ni pour le propriétaire', async () => {
      const patron = await seConnecter(banc, '77 710 00 06');
      await inviter(patron, { telephone: '77 710 00 07', role: 'soigneur' });
      await inviter(patron, { telephone: '77 710 00 08', role: 'personnalise', droits: ['admin.utilisateurs', 'cheptel.voir'] });
      await inviter(patron, { telephone: '77 710 00 09', role: 'personnalise', droits: ['admin.utilisateurs', 'cheptel.voir'] });
      const aide = await seConnecter(banc, '77 710 00 07');
      const delegue = await seConnecter(banc, '77 710 00 08');
      const autreDelegue = await seConnecter(banc, '77 710 00 09');
      expect((await reset(aide, delegue.identifiant)).statusCode).toBe(403);
      expect((await reset(delegue, aide.identifiant)).statusCode).toBe(200);
      expect((await reset(delegue, delegue.identifiant)).statusCode).toBe(400);
      expect((await reset(delegue, patron.identifiant)).statusCode).toBe(403);
      // Un délégué ne prend pas la main sur un autre délégué : seul le propriétaire le peut.
      expect((await reset(delegue, autreDelegue.identifiant)).statusCode).toBe(403);
      expect((await reset(patron, autreDelegue.identifiant)).statusCode).toBe(200);
      expect((await reset(patron, 'inconnu.inconnu')).statusCode).toBe(404);
    });

    it('ne réinitialise pas le mot de passe d’une personne d’un autre élevage', async () => {
      const a = await seConnecter(banc, '77 710 00 10');
      const b = await seConnecter(banc, '77 710 00 11');
      expect((await reset(a, b.identifiant)).statusCode).toBe(404);
      expect((await connexion(b.identifiant, MOT_DE_PASSE_TEST)).statusCode).toBe(200);
    });
  });

  describe('codes de secours du propriétaire', () => {
    async function installe() {
      const b = await creerBanc();
      const r = (await b.app.inject({ method: 'POST', url: '/v1/installation', payload: { identifiant: 'admin', motDePasse: 'Poule-Pondeuse-7' } })).json();
      return { b, codes: r.codesSecours as string[], jeton: r.jeton as string };
    }
    const secours = (b: Banc, corps: Record<string, unknown>) => b.app.inject({ method: 'POST', url: '/v1/auth/secours', payload: corps });

    it('un code de secours permet de choisir un nouveau mot de passe, une seule fois, et déconnecte les appareils', async () => {
      const { b, codes, jeton } = await installe();
      try {
        const r = await secours(b, { identifiant: 'admin', code: codes[0]!.toUpperCase(), nouveauMotDePasse: 'Mot-De-Passe-Retrouve-5' });
        expect(r.statusCode).toBe(200);
        expect(r.json().codesRestants).toBe(7);
        expect((await b.app.inject({ method: 'GET', url: '/v1/moi', headers: { authorization: `Bearer ${jeton}` } })).statusCode).toBe(401);
        const ok = await b.app.inject({ method: 'POST', url: '/v1/auth/connexion', payload: { identifiant: 'admin', motDePasse: 'Mot-De-Passe-Retrouve-5' } });
        expect(ok.statusCode).toBe(200);
        expect(ok.json().doitChanger).toBe(false);
        expect((await secours(b, { identifiant: 'admin', code: codes[0], nouveauMotDePasse: 'Encore-Un-Autre-Mot-6' })).statusCode).toBe(401);
        expect((await secours(b, { identifiant: 'admin', code: codes[1], nouveauMotDePasse: 'Encore-Un-Autre-Mot-6' })).statusCode).toBe(200);
      } finally {
        await b.fermer();
      }
    });

    it('refuse un mauvais code, bloque les essais et ne révèle pas si l’identifiant existe', async () => {
      const { b, codes } = await installe();
      try {
        const faux = await secours(b, { identifiant: 'admin', code: 'aaaa-bbbb-cccc', nouveauMotDePasse: 'Mot-De-Passe-Retrouve-5' });
        const inconnu = await secours(b, { identifiant: 'personne', code: codes[0], nouveauMotDePasse: 'Mot-De-Passe-Retrouve-5' });
        expect(faux.statusCode).toBe(401);
        expect(faux.json()).toEqual(inconnu.json());
        for (let i = 0; i < 4; i++) await secours(b, { identifiant: 'admin', code: 'aaaa-bbbb-cccc', nouveauMotDePasse: 'Mot-De-Passe-Retrouve-5' });
        expect((await secours(b, { identifiant: 'admin', code: codes[0], nouveauMotDePasse: 'Mot-De-Passe-Retrouve-5' })).statusCode).toBe(429);
      } finally {
        await b.fermer();
      }
    });

    it('applique la règle des mots de passe sans consommer le code', async () => {
      const { b, codes } = await installe();
      try {
        expect((await secours(b, { identifiant: 'admin', code: codes[0], nouveauMotDePasse: 'court' })).statusCode).toBe(400);
        expect((await secours(b, { identifiant: 'admin', code: codes[0], nouveauMotDePasse: 'Mot-De-Passe-Retrouve-5' })).statusCode).toBe(200);
      } finally {
        await b.fermer();
      }
    });

    it('ne garde que l’empreinte des codes, et on peut en générer de nouveaux (les anciens cessent de marcher)', async () => {
      const { b, codes, jeton } = await installe();
      try {
        const stockes = (await b.pool.query('SELECT code_hash FROM codes_secours')).rows.map((x) => x.code_hash as string);
        expect(stockes).toHaveLength(8);
        for (const c of codes) expect(stockes).not.toContain(c);
        const entetes = { authorization: `Bearer ${jeton}` };
        expect((await b.app.inject({ method: 'POST', url: '/v1/moi/codes-secours', headers: entetes, payload: { motDePasse: 'Faux-mot-de-passe-1' } })).statusCode).toBe(400);
        const r = await b.app.inject({ method: 'POST', url: '/v1/moi/codes-secours', headers: entetes, payload: { motDePasse: 'Poule-Pondeuse-7' } });
        expect(r.statusCode).toBe(200);
        expect(r.json().codesSecours).toHaveLength(8);
        expect((await secours(b, { identifiant: 'admin', code: codes[0], nouveauMotDePasse: 'Mot-De-Passe-Retrouve-5' })).statusCode).toBe(401);
        expect((await secours(b, { identifiant: 'admin', code: r.json().codesSecours[0], nouveauMotDePasse: 'Mot-De-Passe-Retrouve-5' })).statusCode).toBe(200);
      } finally {
        await b.fermer();
      }
    });

    it('seul le propriétaire en a', async () => {
      const patron = await seConnecter(banc, '77 720 00 01');
      await inviter(patron, { telephone: '77 720 00 02', role: 'gerant' });
      const gerant = await seConnecter(banc, '77 720 00 02');
      expect((await post('/v1/moi/codes-secours', { motDePasse: MOT_DE_PASSE_TEST }, gerant)).statusCode).toBe(403);
    });
  });

  describe('élevage, membres et rôles', () => {
    it('le propriétaire ajoute une personne, qui trouve l’élevage à sa première connexion', async () => {
      const patron = await seConnecter(banc, '77 200 00 01');
      const inv = await inviter(patron, { telephone: '77 200 00 02', role: 'soigneur' });
      expect(inv.statusCode).toBe(200);
      let liste = await membres(patron);
      expect(liste).toMatchObject([{ role: 'proprietaire', etat: 'actif' }, { role: 'soigneur', etat: 'provisoire' }]);
      const aide = await seConnecter(banc, '77 200 00 02');
      expect(aide.organisationId).toBe(patron.organisationId);
      const moi = (await get('/v1/moi', aide)).json();
      expect(moi.organisations).toHaveLength(1);
      expect(moi.organisations[0].role).toBe('soigneur');
      liste = await membres(patron);
      expect(liste.find((m) => m.identifiant === aide.identifiant)!.etat).toBe('actif');
    });

    it('seul le propriétaire (ou un administrateur délégué) ajoute, retire ou renomme', async () => {
      const patron = await seConnecter(banc, '77 200 00 05');
      await inviter(patron, { telephone: '77 200 00 06', role: 'soigneur' });
      const aide = await seConnecter(banc, '77 200 00 06');
      const o = patron.organisationId;
      expect((await post(`/v1/organisations/${o}/membres`, { prenom: 'X', nom: 'Y', role: 'lecteur' }, aide)).statusCode).toBe(403);
      expect((await banc.app.inject({ method: 'DELETE', url: `/v1/organisations/${o}/membres/${encodeURIComponent(patron.identifiant)}`, headers: aide.entetes })).statusCode).toBe(403);
      expect((await banc.app.inject({ method: 'PATCH', url: `/v1/organisations/${o}`, payload: { nom: 'Pris' }, headers: aide.entetes })).statusCode).toBe(403);
      expect((await banc.app.inject({ method: 'PATCH', url: `/v1/organisations/${o}`, payload: { nom: 'Ferme Sow' }, headers: patron.entetes })).statusCode).toBe(200);
      expect((await get('/v1/moi', patron)).json().organisations[0].nom).toBe('Ferme Sow');
    });

    it('ne laisse pas créer un propriétaire, ni retirer ou modifier le propriétaire, ni modifier ses propres droits', async () => {
      const patron = await seConnecter(banc, '77 200 00 08');
      const o = patron.organisationId;
      expect((await post(`/v1/organisations/${o}/membres`, { prenom: 'X', nom: 'Y', role: 'proprietaire' }, patron)).statusCode).toBe(400);
      expect((await banc.app.inject({ method: 'DELETE', url: `/v1/organisations/${o}/membres/${encodeURIComponent(patron.identifiant)}`, headers: patron.entetes })).statusCode).toBe(400);
      expect((await banc.app.inject({ method: 'PATCH', url: `/v1/organisations/${o}/membres/${encodeURIComponent(patron.identifiant)}`, payload: { role: 'lecteur' }, headers: patron.entetes })).statusCode).toBe(400);
      await inviter(patron, { telephone: '77 200 00 09', role: 'personnalise', droits: ['admin.utilisateurs', 'cheptel.voir'] });
      const delegue = await seConnecter(banc, '77 200 00 09');
      const sien = await banc.app.inject({ method: 'PATCH', url: `/v1/organisations/${o}/membres/${encodeURIComponent(delegue.identifiant)}`, payload: { role: 'gerant' }, headers: delegue.entetes });
      expect(sien.statusCode).toBe(400);
    });

    it('retire une personne : elle perd l’accès, son compte disparaît et son identifiant redevient libre', async () => {
      const patron = await seConnecter(banc, '77 200 00 10');
      await inviter(patron, { telephone: '77 200 00 11', role: 'soigneur' });
      const aide = await seConnecter(banc, '77 200 00 11');
      expect((await sync(aide, 0, [], patron.organisationId)).statusCode).toBe(200);
      const r = await banc.app.inject({ method: 'DELETE', url: `/v1/organisations/${patron.organisationId}/membres/${encodeURIComponent(aide.identifiant)}`, headers: patron.entetes });
      expect(r.statusCode).toBe(200);
      expect((await sync(aide, 0, [], patron.organisationId)).statusCode).toBe(401);
      expect((await connexion(aide.identifiant, MOT_DE_PASSE_TEST)).statusCode).toBe(401);
      expect((await banc.pool.query('SELECT 1 FROM utilisateurs WHERE identifiant = $1', [aide.identifiant])).rowCount).toBe(0);
    });

    it('cloisonne les élevages entre eux', async () => {
      const a = await seConnecter(banc, '77 200 00 12');
      const b = await seConnecter(banc, '77 200 00 13');
      expect((await sync(a, 0, [enreg('lots', 'l1', MAINTENANT)])).statusCode).toBe(200);
      expect((await sync(b, 0, [], a.organisationId)).statusCode).toBe(404);
      expect((await get(`/v1/organisations/${a.organisationId}/membres`, b)).statusCode).toBe(404);
      expect((await sync(b, 0)).json().changements).toEqual([]);
    });

    it('le téléphone est une simple information de contact, modifiable par la personne', async () => {
      const patron = await seConnecter(banc, '77 200 00 14');
      expect((await banc.app.inject({ method: 'PATCH', url: '/v1/moi', headers: patron.entetes, payload: { telephone: '77 111 22 33', nom: 'Aminata Sow' } })).statusCode).toBe(200);
      expect((await get('/v1/moi', patron)).json().utilisateur).toMatchObject({ telephone: '+221771112233', nom: 'Aminata Sow' });
      expect((await banc.app.inject({ method: 'PATCH', url: '/v1/moi', headers: patron.entetes, payload: { telephone: '12' } })).statusCode).toBe(400);
      expect((await banc.app.inject({ method: 'PATCH', url: '/v1/moi', headers: patron.entetes, payload: { telephone: '' } })).statusCode).toBe(200);
      expect((await get('/v1/moi', patron)).json().utilisateur.telephone).toBeNull();
    });
  });

  describe('synchronisation', () => {
    it('envoie des enregistrements et les restitue à un autre appareil', async () => {
      const a = await seConnecter(banc, '77 300 00 01');
      const b = await seConnecter(banc, '77 300 00 01');
      const r1: ReponseSync = (await sync(a, 0, [enreg('lots', 'l1', MAINTENANT, { nom: 'Soie' }), enreg('pontes', 'p1', MAINTENANT, { lotId: 'l1', nombre: 9 })])).json();
      expect(r1.ecartes).toBe(0);
      expect(r1.changements).toHaveLength(2);
      const r2: ReponseSync = (await sync(b, 0)).json();
      expect(r2.changements.map((c) => [c.table, c.enregistrement.id])).toEqual([['lots', 'l1'], ['pontes', 'p1']]);
      expect(r2.changements[0]!.enregistrement['nom']).toBe('Soie');
      expect(r2.seq).toBe(r1.seq);
      const r3: ReponseSync = (await sync(b, r2.seq)).json();
      expect(r3.changements).toEqual([]);
      expect(r3.seq).toBe(r2.seq);
    });

    it('ne renvoie que ce qui a changé depuis le dernier numéro', async () => {
      const a = await seConnecter(banc, '77 300 00 02');
      const r1: ReponseSync = (await sync(a, 0, [enreg('lots', 'l1', MAINTENANT), enreg('lots', 'l2', MAINTENANT)])).json();
      const r2: ReponseSync = (await sync(a, r1.seq, [enreg('lots', 'l3', MAINTENANT)])).json();
      expect(r2.changements.map((c) => c.enregistrement.id)).toEqual(['l3']);
      expect(r2.seq).toBeGreaterThan(r1.seq);
    });

    it('garde la version la plus récente et écarte la plus ancienne', async () => {
      const a = await seConnecter(banc, '77 300 00 03');
      await sync(a, 0, [enreg('lots', 'l1', MAINTENANT, { nom: 'Version 1' })]);
      const ancienne: ReponseSync = (await sync(a, 0, [enreg('lots', 'l1', MAINTENANT - 5000, { nom: 'Trop vieille' })])).json();
      expect(ancienne.ecartes).toBe(1);
      expect(ancienne.changements[0]!.enregistrement['nom']).toBe('Version 1');
      const meme: ReponseSync = (await sync(a, 0, [enreg('lots', 'l1', MAINTENANT, { nom: 'Même heure' })])).json();
      expect(meme.ecartes).toBe(0);
      expect(meme.changements[0]!.enregistrement['nom']).toBe('Version 1');
      const recente: ReponseSync = (await sync(a, 0, [enreg('lots', 'l1', MAINTENANT + 5000, { nom: 'Version 2' })])).json();
      expect(recente.ecartes).toBe(0);
      expect(recente.changements[0]!.enregistrement['nom']).toBe('Version 2');
    });

    it('fait remonter une modification aux autres appareils (nouveau numéro)', async () => {
      const a = await seConnecter(banc, '77 300 00 04');
      const r1: ReponseSync = (await sync(a, 0, [enreg('lots', 'l1', MAINTENANT, { nom: 'Avant' })])).json();
      await sync(a, r1.seq, [enreg('lots', 'l1', MAINTENANT + 1000, { nom: 'Après' })]);
      const r3: ReponseSync = (await sync(a, r1.seq)).json();
      expect(r3.changements).toHaveLength(1);
      expect(r3.changements[0]!.enregistrement['nom']).toBe('Après');
    });

    it('transmet les suppressions logiques sans rien effacer', async () => {
      const a = await seConnecter(banc, '77 300 00 05');
      const r1: ReponseSync = (await sync(a, 0, [enreg('mouvements', 'm1', MAINTENANT, { quantite: -2 })])).json();
      await sync(a, r1.seq, [enreg('mouvements', 'm1', MAINTENANT + 10, { quantite: -2, supprimeLe: MAINTENANT + 10 })]);
      const r3: ReponseSync = (await sync(a, r1.seq)).json();
      expect(r3.changements[0]!.enregistrement.supprimeLe).toBe(MAINTENANT + 10);
      const n = (await banc.pool.query('SELECT count(*)::int AS n FROM enregistrements WHERE organisation_id = $1', [a.organisationId])).rows[0].n;
      expect(n).toBe(1);
    });

    it('relaie un champ retiré (une propriété qui disparaît)', async () => {
      const a = await seConnecter(banc, '77 300 00 06');
      await sync(a, 0, [enreg('incubations', 'i1', MAINTENANT, { eclosion: { nes: 30 } })]);
      const r: ReponseSync = (await sync(a, 0, [enreg('incubations', 'i1', MAINTENANT + 1)])).json();
      expect(r.changements[0]!.enregistrement['eclosion']).toBeUndefined();
    });

    it('pagine les réponses par tranches de 1000', async () => {
      const a = await seConnecter(banc, '77 300 00 07');
      for (let lot = 0; lot < 3; lot++) {
        const changements = Array.from({ length: 400 }, (_, i) => enreg('pontes', `p${lot}-${i}`, MAINTENANT));
        expect((await sync(a, 0, changements)).statusCode).toBe(200);
      }
      let seq = 0;
      let total = 0;
      let tours = 0;
      for (;;) {
        const r: ReponseSync = (await sync(a, seq)).json();
        total += r.changements.length;
        seq = r.seq;
        tours += 1;
        if (!r.reste) break;
      }
      expect(total).toBe(1200);
      expect(tours).toBe(2);
    });

    it('le lecteur est refusé s’il envoie des modifications, mais peut lire ; le vétérinaire ne peut écrire que dans la santé', async () => {
      const patron = await seConnecter(banc, '77 300 00 08');
      await sync(patron, 0, [enreg('lots', 'l1', MAINTENANT, { nom: 'Soie' })]);
      await inviter(patron, { telephone: '77 300 00 10', role: 'lecteur' });
      const lecteur = await seConnecter(banc, '77 300 00 10');
      expect(((await sync(lecteur, 0, [], patron.organisationId)).json() as ReponseSync).changements).toHaveLength(1);
      expect((await sync(lecteur, 0, [enreg('lots', 'l2', MAINTENANT)], patron.organisationId)).statusCode).toBe(403);

      await inviter(patron, { telephone: '77 300 00 09', role: 'veterinaire' });
      const veto = await seConnecter(banc, '77 300 00 09');
      const r: ReponseSync = (await sync(veto, 0, [enreg('lots', 'l3', MAINTENANT), enreg('evenementsSante', 's1', MAINTENANT, { lotId: 'l1' })], patron.organisationId)).json();
      expect(r.refuses).toBe(1);
      const vu: ReponseSync = (await sync(patron, 0)).json();
      expect(vu.changements.map((c) => c.enregistrement.id).sort()).toEqual(['l1', 's1']);
      expect((await sync(patron, 0)).json().changements).toHaveLength(2);
    });

    it('laisse un soigneur écrire', async () => {
      const patron = await seConnecter(banc, '77 300 00 11');
      await inviter(patron, { telephone: '77 300 00 12', role: 'soigneur' });
      const aide = await seConnecter(banc, '77 300 00 12');
      expect((await sync(aide, 0, [enreg('pontes', 'p1', MAINTENANT, { nombre: 5 })], patron.organisationId)).statusCode).toBe(200);
      expect((await sync(patron, 0)).json().changements).toHaveLength(1);
    });

    it('refuse une table inconnue, un enregistrement mal formé ou trop volumineux', async () => {
      const a = await seConnecter(banc, '77 300 00 13');
      const url = `/v1/organisations/${a.organisationId}/sync`;
      const essai = (changements: unknown[]) => post(url, { depuisSeq: 0, changements }, a);
      expect((await essai([{ table: 'reglages', enregistrement: { id: 'x', misAJour: 1 } }])).statusCode).toBe(400);
      expect((await essai([{ table: 'lots', enregistrement: { id: '', misAJour: 1 } }])).statusCode).toBe(400);
      expect((await essai([{ table: 'lots', enregistrement: { id: 'x', misAJour: 'hier' } }])).statusCode).toBe(400);
      expect((await essai([{ table: 'lots', enregistrement: { id: 'x', misAJour: 1, texte: 'a'.repeat(60_000) } }])).statusCode).toBe(400);
      expect((await post(url, { depuisSeq: -1, changements: [] }, a)).statusCode).toBe(400);
      expect((await post(url, { depuisSeq: 0, changements: Array.from({ length: 501 }, (_, i) => enreg('lots', `l${i}`, 1)) }, a)).statusCode).toBe(400);
      expect((await post(`/v1/organisations/pas-un-uuid/sync`, { depuisSeq: 0, changements: [] }, a)).statusCode).toBe(400);
    });

    it('exige une connexion', async () => {
      const a = await seConnecter(banc, '77 300 00 14');
      expect((await post(`/v1/organisations/${a.organisationId}/sync`, { depuisSeq: 0, changements: [] })).statusCode).toBe(401);
    });

    it('supporte des synchronisations simultanées sans perdre de modification', async () => {
      const a = await seConnecter(banc, '77 300 00 15');
      const b = await seConnecter(banc, '77 300 00 15');
      const [ra, rb] = await Promise.all([
        sync(a, 0, Array.from({ length: 50 }, (_, i) => enreg('pontes', `a${i}`, MAINTENANT))),
        sync(b, 0, Array.from({ length: 50 }, (_, i) => enreg('pontes', `b${i}`, MAINTENANT))),
      ]);
      expect(ra.statusCode).toBe(200);
      expect(rb.statusCode).toBe(200);
      const tout: ReponseSync = (await sync(a, 0)).json();
      expect(tout.changements).toHaveLength(100);
    });
  });

  it('répond sur /v1/sante', async () => {
    expect((await get('/v1/sante')).json()).toEqual({ ok: true });
  });

  describe('droits fins et validation', () => {

    it('enregistre la fonction et le profil à la création, et les montre dans la liste', async () => {
      const patron = await seConnecter(banc, '77 400 00 01');
      const inv = (await inviter(patron, { telephone: '77 400 00 02', role: 'soigneur', fonction: 'Responsable bâtiment A', nom: 'Cheikh Mbaye' })).json();
      expect(inv.identifiant).toBe('mbaye.cheikh');
      expect((await membres(patron)).find((m) => m.identifiant === inv.identifiant)).toMatchObject({ nom: 'Cheikh Mbaye', fonction: 'Responsable bâtiment A', etat: 'provisoire' });
      const ok = await connexion(inv.identifiant, inv.motDePasseProvisoire);
      expect(ok.statusCode).toBe(200);
      expect(ok.json().organisations[0]).toMatchObject({ id: patron.organisationId, role: 'soigneur', fonction: 'Responsable bâtiment A' });
    });

    it('un soigneur ne voit pas les finances ni les salaires, un caissier voit les ventes mais pas les dépenses', async () => {
      const patron = await seConnecter(banc, '77 400 00 05');
      await sync(patron, 0, [
        enreg('operations', 'o-dep', MAINTENANT, { sens: 'depense', categorie: 'soins', montant: 100 }),
        enreg('operations', 'o-rec', MAINTENANT, { sens: 'recette', categorie: 'oeufs', montant: 200 }),
        enreg('operations', 'o-sal', MAINTENANT, { sens: 'depense', categorie: 'main_oeuvre', montant: 300, employeId: 'e1' }),
        enreg('paiements', 'p-dep', MAINTENANT, { operationId: 'o-dep', montant: 100 }),
        enreg('paiements', 'p-rec', MAINTENANT, { operationId: 'o-rec', montant: 200 }),
        enreg('paiements', 'p-sal', MAINTENANT, { operationId: 'o-sal', montant: 300 }),
        enreg('employes', 'e1', MAINTENANT, { nom: 'Moussa', salaire: 45000 }),
        enreg('pontes', 'po1', MAINTENANT, { nombre: 5 }),
      ]);
      const ids = async (s: Session) => ((await sync(s, 0, [], patron.organisationId)).json() as ReponseSync).changements.map((c) => c.enregistrement.id).sort();

      await inviter(patron, { telephone: '77 400 00 06', role: 'soigneur' });
      expect(await ids(await seConnecter(banc, '77 400 00 06'))).toEqual(['po1']);
      await inviter(patron, { telephone: '77 400 00 07', role: 'caissier' });
      expect(await ids(await seConnecter(banc, '77 400 00 07'))).toEqual(['o-rec', 'p-rec', 'po1']);
      await inviter(patron, { telephone: '77 400 00 08', role: 'personnalise', droits: ['finances.voir_depenses'] });
      expect(await ids(await seConnecter(banc, '77 400 00 08'))).toEqual(['o-dep', 'p-dep']);
      await inviter(patron, { telephone: '77 400 00 09', role: 'personnalise', droits: ['salaires.voir'] });
      expect(await ids(await seConnecter(banc, '77 400 00 09'))).toEqual(['e1', 'o-sal', 'p-sal']);
    });

    it('les comptes de trésorerie : qui voit les soldes voit aussi les règlements, mais pas les fiches d’employés', async () => {
      const patron = await seConnecter(banc, '77 400 01 01');
      await sync(patron, 0, [
        enreg('operations', 'to-dep', MAINTENANT, { sens: 'depense', categorie: 'soins', montant: 100 }),
        enreg('operations', 'to-sal', MAINTENANT, { sens: 'depense', categorie: 'main_oeuvre', montant: 300, employeId: 'e1' }),
        enreg('paiements', 'tp-dep', MAINTENANT, { operationId: 'to-dep', montant: 100, mode: 'wave' }),
        enreg('paiements', 'tp-sal', MAINTENANT, { operationId: 'to-sal', montant: 300, mode: 'especes' }),
        enreg('employes', 'e1', MAINTENANT, { nom: 'Moussa', salaire: 1 }),
        enreg('comptes', 'c1', MAINTENANT, { nom: 'Caisse', soldeInitial: 0 }),
        enreg('transferts', 'tr1', MAINTENANT, { deId: 'c1', versId: 'c2', montant: 5 }),
        enreg('pointages', 'pt1', MAINTENANT, { compteId: 'c1', ecart: -50 }),
      ]);
      await inviter(patron, { telephone: '77 400 01 02', role: 'personnalise', droits: ['tresorerie.voir'] });
      const tres = await seConnecter(banc, '77 400 01 02');
      const vus = ((await sync(tres, 0, [], patron.organisationId)).json() as ReponseSync).changements.map((c) => c.enregistrement.id).sort();
      expect(vus).toEqual(['c1', 'pt1', 'to-dep', 'to-sal', 'tp-dep', 'tp-sal', 'tr1']);
      // Sans ce droit, rien de tout cela n'est visible ; et voir ne permet pas d'écrire.
      await inviter(patron, { telephone: '77 400 01 03', role: 'soigneur' });
      expect(((await sync(await seConnecter(banc, '77 400 01 03'), 0, [], patron.organisationId)).json() as ReponseSync).changements).toEqual([]);
      expect((await sync(tres, 0, [enreg('transferts', 'tr2', MAINTENANT + 1, { deId: 'c1', versId: 'c2', montant: 9 })], patron.organisationId)).statusCode).toBe(403);
      await inviter(patron, { telephone: '77 400 01 04', role: 'personnalise', droits: ['tresorerie.voir', 'tresorerie.transferer', 'tresorerie.pointer'] });
      const caissier = await seConnecter(banc, '77 400 01 04');
      const ok = (await sync(caissier, 0, [enreg('transferts', 'tr3', MAINTENANT + 1, { deId: 'c1', versId: 'c2', montant: 9 }), enreg('pointages', 'pt2', MAINTENANT + 1, { compteId: 'c1', ecart: 0 }), enreg('comptes', 'c9', MAINTENANT + 1, { nom: 'Pirate' })], patron.organisationId)).json() as ReponseSync;
      expect(ok.refuses).toBe(1);
    });

    it('n’accepte que les écritures permises par les droits cochés', async () => {
      const patron = await seConnecter(banc, '77 400 00 10');
      await inviter(patron, { telephone: '77 400 00 11', role: 'personnalise', droits: ['saisie.ponte', 'cheptel.voir'] });
      const aide = await seConnecter(banc, '77 400 00 11');
      const r: ReponseSync = (await sync(aide, 0, [enreg('pontes', 'a', MAINTENANT, { nombre: 3 }), enreg('distributions', 'b', MAINTENANT), enreg('operations', 'c', MAINTENANT, { sens: 'recette' })], patron.organisationId)).json();
      expect(r.refuses).toBe(2);
      expect(r.moi.droits.sort()).toEqual(['cheptel.voir', 'saisie.ponte']);
      expect(((await sync(patron, 0)).json() as ReponseSync).changements.map((c) => c.enregistrement.id)).toEqual(['a']);
    });

    it('annuler une saisie demande le droit d’annuler', async () => {
      const patron = await seConnecter(banc, '77 400 00 12');
      await sync(patron, 0, [enreg('pontes', 'x', MAINTENANT, { nombre: 3 })]);
      await inviter(patron, { telephone: '77 400 00 13', role: 'personnalise', droits: ['saisie.ponte'] });
      await inviter(patron, { telephone: '77 400 00 14', role: 'personnalise', droits: ['saisie.ponte', 'saisie.annuler'] });
      const sans = await seConnecter(banc, '77 400 00 13');
      const avec = await seConnecter(banc, '77 400 00 14');
      const annulation = (t: number) => enreg('pontes', 'x', MAINTENANT + t, { nombre: 3, supprimeLe: MAINTENANT + t });
      expect(((await sync(sans, 0, [annulation(1)], patron.organisationId)).json() as ReponseSync).refuses).toBe(1);
      expect(((await sync(avec, 0, [annulation(2)], patron.organisationId)).json() as ReponseSync).refuses).toBe(0);
    });

    it('annuler une dépense et annuler une vente sont deux droits distincts', async () => {
      const patron = await seConnecter(banc, '77 400 00 15');
      await sync(patron, 0, [
        enreg('operations', 'd', MAINTENANT, { sens: 'depense', categorie: 'soins', montant: 1 }),
        enreg('operations', 'v', MAINTENANT, { sens: 'recette', categorie: 'oeufs', montant: 1 }),
      ]);
      await inviter(patron, { telephone: '77 400 00 16', role: 'personnalise', droits: ['finances.saisir_depense', 'finances.saisir_facture', 'finances.annuler_depense', 'finances.voir_depenses', 'finances.voir_recettes'] });
      const g = await seConnecter(banc, '77 400 00 16');
      const r: ReponseSync = (await sync(g, 0, [
        enreg('operations', 'd', MAINTENANT + 1, { sens: 'depense', categorie: 'soins', montant: 1, supprimeLe: MAINTENANT + 1, statut: 'a_valider' }),
        enreg('operations', 'v', MAINTENANT + 1, { sens: 'recette', categorie: 'oeufs', montant: 1, supprimeLe: MAINTENANT + 1 }),
      ], patron.organisationId)).json();
      expect(r.refuses).toBe(1);
    });

    it('une dépense ne devient « validée » que par une personne autorisée', async () => {
      const patron = await seConnecter(banc, '77 400 00 17');
      await inviter(patron, { telephone: '77 400 00 18', role: 'personnalise', droits: ['finances.saisir_depense'] });
      await inviter(patron, { telephone: '77 400 00 19', role: 'personnalise', droits: ['finances.valider_depense', 'finances.voir_depenses'] });
      await inviter(patron, { telephone: '77 400 00 20', role: 'personnalise', droits: ['finances.valider_achat', 'finances.voir_depenses'] });
      const saisisseur = await seConnecter(banc, '77 400 00 18');
      const validateur = await seConnecter(banc, '77 400 00 19');
      const acheteur = await seConnecter(banc, '77 400 00 20');
      const org = patron.organisationId;
      const aValider = (id: string, categorie: string, t = 0) => enreg('operations', id, MAINTENANT + t, { sens: 'depense', categorie, montant: 5000, statut: 'a_valider' });
      const validee = (id: string, categorie: string, t: number) => enreg('operations', id, MAINTENANT + t, { sens: 'depense', categorie, montant: 5000, statut: 'validee' });

      expect(((await sync(saisisseur, 0, [aValider('d1', 'soins'), aValider('d2', 'materiel')], org)).json() as ReponseSync).refuses).toBe(0);
      // Se valider soi-même est refusé.
      expect(((await sync(saisisseur, 0, [validee('d1', 'soins', 5)], org)).json() as ReponseSync).refuses).toBe(1);
      // Une dépense ordinaire se valide avec le droit « dépenses », un achat avec le droit « achats ».
      expect(((await sync(validateur, 0, [validee('d1', 'soins', 6), validee('d2', 'materiel', 6)], org)).json() as ReponseSync).refuses).toBe(1);
      expect(((await sync(acheteur, 0, [validee('d2', 'materiel', 7)], org)).json() as ReponseSync).refuses).toBe(0);
    });

    it('un paiement de dépense doit être validé par une personne autorisée', async () => {
      const patron = await seConnecter(banc, '77 400 00 21');
      await sync(patron, 0, [enreg('operations', 'dd', MAINTENANT, { sens: 'depense', categorie: 'soins', montant: 10 })]);
      await inviter(patron, { telephone: '77 400 00 22', role: 'personnalise', droits: ['finances.payer', 'finances.voir_depenses'] });
      const payeur = await seConnecter(banc, '77 400 00 22');
      const enAttente = (t: number) => enreg('paiements', 'pp', MAINTENANT + t, { operationId: 'dd', montant: 10, statut: 'a_valider' });
      const valide = (t: number) => enreg('paiements', 'pp', MAINTENANT + t, { operationId: 'dd', montant: 10, statut: 'validee' });
      expect(((await sync(payeur, 0, [enAttente(1)], patron.organisationId)).json() as ReponseSync).refuses).toBe(0);
      expect(((await sync(payeur, 0, [valide(2)], patron.organisationId)).json() as ReponseSync).refuses).toBe(1);
      expect(((await sync(patron, 0, [valide(3)])).json() as ReponseSync).refuses).toBe(0);
    });

    it('la gestion des utilisateurs est un droit : un gérant ne peut pas se l’accorder, un délégué ne peut pas la transmettre', async () => {
      const patron = await seConnecter(banc, '77 400 00 23');
      await inviter(patron, { telephone: '77 400 00 24', role: 'gerant' });
      const gerant = await seConnecter(banc, '77 400 00 24');
      const org = patron.organisationId;
      expect((await inviter(gerant, { telephone: '77 400 00 25', role: 'lecteur' })).statusCode).toBe(403);
      expect((await get(`/v1/organisations/${org}/membres`, gerant)).statusCode).toBe(403);

      await inviter(patron, { telephone: '77 400 00 26', role: 'personnalise', droits: ['admin.utilisateurs', 'cheptel.voir'] });
      const delegue = await seConnecter(banc, '77 400 00 26');
      expect((await inviter(delegue, { telephone: '77 400 00 27', role: 'lecteur' })).statusCode).toBe(200);
      expect((await inviter(delegue, { telephone: '77 400 00 28', role: 'personnalise', droits: ['admin.utilisateurs'] })).statusCode).toBe(403);
      expect((await inviter(delegue, { telephone: '77 400 00 24', role: 'lecteur' })).statusCode).toBe(200);
    });

    it('modifie les droits d’une personne, qui les voit à la synchronisation suivante', async () => {
      const patron = await seConnecter(banc, '77 400 00 29');
      await inviter(patron, { telephone: '77 400 00 30', role: 'lecteur' });
      const aide = await seConnecter(banc, '77 400 00 30');
      expect(((await sync(aide, 0, [], patron.organisationId)).json() as ReponseSync).moi.role).toBe('lecteur');
      await inviter(patron, { telephone: '77 400 00 30', role: 'soigneur', zones: ['bat-a'] });
      const moi = ((await sync(aide, 0, [], patron.organisationId)).json() as ReponseSync).moi;
      expect(moi).toMatchObject({ role: 'soigneur', zones: ['bat-a'] });
      expect(moi.droits).toContain('saisie.ponte');
      expect((await get('/v1/moi', aide)).json().organisations[0].droits).toContain('saisie.ponte');
    });

    it('ignore les droits inconnus', async () => {
      const patron = await seConnecter(banc, '77 400 00 31');
      const cree = (await inviter(patron, { telephone: '77 400 00 32', role: 'personnalise', droits: ['saisie.ponte', 'n.importe.quoi'] })).json();
      expect((await membres(patron)).find((m) => m.identifiant === cree.identifiant)!.droits).toEqual(['saisie.ponte']);
    });

    it('déconnecte les appareils d’une personne', async () => {
      const patron = await seConnecter(banc, '77 400 00 33');
      await inviter(patron, { telephone: '77 400 00 34', role: 'soigneur' });
      const aide = await seConnecter(banc, '77 400 00 34');
      expect((await get('/v1/moi', aide)).statusCode).toBe(200);
      const r = await post(`/v1/organisations/${patron.organisationId}/membres/${encodeURIComponent(aide.identifiant)}/deconnexion`, {}, patron);
      expect(r.statusCode).toBe(200);
      expect((await get('/v1/moi', aide)).statusCode).toBe(401);
      expect((await post(`/v1/organisations/${patron.organisationId}/membres/${encodeURIComponent(patron.identifiant)}/deconnexion`, {}, patron)).statusCode).toBe(400);
    });
  });

  describe('journal d’activité', () => {
    const journal = async (s: Session, requete = '', org = s.organisationId) => get(`/v1/organisations/${org}/journal${requete}`, s);

    it('note qui a créé, modifié, annulé, sans doublon quand un appareil renvoie la même fiche', async () => {
      const patron = await seConnecter(banc, '77 500 00 01');
      await inviter(patron, { telephone: '77 500 00 02', role: 'personnalise', droits: ['saisie.ponte', 'saisie.annuler', 'cheptel.voir'], nom: 'Awa Fall', fonction: 'Aide' });
      const aide = await seConnecter(banc, '77 500 00 02');
      const org = patron.organisationId;
      const ponte = (t: number, extra: Record<string, unknown> = {}) => enreg('pontes', 'p1', MAINTENANT + t, { nombre: 9, casses: 0, lotId: 'l', ...extra });
      await sync(aide, 0, [ponte(1)], org);
      await sync(aide, 0, [ponte(1)], org);
      await sync(aide, 0, [ponte(2, { nombre: 10 })], org);
      await sync(aide, 0, [ponte(3, { nombre: 10, supprimeLe: MAINTENANT + 3 })], org);
      const r = (await journal(patron)).json() as { entrees: EntreeJournal[]; reste: boolean };
      const ponteEntrees = r.entrees.filter((x) => x.table === 'pontes');
      expect(ponteEntrees.map((x) => x.action)).toEqual(['annulation', 'modification', 'creation']);
      expect(ponteEntrees[2]).toMatchObject({ identifiant: aide.identifiant, nom: 'Awa Fall', fonction: 'Aide', description: '9 œufs', faitLe: MAINTENANT + 1, enregistrementId: 'p1' });
    });

    it('ne note pas ce qui a été refusé', async () => {
      const patron = await seConnecter(banc, '77 500 00 03');
      await inviter(patron, { telephone: '77 500 00 04', role: 'lecteur' });
      const lecteur = await seConnecter(banc, '77 500 00 04');
      await sync(lecteur, 0, [enreg('lots', 'x', MAINTENANT, { nom: 'Pirate' })], patron.organisationId);
      const r = (await journal(patron)).json() as { entrees: EntreeJournal[] };
      expect(r.entrees.some((x) => x.enregistrementId === 'x')).toBe(false);
    });

    it('note aussi les changements d’utilisateurs, et réserve la consultation aux autorisés', async () => {
      const patron = await seConnecter(banc, '77 500 00 05');
      const org = patron.organisationId;
      const moussa = (await inviter(patron, { telephone: '77 500 00 06', role: 'soigneur', nom: 'Moussa Diallo', fonction: 'Responsable bâtiment A' })).json().identifiant as string;
      await inviter(patron, { telephone: '77 500 00 06', role: 'caissier' });
      await post(`/v1/organisations/${org}/membres/${encodeURIComponent(moussa)}/deconnexion`, {}, patron);
      await banc.app.inject({ method: 'DELETE', url: `/v1/organisations/${org}/membres/${encodeURIComponent(moussa)}`, headers: patron.entetes });
      const r = (await journal(patron)).json() as { entrees: EntreeJournal[] };
      const phrases = r.entrees.filter((x) => x.action === 'utilisateur').map((x) => x.description);
      expect(phrases).toHaveLength(4);
      expect(phrases[3]).toMatch(/a ajouté Moussa Diallo \(Responsable bâtiment A\) · identifiant diallo\.moussa, profil soigneur/);
      expect(phrases[2]).toMatch(/a modifié les droits de Moussa Diallo/);
      expect(phrases[0]).toMatch(/a retiré/);

      await inviter(patron, { telephone: '77 500 00 07', role: 'soigneur' });
      expect((await journal(await seConnecter(banc, '77 500 00 07'), '', org)).statusCode).toBe(403);
      await inviter(patron, { telephone: '77 500 00 08', role: 'gerant' });
      expect((await journal(await seConnecter(banc, '77 500 00 08'), '', org)).statusCode).toBe(200);
    });

    it('pagine, filtre par personne ou par type, et reste propre à chaque élevage', async () => {
      const patron = await seConnecter(banc, '77 500 00 09');
      const autre = await seConnecter(banc, '77 500 00 10');
      await sync(patron, 0, [1, 2, 3, 4, 5].map((n) => enreg('pontes', `q${n}`, MAINTENANT + n, { nombre: n, casses: 0, lotId: 'l' })));
      await sync(patron, 0, [enreg('lots', 'lot-x', MAINTENANT, { nom: 'Soie' })]);
      await sync(autre, 0, [enreg('pontes', 'z', MAINTENANT, { nombre: 1, casses: 0, lotId: 'l' })]);
      const page1 = (await journal(patron, '?limite=3')).json() as { entrees: EntreeJournal[]; reste: boolean };
      expect(page1.entrees).toHaveLength(3);
      expect(page1.reste).toBe(true);
      const page2 = (await journal(patron, `?limite=10&avant=${page1.entrees.at(-1)!.id}`)).json() as { entrees: EntreeJournal[]; reste: boolean };
      expect(page2.entrees).toHaveLength(3);
      expect(page2.reste).toBe(false);
      expect(((await journal(patron, '?table=lots')).json() as { entrees: EntreeJournal[] }).entrees.map((x) => x.enregistrementId)).toEqual(['lot-x']);
      expect(((await journal(patron, `?identifiant=${patron.identifiant}`)).json() as { entrees: EntreeJournal[] }).entrees.every((x) => x.identifiant === patron.identifiant)).toBe(true);
      expect((await journal(patron)).json().entrees.some((x: EntreeJournal) => x.enregistrementId === 'z')).toBe(false);
      expect((await journal(patron, '', autre.organisationId)).statusCode).toBe(404);
    });
  });

  describe('bâtiments réservés (zones appliquées par le serveur)', () => {

    async function ferme(tel: string) {
      const patron = await seConnecter(banc, tel);
      await sync(patron, 0, [
        enreg('logements', 'A', MAINTENANT, { nom: 'Bâtiment A' }),
        enreg('logements', 'B', MAINTENANT, { nom: 'Bâtiment B' }),
        enreg('lots', 'l1', MAINTENANT, { nom: 'Lot 1', logementId: 'A' }),
        enreg('lots', 'l2', MAINTENANT, { nom: 'Lot 2', logementId: 'B' }),
        enreg('lots', 'l3', MAINTENANT, { nom: 'Lot sans local' }),
        enreg('mouvements', 'm1', MAINTENANT, { lotId: 'l1', type: 'arrivee', quantite: 5 }),
        enreg('mouvements', 'm2', MAINTENANT, { lotId: 'l2', type: 'arrivee', quantite: 7 }),
        enreg('pontes', 'po1', MAINTENANT, { lotId: 'l1', nombre: 3 }),
        enreg('pontes', 'po2', MAINTENANT, { lotId: 'l2', nombre: 4 }),
        enreg('distributions', 'di2', MAINTENANT, { lotId: 'l2', quantiteKg: 2 }),
        enreg('evenementsSante', 's2', MAINTENANT, { lotId: 'l2', type: 'observation' }),
        enreg('quarantaines', 'qa', MAINTENANT, { nom: 'Arrivage A', lotId: 'l1', logementId: 'A' }),
        enreg('quarantaines', 'qb', MAINTENANT, { nom: 'Arrivage B', lotId: 'l2', logementId: 'B' }),
        enreg('notesQuarantaine', 'na', MAINTENANT, { quarantaineId: 'qa' }),
        enreg('notesQuarantaine', 'nb', MAINTENANT, { quarantaineId: 'qb' }),
        enreg('operations', 'o-glob', MAINTENANT, { sens: 'depense', categorie: 'soins', montant: 1 }),
        enreg('operations', 'o-l1', MAINTENANT, { sens: 'depense', categorie: 'soins', montant: 2, lotId: 'l1' }),
        enreg('operations', 'o-l2', MAINTENANT, { sens: 'depense', categorie: 'soins', montant: 3, lotId: 'l2' }),
        enreg('paiements', 'pa-l1', MAINTENANT, { operationId: 'o-l1', montant: 2 }),
        enreg('paiements', 'pa-l2', MAINTENANT, { operationId: 'o-l2', montant: 3 }),
        enreg('entreesStock', 'st', MAINTENANT, { quantiteKg: 10 }),
      ]);
      return patron;
    }
    const ids = async (s: Session, org: string) => ((await sync(s, 0, [], org)).json() as ReponseSync).changements.map((c) => c.enregistrement.id).sort();

    it('ne renvoie que les bâtiments réservés, leurs lots et ce qui s’y rattache', async () => {
      const patron = await ferme('77 600 00 01');
      await inviter(patron, {
        telephone: '77 600 00 02', role: 'personnalise', zones: ['A'], fonction: 'Responsable bâtiment A',
        droits: ['saisie.ponte', 'saisie.aliment', 'cheptel.voir', 'sante.voir', 'quarantaine.voir', 'quarantaine.notes', 'finances.voir_depenses'],
      });
      const resp = await seConnecter(banc, '77 600 00 02');
      expect(await ids(resp, patron.organisationId)).toEqual(['A', 'l1', 'm1', 'na', 'o-glob', 'o-l1', 'pa-l1', 'po1', 'qa', 'st']);
      expect(await ids(patron, patron.organisationId)).toHaveLength(21);
    });

    it('n’accepte que des écritures dans ses bâtiments', async () => {
      const patron = await ferme('77 600 00 03');
      const org = patron.organisationId;
      await inviter(patron, { telephone: '77 600 00 04', role: 'personnalise', zones: ['A'], droits: ['saisie.ponte', 'cheptel.lots', 'cheptel.deplacer', 'quarantaine.notes'] });
      const resp = await seConnecter(banc, '77 600 00 04');
      const envoyer = async (...c: ChangementSync[]) => ((await sync(resp, 0, c, org)).json() as ReponseSync).refuses;
      expect(await envoyer(enreg('pontes', 'ok1', MAINTENANT + 1, { lotId: 'l1', nombre: 5 }))).toBe(0);
      expect(await envoyer(enreg('pontes', 'ko1', MAINTENANT + 1, { lotId: 'l2', nombre: 5 }))).toBe(1);
      expect(await envoyer(enreg('pontes', 'ko2', MAINTENANT + 1, { lotId: 'l3', nombre: 5 }))).toBe(1);
      expect(await envoyer(enreg('pontes', 'ko3', MAINTENANT + 1, { lotId: 'inconnu', nombre: 5 }))).toBe(1);
      expect(await envoyer(enreg('lots', 'neuf-a', MAINTENANT + 1, { nom: 'Neuf', logementId: 'A' }))).toBe(0);
      expect(await envoyer(enreg('lots', 'neuf-b', MAINTENANT + 1, { nom: 'Neuf', logementId: 'B' }))).toBe(1);
      expect(await envoyer(enreg('lots', 'l1', MAINTENANT + 2, { nom: 'Lot 1', logementId: 'B' }))).toBe(1);
      expect(await envoyer(enreg('lots', 'l2', MAINTENANT + 2, { nom: 'Lot 2', logementId: 'A' }))).toBe(1);
      expect(await envoyer(enreg('notesQuarantaine', 'nn', MAINTENANT + 1, { quarantaineId: 'qa' }))).toBe(0);
      expect(await envoyer(enreg('notesQuarantaine', 'nm', MAINTENANT + 1, { quarantaineId: 'qb' }))).toBe(1);
      const vus = await ids(patron, org);
      expect(vus).toContain('ok1');
      expect(vus).toContain('neuf-a');
      expect(vus).not.toContain('ko1');
      expect(vus).not.toContain('neuf-b');
    });

    it('sans zone, toute la ferme reste visible', async () => {
      const patron = await ferme('77 600 00 05');
      await inviter(patron, { telephone: '77 600 00 06', role: 'lecteur' });
      const lecteur = await seConnecter(banc, '77 600 00 06');
      const vus = await ids(lecteur, patron.organisationId);
      expect(vus).toEqual(expect.arrayContaining(['A', 'B', 'l1', 'l2', 'l3', 'm2', 'po2']));
    });
  });
});

describe('configuration du serveur', () => {
  it('exige une base de données', () => {
    expect(() => lireConfig({})).toThrow(/DATABASE_URL/);
  });
  it('exige un secret en production', () => {
    expect(() => lireConfig({ NODE_ENV: 'production', DATABASE_URL: 'x' })).toThrow(/DIGITALAB_SECRET/);
  });
  it('lit la clé d’installation si elle est donnée, sinon laisse le serveur en inventer une', () => {
    expect(lireConfig({ DATABASE_URL: 'x' }).cleInstallation).toBeNull();
    expect(lireConfig({ DATABASE_URL: 'x', DIGITALAB_CLE_INSTALLATION: ' abcd-efgh ' }).cleInstallation).toBe('abcd-efgh');
    expect(lireConfig({ DATABASE_URL: 'x' }).coutMotDePasse).toEqual({ N: 32768, r: 8, p: 3 });
  });
  it('lit les origines autorisées', () => {
    const c = lireConfig({ DATABASE_URL: 'x', DIGITALAB_ORIGINES: 'https://a.sn, https://b.sn' });
    expect(c.origines).toEqual(['https://a.sn', 'https://b.sn']);
    expect(lireConfig({ DATABASE_URL: 'x' }).origines).toBe(true);
  });

});
