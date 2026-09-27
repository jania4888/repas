import { Component, computed, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-draft-banner',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (visible()) {
      <div class="db-banner" role="region" aria-label="Brouillon disponible" i18n-aria-label="@@accounting.manual-entry.brouillon.disponible.d1d2f606">
        <span class="db-icon" aria-hidden="true" i18n="@@accounting.manual-entry.text.edc47290">📝</span>
        <span class="db-message">
          <ng-container i18n="@@accounting.manual-entry.un.brouillon.d.ecriture.a.ete.sauvegarde.automat.1930ed4a"> Un brouillon d'écriture a été sauvegardé automatiquement </ng-container>
          <strong>{{ relative() }}</strong>.
        </span>
        <div class="db-actions">
          <button type="button" class="btn btn-sm btn-primary" (click)="restore.emit()" i18n="@@accounting.manual-entry.restaurer.le.brouillon.6208ee6f"> Restaurer le brouillon </button>
          <button type="button" class="btn btn-sm btn-outline-secondary" (click)="discard.emit()" i18n="@@accounting.manual-entry.ignorer.b0d64e49"> Ignorer </button>
        </div>
      </div>
    }
  `,
  styles: `
    .db-banner { display:flex; flex-wrap:wrap; align-items:center; gap:var(--spacing-3); padding:var(--spacing-3) var(--spacing-4); margin-bottom:var(--spacing-4); border-radius:var(--radius-md); background:var(--color-info-50,#f0f9ff); color:var(--color-info-700,#0369a1); border:1px solid var(--color-info-200,#bae6fd); }
    .db-icon { font-size:1.25rem; }
    .db-message { flex:1 1 240px; font-size:var(--font-size-sm); }
    .db-actions { display:flex; gap:var(--spacing-2); }
  `
})
export class DraftBannerComponent {
  readonly visible = input<boolean>(false);
  readonly savedAt = input<string | null>(null);
  readonly restore = output<void>();
  readonly discard = output<void>();

  readonly relative = computed(() => {
    const iso = this.savedAt();
    if (!iso) return 'récemment';
    const saved = new Date(iso);
    const now = Date.now();
    const diffSec = Math.max(0, Math.round((now - saved.getTime()) / 1000));
    if (diffSec < 60) return "il y a quelques secondes";
    if (diffSec < 3600) {
      const m = Math.floor(diffSec / 60);
      return `il y a ${m} minute${m > 1 ? 's' : ''}`;
    }
    if (diffSec < 86400) {
      const h = Math.floor(diffSec / 3600);
      return `il y a ${h} heure${h > 1 ? 's' : ''}`;
    }
    const d = Math.floor(diffSec / 86400);
    return `il y a ${d} jour${d > 1 ? 's' : ''}`;
  });
}
