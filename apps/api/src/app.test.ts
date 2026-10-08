import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChangementSync, ReponseSync } from '@digitalab/core';
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

    it('refuse les rôles en lecture quand ils envoient des modifications, mais leur laisse lire', async () => {
      const patron = await seConnecter(banc, '77 300 00 08');
      await sync(patron, 0, [enreg('lots', 'l1', MAINTENANT, { nom: 'Soie' })]);
      for (const [tel, role] of [['77 300 00 09', 'veterinaire'], ['77 300 00 10', 'lecteur']] as const) {
        await post(`/v1/organisations/${patron.organisationId}/membres`, { telephone: tel, role }, patron);
        const lecteur = await seConnecter(banc, tel);
        const lecture: ReponseSync = (await sync(lecteur, 0, [], patron.organisationId)).json();
        expect(lecture.changements).toHaveLength(1);
        const ecriture = await sync(lecteur, 0, [enreg('lots', 'l2', MAINTENANT)], patron.organisationId);
        expect(ecriture.statusCode).toBe(403);
      }
      expect((await sync(patron, 0)).json().changements).toHaveLength(1);
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
