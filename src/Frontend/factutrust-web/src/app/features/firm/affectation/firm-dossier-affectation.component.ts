import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TagModule } from 'primeng/tag';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import {
  DossierAssignmentFilter,
  FirmDossierAssignmentRow,
  FirmGovernanceService
} from '@core/services/firm-governance.service';
import { FirmGovernanceActionsService } from '../shared/firm-governance-actions.service';
import { FirmAffectAccountantDialogComponent } from './firm-affect-accountant-dialog.component';

@Component({
  selector: 'app-firm-dossier-affectation',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    TableModule,
    ButtonModule,
    InputTextModule,
    SelectModule,
    TagModule,
    PageHeaderComponent,
    EmptyStateComponent,
    FirmAffectAccountantDialogComponent
  ],
  template: `
    <app-page-header
      title="Affectation des dossiers"
      subtitle="Affecter les dossiers clients à un gestionnaire comptable">
      <p-button label="Retour" icon="pi pi-arrow-left" [outlined]="true" (onClick)="back()"></p-button>
      <p-button
        label="Affecter à un gestionnaire comptable"
        icon="pi pi-user-plus"
        [disabled]="selection.length === 0"
        (onClick)="openAffectDialog()"></p-button>
      <p-button
        label="Feuille de temps"
        icon="pi pi-clock"
        [outlined]="true"
        [disabled]="selection.length !== 1"
        (onClick)="openTimeSheet()"></p-button>
      <p-button
        label="Dossier permanent"
        icon="pi pi-folder-open"
        [outlined]="true"
        [disabled]="selection.length !== 1"
        (onClick)="openPermanentFile()"></p-button>
    </app-page-header>

    <div class="filters">
      <p-select
        [options]="filterOptions"
        [(ngModel)]="assignmentFilter"
        optionLabel="label"
        optionValue="value"
        (onChange)="reload()"></p-select>
      <input
        pInputText
        [(ngModel)]="nameFilter"
        placeholder="Rechercher par dénomination..."
        (keyup.enter)="reload()" />
      <button pButton type="button" icon="pi pi-search" label="Rechercher" (click)="reload()"></button>
      <button pButton type="button" class="p-button-link" label="Réinitialiser" (click)="resetFilters()"></button>
    </div>

    @if (!loading() && rows().length === 0) {
      <app-empty-state
        icon="pi-inbox"
        title="Aucun dossier"
        description="Aucun dossier ne correspond aux filtres sélectionnés.">
      </app-empty-state>
    } @else {
      <div class="fc-card">
        <p-table
          [value]="rows()"
          [loading]="loading()"
          [(selection)]="selection"
          dataKey="assignmentId"
          [paginator]="true"
          [rows]="15"
          responsiveLayout="scroll">
          <ng-template pTemplate="header">
            <tr>
              <th style="width: 3rem"><p-tableHeaderCheckbox></p-tableHeaderCheckbox></th>
              <th>Société</th>
              <th>Gestionnaire</th>
              <th>Statut DP</th>
              <th>Active depuis</th>
              <th style="width: 8rem"></th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-row>
            <tr>
              <td><p-tableCheckbox [value]="row"></p-tableCheckbox></td>
              <td>{{ row.companyName }}</td>
              <td>
                @if (row.assignedAccountantName) {
                  {{ row.assignedAccountantName }}
                } @else {
                  <span class="muted">En attente</span>
                }
              </td>
              <td>
                @if (row.hasPermanentFile) {
                  <p-tag
                    [value]="row.permanentFileStatusDisplay || 'Ouvert'"
                    [severity]="dpSeverity(row.permanentFileStatus)" />
                } @else {
                  <p-tag value="Absent" severity="secondary" />
                }
              </td>
              <td>{{ row.activeSince | date:'dd/MM/yyyy' }}</td>
              <td class="row-actions">
                <button
                  type="button"
                  class="link-btn"
                  (click)="openAffectDialog([row])"
                  title="Affecter">
                  <i class="pi pi-user-plus"></i>
                </button>
              </td>
            </tr>
          </ng-template>
        </p-table>
      </div>
    }

    <app-firm-affect-accountant-dialog
      [(visible)]="dialogVisible"
      [assignmentIds]="dialogAssignmentIds"
      (assigned)="onAssigned()">
    </app-firm-affect-accountant-dialog>
  `,
  styles: [`
    :host { display: block; }
    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      align-items: center;
      margin-bottom: 1rem;
    }
    .fc-card {
      background: var(--color-surface, #fff);
      border: 1px solid var(--color-border-subtle, #e2e8f0);
      border-radius: var(--radius-xl, 16px);
      box-shadow: var(--shadow-soft-sm, 0 1px 2px rgba(15, 23, 42, 0.05));
      padding: var(--spacing-2, 8px);
    }
    .muted { color: var(--color-text-muted, #94a3b8); font-style: italic; }
    .row-actions { text-align: right; }
    .link-btn {
      border: none;
      background: transparent;
      color: var(--color-primary-600, #2563eb);
      cursor: pointer;
      padding: 0.35rem;
      border-radius: 6px;
    }
    .link-btn:hover { background: var(--color-primary-50, #eff6ff); }
  `]
})
export class FirmDossierAffectationComponent implements OnInit {
  private readonly governance = inject(FirmGovernanceService);
  private readonly governanceActions = inject(FirmGovernanceActionsService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);

  readonly rows = signal<FirmDossierAssignmentRow[]>([]);
  readonly loading = signal(true);

  selection: FirmDossierAssignmentRow[] = [];
  assignmentFilter: DossierAssignmentFilter = 1;
  nameFilter = '';
  dialogVisible = false;
  dialogAssignmentIds: string[] = [];

  readonly filterOptions: { label: string; value: DossierAssignmentFilter }[] = [
    { label: 'En attente d\'affectation', value: 1 },
    { label: 'Affectés', value: 2 },
    { label: 'Tous', value: 0 }
  ];

  ngOnInit(): void {
    this.reload();
  }

  back(): void {
    this.location.back();
  }

  resetFilters(): void {
    this.assignmentFilter = 1;
    this.nameFilter = '';
    this.reload();
  }

  reload(): void {
    this.loading.set(true);
    this.selection = [];
    this.governance.listDossierAssignments(this.assignmentFilter, this.nameFilter).subscribe({
      next: res => {
        this.rows.set(res.data ?? []);
        this.loading.set(false);
      },
      error: () => {
        this.rows.set([]);
        this.loading.set(false);
      }
    });
  }

  openAffectDialog(rows?: FirmDossierAssignmentRow[]): void {
    const source = rows?.length ? rows : this.selection;
    if (!source.length) return;
    this.dialogAssignmentIds = source.map(r => r.assignmentId);
    this.dialogVisible = true;
  }

  onAssigned(): void {
    this.reload();
  }

  openTimeSheet(): void {
    const row = this.selection[0];
    if (!row) return;
    void this.router.navigate(['/firm/governance/time-sheets'], {
      queryParams: { assignmentId: row.assignmentId, companyName: row.companyName }
    });
  }

  openPermanentFile(): void {
    const row = this.selection[0];
    if (!row) return;
    if (row.hasPermanentFile) {
      const mode = row.permanentFileStatus === 2 ? 'view' : 'edit';
      this.governanceActions.openPermanentFile(row.assignmentId, mode);
    } else {
      void this.governanceActions.initializePermanentFile({
        assignmentId: row.assignmentId,
        companyName: row.companyName
      });
    }
  }

  dpSeverity(status?: number | null): 'success' | 'info' | 'warn' | 'danger' | 'secondary' {
    switch (status) {
      case 2: return 'success';
      case 1: return 'warn';
      case 9: return 'secondary';
      default: return 'info';
    }
  }
}
