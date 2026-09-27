/// <reference types="@angular/localize" />
import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import { ToastService } from '@core/services/toast.service';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { AccountingService, ClosingRevaluationResultDto } from '../services/accounting.service';
import { AccountingAmountPipe } from '../shared/accounting-amount.pipe';
import { ErrorHandlerService } from '@core/services/error-handler.service';

const MONTHS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
];

@Component({
  selector: 'app-closing-revaluation',
  standalone: true,
  imports: [AccountingAmountPipe, CommonModule, FormsModule, PageHeaderComponent, ButtonComponent, AccountingStatusBannerComponent],
  template: `
    <app-page-header title="Réévaluation de clôture" i18n-title="Réévaluation de clôture"
                     subtitle="Écarts de conversion sur les positions en devise, à la clôture d'une période" />

    <app-accounting-status-banner variant="error" [message]="error() ?? ''" />

    <div class="card cr-block">
      <p class="cr-doctrine">
        Les positions en devise encore ouvertes — comptes de tiers et de trésorerie non lettrés —
        sont réévaluées au taux de clôture. L'écart va en <strong i18n="@@accounting.currencies.ecarts.de.conversion.724cde27">écarts de conversion</strong>,
        comptes de régularisation du bilan, et l'écriture est
        <strong i18n="@@accounting.currencies.contre.passee.automatiquement.au.premier.jour.de.51efa181">contre-passée automatiquement au premier jour de la période suivante</strong> :
        sans cela, la réévaluation du mois d'après se cumulerait à celle-ci.
      </p>

      <div class="cr-grid">
        <div class="cr-field">
          <label class="cr-lbl" for="cr-year" i18n="@@accounting.currencies.exercice.e171e2b0">Exercice</label>
          <input id="cr-year" class="cr-inp" type="number" [(ngModel)]="fiscalYear" [min]="2000" [max]="2100" />
        </div>
        <div class="cr-field">
          <label class="cr-lbl" for="cr-month" i18n="@@accounting.currencies.mois.0d304bea">Mois</label>
          <select id="cr-month" class="cr-inp" [(ngModel)]="month">
            @for (label of months; track $index) {
              <option [ngValue]="$index + 1">{{ label }}</option>
            }
          </select>
        </div>
      </div>
    </div>

    <div class="card cr-block">
      <h3 class="cr-title" i18n="@@accounting.currencies.comptes.d.imputation.9bc1ccb6">Comptes d'imputation</h3>
      <p class="cr-hint" i18n="@@accounting.currencies.saisis.a.chaque.execution.sans.valeur.memorisee..6a41fcf0"> Saisis à chaque exécution, sans valeur mémorisée : le plan NCT 01 fournit 185, 275 et 1515,
        mais un dossier non migré peut ne pas les avoir. </p>

      <div class="cr-grid">
        <div class="cr-field">
          <label class="cr-lbl" for="cr-gain" i18n="@@accounting.currencies.ecarts.de.conversion.passif.d0ac7c2b">Écarts de conversion — passif</label>
          <input id="cr-gain" class="cr-inp" [(ngModel)]="gainAccount" placeholder="Ex. 185" i18n-placeholder="Ex. 185" />
          <span class="cr-sub" i18n="@@accounting.currencies.gains.latents.dbd8c915">Gains latents</span>
        </div>
        <div class="cr-field">
          <label class="cr-lbl" for="cr-loss" i18n="@@accounting.currencies.ecarts.de.conversion.actif.5744833c">Écarts de conversion — actif</label>
          <input id="cr-loss" class="cr-inp" [(ngModel)]="lossAccount" placeholder="Ex. 275" i18n-placeholder="Ex. 275" />
          <span class="cr-sub" i18n="@@accounting.currencies.pertes.latentes.7c4dbdbb">Pertes latentes</span>
        </div>
      </div>

      <h3 class="cr-title cr-title--sub"><ng-container i18n="@@accounting.currencies.provision.pour.pertes.de.change.dde90ec9">Provision pour pertes de change </ng-container> <span class="cr-optional" i18n="@@accounting.currencies.facultatif.1f84e92e">facultatif</span></h3>
      <p class="cr-hint" i18n="@@accounting.currencies.principe.de.prudence.seule.la.perte.latente.se.p.4246cee4"> Principe de prudence : seule la perte latente se provisionne, le gain latent ne se constate pas.
        Laissez ces deux champs vides pour ne constater aucune provision. </p>

      <div class="cr-grid">
        <div class="cr-field">
          <label class="cr-lbl" for="cr-expense" i18n="@@accounting.currencies.dotation.aux.provisions.2a479425">Dotation aux provisions</label>
          <input id="cr-expense" class="cr-inp" [(ngModel)]="provisionExpenseAccount" placeholder="Classe 6" i18n-placeholder="Classe 6" />
        </div>
        <div class="cr-field">
          <label class="cr-lbl" for="cr-provision" i18n="@@accounting.currencies.provision.e11d5b69">Provision</label>
          <input id="cr-provision" class="cr-inp" [(ngModel)]="provisionAccount" placeholder="Ex. 1515" i18n-placeholder="Ex. 1515" />
        </div>
      </div>

      @if (canRun()) {
        <div class="cr-actions">
          <app-button variant="primary" icon="pi pi-play" type="button"
                      (click)="run()" [disabled]="running() || !gainAccount.trim() || !lossAccount.trim()">
            {{ running() ? loc_ui_tern_traitement_2f66d9 : loc_ui_tern_lancer_la_reevaluation_ca8de5 }}
          </app-button>
        </div>
      } @else {
        <p class="cr-hint" i18n="@@accounting.currencies.la.reevaluation.de.cloture.requiert.le.droit.de..cb9dcd39">La réévaluation de clôture requiert le droit de clôture comptable.</p>
      }
    </div>

    @if (result(); as res) {
      <div class="card cr-block cr-result" role="status">
        <h3 class="cr-title" i18n="@@accounting.currencies.reevaluation.effectuee.72b6d6a2">Réévaluation effectuée</h3>
        <dl class="cr-result-list">
          <div class="cr-result-row"><dt i18n="@@accounting.currencies.positions.reevaluees.3b1cbe6d">Positions réévaluées</dt><dd>{{ res.positionCount }}</dd></div>
          <div class="cr-result-row"><dt i18n="@@accounting.currencies.total.gains.latents.2c087428">Total gains latents</dt><dd class="cr-mono">{{ res.totalLatentGain | accountingAmount }}</dd></div>
          <div class="cr-result-row"><dt i18n="@@accounting.currencies.total.pertes.latentes.ec6f82b1">Total pertes latentes</dt><dd class="cr-mono">{{ res.totalLatentLoss | accountingAmount }}</dd></div>
          <div class="cr-result-row"><dt i18n="@@accounting.currencies.ecriture.de.contre.passation.cca3e2a8">Écriture de contre-passation</dt><dd>générée au {{ nextPeriodStart() | date : 'shortDate' }}</dd></div>
          @if (res.provisionEntryId) {
            <div class="cr-result-row"><dt i18n="@@accounting.currencies.provision.e11d5b69">Provision</dt><dd i18n="@@accounting.currencies.constatee.b4961337">constatée</dd></div>
          }
        </dl>
      </div>
    }
  `,
  styles: `
    .cr-block { padding: var(--spacing-4); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); margin-bottom: var(--spacing-4); }
    .cr-title { margin: 0 0 var(--spacing-2); font-size: var(--font-size-md); font-weight: var(--font-weight-semibold); }
    .cr-title--sub { margin-top: var(--spacing-5); }
    .cr-optional { font-size: var(--font-size-xs); font-weight: var(--font-weight-normal); color: var(--color-text-tertiary); }
    .cr-doctrine { margin: 0 0 var(--spacing-4); padding: var(--spacing-3); background: var(--color-primary-50); border-radius: var(--radius-md); font-size: var(--font-size-sm); color: var(--color-text-secondary); }
    .cr-hint { margin: 0 0 var(--spacing-3); font-size: var(--font-size-sm); color: var(--color-text-secondary); }
    .cr-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr)); gap: var(--spacing-3); }
    .cr-field { display: flex; flex-direction: column; gap: var(--spacing-1); }
    .cr-lbl { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); }
    .cr-sub { font-size: var(--font-size-xs); color: var(--color-text-tertiary); }
    .cr-inp { padding: var(--spacing-2) var(--spacing-3); border: 1px solid var(--color-border-default); border-radius: var(--radius-md); background: var(--color-background-elevated); color: var(--color-text-primary); font-size: var(--font-size-sm); width: 100%; box-sizing: border-box; }
    .cr-actions { display: flex; justify-content: flex-end; margin-top: var(--spacing-4); }
    .cr-result-list { margin: 0; }
    .cr-result-row { display: flex; justify-content: space-between; gap: var(--spacing-2); padding: var(--spacing-2) 0; border-bottom: 1px solid var(--color-border-subtle); font-size: var(--font-size-sm); }
    .cr-result-row dt { color: var(--color-text-secondary); margin: 0; }
    .cr-result-row dd { margin: 0; font-weight: var(--font-weight-medium); }
    .cr-mono { font-variant-numeric: tabular-nums; }
  `
})
export class ClosingRevaluationComponent {
  readonly loc_ui_tern_traitement_2f66d9 = $localize`:@@ui.tern.traitement.2f66d9:Traitement…`;
  readonly loc_ui_tern_lancer_la_reevaluation_ca8de5 = $localize`:@@ui.tern.lancer.la.reevaluation.ca8de5:Lancer la réévaluation`;
  private readonly api = inject(AccountingService);
  // Le 400 metier porte un message precis ; extractErrorMessage le lit et
  // distingue au passage la vraie panne reseau (status 0).
  private readonly errors = inject(ErrorHandlerService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);

  readonly months = MONTHS;

  fiscalYear = new Date().getFullYear();
  month = new Date().getMonth() + 1;
  gainAccount = '';
  lossAccount = '';
  provisionExpenseAccount = '';
  provisionAccount = '';

  readonly running = signal(false);
  readonly error = signal<string | null>(null);
  readonly result = signal<ClosingRevaluationResultDto | null>(null);

  /** Opération de clôture : elle relève du droit de clôture, pas de la simple saisie. */
  readonly canRun = computed(() => this.auth.hasPermission(PERMISSIONS.accounting.close));

  /** Date de la contre-passation, affichée pour lever toute ambiguïté sur ce qui a été généré. */
  nextPeriodStart(): Date {
    return new Date(this.fiscalYear, this.month, 1);
  }

  run(): void {
    if (this.running() || !this.canRun()) return;

    this.running.set(true);
    this.error.set(null);
    this.result.set(null);

    this.api.runClosingRevaluation({
      fiscalYear: this.fiscalYear,
      month: this.month,
      gainAccount: this.gainAccount.trim(),
      lossAccount: this.lossAccount.trim(),
      provisionExpenseAccount: this.provisionExpenseAccount.trim() || null,
      provisionAccount: this.provisionAccount.trim() || null
    }).subscribe({
      next: res => {
        this.running.set(false);
        if (res.success && res.data) {
          this.result.set(res.data);
          this.toast.add({
            severity: 'success',
            summary: $localize`:@@closing-revaluation.component.summary.R_valuation_eff:Réévaluation effectuée`,
            detail: `${res.data.positionCount} position(s) réévaluée(s)`,
            life: 5000
          });
        } else {
          this.error.set(res.error ?? $localize`:@@ui.tern.erreur.ab546c:Erreur`);
        }
      },
      error: err => { this.running.set(false); this.error.set(this.errors.extractErrorMessage(err, 'Erreur réseau')); }
    });
  }
}
