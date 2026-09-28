import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { VatDocLinkRow } from './vat-declaration.view-model';

@Component({
  selector: 'app-vat-declaration-doc-links',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="card vat-zone-card">
      <h3 class="vat-zone-title" i18n="@@accounting.vat-declaration.5.pieces.justificatives.a464a293">5. Pièces justificatives</h3>
      <p class="vat-zone-hint" i18n="@@accounting.vat-declaration.acces.lecture.seule.aux.journaux.et.modules.sour.c1b13fc8">Accès lecture seule aux journaux et modules sources. Les pièces jointes seront disponibles dans une prochaine version.</p>
      <ul class="vat-doc-list">
        @for (link of links; track link.label) {
          <li class="vat-doc-item">
            <span class="vat-doc-status" [class.vat-doc-status--ok]="link.status === 'ok'" [class.vat-doc-status--warning]="link.status === 'warning'">
              @if (link.status === 'ok') {
                <i class="pi pi-check" aria-hidden="true"></i>
              } @else if (link.status === 'warning') {
                <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
              } @else {
                <i class="pi pi-minus" aria-hidden="true"></i>
              }
              {{ link.statusLabel }}
            </span>
            <a class="vat-doc-link" [routerLink]="link.route" [queryParams]="link.queryParams">{{ link.label }}</a>
          </li>
        }
      </ul>
    </div>
  `,
  styles: `
    .vat-zone-card { padding: var(--spacing-5); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); margin-bottom: var(--spacing-4); }
    .vat-zone-title { font-size: var(--font-size-md); font-weight: var(--font-weight-semibold); margin: 0 0 var(--spacing-2); color: var(--color-text-primary); }
    .vat-zone-hint { font-size: var(--font-size-sm); color: var(--color-text-tertiary); margin: 0 0 var(--spacing-4); }
    .vat-doc-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--spacing-2); }
    .vat-doc-item { display: flex; align-items: center; gap: var(--spacing-3); padding: var(--spacing-2) 0; border-bottom: 1px solid var(--color-border-subtle); }
    .vat-doc-item:last-child { border-bottom: none; }
    .vat-doc-status { display: inline-flex; align-items: center; gap: 0.25rem; min-width: 3.5rem; font-size: var(--font-size-xs); font-weight: var(--font-weight-semibold); color: var(--color-text-tertiary); }
    .vat-doc-status--ok { color: var(--color-success-700,#15803d); }
    .vat-doc-status--warning { color: var(--color-warning-700,#a16207); }
    .vat-doc-link { font-size: var(--font-size-sm); color: var(--color-primary-600,#2563eb); text-decoration: none; }
    .vat-doc-link:hover { text-decoration: underline; }
  `
})
export class VatDeclarationDocLinksComponent {
  @Input() links: VatDocLinkRow[] = [];
}
