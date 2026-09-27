import { Component, computed, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { erpPlural, erpPluralLocale } from '@core/i18n/erp-plural';

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
    if (!iso) return $localize`:@@accounting.draft-banner.ts.recemment.b326495c:récemment`;
    const saved = new Date(iso);
    const now = Date.now();
    const diffSec = Math.max(0, Math.round((now - saved.getTime()) / 1000));
    if (diffSec < 60) return $localize`:@@accounting.draft-banner.il.y.a.quelques.secondes:il y a quelques secondes`;
    if (diffSec < 3600) {
      const m = Math.floor(diffSec / 60);
      return erpPlural(m, {
        zero: $localize`:@@accounting.draft-banner.il.y.a.minutes.zero:il y a ${m}:m: minutes`,
        one: $localize`:@@accounting.draft-banner.il.y.a.minutes.one:il y a ${m}:m: minute`,
        two: $localize`:@@accounting.draft-banner.il.y.a.minutes.two:il y a ${m}:m: minutes`,
        few: $localize`:@@accounting.draft-banner.il.y.a.minutes.few:il y a ${m}:m: minutes`,
        many: $localize`:@@accounting.draft-banner.il.y.a.minutes.many:il y a ${m}:m: minutes`,
        other: $localize`:@@accounting.draft-banner.il.y.a.minutes.other:il y a ${m}:m: minutes`
      }, erpPluralLocale());
    }
    if (diffSec < 86400) {
      const h = Math.floor(diffSec / 3600);
      return erpPlural(h, {
        zero: $localize`:@@accounting.draft-banner.il.y.a.heures.zero:il y a ${h}:h: heures`,
        one: $localize`:@@accounting.draft-banner.il.y.a.heures.one:il y a ${h}:h: heure`,
        two: $localize`:@@accounting.draft-banner.il.y.a.heures.two:il y a ${h}:h: heures`,
        few: $localize`:@@accounting.draft-banner.il.y.a.heures.few:il y a ${h}:h: heures`,
        many: $localize`:@@accounting.draft-banner.il.y.a.heures.many:il y a ${h}:h: heures`,
        other: $localize`:@@accounting.draft-banner.il.y.a.heures.other:il y a ${h}:h: heures`
      }, erpPluralLocale());
    }
    const d = Math.floor(diffSec / 86400);
    return erpPlural(d, {
      zero: $localize`:@@accounting.draft-banner.il.y.a.jours.zero:il y a ${d}:d: jours`,
      one: $localize`:@@accounting.draft-banner.il.y.a.jours.one:il y a ${d}:d: jour`,
      two: $localize`:@@accounting.draft-banner.il.y.a.jours.two:il y a ${d}:d: jours`,
      few: $localize`:@@accounting.draft-banner.il.y.a.jours.few:il y a ${d}:d: jours`,
      many: $localize`:@@accounting.draft-banner.il.y.a.jours.many:il y a ${d}:d: jours`,
      other: $localize`:@@accounting.draft-banner.il.y.a.jours.other:il y a ${d}:d: jours`
    }, erpPluralLocale());
  });
}
