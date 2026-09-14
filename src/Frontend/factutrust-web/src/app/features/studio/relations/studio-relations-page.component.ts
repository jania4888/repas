import { Component } from '@angular/core';
import { StudioPageShellComponent } from '../shared/studio-page-shell.component';
import { STUDIO_BREADCRUMBS } from '../shared/studio-breadcrumb.util';

/**
 * Emplacement minimal de la route `/studio/relations` (2.5a) : le tableau + diagramme SVG des
 * relations arrivent en 2.5d. Ce stub valide le routage + les gardes (`permissionGuard`
 * `studio.designEntities` + `capabilityGuard('manyToManyEnabled', …)`, V5/E5).
 */
@Component({
  selector: 'app-studio-relations-page',
  standalone: true,
  imports: [StudioPageShellComponent],
  template: `
    <app-studio-page-shell title="Relations" subtitle="Bientôt" [breadcrumbs]="breadcrumbs">
      <p>La page des relations plusieurs-à-plusieurs arrive dans une prochaine mise à jour.</p>
    </app-studio-page-shell>
  `
})
export class StudioRelationsPageComponent {
  readonly breadcrumbs = STUDIO_BREADCRUMBS.relations();
}
