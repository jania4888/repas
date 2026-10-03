/// <reference types="@angular/localize" />
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { concatMap, from, map } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TableModule } from 'primeng/table';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { ToastService } from '@core/services/toast.service';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import { AccountingFilterBarComponent } from '../shared/accounting-filter-bar.component';
import { AccountingCorrectionBannerComponent } from '../shared/accounting-correction-banner.component';
import { AccountingExportMenuComponent } from '../shared/accounting-export-menu.component';
import { AccountingExportFormat, downloadBlob, exportExtension } from '../shared/accounting-download.util';
import { AccountingService, JournalSearchRowDto } from '../services/accounting.service';
import {
  AutoAssociationResultDto,
  BankImportIssueDto,
  BankLineAssociationDto,
  BankLineAssociationStatus,
  BankReconciliationService,
  BankReconciliationStatementDto,
  BankReconciliationSummaryDto,
  BankStatementDto,
  BankStatementExtractionMethod,
  BankStatementFileFormat,
  BankStatementFilePreviewDto,
  BankStatementLineDto,
  ReconcilePairRequest,
  normalizeExtractionMethod
} from '../services/bank-reconciliation.service';
import { BankAccountDto, BankAccountService } from '@core/services/bank-account.service';
import { formatLocalDate, parseLocalDateString } from '../shared/accounting-date-utils';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { BankStatementImportService } from '../bank-statement-import/bank-statement-import.service';
import { BankStatementUploadDialogComponent } from '../bank-statement-import/bank-statement-upload-dialog.component';

interface WizardStepDef {
  index: 1 | 2 | 3 | 4;
  label: string;
  hint: string;
}

/** Identifiant de relevé accepté dans l'adresse (retour de l'import IA). */
const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Code stable d'un échec de l'aperçu (corps `ApiResponse`), jamais le texte serveur. */
function previewErrorCode(err: unknown): string | null {
  if (!(err instanceof HttpErrorResponse)) return null;
  return (err.error as { code?: string } | null)?.code ?? null;
}

@Component({
  selector: 'app-bank-reconciliation',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    PageHeaderComponent,
    ButtonComponent,
    AccountingStatusBannerComponent,
    AccountingFilterBarComponent,
    AccountingExportMenuComponent,
    AccountingCorrectionBannerComponent,
    BankStatementUploadDialogComponent
  ],
  template: `
    <app-page-header
      title="Rapprochement bancaire" i18n-title="@@accounting.bank-reconciliation.rapprochement.bancaire.b6463429"
      subtitle="Assistant d'importation de relevé et de rapprochement — Import, association automatique, rapprochement manuel, résultat" i18n-subtitle="@@accounting.bank-reconciliation.assistant.d.importation.de.releve.et.de.a85665d9" />

    <app-accounting-correction-banner />

    <app-accounting-status-banner variant="error" [message]="error() ?? ''" />

    <!-- ── Progression du wizard ─────────────────────────────────────────── -->
    @if (wizardActive()) {
      <div class="card br-card br-stepper-card">
        <ol class="br-stepper" role="list">
          @for (st of steps; track st.index) {
            <li class="br-step"
              [class.br-step-current]="step() === st.index"
              [class.br-step-done]="step() > st.index">
              <span class="br-step-badge">
                @if (step() > st.index) { <i class="pi pi-check"></i> } @else { {{ st.index }} }
              </span>
              <span class="br-step-text">
                <span class="br-step-label">{{ st.label }}</span>
                <span class="br-step-hint">{{ st.hint }}</span>
              </span>
            </li>
          }
        </ol>
        <div class="br-stepper-actions">
          <app-button variant="secondary" icon="pi pi-times" type="button" (click)="exitWizard()" [disabled]="busy() || applying() || autoAssociating()" i18n="@@accounting.bank-reconciliation.quitter.l.assistant.d704aff2"> Quitter l'assistant </app-button>
        </div>
      </div>
    }

    <!-- ── Liste des relevés (accueil) ───────────────────────────────────── -->
    @if (!wizardActive()) {
      <div class="card br-card">
        <app-accounting-filter-bar ariaLabel="Filtres des relevés bancaires" i18n-ariaLabel="@@accounting.bank-reconciliation.filtres.des.releves.bancaires.9f25f289">
          <div accountingFilterFields class="br-toolbar-fields">
            <div class="form-field">
              <label class="field-label" for="br-account" i18n="@@accounting.bank-reconciliation.compte.bancaire.485b42ca">Compte bancaire</label>
              <input id="br-account" class="br-input" [(ngModel)]="accountFilter" placeholder="N° de compte…" i18n-placeholder="@@accounting.bank-reconciliation.n.de.compte.05918a18" [disabled]="loadingList()" />
            </div>
            <div class="form-field">
              <label class="field-label" for="br-from" i18n="@@accounting.bank-reconciliation.du.84814985">Du</label>
              <input id="br-from" type="date" class="br-input" [(ngModel)]="fromStr" [disabled]="loadingList()" />
            </div>
            <div class="form-field">
              <label class="field-label" for="br-to" i18n="@@accounting.bank-reconciliation.au.7a1732d5">Au</label>
              <input id="br-to" type="date" class="br-input" [(ngModel)]="toStr" [disabled]="loadingList()" />
            </div>
          </div>
          <div accountingFilterActions class="br-toolbar-actions">
            <app-button variant="secondary" icon="pi pi-search" type="button" (click)="loadStatements()" [disabled]="loadingList()" i18n="@@accounting.bank-reconciliation.rechercher.91f7d3e9"> Rechercher </app-button>
            <app-button variant="primary" icon="pi pi-upload" type="button" (click)="startImport()" [disabled]="loadingList()" i18n="@@accounting.bank-reconciliation.importer.un.releve.75bae472"> Importer un relevé </app-button>
          </div>
        </app-accounting-filter-bar>

        <p-table [value]="statements()" [loading]="loadingList()" [paginator]="statements().length > 10" [rows]="10"
          styleClass="p-datatable-sm accounting-datatable" [rowHover]="true">
          <ng-template pTemplate="header">
            <tr>
              <th scope="col" i18n="@@accounting.bank-reconciliation.banque.2a7302cd">Banque</th>
              <th scope="col" i18n="@@accounting.bank-reconciliation.compte.c45740bb">Compte</th>
              <th scope="col" i18n="@@accounting.bank-reconciliation.periode.de2110b7">Période</th>
              <th scope="col" class="br-amt" i18n="@@accounting.bank-reconciliation.solde.initial.78a4e543">Solde initial</th>
              <th scope="col" class="br-amt" i18n="@@accounting.bank-reconciliation.solde.final.eafcc35f">Solde final</th>
              <th scope="col" i18n="@@accounting.bank-reconciliation.avancement.e1963fc4">Avancement</th>
              <th scope="col"></th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-s>
            <tr>
              <td data-label="Banque" i18n-data-label="@@accounting.bank-reconciliation.banque.2a7302cd">{{ s.bankName }}</td>
              <td data-label="Compte" i18n-data-label="@@accounting.bank-reconciliation.compte.c45740bb" class="br-mono">{{ s.accountNumber }}</td>
              <td data-label="Période" i18n-data-label="@@accounting.bank-reconciliation.periode.de2110b7">{{ s.periodStart | date : 'shortDate' }} → {{ s.periodEnd | date : 'shortDate' }}</td>
              <td data-label="Solde initial" i18n-data-label="@@accounting.bank-reconciliation.solde.initial.78a4e543" class="br-amt">{{ s.openingBalance | number : '1.3-3' }}</td>
              <td data-label="Solde final" i18n-data-label="@@accounting.bank-reconciliation.solde.final.eafcc35f" class="br-amt">{{ s.closingBalance | number : '1.3-3' }}</td>
              <td data-label="Avancement" i18n-data-label="@@accounting.bank-reconciliation.avancement.e1963fc4" i18n="@@accounting.bank-reconciliation.rapprochee.s.1f9f5e71">
                <span class="br-badge" [class.br-badge-done]="reconciledCount(s) === s.lines.length" [class.br-badge-partial]="reconciledCount(s) < s.lines.length">
                  {{ reconciledCount(s) }}/{{ s.lines.length }} rapprochée(s)
                </span>
              </td>
              <td>
                <button type="button" class="br-link-btn" (click)="openStatement(s.id)" i18n="@@accounting.bank-reconciliation.ouvrir.l.assistant.cd84c0bc">Ouvrir l'assistant</button>
                <button type="button" class="br-link-btn" (click)="openReconciliationStatement(s.id)" i18n="@@accounting.bank-reconciliation.etat.de.rapprochement.f019963e">État de rapprochement</button>
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="7" class="br-empty">
                <p class="br-empty-title" i18n="@@accounting.bank-reconciliation.aucun.releve.bancaire.ae728f5f">Aucun relevé bancaire</p>
                <p class="br-empty-hint" i18n="@@accounting.bank-reconciliation.importez.votre.premier.releve.csv.excel.ofx.mt94.4bd6c4e2">Importez votre premier relevé (CSV, Excel, OFX, MT940 ou PDF) pour démarrer le rapprochement.</p>
              </td>
            </tr>
          </ng-template>
        </p-table>
      </div>

      <!-- ── État de rapprochement (édition imprimable) ─────────────────── -->
      @if (reconStatement(); as rs) {
        <div class="card br-card br-recon-card">
          <div class="br-detail-head">
            <h2 class="br-section-title" i18n="@@accounting.bank-reconciliation.etat.de.rapprochement.42af3d10">État de rapprochement — {{ rs.bankName }} · {{ rs.accountNumber }}</h2>
            <div class="br-recon-actions">
              <app-accounting-export-menu
                [disabled]="exportingRecon()"
                (exportFormat)="onExportReconciliation($event)" />
              <button type="button" class="br-link-btn" (click)="closeReconciliationStatement()" i18n="@@accounting.bank-reconciliation.fermer.5ab4ec64">Fermer</button>
            </div>
          </div>
          <p class="br-help" i18n="@@accounting.bank-reconciliation.compte.banque.periode.625007b5">
            Compte banque {{ rs.chartOfAccountNumber }} · période {{ rs.periodStart | date : 'shortDate' }}
            → {{ rs.periodEnd | date : 'shortDate' }}
          </p>

          <div class="br-recon-balances">
            <div><span class="br-recon-lbl" i18n="@@accounting.bank-reconciliation.solde.comptable.e8c3cf14">Solde comptable</span><span class="br-recon-val">{{ rs.accountingBalance | number : '1.3-3' }}</span></div>
            <div><span class="br-recon-lbl" i18n="@@accounting.bank-reconciliation.solde.releve.4b7a1112">Solde relevé</span><span class="br-recon-val">{{ rs.statementClosingBalance | number : '1.3-3' }}</span></div>
          </div>

          <h3 class="br-recon-sub" i18n="@@accounting.bank-reconciliation.ecritures.non.pointees.cheques.emis.non.debites..577a1578">Écritures non pointées (chèques émis non débités, remises non créditées)</h3>
          @if (rs.unreconciledBookItems.length === 0) {
            <p class="br-help" i18n="@@accounting.bank-reconciliation.aucune.27955d6f">Aucune.</p>
          } @else {
            <p-table [value]="rs.unreconciledBookItems" styleClass="p-datatable-sm accounting-datatable" [rowHover]="true">
              <ng-template pTemplate="header">
                <tr><th scope="col" i18n="@@accounting.bank-reconciliation.date.eb9a4bc1">Date</th><th scope="col" i18n="@@accounting.bank-reconciliation.reference.f8130bb0">Référence</th><th scope="col" i18n="@@accounting.bank-reconciliation.libelle.f5485bba">Libellé</th><th scope="col" class="br-amt" i18n="@@accounting.bank-reconciliation.debit.f528224f">Débit</th><th scope="col" class="br-amt" i18n="@@accounting.bank-reconciliation.credit.19194bdf">Crédit</th></tr>
              </ng-template>
              <ng-template pTemplate="body" let-i>
                <tr>
                  <td data-label="Date" i18n-data-label="@@accounting.bank-reconciliation.date.eb9a4bc1">{{ i.date | date : 'shortDate' }}</td>
                  <td data-label="Référence" i18n-data-label="@@accounting.bank-reconciliation.reference.f8130bb0" class="br-mono">{{ i.reference }}</td>
                  <td data-label="Libellé" i18n-data-label="@@accounting.bank-reconciliation.libelle.f5485bba">{{ i.label }}</td>
                  <td data-label="Débit" i18n-data-label="@@accounting.bank-reconciliation.debit.f528224f" class="br-amt">{{ i.debit | number : '1.3-3' }}</td>
                  <td data-label="Crédit" i18n-data-label="@@accounting.bank-reconciliation.credit.19194bdf" class="br-amt">{{ i.credit | number : '1.3-3' }}</td>
                </tr>
              </ng-template>
            </p-table>
          }

          <h3 class="br-recon-sub" i18n="@@accounting.bank-reconciliation.operations.du.releve.non.comptabilisees.frais.ag.14333ba6">Opérations du relevé non comptabilisées (frais, agios)</h3>
          @if (rs.unreconciledStatementItems.length === 0) {
            <p class="br-help" i18n="@@accounting.bank-reconciliation.aucune.27955d6f">Aucune.</p>
          } @else {
            <p-table [value]="rs.unreconciledStatementItems" styleClass="p-datatable-sm accounting-datatable" [rowHover]="true">
              <ng-template pTemplate="header">
                <tr><th scope="col" i18n="@@accounting.bank-reconciliation.date.eb9a4bc1">Date</th><th scope="col" i18n="@@accounting.bank-reconciliation.reference.f8130bb0">Référence</th><th scope="col" i18n="@@accounting.bank-reconciliation.libelle.f5485bba">Libellé</th><th scope="col" class="br-amt" i18n="@@accounting.bank-reconciliation.debit.f528224f">Débit</th><th scope="col" class="br-amt" i18n="@@accounting.bank-reconciliation.credit.19194bdf">Crédit</th></tr>
              </ng-template>
              <ng-template pTemplate="body" let-i>
                <tr>
                  <td data-label="Date" i18n-data-label="@@accounting.bank-reconciliation.date.eb9a4bc1">{{ i.date | date : 'shortDate' }}</td>
                  <td data-label="Référence" i18n-data-label="@@accounting.bank-reconciliation.reference.f8130bb0" class="br-mono">{{ i.reference }}</td>
                  <td data-label="Libellé" i18n-data-label="@@accounting.bank-reconciliation.libelle.f5485bba">{{ i.label }}</td>
                  <td data-label="Débit" i18n-data-label="@@accounting.bank-reconciliation.debit.f528224f" class="br-amt">{{ i.debit | number : '1.3-3' }}</td>
                  <td data-label="Crédit" i18n-data-label="@@accounting.bank-reconciliation.credit.19194bdf" class="br-amt">{{ i.credit | number : '1.3-3' }}</td>
                </tr>
              </ng-template>
            </p-table>
          }

          <div class="br-recon-balances br-recon-adjusted">
            <div><span class="br-recon-lbl" i18n="@@accounting.bank-reconciliation.solde.releve.corrige.37a6a51e">Solde relevé corrigé</span><span class="br-recon-val">{{ rs.adjustedStatementBalance | number : '1.3-3' }}</span></div>
            <div><span class="br-recon-lbl" i18n="@@accounting.bank-reconciliation.solde.comptable.corrige.baedc64d">Solde comptable corrigé</span><span class="br-recon-val">{{ rs.adjustedAccountingBalance | number : '1.3-3' }}</span></div>
          </div>
          <p class="br-recon-diff" [class.br-recon-ok]="rs.isReconciled" [class.br-recon-ko]="!rs.isReconciled" i18n="@@accounting.bank-reconciliation.ecart.2bfe792f">
            Écart : {{ rs.difference | number : '1.3-3' }}
            <span>{{ rs.isReconciled ? loc_ui_tern_rapproche_06101d : loc_ui_tern_a_justifier_d719d3 }}</span>
          </p>
        </div>
      } @else if (reconError()) {
        <div class="card br-card">
          <app-accounting-status-banner variant="warning" [message]="reconError() ?? ''" />
        </div>
      }
    }

    <!-- ══ ÉTAPE 1 — Import du relevé ═════════════════════════════════════ -->
    @if (wizardActive() && step() === 1) {
      <div class="card br-card">
        <h2 class="br-section-title" i18n="@@accounting.bank-reconciliation.1.import.du.releve.8866181a">1 · Import du relevé</h2>
        <div class="br-import-fields">
          <div class="form-field">
            <label class="field-label" for="br-bank-acc" i18n="@@accounting.bank-reconciliation.compte.bancaire.485b42ca">Compte bancaire</label>
            <select id="br-bank-acc" class="br-input" [(ngModel)]="selectedBankAccountId" [disabled]="busy() || loadingBankAccounts()">
              <option value="" i18n="@@accounting.bank-reconciliation.selectionner.7ae1afc7">— Sélectionner —</option>
              @for (ba of bankAccounts(); track ba.id) {
                <option [ngValue]="ba.id">{{ ba.bankName }} — {{ formatRib(ba.rib) }} {{ ba.chartOfAccountNumber ? ('(' + ba.chartOfAccountNumber + ')') : '' }}</option>
              }
            </select>
            @if (preview()?.detectedRib && !preview()?.matchedBankAccountId) {
              <small class="br-help br-rib-hint" i18n="@@accounting.bank-reconciliation.rib.detecte.creez.un.compte.bancaire.ou.17e867bf">
                RIB détecté {{ formatRib(preview()!.detectedRib!) }} — créez un compte bancaire ou sélectionnez-le manuellement.
              </small>
            }
          </div>
          <div class="form-field">
            <label class="field-label" for="br-format" i18n="@@accounting.bank-reconciliation.format.041a5dec">Format</label>
            <select id="br-format" class="br-input" [(ngModel)]="fileFormat" [disabled]="busy()">
              <option [ngValue]="0" i18n="@@accounting.bank-reconciliation.csv.delimite.d957a0e8">CSV (délimité)</option>
              <option [ngValue]="1" i18n="@@accounting.bank-reconciliation.excel.xlsx.47f8ecb0">Excel (.xlsx)</option>
              <option [ngValue]="4" i18n="@@accounting.bank-reconciliation.ofx.money.banques.5619a715">OFX (Money/banques)</option>
              <option [ngValue]="5" i18n="@@accounting.bank-reconciliation.mt940.swift.3ff4da2b">MT940 (SWIFT)</option>
              <option [ngValue]="2" i18n="@@accounting.bank-reconciliation.pdf.releve.bancaire.f5c3b5c0">PDF (relevé bancaire)</option>
              <option [ngValue]="3" i18n="@@accounting.bank-reconciliation.image.scannee.b4b3cd7d">Image scannée</option>
            </select>
          </div>
          <div class="form-field br-field-file">
            <label class="field-label" for="br-file" i18n="@@accounting.bank-reconciliation.fichier.f0fa5745">Fichier</label>
            <input id="br-file" type="file" class="br-input" (change)="onFileSelected($event)" [disabled]="busy()"
              accept=".csv,.txt,.tsv,.xlsx,.ofx,.qfx,.sta,.mt940,.txt,.pdf,.jpg,.jpeg,.png,.webp" />
            @if (allDocumentsViaAi()) {
              <small class="br-help br-ai-hint" i18n="@@accounting.bank-reconciliation.releve.pdf.ou.image.analyse.par.l.import.ia.lect.4f7ad0bc">Relevé PDF ou image : analyse par l'import IA (lecture directe, complétée par l'IA si nécessaire), puis retour ici.</small>
            }
          </div>
          <div class="br-import-actions">
            <app-button variant="secondary" icon="pi pi-search" type="button"
              (click)="runPreview()" [disabled]="!selectedFile() || busy()">
              {{ previewing() ? loc_ui_tern_analyse_458c82 : loc_ui_tern_tester_l_importation_92d856 }}
            </app-button>
          </div>
        </div>
        @if (previewing()) {
          <p class="br-help" role="status" i18n="@@accounting.bank-reconciliation.lecture.du.releve.en.cours.un.releve.sca.f6c24d36">Lecture du relevé en cours. Un relevé scanné lu par l'IA peut demander quelques minutes.</p>
        }

        <!-- Options d'import (façon Sage) -->
        <h3 class="br-section-sub" i18n="@@accounting.bank-reconciliation.options.d.import.ad83e6f8">Options d'import</h3>
        <div class="br-options">
          <label class="br-check">
            <input type="checkbox" [(ngModel)]="optSkipAlreadyImported" [disabled]="busy()" />
            <span i18n="@@accounting.bank-reconciliation.ignorer.les.ecritures.deja.importees.b2478340">Ignorer les écritures déjà importées</span>
          </label>
          <label class="br-check">
            <input type="checkbox" [(ngModel)]="optImportBalances" [disabled]="busy()" />
            <span i18n="@@accounting.bank-reconciliation.importer.les.soldes.f9ecb009">Importer les soldes</span>
          </label>
          <label class="br-check br-check-disabled" title="Non applicable : les écritures 512↔contrepartie ne créent pas de tiers." i18n-title="@@accounting.bank-reconciliation.non.applicable.les.ecritures.512.contrepartie.ne.e3b79636">
            <input type="checkbox" disabled />
            <span i18n="@@accounting.bank-reconciliation.creer.les.tiers.inexistants.e16eb6d9">Créer les tiers inexistants</span>
          </label>
        </div>

        <!-- Paramètres de comptabilisation -->
        <h3 class="br-section-sub" i18n="@@accounting.bank-reconciliation.parametres.de.comptabilisation.6312fe8f">Paramètres de comptabilisation</h3>
        <div class="br-import-fields">
          <div class="form-field">
            <label class="field-label" for="br-journal" i18n="@@accounting.bank-reconciliation.journal.a.utiliser.5d02eafb">Journal à utiliser</label>
            <input id="br-journal" class="br-input br-input-narrow" [(ngModel)]="defaultJournalCode" placeholder="BQ" i18n-placeholder="@@accounting.bank-reconciliation.bq.70c2d9e1" [disabled]="busy()" />
          </div>
          <div class="form-field">
            <label class="field-label" for="br-counterparty" i18n="@@accounting.bank-reconciliation.contrepartie.par.defaut.10226f0a">Contrepartie par défaut</label>
            <input id="br-counterparty" class="br-input" [(ngModel)]="defaultCounterparty" placeholder="Ex. 6580000" i18n-placeholder="@@accounting.bank-reconciliation.ex.6580000.19a967b0" [disabled]="busy()" />
            <small class="br-help" i18n="@@accounting.bank-reconciliation.utilisee.pour.comptabiliser.les.lignes.non.assoc.f8e30f7b">Utilisée pour comptabiliser les lignes non associées (étapes 2 et 3).</small>
          </div>
        </div>

        <p class="br-help" i18n="@@accounting.bank-reconciliation.colonnes.attendues.pour.csv.excel.1.re.l.8023ec2c">
          <ng-container> Colonnes attendues pour CSV/Excel (1</ng-container><sup>re</sup> ligne = en-têtes) : <code>date, libelle, [reference]</code> puis
          <code>debit/credit</code> ou une colonne <code>montant</code> signée. OFX/MT940 sont lus automatiquement.
        </p>

        @if (preview(); as p) {
          @if (p.extractionMethod !== undefined && p.extractionMethod !== null && p.extractionMethod !== 0) {
            <p class="br-help br-extract-banner"><ng-container i18n="@@accounting.bank-reconciliation.extraction.8a1adcfb">
              Extraction : {{ extractionLabel(p.extractionMethod) }}
              </ng-container>@if (p.confidenceScore !== undefined && p.confidenceScore !== null) {<ng-container i18n="@@accounting.bank-reconciliation.confiance.d8da4bc0"> — confiance {{ p.confidenceScore }} % </ng-container>}
              @if (p.matchedChartOfAccountNumber) {<ng-container i18n="@@accounting.bank-reconciliation.compte.comptable.42b761b0"> — compte comptable {{ p.matchedChartOfAccountNumber }} </ng-container>}
            </p>
          }
          @if (p.statements && p.statements.length > 1) {
            <h3 class="br-section-sub" i18n="@@accounting.bank-reconciliation.releves.detectes.dans.ce.fichier.c9a38276">{{ p.statements.length }} relevés détectés dans ce fichier</h3>
            <p class="br-help" i18n="@@accounting.bank-reconciliation.ils.seront.importes.l.un.apres.l.autre.d.a2fd50e2">Ils seront importés l'un après l'autre, dans l'ordre chronologique, chacun avec ses propres soldes.</p>
            <p-table [value]="p.statements" styleClass="p-datatable-sm accounting-datatable" [rowHover]="true">
              <ng-template pTemplate="header">
                <tr>
                  <th scope="col" i18n="@@accounting.bank-reconciliation.periode.de2110b7">Période</th>
                  <th scope="col" class="br-amt" i18n="@@accounting.bank-reconciliation.lignes.41c7025e">Lignes</th>
                  <th scope="col" class="br-amt" i18n="@@accounting.bank-reconciliation.solde.initial.78a4e543">Solde initial</th>
                  <th scope="col" class="br-amt" i18n="@@accounting.bank-reconciliation.total.debits.9acf4842">Total débits</th>
                  <th scope="col" class="br-amt" i18n="@@accounting.bank-reconciliation.total.credits.ec8c5525">Total crédits</th>
                  <th scope="col" class="br-amt" i18n="@@accounting.bank-reconciliation.solde.final.eafcc35f">Solde final</th>
                  <th scope="col" i18n="@@accounting.bank-reconciliation.etat.d3b28a2a">État</th>
                </tr>
              </ng-template>
              <ng-template pTemplate="body" let-st>
                <tr>
                  <td>{{ st.periodStart | date : 'shortDate' }} → {{ st.periodEnd | date : 'shortDate' }}</td>
                  <td class="br-amt">{{ st.validLines }}</td>
                  <td class="br-amt">{{ st.suggestedOpeningBalance | number : '1.3-3' }}</td>
                  <td class="br-amt">{{ st.totalDebit | number : '1.3-3' }}</td>
                  <td class="br-amt">{{ st.totalCredit | number : '1.3-3' }}</td>
                  <td class="br-amt">{{ st.suggestedClosingBalance | number : '1.3-3' }}</td>
                  <td>
                    @if (st.canImport) {
                      <span class="br-ok" i18n="@@accounting.bank-reconciliation.pret.49ed3e18">Prêt</span>
                    } @else {
                      <span class="br-err" i18n="@@accounting.bank-reconciliation.a.corriger.28269b0c">À corriger</span>
                    }
                  </td>
                </tr>
              </ng-template>
            </p-table>
            @for (st of p.statements; track $index) {
              @if (blockingIssues(st).length > 0) {
                <div class="br-issues">
                  <h3 class="br-issues-title">{{ st.periodStart | date : 'shortDate' }} → {{ st.periodEnd | date : 'shortDate' }}</h3>
                  <ul class="br-issues-list">
                    @for (issue of blockingIssues(st); track $index) {
                      <li><span class="br-issue-ref">{{ issue.ref }}</span> {{ issue.message }}</li>
                    }
                  </ul>
                </div>
              }
            }
            <div class="br-import-fields">
              <div class="form-field">
                <label class="field-label" for="br-bank-multi" i18n="@@accounting.bank-reconciliation.banque.2a7302cd">Banque</label>
                <input id="br-bank-multi" class="br-input" [(ngModel)]="meta.bankName" [disabled]="busy()" />
              </div>
              <div class="form-field">
                <label class="field-label" for="br-acc-multi" i18n="@@accounting.bank-reconciliation.n.de.compte.0b69581b">N° de compte</label>
                <input id="br-acc-multi" class="br-input" [(ngModel)]="meta.accountNumber" [disabled]="busy()" />
              </div>
            </div>
            <div class="br-commit-bar">
              <span class="br-commit-hint" i18n="@@accounting.bank-reconciliation.releve.s.a.importer.du.plus.ancien.au.pl.813a34f3">{{ p.statements.length }} relevé(s) à importer, du plus ancien au plus récent.</span>
              <app-button variant="primary" icon="pi pi-arrow-right" type="button"
                (click)="runImportAll()" [disabled]="!canImportAll() || busy()">
                {{ importing() ? loc_ui_tern_import_4834ca : loc_import_all_statements }}
              </app-button>
            </div>
          } @else {
          <div class="br-summary">
            <div class="br-kpi"><span class="br-kpi-label" i18n="@@accounting.bank-reconciliation.lignes.valides.b21843dc">Lignes valides</span><span class="br-kpi-value br-ok">{{ p.validLines }}</span></div>
            <div class="br-kpi"><span class="br-kpi-label" i18n="@@accounting.bank-reconciliation.anomalies.4b2e6f56">Anomalies</span><span class="br-kpi-value" [class.br-err]="p.issues.length > 0">{{ p.issues.length }}</span></div>
            <div class="br-kpi"><span class="br-kpi-label" i18n="@@accounting.bank-reconciliation.total.debits.9acf4842">Total débits</span><span class="br-kpi-value">{{ p.totalDebit | number : '1.3-3' }}</span></div>
            <div class="br-kpi"><span class="br-kpi-label" i18n="@@accounting.bank-reconciliation.total.credits.ec8c5525">Total crédits</span><span class="br-kpi-value">{{ p.totalCredit | number : '1.3-3' }}</span></div>
          </div>

          @if (p.issues.length > 0) {
            <div class="br-issues">
              <h3 class="br-issues-title" i18n="@@accounting.bank-reconciliation.anomalie.s.e802e12e">{{ p.issues.length }} anomalie(s)</h3>
              <ul class="br-issues-list">
                @for (issue of p.issues.slice(0, 50); track $index) {
                  <li><span class="br-issue-ref">{{ issue.ref }}</span> {{ issue.message }}</li>
                }
              </ul>
            </div>
          }

          @if (p.canImport) {
            <!-- Aperçu des lignes -->
            <h3 class="br-section-sub" i18n="@@accounting.bank-reconciliation.apercu.des.mouvements.67b3dc46">Aperçu des mouvements</h3>
            <p-table [value]="p.lines.slice(0, 100)" styleClass="p-datatable-sm accounting-datatable" [rowHover]="true">
              <ng-template pTemplate="header">
                <tr>
                  <th scope="col" i18n="@@accounting.bank-reconciliation.date.op.ee2c5d30">Date op.</th>
                  <th scope="col" i18n="@@accounting.bank-reconciliation.reference.f8130bb0">Référence</th>
                  <th scope="col" i18n="@@accounting.bank-reconciliation.libelle.f5485bba">Libellé</th>
                  <th scope="col" class="br-amt" i18n="@@accounting.bank-reconciliation.debit.f528224f">Débit</th>
                  <th scope="col" class="br-amt" i18n="@@accounting.bank-reconciliation.credit.19194bdf">Crédit</th>
                </tr>
              </ng-template>
              <ng-template pTemplate="body" let-l>
                <tr>
                  <td>{{ l.transactionDate | date : 'shortDate' }}</td>
                  <td class="br-mono">{{ l.reference }}</td>
                  <td>{{ l.description }}</td>
                  <td class="br-amt">{{ l.isDebit ? (l.amount | number : '1.3-3') : '' }}</td>
                  <td class="br-amt">{{ !l.isDebit ? (l.amount | number : '1.3-3') : '' }}</td>
                </tr>
              </ng-template>
            </p-table>

            <h3 class="br-section-sub" i18n="@@accounting.bank-reconciliation.informations.du.releve.2a72c4df">Informations du relevé</h3>
            <div class="br-import-fields">
              <div class="form-field">
                <label class="field-label" for="br-bank" i18n="@@accounting.bank-reconciliation.banque.2a7302cd">Banque</label>
                <input id="br-bank" class="br-input" [(ngModel)]="meta.bankName" placeholder="Ex. BIAT" i18n-placeholder="@@accounting.bank-reconciliation.ex.biat.3372625e" [disabled]="busy()" />
              </div>
              <div class="form-field">
                <label class="field-label" for="br-acc" i18n="@@accounting.bank-reconciliation.n.de.compte.0b69581b">N° de compte</label>
                <input id="br-acc" class="br-input" [(ngModel)]="meta.accountNumber" placeholder="Ex. 08 123 456789" i18n-placeholder="@@accounting.bank-reconciliation.ex.08.123.456789.b37e585d" [disabled]="busy()" />
              </div>
              <div class="form-field">
                <label class="field-label" for="br-pstart" i18n="@@accounting.bank-reconciliation.debut.de.periode.071c1f1d">Début de période</label>
                <input id="br-pstart" type="date" class="br-input" [(ngModel)]="meta.periodStart" [disabled]="busy()" />
              </div>
              <div class="form-field">
                <label class="field-label" for="br-pend" i18n="@@accounting.bank-reconciliation.fin.de.periode.ffc198b7">Fin de période</label>
                <input id="br-pend" type="date" class="br-input" [(ngModel)]="meta.periodEnd" [disabled]="busy()" />
              </div>
              <div class="form-field">
                <label class="field-label" for="br-open" i18n="@@accounting.bank-reconciliation.solde.initial.78a4e543">Solde initial</label>
                <input id="br-open" type="text" inputmode="decimal" class="br-input" [(ngModel)]="meta.openingBalance" [disabled]="busy()" />
              </div>
              <div class="form-field">
                <label class="field-label" for="br-close" i18n="@@accounting.bank-reconciliation.solde.final.eafcc35f">Solde final</label>
                <input id="br-close" type="text" inputmode="decimal" class="br-input" [(ngModel)]="meta.closingBalance" [disabled]="busy()" />
              </div>
            </div>
            <div class="br-commit-bar">
              <span class="br-commit-hint" i18n="@@accounting.bank-reconciliation.ligne.s.prete.s.a.etre.importee.s.e8f2abee">{{ p.validLines }} ligne(s) prête(s) à être importée(s).</span>
              <app-button variant="primary" icon="pi pi-arrow-right" type="button"
                (click)="runImport()" [disabled]="!canSubmitImport() || busy()">
                {{ importing() ? loc_ui_tern_import_4834ca : loc_ui_tern_importer_et_continuer_135d02 }}
              </app-button>
            </div>
          } @else {
            <p class="br-commit-hint br-err" i18n="@@accounting.bank-reconciliation.corrigez.les.anomalies.bloquantes.avant.d.import.127ebca3">Corrigez les anomalies bloquantes avant d'importer.</p>
          }
          }
        }
      </div>
    }

    <!-- ══ ÉTAPE 2 — Association automatique ═════════════════════════════ -->
    @if (wizardActive() && step() === 2 && selected(); as s) {
      <div class="br-two-col">
        <div class="card br-card br-col-main">
          <div class="br-detail-head">
            <h2 class="br-section-title" i18n="@@accounting.bank-reconciliation.2.association.automatique.c80a6cb1">2 · Association automatique — {{ s.bankName }} · {{ s.accountNumber }}</h2>
            <div class="br-head-actions">
              @if (aiPostingEnabled()) {
                <app-button variant="secondary" icon="pi pi-sparkles" [routerLink]="['/accounting/bank-statement-import/statement', s.id]"
                  ariaLabel="Proposer et générer les écritures du journal de banque pour les lignes de ce relevé"
                  i18n-ariaLabel="@@accounting.bank-reconciliation.proposer.et.generer.les.ecritures.du.journal.de.b7479a3c"
                  i18n="@@accounting.bank-reconciliation.comptabiliser.avec.l.ia.4192ed9a">Comptabiliser avec l'IA</app-button>
              }
              <app-button variant="secondary" icon="pi pi-refresh" type="button" (click)="runAutoAssociate()" [disabled]="autoAssociating() || applying()" i18n="@@accounting.bank-reconciliation.relancer.l.association.3c42e685"> Relancer l'association </app-button>
              <app-button variant="primary" icon="pi pi-check-circle" type="button" (click)="applySelectedAssociations()"
                [disabled]="applying() || autoAssociating() || selectedAssociatedCount() === 0">
                {{ applying() ? loc_ui_tern_rapprochement_e7a2b4 : loc_ui_tern_rapprocher_tout_ce_qui_est_associe_061001 + selectedAssociatedCount() + ')' }}
              </app-button>
            </div>
          </div>
          <p class="br-help" i18n="@@accounting.bank-reconciliation.les.correspondances.certaines.sont.pre.cochees.a.97609dc3"> Les correspondances certaines sont pré-cochées « Associé » (non enregistrées tant que vous ne cliquez pas sur « Rapprocher »).
            Les lignes à plusieurs candidats restent « À rapprocher », les lignes sans écriture « Non associé ». </p>

          <p-table [value]="associations()" [loading]="autoAssociating()" styleClass="p-datatable-sm accounting-datatable" [rowHover]="true">
            <ng-template pTemplate="header">
              <tr>
                <th scope="col" class="br-check-col"></th>
                <th scope="col" i18n="@@accounting.bank-reconciliation.date.eb9a4bc1">Date</th>
                <th scope="col" i18n="@@accounting.bank-reconciliation.libelle.f5485bba">Libellé</th>
                <th scope="col" class="br-amt" i18n="@@accounting.bank-reconciliation.debit.f528224f">Débit</th>
                <th scope="col" class="br-amt" i18n="@@accounting.bank-reconciliation.credit.19194bdf">Crédit</th>
                <th scope="col" i18n="@@accounting.bank-reconciliation.statut.659499f3">Statut</th>
                <th scope="col" i18n="@@accounting.bank-reconciliation.ecriture.proposee.3b3b973e">Écriture proposée</th>
                <th scope="col" i18n="@@accounting.bank-reconciliation.actions.c3cd636a">Actions</th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-a>
              <tr>
                <td class="br-check-col">
                  @if (a.status === 2) {
                    <input type="checkbox" [checked]="isChecked(a)" (change)="toggleChecked(a)" [disabled]="applying()" />
                  }
                </td>
                <td>{{ a.transactionDate | date : 'shortDate' }}</td>
                <td>{{ a.description }}</td>
                <td class="br-amt">{{ a.isDebit ? (a.amount | number : '1.3-3') : '' }}</td>
                <td class="br-amt">{{ !a.isDebit ? (a.amount | number : '1.3-3') : '' }}</td>
                <td>
                  <span class="br-badge"
                    [class.br-badge-done]="a.status === 2"
                    [class.br-badge-partial]="a.status === 1"
                    [class.br-badge-none]="a.status === 0">
                    {{ associationStatusLabel(a.status) }}
                  </span>
                </td>
                <td class="br-proposed">
                  @if (a.status === 2) { {{ a.proposedEntryRef }} }
                  @else if (a.status === 1) { <span class="br-muted" i18n="@@accounting.bank-reconciliation.candidat.s.0c6feb0a">{{ a.candidateCount }} candidat(s)</span> }
                  @else { <span class="br-muted" i18n="@@accounting.bank-reconciliation.text.1b93795b">—</span> }
                </td>
                <td data-label="Actions" i18n-data-label="@@accounting.bank-reconciliation.actions.c3cd636a">
                  @if (a.status !== 2) {
                    <button type="button" class="br-link-btn" (click)="reconcileFromStep(a)" [disabled]="applying()" i18n="@@accounting.bank-reconciliation.rapprocher.094cf3ee">Rapprocher…</button>
                    <button type="button" class="br-link-btn" (click)="openCreateEntry(a.bankStatementLineId, a.description, a.isDebit, a.amount)" [disabled]="applying()" i18n="@@accounting.bank-reconciliation.creer.ecriture.05b7d14c">Créer écriture</button>
                  }
                </td>
              </tr>
            </ng-template>
            <ng-template pTemplate="emptymessage">
              <tr><td colspan="8" class="br-empty" i18n="@@accounting.bank-reconciliation.aucune.ligne.a.associer.0c17e88d">Aucune ligne à associer.</td></tr>
            </ng-template>
          </p-table>

          <div class="br-commit-bar">
            <app-button variant="secondary" icon="pi pi-arrow-left" type="button" (click)="goStep(1)" [disabled]="applying() || autoAssociating()" i18n="@@accounting.bank-reconciliation.retour.e5befb1f"> Retour </app-button>
            <app-button variant="primary" icon="pi pi-arrow-right" type="button" (click)="goToManual()" [disabled]="applying() || autoAssociating()" i18n="@@accounting.bank-reconciliation.rapprochement.manuel.476a4125"> Rapprochement manuel </app-button>
          </div>
        </div>

        <!-- Récapitulatif -->
        <aside class="card br-card br-col-side">
          <h3 class="br-section-title" i18n="@@accounting.bank-reconciliation.recapitulatif.d5b5de6d">Récapitulatif</h3>
          @if (summary(); as sum) {
            <dl class="br-recap">
              <div class="br-recap-row"><dt i18n="@@accounting.bank-reconciliation.lignes.importees.07d18d9c">Lignes importées</dt><dd>{{ sum.importedCount }}</dd></div>
              <div class="br-recap-row"><dt i18n="@@accounting.bank-reconciliation.associees.auto.d614447e">Associées auto</dt><dd class="br-ok">{{ sum.autoMatchedCount }}</dd></div>
              <div class="br-recap-row"><dt i18n="@@accounting.bank-reconciliation.a.rapprocher.b60223ed">À rapprocher</dt><dd class="br-warn">{{ sum.toReconcileCount }}</dd></div>
              <div class="br-recap-row"><dt i18n="@@accounting.bank-reconciliation.non.associees.02017026">Non associées</dt><dd class="br-err">{{ sum.notAssociatedCount }}</dd></div>
              <div class="br-recap-sep"></div>
              <div class="br-recap-row"><dt i18n="@@accounting.bank-reconciliation.total.credits.ec8c5525">Total crédits</dt><dd>{{ sum.totalCredit | number : '1.3-3' }}</dd></div>
              <div class="br-recap-row"><dt i18n="@@accounting.bank-reconciliation.total.debits.9acf4842">Total débits</dt><dd>{{ sum.totalDebit | number : '1.3-3' }}</dd></div>
              <div class="br-recap-row"><dt i18n="@@accounting.bank-reconciliation.solde.du.releve.0ae322d0">Solde du relevé</dt><dd class="br-strong">{{ sum.statementBalance | number : '1.3-3' }}</dd></div>
            </dl>
          } @else {
            <p class="br-help" i18n="@@accounting.bank-reconciliation.lancez.l.association.pour.afficher.le.recapitula.bbcfee1a">Lancez l'association pour afficher le récapitulatif.</p>
          }
          @if ((s.skippedDuplicateCount ?? 0) > 0) {
            <p class="br-help br-dup-hint" i18n="@@accounting.bank-reconciliation.ligne.s.deja.importee.s.ont.ete.ignorees.2d764e72">{{ s.skippedDuplicateCount }} ligne(s) déjà importée(s) ont été ignorées.</p>
          }
        </aside>
      </div>
    }

    <!-- ══ ÉTAPE 3 — Rapprochement manuel ═══════════════════════════════ -->
    @if (wizardActive() && step() === 3 && selected(); as s) {
      <div class="card br-card">
        <div class="br-detail-head">
          <h2 class="br-section-title" i18n="@@accounting.bank-reconciliation.3.rapprochement.manuel.ffe78be3">3 · Rapprochement manuel — {{ s.bankName }} · {{ s.accountNumber }}</h2>
          <span class="br-detail-period" i18n="@@accounting.bank-reconciliation.ligne.s.restante.s.49255e1e">{{ unreconciledLines(s).length }} ligne(s) restante(s)</span>
        </div>
        <p class="br-help" i18n="@@accounting.bank-reconciliation.compte.banque.choisissez.une.ecriture.ca.09d811a8">Compte banque {{ reconcileAccountLabel() }}. Choisissez une écriture candidate ou comptabilisez directement la ligne.</p>

        <p-table [value]="s.lines" [loading]="loadingDetail()" styleClass="p-datatable-sm accounting-datatable" [rowHover]="true">
          <ng-template pTemplate="header">
            <tr>
              <th scope="col" i18n="@@accounting.bank-reconciliation.date.eb9a4bc1">Date</th>
              <th scope="col" i18n="@@accounting.bank-reconciliation.reference.f8130bb0">Référence</th>
              <th scope="col" i18n="@@accounting.bank-reconciliation.libelle.f5485bba">Libellé</th>
              <th scope="col" class="br-amt" i18n="@@accounting.bank-reconciliation.debit.f528224f">Débit</th>
              <th scope="col" class="br-amt" i18n="@@accounting.bank-reconciliation.credit.19194bdf">Crédit</th>
              <th scope="col" i18n="@@accounting.bank-reconciliation.statut.659499f3">Statut</th>
              <th scope="col" i18n="@@accounting.bank-reconciliation.actions.c3cd636a">Actions</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-l>
            <tr [class.br-row-reconciled]="l.isReconciled">
              <td>{{ l.transactionDate | date : 'shortDate' }}</td>
              <td class="br-mono">{{ l.reference }}</td>
              <td>{{ l.description }}</td>
              <td class="br-amt">{{ l.isDebit ? (l.amount | number : '1.3-3') : '' }}</td>
              <td class="br-amt">{{ !l.isDebit ? (l.amount | number : '1.3-3') : '' }}</td>
              <td>
                <span class="br-badge" [class.br-badge-done]="l.isReconciled" [class.br-badge-partial]="!l.isReconciled">
                  {{ l.isReconciled ? loc_ui_tern_rapprochee_bea87b : loc_ui_tern_a_rapprocher_b60223 }}
                </span>
              </td>
              <td data-label="Actions" i18n-data-label="@@accounting.bank-reconciliation.actions.c3cd636a">
                @if (!l.isReconciled) {
                  <button type="button" class="br-link-btn" (click)="openCandidates(l)" [disabled]="reconciling()" i18n="@@accounting.bank-reconciliation.rechercher.91f7d3e9">Rechercher</button>
                  <button type="button" class="br-link-btn" (click)="openCreateEntry(l.id, l.description, l.isDebit, l.amount)" [disabled]="reconciling()" i18n="@@accounting.bank-reconciliation.creer.ecriture.05b7d14c">Créer écriture</button>
                } @else {
                  <button type="button" class="br-link-btn br-link-danger" (click)="unreconcile(l)" [disabled]="reconciling()" i18n="@@accounting.bank-reconciliation.de.rapprocher.52693738">Dé-rapprocher</button>
                }
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr><td colspan="7" class="br-empty" i18n="@@accounting.bank-reconciliation.aucune.ligne.dans.ce.releve.5e04c751">Aucune ligne dans ce relevé.</td></tr>
          </ng-template>
        </p-table>

        <div class="br-commit-bar">
          <app-button variant="secondary" icon="pi pi-arrow-left" type="button" (click)="goStep(2)" [disabled]="reconciling()" i18n="@@accounting.bank-reconciliation.retour.e5befb1f">Retour</app-button>
          <app-button variant="primary" icon="pi pi-arrow-right" type="button" (click)="goStep(4)" [disabled]="reconciling()" i18n="@@accounting.bank-reconciliation.voir.le.resultat.8825ef96">Voir le résultat</app-button>
        </div>
      </div>

      <!-- Candidats de rapprochement -->
      @if (activeLine(); as line) {
        <div class="card br-card">
          <div class="br-detail-head">
            <h2 class="br-section-title" i18n="@@accounting.bank-reconciliation.candidats.pour.0514086e">
              Candidats pour « {{ line.description }} » — {{ line.amount | number : '1.3-3' }}
              {{ line.isDebit ? loc_ui_tern_decaissement_e2ba8f : loc_ui_tern_encaissement_44a988 }}
            </h2>
            <button type="button" class="br-link-btn" (click)="closeCandidates()" i18n="@@accounting.bank-reconciliation.fermer.5ab4ec64">Fermer</button>
          </div>
          <p class="br-help" i18n="@@accounting.bank-reconciliation.lignes.du.compte.banque.au.meme.montant.1b08acdc">Lignes du compte banque {{ reconcileAccountLabel() }} au même montant, à ±10 jours. Les brouillons sont exclus.</p>
          <p-table [value]="candidates()" [loading]="loadingCandidates()" styleClass="p-datatable-sm accounting-datatable" [rowHover]="true">
            <ng-template pTemplate="header">
              <tr>
                <th scope="col" i18n="@@accounting.bank-reconciliation.date.eb9a4bc1">Date</th><th scope="col" i18n="@@accounting.bank-reconciliation.journal.57d7f743">Journal</th><th scope="col" i18n="@@accounting.bank-reconciliation.n.754e6095">N°</th>
                <th scope="col" i18n="@@accounting.bank-reconciliation.compte.c45740bb">Compte</th><th scope="col" i18n="@@accounting.bank-reconciliation.libelle.f5485bba">Libellé</th>
                <th scope="col" class="br-amt" i18n="@@accounting.bank-reconciliation.debit.f528224f">Débit</th><th scope="col" class="br-amt" i18n="@@accounting.bank-reconciliation.credit.19194bdf">Crédit</th>
                <th scope="col"></th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-c>
              <tr>
                <td>{{ c.entryDate | date : 'shortDate' }}</td>
                <td>{{ c.journalCode }}</td>
                <td>{{ c.entryNumber }}</td>
                <td class="br-mono">{{ c.accountNumber }}</td>
                <td>{{ c.label }}</td>
                <td class="br-amt">{{ c.debit | number : '1.3-3' }}</td>
                <td class="br-amt">{{ c.credit | number : '1.3-3' }}</td>
                <td><button type="button" class="br-link-btn" (click)="reconcile(line, c)" [disabled]="reconciling()" i18n="@@accounting.bank-reconciliation.choisir.b030d590">Choisir</button></td>
              </tr>
            </ng-template>
            <ng-template pTemplate="emptymessage">
              <tr><td colspan="8" class="br-empty" i18n="@@accounting.bank-reconciliation.aucune.ecriture.candidate.au.meme.montant.sur.la.ffeccfe5">Aucune écriture candidate au même montant sur la fenêtre de dates.</td></tr>
            </ng-template>
          </p-table>
        </div>
      }
    }

    <!-- ══ ÉTAPE 4 — Résultat ════════════════════════════════════════════ -->
    @if (wizardActive() && step() === 4 && selected(); as s) {
      <div class="card br-card">
        <h2 class="br-section-title" i18n="@@accounting.bank-reconciliation.4.resultat.d9bfda09">4 · Résultat — {{ s.bankName }} · {{ s.accountNumber }}</h2>
        <div class="br-summary">
          <div class="br-kpi"><span class="br-kpi-label" i18n="@@accounting.bank-reconciliation.lignes.41c7025e">Lignes</span><span class="br-kpi-value">{{ s.lines.length }}</span></div>
          <div class="br-kpi"><span class="br-kpi-label" i18n="@@accounting.bank-reconciliation.rapprochees.c5ab1770">Rapprochées</span><span class="br-kpi-value br-ok">{{ reconciledCount(s) }}</span></div>
          <div class="br-kpi"><span class="br-kpi-label" i18n="@@accounting.bank-reconciliation.restantes.17c6e7e2">Restantes</span><span class="br-kpi-value" [class.br-err]="unreconciledLines(s).length > 0">{{ unreconciledLines(s).length }}</span></div>
        </div>

        @if (unreconciledLines(s).length > 0) {
          <h3 class="br-section-sub" i18n="@@accounting.bank-reconciliation.lignes.non.rapprochees.89a2f56d">Lignes non rapprochées</h3>
          <ul class="br-result-list">
            @for (l of unreconciledLines(s); track l.id) {
              <li>
                <span class="br-mono">{{ l.transactionDate | date : 'shortDate' }}</span> · {{ l.description }} —
                <strong>{{ l.amount | number : '1.3-3' }}</strong> {{ l.isDebit ? loc_ui_tern_debit_b70777 : loc_ui_tern_credit_023d57 }}
              </li>
            }
          </ul>
        } @else {
          <p class="br-help br-ok" i18n="@@accounting.bank-reconciliation.toutes.les.lignes.de.ce.releve.sont.rapprochees.ac441077">Toutes les lignes de ce relevé sont rapprochées. 🎉</p>
        }

        <div class="br-commit-bar">
          <app-button variant="secondary" icon="pi pi-arrow-left" type="button" (click)="goStep(3)" i18n="@@accounting.bank-reconciliation.retour.e5befb1f">Retour</app-button>
          <app-button variant="primary" icon="pi pi-check" type="button" (click)="finishWizard()" i18n="@@accounting.bank-reconciliation.terminer.6bf1bd74">Terminer</app-button>
        </div>
      </div>
    }

    <!-- ── Panneau « Créer une écriture » (étapes 2 et 3) ───────────────── -->
    @if (createLine(); as cl) {
      <div class="card br-card br-create-panel">
        <div class="br-detail-head">
          <h2 class="br-section-title" i18n="@@accounting.bank-reconciliation.comptabiliser.d5681f71">Comptabiliser « {{ cl.description }} » — {{ cl.amount | number : '1.3-3' }} {{ cl.isDebit ? loc_ui_tern_decaissement_e2ba8f : loc_ui_tern_encaissement_44a988 }}</h2>
          <button type="button" class="br-link-btn" (click)="cancelCreateEntry()" i18n="@@accounting.bank-reconciliation.fermer.5ab4ec64">Fermer</button>
        </div>
        <div class="br-import-fields">
          <div class="form-field">
            <label class="field-label" for="ce-journal" i18n="@@accounting.bank-reconciliation.journal.57d7f743">Journal</label>
            <input id="ce-journal" class="br-input br-input-narrow" [(ngModel)]="createForm.journalCode" placeholder="BQ" i18n-placeholder="@@accounting.bank-reconciliation.bq.70c2d9e1" [disabled]="creatingEntry()" />
          </div>
          <div class="form-field">
            <label class="field-label" for="ce-account" i18n="@@accounting.bank-reconciliation.compte.de.contrepartie.df81fd03">Compte de contrepartie</label>
            <input id="ce-account" class="br-input" [(ngModel)]="createForm.counterpartyAccount" placeholder="Ex. 6580000" i18n-placeholder="@@accounting.bank-reconciliation.ex.6580000.19a967b0" [disabled]="creatingEntry()" />
          </div>
          <div class="form-field br-field-file">
            <label class="field-label" for="ce-label" i18n="@@accounting.bank-reconciliation.libelle.facultatif.3c04cfb9">Libellé (facultatif)</label>
            <input id="ce-label" class="br-input" [(ngModel)]="createForm.label" [disabled]="creatingEntry()" />
          </div>
        </div>
        <p class="br-help" i18n="@@accounting.bank-reconciliation.ecriture.equilibree.compte.banque.contre.f27e7c9a">
          Écriture équilibrée compte banque {{ reconcileAccountLabel() }} ↔ contrepartie, puis rapprochement automatique de la ligne
          (selon le paramétrage brouillard).
        </p>
        <div class="br-commit-bar">
          <app-button variant="primary" icon="pi pi-save" type="button" (click)="confirmCreateEntry()"
            [disabled]="creatingEntry() || !createForm.counterpartyAccount.trim() || !createForm.journalCode.trim()">
            {{ creatingEntry() ? loc_ui_tern_comptabilisation_a5c2b1 : loc_ui_tern_comptabiliser_l_ecriture_872706 }}
          </app-button>
        </div>
      </div>
    }

    @if (aiPostingEnabled()) {
      <app-bank-statement-upload-dialog
        [(visible)]="aiImportVisible"
        [initialFile]="aiImportFile()"
        [initialBankAccountId]="selectedBankAccountId || null"
        origin="reconciliation" />
    }
  `,
  styles: `
    .br-card {
      padding: var(--spacing-5);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-sm, 0 1px 3px rgba(15, 23, 42, 0.08));
      margin-bottom: var(--spacing-4);
    }
    .br-toolbar-fields { display: flex; flex-wrap: wrap; gap: var(--spacing-3); flex: 1 1 280px; }
    .br-toolbar-actions { display: flex; flex-wrap: wrap; gap: var(--spacing-3); align-items: flex-end; }
    .form-field { display: flex; flex-direction: column; gap: var(--spacing-1); min-width: 0; }
    .field-label { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); margin: 0; }
    .br-input {
      padding: var(--spacing-2) var(--spacing-3);
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-md);
      background: var(--color-background-elevated);
      color: var(--color-text-primary);
      font-size: var(--font-size-sm);
      min-height: 2.5rem;
    }
    .br-input-narrow { max-width: 8rem; }
    .br-import-fields { display: flex; flex-wrap: wrap; align-items: flex-end; gap: var(--spacing-4); }
    .br-field-file { flex: 1 1 260px; }
    .br-import-actions { display: flex; align-items: flex-end; }
    .br-help { margin: var(--spacing-3) 0 0; font-size: var(--font-size-sm); color: var(--color-text-secondary); }
    .br-help code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      background: var(--color-background-subtle); padding: 0 0.25rem; border-radius: var(--radius-sm, 4px);
    }
    .br-dup-hint { color: var(--color-warning-700, #a16207); }

    /* Stepper */
    .br-stepper-card { display: flex; align-items: center; justify-content: space-between; gap: var(--spacing-4); flex-wrap: wrap; }
    .br-stepper { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--spacing-5); flex: 1 1 auto; }
    .br-step { display: flex; align-items: center; gap: var(--spacing-2); opacity: 0.55; }
    .br-step-current, .br-step-done { opacity: 1; }
    .br-step-badge {
      display: inline-flex; align-items: center; justify-content: center;
      width: 1.75rem; height: 1.75rem; border-radius: 999px;
      background: var(--color-background-subtle); color: var(--color-text-secondary);
      font-weight: var(--font-weight-semibold); font-size: var(--font-size-sm);
      border: 1px solid var(--color-border-default);
    }
    .br-step-current .br-step-badge { background: var(--color-primary-600, #2563eb); color: #fff; border-color: transparent; }
    .br-step-done .br-step-badge { background: var(--color-success-600, #16a34a); color: #fff; border-color: transparent; }
    .br-step-text { display: flex; flex-direction: column; line-height: 1.15; }
    .br-step-label { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); }
    .br-step-hint { font-size: var(--font-size-xs); color: var(--color-text-tertiary); }
    .br-stepper-actions { flex: 0 0 auto; }

    .br-two-col { display: grid; grid-template-columns: minmax(0, 1fr) 18rem; gap: var(--spacing-4); align-items: start; }
    @media (max-width: 960px) { .br-two-col { grid-template-columns: 1fr; } }
    .br-col-main, .br-col-side { margin-bottom: 0; }

    .br-section-title { margin: 0 0 var(--spacing-3); font-size: var(--font-size-lg); font-weight: var(--font-weight-semibold); }
    .br-section-sub { margin: var(--spacing-4) 0 var(--spacing-2); font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-text-tertiary); }
    .br-head-actions { display: flex; flex-wrap: wrap; gap: var(--spacing-2); }
    .br-summary {
      display: flex; flex-wrap: wrap; gap: var(--spacing-5);
      margin-top: var(--spacing-4); padding-bottom: var(--spacing-3);
      border-bottom: 1px solid var(--color-border-subtle);
    }
    .br-kpi { display: flex; flex-direction: column; gap: 2px; }
    .br-kpi-label { font-size: var(--font-size-xs); color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.04em; }
    .br-kpi-value { font-size: var(--font-size-lg); font-weight: var(--font-weight-semibold); font-variant-numeric: tabular-nums; }
    .br-ok { color: var(--color-success-700, #15803d); }
    .br-warn { color: var(--color-warning-700, #a16207); }
    .br-err { color: var(--color-danger-600, #dc2626); }
    .br-strong { font-weight: var(--font-weight-semibold); }
    .br-muted { color: var(--color-text-tertiary); }

    .br-options { display: flex; flex-wrap: wrap; gap: var(--spacing-4); }
    .br-check { display: inline-flex; align-items: center; gap: var(--spacing-2); font-size: var(--font-size-sm); color: var(--color-text-primary); cursor: pointer; }
    .br-check-disabled { opacity: 0.55; cursor: not-allowed; }

    .br-recap { margin: 0; }
    .br-recap-row { display: flex; justify-content: space-between; gap: var(--spacing-3); padding: var(--spacing-1) 0; font-size: var(--font-size-sm); }
    .br-recap-row dt { color: var(--color-text-secondary); margin: 0; }
    .br-recap-row dd { margin: 0; font-variant-numeric: tabular-nums; font-weight: var(--font-weight-semibold); }
    .br-recap-sep { height: 1px; background: var(--color-border-subtle); margin: var(--spacing-2) 0; }

    .br-issues {
      margin-top: var(--spacing-3); padding: var(--spacing-3) var(--spacing-4);
      border-radius: var(--radius-md);
      background: var(--color-danger-50, #fef2f2);
      border: 1px solid var(--color-danger-200, #fecaca);
    }
    .br-issues-title { margin: 0 0 var(--spacing-2); font-size: var(--font-size-sm); color: var(--color-danger-700, #b91c1c); }
    .br-issues-list { margin: 0; padding-inline-start: var(--spacing-5); font-size: var(--font-size-sm); color: var(--color-text-secondary); }
    .br-issue-ref { font-weight: var(--font-weight-semibold); color: var(--color-text-primary); margin-inline-end: var(--spacing-1); }
    .br-result-list { margin: var(--spacing-2) 0 0; padding-inline-start: var(--spacing-5); font-size: var(--font-size-sm); color: var(--color-text-secondary); }
    .br-result-list li { padding: 2px 0; }

    .br-commit-bar {
      display: flex; align-items: center; justify-content: flex-end; gap: var(--spacing-4);
      margin-top: var(--spacing-4); padding-top: var(--spacing-4);
      border-top: 1px solid var(--color-border-subtle);
    }
    .br-commit-hint { font-size: var(--font-size-sm); color: var(--color-text-secondary); margin-inline-end: auto; }
    .br-amt { text-align: end; font-variant-numeric: tabular-nums; }
    .br-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    .br-check-col { width: 2.5rem; text-align: center; }
    .br-proposed { font-size: var(--font-size-sm); }
    .br-badge {
      display: inline-block; padding: 0.15rem 0.55rem; border-radius: var(--radius-pill, 999px);
      font-size: var(--font-size-xs); font-weight: var(--font-weight-semibold);
    }
    .br-badge-done { background: var(--color-success-100, #dcfce7); color: var(--color-success-700, #15803d); }
    .br-badge-partial { background: var(--color-warning-50, #fffbeb); color: var(--color-warning-700, #a16207); border: 1px solid var(--color-warning-200, #fde68a); }
    .br-badge-none { background: var(--color-danger-50, #fef2f2); color: var(--color-danger-700, #b91c1c); border: 1px solid var(--color-danger-200, #fecaca); }
    .br-link-btn {
      background: none; border: none; padding: 0; margin-inline-end: var(--spacing-3); cursor: pointer;
      color: var(--color-primary-600, #2563eb); font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold);
    }
    .br-link-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .br-link-danger { color: var(--color-danger-600, #dc2626); }
    .br-row-reconciled { opacity: 0.75; }
    .br-detail-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--spacing-3); flex-wrap: wrap; }
    .br-detail-period { font-size: var(--font-size-sm); color: var(--color-text-secondary); }
    .br-empty { text-align: center; padding: var(--spacing-6) var(--spacing-4) !important; color: var(--color-text-secondary); }
    .br-empty-title { margin: 0 0 var(--spacing-1); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); }
    .br-empty-hint { margin: 0; font-size: var(--font-size-sm); }
    .br-create-panel { border: 1px solid var(--color-primary-200, #bfdbfe); }
    .br-recon-card { margin-top: var(--spacing-4); }
    .br-recon-actions { display: flex; align-items: center; gap: var(--spacing-3); }
    .br-recon-balances { display: flex; flex-wrap: wrap; gap: var(--spacing-6); margin: var(--spacing-3) 0; }
    .br-recon-balances > div { display: flex; flex-direction: column; }
    .br-recon-lbl { font-size: var(--font-size-sm); color: var(--color-text-secondary); }
    .br-recon-val { font-weight: var(--font-weight-bold); font-variant-numeric: tabular-nums; }
    .br-recon-adjusted { border-top: 1px solid var(--color-border-default); padding-top: var(--spacing-3); margin-top: var(--spacing-4); }
    .br-recon-sub { margin: var(--spacing-4) 0 var(--spacing-2); font-size: var(--font-size-md); font-weight: var(--font-weight-semibold); }
    .br-recon-diff { font-weight: var(--font-weight-bold); font-variant-numeric: tabular-nums; font-size: var(--font-size-lg); }
    .br-recon-diff span { font-size: var(--font-size-sm); font-weight: var(--font-weight-regular); margin-inline-start: var(--spacing-2); }
    .br-recon-ok { color: var(--color-success-600, #16a34a); }
    .br-recon-ko { color: var(--color-danger-600, #dc2626); }
  `
})
export class BankReconciliationComponent implements OnInit {
  readonly loc_ui_tern_rapproche_06101d = $localize`:@@ui.tern.rapproche.06101d:— rapproché`;
  readonly loc_ui_tern_a_justifier_d719d3 = $localize`:@@ui.tern.a.justifier.d719d3:— à justifier`;
  readonly loc_ui_tern_analyse_458c82 = $localize`:@@ui.tern.analyse.458c82:Analyse…`;
  readonly loc_ui_tern_tester_l_importation_92d856 = $localize`:@@ui.tern.tester.l.importation.92d856:Tester l'importation`;
  readonly loc_ui_tern_import_4834ca = $localize`:@@ui.tern.import.4834ca:Import…`;
  readonly loc_ui_tern_importer_et_continuer_135d02 = $localize`:@@ui.tern.importer.et.continuer.135d02:Importer et continuer`;
  readonly loc_import_all_statements = $localize`:@@accounting.bank-reconciliation.ts.importer.les.releves.et.continuer.d68ffced:Importer les relevés et continuer`;
  readonly loc_ui_tern_rapprochement_e7a2b4 = $localize`:@@ui.tern.rapprochement.e7a2b4:Rapprochement…`;
  readonly loc_ui_tern_rapprocher_tout_ce_qui_est_associe_061001 = $localize`:@@ui.tern.rapprocher.tout.ce.qui.est.associe.061001:Rapprocher tout ce qui est associé (`;
  readonly loc_ui_tern_rapprochee_bea87b = $localize`:@@ui.tern.rapprochee.bea87b:Rapprochée`;
  readonly loc_ui_tern_a_rapprocher_b60223 = $localize`:@@ui.tern.a.rapprocher.b60223:À rapprocher`;
  readonly loc_ui_tern_decaissement_e2ba8f = $localize`:@@ui.tern.decaissement.e2ba8f:(décaissement)`;
  readonly loc_ui_tern_encaissement_44a988 = $localize`:@@ui.tern.encaissement.44a988:(encaissement)`;
  readonly loc_ui_tern_debit_b70777 = $localize`:@@ui.tern.debit.b70777:(débit)`;
  readonly loc_ui_tern_credit_023d57 = $localize`:@@ui.tern.credit.023d57:(crédit)`;
  readonly loc_ui_tern_comptabilisation_a5c2b1 = $localize`:@@ui.tern.comptabilisation.a5c2b1:Comptabilisation…`;
  readonly loc_ui_tern_comptabiliser_l_ecriture_872706 = $localize`:@@ui.tern.comptabiliser.l.ecriture.872706:Comptabiliser l'écriture`;
  private readonly errors = inject(ErrorHandlerService);
  private readonly api = inject(BankReconciliationService);
  private readonly accounting = inject(AccountingService);
  private readonly bankAccountsApi = inject(BankAccountService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly bankStatementImport = inject(BankStatementImportService);
  private readonly destroyRef = inject(DestroyRef);

  /** Import IA de relevés activé côté serveur : accès à la comptabilisation assistée d'un relevé. */
  readonly aiPostingEnabled = signal(false);
  /** Tout relevé PDF ou image passe par l'import IA (analyse en arrière-plan, relecture, retour ici). */
  readonly allDocumentsViaAi = signal(false);
  readonly aiImportVisible = signal(false);
  readonly aiImportFile = signal<File | null>(null);

  unmatchedOnly = false;

  readonly steps: WizardStepDef[] = [
    { index: 1, label: $localize`:@@accounting.bank-reconciliation.ts.import.d6fbc9d2:Import`, hint: $localize`:@@accounting.bank-reconciliation.ts.charger.le.releve.f291ecbe:Charger le relevé` },
    { index: 2, label: $localize`:@@accounting.bank-reconciliation.ts.association.auto.02f66e5d:Association auto`, hint: $localize`:@@accounting.bank-reconciliation.ts.propositions.recap.d21112d4:Propositions + récap` },
    { index: 3, label: $localize`:@@accounting.bank-reconciliation.ts.rapprochement.manuel.476a4125:Rapprochement manuel`, hint: $localize`:@@accounting.bank-reconciliation.ts.lignes.restantes.88fe6e9b:Lignes restantes` },
    { index: 4, label: $localize`:@@accounting.bank-reconciliation.ts.resultat.7186e8ff:Résultat`, hint: $localize`:@@accounting.bank-reconciliation.ts.synthese.ab761b35:Synthèse` }
  ];

  // Wizard
  readonly wizardActive = signal(false);
  readonly step = signal<1 | 2 | 3 | 4>(1);

  readonly bankAccounts = signal<BankAccountDto[]>([]);
  readonly loadingBankAccounts = signal(false);
  selectedBankAccountId = '';
  private lastImportMethod = 0;
  private lastSourceFileName: string | null = null;

  // Options + paramètres d'import
  optSkipAlreadyImported = false;
  optImportBalances = true;
  defaultJournalCode = 'BQ';
  defaultCounterparty = '';

  // Liste
  accountFilter = '';
  fromStr = '';
  toStr = '';
  readonly statements = signal<BankStatementDto[]>([]);
  readonly loadingList = signal(false);

  // Détail
  readonly selected = signal<BankStatementDto | null>(null);
  readonly loadingDetail = signal(false);

  // État de rapprochement (édition imprimable, hors wizard)
  readonly reconStatement = signal<BankReconciliationStatementDto | null>(null);
  readonly reconError = signal<string | null>(null);
  readonly exportingRecon = signal(false);
  private reconStatementId: string | null = null;

  // Import fichier
  fileFormat: BankStatementFileFormat = BankStatementFileFormat.Csv;
  readonly selectedFile = signal<File | null>(null);
  readonly preview = signal<BankStatementFilePreviewDto | null>(null);
  readonly previewing = signal(false);
  readonly importing = signal(false);
  meta = this.emptyMeta();

  // Association automatique
  readonly associations = signal<BankLineAssociationDto[]>([]);
  readonly summary = signal<BankReconciliationSummaryDto | null>(null);
  readonly autoAssociating = signal(false);
  readonly applying = signal(false);
  private readonly checked = signal<Set<string>>(new Set());

  // Rapprochement manuel
  readonly activeLine = signal<BankStatementLineDto | null>(null);
  readonly candidates = signal<JournalSearchRowDto[]>([]);
  readonly loadingCandidates = signal(false);
  readonly reconciling = signal(false);

  // Création d'écriture
  readonly createLine = signal<{ id: string; description: string; isDebit: boolean; amount: number } | null>(null);
  createForm = { journalCode: 'BQ', counterpartyAccount: '', label: '' };
  readonly creatingEntry = signal(false);

  readonly error = signal<string | null>(null);

  readonly canSubmitImport = computed(() => {
    const p = this.preview();
    return !!p?.canImport
      && this.meta.bankName.trim().length > 0
      && this.meta.accountNumber.trim().length > 0
      && this.meta.periodStart.length > 0
      && this.meta.periodEnd.length > 0;
  });

  readonly selectedAssociatedCount = computed(() =>
    this.associations().filter(a => a.status === BankLineAssociationStatus.Associated && this.checked().has(a.bankStatementLineId)).length);

  ngOnInit(): void {
    const qp = this.route.snapshot.queryParamMap;
    const fy = qp.get('fiscalYear');
    if (fy) {
      this.fromStr = `${fy}-01-01`;
      this.toStr = `${fy}-12-31`;
    }
    this.unmatchedOnly = qp.get('unmatchedOnly') === '1';
    this.loadStatements();
    this.loadBankAccounts();
    this.bankStatementImport.capabilities({ includeAi: false }).subscribe(caps => {
      this.aiPostingEnabled.set(!!caps?.enabled);
      this.allDocumentsViaAi.set(!!caps?.enabled && !!caps?.allDocumentsViaAi);
    });
    this.openImportedStatement(qp.get('statementId'));
  }

  /**
   * Retour de l'import IA : le relevé enregistré s'ouvre directement à l'étape 2 (association).
   * Seul un identifiant au format GUID est accepté, lu par l'API du dossier ; le paramètre est
   * ensuite retiré de l'adresse (un rafraîchissement ne rouvre pas l'assistant).
   */
  private openImportedStatement(statementId: string | null): void {
    if (!statementId || !GUID_PATTERN.test(statementId)) return;
    const state = (typeof history !== 'undefined' ? history.state : null) as
      { importedStatement?: { lineCount?: number; alreadyImportedCount?: number } } | null;
    const imported = state?.importedStatement;
    if (imported && typeof imported.lineCount === 'number') {
      const already = imported.alreadyImportedCount ?? 0;
      this.toast.add({
        severity: already > 0 ? 'warn' : 'success',
        summary: $localize`:@@accounting.bank-reconciliation.ts.releve.enregistre.48f3bacc:Relevé enregistré`,
        detail: already > 0
          ? $localize`:@@accounting.bank-reconciliation.ts.operation.s.dont.deja.presente.s.dans.un.autre.r.84d6cf0e:${imported.lineCount}:COUNT: opération(s), dont ${already}:ALREADY: déjà présente(s) dans un autre relevé de ce compte.`
          : $localize`:@@accounting.bank-reconciliation.ts.operation.s.prete.s.pour.le.rapprochement.9a5f4b90:${imported.lineCount}:COUNT: opération(s) prête(s) pour le rapprochement.`,
        life: 5000
      });
    }
    this.openStatement(statementId);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { statementId: null },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  /** Relevé PDF ou image : l'import IA le prend en charge (le fichier est présélectionné). */
  openAiImport(file: File | null): void {
    if (!file) return;
    this.aiImportFile.set(file);
    this.aiImportVisible.set(true);
  }

  private isAiDocument(file: File | null): boolean {
    const ext = file?.name.split('.').pop()?.toLowerCase() ?? '';
    return ['pdf', 'png', 'jpg', 'jpeg', 'webp'].includes(ext);
  }

  loadBankAccounts(): void {
    this.loadingBankAccounts.set(true);
    this.bankAccountsApi.list().subscribe({
      next: res => {
        this.loadingBankAccounts.set(false);
        if (res.success && res.data) this.bankAccounts.set(res.data);
      },
      error: () => this.loadingBankAccounts.set(false)
    });
  }

  formatRib(rib: string): string {
    const d = rib.replace(/\D/g, '');
    if (d.length !== 20) return rib;
    return `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 18)} ${d.slice(18, 20)}`;
  }

  extractionLabel(method: BankStatementExtractionMethod): string {
    switch (method) {
      case BankStatementExtractionMethod.TextParser: return 'Parser texte BIAT/TN';
      case BankStatementExtractionMethod.OcrTextParser: return 'OCR + parser texte';
      case BankStatementExtractionMethod.OcrLlm: return 'OCR + IA';
      default: return 'Inconnue';
    }
  }

  associationStatusLabel(status: BankLineAssociationStatus): string {
    switch (status) {
      case BankLineAssociationStatus.Associated: return $localize`:@@accounting.bank-reconciliation.ts.associe.7ab382a5:Associé`;
      case BankLineAssociationStatus.ToReconcile: return $localize`:@@accounting.bank-reconciliation.ts.a.rapprocher.b60223ed:À rapprocher`;
      default: return $localize`:@@accounting.bank-reconciliation.ts.non.associe.1d12cdc9:Non associé`;
    }
  }

  reconcileAccountLabel(): string {
    const s = this.selected();
    return s?.chartOfAccountNumber?.trim() || '53…';
  }

  busy(): boolean {
    return this.previewing() || this.importing();
  }

  reconciledCount(s: BankStatementDto): number {
    return s.lines.filter(l => l.isReconciled).length;
  }

  unreconciledLines(s: BankStatementDto): BankStatementLineDto[] {
    return s.lines.filter(l => !l.isReconciled);
  }

  private emptyMeta() {
    return { bankName: '', accountNumber: '', periodStart: '', periodEnd: '', openingBalance: 0, closingBalance: 0 };
  }

  loadStatements(): void {
    this.loadingList.set(true);
    this.error.set(null);
    const from = this.fromStr ? parseLocalDateString(this.fromStr) : null;
    const to = this.toStr ? parseLocalDateString(this.toStr) : null;
    this.api.getStatements(this.accountFilter || null, from, to).subscribe({
      next: res => {
        this.loadingList.set(false);
        if (res.success && res.data) {
          let list = res.data;
          if (this.unmatchedOnly) {
            list = list.filter(s => s.lines.some(l => !l.isReconciled));
          }
          this.statements.set(list);
        } else this.error.set(res.error ?? $localize`:@@ui.tern.erreur.de.chargement.des.releves.b5e8ea:Erreur de chargement des relevés.`);
      },
      error: err => {
        this.loadingList.set(false);
        this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.bank-reconciliation.ts.erreur.reseau.lors.du.chargement.des.rel.9f816010:Erreur réseau lors du chargement des relevés.`));
      }
    });
  }

  // ── Navigation wizard ────────────────────────────────────────────────

  goStep(n: 1 | 2 | 3 | 4): void {
    this.closeCandidates();
    this.cancelCreateEntry();
    this.step.set(n);
  }

  startImport(): void {
    this.resetImport();
    this.selected.set(null);
    this.associations.set([]);
    this.summary.set(null);
    this.wizardActive.set(true);
    this.step.set(1);
  }

  exitWizard(): void {
    this.wizardActive.set(false);
    this.resetImport();
    this.selected.set(null);
    this.associations.set([]);
    this.summary.set(null);
    this.closeCandidates();
    this.cancelCreateEntry();
    this.loadStatements();
  }

  finishWizard(): void {
    this.toast.add({ severity: 'success', summary: $localize`:@@bank-reconciliation.component.summary.Rapprochement_te:Rapprochement terminé`, life: 3000 });
    this.exitWizard();
  }

  openStatement(id: string): void {
    this.loadingDetail.set(true);
    this.error.set(null);
    this.closeCandidates();
    this.api.getStatement(id).subscribe({
      next: res => {
        this.loadingDetail.set(false);
        if (res.success && res.data) {
          this.selected.set(res.data);
          this.wizardActive.set(true);
          this.step.set(2);
          this.runAutoAssociate();
        } else {
          this.error.set(res.error ?? $localize`:@@ui.tern.releve.introuvable.a15279:Relevé introuvable.`);
        }
      },
      error: err => {
        this.loadingDetail.set(false);
        this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.bank-reconciliation.ts.erreur.reseau.lors.du.chargement.du.rele.6043868d:Erreur réseau lors du chargement du relevé.`));
      }
    });
  }

  /** Ouvre l'état de rapprochement d'un relevé (hors wizard, en lecture seule). */
  openReconciliationStatement(id: string): void {
    this.reconStatementId = id;
    this.reconError.set(null);
    this.reconStatement.set(null);
    this.api.getReconciliationStatement(id).subscribe({
      next: res => {
        if (res.success && res.data) this.reconStatement.set(res.data);
        else this.reconError.set(res.error ?? $localize`:@@ui.tern.impossible.d.etablir.l.etat.de.rapprocheme.86ce87:Impossible d'établir l'état de rapprochement.`);
      },
      error: err => this.reconError.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.bank-reconciliation.ts.erreur.reseau.lors.du.chargement.de.l.et.626d3dd3:Erreur réseau lors du chargement de l'état de rapprochement.`))
    });
  }

  closeReconciliationStatement(): void {
    this.reconStatement.set(null);
    this.reconError.set(null);
    this.reconStatementId = null;
  }

  onExportReconciliation(format: AccountingExportFormat): void {
    const id = this.reconStatementId;
    if (!id) return;
    this.exportingRecon.set(true);
    this.api.exportReconciliationStatement(id, format).subscribe({
      next: blob => {
        this.exportingRecon.set(false);
        downloadBlob(blob, `etat_rapprochement_${id}.${exportExtension(format)}`);
      },
      error: err => {
        this.exportingRecon.set(false);
        this.toast.add({ severity: 'error', summary: this.errors.extractErrorMessage(err, $localize`:@@accounting.bank-reconciliation.ts.erreur.lors.de.l.export.de.l.etat.de.rap.6d8d923c:Erreur lors de l'export de l'état de rapprochement.`), life: 4000 });
      }
    });
  }

  private refreshSelected(then?: () => void): void {
    const current = this.selected();
    if (!current) return;
    this.loadingDetail.set(true);
    this.api.getStatement(current.id).subscribe({
      next: res => {
        this.loadingDetail.set(false);
        if (res.success && res.data) this.selected.set(res.data);
        then?.();
      },
      error: () => {
        this.loadingDetail.set(false);
        then?.();
      }
    });
  }

  // ── Import fichier ─────────────────────────────────────────────────────

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files && input.files.length > 0 ? input.files[0] : null;
    this.selectedFile.set(file);
    this.preview.set(null);
    this.error.set(null);
    if (file) {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      if (ext === 'pdf') this.fileFormat = BankStatementFileFormat.Pdf;
      else if (['jpg', 'jpeg', 'png'].includes(ext)) this.fileFormat = BankStatementFileFormat.Image;
      else if (ext === 'xlsx') this.fileFormat = BankStatementFileFormat.Excel;
      else if (['ofx', 'qfx'].includes(ext)) this.fileFormat = BankStatementFileFormat.Ofx;
      else if (['sta', 'mt940'].includes(ext)) this.fileFormat = BankStatementFileFormat.Mt940;
      else this.fileFormat = BankStatementFileFormat.Csv;
      if (this.allDocumentsViaAi() && this.isAiDocument(file)) this.openAiImport(file);
    }
  }

  runPreview(): void {
    const file = this.selectedFile();
    if (!file || this.busy()) return;
    if (this.allDocumentsViaAi()
      && (this.isAiDocument(file) || this.fileFormat === BankStatementFileFormat.Pdf || this.fileFormat === BankStatementFileFormat.Image)) {
      this.openAiImport(file);
      return;
    }
    this.error.set(null);
    this.previewing.set(true);
    this.api.previewStatementFile(file, this.fileFormat).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: res => {
        this.previewing.set(false);
        if (!res.success || !res.data) {
          this.error.set(res.error ?? $localize`:@@ui.tern.l.apercu.du.releve.a.echoue.1582c6:L'aperçu du relevé a échoué.`);
          return;
        }
        const data: BankStatementFilePreviewDto = {
          ...res.data,
          extractionMethod: normalizeExtractionMethod(res.data.extractionMethod)
        };
        this.preview.set(data);
        if (data.periodStart) this.meta.periodStart = data.periodStart.substring(0, 10);
        if (data.periodEnd) this.meta.periodEnd = data.periodEnd.substring(0, 10);
        if (this.optImportBalances) {
          if (data.suggestedOpeningBalance != null) this.meta.openingBalance = data.suggestedOpeningBalance;
          if (data.suggestedClosingBalance != null) this.meta.closingBalance = data.suggestedClosingBalance;
        }
        if (data.suggestedBankName) this.meta.bankName = data.suggestedBankName;
        if (data.detectedRib) this.meta.accountNumber = this.formatRib(data.detectedRib);
        if (data.matchedBankAccountId) this.selectedBankAccountId = data.matchedBankAccountId;
        this.lastSourceFileName = this.selectedFile()?.name ?? null;
        this.lastImportMethod = this.mapImportMethod(data.extractionMethod, this.fileFormat);
      },
      error: err => {
        this.previewing.set(false);
        if (previewErrorCode(err) === 'bank_statement.ai_import_required' && this.aiPostingEnabled()) {
          this.openAiImport(file);
          return;
        }
        this.error.set(this.previewErrorMessage(err)
          ?? this.errors.extractErrorMessage(err, $localize`:@@accounting.bank-reconciliation.ts.erreur.reseau.lors.de.l.apercu.du.releve.170cebcd:Erreur réseau lors de l'aperçu du relevé.`));
      }
    });
  }

  runImport(): void {
    const p = this.preview();
    if (!p?.canImport || !this.canSubmitImport() || this.busy()) return;
    this.error.set(null);
    this.importing.set(true);
    this.api.importStatement({
      bankName: this.meta.bankName.trim(),
      accountNumber: this.meta.accountNumber.trim(),
      statementDate: this.meta.periodEnd,
      periodStart: this.meta.periodStart,
      periodEnd: this.meta.periodEnd,
      openingBalance: Number(this.meta.openingBalance) || 0,
      closingBalance: Number(this.meta.closingBalance) || 0,
      bankAccountId: this.selectedBankAccountId || p.matchedBankAccountId || null,
      chartOfAccountNumber: this.resolveChartAccountNumber(p),
      sourceFileName: this.lastSourceFileName,
      importMethod: this.lastImportMethod,
      skipAlreadyImported: this.optSkipAlreadyImported,
      lines: p.lines
    }).subscribe({
      next: res => {
        this.importing.set(false);
        if (!res.success || !res.data) {
          this.error.set(res.error ?? $localize`:@@ui.tern.l.import.du.releve.a.echoue.ae1cdf:L'import du relevé a échoué.`);
          return;
        }
        const skipped = res.data.skippedDuplicateCount ?? 0;
        this.toast.add({
          severity: 'success',
          summary: $localize`:@@bank-reconciliation.component.summary.Relevé impor:Relevé importé`,
          detail: skipped > 0
            ? $localize`:@@ui.tern.ph.ligne.s.ph.deja.importee.s.ignoree.s.9ed814:${res.data.lines.length}:p0: ligne(s) — ${skipped}:p1: déjà importée(s) ignorée(s)`
            : $localize`:@@ui.tern.ph.ligne.s.ph.8df2cd:${res.data.lines.length}:p0: ligne(s) — ${res.data.bankName}:p1:`,
          life: 4000
        });
        this.selected.set(res.data);
        this.resetImport();
        this.step.set(2);
        this.runAutoAssociate();
      },
      error: err => {
        this.importing.set(false);
        this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.bank-reconciliation.ts.erreur.reseau.lors.de.l.import.du.releve.60473acb:Erreur réseau lors de l'import du relevé.`));
      }
    });
  }

  /** Anomalies bloquantes d'un relevé d'un fichier qui en contient plusieurs. */
  blockingIssues(statement: BankStatementFilePreviewDto): BankImportIssueDto[] {
    return statement.issues.filter(i => i.isBlocking);
  }

  canImportAll(): boolean {
    const statements = this.preview()?.statements ?? [];
    return statements.length > 1
      && statements.every(s => s.canImport)
      && this.meta.bankName.trim().length > 0
      && this.meta.accountNumber.trim().length > 0;
  }

  /**
   * Plusieurs relevés dans un fichier : import successif (du plus ancien au plus récent) par l'endpoint
   * historique, arrêt au premier échec avec bilan, puis association automatique du premier relevé.
   */
  runImportAll(): void {
    const p = this.preview();
    const statements = p?.statements ?? [];
    if (!p || !this.canImportAll() || this.busy()) return;
    this.error.set(null);
    this.importing.set(true);
    const imported: BankStatementDto[] = [];
    from(statements)
      .pipe(
        concatMap(st => this.importOne(st, p).pipe(map(res => {
          if (!res.success || !res.data) throw new Error(res.error ?? '');
          return res.data;
        }))),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: statement => imported.push(statement),
        error: err => {
          this.importing.set(false);
          const reason = err instanceof HttpErrorResponse
            ? this.errors.extractErrorMessage(err, $localize`:@@accounting.bank-reconciliation.ts.erreur.reseau.lors.de.l.import.du.releve.60473acb:Erreur réseau lors de l'import du relevé.`)
            : (err as Error)?.message || $localize`:@@ui.tern.l.import.du.releve.a.echoue.ae1cdf:L'import du relevé a échoué.`;
          // La liste est rafraîchie d'abord : son chargement efface l'erreur affichée.
          if (imported.length > 0) this.loadStatements();
          this.error.set($localize`:@@accounting.bank-reconciliation.ts.releve.s.importe.s.sur.echec.du.suivant.24963d2a:${imported.length}:imported: relevé(s) importé(s) sur ${statements.length}:total: ; échec du suivant : ${reason}:reason:`);
        },
        complete: () => {
          this.importing.set(false);
          if (imported.length === 0) return;
          this.toast.add({
            severity: 'success',
            summary: $localize`:@@accounting.bank-reconciliation.ts.releves.importes.958c16b7:Relevés importés`,
            detail: $localize`:@@accounting.bank-reconciliation.ts.releve.s.importe.s.ligne.s.62b87b72:${imported.length}:count: relevé(s) importé(s), ${imported.reduce((n, s) => n + s.lines.length, 0)}:lines: ligne(s).`,
            life: 4000
          });
          this.selected.set(imported[0]);
          this.resetImport();
          this.step.set(2);
          this.runAutoAssociate();
        }
      });
  }

  private importOne(st: BankStatementFilePreviewDto, root: BankStatementFilePreviewDto): ReturnType<BankReconciliationService['importStatement']> {
    return this.api.importStatement({
      bankName: this.meta.bankName.trim(),
      accountNumber: this.meta.accountNumber.trim(),
      statementDate: (st.periodEnd ?? '').substring(0, 10),
      periodStart: (st.periodStart ?? '').substring(0, 10),
      periodEnd: (st.periodEnd ?? '').substring(0, 10),
      openingBalance: this.optImportBalances ? Number(st.suggestedOpeningBalance ?? 0) : 0,
      closingBalance: this.optImportBalances ? Number(st.suggestedClosingBalance ?? 0) : 0,
      bankAccountId: this.selectedBankAccountId || st.matchedBankAccountId || root.matchedBankAccountId || null,
      chartOfAccountNumber: this.resolveChartAccountNumber(st),
      sourceFileName: this.lastSourceFileName,
      importMethod: this.lastImportMethod,
      skipAlreadyImported: this.optSkipAlreadyImported,
      lines: st.lines
    });
  }

  /** Échecs de l'aperçu restitués par leur code stable (jamais le texte serveur). */
  private previewErrorMessage(err: unknown): string | null {
    if (!(err instanceof HttpErrorResponse)) return null;
    if (err.status === 504) {
      return $localize`:@@accounting.bank-reconciliation.ts.le.serveur.a.mis.trop.de.temps.a.lire.ce.releve.81baa616:Le serveur a mis trop de temps à lire ce relevé. Préférez un relevé PDF téléchargé depuis votre banque en ligne, ou un export CSV/OFX.`;
    }
    const code = (err.error as { code?: string } | null)?.code;
    switch (code) {
      case 'bank_statement.preview_timeout':
        return $localize`:@@accounting.bank-reconciliation.ts.la.lecture.de.ce.releve.par.l.ia.depasse.le.dela.238cef35:La lecture de ce relevé par l'IA dépasse le délai autorisé. Préférez un relevé PDF téléchargé depuis votre banque en ligne (texte lisible), ou un export CSV/OFX.`;
      case 'bank_statement.ai_unavailable':
        return $localize`:@@accounting.bank-reconciliation.ts.le.moteur.ia.n.a.pas.pu.lire.ce.releve.pour.le.m.c6ea7b62:Le moteur IA n'a pas pu lire ce relevé pour le moment. Réessayez plus tard, ou utilisez un relevé PDF téléchargé depuis votre banque en ligne, ou un export CSV/OFX.`;
      case 'bank_statement.ai_import_required':
        return $localize`:@@accounting.bank-reconciliation.ts.les.releves.pdf.ou.image.s.importent.par.l.analy.f7d9f7d0:Les relevés PDF ou image s'importent par l'analyse IA du relevé : rechargez la page puis choisissez à nouveau le fichier.`;
      default:
        return null;
    }
  }

  private resetImport(): void {
    this.selectedFile.set(null);
    this.preview.set(null);
    this.meta = this.emptyMeta();
    this.lastImportMethod = 0;
    this.lastSourceFileName = null;
  }

  private resolveChartAccountNumber(p: BankStatementFilePreviewDto): string | null {
    if (p.matchedChartOfAccountNumber) return p.matchedChartOfAccountNumber;
    const id = this.selectedBankAccountId || p.matchedBankAccountId;
    if (!id) return null;
    const ba = this.bankAccounts().find(b => b.id === id);
    return ba?.chartOfAccountNumber ?? null;
  }

  private mapImportMethod(extraction: BankStatementExtractionMethod | undefined | null, format: BankStatementFileFormat): number {
    if (extraction === BankStatementExtractionMethod.TextParser) return 3;
    if (extraction === BankStatementExtractionMethod.OcrTextParser) return 4;
    if (extraction === BankStatementExtractionMethod.OcrLlm) return 5;
    if (format === BankStatementFileFormat.Csv) return 1;
    if (format === BankStatementFileFormat.Excel) return 2;
    if (format === BankStatementFileFormat.Pdf) return 3;
    if (format === BankStatementFileFormat.Image) return 6;
    return 0;
  }

  // ── Association automatique ─────────────────────────────────────────────

  runAutoAssociate(): void {
    const s = this.selected();
    if (!s || this.autoAssociating()) return;
    this.autoAssociating.set(true);
    this.error.set(null);
    this.api.autoAssociate(s.id).subscribe({
      next: (res: { success: boolean; data?: AutoAssociationResultDto; error?: string }) => {
        this.autoAssociating.set(false);
        if (!res.success || !res.data) {
          this.error.set(res.error ?? $localize`:@@ui.tern.l.association.automatique.a.echoue.540746:L'association automatique a échoué.`);
          return;
        }
        this.associations.set(res.data.associations);
        this.summary.set(res.data.summary);
        // Pré-cocher toutes les correspondances certaines (« Associé »).
        const preChecked = new Set<string>(
          res.data.associations
            .filter(a => a.status === BankLineAssociationStatus.Associated && a.proposedJournalEntryLineId)
            .map(a => a.bankStatementLineId));
        this.checked.set(preChecked);
      },
      error: err => {
        this.autoAssociating.set(false);
        this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.bank-reconciliation.ts.erreur.reseau.lors.de.l.association.auto.c7f891d3:Erreur réseau lors de l'association automatique.`));
      }
    });
  }

  isChecked(a: BankLineAssociationDto): boolean {
    return this.checked().has(a.bankStatementLineId);
  }

  toggleChecked(a: BankLineAssociationDto): void {
    const next = new Set(this.checked());
    if (next.has(a.bankStatementLineId)) next.delete(a.bankStatementLineId);
    else next.add(a.bankStatementLineId);
    this.checked.set(next);
  }

  applySelectedAssociations(): void {
    const s = this.selected();
    if (!s || this.applying()) return;
    const pairs: ReconcilePairRequest[] = this.associations()
      .filter(a => a.status === BankLineAssociationStatus.Associated
        && a.proposedJournalEntryLineId
        && this.checked().has(a.bankStatementLineId))
      .map(a => ({ bankStatementLineId: a.bankStatementLineId, journalEntryLineId: a.proposedJournalEntryLineId! }));
    if (pairs.length === 0) return;
    this.applying.set(true);
    this.error.set(null);
    this.api.applyAssociations(s.id, pairs).subscribe({
      next: res => {
        this.applying.set(false);
        if (!res.success || !res.data) {
          this.error.set(res.error ?? $localize`:@@ui.tern.le.rapprochement.en.lot.a.echoue.220ccc:Le rapprochement en lot a échoué.`);
          return;
        }
        const r = res.data;
        this.toast.add({
          severity: r.failures.length > 0 ? 'warn' : 'success',
          summary: $localize`:@@accounting.bank-reconciliation.ts.appliedcount.rapprochement.s.applique.s.e28d32b2:${r.appliedCount}:appliedCount: rapprochement(s) appliqué(s)`,
          detail: r.failures.length > 0 ? $localize`:@@ui.tern.ph.echec.s.ba006c:${r.failures.length}:p0: échec(s)` : undefined,
          life: 4000
        });
        this.refreshSelected(() => this.runAutoAssociate());
      },
      error: err => {
        this.applying.set(false);
        this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.bank-reconciliation.ts.erreur.reseau.lors.du.rapprochement.en.l.925121a1:Erreur réseau lors du rapprochement en lot.`));
      }
    });
  }

  /** Depuis l'étape 2 : bascule vers le rapprochement manuel sur une ligne précise. */
  reconcileFromStep(a: BankLineAssociationDto): void {
    const s = this.selected();
    if (!s) return;
    const line = s.lines.find(l => l.id === a.bankStatementLineId);
    this.step.set(3);
    if (line) this.openCandidates(line);
  }

  goToManual(): void {
    this.goStep(3);
  }

  // ── Rapprochement ligne à ligne ────────────────────────────────────────

  openCandidates(line: BankStatementLineDto): void {
    this.activeLine.set(line);
    this.candidates.set([]);
    this.loadingCandidates.set(true);

    const opDate = new Date(line.transactionDate);
    const from = new Date(opDate);
    from.setDate(from.getDate() - 10);
    const to = new Date(opDate);
    to.setDate(to.getDate() + 10);

    this.accounting.searchJournalEntries({
      account: this.reconcileAccountLabel(),
      from: formatLocalDate(from),
      to: formatLocalDate(to),
      minAmount: line.amount,
      maxAmount: line.amount,
      take: 50
    }).subscribe({
      next: res => {
        this.loadingCandidates.set(false);
        if (!res.success || !res.data) {
          this.error.set(res.error ?? $localize`:@@ui.tern.la.recherche.de.candidats.a.echoue.d7b288:La recherche de candidats a échoué.`);
          return;
        }
        // Encaissement (crédit banque relevé) ⇒ débit du compte 53x ; décaissement ⇒ crédit. Brouillons exclus.
        const wantDebit = !line.isDebit;
        this.candidates.set(res.data.filter(c => !c.isDraft && (wantDebit ? c.debit > 0 : c.credit > 0)));
      },
      error: err => {
        this.loadingCandidates.set(false);
        this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.bank-reconciliation.ts.erreur.reseau.lors.de.la.recherche.de.ca.01e56031:Erreur réseau lors de la recherche de candidats.`));
      }
    });
  }

  closeCandidates(): void {
    this.activeLine.set(null);
    this.candidates.set([]);
  }

  reconcile(line: BankStatementLineDto, candidate: JournalSearchRowDto): void {
    if (this.reconciling()) return;
    this.reconciling.set(true);
    this.error.set(null);
    this.api.reconcileLine({ bankStatementLineId: line.id, journalEntryLineId: candidate.lineId }).subscribe({
      next: res => {
        this.reconciling.set(false);
        if (!res.success) {
          this.error.set(res.error ?? $localize`:@@ui.tern.le.rapprochement.a.echoue.0d3e17:Le rapprochement a échoué.`);
          return;
        }
        this.toast.add({ severity: 'success', summary: $localize`:@@bank-reconciliation.component.summary.Ligne_rapproch_e:Ligne rapprochée`, detail: line.description, life: 3000 });
        this.closeCandidates();
        this.refreshSelected();
      },
      error: err => {
        this.reconciling.set(false);
        this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.bank-reconciliation.ts.erreur.reseau.lors.du.rapprochement.ff993f79:Erreur réseau lors du rapprochement.`));
      }
    });
  }

  unreconcile(line: BankStatementLineDto): void {
    if (this.reconciling()) return;
    this.reconciling.set(true);
    this.error.set(null);
    this.api.unreconcileLine(line.id).subscribe({
      next: res => {
        this.reconciling.set(false);
        if (!res.success) {
          this.error.set(res.error ?? $localize`:@@ui.tern.le.de.rapprochement.a.echoue.3fcf60:Le dé-rapprochement a échoué.`);
          return;
        }
        this.toast.add({ severity: 'success', summary: $localize`:@@bank-reconciliation.component.summary.Rapprochement_an:Rapprochement annulé`, detail: line.description, life: 3000 });
        this.refreshSelected();
      },
      error: err => {
        this.reconciling.set(false);
        this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.bank-reconciliation.ts.erreur.reseau.lors.du.de.rapprochement.847704b5:Erreur réseau lors du dé-rapprochement.`));
      }
    });
  }

  // ── Création d'écriture depuis une ligne non rapprochée ─────────────────

  openCreateEntry(lineId: string, description: string, isDebit: boolean, amount: number): void {
    this.createForm = {
      journalCode: this.defaultJournalCode?.trim() || 'BQ',
      counterpartyAccount: this.defaultCounterparty?.trim() || '',
      label: description
    };
    this.createLine.set({ id: lineId, description, isDebit, amount });
  }

  cancelCreateEntry(): void {
    this.createLine.set(null);
  }

  confirmCreateEntry(): void {
    const s = this.selected();
    const cl = this.createLine();
    if (!s || !cl || this.creatingEntry()) return;
    const journal = this.createForm.journalCode.trim();
    const counterparty = this.createForm.counterpartyAccount.trim();
    if (!journal || !counterparty) return;
    this.creatingEntry.set(true);
    this.error.set(null);
    this.api.createEntryForLine(s.id, cl.id, {
      journalCode: journal,
      counterpartyAccount: counterparty,
      label: this.createForm.label?.trim() || null
    }).subscribe({
      next: res => {
        this.creatingEntry.set(false);
        if (!res.success) {
          this.error.set(res.error ?? $localize`:@@ui.tern.la.comptabilisation.de.la.ligne.a.echoue.ed9000:La comptabilisation de la ligne a échoué.`);
          return;
        }
        this.toast.add({ severity: 'success', summary: $localize`:@@bank-reconciliation.component.summary.Écriture com:Écriture comptabilisée`, detail: cl.description, life: 3000 });
        this.cancelCreateEntry();
        this.refreshSelected(() => {
          if (this.step() === 2) this.runAutoAssociate();
        });
      },
      error: err => {
        this.creatingEntry.set(false);
        this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.bank-reconciliation.ts.erreur.reseau.lors.de.la.comptabilisatio.118cf68f:Erreur réseau lors de la comptabilisation.`));
      }
    });
  }
}
