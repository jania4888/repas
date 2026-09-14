import { Component } from '@angular/core';
import { StudioPageShellComponent } from '../shared/studio-page-shell.component';

/**
 * Emplacement minimal de la route `d/:key/views/new` / `d/:key/views/:viewId` (2.5a) : le vrai
 * concepteur de vue (formulaire, limites `RECORD_VIEW_LIMITS`, aperçu R3…) arrive en 2.5c. Ce stub
 * ne fait que valider le routage + les gardes (`permissionGuard` + `capabilityGuard`).
 */
@Component({
  selector: 'app-studio-record-view-designer',
  standalone: true,
  imports: [StudioPageShellComponent],
  template: `
    <app-studio-page-shell title="Concepteur de vue" subtitle="Bientôt">
      <p>Le concepteur de vue arrive dans une prochaine mise à jour.</p>
    </app-studio-page-shell>
  `
})
export class StudioRecordViewDesignerComponent {}
