import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { DialogModule } from 'primeng/dialog';
import { ButtonComponent } from '@shared/components/button/button.component';
import {
  RecurringContractService,
  UsageAggregationMode,
  UsageMetric,
  UpsertUsageMetricPayload
} from '@core/services/recurring-contract.service';
import { ProductListItem } from '@core/services/product.service';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';

interface AggregationOption {
  label: string;
  value: UsageAggregationMode;
}

/**
 * Dialog de gestion des métriques de consommation (création / édition inline).
 * Liste chargée à l'ouverture ; `saved` est émis après chaque écriture pour que
 * l'onglet Services recharge ses listes déroulantes.
 */
@Component({
  selector: 'app-usage-metric-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, DialogModule, ButtonComponent],
  template: `
    <p-dialog
      [(visible)]="visible"
      [modal]="true"
      header="Gérer les métriques"
      [style]="{ width: '46rem' }">
      <table class="metrics-table">
        <thead>
          <tr><th i18n="@@recurring-contracts.components.code.adac6937">Code</th><th i18n="@@recurring-contracts.components.nom.7ff20370">Nom</th><th i18n="@@recurring-contracts.components.unite.388fd9c4">Unité</th><th i18n="@@recurring-contracts.components.agregation.1b174f8f">Agrégation</th><th i18n="@@recurring-contracts.components.actif.2eb75f84">Actif</th><th></th></tr>
        </thead>
        <tbody>
          @for (m of metrics; track m.id) {
            <tr>
              <td class="mono">{{ m.code }}</td>
              <td>{{ m.name }}</td>
              <td>{{ m.unit }}</td>
              <td>{{ aggregationLabel(m.aggregationMode) }}</td>
              <td>{{ m.isActive ? 'Oui' : 'Non' }}</td>
              <td>
                <app-button variant="ghost" size="sm" icon="pi-pencil" (clicked)="edit(m)" i18n="@@recurring-contracts.components.modifier.f260e757">Modifier</app-button>
              </td>
            </tr>
          } @empty {
            <tr><td colspan="6" class="empty" i18n="@@recurring-contracts.components.aucune.metrique.pour.l.instant.3adec9d2">Aucune métrique pour l'instant.</td></tr>
          }
        </tbody>
      </table>

      <div class="edit-block">
        <h4>{{ editingId ? 'Modifier la métrique' : 'Nouvelle métrique' }}</h4>
        <div class="grid">
          <label>Code *
            <input class="ft-input" [(ngModel)]="form.code" name="metricCode" [disabled]="!!editingId" />
          </label>
          <label>Nom *
            <input class="ft-input" [(ngModel)]="form.name" name="metricName" />
          </label>
          <label>Unité *
            <input class="ft-input" [(ngModel)]="form.unit" name="metricUnit" placeholder="ex. appels, Go, utilisateurs" i18n-placeholder="ex. appels, Go, utilisateurs" />
          </label>
          <label>Mode d'agrégation
            <select class="ft-input" [(ngModel)]="form.aggregationMode" name="metricAggregation">
              @for (opt of aggregationOptions; track opt.value) {
                <option [ngValue]="opt.value">{{ opt.label }}</option>
              }
            </select>
          </label>
          <label>Produit lié
            <select class="ft-input" [(ngModel)]="form.productId" name="metricProduct">
              <option [ngValue]="null" i18n="@@recurring-contracts.components.aucun.67323ce2">— Aucun —</option>
              @for (p of products; track p.id) {
                <option [ngValue]="p.id">{{ p.code }} — {{ p.name }}</option>
              }
            </select>
          </label>
          <label class="checkbox-label">
            <input type="checkbox" [(ngModel)]="form.isActive" name="metricActive" />
            Métrique active
          </label>
        </div>
      </div>

      <ng-template pTemplate="footer">
        @if (editingId) {
          <app-button variant="ghost" (clicked)="resetForm()" i18n="@@recurring-contracts.components.annuler.la.modification.a5ded982">Annuler la modification</app-button>
        }
        <app-button variant="primary" icon="pi-check" [disabled]="saving" (clicked)="save()">
          {{ saving ? 'Enregistrement…' : 'Enregistrer' }}
        </app-button>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    .metrics-table {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--font-size-sm);
      margin-bottom: var(--spacing-4);

      th {
        text-align: left;
        color: var(--color-text-secondary);
        font-weight: var(--font-weight-semibold);
        padding: var(--spacing-2);
        border-bottom: 1px solid var(--color-border-default);
      }

      td {
        padding: var(--spacing-2);
        border-bottom: 1px solid var(--color-neutral-100);
      }
    }

    .mono { font-family: var(--font-family-mono, 'JetBrains Mono', monospace); }
    .empty { text-align: center; color: var(--color-text-tertiary); padding: var(--spacing-4); }

    .edit-block {
      border-top: 1px solid var(--color-border-subtle);
      padding-top: var(--spacing-3);

      h4 {
        margin: 0 0 var(--spacing-3);
        font-size: var(--font-size-base);
        color: var(--color-text-primary);
      }
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: var(--spacing-3);
    }

    label {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-1);
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
    }

    .checkbox-label {
      flex-direction: row;
      align-items: center;
      gap: var(--spacing-2);
      color: var(--color-text-primary);
      align-self: end;
      padding-bottom: var(--spacing-2);
    }

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
export class UsageMetricDialogComponent {
  @Input() visible = false;
  @Output() visibleChange = new EventEmitter<boolean>();
  @Input() metrics: UsageMetric[] = [];
  @Input() products: ProductListItem[] = [];
  /** Émis après chaque création/modification réussie (le parent recharge ses référentiels). */
  @Output() saved = new EventEmitter<void>();

  private readonly service = inject(RecurringContractService);
  private readonly toast = inject(ToastService);
  private readonly errorHandler = inject(ErrorHandlerService);

  editingId: string | null = null;
  saving = false;

  form: UpsertUsageMetricPayload = this.emptyForm();

  readonly aggregationOptions: AggregationOption[] = [
    { label: 'Somme', value: 'Sum' },
    { label: 'Maximum', value: 'Max' },
    { label: 'Dernière valeur', value: 'Last' }
  ];

  aggregationLabel(mode: UsageAggregationMode): string {
    return this.aggregationOptions.find(o => o.value === mode)?.label ?? mode;
  }

  edit(m: UsageMetric): void {
    this.editingId = m.id;
    this.form = {
      code: m.code,
      name: m.name,
      unit: m.unit,
      aggregationMode: m.aggregationMode,
      productId: m.productId ?? null,
      isActive: m.isActive
    };
  }

  resetForm(): void {
    this.editingId = null;
    this.form = this.emptyForm();
  }

  save(): void {
    if (!this.form.code?.trim() || !this.form.name?.trim() || !this.form.unit?.trim()) {
      this.toast.add({
        severity: 'warn',
        summary: 'Formulaire incomplet',
        detail: 'Code, nom et unité sont obligatoires.'
      });
      return;
    }
    this.saving = true;
    const request: Observable<unknown> = this.editingId
      ? this.service.updateUsageMetric(this.editingId, this.form)
      : this.service.createUsageMetric(this.form);
    request.subscribe({
      next: () => {
        this.saving = false;
        this.toast.add({
          severity: 'success',
          summary: this.editingId ? 'Métrique modifiée' : 'Métrique créée',
          detail: `La métrique « ${this.form.name} » a été enregistrée.`
        });
        this.resetForm();
        this.saved.emit();
      },
      error: (err: unknown) => {
        this.saving = false;
        this.errorHandler.logError('RecurringContracts: usage metric save', err);
        this.toast.add({ severity: 'error', summary: 'Erreur', detail: this.errorHandler.extractErrorMessage(err) });
      }
    });
  }

  private emptyForm(): UpsertUsageMetricPayload {
    return { code: '', name: '', unit: '', aggregationMode: 'Sum', productId: null, isActive: true };
  }
}
