import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { STUDIO_AI_LABELS } from '../studio-ai-labels';
import { StudioAiCapabilitiesDto, StudioAiPlanListItemDto, StudioTemplateListItemDto } from '../studio-ai.models';
import { StudioAiHistoryCardComponent } from './studio-ai-history-card.component';
import { StudioAiPromoCardComponent } from './studio-ai-promo-card.component';
import { StudioAiQuickActionsComponent } from './studio-ai-quick-actions.component';
import { StudioAiTemplatesCardComponent } from './studio-ai-templates-card.component';

/**
 * Rail droit de l'atelier (320 px dès 1280 px, empilé sous le contenu en dessous) : Modèles de
 * systèmes (si `templatesEnabled`), Actions rapides (toujours), Historique (si `planPreviewEnabled`),
 * carte promo. Capabilities en repli ⇒ rail réduit (actions rapides + promo).
 *
 * Présentiel : toutes les décisions remontent à la page par des sorties ; le rail ne connaît ni le
 * store ni les services.
 */
@Component({
  selector: 'app-studio-ai-rail',
  standalone: true,
  imports: [
    StudioAiTemplatesCardComponent,
    StudioAiQuickActionsComponent,
    StudioAiHistoryCardComponent,
    StudioAiPromoCardComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside class="sar" [attr.aria-label]="panelLabel">
      @if (capabilities()?.templatesEnabled) {
        <app-studio-ai-templates-card
          [templates]="templates()"
          [loading]="templatesLoading()"
          [error]="templatesError()"
          [busy]="busy()"
          (use)="useTemplate.emit($event)" />
      }

      <app-studio-ai-quick-actions
        [exportEnabled]="!!capabilities()?.systemExportEnabled"
        [busy]="busy()"
        (reset)="reset.emit()"
        (importTemplate)="importTemplate.emit()"
        (duplicate)="duplicate.emit()"
        (exportSystem)="exportSystem.emit()" />

      @if (capabilities()?.planPreviewEnabled) {
        <app-studio-ai-history-card
          [items]="history()"
          [loading]="historyLoading()"
          [error]="historyError()"
          [busy]="busy()"
          (open)="openPlan.emit($event)"
          (replay)="replayPlan.emit($event)" />
      }

      <app-studio-ai-promo-card [busy]="busy()" (tryPrompt)="tryPrompt.emit($event)" />
    </aside>
  `,
  styles: [`
    .sar { display: flex; flex-direction: column; gap: var(--spacing-4, 1rem); min-width: 0; }
  `]
})
export class StudioAiRailComponent {
  readonly capabilities = input<StudioAiCapabilitiesDto | null>(null);
  readonly templates = input<StudioTemplateListItemDto[]>([]);
  readonly templatesLoading = input(false);
  readonly templatesError = input<string | null>(null);
  readonly history = input<StudioAiPlanListItemDto[]>([]);
  readonly historyLoading = input(false);
  readonly historyError = input<string | null>(null);
  readonly busy = input(false);

  readonly useTemplate = output<string>();
  readonly reset = output<void>();
  readonly importTemplate = output<void>();
  readonly duplicate = output<void>();
  readonly exportSystem = output<void>();
  readonly openPlan = output<StudioAiPlanListItemDto>();
  readonly replayPlan = output<StudioAiPlanListItemDto>();
  readonly tryPrompt = output<string>();

  protected readonly panelLabel = STUDIO_AI_LABELS.rail.panelLabel;
}
