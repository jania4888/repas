import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputSwitchModule } from 'primeng/inputswitch';
import { SelectModule } from 'primeng/select';
import { MultiSelectModule } from 'primeng/multiselect';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { ConfirmationService } from '@core/services/confirmation.service';
import { CustomField, CustomFieldType } from '@shared/studio-runtime/studio-runtime.models';
import { BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { StudioService } from '../studio.service';
import { StudioPageShellComponent } from '../shared/studio-page-shell.component';
import { StudioFilterBuilderComponent } from '../shared/studio-filter-builder.component';
import { STUDIO_RUNTIME_LABELS } from '../shared/studio-runtime-labels';
import { STUDIO_BREADCRUMBS } from '../shared/studio-breadcrumb.util';
import { StudioRecordViewsService } from './studio-record-views.service';
import { StudioRecordViewRunnerComponent } from './studio-record-view-runner.component';
import {
  CustomRecordViewDto, RECORD_VIEW_LIMITS, RECORD_VIEW_PERSISTED_KEYS, RecordViewCalendar, RecordViewColumn,
  RecordViewDefinition, RecordViewFilter, RecordViewKanban, RecordViewMode, RecordViewSort, SaveCustomRecordViewRequest
} from './studio-record-views.models';
import { slugifyKey } from '../shared/studio-text.util';

/** Option `{ key, label }` d'un `p-select` de champ. */
interface FieldOption { key: string; label: string; }

/** Bandeau d'erreur métier (409 clé / vue périmée, 400 quota ou validation serveur). */
interface DesignerError { message: string; stale: boolean; }

const PERSISTED_LABELS: Readonly<Record<string, string>> = { createdAt: 'Créé le', updatedAt: 'Modifié le' };

/**
 * Concepteur de vue enregistrée (2.5d) : routes `d/:key/views/new` (création) et
 * `d/:key/views/:viewId` (édition). Mode Liste complet (colonnes, filtres, tris, pagination,
 * recherche) + sections Kanban / Calendrier (2.5d2) et aperçu R3 en édition (colonne collante,
 * `previewLimit=20`, bouton « Actualiser l'aperçu »). Les bornes `RECORD_VIEW_LIMITS` sont
 * appliquées côté client par confort ; le serveur reste l'autorité (toute erreur 400/409 est rendue
 * en ligne, jamais via le toast global).
 */
@Component({
  selector: 'app-studio-record-view-designer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, ButtonModule, InputTextModule, InputNumberModule, InputSwitchModule, SelectModule,
    MultiSelectModule, StudioPageShellComponent, StudioFilterBuilderComponent, StudioRecordViewRunnerComponent
  ],
  template: `
    <app-studio-page-shell [title]="labels.designer.title" [subtitle]="subtitle()" [breadcrumbs]="breadcrumbs()">
      <div studioActions class="studio-head-actions">
        @if (editing && canDesign()) {
          @if (!isDefault()) {
            <p-button [label]="labels.designer.setDefault" icon="pi pi-star" [outlined]="true" size="small"
              [disabled]="saving()" (onClick)="setDefault()" data-testid="designer-set-default" />
          }
          <p-button [label]="labels.designer.delete" icon="pi pi-trash" severity="danger" [outlined]="true" size="small"
            [disabled]="saving()" (onClick)="delete()" data-testid="designer-delete" />
        }
      </div>

      @if (loading()) {
        <p class="studio-muted">Chargement…</p>
      } @else {
        @if (error(); as err) {
          <div class="studio-row studio-row-section" role="alert" data-testid="designer-error">
            <i class="pi pi-exclamation-triangle studio-mr"></i>
            <span class="studio-grow">{{ err.message }}</span>
            @if (err.stale) {
              <p-button label="Recharger" icon="pi pi-refresh" size="small" [text]="true" (onClick)="reload()" data-testid="designer-reload" />
            }
          </div>
        }

        <div class="studio-designer">
          <section class="studio-editor studio-form">
            <label class="studio-lbl" for="rvd-name">{{ labels.designer.name }} *</label>
            <input pInputText id="rvd-name" class="studio-w-full" [ngModel]="displayName()" (ngModelChange)="onNameChange($event)"
              maxlength="120" [disabled]="!canDesign()" data-testid="designer-name" />

            <label class="studio-lbl" for="rvd-key">{{ labels.designer.key }} *</label>
            <input pInputText id="rvd-key" class="studio-w-full" [ngModel]="key()" (ngModelChange)="onKeyChange($event)"
              maxlength="64" [disabled]="editing || !canDesign()" data-testid="designer-key" />
            @if (editing) {
              <small class="studio-hint">{{ labels.designer.keyImmutable }}</small>
            } @else if (key() && !keyValid()) {
              <small class="studio-hint" data-testid="designer-key-invalid">{{ labels.designer.invalidKey }}</small>
            }

            <label class="studio-lbl" for="rvd-mode">{{ labels.designer.mode }}</label>
            <p-select inputId="rvd-mode" [options]="modeOptions" [ngModel]="mode()" (ngModelChange)="onModeChange($event)"
              optionLabel="label" optionValue="value" [disabled]="!canDesign()" appendTo="body" panelStyleClass="studio-theme" />

            @if (mode() === 'Kanban') {
              <div class="studio-row-section rvd-mode-section" data-testid="designer-kanban">
                <h3 class="studio-section-title">Kanban</h3>
                <label class="studio-lbl" for="rvd-kanban-group">{{ labels.designer.kanbanGroupBy }} *</label>
                <p-select inputId="rvd-kanban-group" class="studio-w-full" [options]="kanbanGroupByOptions()" [ngModel]="kanban().groupByFieldKey"
                  (ngModelChange)="patchKanban({ groupByFieldKey: $event })" optionLabel="label" optionValue="key"
                  [disabled]="!canDesign()" appendTo="body" panelStyleClass="studio-theme" data-testid="designer-kanban-group" />
                <label class="studio-lbl" for="rvd-kanban-title">Champ de titre</label>
                <p-select inputId="rvd-kanban-title" class="studio-w-full" [options]="fieldOptions()" [ngModel]="kanban().titleFieldKey"
                  (ngModelChange)="patchKanban({ titleFieldKey: $event })" optionLabel="label" optionValue="key" [showClear]="true"
                  [disabled]="!canDesign()" appendTo="body" panelStyleClass="studio-theme" />
                <label class="studio-lbl">Champs de la carte ({{ kanban().cardFieldKeys?.length ?? 0 }}/{{ limits.maxCardFields }})</label>
                <p-multiSelect class="studio-w-full" [options]="fieldOptions()" [ngModel]="kanban().cardFieldKeys ?? []"
                  (ngModelChange)="patchKanban({ cardFieldKeys: ($event ?? []).slice(0, limits.maxCardFields) })"
                  optionLabel="label" optionValue="key" [maxSelectedLabels]="3" [selectedItemsLabel]="'{0} champs'"
                  [disabled]="!canDesign()" appendTo="body" panelStyleClass="studio-theme" data-testid="designer-kanban-cards" />
                <div class="studio-line">
                  <p-inputSwitch inputId="rvd-kanban-empty" [ngModel]="kanban().showEmptyGroup"
                    (ngModelChange)="patchKanban({ showEmptyGroup: $event })" [disabled]="!canDesign()" />
                  <label for="rvd-kanban-empty">Afficher la colonne « {{ labels.kanban.emptyGroup }} »</label>
                </div>
              </div>
            }

            @if (mode() === 'Calendar') {
              <div class="studio-row-section rvd-mode-section" data-testid="designer-calendar">
                <h3 class="studio-section-title">Calendrier</h3>
                <label class="studio-lbl" for="rvd-cal-start">{{ labels.designer.calendarStart }} *</label>
                <p-select inputId="rvd-cal-start" class="studio-w-full" [options]="dateOptions()" [ngModel]="calendar().startFieldKey"
                  (ngModelChange)="patchCalendar({ startFieldKey: $event })" optionLabel="label" optionValue="key"
                  [disabled]="!canDesign()" appendTo="body" panelStyleClass="studio-theme" data-testid="designer-calendar-start" />
                <label class="studio-lbl" for="rvd-cal-end">Champ de fin</label>
                <p-select inputId="rvd-cal-end" class="studio-w-full" [options]="dateOptions()" [ngModel]="calendar().endFieldKey"
                  (ngModelChange)="patchCalendar({ endFieldKey: $event })" optionLabel="label" optionValue="key" [showClear]="true"
                  [disabled]="!canDesign()" appendTo="body" panelStyleClass="studio-theme" />
                <label class="studio-lbl" for="rvd-cal-title">Champ de titre</label>
                <p-select inputId="rvd-cal-title" class="studio-w-full" [options]="fieldOptions()" [ngModel]="calendar().titleFieldKey"
                  (ngModelChange)="patchCalendar({ titleFieldKey: $event })" optionLabel="label" optionValue="key" [showClear]="true"
                  [disabled]="!canDesign()" appendTo="body" panelStyleClass="studio-theme" />
                <label class="studio-lbl" for="rvd-cal-color">Champ de couleur</label>
                <p-select inputId="rvd-cal-color" class="studio-w-full" [options]="optionColorOptions()" [ngModel]="calendar().colorFieldKey"
                  (ngModelChange)="patchCalendar({ colorFieldKey: $event })" optionLabel="label" optionValue="key" [showClear]="true"
                  [disabled]="!canDesign()" appendTo="body" panelStyleClass="studio-theme" />
              </div>
            }

            <div class="studio-block-head">
              <span class="studio-lbl">{{ labels.designer.columns }} ({{ columns().length }}/{{ limits.maxColumns }})</span>
              <p-select [options]="availableColumnOptions()" [ngModel]="null" (ngModelChange)="addColumn($event)"
                optionLabel="label" optionValue="key" placeholder="Ajouter une colonne" appendTo="body" panelStyleClass="studio-theme"
                [disabled]="!canDesign() || columns().length >= limits.maxColumns" data-testid="designer-add-column" />
            </div>
            @if (columns().length >= limits.maxColumns) {
              <small class="studio-hint">{{ labels.designer.columnLimit }}</small>
            }
            <div class="studio-cols">
              @for (col of columns(); track col.fieldKey; let i = $index; let first = $first; let last = $last) {
                <div class="studio-col-row" [class.studio-col-row--off]="col.hidden" [attr.data-testid]="'designer-column-' + i">
                  <span class="studio-grow">{{ fieldLabel(col.fieldKey) }}</span>
                  <span class="studio-row-move">
                    <p-button icon="pi pi-chevron-up" [text]="true" size="small" [disabled]="first" (onClick)="moveColumn(i, -1)" ariaLabel="Monter" />
                    <p-button icon="pi pi-chevron-down" [text]="true" size="small" [disabled]="last" (onClick)="moveColumn(i, 1)" ariaLabel="Descendre" />
                  </span>
                  <p-button [icon]="col.hidden ? 'pi pi-eye-slash' : 'pi pi-eye'" [text]="true" size="small"
                    (onClick)="toggleColumnHidden(i)" [ariaLabel]="col.hidden ? 'Afficher' : 'Masquer'" />
                  <p-button icon="pi pi-times" [text]="true" size="small" severity="danger" (onClick)="removeColumn(i)" ariaLabel="Retirer" />
                </div>
              } @empty {
                <p class="studio-muted">Aucune colonne : toutes les colonnes actives seront affichées.</p>
              }
            </div>

            <span class="studio-lbl">{{ labels.filters.title }}</span>
            <app-studio-filter-builder [fields]="activeFields()" [(filters)]="filters" [disabled]="!canDesign()" />

            <div class="studio-block-head">
              <span class="studio-lbl">{{ labels.designer.sort }} ({{ sort().length }}/{{ limits.maxSorts }})</span>
              <p-select [options]="availableSortOptions()" [ngModel]="null" (ngModelChange)="addSort($event)"
                optionLabel="label" optionValue="key" placeholder="Ajouter un tri" appendTo="body" panelStyleClass="studio-theme"
                [disabled]="!canDesign() || sort().length >= limits.maxSorts" data-testid="designer-add-sort" />
            </div>
            @if (sort().length >= limits.maxSorts) {
              <small class="studio-hint">{{ labels.designer.sortLimit }}</small>
            }
            @for (s of sort(); track s.fieldKey; let i = $index) {
              <div class="studio-row" [attr.data-testid]="'designer-sort-' + i">
                <span class="studio-grow">{{ fieldLabel(s.fieldKey) }}</span>
                <p-button [label]="s.descending ? 'Décroissant' : 'Croissant'" [icon]="s.descending ? 'pi pi-sort-amount-down' : 'pi pi-sort-amount-up'"
                  [text]="true" size="small" (onClick)="toggleSortDirection(i)" />
                <p-button icon="pi pi-times" [text]="true" size="small" severity="danger" (onClick)="removeSort(i)" ariaLabel="Retirer" />
              </div>
            }

            <div class="studio-line">
              <label class="studio-lbl" for="rvd-page-size">{{ labels.designer.pageSize }}</label>
              <p-inputNumber inputId="rvd-page-size" [ngModel]="pageSize()" (ngModelChange)="pageSize.set($event ?? 0)"
                [min]="1" [max]="limits.maxPageSize" [showButtons]="true" [disabled]="!canDesign()" data-testid="designer-page-size" />
            </div>
            <div class="studio-line">
              <p-inputSwitch inputId="rvd-search" [ngModel]="searchEnabled()" (ngModelChange)="searchEnabled.set($event)" [disabled]="!canDesign()" />
              <label for="rvd-search">Recherche plein texte</label>
            </div>
            <div class="studio-line">
              <p-inputSwitch inputId="rvd-default" [ngModel]="isDefault()" (ngModelChange)="isDefault.set($event)" [disabled]="!canDesign()" />
              <label for="rvd-default">{{ labels.designer.setDefault }}</label>
            </div>

            <div class="studio-form-actions">
              <p-button label="Annuler" [text]="true" (onClick)="backToList()" />
              <p-button [label]="labels.designer.save" icon="pi pi-check" [loading]="saving()" [disabled]="!canSave()" (onClick)="save()" data-testid="designer-save" />
            </div>
          </section>

          <aside class="studio-preview rvd-preview">
            <div class="studio-block-head">
              <h3 class="studio-preview-title">Aperçu</h3>
              @if (canDesign()) {
                <p-button label="Actualiser l’aperçu" icon="pi pi-refresh" [text]="true" size="small"
                  [disabled]="saving() || !previewEligible()" (onClick)="refreshPreview()" data-testid="designer-preview-refresh" />
              }
            </div>
            @if (!canDesign()) {
              <p class="studio-muted" data-testid="designer-preview-design-only">{{ labels.designer.previewDesignOnly }}</p>
            } @else if (!previewEligible()) {
              <p class="studio-muted" data-testid="designer-preview-invalid">{{ labels.designer.previewInvalid }}</p>
            } @else {
              <app-studio-record-view-runner [entityKey]="entityKey" [view]="previewView()" [allFields]="fields()"
                [showActions]="false" [preview]="true" [previewLimit]="20" />
              <p class="studio-muted">{{ labels.designer.previewDraft }}</p>
            }
          </aside>
        </div>
      }
    </app-studio-page-shell>
  `,
  styleUrls: ['../shared/studio-layout.scss', './studio-record-view-designer.component.scss']
})
export class StudioRecordViewDesignerComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly studio = inject(StudioService);
  private readonly views = inject(StudioRecordViewsService);
  private readonly toast = inject(MessageService);
  private readonly confirmation = inject(ConfirmationService);
  private readonly auth = inject(AuthService);

  readonly labels = STUDIO_RUNTIME_LABELS;
  readonly limits = RECORD_VIEW_LIMITS;
  readonly modeOptions: { label: string; value: RecordViewMode }[] = [
    { label: 'Liste', value: 'List' }, { label: 'Kanban', value: 'Kanban' }, { label: 'Calendrier', value: 'Calendar' }
  ];

  readonly entityKey = this.route.snapshot.paramMap.get('key') ?? '';
  readonly viewId = this.route.snapshot.paramMap.get('viewId');
  readonly editing = this.viewId !== null;

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal<DesignerError | null>(null);
  readonly entityName = signal('');
  readonly fields = signal<CustomField[]>([]);
  readonly view = signal<CustomRecordViewDto | null>(null);

  readonly displayName = signal('');
  readonly key = signal('');
  readonly mode = signal<RecordViewMode>('List');
  readonly columns = signal<RecordViewColumn[]>([]);
  readonly filters = signal<RecordViewFilter[]>([]);
  readonly sort = signal<RecordViewSort[]>([]);
  readonly pageSize = signal(25);
  readonly searchEnabled = signal(true);
  readonly isDefault = signal(false);
  readonly kanban = signal<RecordViewKanban>({ groupByFieldKey: '', titleFieldKey: null, cardFieldKeys: [], showEmptyGroup: true });
  readonly calendar = signal<RecordViewCalendar>({ startFieldKey: '', endFieldKey: null, titleFieldKey: null, colorFieldKey: null });
  private keyTouched = false;

  readonly canDesign = computed(() => this.auth.hasPermission(PERMISSIONS.studio.designForms));
  readonly activeFields = computed(() => this.fields().filter(f => f.isActive));
  readonly fieldOptions = computed<FieldOption[]>(() => this.activeFields().map(f => ({ key: f.key, label: f.label })));
  /** Regroupement Kanban : champs Select actifs avec options (miroir `RecordViewDefinitionValidator`). */
  readonly kanbanGroupByOptions = computed<FieldOption[]>(() =>
    this.activeFields()
      .filter(f => f.fieldType === CustomFieldType.Select && (f.options?.length ?? 0) > 0)
      .map(f => ({ key: f.key, label: f.label })));
  readonly dateOptions = computed<FieldOption[]>(() =>
    this.activeFields()
      .filter(f => f.fieldType === CustomFieldType.Date || f.fieldType === CustomFieldType.DateTime)
      .map(f => ({ key: f.key, label: f.label })));
  readonly optionColorOptions = computed<FieldOption[]>(() =>
    this.activeFields()
      .filter(f => f.fieldType === CustomFieldType.Select || f.fieldType === CustomFieldType.MultiSelect)
      .map(f => ({ key: f.key, label: f.label })));
  readonly subtitle = computed(() => this.entityName() ? `Table « ${this.entityName()} »` : null);
  readonly breadcrumbs = computed<BreadcrumbItem[]>(() => this.editing
    ? STUDIO_BREADCRUMBS.recordViewEdit(this.entityName(), this.entityKey, this.view()?.displayName)
    : STUDIO_BREADCRUMBS.recordViewNew(this.entityName(), this.entityKey));

  /** Colonnes/tris : champs actifs + clés système `createdAt`/`updatedAt`. */
  private readonly columnCandidates = computed<FieldOption[]>(() => [
    ...this.activeFields().map(f => ({ key: f.key, label: f.label })),
    ...RECORD_VIEW_PERSISTED_KEYS.map(k => ({ key: k, label: PERSISTED_LABELS[k] ?? k }))
  ]);
  readonly availableColumnOptions = computed(() => {
    const used = new Set(this.columns().map(c => c.fieldKey));
    return this.columnCandidates().filter(o => !used.has(o.key));
  });
  readonly availableSortOptions = computed(() => {
    const used = new Set(this.sort().map(s => s.fieldKey));
    return this.columnCandidates().filter(o => !used.has(o.key));
  });

  readonly nameValid = computed(() => this.displayName().trim().length > 0);
  readonly keyValid = computed(() => RECORD_VIEW_LIMITS.keyPattern.test(this.key()));
  readonly pageSizeValid = computed(() => Number.isInteger(this.pageSize()) && this.pageSize() >= 1 && this.pageSize() <= RECORD_VIEW_LIMITS.maxPageSize);
  readonly modeValid = computed(() => {
    switch (this.mode()) {
      case 'Kanban': return this.kanban().groupByFieldKey.length > 0;
      case 'Calendar': return this.calendar().startFieldKey.length > 0;
      default: return true;
    }
  });
  readonly canSave = computed(() => this.canDesign() && !this.saving() && this.nameValid() && this.keyValid()
    && this.pageSizeValid() && this.modeValid()
    && this.columns().length <= RECORD_VIEW_LIMITS.maxColumns
    && this.filters().length <= RECORD_VIEW_LIMITS.maxFilters
    && this.sort().length <= RECORD_VIEW_LIMITS.maxSorts);

  readonly definition = computed<RecordViewDefinition>(() => ({
    columns: this.columns(),
    filters: this.filters(),
    sort: this.sort(),
    kanban: this.mode() === 'Kanban' ? this.kanban() : null,
    calendar: this.mode() === 'Calendar' ? this.calendar() : null,
    searchEnabled: this.searchEnabled(),
    pageSize: this.pageSize()
  }));

  /**
   * Brouillon DTO de la définition courante, utilisé par l'aperçu en direct (4.7v2, R3) —
   * création ET édition. `id: 'apercu'` est un placeholder JAMAIS émis (le runner en mode
   * `preview` poste sur `/views/preview` avec la définition, sans identifiant).
   */
  readonly previewView = computed<CustomRecordViewDto | null>(() => {
    const current = this.view();
    return {
      id: this.viewId ?? 'apercu',
      key: this.key() || current?.key || 'apercu',
      displayName: this.displayName().trim() || current?.displayName || 'Aperçu',
      mode: this.mode(),
      definition: this.definition(),
      isDefault: this.isDefault(),
      isActive: true,
      rowVersion: current?.rowVersion ?? '',
      updatedAt: current?.updatedAt ?? new Date(0).toISOString()
    };
  });
  readonly previewRunner = viewChild(StudioRecordViewRunnerComponent);

  /**
   * 4.7v2 : le brouillon est prévisualisable dès que sa définition passerait la validation
   * client — `canSave` MOINS nom/clé (rien n'est enregistré : une définition prévisualisable
   * peut être innommable, D-47-20).
   */
  readonly previewEligible = computed(() => this.canDesign() && this.pageSizeValid() && this.modeValid()
    && this.columns().length <= RECORD_VIEW_LIMITS.maxColumns
    && this.filters().length <= RECORD_VIEW_LIMITS.maxFilters
    && this.sort().length <= RECORD_VIEW_LIMITS.maxSorts);

  /** Anti-rebond de l'aperçu en direct (motif du hub, D-44-86) — branché dans le constructeur. */
  private readonly previewRefresh$ = new Subject<void>();
  private readonly destroyRef = inject(DestroyRef);
  /** La première émission de l'effet est ignorée : le montage du runner exécute déjà (garde du runner). */
  private previewFirstEmission = true;

  constructor() {
    // Aperçu en direct (4.7v2) : toute modification du brouillon (definition suit colonnes,
    // filtres, tris, mode, pageSize…) reprogramme une exécution après 300 ms de calme.
    this.previewRefresh$.pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (this.previewEligible()) this.previewRunner()?.reload();
    });
    effect(() => {
      this.definition(); // signal suivi : le graphe complet du brouillon
      if (this.previewFirstEmission) { this.previewFirstEmission = false; return; }
      // Le peuplement initial du brouillon (schéma/vue chargés) ne doit PAS doubler l'exécution
      // de montage du runner — `untracked` : le retour de loading ne relance pas l'effet.
      if (untracked(() => this.loading())) return;
      this.previewRefresh$.next();
    });
  }

  ngOnInit(): void {
    this.reload();
  }

  refreshPreview(): void {
    this.previewRunner()?.reload();
  }

  reload(): void {
    this.loading.set(true);
    this.error.set(null);
    this.studio.getSchema(this.entityKey).subscribe({
      next: res => {
        if (!res.success) { this.backToList(); return; }
        this.entityName.set(res.data.entity.displayName);
        this.fields.set(res.data.fields ?? []);
        if (this.editing) this.loadView(); else this.loading.set(false);
      },
      error: () => this.backToList()
    });
  }

  private loadView(): void {
    this.views.getRecordView(this.entityKey, this.viewId!).subscribe({
      next: res => {
        if (!res.success) { this.backToList(); return; }
        this.applyView(res.data);
        this.loading.set(false);
      },
      error: () => this.backToList()
    });
  }

  private applyView(v: CustomRecordViewDto): void {
    // 4.7v2 : le peuplement du brouillon depuis la vue enregistrée n'est PAS une modification —
    // l'effet d'aperçu saute cette émission (l'exécution de montage du runner suffit).
    this.previewFirstEmission = true;
    this.view.set(v);
    this.displayName.set(v.displayName);
    this.key.set(v.key);
    this.mode.set(v.mode);
    this.columns.set([...(v.definition.columns ?? [])]);
    this.filters.set([...(v.definition.filters ?? [])]);
    this.sort.set([...(v.definition.sort ?? [])]);
    this.pageSize.set(v.definition.pageSize ?? 25);
    this.searchEnabled.set(v.definition.searchEnabled ?? true);
    this.isDefault.set(v.isDefault);
    if (v.definition.kanban) this.kanban.set({ ...v.definition.kanban, cardFieldKeys: [...(v.definition.kanban.cardFieldKeys ?? [])] });
    if (v.definition.calendar) this.calendar.set({ ...v.definition.calendar });
  }

  onNameChange(value: string): void {
    this.displayName.set(value ?? '');
    if (!this.editing && !this.keyTouched) this.key.set(slugifyViewKey(value));
  }

  onKeyChange(value: string): void {
    this.keyTouched = true;
    this.key.set((value ?? '').trim());
  }

  fieldLabel(fieldKey: string): string {
    return this.columnCandidates().find(o => o.key === fieldKey)?.label ?? fieldKey;
  }

  addColumn(fieldKey: string | null): void {
    if (!fieldKey || this.columns().length >= RECORD_VIEW_LIMITS.maxColumns) return;
    if (this.columns().some(c => c.fieldKey === fieldKey)) return;
    this.columns.update(cols => [...cols, { fieldKey, hidden: false }]);
  }

  removeColumn(index: number): void {
    this.columns.update(cols => cols.filter((_, i) => i !== index));
  }

  toggleColumnHidden(index: number): void {
    this.columns.update(cols => cols.map((c, i) => i === index ? { ...c, hidden: !c.hidden } : c));
  }

  moveColumn(index: number, delta: -1 | 1): void {
    this.columns.update(cols => {
      const target = index + delta;
      if (target < 0 || target >= cols.length) return cols;
      const next = [...cols];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  addSort(fieldKey: string | null): void {
    if (!fieldKey || this.sort().length >= RECORD_VIEW_LIMITS.maxSorts) return;
    if (this.sort().some(s => s.fieldKey === fieldKey)) return;
    this.sort.update(list => [...list, { fieldKey, descending: false }]);
  }

  removeSort(index: number): void {
    this.sort.update(list => list.filter((_, i) => i !== index));
  }

  toggleSortDirection(index: number): void {
    this.sort.update(list => list.map((s, i) => i === index ? { ...s, descending: !s.descending } : s));
  }

  /** Troncature appliquée au moment du patch (le `p-multiSelect` émet son modèle non borné). */
  patchKanban(patch: Partial<RecordViewKanban>): void {
    this.kanban.update(k => {
      const next = { ...k, ...patch };
      if (next.cardFieldKeys && next.cardFieldKeys.length > RECORD_VIEW_LIMITS.maxCardFields) {
        next.cardFieldKeys = next.cardFieldKeys.slice(0, RECORD_VIEW_LIMITS.maxCardFields);
      }
      return next;
    });
  }

  patchCalendar(patch: Partial<RecordViewCalendar>): void {
    this.calendar.update(c => ({ ...c, ...patch }));
  }

  onModeChange(value: RecordViewMode): void {
    this.mode.set(value);
    if (value === 'Kanban' && !this.kanbanGroupByOptions().some(o => o.key === this.kanban().groupByFieldKey)) {
      this.patchKanban({ groupByFieldKey: this.kanbanGroupByOptions()[0]?.key ?? '' });
    }
    if (value === 'Calendar' && !this.dateOptions().some(o => o.key === this.calendar().startFieldKey)) {
      this.patchCalendar({ startFieldKey: this.dateOptions()[0]?.key ?? '' });
    }
  }

  buildRequest(): SaveCustomRecordViewRequest {
    return {
      key: this.key(),
      displayName: this.displayName().trim(),
      mode: this.mode(),
      definition: this.definition(),
      isDefault: this.isDefault(),
      rowVersion: this.editing ? this.view()?.rowVersion ?? null : undefined
    };
  }

  save(): void {
    if (!this.canSave()) return;
    this.saving.set(true);
    this.error.set(null);
    const request = this.buildRequest();
    const call = this.editing
      ? this.views.updateRecordView(this.entityKey, this.viewId!, request)
      : this.views.createRecordView(this.entityKey, request);
    call.subscribe({
      next: res => {
        this.saving.set(false);
        if (!res.success) { this.error.set({ message: res.message || this.labels.views.error, stale: false }); return; }
        this.toast.add({ severity: 'success', summary: this.labels.designer.title, detail: this.labels.designer.saved });
        if (this.editing) { this.applyView(res.data); return; }
        void this.router.navigate(['/studio/d', this.entityKey], { queryParams: { view: res.data.id } });
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.handleWriteError(err);
      }
    });
  }

  setDefault(): void {
    if (!this.editing || !this.canDesign()) return;
    this.saving.set(true);
    this.views.setDefaultRecordView(this.entityKey, this.viewId!).subscribe({
      next: () => {
        this.saving.set(false);
        this.isDefault.set(true);
        this.toast.add({ severity: 'success', summary: this.labels.designer.title, detail: this.labels.designer.saved });
        this.loadView();
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.handleWriteError(err);
      }
    });
  }

  delete(): void {
    if (!this.editing || !this.canDesign()) return;
    this.confirmation.confirm({
      message: 'Supprimer cette vue ? Cette action est irréversible.',
      header: 'Confirmation',
      acceptLabel: this.labels.designer.delete,
      rejectLabel: 'Annuler',
      accept: () => {
        this.saving.set(true);
        this.views.deleteRecordView(this.entityKey, this.viewId!).subscribe({
          next: () => {
            this.saving.set(false);
            this.toast.add({ severity: 'success', summary: this.labels.designer.title, detail: this.labels.designer.deleted });
            this.backToList();
          },
          error: (err: HttpErrorResponse) => {
            this.saving.set(false);
            this.handleWriteError(err);
          }
        });
      }
    });
  }

  backToList(): void {
    void this.router.navigate(['/studio/d', this.entityKey]);
  }

  /** Mapping 409 / 400 / 404 (§ « Réponse d'erreur API » du plan) ; tout autre statut ⇒ toast générique. */
  private handleWriteError(err: HttpErrorResponse): void {
    const serverMessage: string = typeof err.error?.message === 'string' ? err.error.message : '';
    switch (err.status) {
      case 409:
        this.error.set(this.editing
          ? { message: this.labels.designer.staleConflict, stale: true }
          : { message: this.labels.designer.duplicateKey, stale: false });
        return;
      case 400:
        this.error.set({
          message: serverMessage.startsWith('Limite du plan') ? this.labels.designer.planLimit : (serverMessage || this.labels.views.error),
          stale: false
        });
        return;
      case 404:
        this.backToList();
        return;
      default:
        this.toast.add({ severity: 'error', summary: this.labels.designer.title, detail: this.labels.views.error });
    }
  }
}

/** Clé auto-dérivée du nom : enveloppe de `slugifyKey` (shared/studio-text.util.ts, 4.5h), préfixe `v_` si chiffre initial. */
export function slugifyViewKey(input: string): string { return slugifyKey(input, 'v_'); }
