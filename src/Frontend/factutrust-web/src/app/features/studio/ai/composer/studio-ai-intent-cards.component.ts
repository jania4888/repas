import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';
import { STUDIO_AI_LABELS, StudioAiIntentCardDef } from '../studio-ai-labels';
import { StudioAiCapabilitiesDto, StudioAiIntent } from '../studio-ai.models';

/**
 * Capacité serveur requise par chaque intention (plan P1 §4.2). Une carte dont la capacité est
 * `false` reste VISIBLE mais désactivée : l'utilisateur comprend que la fonction existe et qu'elle
 * a été coupée par l'administrateur, au lieu de voir la carte disparaître sans explication.
 */
const CAPABILITY_BY_INTENT: Partial<Record<StudioAiIntent, keyof StudioAiCapabilitiesDto>> = {
  system: 'systemGenerationEnabled',
  relations: 'modifyToolsEnabled',
  form: 'modifyToolsEnabled',
  reference_data: 'modifyToolsEnabled',
  report: 'reportToolsEnabled'
};

/** Carte prête à rendre : définition + raison éventuelle de la désactivation. */
export interface StudioAiIntentCardView {
  def: StudioAiIntentCardDef;
  /** `true` ⇒ clic sans effet (phase ultérieure ou capacité coupée). */
  disabled: boolean;
  /** Badge « Bientôt » (uniquement pour les intentions non encore livrées). */
  soon: boolean;
  tooltip: string;
}

/**
 * Grille « Que voulez-vous créer ? » : les 8 intentions de `STUDIO_AI_LABELS.intents`.
 *
 * Le composant est purement présentiel : cliquer une carte n'envoie RIEN, il émet `pick` pour que
 * la page préremplisse le composer et y place le focus (§4.2). La carte Workflow s'active quand le
 * serveur expose `workflowToolsEnabled` (PR 4.x) ; Page reste « Bientôt ». Une carte non livrée est
 * désactivée avec un badge plutôt qu'absente, pour que la feuille de route soit lisible sans documentation.
 */
@Component({
  selector: 'app-studio-ai-intent-cards',
  standalone: true,
  imports: [TooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="sai-cards" [attr.aria-label]="labels.page.whatToCreate">
      <h3 class="sai-cards__title">{{ labels.page.whatToCreate }}</h3>
      <div class="sai-cards__grid">
        @for (card of cards(); track card.def.intent) {
          <div class="sai-cards__cell" [pTooltip]="card.tooltip" tooltipPosition="top">
            <button
              type="button"
              class="sai-card"
              [class.sai-card--off]="card.disabled"
              [attr.data-intent]="card.def.intent"
              [disabled]="card.disabled || disabled()"
              (click)="pick.emit(card.def)">
              <span class="sai-card__icon"><i [class]="card.def.icon" aria-hidden="true"></i></span>
              <span class="sai-card__body">
                <span class="sai-card__title">
                  {{ card.def.title }}
                  @if (card.soon) {
                    <span class="sai-card__badge">{{ labels.soon }}</span>
                  }
                </span>
                <span class="sai-card__desc">{{ card.def.description }}</span>
              </span>
            </button>
          </div>
        }
      </div>
    </section>
  `,
  styles: [`
    .sai-cards { display: flex; flex-direction: column; gap: var(--spacing-3); }
    .sai-cards__title {
      margin: 0;
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-neutral-700);
    }
    /* 4 colonnes ≥ 1280 px, 2 en tablette, 1 en mobile (plan §11). */
    .sai-cards__grid { display: grid; gap: var(--spacing-3); grid-template-columns: repeat(4, minmax(0, 1fr)); }
    @media (max-width: 1279px) { .sai-cards__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 899px) { .sai-cards__grid { grid-template-columns: 1fr; } }
    .sai-cards__cell { display: block; }
    .sai-card {
      display: flex;
      gap: var(--spacing-3);
      width: 100%;
      height: 100%;
      text-align: start;
      align-items: flex-start;
      padding: var(--spacing-3);
      border: 1px solid var(--color-border-subtle, #e2e8f0);
      border-radius: var(--radius-lg);
      background: var(--color-background-elevated, #fff);
      cursor: pointer;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .sai-card:hover:not(:disabled) {
      border-color: var(--color-primary-600);
      box-shadow: 0 2px 8px rgb(15 23 42 / 8%);
    }
    .sai-card:disabled { cursor: not-allowed; opacity: 0.6; }
    .sai-card__icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 2.25rem;
      height: 2.25rem;
      flex: 0 0 auto;
      border-radius: var(--radius-md, 8px);
      background: var(--color-primary-50, #eef2ff);
      color: var(--color-primary-600);
    }
    .sai-card__body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .sai-card__title {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-neutral-800, #1e293b);
    }
    .sai-card__badge {
      font-size: 0.6875rem;
      font-weight: var(--font-weight-medium);
      padding: 1px var(--spacing-2);
      border-radius: 999px;
      background: var(--color-neutral-100, #f1f5f9);
      color: var(--color-neutral-500);
    }
    .sai-card__desc { font-size: var(--font-size-sm); color: var(--color-neutral-500); }
  `]
})
export class StudioAiIntentCardsComponent {
  /** Capacités serveur ; `null` ⇒ aucune restriction connue (les cartes ne dépendent que de `available`). */
  readonly capabilities = input<StudioAiCapabilitiesDto | null>(null);
  /** Désactive toutes les cartes (génération en cours). */
  readonly disabled = input(false);

  /** Intention choisie : la page prérempli le composer, elle n'envoie pas la demande. */
  readonly pick = output<StudioAiIntentCardDef>();

  protected readonly labels = STUDIO_AI_LABELS;

  protected readonly cards = computed<StudioAiIntentCardView[]>(() => {
    const caps = this.capabilities();
    return STUDIO_AI_LABELS.intents.map(def => this.toView(def, caps));
  });

  private toView(base: StudioAiIntentCardDef, caps: StudioAiCapabilitiesDto | null): StudioAiIntentCardView {
    // Workflow : livrée par le serveur (capability), pas par une version du client.
    const def: StudioAiIntentCardDef = base.intent === 'workflow' && caps?.workflowToolsEnabled
      ? { ...base, available: true, prompt: base.prompt || STUDIO_AI_LABELS.workflowPrompt }
      : base;
    if (!def.available) {
      return { def, disabled: true, soon: true, tooltip: def.soonTooltip ?? STUDIO_AI_LABELS.soon };
    }
    if (caps && !caps.workbenchEnabled) {
      return { def, disabled: true, soon: false, tooltip: STUDIO_AI_LABELS.capabilities.workbenchRequired };
    }
    const flag = CAPABILITY_BY_INTENT[def.intent];
    if (caps && flag && caps[flag] === false) {
      return { def, disabled: true, soon: false, tooltip: STUDIO_AI_LABELS.disabledByAdmin };
    }
    return { def, disabled: false, soon: false, tooltip: '' };
  }
}
