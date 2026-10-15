import { Directive, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DeskWindowStore } from './desk-window.store';

/** Mémorise l'instance affichée pour savoir si elle est modifiée, y compris tant qu'elle n'est pas détachée. */
@Directive({
  selector: 'router-outlet[deskOutlet]',
  standalone: true
})
export class DeskOutletDirective {
  private readonly outlet = inject(RouterOutlet);
  private readonly windows = inject(DeskWindowStore);

  constructor() {
    this.outlet.activateEvents.subscribe(instance => this.remember(instance));
    this.outlet.attachEvents.subscribe(instance => this.remember(instance));
    this.outlet.deactivateEvents.subscribe(() => this.windows.setActiveInstance(null));
    this.outlet.detachEvents.subscribe(() => this.windows.setActiveInstance(null));
  }

  private remember(instance: unknown): void {
    this.windows.setActiveInstance(instance && typeof instance === 'object' ? instance : null);
  }
}
