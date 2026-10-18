/// <reference types="@angular/localize" />
/**
 * Dialogue de modification d'un compte comptable existant : libellé + matricule fiscal
 * (Client/Fournisseur auxiliaire uniquement). Le numéro de compte et la hiérarchie restent
 * en lecture seule — ils ne sont jamais modifiables une fois le compte créé.
 */
import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, HostListener, inject, input, OnInit, output, signal, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AccountingService, ChartOfAccountDto } from '../services/accounting.service';
import {
  accountSupportsFiscalId,
  extractFiscalIdServerError,
  fiscalIdFieldError,
  normalizeFiscalIdInput
} from './chart-account-fiscal-id';
import { NIF_MAX_INPUT_LENGTH } from '@shared/validation/validation-rules';
import { NifMaskPasteDirective } from '@shared/validation/nif-mask-paste.directive';

@Component({
  selector: 'app-chart-account-edit-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, NifMaskPasteDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="coa-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="coa-edit-title" (keydown.escape)="close()">
      <div class="coa-modal">
        <h2 id="coa-edit-title" class="coa-modal-title">
          {{ loc_modifier_le_compte_018a44a1 }}{{ account().accountNumber }}
        </h2>
        <p class="coa-modal-sub" i18n="@@accounting.chart-of-accounts.plan.comptable.gestion.des.comptes.619b25d6">Plan comptable — Gestion des comptes</p>

        <h3 class="coa-sec" i18n="@@accounting.chart-of-accounts.hierarchie.du.compte.edd80076">Hiérarchie du compte</h3>
        <div class="coa-summary" aria-label="Hiérarchie du compte (non modifiable)" i18n-aria-label="@@accounting.chart-of-accounts.hierarchie.du.compte.non.modifiable.b559b297">
          <span>{{ loc_type_de_compte_b6544864 }} : <b>{{ accountTypeLabel() }}</b></span>
          <span>{{ loc_type_3deb7456 }} : <b>{{ accountKindLabel() }}</b></span>
          @if (parentLabel(); as parent) {
            <span>{{ loc_sous_compte_de_7f47036e }} : <b>{{ parent }}</b></span>
          }
          @if (account().affectationAccountNumber) {
            <span>{{ loc_compte_d_affectation_4a67171b }} : <b>{{ account().affectationAccountNumber }}</b></span>
          }
        </div>

        <h3 class="coa-sec" i18n="@@accounting.chart-of-accounts.identification.9d2c7063">Identification</h3>
        <div class="coa-grid">
          <div class="coa-field">
            <label class="coa-lbl" for="coa-edit-num" i18n="@@accounting.chart-of-accounts.compte.numero.f569fef7">Compte numéro</label>
            <span class="coa-inp-wrap">
              <input id="coa-edit-num" class="coa-inp" [value]="account().accountNumber" readonly aria-readonly="true" aria-describedby="coa-edit-num-help" />
              <span class="lock" [attr.title]="loc_non_modifiable_1c6df9f1" aria-hidden="true"><i class="pi pi-lock"></i></span>
            </span>
            <p id="coa-edit-num-help" class="coa-help" i18n="@@accounting.chart-of-accounts.le.numero.d.un.compte.existant.n.est.pas.modifia.4afb2a5c">Le numéro d'un compte existant n'est pas modifiable.</p>
          </div>
          <div class="coa-field coa-field-wide">
            <label class="coa-lbl" for="coa-edit-label" i18n="@@accounting.chart-of-accounts.libelle.f5485bba">Libellé</label>
            <input #labelInput id="coa-edit-label" class="coa-inp" [(ngModel)]="label" placeholder="Ex. Client Société X" i18n-placeholder="@@accounting.chart-of-accounts.ex.client.societe.x.947766e4" />
          </div>
          @if (showFiscalIdField()) {
            <div class="coa-field coa-field-full">
              <label class="coa-lbl" for="coa-edit-fiscal-id" i18n="@@accounting.chart-of-accounts.matricule.fiscal.facultatif.2d99c70e">Matricule fiscal (facultatif)</label>
              <input
                id="coa-edit-fiscal-id"
                class="coa-inp coa-inp--nif"
                [class.coa-inp--invalid]="!!fiscalIdError()"
                [attr.aria-invalid]="fiscalIdError() ? true : null"
                [attr.aria-describedby]="fiscalIdError() ? 'coa-edit-fiscal-id-error' : 'coa-edit-fiscal-id-help'"
                [(ngModel)]="fiscalId"
                (ngModelChange)="serverError.set(null)"
                (blur)="fiscalId = normalizeFiscalIdInput(fiscalId)"
                appNifMaskPaste
                [maxlength]="fiscalIdMaxInputLength"
                placeholder="Ex. 1234567A/B/M/000" i18n-placeholder="@@accounting.chart-of-accounts.ex.1234567a.b.m.000.9d9247ba"
                autocomplete="off" spellcheck="false" />
              @if (fiscalIdError(); as err) {
                <p id="coa-edit-fiscal-id-error" class="coa-create-error" role="alert">{{ err }}</p>
              } @else {
                <p id="coa-edit-fiscal-id-help" class="coa-help">
                  {{ account().accountType === 1 ? loc_fiscalid_help_client_1587022f : loc_fiscalid_help_supplier_7579ceec }}
                </p>
              }
            </div>
          }
        </div>

        @if (saveError()) {
          <p class="coa-create-error" role="alert">{{ saveError() }}</p>
        }

        <div class="coa-modal-actions">
          <button type="button" class="btn btn-secondary" (click)="close()" [disabled]="saving()" i18n="@@accounting.chart-of-accounts.annuler.49ba3292">Annuler</button>
          <button type="button" class="btn btn-primary" (click)="save()" [disabled]="saving() || !canSave()">
            {{ saving() ? loc_enregistrement_e7d5f2 : loc_enregistrer_f7c8bc }}
          </button>
        </div>
      </div>
    </div>
  `,
  styles: `
    .coa-modal-backdrop {
      position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45);
      display: flex; align-items: center; justify-content: center; z-index: 1000; padding: var(--spacing-4);
    }
    .coa-modal {
      background: var(--color-background-elevated); border-radius: var(--radius-lg);
      box-shadow: var(--shadow-lg, 0 10px 30px rgba(15, 23, 42, 0.2));
      padding: var(--spacing-5); width: 100%; max-width: 560px; max-height: 90vh; overflow: auto;
    }
    .coa-modal-title { margin: 0; font-size: var(--font-size-lg); font-weight: var(--font-weight-semibold); }
    .coa-modal-sub { margin: 2px 0 var(--spacing-3); font-size: var(--font-size-xs); color: var(--color-text-tertiary); }
    .coa-sec { margin: var(--spacing-4) 0 var(--spacing-2); font-size: var(--font-size-xs); text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-text-tertiary); font-weight: var(--font-weight-bold); }
    .coa-grid { display: flex; flex-wrap: wrap; gap: var(--spacing-3); }
    .coa-field { display: flex; flex-direction: column; gap: var(--spacing-1); flex: 1 1 10rem; }
    .coa-field-wide { flex: 2 1 16rem; }
    .coa-field-full { flex: 1 1 100%; }
    .coa-lbl { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); }
    .coa-lbl small { font-weight: var(--font-weight-regular, 400); color: var(--color-text-tertiary); font-size: var(--font-size-xs); }
    .coa-inp { padding: var(--spacing-2) var(--spacing-3); border: 1px solid var(--color-border-default); border-radius: var(--radius-md); background: var(--color-background-elevated); color: var(--color-text-primary); font-size: var(--font-size-sm); width: 100%; }
    .coa-inp--nif { font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace); letter-spacing: 0.02em; text-transform: uppercase; }
    .coa-inp--invalid { border-color: #f04438; box-shadow: 0 0 0 3px rgba(240, 68, 56, 0.12); }
    .coa-help { margin: 0; font-size: var(--font-size-xs); color: var(--color-text-tertiary); line-height: 1.4; }
    .coa-create-error {
      margin: var(--spacing-4) 0 0;
      padding: var(--spacing-2) var(--spacing-3);
      border-radius: var(--radius-md);
      border: 1px solid #fecaca;
      background: #fef2f2;
      color: #b42318;
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
    }
    .coa-modal-actions { display: flex; justify-content: flex-end; gap: var(--spacing-3); margin-top: var(--spacing-5); padding-top: var(--spacing-3); border-top: 1px solid var(--color-border-subtle); }
    .btn { padding: var(--spacing-2) var(--spacing-4); border-radius: var(--radius-md); font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); cursor: pointer; border: 1px solid transparent; }
    .btn-secondary { background: var(--color-background-subtle); color: var(--color-text-primary); border-color: var(--color-border-default); }
    .btn-primary { background: var(--color-primary-500, #2563eb); color: #fff; }
    .btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .coa-inp-wrap { position: relative; }
    .coa-inp-wrap .lock {
      position: absolute; inset-inline-end: var(--spacing-3); top: 50%; transform: translateY(-50%);
      color: var(--color-text-tertiary); font-size: var(--font-size-sm); pointer-events: none;
    }
    .coa-inp[readonly] { background: var(--color-background-subtle); color: var(--color-text-secondary); }
    .coa-summary {
      display: flex; flex-wrap: wrap; gap: var(--spacing-1) var(--spacing-4);
      padding: var(--spacing-2) var(--spacing-3); border: 1px solid var(--color-border-subtle);
      border-radius: var(--radius-md); background: var(--color-background-subtle);
      font-size: var(--font-size-sm); color: var(--color-text-secondary);
    }
    .coa-summary b { color: var(--color-text-primary); font-weight: var(--font-weight-semibold); }
  `
})
export class ChartAccountEditDialogComponent implements OnInit, AfterViewInit {
  private readonly api = inject(AccountingService);

  readonly account = input.required<ChartOfAccountDto>();
  readonly rows = input.required<ChartOfAccountDto[]>();
  readonly saved = output<void>();
  readonly closed = output<void>();

  @ViewChild('labelInput') labelInputRef?: ElementRef<HTMLInputElement>;

  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly serverError = signal<string | null>(null);

  readonly fiscalIdMaxInputLength = NIF_MAX_INPUT_LENGTH;

  label = '';
  fiscalId = '';

  private initializedForId: string | null = null;

  readonly loc_modifier_le_compte_018a44a1 = $localize`:@@accounting.chart-of-accounts.modifier.le.compte.018a44a1:Modifier le compte `;
  readonly loc_type_de_compte_b6544864 = $localize`:@@accounting.chart-of-accounts.type.de.compte.b6544864:Type de compte`;
  readonly loc_type_3deb7456 = $localize`:@@accounting.chart-of-accounts.type.3deb7456:Type`;
  readonly loc_sous_compte_de_7f47036e = $localize`:@@accounting.chart-of-accounts.sous.compte.de.7f47036e:Sous compte de`;
  readonly loc_compte_d_affectation_4a67171b = $localize`:@@accounting.chart-of-accounts.compte.d.affectation.4a67171b:Compte d'affectation`;
  readonly loc_non_modifiable_1c6df9f1 = $localize`:@@accounting.chart-of-accounts.non.modifiable.1c6df9f1:Non modifiable`;
  readonly loc_enregistrement_e7d5f2 = $localize`:@@ui.tern.enregistrement.e7d5f2:Enregistrement…`;
  readonly loc_enregistrer_f7c8bc = $localize`:@@ui.tern.enregistrer.f7c8bc:Enregistrer`;
  readonly loc_fiscalid_help_client_1587022f = $localize`:@@accounting.chart-of-accounts.utilise.pour.rattacher.automatiquement.a.ce.comp.1587022f:Utilisé pour rattacher automatiquement à ce compte les factures importées de ce client.`;
  readonly loc_fiscalid_help_supplier_7579ceec = $localize`:@@accounting.chart-of-accounts.utilise.pour.rattacher.automatiquement.a.ce.comp.7579ceec:Utilisé pour rattacher automatiquement à ce compte les factures importées de ce fournisseur.`;
  private readonly loc_client_1bdd79b1 = $localize`:@@accounting.chart-of-accounts.client.1bdd79b1:Client`;
  private readonly loc_fournisseur_97d91d89 = $localize`:@@accounting.chart-of-accounts.fournisseur.97d91d89:Fournisseur`;
  private readonly loc_autre_43dacf9e = $localize`:@@accounting.chart-of-accounts.autre.43dacf9e:Autre`;
  private readonly loc_auxiliaire_b8c6c266 = $localize`:@@accounting.chart-of-accounts.auxiliaire.b8c6c266:Auxiliaire`;
  private readonly loc_general_5376df98 = $localize`:@@accounting.chart-of-accounts.general.5376df98:Général`;

  ngOnInit(): void {
    this.syncFromAccount();
  }

  ngAfterViewInit(): void {
    this.labelInputRef?.nativeElement.focus();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close();
  }

  private syncFromAccount(): void {
    const acc = this.account();
    if (this.initializedForId === acc.id) return;
    this.initializedForId = acc.id;
    this.label = acc.label;
    this.fiscalId = acc.fiscalId ?? '';
    this.saveError.set(null);
    this.serverError.set(null);
  }

  accountTypeLabel(): string {
    const type = this.account().accountType;
    if (type === 1) return this.loc_client_1bdd79b1;
    if (type === 2) return this.loc_fournisseur_97d91d89;
    return this.loc_autre_43dacf9e;
  }

  accountKindLabel(): string {
    return this.account().isAuxiliary ? this.loc_auxiliaire_b8c6c266 : this.loc_general_5376df98;
  }

  parentLabel(): string | null {
    const parentNumber = this.account().parentAccountNumber;
    if (!parentNumber) return null;
    const parent = this.rows().find(r => r.accountNumber === parentNumber);
    return parent ? `${parent.accountNumber} — ${parent.label}` : parentNumber;
  }

  showFiscalIdField(): boolean {
    this.syncFromAccount();
    return accountSupportsFiscalId(this.account().accountType, this.account().isAuxiliary);
  }

  fiscalIdError(): string | null {
    if (!this.showFiscalIdField()) return null;
    return fiscalIdFieldError(
      this.serverError(), this.fiscalId, this.rows(), this.account().accountType, this.account().id);
  }

  normalizeFiscalIdInput(raw: string): string {
    return normalizeFiscalIdInput(raw);
  }

  canSave(): boolean {
    this.syncFromAccount();
    if (this.label.trim().length === 0) return false;
    if (this.fiscalIdError()) return false;
    const acc = this.account();
    const normalizedFiscalId = this.showFiscalIdField() ? normalizeFiscalIdInput(this.fiscalId) : '';
    const changed = this.label.trim() !== acc.label || normalizedFiscalId !== (acc.fiscalId ?? '');
    return changed;
  }

  save(): void {
    if (!this.canSave() || this.saving()) return;
    const acc = this.account();
    const supportsFiscalId = this.showFiscalIdField();
    const fiscalId = supportsFiscalId ? normalizeFiscalIdInput(this.fiscalId) : '';
    this.saveError.set(null);
    this.serverError.set(null);
    this.saving.set(true);
    this.api.updateChartOfAccount(acc.id, {
      label: this.label.trim(),
      fiscalId: fiscalId || null,
      updateFiscalId: supportsFiscalId
    }).subscribe({
      next: res => {
        this.saving.set(false);
        if (res.success) {
          this.saved.emit();
        } else {
          const fiscalIdErr = extractFiscalIdServerError(res);
          if (fiscalIdErr) {
            this.serverError.set(fiscalIdErr);
          } else {
            this.saveError.set(res.error ?? $localize`:@@accounting.chart-of-accounts.la.modification.du.compte.a.echoue.5b8a6cb1:La modification du compte a échoué.`);
          }
        }
      },
      error: err => {
        this.saving.set(false);
        const fiscalIdErr = extractFiscalIdServerError(err);
        if (fiscalIdErr) {
          this.serverError.set(fiscalIdErr);
        } else {
          this.saveError.set($localize`:@@accounting.chart-of-accounts.erreur.reseau.lors.de.la.modification.du.compte.bb78977b:Erreur réseau lors de la modification du compte.`);
        }
      }
    });
  }

  close(): void {
    this.closed.emit();
  }
}
