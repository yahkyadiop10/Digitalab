import { Component, type ErrorInfo, type ReactNode } from 'react';
import { repo } from '../repo';

/**
 * Dernier filet : si un écran plante (fiche abîmée, bug), on n'affiche pas une page blanche. Les données restent sur le téléphone ;
 * on propose de recharger, et de télécharger une sauvegarde pour ne rien perdre.
 */
export class Secours extends Component<{ children: ReactNode }, { erreur: boolean }> {
  override state = { erreur: false };

  static getDerivedStateFromError(): { erreur: boolean } {
    return { erreur: true };
  }

  override componentDidCatch(erreur: Error, info: ErrorInfo): void {
    console.error('Écran interrompu', erreur, info.componentStack);
  }

  private async sauvegarder(): Promise<void> {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([await repo.exporter()], { type: 'application/json' }));
    a.download = `avimaster-secours-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  override render(): ReactNode {
    if (!this.state.erreur) return this.props.children;
    return (
      <main className="secours">
        <h2>Un problème est survenu</h2>
        <p>Vos données sont toujours sur ce téléphone. Rechargez l’application ; si le problème revient, téléchargez une sauvegarde et contactez votre installateur.</p>
        <button className="bouton" onClick={() => { location.hash = '#/'; location.reload(); }}>Recharger</button>
        <button className="bouton alt" onClick={() => void this.sauvegarder()}>Télécharger une sauvegarde</button>
      </main>
    );
  }
}
