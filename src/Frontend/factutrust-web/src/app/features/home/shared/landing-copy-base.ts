import { inject } from '@angular/core';
import { LandingCopyService } from '../content/landing-copy.service';

/**
 * Base commune des composants de la landing : accès au dictionnaire (`t()`),
 * au texte enrichi (`rich()` : `**gras**`, `_em_`, `[[ltr]]`) et au formatage
 * de paramètres (`format()` : `{clé}`). Centralise l'injection pour éviter la
 * répétition du même bloc dans chaque section.
 */
export abstract class LandingCopyBase {
  protected readonly copy = inject(LandingCopyService);
  protected readonly t = this.copy.t;

  protected rich(text: string) {
    return this.copy.rich(text);
  }

  protected format(template: string, params: Record<string, string | number>): string {
    return this.copy.format(template, params);
  }
}
