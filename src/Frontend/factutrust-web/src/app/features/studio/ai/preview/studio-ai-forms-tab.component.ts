import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { STUDIO_AI_LABELS } from '../studio-ai-labels';
import { StudioSpecEntity, StudioSpecFormSection, StudioSystemSpec } from '../studio-ai.models';

/** Section aplatie pour l'affichage : chaque champ porte déjà son libellé et sa largeur. */
interface StudioAiFormSectionView {
  title: string;
  fields: { key: string; label: string; half: boolean }[];
}

/**
 * Onglet « Formulaires » (lecture, P1a) : pour chaque table, les sections du formulaire proposé et
 * la largeur de chaque champ (pleine largeur ou demi-largeur), rendues dans une grille 2 colonnes.
 *
 * Une table sans `form` affichera une mise en page par défaut à l'intégration : on l'indique au lieu
 * de laisser un blanc. L'aperçu à l'exécution (`app-dynamic-form`) et le glisser-déposer sont P1b.
 */
@Component({
  selector: 'app-studio-ai-forms-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './studio-ai-preview.scss',
  template: `
    @if (!spec().entities.length) {
      <p class="sai-hint">{{ labels.noEntities }}</p>
    } @else {
      @if (!hasAnyForm()) {
        <p class="sai-hint">{{ labels.noForms }}</p>
      }
      @for (entity of spec().entities; track entity.ref) {
        <div class="sai-block">
          <div class="sai-block__head">
            <i [class]="entity.icon || 'fa-solid fa-file-lines'" aria-hidden="true"></i>
            <span>{{ entity.displayName }}</span>
          </div>
          @if (sectionsOf(entity); as sections) {
            @if (!sections.length) {
              <p class="sai-hint">{{ labels.defaultForm }}</p>
            } @else {
              @for (section of sections; track section.title) {
                <div class="sai-panel sai-body" style="margin-bottom: var(--spacing-2, 0.5rem)">
                  <p class="sai-hint" style="margin-bottom: var(--spacing-2, 0.5rem)">{{ section.title }}</p>
                  <div class="sai-form-grid">
                    @for (field of section.fields; track field.key) {
                      <div
                        class="sai-form-grid__cell sai-field-box"
                        [class.sai-form-grid__cell--half]="field.half">
                        {{ field.label }}
                        <span class="sai-code" style="display: block">{{ field.key }}</span>
                      </div>
                    }
                  </div>
                </div>
              }
            }
          }
        </div>
      }
    }
  `
})
export class StudioAiFormsTabComponent {
  readonly spec = input.required<StudioSystemSpec>();
  /** Réservé à P1b : l'onglet reste en lecture seule en P1a. */
  readonly editable = input(false);

  readonly labels = STUDIO_AI_LABELS.preview;

  readonly hasAnyForm = computed(() => this.spec().entities.some(e => !!e.form?.sections?.length));

  sectionsOf(entity: StudioSpecEntity): StudioAiFormSectionView[] {
    const sections = entity.form?.sections ?? [];
    return sections.map((section, index) => this.toView(entity, section, index));
  }

  private toView(entity: StudioSpecEntity, section: StudioSpecFormSection, index: number): StudioAiFormSectionView {
    return {
      title: section.title?.trim() || $localize`:@@studio.studio-ai-forms-tab.ts.section.p.1dbbb668:Section ${index + 1}:p:`,
      fields: (section.fields ?? []).map(ref => ({
        key: ref.field,
        label: ref.label || entity.fields.find(f => f.key === ref.field)?.label || ref.field,
        half: ref.width === 'half'
      }))
    };
  }
}
