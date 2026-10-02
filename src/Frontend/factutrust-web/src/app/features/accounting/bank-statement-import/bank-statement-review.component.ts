/// <reference types="@angular/localize" />
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { TableModule } from 'primeng/table';
import { Subscription, catchError, of, timer } from 'rxjs';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { ConfirmationService } from '@core/services/confirmation.service';
import { AuthService } from '@core/services/auth.service';
import { EmployeeService } from '@core/services/employee.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { EntryReferenceStore } from '../manual-entry/services/entry-reference.store';
import { ThirdPartyRef } from '../manual-entry/models/entry-form.model';
import { BankStatementImportError, BankStatementImportService } from './bank-statement-import.service';
import { downloadBlob } from '../shared/accounting-download.util';
import {
  BankLineProposal,
  BankStatementImportCapabilities,
  BankStatementImportSession,
  BankStatementImportSibling,
  BankStatementProposals,
  GenerateItem,
  GenerateOutcome,
  SETTLED_STATUSES,
  expectedThirdPartyKind,
  requiresThirdParty,
  thirdPartyKindCode,
  thirdPartyKindName
} from './bank-statement-import.models';
import {
  confidenceLabel,
  generationFailureMessage,
  importErrorMessage,
  issueTitle,
  lineStatusLabel,
  proposalDiagnosticMessage,
  proposalSourceLabel
} from './bank-statement-import.messages';

/** État éditable d'une ligne de proposition (jamais le montant ni la date : ils restent ceux du relevé). */
interface ReviewRow {
  proposal: BankLineProposal;
  selected: boolean;
  account: string;
  thirdPartyId: string | null;
  thirdPartyKind: number;
  thirdPartyName: string;
  splitVat: boolean;
  remember: boolean;
}

type RowFilter = 'all' | 'todo' | 'proposed' | 'settled';

const GENERATION_BATCH = 200;

const SOURCE_EXTENSIONS: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp'
};

/**
 * Relecture d'un relevé bancaire importé : contrôle de l'extraction (soldes, lignes), puis
 * propositions de comptabilisation ligne par ligne et génération des brouillons du journal de banque.
 */
@Component({
  selector: 'app-bank-statement-review',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, TableModule, PageHeaderComponent, ButtonComponent],
  providers: [EntryReferenceStore],
  template: `
    <app-page-header title="Relevé bancaire — comptabilisation assistée" i18n-title="@@accounting.bank-statement-import.releve.bancaire.comptabilisation.assiste.34e1c2fa" [subtitle]="subtitle()" />

    @if (error(); as message) {
      <div class="bsr-alert bsr-alert--error" role="alert">
        <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
        <span>{{ message }}</span>
      </div>
    }

    <!-- ══ Lecture en cours (pages scannées lues par l'IA) ══ -->
    @if (session(); as s) {
      @if (s.status === 'Extracting' || s.status === 'Pending') {
        <div class="card bsr-card bsr-progress" role="status" aria-live="polite">
          <i class="pi pi-spin pi-spinner" aria-hidden="true"></i>
          <div class="bsr-progress__body">
            <p class="bsr-strong" i18n="@@accounting.bank-statement-import.lecture.des.pages.scannees.ebb6ce2d">Lecture des pages scannées… {{ s.progressPercent }} %</p>
            <div class="bsr-bar"><div class="bsr-bar__fill" [style.width.%]="s.progressPercent"></div></div>
            <p class="bsr-muted" i18n="@@accounting.bank-statement-import.une.page.prend.jusqu.a.une.minute.avec.l.fc78a702">Une page prend jusqu'à une minute avec l'IA locale. Vous pouvez quitter cet écran et y revenir.</p>
          </div>
          <app-button variant="secondary" icon="pi-times" iconPos="left" (clicked)="cancelSession()" [disabled]="busy()" ariaLabel="Annuler l'import" i18n-ariaLabel="@@accounting.bank-statement-import.annuler.l.import.8c2b45d2" i18n="@@accounting.bank-statement-import.annuler.49ba3292">Annuler</app-button>
        </div>
      }

      @if (s.status === 'Failed' || s.status === 'Cancelled') {
        <div class="card bsr-card">
          <p class="bsr-strong" i18n="@@accounting.bank-statement-import.l.analyse.de.ce.releve.n.a.pas.abouti.bcff5d65">L'analyse de ce relevé n'a pas abouti.</p>
          <a routerLink="/accounting/manual-entry" class="bsr-link" i18n="@@accounting.bank-statement-import.retour.a.la.saisie.ca4355e9">Retour à la saisie</a>
        </div>
      }

      <!-- ══ Fichier assemblant plusieurs relevés : une session par relevé ══ -->
      @if (s.segmentCount && s.segmentCount > 1) {
        <div class="card bsr-card" role="status">
          <p class="bsr-strong" i18n="@@accounting.bank-statement-import.ce.fichier.contient.releves.chacun.est.c.aaf84d84">Ce fichier contient {{ s.segmentCount }} relevés : chacun est contrôlé et enregistré séparément.</p>
          <ul class="bsr-siblings">
            <li i18n="@@accounting.bank-statement-import.releve.affiche.ci.dessous.a7b05a90">Relevé {{ s.segmentIndex }} — affiché ci-dessous</li>
            @for (sib of s.siblings ?? []; track sib.id) {
              <li i18n="@@accounting.bank-statement-import.releve.1919c83f">
                <a class="bsr-link" [routerLink]="siblingLink(sib)">Relevé {{ sib.segmentIndex }} — {{ sib.periodStart | date: 'MM/yyyy' }}</a>
                <span class="bsr-muted"> · {{ siblingState(sib) }}</span>
              </li>
            }
          </ul>
        </div>
      }

      <!-- ══ Étape 1 : contrôle de l'extraction ══ -->
      @if (s.status === 'AwaitingReview' && s.extraction; as x) {
        <div class="card bsr-card">
          <h2 class="bsr-title" i18n="@@accounting.bank-statement-import.1.controle.du.releve.2c418cb5">1 · Contrôle du relevé</h2>
          <div class="bsr-facts">
            <div i18n="@@accounting.bank-statement-import.fichier.71149cb0"><span class="bsr-muted">Fichier</span><span>{{ s.fileName }}</span></div>
            <div i18n="@@accounting.bank-statement-import.rib.lu.18ae8682"><span class="bsr-muted">RIB lu</span><span>{{ maskRib(x.header.rib) }}</span></div>
            <div i18n="@@accounting.bank-statement-import.periode.bad3ec87"><span class="bsr-muted">Période</span><span>{{ x.header.periodStart | date: 'dd/MM/yyyy' }} → {{ x.header.periodEnd | date: 'dd/MM/yyyy' }}</span></div>
            <div i18n="@@accounting.bank-statement-import.operations.lues.p.e06736ac"><span class="bsr-muted">Opérations lues</span><span>{{ x.lines.length }} ({{ s.pageCount }} p.)</span></div>
            <div i18n="@@accounting.bank-statement-import.methode.1488365d"><span class="bsr-muted">Méthode</span><span>{{ methodLabel(s) }}</span></div>
          </div>

          @if (s.balanceCheck; as b) {
            <div class="bsr-balance" [class.is-ok]="b.isBalanced" [class.is-ko]="!b.isBalanced">
              <i class="pi" [class.pi-check-circle]="b.isBalanced" [class.pi-times-circle]="!b.isBalanced" aria-hidden="true"></i>
              <div>
                <p class="bsr-strong">
                  @if (b.isBalanced) {<ng-container i18n="@@accounting.bank-statement-import.soldes.controles.le.releve.est.complet.e148f4ae"> Soldes contrôlés : le relevé est complet. </ng-container>} @else {<ng-container i18n="@@accounting.bank-statement-import.controle.de.solde.en.echec.le.releve.ne.4c049756"> Contrôle de solde en échec : le relevé ne peut pas être enregistré. </ng-container>}
                </p>
                <p class="bsr-muted bsr-num">
                  {{ x.header.openingBalance?.value | number: '1.3-3' }} + {{ b.sumCredits | number: '1.3-3' }}
                  − {{ b.sumDebits | number: '1.3-3' }} = {{ b.computedClosing | number: '1.3-3' }}
                  / {{ x.header.closingBalance?.value | number: '1.3-3' }}
                </p>
              </div>
            </div>
          }

          @if (x.issues.length > 0) {
            <ul class="bsr-issues">
              @for (issue of x.issues; track $index) {
                <li [class]="'bsr-issue bsr-issue--' + issue.severity.toLowerCase()">
                  <span class="bsr-strong">{{ issueTitle(issue.code) }}</span>
                  <span class="bsr-muted">{{ issue.message }}</span>
                </li>
              }
            </ul>
          }

          <p-table [value]="x.lines" [paginator]="x.lines.length > 50" [rows]="50" styleClass="p-datatable-sm" [tableStyle]="{ 'min-width': '720px' }">
            <ng-template pTemplate="header">
              <tr>
                <th i18n="@@accounting.bank-statement-import.date.eb9a4bc1">Date</th>
                <th i18n="@@accounting.bank-statement-import.valeur.68f92b0d">Valeur</th>
                <th i18n="@@accounting.bank-statement-import.libelle.f5485bba">Libellé</th>
                <th class="bsr-right" i18n="@@accounting.bank-statement-import.debit.f528224f">Débit</th>
                <th class="bsr-right" i18n="@@accounting.bank-statement-import.credit.19194bdf">Crédit</th>
                <th i18n="@@accounting.bank-statement-import.page.fb06270f">Page</th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-line>
              <tr>
                <td>{{ line.transactionDate | date: 'dd/MM/yyyy' }}</td>
                <td>{{ line.valueDate | date: 'dd/MM/yyyy' }}</td>
                <td>
                  @for (part of line.labelLines.length ? line.labelLines : [line.label]; track $index) {
                    <div>{{ part }}</div>
                  }
                  @if (line.source === 'Ai') { <span class="bsr-badge bsr-badge--ai" i18n="@@accounting.bank-statement-import.lu.par.l.ia.e4b06016">Lu par l'IA</span> }
                </td>
                <td class="bsr-right bsr-num">{{ line.isDebit ? (line.amount | number: '1.3-3') : '' }}</td>
                <td class="bsr-right bsr-num">{{ line.isDebit ? '' : (line.amount | number: '1.3-3') }}</td>
                <td>{{ line.pageNumber }}</td>
              </tr>
            </ng-template>
          </p-table>

          <div class="bsr-actions">
            <app-button variant="secondary" (clicked)="cancelSession()" [disabled]="busy()" ariaLabel="Abandonner cet import" i18n-ariaLabel="@@accounting.bank-statement-import.abandonner.cet.import.b2a65847" i18n="@@accounting.bank-statement-import.abandonner.7a0662a3">Abandonner</app-button>
            <app-button variant="primary" icon="pi-check" iconPos="left" (clicked)="confirmStatement()" [disabled]="!s.canConfirm || busy()"
                        ariaLabel="Enregistrer le relevé et passer aux propositions" i18n-ariaLabel="@@accounting.bank-statement-import.enregistrer.le.releve.et.passer.aux.prop.932225f1" i18n="@@accounting.bank-statement-import.enregistrer.le.releve.8d42b4ab">Enregistrer le relevé</app-button>
          </div>
        </div>
      }
    }

    <!-- ══ Relevés du même fichier restant à contrôler ══ -->
    @if (proposals() && pendingSiblings().length > 0) {
      <div class="card bsr-card" role="status">
        <p class="bsr-strong" i18n="@@accounting.bank-statement-import.il.reste.releve.s.de.ce.fichier.a.contro.a982f4ce">Il reste {{ pendingSiblings().length }} relevé(s) de ce fichier à contrôler :</p>
        <ul class="bsr-siblings">
          @for (sib of pendingSiblings(); track sib.id) {
            <li i18n="@@accounting.bank-statement-import.releve.0edb21de"><a class="bsr-link" [routerLink]="siblingLink(sib)">Relevé {{ sib.segmentIndex }} — {{ sib.periodStart | date: 'MM/yyyy' }}</a></li>
          }
        </ul>
      </div>
    }

    <!-- ══ Étape 2 : propositions et génération ══ -->
    @if (proposals(); as p) {
      <div class="card bsr-card">
        <div class="bsr-toolbar">
          <h2 class="bsr-title" i18n="@@accounting.bank-statement-import.2.comptabilisation.5c5a096b">2 · Comptabilisation</h2>
          <div class="bsr-toolbar__actions">
            <label class="bsr-inline" for="bsr-journal" i18n="@@accounting.bank-statement-import.journal.57d7f743">Journal</label>
            <select id="bsr-journal" class="bsr-input bsr-input--narrow" [(ngModel)]="journalCode" [disabled]="busy()">
              @for (j of journalOptions(); track j.code) { <option [ngValue]="j.code">{{ j.code }} — {{ j.label }}</option> }
            </select>
            <app-button variant="secondary" icon="pi-file-pdf" iconPos="left" (clicked)="downloadSource()" [disabled]="busy()"
                        ariaLabel="Télécharger le relevé d'origine" i18n-ariaLabel="@@accounting.bank-statement-import.telecharger.le.releve.d.origine.7a60a19c"
                        i18n="@@accounting.bank-statement-import.piece.justificative.d81c4617">Pièce justificative</app-button>
            @if (p.unclassifiedDistinctLabels > 0 && capabilities()?.aiAvailable) {
              <app-button variant="secondary" icon="pi-sparkles" iconPos="left" (clicked)="classifyWithAi()" [disabled]="busy()"
                          ariaLabel="Classer par l'IA les libellés non reconnus" i18n-ariaLabel="@@accounting.bank-statement-import.classer.par.l.ia.les.libelles.non.reconn.50ae67f0" i18n="@@accounting.bank-statement-import.classer.par.l.ia.9665f0d2">Classer par l'IA ({{ p.unclassifiedDistinctLabels }})</app-button>
            }
          </div>
        </div>

        <div class="bsr-chips" role="group" aria-label="Filtrer les lignes" i18n-aria-label="@@accounting.bank-statement-import.filtrer.les.lignes.ba7ccf6b">
          <button type="button" class="bsr-chip" [class.is-active]="filter() === 'all'" (click)="filter.set('all')" i18n="@@accounting.bank-statement-import.toutes.a97a8888">Toutes ({{ rows().length }})</button>
          <button type="button" class="bsr-chip" [class.is-active]="filter() === 'todo'" (click)="filter.set('todo')" i18n="@@accounting.bank-statement-import.a.completer.e4d277ce">À compléter ({{ counts().todo }})</button>
          <button type="button" class="bsr-chip" [class.is-active]="filter() === 'proposed'" (click)="filter.set('proposed')" i18n="@@accounting.bank-statement-import.proposees.fe9ab7c2">Proposées ({{ counts().proposed }})</button>
          <button type="button" class="bsr-chip" [class.is-active]="filter() === 'settled'" (click)="filter.set('settled')" i18n="@@accounting.bank-statement-import.deja.traitees.1b0627dc">Déjà traitées ({{ counts().settled }})</button>
        </div>

        <datalist id="bsr-accounts">
          @for (a of accountOptions(); track a.accountNumber) { <option [value]="a.accountNumber">{{ a.accountNumber }} — {{ a.label }}</option> }
        </datalist>

        <p-table [value]="visibleRows()" [paginator]="visibleRows().length > 50" [rows]="50" styleClass="p-datatable-sm" [tableStyle]="{ 'min-width': '1100px' }" dataKey="proposal.lineId">
          <ng-template pTemplate="header">
            <tr>
              <th class="bsr-check">
                <input type="checkbox" [checked]="allVisibleSelected()" (change)="toggleAll($any($event.target).checked)" aria-label="Tout sélectionner" i18n-aria-label="@@accounting.bank-statement-import.tout.selectionner.a288cf23" />
              </th>
              <th i18n="@@accounting.bank-statement-import.date.eb9a4bc1">Date</th>
              <th i18n="@@accounting.bank-statement-import.libelle.f5485bba">Libellé</th>
              <th class="bsr-right" i18n="@@accounting.bank-statement-import.montant.4adcd9fc">Montant</th>
              <th i18n="@@accounting.bank-statement-import.statut.659499f3">Statut</th>
              <th i18n="@@accounting.bank-statement-import.compte.c45740bb">Compte</th>
              <th i18n="@@accounting.bank-statement-import.tiers.435080ba">Tiers</th>
              <th>TVA</th>
              <th i18n="@@accounting.bank-statement-import.memoriser.72c86d0e">Mémoriser</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-row>
            <tr [class.bsr-row--settled]="isSettled(row)">
              <td class="bsr-check">
                <input type="checkbox" [(ngModel)]="row.selected" [disabled]="isSettled(row) || row.proposal.status === 'Blocked'" aria-label="Générer l'écriture de cette ligne" i18n-aria-label="@@accounting.bank-statement-import.generer.l.ecriture.de.cette.ligne.4c65c1aa" />
              </td>
              <td>{{ row.proposal.transactionDate | date: 'dd/MM/yyyy' }}</td>
              <td class="bsr-label">
                <div>{{ row.proposal.label }}</div>
                @if (sourceLabel(row.proposal.source); as origin) {
                  <div class="bsr-muted bsr-small" [attr.title]="row.proposal.explanation || null">{{ origin }}</div>
                }
                @for (d of row.proposal.diagnostics; track $index) {
                  <div class="bsr-small" [class.bsr-danger]="d.severity === 'blocking'" [class.bsr-warn]="d.severity !== 'blocking'">{{ diagnosticText(d.code, row.proposal.accountNumber) }}</div>
                }
              </td>
              <td class="bsr-right bsr-num" [class.bsr-debit]="row.proposal.isDebit" [class.bsr-credit]="!row.proposal.isDebit">
                {{ row.proposal.isDebit ? '−' : '+' }}{{ row.proposal.amount | number: '1.3-3' }}
              </td>
              <td>
                <span [class]="'bsr-badge bsr-badge--' + row.proposal.status.toLowerCase()">{{ statusLabel(row.proposal.status) }}</span>
                @if (row.proposal.confidence) { <div class="bsr-small bsr-muted">{{ confidenceText(row.proposal.confidence) }}</div> }
                @if (row.proposal.generatedEntry || row.proposal.existingEntry; as entry) {
                  <div class="bsr-small">{{ entry.reference }}</div>
                }
              </td>
              <td>
                @if (!isSettled(row)) {
                  <input class="bsr-input bsr-input--account" list="bsr-accounts" [(ngModel)]="row.account" (ngModelChange)="onAccountChanged(row)"
                         [disabled]="row.proposal.status === 'Blocked'" aria-label="Compte de contrepartie" i18n-aria-label="@@accounting.bank-statement-import.compte.de.contrepartie.ab1b7a65" />
                  @if (accountLabel(row.account); as label) { <div class="bsr-small bsr-muted">{{ label }}</div> }
                }
              </td>
              <td class="bsr-tp">
                @if (!isSettled(row) && needsThirdParty(row)) {
                  <input class="bsr-input" [ngModel]="row.thirdPartyName" (ngModelChange)="searchThirdParty(row, $event)"
                         (focus)="activeRow.set(row)" placeholder="Rechercher un tiers" i18n-placeholder="@@accounting.bank-statement-import.rechercher.un.tiers.c3eb7a26" aria-label="Tiers" i18n-aria-label="@@accounting.bank-statement-import.tiers.d886c86c" />
                  @if (activeRow() === row && thirdPartySuggestions(row).length > 0) {
                    <ul class="bsr-suggestions" role="listbox">
                      @for (tp of thirdPartySuggestions(row); track tp.id) {
                        <li><button type="button" class="bsr-suggestion" (click)="pickThirdParty(row, tp)">{{ tp.display }}</button></li>
                      }
                    </ul>
                  }
                } @else if (row.thirdPartyName) {
                  <span>{{ row.thirdPartyName }}</span>
                }
              </td>
              <td>
                @if (row.proposal.vatSplit; as vat) {
                  <label class="bsr-inline bsr-small">
                    <input type="checkbox" [(ngModel)]="row.splitVat" [disabled]="isSettled(row)" />
                    {{ vat.netAmount | number: '1.3-3' }} + {{ vat.vatAmount | number: '1.3-3' }}
                  </label>
                }
              </td>
              <td class="bsr-check">
                @if (!isSettled(row)) {
                  <input type="checkbox" [(ngModel)]="row.remember" aria-label="Mémoriser cette affectation pour les prochains relevés" i18n-aria-label="@@accounting.bank-statement-import.memoriser.cette.affectation.pour.les.pro.aec758ff" />
                }
              </td>
            </tr>
          </ng-template>
        </p-table>

        <div class="bsr-actions">
          <span class="bsr-muted" i18n="@@accounting.bank-statement-import.ecriture.s.a.generer.en.brouillard.9f575194">{{ selectedCount() }} écriture(s) à générer, en brouillard.</span>
          <app-button variant="primary" icon="pi-bolt" iconPos="left" (clicked)="generate()" [disabled]="selectedCount() === 0 || busy()"
                      ariaLabel="Générer les écritures en brouillard" i18n-ariaLabel="@@accounting.bank-statement-import.generer.les.ecritures.en.brouillard.4135ddf9" i18n="@@accounting.bank-statement-import.generer.les.ecritures.f829d762">Générer les écritures</app-button>
        </div>

        @if (lastGeneration(); as g) {
          <div class="bsr-result" role="status">
            <p class="bsr-strong" i18n="@@accounting.bank-statement-import.ecriture.s.creee.s.en.brouillard.deja.co.0bb4142c">{{ g.created }} écriture(s) créée(s) en brouillard, {{ g.skipped }} déjà comptabilisée(s), {{ g.failed }} en échec.</p>
            @if (g.failures.length > 0) {
              <ul class="bsr-issues">
                @for (f of g.failures; track f.lineId) { <li class="bsr-issue bsr-issue--warning">{{ failureLabel(f) }}</li> }
              </ul>
            }
            <div class="bsr-links" i18n="@@accounting.bank-statement-import.ecritures.en.brouillard.rapprochement.ba.743b60b0">
              <a routerLink="/accounting/draft-batch" class="bsr-link">Écritures en brouillard</a>
              <a routerLink="/accounting/bank-reconciliation" class="bsr-link">Rapprochement bancaire</a>
            </div>
          </div>
        }
      </div>
    }
  `,
  styles: `
    .bsr-card { padding:var(--spacing-4); margin-block-end:var(--spacing-4); display:flex; flex-direction:column; gap:var(--spacing-3); }
    .bsr-title { margin:0; font-size:var(--font-size-lg); font-weight:600; }
    .bsr-strong { margin:0; font-weight:600; }
    .bsr-muted { color:var(--color-text-secondary); }
    .bsr-small { font-size:var(--font-size-xs); }
    .bsr-num { font-variant-numeric:tabular-nums; }
    .bsr-right { text-align:end; }
    .bsr-warn { color:var(--color-warning); }
    .bsr-danger { color:var(--color-danger); }
    .bsr-debit { color:var(--color-danger); }
    .bsr-credit { color:var(--color-success); }
    .bsr-alert { display:flex; gap:var(--spacing-2); align-items:center; padding:var(--spacing-3); border-radius:var(--radius-md); margin-block-end:var(--spacing-3); }
    .bsr-alert--error { background:var(--color-danger-subtle, transparent); color:var(--color-danger); border:1px solid var(--color-danger); }
    .bsr-progress { flex-direction:row; align-items:center; }
    .bsr-progress__body { flex:1; display:flex; flex-direction:column; gap:var(--spacing-2); }
    .bsr-bar { height:6px; background:var(--color-border-subtle); border-radius:3px; overflow:hidden; }
    .bsr-bar__fill { height:100%; background:var(--color-primary); transition:width .3s; }
    .bsr-facts { display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:var(--spacing-2); }
    .bsr-facts > div { display:flex; flex-direction:column; gap:2px; }
    .bsr-balance { display:flex; gap:var(--spacing-3); align-items:flex-start; padding:var(--spacing-3); border-radius:var(--radius-md); border:1px solid var(--color-border-default); }
    .bsr-balance .pi { font-size:1.5rem; }
    .bsr-balance.is-ok { border-color:var(--color-success); }
    .bsr-balance.is-ok .pi { color:var(--color-success); }
    .bsr-balance.is-ko { border-color:var(--color-danger); }
    .bsr-balance.is-ko .pi { color:var(--color-danger); }
    .bsr-balance p { margin:0; }
    .bsr-issues { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:var(--spacing-1); }
    .bsr-issue { display:flex; flex-direction:column; padding:var(--spacing-2); border-inline-start:3px solid var(--color-border-default); }
    .bsr-issue--blocking { border-inline-start-color:var(--color-danger); }
    .bsr-issue--warning { border-inline-start-color:var(--color-warning); }
    .bsr-issue--info { border-inline-start-color:var(--color-primary); }
    .bsr-actions { display:flex; justify-content:flex-end; align-items:center; gap:var(--spacing-3); flex-wrap:wrap; }
    .bsr-toolbar { display:flex; justify-content:space-between; align-items:center; gap:var(--spacing-3); flex-wrap:wrap; }
    .bsr-toolbar__actions { display:flex; align-items:center; gap:var(--spacing-2); flex-wrap:wrap; }
    .bsr-inline { display:inline-flex; align-items:center; gap:var(--spacing-1); }
    .bsr-input { padding:var(--spacing-1) var(--spacing-2); border:1px solid var(--color-border-default); border-radius:var(--radius-sm); background:var(--color-background-elevated); min-width:0; }
    .bsr-input--narrow { width:auto; }
    .bsr-input--account { width:9rem; }
    .bsr-chips { display:flex; gap:var(--spacing-2); flex-wrap:wrap; }
    .bsr-chip { border:1px solid var(--color-border-default); background:transparent; border-radius:999px; padding:var(--spacing-1) var(--spacing-3); cursor:pointer; font-size:var(--font-size-sm); }
    .bsr-chip.is-active { border-color:var(--color-primary); color:var(--color-primary); font-weight:600; }
    .bsr-check { width:2.5rem; text-align:center; }
    .bsr-label { max-width:28rem; }
    .bsr-tp { position:relative; min-width:12rem; }
    .bsr-suggestions { position:absolute; z-index:20; inset-inline-start:0; inset-block-start:100%; list-style:none; margin:0; padding:var(--spacing-1); background:var(--color-background-elevated); border:1px solid var(--color-border-default); border-radius:var(--radius-sm); box-shadow:var(--shadow-md); min-width:16rem; }
    .bsr-suggestion { display:block; width:100%; text-align:start; border:none; background:transparent; padding:var(--spacing-1) var(--spacing-2); cursor:pointer; }
    .bsr-suggestion:hover { background:var(--color-background-hover); }
    .bsr-row--settled td { opacity:.65; }
    .bsr-badge { display:inline-block; padding:1px var(--spacing-2); border-radius:999px; font-size:var(--font-size-xs); border:1px solid var(--color-border-default); }
    .bsr-badge--proposed { border-color:var(--color-primary); color:var(--color-primary); }
    .bsr-badge--tocomplete, .bsr-badge--ambiguous { border-color:var(--color-warning); color:var(--color-warning); }
    .bsr-badge--blocked { border-color:var(--color-danger); color:var(--color-danger); }
    .bsr-badge--generated, .bsr-badge--reconciled, .bsr-badge--alreadyposted, .bsr-badge--alreadyimported { border-color:var(--color-success); color:var(--color-success); }
    .bsr-badge--ai { margin-block-start:var(--spacing-1); border-color:var(--color-warning); color:var(--color-warning); }
    .bsr-result { border-top:1px solid var(--color-border-subtle); padding-block-start:var(--spacing-3); display:flex; flex-direction:column; gap:var(--spacing-2); }
    .bsr-links { display:flex; gap:var(--spacing-3); flex-wrap:wrap; }
    .bsr-link { color:var(--color-primary); }
    .bsr-siblings { margin:0; padding-inline-start:var(--spacing-4); display:flex; flex-direction:column; gap:var(--spacing-1); }
  `
})
export class BankStatementReviewComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(BankStatementImportService);
  private readonly refs = inject(EntryReferenceStore);
  private readonly confirmation = inject(ConfirmationService);
  private readonly auth = inject(AuthService);
  private readonly employees = inject(EmployeeService);
  private readonly destroyRef = inject(DestroyRef);

  /** Salariés (compte 425) : recherchés seulement avec `payroll:read`, sinon l'API répondrait 403. */
  private readonly employeeSuggestions = signal<ThirdPartyRef[]>([]);
  private employeeSearch?: Subscription;

  readonly session = signal<BankStatementImportSession | null>(null);
  readonly proposals = signal<BankStatementProposals | null>(null);
  readonly rows = signal<ReviewRow[]>([]);
  readonly capabilities = signal<BankStatementImportCapabilities | null>(null);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly filter = signal<RowFilter>('all');
  readonly activeRow = signal<ReviewRow | null>(null);
  /** Relevés frères (même fichier) encore à contrôler, transmis lors de la navigation après confirmation. */
  readonly pendingSiblings = signal<BankStatementImportSibling[]>([]);
  readonly lastGeneration = signal<{ created: number; skipped: number; failed: number; failures: GenerateOutcome[] } | null>(null);

  journalCode = 'JB';
  private polling?: Subscription;
  private pollAttempt = 0;

  readonly subtitle = computed(() => {
    const p = this.proposals();
    if (p) return `${p.bankName} — ${p.bankGlAccount ?? ''}`;
    return this.session()?.fileName ?? '';
  });

  readonly accountOptions = computed(() => this.refs.accounts().filter(a => a.isActive));

  readonly journalOptions = computed(() => {
    const options = this.refs.journalOptions().filter(j => !['JV', 'JA', 'JC', 'JOD', 'JIM', 'JAN'].includes(j.code) || j.code === 'JB');
    return options.length > 0 ? options : [{ code: 'JB', label: $localize`:@@accounting.bank-statement-import.ts.journal.de.banque.b0b1e524:Journal de Banque` }];
  });

  readonly counts = computed(() => {
    const all = this.rows();
    return {
      todo: all.filter(r => r.proposal.status === 'ToComplete' || r.proposal.status === 'Ambiguous').length,
      proposed: all.filter(r => r.proposal.status === 'Proposed').length,
      settled: all.filter(r => this.isSettled(r)).length
    };
  });

  readonly visibleRows = computed(() => {
    const all = this.rows();
    switch (this.filter()) {
      case 'todo':
        return all.filter(r => r.proposal.status === 'ToComplete' || r.proposal.status === 'Ambiguous' || r.proposal.status === 'Blocked');
      case 'proposed':
        return all.filter(r => r.proposal.status === 'Proposed');
      case 'settled':
        return all.filter(r => this.isSettled(r));
      default:
        return all;
    }
  });

  readonly selectedCount = computed(() => this.rows().filter(r => r.selected && !this.isSettled(r)).length);

  ngOnInit(): void {
    this.refs.loadAll();
    this.api.capabilities().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(caps => this.capabilities.set(caps));
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const sessionId = params.get('sessionId');
      const statementId = params.get('statementId');
      if (sessionId) this.loadSession(sessionId);
      else if (statementId) this.loadProposals(statementId);
    });
    this.destroyRef.onDestroy(() => this.polling?.unsubscribe());
  }

  // ── Session ─────────────────────────────────────────────────────────────────────────────

  private loadSession(id: string): void {
    this.api.session(id).subscribe({
      next: s => {
        this.session.set(s);
        if (s.status === 'Confirmed' && s.statementId) {
          void this.router.navigate(['/accounting/bank-statement-import/statement', s.statementId], { replaceUrl: true });
          return;
        }
        if (s.status === 'Extracting' || s.status === 'Pending') this.schedulePoll(id);
        else this.pollAttempt = 0;
        this.journalCode = s.journalCode || 'JB';
      },
      error: (err: unknown) => this.fail(err)
    });
  }

  /** Interrogation avec temporisation croissante (2 s → 10 s). */
  private schedulePoll(id: string): void {
    this.polling?.unsubscribe();
    const delay = Math.min(10_000, 2_000 + this.pollAttempt++ * 1_000);
    this.polling = timer(delay).subscribe(() => this.loadSession(id));
  }

  cancelSession(): void {
    const s = this.session();
    if (!s) return;
    this.busy.set(true);
    this.api.cancel(s.id).subscribe({
      next: () => {
        this.busy.set(false);
        void this.router.navigate(['/accounting/manual-entry']);
      },
      error: (err: unknown) => this.fail(err)
    });
  }

  confirmStatement(): void {
    const s = this.session();
    if (!s?.canConfirm) return;
    this.busy.set(true);
    this.error.set(null);
    this.api.confirm(s.id).subscribe({
      next: result => {
        this.busy.set(false);
        const pendingSiblings = (s.siblings ?? []).filter(x => !x.statementId);
        void this.router.navigate(['/accounting/bank-statement-import/statement', result.statementId], {
          replaceUrl: true,
          state: { pendingSiblings }
        });
      },
      error: (err: unknown) => this.fail(err)
    });
  }

  // ── Propositions ────────────────────────────────────────────────────────────────────────

  private loadProposals(statementId: string): void {
    this.session.set(null);
    const state = (typeof history !== 'undefined' ? history.state : null) as { pendingSiblings?: BankStatementImportSibling[] } | null;
    if (Array.isArray(state?.pendingSiblings)) this.pendingSiblings.set(state.pendingSiblings);
    this.api.proposals(statementId).subscribe({
      next: p => {
        this.proposals.set(p);
        this.rows.set(p.lines.map(line => this.toRow(line)));
      },
      error: (err: unknown) => this.fail(err)
    });
  }

  private toRow(proposal: BankLineProposal): ReviewRow {
    return {
      proposal,
      selected: proposal.selectedByDefault,
      account: proposal.accountNumber ?? '',
      thirdPartyId: proposal.thirdPartyId,
      thirdPartyKind: thirdPartyKindCode(proposal.thirdPartyKind),
      thirdPartyName: proposal.thirdPartyName ?? '',
      splitVat: !!proposal.vatSplit && !proposal.vatSplit.implied,
      remember: false
    };
  }

  isSettled(row: ReviewRow): boolean {
    return SETTLED_STATUSES.includes(row.proposal.status);
  }

  needsThirdParty(row: ReviewRow): boolean {
    return requiresThirdParty(row.account);
  }

  allVisibleSelected(): boolean {
    const selectable = this.visibleRows().filter(r => !this.isSettled(r) && r.proposal.status !== 'Blocked');
    return selectable.length > 0 && selectable.every(r => r.selected);
  }

  toggleAll(checked: boolean): void {
    for (const row of this.visibleRows()) {
      if (!this.isSettled(row) && row.proposal.status !== 'Blocked') row.selected = checked;
    }
    this.rows.set([...this.rows()]);
  }

  onAccountChanged(row: ReviewRow): void {
    // Un tiers d'un autre type que celui attendu par le nouveau compte est retiré.
    const expected = expectedThirdPartyKind(row.account);
    if (row.thirdPartyId && expected !== 0 && expected !== row.thirdPartyKind) {
      row.thirdPartyId = null;
      row.thirdPartyKind = 0;
      row.thirdPartyName = '';
    }
    this.rows.set([...this.rows()]);
  }

  accountLabel(account: string): string | null {
    if (!account) return null;
    return this.refs.findAccountByNumber(account)?.label ?? $localize`:@@accounting.bank-statement-import.ts.compte.inconnu.du.plan.a0abf82a:Compte inconnu du plan`;
  }

  searchThirdParty(row: ReviewRow, term: string): void {
    row.thirdPartyName = term;
    row.thirdPartyId = null;
    row.thirdPartyKind = 0;
    this.activeRow.set(row);
    if (expectedThirdPartyKind(row.account) === 3) this.searchEmployees(term);
    else this.refs.searchThirdParties(term);
  }

  thirdPartySuggestions(row: ReviewRow): ThirdPartyRef[] {
    const expected = expectedThirdPartyKind(row.account);
    if (expected === 3) return this.employeeSuggestions();
    return this.refs.thirdPartySuggestions().filter(tp => expected === 0 || tp.kind === expected);
  }

  private searchEmployees(term: string): void {
    const search = term.trim();
    this.employeeSearch?.unsubscribe();
    if (search.length < 2 || !this.auth.hasPermission(PERMISSIONS.payroll.read)) {
      this.employeeSuggestions.set([]);
      return;
    }
    this.employeeSearch = this.employees
      .list(search, true, 1, 10)
      .pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe(res =>
        this.employeeSuggestions.set(
          (res?.data?.items ?? []).map(e => ({
            id: e.id,
            kind: 3,
            name: e.fullName,
            display: $localize`:@@accounting.bank-statement-import.ts.salarie.99331550:Salarié — ${e.fullName}:name: (${e.employeeNumber}:number:)`
          }))
        )
      );
  }

  pickThirdParty(row: ReviewRow, tp: ThirdPartyRef): void {
    row.thirdPartyId = tp.id;
    row.thirdPartyKind = tp.kind;
    row.thirdPartyName = tp.name;
    this.activeRow.set(null);
    this.rows.set([...this.rows()]);
  }

  classifyWithAi(): void {
    const p = this.proposals();
    if (!p) return;
    this.busy.set(true);
    this.error.set(null);
    this.api.classifyWithAi(p.statementId).subscribe({
      next: () => {
        this.busy.set(false);
        this.loadProposals(p.statementId);
      },
      error: (err: unknown) => this.fail(err)
    });
  }

  downloadSource(): void {
    const p = this.proposals();
    if (!p) return;
    this.error.set(null);
    this.api.sourceFile(p.statementId).subscribe({
      next: blob => downloadBlob(blob, `${this.sourceFileStem(p)}${SOURCE_EXTENSIONS[blob.type] ?? ''}`),
      error: (err: unknown) =>
        this.error.set(
          err instanceof BankStatementImportError && err.status === 404
            ? $localize`:@@accounting.bank-statement-import.ts.aucune.piece.justificative.pour.ce.releve.il.n.a.3c22e363:Aucune pièce justificative pour ce relevé : il n'a pas été importé par l'import IA.`
            : importErrorMessage(null)
        )
    });
  }

  /** Nom de fichier construit côté client (l'en-tête Content-Disposition n'est pas exposé en CORS). */
  private sourceFileStem(p: BankStatementProposals): string {
    const bank = (p.bankName || 'banque').replace(/[^A-Za-z0-9_-]+/g, '_');
    return `releve_${bank}_${(p.periodStart || '').slice(0, 10)}`;
  }

  // ── Génération ──────────────────────────────────────────────────────────────────────────

  generate(): void {
    const p = this.proposals();
    if (!p) return;
    const selected = this.rows().filter(r => r.selected && !this.isSettled(r));
    const invalid = selected.filter(r => !this.isReady(r));
    if (invalid.length > 0) {
      this.error.set($localize`:@@accounting.bank-statement-import.ts.ligne.s.selectionnee.s.sans.compte.valide.ou.san.52f0b12e:${invalid.length}:count: ligne(s) sélectionnée(s) sans compte valide ou sans tiers : complétez-les ou désélectionnez-les.`);
      return;
    }

    this.confirmation.confirm({
      header: $localize`:@@accounting.bank-statement-import.ts.generer.les.ecritures.f829d762:Générer les écritures`,
      message: $localize`:@@accounting.bank-statement-import.ts.ecriture.s.seront.creees.en.brouillard.dans.le.j.65bcac9a:${selected.length}:count: écriture(s) seront créées en brouillard dans le journal ${this.journalCode}:journal:, une par ligne de relevé. Elles devront être validées ensuite.`,
      acceptLabel: $localize`:@@accounting.bank-statement-import.ts.generer.bd221c07:Générer`,
      rejectLabel: $localize`:@@accounting.bank-statement-import.ts.annuler.49ba3292:Annuler`,
      accept: () => this.runGeneration(p.statementId, selected)
    });
  }

  private isReady(row: ReviewRow): boolean {
    const account = row.account?.trim();
    if (!account || !this.refs.findAccountByNumber(account)?.isActive) return false;
    if (!requiresThirdParty(account)) return true;
    return !!row.thirdPartyId && row.thirdPartyKind === expectedThirdPartyKind(account);
  }

  private runGeneration(statementId: string, rows: ReviewRow[]): void {
    const items: GenerateItem[] = rows.map(r => ({
      lineId: r.proposal.lineId,
      accountNumber: r.account.trim(),
      thirdPartyId: requiresThirdParty(r.account) ? r.thirdPartyId : null,
      thirdPartyKind: thirdPartyKindName(requiresThirdParty(r.account) ? r.thirdPartyKind : 0),
      vatAmount: r.splitVat && r.proposal.vatSplit && r.proposal.isDebit ? r.proposal.vatSplit.vatAmount : null,
      vatAccountNumber: r.splitVat && r.proposal.vatSplit ? r.proposal.vatSplit.vatAccountNumber : null,
      label: null,
      rememberRule: r.remember
    }));

    const total = { created: 0, skipped: 0, failed: 0, failures: [] as GenerateOutcome[] };
    const batches: GenerateItem[][] = [];
    for (let i = 0; i < items.length; i += GENERATION_BATCH) batches.push(items.slice(i, i + GENERATION_BATCH));

    this.busy.set(true);
    this.error.set(null);
    const next = (index: number): void => {
      if (index >= batches.length) {
        this.busy.set(false);
        this.lastGeneration.set(total);
        this.loadProposals(statementId);
        return;
      }
      this.api.generate(statementId, this.journalCode, batches[index]).subscribe({
        next: result => {
          total.created += result.created;
          total.skipped += result.skipped;
          total.failed += result.failed;
          total.failures.push(...result.outcomes.filter(o => o.outcome === 'failed'));
          next(index + 1);
        },
        error: (err: unknown) => {
          this.lastGeneration.set(total);
          this.fail(err);
          this.loadProposals(statementId);
        }
      });
    };
    next(0);
  }

  failureLabel(outcome: GenerateOutcome): string {
    const row = this.rows().find(r => r.proposal.lineId === outcome.lineId);
    const label = row ? row.proposal.label : '';
    return `${label} — ${generationFailureMessage(outcome.code)}`;
  }

  // ── Affichage ───────────────────────────────────────────────────────────────────────────

  readonly statusLabel = lineStatusLabel;
  readonly confidenceText = confidenceLabel;
  readonly issueTitle = issueTitle;
  readonly sourceLabel = proposalSourceLabel;
  readonly diagnosticText = proposalDiagnosticMessage;

  siblingLink(sib: BankStatementImportSibling): string[] {
    return sib.statementId
      ? ['/accounting/bank-statement-import/statement', sib.statementId]
      : ['/accounting/bank-statement-import/session', sib.id];
  }

  siblingState(sib: BankStatementImportSibling): string {
    if (sib.statementId) return $localize`:@@accounting.bank-statement-import.ts.enregistre.c68fb2eb:enregistré`;
    switch (sib.status) {
      case 'AwaitingReview':
        return $localize`:@@accounting.bank-statement-import.ts.a.controler.c2ced249:à contrôler`;
      case 'Extracting':
      case 'Pending':
        return $localize`:@@accounting.bank-statement-import.ts.lecture.en.cours.01347730:lecture en cours`;
      default:
        return $localize`:@@accounting.bank-statement-import.ts.indisponible.1ad054af:indisponible`;
    }
  }

  maskRib(rib: string | null): string {
    return rib ? `${rib.slice(0, 2)} … ${rib.slice(-4)}` : '—';
  }

  methodLabel(s: BankStatementImportSession): string {
    switch (s.extractionMethod) {
      case 'layout':
        return $localize`:@@accounting.bank-statement-import.ts.lecture.directe.du.pdf.aucune.ia.ba300454:Lecture directe du PDF (aucune IA)`;
      case 'layout+ai':
        return s.aiProviderKind === 'external'
          ? $localize`:@@accounting.bank-statement-import.ts.lecture.directe.pages.scannees.lues.par.une.ia.e.1e33d5e5:Lecture directe + pages scannées lues par une IA externe`
          : $localize`:@@accounting.bank-statement-import.ts.lecture.directe.pages.scannees.lues.par.l.ia.loc.9d423ab4:Lecture directe + pages scannées lues par l'IA locale`;
      case 'ai':
        return s.aiProviderKind === 'external'
          ? $localize`:@@accounting.bank-statement-import.ts.lu.par.une.ia.externe.ba81ec2a:Lu par une IA externe`
          : $localize`:@@accounting.bank-statement-import.ts.lu.par.l.ia.locale.04535067:Lu par l'IA locale`;
      default:
        return '—';
    }
  }

  private fail(err: unknown): void {
    this.busy.set(false);
    if (err instanceof BankStatementImportError && err.status === 403) {
      this.error.set($localize`:@@accounting.bank-statement-import.ts.acces.refuse.vos.droits.ont.peut.etre.change.rec.68412fb2:Accès refusé : vos droits ont peut-être changé, reconnectez-vous.`);
      return;
    }
    this.error.set(importErrorMessage(err instanceof BankStatementImportError ? err.code : null));
  }
}
