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
import { CustomEntity, CustomView } from './studio.models';
import { StudioPageShellComponent } from './shared/studio-page-shell.component';
import { STUDIO_BREADCRUMBS } from './shared/studio-breadcrumb.util';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';

@Component({
  selector: 'app-studio-form-hub',
  standalone: true,
  imports: [CommonModule, RouterModule, TableModule, ButtonModule, TooltipModule, ToastModule, StudioPageShellComponent, EmptyStateComponent],
  template: `
    <p-toast></p-toast>
    <app-studio-page-shell
      title="Formulaires & vues" i18n-title="@@studio.studio-form-hub.formulaires.vues.b08f8230"
      subtitle="Concevez le formulaire de saisie ou une vue lecture seule sur une table SQL."
      [breadcrumbs]="breadcrumbs">
      <button pButton type="button" label="Nouvelle vue" i18n-label="@@studio.studio-form-hub.nouvelle.vue.5c1894bc" icon="fa-solid fa-database" class="p-button-outlined"
        studioActions routerLink="/studio/views/new"></button>

      <div class="studio-section-card">
        <h2 class="studio-section-title" i18n="@@studio.studio-form-hub.mes.tables.personnalisees.544bd9ef">Mes tables personnalisées</h2>
        <div class="ft-table-card">
          <p-table [value]="entities()" [loading]="loading()" styleClass="p-datatable-sm">
            <ng-template pTemplate="header">
              <tr><th i18n="@@studio.studio-form-hub.table.0424f6e7">Table</th><th class="studio-num" i18n="@@studio.studio-form-hub.champs.76943546">Champs</th><th style="width:22rem"></th></tr>
            </ng-template>
            <ng-template pTemplate="body" let-e>
              <tr>
                <td><i [class]="e.icon || 'fa-solid fa-table'" class="studio-mr"></i><strong>{{ e.displayName }}</strong></td>
                <td class="studio-num">{{ e.fieldCount }}</td>
                <td class="studio-actions">
                  <button pButton type="button" icon="fa-solid fa-table-cells-large" label="Formulaire" i18n-label="@@studio.studio-form-hub.formulaire.87e4e76f"
                    class="p-button-sm" [routerLink]="['/studio', e.id, 'form']"></button>
                  <button pButton type="button" icon="fa-solid fa-table-list" label="Données" i18n-label="@@studio.studio-form-hub.donnees.e3e0c5ec"
                    class="p-button-sm p-button-text" [routerLink]="['/studio/d', e.key]"></button>
                </td>
              </tr>
            </ng-template>
            <ng-template pTemplate="emptymessage">
              <tr><td colspan="3">
                <app-empty-state icon="pi-table" title="Aucune table" i18n-title="@@studio.studio-form-hub.aucune.table.05210918" description="Créez une table personnalisée pour concevoir son formulaire."
                  actionLabel="Créer une table" actionRoute="/studio" [showAction]="true" />
              </td></tr>
            </ng-template>
          </p-table>
        </div>
      </div>

      <div class="studio-section-card">
        <h2 class="studio-section-title" i18n="@@studio.studio-form-hub.vues.lecture.seule.78adbdec">Vues lecture seule</h2>
        <div class="ft-table-card">
          <p-table [value]="views()" [loading]="loadingViews()" styleClass="p-datatable-sm">
            <ng-template pTemplate="header">
              <tr><th i18n="@@studio.studio-form-hub.vue.09237dba">Vue</th><th i18n="@@studio.studio-form-hub.table.source.e8534ba8">Table source</th><th style="width:16rem"></th></tr>
            </ng-template>
            <ng-template pTemplate="body" let-v>
              <tr>
                <td><i class="fa-solid fa-database studio-mr"></i><strong>{{ v.displayName }}</strong></td>
                <td><code>{{ v.sourceTable }}</code></td>
                <td class="studio-actions">
                  <button pButton type="button" icon="fa-solid fa-eye" label="Voir" i18n-label="@@studio.studio-form-hub.voir.8a754f1f" class="p-button-sm p-button-text" [routerLink]="['/studio/views', v.id, 'view']"></button>
                  <button pButton type="button" icon="fa-solid fa-pen" class="p-button-sm p-button-text" [routerLink]="['/studio/views', v.id]" pTooltip="Modifier" i18n-pTooltip="@@studio.studio-form-hub.modifier.f260e757"></button>
                  <button pButton type="button" icon="fa-solid fa-trash" class="p-button-sm p-button-text p-button-danger" (click)="removeView(v)"></button>
                </td>
              </tr>
            </ng-template>
            <ng-template pTemplate="emptymessage">
              <tr><td colspan="3">
                <app-empty-state icon="pi-database" title="Aucune vue" i18n-title="@@studio.studio-form-hub.aucune.vue.6f4edeb8" description="Créez une vue lecture seule sur une table existante."
                  actionLabel="Nouvelle vue" actionRoute="/studio/views/new" [showAction]="true" />
              </td></tr>
            </ng-template>
          </p-table>
        </div>
      </div>
    </app-studio-page-shell>
  `,
  styleUrl: './shared/studio-layout.scss',
})
export class StudioFormHubComponent implements OnInit {
  private readonly studio = inject(StudioService);
  private readonly toast = inject(MessageService);
  private readonly confirmation = inject(ConfirmationService);

  readonly entities = signal<CustomEntity[]>([]);
  readonly views = signal<CustomView[]>([]);
  readonly loading = signal(false);
  readonly loadingViews = signal(false);
  readonly breadcrumbs = STUDIO_BREADCRUMBS.forms();

  ngOnInit(): void {
    this.loading.set(true);
    this.studio.listEntities(false).subscribe({
      next: res => { this.loading.set(false); if (res.success) this.entities.set(res.data ?? []); },
      error: () => { this.loading.set(false); this.toast.add({ severity: 'error', summary: $localize`:@@studio-form-hub.component.summary.Erreur:Erreur`, detail: $localize`:@@studio-form-hub.component.detail.Chargement_impos:Chargement impossible.` }); }
    });
    this.loadViews();
  }

  private loadViews(): void {
    this.loadingViews.set(true);
    this.studio.listViews().subscribe({
      next: res => { this.loadingViews.set(false); if (res.success) this.views.set(res.data ?? []); },
      error: () => this.loadingViews.set(false)
    });
  }

  removeView(v: CustomView): void {
    this.confirmation.confirm({
      message: `Supprimer la vue « ${v.displayName} » ?`,
      header: 'Confirmation',
      acceptLabel: $localize`:@@studio-form-hub.component.acceptLabel.Supprimer:Supprimer`,
      rejectLabel: $localize`:@@studio-form-hub.component.rejectLabel.Annuler:Annuler`,
      accept: () => {
        this.studio.deleteView(v.id).subscribe({
          next: res => { if (res.success) this.loadViews(); },
          error: () => this.toast.add({ severity: 'error', summary: $localize`:@@studio-form-hub.component.summary.Erreur:Erreur`, detail: $localize`:@@studio-form-hub.component.detail.Suppression_impo:Suppression impossible.` })
        });
      }
    });
  }
}
