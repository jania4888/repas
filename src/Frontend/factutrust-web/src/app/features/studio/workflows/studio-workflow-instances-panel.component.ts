import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BadgeModule } from 'primeng/badge';
import { ButtonModule } from 'primeng/button';
import { SkeletonModule } from 'primeng/skeleton';
import { TooltipModule } from 'primeng/tooltip';
import { STUDIO_WORKFLOW_LABELS, formatWorkflowLabel } from './studio-workflow-labels';
import { StudioWorkflowStatusTagComponent } from './studio-workflow-status-tag.component';
import { WorkflowInstanceDto } from './studio-workflows.models';
import { StudioWorkflowsService } from './studio-workflows.service';

/**
 * Libellés FR locaux absents de `STUDIO_WORKFLOW_LABELS` (4.4a1, non modifié dans cette
 * tranche — même motif que `DESIGNER_LABELS` du concepteur, 4.4e1) : erreur et « Charger plus ».
 */
const PANEL_LABELS = {
  loadError: 'Chargement des instances impossible.',
  retry: 'Réessayer',
  /** 4.7a2 / D-47-F01 : accumulation paginée — le total serveur fait foi (lève D-46-01). */
  more: 'Charger plus — encore {remaining}'
} as const;

/** Taille de page du panneau « Historique » (borne API 1..200, défaut route 50 — 4.7a1). */
const PANEL_PAGE_SIZE = 20;

/**
 * Panneau « Historique » — colonne 3 du concepteur de workflow (4.4e2, maquette
 * `d44-workflows-designer.html` ; 4.7a2 / D-47-F01 : pagination réelle « Charger plus »,
 * pages de 20 accumulées, lève D-46-01 côté UI) : la route est paginée depuis 4.7a1
 * (`?page=&pageSize=` → `PagedResult`) ; la liste accumule les pages et le bouton
 * « Charger plus — encore N » disparaît quand tout est chargé. Le badge d'en-tête est
 * l'entrée `openCount` (alimentée par `openInstances` de la définition, D-47-F02) :
 * un comptage local sur la page chargée serait faux dès la pagination. Rechargé à la
 * page 1 quand `workflowId`/`refreshToken` changent (le concepteur incrémente le jeton
 * après chaque enregistrement — pas de minuteur d'auto-rafraîchissement). Le clic sur
 * une ligne émet `open` (le concepteur pose `?instance=<id>` dans l'URL, D20). Le DTO
 * n'expose pas de libellé d'enregistrement (D-44-24) : identifiant tronqué + lien
 * « Ouvrir la fiche » vers la route gardée `records/:key/:id`.
 */
@Component({
  selector: 'app-studio-workflow-instances-panel',
  standalone: true,
  imports: [DatePipe, RouterLink, BadgeModule, ButtonModule, SkeletonModule, TooltipModule, StudioWorkflowStatusTagComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wf-inst-head">
      <h3 class="wf-inst-head__title">{{ L.instances.history }}</h3>
      @if (openCount() > 0) {
        <p-badge [value]="openCount()" severity="warn" data-testid="wf-instances-open-count" />
      }
    </div>

    @if (!workflowId()) {
      <p class="wf-inst__hint" data-testid="wf-instances-unsaved">{{ L.designer.unsavedInstances }}</p>
    } @else if (loading()) {
      <div class="wf-inst-skel" data-testid="wf-instances-loading">
        <p-skeleton height="2.75rem" />
        <p-skeleton height="2.75rem" />
        <p-skeleton height="2.75rem" />
      </div>
    } @else if (error()) {
      <div class="wf-inst__error" data-testid="wf-instances-error">
        <p class="wf-inst__hint">{{ panelLabels.loadError }}</p>
        <button pButton type="button" size="small" [outlined]="true" [label]="panelLabels.retry"
          data-testid="wf-instances-retry" (click)="retry()"></button>
      </div>
    } @else if (!instances().length) {
      <p class="wf-inst__hint" data-testid="wf-instances-empty">{{ L.instances.empty }}</p>
    } @else {
      <ul class="wf-inst" data-testid="wf-instances-list">
        @for (i of instances(); track i.id) {
          <li class="wf-inst__item">
            <button type="button" class="wf-inst__row" (click)="open.emit(i)" [attr.data-testid]="'wf-instance-' + i.id">
              <app-studio-workflow-status-tag [status]="i.status" [compact]="true" />
              <span class="wf-inst__body">
                <span class="wf-inst__rec" [title]="i.recordId">{{ shortId(i.recordId) }}</span>
                <span class="wf-inst__dates">
                  {{ i.startedAt | date:'dd/MM HH:mm' }}
                  @if (i.dueAt) {
                    · {{ L.instances.dueAt }} {{ i.dueAt | date:'dd/MM HH:mm' }}
                  }
                  @if (i.error) {
                    <i class="fa-solid fa-circle-exclamation wf-inst__err" [pTooltip]="i.error" aria-hidden="true"></i>
                  }
                </span>
              </span>
            </button>
            @if (entityKey(); as entityKey) {
              <a class="wf-inst__open" [routerLink]="['/studio/records', entityKey, i.recordId]"
                [attr.data-testid]="'wf-instance-open-' + i.id">{{ L.approvals.openRecord }}</a>
            }
          </li>
        }
      </ul>
      @if (hasMore()) {
        <button pButton type="button" size="small" [outlined]="true" class="wf-inst__more"
          [label]="moreText()" [loading]="loadingMore()" data-testid="wf-instances-more"
          (click)="loadMore()"></button>
      }
    }
  `,
  styles: [`
    .wf-inst-head { display: flex; align-items: center; gap: var(--spacing-2, 0.5rem); }
    .wf-inst-head__title { margin: 0; font-size: 0.9375rem; font-weight: 600; }
    .wf-inst__hint { margin: 0; color: var(--color-neutral-500, #64748b); font-size: var(--font-size-sm, 0.8125rem); }
    .wf-inst-skel { display: flex; flex-direction: column; gap: var(--spacing-2, 0.5rem); }
    .wf-inst__error { display: flex; flex-direction: column; align-items: flex-start; gap: var(--spacing-2, 0.5rem); }
    .wf-inst { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: .25rem; }
    .wf-inst__item { display: flex; flex-direction: column; }
    .wf-inst__row { display: grid; grid-template-columns: auto 1fr; gap: .5rem; width: 100%; text-align: left; background: none; border: 1px solid transparent; border-radius: var(--radius-md); padding: .4rem .5rem; cursor: pointer; font: inherit; color: inherit; }
    .wf-inst__row:hover { border-color: var(--color-border-subtle); }
    .wf-inst__body { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
    .wf-inst__rec { font-weight: 600; font-size: 0.8125rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .wf-inst__dates { display: inline-flex; align-items: center; gap: .25rem; font-size: 0.75rem; color: var(--color-neutral-500, #64748b); }
    .wf-inst__err { color: var(--red-500, #ef4444); }
    .wf-inst__open { align-self: flex-start; margin: 0 .5rem .25rem 2rem; font-size: 0.75rem; }
    .wf-inst__more { align-self: flex-start; margin-top: var(--spacing-2, 0.5rem); }
  `]
})
export class StudioWorkflowInstancesPanelComponent {
  private readonly workflowsSvc = inject(StudioWorkflowsService);

  readonly workflowId = input.required<string | null>();
  /** Clé de la table (pour le lien « Ouvrir la fiche ») — le concepteur la connaît via `entity().key`. */
  readonly entityKey = input<string | null>(null);
  readonly refreshToken = input(0);
  /** Instances ouvertes (badge d'en-tête) — fourni par le concepteur (`openInstances` de la définition, D-47-F02). */
  readonly openCount = input(0);
  readonly open = output<WorkflowInstanceDto>();

  protected readonly L = STUDIO_WORKFLOW_LABELS;
  protected readonly panelLabels = PANEL_LABELS;
  protected readonly instances = signal<WorkflowInstanceDto[]>([]);
  protected readonly totalCount = signal(0);
  protected readonly page = signal(0);
  protected readonly loading = signal(false);
  /** Chargement d'une page suivante (« Charger plus ») — la liste reste visible pendant. */
  protected readonly loadingMore = signal(false);
  protected readonly error = signal(false);

  /** Dernier couple (workflowId, refreshToken) chargé — garde anti double-déclenchement de l'effect. */
  private lastKey: string | null = null;

  constructor() {
    effect(() => {
      const id = this.workflowId();
      const token = this.refreshToken();
      const key = `${id ?? ''}|${token}`;
      if (key === this.lastKey) return;
      this.lastKey = key;
      untracked(() => this.reload(id));
    });
  }

  /** Il reste des pages à charger (le total serveur fait foi — D-47-F01). */
  protected readonly hasMore = computed(() => this.instances().length < this.totalCount());
  protected readonly moreText = computed(() =>
    formatWorkflowLabel(PANEL_LABELS.more, { remaining: Math.max(0, this.totalCount() - this.instances().length) }));

  /** Rechargement complet à la page 1 (changement de workflow ou jeton de rafraîchissement). */
  private reload(id: string | null): void {
    this.instances.set([]);
    this.totalCount.set(0);
    this.page.set(0);
    if (!id) return;
    this.loadPage(id, 1, false);
  }

  /** « Charger plus » : page suivante accumulée à la liste. */
  protected loadMore(): void {
    const id = this.workflowId();
    if (!id || this.loadingMore() || !this.hasMore()) return;
    this.loadPage(id, this.page() + 1, true);
  }

  private loadPage(id: string, page: number, append: boolean): void {
    if (append) this.loadingMore.set(true); else this.loading.set(true);
    this.error.set(false);
    this.workflowsSvc.listInstances(id, page, PANEL_PAGE_SIZE).subscribe({
      next: r => {
        const result = r.data ?? null;
        this.instances.update(list => append ? [...list, ...(result?.items ?? [])] : (result?.items ?? []));
        this.totalCount.set(result?.totalCount ?? 0);
        this.page.set(page);
        this.loading.set(false);
        this.loadingMore.set(false);
      },
      error: () => { this.error.set(true); this.loading.set(false); this.loadingMore.set(false); }
    });
  }

  /** Bouton « Réessayer » de l'état d'erreur : recharge depuis la page 1. */
  protected retry(): void {
    this.reload(this.workflowId());
  }

  /** Identifiant d'enregistrement tronqué (pas de libellé dans le DTO — D-44-24) ; le `title` porte l'identifiant complet. */
  protected shortId(recordId: string): string {
    return recordId.length > 8 ? recordId.slice(0, 8) + '…' : recordId;
  }
}
