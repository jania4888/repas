/// <reference types="@angular/localize" />
import { Component, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Table, TableModule } from 'primeng/table';
import { InputTextModule } from 'primeng/inputtext';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AccountingService, ChartOfAccountDto, CreateSubAccountRequest, TunisianBankCatalogEntry } from '../services/accounting.service';
import { AccountingFilterBarComponent } from '../shared/accounting-filter-bar.component';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import { AnalyzeWithAiButtonComponent } from '@features/ai-assistant/components/analyze-with-ai-button/analyze-with-ai-button.component';
import { wrapLegacyAnalyzePayload } from '@features/ai-assistant/utils/ai-screen-payload.factory';
import { AuthService } from '@core/services/auth.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { ToastService } from '@core/services/toast.service';
import {
  accountSupportsFiscalId,
  extractFiscalIdServerError,
  fiscalIdFieldError,
  normalizeFiscalIdInput
} from './chart-account-fiscal-id';
import { ChartAccountEditDialogComponent } from './chart-account-edit-dialog.component';
import { NifMaskPasteDirective } from '@shared/validation/nif-mask-paste.directive';
import { NIF_MAX_INPUT_LENGTH, isValidNif } from '@shared/validation/validation-rules';

/** SCE tunisien : classe 1–7, chiffres, segments optionnels après un point (ex. 428.3). */
export const SCE_ACCOUNT_NUMBER_PATTERN = /^[1-7]\d*(?:\.\d+)*$/;

/**
 * Plafond de chiffres d'un numéro de compte, aligné sur `AccountNumberRules.MaxDigits` côté serveur.
 * On compte les chiffres, pas les caractères : `421.1` en vaut 4 et reste valide.
 */
export const SCE_ACCOUNT_MAX_DIGITS = 8;

export function sceAccountDigitCount(accountNumber: string): number {
  let count = 0;
  for (const c of accountNumber) {
    if (c >= '0' && c <= '9') count++;
  }
  return count;
}

/** Feuille 5321x (dinars) ou 5324x (devises). Les collectifs 532 / 5321 / 5324 sont exclus. */
export function isProvisionableBankLeaf(accountNumber: string | null | undefined): boolean {
  const digits = (accountNumber ?? '').replace(/\D/g, '');
  if (digits === '532' || digits === '5321' || digits === '5324') return false;
  return digits.startsWith('5321') || digits.startsWith('5324');
}

/** Encadré bancaire : numéro déjà une feuille, ou parent 5321/5324 tant que le numéro n'est pas un autre compte. */
export function showsBankImportPanel(accountNumber: string, parent: string | null): boolean {
  const digits = accountNumber.replace(/\D/g, '');
  if (digits.length >= 5) return isProvisionableBankLeaf(digits);
  const parentDigits = (parent ?? '').replace(/\D/g, '');
  return parentDigits.startsWith('5321') || parentDigits.startsWith('5324');
}

export function isFxBankLeaf(accountNumber: string, parent: string | null): boolean {
  const digits = accountNumber.replace(/\D/g, '');
  if (digits.startsWith('5321')) return false;
  if (digits.startsWith('5324')) return true;
  return (parent ?? '').replace(/\D/g, '').startsWith('5324');
}

@Component({
  selector: 'app-chart-of-accounts',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    InputTextModule,
    ConfirmDialogModule,
    PageHeaderComponent,
    ButtonComponent,
    AccountingFilterBarComponent,
    AccountingStatusBannerComponent,
    AnalyzeWithAiButtonComponent,
    ChartAccountEditDialogComponent,
    NifMaskPasteDirective
  ],
  providers: [ConfirmationService],
  template: `
    <app-page-header title="Plan comptable" i18n-title="@@accounting.chart-of-accounts.plan.comptable.b3f54c09" subtitle="NCT 01 + overlay métier — comptes système verrouillés" i18n-subtitle="@@accounting.chart-of-accounts.nct.01.overlay.metier.comptes.systeme.ve.7c97c14f" />
    <p-confirmDialog />
    <div class="card coa-card">
      <app-accounting-filter-bar ariaLabel="Recherche et actualisation du plan comptable" i18n-ariaLabel="@@accounting.chart-of-accounts.recherche.et.actualisation.du.plan.compt.9e032a53">
        <div accountingFilterFields class="chart-accounts-toolbar-main">
          <span class="p-input-icon-left coa-search-wrap">
            <i class="pi pi-search" aria-hidden="true"></i>
            <input
              type="text"
              pInputText
              class="coa-search-input"
              [(ngModel)]="searchTerm"
              (ngModelChange)="onSearchChange()"
              placeholder="Rechercher par n° de compte, libellé ou matricule fiscal" i18n-placeholder="@@accounting.chart-of-accounts.rechercher.par.n.de.compte.libelle.ou.matricule..c25eae50"
              aria-label="Filtrer le plan comptable" i18n-aria-label="@@accounting.chart-of-accounts.filtrer.le.plan.comptable.f9c60a07" />
          </span>
        </div>
        <div accountingFilterActions class="coa-toolbar-right">
          @if (canCreate) {
            <app-button
              variant="primary"
              icon="pi pi-plus"
              iconPos="left"
              type="button"
              (click)="openCreate()"
              ariaLabel="Créer un nouveau compte comptable" i18n-ariaLabel="@@accounting.chart-of-accounts.creer.un.nouveau.compte.comptable.717dd6d9" i18n="@@accounting.chart-of-accounts.nouveau.compte.9c08a4c7"> Nouveau compte </app-button>
          }
          <app-button
            variant="secondary"
            icon="pi pi-refresh"
            iconPos="left"
            type="button"
            (click)="load()"
            ariaLabel="Actualiser le plan comptable" i18n-ariaLabel="@@accounting.chart-of-accounts.actualiser.le.plan.comptable.1eacb0f3" i18n="@@accounting.chart-of-accounts.actualiser.9d3b2a7d"> Actualiser </app-button>
          <app-analyze-with-ai-button
            screenId="accounting-chart"
            density="toolbar"
            [payloadBuilder]="buildChartAnalyzePayload"
            [disabled]="loading()" />
          @if (auxiliaryCount() > 0) {
            <label class="coa-aux-filter">
              <input
                type="checkbox"
                [ngModel]="hideAuxiliary()"
                (ngModelChange)="hideAuxiliary.set($event)"
                [ngModelOptions]="{ standalone: true }" />
              <span i18n="@@accounting.chart-of-accounts.masquer.les.comptes.auxiliaires.ca6a40b1">Masquer les comptes auxiliaires ({{ auxiliaryCount() }})</span>
            </label>
          }
          <p class="coa-count" aria-live="polite" i18n="@@accounting.chart-of-accounts.compte.87c3614c.pl">
            <span class="coa-count-value">{{ visibleRows().length }}</span>
            <span class="coa-count-label"> {visibleRows().length, plural, =1 {compte} other {comptes}}</span>
          </p>
        </div>
      </app-accounting-filter-bar>
      <app-accounting-status-banner
        variant="error"
        [message]="error() ?? ''"
        [showRetry]="!!error()"
        retryLabel="Réessayer" i18n-retryLabel="@@accounting.chart-of-accounts.reessayer.c4f78b12"
        (retry)="load()" />
      <p-table
        #dt
        [value]="visibleRows()"
        [paginator]="true"
        [rows]="25"
        [rowsPerPageOptions]="[25, 50, 100]"
        [globalFilterFields]="['accountNumber', 'label', 'fiscalId']"
        [loading]="loading()"
        [rowHover]="true"
        [showCurrentPageReport]="true"
        [sortField]="'accountNumber'"
        [sortOrder]="1"
        currentPageReportTemplate="Affichage de {first} à {last} sur {totalRecords} comptes" i18n-currentPageReportTemplate="@@accounting.chart-of-accounts.affichage.de.first.a.last.sur.totalrecords.compt.4470e3a3"
        styleClass="p-datatable-sm coa-table accounting-datatable">
        <ng-template pTemplate="header">
          <tr>
            <th pSortableColumn="accountNumber" scope="col">
              <ng-container i18n="@@accounting.chart-of-accounts.compte.c45740bb"> Compte </ng-container> <p-sortIcon field="accountNumber" />
            </th>
            <th pSortableColumn="label" scope="col">
              <ng-container i18n="@@accounting.chart-of-accounts.libelle.f5485bba"> Libellé </ng-container> <p-sortIcon field="label" />
            </th>
            <th scope="col" class="coa-col-narrow" i18n="@@accounting.chart-of-accounts.matricule.fiscal.304096c4">Matricule fiscal</th>
            <th pSortableColumn="accountClass" scope="col" class="coa-col-narrow">
              <ng-container i18n="@@accounting.chart-of-accounts.classe.3c38412a"> Classe </ng-container> <p-sortIcon field="accountClass" />
            </th>
            <th scope="col" class="coa-col-narrow" i18n="@@accounting.chart-of-accounts.systeme.62d09520">Système</th>
            <th scope="col" class="coa-col-narrow" i18n="@@accounting.chart-of-accounts.auxiliaire.b8c6c266">Auxiliaire</th>
            <th scope="col" class="coa-col-narrow" i18n="@@accounting.chart-of-accounts.statut.659499f3">Statut</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-r>
          <tr [class.coa-row-inactive]="!r.isActive">
            <td class="coa-account-cell" data-label="Compte" i18n-data-label="@@accounting.chart-of-accounts.compte.c45740bb">
              <span class="coa-account-code" [style.paddingInlineStart.rem]="indentRem(r.level)">{{ r.accountNumber }}</span>
            </td>
            <td data-label="Libellé" i18n-data-label="@@accounting.chart-of-accounts.libelle.f5485bba">{{ r.label }}</td>
            <td class="coa-col-narrow" data-label="Matricule fiscal" i18n-data-label="@@accounting.chart-of-accounts.matricule.fiscal.304096c4">
              @if (r.fiscalId) {
                <span class="coa-nif">{{ r.fiscalId }}</span>
              } @else {
                <span class="coa-aux-none" i18n="@@accounting.chart-of-accounts.text.1b93795b">—</span>
              }
            </td>
            <td class="coa-col-narrow coa-class-cell" data-label="Classe" i18n-data-label="@@accounting.chart-of-accounts.classe.3c38412a">{{ r.accountClass }}</td>
            <td class="coa-col-narrow" data-label="Système" i18n-data-label="@@accounting.chart-of-accounts.systeme.62d09520">
              <span
                class="coa-badge"
                [class.coa-badge--yes]="r.isSystem"
                [class.coa-badge--no]="!r.isSystem">
                {{ r.isSystem ? loc_ui_tern_oui_eaa02f : loc_ui_tern_non_a72199 }}
              </span>
            </td>
            <td class="coa-col-narrow" data-label="Auxiliaire" i18n-data-label="@@accounting.chart-of-accounts.auxiliaire.b8c6c266">
              @if (r.isAuxiliary) {
                <span
                  class="coa-badge coa-badge--aux"
                  [title]="r.affectationAccountNumber ? loc_ui_tern_rattache_au_compte_324197 + r.affectationAccountNumber : ''">
                  {{ r.affectationAccountNumber || 'Oui' }}
                </span>
              } @else {
                <span class="coa-aux-none" i18n="@@accounting.chart-of-accounts.text.1b93795b">—</span>
              }
            </td>
            <td class="coa-col-narrow" data-label="Statut" i18n-data-label="@@accounting.chart-of-accounts.statut.659499f3">
              <span class="coa-status-cell">
                <span
                  class="coa-badge"
                  [class.coa-badge--yes]="r.isActive"
                  [class.coa-badge--no]="!r.isActive">
                  {{ r.isActive ? loc_ui_tern_actif_2eb75f : loc_ui_tern_inactif_d2e033 }}
                </span>
                @if (canCreate && !r.isSystem) {
                  <button
                    type="button"
                    class="coa-toggle-btn"
                    (click)="startEdit(r, $event)"
                    [attr.aria-label]="loc_ui_tern_modifier_le_compte_018a44a1 + r.accountNumber"
                    i18n="@@accounting.chart-of-accounts.modifier.f260e757">
                    Modifier
                  </button>
                  <button
                    type="button"
                    class="coa-toggle-btn"
                    [disabled]="togglingId() === r.id"
                    (click)="confirmToggleActive(r)"
                    [attr.aria-label]="(r.isActive ? loc_ui_tern_desactiver_d28397 : loc_ui_tern_reactiver_822dbd) + loc_ui_tern_le_compte_e8f216 + r.accountNumber">
                    {{ r.isActive ? loc_ui_tern_desactiver_d28397 : loc_ui_tern_reactiver_822dbd }}
                  </button>
                }
              </span>
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="7" class="coa-empty">
              <p class="coa-empty-title" i18n="@@accounting.chart-of-accounts.aucun.resultat.9e524fe1">Aucun résultat</p>
              <p class="coa-empty-hint" i18n="@@accounting.chart-of-accounts.ajustez.la.recherche.ou.actualisez.la.liste.c28a5fae">Ajustez la recherche ou actualisez la liste.</p>
            </td>
          </tr>
        </ng-template>
      </p-table>
    </div>

    @if (showCreate()) {
      <div class="coa-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="coa-create-title">
        <div class="coa-modal">
          <h2 id="coa-create-title" class="coa-modal-title" i18n="@@accounting.chart-of-accounts.nouveau.compte.comptable.c517e173">Nouveau compte comptable</h2>
          <p class="coa-modal-sub" i18n="@@accounting.chart-of-accounts.plan.comptable.gestion.des.comptes.619b25d6">Plan comptable — Gestion des comptes</p>

          <h3 class="coa-sec" i18n="@@accounting.chart-of-accounts.type.de.compte.b6544864">Type de compte</h3>
          <div class="coa-type-row">
            <button type="button" class="coa-type" [class.coa-type--on]="form.accountType === 2" (click)="setType(2)" i18n="@@accounting.chart-of-accounts.fournisseur.a1324303"><i class="pi pi-truck"></i> Fournisseur</button>
            <button type="button" class="coa-type" [class.coa-type--on]="form.accountType === 1" (click)="setType(1)" i18n="@@accounting.chart-of-accounts.client.e9ef2d15"><i class="pi pi-user"></i> Client</button>
            <button type="button" class="coa-type" [class.coa-type--on]="form.accountType === 3 || form.accountType === 0" (click)="setType(3)" i18n="@@accounting.chart-of-accounts.autre.9211ea87"><i class="pi pi-ellipsis-h"></i> Autre</button>
          </div>

          <h3 class="coa-sec" i18n="@@accounting.chart-of-accounts.hierarchie.du.compte.edd80076">Hiérarchie du compte</h3>
          <div class="coa-grid">
            <div class="coa-field">
              <label class="coa-lbl" for="coa-aux" i18n="@@accounting.chart-of-accounts.type.3deb7456">Type</label>
              <select id="coa-aux" class="coa-inp" [(ngModel)]="form.isAuxiliary" (ngModelChange)="onAuxiliaryChange($event)">
                <option [ngValue]="true" i18n="@@accounting.chart-of-accounts.auxiliaire.b8c6c266">Auxiliaire</option>
                <option [ngValue]="false" i18n="@@accounting.chart-of-accounts.general.5376df98">Général</option>
              </select>
            </div>
            <div class="coa-field coa-field-wide">
              <label class="coa-lbl" for="coa-parent" i18n="@@accounting.chart-of-accounts.sous.compte.de.7f47036e">Sous compte de</label>
              <select id="coa-parent" class="coa-inp" [(ngModel)]="form.parentAccountNumber" (ngModelChange)="onParentChange($event)">
                <option [ngValue]="null" i18n="@@accounting.chart-of-accounts.text.1b93795b">—</option>
                @for (a of parentOptions(); track a.accountNumber) {
                  <option [ngValue]="a.accountNumber">{{ a.accountNumber }} — {{ a.label }}</option>
                }
              </select>
            </div>
            @if (form.isAuxiliary) {
              <div class="coa-field coa-field-wide">
                <label class="coa-lbl" for="coa-affect" i18n="@@accounting.chart-of-accounts.compte.d.affectation.4a67171b">Compte d'affectation</label>
                <select id="coa-affect" class="coa-inp" [(ngModel)]="form.affectationAccountNumber">
                  <option [ngValue]="null" i18n="@@accounting.chart-of-accounts.text.1b93795b">—</option>
                  @for (a of rows(); track a.accountNumber) {
                    <option [ngValue]="a.accountNumber">{{ a.accountNumber }} — {{ a.label }}</option>
                  }
                </select>
              </div>
            }
          </div>

          <h3 class="coa-sec" i18n="@@accounting.chart-of-accounts.identification.9d2c7063">Identification</h3>
          <div class="coa-grid">
            <div class="coa-field">
              <label class="coa-lbl" for="coa-num" i18n="@@accounting.chart-of-accounts.compte.numero.f569fef7">Compte numéro</label>
              <input id="coa-num" class="coa-inp" [(ngModel)]="form.accountNumber" (ngModelChange)="onAccountNumberChange()" [maxlength]="accountNumberMaxLength" placeholder="Ex. 428.3 ou 41100001" i18n-placeholder="@@accounting.chart-of-accounts.ex.428.3.ou.41100001.5e8b90c4" />
              @if (accountNumberError(); as numError) {
                <p class="coa-create-error" role="alert">{{ numError }}</p>
              }
            </div>
            <div class="coa-field coa-field-wide">
              <label class="coa-lbl" for="coa-label" i18n="@@accounting.chart-of-accounts.libelle.f5485bba">Libellé</label>
              <input id="coa-label" class="coa-inp" [(ngModel)]="form.label" placeholder="Ex. Client Société X" i18n-placeholder="@@accounting.chart-of-accounts.ex.client.societe.x.947766e4" />
            </div>
            @if (showFiscalIdField()) {
              <div class="coa-field coa-field-full">
                <label class="coa-lbl" for="coa-fiscal-id" i18n="@@accounting.chart-of-accounts.matricule.fiscal.facultatif.2d99c70e">Matricule fiscal (facultatif)</label>
                <input
                  id="coa-fiscal-id"
                  class="coa-inp coa-inp--nif"
                  [class.coa-inp--invalid]="!!fiscalIdError()"
                  [attr.aria-invalid]="fiscalIdError() ? true : null"
                  [attr.aria-describedby]="fiscalIdError() ? 'coa-fiscal-id-error' : 'coa-fiscal-id-help'"
                  [(ngModel)]="form.fiscalId"
                  (ngModelChange)="fiscalIdServerError.set(null)"
                  (blur)="form.fiscalId = normalizeFiscalIdInput(form.fiscalId)"
                  appNifMaskPaste
                  [maxlength]="fiscalIdMaxInputLength"
                  placeholder="Ex. 1234567A/B/M/000" i18n-placeholder="@@accounting.chart-of-accounts.ex.1234567a.b.m.000.9d9247ba"
                  autocomplete="off" spellcheck="false" />
                @if (fiscalIdError(); as fiscalIdErr) {
                  <p id="coa-fiscal-id-error" class="coa-create-error" role="alert">{{ fiscalIdErr }}</p>
                } @else {
                  <p id="coa-fiscal-id-help" class="coa-help">
                    {{ form.accountType === 1 ? loc_fiscalid_help_client_1587022f : loc_fiscalid_help_supplier_7579ceec }}
                  </p>
                }
              </div>
            }
          </div>

          @if (showsBankPanel()) {
            <h3 class="coa-sec" i18n="@@accounting.chart-of-accounts.compte.bancaire.import.releves">Compte bancaire (import de relevés)</h3>
            <p class="coa-bank-hint" i18n="@@accounting.chart-of-accounts.ce.compte.apparaitra.dans.l.import">
              Ce compte apparaîtra dans l'import de relevés. Le RIB est facultatif : vous pourrez le compléter dans Paiements › Comptes bancaires.
            </p>
            <div class="coa-grid">
              <div class="coa-field coa-field-wide">
                <label class="coa-lbl" for="coa-bank" i18n="@@accounting.chart-of-accounts.banque.facultative">Banque (facultatif)</label>
                <select id="coa-bank" class="coa-inp" [(ngModel)]="form.bankCode">
                  <option value="" i18n="@@accounting.chart-of-accounts.detecter.depuis.le.libelle">Détecter depuis le libellé</option>
                  @for (bank of tunisianBanks(); track bank.code) {
                    <option [value]="bank.code">{{ bank.name }}</option>
                  }
                </select>
              </div>
              <div class="coa-field">
                <label class="coa-lbl" for="coa-rib" i18n="@@accounting.chart-of-accounts.rib.facultatif">RIB (facultatif)</label>
                <input id="coa-rib" class="coa-inp" [(ngModel)]="form.rib" maxlength="32" autocomplete="off" />
              </div>
              <div class="coa-field coa-field-wide">
                <label class="coa-lbl" for="coa-iban" i18n="@@accounting.chart-of-accounts.iban.facultatif">IBAN (facultatif)</label>
                <input id="coa-iban" class="coa-inp" [(ngModel)]="form.iban" maxlength="34" autocomplete="off" />
              </div>
              @if (showsFxCurrency()) {
                <div class="coa-field">
                  <label class="coa-lbl" for="coa-ccy" i18n="@@accounting.chart-of-accounts.devise.iso">Devise ISO</label>
                  <input id="coa-ccy" class="coa-inp" [(ngModel)]="form.bankCurrency" maxlength="3" placeholder="EUR" />
                </div>
              }
            </div>
          }

          @if (createError()) {
            <p class="coa-create-error" role="alert">{{ createError() }}</p>
          }

          <div class="coa-modal-actions">
            <button type="button" class="btn btn-secondary" (click)="closeCreate()" [disabled]="creating()" i18n="@@accounting.chart-of-accounts.annuler.49ba3292">Annuler</button>
            <button type="button" class="btn btn-primary" (click)="create()" [disabled]="creating() || !canSubmit()">
              {{ creating() ? loc_ui_tern_enregistrement_e7d5f2 : loc_ui_tern_enregistrer_f7c8bc }}
            </button>
          </div>
        </div>
      </div>
    }

    @if (editing(); as acc) {
      <app-chart-account-edit-dialog
        [account]="acc"
        [rows]="rows()"
        (saved)="onEdited()"
        (closed)="closeEdit()" />
    }
  `,
  styles: `
    .coa-card {
      padding: var(--spacing-5);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-sm, 0 1px 3px rgba(15, 23, 42, 0.08));
    }
    .coa-toolbar-right {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--spacing-3);
    }
    .chart-accounts-toolbar-main {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--spacing-3);
      flex: 1 1 280px;
      min-width: 0;
    }
    .coa-search-wrap.p-input-icon-left {
      position: relative;
      flex: 1 1 220px;
      max-width: 420px;
      min-width: 180px;
    }
    .coa-search-wrap.p-input-icon-left i {
      position: absolute;
      inset-inline-start: var(--spacing-3);
      top: 50%;
      transform: translateY(-50%);
      color: var(--color-text-secondary);
      pointer-events: none;
    }
    :host ::ng-deep .coa-search-wrap .p-inputtext,
    :host ::ng-deep .coa-search-input {
      width: 100%;
      padding-inline-start: var(--spacing-8);
    }
    .coa-count {
      margin: 0;
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
    }
    .coa-aux-filter { display: inline-flex; align-items: center; gap: .4rem; font-size: .8rem;
      color: var(--text-color-secondary, #64748b); cursor: pointer; white-space: nowrap; }
    .coa-badge--aux { background: var(--surface-100, #f1f5f9); color: var(--text-color, #334155);
      font-variant-numeric: tabular-nums; }
    .coa-aux-none { color: var(--text-color-secondary, #94a3b8); }
    .coa-count-value {
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
      font-variant-numeric: tabular-nums;
    }
    .coa-error {
      margin: 0 0 var(--spacing-3);
    }
    .coa-account-cell {
      vertical-align: middle;
    }
    .coa-account-code {
      display: inline-block;
      font-variant-numeric: tabular-nums;
      font-weight: var(--font-weight-medium);
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      color: var(--color-text-primary);
    }
    .coa-col-narrow {
      width: 1%;
      white-space: nowrap;
    }
    .coa-class-cell {
      font-variant-numeric: tabular-nums;
      text-align: center;
    }
    .coa-badge {
      display: inline-flex;
      align-items: center;
      padding: 0.2rem 0.5rem;
      border-radius: var(--radius-md);
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-semibold);
      border: 1px solid var(--color-border-subtle);
      background: var(--color-background-subtle);
      color: var(--color-text-secondary);
    }
    .coa-badge--yes {
      border-color: var(--color-primary-200);
      background: var(--color-primary-50, rgba(37, 99, 235, 0.08));
      color: var(--color-primary-700, var(--color-primary-600));
    }
    .coa-badge--no {
      background: var(--color-background-elevated);
      color: var(--color-text-tertiary);
    }
    .coa-status-cell {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-2);
    }
    .coa-toggle-btn {
      padding: 0.2rem 0.55rem;
      border-radius: var(--radius-md);
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-semibold);
      cursor: pointer;
      border: 1px solid var(--color-border-default);
      background: var(--color-background-elevated);
      color: var(--color-text-secondary);
    }
    .coa-toggle-btn:hover:not(:disabled) {
      border-color: var(--color-primary-500, #2563eb);
      color: var(--color-primary-700, #1d4ed8);
    }
    .coa-toggle-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .coa-row-inactive {
      opacity: 0.72;
    }
    .coa-row-inactive .coa-account-code,
    .coa-row-inactive td:not(.coa-col-narrow) {
      color: var(--color-text-tertiary);
    }
    .coa-empty {
      text-align: center;
      padding: var(--spacing-8) var(--spacing-4) !important;
      border: none !important;
    }
    .coa-empty-title {
      margin: 0 0 var(--spacing-2);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
    }
    .coa-empty-hint {
      margin: 0;
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
    }
    :host ::ng-deep .coa-table .p-datatable-thead > tr > th {
      text-transform: uppercase;
      font-size: var(--font-size-xs);
      letter-spacing: 0.04em;
      color: var(--color-text-tertiary);
      background: var(--color-background-subtle);
    }
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
    .coa-type-row { display: flex; gap: var(--spacing-2); flex-wrap: wrap; }
    .coa-type {
      flex: 1 1 8rem; display: inline-flex; align-items: center; justify-content: center; gap: var(--spacing-2);
      padding: var(--spacing-3); border: 1px solid var(--color-border-default); border-radius: var(--radius-md);
      background: var(--color-background-elevated); color: var(--color-text-secondary); cursor: pointer; font-size: var(--font-size-sm); font-weight: var(--font-weight-medium);
    }
    .coa-type--on { border-color: var(--color-primary-500, #2563eb); background: var(--color-primary-50, #eff6ff); color: var(--color-primary-700, #1d4ed8); }
    .coa-grid { display: flex; flex-wrap: wrap; gap: var(--spacing-3); }
    .coa-field { display: flex; flex-direction: column; gap: var(--spacing-1); flex: 1 1 10rem; }
    .coa-field-wide { flex: 2 1 16rem; }
    .coa-field-full { flex: 1 1 100%; }
    .coa-inp--nif { font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace); letter-spacing: 0.02em; text-transform: uppercase; }
    .coa-inp--invalid { border-color: #f04438; box-shadow: 0 0 0 3px rgba(240, 68, 56, 0.12); }
    .coa-help { margin: 0; font-size: var(--font-size-xs); color: var(--color-text-tertiary); line-height: 1.4; }
    .coa-nif { font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace); font-size: var(--font-size-sm); font-variant-numeric: tabular-nums; color: var(--color-text-primary); white-space: nowrap; }
    .coa-lbl { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); }
    .coa-inp { padding: var(--spacing-2) var(--spacing-3); border: 1px solid var(--color-border-default); border-radius: var(--radius-md); background: var(--color-background-elevated); color: var(--color-text-primary); font-size: var(--font-size-sm); width: 100%; }
    .coa-bank-hint {
      margin: 0 0 var(--spacing-3);
      color: var(--color-text-secondary);
      font-size: var(--font-size-sm);
    }
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
  `
})
export class ChartOfAccountsComponent implements OnInit {
  readonly loc_ui_tern_oui_eaa02f = $localize`:@@ui.tern.oui.eaa02f:Oui`;
  readonly loc_ui_tern_non_a72199 = $localize`:@@ui.tern.non.a72199:Non`;
  readonly loc_ui_tern_rattache_au_compte_324197 = $localize`:@@ui.tern.rattache.au.compte.324197:Rattaché au compte `;
  readonly loc_ui_tern_actif_2eb75f = $localize`:@@ui.tern.actif.2eb75f:Actif`;
  readonly loc_ui_tern_inactif_d2e033 = $localize`:@@ui.tern.inactif.d2e033:Inactif`;
  readonly loc_ui_tern_desactiver_d28397 = $localize`:@@ui.tern.desactiver.d28397:Désactiver`;
  readonly loc_ui_tern_reactiver_822dbd = $localize`:@@ui.tern.reactiver.822dbd:Réactiver`;
  readonly loc_ui_tern_le_compte_e8f216 = $localize`:@@ui.tern.le.compte.e8f216: le compte `;
  readonly loc_ui_tern_enregistrement_e7d5f2 = $localize`:@@ui.tern.enregistrement.e7d5f2:Enregistrement…`;
  readonly loc_ui_tern_enregistrer_f7c8bc = $localize`:@@ui.tern.enregistrer.f7c8bc:Enregistrer`;
  readonly loc_ui_tern_modifier_le_compte_018a44a1 = $localize`:@@accounting.chart-of-accounts.modifier.le.compte.018a44a1:Modifier le compte `;
  readonly loc_fiscalid_help_client_1587022f = $localize`:@@accounting.chart-of-accounts.utilise.pour.rattacher.automatiquement.a.ce.comp.1587022f:Utilisé pour rattacher automatiquement à ce compte les factures importées de ce client.`;
  readonly loc_fiscalid_help_supplier_7579ceec = $localize`:@@accounting.chart-of-accounts.utilise.pour.rattacher.automatiquement.a.ce.comp.7579ceec:Utilisé pour rattacher automatiquement à ce compte les factures importées de ce fournisseur.`;
  private readonly api = inject(AccountingService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly errorHandler = inject(ErrorHandlerService);
  private readonly confirmService = inject(ConfirmationService);

  @ViewChild('dt') dt?: Table;

  readonly rows = signal<ChartOfAccountDto[]>([]);

  /**
   * Masque les comptes auxiliaires (salariés, comptes bancaires…). Décoché par défaut : on ne
   * cache rien tant que l'utilisateur ne le demande pas.
   *
   * Le filtre porte sur `visibleRows`, pas sur `rows` : le dialogue de création lit `rows` pour
   * proposer les comptes parents, et masquer une partie du plan l'amputerait silencieusement.
   */
  readonly hideAuxiliary = signal(false);

  readonly auxiliaryCount = computed(() => this.rows().filter(r => r.isAuxiliary).length);

  readonly visibleRows = computed(() =>
    this.hideAuxiliary() ? this.rows().filter(r => !r.isAuxiliary) : this.rows());
  readonly error = signal<string | null>(null);
  readonly createError = signal<string | null>(null);
  readonly loading = signal(false);

  readonly canCreate = this.auth.hasPermission('accounting:create');
  readonly showCreate = signal(false);
  readonly creating = signal(false);
  readonly togglingId = signal<string | null>(null);
  readonly tunisianBanks = signal<TunisianBankCatalogEntry[]>([]);
  readonly fiscalIdServerError = signal<string | null>(null);
  readonly editing = signal<ChartOfAccountDto | null>(null);
  private editTriggerEl: HTMLElement | null = null;

  /** Laisse l'utilisateur taper la forme historique avant la canonisation au blur. */
  readonly fiscalIdMaxInputLength = NIF_MAX_INPUT_LENGTH;

  form = this.emptyForm();
  lastSuggestedNumber = '';

  searchTerm = '';

  private emptyForm() {
    return {
      accountType: 3 as number, // Autre par défaut
      isAuxiliary: false,
      parentAccountNumber: null as string | null,
      affectationAccountNumber: null as string | null,
      accountNumber: '',
      label: '',
      bankCode: '',
      rib: '',
      iban: '',
      bankCurrency: '',
      fiscalId: ''
    };
  }

  showFiscalIdField(): boolean {
    return accountSupportsFiscalId(this.form.accountType, this.form.isAuxiliary);
  }

  /** `null` si le champ est masqué ou valide ; sinon erreur serveur > format > doublon local. */
  fiscalIdError(): string | null {
    if (!this.showFiscalIdField()) return null;
    return fiscalIdFieldError(this.fiscalIdServerError(), this.form.fiscalId, this.rows(), this.form.accountType);
  }

  normalizeFiscalIdInput(raw: string): string {
    return normalizeFiscalIdInput(raw);
  }

  showsBankPanel(): boolean {
    return showsBankImportPanel(this.form.accountNumber, this.form.parentAccountNumber);
  }

  showsFxCurrency(): boolean {
    return isFxBankLeaf(this.form.accountNumber, this.form.parentAccountNumber);
  }

  openCreate(): void {
    this.form = this.emptyForm();
    this.lastSuggestedNumber = '';
    this.createError.set(null);
    this.fiscalIdServerError.set(null);
    this.showCreate.set(true);
    if (this.tunisianBanks().length === 0) {
      this.api.getTunisianBanks().subscribe({
        next: res => this.tunisianBanks.set(res?.data ?? []),
        error: () => this.tunisianBanks.set([])
      });
    }
  }

  closeCreate(): void {
    this.showCreate.set(false);
    this.createError.set(null);
    this.fiscalIdServerError.set(null);
  }

  /** Sélectionne le type de compte et pré-remplit la hiérarchie (façon Axeane). */
  setType(type: number): void {
    this.form.accountType = type;
    if (type === 1) { // Client
      this.form.isAuxiliary = true;
      const parent = this.rows().find(a => a.accountNumber.startsWith('411')) ?? this.rows().find(a => a.accountNumber.startsWith('41'));
      this.form.parentAccountNumber = parent?.accountNumber ?? null;
      this.form.affectationAccountNumber = parent?.accountNumber ?? null;
      this.applySuggestedNumber(this.form.parentAccountNumber);
    } else if (type === 2) { // Fournisseur
      this.form.isAuxiliary = true;
      const parent = this.rows().find(a => a.accountNumber.startsWith('401')) ?? this.rows().find(a => a.accountNumber.startsWith('40'));
      this.form.parentAccountNumber = parent?.accountNumber ?? null;
      this.form.affectationAccountNumber = parent?.accountNumber ?? null;
      this.applySuggestedNumber(this.form.parentAccountNumber);
    } else {
      this.form.isAuxiliary = false;
      this.form.affectationAccountNumber = null;
    }
    if (!this.showFiscalIdField()) {
      this.form.fiscalId = '';
    }
    // Une erreur serveur (ex. doublon) est propre au type choisi : elle ne survit pas au
    // changement Client ↔ Fournisseur.
    this.fiscalIdServerError.set(null);
  }

  /** Bascule Auxiliaire/Général depuis le sélecteur de hiérarchie — n'envoie jamais un matricule fiscal masqué. */
  onAuxiliaryChange(isAuxiliary: boolean): void {
    this.form.isAuxiliary = isAuxiliary;
    if (!this.showFiscalIdField()) {
      this.form.fiscalId = '';
      this.fiscalIdServerError.set(null);
    }
  }

  onParentChange(parent: string | null): void {
    this.form.parentAccountNumber = parent;
    this.applySuggestedNumber(parent);
  }

  onAccountNumberChange(): void {
    this.createError.set(null);
  }

  applySuggestedNumber(parent: string | null): void {
    const current = this.form.accountNumber.trim();
    const canReplace = current.length === 0 || current === this.lastSuggestedNumber;
    if (!canReplace) return;
    const next = this.nextFreeChildNumber(parent);
    this.form.accountNumber = next ?? '';
    this.lastSuggestedNumber = next ?? '';
    this.createError.set(null);
  }

  /**
   * Prochain numéro libre sous le parent (43671 + 436711/436712 → 436713), borné à
   * {@link SCE_ACCOUNT_MAX_DIGITS} chiffres.
   *
   * La largeur du suffixe se déduit des frères existants : sans cette borne, un frère hérité à
   * 10 chiffres ferait proposer du 10 chiffres, que le serveur refuserait.
   */
  nextFreeChildNumber(parent: string | null): string | null {
    if (!parent) return null;

    const budget = SCE_ACCOUNT_MAX_DIGITS - sceAccountDigitCount(parent);
    if (budget < 1) return null;

    const existing = new Set(this.rows().map(r => r.accountNumber));
    let maxSuffix = 0;
    let width = 1;
    let foundChild = false;
    for (const acc of existing) {
      if (acc.length <= parent.length || !acc.startsWith(parent)) continue;
      const suffix = acc.slice(parent.length);
      if (!/^\d+$/.test(suffix) || suffix.length > budget) continue;
      foundChild = true;
      width = Math.max(width, suffix.length);
      maxSuffix = Math.max(maxSuffix, Number.parseInt(suffix, 10));
    }

    let candidate = foundChild ? maxSuffix + 1 : 1;
    for (let i = 0; i < 10000; i++) {
      const suffix = String(candidate).padStart(width, '0');
      if (suffix.length > budget) return null;
      const num = parent + suffix;
      if (!existing.has(num)) return num;
      candidate++;
    }
    return null;
  }

  formatDuplicateMessage(account: Pick<ChartOfAccountDto, 'accountNumber' | 'label'>): string {
    return $localize`:@@accounting.chart-of-accounts.ts.le.compte.accountnumber.existe.deja.labe.b94d0456:Le compte ${account.accountNumber}:accountNumber: existe déjà (${account.label}:label:).`;
  }

  /** Comptes proposés comme parent selon le type choisi. */
  parentOptions(): ChartOfAccountDto[] {
    const prefix = this.form.accountType === 1 ? '41' : this.form.accountType === 2 ? '40' : '';
    const list = prefix ? this.rows().filter(a => a.accountNumber.startsWith(prefix)) : this.rows();
    return list.filter(a => a.accountNumber !== this.form.accountNumber);
  }

  /**
   * Longueur maximale saisissable. Les formes pointées consomment des caractères sans consommer de
   * chiffres : on laisse la place à deux séparateurs, et `accountNumberError` tranche sur les chiffres.
   */
  readonly accountNumberMaxLength = SCE_ACCOUNT_MAX_DIGITS + 2;

  /** Message de refus du numéro saisi, ou `null` s'il est acceptable. */
  accountNumberError(): string | null {
    const num = this.form.accountNumber.trim();
    if (num.length === 0) return null;

    const digits = sceAccountDigitCount(num);
    if (digits > SCE_ACCOUNT_MAX_DIGITS) {
      return $localize`:@@accounting.chart-of-accounts.ts.le.compte.num.comporte.digits.chiffres.u.421b5b16:Le compte ${num}:num: comporte ${digits}:digits: chiffres : un numéro de compte ne peut pas en dépasser ${SCE_ACCOUNT_MAX_DIGITS}:SCE_ACCOUNT_MAX_DIGITS:.`;
    }

    if (num.length >= 2 && !SCE_ACCOUNT_NUMBER_PATTERN.test(num)) {
      return $localize`:@@accounting.chart-of-accounts.ts.le.numero.doit.etre.un.compte.sce.chiffr.37283b73:Le numéro doit être un compte SCE : chiffres, classe 1 à 7, points autorisés (ex. 428.3).`;
    }

    return null;
  }

  canSubmit(): boolean {
    const num = this.form.accountNumber.trim();
    return num.length >= 2
      && SCE_ACCOUNT_NUMBER_PATTERN.test(num)
      && sceAccountDigitCount(num) <= SCE_ACCOUNT_MAX_DIGITS
      && this.form.label.trim().length > 0
      && !this.fiscalIdError();
  }

  create(): void {
    if (!this.canSubmit() || this.creating()) return;
    const num = this.form.accountNumber.trim();
    this.createError.set(null);
    this.fiscalIdServerError.set(null);
    const existing = this.rows().find(a => a.accountNumber === num);
    if (existing) {
      this.createError.set(this.formatDuplicateMessage(existing));
      return;
    }
    // Nature dérivée du type : Client → débit, Fournisseur → crédit, sinon mixte.
    const natureType = this.form.accountType === 1 ? 0 : this.form.accountType === 2 ? 1 : 2;
    const fiscalId = this.showFiscalIdField() ? normalizeFiscalIdInput(this.form.fiscalId) : '';
    this.form.fiscalId = fiscalId;
    const request: CreateSubAccountRequest = {
      accountNumber: num,
      label: this.form.label.trim(),
      accountClass: Number(num[0]),
      parentAccountNumber: this.form.parentAccountNumber || null,
      natureType,
      accountType: this.form.accountType,
      isAuxiliary: this.form.isAuxiliary,
      affectationAccountNumber: this.form.isAuxiliary ? (this.form.affectationAccountNumber || null) : null,
      fiscalId: fiscalId || null
    };
    if (isProvisionableBankLeaf(num)) {
      const rib = this.form.rib.trim();
      const iban = this.form.iban.trim();
      request.bankCode = this.form.bankCode.trim() || null;
      request.rib = rib || null;
      request.iban = iban || null;
      request.swiftBic = null;
      if (isFxBankLeaf(num, this.form.parentAccountNumber) && this.form.bankCurrency.trim()) {
        request.bankCurrency = this.form.bankCurrency.trim();
      }
    }
    this.creating.set(true);
    this.api.createSubAccount(request).subscribe({
      next: res => {
        this.creating.set(false);
        if (res.success) {
          this.createError.set(null);
          const importHint = isProvisionableBankLeaf(num)
            ? $localize`:@@accounting.chart-of-accounts.ts.disponible.pour.l.import.de.releves:disponible pour l'import de relevés`
            : '';
          this.toast.add({
            severity: 'success',
            summary: $localize`:@@chart-of-accounts.component.summary.Comptecréé:Compte créé`,
            detail: importHint ? `${num} — ${request.label} — ${importHint}` : `${num} — ${request.label}`,
            life: 4000
          });
          this.showCreate.set(false);
          this.load();
        } else {
          const fiscalIdErr = extractFiscalIdServerError(res);
          if (fiscalIdErr) {
            this.fiscalIdServerError.set(fiscalIdErr);
          } else {
            this.createError.set(res.error ?? $localize`:@@ui.tern.la.creation.du.compte.a.echoue.f63cae:La création du compte a échoué.`);
          }
        }
      },
      error: err => {
        this.creating.set(false);
        const fiscalIdErr = extractFiscalIdServerError(err);
        if (fiscalIdErr) {
          this.fiscalIdServerError.set(fiscalIdErr);
        } else {
          this.createError.set(this.httpFailureMessage(err, $localize`:@@accounting.chart-of-accounts.ts.erreur.reseau.lors.de.la.creation.du.com.5e2cfce1:Erreur réseau lors de la création du compte.`));
        }
      }
    });
  }

  /**
   * Messages API (4xx/5xx) via ErrorHandlerService ; repli « erreur réseau » seulement si status 0.
   *
   * Conservé comme point d'appel de l'écran : la règle elle-même vit désormais dans
   * `ErrorHandlerService.extractErrorMessage`, où tout le module comptable la partage.
   */
  httpFailureMessage(err: unknown, networkFallback: string): string {
    return this.errorHandler.extractErrorMessage(err, networkFallback);
  }

  ngOnInit(): void {
    this.load();
  }

  startEdit(account: ChartOfAccountDto, event?: Event): void {
    this.editTriggerEl = (event?.currentTarget as HTMLElement | null) ?? null;
    this.editing.set(account);
  }

  onEdited(): void {
    const account = this.editing();
    this.closeEdit();
    this.load();
    if (account) {
      this.toast.add({
        severity: 'success',
        summary: $localize`:@@accounting.chart-of-accounts.ts.compte.modifie.b173f6a0:Compte modifié`,
        detail: `${account.accountNumber} — ${account.label}`,
        life: 4000
      });
    }
  }

  closeEdit(): void {
    this.editing.set(null);
    this.editTriggerEl?.focus();
    this.editTriggerEl = null;
  }

  confirmToggleActive(account: ChartOfAccountDto): void {
    const action = account.isActive ? $localize`:@@ui.tern.desactiver.d28397:Désactiver` : $localize`:@@ui.tern.reactiver.822dbd:Réactiver`;
    this.confirmService.confirm({
      header: $localize`:@@ui.tern.action.le.compte.9c1a20:${action}:action: le compte`,
      message: account.isActive
        ? $localize`:@@ui.tern.desactiver.le.compte.ph.ph.il.ne.sera.plus.b1104d:Désactiver le compte ${account.accountNumber}:p0: — ${account.label}:p1: ? Il ne sera plus utilisable en saisie ni en génération automatique.`
        : $localize`:@@ui.tern.reactiver.le.compte.ph.ph.3c4d55:Réactiver le compte ${account.accountNumber}:p0: — ${account.label}:p1: ?`,
      acceptLabel: action,
      rejectLabel: $localize`:@@chart-of-accounts.component.rejectLabel.Annuler:Annuler`,
      accept: () => this.toggleActive(account)
    });
  }

  private toggleActive(account: ChartOfAccountDto): void {
    this.togglingId.set(account.id);
    this.api.toggleAccountActive(account.id).subscribe({
      next: res => {
        this.togglingId.set(null);
        if (res.success) {
          this.toast.add({
            severity: 'success',
            summary: account.isActive ? $localize`:@@ui.tern.compte.desactive.3ba8b2:Compte désactivé` : $localize`:@@ui.tern.compte.reactive.c00017:Compte réactivé`,
            detail: `${account.accountNumber} — ${account.label}`,
            life: 4000
          });
          this.load();
        } else {
          this.error.set(res.error ?? $localize`:@@ui.tern.le.changement.de.statut.a.echoue.aac7f0:Le changement de statut a échoué.`);
        }
      },
      error: (err: HttpErrorResponse) => {
        this.togglingId.set(null);
        this.error.set(this.httpFailureMessage(err, $localize`:@@accounting.chart-of-accounts.ts.erreur.reseau.lors.du.changement.de.stat.63ef6bc0:Erreur réseau lors du changement de statut du compte.`));
      }
    });
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.getChartOfAccounts().subscribe({
      next: res => {
        this.loading.set(false);
        if (res.success && res.data) {
          this.rows.set(res.data);
          this.reapplyGlobalFilter();
        } else {
          this.error.set(res.error ?? $localize`:@@ui.tern.erreur.de.chargement.d75684:Erreur de chargement`);
        }
      },
      error: err => {
        this.loading.set(false);
        this.error.set(this.errorHandler.extractErrorMessage(err, $localize`:@@accounting.chart-of-accounts.ts.erreur.reseau.0683007f:Erreur réseau`));
      }
    });
  }

  readonly buildChartAnalyzePayload = (): unknown => {
    const all = this.rows();
    const byClass: Record<number, number> = {};
    let activeCount = 0;
    let systemCount = 0;
    for (const r of all) {
      byClass[r.accountClass] = (byClass[r.accountClass] ?? 0) + 1;
      if (r.isActive) activeCount++;
      if (r.isSystem) systemCount++;
    }
    return wrapLegacyAnalyzePayload(
      'accounting-chart',
      {
        screen: 'accounting-chart',
        summary: {
          totalAccounts: all.length,
          activeAccounts: activeCount,
          inactiveAccounts: all.length - activeCount,
          systemAccounts: systemCount,
          customAccounts: all.length - systemCount,
          byClass
        }
      } as Record<string, unknown>
    );
  };

  onSearchChange(): void {
    this.dt?.filterGlobal(this.effectiveFilterTerm(), 'contains');
  }

  indentRem(level: number): number {
    const n = Number(level);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n * 0.75;
  }

  /**
   * Terme de recherche effectif : si la saisie canonise en un matricule fiscal valide (ex. forme
   * compacte `1525071PBM000`), on filtre sur la forme carte stockée plutôt que sur le texte brut.
   */
  private effectiveFilterTerm(): string {
    const term = this.searchTerm;
    const canonical = normalizeFiscalIdInput(term);
    return canonical && isValidNif(canonical) ? canonical : term;
  }

  private reapplyGlobalFilter(): void {
    setTimeout(() => {
      this.dt?.filterGlobal(this.effectiveFilterTerm(), 'contains');
    }, 0);
  }
}
