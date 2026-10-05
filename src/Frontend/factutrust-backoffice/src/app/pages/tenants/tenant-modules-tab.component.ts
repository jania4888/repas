import {
  ChangeDetectionStrategy,
  Component,
  Input,
  OnChanges,
  SimpleChanges,
  inject,
  signal
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { InputTextModule } from 'primeng/inputtext';
import { DatePickerModule } from 'primeng/datepicker';
import { TooltipModule } from 'primeng/tooltip';
import { MessageService } from 'primeng/api';

import {
  PlatformTenantModuleOverridesService,
  type SetTenantModuleOverrideRequest
} from '@core/services/platform-tenant-module-overrides.service';
import type { TenantModuleOverrideDto } from '@core/models/platform.models';
import { MODULE_CATALOG } from '@core/models/module-catalog';

import { FtBadgeComponent } from '@core/ui/badge/ft-badge.component';
import { FtSkeletonComponent } from '@core/ui/skeleton/ft-skeleton.component';
import { FtEmptyStateComponent } from '@core/ui/empty-state/ft-empty-state.component';
import type { FtTone } from '@core/ui/badge/ft-badge.component';

/**
 * Sous-lot C1 — Tab « Modules » dans le détail tenant.
 *
 * Liste les overrides de modules du tenant (activation/désactivation explicite par
 * rapport au plan). Permet de créer un override (avec date d'expiration optionnelle)
 * ou de supprimer un override existant (le module retombe sur la valeur du plan).
 */
@Component({
  selector: 'app-tenant-modules-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    FormsModule,
    TableModule,
    ButtonModule,
    DialogModule,
    SelectModule,
    ToggleSwitchModule,
    InputTextModule,
    DatePickerModule,
    TooltipModule,
    FtBadgeComponent,
    FtSkeletonComponent,
    FtEmptyStateComponent
  ],
  template: `
    <div class="tab-actions">
      <p-button
        label="Rafraîchir"
        icon="pi pi-refresh"
        [outlined]="true"
        size="small"
        [disabled]="loading()"
        (onClick)="reload()" />
      <p-button
        label="Ajouter un override"
        icon="pi pi-plus"
        severity="primary"
        size="small"
        (onClick)="openCreate()" />
    </div>

    <p class="intro">
      Les <strong>overrides</strong> de modules permettent d'activer ou désactiver un module
      pour cette entreprise indépendamment du plan auquel elle est abonnée.
      Un override avec date d'expiration est purgé automatiquement par le job
      Hangfire quotidien.
    </p>

    @if (loading()) {
      <ft-skeleton kind="line" count="4" />
    } @else if (errored()) {
      <p class="error">Impossible de charger les overrides.</p>
    } @else if (overrides().length === 0) {
      <ft-empty-state
        variant="table-empty"
        [title]="'Aucun override'"
        [description]="'Cette entreprise utilise les modules définis par son plan.'" />
    } @else {
      <p-table [value]="overrides()" styleClass="p-datatable-sm ft-table">
        <ng-template pTemplate="header">
          <tr>
            <th>Module</th>
            <th>État</th>
            <th>Expire le</th>
            <th>Motif</th>
            <th>Statut</th>
            <th></th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-row>
          <tr>
            <td class="strong">{{ row.moduleDisplay }}</td>
            <td>
              <ft-badge [tone]="row.isEnabled ? 'success' : 'danger'">
                {{ row.isEnabled ? 'Activé' : 'Désactivé' }}
              </ft-badge>
            </td>
            <td>
              @if (row.expiresAt) {
                {{ row.expiresAt | date:'dd/MM/yyyy' }}
              } @else {
                <span class="muted">Permanent</span>
              }
            </td>
            <td class="reason">{{ row.reason ?? '—' }}</td>
            <td>
              <ft-badge [tone]="row.isCurrentlyActive ? 'accent' : 'neutral'" size="sm">
                {{ row.isCurrentlyActive ? 'Actif' : 'Expiré' }}
              </ft-badge>
            </td>
            <td class="cell-action">
              <p-button
                icon="pi pi-trash"
                severity="danger"
                size="small"
                [text]="true"
                [disabled]="busy()"
                pTooltip="Supprimer cet override (le module retombe sur le plan)"
                tooltipPosition="left"
                (onClick)="remove(row)" />
            </td>
          </tr>
        </ng-template>
      </p-table>
    }

    <!-- Dialog ajout/édition override -->
    <p-dialog
      [visible]="showFormDialog()"
      (visibleChange)="showFormDialog.set($event)"
      [modal]="true"
      [draggable]="false"
      [resizable]="false"
      [closable]="!busy()"
      [style]="{ width: '32rem', maxWidth: '95vw' }"
      header="Ajouter un override de module">

      <div class="form-grid">
        <div class="field">
          <label for="tm-module">Module</label>
          <p-select
            inputId="tm-module"
            [options]="moduleOptions"
            [(ngModel)]="formModule"
            optionLabel="label"
            optionValue="value"
            [disabled]="busy()"
            styleClass="w-full" />
        </div>
        <div class="field">
          <label class="checkbox">
            <p-toggleswitch [(ngModel)]="formEnabled" [disabled]="busy()" />
            <span>{{ formEnabled ? 'Activer ce module' : 'Désactiver ce module' }}</span>
          </label>
        </div>
        <div class="field">
          <label for="tm-expires">Date d'expiration (optionnel)</label>
          <p-datepicker
            inputId="tm-expires"
            [(ngModel)]="formExpiresAt"
            dateFormat="dd/mm/yy"
            [showIcon]="true"
            [showClear]="true"
            [minDate]="minExpireDate"
            [disabled]="busy()"
            styleClass="w-full" />
        </div>
        <div class="field">
          <label for="tm-reason">Motif (audit)</label>
          <input
            id="tm-reason"
            type="text"
            pInputText
            [(ngModel)]="formReason"
            [disabled]="busy()"
            maxlength="300"
            placeholder="Ex.: extension de période d'essai, démo commerciale, …"
            class="w-full" />
        </div>
      </div>

      <ng-template pTemplate="footer">
        <p-button label="Annuler" [text]="true" severity="secondary" [disabled]="busy()" (onClick)="closeForm()" />
        <p-button
          label="Enregistrer"
          icon="pi pi-check"
          severity="primary"
          [disabled]="busy()"
          [loading]="busy()"
          (onClick)="submit()" />
      </ng-template>
    </p-dialog>
  `,
  styles: [
    `
      :host {
        display: block;
        padding-top: 0.6rem;
      }
      .tab-actions {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
        margin-bottom: 0.7rem;
      }
      .intro {
        color: var(--ft-text-muted, #8b949e);
        font-size: 0.88rem;
        line-height: 1.5;
        margin: 0 0 1rem;
        max-width: 720px;
      }
      .strong { font-weight: 600; color: var(--ft-text); }
      .muted { color: var(--ft-text-subtle, #6e7681); font-style: italic; }
      .reason { color: var(--ft-text-muted, #8b949e); font-size: 0.88rem; }
      .cell-action { width: 3rem; text-align: right; }
      .error {
        color: var(--ft-danger-text, #f85149);
        background: var(--ft-danger-surface, rgba(248, 81, 73, 0.14));
        border: 1px solid var(--ft-danger-border, rgba(248, 81, 73, 0.4));
        border-radius: var(--ft-radius, 8px);
        padding: 0.6rem 0.85rem;
        margin: 0;
      }

      .form-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: var(--gap-md, 1rem);
        padding-top: 0.6rem;
      }
      .field { display: flex; flex-direction: column; gap: 0.35rem; }
      .field label {
        font-size: 0.78rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--ft-text-muted, #8b949e);
        font-weight: 600;
      }
      .checkbox { flex-direction: row; align-items: center; gap: 0.6rem; }
      :host ::ng-deep .w-full { width: 100%; }
      :host ::ng-deep .p-datepicker { width: 100%; }
    `
  ]
})
export class TenantModulesTabComponent implements OnChanges {
  private readonly api = inject(PlatformTenantModuleOverridesService);
  private readonly toast = inject(MessageService);

  @Input({ required: true }) tenantId: string | null = null;

  protected readonly overrides = signal<TenantModuleOverrideDto[]>([]);
  protected readonly loading = signal<boolean>(false);
  protected readonly busy = signal<boolean>(false);
  protected readonly errored = signal<boolean>(false);

  protected readonly showFormDialog = signal<boolean>(false);
  protected formModule: number = 0;
  protected formEnabled = true;
  protected formExpiresAt: Date | null = null;
  protected formReason = '';

  protected readonly minExpireDate = new Date();
  protected readonly moduleOptions = MODULE_CATALOG;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['tenantId']) this.reload();
  }

  reload(): void {
    if (!this.tenantId) {
      this.overrides.set([]);
      return;
    }
    this.loading.set(true);
    this.errored.set(false);
    this.api.list(this.tenantId).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.overrides.set(res.data);
        } else {
          this.errored.set(true);
        }
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.errored.set(true);
      }
    });
  }

  openCreate(): void {
    this.formModule = 0;
    this.formEnabled = true;
    this.formExpiresAt = null;
    this.formReason = '';
    this.showFormDialog.set(true);
  }

  closeForm(): void {
    this.showFormDialog.set(false);
  }

  submit(): void {
    if (!this.tenantId) return;
    const request: SetTenantModuleOverrideRequest = {
      module: this.formModule,
      isEnabled: this.formEnabled,
      expiresAt: this.formExpiresAt ? this.formExpiresAt.toISOString() : undefined,
      reason: this.formReason?.trim() || undefined
    };
    this.busy.set(true);
    this.api.set(this.tenantId, request).subscribe({
      next: (res) => {
        this.busy.set(false);
        if (res.success) {
          this.toast.add({ severity: 'success', summary: 'Override enregistré' });
          this.closeForm();
          this.reload();
        } else {
          this.toast.add({ severity: 'error', summary: 'Erreur', detail: res.message ?? '' });
        }
      },
      error: () => {
        this.busy.set(false);
        this.toast.add({ severity: 'error', summary: 'Erreur', detail: 'Impossible de contacter l’API.' });
      }
    });
  }

  remove(row: TenantModuleOverrideDto): void {
    if (!this.tenantId) return;
    this.busy.set(true);
    this.api.remove(this.tenantId, row.id).subscribe({
      next: (res) => {
        this.busy.set(false);
        if (res.success) {
          this.toast.add({ severity: 'success', summary: 'Override supprimé' });
          this.reload();
        } else {
          this.toast.add({ severity: 'error', summary: 'Erreur', detail: res.message ?? '' });
        }
      },
      error: () => {
        this.busy.set(false);
        this.toast.add({ severity: 'error', summary: 'Erreur', detail: 'Impossible de contacter l’API.' });
      }
    });
  }
}
