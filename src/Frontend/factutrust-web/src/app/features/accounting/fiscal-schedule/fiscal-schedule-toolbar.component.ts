import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { MenuModule } from 'primeng/menu';
import { MenuItem } from 'primeng/api';
import { FISCAL_SCHEDULE_SHARED_STYLES } from './fiscal-schedule-shared.styles';

@Component({
  selector: 'app-fiscal-schedule-toolbar',
  standalone: true,
  imports: [CommonModule, MenuModule],
  template: `
    <div class="toolbar" role="toolbar" aria-label="Actions echeancier fiscal" i18n-aria-label="Actions echeancier fiscal">
      <button class="icon-button primary" type="button" title="Creer" i18n-title="Creer" (click)="create.emit()" [disabled]="!canCreate">
        <i class="fa-solid fa-plus"></i><span i18n="@@accounting.fiscal-schedule.creer.2bd00521">Creer</span>
      </button>
      <button class="icon-button" type="button" title="Modifier" i18n-title="Modifier" (click)="edit.emit()" [disabled]="!canEdit || !hasSelection">
        <i class="fa-solid fa-pen"></i><span i18n="@@accounting.fiscal-schedule.modifier.f260e757">Modifier</span>
      </button>
      <button class="icon-button danger" type="button" title="Supprimer" i18n-title="Supprimer" (click)="delete.emit()" [disabled]="!canDelete || !hasSelection">
        <i class="fa-solid fa-trash"></i><span i18n="@@accounting.fiscal-schedule.supprimer.1acfc1c7">Supprimer</span>
      </button>
      <button class="icon-button" type="button" title="Actualiser" i18n-title="Actualiser" (click)="refresh.emit()">
        <i class="fa-solid fa-rotate"></i><span i18n="@@accounting.fiscal-schedule.actualiser.9d3b2a7d">Actualiser</span>
      </button>
      <div class="menu-wrap">
        <button class="icon-button" type="button" title="Imprimer" i18n-title="Imprimer" (click)="printMenu.toggle($event)">
          <i class="fa-solid fa-print"></i><span i18n="@@accounting.fiscal-schedule.imprimer.5382c09d">Imprimer</span><i class="fa-solid fa-caret-down caret"></i>
        </button>
        <p-menu #printMenu [popup]="true" [model]="printItems" appendTo="body"></p-menu>
      </div>
      <div class="menu-wrap">
        <button class="icon-button" type="button" title="Exporter" i18n-title="Exporter" (click)="exportMenu.toggle($event)">
          <i class="fa-solid fa-file-export"></i><span i18n="@@accounting.fiscal-schedule.exporter.0cd84bdc">Exporter</span><i class="fa-solid fa-caret-down caret"></i>
        </button>
        <p-menu #exportMenu [popup]="true" [model]="exportItems" appendTo="body"></p-menu>
      </div>
      <button class="icon-button" type="button" title="Planifier les rappels" i18n-title="Planifier les rappels" (click)="planReminder.emit()" [disabled]="!canCreate || !hasSelection">
        <i class="fa-regular fa-bell"></i><span i18n="@@accounting.fiscal-schedule.planifier.les.rappels.7acb81ad">Planifier les rappels</span>
      </button>
    </div>
  `,
  styles: [FISCAL_SCHEDULE_SHARED_STYLES, `
    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .menu-wrap { position: relative; }
    .caret { font-size: 10px; opacity: .7; }
  `]
})
export class FiscalScheduleToolbarComponent implements OnChanges {
  @Input() canCreate = false;
  @Input() canEdit = false;
  @Input() canDelete = false;
  @Input() hasSelection = false;

  @Output() create = new EventEmitter<void>();
  @Output() edit = new EventEmitter<void>();
  @Output() delete = new EventEmitter<void>();
  @Output() refresh = new EventEmitter<void>();
  @Output() planReminder = new EventEmitter<void>();
  @Output() printCurrent = new EventEmitter<void>();
  @Output() printSelected = new EventEmitter<void>();
  @Output() exportFiltered = new EventEmitter<void>();
  @Output() exportPage = new EventEmitter<void>();

  printItems: MenuItem[] = [];
  exportItems: MenuItem[] = [];

  ngOnChanges(_changes: SimpleChanges): void {
    this.printItems = [
      { label: 'Vue courante', icon: 'fa-solid fa-table', command: () => this.printCurrent.emit() },
      { label: 'Echeance selectionnee', icon: 'fa-solid fa-file-lines', command: () => this.printSelected.emit(), disabled: !this.hasSelection }
    ];
    this.exportItems = [
      { label: 'CSV filtres courants', icon: 'fa-solid fa-filter', command: () => this.exportFiltered.emit() },
      { label: 'CSV page courante', icon: 'fa-solid fa-file-csv', command: () => this.exportPage.emit() }
    ];
  }
}
