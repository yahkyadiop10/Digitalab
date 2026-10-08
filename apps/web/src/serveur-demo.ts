import { PROFILS_ASSIGNABLES, droitsDuProfil, droitsEffectifs, nettoyerDroits, normaliserTelephone, type DroitsMembre, type RoleMembre } from '@digitalab/core';

/**
 * Faux serveur qui vit dans la page : il sert à essayer les comptes et la gestion des utilisateurs dans l'aperçu,
 * où aucun vrai serveur n'est joignable. Il ne garde rien après un rechargement et n'échange aucune donnée d'élevage.
 */
interface MembreDemo extends DroitsMembre {
  telephone: string;
  nom: string | null;
  actif: boolean;
  codeInvitation?: string;
}

export const URL_SERVEUR_APERCU = 'https://serveur-demonstration.digitalab';
export const CODE_APERCU = '123456';

export function creerServeurDemo() {
  const membres = new Map<string, MembreDemo>();
  const sessions = new Map<string, string>();
  const organisation = { id: 'org-demonstration', nom: 'Mon élevage' };

  const repondre = (statut: number, corps: unknown) => new Response(JSON.stringify(corps), { status: statut, headers: { 'content-type': 'application/json' } });
  const erreur = (statut: number, message: string) => repondre(statut, { erreur: message });
  const moi = (m: MembreDemo): DroitsMembre & { id: string; nom: string } => ({ ...organisation, role: m.role, droits: m.droits, zones: m.zones, ...(m.fonction ? { fonction: m.fonction } : {}) });
  const code6 = () => String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');

  return async (entree: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof entree === 'string' ? entree : entree instanceof URL ? entree.href : entree.url);
    const chemin = url.pathname;
    const methode = (init?.method ?? 'GET').toUpperCase();
    const corps = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const jeton = (new Headers(init?.headers).get('authorization') ?? '').replace('Bearer ', '');
    const moiMembre = sessions.has(jeton) ? membres.get(sessions.get(jeton)!) : undefined;

    if (chemin === '/v1/auth/code') {
      const tel = normaliserTelephone(String(corps['telephone'] ?? ''));
      if (!tel) return erreur(400, 'Numéro de téléphone invalide. Exemple : 77 123 45 67.');
      return repondre(200, { ok: true, telephone: tel, codeDemo: CODE_APERCU });
    }

    if (chemin === '/v1/auth/connexion') {
      const tel = normaliserTelephone(String(corps['telephone'] ?? ''));
      const code = String(corps['code'] ?? '');
      if (!tel) return erreur(400, 'Numéro de téléphone invalide.');
      let m = membres.get(tel);
      if (m?.codeInvitation && m.codeInvitation === code) {
        delete m.codeInvitation;
        m.actif = true;
      } else if (code === CODE_APERCU) {
        if (!m && membres.size === 0) {
          m = { telephone: tel, nom: null, actif: true, role: 'proprietaire', droits: droitsEffectifs('proprietaire', null), zones: [] };
          membres.set(tel, m);
        }
        if (!m) return erreur(400, 'Démonstration : ce numéro n’a pas été ajouté. Utilisez le code donné par l’administrateur.');
        m.actif = true;
      } else {
        return erreur(400, 'Code invalide ou expiré. Demandez un nouveau code.');
      }
      const nouveau = `jeton-${code6()}${code6()}`;
      sessions.set(nouveau, tel);
      return repondre(200, { jeton: nouveau, utilisateur: { telephone: tel }, organisations: [moi(m)] });
    }

    if (chemin === '/v1/auth/deconnexion') {
      sessions.delete(jeton);
      return repondre(200, { ok: true });
    }

    if (!moiMembre) return erreur(401, 'Session expirée. Reconnectez-vous.');
    const estAdmin = moiMembre.droits.includes('admin.utilisateurs');

    if (/^\/v1\/organisations\/[^/]+\/sync$/.test(chemin)) {
      return repondre(200, { seq: 0, changements: [], reste: false, ecartes: 0, refuses: 0, moi: { role: moiMembre.role, droits: moiMembre.droits, zones: moiMembre.zones, ...(moiMembre.fonction ? { fonction: moiMembre.fonction } : {}) } });
    }

    if (/^\/v1\/organisations\/[^/]+$/.test(chemin) && methode === 'PATCH') {
      if (!moiMembre.droits.includes('admin.elevage')) return erreur(403, 'Vous n’avez pas le droit de modifier les informations de l’élevage.');
      organisation.nom = String(corps['nom'] ?? organisation.nom);
      return repondre(200, { ok: true });
    }

    const m = chemin.match(/^\/v1\/organisations\/[^/]+\/membres(?:\/([^/]+)(\/deconnexion)?)?$/);
    if (m) {
      if (!estAdmin) return erreur(403, 'Seuls les administrateurs voient la liste des utilisateurs.');
      const cible = m[1] ? normaliserTelephone(decodeURIComponent(m[1])) : null;
      if (methode === 'GET') {
        return repondre(200, {
          membres: [...membres.values()].map((x) => ({ telephone: x.telephone, role: x.role, nom: x.nom, fonction: x.fonction ?? null, droits: x.droits, zones: x.zones, actif: x.actif, invitationEnCours: !!x.codeInvitation })),
        });
      }
      if (methode === 'DELETE' && cible) {
        if (membres.get(cible)?.role === 'proprietaire') return erreur(400, 'Le propriétaire ne peut pas être retiré.');
        membres.delete(cible);
        return repondre(200, { ok: true });
      }
      if (methode === 'POST' && cible && m[2]) {
        for (const [j, t] of sessions) if (t === cible) sessions.delete(j);
        return repondre(200, { ok: true });
      }
      if (methode === 'POST' && !m[1]) {
        const tel = normaliserTelephone(String(corps['telephone'] ?? ''));
        if (!tel) return erreur(400, 'Numéro de téléphone invalide. Exemple : 77 123 45 67.');
        const existant = membres.get(tel);
        if (existant?.role === 'proprietaire') return erreur(400, 'Les droits du propriétaire ne se modifient pas.');
        const roleDemande = corps['role'] as RoleMembre | undefined;
        if (!existant && !roleDemande && !corps['droits']) return erreur(400, 'Choisissez un profil ou cochez des droits.');
        if (roleDemande && !PROFILS_ASSIGNABLES.includes(roleDemande as never)) return erreur(400, 'Profil inconnu.');
        const role: RoleMembre = roleDemande ?? (corps['droits'] ? 'personnalise' : existant!.role);
        const droits = nettoyerDroits((corps['droits'] as string[] | undefined) ?? (roleDemande ? droitsDuProfil(roleDemande) : existant!.droits));
        if (droits.includes('admin.utilisateurs') && moiMembre.role !== 'proprietaire') return erreur(403, 'Seul le propriétaire peut donner le droit de gérer les utilisateurs.');
        const nouveauCode = corps['nouveauCode'] === true || !existant;
        const fonction = String(corps['fonction'] ?? '').trim();
        const fiche: MembreDemo = {
          telephone: tel, role, droits, zones: (corps['zones'] as string[] | undefined) ?? existant?.zones ?? [],
          nom: String(corps['nom'] ?? '').trim() || existant?.nom || null, actif: existant?.actif ?? false,
          ...(fonction ? { fonction } : existant?.fonction ? { fonction: existant.fonction } : {}),
          ...(existant?.codeInvitation ? { codeInvitation: existant.codeInvitation } : {}),
        };
        let codeInvitation: string | undefined;
        if (nouveauCode) {
          codeInvitation = code6();
          fiche.codeInvitation = codeInvitation;
        }
        membres.set(tel, fiche);
        return repondre(200, { ok: true, telephone: tel, role, ...(codeInvitation ? { codeInvitation } : {}) });
      }
    }

    return erreur(404, 'Adresse inconnue.');
  };
}
