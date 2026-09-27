import { Component, EventEmitter, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AutoCompleteModule } from 'primeng/autocomplete';
import { EntryFormStore } from '../../services/entry-form.store';
import { EntryReferenceStore } from '../../services/entry-reference.store';
import {
  GUIDED_SCENARIOS,
  GuidedScenario,
  buildScenarioLines,
  formatPeriodLabel
} from '../../models/guided-scenarios.catalog';
import { EntryLinesGridComponent } from '../entry-lines-grid.component';
import { EntrySummaryPanelComponent } from '../entry-summary-panel.component';
import { AccountingAmountInputComponent } from '../../../shared/accounting-amount-input.component';
import { ThirdPartyRef } from '../../models/entry-form.model';
import { AccountingService, JournalEntryTemplateDto } from '../../../services/accounting.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DestroyRef } from '@angular/core';

type GuidedStep = 1 | 2 | 3 | 4;

const PAYMENT_METHODS = [
  { value: 1, label: 'Virement bancaire' },
  { value: 0, label: 'Espèces' },
  { value: 2, label: 'Chèque' },
  { value: 3, label: 'Carte bancaire' },
  { value: 4, label: 'Paiement mobile' },
  { value: 5, label: 'Traite' }
];

@Component({
  selector: 'app-guided-entry',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    AutoCompleteModule,
    EntryLinesGridComponent,
    EntrySummaryPanelComponent,
    AccountingAmountInputComponent
  ],
  template: `
    <div class="guided-entry">
      <nav class="guided-stepper" aria-label="Étapes de la saisie guidée" i18n-aria-label="Étapes de la saisie guidée">
        @for (s of steps; track s.num) {
          <button type="button" class="guided-step"
                  [class.guided-step--active]="step() === s.num"
                  [class.guided-step--done]="step() > s.num"
                  (click)="goToStep(s.num)"
                  [disabled]="s.num > step() + 1">
            <span class="guided-step__num">{{ s.num }}</span>
            <span class="guided-step__label">{{ s.label }}</span>
          </button>
        }
      </nav>

      @switch (step()) {
        @case (1) {
          <section class="guided-panel card">
            <p class="guided-intro" i18n="@@accounting.manual-entry.choisissez.le.type.d.ecriture.que.vous.souhaitez.eb087e6a">Choisissez le type d'écriture que vous souhaitez saisir parmi les modèles guidés disponibles.</p>
            <div class="scenario-grid">
              @for (sc of scenarios; track sc.id) {
                <button type="button" class="scenario-card"
                        [class.scenario-card--selected]="selectedScenario()?.id === sc.id"
                        (click)="selectScenario(sc)">
                  <i [class]="loc_ui_tern_scenario_card_icon_8fea02 + sc.icon" aria-hidden="true"></i>
                  <strong>{{ sc.label }}</strong>
                  <span class="scenario-card__desc">{{ sc.description }}</span>
                </button>
              }
            </div>
            <div class="guided-info" i18n="@@accounting.manual-entry.la.saisie.guidee.vous.accompagne.pas.a.pas.et.pr.e4e13f23">La saisie guidée vous accompagne pas à pas et propose les comptes adaptés à chaque opération.</div>
            <div class="guided-actions">
              <button type="button" class="btn btn-primary" [disabled]="!selectedScenario()" (click)="nextStep()" i18n="@@accounting.manual-entry.suivant.596d29a7">Suivant</button>
            </div>
          </section>
        }
        @case (2) {
          <section class="guided-panel card">
            <p class="guided-banner" i18n="@@accounting.manual-entry.renseignez.les.informations.generales.elles.perm.b969909d">Renseignez les informations générales. Elles permettront de préremplir certaines valeurs lors de la saisie des lignes.</p>
            <div class="guided-form-grid">
              <div class="form-field">
                <label i18n="@@accounting.manual-entry.journal.d4d0b33f">Journal *</label>
                <select [ngModel]="store.journalCode()" (ngModelChange)="store.journalCode.set($event)">
                  @for (j of store.journalOptions(); track j.code) {
                    <option [value]="j.code">{{ j.code }} — {{ j.label }}</option>
                  }
                </select>
              </div>
              <div class="form-field">
                <label i18n="@@accounting.manual-entry.date.d.ecriture.fb8ff34e">Date d'écriture *</label>
                <input type="date" [ngModel]="store.entryDate()" (ngModelChange)="store.setEntryDate($event)" />
              </div>
              <div class="form-field">
                <label i18n="@@accounting.manual-entry.periode.2be15f92">Période *</label>
                <select [ngModel]="store.periodId()" (ngModelChange)="store.setPeriodId($event || null)">
                  <option [ngValue]="null" i18n="@@accounting.manual-entry.text.1b93795b">—</option>
                  @for (p of refs.openPeriods(); track p.id) {
                    <option [ngValue]="p.id">{{ periodLabel(p) }}</option>
                  }
                </select>
              </div>
              <div class="form-field">
                <label i18n="@@accounting.manual-entry.reference.f8130bb0">Référence</label>
                <input type="text" [ngModel]="store.pieceRef()" (ngModelChange)="store.pieceRef.set($event)" />
              </div>
              <div class="form-field form-field--wide">
                <label i18n="@@accounting.manual-entry.libelle.general.b05df8c4">Libellé général *</label>
                <input type="text" [ngModel]="store.entryLabel()" (ngModelChange)="store.entryLabel.set($event)" />
              </div>
              <div class="form-field form-field--wide">
                <label i18n="@@accounting.manual-entry.description.55f8ebc8">Description</label>
                <textarea rows="2" [ngModel]="store.description()" (ngModelChange)="store.description.set($event)"></textarea>
              </div>
              @if (selectedScenario()?.thirdPartyKind) {
                <div class="form-field form-field--wide">
                  <label i18n="@@accounting.manual-entry.tiers.435080ba">Tiers</label>
                  <p-autoComplete
                    [(ngModel)]="guidedThirdParty"
                    [suggestions]="thirdPartySuggestions"
                    (completeMethod)="searchThirdParties($event)"
                    [field]="'display'"
                    [minLength]="2"
                    [forceSelection]="true"
                    [showClear]="true"
                    placeholder="Client ou fournisseur" i18n-placeholder="Client ou fournisseur"
                    appendTo="body"
                    panelStyleClass="me-autocomplete-panel"
                  />
                </div>
              }
              <div class="form-field">
                <label i18n="@@accounting.manual-entry.devise.eb2e42c4">Devise</label>
                <!-- Lecture seule : la devise se choisit dans l'en-tête de l'onglet standard,
                     mais l'état est partagé — l'afficher en dur mentirait dès qu'elle change. -->
                <input type="text" [value]="currencyLabel()" readonly class="readonly" />
              </div>
              @if (store.isForeignCurrency()) {
                <div class="form-field">
                  <label i18n="@@accounting.manual-entry.taux.18bc95b8">Taux</label>
                  <input type="text" [value]="store.exchangeRate() ?? '—'" readonly class="readonly" />
                </div>
              }
              <div class="form-field">
                <label i18n="@@accounting.manual-entry.date.d.echeance.4f9893d7">Date d'échéance</label>
                <input type="date" [ngModel]="store.headerDueDate()" (ngModelChange)="store.headerDueDate.set($event)" />
              </div>
              <div class="form-field">
                <label i18n="@@accounting.manual-entry.mode.de.reglement.c82ec4a6">Mode de règlement</label>
                <select [ngModel]="store.paymentMethod()" (ngModelChange)="store.paymentMethod.set($event)">
                  <option [ngValue]="null" i18n="@@accounting.manual-entry.text.1b93795b">—</option>
                  @for (pm of paymentMethods; track pm.value) {
                    <option [ngValue]="pm.value">{{ pm.label }}</option>
                  }
                </select>
              </div>
              <div class="form-field">
                <label i18n="@@accounting.manual-entry.compte.bancaire.485b42ca">Compte bancaire</label>
                <select [ngModel]="store.bankAccountId()" (ngModelChange)="onBankSelect($event)">
                  <option [ngValue]="null" i18n="@@accounting.manual-entry.text.1b93795b">—</option>
                  @for (b of refs.bankAccounts(); track b.id) {
                    <option [ngValue]="b.id">{{ b.chartOfAccountNumber }} — {{ b.designation || b.bankName }}</option>
                  }
                </select>
              </div>
              <div class="form-field">
                <label i18n="@@accounting.manual-entry.montant.ttc.a742433a">Montant TTC</label>
                <app-accounting-amount-input
                  [ngModel]="store.amountTtc()"
                  (ngModelChange)="onTtcChange($event)"
                  side="debit"
                  [fractionDigits]="store.currencyDecimals()"
                  inputId="guided-amount-ttc"
                  ariaLabel="Montant TTC" />
              </div>
              <div class="form-field">
                <label i18n="@@accounting.manual-entry.montant.ht.3df1d6fe">Montant HT</label>
                <app-accounting-amount-input
                  [ngModel]="store.amountHt()"
                  (ngModelChange)="onHtChange($event)"
                  side="debit"
                  [fractionDigits]="store.currencyDecimals()"
                  inputId="guided-amount-ht"
                  ariaLabel="Montant HT" />
              </div>
              <div class="form-field">
                <label i18n="@@accounting.manual-entry.montant.tva.f0c1b7cc">Montant TVA</label>
                <app-accounting-amount-input
                  [ngModel]="store.amountVat()"
                  (ngModelChange)="store.amountVat.set($event)"
                  side="credit"
                  [fractionDigits]="store.currencyDecimals()"
                  inputId="guided-amount-vat"
                  ariaLabel="Montant TVA" />
              </div>
            </div>
            <div class="guided-options">
              <label><input type="checkbox" [checked]="store.isBalanced()" disabled /> Écriture équilibrée (vérification auto)</label>
              <label><input type="checkbox" [checked]="store.autoSuggestAccounts()" (change)="store.autoSuggestAccounts.set($any($event.target).checked)" /> Proposition automatique des comptes</label>
              <label><input type="checkbox" [checked]="store.rememberGuidedPrefs()" (change)="store.rememberGuidedPrefs.set($any($event.target).checked)" /> Mémoriser ces informations</label>
            </div>
            <div class="guided-actions">
              <button type="button" class="btn btn-outline-secondary" (click)="prevStep()" i18n="@@accounting.manual-entry.precedent.a527f171">Précédent</button>
              <button type="button" class="btn btn-primary" (click)="applyGeneralAndNext()" i18n="@@accounting.manual-entry.suivant.596d29a7">Suivant</button>
            </div>
          </section>
        }
        @case (3) {
          <app-entry-lines-grid [vatSide]="vatSide()">
          </app-entry-lines-grid>
          <div class="guided-actions">
            <button type="button" class="btn btn-outline-secondary" (click)="prevStep()" i18n="@@accounting.manual-entry.precedent.a527f171">Précédent</button>
            <button type="button" class="btn btn-outline-secondary" (click)="store.autoBalance()" i18n="@@accounting.manual-entry.verifier.l.equilibre.5e8c448c">Vérifier l'équilibre</button>
            <button type="button" class="btn btn-primary" [disabled]="!store.isBalanced()" (click)="nextStep()" i18n="@@accounting.manual-entry.suivant.596d29a7">Suivant</button>
          </div>
        }
        @case (4) {
          <section class="guided-panel card">
            <h3 i18n="@@accounting.manual-entry.recapitulatif.de.l.ecriture.cf97dcf0">Récapitulatif de l'écriture</h3>
            <app-entry-summary-panel />
            <div class="guided-actions">
              <button type="button" class="btn btn-outline-secondary" (click)="prevStep()" i18n="@@accounting.manual-entry.precedent.a527f171">Précédent</button>
              <button type="button" class="btn btn-primary" [disabled]="!store.canSubmit()" (click)="finish.emit()" i18n="@@accounting.manual-entry.enregistrer.l.ecriture.8fef0dc9">Enregistrer l'écriture</button>
            </div>
          </section>
        }
      }

      @if (step() === 1 && recentTemplates().length > 0) {
        <aside class="recent-templates card">
          <h4 i18n="@@accounting.manual-entry.modeles.recemment.utilises.ada49d50">Modèles récemment utilisés</h4>
          <ul>
            @for (t of recentTemplates(); track t.id) {
              <li><button type="button" class="link-btn" (click)="applyTemplate(t)">{{ t.name }}</button></li>
            }
          </ul>
        </aside>
      }
    </div>
  `,
  styles: `
    .guided-entry { display:flex; flex-direction:column; gap:var(--spacing-4); }
    .guided-stepper { display:flex; flex-wrap:wrap; gap:var(--spacing-2); margin-bottom:var(--spacing-2); }
    .guided-step { display:flex; align-items:center; gap:var(--spacing-2); padding:var(--spacing-2) var(--spacing-3); border:1px solid var(--color-border-default); border-radius:var(--radius-md); background:var(--color-background-elevated); cursor:pointer; font-size:var(--font-size-sm); }
    .guided-step--active { border-color:var(--color-primary-500); background:var(--color-primary-50); }
    .guided-step--done .guided-step__num { background:var(--color-success-600); color:#fff; }
    .guided-step__num { display:inline-flex; align-items:center; justify-content:center; width:1.5rem; height:1.5rem; border-radius:var(--radius-full); background:var(--color-neutral-200); font-weight:bold; font-size:var(--font-size-xs); }
    .guided-panel { padding:var(--spacing-5); }
    .guided-intro, .guided-banner { font-size:var(--font-size-sm); color:var(--color-text-secondary); margin-bottom:var(--spacing-4); }
    .guided-banner { padding:var(--spacing-3); background:var(--color-primary-50); border-radius:var(--radius-md); }
    .scenario-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(220px, 1fr)); gap:var(--spacing-3); margin-bottom:var(--spacing-4); }
    .scenario-card { display:flex; flex-direction:column; align-items:flex-start; gap:var(--spacing-2); padding:var(--spacing-4); border:2px solid var(--color-border-default); border-radius:var(--radius-lg); background:var(--color-background-elevated); cursor:pointer; text-align:left; transition:border-color 150ms; }
    .scenario-card:hover, .scenario-card--selected { border-color:var(--color-primary-500); }
    .scenario-card__desc { font-size:var(--font-size-xs); color:var(--color-text-secondary); }
    .scenario-card__icon { font-size:1.75rem; color:var(--color-success-600); line-height:1; flex-shrink:0; }
    .guided-info { padding:var(--spacing-3); background:var(--color-success-50); border-radius:var(--radius-md); font-size:var(--font-size-sm); margin-bottom:var(--spacing-4); }
    .guided-form-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(200px, 1fr)); gap:var(--spacing-4); margin-bottom:var(--spacing-4); }
    .form-field { display:flex; flex-direction:column; gap:var(--spacing-1); }
    .form-field--wide { grid-column:1 / -1; }
    .form-field label { font-size:var(--font-size-sm); font-weight:var(--font-weight-semibold); }
    .form-field input, .form-field select, .form-field textarea { padding:var(--spacing-2); border:1px solid var(--color-border-default); border-radius:var(--radius-md); font-size:var(--font-size-sm); }
    .readonly { background:var(--color-background-subtle); color:var(--color-text-tertiary); }
    .guided-options { display:flex; flex-direction:column; gap:var(--spacing-2); font-size:var(--font-size-sm); margin-bottom:var(--spacing-4); }
    .guided-actions { display:flex; justify-content:flex-end; gap:var(--spacing-2); margin-top:var(--spacing-4); }
    .recent-templates { padding:var(--spacing-4); }
    .recent-templates ul { list-style:none; padding:0; margin:0; }
    .link-btn { background:none; border:none; color:var(--color-primary-600); cursor:pointer; font-size:var(--font-size-sm); padding:var(--spacing-1) 0; }
    :host ::ng-deep .me-autocomplete-panel { min-width:22rem; max-width:min(32rem, 90vw); z-index:1100; }
  `
})
export class GuidedEntryComponent {
  readonly loc_ui_tern_scenario_card_icon_8fea02 = "scenario-card__icon ";
  readonly store = inject(EntryFormStore);
  readonly refs = inject(EntryReferenceStore);
  private readonly api = inject(AccountingService);
  private readonly destroyRef = inject(DestroyRef);

  /** « EUR — Euro » quand le catalogue est chargé, le code seul sinon. */
  currencyLabel(): string {
    const code = this.store.currency();
    const found = this.refs.currencies().find(c => c.code === code);
    return found ? `${found.code} — ${found.label}` : code;
  }

  @Output() finish = new EventEmitter<void>();

  readonly scenarios = GUIDED_SCENARIOS;
  readonly paymentMethods = PAYMENT_METHODS;
  readonly steps = [
    { num: 1 as GuidedStep, label: 'Type d\'écriture' },
    { num: 2 as GuidedStep, label: 'Informations générales' },
    { num: 3 as GuidedStep, label: 'Saisie des lignes' },
    { num: 4 as GuidedStep, label: 'Récapitulatif' }
  ];

  readonly step = signal<GuidedStep>(1);
  readonly selectedScenario = signal<GuidedScenario | null>(null);
  readonly recentTemplates = signal<JournalEntryTemplateDto[]>([]);
  guidedThirdParty: ThirdPartyRef | null = null;
  thirdPartySuggestions: ThirdPartyRef[] = [];

  constructor() {
    this.api.getJournalTemplates(true)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(res => {
        if (res.success && res.data) {
          this.recentTemplates.set(res.data.slice(0, 5));
        }
      });
  }

  vatSide(): 'deductible' | 'collected' {
    const side = this.selectedScenario()?.vatSide;
    return side === 'collected' ? 'collected' : 'deductible';
  }

  periodLabel(p: { fiscalYear: number; month: number }): string {
    return formatPeriodLabel(p.fiscalYear, p.month);
  }

  selectScenario(sc: GuidedScenario): void {
    this.selectedScenario.set(sc);
    this.store.journalCode.set(sc.defaultJournalCode);
  }

  searchThirdParties(event: { query: string }): void {
    this.refs.searchThirdParties(event.query);
    this.thirdPartySuggestions = this.refs.thirdPartySuggestions();
  }

  onBankSelect(id: string | null): void {
    this.store.bankAccountId.set(id);
  }

  onTtcChange(ttc: number | null): void {
    this.store.amountTtc.set(ttc);
    const ht = this.store.amountHt() ?? 0;
    const vat = this.store.amountVat() ?? 0;
    if (ttc && ht && !vat) this.store.amountVat.set(Math.round((ttc - ht) * 1000) / 1000);
  }

  onHtChange(ht: number | null): void {
    this.store.amountHt.set(ht);
    const ttc = this.store.amountTtc() ?? 0;
    const vat = this.store.amountVat() ?? 0;
    if (ht && ttc && !vat) this.store.amountVat.set(Math.round((ttc - ht) * 1000) / 1000);
  }

  applyGeneralAndNext(): void {
    const sc = this.selectedScenario();
    if (!sc || !this.store.autoSuggestAccounts()) {
      this.nextStep();
      return;
    }
    const ht = this.store.amountHt() ?? 0;
    const tva = this.store.amountVat() ?? 0;
    const ttc = this.store.amountTtc() ?? (ht + tva);
    const label = this.store.entryLabel() || sc.label;
    const lines = buildScenarioLines(
      sc,
      candidates => this.refs.resolveAccount(candidates),
      { ht, tva, ttc },
      label
    );
    if (this.guidedThirdParty) {
      for (let i = 0; i < lines.length; i++) {
        const tpl = sc.lineTemplates[i];
        if (tpl?.role === 'counterpart') {
          lines[i] = { ...lines[i], thirdParty: this.guidedThirdParty };
        }
      }
    }
    this.store.setLines(lines);
    this.nextStep();
  }

  applyTemplate(t: JournalEntryTemplateDto): void {
    this.store.applyHeaderFromTemplate(t.journalCode, t.labelTemplate ?? null);
    this.store.applyLinesFromTemplate(
      t.lines.map(l => ({
        accountNumber: l.accountNumber,
        lineLabel: l.lineLabelTemplate ?? '',
        debit: l.fixedDebit ?? null,
        credit: l.fixedCredit ?? null
      }))
    );
    this.step.set(2);
  }

  goToStep(n: GuidedStep): void {
    if (n <= this.step()) this.step.set(n);
  }

  nextStep(): void {
    if (this.step() < 4) this.step.update(s => (s + 1) as GuidedStep);
  }

  prevStep(): void {
    if (this.step() > 1) this.step.update(s => (s - 1) as GuidedStep);
  }
}
