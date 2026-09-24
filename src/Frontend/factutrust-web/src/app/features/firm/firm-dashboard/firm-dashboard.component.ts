import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { catchError, forkJoin, of } from 'rxjs';
import { AuthService, ApiResponse } from '@core/services/auth.service';
import {
  FirmDashboardService,
  FirmDashboardData,
  FirmDashboardInvitationRow
} from '@core/services/firm-dashboard.service';
import {
  FirmGovernanceService,
  FirmGovernanceDashboard
} from '@core/services/firm-governance.service';
import { FirmFeatureFlagsService } from '@core/services/firm-feature-flags.service';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { StatCardComponent } from '@shared/components/stat-card/stat-card.component';
import { FirmInvitationActionsService } from '../shared/firm-invitation-actions.service';
import { FirmDecisionTablesSectionComponent } from './decision-tables/firm-decision-tables-section.component';
import { OnboardingChecklistComponent } from '@shared/onboarding/onboarding-checklist.component';
import { FirmAssignmentService } from '@core/services/firm-assignment.service';

interface GovernanceTile {
  label: string;
  subtitle: string;
  route: string;
  icon: string;
}

@Component({
  selector: 'app-firm-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ButtonModule,
    TagModule,
    PageHeaderComponent,
    StatCardComponent,
    FirmDecisionTablesSectionComponent,
    OnboardingChecklistComponent
  ],
  template: `
    <app-page-header
      [title]="'Tableau de bord cabinet'"
      [subtitle]="welcomeSubtitle()" />

    <app-onboarding-checklist />

    @if (profileNudge()) {
      <a class="profile-nudge" routerLink="/firm/settings/profile">
        Complétez votre fiche annuaire pour que les sociétés vous trouvent plus facilement.
      </a>
    }

    @if (loading()) {
      <p class="loading">Chargement…</p>
    } @else {
      <section class="dash-section">
        <h2 class="section-title">Alertes prioritaires</h2>
        <div class="stats-grid">
          <app-stat-card appearance="solid"
            label="Échéances en retard"
            [value]="dashboard()?.overdueSchedulesCount ?? 0"
            icon="fa-solid fa-calendar-xmark"
            [variant]="(dashboard()?.overdueSchedulesCount ?? 0) > 0 ? 'error' : 'success'"
            routerLink="/firm/fiscal-schedule">
            <span class="stat-amount">
              {{ (dashboard()?.overdueEstimatedAmount ?? 0) | number:'1.0-3' }} TND estimés
            </span>
          </app-stat-card>
          <app-stat-card appearance="solid"
            label="Échéances ≤ 7 jours"
            [value]="dashboard()?.upcomingWithin7DaysCount ?? 0"
            icon="fa-solid fa-calendar-day"
            variant="warning"
            routerLink="/firm/fiscal-schedule">
            <span class="stat-amount">
              {{ (dashboard()?.upcoming7DaysEstimatedAmount ?? 0) | number:'1.0-3' }} TND estimés
            </span>
          </app-stat-card>
        </div>
      </section>

      <section class="dash-section">
        <h2 class="section-title">Opérations &amp; fiscalité</h2>
        <div class="stats-grid">
          <app-stat-card appearance="solid"
            label="Dossiers actifs"
            [value]="dashboard()?.activeClientsCount ?? 0"
            icon="fa-solid fa-briefcase"
            variant="primary"
            routerLink="/firm/clients" />
          <app-stat-card appearance="solid"
            label="Invitations en attente"
            [value]="dashboard()?.pendingInvitationsCount ?? 0"
            icon="fa-solid fa-envelope-open-text"
            [variant]="(dashboard()?.pendingInvitationsCount ?? 0) > 0 ? 'warning' : 'success'"
            routerLink="/firm/invitations" />
          <app-stat-card appearance="solid"
            label="Dossiers inactifs (30j)"
            [value]="dashboard()?.inactiveDossiersCount ?? 0"
            icon="fa-solid fa-clock"
            [variant]="(dashboard()?.inactiveDossiersCount ?? 0) > 0 ? 'warning' : 'success'" />
          <app-stat-card appearance="solid"
            label="Déclarations TVA brouillon"
            [value]="dashboard()?.vatDraftsCount ?? 0"
            icon="fa-solid fa-file-invoice"
            variant="primary"
            routerLink="/firm/fiscal-schedule" />
          <app-stat-card appearance="solid"
            label="TEJ en attente"
            [value]="dashboard()?.tejPendingCount ?? 0"
            icon="fa-solid fa-file-export"
            variant="primary" />
          <app-stat-card appearance="solid"
            label="Liasse IS brouillon"
            [value]="dashboard()?.liasseDraftsCount ?? 0"
            icon="fa-solid fa-file-contract"
            variant="primary" />
          <app-stat-card appearance="solid"
            label="DTS CNSS en attente"
            [value]="dashboard()?.dtsPendingCount ?? 0"
            icon="fa-solid fa-users"
            variant="primary" />
        </div>
      </section>

      @if (governanceEnabled() && governance()) {
        <section class="dash-section">
          <h2 class="section-title">Gouvernance &amp; productivité</h2>
          <div class="stats-grid">
            <app-stat-card appearance="solid"
              label="Dossiers permanents complets"
              [value]="governance()!.permanentFilesCompleteCount"
              icon="fa-solid fa-folder-open"
              variant="success"
              routerLink="/firm/governance/permanent-files"
              [queryParams]="{ status: '2' }" />
            <app-stat-card appearance="solid"
              label="DP en cours"
              [value]="governance()!.permanentFilesInProgressCount"
              icon="fa-solid fa-pen"
              variant="warning"
              routerLink="/firm/governance/permanent-files"
              [queryParams]="{ status: '1' }" />
            <app-stat-card appearance="solid"
              label="Heures facturables (mois)"
              [value]="governance()!.totalBillableHoursMonth"
              icon="fa-solid fa-clock"
              variant="primary"
              routerLink="/firm/governance/time-sheets" />
            <app-stat-card appearance="solid"
              label="Heures facturables (année)"
              [value]="governance()!.totalBillableHoursYear"
              icon="fa-solid fa-chart-line"
              variant="primary"
              routerLink="/firm/governance/time-sheets" />
            <app-stat-card appearance="solid"
              label="Notes de frais en attente"
              [value]="governance()!.pendingExpenseNotesCount"
              icon="fa-solid fa-receipt"
              [variant]="governance()!.pendingExpenseNotesCount > 0 ? 'warning' : 'success'"
              routerLink="/firm/governance/expense-notes" />
          </div>
        </section>

        <section class="dash-section">
          <h2 class="section-title">Accès modules</h2>
          <div class="tiles">
            @for (tile of tiles; track tile.route) {
              <a [routerLink]="tile.route" class="tile">
                <i [class]="tile.icon"></i>
                <span class="tile-label">{{ tile.label }}</span>
                <span class="tile-sub">{{ tile.subtitle }}</span>
              </a>
            }
          </div>
        </section>
      }

      <div class="panels-grid">
        <section class="panel">
          <div class="panel-header">
            <h2>Mes dossiers</h2>
            <a routerLink="/firm/clients" pButton label="Voir tous" class="p-button-text"></a>
          </div>
          @if ((dashboard()?.clients?.length ?? 0) === 0) {
            <p class="empty" data-tour="firm-empty-clients">Aucun dossier client actif. Acceptez une invitation pour commencer.</p>
          } @else {
            <table class="dossier-table">
              <thead>
                <tr>
                  <th>Société</th>
                  <th>Actif depuis</th>
                  <th>Dernière écriture</th>
                  <th>Statut</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (c of dashboard()?.clients ?? []; track c.assignmentId) {
                  <tr>
                    <td>{{ c.companyName }}</td>
                    <td>{{ c.activeSince | date:'shortDate' }}</td>
                    <td>{{ c.lastJournalEntryDate ? (c.lastJournalEntryDate | date:'shortDate') : '—' }}</td>
                    <td>
                      @if (c.isInactive30Days) {
                        <p-tag severity="warn" value="Inactif 30j" />
                      } @else {
                        <p-tag severity="success" value="Actif" />
                      }
                    </td>
                    <td>
                      <a [routerLink]="['/firm/open', c.companyTenantId]" pButton label="Ouvrir comptabilité" class="p-button-sm"></a>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </section>

        <section class="panel">
          <div class="panel-header">
            <h2>Invitations en attente</h2>
            <a routerLink="/firm/invitations" pButton label="Gérer" class="p-button-text"></a>
          </div>
          @if ((dashboard()?.pendingInvitations?.length ?? 0) === 0) {
            <p class="empty">Aucune invitation en attente.</p>
          } @else {
            <ul class="invitation-list">
              @for (inv of dashboard()?.pendingInvitations ?? []; track inv.id) {
                <li>
                  <div>
                    <strong>{{ inv.companyName }}</strong>
                    <span class="muted">{{ inv.requestedAt | date:'short' }}</span>
                    @if (inv.notes) {
                      <p class="notes">{{ inv.notes }}</p>
                    }
                  </div>
                  @if (auth.isFirmManager()) {
                    <div class="actions">
                      <button type="button" pButton label="Accepter" class="p-button-sm p-button-success" (click)="accept(inv)"></button>
                      <button type="button" pButton label="Refuser" class="p-button-sm p-button-outlined" (click)="reject(inv)"></button>
                    </div>
                  }
                </li>
              }
            </ul>
          }
        </section>
      </div>

      @if (decisionTablesEnabled()) {
        <app-firm-decision-tables-section />
      }
    }
  `,
  styles: [`
    .loading, .empty { color: var(--color-neutral-600); padding: 1rem 0; }
    .profile-nudge {
      display: block;
      margin: 0 0 16px;
      padding: 12px 16px;
      border-radius: 12px;
      background: var(--color-primary-50, #eff6ff);
      color: var(--color-primary-800, #1e40af);
      text-decoration: none;
      font-size: 0.9rem;
    }
    .dash-section { margin-bottom: 1.5rem; }
    .section-title {
      margin: 0 0 0.75rem;
      font-size: 1rem;
      font-weight: 600;
      color: var(--color-neutral-700, #334155);
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 1rem;
    }
    .stat-amount {
      display: block;
      margin-top: 0.35rem;
      font-size: 0.75rem;
      color: var(--color-text-muted, #64748b);
    }
    .tiles {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 1rem;
    }
    .tile {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: .35rem;
      padding: 1.5rem;
      border-radius: .75rem;
      border: 1px solid var(--color-border-subtle, #e5e7eb);
      background: var(--color-background-elevated, #fff);
      text-decoration: none;
      color: inherit;
      min-height: 130px;
      text-align: center;
    }
    .tile i {
      font-size: 1.75rem;
      color: var(--color-primary, #0d9488);
      margin-bottom: .25rem;
    }
    .tile-label { font-weight: 600; font-size: .95rem; }
    .tile-sub {
      font-size: .75rem;
      color: var(--color-text-muted, #64748b);
      line-height: 1.3;
    }
    .tile:hover { box-shadow: 0 4px 12px rgba(0,0,0,.08); }
    .panels-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 1.25rem;
      margin-bottom: 1.25rem;
    }
    .panel {
      background: var(--color-background-elevated, #fff);
      border: 1px solid var(--color-border-subtle, #e2e8f0);
      border-radius: var(--radius-xl, 12px);
      padding: 1.25rem;
    }
    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1rem;
    }
    .panel-header h2 { margin: 0; font-size: 1.1rem; }
    .dossier-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    .dossier-table th, .dossier-table td {
      padding: 0.6rem 0.5rem;
      text-align: left;
      border-bottom: 1px solid var(--color-border-subtle, #e2e8f0);
    }
    .invitation-list { list-style: none; margin: 0; padding: 0; }
    .invitation-list li {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 1rem;
      padding: 0.75rem 0;
      border-bottom: 1px solid var(--color-border-subtle, #e2e8f0);
    }
    .muted { color: var(--color-neutral-500); margin-left: 0.5rem; font-size: 0.85rem; }
    .notes { margin: 0.25rem 0 0; font-size: 0.85rem; color: var(--color-neutral-600); }
    .actions { display: flex; gap: 0.5rem; flex-shrink: 0; }
  `]
})
export class FirmDashboardComponent implements OnInit {
  readonly auth = inject(AuthService);
  private readonly dashboardService = inject(FirmDashboardService);
  private readonly governanceService = inject(FirmGovernanceService);
  private readonly featureFlags = inject(FirmFeatureFlagsService);
  private readonly actions = inject(FirmInvitationActionsService);
  private readonly assignments = inject(FirmAssignmentService);

  readonly loading = signal(true);
  readonly profileNudge = signal(false);
  readonly dashboard = signal<FirmDashboardData | null>(null);
  readonly governance = signal<FirmGovernanceDashboard | null>(null);
  readonly governanceEnabled = signal(false);

  decisionTablesEnabled(): boolean {
    return this.governanceEnabled()
      && this.featureFlags.isEnabled('firmDecisionTables')
      && this.auth.isFirmManager();
  }

  readonly tiles: GovernanceTile[] = [
    {
      label: 'Dossiers permanents',
      subtitle: 'Identité juridique & conformité TN',
      route: '/firm/governance/permanent-files',
      icon: 'fa-solid fa-folder-open'
    },
    {
      label: 'Feuilles de temps',
      subtitle: 'Saisie des heures facturables',
      route: '/firm/governance/time-sheets',
      icon: 'fa-solid fa-clock'
    },
    {
      label: 'Notes de frais',
      subtitle: 'Notes de frais dirigeants',
      route: '/firm/governance/expense-notes',
      icon: 'fa-solid fa-receipt'
    },
    {
      label: 'Invitations clients',
      subtitle: 'Demandes de liaison cabinet',
      route: '/firm/invitations',
      icon: 'fa-solid fa-envelope-open-text'
    },
    {
      label: 'Échéancier fiscal',
      subtitle: 'Obligations TVA, TEJ, liasse',
      route: '/firm/fiscal-schedule',
      icon: 'fa-solid fa-calendar-check'
    }
  ];

  ngOnInit(): void {
    this.loadDashboard();
    if (this.auth.isFirmManager()) {
      this.assignments.getMyProfile().subscribe({
        next: r => {
          const profile = r.success ? r.data : null;
          this.profileNudge.set(!!profile && (profile.completeness < 80 || !profile.isPublicInDirectory));
        },
        error: () => this.profileNudge.set(false)
      });
    }
  }

  welcomeSubtitle(): string {
    const name = this.auth.user()?.companyName ?? 'Cabinet';
    const date = new Date().toLocaleDateString('fr-TN', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
    const base = `Bienvenue, ${name} — ${date}`;
    return this.governanceEnabled()
      ? `${base} · Conformité, productivité et pilotage multi-dossiers`
      : base;
  }

  loadDashboard(): void {
    this.loading.set(true);
    const govOn = this.featureFlags.isEnabled('firmGovernance');
    this.governanceEnabled.set(govOn);

    if (!govOn) {
      this.governance.set(null);
      this.dashboardService.getDashboard().subscribe({
        next: r => {
          if (r.success) this.dashboard.set(r.data);
          this.loading.set(false);
        },
        error: () => this.loading.set(false)
      });
      return;
    }

    const emptyGov: ApiResponse<FirmGovernanceDashboard | null> = {
      success: false,
      data: null,
      message: null,
      errors: []
    };

    forkJoin({
      firm: this.dashboardService.getDashboard(),
      gov: this.governanceService.getDashboard().pipe(catchError(() => of(emptyGov)))
    }).subscribe({
      next: ({ firm, gov }) => {
        if (firm.success) this.dashboard.set(firm.data);
        this.governance.set(gov.success && gov.data ? gov.data : null);
        this.loading.set(false);
      },
      error: () => {
        this.governance.set(null);
        this.loading.set(false);
      }
    });
  }

  async accept(inv: FirmDashboardInvitationRow): Promise<void> {
    if (await this.actions.accept(inv)) this.loadDashboard();
  }

  async reject(inv: FirmDashboardInvitationRow): Promise<void> {
    if (await this.actions.reject(inv)) this.loadDashboard();
  }
}
