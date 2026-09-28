/// <reference types="@angular/localize" />
import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputSwitchModule } from 'primeng/inputswitch';
import { SelectModule } from 'primeng/select';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { Subject, debounceTime, takeUntil } from 'rxjs';
import { DynamicReportComponent } from '@shared/studio-runtime/dynamic-report.component';
import { ReportResult } from '@shared/studio-runtime/studio-runtime.models';
import { StudioService } from './studio.service';
import { SqlQueryResult, ViewColumnFormatOptions } from './studio.models';
import { StudioPageShellComponent } from './shared/studio-page-shell.component';
import { StudioDesignerShellComponent } from './shared/studio-designer-shell.component';
import { STUDIO_BREADCRUMBS } from './shared/studio-breadcrumb.util';
import { BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';

interface DesignColumn {
  name: string;
  dataType: string;
  numeric: boolean;
  included: boolean;
  label: string;
  width: 'full' | 'half';
  format: string;
  statusMapText: string;
  lookupTable: string;
  lookupDisplayColumn: string;
  suggestedFormat?: string | null;
}

@Component({
  selector: 'app-studio-view-designer',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterModule, DragDropModule,
    ButtonModule, InputTextModule, InputSwitchModule, SelectModule, ToastModule,
    DynamicReportComponent, StudioPageShellComponent, StudioDesignerShellComponent
  ],
  template: `
    <p-toast></p-toast>
    <app-studio-page-shell
      [title]="(viewId ? loc_ui_tern_modifier_f260e7 : loc_ui_tern_nouvelle_3278b0) + loc_ui_tern_vue_lecture_seule_485638"
      subtitle="Configurez les colonnes affichées depuis une table SQL existante." i18n-subtitle="@@studio.studio-view-designer.configurez.les.colonnes.affichees.depuis.d412ac7a"
      [breadcrumbs]="breadcrumbs()">
      <div studioActions class="studio-head-actions">
        <button pButton type="button" label="Aperçu" i18n-label="@@studio.studio-view-designer.apercu.f0f53004" icon="fa-solid fa-play" class="p-button-outlined" (click)="preview()"></button>
        <button pButton type="button" label="Enregistrer" i18n-label="@@studio.studio-view-designer.enregistrer.f7c8bcd8" icon="fa-solid fa-check" [disabled]="saving()" (click)="save()"></button>
      </div>

      <app-studio-designer-shell previewTitle="Aperçu (lecture seule)" i18n-previewTitle="@@studio.studio-view-designer.apercu.lecture.seule.cc77c764">
        <div studioEditor>
          <label class="studio-lbl" i18n="@@studio.studio-view-designer.nom.de.la.vue.86ef855c">Nom de la vue *</label>
          <input pInputText [(ngModel)]="displayName" class="studio-w-full" placeholder="Ex. Liste clients" i18n-placeholder="@@studio.studio-view-designer.ex.liste.clients.509e94e2" (ngModelChange)="schedulePreview()" />

          <label class="studio-lbl" i18n="@@studio.studio-view-designer.table.sql.existante.69202119">Table SQL existante *</label>
          <p-select [options]="tables()" [(ngModel)]="sourceTable" (ngModelChange)="onTableChange()"
            optionLabel="name" optionValue="name" [filter]="true" appendTo="body" panelStyleClass="studio-theme" styleClass="studio-w-full"
            placeholder="Choisir une table" i18n-placeholder="@@studio.studio-view-designer.choisir.une.table.9ec20a6a"></p-select>
          <small class="studio-hint" i18n="@@studio.studio-view-designer.lecture.seule.aucune.donnee.n.est.modifiee.par.u.6baf5fab">Lecture seule : aucune donnée n'est modifiée par une vue.</small>

          <div class="studio-block-head" style="margin-top: 1rem">
            <label class="studio-lbl" style="margin:0" i18n="@@studio.studio-view-designer.recherche.activee.4d16ddb9">Recherche activée</label>
            <p-inputSwitch [(ngModel)]="searchEnabled"></p-inputSwitch>
          </div>

          @if (columns().length > 0) {
            <label class="studio-lbl" i18n="@@studio.studio-view-designer.colonnes.53a2544c">Colonnes</label>
            <div class="studio-cols" cdkDropList (cdkDropListDropped)="drop($event)">
              @for (c of columns(); track c.name) {
                <div class="studio-col-row" cdkDrag [class.studio-col-row--off]="!c.included">
                  <i class="fa-solid fa-grip-vertical studio-drag-handle" cdkDragHandle></i>
                  <p-inputSwitch [(ngModel)]="c.included" (ngModelChange)="schedulePreview()"></p-inputSwitch>
                  <code class="studio-cname">{{ c.name }}</code>
                  <input pInputText [(ngModel)]="c.label" [placeholder]="c.name" class="studio-grow"
                    [disabled]="!c.included" (ngModelChange)="schedulePreview()" />
                  <p-select [options]="formatOptions" [(ngModel)]="c.format" optionLabel="label" optionValue="value"
                    appendTo="body" panelStyleClass="studio-theme" [disabled]="!c.included" (ngModelChange)="schedulePreview()"></p-select>
                  @if (c.included && c.format === 'status') {
                    <input pInputText [(ngModel)]="c.statusMapText" placeholder="1=Brouillon,3=Validé" i18n-placeholder="@@studio.studio-view-designer.1.brouillon.3.valide.6e930b25"
                      class="studio-grow" (ngModelChange)="schedulePreview()" />
                  }
                  @if (c.included && c.format === 'fk') {
                    <input pInputText [(ngModel)]="c.lookupTable" placeholder="Table" i18n-placeholder="@@studio.studio-view-designer.table.0424f6e7" class="studio-grow" (ngModelChange)="schedulePreview()" />
                    <input pInputText [(ngModel)]="c.lookupDisplayColumn" placeholder="Colonne" i18n-placeholder="@@studio.studio-view-designer.colonne.064b24f9" (ngModelChange)="schedulePreview()" />
                  }
                </div>
              }
            </div>
          }
        </div>
        <div studioPreview>
          <app-dynamic-report [result]="result()" [loading]="previewLoading()"></app-dynamic-report>
        </div>
      </app-studio-designer-shell>
    </app-studio-page-shell>
  `,
  styles: [`
    .studio-head-actions { display: flex; gap: var(--spacing-3); }
    .studio-drag-handle { cursor: grab; color: var(--color-neutral-400); }
  `],
  styleUrl: './shared/studio-layout.scss',
})
export class StudioViewDesignerComponent implements OnInit, OnDestroy {
  readonly loc_ui_tern_modifier_f260e7 = $localize`:@@ui.tern.modifier.f260e7:Modifier`;
  readonly loc_ui_tern_nouvelle_3278b0 = $localize`:@@ui.tern.nouvelle.3278b0:Nouvelle`;
  readonly loc_ui_tern_vue_lecture_seule_485638 = $localize`:@@ui.tern.vue.lecture.seule.485638: vue (lecture seule)`;
  private readonly studio = inject(StudioService);
  private readonly toast = inject(MessageService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly previewTrigger$ = new Subject<void>();
  private readonly destroy$ = new Subject<void>();

  readonly tables = signal<{ name: string }[]>([]);
  readonly columns = signal<DesignColumn[]>([]);
  readonly result = signal<ReportResult | null>(null);
  readonly saving = signal(false);
  readonly previewLoading = signal(false);
  readonly breadcrumbs = signal<BreadcrumbItem[]>(STUDIO_BREADCRUMBS.viewDesigner());

  viewId: string | null = null;
  displayName = '';
  sourceTable: string | null = null;
  searchEnabled = true;

  readonly formatOptions = [
    { label: $localize`:@@studio.studio-view-designer.ts.auto.c614ba7c:Auto`, value: 'auto' },
    { label: $localize`:@@studio.studio-view-designer.ts.texte.ff9afef1:Texte`, value: 'text' },
    { label: $localize`:@@studio.studio-view-designer.ts.date.eb9a4bc1:Date`, value: 'date' },
    { label: $localize`:@@studio.studio-view-designer.ts.date.heure.3c4dd1be:Date/heure`, value: 'datetime' },
    { label: $localize`:@@studio.studio-view-designer.ts.nombre.e68491e9:Nombre`, value: 'number' },
    { label: $localize`:@@studio.studio-view-designer.ts.monetaire.5b9130b4:Monétaire`, value: 'money' },
    { label: $localize`:@@studio.studio-view-designer.ts.booleen.76d7ac23:Booléen`, value: 'boolean' },
    { label: $localize`:@@studio.studio-view-designer.ts.statut.659499f3:Statut`, value: 'status' },
    { label: $localize`:@@studio.studio-view-designer.ts.cle.etrangere.57b1da1f:Clé étrangère`, value: 'fk' },
  ];

  readonly widthOptions = [{ label: $localize`:@@studio.studio-view-designer.ts.pleine.7c970f6b:Pleine`, value: 'full' }, { label: $localize`:@@studio.studio-view-designer.ts.demi.2afabf13:Demi`, value: 'half' }];

  ngOnInit(): void {
    this.previewTrigger$.pipe(debounceTime(300), takeUntil(this.destroy$)).subscribe(() => this.preview());
    this.viewId = this.route.snapshot.paramMap.get('id');
    this.studio.listSchemaTables().subscribe({
      next: res => { if (res.success) this.tables.set(res.data ?? []); },
      error: () => this.toast.add({ severity: 'error', summary: $localize`:@@studio-view-designer.component.summary.Erreur:Erreur`, detail: $localize`:@@studio-view-designer.component.detail.Tables_introuvab:Tables introuvables.` })
    });
    if (this.viewId) this.loadView();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  schedulePreview(): void { this.previewTrigger$.next(); }

  drop(event: CdkDragDrop<DesignColumn[]>): void {
    const arr = [...this.columns()];
    moveItemInArray(arr, event.previousIndex, event.currentIndex);
    this.columns.set(arr);
    this.schedulePreview();
  }

  private loadView(): void {
    this.studio.getView(this.viewId!).subscribe({
      next: res => {
        if (res.success) {
          const v = res.data;
          this.displayName = v.displayName;
          this.sourceTable = v.sourceTable;
          this.searchEnabled = v.definition.search !== false;
          this.breadcrumbs.set(STUDIO_BREADCRUMBS.viewDesigner(v.displayName));
          this.studio.listSchemaColumns(v.sourceTable).subscribe({
            next: cr => {
              if (cr.success) {
                const byName = new Map((v.definition.columns ?? []).map(c => [c.name, c] as const));
                const live = cr.data ?? [];
                const included = (v.definition.columns ?? [])
                  .map(dc => live.find(l => l.name === dc.name))
                  .filter((l): l is NonNullable<typeof l> => !!l)
                  .map(l => this.toDesign(l, byName.get(l.name), true));
                const rest = live.filter(l => !byName.has(l.name)).map(l => this.toDesign(l, null, false));
                this.columns.set([...included, ...rest]);
                this.preview();
              }
            }
          });
        }
      }
    });
  }

  onTableChange(): void {
    this.columns.set([]);
    this.result.set(null);
    if (!this.sourceTable) return;
    this.studio.listSchemaColumns(this.sourceTable).subscribe({
      next: res => {
        if (res.success) {
          this.columns.set((res.data ?? []).map((c, i) => this.toDesign(c, null, i < 8)));
          this.schedulePreview();
        }
      },
      error: () => this.toast.add({ severity: 'error', summary: $localize`:@@studio-view-designer.component.summary.Erreur:Erreur`, detail: $localize`:@@studio-view-designer.component.detail.Colonnes_introuv:Colonnes introuvables.` })
    });
  }

  private toDesign(
    c: { name: string; dataType: string; numeric: boolean; suggestedFormat?: string | null; foreignKey?: { referencedTable: string } | null },
    saved: { label?: string | null; format?: string | null; formatOptions?: ViewColumnFormatOptions | null } | null | undefined,
    included: boolean
  ): DesignColumn {
    const statusMap = saved?.formatOptions?.statusMap ?? {};
    return {
      name: c.name,
      dataType: c.dataType,
      numeric: c.numeric,
      included,
      label: saved?.label ?? '',
      width: 'full',
      format: saved?.format ?? c.suggestedFormat ?? 'auto',
      statusMapText: Object.entries(statusMap).map(([k, v]) => `${k}=${v}`).join(','),
      lookupTable: saved?.formatOptions?.lookupTable ?? c.foreignKey?.referencedTable ?? '',
      lookupDisplayColumn: saved?.formatOptions?.lookupDisplayColumn ?? 'Name',
      suggestedFormat: c.suggestedFormat
    };
  }

  private selectedNames(): string[] {
    return this.columns().filter(c => c.included).map(c => c.name);
  }

  private mapResult(r: SqlQueryResult): ReportResult {
    const labelByName = new Map(this.columns().filter(c => c.included).map(c => [c.name, c.label?.trim() || c.name] as const));
    return {
      columns: r.columns.map(c => ({
        key: c.key,
        label: labelByName.get(c.key) ?? c.label ?? c.key,
        kind: c.kind,
        format: c.format,
        formatOptions: c.formatOptions,
        dataType: c.dataType,
        numeric: c.numeric
      })),
      rows: r.rows,
      totalRows: r.totalRows,
      displayValues: r.displayValues ?? null
    };
  }

  preview(): void {
    if (!this.sourceTable) return;
    const cols = this.selectedNames();
    if (cols.length === 0) return;
    this.previewLoading.set(true);
    this.studio.previewSchema({ table: this.sourceTable, columns: cols, page: 1, pageSize: 25 }).subscribe({
      next: res => {
        this.previewLoading.set(false);
        if (res.success) this.result.set(this.mapResult(res.data));
      },
      error: () => this.previewLoading.set(false)
    });
  }

  save(): void {
    if (!this.displayName.trim()) {
      this.toast.add({ severity: 'warn', summary: $localize`:@@studio-view-designer.component.summary.Nom requis:Nom requis`, detail: $localize`:@@studio-view-designer.component.detail.Donnez_un_nom_:Donnez un nom à la vue.` });
      return;
    }
    if (!this.sourceTable) {
      this.toast.add({ severity: 'warn', summary: $localize`:@@studio-view-designer.component.summary.Table requis:Table requise`, detail: $localize`:@@studio-view-designer.component.detail.Choisissez_une_t:Choisissez une table.` });
      return;
    }
    const cols = this.columns().filter(c => c.included).map(c => ({
      name: c.name,
      label: c.label?.trim() || null,
      width: c.width,
      format: c.format === 'auto' ? null : c.format,
      formatOptions: this.buildFormatOptions(c)
    }));
    if (cols.length === 0) {
      this.toast.add({ severity: 'warn', summary: $localize`:@@studio-view-designer.component.summary.Colonnes_requise:Colonnes requises`, detail: $localize`:@@studio-view-designer.component.detail.Cochez_au_moins_:Cochez au moins une colonne.` });
      return;
    }

    this.saving.set(true);
    const req = {
      displayName: this.displayName.trim(),
      sourceTable: this.sourceTable,
      definition: { columns: cols, search: this.searchEnabled }
    };
    const obs = this.viewId ? this.studio.updateView(this.viewId, req) : this.studio.createView(req);
    obs.subscribe({
      next: res => {
        this.saving.set(false);
        if (res.success) {
          this.toast.add({ severity: 'success', summary: $localize`:@@studio-view-designer.component.summary.Vue_enregistr_e:Vue enregistrée` });
          this.router.navigate(['/studio/forms']);
        } else {
          this.toast.add({ severity: 'error', summary: $localize`:@@studio-view-designer.component.summary.Erreur:Erreur`, detail: res.errors?.[0] ?? res.message ?? $localize`:@@ui.tern.echec.0238a9:Échec.` });
        }
      },
      error: err => {
        this.saving.set(false);
        this.toast.add({ severity: 'error', summary: $localize`:@@studio-view-designer.component.summary.Erreur:Erreur`, detail: err?.error?.message ?? $localize`:@@ui.tern.enregistrement.impossible.206044:Enregistrement impossible.` });
      }
    });
  }

  private buildFormatOptions(c: DesignColumn): ViewColumnFormatOptions | null {
    if (c.format === 'status' && c.statusMapText.trim()) {
      const map: Record<string, string> = {};
      for (const part of c.statusMapText.split(',')) {
        const [k, v] = part.split('=').map(s => s.trim());
        if (k && v) map[k] = v;
      }
      return Object.keys(map).length ? { statusMap: map } : null;
    }
    if (c.format === 'fk' && c.lookupTable.trim()) {
      return { lookupTable: c.lookupTable.trim(), lookupDisplayColumn: c.lookupDisplayColumn.trim() || 'Name' };
    }
    return null;
  }
}
