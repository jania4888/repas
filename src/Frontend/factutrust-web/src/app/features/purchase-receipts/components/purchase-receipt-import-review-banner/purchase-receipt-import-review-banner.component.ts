import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonComponent } from '@shared/components/button/button.component';
import { PurchaseReceiptImportConfidence, PurchaseReceiptImportWarning } from '../../models/purchase-receipt-import.models';
import { importWarningLabel } from '../../utils/purchase-receipt-import.mapping';

/**
 * Bandeau de revue affiché au-dessus de la section 1 du formulaire quand le
 * bon de réception a été pré-rempli depuis un document importé. Purement
 * présentationnel : la logique d'acceptation/rejet reste dans le formulaire.
 */
@Component({
  selector: 'app-purchase-receipt-import-review-banner',
  standalone: true,
  imports: [CommonModule, ButtonComponent],
  template: `
    <div class="pirb" role="status">
      <div class="pirb-main">
        <i class="pi pi-sparkles pirb-icon" aria-hidden="true"></i>
        <div class="pirb-text">
          <p class="pirb-title" i18n="@@features.purchase-receipts.components.purchase-receipt-import-review-banner.ts.bon.de.reception.pre.rempli.depuis.un.docume.1a2b3c20">Bon de réception pré-rempli depuis un document importé</p>
          <p class="pirb-sub">
            @if (confidence === 'low') {
              <span i18n="@@features.purchase-receipts.components.purchase-receipt-import-review-banner.ts.confiance.faible.verifiez.attentivement.le.1a2b3c21">Confiance faible : vérifiez attentivement les données avant d'enregistrer.</span>
            } @else if (confidence === 'medium') {
              <span i18n="@@features.purchase-receipts.components.purchase-receipt-import-review-banner.ts.confiance.moyenne.relisez.les.donnees.extraite.1a2b3c22">Confiance moyenne : relisez les données extraites.</span>
            } @else {
              <span i18n="@@features.purchase-receipts.components.purchase-receipt-import-review-banner.ts.verifiez.les.donnees.extraites.avant.d.enregi.1a2b3c23">Vérifiez les données extraites avant d'enregistrer.</span>
            }
          </p>
        </div>
      </div>

      @if (warnings.length > 0) {
        <ul class="pirb-warnings">
          @for (w of warnings; track w.code + '-' + (w.lineIndex ?? -1)) {
            <li [class.pirb-warning--info]="w.severity === 'info'">
              <i class="pi" [class.pi-info-circle]="w.severity === 'info'" [class.pi-exclamation-triangle]="w.severity !== 'info'" aria-hidden="true"></i>
              <span>{{ w.message || importWarningLabel(w.code) }}</span>
            </li>
          }
        </ul>
      }

      @if (totalsMismatch) {
        <div class="pirb-mismatch">
          <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
          <span i18n="@@features.purchase-receipts.components.purchase-receipt-import-review-banner.ts.le.total.calcule.ne.correspond.pas.au.total.1a2b3c24">Le total calculé ne correspond pas au total lu sur le document.</span>
          @if (!gapAccepted) {
            <app-button variant="outline" size="sm" (clicked)="acceptGap.emit()" i18n="@@features.purchase-receipts.components.purchase-receipt-import-review-banner.ts.accepter.l.ecart.1a2b3c25">Accepter l'écart</app-button>
          }
        </div>
      }

      @if (hasNameMatches && !suggestionsConfirmed) {
        <div class="pirb-suggestions">
          <span i18n="@@features.purchase-receipts.components.purchase-receipt-import-review-banner.ts.certains.articles.ont.ete.rapproches.par.nom.1a2b3c26">Certains articles ont été rapprochés par nom.</span>
          <app-button variant="outline" size="sm" (clicked)="confirmSuggestions.emit()" i18n="@@features.purchase-receipts.components.purchase-receipt-import-review-banner.ts.confirmer.les.suggestions.1a2b3c27">Confirmer les suggestions</app-button>
        </div>
      }
    </div>
  `,
  styles: [`
    .pirb {
      display: flex; flex-direction: column; gap: var(--spacing-3);
      padding: var(--spacing-4); margin-bottom: var(--spacing-4);
      background: var(--color-primary-50, #eff6ff);
      border: 1px solid var(--color-primary-200, #bfdbfe);
      border-radius: var(--radius-lg);
    }
    .pirb-main { display: flex; align-items: flex-start; gap: var(--spacing-3); }
    .pirb-icon { font-size: 1.25rem; color: var(--color-primary-600); margin-top: 2px; }
    .pirb-title { margin: 0; font-weight: var(--font-weight-semibold); color: var(--color-text-primary); }
    .pirb-sub { margin: var(--spacing-1) 0 0; font-size: var(--font-size-sm); color: var(--color-text-secondary); }
    .pirb-warnings { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--spacing-1); }
    .pirb-warnings li { display: flex; align-items: flex-start; gap: var(--spacing-2); font-size: var(--font-size-sm); color: var(--color-warning-700); }
    .pirb-warnings li.pirb-warning--info { color: var(--color-text-tertiary); }
    .pirb-mismatch, .pirb-suggestions {
      display: flex; align-items: center; gap: var(--spacing-2); flex-wrap: wrap;
      font-size: var(--font-size-sm); color: var(--color-warning-700);
    }
  `]
})
export class PurchaseReceiptImportReviewBannerComponent {
  @Input() confidence: PurchaseReceiptImportConfidence | null = null;
  @Input() warnings: PurchaseReceiptImportWarning[] = [];
  @Input() totalsMismatch = false;
  @Input() gapAccepted = false;
  @Input() hasNameMatches = false;
  @Input() suggestionsConfirmed = false;

  @Output() acceptGap = new EventEmitter<void>();
  @Output() confirmSuggestions = new EventEmitter<void>();

  protected readonly importWarningLabel = importWarningLabel;
}
