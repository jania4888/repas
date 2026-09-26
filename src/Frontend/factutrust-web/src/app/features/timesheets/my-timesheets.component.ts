import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TableModule } from 'primeng/table';
import { SelectModule } from 'primeng/select';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { TimesheetApiService, TimesheetGrid, TimesheetTimerState } from './timesheet-api.service';
import { ProjectApiService, ProjectListItem } from '../projects/project-api.service';

@Component({
  selector: 'app-my-timesheets',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TableModule, SelectModule, PageHeaderComponent, ButtonComponent],
  template: `
    <app-page-header title="Mes feuilles de temps" i18n-title="Mes feuilles de temps" subtitle="Vue grille — alignée Odoo Timesheets">
      <app-button variant="secondary" routerLink="/timesheets/validation" i18n="@@timesheets.my-timesheets.validation.equipe.104ff195">Validation équipe</app-button>
    </app-page-header>

    @if (kpi(); as k) {
      <div class="kpi-banner" [class.reached]="k.targetReached">
        <strong>{{ k.billableLoggedHours | number:'1.2-2' }} h</strong>
        <span>/ {{ k.targetHours | number:'1.2-2' }} h objectif facturable</span>
        <span class="pct">({{ k.completionPercent | number:'1.0-0' }} %)</span>
        <span class="total">Total période : {{ k.totalLoggedHours | number:'1.2-2' }} h</span>
      </div>
    }

    @if (leaderboard(); as lb) {
      <aside class="leaderboard">
        <h3 i18n="@@timesheets.my-timesheets.classement.top.3.d01a1b89">Classement (top 3)</h3>
        <ol>
          @for (e of lb.topThree; track e.userId) {
            <li>{{ e.userName }} — {{ e.completionPercent | number:'1.0-0' }} % ({{ e.billableLoggedHours | number:'1.1-1' }} h)</li>
          }
        </ol>
        @if (lb.dailyTip) {
          <p class="tip">{{ lb.dailyTip }}</p>
        }
      </aside>
    }

    <div class="toolbar">
      <app-button (clicked)="toggleTimer()">{{ timer() ? 'Stop timer' : 'Start timer' }}</app-button>
      @if (timer(); as t) {
        <span class="timer-info">{{ t.projectName }} — depuis {{ t.startedAtUtc | date:'HH:mm' }}</span>
      }
      <label>Période
        <select [(ngModel)]="periodMode" (ngModelChange)="reload()">
          <option value="week" i18n="@@timesheets.my-timesheets.semaine.33703a8c">Semaine</option>
          <option value="month" i18n="@@timesheets.my-timesheets.mois.0d304bea">Mois</option>
        </select>
      </label>
    </div>

    @if (grid(); as g) {
      <p-table [value]="g.rows" [scrollable]="true" styleClass="timesheet-grid">
        <ng-template pTemplate="header">
          <tr>
            <th i18n="@@timesheets.my-timesheets.projet.a9de3a26">Projet</th>
            @for (d of g.dailyTotals; track d.date) {
              <th>{{ d.date | date:'EEE dd' }}</th>
            }
            <th i18n="@@timesheets.my-timesheets.total.b25928c6">Total</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-row>
          <tr>
            <td><a [routerLink]="['/projects', row.projectId]">{{ row.projectName }}</a></td>
            @for (cell of row.days; track cell.date) {
              <td [class]="'cell-' + cell.colorCode">{{ cell.hours | number:'1.2-2' }}</td>
            }
            <td [class]="'cell-' + row.periodColorCode"><strong>{{ row.periodTotalHours | number:'1.2-2' }}</strong></td>
          </tr>
        </ng-template>
        <ng-template pTemplate="footer">
          <tr>
            <td><strong i18n="@@timesheets.my-timesheets.jour.240ce85d">Jour</strong></td>
            @for (d of g.dailyTotals; track d.date) {
              <td [class]="'cell-' + d.colorCode"><strong>{{ d.hours | number:'1.2-2' }}</strong></td>
            }
            <td></td>
          </tr>
        </ng-template>
      </p-table>
    }
  `,
  styles: [`
    .kpi-banner {
      display: flex; gap: .75rem; align-items: baseline; padding: .75rem 1rem;
      border-radius: 12px; margin-bottom: 1rem;
      background: #fef2f2; border: 1px solid #fecaca;
    }
    .kpi-banner.reached { background: #ecfdf5; border-color: #a7f3d0; }
    .kpi-banner .pct { font-weight: 600; }
    .kpi-banner .total { margin-left: auto; opacity: .85; }
    .leaderboard {
      float: right; width: 260px; margin: 0 0 1rem 1rem; padding: .75rem;
      border: 1px solid var(--color-border-subtle, #e2e8f0); border-radius: 12px;
    }
    .leaderboard ol { margin: 0; padding-left: 1.2rem; }
    .tip { font-size: .85rem; color: #64748b; margin-top: .5rem; }
    .toolbar { display: flex; gap: 1rem; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; }
    .timer-info { font-size: .9rem; color: #475569; }
    :host ::ng-deep .cell-green { background: #ecfdf5; }
    :host ::ng-deep .cell-red { background: #fef2f2; }
    :host ::ng-deep .cell-orange { background: #fff7ed; }
  `]
})
export class MyTimesheetsComponent implements OnInit {
  private readonly api = inject(TimesheetApiService);
  private readonly projects = inject(ProjectApiService);
  private readonly toast = inject(ToastService);
  private readonly errors = inject(ErrorHandlerService);

  grid = signal<TimesheetGrid | null>(null);
  kpi = signal<TimesheetGrid['billingRateKpi']>(null);
  leaderboard = signal<TimesheetGrid['leaderboard']>(null);
  timer = signal<TimesheetTimerState | null>(null);
  periodMode: 'week' | 'month' = 'week';
  private projectList: ProjectListItem[] = [];

  ngOnInit(): void {
    this.reload();
    this.api.getActiveTimer().subscribe({
      next: r => { if (r.success && r.data) this.timer.set(r.data); },
      error: e => this.fail(e, 'Chronomètre')
    });
  }

  reload(): void {
    const { from, to } = this.periodRange();
    this.api.getGrid(from, to).subscribe({
      next: r => {
        if (!r.success || !r.data) return;
        this.grid.set(r.data);
        this.kpi.set(r.data.billingRateKpi ?? null);
        this.leaderboard.set(r.data.leaderboard ?? null);
      },
      error: e => this.fail(e, 'Feuille de temps')
    });
  }

  toggleTimer(): void {
    const active = this.timer();
    if (active) {
      this.api.stopTimer(active.entryId).subscribe({
        next: r => {
          if (r.success) {
            this.timer.set(null);
            this.toast.add({ severity: 'success', summary: 'Chronomètre arrêté' });
            this.reload();
          }
        },
        error: e => this.fail(e, 'Arrêt du chronomètre')
      });
      return;
    }
    this.ensureProjects(() => {
      const project = this.projectList.find(p => p.timesheetsEnabled);
      if (!project) {
        this.toast.add({ severity: 'warn', summary: 'Aucun projet avec timesheets activés' });
        return;
      }
      this.api.startTimer({ projectId: project.id }).subscribe({
        next: r => {
          if (r.success && r.data) {
            this.timer.set(r.data);
            this.toast.add({ severity: 'success', summary: 'Chronomètre démarré' });
          }
        },
        error: e => this.fail(e, 'Démarrage du chronomètre')
      });
    });
  }

  private ensureProjects(cb: () => void): void {
    if (this.projectList.length) { cb(); return; }
    this.projects.list({ page: 1, pageSize: 50 }).subscribe({
      next: r => {
        if (r.success && r.data) {
          this.projectList = r.data.items;
          cb();
        }
      },
      error: e => this.fail(e, 'Projets')
    });
  }

  private fail(err: unknown, summary: string): void {
    this.toast.add({ severity: 'error', summary, detail: this.errors.extractErrorMessage(err) });
  }

  private periodRange(): { from: Date; to: Date } {
    const now = new Date();
    if (this.periodMode === 'month') {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { from, to };
    }
    const day = now.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const from = new Date(now);
    from.setDate(now.getDate() + diff);
    const to = new Date(from);
    to.setDate(from.getDate() + 6);
    return { from, to };
  }
}
