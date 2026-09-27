/// <reference types="@angular/localize" />
import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';
import { finalize } from 'rxjs/operators';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { AccountingService, AccountingPeriodDto, FiscalYearLockDto } from '../services/accounting.service';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import { AccountingCorrectionBannerComponent } from '../shared/accounting-correction-banner.component';
import { AnalyzeWithAiButtonComponent } from '@features/ai-assistant/components/analyze-with-ai-button/analyze-with-ai-button.component';
import { wrapLegacyAnalyzePayload } from '@features/ai-assistant/utils/ai-screen-payload.factory';

@Component({
  selector: 'app-accounting-closing',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    TableModule,
    ConfirmDialogModule,
    PageHeaderComponent,
    AccountingStatusBannerComponent,
    AccountingCorrectionBannerComponent,
    AnalyzeWithAiButtonComponent
  ],
  providers: [ConfirmationService],
  template: `
    <app-page-header title="Clôture des périodes" i18n-title="@@accounting.closing.cloture.des.periodes.23eeb3ca" subtitle="Verrouillage mensuel des écritures" i18n-subtitle="@@accounting.closing.verrouillage.mensuel.des.ecritures.9b3a6eed" />
    <app-accounting-correction-banner />
    <p-confirmDialog />

    <app-accounting-status-banner variant="error" [message]="error() ?? ''" [showRetry]="!!error()" retryLabel="Réessayer" i18n-retryLabel="@@accounting.closing.reessayer.c4f78b12" (retry)="refresh()" />
    <app-accounting-status-banner variant="success" [message]="success() ?? ''" />

    @if (lockedYears().length > 0) {
      <div class="closing-locks" role="note" i18n="@@accounting.closing.exercice.s.verrouille.s.definitivement.c.77083646">
        <i class="pi pi-lock" aria-hidden="true"></i>
        <span>Exercice(s) verrouillé(s) définitivement : {{ lockedYearsLabel() }}. Ces exercices ne peuvent plus être rouverts ni modifiés.</span>
      </div>
    }

    <div class="card closing-card">
      <div class="closing-year-bar">
        <label class="field-label" for="fy-close" i18n="@@accounting.closing.exercice.e171e2b0">Exercice</label>
        <input id="fy-close" type="number" [(ngModel)]="fiscalYearInput" min="2000" max="2100"
          class="closing-input" />
        <a class="btn btn-outline-secondary" [routerLink]="['/accounting/pre-closing']" [queryParams]="{ }" i18n="@@accounting.closing.controles.de.pre.cloture.bb15f8fd">
          <i class="pi pi-list-check" aria-hidden="true"></i> Contrôles de pré-clôture
        </a>
        <button type="button" class="btn btn-warning" (click)="confirmCloseYear()" [disabled]="loading() || isYearLocked(fiscalYearInput)" i18n="@@accounting.closing.cloturer.l.exercice.cd0d9b56"> Clôturer l'exercice </button>
        <button type="button" class="btn btn-primary" (click)="confirmGenerateOpeningEntries()" [disabled]="loading() || isYearLocked(fiscalYearInput)" i18n="@@accounting.closing.ecritures.d.a.nouveau.d0348a61"> Ecritures d'a-nouveau </button>
        <button type="button" class="btn btn-outline-danger" (click)="confirmLockYear()" [disabled]="loading() || isYearLocked(fiscalYearInput)" i18n="@@accounting.closing.verrouiller.definitivement.a87416b3">
          <i class="pi pi-lock" aria-hidden="true"></i> Verrouiller définitivement
        </button>
        <button type="button" class="btn btn-outline-primary" (click)="exportFec()" [disabled]="loading() || exportingFec()">
          @if (exportingFec()) {
            <i class="pi pi-spin pi-spinner" aria-hidden="true"></i>
          } @else {
            <i class="pi pi-download" aria-hidden="true"></i>
          }<ng-container i18n="@@accounting.closing.exporter.fec.088bf139">
          Exporter FEC
        </ng-container></button>
        <app-analyze-with-ai-button
          screenId="accounting-closing"
          [payloadBuilder]="buildClosingAnalyzePayload"
          [disabled]="loading()" />
      </div>
    </div>

    <p-table [value]="periods()" [paginator]="true" [rows]="12" [loading]="loading()"
      [rowHover]="true" styleClass="p-datatable-sm">
      <ng-template pTemplate="header">
        <tr>
          <th i18n="@@accounting.closing.exercice.e171e2b0">Exercice</th>
          <th i18n="@@accounting.closing.mois.0d304bea">Mois</th>
          <th i18n="@@accounting.closing.cloturee.da2e2bc8">Clôturée</th>
          <th i18n="@@accounting.closing.action.97c89a4d">Action</th>
        </tr>
      </ng-template>
      <ng-template pTemplate="body" let-p>
        <tr>
          <td>{{ p.fiscalYear }}</td>
          <td>{{ p.month }}</td>
          <td>
            <span class="closing-badge" [class.closing-badge--closed]="p.isClosed" [class.closing-badge--open]="!p.isClosed">
              {{ p.isClosed ? loc_ui_tern_oui_eaa02f : loc_ui_tern_non_a72199 }}
            </span>
          </td>
          <td>
            @if (!p.isClosed) {
              <button type="button" class="btn btn-sm btn-outline-danger" (click)="confirmClose(p.id, p.month, p.fiscalYear)" [disabled]="loading()" i18n="@@accounting.closing.cloturer.e9f075c1">Clôturer</button>
            } @else if (isYearLocked(p.fiscalYear)) {
              <span class="closing-locked-tag" i18n="@@accounting.closing.verrouille.e63b99c3"><i class="pi pi-lock" aria-hidden="true"></i> Verrouillé</span>
            } @else {
              <button type="button" class="btn btn-sm btn-outline-secondary" (click)="confirmReopen(p.id, p.month, p.fiscalYear)" [disabled]="loading()" i18n="@@accounting.closing.reouvrir.10968fea">Réouvrir</button>
            }
          </td>
        </tr>
      </ng-template>
      <ng-template pTemplate="emptymessage">
        <tr><td colspan="4" style="text-align:center;padding:2rem" i18n="@@accounting.closing.aucune.periode.enregistree.869c0e9d">Aucune période enregistrée.</td></tr>
      </ng-template>
    </p-table>
  `,
  styles: `
    .closing-card { padding:var(--spacing-4); border-radius:var(--radius-lg); box-shadow:var(--shadow-sm); margin-bottom:var(--spacing-4); }
    .closing-year-bar { display:flex; flex-wrap:wrap; align-items:flex-end; gap:var(--spacing-3); }
    .field-label { font-size:var(--font-size-sm); font-weight:var(--font-weight-semibold); color:var(--color-text-primary); }
    .closing-input { padding:var(--spacing-2) var(--spacing-3); border:1px solid var(--color-border-default); border-radius:var(--radius-md); width:6rem; min-height:2.5rem; }
    .closing-badge { padding:0.2rem 0.5rem; border-radius:var(--radius-md); font-size:var(--font-size-xs); font-weight:var(--font-weight-semibold); }
    .closing-badge--closed { background:var(--color-success-50,#f0fdf4); color:var(--color-success-700,#15803d); border:1px solid var(--color-success-200); }
    .closing-badge--open { background:var(--color-warning-50,#fffbeb); color:var(--color-warning-700,#a16207); border:1px solid var(--color-warning-200); }
    .text-success { color:var(--color-success-600); }
    .closing-locks {
      display:flex; align-items:center; gap:var(--spacing-2);
      padding:var(--spacing-3) var(--spacing-4); margin-bottom:var(--spacing-4);
      background:var(--color-danger-50,#fef2f2); color:var(--color-danger-700,#b91c1c);
      border:1px solid var(--color-danger-200,#fecaca); border-radius:var(--radius-md); font-size:var(--font-size-sm);
    }
    .closing-locked-tag { display:inline-flex; align-items:center; gap:4px; font-size:var(--font-size-xs); font-weight:var(--font-weight-semibold); color:var(--color-danger-700,#b91c1c); }
  `
})
export class ClosingComponent implements OnInit {
  readonly loc_ui_tern_oui_eaa02f = $localize`:@@ui.tern.oui.eaa02f:Oui`;
  readonly loc_ui_tern_non_a72199 = $localize`:@@ui.tern.non.a72199:Non`;
  private readonly api = inject(AccountingService);
  private readonly confirmService = inject(ConfirmationService);
  private readonly errorHandler = inject(ErrorHandlerService);
  private readonly route = inject(ActivatedRoute);
  readonly periods = signal<AccountingPeriodDto[]>([]);
  readonly lockedYears = signal<FiscalYearLockDto[]>([]);
  readonly error = signal<string | null>(null);
  readonly success = signal<string | null>(null);
  readonly loading = signal(false);
  readonly exportingFec = signal(false);
  fiscalYearInput = new Date().getFullYear();

  isYearLocked(year: number): boolean {
    return this.lockedYears().some(l => l.fiscalYear === year);
  }

  lockedYearsLabel(): string {
    return this.lockedYears().map(l => l.fiscalYear).sort((a, b) => a - b).join(', ');
  }

  readonly buildClosingAnalyzePayload = (): unknown =>
    wrapLegacyAnalyzePayload(
      'accounting-closing',
      {
        screen: 'accounting-closing',
        fiscalYearInput: this.fiscalYearInput,
        periods: this.periods().map(p => ({
          fiscalYear: p.fiscalYear,
          month: p.month,
          startDate: p.startDate,
          endDate: p.endDate,
          isClosed: p.isClosed
        }))
      } as Record<string, unknown>,
      { rowsKey: 'periods' }
    );

  ngOnInit(): void {
    const fy = this.route.snapshot.queryParamMap.get('fiscalYear');
    if (fy) {
      const year = Number(fy);
      if (!Number.isNaN(year)) this.fiscalYearInput = year;
    }
    this.refresh();
  }

  exportFec(): void {
    const y = this.fiscalYearInput;
    this.exportingFec.set(true);
    this.error.set(null);
    this.success.set(null);
    this.api.exportFec(y).subscribe({
      next: blob => {
        this.exportingFec.set(false);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `FEC_${y}.txt`;
        a.click();
        URL.revokeObjectURL(url);
        this.success.set($localize`:@@accounting.closing.ts.export.fec.y.telecharge.2c478a46:Export FEC ${y}:y: téléchargé.`);
      },
      error: err => {
        this.exportingFec.set(false);
        this.error.set(this.httpFailureMessage(err, $localize`:@@accounting.closing.ts.erreur.reseau.lors.de.l.export.fec.44e1be71:Erreur réseau lors de l'export FEC.`));
      }
    });
  }

  confirmGenerateOpeningEntries(): void {
    const y = this.fiscalYearInput;
    this.confirmService.confirm({
      message: $localize`:@@accounting.closing.ts.generer.les.ecritures.d.a.nouveau.pour.l.7bd2b52b:Generer les ecritures d'a-nouveau pour l'exercice ${y + 1}:p: a partir des soldes de ${y}:y: ?`,
      header: $localize`:@@accounting.closing.ts.ecritures.d.a.nouveau.d0348a61:Ecritures d'a-nouveau`,
      icon: 'pi pi-book',
      acceptLabel: $localize`:@@closing.component.acceptLabel.Generer:Generer`,
      rejectLabel: $localize`:@@closing.component.rejectLabel.Annuler:Annuler`,
      accept: () => {
        this.loading.set(true);
        this.error.set(null);
        this.success.set(null);
        this.api.generateOpeningEntries(y).subscribe({
          next: res => {
            this.loading.set(false);
            if (res.success) {
              this.success.set($localize`:@@accounting.closing.ts.ecritures.d.a.nouveau.generees.pour.l.ex.5c92efd1:Ecritures d'a-nouveau generees pour l'exercice ${y + 1}:p:.`);
            } else {
              this.error.set(res.error ?? $localize`:@@ui.tern.erreur.ab546c:Erreur`);
            }
          },
          error: err => {
            this.loading.set(false);
            this.error.set(
              this.httpFailureMessage(err, $localize`:@@accounting.closing.ts.erreur.reseau.lors.de.la.generation.des.1efc02dc:Erreur réseau lors de la génération des à-nouveau.`)
            );
          }
        });
      }
    });
  }

  confirmCloseYear(): void {
    const y = this.fiscalYearInput;
    this.confirmService.confirm({
      message: $localize`:@@accounting.closing.ts.cloturer.tous.les.mois.enregistres.pour.9c9cdfb7:Clôturer tous les mois enregistrés pour l'exercice ${y}:y: ?`,
      header: $localize`:@@accounting.closing.ts.confirmation.3424edc2:Confirmation`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: $localize`:@@closing.component.acceptLabel.Clôturer:Clôturer`,
      rejectLabel: $localize`:@@closing.component.rejectLabel.Annuler:Annuler`,
      accept: () => {
        this.loading.set(true);
        this.error.set(null);
        this.success.set(null);
        this.api.closeAnnualYear(y).subscribe({
          next: res => {
            this.loading.set(false);
            if (res.success) {
              this.success.set($localize`:@@accounting.closing.ts.exercice.y.cloture.78e5dcf1:Exercice ${y}:y: clôturé.`);
              this.refresh();
            } else {
              this.error.set(res.error ?? $localize`:@@ui.tern.erreur.ab546c:Erreur`);
            }
          },
          error: err => {
            this.loading.set(false);
            this.error.set(
              this.httpFailureMessage(err, $localize`:@@accounting.closing.ts.erreur.reseau.lors.de.la.cloture.de.l.ex.4ca4d8b8:Erreur réseau lors de la clôture de l'exercice.`)
            );
          }
        });
      }
    });
  }

  refresh(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api
      .getPeriods()
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: r => {
          if (r.success && r.data) this.periods.set(r.data);
          else this.error.set(r.error ?? $localize`:@@ui.tern.erreur.ab546c:Erreur`);
        },
        error: err =>
          this.error.set(this.httpFailureMessage(err, $localize`:@@accounting.closing.ts.erreur.reseau.impossible.de.charger.les.dcc3ca2a:Erreur réseau. Impossible de charger les périodes.`))
      });
    this.api.getFiscalYearLocks().subscribe({
      next: r => { if (r.success && r.data) this.lockedYears.set(r.data); }
    });
  }

  confirmLockYear(): void {
    const y = this.fiscalYearInput;
    this.confirmService.confirm({
      message: $localize`:@@accounting.closing.ts.verrouiller.definitivement.l.exercice.y.81e541ec:Verrouiller DÉFINITIVEMENT l'exercice ${y}:y: ? Cette action est IRRÉVERSIBLE : aucune écriture ne pourra plus y être enregistrée et ses périodes ne pourront plus être rouvertes. Assurez-vous d'avoir résolu les contrôles de pré-clôture et généré les à-nouveaux.`,
      header: $localize`:@@accounting.closing.ts.verrouillage.definitif.1aef2d75:Verrouillage définitif`,
      icon: 'pi pi-lock',
      acceptLabel: $localize`:@@closing.component.acceptLabel.Verrouiller_d_fi:Verrouiller définitivement`,
      rejectLabel: $localize`:@@closing.component.rejectLabel.Annuler:Annuler`,
      accept: () => {
        this.loading.set(true);
        this.error.set(null);
        this.success.set(null);
        this.api.lockFiscalYear(y).subscribe({
          next: res => {
            this.loading.set(false);
            if (res.success) {
              this.success.set($localize`:@@accounting.closing.ts.exercice.y.verrouille.definitivement.949ff1c0:Exercice ${y}:y: verrouillé définitivement.`);
              this.refresh();
            } else {
              this.error.set(res.error ?? $localize`:@@ui.tern.erreur.lors.du.verrouillage.0bbd74:Erreur lors du verrouillage.`);
            }
          },
          error: err => {
            this.loading.set(false);
            this.error.set(this.httpFailureMessage(err, $localize`:@@accounting.closing.ts.erreur.reseau.lors.du.verrouillage.31827190:Erreur réseau lors du verrouillage.`));
          }
        });
      }
    });
  }

  confirmClose(id: string, month: number, year: number): void {
    this.confirmService.confirm({
      message: $localize`:@@accounting.closing.ts.cloturer.la.periode.month.year.3afeb2b7:Clôturer la période ${month}:month:/${year}:year: ?`,
      header: $localize`:@@accounting.closing.ts.confirmation.3424edc2:Confirmation`,
      icon: 'pi pi-lock',
      acceptLabel: $localize`:@@closing.component.acceptLabel.Clôturer:Clôturer`,
      rejectLabel: $localize`:@@closing.component.rejectLabel.Annuler:Annuler`,
      accept: () => {
        this.loading.set(true);
        this.error.set(null);
        this.success.set(null);
        this.api.closePeriod(id).subscribe({
          next: res => {
            this.loading.set(false);
            if (res.success) {
              this.success.set($localize`:@@accounting.closing.ts.periode.month.year.cloturee.b0561dc7:Période ${month}:month:/${year}:year: clôturée.`);
              this.refresh();
            } else {
              this.error.set(res.error ?? $localize`:@@ui.tern.erreur.lors.de.la.cloture.e012f5:Erreur lors de la clôture.`);
            }
          },
          error: err => {
            this.loading.set(false);
            this.error.set(this.httpFailureMessage(err, $localize`:@@accounting.closing.ts.erreur.reseau.lors.de.la.cloture.9100a651:Erreur réseau lors de la clôture.`));
          }
        });
      }
    });
  }

  confirmReopen(id: string, month: number, year: number): void {
    this.confirmService.confirm({
      message: $localize`:@@accounting.closing.ts.reouvrir.la.periode.month.year.les.ecrit.d2ef9bb5:Réouvrir la période ${month}:month:/${year}:year: ? Les écritures pourront à nouveau être modifiées.`,
      header: $localize`:@@accounting.closing.ts.confirmation.3424edc2:Confirmation`,
      icon: 'pi pi-unlock',
      acceptLabel: $localize`:@@closing.component.acceptLabel.Réouvrir:Réouvrir`,
      rejectLabel: $localize`:@@closing.component.rejectLabel.Annuler:Annuler`,
      accept: () => {
        this.loading.set(true);
        this.error.set(null);
        this.success.set(null);
        this.api.reopenPeriod(id).subscribe({
          next: res => {
            this.loading.set(false);
            if (res.success) {
              this.success.set($localize`:@@accounting.closing.ts.periode.month.year.reouverte.0059da14:Période ${month}:month:/${year}:year: réouverte.`);
              this.refresh();
            } else {
              this.error.set(res.error ?? $localize`:@@ui.tern.erreur.lors.de.la.reouverture.d5e49a:Erreur lors de la réouverture.`);
            }
          },
          error: err => {
            this.loading.set(false);
            this.error.set(this.httpFailureMessage(err, $localize`:@@accounting.closing.ts.erreur.reseau.lors.de.la.reouverture.5faacfd8:Erreur réseau lors de la réouverture.`));
          }
        });
      }
    });
  }

  /** Messages API (4xx/5xx) via ErrorHandlerService ; repli « erreur réseau » seulement si status 0 (pas de réponse HTTP). */
  private httpFailureMessage(err: unknown, networkFallback: string): string {
    const he = err as HttpErrorResponse;
    if (he?.status === 0) {
      return networkFallback;
    }
    return this.errorHandler.extractErrorMessage(err);
  }
}
