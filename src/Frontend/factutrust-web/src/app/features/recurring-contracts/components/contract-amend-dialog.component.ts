/// <reference types="@angular/localize" />
import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { ButtonComponent } from '@shared/components/button/button.component';
import {
  AmendRecurringContractPayload,
  AmendmentType,
  ProrationPolicy,
  RecurringContractDetail,
  RecurringContractService,
  UsageMetric
} from '@core/services/recurring-contract.service';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { ContractLinePayloadSource, toLinePayloads, toUpsertPayload } from '../recurring-contracts.ui-utils';

// Une ligne d'avenant est exactement la forme partagée d'une ligne éditable (ui-utils) :
// tout champ divergent ici serait un vecteur de perte de données de la même classe que B3.
type AmendLineForm = ContractLinePayloadSource;

interface AmendmentTypeOption {
  label: string;
  value: AmendmentType;
}

interface ProrationOption {
  label: string;
  value: ProrationPolicy;
}

/**
 * Dialog « Nouvel avenant » sur contrat actif (backend AmendLines, D14) :
 * périmètre = lignes uniquement, date d'effet = jour même (non modifiable),
 * effet immédiat — les lignes remplacées sont clôturées à la veille.
 */
@Component({
  selector: 'app-contract-amend-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, DialogModule, ButtonComponent],
  template: `
    <p-dialog
      [(visible)]="visible"
      [modal]="true"
      header="Créer un avenant" i18n-header="Créer un avenant"
      [style]="{ width: '56rem' }"
      (onShow)="onShow()">
      <div class="grid">
        <label>Type d'avenant
          <select class="ft-input" [(ngModel)]="amendmentType" name="amendmentType">
            @for (opt of typeOptions; track opt.value) {
              <option [ngValue]="opt.value">{{ opt.label }}</option>
            }
          </select>
        </label>
        <label>Date d'effet
          <input class="ft-input" [value]="today | date:'dd/MM/yyyy'" disabled />
          <span class="field-hint" i18n="@@recurring-contracts.components.effet.immediat.jour.meme.non.modifiable.71bcc4a8">Effet immédiat (jour même) — non modifiable.</span>
        </label>
        <label>Politique de prorata
          <select class="ft-input" [(ngModel)]="prorationPolicy" name="prorationPolicy">
            @for (opt of prorationOptions; track opt.value) {
              <option [ngValue]="opt.value">{{ opt.label }}</option>
            }
          </select>
        </label>
      </div>

      <p class="info-line">
        <i class="pi pi-info-circle"></i>
        Les modifications prennent effet immédiatement ; les lignes actuelles sont clôturées à la veille.
        Si un brouillon existe déjà pour la période en cours, il n'est pas modifié.
      </p>

      <h4 class="lines-title" i18n="@@recurring-contracts.components.lignes.du.contrat.apres.avenant.707b103f">Lignes du contrat après avenant</h4>
      @for (line of lines; track $index; let i = $index) {
        <div class="line-card">
          <div class="line-card__head">
            <select class="ft-input" [(ngModel)]="line.lineType" [name]="'amendLineType' + i">
              <option [ngValue]="'FixedRecurring'" i18n="@@recurring-contracts.components.recurrent.fixe.9f36de5c">Récurrent fixe</option>
              <option [ngValue]="'UsageMetered'" i18n="@@recurring-contracts.components.a.la.consommation.a9497352">À la consommation</option>
              <option [ngValue]="'OneTimeSetup'" i18n="@@recurring-contracts.components.frais.d.installation.f39459df">Frais d'installation</option>
            </select>
            <app-button type="button" variant="ghost" size="sm" icon="pi-trash" (clicked)="removeLine(i)" i18n="@@recurring-contracts.components.retirer.54ec24a1"> Retirer </app-button>
          </div>
          <div class="grid">
            <label class="span-2">Description
              <input class="ft-input" placeholder="Description (optionnelle)" i18n-placeholder="Description (optionnelle)" [(ngModel)]="line.description" [name]="'amendDesc' + i" />
            </label>
            <label>Qté
              <input class="ft-input" type="number" [(ngModel)]="line.quantity" [name]="'amendQty' + i" />
            </label>
            <label>Prix unitaire HT
              <input class="ft-input" type="number" step="0.001" min="0" [(ngModel)]="line.unitPriceHT" [name]="'amendPrice' + i" />
            </label>
            <label>TVA %
              <input class="ft-input" type="number" step="0.001" min="0" [(ngModel)]="line.vatRate" [name]="'amendVat' + i" />
            </label>
            @if (line.lineType === 'UsageMetered') {
              <label>
                <span class="field-label required" i18n="@@recurring-contracts.components.metrique.066ebc60">Métrique</span>
                <select class="ft-input" [(ngModel)]="line.usageMetricId" [name]="'amendMetric' + i">
                  <option [ngValue]="null" i18n="@@recurring-contracts.components.selectionner.7ae1afc7">— Sélectionner —</option>
                  @for (m of usageMetrics; track m.id) {
                    <option [ngValue]="m.id">{{ m.name }} ({{ m.unit }})</option>
                  }
                </select>
              </label>
              <label>Quantité incluse
                <input class="ft-input" type="number" min="0" [(ngModel)]="line.includedQuantity" [name]="'amendIncluded' + i" />
              </label>
              <label>Prix dépassement HT
                <input class="ft-input" type="number" step="0.001" min="0" [(ngModel)]="line.overageUnitPriceHT" [name]="'amendOverage' + i" />
              </label>
            }
          </div>
        </div>
      }
      <app-button type="button" variant="outline" size="sm" icon="pi-plus" (clicked)="addLine()" i18n="@@recurring-contracts.components.ajouter.une.ligne.ba241fd4"> Ajouter une ligne </app-button>

      <label class="notes-label">Notes
        <textarea
          class="ft-input"
          rows="2"
          [(ngModel)]="notes"
          name="amendmentNotes"
          placeholder="Motif de l'avenant (visible dans l'historique)…" i18n-placeholder="Motif de l'avenant (visible dans l'historique)…">
        </textarea>
      </label>

      <ng-template pTemplate="footer">
        <app-button variant="secondary" (clicked)="close()" i18n="@@recurring-contracts.components.annuler.49ba3292">Annuler</app-button>
        <app-button variant="primary" icon="pi-check" [disabled]="saving" (clicked)="submit()">
          {{ saving ? loc_ui_tern_enregistrement_e7d5f2 : loc_ui_tern_enregistrer_l_avenant_d671bc }}
        </app-button>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: var(--spacing-3);
    }

    label {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-1);
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
    }

    .field-label.required::after {
      content: ' *';
      color: var(--color-error-500);
    }

    .span-2 { grid-column: span 2; }

    .field-hint {
      font-size: var(--font-size-xs);
      color: var(--color-text-tertiary);
    }

    .info-line {
      display: flex;
      align-items: flex-start;
      gap: var(--spacing-2);
      margin: var(--spacing-3) 0;
      padding: var(--spacing-2) var(--spacing-3);
      border-radius: var(--radius-lg);
      background: var(--color-info-50, #f0f9ff);
      color: var(--color-info-700, #0369a1);
      font-size: var(--font-size-sm);

      .pi { margin-top: 2px; }
    }

    .lines-title {
      margin: var(--spacing-3) 0;
      font-size: var(--font-size-base);
      color: var(--color-text-primary);
    }

    .line-card {
      border: 1px solid var(--color-border-subtle);
      border-radius: var(--radius-lg);
      padding: var(--spacing-3);
      margin-bottom: var(--spacing-3);
      background: var(--color-background-subtle);
    }

    .line-card__head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: var(--spacing-3);
      margin-bottom: var(--spacing-2);
    }

    .notes-label { margin-top: var(--spacing-3); }

    .ft-input {
      padding: var(--spacing-2) var(--spacing-3);
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-lg);
      font-size: var(--font-size-sm);
      font-family: inherit;
      background: var(--color-background-elevated);
      color: var(--color-text-primary);
    }

    .ft-input:focus-visible {
      outline: 2px solid var(--color-primary-500);
      outline-offset: 1px;
    }
  `]
})
export class ContractAmendDialogComponent {
  readonly loc_ui_tern_enregistrement_e7d5f2 = $localize`:@@ui.tern.enregistrement.e7d5f2:Enregistrement…`;
  readonly loc_ui_tern_enregistrer_l_avenant_d671bc = $localize`:@@ui.tern.enregistrer.l.avenant.d671bc:Enregistrer l'avenant`;
  @Input() visible = false;
  @Output() visibleChange = new EventEmitter<boolean>();
  @Input({ required: true }) contract!: RecurringContractDetail;
  /** Émis après enregistrement réussi : la page parente recharge contrat + historique. */
  @Output() amended = new EventEmitter<void>();

  private readonly service = inject(RecurringContractService);
  private readonly toast = inject(ToastService);
  private readonly errorHandler = inject(ErrorHandlerService);

  amendmentType: AmendmentType = 'PriceChange';
  prorationPolicy: ProrationPolicy = 'DailyProration';
  notes = '';
  lines: AmendLineForm[] = [];
  usageMetrics: UsageMetric[] = [];
  saving = false;

  readonly today = new Date();

  readonly typeOptions: AmendmentTypeOption[] = [
    { label: 'Mise à niveau', value: 'Upgrade' },
    { label: 'Déclassement', value: 'Downgrade' },
    { label: 'Ajout de ligne', value: 'AddLine' },
    { label: 'Retrait de ligne', value: 'RemoveLine' },
    { label: 'Changement de prix', value: 'PriceChange' }
  ];

  readonly prorationOptions: ProrationOption[] = [
    { label: 'Prorata journalier', value: 'DailyProration' },
    { label: 'Aucun', value: 'None' }
  ];

  // Initialisation uniquement via (onShow) de p-dialog : après un avenant réussi le parent
  // ferme le dialog, donc `contract` ne change jamais pendant que le dialog est ouvert.
  onShow(): void {
    this.resetFromContract();
    if (this.usageMetrics.length === 0) {
      this.service.listUsageMetrics().subscribe({
        next: m => { this.usageMetrics = m; },
        error: () => { this.usageMetrics = []; }
      });
    }
  }

  addLine(): void {
    this.lines.push({
      id: null,
      lineType: 'FixedRecurring',
      productId: null,
      description: '',
      quantity: 1,
      unitPriceHT: 0,
      vatRate: 19,
      usageMetricId: null,
      includedQuantity: null,
      overageUnitPriceHT: null
    });
  }

  removeLine(index: number): void {
    this.lines.splice(index, 1);
  }

  close(): void {
    this.visible = false;
    this.visibleChange.emit(false);
  }

  submit(): void {
    if (this.lines.length === 0) {
      this.toast.add({ severity: 'warn', summary: $localize`:@@contract-amend-dialog.component.summary.Avenant_incomple:Avenant incomplet`, detail: $localize`:@@contract-amend-dialog.component.detail.Le_contrat_doit_:Le contrat doit conserver au moins une ligne.` });
      return;
    }
    for (const line of this.lines) {
      if (line.lineType === 'UsageMetered' && !line.usageMetricId) {
        this.toast.add({ severity: 'warn', summary: $localize`:@@contract-amend-dialog.component.summary.Avenant_incomple:Avenant incomplet`, detail: $localize`:@@contract-amend-dialog.component.detail.La_m_trique_est_:La métrique est obligatoire pour une ligne à la consommation.` });
        return;
      }
    }

    const payload: AmendRecurringContractPayload = {
      amendmentType: this.amendmentType,
      effectiveDate: new Date().toISOString().slice(0, 10),
      prorationPolicy: this.prorationPolicy,
      notes: this.notes || null,
      updatedContract: toUpsertPayload(this.contract, toLinePayloads(this.lines))
    };

    this.saving = true;
    this.service.amend(this.contract.id, payload).subscribe({
      next: () => {
        this.saving = false;
        this.toast.add({ severity: 'success', summary: $localize`:@@contract-amend-dialog.component.summary.Avenant_enregist:Avenant enregistré`, detail: $localize`:@@contract-amend-dialog.component.detail.L_avenant_a_t_:L'avenant a été pris en compte immédiatement.` });
        this.close();
        this.amended.emit();
      },
      error: err => {
        this.saving = false;
        this.errorHandler.logError('RecurringContracts: amend', err);
        this.toast.add({ severity: 'error', summary: $localize`:@@contract-amend-dialog.component.summary.Erreur:Erreur`, detail: this.errorHandler.extractErrorMessage(err) });
      }
    });
  }

  private resetFromContract(): void {
    this.amendmentType = 'PriceChange';
    this.prorationPolicy = 'DailyProration';
    this.notes = '';
    this.lines = (this.contract.lines ?? [])
      .filter(l => l.isActive !== false)
      .map(l => ({
        id: l.id ?? null,
        lineType: l.lineType,
        productId: l.productId ?? null,
        description: l.description,
        quantity: l.quantity,
        unitPriceHT: l.unitPriceHT,
        vatRate: l.vatRate,
        usageMetricId: l.usageMetricId ?? null,
        includedQuantity: l.includedQuantity ?? null,
        overageUnitPriceHT: l.overageUnitPriceHT ?? null
      }));
  }
}
