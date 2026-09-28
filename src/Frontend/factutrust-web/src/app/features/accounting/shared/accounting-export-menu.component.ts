import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MenuModule } from 'primeng/menu';
import { MenuItem } from 'primeng/api';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AccountingExportFormat } from './accounting-download.util';

/**
 * Bouton « Exporter ▾ » réutilisable proposant PDF / Excel / CSV.
 * Émet le format choisi via (exportFormat) ; le composant hôte réalise l'appel réseau + le téléchargement.
 */
@Component({
  selector: 'app-accounting-export-menu',
  standalone: true,
  imports: [CommonModule, MenuModule, ButtonComponent],
  template: `
    <p-menu #menu [popup]="true" [model]="items" appendTo="body"></p-menu>
    <app-button
      variant="secondary"
      size="sm"
      icon="pi-download"
      iconPos="left"
      type="button"
      [disabled]="disabled"
      (click)="menu.toggle($event)"
      [attr.aria-haspopup]="true"
      [attr.aria-label]="label">
      {{ label }}
      <i class="pi pi-chevron-down icon-right" aria-hidden="true"></i>
    </app-button>
  `
})
export class AccountingExportMenuComponent {
  /** Désactive le bouton (chargement en cours, données vides, période invalide). */
  @Input() disabled = false;
  /** Libellé du bouton. */
  @Input() label = $localize`:@@accounting.accounting-export-menu.ts.exporter.0cd84bdc:Exporter`;

  /** Format choisi par l'utilisateur. */
  @Output() exportFormat = new EventEmitter<AccountingExportFormat>();

  readonly items: MenuItem[] = [
    { label: 'PDF', icon: 'fa-solid fa-file-pdf', command: () => this.exportFormat.emit('pdf') },
    { label: 'Excel', icon: 'fa-solid fa-file-excel', command: () => this.exportFormat.emit('excel') },
    { label: 'CSV', icon: 'fa-solid fa-file-csv', command: () => this.exportFormat.emit('csv') }
  ];
}
