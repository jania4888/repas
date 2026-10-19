import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonComponent } from '@shared/components/button/button.component';
import { PurchaseReceiptImportSupplier } from '../../models/purchase-receipt-import.models';

/**
 * Carte de rapprochement fournisseur affichée dans la section 1 du
 * formulaire quand le bon de réception a été pré-rempli depuis un document
 * importé. Purement présentationnelle.
 */
@Component({
  selector: 'app-purchase-receipt-import-supplier-card',
  standalone: true,
  imports: [CommonModule, ButtonComponent],
  template: `
    @if (supplierInfo) {
      <div class="pisc" role="status">
        <div class="pisc-main">
          <i class="pi pi-building pisc-icon" aria-hidden="true"></i>
          <div class="pisc-text">
            @if (supplierInfo.matchOutcome === 'MatchedByNif' || supplierInfo.matchOutcome === 'MatchedByName') {
              <p class="pisc-title" i18n="@@features.purchase-receipts.components.purchase-receipt-import-supplier-card.ts.fournisseur.rapproche.1a2b3c30">Fournisseur rapproché</p>
              <p class="pisc-sub">{{ supplierInfo.supplierName }}</p>
            } @else if (supplierInfo.matchOutcome === 'Ambiguous') {
              <p class="pisc-title" i18n="@@features.purchase-receipts.components.purchase-receipt-import-supplier-card.ts.plusieurs.fournisseurs.correspondent.1a2b3c31">Plusieurs fournisseurs correspondent</p>
              <p class="pisc-sub">{{ supplierInfo.extractedName }}</p>
            } @else if (supplierInfo.matchOutcome === 'MatchedInactive') {
              <p class="pisc-title" i18n="@@features.purchase-receipts.components.purchase-receipt-import-supplier-card.ts.fournisseur.trouve.mais.inactif.1a2b3c32">Fournisseur trouvé mais inactif</p>
              <p class="pisc-sub">{{ supplierInfo.extractedName }}</p>
            } @else if (supplierInfo.matchOutcome === 'NameConflictsWithNif') {
              <p class="pisc-title" i18n="@@features.purchase-receipts.components.purchase-receipt-import-supplier-card.ts.le.nom.ne.correspond.pas.au.matricule.fiscal.1a2b3c33">Le nom ne correspond pas au matricule fiscal trouvé</p>
              <p class="pisc-sub">{{ supplierInfo.extractedName }} — {{ supplierInfo.extractedNif }}</p>
            } @else {
              <p class="pisc-title" i18n="@@features.purchase-receipts.components.purchase-receipt-import-supplier-card.ts.aucun.fournisseur.identifie.1a2b3c34">Aucun fournisseur identifié</p>
              @if (supplierInfo.extractedName) {
                <p class="pisc-sub">{{ supplierInfo.extractedName }}</p>
              }
            }
          </div>
        </div>

        @if (supplierInfo.candidates.length > 0) {
          <div class="pisc-candidates">
            @for (c of supplierInfo.candidates; track c.id) {
              <app-button variant="outline" size="sm" [disabled]="!c.isActive" (clicked)="selectCandidate.emit(c.id)">
                {{ c.name }}{{ c.city ? ' — ' + c.city : '' }}
              </app-button>
            }
          </div>
        }

        @if (showCreateButton) {
          <app-button variant="primary" size="sm" icon="pi-plus" iconPos="left" (clicked)="createRequested.emit()" i18n="@@features.purchase-receipts.components.purchase-receipt-import-supplier-card.ts.creer.ce.fournisseur.1a2b3c35"> Créer ce fournisseur </app-button>
        }
      </div>
    }
  `,
  styles: [`
    .pisc {
      display: flex; flex-direction: column; gap: var(--spacing-3);
      padding: var(--spacing-3) var(--spacing-4); margin-bottom: var(--spacing-4);
      background: var(--color-background-subtle); border: 1px solid var(--color-border-subtle);
      border-radius: var(--radius-lg);
    }
    .pisc-main { display: flex; align-items: flex-start; gap: var(--spacing-3); }
    .pisc-icon { font-size: 1.1rem; color: var(--color-text-tertiary); margin-top: 2px; }
    .pisc-title { margin: 0; font-weight: var(--font-weight-semibold); color: var(--color-text-primary); }
    .pisc-sub { margin: var(--spacing-1) 0 0; font-size: var(--font-size-sm); color: var(--color-text-secondary); }
    .pisc-candidates { display: flex; gap: var(--spacing-2); flex-wrap: wrap; }
  `]
})
export class PurchaseReceiptImportSupplierCardComponent {
  @Input() supplierInfo: PurchaseReceiptImportSupplier | null = null;
  @Input() canCreateSupplier = false;

  @Output() selectCandidate = new EventEmitter<string>();
  @Output() createRequested = new EventEmitter<void>();

  get showCreateButton(): boolean {
    const outcome = this.supplierInfo?.matchOutcome;
    return this.canCreateSupplier
      && (outcome === 'NotFound' || outcome === 'Missing')
      && !!this.supplierInfo?.prefill;
  }
}
