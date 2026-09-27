/// <reference types="@angular/localize" />
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { MultiSelectModule } from 'primeng/multiselect';
import { MessageService } from 'primeng/api';
import { DynamicReportComponent } from '@shared/studio-runtime/dynamic-report.component';
import { erpCollatorCompare } from '@core/i18n/erp-format';
import { StudioService } from './studio.service';
import {
  ReportAggFn, ReportAggregation, ReportDataSourceKind, ReportDefinition, ReportFieldMeta, ReportFilter,
  ReportFilterOp, ReportResult, ReportSort, ReportSource
} from './studio.models';
import { StudioPageShellComponent } from './shared/studio-page-shell.component';
import { StudioDesignerShellComponent } from './shared/studio-designer-shell.component';
import { STUDIO_BREADCRUMBS } from './shared/studio-breadcrumb.util';
import { ToastModule } from 'primeng/toast';

@Component({
  selector: 'app-studio-report-designer',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, ButtonModule, InputTextModule, SelectModule, MultiSelectModule, DynamicReportComponent, ToastModule, StudioPageShellComponent, StudioDesignerShellComponent],
  template: `
    <p-toast></p-toast>
    <app-studio-page-shell
      [title]="(reportId ? loc_ui_tern_modifier_f260e7 : loc_ui_tern_nouveau_b9676c) + loc_ui_tern_rapport_fe9579"
      subtitle="Configurez source, filtres, agrégations et aperçu." i18n-subtitle="@@studio.studio-report-designer.configurez.source.filtres.agregations.et.d5f4c2e5"
      [breadcrumbs]="breadcrumbs()">
      <div studioActions class="studio-head-actions">
        <button pButton type="button" label="Aperçu" i18n-label="@@studio.studio-report-designer.apercu.f0f53004" icon="fa-solid fa-play" class="p-button-outlined" (click)="preview()"></button>
        <button pButton type="button" label="Enregistrer" i18n-label="@@studio.studio-report-designer.enregistrer.f7c8bcd8" icon="fa-solid fa-check" [disabled]="saving()" (click)="save()"></button>
      </div>

      <app-studio-designer-shell previewTitle="Aperçu du rapport">
        <div studioEditor>
          <label class="ft-lbl" i18n="@@studio.studio-report-designer.nom.du.rapport.b452b638">Nom du rapport *</label>
          <input pInputText [(ngModel)]="displayName" class="ft-w-full" placeholder="Ex. Ventes par région" i18n-placeholder="@@studio.studio-report-designer.ex.ventes.par.region.97cf7e33" />

          <label class="ft-lbl" i18n="@@studio.studio-report-designer.source.de.donnees.ceb89bdd">Source de données *</label>
          <p-select [options]="sources()" [(ngModel)]="sourceId" (ngModelChange)="onSourceChange()"
            optionLabel="displayName" optionValue="id" [group]="true" appendTo="body" panelStyleClass="studio-theme" styleClass="ft-w-full"
            placeholder="Choisir une table ou source" i18n-placeholder="@@studio.studio-report-designer.choisir.une.table.ou.source.e274c851"></p-select>

          <ng-container *ngIf="selectedSource() as src">
            <label class="ft-lbl" i18n="@@studio.studio-report-designer.regrouper.par.ac0889e9">Regrouper par</label>
            <p-multiSelect [options]="fieldOptions()" [(ngModel)]="grouping" optionLabel="label" optionValue="value"
              appendTo="body" panelStyleClass="studio-theme" styleClass="ft-w-full" placeholder="Aucun (rapport détaillé)" i18n-placeholder="@@studio.studio-report-designer.aucun.rapport.detaille.18f2957d"></p-multiSelect>

            <ng-container *ngIf="grouping.length === 0">
              <label class="ft-lbl" i18n="@@studio.studio-report-designer.colonnes.affichees.9cedff9b">Colonnes affichées</label>
              <p-multiSelect [options]="fieldOptions()" [(ngModel)]="detailFields" optionLabel="label" optionValue="value"
                appendTo="body" panelStyleClass="studio-theme" styleClass="ft-w-full" placeholder="Toutes les colonnes" i18n-placeholder="@@studio.studio-report-designer.toutes.les.colonnes.dcaedd40"></p-multiSelect>
            </ng-container>

            <ng-container *ngIf="grouping.length > 0">
              <div class="ft-block-head">
                <label class="ft-lbl" i18n="@@studio.studio-report-designer.calculs.agregations.2ad91593">Calculs (agrégations)</label>
                <button pButton type="button" icon="fa-solid fa-plus" class="p-button-text p-button-sm" label="Ajouter" i18n-label="@@studio.studio-report-designer.ajouter.87c57ed1" (click)="addAgg()"></button>
              </div>
              <div class="ft-line" *ngFor="let a of aggregations; let i = index">
                <p-select [options]="fnOptions" [(ngModel)]="a.fn" optionLabel="label" optionValue="value" appendTo="body" panelStyleClass="studio-theme"></p-select>
                <p-select *ngIf="a.fn !== 'count'" [options]="numericFieldOptions()" [(ngModel)]="a.field" optionLabel="label" optionValue="value"
                  appendTo="body" panelStyleClass="studio-theme" styleClass="ft-grow" placeholder="Champ" i18n-placeholder="@@studio.studio-report-designer.champ.e1472010"></p-select>
                <span *ngIf="a.fn === 'count'" class="ft-grow ft-muted" i18n="@@studio.studio-report-designer.tous.les.enregistrements.4e9454e2">tous les enregistrements</span>
                <button pButton type="button" icon="fa-solid fa-xmark" class="p-button-text p-button-sm p-button-danger" (click)="removeAgg(i)"></button>
              </div>
            </ng-container>

            <div class="ft-block-head">
              <label class="ft-lbl" i18n="@@studio.studio-report-designer.filtres.2a8e76e0">Filtres</label>
              <button pButton type="button" icon="fa-solid fa-plus" class="p-button-text p-button-sm" label="Ajouter" i18n-label="@@studio.studio-report-designer.ajouter.87c57ed1" (click)="addFilter()"></button>
            </div>
            <div class="ft-line" *ngFor="let f of filters; let i = index">
              <p-select [options]="fieldOptions()" [(ngModel)]="f.field" optionLabel="label" optionValue="value" appendTo="body" panelStyleClass="studio-theme" styleClass="ft-grow"></p-select>
              <p-select [options]="opOptions" [(ngModel)]="f.op" optionLabel="label" optionValue="value" appendTo="body" panelStyleClass="studio-theme"></p-select>
              <input pInputText [ngModel]="$any(f).value" (ngModelChange)="f.value = $event" placeholder="Valeur" i18n-placeholder="@@studio.studio-report-designer.valeur.68f92b0d" class="ft-grow" />
              <button pButton type="button" icon="fa-solid fa-xmark" class="p-button-text p-button-sm p-button-danger" (click)="removeFilter(i)"></button>
            </div>

            <div class="ft-block-head">
              <label class="ft-lbl" i18n="@@studio.studio-report-designer.tri.c05261e0">Tri</label>
              <button pButton type="button" icon="fa-solid fa-plus" class="p-button-text p-button-sm" label="Ajouter" i18n-label="@@studio.studio-report-designer.ajouter.87c57ed1" (click)="addSort()"></button>
            </div>
            <div class="ft-line" *ngFor="let s of sort; let i = index">
              <p-select [options]="sortFieldOptions()" [(ngModel)]="s.field" optionLabel="label" optionValue="value" appendTo="body" panelStyleClass="studio-theme" styleClass="ft-grow"></p-select>
              <p-select [options]="dirOptions" [(ngModel)]="s.dir" optionLabel="label" optionValue="value" appendTo="body" panelStyleClass="studio-theme"></p-select>
              <button pButton type="button" icon="fa-solid fa-xmark" class="p-button-text p-button-sm p-button-danger" (click)="removeSort(i)"></button>
            </div>
          </ng-container>
        </div>

        <div studioPreview>
          <app-dynamic-report [result]="result()"></app-dynamic-report>
        </div>
      </app-studio-designer-shell>
    </app-studio-page-shell>
  `,
  styles: [`
    .studio-head-actions { display: flex; gap: var(--spacing-2); }
  `],
  styleUrl: './shared/studio-layout.scss',
})
export class StudioReportDesignerComponent implements OnInit {
  readonly loc_ui_tern_modifier_f260e7 = $localize`:@@ui.tern.modifier.f260e7:Modifier`;
  readonly loc_ui_tern_nouveau_b9676c = $localize`:@@ui.tern.nouveau.b9676c:Nouveau`;
  readonly loc_ui_tern_rapport_fe9579 = $localize`:@@ui.tern.rapport.fe9579: rapport`;
  private readonly studio = inject(StudioService);
  private readonly toast = inject(MessageService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly breadcrumbs = signal(STUDIO_BREADCRUMBS.reportDesigner());

  readonly result = signal<ReportResult | null>(null);
  readonly saving = signal(false);
  private readonly sourcesRaw = signal<ReportSource[]>([]);
  /** Champs introspectés à la demande, mémorisés par `kind:ref` pour ne pas retourner au serveur. */
  private readonly lazyFields = signal<Record<string, ReportFieldMeta[]>>({});

  reportId: string | null = null;
  sourceId: string | null = null;

  displayName = '';
  grouping: string[] = [];
  detailFields: string[] = [];
  aggregations: ReportAggregation[] = [];
  filters: ReportFilter[] = [];
  sort: ReportSort[] = [];

  readonly fnOptions: { label: string; value: ReportAggFn }[] = [
    { label: $localize`:@@studio.studio-report-designer.ts.nombre.e68491e9:Nombre`, value: 'count' },
    { label: $localize`:@@studio.studio-report-designer.ts.somme.f38fb915:Somme`, value: 'sum' },
    { label: $localize`:@@studio.studio-report-designer.ts.moyenne.ef33304d:Moyenne`, value: 'avg' },
    { label: $localize`:@@studio.studio-report-designer.ts.min.7eb0cee8:Min`, value: 'min' },
    { label: $localize`:@@studio.studio-report-designer.ts.max.a95e85ae:Max`, value: 'max' }
  ];
  // `in` et `between` étaient déjà gérés côté serveur mais absents de l'interface.
  readonly opOptions: { label: string; value: ReportFilterOp }[] = [
    { label: '=', value: 'eq' }, { label: '≠', value: 'neq' },
    { label: '>', value: 'gt' }, { label: '≥', value: 'gte' },
    { label: '<', value: 'lt' }, { label: '≤', value: 'lte' },
    { label: $localize`:@@studio.studio-report-designer.ts.contient.207c5ba4:contient`, value: 'contains' },
    { label: $localize`:@@studio.studio-report-designer.ts.parmi.874b76e3:parmi`, value: 'in' }, { label: $localize`:@@studio.studio-report-designer.ts.entre.ed7ad1f6:entre`, value: 'between' }
  ];
  readonly dirOptions = [{ label: $localize`:@@studio.studio-report-designer.ts.croissant.c4f64a87:Croissant`, value: 'asc' }, { label: $localize`:@@studio.studio-report-designer.ts.decroissant.7e888644:Décroissant`, value: 'desc' }];

  /**
   * Grouped dropdown: custom tables, whitelisted existing sources, then the tenant's real tables
   * grouped by business domain (Ventes, Achats, Stock…). Option id = `${kind}:${ref}`.
   */
  readonly sources = computed(() => {
    const all = this.sourcesRaw();
    const custom = all.filter(s => s.kind === 'custom').map(this.toOption);
    const existing = all.filter(s => s.kind === 'existing').map(this.toOption);
    const groups: { label: string; items: { displayName: string; id: string }[] }[] = [];
    if (custom.length) groups.push({ label: $localize`:@@studio.studio-report-designer.ts.mes.tables.303981a7:Mes tables`, items: custom });
    if (existing.length) groups.push({ label: $localize`:@@studio.studio-report-designer.ts.donnees.existantes.lecture.seule.9c053270:Données existantes (lecture seule)`, items: existing });

    // Un groupe par domaine métier : 80 tables à plat seraient inutilisables.
    const byDomain = new Map<string, { displayName: string; id: string }[]>();
    for (const source of all.filter(s => s.kind === 'sql')) {
      const domain = source.domain ?? $localize`:@@ui.tern.autres.2f0dd0:Autres`;
      (byDomain.get(domain) ?? byDomain.set(domain, []).get(domain)!).push(this.toOption(source));
    }
    for (const [label, items] of byDomain) {
      groups.push({ label, items: items.sort((a, b) => erpCollatorCompare(a.displayName, b.displayName)) });
    }
    return groups;
  });

  readonly selectedSource = computed(() => this.sourcesRaw().find(s => `${s.kind}:${s.ref}` === this.sourceId) ?? null);

  /** Champs de la source sélectionnée : ceux du catalogue, ou ceux chargés à la demande (sources SQL). */
  readonly selectedFields = computed(() => {
    const source = this.selectedSource();
    if (!source) return [];
    return source.fields.length > 0 ? source.fields : (this.lazyFields()[`${source.kind}:${source.ref}`] ?? []);
  });

  readonly fieldOptions = computed(() => this.selectedFields().map(f => ({ label: f.label, value: f.key })));
  readonly numericFieldOptions = computed(() => this.selectedFields().filter(f => f.numeric).map(f => ({ label: f.label, value: f.key })));
  readonly sortFieldOptions = computed(() => {
    const fields = this.selectedFields();
    if (fields.length === 0) return [];
    const labelByKey = new Map(fields.map(f => [f.key, f.label] as const));
    const keys = this.grouping.length > 0
      ? [...this.grouping, ...this.aggregations.map(a => a.fn === 'count' ? 'count' : `${a.fn}_${a.field}`)]
      : fields.map(f => f.key);
    return keys.map(k => ({ label: labelByKey.get(k) ?? k, value: k }));
  });

  private toOption = (s: ReportSource) => ({ displayName: s.displayName, id: `${s.kind}:${s.ref}` });

  ngOnInit(): void {
    this.reportId = this.route.snapshot.paramMap.get('id');
    const preselect = this.route.snapshot.queryParamMap.get('source');
    this.studio.getReportSources().subscribe({
      next: res => {
        if (res.success) {
          this.sourcesRaw.set(res.data ?? []);
          if (this.reportId) {
            this.loadReport();
          } else if (preselect) {
            const match = (res.data ?? []).find(s => s.ref === preselect);
            if (match) this.sourceId = `${match.kind}:${match.ref}`;
          }
        }
      }
    });
  }

  private loadReport(): void {
    this.studio.getReport(this.reportId!).subscribe({
      next: res => {
        if (res.success) {
          const d = res.data;
          this.displayName = d.displayName;
          const kind = d.dataSourceKind === ReportDataSourceKind.ExistingSource ? 'existing'
            : d.dataSourceKind === ReportDataSourceKind.SqlQuery ? 'sql'
            : 'custom';
          this.sourceId = `${kind}:${d.dataSourceRef}`;
          this.ensureFieldsLoaded();
          this.grouping = [...(d.definition.grouping ?? [])];
          this.detailFields = [...(d.definition.fields ?? [])];
          this.aggregations = (d.definition.aggregations ?? []).map(a => ({ ...a }));
          this.filters = (d.definition.filters ?? []).map(f => ({ ...f }));
          this.sort = (d.definition.sort ?? []).map(s => ({ ...s }));
          this.preview();
        }
      }
    });
  }

  onSourceChange(): void {
    this.grouping = [];
    this.detailFields = [];
    this.aggregations = [];
    this.filters = [];
    this.sort = [];
    this.result.set(null);
    this.ensureFieldsLoaded();
  }

  /**
   * Les sources SQL arrivent sans champs : on introspecte la table à la sélection seulement.
   * Lister les colonnes des ~80 tables autorisées à l'ouverture du concepteur serait inutile.
   */
  private ensureFieldsLoaded(): void {
    const source = this.selectedSource();
    if (!source || source.fields.length > 0) return;

    const cacheKey = `${source.kind}:${source.ref}`;
    if (this.lazyFields()[cacheKey]) return;

    this.studio.getReportSourceFields(source.kind, source.ref).subscribe({
      next: res => {
        if (res.success) {
          this.lazyFields.update(current => ({ ...current, [cacheKey]: res.data ?? [] }));
        } else {
          this.toast.add({ severity: 'error', summary: $localize`:@@studio-report-designer.component.summary.Erreur:Erreur`, detail: res.errors?.[0] ?? $localize`:@@ui.tern.champs.indisponibles.9c357c:Champs indisponibles.` });
        }
      },
      error: err => this.toast.add({
        severity: 'error', summary: $localize`:@@studio-report-designer.component.summary.Erreur:Erreur`,
        detail: err?.error?.message ?? $localize`:@@ui.tern.champs.de.la.source.indisponibles.8712cc:Champs de la source indisponibles.`
      })
    });
  }

  addAgg(): void { this.aggregations = [...this.aggregations, { field: '', fn: 'count' }]; }
  removeAgg(i: number): void { this.aggregations = this.aggregations.filter((_, idx) => idx !== i); }
  addFilter(): void { this.filters = [...this.filters, { field: '', op: 'eq', value: '' }]; }
  removeFilter(i: number): void { this.filters = this.filters.filter((_, idx) => idx !== i); }
  addSort(): void { this.sort = [...this.sort, { field: '', dir: 'asc' }]; }
  removeSort(i: number): void { this.sort = this.sort.filter((_, idx) => idx !== i); }

  private buildDefinition(): ReportDefinition {
    return {
      fields: this.grouping.length === 0 ? this.detailFields : [],
      filters: this.filters.filter(f => f.field),
      grouping: this.grouping,
      aggregations: this.grouping.length > 0 ? this.aggregations.filter(a => a.fn === 'count' || a.field) : [],
      sort: this.sort.filter(s => s.field)
    };
  }

  private kindValue(): number {
    switch (this.selectedSource()?.kind) {
      case 'existing': return ReportDataSourceKind.ExistingSource;
      case 'sql': return ReportDataSourceKind.SqlQuery;
      default: return ReportDataSourceKind.CustomEntity;
    }
  }

  preview(): void {
    const src = this.selectedSource();
    if (!src) { this.toast.add({ severity: 'warn', summary: $localize`:@@studio-report-designer.component.summary.Source requi:Source requise`, detail: $localize`:@@studio-report-designer.component.detail.Choisissez_une_s:Choisissez une source de données.` }); return; }
    this.studio.previewReport({ dataSourceKind: this.kindValue(), dataSourceRef: src.ref, definition: this.buildDefinition() }).subscribe({
      next: res => { if (res.success) this.result.set(res.data); else this.toast.add({ severity: 'error', summary: $localize`:@@studio-report-designer.component.summary.Erreur:Erreur`, detail: res.errors?.[0] ?? $localize`:@@ui.tern.apercu.impossible.8df7df:Aperçu impossible.` }); },
      error: err => this.toast.add({ severity: 'error', summary: $localize`:@@studio-report-designer.component.summary.Erreur:Erreur`, detail: err?.error?.message ?? $localize`:@@ui.tern.apercu.impossible.8df7df:Aperçu impossible.` })
    });
  }

  save(): void {
    const src = this.selectedSource();
    if (!src) { this.toast.add({ severity: 'warn', summary: $localize`:@@studio-report-designer.component.summary.Source requi:Source requise`, detail: $localize`:@@studio-report-designer.component.detail.Choisissez_une_s:Choisissez une source de données.` }); return; }
    if (!this.displayName.trim()) { this.toast.add({ severity: 'warn', summary: $localize`:@@studio-report-designer.component.summary.Nom requis:Nom requis`, detail: $localize`:@@studio-report-designer.component.detail.Donnez_un_nom_au:Donnez un nom au rapport.` }); return; }
    this.saving.set(true);
    const req = { displayName: this.displayName.trim(), dataSourceKind: this.kindValue(), dataSourceRef: src.ref, definition: this.buildDefinition() };
    const obs = this.reportId ? this.studio.updateReport(this.reportId, req) : this.studio.createReport(req);
    obs.subscribe({
      next: res => {
        this.saving.set(false);
        if (res.success) {
          this.toast.add({ severity: 'success', summary: $localize`:@@studio-report-designer.component.summary.Rapport_enregist:Rapport enregistré` });
          this.router.navigate(['/studio/reports']);
        } else {
          this.toast.add({ severity: 'error', summary: $localize`:@@studio-report-designer.component.summary.Erreur:Erreur`, detail: res.errors?.[0] ?? res.message ?? $localize`:@@ui.tern.echec.0238a9:Échec.` });
        }
      },
      error: err => { this.saving.set(false); this.toast.add({ severity: 'error', summary: $localize`:@@studio-report-designer.component.summary.Erreur:Erreur`, detail: err?.error?.message ?? $localize`:@@ui.tern.enregistrement.impossible.206044:Enregistrement impossible.` }); }
    });
  }
}
