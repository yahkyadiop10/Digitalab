import {
  LIBELLES_PROFILS, PROFILS_ASSIGNABLES, droitsDuProfil, droitsEffectifs, identifiantDepuisNom, identifiantLibre, nettoyerDroits, normaliserIdentifiant, normaliserTelephone,
  problemeIdentifiant, problemeMotDePasse, type DroitsMembre, type EntreeJournal, type RoleMembre,
} from '@digitalab/core';

/**
 * Faux serveur qui vit dans la page : il sert à essayer la connexion, les mots de passe et la gestion des utilisateurs dans l'aperçu,
 * où aucun vrai serveur n'est joignable. Il ne garde rien après un rechargement et n'échange aucune donnée d'élevage.
 * (Il n'a pas la sécurité du vrai serveur : pas de blocage après des échecs, mots de passe gardés en clair dans la page.)
 */
interface CompteDemo extends DroitsMembre {
  identifiant: string;
  nom: string | null;
  telephone: string | null;
  motDePasse: string;
  provisoire: boolean;
}

export const URL_SERVEUR_APERCU = 'https://mon-elevage.avimaster.demo';

/** Compte de l'aperçu, comme celui que le vrai serveur crée à son premier démarrage. */
export const ADMIN_APERCU = { identifiant: 'admin', motDePasseProvisoire: '123456' };
const codeAleatoire = () => String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');

export function creerServeurDemo() {
  const comptes = new Map<string, CompteDemo>();
  const sessions = new Map<string, string>();
  const organisation = { id: 'org-demonstration', nom: 'Mon élevage' };
  const journal: EntreeJournal[] = [];
  const noter = (acteur: CompteDemo | { identifiant: string; nom: string | null; fonction?: string }, action: EntreeJournal['action'], table: string, description: string, ilYaMinutes = 0, horsLigne = 0) => {
    const maintenant = Date.now() - ilYaMinutes * 60_000;
    journal.unshift({
      id: journal.length + 1, faitLe: maintenant - horsLigne * 60_000, recuLe: new Date(maintenant).toISOString(), identifiant: acteur.identifiant, nom: acteur.nom, fonction: acteur.fonction ?? null,
      action, table, enregistrementId: `demo-${journal.length + 1}`, description,
    });
  };
  /** Quelques lignes d'exemple, pour montrer à quoi ressemble le journal. */
  const amorcer = (patron: CompteDemo) => {
    const awa = { identifiant: 'fall.awa', nom: 'Awa Fall', fonction: 'Aide' };
    noter(awa, 'creation', 'pontes', '48 œufs', 190);
    noter(awa, 'creation', 'distributions', '12 kg', 185);
    noter(awa, 'creation', 'mouvements', 'décès · 2 animaux', 140);
    noter(patron, 'creation', 'operations', 'recette · 45 000 FCFA · Boutique Awa · F-2026-0001', 95);
    noter(awa, 'annulation', 'mouvements', 'décès · 2 animaux', 60);
    noter(awa, 'creation', 'pontes', '51 œufs', 30, 240);
  };

  const patron: CompteDemo = {
    identifiant: ADMIN_APERCU.identifiant, nom: null, telephone: null, motDePasse: ADMIN_APERCU.motDePasseProvisoire, provisoire: true,
    role: 'proprietaire', droits: droitsEffectifs('proprietaire', null), zones: [],
  };
  comptes.set(patron.identifiant, patron);
  amorcer(patron);

  const repondre = (statut: number, corps: unknown) => new Response(JSON.stringify(corps), { status: statut, headers: { 'content-type': 'application/json' } });
  const erreur = (statut: number, message: string, code?: string) => repondre(statut, { erreur: message, ...(code ? { code } : {}) });
  const orga = (m: CompteDemo) => ({ ...organisation, role: m.role, droits: m.droits, zones: m.zones, ...(m.fonction ? { fonction: m.fonction } : {}) });
  const publique = (m: CompteDemo) => ({ id: `u-${m.identifiant}`, identifiant: m.identifiant, nom: m.nom, telephone: m.telephone });
  const jetonAleatoire = () => `jeton-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  const ouvrir = (m: CompteDemo) => {
    const jeton = jetonAleatoire();
    sessions.set(jeton, m.identifiant);
    return jeton;
  };
  const finirSessions = (identifiant: string, sauf?: string) => {
    for (const [j, i] of sessions) if (i === identifiant && j !== sauf) sessions.delete(j);
  };
  /** Un mot de passe provisoire se recopie : majuscules et espaces tolérés. */
  const juste = (m: CompteDemo, saisi: string) => saisi === m.motDePasse || (m.provisoire && saisi.trim().toLowerCase() === m.motDePasse);
  const provisoire = (m: CompteDemo) => ({ ok: true, identifiant: m.identifiant, nom: m.nom, motDePasseProvisoire: m.motDePasse, expireLe: new Date(Date.now() + 5 * 86_400_000).toISOString() });

  return async (entree: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof entree === 'string' ? entree : entree instanceof URL ? entree.href : entree.url);
    const chemin = url.pathname;
    const methode = (init?.method ?? 'GET').toUpperCase();
    const corps = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const jeton = (new Headers(init?.headers).get('authorization') ?? '').replace('Bearer ', '');
    const moiCompte = sessions.has(jeton) ? comptes.get(sessions.get(jeton)!) : undefined;

    if (chemin === '/v1/sante') return repondre(200, { ok: true });

    if (chemin === '/v1/auth/connexion') {
      const m = comptes.get(normaliserIdentifiant(String(corps['identifiant'] ?? '')));
      if (!m || !juste(m, String(corps['motDePasse'] ?? ''))) return erreur(401, 'Identifiant ou mot de passe incorrect.');
      return repondre(200, { jeton: ouvrir(m), utilisateur: publique(m), doitChanger: m.provisoire, organisations: [orga(m)] });
    }

    if (chemin === '/v1/auth/deconnexion') {
      sessions.delete(jeton);
      return repondre(200, { ok: true });
    }

    if (!moiCompte) return erreur(401, 'Session expirée. Reconnectez-vous.');
    const m0 = moiCompte;

    if (chemin === '/v1/moi' && methode === 'GET') {
      return repondre(200, { utilisateur: { ...publique(m0), doitChanger: m0.provisoire }, organisations: [orga(m0)] });
    }

    if (chemin === '/v1/moi/mot-de-passe') {
      if (!juste(m0, String(corps['ancien'] ?? ''))) return erreur(400, 'Le mot de passe actuel est incorrect.');
      const nouveau = String(corps['nouveau'] ?? '');
      const probleme = problemeMotDePasse(nouveau, m0.identifiant);
      if (probleme) return erreur(400, probleme);
      if (nouveau === String(corps['ancien'])) return erreur(400, 'Choisissez un mot de passe différent de l’actuel.');
      noter(m0, 'utilisateur', 'utilisateurs', m0.provisoire ? 'a choisi son mot de passe personnel' : 'a changé son mot de passe');
      m0.motDePasse = nouveau;
      m0.provisoire = false;
      finirSessions(m0.identifiant, jeton);
      return repondre(200, { ok: true });
    }

    // Tant que le mot de passe provisoire n'est pas remplacé, rien d'autre n'est ouvert.
    if (m0.provisoire) return erreur(403, 'Choisissez d’abord votre propre mot de passe.', 'changement_requis');

    if (chemin === '/v1/moi' && methode === 'PATCH') {
      if (corps['nom'] !== undefined) m0.nom = String(corps['nom']).trim() || null;
      if (corps['telephone'] !== undefined) {
        const brut = String(corps['telephone']).trim();
        const tel = brut ? normaliserTelephone(brut) : null;
        if (brut && !tel) return erreur(400, 'Numéro de téléphone invalide. Exemple : 77 123 45 67.');
        m0.telephone = tel;
      }
      return repondre(200, { ok: true });
    }

    const estAdmin = m0.droits.includes('admin.utilisateurs');

    if (/^\/v1\/organisations\/[^/]+\/sync$/.test(chemin)) {
      return repondre(200, { seq: 0, changements: [], reste: false, ecartes: 0, refuses: 0, moi: { role: m0.role, droits: m0.droits, zones: m0.zones, ...(m0.fonction ? { fonction: m0.fonction } : {}) } });
    }

    if (/^\/v1\/organisations\/[^/]+$/.test(chemin) && methode === 'PATCH') {
      if (!m0.droits.includes('admin.elevage')) return erreur(403, 'Vous n’avez pas le droit de modifier les informations de l’élevage.');
      organisation.nom = String(corps['nom'] ?? organisation.nom);
      return repondre(200, { ok: true });
    }

    if (/^\/v1\/organisations\/[^/]+\/journal$/.test(chemin)) {
      if (!m0.droits.includes('admin.journal')) return erreur(403, 'Vous n’avez pas le droit de consulter le journal d’activité.');
      const avant = Number(url.searchParams.get('avant')) || Infinity;
      const qui = url.searchParams.get('identifiant');
      const limite = Number(url.searchParams.get('limite')) || 50;
      const choisies = journal.filter((x) => x.id < avant && (!qui || x.identifiant === normaliserIdentifiant(qui)));
      return repondre(200, { entrees: choisies.slice(0, limite), reste: choisies.length > limite });
    }

    const m = chemin.match(/^\/v1\/organisations\/[^/]+\/membres(?:\/([^/]+)(?:\/(deconnexion|mot-de-passe))?)?$/);
    if (m) {
      if (!estAdmin) return erreur(403, 'Seuls les administrateurs voient la liste des utilisateurs.');
      const cible = m[1] ? comptes.get(normaliserIdentifiant(decodeURIComponent(m[1]))) : undefined;
      const action = m[2];
      if (methode === 'GET' && !m[1]) {
        return repondre(200, {
          membres: [...comptes.values()].sort((a, b) => Number(b.role === 'proprietaire') - Number(a.role === 'proprietaire')).map((x) => ({
            identifiant: x.identifiant, nom: x.nom, telephone: x.telephone, role: x.role, fonction: x.fonction ?? null, droits: x.droits, zones: x.zones,
            etat: x.provisoire ? 'provisoire' : 'actif', derniereConnexion: null,
          })),
        });
      }
      if (m[1] && !cible) return erreur(404, 'Cette personne ne fait pas partie de l’élevage.');

      if (methode === 'DELETE' && cible) {
        if (cible.role === 'proprietaire') return erreur(400, 'Le propriétaire ne peut pas être retiré.');
        comptes.delete(cible.identifiant);
        finirSessions(cible.identifiant);
        noter(m0, 'utilisateur', 'utilisateurs', `a retiré ${cible.nom ?? cible.identifiant} de l’élevage`);
        return repondre(200, { ok: true });
      }
      if (methode === 'POST' && cible && action === 'deconnexion') {
        finirSessions(cible.identifiant);
        noter(m0, 'utilisateur', 'utilisateurs', `a déconnecté les appareils de ${cible.nom ?? cible.identifiant}`);
        return repondre(200, { ok: true });
      }
      if (methode === 'POST' && cible && action === 'mot-de-passe') {
        if (cible.identifiant === m0.identifiant) return erreur(400, 'Pour changer votre propre mot de passe, utilisez « Compte ».');
        if (cible.role === 'proprietaire') return erreur(403, 'Le mot de passe du propriétaire ne se réinitialise pas ici : la personne qui a installé l’application peut lui en redonner un depuis l’ordinateur du serveur.');
        cible.motDePasse = codeAleatoire();
        cible.provisoire = true;
        finirSessions(cible.identifiant);
        noter(m0, 'utilisateur', 'utilisateurs', `a réinitialisé le mot de passe de ${cible.nom ?? cible.identifiant}`);
        return repondre(200, provisoire(cible));
      }

      if ((methode === 'POST' && !m[1]) || (methode === 'PATCH' && cible)) {
        const roleDemande = corps['role'] as RoleMembre | undefined;
        if (!cible && !roleDemande && !corps['droits']) return erreur(400, 'Choisissez un profil ou cochez des droits.');
        if (roleDemande && !PROFILS_ASSIGNABLES.includes(roleDemande as never)) return erreur(400, 'Profil inconnu.');
        if (cible?.role === 'proprietaire') return erreur(400, 'Les droits du propriétaire ne se modifient pas.');
        const role: RoleMembre = roleDemande ?? (corps['droits'] ? 'personnalise' : cible!.role);
        const droits = nettoyerDroits((corps['droits'] as string[] | undefined) ?? (roleDemande ? droitsDuProfil(roleDemande) : cible!.droits));
        if (droits.includes('admin.utilisateurs') && m0.role !== 'proprietaire') return erreur(403, 'Seul le propriétaire peut donner le droit de gérer les utilisateurs.');
        const zones = (corps['zones'] as string[] | undefined) ?? cible?.zones ?? [];
        const fonction = String(corps['fonction'] ?? '').trim();
        const brutTel = corps['telephone'] === undefined ? undefined : String(corps['telephone']).trim();
        const tel = brutTel ? normaliserTelephone(brutTel) : null;
        if (brutTel && !tel) return erreur(400, 'Numéro de téléphone invalide. Exemple : 77 123 45 67.');
        const resume = `profil ${LIBELLES_PROFILS[role].toLowerCase()}, ${droits.length} fonction${droits.length > 1 ? 's' : ''}`;
        if (cible) {
          Object.assign(cible, { role, droits, zones });
          if (corps['fonction'] !== undefined) { if (fonction) cible.fonction = fonction; else delete cible.fonction; }
          if (brutTel !== undefined) cible.telephone = tel;
          if (typeof corps['nom'] === 'string' && corps['nom'].trim()) cible.nom = corps['nom'].trim();
          noter(m0, 'utilisateur', 'utilisateurs', `a modifié les droits de ${cible.nom ?? cible.identifiant}${cible.fonction ? ` (${cible.fonction})` : ''} · ${resume}`);
          return repondre(200, { ok: true, identifiant: cible.identifiant, role });
        }
        const prenom = String(corps['prenom'] ?? '').trim();
        const nom = String(corps['nom'] ?? '').trim();
        const choisi = String(corps['identifiant'] ?? '').trim() ? normaliserIdentifiant(String(corps['identifiant'])) : null;
        if (choisi && problemeIdentifiant(choisi)) return erreur(400, problemeIdentifiant(choisi)!);
        if (choisi && comptes.has(choisi)) return erreur(409, `L’identifiant « ${choisi} » est déjà pris. Choisissez-en un autre.`);
        const base = choisi ?? identifiantDepuisNom(prenom, nom);
        if (!prenom || !nom || problemeIdentifiant(base)) return erreur(400, 'Le nom et le prénom doivent contenir des lettres.');
        const identifiant = identifiantLibre(base, (x) => comptes.has(x));
        const neuf: CompteDemo = {
          identifiant, nom: `${prenom} ${nom}`, telephone: tel, motDePasse: codeAleatoire(), provisoire: true, role, droits, zones,
          ...(fonction ? { fonction } : {}),
        };
        comptes.set(identifiant, neuf);
        noter(m0, 'utilisateur', 'utilisateurs', `a ajouté ${neuf.nom}${fonction ? ` (${fonction})` : ''} · identifiant ${identifiant}, ${resume}`);
        return repondre(200, { ...provisoire(neuf), role });
      }
    }

    return erreur(404, 'Adresse inconnue.');
  };
}
