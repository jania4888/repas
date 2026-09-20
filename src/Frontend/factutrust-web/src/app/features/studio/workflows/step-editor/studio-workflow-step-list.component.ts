import { ChangeDetectionStrategy, Component, computed, inject, input, model, signal, viewChild } from '@angular/core';
import { MenuItem } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { Menu, MenuModule } from 'primeng/menu';
import { TagModule } from 'primeng/tag';
import { ConfirmationService } from '@core/services/confirmation.service';
import { STUDIO_WORKFLOW_LABELS, STEP_TYPE_ICONS, formatWorkflowLabel, stepTypeLabel } from '../studio-workflow-labels';
import {
  StepCatalogEntryDto,
  WORKFLOW_LIMITS,
  WorkflowStepSpec,
  WorkflowStepType,
  WorkflowValidationIssueDto
} from '../studio-workflows.models';
import { newStep, nextStepKey, referencingSteps } from './studio-workflow-step-defaults';

/**
 * Libellés FR locaux de la liste : absents de `STUDIO_WORKFLOW_LABELS` (4.4a1, fichier non
 * modifié dans cette tranche) — à centraliser en 4.4e1 si un autre composant en a besoin.
 */
const LIST_LABELS = {
  listAria: 'Étapes du workflow',
  rowActions: 'Actions de l\'étape {key}',
  removeTitle: 'Supprimer l\'étape ?',
  removeReferenced: 'L\'étape « {key} » est la cible d\'un branchement « Aller à » depuis : {refs}. La suppression retire aussi ces références.'
} as const;

/** Ligne affichée : étape + position + nombre d'issues de validation + entrée de catalogue. */
interface StepRow { step: WorkflowStepSpec; index: number; errors: number; entry: StepCatalogEntryDto | undefined }

/**
 * Liste ordonnée des étapes d'un workflow (4.4c2) — colonne gauche du concepteur (maquette
 * `d44-workflows-designer.html`) : ajout typé via menu popup (7 types du catalogue serveur),
 * sélection, montée/descente, duplication et suppression gardée par les références `gotoKey`
 * (D-44-18). Standalone + OnPush + signals ; le parent remplace l'élément édité par index.
 */
@Component({
  selector: 'app-studio-workflow-step-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonModule, MenuModule, TagModule],
  template: `
    <div class="wf-step-list">
      @if (rows().length > 0) {
        <ol class="wf-steps" role="listbox" [attr.aria-label]="listLabels.listAria"
            (keydown.arrowup)="selectRelative(-1, $event)" (keydown.arrowdown)="selectRelative(1, $event)">
          @for (r of rows(); track r.step.key) {
            <li class="wf-steps__item" [class.wf-steps__item--active]="r.index === selectedIndex()" role="option"
                [attr.aria-selected]="r.index === selectedIndex()" [attr.data-testid]="'wf-step-' + r.step.key"
                tabindex="0" (click)="selectedIndex.set(r.index)">
              <span class="wf-steps__no" aria-hidden="true">{{ r.index + 1 }}</span>
              <i [class]="icons[r.step.type] + ' wf-steps__icon'" aria-hidden="true"></i>
              <span class="wf-steps__label">{{ r.step.label || r.step.key }}</span>
              @if (r.errors > 0) {
                <p-tag severity="danger" [value]="'' + r.errors" />
              }
              <button pButton type="button" text rounded icon="fa-solid fa-ellipsis-vertical" class="p-button-sm"
                [disabled]="disabled()" (click)="openRowMenu($event, r.index)"
                [attr.aria-label]="rowActionsLabel(r.step.key)"></button>
            </li>
          }
        </ol>
      } @else {
        <p class="studio-muted wf-steps__empty">{{ labels.designer.noSteps }}</p>
      }
      <div class="wf-step-list__foot">
        <button pButton type="button" icon="fa-solid fa-plus" [label]="labels.designer.addStep" severity="secondary"
          [outlined]="true" class="wf-step-list__add" data-testid="wf-step-add" aria-haspopup="menu"
          [disabled]="disabled() || steps().length >= limits.maxSteps" (click)="openAddMenu($event)"></button>
        <span class="studio-muted">{{ steps().length }}/{{ limits.maxSteps }}</span>
      </div>
      <p-menu #rowMenu [model]="rowMenuItems()" [popup]="true" appendTo="body" styleClass="studio-theme"></p-menu>
      <p-menu #addMenu [model]="addItems()" [popup]="true" appendTo="body" styleClass="studio-theme">
        <ng-template #item let-item>
          <a class="p-menu-item-link" tabindex="-1" [attr.data-testid]="'wf-step-type-' + item.state?.['type']">
            <i [class]="item.icon" aria-hidden="true"></i>
            <span class="p-menu-item-label">{{ item.label }}</span>
          </a>
        </ng-template>
      </p-menu>
    </div>
  `,
  styles: [`
    .wf-step-list { display: flex; flex-direction: column; }
    .wf-steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .25rem; }
    .wf-steps__item { display: grid; grid-template-columns: 1.5rem 1.25rem 1fr auto auto; gap: .5rem; align-items: center; padding: .5rem .75rem; border: 1px solid var(--color-neutral-200); border-radius: var(--radius-md, 8px); cursor: pointer; }
    .wf-steps__item:focus-visible { outline: none; box-shadow: var(--focus-ring); }
    .wf-steps__item--active { border-color: var(--color-primary-600); background: var(--color-primary-50); }
    .wf-steps__no { width: 1.5rem; height: 1.5rem; border-radius: 50%; background: var(--color-primary-50); color: var(--color-primary-700); font-weight: 700; font-size: .75rem; display: inline-flex; align-items: center; justify-content: center; }
    .wf-steps__item--active .wf-steps__no { background: var(--color-primary-600); color: #fff; }
    .wf-steps__icon { color: var(--color-primary-600); text-align: center; }
    .wf-steps__label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .875rem; }
    .wf-steps__empty { margin: 0 0 .5rem; }
    .wf-step-list__foot { display: flex; align-items: center; gap: .75rem; margin-top: .5rem; }
    .wf-step-list__add.p-button { flex: 1; justify-content: center; border-style: dashed; }
  `]
})
export class StudioWorkflowStepListComponent {
  readonly steps = model.required<WorkflowStepSpec[]>();
  readonly selectedIndex = model<number | null>(null);
  readonly catalog = input.required<StepCatalogEntryDto[]>();
  readonly issues = input<WorkflowValidationIssueDto[]>([]);
  readonly disabled = input(false);

  private readonly confirm = inject(ConfirmationService);

  protected readonly labels = STUDIO_WORKFLOW_LABELS;
  protected readonly listLabels = LIST_LABELS;
  protected readonly icons = STEP_TYPE_ICONS;
  protected readonly limits = WORKFLOW_LIMITS;

  protected readonly addMenu = viewChild<Menu>('addMenu');
  private readonly rowMenu = viewChild<Menu>('rowMenu');

  protected readonly canAdd = computed(() => !this.disabled() && this.steps().length < WORKFLOW_LIMITS.maxSteps);

  // `state.type` alimente le data-testid du template #item (motif p-menu popup : studio-kanban-board.component.ts).
  protected readonly addItems = computed<MenuItem[]>(() =>
    this.catalog().map(e => ({ label: stepTypeLabel(e.type, e.label), icon: STEP_TYPE_ICONS[e.type], state: { type: e.type }, command: () => this.add(e.type) })));

  protected readonly rows = computed<StepRow[]>(() => this.steps().map((s, i) => ({
    step: s,
    index: i,
    errors: this.issues().filter(x => x.path === `steps[${i}]` || x.path.startsWith(`steps[${i}].`) || x.path.startsWith(`steps[${i}][`)).length,
    entry: this.catalog().find(e => e.type === s.type)
  })));

  protected readonly rowMenuItems = signal<MenuItem[]>([]);

  add(type: WorkflowStepType): void {
    if (!this.canAdd()) return;
    const next = [...this.steps(), newStep(type, this.steps())];
    this.steps.set(next);
    this.selectedIndex.set(next.length - 1);
  }

  move(i: number, delta: -1 | 1): void {
    const j = i + delta;
    if (j < 0 || j >= this.steps().length) return;
    const next = [...this.steps()];
    [next[i], next[j]] = [next[j], next[i]];
    this.steps.set(next);
    this.selectedIndex.set(j);
  }

  duplicate(i: number): void {
    if (!this.canAdd()) return;
    const src = this.steps()[i];
    const copy: WorkflowStepSpec = { ...structuredClone(src), key: nextStepKey(src.type, this.steps()) };
    delete copy['gotoKey'];   // un branchement n'est jamais recopié (il viserait la même cible)
    const next = [...this.steps()];
    next.splice(i + 1, 0, copy);
    this.steps.set(next);
    this.selectedIndex.set(i + 1);
  }

  remove(i: number): void {
    const step = this.steps()[i];
    const refs = referencingSteps(this.steps(), step.key);
    const doRemove = () => {
      const next = this.steps()
        .filter((_, k) => k !== i)
        .map(s => (s['gotoKey'] === step.key ? (({ gotoKey, ...rest }) => rest)(s) as WorkflowStepSpec : s));
      this.steps.set(next);
      this.selectedIndex.set(next.length ? Math.min(i, next.length - 1) : null);
    };
    if (refs.length === 0) { doRemove(); return; }
    this.confirm.confirm({
      header: LIST_LABELS.removeTitle,
      message: formatWorkflowLabel(LIST_LABELS.removeReferenced, { key: step.key, refs: refs.map(r => r.key).join(', ') }),
      acceptLabel: this.labels.steps.remove,
      acceptButtonStyleClass: 'btn-danger',
      accept: doRemove
    });
  }

  /**
   * Ouvre le menu d'ajout typé. Passe par une méthode : dans le template, la référence
   * `#addMenu` masque le signal `viewChild` (NG9 en AOT strict — correctif 4.4e1).
   */
  protected openAddMenu(event: Event): void {
    this.addMenu()?.toggle(event);
  }

  /** Menu contextuel d'une ligne : reconstruit à l'ouverture (items désactivés selon la position). */
  protected openRowMenu(event: Event, i: number): void {
    event.stopPropagation();
    const last = this.steps().length - 1;
    this.rowMenuItems.set([
      { label: this.labels.steps.moveUp, icon: 'fa-solid fa-arrow-up', disabled: this.disabled() || i === 0, command: () => this.move(i, -1) },
      { label: this.labels.steps.moveDown, icon: 'fa-solid fa-arrow-down', disabled: this.disabled() || i === last, command: () => this.move(i, 1) },
      { label: this.labels.designer.duplicate, icon: 'fa-solid fa-copy', disabled: !this.canAdd(), command: () => this.duplicate(i) },
      { separator: true },
      { label: this.labels.steps.remove, icon: 'fa-solid fa-trash', disabled: this.disabled(), command: () => this.remove(i) }
    ]);
    this.rowMenu()?.toggle(event);
  }

  /** Navigation clavier de la listbox (ArrowUp/ArrowDown sur l'`ol`). `Event` : `strictDomEventTypes` est inactif (NG5 AOT — correctif 4.4e1). */
  protected selectRelative(delta: -1 | 1, event: Event): void {
    const count = this.steps().length;
    if (!count) return;
    event.preventDefault();
    const cur = this.selectedIndex();
    this.selectedIndex.set(cur === null ? (delta === 1 ? 0 : count - 1) : Math.min(count - 1, Math.max(0, cur + delta)));
  }

  protected rowActionsLabel(key: string): string { return formatWorkflowLabel(LIST_LABELS.rowActions, { key }); }
}
