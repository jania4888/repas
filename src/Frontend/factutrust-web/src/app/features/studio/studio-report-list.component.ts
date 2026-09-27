/// <reference types="@angular/localize" />
import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { ConfirmationService } from '@core/services/confirmation.service';
import { StudioService } from './studio.service';
import { CustomReport, ReportDataSourceKind } from './studio.models';
import { StudioPageShellComponent } from './shared/studio-page-shell.component';
import { STUDIO_BREADCRUMBS } from './shared/studio-breadcrumb.util';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';

@Component({
  selector: 'app-studio-report-list',
  standalone: true,
  imports: [CommonModule, RouterModule, TableModule, ButtonModule, TooltipModule, ToastModule, StudioPageShellComponent, EmptyStateComponent],
  template: `
    <p-toast></p-toast>
    <app-studio-page-shell
      title="Rapports" i18n-title="Rapports"
      subtitle="Analysez vos tables personnalisées et vos données existantes."
      [breadcrumbs]="breadcrumbs">
      <button pButton type="button" label="Nouveau rapport" i18n-label="Nouveau rapport" icon="fa-solid fa-plus" studioActions routerLink="/studio/reports/new"></button>

      <div class="ft-table-card">
        <p-table [value]="reports()" [loading]="loading()" styleClass="p-datatable-sm">
          <ng-template pTemplate="header">
            <tr><th i18n="@@studio.studio-report-list.nom.7ff20370">Nom</th><th i18n="@@studio.studio-report-list.source.6da13add">Source</th><th i18n="@@studio.studio-report-list.type.3deb7456">Type</th><th style="width:9rem"></th></tr>
          </ng-template>
          <ng-template pTemplate="body" let-r>
            <tr>
              <td><strong>{{ r.displayName }}</strong></td>
              <td>
                <i [class]="r.dataSourceKind === ExistingKind ? 'fa-solid fa-database' : 'fa-solid fa-table'" class="studio-mr"></i>
                {{ r.dataSourceRef }}
              </td>
              <td>{{ r.definition.grouping.length > 0 ? loc_ui_tern_agrege_a31b89 : loc_ui_tern_detail_7ce06a }}</td>
              <td class="studio-actions">
                <button pButton type="button" icon="fa-solid fa-eye" class="p-button-text p-button-sm" [routerLink]="['/studio/reports', r.id, 'view']" pTooltip="Voir" i18n-pTooltip="Voir"></button>
                <button pButton type="button" icon="fa-solid fa-pen" class="p-button-text p-button-sm" [routerLink]="['/studio/reports', r.id]" pTooltip="Modifier" i18n-pTooltip="Modifier"></button>
                <button pButton type="button" icon="fa-solid fa-trash" class="p-button-text p-button-sm p-button-danger" (click)="remove(r)"></button>
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr><td colspan="4">
              <app-empty-state icon="pi-chart-bar" title="Aucun rapport" i18n-title="Aucun rapport" description="Créez votre premier rapport analytique."
                actionLabel="Nouveau rapport" actionRoute="/studio/reports/new" [showAction]="true" />
            </td></tr>
          </ng-template>
        </p-table>
      </div>
    </app-studio-page-shell>
  `,
  styleUrl: './shared/studio-layout.scss',
})
export class StudioReportListComponent implements OnInit {
  readonly loc_ui_tern_agrege_a31b89 = $localize`:@@ui.tern.agrege.a31b89:Agrégé`;
  readonly loc_ui_tern_detail_7ce06a = $localize`:@@ui.tern.detail.7ce06a:Détail`;
  private readonly studio = inject(StudioService);
  private readonly toast = inject(MessageService);
  private readonly confirmation = inject(ConfirmationService);

  readonly ExistingKind = ReportDataSourceKind.ExistingSource;
  readonly reports = signal<CustomReport[]>([]);
  readonly loading = signal(false);
  readonly breadcrumbs = STUDIO_BREADCRUMBS.reports();

  ngOnInit(): void { this.load(); }

  private load(): void {
    this.loading.set(true);
    this.studio.listReports().subscribe({
      next: res => { this.loading.set(false); if (res.success) this.reports.set(res.data ?? []); },
      error: () => { this.loading.set(false); this.toast.add({ severity: 'error', summary: $localize`:@@studio-report-list.component.summary.Erreur:Erreur`, detail: $localize`:@@studio-report-list.component.detail.Chargement_impos:Chargement impossible.` }); }
    });
  }

  remove(r: CustomReport): void {
    this.confirmation.confirm({
      message: `Supprimer le rapport « ${r.displayName} » ?`,
      header: 'Confirmation',
      acceptLabel: $localize`:@@studio-report-list.component.acceptLabel.Supprimer:Supprimer`,
      rejectLabel: $localize`:@@studio-report-list.component.rejectLabel.Annuler:Annuler`,
      accept: () => {
        this.studio.deleteReport(r.id).subscribe({
          next: res => { if (res.success) this.load(); },
          error: () => this.toast.add({ severity: 'error', summary: $localize`:@@studio-report-list.component.summary.Erreur:Erreur`, detail: $localize`:@@studio-report-list.component.detail.Suppression_impo:Suppression impossible.` })
        });
      }
    });
  }
}
