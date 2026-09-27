/// <reference types="@angular/localize" />
import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TableModule } from 'primeng/table';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { ProjectApiService, ProjectTimeEntry } from '../projects/project-api.service';
import { TimesheetApiService } from './timesheet-api.service';

@Component({
  selector: 'app-timesheet-validation',
  standalone: true,
  imports: [CommonModule, RouterLink, TableModule, PageHeaderComponent, ButtonComponent],
  template: `
    <app-page-header title="Validation des feuilles de temps" i18n-title="Validation des feuilles de temps" subtitle="File manageriale centralisée" />
    <p-table [value]="entries()" [paginator]="true" [rows]="20">
      <ng-template pTemplate="header">
        <tr>
          <th i18n="@@timesheets.timesheet-validation.date.eb9a4bc1">Date</th><th i18n="@@timesheets.timesheet-validation.projet.a9de3a26">Projet</th><th i18n="@@timesheets.timesheet-validation.utilisateur.0b20cd7f">Utilisateur</th><th i18n="@@timesheets.timesheet-validation.heures.b4448c06">Heures</th><th i18n="@@timesheets.timesheet-validation.facturable.63134237">Facturable</th><th></th>
        </tr>
      </ng-template>
      <ng-template pTemplate="body" let-e>
        <tr>
          <td>{{ e.workDate | date:'dd/MM/yyyy' }}</td>
          <td><a [routerLink]="['/projects', e.projectId]">{{ e.projectName }}</a></td>
          <td>{{ e.userName }}</td>
          <td>{{ e.hours | number:'1.2-2' }}</td>
          <td>{{ e.isBillable ? loc_ui_tern_oui_eaa02f : loc_ui_tern_non_a72199 }}</td>
          <td><app-button size="sm" (clicked)="validate(e.id)" i18n="@@timesheets.timesheet-validation.valider.be4220f7">Valider</app-button></td>
        </tr>
      </ng-template>
    </p-table>
  `
})
export class TimesheetValidationComponent implements OnInit {
  readonly loc_ui_tern_oui_eaa02f = $localize`:@@ui.tern.oui.eaa02f:Oui`;
  readonly loc_ui_tern_non_a72199 = $localize`:@@ui.tern.non.a72199:Non`;
  private readonly timesheets = inject(TimesheetApiService);
  private readonly projects = inject(ProjectApiService);
  private readonly toast = inject(ToastService);
  private readonly errors = inject(ErrorHandlerService);
  entries = signal<ProjectTimeEntry[]>([]);

  ngOnInit(): void { this.load(); }

  load(): void {
    this.timesheets.getValidationQueue().subscribe({
      next: r => { if (r.success && r.data) this.entries.set(r.data); },
      error: e => this.fail(e, 'File de validation')
    });
  }

  validate(id: string): void {
    this.projects.validateTime(id).subscribe({
      next: r => {
        if (r.success) {
          this.toast.add({ severity: 'success', summary: $localize`:@@timesheet-validation.component.summary.Temps validé:Temps validé` });
          this.load();
        }
      },
      error: e => this.fail(e, 'Validation impossible')
    });
  }

  private fail(err: unknown, summary: string): void {
    this.toast.add({ severity: 'error', summary, detail: this.errors.extractErrorMessage(err) });
  }
}
