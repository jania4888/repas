import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

/** Onglet de la fiche d'un enregistrement (2.5e) ; `badge` optionnel (compteur). */
export interface StudioRecordTab {
  key: string;
  label: string;
  badge?: number | null;
  /** 4.7 « v1.1 » (ap-f) : onglet désactivé (ex. « Déléguées » — Bientôt) ; `title` = infobulle. */
  disabled?: boolean | null;
  title?: string | null;
}

/**
 * Barre d'onglets de la fiche enregistrement (N8 : Fiche / Liés / [Workflows en 4.4h]).
 * Contrat consommé par 4.4h : `<app-studio-record-tabs [tabs]="[{key:'form',label:'Fiche'},…]"
 * [(active)]="activeTab" />`. Clavier ←/→ entre onglets (roving focus), `role="tablist"/"tab"`.
 */
@Component({
  selector: 'app-studio-record-tabs',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="studio-tabs" role="tablist" [attr.aria-label]="ariaLabel()">
      @for (tab of tabs(); track tab.key; let i = $index) {
        <button type="button" class="studio-tab" role="tab" [id]="'studio-tab-' + tab.key"
          [attr.aria-selected]="active() === tab.key" [attr.tabindex]="active() === tab.key ? 0 : -1"
          [disabled]="tab.disabled ?? false" [attr.title]="tab.title ?? null"
          [attr.data-testid]="'studio-tab-' + tab.key"
          (click)="select(tab.key)" (keydown)="onKeydown($event, i)">
          {{ tab.label }}
          @if (tab.badge !== undefined && tab.badge !== null) {
            <span class="studio-tab__badge">{{ tab.badge }}</span>
          }
        </button>
      }
    </div>
  `,
  styles: [`
    .studio-tabs {
      display: flex;
      gap: var(--spacing-1);
      border-bottom: 1px solid var(--color-border-subtle, #e2e8f0);
      margin-bottom: var(--spacing-4);
    }
    .studio-tab {
      appearance: none;
      border: 0;
      border-bottom: 2px solid transparent;
      background: transparent;
      padding: var(--spacing-2) var(--spacing-3);
      font: inherit;
      font-weight: var(--font-weight-medium, 500);
      color: var(--color-neutral-500);
      cursor: pointer;
    }
    .studio-tab[aria-selected='true'] {
      color: var(--color-primary-700, #1d4ed8);
      border-bottom-color: var(--color-primary-600, #2563eb);
    }
    .studio-tab:focus-visible { outline: 2px solid var(--color-primary-500, #3b82f6); outline-offset: -2px; }
    .studio-tab:disabled { opacity: .55; cursor: not-allowed; }
    .studio-tab__badge {
      display: inline-block;
      margin-left: var(--spacing-1);
      padding: 0 var(--spacing-1);
      border-radius: var(--radius-full, 999px);
      background: var(--color-primary-50, #eff6ff);
      color: var(--color-primary-700, #1d4ed8);
      font-size: var(--font-size-xs);
    }
  `]
})
export class StudioRecordTabsComponent {
  readonly tabs = input.required<StudioRecordTab[]>();
  readonly active = model<string>('form');
  /** 4.7 « v1.1 » (ap-f) : aria-label du tablist paramétrable (défaut = valeur historique). */
  readonly ariaLabel = input<string>('Fiche enregistrement');

  select(key: string): void {
    if (this.tabs().find(t => t.key === key)?.disabled) return;   // onglet désactivé (« Bientôt »)
    this.active.set(key);
  }

  onKeydown(event: KeyboardEvent, index: number): void {
    const tabs = this.tabs();
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    if (next === null || !tabs[next]) return;
    event.preventDefault();
    if (!tabs[next].disabled) this.select(tabs[next].key);
    const host = (event.target as HTMLElement | null)?.closest?.('.studio-tabs');
    (host?.querySelectorAll<HTMLElement>('[role="tab"]')[next])?.focus();
  }
}
