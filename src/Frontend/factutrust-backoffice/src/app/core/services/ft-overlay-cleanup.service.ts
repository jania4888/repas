import { Injectable } from '@angular/core';

/**
 * Nettoie les overlays PrimeNG orphelins (menus popup, masques drawer/dialog)
 * qui peuvent bloquer les clics sur toute la page.
 *
 * Workaround PrimeNG #19213 — à appeler sur NavigationStart, logout et destroy.
 */
@Injectable({ providedIn: 'root' })
export class FtOverlayCleanupService {
  clearOrphanOverlays(): void {
    if (typeof document === 'undefined') return;

    // PrimeNG 20 : les overlays sont des éléments <p-overlay> (plus de marqueur
    // p-anchored-overlay) ; on cible les panneaux orphelins hors dialog/drawer.
    document.querySelectorAll('.p-component-overlay, .p-overlay').forEach(node => {
      const el = node as HTMLElement;
      if (el.closest('.p-dialog') || el.closest('.p-drawer')) return;
      if (el.classList.contains('p-overlay-mask') || el.classList.contains('p-drawer-mask')) return;
      node.remove();
    });
  }
}
