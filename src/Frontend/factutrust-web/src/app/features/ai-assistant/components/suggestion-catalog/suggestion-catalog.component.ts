import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  EventEmitter,
  input,
  Output,
  signal,
  ViewChild
} from '@angular/core';
import { AgentSuggestionCategory } from '../../config/agent-scopes.config';

@Component({
  selector: 'app-suggestion-catalog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="suggestion-catalog">
      <div
        #tabList
        class="suggestion-catalog-tabs"
        role="tablist"
        aria-label="Thèmes de questions" i18n-aria-label="@@ai-assistant.components.themes.de.questions.5cfda301"
        (keydown)="onKeydown($event)">
        @for (cat of categories(); track cat.id) {
          <button
            type="button"
            role="tab"
            class="suggestion-catalog-tab"
            [class.is-active]="cat.id === activeId()"
            [attr.aria-selected]="cat.id === activeId()"
            [attr.tabindex]="cat.id === activeId() ? 0 : -1"
            [attr.id]="'sug-tab-' + cat.id"
            [attr.aria-controls]="'sug-panel-' + cat.id"
            [attr.title]="cat.label"
            (click)="selectCategory(cat.id)">
            {{ cat.label }}
          </button>
        }
      </div>

      @if (activeCategory(); as active) {
        <div
          class="suggestions"
          role="tabpanel"
          [attr.id]="'sug-panel-' + active.id"
          [attr.aria-labelledby]="'sug-tab-' + active.id">
          @for (q of active.questions; track q) {
            <button type="button" class="suggestion-chip" (click)="questionSelected.emit(q)">
              {{ q }}
            </button>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
        max-width: 1040px;
      }

      .suggestion-catalog {
        width: 100%;
        text-align: left;
      }

      .suggestion-catalog-tabs {
        display: flex;
        flex-wrap: nowrap;
        gap: 8px;
        width: 100%;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        margin-bottom: 12px;
        border-bottom: 1px solid var(--color-neutral-200, #e5e7eb);
        scrollbar-width: thin;
      }

      .suggestion-catalog-tab {
        flex-shrink: 0;
        padding: 8px 12px;
        border: 0;
        border-bottom: 2px solid transparent;
        margin-bottom: -1px;
        background: transparent;
        font-size: 13px;
        font-weight: 600;
        font-family: inherit;
        letter-spacing: normal;
        white-space: nowrap;
        color: var(--color-neutral-500, #6b7280);
        cursor: pointer;
      }

      .suggestion-catalog-tab:hover:not(.is-active) {
        color: var(--ai-accent-600, #7c3aed);
      }

      .suggestion-catalog-tab.is-active {
        color: var(--ai-accent-600, #7c3aed);
        border-bottom-color: var(--ai-accent-500, #8b5cf6);
      }

      .suggestion-catalog-tab:focus-visible {
        outline: 2px solid var(--ai-accent-500, #8b5cf6);
        outline-offset: 2px;
      }

      .suggestions {
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: 100%;
      }

      .suggestion-chip {
        padding: 10px 14px;
        border: 1px solid var(--color-neutral-200, #e5e7eb);
        border-radius: 10px;
        background: #fff;
        text-align: left;
        font-size: 13px;
        color: var(--color-neutral-700, #374151);
        cursor: pointer;
        transition: all 0.15s;
      }

      .suggestion-chip:hover {
        border-color: var(--ai-accent-300, #c4b5fd);
        background: var(--ai-accent-50, #f5f3ff);
        color: var(--ai-accent-600, #7c3aed);
      }
    `
  ]
})
export class SuggestionCatalogComponent {
  readonly categories = input.required<readonly AgentSuggestionCategory[]>();

  @Output() readonly questionSelected = new EventEmitter<string>();

  @ViewChild('tabList') tabListRef?: ElementRef<HTMLElement>;

  readonly selectedCategoryId = signal<string | null>(null);

  readonly activeCategory = computed(() => {
    const cats = this.categories();
    const selected = this.selectedCategoryId();
    return cats.find(c => c.id === selected) ?? cats[0] ?? null;
  });

  readonly activeId = computed(() => this.activeCategory()?.id ?? null);

  selectCategory(id: string): void {
    if (id === this.activeId()) {
      return;
    }
    if (!this.categories().some(c => c.id === id)) {
      return;
    }
    this.selectedCategoryId.set(id);
    this.focusTabButton(id);
  }

  onKeydown(event: KeyboardEvent): void {
    const cats = this.categories();
    if (cats.length === 0) {
      return;
    }

    const currentId = this.activeCategory()?.id;
    const currentIndex = Math.max(
      0,
      cats.findIndex(c => c.id === currentId)
    );
    let next = currentIndex;

    switch (event.key) {
      case 'ArrowRight':
        next = (currentIndex + 1) % cats.length;
        break;
      case 'ArrowLeft':
        next = (currentIndex - 1 + cats.length) % cats.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = cats.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    this.selectCategory(cats[next].id);
  }

  private focusTabButton(id: string): void {
    const el = this.tabListRef?.nativeElement;
    if (!el) {
      return;
    }
    const button = el.querySelector<HTMLButtonElement>(`#sug-tab-${id}`);
    button?.focus();
  }
}
