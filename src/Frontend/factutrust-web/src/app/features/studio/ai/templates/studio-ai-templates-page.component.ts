import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { SkeletonModule } from 'primeng/skeleton';
import { TagModule } from 'primeng/tag';
import { StudioAiBuildService } from '../../studio-ai-build.service';
import { StudioPageShellComponent } from '../../shared/studio-page-shell.component';
import { studioBreadcrumb } from '../../shared/studio-breadcrumb.util';
import { StudioAiCapabilitiesService } from '../studio-ai-capabilities.service';
import { STUDIO_AI_LABELS, formatLabel } from '../studio-ai-labels';
import { StudioTemplateListItemDto, normalizeViewMode } from '../studio-ai.models';

export interface StudioTemplateGroup {
  category: string;
  templates: StudioTemplateListItemDto[];
}

/** Regroupe par `category` (ordre d'apparition, « Autres » pour les modèles sans catégorie). */
export function groupTemplates(templates: readonly StudioTemplateListItemDto[]): StudioTemplateGroup[] {
  const groups = new Map<string, StudioTemplateListItemDto[]>();
  for (const template of templates) {
    const category = template.category?.trim() || STUDIO_AI_LABELS.templates.uncategorized;
    const bucket = groups.get(category);
    if (bucket) bucket.push(template);
    else groups.set(category, [template]);
  }
  return [...groups.entries()].map(([category, list]) => ({ category, templates: list }));
}

/**
 * « Bibliothèque de modèles » (`/studio/ai/templates`) : le catalogue `GET api/studio/templates`
 * en cartes groupées par catégorie. « Utiliser ce modèle » renvoie vers l'atelier avec
 * `?template=<key>` : c'est l'atelier qui appelle `createFromTemplate` et affiche la proposition.
 */
@Component({
  selector: 'app-studio-ai-templates-page',
  standalone: true,
  imports: [RouterLink, ButtonModule, SkeletonModule, TagModule, StudioPageShellComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-studio-page-shell [title]="labels.title" [subtitle]="labels.subtitle" [breadcrumbs]="breadcrumbs">
      <a
        studioActions
        pButton
        [label]="labels.backToStudio"
        icon="fa-solid fa-wand-magic-sparkles"
        severity="secondary"
        [outlined]="true"
        size="small"
        routerLink="/studio/ai"></a>

      @if (disabled()) {
        <div class="sat__notice" role="status" data-testid="templates-disabled">
          <i class="fa-solid fa-lock" aria-hidden="true"></i>
          <span>{{ labels.disabled }}</span>
        </div>
      } @else if (error()) {
        <div class="sat__notice sat__notice--error" role="alert">
          <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
          <span>{{ error() }}</span>
          <p-button [label]="retryLabel" [link]="true" size="small" (onClick)="load()" />
        </div>
      } @else if (loading()) {
        <div class="sat__grid" aria-busy="true">
          @for (i of [1, 2, 3, 4, 5, 6]; track i) {
            <p-skeleton height="9rem" borderRadius="12px" />
          }
        </div>
      } @else if (!groups().length) {
        <p class="sat__empty" data-testid="templates-empty">{{ labels.empty }}</p>
      } @else {
        @for (group of groups(); track group.category) {
          <section class="sat__group" [attr.data-category]="group.category">
            <h2 class="sat__group-title">{{ group.category }}</h2>
            <div class="sat__grid">
              @for (template of group.templates; track template.key) {
                <article class="sat__card" [attr.data-template-key]="template.key">
                  <header class="sat__card-head">
                    <h3 class="sat__card-title">{{ template.displayName }}</h3>
                    <p-tag
                      [value]="template.source === 'builtin' ? labels.sourceBuiltin : labels.sourceTenant"
                      [severity]="template.source === 'builtin' ? 'secondary' : 'info'" />
                    @if (template.moduleTag) {
                      <p-tag class="sat__module" [value]="template.moduleTag" severity="secondary" />
                    }
                  </header>
                  <p class="sat__card-desc">{{ template.description }}</p>
                  <footer class="sat__card-foot">
                    <span class="sat__card-meta">
                      <span>{{ entitiesText(template) }}</span>
                      @if (relationsText(template); as relations) {
                        <span class="sat__card-relations">{{ relations }}</span>
                      }
                      @if (viewModesText(template); as views) {
                        <span class="sat__card-views">{{ views }}</span>
                      }
                    </span>
                    <a
                      pButton
                      class="sat__use"
                      [label]="labels.use"
                      icon="fa-solid fa-wand-magic-sparkles"
                      size="small"
                      [routerLink]="['/studio/ai']"
                      [queryParams]="{ template: template.key }"></a>
                  </footer>
                </article>
              }
            </div>
          </section>
        }
      }
    </app-studio-page-shell>
  `,
  styles: [`
    :host { display: block; }
    .sat__group { margin-bottom: 1.5rem; }
    .sat__group-title {
      margin: 0 0 0.75rem; font-size: 0.8125rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
      color: var(--color-neutral-500, #6b7280);
    }
    .sat__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr)); gap: 1rem; }
    .sat__card {
      display: flex; flex-direction: column; gap: 0.5rem; padding: 1rem;
      background: var(--color-surface, #fff); border: 1px solid var(--color-neutral-200, #e5e7eb); border-radius: var(--radius-lg, 12px);
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .sat__card:hover { border-color: var(--color-primary-300, #a5b4fc); box-shadow: 0 4px 12px rgba(79, 70, 229, 0.08); }
    .sat__card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; }
    .sat__card-head .sat__card-title { flex: 1 1 auto; }
    .sat__card-title { margin: 0; font-size: 1rem; font-weight: 600; color: var(--color-neutral-900, #111827); }
    .sat__card-desc { margin: 0; flex: 1 1 auto; font-size: 0.875rem; color: var(--color-neutral-600, #4b5563); }
    .sat__card-foot { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
    .sat__card-meta { display: flex; flex-wrap: wrap; gap: 0.25rem 0.75rem; font-size: 0.8125rem; color: var(--color-neutral-500, #6b7280); }
    .sat__use { text-decoration: none; }
    .sat__empty { padding: 2rem 1rem; text-align: center; color: var(--color-neutral-500, #6b7280); }
    .sat__notice {
      display: flex; align-items: center; gap: 0.5rem; padding: 0.75rem 1rem; border-radius: 8px;
      background: var(--color-primary-50, #eef2ff); color: var(--color-primary-700, #4338ca); font-size: 0.875rem;
    }
    .sat__notice span { flex: 1 1 auto; }
    .sat__notice--error { background: var(--color-danger-50, #fef2f2); color: var(--color-danger-700, #b91c1c); }
  `]
})
export class StudioAiTemplatesPageComponent {
  private readonly builds = inject(StudioAiBuildService);
  private readonly capabilities = inject(StudioAiCapabilitiesService);

  readonly labels = STUDIO_AI_LABELS.templates;
  readonly retryLabel = STUDIO_AI_LABELS.conversation.retry;
  readonly viewLabels = STUDIO_AI_LABELS.views;
  readonly breadcrumbs = studioBreadcrumb({ label: 'Assistant IA', route: '/studio/ai' }, { label: STUDIO_AI_LABELS.templates.title });

  readonly templates = signal<StudioTemplateListItemDto[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly groups = computed(() => groupTemplates(this.templates()));
  /** Capabilities chargées et bibliothèque coupée par l'administrateur. */
  readonly disabled = computed(() => this.capabilities.state() === 'ready' && !this.capabilities.capabilities().templatesEnabled);

  constructor() {
    this.capabilities.ensureLoaded();
    this.load();
  }

  entitiesText(template: StudioTemplateListItemDto): string {
    return formatLabel(this.labels.entities, { count: template.entityCount ?? 0 });
  }

  /** « {n} relation(s) » ; chaîne vide quand `relationCount` est absent ou nul (mention masquée). */
  relationsText(template: StudioTemplateListItemDto): string {
    const count = template.relationCount ?? 0;
    return count > 0 ? formatLabel(this.labels.relations, { count }) : '';
  }

  /** Modes de vue normalisés (`normalizeViewMode`), dédoublonnés, traduits et joints par « · » — D19. */
  viewModesText(template: StudioTemplateListItemDto): string {
    const modes = Array.from(new Set((template.viewModes ?? []).map(normalizeViewMode)));
    return modes.map(mode => this.viewLabels[mode]).join(' · ');
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.builds.listTemplates().subscribe({
      next: res => {
        this.templates.set(res?.success && Array.isArray(res.data) ? res.data : []);
        this.loading.set(false);
      },
      error: () => {
        this.templates.set([]);
        this.loading.set(false);
        this.error.set(this.labels.loadFailed);
      }
    });
  }
}
