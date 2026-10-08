/** Envoie le code de connexion à l'utilisateur. Une implémentation SMS ou WhatsApp s'y branche sans toucher au reste. */
export interface Notifieur {
  envoyerCode(telephone: string, code: string): Promise<void>;
}

/** Écrit le code dans les journaux du serveur : pour le développement et les essais seulement. */
export const notifieurConsole: Notifieur = {
  async envoyerCode(telephone, code) {
    console.log(`[digitalab] code de connexion pour ${telephone} : ${code}`);
  },
};
