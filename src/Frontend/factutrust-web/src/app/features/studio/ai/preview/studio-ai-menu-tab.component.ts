import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { STUDIO_AI_LABELS } from '../studio-ai-labels';
import { StudioSystemSpec } from '../studio-ai.models';

/**
 * Onglet « Menu » (lecture, P1a) : montre à quoi ressemblera l'entrée Studio de la barre latérale
 * une fois le système intégré (nom + icône du système, une ligne par table au pluriel).
 *
 * L'édition du nom / de l'icône / des étapes d'accueil arrive en P1b (`editable`).
 */
@Component({
  selector: 'app-studio-ai-menu-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './studio-ai-preview.scss',
  template: `
    <div class="sai-block">
      <div class="sai-block__head">{{ labels.menuTitle }}</div>
      <p class="sai-hint">{{ labels.menuHint }}</p>
    </div>

    <div class="sai-panel sai-body">
      <ul class="sai-list">
        <li>
          <div class="sai-list__item sai-list__item--static sai-list__item--active">
            <i [class]="systemIcon()" aria-hidden="true"></i>
            <span>{{ spec().system.displayName }}</span>
          </div>
        </li>
        @for (entity of spec().entities; track entity.ref) {
          <li>
            <div class="sai-list__item sai-list__item--static" style="padding-inline-start: 1.75rem">
              <i [class]="entity.icon || 'fa-solid fa-table'" aria-hidden="true"></i>
              <span>{{ entity.displayNamePlural || entity.displayName }}</span>
            </div>
          </li>
        }
      </ul>
      @if (!spec().entities.length) {
        <p class="sai-hint">{{ labels.noEntities }}</p>
      }
    </div>

    @if (onboarding().length) {
      <div class="sai-block" style="margin-top: var(--spacing-4, 1rem)">
        <div class="sai-block__head">{{ labels.onboarding }}</div>
        <ol class="sai-hint">
          @for (step of onboarding(); track step) {
            <li>{{ step }}</li>
          }
        </ol>
      </div>
    }
  `
})
export class StudioAiMenuTabComponent {
  readonly spec = input.required<StudioSystemSpec>();
  /** Réservé à P1b : l'onglet reste en lecture seule en P1a. */
  readonly editable = input(false);

  readonly labels = STUDIO_AI_LABELS.preview;
  readonly systemIcon = computed(() => this.spec().system.icon || 'fa-solid fa-cubes');
  readonly onboarding = computed(() => this.spec().system.onboarding ?? []);
}
