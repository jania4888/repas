import { ChangeDetectionStrategy, Component, ElementRef, computed, input, output, signal, viewChildren } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SelectModule } from 'primeng/select';
import { CustomRecordViewDto } from './studio-record-views.models';

interface ViewSwitcherOption {
  id: string | null;
  label: string;
  isDefault: boolean;
}

/**
 * Sélecteur « Liste / vues enregistrées » de la page Données (2.5a) : onglets tant qu'il y a ≤ 6
 * vues enregistrées (maquette `studio-runtime-vues-kanban.html`), bascule sur `p-select
 * panelStyleClass="studio-theme"` au-delà pour rester lisible. La vue par défaut porte une étoile.
 *
 * Onglets : patron ARIA « tabs » (activation automatique) — `tabindex` roulant (un seul onglet à 0,
 * les autres à -1), navigation clavier `ArrowLeft`/`ArrowRight` (circulaire) et `Home`/`End`, chaque
 * onglet référence via `aria-controls` le panneau `role="tabpanel"` rendu par le parent
 * (`studio-record-list.component.ts`, id `studio-view-panel` par défaut).
 */
@Component({
  selector: 'app-studio-view-switcher',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, SelectModule],
  template: `
    @if (views().length > 6) {
      <p-select
        [options]="options()"
        optionLabel="label"
        optionValue="id"
        [ngModel]="activeId()"
        (ngModelChange)="select($event)"
        appendTo="body"
        panelStyleClass="studio-theme"
        styleClass="view-switcher-select"
        [ariaLabel]="'Vue active'">
        <ng-template let-opt pTemplate="selectedItem">
          <span class="view-switcher__mode">{{ opt.label }}</span>
          @if (opt.isDefault) {
            <span class="view-switcher__star" title="Vue par défaut"><i class="fa-solid fa-star"></i></span>
          }
        </ng-template>
        <ng-template let-opt pTemplate="item">
          <span>{{ opt.label }}</span>
          @if (opt.isDefault) {
            <span class="view-switcher__star" title="Vue par défaut"><i class="fa-solid fa-star"></i></span>
          }
        </ng-template>
      </p-select>
    } @else {
      <div class="view-switcher" role="tablist" aria-label="Vue active">
        @for (opt of options(); track opt.id ?? 'list'; let i = $index) {
          <button
            #tabButton
            type="button"
            role="tab"
            class="view-switcher__tab"
            [attr.aria-selected]="activeId() === opt.id"
            [attr.aria-controls]="panelId()"
            [attr.tabindex]="tabIndexFor(opt.id, i)"
            (click)="onTabClick(opt.id, i)"
            (keydown)="onKeydown($event, i)">
            <span>{{ opt.label }}</span>
            @if (opt.isDefault) {
              <span class="view-switcher__star" title="Vue par défaut"><i class="fa-solid fa-star"></i></span>
            }
          </button>
        }
      </div>
    }
  `,
  styles: [`
    .view-switcher {
      display: flex;
      flex-wrap: wrap;
      gap: var(--spacing-1, 0.25rem);
      margin-bottom: var(--spacing-4);
      border-bottom: 1px solid var(--color-border-subtle, #e2e8f0);
    }

    .view-switcher__tab {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-1, 0.25rem);
      border: none;
      background: transparent;
      padding: var(--spacing-2) var(--spacing-3);
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      color: var(--color-neutral-600);
      cursor: pointer;
      border-bottom: 2px solid transparent;

      &:hover { color: var(--color-primary-600); }

      &[aria-selected='true'] {
        color: var(--color-primary-700);
        border-bottom-color: var(--color-primary-600);
      }
    }

    .view-switcher__star {
      color: var(--color-warning-500, #f59e0b);
      font-size: var(--font-size-xs);
    }

    .view-switcher__mode { margin-right: var(--spacing-1, 0.25rem); }

    .view-switcher-select { min-width: 14rem; }
  `]
})
export class StudioViewSwitcherComponent {
  readonly views = input<CustomRecordViewDto[]>([]);
  /** `null` = vue « Liste » brute (comportement historique, capabilities off ou aucune vue). */
  readonly activeId = input<string | null>(null);
  /** id du panneau `role="tabpanel"` contrôlé par ces onglets (voir `studio-record-list.component.ts`). */
  readonly panelId = input('studio-view-panel');
  readonly activeIdChange = output<string | null>();

  private readonly tabButtons = viewChildren<ElementRef<HTMLButtonElement>>('tabButton');
  /** Onglet ayant le focus clavier courant (patron ARIA tabs, tabindex roulant). `null` = suit `activeId`. */
  private readonly focusedIndex = signal<number | null>(null);

  protected readonly options = computed<ViewSwitcherOption[]>(() => [
    { id: null, label: 'Liste', isDefault: false },
    ...this.views().map(v => ({ id: v.id, label: v.displayName, isDefault: v.isDefault }))
  ]);

  tabIndexFor(id: string | null, index: number): number {
    const opts = this.options();
    const focused = this.focusedIndex();
    const reference = focused !== null && focused < opts.length ? opts[focused].id : this.activeId();
    return id === reference ? 0 : -1;
  }

  onTabClick(id: string | null, index: number): void {
    this.focusedIndex.set(index);
    this.select(id);
  }

  /** Navigation clavier ARIA tabs : `ArrowLeft`/`ArrowRight` circulaire, `Home`/`End`, activation automatique. */
  onKeydown(event: KeyboardEvent, index: number): void {
    const opts = this.options();
    let next = index;
    switch (event.key) {
      case 'ArrowRight': next = (index + 1) % opts.length; break;
      case 'ArrowLeft': next = (index - 1 + opts.length) % opts.length; break;
      case 'Home': next = 0; break;
      case 'End': next = opts.length - 1; break;
      default: return;
    }
    event.preventDefault();
    this.focusedIndex.set(next);
    this.select(opts[next].id);
    this.tabButtons()[next]?.nativeElement.focus();
  }

  select(id: string | null): void {
    if (id === this.activeId()) return;
    this.activeIdChange.emit(id);
  }
}
