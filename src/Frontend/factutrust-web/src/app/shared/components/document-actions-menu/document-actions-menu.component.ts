import { Component, Input, ViewChild, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Menu, MenuModule } from 'primeng/menu';
import { MenuItem as PrimeMenuItem } from 'primeng/api';
import { ButtonComponent } from '@shared/components/button/button.component';
import { MenuItem } from '@shared/models/menu-item.model';

/**
 * Menu kebab « Actions » pour les pages de détail document (facture, BL, commande…).
 *
 * Convention : tout `p-menu [popup]` dans un header de page DOIT utiliser `appendTo="body"`
 * pour éviter le clipping par les conteneurs `overflow: hidden` du shell
 * (`.full_container`, `#content`, `.midde_cont`). Ne pas réintroduire de `p-menu`
 * inline dans les pages — passer par ce composant.
 */
@Component({
  selector: 'app-document-actions-menu',
  standalone: true,
  imports: [CommonModule, MenuModule, ButtonComponent],
  template: `
    @if (hasVisibleItems) {
      <p-menu
        #menu
        [popup]="true"
        [model]="primeItems"
        appendTo="body"
        styleClass="ft-document-actions-menu"
        [ariaLabel]="ariaLabel"
        (onShow)="onShow()"
        (onHide)="onHide()">
      </p-menu>
      <app-button
        variant="secondary"
        icon="pi-ellipsis-v"
        iconPos="left"
        type="button"
        [ariaLabel]="ariaLabel"
        [attr.aria-haspopup]="true"
        [attr.aria-expanded]="menuVisible()"
        (clicked)="toggle($event)">
        {{ label }}
      </app-button>
    }
  `,
  styles: [`
    :host {
      display: inline-flex;
      align-items: center;
    }
  `]
})
export class DocumentActionsMenuComponent {
  @ViewChild('menu') menu?: Menu;

  /** Éléments du menu (séparateurs et `visible: false` supportés). */
  @Input() items: MenuItem[] = [];
  /** Libellé du bouton déclencheur. */
  @Input() label = $localize`:@@shared.document-actions-menu.ts.actions.c3cd636a:Actions`;
  /**
   * Alignement horizontal du panneau par rapport au bouton.
   * `'end'` est le défaut (header à droite). PrimeNG 19 n'expose pas `popupAlignment`.
   */
  @Input() align: 'start' | 'end' | 'center' = 'end';
  @Input() ariaLabel = $localize`:@@shared.document-actions-menu.ts.menu.des.actions.0fec830f:Menu des actions`;

  readonly menuVisible = signal(false);

  get primeItems(): PrimeMenuItem[] {
    return this.items as PrimeMenuItem[];
  }

  get hasVisibleItems(): boolean {
    return this.items.some(item => !item.separator && item.visible !== false);
  }

  toggle(event: Event): void {
    this.menu?.toggle(event);
  }

  onShow(): void {
    this.menuVisible.set(true);
    if (this.align === 'end' || this.align === 'center') {
      // Après le positionnement PrimeNG (absolutePosition), ré-ancrer à droite / centre.
      queueMicrotask(() => this.realignOverlay());
    }
  }

  onHide(): void {
    this.menuVisible.set(false);
  }

  private realignOverlay(): void {
    const menuRef = this.menu as (Menu & { container?: HTMLElement; target?: HTMLElement }) | undefined;
    const container = menuRef?.container;
    const target = menuRef?.target;
    if (!container || !target) {
      return;
    }

    const targetRect = target.getBoundingClientRect();
    const menuWidth = container.offsetWidth || 220;
    const viewportPad = 8;
    let left: number;

    if (this.align === 'center') {
      left = targetRect.left + targetRect.width / 2 - menuWidth / 2;
    } else {
      left = targetRect.right - menuWidth;
    }

    left = Math.min(Math.max(viewportPad, left), window.innerWidth - menuWidth - viewportPad);
    container.style.left = `${left}px`;
  }
}
