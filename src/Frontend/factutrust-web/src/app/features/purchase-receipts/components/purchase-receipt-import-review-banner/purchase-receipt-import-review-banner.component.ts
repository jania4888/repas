import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonComponent } from '@shared/components/button/button.component';
import {
  PurchaseReceiptImportConfidence,
  PurchaseReceiptImportExtractionProvider,
  PurchaseReceiptImportWarning
} from '../../models/purchase-receipt-import.models';
import { importWarningLabel } from '../../utils/purchase-receipt-import.mapping';

/** Un point « à faire » avant de pouvoir enregistrer, avec l'élément du formulaire à mettre au focus. */
export interface ImportBlockingReason {
  text: string;
  targetId: string;
}

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

      @if (sourceFileName) {
        <div class="pirb-srcdoc">
          <i class="pi pi-paperclip" aria-hidden="true"></i>
          <b class="pirb-srcdoc__name" dir="ltr">{{ sourceFileName }}</b>
          @if (engineLabel) {
            <span class="pirb-srcdoc__engine">{{ engineLabel }}</span>
          }
          <small class="pirb-srcdoc__note" i18n="@@features.purchase-receipts.components.purchase-receipt-import-review-banner.ts.sera.joint.au.bon.a.l.enregistrement.1a2b3c29">Sera joint au bon à l'enregistrement</small>
        </div>
      }

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

      @if (blockingReasons.length > 0) {
        <div class="pirb-todo">
          <span class="pirb-todo__label" i18n="@@features.purchase-receipts.components.purchase-receipt-import-review-banner.ts.a.faire.avant.d.enregistrer.1a2b3c28">À faire avant d'enregistrer :</span>
          <ul class="pirb-todo__list">
            @for (reason of blockingReasons; track reason.targetId) {
              <li>
                <button type="button" class="pirb-todo__btn" (click)="selectReason.emit(reason.targetId)">{{ reason.text }}</button>
              </li>
            }
          </ul>
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
    .pirb-srcdoc { display: flex; align-items: center; gap: var(--spacing-2); flex-wrap: wrap; font-size: var(--font-size-sm); color: var(--color-text-secondary); }
    .pirb-srcdoc i { color: var(--color-primary-600); }
    .pirb-srcdoc__name { font-weight: var(--font-weight-semibold); color: var(--color-text-primary); word-break: break-all; }
    .pirb-srcdoc__engine { color: var(--color-text-tertiary); }
    .pirb-srcdoc__note { flex-basis: 100%; font-size: var(--font-size-xs); color: var(--color-text-tertiary); }
    .pirb-warnings { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--spacing-1); }
    .pirb-warnings li { display: flex; align-items: flex-start; gap: var(--spacing-2); font-size: var(--font-size-sm); color: var(--color-warning-700); }
    .pirb-warnings li.pirb-warning--info { color: var(--color-text-tertiary); }
    .pirb-mismatch, .pirb-suggestions {
      display: flex; align-items: center; gap: var(--spacing-2); flex-wrap: wrap;
      font-size: var(--font-size-sm); color: var(--color-warning-700);
    }
    .pirb-todo { display: flex; flex-direction: column; gap: var(--spacing-1); }
    .pirb-todo__label { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--color-text-secondary); }
    .pirb-todo__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--spacing-1); }
    .pirb-todo__btn {
      background: none; border: none; padding: 0; margin: 0; cursor: pointer;
      font-size: var(--font-size-sm); color: var(--color-primary-700); text-decoration: underline;
      text-align: start;
    }
  `]
})
export class PurchaseReceiptImportReviewBannerComponent {
  @Input() confidence: PurchaseReceiptImportConfidence | null = null;
  /** Nom du fichier source importé, affiché avec la note de pièce jointe. */
  @Input() sourceFileName: string | null = null;
  /** Moteur d'extraction de la proposition ; traduit en libellé générique, jamais de nom commercial. */
  @Input() extractionProvider: PurchaseReceiptImportExtractionProvider | null = null;
  @Input() warnings: PurchaseReceiptImportWarning[] = [];
  @Input() totalsMismatch = false;
  @Input() gapAccepted = false;
  @Input() hasNameMatches = false;
  @Input() suggestionsConfirmed = false;
  @Input() blockingReasons: ImportBlockingReason[] = [];

  @Output() acceptGap = new EventEmitter<void>();
  @Output() confirmSuggestions = new EventEmitter<void>();
  @Output() selectReason = new EventEmitter<string>();

  protected readonly importWarningLabel = importWarningLabel;

  /** Libellé générique du moteur d'extraction (§5.2) ; null pour les lectures sans moteur externe. */
  protected get engineLabel(): string | null {
    switch (this.extractionProvider) {
      case 'docstrange':
        return $localize`:@@features.purchase-receipts.components.purchase-receipt-import-review-banner.ts.service.d.extraction.documentaire.1a2b3c36:Service d'extraction documentaire`;
      case 'llm-text':
      case 'llm-vision':
        return $localize`:@@features.purchase-receipts.components.purchase-receipt-import-review-banner.ts.modele.d.import.ia.1a2b3c37:Modèle d'import IA`;
      default:
        return null;
    }
  }
}
