import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { DynamicFormComponent } from '@shared/studio-runtime/dynamic-form.component';
import { StudioService } from './studio.service';
import { CustomEntity, CustomEntitySchema, CustomField, FormLayout } from './studio.models';
import { StudioPageShellComponent } from './shared/studio-page-shell.component';
import { STUDIO_BREADCRUMBS } from './shared/studio-breadcrumb.util';
import { BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { SkeletonTableComponent } from '@shared/components/skeleton/skeleton-table.component';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { StudioRecordTabsComponent, StudioRecordTab } from './shared/studio-record-tabs.component';
import { StudioLinkedRecordsTabComponent } from './relations/studio-linked-records-tab.component';
import { StudioLinkChipsEditorComponent } from './relations/studio-link-chips-editor.component';
import { StudioRecordWorkflowsTabComponent } from './workflows/studio-record-workflows-tab.component';
import { StudioRecordHistoryTabComponent } from './records/studio-record-history-tab.component';
import { StudioWorkflowsService } from './workflows/studio-workflows.service';
import { STUDIO_WORKFLOW_LABELS } from './workflows/studio-workflow-labels';
import { WorkflowInstanceDto, isOpenInstance } from './workflows/studio-workflows.models';
import { STUDIO_RUNTIME_LABELS } from './shared/studio-runtime-labels';

/** Clé d'onglet « Liés » d'une relation N-N (jonction si connue, sinon la cible). */
function linkedTabKey(r: { junctionEntityKey?: string | null; targetEntityKey: string }): string {
  return `linked:${r.junctionEntityKey ?? r.targetEntityKey}`;
}

@Component({
  selector: 'app-studio-record-form',
  standalone: true,
  imports: [CommonModule, RouterModule, ToastModule, DynamicFormComponent, StudioPageShellComponent, SkeletonTableComponent, StudioRecordTabsComponent, StudioLinkedRecordsTabComponent, StudioLinkChipsEditorComponent, StudioRecordWorkflowsTabComponent, StudioRecordHistoryTabComponent],
  template: `
    <p-toast></p-toast>
    @if (entity(); as e) {
      <app-studio-page-shell
        [title]="(recordId ? (readOnly() ? 'Consulter' : 'Modifier') : 'Nouveau') + ' — ' + e.displayName"
        [subtitle]="recordId ? (readOnly() ? 'Consultation en lecture seule.' : 'Modifiez les champs ci-dessous.') : 'Remplissez le formulaire pour créer un enregistrement.'"
        [breadcrumbs]="breadcrumbs()">
        @if (showTabs()) {
          <app-studio-record-tabs [tabs]="tabs()" [(active)]="activeTab" />
        }
        @switch (activeTab()) {
          @case ('form') {
            @if (loading()) {
              <app-skeleton-table [columns]="[{width:'100%'}]" [rows]="6" />
            } @else if (fields().length > 0) {
              <div class="studio-form-card">
                <app-dynamic-form
                  [fields]="fields()"
                  [layout]="layout()"
                  [model]="model()"
                  [saving]="saving()"
                  [entityKey]="entityKey"
                  [readOnly]="readOnly()"
                  (save)="submit($event)"
                  (formCancel)="cancel()" />
              </div>
            } @else {
              <p class="studio-hint">
                Cette table n'a pas encore de champ.
                <a [routerLink]="['/studio', e.id]">Ajoutez des champs</a> avant de saisir des données.
              </p>
            }
            @if (recordId) {
              <!-- v1.1 / D-47-40 (R4) : une carte de puces par relation N-N, SOUS le formulaire ;
                   édition seulement (recordId requis — même garde que les onglets « Liés »). -->
              @for (rel of manyToMany(); track rel.junctionEntityKey) {
                <app-studio-link-chips-editor [relation]="rel" [recordId]="recordId!" [canWrite]="canWrite()" />
              }
            }
          }
          @case ('workflows') {
            <app-studio-record-workflows-tab [entityKey]="entityKey" [recordId]="recordId!" [instances]="workflowInstances() ?? []"
              [canWrite]="canWrite()" (changed)="loadWorkflowInstances()" />
          }
          @case ('history') {
            <!-- 4.7h5 / D-47-66 : historique de la fiche (lecture seule), chargé à l'activation de l'onglet (D-B4) ;
                 schéma COMPLET (champs inactifs compris) pour résoudre les libellés (D-B8). -->
            <app-studio-record-history-tab [entityKey]="entityKey" [recordId]="recordId!" [fields]="schema()?.fields ?? []" />
          }
          @default {
            @if (activeRelation(); as rel) {
              <app-studio-linked-records-tab [relation]="rel" [recordId]="recordId!" [canWrite]="canWrite()" />
            }
          }
        }
      </app-studio-page-shell>
    }
  `,
  styleUrl: './shared/studio-layout.scss',
})
export class StudioRecordFormComponent implements OnInit {
  private readonly studio = inject(StudioService);
  private readonly toast = inject(MessageService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly entity = signal<CustomEntity | null>(null);
  readonly fields = signal<CustomField[]>([]);
  readonly layout = signal<FormLayout | null>(null);
  readonly model = signal<Record<string, unknown> | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly breadcrumbs = signal<BreadcrumbItem[]>([]);
  /** Schéma complet (relations incluses, champs inactifs compris) — alimente l'onglet « Liés » (2.5e, N8 : Fiche / Liés) et les libellés de l'onglet « Historique » (4.7h5, D-B8). */
  readonly schema = signal<CustomEntitySchema | null>(null);
  readonly activeTab = signal('form');
  private readonly auth = inject(AuthService);
  readonly runtimeLabels = STUDIO_RUNTIME_LABELS;

  readonly canWrite = computed(() => this.auth.hasPermission(PERMISSIONS.customData.recordsWrite));
  /** 4.7 suite (D-47-94) : la route `/view` (custom_records:read) affiche la fiche en lecture seule.
   *  Tous les onglets restent visibles ; seules les actions d'écriture sont masquées (canWrite()). */
  readonly readOnly = computed(() => !!this.recordId && this.route.snapshot.routeConfig?.path === 'd/:key/:id/view');
  readonly manyToMany = computed(() => (this.schema()?.relations ?? []).filter(r => r.kind === 'many_to_many'));
  private readonly workflows = inject(StudioWorkflowsService);
  /** Sonde `listRecordInstances` : null = module coupé / droit absent (403-404) ⇒ onglet masqué (fail-closed, 4.4h2). */
  readonly workflowInstances = signal<WorkflowInstanceDto[] | null>(null);
  /** Badge de l'onglet : instances OUVERTES seulement, `null` si 0 pour ne pas afficher « 0 » (D-44-58). */
  readonly openWorkflowCount = computed(() => (this.workflowInstances() ?? []).filter(i => isOpenInstance(i.status)).length);
  readonly showWorkflowsTab = computed(() => !!this.recordId && this.workflowInstances() !== null);
  /** 4.7h5 / D-B2 : toute fiche existante porte la barre d'onglets (l'onglet « Historique » est toujours présent en édition). */
  readonly showTabs = computed(() => !!this.recordId);
  readonly tabs = computed<StudioRecordTab[]>(() => [
    { key: 'form', label: 'Fiche' },
    ...this.manyToMany().map(r => ({
      key: linkedTabKey(r),
      label: `${this.runtimeLabels.linked.tabLabel} — ${r.targetLabel}`
    })),
    ...(this.showWorkflowsTab()
      ? [{ key: 'workflows', label: STUDIO_WORKFLOW_LABELS.recordTab.tabLabel, badge: this.openWorkflowCount() || null }]
      : []),
    // 4.7h5 / D-B3 : « Historique » toujours en dernier, sans badge — fiche existante seulement (D-B2).
    ...(this.recordId ? [{ key: 'history', label: this.runtimeLabels.history.tabLabel }] : [])
  ]);
  readonly activeRelation = computed(() => {
    const key = this.activeTab();
    if (!key.startsWith('linked:')) return null;
    return this.manyToMany().find(r => linkedTabKey(r) === key) ?? null;
  });

  entityKey = '';
  recordId: string | null = null;

  ngOnInit(): void {
    this.entityKey = this.route.snapshot.paramMap.get('key') ?? '';
    this.recordId = this.route.snapshot.paramMap.get('id');
    this.studio.getSchema(this.entityKey).subscribe({
      next: res => {
        if (res.success) {
          this.schema.set(res.data);
          this.entity.set(res.data.entity);
          this.fields.set(res.data.fields.filter(f => f.isActive));
          this.layout.set(res.data.form);
          this.breadcrumbs.set(STUDIO_BREADCRUMBS.recordForm(
            res.data.entity.displayName, this.entityKey, !!this.recordId, this.readOnly()));
        }
        if (this.recordId) {
          this.studio.getRecord(this.entityKey, this.recordId).subscribe({
            next: r => { this.loading.set(false); if (r.success) this.model.set(r.data.data ?? {}); },
            error: () => { this.loading.set(false); this.toast.add({ severity: 'error', summary: 'Erreur', detail: 'Enregistrement introuvable.' }); }
          });
          // Sonde « Workflows » en parallèle de getRecord (D-44-59 : pas de latence ajoutée à la fiche).
          this.loadWorkflowInstances();
        } else {
          this.loading.set(false);
          this.model.set({});
        }
      },
      error: () => {
        this.loading.set(false);
        this.toast.add({ severity: 'error', summary: 'Erreur', detail: 'Schéma introuvable.' });
      }
    });
  }

  /** Sonde des instances du record (GET records/{key}/{id}/workflow-instances?max=20, skipErrorUi côté service). */
  loadWorkflowInstances(): void {
    if (!this.recordId) return;
    this.workflows.listRecordInstances(this.entityKey, this.recordId, 20).subscribe({
      next: res => this.workflowInstances.set(res.success ? (res.data ?? []) : []),
      error: () => this.workflowInstances.set(null)   // 403/404 : fail-closed silencieux, onglet absent
    });
  }

  submit(data: Record<string, unknown>): void {
    if (this.readOnly()) return; // D-47-94 : la fiche en lecture seule n'écrit jamais.
    this.saving.set(true);
    const obs = this.recordId
      ? this.studio.updateRecord(this.entityKey, this.recordId, data, null)
      : this.studio.createRecord(this.entityKey, data);
    obs.subscribe({
      next: res => {
        this.saving.set(false);
        if (res.success) {
          this.toast.add({ severity: 'success', summary: 'Enregistré' });
          this.router.navigate(['/studio/d', this.entityKey]);
        } else {
          this.toast.add({ severity: 'error', summary: 'Erreur', detail: res.errors?.[0] ?? res.message ?? 'Échec.' });
        }
      },
      error: err => {
        this.saving.set(false);
        this.toast.add({ severity: 'error', summary: 'Erreur', detail: err?.error?.message ?? 'Enregistrement impossible.' });
      }
    });
  }

  cancel(): void {
    this.router.navigate(['/studio/d', this.entityKey]);
  }
}
