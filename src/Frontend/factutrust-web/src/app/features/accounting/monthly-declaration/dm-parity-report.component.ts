import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonComponent } from '@shared/components/button/button.component';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import { downloadBlob } from '../shared/accounting-download.util';
import {
  AccountingService,
  MonthlyDeclarationDiagnosticDto,
  MonthlyDeclarationParityFamilyDto,
  MonthlyDeclarationParityMonthDto,
  MonthlyDeclarationParityReportDto,
  ParityVerdict
} from '../services/accounting.service';
import { familyLabel } from './monthly-declaration-config.view-model';
import { describeDiagnostic } from './monthly-declaration-compute.view-model';
import {
  defaultParityRange,
  describeParityReport,
  parityCsv,
  parityFileName,
  parityMonthLabel,
  parityVerdictLabel,
  parityVerdictTone,
  validateParityRange,
  visibleParityFamilies
} from './monthly-declaration-parity.view-model';

/**
 * « Contrôle avant retrait du calcul historique » — rapport de parité.
 *
 * Lecture pure : le serveur calcule chaque mois des deux façons sans toucher au régime du dossier
 * ni à sa rampe. L'écran met en forme la preuve et permet de l'exporter : une fois l'historique
 * retiré, elle ne pourra plus être produite.
 */
@Component({
  selector: 'app-dm-parity-report',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent, AccountingStatusBannerComponent],
  template: `
    <section class="card dm-parity">
      <h2 class="dm-parity__title" i18n="@@accounting.monthly-declaration.controle.avant.retrait.du.calcul.historique.0aa593e0">Contrôle avant retrait du calcul historique</h2>
      <p class="dm-parity__hint" i18n="@@accounting.monthly-declaration.compare.mois.par.mois.le.calcul.historique.au.ca.509cf13e">
        Compare, mois par mois, le calcul historique au calcul paramétré tel qu’il sera une fois
        l’historique retiré — montants par famille et cases du formulaire officiel. Rien n’est
        enregistré, et la rampe de bascule n’est pas modifiée.
      </p>

      <div class="dm-parity__form">
        <div class="dm-field">
          <label class="dm-lbl" for="dm-parity-year" i18n="@@accounting.monthly-declaration.exercice.e171e2b0">Exercice</label>
          <input id="dm-parity-year" type="number" class="dm-inp dm-narrow" min="2000" max="2100"
            [(ngModel)]="year" [disabled]="disabled || running()" />
        </div>
        <div class="dm-field">
          <label class="dm-lbl" for="dm-parity-from" i18n="@@accounting.monthly-declaration.du.mois.5a23e30b">Du mois</label>
          <input id="dm-parity-from" type="number" class="dm-inp dm-narrow" min="1" max="12"
            [(ngModel)]="fromMonth" [disabled]="disabled || running()" />
        </div>
        <div class="dm-field">
          <label class="dm-lbl" for="dm-parity-to" i18n="@@accounting.monthly-declaration.au.mois.0f235b41">Au mois</label>
          <input id="dm-parity-to" type="number" class="dm-inp dm-narrow" min="1" max="12"
            [(ngModel)]="toMonth" [disabled]="disabled || running()" />
        </div>
        <app-button variant="secondary" icon="pi-check-square" type="button"
          [disabled]="disabled || running() || !!rangeError()" (click)="run()">
          {{ running() ? 'Contrôle en cours…' : 'Lancer le contrôle' }}
        </app-button>
      </div>

      @if (rangeError(); as message) {
        <p class="dm-parity__invalid">{{ message }}</p>
      }
      <app-accounting-status-banner variant="error" [message]="error() ?? ''" />

      @if (report(); as r) {
        <div class="dm-parity__summary" [class.dm-parity__summary--ready]="r.readyForRetirement">
          <p class="dm-parity__conclusion">{{ conclusion(r) }}</p>
          <div class="dm-parity__exports">
            <app-button variant="secondary" size="sm" icon="pi-download" type="button" (click)="exportJson(r)" i18n="@@accounting.monthly-declaration.exporter.la.preuve.json.e995fe42">
              Exporter la preuve (JSON)
            </app-button>
            <app-button variant="secondary" size="sm" icon="pi-file" type="button" (click)="exportCsv(r)" i18n="@@accounting.monthly-declaration.exporter.en.tableur.csv.8c642f15">
              Exporter en tableur (CSV)
            </app-button>
          </div>
        </div>

        @for (m of r.months; track m.month) {
          <details class="dm-parity__month" [open]="m.verdict === gap">
            <summary>
              <span class="dm-parity__month-name">{{ monthLabel(r, m.month) }}</span>
              <span [class]="'dm-tag dm-tag--' + tone(m.verdict)">{{ verdictLabel(m.verdict) }}</span>
              @if (m.savedStatus !== null && m.savedStatus !== undefined) {
                <span class="dm-parity__saved" i18n="@@accounting.monthly-declaration.declaration.enregistree.ed5d4974">déclaration enregistrée</span>
              }
            </summary>

            @if (m.error) {
              <p class="dm-parity__invalid">{{ m.error }}</p>
            } @else {
              <table class="dm-parity__table">
                <thead>
                  <tr>
                    <th scope="col" i18n="@@accounting.monthly-declaration.famille.3b0121d3">Famille</th>
                    <th scope="col" class="num" i18n="@@accounting.monthly-declaration.historique.34f3a06a">Historique</th>
                    <th scope="col" class="num" i18n="@@accounting.monthly-declaration.parametre.4befac1b">Paramétré</th>
                    <th scope="col" class="num" i18n="@@accounting.monthly-declaration.ecart.6ae8dce8">Écart</th>
                    <th scope="col" i18n="@@accounting.monthly-declaration.verdict.7f6e5a6e">Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  @for (f of families(m); track f.family) {
                    <tr>
                      <td>
                        {{ familyName(f) }}
                        @if (!f.isIncluded) { <span class="dm-parity__excluded" i18n="@@accounting.monthly-declaration.non.cochee.ed580872">non cochée</span> }
                      </td>
                      <td class="num">{{ f.legacy | number: '1.3-3' }}</td>
                      <td class="num">{{ f.configured | number: '1.3-3' }}</td>
                      <td class="num">{{ f.gap | number: '1.3-3' }}</td>
                      <td><span [class]="'dm-tag dm-tag--' + tone(f.verdict)">{{ verdictLabel(f.verdict) }}</span></td>
                    </tr>
                  } @empty {
                    <tr><td colspan="5" class="dm-parity__empty" i18n="@@accounting.monthly-declaration.aucun.montant.sur.ce.mois.d.un.cote.comme.de.l.a.3cd15921">Aucun montant sur ce mois, d’un côté comme de l’autre.</td></tr>
                  }
                </tbody>
              </table>

              @if (m.boxDifferences.length) {
                <h3 class="dm-parity__subtitle" i18n="@@accounting.monthly-declaration.cases.du.formulaire.officiel.qui.different.85ae6d68">Cases du formulaire officiel qui diffèrent</h3>
                <table class="dm-parity__table">
                  <thead>
                    <tr>
                      <th scope="col" i18n="@@accounting.monthly-declaration.case.9254c4bb">Case</th>
                      <th scope="col" class="num" i18n="@@accounting.monthly-declaration.historique.34f3a06a">Historique</th>
                      <th scope="col" class="num" i18n="@@accounting.monthly-declaration.parametre.4befac1b">Paramétré</th>
                      <th scope="col" i18n="@@accounting.monthly-declaration.verdict.7f6e5a6e">Verdict</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (b of m.boxDifferences; track b.key) {
                      <tr>
                        <td class="dm-mono">{{ b.key }}</td>
                        <td class="num">{{ b.legacy ?? '—' }}</td>
                        <td class="num">{{ b.configured ?? '—' }}</td>
                        <td><span [class]="'dm-tag dm-tag--' + tone(b.verdict)">{{ verdictLabel(b.verdict) }}</span></td>
                      </tr>
                    }
                  </tbody>
                </table>
              }

              @if (m.diagnostics.length) {
                <ul class="dm-parity__diags">
                  @for (d of m.diagnostics; track $index) {
                    <li>{{ describe(d) }}</li>
                  }
                </ul>
              }
            }
          </details>
        }
      }
    </section>
  `,
  styles: `
    .dm-parity { display: flex; flex-direction: column; gap: var(--spacing-3); margin-top: var(--spacing-4); }
    .dm-parity__title { margin: 0; font-size: var(--font-size-md); font-weight: var(--font-weight-semibold); }
    .dm-parity__hint { margin: 0; font-size: var(--font-size-sm); color: var(--color-text-secondary); }
    .dm-parity__form { display: flex; flex-wrap: wrap; gap: var(--spacing-3); align-items: flex-end; }
    .dm-field { display: flex; flex-direction: column; gap: var(--spacing-1); }
    .dm-lbl { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); }
    .dm-inp { padding: var(--spacing-2) var(--spacing-3); border: 1px solid var(--color-border-default); border-radius: var(--radius-md); background: var(--color-background-elevated); color: var(--color-text-primary); font-size: var(--font-size-sm); }
    .dm-narrow { width: 7rem; }
    .dm-mono { font-family: var(--font-family-mono, monospace); font-size: var(--font-size-xs); }
    .dm-parity__invalid { margin: 0; font-size: var(--font-size-sm); color: var(--color-error-700, #b91c1c); }
    .dm-parity__summary { display: flex; flex-wrap: wrap; gap: var(--spacing-3); align-items: center; justify-content: space-between; padding: var(--spacing-3); border-inline-start: 3px solid var(--color-error-500, #ef4444); background: var(--color-background-subtle, #f8fafc); border-radius: var(--radius-md); }
    .dm-parity__summary--ready { border-inline-start-color: var(--color-success-500, #22c55e); }
    .dm-parity__conclusion { margin: 0; flex: 1 1 24rem; font-size: var(--font-size-sm); }
    .dm-parity__exports { display: flex; flex-wrap: wrap; gap: var(--spacing-2); }
    .dm-parity__month { border: 1px solid var(--color-border-default); border-radius: var(--radius-md); padding: var(--spacing-2) var(--spacing-3); }
    .dm-parity__month > summary { display: flex; flex-wrap: wrap; gap: var(--spacing-2); align-items: center; cursor: pointer; }
    .dm-parity__month-name { font-weight: var(--font-weight-semibold); font-size: var(--font-size-sm); }
    .dm-parity__saved, .dm-parity__excluded { font-size: var(--font-size-xs); color: var(--color-text-tertiary); }
    .dm-parity__subtitle { margin: var(--spacing-3) 0 var(--spacing-1); font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); }
    .dm-parity__table { width: 100%; border-collapse: collapse; margin-top: var(--spacing-2); font-size: var(--font-size-sm); }
    .dm-parity__table th, .dm-parity__table td { padding: var(--spacing-1) var(--spacing-2); border-bottom: 1px solid var(--color-border-subtle, #e5e7eb); text-align: start; }
    .dm-parity__table .num { text-align: end; font-variant-numeric: tabular-nums; }
    .dm-parity__empty { color: var(--color-text-tertiary); }
    .dm-parity__diags { margin: var(--spacing-2) 0 0; padding-inline-start: var(--spacing-5); font-size: var(--font-size-sm); color: var(--color-warning-700, #a16207); }
    .dm-tag { padding: 0.1rem 0.5rem; border-radius: var(--radius-pill, 999px); font-size: var(--font-size-xs); font-weight: var(--font-weight-semibold); }
    .dm-tag--success { background: var(--color-success-50, #f0fdf4); color: var(--color-success-700, #15803d); }
    .dm-tag--warning { background: var(--color-warning-50, #fffbeb); color: var(--color-warning-700, #a16207); }
    .dm-tag--error { background: var(--color-error-50, #fef2f2); color: var(--color-error-700, #b91c1c); }
  `
})
export class DmParityReportComponent implements OnInit {
  private readonly api = inject(AccountingService);
  private readonly errors = inject(ErrorHandlerService);

  /** Vrai hors du cabinet délégué ou interrupteur éteint : le serveur refuserait à coup sûr. */
  @Input() disabled = false;

  readonly report = signal<MonthlyDeclarationParityReportDto | null>(null);
  readonly running = signal(false);
  readonly error = signal<string | null>(null);

  readonly gap = ParityVerdict.Gap;

  year = 0;
  fromMonth = 1;
  toMonth = 1;

  ngOnInit(): void {
    const range = defaultParityRange(new Date());
    this.year = range.year;
    this.fromMonth = range.fromMonth;
    this.toMonth = range.toMonth;
  }

  rangeError(): string | null {
    return validateParityRange({
      year: Number(this.year),
      fromMonth: Number(this.fromMonth),
      toMonth: Number(this.toMonth)
    });
  }

  run(): void {
    if (this.disabled || this.running() || this.rangeError()) {
      return;
    }
    this.running.set(true);
    this.error.set(null);
    this.report.set(null);
    this.api
      .getMonthlyDeclarationParityReport(Number(this.year), Number(this.fromMonth), Number(this.toMonth))
      .subscribe({
        next: res => {
          this.running.set(false);
          if (res.success && res.data) {
            this.report.set(res.data);
          } else {
            this.error.set(res.error ?? $localize`:@@accounting.dm-parity-report.ts.le.controle.a.echoue.efbcecfe:Le contrôle a échoué.`);
          }
        },
        error: err => {
          this.running.set(false);
          this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.dm-parity-report.ts.erreur.reseau.0683007f:Erreur réseau`));
        }
      });
  }

  exportJson(report: MonthlyDeclarationParityReportDto): void {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8' });
    downloadBlob(blob, parityFileName(report, 'json'));
  }

  exportCsv(report: MonthlyDeclarationParityReportDto): void {
    const blob = new Blob([parityCsv(report)], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, parityFileName(report, 'csv'));
  }

  conclusion(report: MonthlyDeclarationParityReportDto): string {
    return describeParityReport(report);
  }

  families(month: MonthlyDeclarationParityMonthDto): MonthlyDeclarationParityFamilyDto[] {
    return visibleParityFamilies(month);
  }

  familyName(f: MonthlyDeclarationParityFamilyDto): string {
    return familyLabel(f.family);
  }

  monthLabel(report: MonthlyDeclarationParityReportDto, month: number): string {
    return parityMonthLabel(report, month);
  }

  verdictLabel(verdict: ParityVerdict): string {
    return parityVerdictLabel(verdict);
  }

  tone(verdict: ParityVerdict): string {
    return parityVerdictTone(verdict);
  }

  describe(d: MonthlyDeclarationDiagnosticDto): string {
    return describeDiagnostic(d);
  }
}
