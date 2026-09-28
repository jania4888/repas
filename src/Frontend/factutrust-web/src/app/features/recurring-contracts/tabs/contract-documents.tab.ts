import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TooltipModule } from 'primeng/tooltip';
import { ButtonComponent } from '@shared/components/button/button.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';

/**
 * Onglet « Documents » : placeholder phase 2 (aucun appel réseau).
 * Le backend documents n'existe pas encore — on colle à la maquette avec un état vide explicite.
 */
@Component({
  selector: 'app-contract-documents-tab',
  standalone: true,
  imports: [CommonModule, TooltipModule, ButtonComponent, EmptyStateComponent],
  template: `
    <app-empty-state
      icon="pi-folder-open"
      title="Aucun document" i18n-title="@@recurring-contracts.tabs.aucun.document.ceec9bd3"
      description="Le dépôt de documents contractuels arrive en phase 2." i18n-description="@@recurring-contracts.tabs.le.depot.de.documents.contractuels.arriv.6e69b987"
      [showAction]="false">
    </app-empty-state>
    <div class="center">
      <app-button
        variant="outline"
        size="sm"
        icon="pi-plus"
        [disabled]="true"
        pTooltip="Disponible prochainement" i18n-pTooltip="@@recurring-contracts.tabs.disponible.prochainement.dd388b37" i18n="@@recurring-contracts.tabs.ajouter.un.document.16690036">
        Ajouter un document
      </app-button>
    </div>
  `,
  styles: [`
    .center { display: flex; justify-content: center; margin-top: calc(-1 * var(--spacing-6)); }
  `]
})
export class ContractDocumentsTabComponent {}
