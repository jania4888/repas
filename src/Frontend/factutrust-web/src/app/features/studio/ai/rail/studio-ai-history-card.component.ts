import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SkeletonModule } from 'primeng/skeleton';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { STUDIO_AI_LABELS, formatLabel } from '../studio-ai-labels';
import { StudioAiPlanListItemDto } from '../studio-ai.models';
import { planKindLabel, planStatusLabel, planStatusSeverity, relativeTime } from './studio-ai-rail.util';

/**
 * Carte « Historique des générations » du rail : les 5 derniers plans du propriétaire, avec un tag
 * de statut et une date relative. Un plan `Pending` se rouvre d'un clic (`open`) ; les autres sont
 * en lecture ; un plan `replayable` propose « Rejouer » (`replay`) et `openUrl` un lien vers le système.
 * « Voir tout » mène à `/studio/ai/projects`. Rendue par le rail si `planPreviewEnabled`.
 */
@Component({
  selector: 'app-studio-ai-history-card',
  standalone: true,
  imports: [NgTemplateOutlet, RouterLink, SkeletonModule, TagModule, TooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './studio-ai-rail.scss',
  template: `
    <section class="sar-card" [attr.aria-label]="labels.history">
      <div class="sar-card__head">
        <h3 class="sar-card__title"><i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i>{{ labels.history }}</h3>
        <a class="sar-card__link" routerLink="/studio/ai/projects">{{ labels.seeAllHistory }}</a>
      </div>

      @if (loading() && !items().length) {
        <p-skeleton width="100%" height="2.25rem" />
        <p-skeleton width="100%" height="2.25rem" />
      } @else if (error()) {
        <p class="sar-error" role="status">{{ error() }}</p>
      } @else if (!items().length) {
        <p class="sar-empty">{{ labels.historyEmpty }}</p>
      } @else {
        <ul class="sar-list">
          @for (plan of items(); track plan.id) {
            <li>
              @if (plan.status === 'Pending') {
                <button
                  type="button"
                  class="sar-row"
                  [attr.data-plan-id]="plan.id"
                  [disabled]="busy()"
                  [pTooltip]="labels.openPlan"
                  tooltipPosition="left"
                  (click)="open.emit(plan)">
                  <ng-container *ngTemplateOutlet="row; context: { $implicit: plan }" />
                </button>
              } @else {
                <div class="sar-row" [attr.data-plan-id]="plan.id">
                  <ng-container *ngTemplateOutlet="row; context: { $implicit: plan }" />
                  @if (plan.replayable) {
                    <button
                      type="button"
                      class="sar-row__action"
                      data-action="replay"
                      [disabled]="busy()"
                      [pTooltip]="labels.replay"
                      tooltipPosition="left"
                      [attr.aria-label]="labels.replay"
                      (click)="replay.emit(plan)">
                      <i class="fa-solid fa-rotate-right" aria-hidden="true"></i>
                    </button>
                  }
                  @if (plan.openUrl) {
                    <a
                      class="sar-row__action"
                      data-action="open-system"
                      [routerLink]="plan.openUrl"
                      [pTooltip]="labels.openSystem"
                      tooltipPosition="left"
                      [attr.aria-label]="labels.openSystem">
                      <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>
                    </a>
                  }
                </div>
              }
            </li>
          }
        </ul>
      }
    </section>

    <ng-template #row let-plan>
      <span class="sar-row__body">
        <span class="sar-row__title">{{ plan.title || kind(plan) }}</span>
        <span class="sar-row__meta">{{ meta(plan) }}</span>
      </span>
      <span class="sar-row__end">
        <p-tag
          [value]="status(plan)"
          [severity]="severity(plan)"
          [pTooltip]="plan.status === 'Failed' ? (plan.errorMessage ?? undefined) : undefined"
          tooltipPosition="left" />
      </span>
    </ng-template>
  `
})
export class StudioAiHistoryCardComponent {
  readonly items = input<StudioAiPlanListItemDto[]>([]);
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  readonly busy = input(false);

  /** Plan `Pending` à rouvrir dans l'atelier. */
  readonly open = output<StudioAiPlanListItemDto>();
  /** Plan `replayable` à rejouer (`POST {id}/replay`). */
  readonly replay = output<StudioAiPlanListItemDto>();

  protected readonly labels = STUDIO_AI_LABELS.rail;

  protected kind(plan: StudioAiPlanListItemDto): string { return planKindLabel(plan.kind); }
  protected status(plan: StudioAiPlanListItemDto): string { return planStatusLabel(plan.status); }
  protected severity(plan: StudioAiPlanListItemDto) { return planStatusSeverity(plan.status); }
  protected when(plan: StudioAiPlanListItemDto): string { return relativeTime(plan.createdAt); }

  /** `Genre · date` puis `· N rel. · N vues` quand ces compteurs sont > 0. */
  protected meta(plan: StudioAiPlanListItemDto): string {
    const parts = [this.kind(plan), this.when(plan)];
    if ((plan.relationCount ?? 0) > 0) parts.push(formatLabel(this.labels.relationsShort, { count: plan.relationCount! }));
    if ((plan.viewCount ?? 0) > 0) parts.push(formatLabel(this.labels.viewsShort, { count: plan.viewCount! }));
    return parts.join(' · ');
  }
}
