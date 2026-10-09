import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChangementSync, EntreeJournal, ReponseSync } from '@digitalab/core';
import { creerBanc, seConnecter, URL_BASE_TEST, type Banc, type Session } from './test-utils.js';
import { lireConfig } from './config.js';

const MAINTENANT = 1_790_000_000_000;
const enreg = (table: ChangementSync['table'], id: string, misAJour: number, extra: Record<string, unknown> = {}): ChangementSync => ({ table, enregistrement: { id, misAJour, ...extra } });

describe.skipIf(!URL_BASE_TEST)('serveur (PostgreSQL requis : TEST_DATABASE_URL)', () => {
  let banc: Banc;
  beforeAll(async () => { banc = await creerBanc(); });
  afterAll(async () => { await banc.fermer(); });

  const post = (url: string, payload: unknown, s?: Session) => banc.app.inject({ method: 'POST', url, payload: payload as object, ...(s ? { headers: s.entetes } : {}) });
  const get = (url: string, s?: Session) => banc.app.inject({ method: 'GET', url, ...(s ? { headers: s.entetes } : {}) });
  const sync = async (s: Session, depuisSeq: number, changements: ChangementSync[] = [], org = s.organisationId) => post(`/v1/organisations/${org}/sync`, { depuisSeq, changements }, s);

  describe('connexion par téléphone', () => {
    it('refuse un numéro invalide', async () => {
      const r = await post('/v1/auth/code', { telephone: '123' });
      expect(r.statusCode).toBe(400);
      expect(r.json().erreur).toMatch(/invalide/);
    });

    it('crée le compte et un premier élevage dont on est propriétaire', async () => {
      const s = await seConnecter(banc, '77 100 00 01');
      expect(s.telephone).toBe('+221771000001');
      const moi = (await get('/v1/moi', s)).json();
      expect(moi.utilisateur.telephone).toBe('+221771000001');
      expect(moi.organisations).toMatchObject([{ nom: 'Mon élevage', role: 'proprietaire' }]);
    });

    it('retrouve le même compte et le même élevage à la connexion suivante', async () => {
      const a = await seConnecter(banc, '77 100 00 02');
      const b = await seConnecter(banc, '+221771000002');
      expect(b.organisationId).toBe(a.organisationId);
      expect(b.jeton).not.toBe(a.jeton);
    });

    it('ne stocke ni le code ni le jeton en clair', async () => {
      const s = await seConnecter(banc, '77 100 00 03');
      const sessions = (await banc.pool.query('SELECT jeton_hash FROM sessions')).rows.map((r) => r.jeton_hash);
      expect(sessions).not.toContain(s.jeton);
      await post('/v1/auth/code', { telephone: '77 100 00 03' });
      const code = banc.codes.get('+221771000003')!;
      const stocke = (await banc.pool.query('SELECT code_hash FROM codes_connexion WHERE telephone = $1', ['+221771000003'])).rows[0].code_hash;
      expect(stocke).not.toBe(code);
      expect(stocke).toHaveLength(64);
    });

    it('limite les demandes de code à une par minute', async () => {
      expect((await post('/v1/auth/code', { telephone: '77 100 00 04' })).statusCode).toBe(200);
      const r = await post('/v1/auth/code', { telephone: '77 100 00 04' });
      expect(r.statusCode).toBe(429);
      banc.horloge.maintenant = new Date(banc.horloge.maintenant.getTime() + 61_000);
      expect((await post('/v1/auth/code', { telephone: '77 100 00 04' })).statusCode).toBe(200);
    });

    it('refuse un mauvais code, bloque après 5 essais, même avec le bon code', async () => {
      await post('/v1/auth/code', { telephone: '77 100 00 05' });
      const bon = banc.codes.get('+221771000005')!;
      const faux = bon === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++) expect((await post('/v1/auth/connexion', { telephone: '77 100 00 05', code: faux })).statusCode).toBe(400);
      const r = await post('/v1/auth/connexion', { telephone: '77 100 00 05', code: bon });
      expect(r.statusCode).toBe(429);
    });

    it('refuse un code expiré', async () => {
      await post('/v1/auth/code', { telephone: '77 100 00 06' });
      const code = banc.codes.get('+221771000006')!;
      banc.horloge.maintenant = new Date(banc.horloge.maintenant.getTime() + 11 * 60_000);
      const r = await post('/v1/auth/connexion', { telephone: '77 100 00 06', code });
      expect(r.statusCode).toBe(400);
      expect(r.json().erreur).toMatch(/expiré/);
    });

    it('un code ne sert qu’une fois', async () => {
      await post('/v1/auth/code', { telephone: '77 100 00 07' });
      const code = banc.codes.get('+221771000007')!;
      expect((await post('/v1/auth/connexion', { telephone: '77 100 00 07', code })).statusCode).toBe(200);
      expect((await post('/v1/auth/connexion', { telephone: '77 100 00 07', code })).statusCode).toBe(400);
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

  describe('élevage, invitations et rôles', () => {
    it('le propriétaire invite une personne, qui trouve l’élevage à sa première connexion', async () => {
      const patron = await seConnecter(banc, '77 200 00 01');
      const inv = await post(`/v1/organisations/${patron.organisationId}/membres`, { telephone: '77 200 00 02', role: 'soigneur' }, patron);
      expect(inv.statusCode).toBe(200);
      let liste = (await get(`/v1/organisations/${patron.organisationId}/membres`, patron)).json().membres;
      expect(liste).toMatchObject([{ telephone: '+221772000001', role: 'proprietaire', actif: true }, { telephone: '+221772000002', role: 'soigneur', actif: false }]);
      const aide = await seConnecter(banc, '77 200 00 02');
      expect(aide.organisationId).toBe(patron.organisationId);
      const moi = (await get('/v1/moi', aide)).json();
      expect(moi.organisations).toHaveLength(1);
      expect(moi.organisations[0].role).toBe('soigneur');
      liste = (await get(`/v1/organisations/${patron.organisationId}/membres`, patron)).json().membres;
      expect(liste.find((m: { telephone: string }) => m.telephone === '+221772000002').actif).toBe(true);
    });

    it('invite quelqu’un qui a déjà un compte, qui garde son propre élevage en plus', async () => {
      const patron = await seConnecter(banc, '77 200 00 03');
      const autre = await seConnecter(banc, '77 200 00 04');
      await post(`/v1/organisations/${patron.organisationId}/membres`, { telephone: '77 200 00 04', role: 'veterinaire' }, patron);
      const moi = (await get('/v1/moi', autre)).json();
      expect(moi.organisations.map((o: { role: string }) => o.role).sort()).toEqual(['proprietaire', 'veterinaire']);
    });

    it('seul le propriétaire invite, retire ou renomme', async () => {
      const patron = await seConnecter(banc, '77 200 00 05');
      await post(`/v1/organisations/${patron.organisationId}/membres`, { telephone: '77 200 00 06', role: 'soigneur' }, patron);
      const aide = await seConnecter(banc, '77 200 00 06');
      const org = patron.organisationId;
      expect((await post(`/v1/organisations/${org}/membres`, { telephone: '77 200 00 07', role: 'lecteur' }, aide)).statusCode).toBe(403);
      expect((await banc.app.inject({ method: 'DELETE', url: `/v1/organisations/${org}/membres/${encodeURIComponent('+221772000005')}`, headers: aide.entetes })).statusCode).toBe(403);
      expect((await banc.app.inject({ method: 'PATCH', url: `/v1/organisations/${org}`, payload: { nom: 'Pris' }, headers: aide.entetes })).statusCode).toBe(403);
      expect((await banc.app.inject({ method: 'PATCH', url: `/v1/organisations/${org}`, payload: { nom: 'Ferme Sow' }, headers: patron.entetes })).statusCode).toBe(200);
      expect((await get('/v1/moi', patron)).json().organisations[0].nom).toBe('Ferme Sow');
    });

    it('ne laisse pas inviter avec le rôle propriétaire ni retirer le propriétaire', async () => {
      const patron = await seConnecter(banc, '77 200 00 08');
      const org = patron.organisationId;
      expect((await post(`/v1/organisations/${org}/membres`, { telephone: '77 200 00 09', role: 'proprietaire' }, patron)).statusCode).toBe(400);
      expect((await post(`/v1/organisations/${org}/membres`, { telephone: '77 200 00 08', role: 'lecteur' }, patron)).statusCode).toBe(400);
      expect((await banc.app.inject({ method: 'DELETE', url: `/v1/organisations/${org}/membres/${encodeURIComponent('+221772000008')}`, headers: patron.entetes })).statusCode).toBe(400);
    });

    it('retire une personne : elle perd l’accès', async () => {
      const patron = await seConnecter(banc, '77 200 00 10');
      await post(`/v1/organisations/${patron.organisationId}/membres`, { telephone: '77 200 00 11', role: 'soigneur' }, patron);
      const aide = await seConnecter(banc, '77 200 00 11');
      expect((await sync(aide, 0, [], patron.organisationId)).statusCode).toBe(200);
      const r = await banc.app.inject({ method: 'DELETE', url: `/v1/organisations/${patron.organisationId}/membres/${encodeURIComponent('+221772000011')}`, headers: patron.entetes });
      expect(r.statusCode).toBe(200);
      expect((await sync(aide, 0, [], patron.organisationId)).statusCode).toBe(404);
    });

    it('cloisonne les élevages entre eux', async () => {
      const a = await seConnecter(banc, '77 200 00 12');
      const b = await seConnecter(banc, '77 200 00 13');
      expect((await sync(a, 0, [enreg('lots', 'l1', MAINTENANT)])).statusCode).toBe(200);
      expect((await sync(b, 0, [], a.organisationId)).statusCode).toBe(404);
      expect((await get(`/v1/organisations/${a.organisationId}/membres`, b)).statusCode).toBe(404);
      expect((await sync(b, 0)).json().changements).toEqual([]);
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
      await post(`/v1/organisations/${patron.organisationId}/membres`, { telephone: '77 300 00 10', role: 'lecteur' }, patron);
      const lecteur = await seConnecter(banc, '77 300 00 10');
      expect(((await sync(lecteur, 0, [], patron.organisationId)).json() as ReponseSync).changements).toHaveLength(1);
      expect((await sync(lecteur, 0, [enreg('lots', 'l2', MAINTENANT)], patron.organisationId)).statusCode).toBe(403);

      await post(`/v1/organisations/${patron.organisationId}/membres`, { telephone: '77 300 00 09', role: 'veterinaire' }, patron);
      const veto = await seConnecter(banc, '77 300 00 09');
      const r: ReponseSync = (await sync(veto, 0, [enreg('lots', 'l3', MAINTENANT), enreg('evenementsSante', 's1', MAINTENANT, { lotId: 'l1' })], patron.organisationId)).json();
      expect(r.refuses).toBe(1);
      const vu: ReponseSync = (await sync(patron, 0)).json();
      expect(vu.changements.map((c) => c.enregistrement.id).sort()).toEqual(['l1', 's1']);
      expect((await sync(patron, 0)).json().changements).toHaveLength(2);
    });

    it('laisse un soigneur écrire', async () => {
      const patron = await seConnecter(banc, '77 300 00 11');
      await post(`/v1/organisations/${patron.organisationId}/membres`, { telephone: '77 300 00 12', role: 'soigneur' }, patron);
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

  describe('droits fins, invitations et validation', () => {
    const inviter = (patron: Session, corps: Record<string, unknown>) => post(`/v1/organisations/${patron.organisationId}/membres`, corps, patron);

    it('renvoie un code d’invitation à usage unique, qui permet de se connecter sans SMS', async () => {
      const patron = await seConnecter(banc, '77 400 00 01');
      const inv = (await inviter(patron, { telephone: '77 400 00 02', role: 'soigneur', fonction: 'Responsable bâtiment A', nom: 'Moussa' })).json();
      expect(inv.codeInvitation).toMatch(/^\d{6}$/);
      const liste = (await get(`/v1/organisations/${patron.organisationId}/membres`, patron)).json().membres;
      expect(liste.find((m: { telephone: string }) => m.telephone === '+221774000002')).toMatchObject({ nom: 'Moussa', fonction: 'Responsable bâtiment A', invitationEnCours: true, actif: false });

      expect((await post('/v1/auth/connexion', { telephone: '77 400 00 02', code: '000000' })).statusCode).toBe(400);
      const ok = await post('/v1/auth/connexion', { telephone: '77 400 00 02', code: inv.codeInvitation });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().organisations[0]).toMatchObject({ id: patron.organisationId, role: 'soigneur', fonction: 'Responsable bâtiment A' });
      expect((await post('/v1/auth/connexion', { telephone: '77 400 00 02', code: inv.codeInvitation })).statusCode).toBe(400);
    });

    it('bloque les essais répétés et refuse une invitation périmée', async () => {
      const patron = await seConnecter(banc, '77 400 00 03');
      const inv = (await inviter(patron, { telephone: '77 400 00 04', role: 'lecteur' })).json();
      for (let i = 0; i < 5; i++) expect((await post('/v1/auth/connexion', { telephone: '77 400 00 04', code: '111111' })).statusCode).toBe(400);
      expect((await post('/v1/auth/connexion', { telephone: '77 400 00 04', code: inv.codeInvitation })).statusCode).toBe(429);
      const inv2 = (await inviter(patron, { telephone: '77 400 00 04', nouveauCode: true })).json();
      banc.horloge.maintenant = new Date(banc.horloge.maintenant.getTime() + 8 * 86_400_000);
      expect((await post('/v1/auth/connexion', { telephone: '77 400 00 04', code: inv2.codeInvitation })).statusCode).toBe(400);
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
      expect((await post(`/v1/organisations/${org}/membres`, { telephone: '77 400 00 25', role: 'lecteur' }, gerant)).statusCode).toBe(403);
      expect((await get(`/v1/organisations/${org}/membres`, gerant)).statusCode).toBe(403);

      await inviter(patron, { telephone: '77 400 00 26', role: 'personnalise', droits: ['admin.utilisateurs', 'cheptel.voir'] });
      const delegue = await seConnecter(banc, '77 400 00 26');
      expect((await post(`/v1/organisations/${org}/membres`, { telephone: '77 400 00 27', role: 'lecteur' }, delegue)).statusCode).toBe(200);
      expect((await post(`/v1/organisations/${org}/membres`, { telephone: '77 400 00 28', role: 'personnalise', droits: ['admin.utilisateurs'] }, delegue)).statusCode).toBe(403);
      expect((await post(`/v1/organisations/${org}/membres`, { telephone: '77 400 00 24', role: 'lecteur' }, delegue)).statusCode).toBe(200);
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

    it('ne laisse pas modifier le propriétaire, et ignore les droits inconnus', async () => {
      const patron = await seConnecter(banc, '77 400 00 31');
      expect((await inviter(patron, { telephone: '77 400 00 31', role: 'lecteur' })).statusCode).toBe(400);
      await inviter(patron, { telephone: '77 400 00 32', role: 'personnalise', droits: ['saisie.ponte', 'n.importe.quoi'] });
      const liste = (await get(`/v1/organisations/${patron.organisationId}/membres`, patron)).json().membres;
      expect(liste.find((m: { telephone: string }) => m.telephone === '+221774000032').droits).toEqual(['saisie.ponte']);
    });

    it('déconnecte les appareils d’une personne', async () => {
      const patron = await seConnecter(banc, '77 400 00 33');
      await inviter(patron, { telephone: '77 400 00 34', role: 'soigneur' });
      const aide = await seConnecter(banc, '77 400 00 34');
      expect((await get('/v1/moi', aide)).statusCode).toBe(200);
      const r = await post(`/v1/organisations/${patron.organisationId}/membres/${encodeURIComponent('+221774000034')}/deconnexion`, {}, patron);
      expect(r.statusCode).toBe(200);
      expect((await get('/v1/moi', aide)).statusCode).toBe(401);
      expect((await post(`/v1/organisations/${patron.organisationId}/membres/${encodeURIComponent('+221774000033')}/deconnexion`, {}, patron)).statusCode).toBe(400);
    });
  });

  describe('journal d’activité', () => {
    const inviter = (patron: Session, corps: Record<string, unknown>) => post(`/v1/organisations/${patron.organisationId}/membres`, corps, patron);
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
      expect(ponteEntrees[2]).toMatchObject({ telephone: '+221775000002', nom: 'Awa Fall', fonction: 'Aide', description: '9 œufs', faitLe: MAINTENANT + 1, enregistrementId: 'p1' });
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
      await inviter(patron, { telephone: '77 500 00 06', role: 'soigneur', nom: 'Moussa', fonction: 'Responsable bâtiment A' });
      await inviter(patron, { telephone: '77 500 00 06', role: 'caissier' });
      await post(`/v1/organisations/${org}/membres/${encodeURIComponent('+221775000006')}/deconnexion`, {}, patron);
      await banc.app.inject({ method: 'DELETE', url: `/v1/organisations/${org}/membres/${encodeURIComponent('+221775000006')}`, headers: patron.entetes });
      const r = (await journal(patron)).json() as { entrees: EntreeJournal[] };
      const phrases = r.entrees.filter((x) => x.action === 'utilisateur').map((x) => x.description);
      expect(phrases).toHaveLength(4);
      expect(phrases[3]).toMatch(/a ajouté Moussa \(Responsable bâtiment A\) · profil soigneur/);
      expect(phrases[2]).toMatch(/a modifié les droits de Moussa/);
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
      expect(((await journal(patron, '?telephone=77%20500%2000%2009')).json() as { entrees: EntreeJournal[] }).entrees.every((x) => x.telephone === '+221775000009')).toBe(true);
      expect((await journal(patron)).json().entrees.some((x: EntreeJournal) => x.enregistrementId === 'z')).toBe(false);
      expect((await journal(patron, '', autre.organisationId)).statusCode).toBe(404);
    });
  });

  describe('bâtiments réservés (zones appliquées par le serveur)', () => {
    const inviter = (patron: Session, corps: Record<string, unknown>) => post(`/v1/organisations/${patron.organisationId}/membres`, corps, patron);

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
  it('exige un secret en production et interdit le code de démonstration', () => {
    expect(() => lireConfig({ NODE_ENV: 'production', DATABASE_URL: 'x' })).toThrow(/DIGITALAB_SECRET/);
    expect(() => lireConfig({ NODE_ENV: 'production', DATABASE_URL: 'x', DIGITALAB_SECRET: 'un-secret-assez-long', DIGITALAB_CODE_DEMO: '1' })).toThrow(/CODE_DEMO/);
  });
  it('lit les origines autorisées', () => {
    const c = lireConfig({ DATABASE_URL: 'x', DIGITALAB_ORIGINES: 'https://a.sn, https://b.sn' });
    expect(c.origines).toEqual(['https://a.sn', 'https://b.sn']);
    expect(lireConfig({ DATABASE_URL: 'x' }).origines).toBe(true);
  });

});
