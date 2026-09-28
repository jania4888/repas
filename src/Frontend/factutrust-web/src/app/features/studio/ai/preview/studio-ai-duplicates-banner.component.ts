import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { STUDIO_AI_LABELS, formatLabel } from '../studio-ai-labels';
import { StudioDuplicateHint } from '../studio-ai.models';

/**
 * Bandeau « doublons probables » de l'aperçu (PR 1.3 côté serveur, R21 côté client).
 *
 * Un bloc par `StudioDuplicateHint` : « La table “Clients” existe déjà » + table existante (clé) +
 * raison du rapprochement, puis deux décisions : « Réutiliser la table existante » (le plan pose
 * `existingKey` et ne touche pas à la table) ou « Créer quand même » (libellé suffixé « (2) »).
 * Présentiel : les décisions remontent à la page/au store. Masqué quand la liste est vide.
 */
@Component({
  selector: 'app-studio-ai-duplicates-banner',
  standalone: true,
  imports: [ButtonModule, TooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (hints().length) {
      <div class="sai-dup" role="status" aria-live="polite">
        @for (hint of hints(); track hint.specRef) {
          <div class="sai-dup__item" [attr.data-spec-ref]="hint.specRef">
            <i class="fa-solid fa-triangle-exclamation sai-dup__icon" aria-hidden="true"></i>
            <div class="sai-dup__body">
              <p class="sai-dup__text">
                <strong>{{ title(hint) }}</strong>
                <span> {{ item(hint) }}</span>
                @if (reason(hint); as why) {
                  <span class="sai-dup__reason">({{ why }})</span>
                }
                <span> {{ question(hint) }}</span>
              </p>
              @if (actionsEnabled()) {
                <div class="sai-dup__actions">
                  <p-button
                    size="small"
                    icon="fa-solid fa-link"
                    [label]="labels.reuse"
                    [disabled]="busy()"
                    [pTooltip]="labels.reuseHint"
                    tooltipPosition="bottom"
                    (onClick)="reuse.emit(hint)" />
                  <p-button
                    size="small"
                    severity="secondary"
                    [outlined]="true"
                    icon="fa-solid fa-plus"
                    [label]="labels.createAnyway"
                    [disabled]="busy()"
                    (onClick)="createAnyway.emit(hint)" />
                </div>
              }
            </div>
          </div>
        }
      </div>
    }
  `,
  styles: [`
    .sai-dup {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2, 0.5rem);
      margin: var(--spacing-3, 0.75rem) var(--spacing-4, 1rem) 0;
    }
    .sai-dup__item {
      display: flex;
      align-items: flex-start;
      gap: var(--spacing-2, 0.5rem);
      padding: var(--spacing-3, 0.75rem);
      border-radius: 0.5rem;
      border: 1px solid #fde68a;
      background: #fffbeb;
      color: var(--color-neutral-700, #374151);
      font-size: var(--font-size-sm, 0.875rem);
    }
    .sai-dup__icon { color: #b45309; margin-top: 2px; flex: none; }
    .sai-dup__body { display: flex; flex-direction: column; gap: var(--spacing-2, 0.5rem); min-width: 0; }
    .sai-dup__text { margin: 0; }
    .sai-dup__reason { margin-inline-start: 0.25rem; color: var(--color-neutral-500, #6b7280); }
    .sai-dup__actions { display: flex; flex-wrap: wrap; gap: var(--spacing-2, 0.5rem); }
  `]
})
export class StudioAiDuplicatesBannerComponent {
  readonly hints = input<StudioDuplicateHint[]>([]);
  /** Boutons de décision affichés (désactivés pendant une sauvegarde / génération). */
  readonly actionsEnabled = input(true);
  readonly busy = input(false);

  readonly reuse = output<StudioDuplicateHint>();
  readonly createAnyway = output<StudioDuplicateHint>();

  protected readonly labels = STUDIO_AI_LABELS.duplicates;

  protected title(hint: StudioDuplicateHint): string {
    return formatLabel(this.labels.title, { specDisplayName: hint.specDisplayName });
  }

  protected item(hint: StudioDuplicateHint): string {
    return formatLabel(this.labels.item, { existingDisplayName: hint.existingDisplayName, existingKey: hint.existingKey });
  }

  protected question(hint: StudioDuplicateHint): string {
    return formatLabel(this.labels.question, { suggestedName: `${hint.specDisplayName} ${this.labels.suffix}` });
  }

  protected reason(hint: StudioDuplicateHint): string | null {
    return this.labels.reasons[hint.reason] ?? null;
  }
}
