import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { StudioApprovalsBadgeService } from '../approvals/studio-approvals-badge.service';

/**
 * Coquille du module Studio (`/studio/**`).
 *
 * Son seul rôle est de porter la classe `studio-theme` (décision D2) : les
 * tokens indigo déclarés dans `shared/_studio-theme.scss` s'appliquent ainsi à
 * tout le module sans toucher au thème global de l'application. Les overlays
 * PrimeNG attachés à `<body>` doivent recevoir la classe explicitement
 * (`panelStyleClass="studio-theme"` / `styleClass="studio-theme"`).
 */
@Component({
  selector: 'app-studio-shell',
  standalone: true,
  imports: [RouterOutlet],
  template: '<router-outlet />',
  styles: [':host { display: block; }'],
  host: { class: 'studio-theme' },
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class StudioShellComponent {
  constructor() {
    // Badge « Mes approbations » (4.4j, D2) : idempotent ; 404 (module coupé) ou 403 ⇒ arrêt définitif.
    inject(StudioApprovalsBadgeService).start();
  }
}
