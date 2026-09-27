import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

/**
 * Redirection `/studio/records/:key/:id` → fiche réelle `/studio/d/:key/:id/edit` (4.4d, D6/R9).
 * Cible stable des liens de notification (types 15–18, 4.4j) : la route n'a pas de
 * `capabilityGuard` pour fonctionner même si le flag workflows est coupé ensuite. Le paramètre
 * de requête `instance` est propagé à la fiche (prépare D20). Aucune donnée d'enregistrement
 * n'est chargée ici.
 */
@Component({
  selector: 'app-studio-record-redirect',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ''
})
export class StudioRecordRedirectComponent {
  constructor() {
    const route = inject(ActivatedRoute);
    const router = inject(Router);
    const key = route.snapshot.paramMap.get('key');
    const id = route.snapshot.paramMap.get('id');
    const instance = route.snapshot.queryParamMap.get('instance');
    if (!key || !id) {
      router.navigateByUrl('/studio', { replaceUrl: true });
      return;
    }
    router.navigateByUrl(
      `/studio/d/${encodeURIComponent(key)}/${encodeURIComponent(id)}/edit${instance ? '?instance=' + encodeURIComponent(instance) : ''}`,
      { replaceUrl: true }
    );
  }
}
