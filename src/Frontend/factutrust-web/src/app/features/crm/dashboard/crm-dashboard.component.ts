/// <reference types="@angular/localize" />
import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { StatCardComponent } from '@shared/components/stat-card/stat-card.component';
import { DashboardPanelComponent } from '@shared/components/dashboard/dashboard-panel.component';
import { CrmService, OpportunityDto, SalesActivityDto } from '../services/crm.service';
import { DecimalPipe } from '@angular/common';
import { ToastService } from '@core/services/toast.service';

@Component({
  selector: 'app-crm-dashboard',
  standalone: true,
  providers: [DecimalPipe],
  imports: [CommonModule, RouterModule, PageHeaderComponent, StatCardComponent, DashboardPanelComponent],
  template: `
    <app-page-header title="CRM Commercial" i18n-title="@@crm.dashboard.crm.commercial.96a9fcf3" subtitle="Tableau de bord" i18n-subtitle="@@crm.dashboard.tableau.de.bord.d776a08d" />

    <div class="stats-wrapper">
      <div class="stats-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:1rem; margin-bottom:1.5rem;">
        <app-stat-card appearance="solid" label="Mes relances" i18n-label="@@crm.dashboard.mes.relances.05d28ed7" [value]="reminders().length" icon="pi-bell"
          [variant]="reminders().length > 0 ? 'warning' : 'success'" />
        <app-stat-card appearance="solid" label="Pipeline pondéré" i18n-label="@@crm.dashboard.pipeline.pondere.506d4899" [value]="formatAmount(pipelineTotal())" icon="pi-chart-bar" variant="primary" />
        <app-stat-card appearance="solid" label="Opportunités ouvertes" i18n-label="@@crm.dashboard.opportunites.ouvertes.37ea7471" [value]="openOpps().length" icon="pi-bullseye" variant="primary" />
      </div>
    </div>

    @if (reminders().length > 0) {
      <app-dashboard-panel title="Relances à venir" i18n-title="@@crm.dashboard.relances.a.venir.cf05a6ba" [hasActions]="true" class="mb-4">
        <a panel-actions routerLink="/crm/activities" [queryParams]="{ mine: 1, completed: 'false' }" class="crm-dash-link" i18n="@@crm.dashboard.voir.toutes.mes.activites.c91dd96a">Voir toutes mes activités</a>
        <div class="reminder-list">
          @for (r of reminders(); track r.id) {
            <div style="display:flex; justify-content:space-between; align-items:center; padding:0.5rem 0; border-bottom:1px solid var(--border-subtle);">
              <div>
                <strong>{{ r.subject }}</strong>
                <span style="color:var(--text-muted); margin-left:0.5rem">{{ r.dueDate | date:'shortDate' }}</span>
              </div>
              <button type="button" style="font-size:0.85rem" (click)="markDone(r.id)" i18n="@@crm.dashboard.termine.3bc59720">Terminé</button>
            </div>
          }
        </div>
      </app-dashboard-panel>
    }

    @if (openOpps().length > 0) {
      <app-dashboard-panel title="Top opportunités" i18n-title="@@crm.dashboard.top.opportunites.b18e8f17">
        @for (o of openOpps().slice(0, 5); track o.id) {
          <div style="display:flex; justify-content:space-between; padding:0.5rem 0; border-bottom:1px solid var(--border-subtle);">
            <div>
              <a [routerLink]="['/crm/opportunities']" style="font-weight:600">{{ o.title }}</a>
              <span style="margin-left:0.5rem; font-size:0.85rem; color:var(--text-muted)">{{ o.stageName }}</span>
            </div>
            <span>{{ o.weightedAmount | number:'1.0-0' }} {{ o.currency }}</span>
          </div>
        }
      </app-dashboard-panel>
    }
  `,
  styles: [
    `
      .crm-dash-link {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-semibold);
        color: var(--color-primary-600);
        text-decoration: none;
      }
      .crm-dash-link:hover {
        text-decoration: underline;
      }
    `
  ]
})
export class CrmDashboardComponent implements OnInit {
  private readonly crm = inject(CrmService);
  private readonly decimalPipe = inject(DecimalPipe);
  private readonly toast = inject(ToastService);
  readonly reminders = signal<SalesActivityDto[]>([]);
  readonly openOpps = signal<OpportunityDto[]>([]);
  readonly pipelineTotal = signal(0);

  ngOnInit(): void {
    this.crm.getMyReminders().subscribe(r => {
      if (r.success && r.data) this.reminders.set(r.data);
    });
    this.crm.getOpportunities().subscribe(r => {
      if (r.success && r.data) {
        const open = r.data.filter(o => o.stage < 4);
        this.openOpps.set(open.sort((a, b) => b.weightedAmount - a.weightedAmount));
        this.pipelineTotal.set(open.reduce((s, o) => s + o.weightedAmount, 0));
      }
    });
  }

  formatAmount(v: number): string {
    return (this.decimalPipe.transform(v, '1.0-0') ?? '0') + $localize`:@@ui.tern.tnd.9aaf5c: TND`;
  }

  markDone(id: string): void {
    this.crm.completeActivity(id).subscribe({
      next: r => {
        if (r.success) {
          this.reminders.update(list => list.filter(x => x.id !== id));
        } else {
          const msg = r.errors?.[0] ?? r.message ?? r.error ?? $localize`:@@ui.tern.impossible.de.terminer.l.activite.0da4cb:Impossible de terminer l’activité`;
          this.toast.add({ severity: 'error', summary: $localize`:@@crm-dashboard.component.summary.Erreur:Erreur`, detail: msg, life: 6000 });
        }
      },
      error: () => {
        this.toast.add({ severity: 'error', summary: $localize`:@@crm-dashboard.component.summary.Erreur résea:Erreur réseau`, life: 6000 });
      }
    });
  }
}
