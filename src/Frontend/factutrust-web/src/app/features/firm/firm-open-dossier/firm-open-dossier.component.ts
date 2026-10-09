import { Component, inject, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FirmContextService } from '@core/services/firm-context.service';
import { FirmAreaCoherenceService } from '@core/services/firm-area-coherence.service';
import { FIRM_DELEGATED_HOME_ROUTE } from '@core/config/firm-area-access';

@Component({
  selector: 'app-firm-open-dossier',
  standalone: true,
  template: `<p class="p-4">Ouverture du dossier…</p>`
})
export class FirmOpenDossierComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly firmContext = inject(FirmContextService);
  private readonly firmCoherence = inject(FirmAreaCoherenceService);

  ngOnInit(): void {
    const tenantId = this.route.snapshot.paramMap.get('tenantId');
    if (!tenantId) {
      void this.router.navigate(['/firm/clients']);
      return;
    }
    void this.firmContext.switchClient(tenantId).then(async () => {
      // Le jeton est déjà délégué : rester sur une page cabinet si la navigation est annulée
      // afficherait l'espace cabinet dans l'habillage du dossier.
      const navigated = await this.router.navigate([FIRM_DELEGATED_HOME_ROUTE]);
      if (!navigated) {
        this.firmCoherence.enforceNow();
      }
    }).catch(() => {
      // Message d'erreur déjà affiché par FirmContextService (403 ACL).
      void this.router.navigate(['/firm/clients']);
    });
  }
}
