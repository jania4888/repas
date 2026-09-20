import { ChangeDetectionStrategy, Component, computed, inject, model, output, signal } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { SkeletonModule } from 'primeng/skeleton';
import { TabsModule } from 'primeng/tabs';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { ReportResult } from '@shared/studio-runtime/studio-runtime.models';
import { StudioAiCapabilitiesService } from '../studio-ai-capabilities.service';
import { STUDIO_AI_LABELS, formatLabel } from '../studio-ai-labels';
import { StudioAiSessionStore } from '../studio-ai-session.store';
import { StudioAiPreviewMode, StudioAiPreviewTab } from '../studio-ai.models';
import { counterChips } from '../studio-ai-spec.util';
import { isWorkflowPlanKind } from './studio-ai-workflow-summary.util';
import { StudioAiDuplicatesBannerComponent } from './studio-ai-duplicates-banner.component';
import { StudioAiFormsTabComponent } from './studio-ai-forms-tab.component';
import { StudioAiMenuTabComponent } from './studio-ai-menu-tab.component';
import { StudioAiModeBarComponent } from './studio-ai-mode-bar.component';
import { StudioAiOverviewTabComponent } from './studio-ai-overview-tab.component';
import { StudioAiRelationsTabComponent } from './studio-ai-relations-tab.component';
import { StudioAiReportsTabComponent } from './studio-ai-reports-tab.component';
import { StudioAiSeedTabComponent } from './studio-ai-seed-tab.component';
import { StudioAiTablesTabComponent } from './studio-ai-tables-tab.component';
import { StudioAiTestPanelComponent } from './studio-ai-test-panel.component';
import { StudioAiViewsTabComponent } from './studio-ai-views-tab.component';
import { StudioAiWorkflowsTabComponent } from './studio-ai-workflows-tab.component';

/**
 * Coquille de l'aperçu de la proposition (`/studio/ai`) : en-tête + 10 onglets (P1a, lecture seule).
 *
 * Trois états : aucun plan (placeholder), spec en cours de chargement (squelette), proposition
 * chargée (en-tête, compteurs, onglets). Le composant ne crée jamais rien : « Créer maintenant »
 * remonte `confirmRequested` pour que la page ouvre le dialogue de confirmation, seul chemin vers
 * `POST {id}/confirm`. La barre de modes (Aperçu / Tester / Personnaliser, 3.4c) remplace l'ancien
 * bouton « Modifier » ; « Personnaliser » démarre l'édition dans le store. En mode « Tester » (3.4f1),
 * les onglets sont remplacés par le panneau de simulation (`app-studio-ai-test-panel`, 0 écriture).
 * En mode « Personnaliser » (3.4g1), l'onglet Tables devient éditable (mutations `updateField` /
 * `addField` / `removeField` du store) et un pied collant affiche le compteur de modifications et
 * l'action « Enregistrer le brouillon » (`saveDraft` existant). En 3.4g2, l'onglet Tables permet
 * en plus le réordonnancement des champs (`reorderFields`) et l'onglet Vues l'édition des filtres
 * (`updateView`) via le constructeur de filtres partagé.
 */
@Component({
  selector: 'app-studio-ai-preview',
  standalone: true,
  imports: [
    ButtonModule, SkeletonModule, TabsModule, TagModule, TooltipModule,
    StudioAiOverviewTabComponent, StudioAiTablesTabComponent, StudioAiRelationsTabComponent,
    StudioAiFormsTabComponent, StudioAiSeedTabComponent, StudioAiReportsTabComponent,
    StudioAiMenuTabComponent, StudioAiDuplicatesBannerComponent, StudioAiModeBarComponent,
    StudioAiViewsTabComponent, StudioAiWorkflowsTabComponent, StudioAiTestPanelComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './studio-ai-preview.scss',
  template: `
    <section class="sai-panel" aria-labelledby="sai-preview-title">
      <header class="sai-head">
        <span class="sai-empty__icon" aria-hidden="true"><i class="fa-solid fa-diagram-project"></i></span>
        <div class="sai-head__text">
          <h2 class="sai-title" id="sai-preview-title">{{ headerTitle() }}</h2>
          <p class="sai-sub">{{ headerSubtitle() }}</p>
        </div>
        @if (store.plan()) {
          <div class="sai-head__actions">
            <app-studio-ai-mode-bar
              [mode]="store.mode()"
              [expiresInSeconds]="store.expiresInSeconds()"
              [changeCount]="store.changeCount()"
              [previewUnavailable]="store.previewUnavailable()"
              [busy]="store.busy()"
              [disabledModes]="disabledModes()"
              [disabledTooltip]="workflowLabels.soonForWorkflows"
              (modeChange)="store.setMode($event)"
              (regenerate)="regenerateExpired()" />
            <p-button
              [label]="labels.cancel"
              icon="fa-solid fa-xmark"
              severity="secondary"
              [text]="true"
              (onClick)="store.cancelPlan()" />
            <p-button
              [label]="labels.createNow"
              icon="fa-solid fa-check"
              severity="success"
              [disabled]="!store.canConfirm()"
              [pTooltip]="confirmTooltip()"
              (onClick)="confirmRequested.emit()" />
          </div>
        }
      </header>

      @if (!previewEnabled()) {
        <div class="sai-banner" role="status">
          <i class="fa-solid fa-circle-info" aria-hidden="true"></i>
          <span>{{ capabilityLabels.previewDisabled }}</span>
        </div>
      }
      @if (store.error(); as error) {
        <div class="sai-banner sai-banner--error" role="alert">
          <i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
          <span>{{ error }}</span>
        </div>
      }
      @for (validationError of store.validation().errors; track validationError) {
        <div class="sai-banner sai-banner--error" role="alert" data-testid="sai-validation-error">
          <i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
          <span>{{ validationError }}</span>
        </div>
      }
      @if (store.warnings().length) {
        <div class="sai-banner sai-banner--warn">
          <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
          <div>
            <strong>{{ store.warnings().length }} {{ labels.warningsTitle }}</strong>
            <ul>
              @for (warning of store.warnings(); track warning) {
                <li>{{ warning }}</li>
              }
            </ul>
          </div>
        </div>
      }

      @if (store.plan()) {
        <app-studio-ai-duplicates-banner
          [hints]="store.duplicates()"
          [busy]="store.busy() || store.validation().pending || store.specLoading()"
          (reuse)="store.reuseExistingTable($event)"
          (createAnyway)="store.renameDuplicate($event)" />
      }

      @if (!store.plan()) {
        <div class="sai-empty">
          <span class="sai-empty__icon" aria-hidden="true"><i class="fa-solid fa-wand-magic-sparkles"></i></span>
          <strong>{{ labels.emptyTitle }}</strong>
          <span>{{ labels.emptyHint }}</span>
        </div>
      } @else if (isWorkflowPlan() && !spec()) {
        <!-- Plan Workflow sans spec (D12, 4.4k1) : l'onglet « Workflow » seul, alimenté par le résumé. -->
        <section class="sai-body" data-testid="sai-workflow-only">
          <app-studio-ai-workflows-tab [spec]="null" [summary]="summary()" />
        </section>
      } @else if (store.specLoading() || !spec()) {
        <div class="sai-body" aria-busy="true" aria-live="polite">
          <p class="sai-hint">{{ labels.loadingSpec }}</p>
          <p-skeleton width="45%" height="1.25rem" styleClass="mb-3" />
          <p-skeleton width="100%" height="2.5rem" styleClass="mb-3" />
          <p-skeleton width="100%" height="12rem" />
        </div>
      } @else {
        <div class="sai-chips">
          @for (chip of chips(); track chip.label) {
            <span class="sai-chip"><span class="sai-chip__num">{{ chip.value }}</span> {{ chip.label }}</span>
          }
        </div>

        @switch (store.mode()) {
          @case ('test') {
            <!-- Mode Tester (3.4f1) : formulaire simulé depuis la spec, 0 écriture ; onglets masqués. -->
            <app-studio-ai-test-panel
              [spec]="spec()!"
              [preview]="store.preview()"
              [previewUnavailable]="store.previewUnavailable()"
              [sample]="reportSample()" />
          }
          @default {
        <p-tabs [value]="activeTab()" [scrollable]="true" (valueChange)="onTabChange($event)">
          <p-tablist>
            @for (tab of tabs; track tab.id) {
              <p-tab [value]="tab.id" [disabled]="!tab.available">
                <span
                  class="sai-tab-label"
                  [class.sai-tab-label--soon]="!tab.available"
                  [pTooltip]="tab.soonTooltip ?? ''"
                  [tooltipDisabled]="tab.available"
                  tooltipPosition="bottom"
                  (click)="onTabLabelClick($event, tab.available)">
                  <i [class]="tab.icon" aria-hidden="true"></i>
                  {{ tab.label }}
                  @if (tabCount(tab.id) !== null) {
                    <span class="sai-count">{{ tabCount(tab.id) }}</span>
                  }
                  @if (!tab.available) {
                    <p-tag class="sai-soon" severity="warn" [value]="soon" />
                  }
                </span>
              </p-tab>
            }
          </p-tablist>
          <p-tabpanels>
            <p-tabpanel value="overview">
              <app-studio-ai-overview-tab
                [spec]="spec()!"
                [counters]="store.counters()"
                [warnings]="store.warnings()"
                (openEntity)="selectEntity($event)" />
            </p-tabpanel>
            <p-tabpanel value="tables">
              <!-- 3.4g1/g2 : en mode Personnaliser, l'onglet Tables devient éditable et réordonnable. -->
              <app-studio-ai-tables-tab
                [spec]="spec()!"
                [selectedRef]="selectedRef()"
                [highlightedRef]="store.highlightedEntityRef()"
                [editable]="store.mode() === 'customize'"
                [changes]="store.changes()"
                (fieldChange)="store.updateField($event.ref, $event.key, $event.patch)"
                (fieldAdd)="store.addField($event)"
                (fieldRemove)="store.removeField($event.ref, $event.key)"
                (fieldReorder)="store.reorderFields($event.ref, $event.from, $event.to)" />
            </p-tabpanel>
            <p-tabpanel value="relations">
              <app-studio-ai-relations-tab [spec]="spec()!" />
            </p-tabpanel>
            <p-tabpanel value="forms">
              <app-studio-ai-forms-tab [spec]="spec()!" />
            </p-tabpanel>
            <p-tabpanel value="seed">
              <!-- 3.4h : en mode Personnaliser, chaque bloc permet d'importer un CSV (seed du brouillon). -->
              <app-studio-ai-seed-tab
                [spec]="spec()!"
                [editable]="store.mode() === 'customize'"
                (seedReplace)="store.replaceSeed($event.ref, $event.records)" />
            </p-tabpanel>
            <p-tabpanel value="reports">
              <app-studio-ai-reports-tab [spec]="spec()!" />
            </p-tabpanel>
            <p-tabpanel value="views">
              <!-- 3.4g2 : en mode Personnaliser, les filtres de chaque vue sont éditables. -->
              <app-studio-ai-views-tab
                [spec]="spec()!"
                [editable]="store.mode() === 'customize'"
                (viewChange)="store.updateView($event.ref, $event.index, $event.patch)" />
            </p-tabpanel>
            <p-tabpanel value="workflow">
              <app-studio-ai-workflows-tab [spec]="spec()" [summary]="summary()" />
            </p-tabpanel>
            <p-tabpanel value="menu">
              <app-studio-ai-menu-tab [spec]="spec()!" />
            </p-tabpanel>
          </p-tabpanels>
        </p-tabs>
          }
        }

        @if (store.mode() === 'customize') {
          <!-- Pied collant du mode Personnaliser (3.4g1) : compteur de modifications + sauvegarde. -->
          <footer class="sai-changes-footer" data-component-id="sai-changes-footer">
            @if (store.changeCount() > 0) {
              <span class="sai-changes-badge" data-component-id="sai-changes-badge">
                <span class="sai-changes-badge__dot" aria-hidden="true"></span>{{ changesBadge() }}
              </span>
            } @else {
              <span class="sai-hint">{{ customizeLabels.noChanges }}</span>
            }
            <span class="sai-changes-footer__spacer"></span>
            <p-button
              [label]="modeLabels.saveDraft"
              icon="fa-solid fa-floppy-disk"
              [disabled]="store.changeCount() === 0 || store.validation().pending"
              (onClick)="store.saveDraft()" />
          </footer>
        }
      }
    </section>
  `
})
export class StudioAiPreviewComponent {
  readonly store = inject(StudioAiSessionStore);
  private readonly capabilitiesService = inject(StudioAiCapabilitiesService);

  /** Onglet actif ; la page peut le prérégler selon l'intention (« Rapport » → `reports`). */
  readonly activeTab = model<StudioAiPreviewTab>('overview');
  /** Demande d'ouverture du dialogue de confirmation (la page décide, cf. WP‑B). */
  readonly confirmRequested = output<void>();
  /** Table choisie dans la Vue d'ensemble, relayée à la page (elle synchronise son onglet). */
  readonly openEntity = output<string>();

  readonly labels = STUDIO_AI_LABELS.preview;
  readonly capabilityLabels = STUDIO_AI_LABELS.capabilities;
  readonly soon = STUDIO_AI_LABELS.soon;
  readonly tabs = STUDIO_AI_LABELS.tabs;
  readonly customizeLabels = STUDIO_AI_LABELS.customize;
  readonly modeLabels = STUDIO_AI_LABELS.modes;
  readonly workflowLabels = STUDIO_AI_LABELS.workflows;

  /** Table à mettre en avant dans l'onglet Tables (clic dans la Vue d'ensemble). */
  readonly selectedRef = signal<string | null>(null);

  readonly spec = computed(() => this.store.draft() ?? this.store.spec());
  readonly previewEnabled = computed(() => this.capabilitiesService.capabilities().planPreviewEnabled);
  /** Échantillon de rapport calculé par le serveur (`summary.sample`, P5) pour le mode Tester. */
  readonly reportSample = computed<ReportResult | null>(() => this.store.plan()?.summary.sample ?? null);
  /** Plan de type Workflow (casse tolérée, 4.4k1) : pas de `StudioSystemSpec`, résumé seul. */
  readonly isWorkflowPlan = computed(() => isWorkflowPlanKind(this.store.plan()?.kind));
  /** Résumé du plan (porteur de `workflows[]` pour un plan Workflow). */
  readonly summary = computed(() => this.store.plan()?.summary ?? null);
  /** Tester/Personnaliser exigent une spec : désactivés pour une proposition de workflow. */
  readonly disabledModes = computed<StudioAiPreviewMode[]>(() => this.isWorkflowPlan() ? ['test', 'customize'] : []);

  readonly headerTitle = computed(
    () => this.spec()?.system?.displayName || this.store.plan()?.summary.title || this.labels.title
  );

  readonly headerSubtitle = computed(() => {
    if (!this.store.plan()) return this.labels.emptyHint;
    if (this.store.mode() === 'customize') return this.labels.editingSubtitle;
    const description = this.spec()?.system?.description;
    return description ? `${description} · ${this.labels.nothingCreated}` : this.labels.nothingCreated;
  });

  readonly confirmTooltip = computed(() => {
    if (this.store.expired()) return this.labels.expired;
    return this.store.canConfirm() ? '' : this.labels.integrateDisabledDirty;
  });

  readonly chips = computed(() => counterChips(this.store.counters()));

  /** Badge « n modifications » du pied Personnaliser (3.4g1). */
  readonly changesBadge = computed(() =>
    formatLabel(STUDIO_AI_LABELS.customize.changes, { count: this.store.changeCount() }));

  /** Compteur affiché dans l'onglet ; `null` = pas de compteur (Vue d'ensemble, Pages, Workflow sans workflow). */
  tabCount(id: StudioAiPreviewTab): number | null {
    const counters = this.store.counters();
    switch (id) {
      case 'tables': return counters.entities;
      case 'relations': return counters.relations;
      case 'forms': return counters.forms;
      case 'seed': return counters.seedRecords;
      case 'reports': return counters.reports;
      case 'views': return counters.views;
      case 'workflow': return counters.workflows || null;
      default: return null;
    }
  }

  onTabChange(value: string | number): void {
    const next = value as StudioAiPreviewTab;
    if (!this.tabs.find(t => t.id === next)?.available) return;
    this.activeTab.set(next);
  }

  /**
   * PrimeNG pose `pointer-events: none` sur un onglet désactivé (et ses enfants), ce qui empêche le
   * tooltip « Bientôt » de s'afficher. On réactive les événements sur le libellé seul et on stoppe
   * le clic pour qu'il ne remonte pas au `p-tab` (dont `onClick` n'est pas gardé par `disabled`).
   */
  onTabLabelClick(event: Event, available: boolean): void {
    if (!available) event.stopPropagation();
  }

  /** « Régénérer » sur un plan expiré : rejoue le plan (`POST {id}/replay`) et ouvre le nouveau. */
  regenerateExpired(): void {
    const plan = this.store.plan();
    if (plan) this.store.replay(plan.planId);
  }

  /** Clic sur une table de la Vue d'ensemble : bascule sur l'onglet Tables, table sélectionnée. */
  selectEntity(ref: string): void {
    this.selectedRef.set(ref);
    this.activeTab.set('tables');
    this.openEntity.emit(ref);
  }
}
