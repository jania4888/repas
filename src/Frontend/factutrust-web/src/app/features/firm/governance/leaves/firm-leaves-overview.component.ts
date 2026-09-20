import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { ProgressBarModule } from 'primeng/progressbar';
import { AuthService } from '@core/services/auth.service';
import { ToastService } from '@core/services/toast.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { FirmLeavesService } from './data-access/firm-leaves.service';
import {
  FIRM_LEAVE_MIRROR_STATE,
  FirmLeaveMirrorResult,
  FirmLeaveOverview
} from './data-access/firm-leaves.models';

@Component({
  selector: 'app-firm-leaves-overview',
  standalone: true,
  imports: [CommonModule, RouterLink, TableModule, ButtonModule, TagModule, ProgressBarModule],
  template: `
    @if (overview(); as o) {
      <div class="kpis">
        <div class="kpi"><span class="label">Solde total congés payés</span><strong>{{ o.totalPaidBalanceDays }} j.</strong></div>
        <div class="kpi"><span class="label">Congés posés</span><strong>{{ o.takenDays }} j.</strong><small>validés {{ o.year }}</small></div>
        <div class="kpi"><span class="label">Demandes en attente</span><strong>{{ o.pendingDays }} j.</strong></div>
        <div class="kpi"><span class="label">Taux d'absentéisme</span><strong>{{ o.absenteeismRatePercent }} %</strong><small>{{ o.year }}</small></div>
      </div>

      <div class="grid">
        <section class="fc-card main">
          <div class="sec-head">
            <h3>Demandes en cours ({{ o.pendingRequests.length }})</h3>
            <a routerLink="../validation" class="link">Voir validation</a>
          </div>
          <p-table [value]="o.pendingRequests">
            <ng-template pTemplate="header">
              <tr><th>Collaborateur</th><th>Type</th><th>Période</th><th>Durée</th><th>Motif</th><th>Statut</th>
                @if (isManager()) { <th></th> }
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-r>
              <tr>
                <td>{{ r.collaboratorName }}</td>
                <td>{{ r.leaveTypeLabel }}</td>
                <td>{{ r.startDate | date:'dd/MM' }} → {{ r.endDate | date:'dd/MM' }}</td>
                <td>{{ r.days }} j.</td>
                <td>{{ r.reason || '—' }}</td>
                <td><p-tag value="En attente" severity="info" /></td>
                @if (isManager()) {
                  <td class="act">
                    <button type="button" pButton icon="pi pi-check" class="p-button-rounded p-button-success p-button-sm" (click)="approve(r.id)"></button>
                    <button type="button" pButton icon="pi pi-times" class="p-button-rounded p-button-danger p-button-sm" (click)="reject(r.id)"></button>
                  </td>
                }
              </tr>
            </ng-template>
            <ng-template pTemplate="emptymessage"><tr><td colspan="7">Aucune demande en attente.</td></tr></ng-template>
          </p-table>
        </section>

        <aside class="side">
          <section class="fc-card">
            <h3>Soldes par collaborateur</h3>
            @for (b of o.topBalances; track b.userId) {
              <div class="bal">
                <div class="bal-top"><span>{{ b.collaboratorName }}</span><span>{{ b.remainingDays }} / {{ b.openingBalanceDays + b.adjustmentDays }} j.</span></div>
                <p-progressBar [value]="pct(b.consumedDays, b.openingBalanceDays + b.adjustmentDays)" [showValue]="false" />
              </div>
            }
          </section>
          <section class="fc-card">
            <h3>Types d'absence</h3>
            <table class="mini">
              <thead><tr><th>Type</th><th>Pris</th></tr></thead>
              <tbody>
                @for (t of o.typeSummaries; track t.leaveTypeId) {
                  <tr>
                    <td><span class="dot" [style.background]="t.colorHex"></span>{{ t.label }}</td>
                    <td>{{ t.takenDays }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </section>
        </aside>
      </div>
    }
  `,
  styles: [`
    .kpis { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:1rem; margin-bottom:1rem; }
    .kpi { background:#fff; border:1px solid #e2e8f0; border-radius:16px; padding:1rem 1.1rem; display:grid; gap:.25rem; }
    .kpi .label { color:#64748b; font-size:.8rem; }
    .kpi strong { font-size:1.4rem; }
    .kpi small { color:#94a3b8; }
    .grid { display:grid; grid-template-columns:1fr 320px; gap:1rem; align-items:start; }
    .fc-card { background:#fff; border:1px solid #e2e8f0; border-radius:16px; padding:1rem; }
    .sec-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:.75rem; }
    .sec-head h3, .side h3 { margin:0 0 .75rem; font-size:1rem; }
    .link { font-size:.85rem; }
    .act { display:flex; gap:.25rem; }
    .bal { margin-bottom:.85rem; }
    .bal-top { display:flex; justify-content:space-between; font-size:.85rem; margin-bottom:.25rem; }
    .mini { width:100%; font-size:.85rem; }
    .mini th { text-align:left; color:#64748b; font-weight:500; }
    .dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:6px; }
    @media (max-width: 960px) {
      .kpis { grid-template-columns:1fr 1fr; }
      .grid { grid-template-columns:1fr; }
    }
  `]
})
export class FirmLeavesOverviewComponent implements OnInit {
  private readonly api = inject(FirmLeavesService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmationService);

  readonly isManager = this.auth.isFirmManager;
  readonly overview = signal<FirmLeaveOverview | null>(null);

  ngOnInit(): void { this.reload(); }

  reload(): void {
    this.api.getOverview(new Date().getFullYear()).subscribe({
      next: r => this.overview.set(r.data ?? null)
    });
  }

  pct(consumed: number, total: number): number {
    if (total <= 0) return 0;
    return Math.min(100, Math.round((consumed / total) * 100));
  }

  approve(id: string): void {
    this.confirm.confirm({
      header: 'Accepter',
      message: 'Accepter cette demande ?',
      acceptLabel: 'Accepter',
      acceptButtonStyleClass: 'btn-success',
      accept: () => this.api.process(id, true).subscribe({
        next: r => {
          if (r.success) {
            this.toast.add({ severity: 'success', summary: 'Congés', detail: 'Acceptée' });
            this.notifyPayrollMirror(r.data?.payrollMirror);
            this.reload();
          }
          else this.toast.add({ severity: 'error', summary: 'Erreur', detail: r.message ?? '' });
        }
      })
    });
  }

  reject(id: string): void {
    this.confirm.confirm({
      header: 'Refuser',
      message: 'Refuser cette demande ?',
      acceptLabel: 'Refuser',
      acceptButtonStyleClass: 'btn-danger',
      accept: () => this.api.process(id, false).subscribe({
        next: r => {
          if (r.success) { this.toast.add({ severity: 'info', summary: 'Congés', detail: 'Refusée' }); this.reload(); }
          else this.toast.add({ severity: 'error', summary: 'Erreur', detail: r.message ?? '' });
        }
      })
    });
  }

  /** Alerte l'approbateur quand le congé n'a pas pu produire son effet en paie. */
  private notifyPayrollMirror(mirror?: FirmLeaveMirrorResult): void {
    if (!mirror || mirror.isApplied || mirror.state === FIRM_LEAVE_MIRROR_STATE.noPayrollEffect) return;

    this.toast.add({
      severity: mirror.state === FIRM_LEAVE_MIRROR_STATE.blockedFrozenPayroll ? 'warn' : 'error',
      summary: 'Report en paie',
      detail: mirror.message ?? mirror.stateDisplay,
      life: 10000
    });
  }
}
