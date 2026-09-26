import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-entry-shortcuts-panel',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <aside class="shortcuts card" aria-labelledby="shortcuts-title">
      <h3 id="shortcuts-title" class="shortcuts__title" i18n="@@accounting.manual-entry.raccourcis.0e0d6404">Raccourcis</h3>
      <ul class="shortcuts__list">
        <li><a routerLink="/accounting/journal" [queryParams]="{ journalCode: 'JA' }" i18n="@@accounting.manual-entry.consulter.le.journal.des.achats.fb254caf">Consulter le journal des achats</a></li>
        <li><a routerLink="/accounting/journal" [queryParams]="{ journalCode: 'JV' }" i18n="@@accounting.manual-entry.consulter.le.journal.des.ventes.100df53f">Consulter le journal des ventes</a></li>
        <li><a routerLink="/accounting/ledger" i18n="@@accounting.manual-entry.consulter.le.compte.general.b7a8d490">Consulter le compte général</a></li>
        <li><a routerLink="/accounting/entry-templates" i18n="@@accounting.manual-entry.nouveau.modele.d.ecriture.29362cf3">Nouveau modèle d'écriture</a></li>
      </ul>
    </aside>
  `,
  styles: `
    .shortcuts { padding:var(--spacing-4); margin-bottom:0; }
    .shortcuts__title { font-size:var(--font-size-sm); font-weight:var(--font-weight-semibold); margin:0 0 var(--spacing-2); text-transform:uppercase; color:var(--color-text-secondary); }
    .shortcuts__list { list-style:none; padding:0; margin:0; display:grid; grid-template-columns:repeat(auto-fit, minmax(min(100%, 15rem), 1fr)); gap:0 var(--spacing-4); }
    .shortcuts__list li { margin-bottom:var(--spacing-2); }
    .shortcuts__list a { font-size:var(--font-size-sm); color:var(--color-primary-600); text-decoration:none; }
    .shortcuts__list a:hover { text-decoration:underline; }
  `
})
export class EntryShortcutsPanelComponent {}
