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

    document.querySelectorAll('[name="p-anchored-overlay"]').forEach(node => node.remove());

    document.querySelectorAll('.p-component-overlay').forEach(node => {
      const el = node as HTMLElement;
      if (el.closest('.p-dialog') || el.closest('.p-drawer')) return;
      if (el.classList.contains('p-sidebar-mask')) return;
      node.remove();
    });
  }
}
