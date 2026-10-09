/** Poids maximum d'un logo une fois encodé (le serveur limite chaque fiche à 50 000 caractères). */
export const LOGO_MAX_CARACTERES = 38_000;

/** Réduit une image choisie par l'éleveur en un petit logo (PNG, ou JPEG si c'est une photo trop lourde). */
export async function redimensionnerLogo(fichier: File): Promise<string> {
  if (!fichier.type.startsWith('image/')) throw new Error('Choisissez une image (PNG, JPEG…).');
  const url = URL.createObjectURL(fichier);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Cette image ne peut pas être lue.'));
      i.src = url;
    });
    let cote = 256;
    for (let essai = 0; essai < 8; essai++) {
      const echelle = Math.min(1, cote / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * echelle));
      canvas.height = Math.max(1, Math.round(image.height * echelle));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Cette image ne peut pas être traitée ici.');
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const [type, qualite] of [['image/png', undefined], ['image/jpeg', 0.85]] as const) {
        const data = canvas.toDataURL(type, qualite);
        if (data.startsWith(`data:${type}`) && data.length <= LOGO_MAX_CARACTERES) return data;
      }
      cote = Math.round(cote * 0.75);
    }
    throw new Error('Ce logo est trop détaillé. Choisissez une image plus simple.');
  } finally {
    URL.revokeObjectURL(url);
  }
}
