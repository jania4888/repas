/// <reference types="@angular/localize" />
import { DOCUMENT } from '@angular/common';
import { Component, ElementRef, inject } from '@angular/core';
import { DeskWindow } from './desk-window.model';
import { DeskWindowService } from './desk-window.service';

@Component({
  selector: 'app-desk-shell',
  standalone: true,
  host: {
    '[class.desk-on]': 'enabled()'
  },
  template: `
    @if (enabled()) {
      <div class="desk">
        @if (active(); as window) {
          <header class="desk__titlebar">
            <h1 class="desk__title" id="desk-window-title">{{ window.title }}</h1>
            <button
              type="button"
              class="desk__chrome"
              [attr.aria-label]="minimizeLabel(window)"
              (click)="minimize(window)">
              <i class="fa-solid fa-window-minimize" aria-hidden="true"></i>
            </button>
            <button
              type="button"
              class="desk__chrome desk__chrome--close"
              [attr.aria-label]="closeLabel(window)"
              (click)="close(window)">
              <i class="fa-solid fa-xmark" aria-hidden="true"></i>
            </button>
          </header>
        }
        <div class="desk__canvas">
          <ng-content />
        </div>
        <nav
          class="desk__taskbar"
          [attr.aria-label]="taskbarLabel"
          (keydown)="onTaskbarKeydown($event)">
          @for (window of windows(); track window.key) {
            <div class="desk__task" [class.desk__task--min]="window.minimized">
              <button
                type="button"
                class="desk__task-main"
                [attr.aria-current]="isCurrent(window) ? 'true' : null"
                [attr.aria-label]="activateLabel(window)"
                (click)="activate(window)">
                {{ window.title }}
              </button>
              <button
                type="button"
                class="desk__task-close"
                [attr.aria-label]="closeLabel(window)"
                (click)="close(window)">
                <i class="fa-solid fa-xmark" aria-hidden="true"></i>
              </button>
            </div>
          }
        </nav>
      </div>
    } @else {
      <ng-content />
    }
  `,
  styles: [`
    :host { display: contents; }
    :host(.desk-on) {
      display: flex;
      flex: 1 1 auto;
      flex-direction: column;
      min-height: 0;
      min-width: 0;
    }
    .desk {
      display: flex;
      flex: 1 1 auto;
      flex-direction: column;
      min-height: 0;
      min-width: 0;
      border: 1px solid rgba(10, 31, 68, 0.16);
      border-radius: 0.5rem;
      overflow: hidden;
      background: #fff;
    }
    .desk__titlebar {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      min-height: 2.25rem;
      padding-inline: 0.75rem;
      background: var(--sidebar-delegated-navy, #0a1f44);
      color: #fff;
      border-block-end: 2px solid var(--sidebar-delegated-gold, #d4af37);
    }
    .desk__title {
      flex: 1 1 auto;
      margin: 0;
      overflow: hidden;
      font-size: 0.875rem;
      font-weight: 600;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .desk__chrome,
    .desk__task-close,
    .desk__task-main {
      border: 0;
      background: transparent;
      color: inherit;
      cursor: pointer;
    }
    .desk__chrome {
      width: 1.75rem;
      height: 1.75rem;
      border-radius: 0.25rem;
    }
    .desk__chrome:hover,
    .desk__task-close:hover { background: rgba(255, 255, 255, 0.14); }
    .desk__chrome--close:hover,
    .desk__task-close:hover { background: #b91c1c; color: #fff; }
    .desk__canvas > * {
      min-height: 100%;
    }
    .desk__taskbar {
      display: flex;
      flex: 0 0 auto;
      gap: 0.25rem;
      overflow-x: auto;
      padding: 0.25rem;
      background: var(--sidebar-delegated-navy-light, #0f2a5c);
      border-block-start: 1px solid rgba(255, 255, 255, 0.12);
    }
    .desk__task {
      display: flex;
      align-items: stretch;
      max-width: 16rem;
      border-radius: 0.25rem;
      background: rgba(255, 255, 255, 0.08);
      color: #fff;
    }
    .desk__task--min { opacity: 0.72; }
    .desk__task-main {
      overflow: hidden;
      padding: 0.35rem 0.6rem;
      font-size: 0.8125rem;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .desk__task-main[aria-current='true'] {
      background: #fff;
      color: var(--sidebar-delegated-navy, #0a1f44);
      box-shadow: inset 0 -2px 0 var(--sidebar-delegated-gold, #d4af37);
    }
    .desk__task-close {
      width: 1.75rem;
      color: inherit;
    }
    .desk__task-main:focus-visible,
    .desk__chrome:focus-visible,
    .desk__task-close:focus-visible {
      outline: 2px solid var(--sidebar-delegated-gold, #d4af37);
      outline-offset: -2px;
    }
  `]
})
export class DeskShellComponent {
  private readonly desk = inject(DeskWindowService);
  private readonly document = inject(DOCUMENT);
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly enabled = this.desk.enabled;
  readonly windows = this.desk.windows;
  readonly active = this.desk.activeWindow;
  readonly taskbarLabel = $localize`:@@core.desk.taskbar:Fenêtres ouvertes`;

  closeLabel(window: DeskWindow): string {
    return $localize`:@@core.desk.close-window:Fermer ${window.title}:title:`;
  }

  minimizeLabel(window: DeskWindow): string {
    return $localize`:@@core.desk.minimize-window:Réduire ${window.title}:title:`;
  }

  activateLabel(window: DeskWindow): string {
    return $localize`:@@core.desk.activate-window:Afficher ${window.title}:title:`;
  }

  isCurrent(window: DeskWindow): boolean {
    return this.active()?.key === window.key;
  }

  activate(window: DeskWindow): void {
    void this.desk.activate(window.key);
  }

  minimize(window: DeskWindow): void {
    void this.desk.minimize(window.key);
  }

  close(window: DeskWindow): void {
    void this.desk.close(window.key);
  }

  onTaskbarKeydown(event: KeyboardEvent): void {
    const forward = this.isRtl() ? 'ArrowLeft' : 'ArrowRight';
    const backward = this.isRtl() ? 'ArrowRight' : 'ArrowLeft';
    if (event.key !== forward && event.key !== backward) return;
    const buttons = Array.from(
      this.host.nativeElement.querySelectorAll('.desk__task-main')
    ) as HTMLButtonElement[];
    const index = buttons.indexOf(this.document.activeElement as HTMLButtonElement);
    if (index < 0 || buttons.length === 0) return;
    event.preventDefault();
    const delta = event.key === forward ? 1 : -1;
    buttons[(index + delta + buttons.length) % buttons.length]?.focus();
  }

  private isRtl(): boolean {
    const root = this.document.documentElement;
    return root?.dir === 'rtl' || this.document.dir === 'rtl';
  }
}
