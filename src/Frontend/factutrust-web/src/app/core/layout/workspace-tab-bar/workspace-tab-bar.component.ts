import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { WorkspacePane } from '@features/ai-assistant/services/ai-assistant-shell.service';

@Component({
  selector: 'app-workspace-tab-bar',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="workspace-tab-bar" role="tablist" aria-label="Onglets de travail" i18n-aria-label="@@core.layout.workspace-tab-bar.workspace-tab-bar.onglets.de.travail.56b70fa7">
      <button
        type="button"
        class="workspace-tab"
        role="tab"
        id="workspace-tab-work"
        aria-controls="workspace-panel-work"
        [attr.aria-selected]="activePane() === 'work'"
        [class.workspace-tab--active]="activePane() === 'work'"
        (click)="selectPane.emit('work')">
        <span class="workspace-tab__label">{{ workTitle() }}</span>
      </button>

      <div
        class="workspace-tab-group workspace-tab-group--ai"
        [class.workspace-tab-group--active]="activePane() === 'ai'">
        <button
          type="button"
          class="workspace-tab workspace-tab--ai"
          role="tab"
          id="workspace-tab-ai"
          aria-controls="workspace-panel-ai"
          [attr.aria-selected]="activePane() === 'ai'"
          (click)="selectPane.emit('ai')">
          <span class="workspace-tab__label">{{ aiTitle() }}</span>
        </button>
        <button
          type="button"
          class="workspace-tab__close"
          aria-label="Fermer l'assistant IA" i18n-aria-label="@@core.layout.workspace-tab-bar.workspace-tab-bar.fermer.l.assistant.ia.bd647d76"
          (click)="onCloseAi($event)">
          <i class="fa-solid fa-xmark" aria-hidden="true"></i>
        </button>
      </div>
    </div>
  `,
  styles: [`
    .workspace-tab-bar {
      display: flex;
      align-items: stretch;
      gap: 2px;
      padding: 0 var(--shell-content-padding-inline, var(--spacing-4));
      background: var(--color-neutral-100, #f3f4f6);
      border-bottom: 1px solid var(--color-border-subtle, #e5e7eb);
      overflow-x: auto;
      flex-shrink: 0;
    }

    .workspace-tab,
    .workspace-tab-group {
      display: inline-flex;
      align-items: center;
      min-height: 2.5rem;
      border-radius: var(--radius-md) var(--radius-md) 0 0;
    }

    .workspace-tab-group {
      gap: 0;
      border-bottom: 2px solid transparent;
    }

    .workspace-tab-group--active {
      background: #fff;
      border-bottom-color: var(--color-primary-500, #3b82f6);
    }

    .workspace-tab {
      gap: var(--spacing-2);
      padding: 0 var(--spacing-4);
      margin: 0;
      border: none;
      border-bottom: 2px solid transparent;
      background: transparent;
      color: var(--color-text-secondary);
      font-size: var(--font-size-sm, 0.875rem);
      font-weight: var(--font-weight-medium);
      cursor: pointer;
      white-space: nowrap;
      transition: color var(--transition-fast), background-color var(--transition-fast), border-color var(--transition-fast);
    }

    .workspace-tab:hover:not(.workspace-tab-group--active .workspace-tab--ai) {
      background: var(--color-background-hover, rgba(0, 0, 0, 0.04));
      color: var(--color-text-primary);
    }

    .workspace-tab--active,
    .workspace-tab-group--active .workspace-tab--ai {
      background: #fff;
      color: var(--color-primary-700, #1d4ed8);
      font-weight: var(--font-weight-semibold);
    }

    .workspace-tab--active {
      border-bottom-color: var(--color-primary-500, #3b82f6);
    }

    .workspace-tab:focus-visible,
    .workspace-tab__close:focus-visible {
      outline: 2px solid var(--color-primary-500);
      outline-offset: -2px;
    }

    .workspace-tab__label {
      max-width: 16rem;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .workspace-tab__close {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      width: 1.75rem;
      min-width: 1.75rem;
      height: 1.75rem;
      min-height: 1.75rem;
      padding: 0;
      margin-inline-end: var(--spacing-1);
      border: none;
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--color-text-secondary);
      opacity: 0.9;
      cursor: pointer;
    }

    .workspace-tab__close:hover {
      opacity: 1;
      background: var(--color-background-hover, rgba(0, 0, 0, 0.06));
    }
  `]
})
export class WorkspaceTabBarComponent {
  readonly workTitle = input($localize`:@@core.workspace-tab-bar.ts.accueil.a8ff8fd2:Accueil`);
  readonly aiTitle = input($localize`:@@core.workspace-tab-bar.ts.assistant.ia.94f6f208:Assistant IA`);
  readonly activePane = input<WorkspacePane>('work');

  readonly selectPane = output<WorkspacePane>();
  readonly closeAi = output<void>();

  onCloseAi(event: Event): void {
    event.stopPropagation();
    this.closeAi.emit();
  }
}
