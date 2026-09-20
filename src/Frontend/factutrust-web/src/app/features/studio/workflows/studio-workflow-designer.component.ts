import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, HostListener, OnInit, computed, effect, inject, linkedSignal, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { EMPTY, forkJoin, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { DrawerModule } from 'primeng/drawer';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { SelectModule } from 'primeng/select';
import { SkeletonModule } from 'primeng/skeleton';
import { TagModule } from 'primeng/tag';
import { TextareaModule } from 'primeng/textarea';
import { ToastModule } from 'primeng/toast';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { ApiResponse } from '@core/services/client.service';
import { ViewportService } from '@core/services/viewport.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { CustomField, CustomFieldType } from '@shared/studio-runtime/studio-runtime.models';
import { StudioPageShellComponent } from '../shared/studio-page-shell.component';
import { STUDIO_BREADCRUMBS } from '../shared/studio-breadcrumb.util';
import { StudioFilterBuilderComponent } from '../shared/studio-filter-builder.component';
import { StudioService } from '../studio.service';
import { AutomationAction, CustomEntity } from '../studio.models';
import type { RecordViewFilter } from '../views/studio-record-views.models';
import { toRecordViewFilters, toWorkflowFilters } from './step-editor/studio-workflow-filter.adapter';
import { StudioWorkflowConditionTreeComponent } from './step-editor/studio-workflow-condition-tree.component';
import { StudioWorkflowStepEditorComponent } from './step-editor/studio-workflow-step-editor.component';
import { StudioWorkflowStepListComponent } from './step-editor/studio-workflow-step-list.component';
import { STUDIO_WORKFLOW_LABELS, formatWorkflowLabel } from './studio-workflow-labels';
import { workflowErrorMessage } from './studio-workflow-http.util';
import { StudioWorkflowInstanceDetailComponent } from './studio-workflow-instance-detail.component';
import { StudioWorkflowInstancesPanelComponent } from './studio-workflow-instances-panel.component';
import { StudioWorkflowTestDialogComponent } from './studio-workflow-test-dialog.component';
import {
  COMPUTED_FIELD_TYPES,
  STEP_KEY_REGEX,
  SaveWorkflowRequest,
  StepCatalogEntryDto,
  WORKFLOW_LIMITS,
  WORKFLOW_TRIGGERS,
  WorkflowDefinitionDto,
  WorkflowInstanceDto,
  WorkflowStepSpec,
  WorkflowTrigger,
  WorkflowTriggerConfig,
  WorkflowValidationIssueDto,
  WorkflowValidationResultDto,
  slugifyWorkflowKey,
  stepsJsonBytes
} from './studio-workflows.models';
import { StudioWorkflowsService } from './studio-workflows.service';

/** Icônes Font Awesome des cartes de déclencheur (maquette `d44-workflows-designer.html`). */
const TRIGGER_ICONS: Readonly<Record<WorkflowTrigger, string>> = {
  on_create: 'fa-solid fa-circle-plus',
  on_update: 'fa-solid fa-pen-to-square',
  field_changed: 'fa-solid fa-bolt',
  manual: 'fa-solid fa-play',
  scheduled: 'fa-solid fa-calendar'
};

const COMPUTED: ReadonlySet<CustomFieldType> = new Set(COMPUTED_FIELD_TYPES);

/**
 * Libellés FR locaux absents de `STUDIO_WORKFLOW_LABELS` (4.4a1, non modifié dans cette
 * tranche — même motif que `LIST_LABELS` de la liste d'étapes, 4.4c2) ; à centraliser si un
 * autre composant en a besoin. `L.designer.error` et `L.instances.title`, cités par l'annexe,
 * n'existent pas : remplacés par `saveError` et `L.instances.history` (4.7a2).
 */
const DESIGNER_LABELS = {
  description: 'Description',
  tableFixed: 'La table ne peut plus être changée après la création.',
  saveError: 'Enregistrement impossible.',
  triggerConfigTooLarge: 'La configuration du déclencheur dépasse 2 Ko.'
} as const;

/** Bannière d'erreur d'écriture (400/409) ; `reload` affiche le bouton « Recharger » (409 édition). */
interface DesignerBanner { severity: 'warn' | 'error'; text: string; reload: boolean }

/** Résultat de la dernière validation serveur affiché en bannière. */
interface ValidationState { isValid: boolean; errors: WorkflowValidationIssueDto[] }

/**
 * Concepteur de workflow `/studio/workflows/new?entity=<id>` et `/studio/workflows/:id` (4.4e1) :
 * en-tête (nom, clé auto-slugifiée D-44-12, description, actif — `false` par défaut à la création,
 * D-44-23), déclencheur en cartes radio avec sous-formulaires `field_changed` et `scheduled`
 * (4.7b4 : expression cron UTC — presets ou saisie libre — et filtres optionnels ; la mécanique
 * `soon` reste pour de futurs déclencheurs), puis grille 3 colonnes `1fr · 320 px · 250 px` (D-44-21) :
 * liste d'étapes + arbre de branchements en `@defer` (col. 1), éditeur d'étape 4.4c1 (col. 2),
 * aperçu/instances récentes (col. 3, panneau 4.4e2 rafraîchi via `refreshToken` ; le clic pose
 * `?instance=<id>`, D20 — le drawer de détail 4.4f `app-studio-workflow-instance-detail` est
 * branché sur `openInstanceId`, alimenté par ce paramètre, et sa fermeture le retire de l'URL).
 * Sous 1280 px, les colonnes 2–3
 * passent en `p-drawer` (D-44-22, première utilisation de `primeng/drawer`).
 * Enregistrement TOUJOURS précédé d'une validation serveur (D-44-02) dont les erreurs sont
 * remontées par étape/propriété (`steps[i].prop`) à la liste et à l'éditeur.
 * `data-testid` figés (`wf-validate`, `wf-save`, `wf-toggle`) — consommés par Playwright (4.4l1).
 */
@Component({
  selector: 'app-studio-workflow-designer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, FormsModule, ButtonModule, DrawerModule, InputTextModule, MessageModule, SelectModule,
    SkeletonModule, TagModule, TextareaModule, ToastModule, ToggleSwitchModule, StudioPageShellComponent,
    StudioFilterBuilderComponent,
    StudioWorkflowStepListComponent, StudioWorkflowStepEditorComponent, StudioWorkflowInstancesPanelComponent,
    StudioWorkflowInstanceDetailComponent, StudioWorkflowTestDialogComponent,
    // Référencé UNIQUEMENT dans le bloc `@defer` ci-dessous : Angular l'isole dans un chunk
    // chargé à la demande (primeng/tree reste hors du bundle initial — 4.4c2 §3).
    StudioWorkflowConditionTreeComponent
  ],
  template: `
    <app-studio-page-shell [title]="title()" [breadcrumbs]="breadcrumbs()">
      <!-- 4.6d1 (D-44-95) : hôte des toasts — les succès/erreurs des écritures étaient muets sur cette page. -->
      <p-toast styleClass="studio-theme" />
      <ng-container studioActions>
        <button pButton type="button" [outlined]="true" icon="fa-solid fa-list-check" [label]="L.designer.validate"
          data-testid="wf-validate" [disabled]="busy() || saving() || loading() || loadError()" (click)="validate()"></button>
        <button pButton type="button" [outlined]="true" icon="fa-solid fa-vial" [label]="L.test.button"
          data-testid="wf-test" [disabled]="busy() || saving() || loading() || loadError() || !id || dirty()"
          [attr.title]="!id || dirty() ? L.test.saveFirst : null" (click)="testDialog.open()"></button>
        <button pButton type="button" icon="fa-solid fa-floppy-disk" [label]="L.designer.save"
          data-testid="wf-save" [loading]="saving()" [disabled]="saving() || !canSave()" (click)="save()"></button>
        @if (id) {
          <button pButton type="button" severity="secondary" [outlined]="true" icon="fa-solid fa-copy"
            [label]="L.designer.duplicate" data-testid="wf-duplicate" [disabled]="saving()" (click)="duplicate()"></button>
          <button pButton type="button" severity="danger" [outlined]="true" icon="fa-solid fa-trash"
            [label]="L.hub.delete" data-testid="wf-delete" [disabled]="saving()" (click)="remove()"></button>
        }
      </ng-container>

      @if (loading()) {
        <div data-testid="wf-loading">
          <p-skeleton height="2.5rem" styleClass="wf-mb" />
          <p-skeleton height="11rem" styleClass="wf-mb" />
          <p-skeleton height="20rem" />
        </div>
      } @else if (loadError()) {
        <p-message severity="error" [text]="L.hub.loadError" data-testid="wf-load-error" />
      } @else {
        <div class="wf-tags">
          @if (dirty()) { <p-tag severity="warn" [value]="L.designer.dirty" data-testid="wf-dirty" /> }
          @if (id) {
            <p-tag severity="secondary" [value]="'v' + version()" />
            <p-tag [severity]="isActive() ? 'success' : 'secondary'" [value]="isActive() ? L.designer.active : L.designer.inactive" />
          }
        </div>

        @if (banner(); as b) {
          <p-message [severity]="b.severity" styleClass="wf-banner" data-testid="wf-banner">
            <span>{{ b.text }}</span>
            @if (b.reload) {
              <button pButton type="button" size="small" [outlined]="true" [label]="L.designer.reload"
                data-testid="wf-reload" (click)="reload()"></button>
            }
          </p-message>
        }
        @if (validation(); as v) {
          <p-message [severity]="v.isValid ? 'success' : 'error'" styleClass="wf-banner" data-testid="wf-validation">
            <div class="wf-validation">
              <span>{{ v.isValid ? L.designer.validOk : formatLabel(L.designer.validErrors, { count: v.errors.length }) }}</span>
              @if (warningCount() > 0) {
                <span class="studio-muted">{{ formatLabel(L.designer.warnings, { count: warningCount() }) }}</span>
              }
              @if (!v.isValid) {
                <ul class="wf-issues">
                  @for (issue of v.errors; track issue.path + '|' + issue.message) {
                    <li>
                      <button type="button" class="wf-issues__link" (click)="selectIssue(issue.path)">{{ issue.path }} — {{ issue.message }}</button>
                    </li>
                  }
                </ul>
              }
            </div>
          </p-message>
        }

        <section class="wf-head" aria-labelledby="wf-trigger-lbl">
          <div class="wf-head__grid">
            <div class="wf-field">
              <label for="wf-name">{{ L.designer.name }} <span class="wf-req">*</span></label>
              <input id="wf-name" pInputText maxlength="120" [ngModel]="name()" (ngModelChange)="onNameChange($event)"
                autocomplete="off" data-testid="wf-name" />
            </div>
            <div class="wf-field">
              <label for="wf-key">{{ L.designer.key }} <span class="wf-req">*</span></label>
              <input id="wf-key" pInputText [ngModel]="key()" (ngModelChange)="onKeyChange($event)"
                [disabled]="!!id" autocomplete="off" data-testid="wf-key" />
              <small class="studio-muted">{{ id ? L.designer.keyImmutable : L.designer.keyHint }}</small>
            </div>
            <div class="wf-field">
              <label for="wf-entity">{{ L.designer.table }} <span class="wf-req">*</span></label>
              <input id="wf-entity" pInputText [value]="entity()?.displayName ?? ''" disabled data-testid="wf-entity" />
              <small class="studio-muted">{{ localLabels.tableFixed }}</small>
            </div>
            <div class="wf-field">
              <label for="wf-active">{{ L.designer.active }}</label>
              <p-toggleswitch inputId="wf-active" [ngModel]="isActive()" (ngModelChange)="isActive.set($event)"
                [ariaLabel]="L.designer.active" data-testid="wf-toggle" />
            </div>
          </div>
          <div class="wf-field">
            <label for="wf-description">{{ localLabels.description }}</label>
            <textarea id="wf-description" pTextarea rows="2" [ngModel]="description()"
              (ngModelChange)="description.set($event)" data-testid="wf-description"></textarea>
          </div>

          <span class="wf-lbl" id="wf-trigger-lbl">{{ L.designer.trigger }} <span class="wf-req">*</span></span>
          <div class="wf-triggers" role="radiogroup" aria-labelledby="wf-trigger-lbl">
            @for (t of triggers; track t.value) {
              <div class="wf-trigger" role="radio" [attr.aria-checked]="trigger() === t.value"
                [attr.aria-disabled]="t.soon ? true : null" [attr.tabindex]="t.soon ? -1 : 0"
                [class.wf-trigger--on]="trigger() === t.value" [class.wf-trigger--disabled]="!!t.soon"
                [attr.data-testid]="'wf-trigger-' + t.value"
                (click)="selectTrigger(t)" (keydown.enter)="selectTrigger(t)" (keydown.space)="selectTrigger(t); $event.preventDefault()">
                <i [class]="triggerIcons[t.value]" aria-hidden="true"></i>
                <div class="wf-trigger__body">
                  <div class="wf-trigger__t">
                    {{ L.triggers[t.value] }}
                    @if (t.soon) { <p-tag severity="secondary" [value]="L.soon" /> }
                  </div>
                  <div class="wf-trigger__h">{{ L.triggerHints[t.value] }}</div>
                </div>
              </div>
            }
          </div>

          @if (trigger() === 'field_changed') {
            <div class="wf-sub" data-testid="wf-trigger-config">
              <div class="wf-field">
                <label for="wf-watched">{{ L.designer.watchedField }} <span class="wf-req">*</span></label>
                <p-select inputId="wf-watched" [options]="watchableFields()" [ngModel]="triggerConfig()?.field ?? null"
                  (ngModelChange)="patchTriggerConfig({ field: $event ?? undefined })" optionLabel="label" optionValue="value"
                  [showClear]="true" [filter]="true" appendTo="body" panelStyleClass="studio-theme" styleClass="wf-w"
                  data-testid="wf-watched" [attr.aria-label]="L.designer.watchedField" />
              </div>
              <div class="wf-field">
                <label for="wf-from">{{ L.designer.from }}</label>
                <input id="wf-from" pInputText [ngModel]="asText(triggerConfig()?.from)"
                  (ngModelChange)="patchTriggerConfig({ from: $event || undefined })" autocomplete="off" data-testid="wf-from" />
              </div>
              <div class="wf-field">
                <label for="wf-to">{{ L.designer.to }}</label>
                <input id="wf-to" pInputText [ngModel]="asText(triggerConfig()?.to)"
                  (ngModelChange)="patchTriggerConfig({ to: $event || undefined })" autocomplete="off" data-testid="wf-to" />
              </div>
            </div>
          }
          @if (trigger() === 'scheduled') {
            <!-- 4.7b4 : cron UTC (presets ou saisie libre) + filtres optionnels (même adaptateur que l'étape condition). -->
            <div class="wf-sub wf-sub--scheduled" data-testid="wf-scheduled-config">
              <div class="wf-field">
                <label for="wf-cron-preset">{{ L.designer.cronPreset }}</label>
                <p-select inputId="wf-cron-preset" [options]="cronPresets" [ngModel]="cronPresetSelection()"
                  (ngModelChange)="onCronPreset($event)" optionLabel="label" optionValue="value"
                  appendTo="body" panelStyleClass="studio-theme" styleClass="wf-w"
                  data-testid="wf-cron-preset" [attr.aria-label]="L.designer.cronPreset" />
              </div>
              <div class="wf-field">
                <label for="wf-cron">{{ L.designer.cron }} <span class="wf-req">*</span></label>
                <input id="wf-cron" pInputText [ngModel]="triggerConfig()?.cron ?? ''"
                  (ngModelChange)="onCronInput($event)" autocomplete="off" placeholder="0 6 * * *" data-testid="wf-cron" />
                <small class="wf-hint">{{ L.designer.cronHint }}</small>
              </div>
              <div class="wf-field wf-field--filters">
                <span class="wf-lbl">{{ L.designer.scheduledFilters }}</span>
                <app-studio-filter-builder [fields]="scheduledFilterFields()" [filters]="scheduledFilterModel()"
                  (filtersChange)="onScheduledFilters($event)" />
              </div>
            </div>
          }
          @if (triggerConfigTooLarge()) {
            <p-message severity="warn" [text]="localLabels.triggerConfigTooLarge" styleClass="wf-banner" data-testid="wf-trigger-too-large" />
          }
          @if (tooLarge()) {
            <p-message severity="error" [text]="L.designer.tooLarge" styleClass="wf-banner" data-testid="wf-too-large" />
          }
        </section>

        <div class="wf-designer">
          <div class="wf-designer__col">
            <app-studio-workflow-step-list [(steps)]="steps" [(selectedIndex)]="selectedIndex"
              (selectedIndexChange)="onSelected($event)" [catalog]="catalog()" [issues]="issues()" />
            @defer (on viewport) {
              <app-studio-workflow-condition-tree [steps]="steps()" />
            } @placeholder {
              <p-skeleton height="6rem" />
            }
          </div>
          @if (!narrow()) {
            <div class="wf-designer__col wf-designer__col--editor">
              <ng-container *ngTemplateOutlet="editorTpl" />
            </div>
            <div class="wf-designer__col wf-designer__col--side">
              <app-studio-workflow-instances-panel [workflowId]="id" [entityKey]="entity()?.key ?? null"
                [refreshToken]="refreshToken()" [openCount]="openInstances()" (open)="openInstance($event)" />
            </div>
          }
        </div>

        @if (narrow()) {
          <p-drawer [(visible)]="editorDrawer" position="right" styleClass="studio-theme wf-drawer"
            [header]="L.designer.properties" [style]="{ width: 'min(720px, 100vw)' }">
            <ng-container *ngTemplateOutlet="editorTpl" />
          </p-drawer>
        }
      }

      <!-- Détail d'instance (4.4f) : drawer droit piloté par ?instance= (D20) ; hors du bloc de
           chargement pour s'ouvrir directement à l'arrivée sur /studio/workflows/<id>?instance=<iid>. -->
      <app-studio-workflow-instance-detail [(instanceId)]="openInstanceId" [entityKey]="entity()?.key ?? null"
        (changed)="onInstanceChanged()" />

      <ng-template #editorTpl>
        @if (selectedIndex() !== null && steps()[selectedIndex()!]; as step) {
          <app-studio-workflow-step-editor [step]="step" (stepChange)="replaceStep(selectedIndex()!, $event)"
            [index]="selectedIndex()!" [steps]="steps()" [catalog]="catalog()" [fields]="fields()"
            [entities]="entities()" [actions]="actions()" [issues]="issues()" />
        } @else {
          <div class="wf-empty" data-testid="wf-no-step">
            <i class="fa-solid fa-sliders" aria-hidden="true"></i>
            <p class="studio-muted">{{ L.designer.noStep }}</p>
          </div>
        }
      </ng-template>
      <!-- 4.7c2 (R17) : dialogue « Tester sur un enregistrement » — composant dédié depuis 4.7★3 (D-47-80), ouvert par le bouton wf-test via #testDialog. -->
      <app-studio-workflow-test-dialog #testDialog [workflowId]="id" [entityKey]="entity()?.key ?? null" [fields]="fields()" />
    </app-studio-page-shell>
  `,
  styleUrls: ['../shared/studio-layout.scss', './studio-workflow-designer.scss']
})
export class StudioWorkflowDesignerComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly studio = inject(StudioService);
  private readonly workflowsSvc = inject(StudioWorkflowsService);
  private readonly toast = inject(MessageService);
  private readonly confirm = inject(ConfirmationService);

  /** `null` en création (`workflows/new`) — la clé est alors éditable et suit le nom (D-44-12). */
  protected id: string | null = null;

  protected readonly L = STUDIO_WORKFLOW_LABELS;
  protected readonly localLabels = DESIGNER_LABELS;
  protected readonly triggers = WORKFLOW_TRIGGERS;
  protected readonly triggerIcons = TRIGGER_ICONS;

  // ---- Chargement ----
  readonly loading = signal(true);
  readonly loadError = signal(false);
  readonly saving = signal(false);
  readonly busy = signal(false);   // « Valider » en cours

  readonly catalog = signal<StepCatalogEntryDto[]>([]);
  readonly entities = signal<CustomEntity[]>([]);
  readonly actions = signal<AutomationAction[]>([]);
  readonly entity = signal<CustomEntity | null>(null);
  readonly fields = signal<CustomField[]>([]);   // fieldType normalisé numérique (D-44-14, via getSchema)

  // ---- Formulaire ----
  readonly name = signal('');
  readonly key = signal('');
  readonly description = signal('');
  readonly trigger = signal<WorkflowTrigger>('on_create');
  readonly triggerConfig = signal<WorkflowTriggerConfig | null>(null);
  readonly isActive = signal(false);
  readonly keyTouched = signal(false);

  // ---- Étapes / validation ----
  readonly steps = signal<WorkflowStepSpec[]>([]);
  readonly selectedIndex = signal<number | null>(null);
  readonly issues = signal<WorkflowValidationIssueDto[]>([]);
  readonly warningCount = signal(0);
  readonly validation = signal<ValidationState | null>(null);
  readonly banner = signal<DesignerBanner | null>(null);

  // ---- Métadonnées d'édition ----
  readonly rowVersion = signal<string | null>(null);
  readonly version = signal(0);
  readonly openInstances = signal(0);
  /** Incrémenté après chaque enregistrement — le panneau d'instances (4.4e2) se rafraîchit dessus. */
  readonly refreshToken = signal(0);
  /** `?instance=` lu en continu (D20). */
  readonly instanceId = toSignal(this.route.queryParamMap.pipe(map(q => q.get('instance'))), { initialValue: null });
  /**
   * Instance ouverte dans le drawer de détail (4.4f) : suit `?instance=` (arrivée directe ou clic
   * dans le panneau 4.4e2) et peut être remise à `null` par le drawer — la remise à `null`
   * retire alors le paramètre de l'URL (effet ci-dessous).
   */
  readonly openInstanceId = linkedSignal<string | null>(() => this.instanceId());
  private readonly snapshot = signal('');

  // ---- Réactif écran étroit (D-44-21 : colonnes 2–3 en tiroir sous 1280 px) ----
  readonly editorDrawer = signal(false);
  readonly narrow = inject(ViewportService).isNarrow;   // 4.6T2 (D-44-56) : seuil 1 279 px inchangé

  readonly title = computed(() => this.name().trim() || (this.id ? this.L.designer.title : this.L.designer.newTitle));
  readonly breadcrumbs = computed(() => STUDIO_BREADCRUMBS.workflowDesigner(this.name()));
  /** Fermeture du drawer de détail (`openInstanceId` remis à `null` par le composant) ⇒ retire `?instance=` (D20). */
  private readonly syncInstanceParamOnClose = effect(() => {
    if (this.openInstanceId() === null && this.instanceId() !== null) {
      untracked(() => void this.router.navigate([], {
        relativeTo: this.route, queryParams: { instance: null }, queryParamsHandling: 'merge', replaceUrl: true
      }));
    }
  });
  readonly tooLarge = computed(() => stepsJsonBytes({ version: 1, steps: this.steps() }) > WORKFLOW_LIMITS.maxStepsJsonBytes);
  readonly triggerConfigTooLarge = computed(() => {
    const c = this.triggerConfig();
    const t = this.trigger();
    // 4.7b4 : la jauge 2 Ko (borne serveur) vaut aussi pour `scheduled` (cron + filtres).
    return (t === 'field_changed' || t === 'scheduled') && !!c
      && new TextEncoder().encode(JSON.stringify(c)).length > WORKFLOW_LIMITS.maxTriggerConfigBytes;
  });
  readonly canSave = computed(() => {
    if (this.name().trim().length === 0 || !STEP_KEY_REGEX.test(this.key()) || this.steps().length === 0 || this.tooLarge()) return false;
    // 4.7b4 : un déclencheur planifié exige une expression cron non vide (revalidée par le serveur, b1).
    return this.trigger() !== 'scheduled' || !!this.triggerConfig()?.cron?.trim();
  });
  /** Instantané JSON du brouillon de requête — toute modification (y compris d'étape) salit. */
  readonly dirty = computed(() => !this.loading() && JSON.stringify(this.toRequest()) !== this.snapshot());
  /** Champ surveillé `field_changed` : champs actifs non calculés (même règle que `update_field.set`). */
  readonly watchableFields = computed(() =>
    this.fields().filter(f => f.isActive && !COMPUTED.has(f.fieldType)).map(f => ({ label: `${f.label} (${f.key})`, value: f.key })));

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id');
    const entityId = this.route.snapshot.queryParamMap.get('entity');
    this.loading.set(true);
    this.loadError.set(false);
    forkJoin({
      catalog: this.workflowsSvc.getStepCatalog(),
      entities: this.studio.listEntities(false),
      // Une indisponibilité du pont ERP ne bloque pas la page : le picker reste utilisable (vide).
      actions: this.studio.listAutomationActions().pipe(
        catchError(() => of({ success: true, data: [] as AutomationAction[] } as ApiResponse<AutomationAction[]>))),
      workflow: this.id ? this.workflowsSvc.getWorkflow(this.id) : of(null)
    }).pipe(
      switchMap(r => {
        const wf = r.workflow?.data ?? null;
        const entity = r.entities.data?.find(e => e.id === (wf?.entityDefinitionId ?? entityId)) ?? null;
        if (!entity) {   // table inconnue (ou ?entity= absent en création) ⇒ retour au hub
          void this.router.navigate(['/studio/workflows']);
          return EMPTY;
        }
        return this.studio.getSchema(entity.key).pipe(map(s => ({ ...r, wf, entity, fields: s.data?.fields ?? [] })));
      })
    ).subscribe({
      next: r => {
        this.catalog.set(r.catalog.data?.entries ?? []);
        this.entities.set(r.entities.data ?? []);
        this.actions.set(r.actions.data ?? []);
        this.entity.set(r.entity);
        this.fields.set(r.fields);
        this.apply(r.wf);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        if (err.status === 404) void this.router.navigate(['/studio/workflows']);
        else { this.loadError.set(true); this.loading.set(false); }
      }
    });
  }

  // ---- Formulaire d'en-tête ----

  onNameChange(value: string): void {
    this.name.set(value ?? '');
    if (!this.id && !this.keyTouched()) this.key.set(slugifyWorkflowKey(value ?? ''));
  }

  onKeyChange(value: string): void {
    this.keyTouched.set(true);
    this.key.set((value ?? '').trim());
  }

  /** Carte radio de déclencheur ; la mécanique `soon` reste pour de futurs déclencheurs (4.7b4 : `scheduled` sélectionnable). */
  selectTrigger(t: { value: WorkflowTrigger; soon?: true }): void {
    if (t.soon) return;
    if (t.value === this.trigger()) return;   // re-clic : conserve la configuration saisie
    this.trigger.set(t.value);
    // Config par déclencheur : jamais de clés d'un type sur un autre (le serveur les rejette, b1).
    this.triggerConfig.set(t.value === 'field_changed' || t.value === 'scheduled' ? {} : null);
  }

  patchTriggerConfig(patch: Partial<WorkflowTriggerConfig>): void {
    this.triggerConfig.update(c => ({ ...(c ?? {}), ...patch }));
  }

  // ---- Déclencheur « Planifié » (4.7b4) ----

  /** Sentinelle du preset « Personnalisé » (jamais une expression cron valide). */
  private static readonly CUSTOM_CRON = '__custom__';

  /** Presets UTC affichés dans le `p-select` (le champ libre reste éditable en « Personnalisé »). */
  /** Presets cron (4.7b4). Mutable : `p-select [options]` exige `any[]` — un `readonly[]` casse le build dev (NG4). */
  readonly cronPresets: { label: string; value: string }[] = [
    { label: this.L.designer.cronPresets.hourly, value: '0 * * * *' },
    { label: this.L.designer.cronPresets.daily, value: '0 6 * * *' },
    { label: this.L.designer.cronPresets.weekly, value: '0 6 * * 1' },
    { label: this.L.designer.cronPresets.custom, value: StudioWorkflowDesignerComponent.CUSTOM_CRON }
  ];

  /** Preset sélectionné : l'expression courante si elle correspond à un preset, sinon « Personnalisé ». */
  readonly cronPresetSelection = computed(() => {
    const cron = this.triggerConfig()?.cron ?? '';
    return this.cronPresets.some(p => p.value === cron) ? cron : StudioWorkflowDesignerComponent.CUSTOM_CRON;
  });

  onCronPreset(value: string): void {
    if (value !== StudioWorkflowDesignerComponent.CUSTOM_CRON) this.patchTriggerConfig({ cron: value });
  }

  onCronInput(value: string): void {
    this.patchTriggerConfig({ cron: value.trim() || undefined });
  }

  /** Filtres `scheduled` : champs actifs non calculés SEULS (b1 refuse `_previous` et les variables de contexte). */
  readonly scheduledFilterFields = computed(() => this.fields().filter(f => f.isActive && !COMPUTED.has(f.fieldType)));

  readonly scheduledFilterModel = computed(() => toRecordViewFilters(this.triggerConfig()?.filters ?? []));

  onScheduledFilters(filters: RecordViewFilter[]): void {
    this.patchTriggerConfig({ filters: toWorkflowFilters(filters) });
  }

  protected asText(v: unknown): string { return typeof v === 'string' ? v : v == null ? '' : String(v); }

  // ---- Étapes ----

  /** Contrat de 4.4c1 : remplacement par index en créant un nouveau tableau. */
  replaceStep(index: number, step: WorkflowStepSpec): void {
    this.steps.update(list => list.map((s, i) => (i === index ? step : s)));
  }

  /** Écran étroit : la sélection d'une étape ouvre le tiroir d'édition. */
  onSelected(index: number | null): void {
    if (this.narrow() && index !== null) this.editorDrawer.set(true);
  }

  /** Après annulation/relance réussie dans le drawer (4.4f) : rafraîchit le panneau d'instances. */
  protected onInstanceChanged(): void {
    this.refreshToken.update(n => n + 1);
  }

  /** Clic sur une instance de la colonne 3 (4.4e2) : l'URL porte l'instance ouverte (D20) ⇒ le drawer 4.4f s'ouvre. */
  openInstance(i: WorkflowInstanceDto): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { instance: i.id }, queryParamsHandling: 'merge' });
  }

  /** Lien « steps[i].prop » de la bannière de validation ⇒ sélectionne l'étape fautive. */
  selectIssue(path: string): void {
    const m = /^steps\[(\d+)\]/.exec(path);
    if (!m) return;
    const i = Number(m[1]);
    if (i < this.steps().length) {
      this.selectedIndex.set(i);
      if (this.narrow()) this.editorDrawer.set(true);
    }
  }

  // ---- Validation → enregistrement (D-44-02) ----

  validate(): void {
    const entity = this.entity();
    if (!entity) return;
    this.busy.set(true);
    this.workflowsSvc.validateWorkflow(entity.id, this.toRequest()).subscribe({
      next: r => { this.applyValidation(r.data); this.busy.set(false); },
      error: (err: HttpErrorResponse) => this.fail(err)
    });
  }

  save(): void {
    if (!this.canSave()) return;
    const entity = this.entity();
    if (!entity) return;
    this.saving.set(true);
    this.banner.set(null);
    const req = this.toRequest();
    this.workflowsSvc.validateWorkflow(entity.id, req).pipe(
      switchMap(v => {
        this.applyValidation(v.data);
        if (!v.data?.isValid) { this.saving.set(false); return EMPTY; }   // erreurs remontées par étape, rien n'est écrit
        return this.id
          ? this.workflowsSvc.updateWorkflow(this.id, { ...req, rowVersion: this.rowVersion() })
          : this.workflowsSvc.createWorkflow(entity.id, req);
      })
    ).subscribe({
      next: r => {
        const wf = r.data!;
        this.saving.set(false);
        this.toast.add({ severity: 'success', summary: this.L.designer.title, detail: this.L.designer.saved });
        if (!this.id) void this.router.navigate(['/studio/workflows', wf.id], { replaceUrl: true });
        else { this.apply(wf); this.refreshToken.update(n => n + 1); }
      },
      error: (err: HttpErrorResponse) => this.fail(err)
    });
  }

  private applyValidation(result: WorkflowValidationResultDto | null | undefined): void {
    const errors = result?.errors ?? [];
    const warnings = result?.warnings ?? [];
    this.issues.set([...errors, ...warnings]);
    this.warningCount.set(warnings.length);
    this.validation.set(result ? { isValid: result.isValid, errors } : null);
  }

  /** Mapping 409/400/404 (motif `handleWriteError` du concepteur de vues, §0.5) ; sinon toast générique. */
  private fail(err: HttpErrorResponse): void {
    this.saving.set(false);
    this.busy.set(false);
    const msg = workflowErrorMessage(err);   // enveloppe { success, error } singulier (D-44-02)
    if (err.status === 409) {
      this.banner.set({ severity: 'warn', text: this.id ? this.L.designer.conflict : this.L.hub.duplicateKey, reload: !!this.id });
    } else if (err.status === 400) {
      this.banner.set({
        severity: 'error',
        text: msg.startsWith('Limite du plan') ? formatWorkflowLabel(this.L.designer.quota, { max: WORKFLOW_LIMITS.maxWorkflowsPerEntity }) : (msg || DESIGNER_LABELS.saveError),
        reload: false
      });
    } else if (err.status === 404) {
      void this.router.navigate(['/studio/workflows']);
    } else {
      this.toast.add({ severity: 'error', summary: this.L.designer.title, detail: DESIGNER_LABELS.saveError });
    }
  }

  /** Bannière 409 : recharge la définition ; confirmation si le brouillon local est sale. */
  reload(): void {
    if (this.dirty()) {
      this.confirm.confirm({
        header: this.L.designer.reload,
        message: this.L.designer.dirty,
        acceptLabel: this.L.designer.reload,
        accept: () => this.ngOnInit()
      });
      return;
    }
    this.ngOnInit();
  }

  // ---- Dupliquer / Supprimer (édition seulement) ----

  duplicate(): void {
    if (!this.id) return;
    this.workflowsSvc.duplicateWorkflow(this.id).subscribe({
      next: r => {
        this.toast.add({ severity: 'success', summary: this.L.designer.title, detail: this.L.hub.duplicated });
        if (r.data) void this.router.navigate(['/studio/workflows', r.data.id]);
      },
      // Mêmes erreurs que le hub : 409 clé `_copy<n>` prise (maxCopies 9), 400 quota 20/table.
      error: (err: HttpErrorResponse) => this.toast.add({
        severity: 'warn', summary: 'Erreur',
        detail: err.status === 409 ? this.L.hub.duplicateKey
          : err.status === 400 && workflowErrorMessage(err).startsWith('Limite du plan')
            ? formatWorkflowLabel(this.L.designer.quota, { max: WORKFLOW_LIMITS.maxWorkflowsPerEntity })
            : (workflowErrorMessage(err) || this.L.hub.loadError)
      })
    });
  }

  remove(): void {
    if (!this.id) return;
    const name = this.name();
    this.confirm.confirm({
      header: this.L.hub.deleteTitle,
      message: this.openInstances() > 0
        ? formatWorkflowLabel(this.L.hub.deleteWithInstances, { name, count: this.openInstances() })
        : formatWorkflowLabel(this.L.hub.deleteMessage, { name }),
      acceptLabel: this.L.hub.delete,
      acceptButtonStyleClass: 'btn-danger',
      accept: () => this.workflowsSvc.deleteWorkflow(this.id!).subscribe({
        next: r => {
          this.toast.add({ severity: 'success', summary: this.L.hub.title, detail: formatWorkflowLabel(this.L.hub.deleted, { count: r.data?.cancelledInstances ?? 0 }) });
          void this.router.navigate(['/studio/workflows']);
        },
        error: (err: HttpErrorResponse) => this.toast.add({ severity: 'error', summary: 'Erreur', detail: workflowErrorMessage(err) || this.L.hub.loadError })
      })
    });
  }

  // ---- Requête / état interne ----

  toRequest(): SaveWorkflowRequest {
    const trigger = this.trigger();
    return {
      key: this.key().trim(),
      name: this.name().trim(),
      description: this.description().trim() || null,
      trigger,
      triggerConfig: trigger === 'field_changed' || trigger === 'scheduled' ? this.triggerConfig() : null,
      steps: { version: 1, steps: this.steps() },
      isActive: this.isActive()
    };
  }

  /** Alimente le formulaire depuis la définition et (ré)initialise l'instantané `dirty`. */
  private apply(wf: WorkflowDefinitionDto | null): void {
    this.name.set(wf?.name ?? '');
    this.key.set(wf?.key ?? '');
    this.description.set(wf?.description ?? '');
    this.trigger.set(wf?.trigger ?? 'on_create');
    this.triggerConfig.set(wf?.triggerConfig ?? null);
    this.isActive.set(wf?.isActive ?? false);   // D-44-23 : un workflow neuf est inactif tant qu'on ne l'active pas
    this.keyTouched.set(!!wf);
    const steps = structuredClone(wf?.steps.steps ?? []);
    this.steps.set(steps);
    this.selectedIndex.set(steps.length ? 0 : null);
    this.rowVersion.set(wf?.rowVersion ?? null);
    this.version.set(wf?.version ?? 0);
    this.openInstances.set(wf?.openInstances ?? 0);
    this.issues.set([]);
    this.warningCount.set(0);
    this.validation.set(null);
    this.banner.set(null);
    this.snapshot.set(JSON.stringify(this.toRequest()));
  }

  protected formatLabel(template: string, values: Record<string, string | number>): string {
    return formatWorkflowLabel(template, values);
  }

  /** Garde légère anti-perte de saisie (pas de `canDeactivate` en 4.4). */
  @HostListener('window:beforeunload', ['$event'])
  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.dirty()) event.returnValue = true;
  }
}
