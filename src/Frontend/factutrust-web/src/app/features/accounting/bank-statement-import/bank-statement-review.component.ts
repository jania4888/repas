/// <reference types="@angular/localize" />
import { Component, DestroyRef, LOCALE_ID, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule, formatNumber } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { Table, TableModule } from 'primeng/table';
import { Subscription, catchError, of, timer } from 'rxjs';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { ConfirmationService } from '@core/services/confirmation.service';
import { AuthService } from '@core/services/auth.service';
import { BankAccountDto, BankAccountService } from '@core/services/bank-account.service';
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
  ConfirmBankStatementImportRequest,
  ConfirmResult,
  ExtractedStatementLine,
  GenerateItem,
  GenerateOutcome,
  IssueSeverity,
  SETTLED_STATUSES,
  StatementAmount,
  StatementLineCorrection,
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
  proposalSourceLabel,
  sessionFailureMessage
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

/** Ligne du relevé telle qu'affichée : valeurs lues, recouvertes par la correction locale éventuelle. */
interface DisplayLine extends ExtractedStatementLine {
  /** Au moins un champ corrigé localement (pas encore envoyé au serveur). */
  corrected: boolean;
  /** Exclue localement de l'enregistrement. */
  excluded: boolean;
  /** Page relue par le modèle texte (repli D2) : à vérifier avec plus d'attention. */
  fallbackPage: boolean;
}

/** Brouillon d'édition d'une ligne (chaînes telles que saisies ; validé avant d'être transformé en correction). */
interface LineDraft {
  lineIndex: number;
  transactionDate: string;
  label: string;
  amount: number | null;
  isDebit: boolean;
}

type PageState = 'done' | 'fallback' | 'failed' | 'current' | 'todo';

/** Codes d'échec d'une session `Failed` pour lesquels une relance complète a un sens. */
const RETRYABLE_FAILURES = ['ai_unavailable', 'ai_timeout', 'ai_failed'];

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

    <!-- ══ Lecture en cours (pages lues par l'IA) ══ -->
    @if (session(); as s) {
      @if (s.status === 'Extracting' || s.status === 'Pending') {
        <div class="card bsr-card bsr-progress">
          <div class="bsr-progress__top">
            <div class="bsr-progress__header">
              <i class="pi pi-spin pi-spinner bsr-progress__spinner" aria-hidden="true"></i>
              <div class="bsr-progress__head-copy">
                @if (viaDocStrange(s)) {
                  <p class="bsr-strong bsr-progress__status" aria-live="polite" i18n="@@accounting.bank-statement-import.lecture.des.pages.par.le.service.d.extraction.do.9953b468">Lecture des pages par le service d'extraction documentaire… page {{ currentPage(s) }} sur {{ totalPages(s) }} — {{ displayPercent(s) }} %</p>
                } @else if (s.extraction?.aiPlan?.engine === 'vision') {
                  <p class="bsr-strong bsr-progress__status" aria-live="polite" i18n="@@accounting.bank-statement-import.lecture.des.pages.par.l.ia.page.currentpage.s.su.0ba333ec">Lecture des pages par l'IA… page {{ currentPage(s) }} sur {{ totalPages(s) }} — {{ displayPercent(s) }} %</p>
                } @else {
                  @switch (s.extraction?.aiPlan?.reason) {
                    @case ('line_issues') {
                      <p class="bsr-strong bsr-progress__status" aria-live="polite" i18n="@@accounting.bank-statement-import.relecture.par.l.ia.des.lignes.non.lues.avec.cert.a39a7373">Relecture par l'IA des lignes non lues avec certitude… {{ displayPercent(s) }} %</p>
                    }
                    @case ('unverified') {
                      <p class="bsr-strong bsr-progress__status" aria-live="polite" i18n="@@accounting.bank-statement-import.relecture.du.releve.par.l.ia.solde.non.verifie.s.725c03c7">Relecture du relevé par l'IA (solde non vérifié)… {{ displayPercent(s) }} %</p>
                    }
                    @case ('all_documents') {
                      <p class="bsr-strong bsr-progress__status" aria-live="polite" i18n="@@accounting.bank-statement-import.lecture.du.releve.par.l.ia.sans.l.image.des.page.6c59fbc2">Lecture du relevé par l'IA, sans l'image des pages… {{ displayPercent(s) }} %</p>
                    }
                    @default {
                      <p class="bsr-strong bsr-progress__status" aria-live="polite" i18n="@@accounting.bank-statement-import.lecture.des.pages.scannees.ebb6ce2d">Lecture des pages scannées… {{ displayPercent(s) }} %</p>
                    }
                  }
                }
                <p class="bsr-muted bsr-progress__meta">
                  <span>{{ s.fileName }}</span>
                  <span i18n="@@accounting.bank-statement-import.secondes.ecoulees">{{ elapsedSeconds() }} s écoulées</span>
                </p>
              </div>
            </div>
            <p class="bsr-progress__pct" aria-hidden="true">{{ displayPercent(s) }} %</p>
          </div>
          <div class="bsr-bar" role="progressbar"
               [class.is-indeterminate]="displayPercent(s) === 0"
               [attr.aria-valuenow]="displayPercent(s)"
               [attr.aria-valuetext]="progressAriaValueText(s)"
               aria-valuemin="0"
               aria-valuemax="100"
               i18n-aria-label="@@accounting.bank-statement-import.progression.lecture.aria"
               aria-label="Progression de la lecture">
            <div class="bsr-bar__fill" [style.width.%]="displayPercent(s)">
              @if (displayPercent(s) > 0) {
                <span class="bsr-bar__pulse" aria-hidden="true"></span>
              }
            </div>
            @if (displayPercent(s) === 0) {
              <div class="bsr-bar__indeterminate" aria-hidden="true"></div>
            }
          </div>
          @if (s.extraction?.aiPlan?.engine === 'vision') {
            <!-- Le service externe lit une page en quelques dizaines de secondes : ni le mot « IA »,
                 ni la fourchette d'une à trois minutes, qui est celle du modèle vision local. -->
            @if (viaDocStrange(s)) {
              @if (estimatedMinutes(s); as minutes) {
                <p class="bsr-muted bsr-estimate" i18n="@@accounting.bank-statement-import.duree.estimee.environ.minutes.min.vous.pouvez.qu.8c3f8b0a">Durée estimée : environ {{ minutes }} min. Vous pouvez quitter cet écran et y revenir.</p>
              }
            } @else if (estimatedMinutes(s); as minutes) {
              <p class="bsr-muted bsr-estimate" i18n="@@accounting.bank-statement-import.temps.restant.estime.environ.min.une.a.trois.minutes.par.page">Temps restant estimé : environ {{ minutes }} min (une à trois minutes par page sur le serveur). Vous pouvez quitter cet écran et y revenir.</p>
            } @else {
              <p class="bsr-muted" i18n="@@accounting.bank-statement-import.une.page.prend.une.a.trois.minutes.avec.l.ia.locale">Une page prend une à trois minutes avec l'IA locale. Vous pouvez quitter cet écran et y revenir.</p>
            }
            @if (pageStates(s); as pages) {
              @if (pages.length > 0) {
                @if (pageSummaryCounts(s); as c) {
                  <p class="bsr-muted bsr-progress__summary">
                    @if (c.done) {
                      <span i18n="@@accounting.bank-statement-import.progress.summary.pages.lues">{{ c.done }} lues</span>
                    }
                    @if (c.fallback) {
                      @if (c.done) {<span class="bsr-progress__sep" aria-hidden="true"> · </span>}
                      <span i18n="@@accounting.bank-statement-import.progress.summary.pages.secours">{{ c.fallback }} lecture de secours</span>
                    }
                    @if (c.failed) {
                      @if (c.done || c.fallback) {<span class="bsr-progress__sep" aria-hidden="true"> · </span>}
                      <span i18n="@@accounting.bank-statement-import.progress.summary.pages.echouees">{{ c.failed }} échouée(s)</span>
                    }
                    @if (c.current) {
                      @if (c.done || c.fallback || c.failed) {<span class="bsr-progress__sep" aria-hidden="true"> · </span>}
                      <span i18n="@@accounting.bank-statement-import.progress.summary.pages.en.cours">{{ c.current }} en cours</span>
                    }
                    @if (c.todo) {
                      @if (c.done || c.fallback || c.failed || c.current) {<span class="bsr-progress__sep" aria-hidden="true"> · </span>}
                      <span i18n="@@accounting.bank-statement-import.progress.summary.pages.a.lire">{{ c.todo }} à lire</span>
                    }
                  </p>
                }
                <div class="bsr-pages-wrap">
                  <ul class="bsr-pages">
                    @for (p of pages; track p.page) {
                      <li class="bsr-page" [class.is-done]="p.state === 'done'" [class.is-fallback]="p.state === 'fallback'" [class.is-failed]="p.state === 'failed'" [class.is-current]="p.state === 'current'">
                        @switch (p.state) {
                          @case ('done') {<ng-container i18n="@@accounting.bank-statement-import.page.etat.lue">Page {{ p.page }} · lue</ng-container>}
                          @case ('fallback') {<ng-container i18n="@@accounting.bank-statement-import.page.p.page.lecture.de.secours.e9790bef">Page {{ p.page }} · lecture de secours</ng-container>}
                          @case ('failed') {<ng-container i18n="@@accounting.bank-statement-import.page.etat.echouee">Page {{ p.page }} · échouée</ng-container>}
                          @case ('current') {<ng-container i18n="@@accounting.bank-statement-import.page.etat.en.cours">Page {{ p.page }} · en cours</ng-container>}
                          @default {<ng-container i18n="@@accounting.bank-statement-import.page.etat.a.lire">Page {{ p.page }} · à lire</ng-container>}
                        }
                      </li>
                    }
                  </ul>
                </div>
              }
            }
            @if (fallbackPagesOf(s); as fallback) {
              @if (fallback.length > 0) {
                <p class="bsr-muted bsr-fallback-note" role="note" i18n="@@accounting.bank-statement-import.pages.pagelist.fallback.lues.en.secours.sans.l.i.1c30311a">Pages {{ pageList(fallback) }} : lues en secours, sans l'image de la page.</p>
              }
            }
          } @else {
            @if (estimatedMinutes(s); as minutes) {
              <p class="bsr-muted bsr-estimate" i18n="@@accounting.bank-statement-import.duree.estimee.environ.minutes.min.vous.pouvez.qu.8c3f8b0a">Durée estimée : environ {{ minutes }} min. Vous pouvez quitter cet écran et y revenir.</p>
            } @else {
              <p class="bsr-muted" i18n="@@accounting.bank-statement-import.une.page.prend.une.a.trois.minutes.avec.l.ia.locale">Une page prend une à trois minutes avec l'IA locale. Vous pouvez quitter cet écran et y revenir.</p>
            }
          }
          <div class="bsr-progress__footer">
            <app-button variant="secondary" icon="pi-times" iconPos="left" (clicked)="cancelSession()" [disabled]="busy()" ariaLabel="Annuler l'import" i18n-ariaLabel="@@accounting.bank-statement-import.annuler.l.import.8c2b45d2" i18n="@@accounting.bank-statement-import.annuler.49ba3292">Annuler</app-button>
          </div>
        </div>
      }

      @if (s.status === 'Failed' || s.status === 'Cancelled') {
        <div class="card bsr-card">
          <p class="bsr-strong" i18n="@@accounting.bank-statement-import.l.analyse.de.ce.releve.n.a.pas.abouti.bcff5d65">L'analyse de ce relevé n'a pas abouti.</p>
          @if (s.status === 'Failed' && sessionFailureMessage(s.errorCode); as failure) {
            <p class="bsr-muted">{{ failure }}</p>
          }
          <div class="bsr-actions bsr-actions--start">
            @if (canRetry()) {
              <app-button variant="secondary" icon="pi-refresh" iconPos="left" (clicked)="retry()" [disabled]="busy()"
                          ariaLabel="Relancer l'analyse du relevé" i18n-ariaLabel="@@accounting.bank-statement-import.relancer.l.analyse.du.releve.aria"
                          i18n="@@accounting.bank-statement-import.ts.relancer.l.analyse">Relancer l'analyse</app-button>
            }
            @if (origin() === 'reconciliation') {
              <a routerLink="/accounting/bank-reconciliation" class="bsr-link" i18n="@@accounting.bank-statement-import.retour.au.rapprochement.bancaire.6e5dcc9c">Retour au rapprochement bancaire</a>
            } @else {
              <a routerLink="/accounting/manual-entry" class="bsr-link" i18n="@@accounting.bank-statement-import.retour.a.la.saisie.ca4355e9">Retour à la saisie</a>
            }
          </div>
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
                <a class="bsr-link" [routerLink]="siblingLink(sib)" [queryParams]="originQuery()">Relevé {{ sib.segmentIndex }} — {{ sib.periodStart | date: 'MM/yyyy' }}</a>
                <span class="bsr-muted"> · {{ siblingState(sib) }}</span>
              </li>
            }
          </ul>
        </div>
      }

      @for (entry of siblingPreviewEntries(); track entry.sib.id) {
        @if (entry.preview?.extraction; as sx) {
          <div class="card bsr-card bsr-sibling-preview" role="region" [attr.aria-label]="siblingPreviewAria(entry.sib)">
            <h2 class="bsr-title" i18n="@@accounting.bank-statement-import.releve.preview.titre">
              Relevé {{ entry.sib.segmentIndex }} — {{ entry.sib.periodStart | date: 'MM/yyyy' }} · aperçu
            </h2>
            <p class="bsr-muted bsr-small" i18n="@@accounting.bank-statement-import.releve.preview.hint">
              Contrôle et enregistrement sur l'écran du relevé (lien ci-dessus). Les opérations ci-dessous sont en lecture seule.
            </p>
            <div class="bsr-facts">
              <div><span class="bsr-muted" i18n="@@accounting.bank-statement-import.operations.lues.p.e06736ac">Opérations lues</span><span>{{ sx.lines.length }} ({{ entry.preview!.pageCount }} p.)</span></div>
            </div>
            @if (entry.preview!.balanceCheck; as b) {
              <div class="bsr-balance" [class.is-ok]="siblingBalanceMode(entry.preview!) === 'ok'" [class.is-ko]="siblingBalanceMode(entry.preview!) === 'blocking'" [class.is-warning]="siblingBalanceMode(entry.preview!) === 'warning'">
                <p class="bsr-muted bsr-num">
                  {{ sx.header.openingBalance?.value | number: '1.3-3' }} + {{ b.sumCredits | number: '1.3-3' }}
                  − {{ b.sumDebits | number: '1.3-3' }} = {{ b.computedClosing | number: '1.3-3' }}
                  / {{ sx.header.closingBalance?.value | number: '1.3-3' }}
                </p>
              </div>
            }
            <p-table [value]="sx.lines" dataKey="index" [paginator]="sx.lines.length > 50" [rows]="50" styleClass="p-datatable-sm" [tableStyle]="{ 'min-width': '720px' }">
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
                  </td>
                  <td class="bsr-right">{{ line.isDebit ? (line.amount | number: '1.3-3') : '' }}</td>
                  <td class="bsr-right">{{ !line.isDebit ? (line.amount | number: '1.3-3') : '' }}</td>
                  <td>{{ line.pageNumber }}</td>
                </tr>
              </ng-template>
            </p-table>
          </div>
        }
      }

      <!-- ══ Étape 1 : contrôle de l'extraction ══ -->
      @if (s.status === 'AwaitingReview' && s.extraction; as x) {
        <div class="card bsr-card">
          <h2 class="bsr-title" i18n="@@accounting.bank-statement-import.1.controle.du.releve.2c418cb5">1 · Contrôle du relevé</h2>
          <div class="bsr-facts">
            <div i18n="@@accounting.bank-statement-import.fichier.71149cb0"><span class="bsr-muted">Fichier</span><span>{{ s.fileName }}</span></div>
            <div>
              <span class="bsr-muted" i18n="@@accounting.bank-statement-import.rib.lu">RIB lu</span>
              <span class="bsr-inline">
                <span>{{ maskRib(x.header.rib) }}</span>
                @if (!x.header.rib) {
                  <span class="bsr-badge bsr-badge--muted" i18n="@@accounting.bank-statement-import.rib.non.lu">non lu</span>
                } @else if (hasIssue(s, 'statement.ai_rib_mismatch', 'Warning')) {
                  <span class="bsr-badge bsr-badge--fallback" [title]="ribToCheckTitle" i18n="@@accounting.bank-statement-import.badge.rib.a.verifier">à vérifier</span>
                }
              </span>
            </div>
            <div i18n="@@accounting.bank-statement-import.periode.bad3ec87"><span class="bsr-muted">Période</span><span>{{ x.header.periodStart | date: 'dd/MM/yyyy' }} → {{ x.header.periodEnd | date: 'dd/MM/yyyy' }}</span></div>
            <div i18n="@@accounting.bank-statement-import.operations.lues.p.e06736ac"><span class="bsr-muted">Opérations lues</span><span>{{ x.lines.length }} ({{ s.pageCount }} p.)</span></div>
            <div i18n="@@accounting.bank-statement-import.methode.1488365d"><span class="bsr-muted">Méthode</span><span>{{ methodLabel(s) }}</span></div>
          </div>

          @if (s.balanceCheck; as b) {
            <div class="bsr-balance" [class.is-ok]="balanceMode() === 'ok'" [class.is-ko]="balanceMode() === 'blocking'" [class.is-warning]="balanceMode() === 'warning'" [attr.role]="balanceMode() === 'warning' ? 'alert' : null">
              <i class="pi" [class.pi-check-circle]="balanceMode() === 'ok'" [class.pi-times-circle]="balanceMode() === 'blocking'" [class.pi-exclamation-triangle]="balanceMode() === 'warning'" aria-hidden="true"></i>
              <div class="bsr-balance__body">
                <p class="bsr-strong">
                  @switch (balanceMode()) {
                    @case ('ok') {<ng-container i18n="@@accounting.bank-statement-import.soldes.controles.le.releve.est.complet.e148f4ae"> Soldes contrôlés : le relevé est complet. </ng-container>}
                    @case ('warning') {<ng-container i18n="@@accounting.bank-statement-import.ecart.de.solde.lu.par.l.ia.non.prouve">Écart de solde de {{ b.difference | number: '1.3-3' }} TND : les montants ont été lus par l'IA et n'ont pas pu être prouvés au millime.</ng-container>}
                    @default {<ng-container i18n="@@accounting.bank-statement-import.controle.de.solde.en.echec.le.releve.ne.4c049756"> Contrôle de solde en échec : le relevé ne peut pas être enregistré. </ng-container>}
                  }
                </p>
                <p class="bsr-muted bsr-num">
                  {{ x.header.openingBalance?.value | number: '1.3-3' }} + {{ b.sumCredits | number: '1.3-3' }}
                  − {{ b.sumDebits | number: '1.3-3' }} = {{ b.computedClosing | number: '1.3-3' }}
                  / {{ x.header.closingBalance?.value | number: '1.3-3' }}
                </p>
                @if (balanceMode() === 'warning') {
                  <p class="bsr-muted bsr-num bsr-small" i18n="@@accounting.bank-statement-import.total.debits.imprime.calcule">Total débits imprimé {{ printedAmount(x.header.totalDebits) }} / calculé {{ b.sumDebits | number: '1.3-3' }}</p>
                  <p class="bsr-muted bsr-num bsr-small" i18n="@@accounting.bank-statement-import.total.credits.imprime.calcule">Total crédits imprimé {{ printedAmount(x.header.totalCredits) }} / calculé {{ b.sumCredits | number: '1.3-3' }}</p>
                  <div class="bsr-ack">
                    <input type="checkbox" id="bsr-ack" [(ngModel)]="balanceAcknowledged" [disabled]="busy()" aria-describedby="bsr-ack-help" />
                    <div>
                      <label for="bsr-ack" i18n="@@accounting.bank-statement-import.j.ai.verifie.enregistrer.malgre.l.ecart">J'ai vérifié les opérations ci-dessous et je souhaite enregistrer ce relevé malgré l'écart de solde.</label>
                      <p id="bsr-ack-help" class="bsr-muted bsr-small" i18n="@@accounting.bank-statement-import.l.ecart.sera.consigne.dans.l.audit">L'écart sera consigné dans le journal d'audit du dossier.</p>
                    </div>
                  </div>
                }
              </div>
            </div>
          }

          @if (x.issues.length > 0) {
            <ul class="bsr-issues">
              @for (issue of x.issues; track $index) {
                <li [class]="'bsr-issue bsr-issue--' + issue.severity.toLowerCase()">
                  <span class="bsr-strong">
                    @if (issue.pageNumber) {<span class="bsr-muted" i18n="@@accounting.bank-statement-import.page.prefixe.signalement">Page {{ issue.pageNumber }} · </span>}
                    @if (issue.lineIndex !== null && issue.lineIndex !== undefined) {<span class="bsr-muted" i18n="@@accounting.bank-statement-import.ligne.prefixe.signalement">Ligne {{ issue.lineIndex + 1 }} · </span>}
                    <span>{{ issueTitle(issue.code) }}</span>
                  </span>
                  <span class="bsr-muted">{{ issue.message }}</span>
                  @if (issue.code === 'statement.ai_line_needs_review' && issue.lineIndex !== null && issue.lineIndex !== undefined && hasEditableLines()) {
                    <button type="button" class="bsr-link bsr-link--button" (click)="editLineFromIssue(issue.lineIndex)" [disabled]="busy()" i18n="@@accounting.bank-statement-import.corriger.cette.ligne">Corriger cette ligne</button>
                  }
                </li>
              }
            </ul>
          }

          @if (aiUnavailableBlocking()) {
            <div class="bsr-retarget" role="status">
              @if (plannedMinutes(s); as minutes) {
                <p class="bsr-muted" i18n="@@accounting.bank-statement-import.aucune.operation.lue.la.relance.reprend.le.fichier.complet.environ.min">Aucune opération n'a été lue : la relance reprend le fichier complet ({{ s.pageCount }} pages, environ {{ minutes }} min) dès que le modèle est prêt.</p>
              } @else {
                <p class="bsr-muted" i18n="@@accounting.bank-statement-import.aucune.operation.lue.la.relance.reprend.le.fichier.complet">Aucune opération n'a été lue : la relance reprend le fichier complet ({{ s.pageCount }} pages) dès que le modèle est prêt.</p>
              }
              <app-button variant="secondary" icon="pi-refresh" iconPos="left" (clicked)="retry()" [disabled]="busy()"
                          ariaLabel="Relancer l'analyse du relevé" i18n-ariaLabel="@@accounting.bank-statement-import.relancer.l.analyse.du.releve.aria"
                          i18n="@@accounting.bank-statement-import.ts.relancer.l.analyse">Relancer l'analyse</app-button>
            </div>
          }

          @if (suggestedRetargetAccount(); as match) {
            <div class="bsr-retarget" role="status">
              <p class="bsr-muted" i18n="@@accounting.bank-statement-import.ce.releve.appartient.au.compte.suggere">Ce relevé appartient au compte {{ match.bankName }} (…{{ ribTail(match.rib) }}).</p>
              @if (s.extraction?.aiPlan?.engine === 'vision') {
                @if (plannedMinutes(s); as minutes) {
                  <p class="bsr-muted bsr-small" i18n="@@accounting.bank-statement-import.analyser.avec.ce.compte.relance.la.lecture.compl.2996c3d3">Analyser avec ce compte relance la lecture complète du fichier par l'IA ({{ s.pageCount }} pages, environ {{ minutes }} min). Les opérations déjà lues ci-dessous sont présentées à titre indicatif.</p>
                } @else {
                  <p class="bsr-muted bsr-small" i18n="@@accounting.bank-statement-import.analyser.avec.ce.compte.relance.la.lecture.compl.4e3d199b">Analyser avec ce compte relance la lecture complète du fichier par l'IA ({{ s.pageCount }} pages). Les opérations déjà lues ci-dessous sont présentées à titre indicatif.</p>
                }
              }
              <app-button variant="secondary" icon="pi-refresh" iconPos="left" (clicked)="retargetToAccount(match.id)" [disabled]="busy()"
                        ariaLabel="Analyser avec ce compte bancaire" i18n-ariaLabel="@@accounting.bank-statement-import.analyser.avec.ce.compte.aria"
                        i18n="@@accounting.bank-statement-import.analyser.avec.ce.compte">Analyser avec ce compte</app-button>
            </div>
          } @else {
            @if (missingAccountRibTail(); as tail) {
              <div class="bsr-retarget" role="status">
                <p class="bsr-muted" i18n="@@accounting.bank-statement-import.releve.d.un.compte.absent.du.dossier">Ce relevé appartient à un autre compte (RIB …{{ tail }}) qui n'existe pas dans ce dossier. Créez-le dans Paiements › Comptes bancaires (compte en dinars relié à un compte 532), puis relancez l'import.</p>
              </div>
            }
          }

          @if (fallbackPagesOf(s); as fallback) {
            @if (fallback.length > 1) {
              <p class="bsr-fallback-note" role="note" i18n="@@accounting.bank-statement-import.l.ia.n.a.pas.pu.lire.les.pages.pagelist.fallback.94d40cd2">L'IA n'a pas pu lire les pages {{ pageList(fallback) }} : elles ont été lues en secours, sans leur image. Vérifiez attentivement ces opérations. Vérifiez attentivement ces opérations.</p>
            } @else if (fallback.length === 1) {
              <p class="bsr-fallback-note" role="note" i18n="@@accounting.bank-statement-import.l.ia.n.a.pas.pu.lire.la.page.fallback.0.elle.a.e.32d72468">L'IA n'a pas pu lire la page {{ fallback[0] }} : elle a été lue en secours, sans son image. Vérifiez attentivement ces opérations. Vérifiez attentivement ces opérations.</p>
            }
          }

          @if (x.lines.length === 0) {
            <p class="bsr-empty" role="status" i18n="@@accounting.bank-statement-import.aucune.operation.lue.verifiez.le.fichier">Aucune opération n'a été lue sur ce relevé. Vérifiez que le fichier est bien un relevé bancaire lisible, ou abandonnez cet import.</p>
          }

          <p-table #linesTable [value]="displayLines()" dataKey="index" [paginator]="displayLines().length > 50" [rows]="50" styleClass="p-datatable-sm" [tableStyle]="{ 'min-width': '720px' }">
            <ng-template pTemplate="header">
              <tr>
                <th i18n="@@accounting.bank-statement-import.date.eb9a4bc1">Date</th>
                <th i18n="@@accounting.bank-statement-import.valeur.68f92b0d">Valeur</th>
                <th i18n="@@accounting.bank-statement-import.libelle.f5485bba">Libellé</th>
                <th class="bsr-right" i18n="@@accounting.bank-statement-import.debit.f528224f">Débit</th>
                <th class="bsr-right" i18n="@@accounting.bank-statement-import.credit.19194bdf">Crédit</th>
                <th i18n="@@accounting.bank-statement-import.page.fb06270f">Page</th>
                @if (hasEditableLines()) {
                  <th class="bsr-col-actions"><span class="sr-only" i18n="@@accounting.bank-statement-import.actions.sur.la.ligne">Actions sur la ligne</span></th>
                }
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-line>
              <tr [id]="'line-' + line.index" [class.bsr-row--excluded]="line.excluded" [class.bsr-row--editing]="editingIndex() === line.index">
                @if (editingIndex() === line.index) {
                  <td>
                    <input type="date" class="bsr-input bsr-input--date" [(ngModel)]="draft.transactionDate" required [disabled]="busy()"
                           aria-label="Date de l'opération" i18n-aria-label="@@accounting.bank-statement-import.date.de.l.operation.aria" />
                  </td>
                  <td>{{ line.valueDate | date: 'dd/MM/yyyy' }}</td>
                  <td>
                    <input type="text" class="bsr-input bsr-input--label" [(ngModel)]="draft.label" maxlength="200" required [disabled]="busy()"
                           aria-label="Libellé de l'opération" i18n-aria-label="@@accounting.bank-statement-import.libelle.de.l.operation.aria" />
                  </td>
                  <td class="bsr-right">
                    <input type="number" class="bsr-input bsr-input--amount" [(ngModel)]="draft.amount" step="0.001" min="0.001" required [disabled]="busy()"
                           aria-label="Montant de l'opération" i18n-aria-label="@@accounting.bank-statement-import.montant.de.l.operation.aria" />
                  </td>
                  <td>
                    <select class="bsr-input" [(ngModel)]="draft.isDebit" [disabled]="busy()" aria-label="Sens de l'opération" i18n-aria-label="@@accounting.bank-statement-import.sens.de.l.operation.aria">
                      <option [ngValue]="true" i18n="@@accounting.bank-statement-import.sens.debit">Débit</option>
                      <option [ngValue]="false" i18n="@@accounting.bank-statement-import.sens.credit">Crédit</option>
                    </select>
                  </td>
                  <td>{{ line.pageNumber }}</td>
                  <td class="bsr-col-actions">
                    <button type="button" class="bsr-icon-btn" (click)="saveLineEdit(line)" [disabled]="busy() || !draftValid()"
                            aria-label="Valider la ligne" i18n-aria-label="@@accounting.bank-statement-import.valider.la.ligne.aria"><i class="pi pi-check" aria-hidden="true"></i></button>
                    <button type="button" class="bsr-icon-btn" (click)="cancelLineEdit()" [disabled]="busy()"
                            aria-label="Annuler la modification" i18n-aria-label="@@accounting.bank-statement-import.annuler.la.modification.aria"><i class="pi pi-times" aria-hidden="true"></i></button>
                  </td>
                } @else {
                  <td>{{ line.transactionDate | date: 'dd/MM/yyyy' }}</td>
                  <td>{{ line.valueDate | date: 'dd/MM/yyyy' }}</td>
                  <td>
                    @if (line.corrected) {
                      <div>{{ line.label }}</div>
                    } @else {
                      @for (part of line.labelLines.length ? line.labelLines : [line.label]; track $index) {
                        <div>{{ part }}</div>
                      }
                    }
                    @if (line.source === 'Ai') { <span class="bsr-badge bsr-badge--ai" i18n="@@accounting.bank-statement-import.lu.par.l.ia.e4b06016">Lu par l'IA</span> }
                    @if (line.fallbackPage) { <span class="bsr-badge bsr-badge--fallback" [title]="fallbackBadgeTitle" [attr.aria-label]="fallbackBadgeTitle" i18n="@@accounting.bank-statement-import.badge.modele.texte">modèle texte</span> }
                    @if (line.source === 'Manual' || line.corrected) { <span class="bsr-badge bsr-badge--manual" i18n="@@accounting.bank-statement-import.badge.corrigee">Corrigée</span> }
                    @if (line.excluded) { <span class="bsr-badge bsr-badge--excluded" i18n="@@accounting.bank-statement-import.badge.exclue">Exclue</span> }
                  </td>
                  <td class="bsr-right bsr-num">{{ line.isDebit ? (line.amount | number: '1.3-3') : '' }}</td>
                  <td class="bsr-right bsr-num">{{ line.isDebit ? '' : (line.amount | number: '1.3-3') }}</td>
                  <td>{{ line.pageNumber }}</td>
                  @if (hasEditableLines()) {
                    <td class="bsr-col-actions">
                      @if (isEditable(line)) {
                        @if (line.excluded) {
                          <button type="button" class="bsr-link bsr-link--button" (click)="toggleExclude(line)" [disabled]="busy()" i18n="@@accounting.bank-statement-import.retablir.la.ligne">Rétablir</button>
                        } @else {
                          <button type="button" class="bsr-icon-btn" (click)="startLineEdit(line)" [disabled]="busy() || editingIndex() !== null"
                                  aria-label="Modifier la ligne" i18n-aria-label="@@accounting.bank-statement-import.modifier.la.ligne.aria"><i class="pi pi-pencil" aria-hidden="true"></i></button>
                          <button type="button" class="bsr-icon-btn" (click)="toggleExclude(line)" [disabled]="busy() || editingIndex() !== null"
                                  aria-label="Exclure la ligne" i18n-aria-label="@@accounting.bank-statement-import.exclure.la.ligne.aria"><i class="pi pi-ban" aria-hidden="true"></i></button>
                        }
                      }
                    </td>
                  }
                }
              </tr>
            </ng-template>
          </p-table>

          @if (correctedCount() > 0 || excludedCount() > 0) {
            <p class="bsr-muted bsr-small" role="status" i18n="@@accounting.bank-statement-import.lignes.corrigees.exclues.recalcul.serveur">{{ correctedCount() }} ligne(s) corrigée(s), {{ excludedCount() }} exclue(s) — le contrôle de solde sera recalculé par le serveur à l'enregistrement.</p>
          }

          <div class="bsr-actions">
            <app-button variant="secondary" (clicked)="cancelSession()" [disabled]="busy()" ariaLabel="Abandonner cet import" i18n-ariaLabel="@@accounting.bank-statement-import.abandonner.cet.import.b2a65847" i18n="@@accounting.bank-statement-import.abandonner.7a0662a3">Abandonner</app-button>
            <app-button variant="primary" icon="pi-check" iconPos="left" (clicked)="confirmStatement()" [disabled]="!s.canConfirm || busy() || (balanceMode() === 'warning' && !balanceAcknowledged())"
                        [ariaLabel]="confirmAriaLabel()" i18n="@@accounting.bank-statement-import.enregistrer.le.releve.8d42b4ab">Enregistrer le relevé</app-button>
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
            <li i18n="@@accounting.bank-statement-import.releve.0edb21de"><a class="bsr-link" [routerLink]="siblingLink(sib)" [queryParams]="originQuery()">Relevé {{ sib.segmentIndex }} — {{ sib.periodStart | date: 'MM/yyyy' }}</a></li>
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
    .bsr-progress { gap:var(--spacing-3); }
    .bsr-progress__top { display:flex; align-items:flex-start; justify-content:space-between; gap:var(--spacing-4); }
    .bsr-progress__header { display:flex; align-items:flex-start; gap:var(--spacing-3); flex:1; min-width:0; }
    .bsr-progress__spinner { flex-shrink:0; margin-block-start:2px; font-size:1.25rem; color:var(--color-primary-600); }
    .bsr-progress__head-copy { flex:1; min-width:0; display:flex; flex-direction:column; gap:var(--spacing-1); }
    .bsr-progress__status { margin:0; }
    .bsr-progress__meta { display:flex; gap:var(--spacing-3); flex-wrap:wrap; font-size:var(--font-size-sm); margin:0; }
    .bsr-progress__pct { margin:0; flex-shrink:0; font-size:var(--font-size-2xl); font-weight:var(--font-weight-bold); color:var(--color-primary-800); font-variant-numeric:tabular-nums; line-height:var(--line-height-tight); }
    .bsr-bar { position:relative; block-size:10px; background:var(--color-neutral-200); border-radius:var(--radius-full); overflow:hidden; }
    .bsr-bar__fill { block-size:100%; background:var(--color-primary-600); transition:width var(--transition-normal); position:relative; min-inline-size:0; }
    .bsr-bar__pulse { position:absolute; inset-block:0; inset-inline-end:0; inline-size:6px; background:var(--color-primary-400); border-radius:var(--radius-full); animation:bsr-bar-pulse 1.2s ease-in-out infinite; }
    .bsr-bar__indeterminate { position:absolute; inset-block:0; inline-size:35%; background:var(--color-primary-600); border-radius:var(--radius-full); animation:bsr-bar-slide 1.4s ease-in-out infinite; }
    .bsr-bar.is-indeterminate .bsr-bar__fill { inline-size:0 !important; }
    @keyframes bsr-bar-slide { 0% { inset-inline-start:-35%; } 100% { inset-inline-start:100%; } }
    @keyframes bsr-bar-pulse { 0%, 100% { opacity:.35; } 50% { opacity:1; } }
    @media (prefers-reduced-motion: reduce) {
      .bsr-progress__spinner { animation:none; }
      .bsr-bar__indeterminate, .bsr-bar__pulse { animation:none; }
    }
    .bsr-progress__summary { margin:0; font-size:var(--font-size-sm); }
    .bsr-progress__sep { color:var(--color-text-tertiary); }
    .bsr-pages-wrap { max-block-size:5.75rem; overflow:auto; padding-inline-end:var(--spacing-1); }
    .bsr-pages { list-style:none; margin:0; padding:0; display:flex; flex-wrap:wrap; gap:var(--spacing-1); }
    .bsr-page { font-size:var(--font-size-xs); padding:2px var(--spacing-2); border-radius:var(--radius-full); border:1px solid var(--color-border-default); color:var(--color-text-secondary); background:var(--color-background-elevated); }
    .bsr-page.is-done { border-color:var(--color-success-600); background:var(--color-success-50); color:var(--color-success-700); }
    .bsr-page.is-fallback { border-color:var(--color-warning-600); background:var(--color-warning-50); color:var(--color-warning-700); }
    .bsr-page.is-failed { border-color:var(--color-error-600); background:var(--color-error-50); color:var(--color-error-700); }
    .bsr-page.is-current { border-color:var(--color-primary-600); background:var(--color-primary-50); color:var(--color-primary-700); font-weight:var(--font-weight-semibold); }
    .bsr-progress__footer { display:flex; justify-content:flex-end; padding-block-start:var(--spacing-2); margin-block-start:var(--spacing-1); border-block-start:1px solid var(--color-border-subtle); }
    .bsr-facts { display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:var(--spacing-2); }
    .bsr-facts > div { display:flex; flex-direction:column; gap:2px; }
    .bsr-balance { display:flex; gap:var(--spacing-3); align-items:flex-start; padding:var(--spacing-3); border-radius:var(--radius-md); border:1px solid var(--color-border-default); }
    .bsr-balance .pi { font-size:1.5rem; }
    .bsr-balance.is-ok { border-color:var(--color-success); }
    .bsr-balance.is-ok .pi { color:var(--color-success); }
    .bsr-balance.is-ko { border-color:var(--color-danger); }
    .bsr-balance.is-ko .pi { color:var(--color-danger); }
    .bsr-balance.is-warning { border-color:var(--color-warning); }
    .bsr-balance.is-warning .pi { color:var(--color-warning); }
    .bsr-balance__body { flex:1; display:flex; flex-direction:column; gap:var(--spacing-1); }
    .bsr-balance p { margin:0; }
    .bsr-ack { display:flex; gap:var(--spacing-2); align-items:flex-start; margin-block-start:var(--spacing-2); }
    .bsr-ack input { margin-block-start:3px; }
    .bsr-ack label { font-weight:600; cursor:pointer; }
    .bsr-fallback-note { margin:0; padding:var(--spacing-2) var(--spacing-3); border-inline-start:3px solid var(--color-warning); background:var(--color-warning-subtle, transparent); }
    .bsr-empty { margin:0; padding:var(--spacing-3); border:1px dashed var(--color-border-default); border-radius:var(--radius-md); color:var(--color-text-secondary); }
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
    .bsr-badge--fallback { margin-block-start:var(--spacing-1); margin-inline-start:var(--spacing-1); border-color:var(--color-warning); color:var(--color-warning); }
    .bsr-badge--manual { margin-block-start:var(--spacing-1); margin-inline-start:var(--spacing-1); border-color:var(--color-primary); color:var(--color-primary); }
    .bsr-badge--excluded { margin-block-start:var(--spacing-1); margin-inline-start:var(--spacing-1); border-color:var(--color-text-secondary); color:var(--color-text-secondary); }
    .bsr-badge--muted { color:var(--color-text-secondary); }
    .bsr-row--excluded td { opacity:.55; text-decoration:line-through; }
    .bsr-row--excluded td.bsr-col-actions { text-decoration:none; }
    .bsr-col-actions { width:5.5rem; white-space:nowrap; text-align:end; }
    .bsr-icon-btn { border:1px solid var(--color-border-default); background:transparent; border-radius:var(--radius-sm); width:2rem; height:2rem; cursor:pointer; color:var(--color-text-secondary); }
    .bsr-icon-btn:hover:not(:disabled) { color:var(--color-primary); border-color:var(--color-primary); }
    .bsr-icon-btn:disabled { opacity:.5; cursor:default; }
    .bsr-icon-btn + .bsr-icon-btn { margin-inline-start:var(--spacing-1); }
    .bsr-link--button { border:none; background:transparent; padding:0; cursor:pointer; font:inherit; text-align:start; }
    .bsr-link--button:disabled { opacity:.5; cursor:default; }
    .bsr-input--date { width:9.5rem; }
    .bsr-input--label { width:100%; min-width:12rem; }
    .bsr-input--amount { width:7.5rem; text-align:end; }
    .bsr-actions--start { justify-content:flex-start; }
    .bsr-result { border-top:1px solid var(--color-border-subtle); padding-block-start:var(--spacing-3); display:flex; flex-direction:column; gap:var(--spacing-2); }
    .bsr-links { display:flex; gap:var(--spacing-3); flex-wrap:wrap; }
    .bsr-link { color:var(--color-primary); }
    .bsr-siblings { margin:0; padding-inline-start:var(--spacing-4); display:flex; flex-direction:column; gap:var(--spacing-1); }
    .bsr-retarget { display:flex; flex-direction:column; align-items:flex-start; gap:var(--spacing-2); margin-block-start:var(--spacing-2); }
  `
})
export class BankStatementReviewComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(BankStatementImportService);
  private readonly bankAccountsApi = inject(BankAccountService);
  private readonly refs = inject(EntryReferenceStore);
  private readonly confirmation = inject(ConfirmationService);
  private readonly auth = inject(AuthService);
  private readonly employees = inject(EmployeeService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly locale = inject(LOCALE_ID);

  @ViewChild('linesTable') private linesTable?: Table;

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
  /** Écran d'origine reconnu (liste blanche) : le rapprochement y revient après l'enregistrement. */
  readonly origin = signal<'reconciliation' | null>(null);
  readonly lastGeneration = signal<{ created: number; skipped: number; failed: number; failures: GenerateOutcome[] } | null>(null);
  readonly bankAccounts = signal<BankAccountDto[]>([]);
  /** Comptes bancaires du dossier chargés (sinon on ne peut pas affirmer qu'un compte est absent). */
  private readonly bankAccountsLoaded = signal(false);

  /** Secondes écoulées depuis l'ouverture d'une lecture en cours (compteur local, 1 s). */
  readonly elapsedSeconds = signal(0);
  /** Accusé explicite de l'écart de solde (D4) ; remis à zéro à chaque rechargement de la session. */
  readonly balanceAcknowledged = signal(false);
  /** Corrections locales par index de ligne (seuls les champs modifiés y figurent). */
  readonly corrections = signal<Map<number, StatementLineCorrection>>(new Map());
  /** Ligne en cours d'édition (une seule à la fois). */
  readonly editingIndex = signal<number | null>(null);
  draft: LineDraft = { lineIndex: -1, transactionDate: '', label: '', amount: null, isDebit: true };

  readonly ribToCheckTitle = issueTitle('statement.ai_rib_mismatch');
  readonly fallbackBadgeTitle = $localize`:@@accounting.bank-statement-import.ts.page.lue.en.secours.sans.l.image.f2ded7f1:Page lue en secours, sans l'image`;

  journalCode = 'JB';
  private polling?: Subscription;
  private pollAttempt = 0;
  private elapsedTimer?: ReturnType<typeof setInterval>;
  /** Sessions frères chargées pour aperçu (ids autorisés via `siblings` du serveur). */
  private readonly siblingPreviews = signal<Map<string, BankStatementImportSession>>(new Map());
  private readonly siblingPreviewLoading = signal<Set<string>>(new Set());

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

  readonly suggestedRetargetAccount = computed(() => {
    const s = this.session();
    const readRib = this.normalizeRibDigits(s?.extraction?.header?.rib);
    if (!s || readRib.length !== 20) return null;
    if (!s.extraction?.issues.some(i => i.code === 'statement.rib_mismatch' && i.severity === 'Blocking')) return null;
    return this.bankAccounts().find(a => a.isActive && this.normalizeRibDigits(a.rib) === readRib && a.id !== s.bankAccountId) ?? null;
  });

  /**
   * RIB lu d'un autre compte qu'aucun compte bancaire actif du dossier ne porte : les quatre derniers
   * chiffres à afficher, ou null (RIB illisible, pas de signalement, compte suggéré ou liste non chargée).
   */
  readonly missingAccountRibTail = computed(() => {
    const s = this.session();
    if (!s?.extraction || !this.bankAccountsLoaded() || this.suggestedRetargetAccount()) return null;
    if (!s.extraction.issues.some(i => i.code === 'statement.rib_mismatch')) return null;
    const readRib = this.normalizeRibDigits(s.extraction.header.rib);
    return readRib.length === 20 ? readRib.slice(-4) : null;
  });

  /** Lecture IA bloquée avant toute page (session en relecture sans aucune opération). */
  readonly aiUnavailableBlocking = computed(() => {
    const s = this.session();
    return !!s && s.status === 'AwaitingReview' && this.hasIssue(s, 'statement.ai_unavailable', 'Blocking');
  });

  /** Relance complète possible : IA indisponible avant lecture, ou session échouée pour un motif IA. */
  readonly canRetry = computed(() => {
    const s = this.session();
    if (!s) return false;
    if (s.status === 'Failed') return RETRYABLE_FAILURES.includes(s.errorCode ?? '');
    return this.aiUnavailableBlocking();
  });

  /**
   * Mode du contrôle de solde : `ok` (prouvé), `warning` (écart lu par l'IA, enregistrable avec accusé —
   * décidé par le serveur seul via `requiresBalanceAcknowledgement`), `blocking` sinon ; null sans contrôle.
   */
  readonly balanceMode = computed<'ok' | 'warning' | 'blocking' | null>(() => {
    const s = this.session();
    const b = s?.balanceCheck;
    if (!s || !b) return null;
    if (b.isBalanced) return 'ok';
    return s.requiresBalanceAcknowledgement === true ? 'warning' : 'blocking';
  });

  /** Pages relues par le modèle texte (repli D2), d'après les lectures page par page ou le plan. */
  readonly fallbackPageSet = computed(() => {
    const s = this.session();
    return new Set(s ? this.fallbackPagesOf(s) : []);
  });

  readonly hasEditableLines = computed(() => (this.session()?.extraction?.lines ?? []).some(l => l.source !== 'Layout'));

  readonly displayLines = computed<DisplayLine[]>(() => {
    const lines = this.session()?.extraction?.lines ?? [];
    const corrections = this.corrections();
    const fallback = this.fallbackPageSet();
    return lines.map(line => {
      const c = corrections.get(line.index);
      return {
        ...line,
        transactionDate: c?.transactionDate ?? line.transactionDate,
        label: c?.label ?? line.label,
        amount: c?.amount ?? line.amount,
        isDebit: c?.isDebit ?? line.isDebit,
        corrected: !!c && this.hasFieldChange(c),
        excluded: c?.exclude === true,
        fallbackPage: fallback.has(line.pageNumber)
      };
    });
  });

  readonly correctedCount = computed(() => [...this.corrections().values()].filter(c => this.hasFieldChange(c) && !c.exclude).length);
  readonly excludedCount = computed(() => [...this.corrections().values()].filter(c => c.exclude === true).length);

  readonly confirmAriaLabel = computed(() =>
    this.balanceMode() === 'warning'
      ? $localize`:@@accounting.bank-statement-import.ts.enregistrer.le.releve.malgre.l.ecart.aria:Enregistrer le relevé malgré l'écart de solde`
      : $localize`:@@accounting.bank-statement-import.enregistrer.le.releve.et.passer.aux.prop.932225f1:Enregistrer le relevé et passer aux propositions`
  );

  readonly siblingPreviewEntries = computed(() => {
    const s = this.session();
    if (!s?.siblings?.length) return [];
    const previews = this.siblingPreviews();
    return s.siblings
      .filter(sib => sib.status === 'AwaitingReview' && !sib.statementId)
      .map(sib => ({ sib, preview: previews.get(sib.id) ?? null }))
      .sort((a, b) => a.sib.segmentIndex - b.sib.segmentIndex);
  });

  ngOnInit(): void {
    this.origin.set(this.route.snapshot?.queryParamMap?.get('from') === 'reconciliation' ? 'reconciliation' : null);
    this.refs.loadAll();
    this.bankAccountsApi.list().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: res => {
        this.bankAccounts.set((res?.data ?? []).filter(a => a.isActive));
        this.bankAccountsLoaded.set(true);
      },
      error: () => this.bankAccounts.set([])
    });
    this.api.capabilities().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(caps => this.capabilities.set(caps));
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const sessionId = params.get('sessionId');
      const statementId = params.get('statementId');
      if (sessionId) this.loadSession(sessionId);
      else if (statementId) this.loadProposals(statementId);
    });
    this.destroyRef.onDestroy(() => this.polling?.unsubscribe());
  }

  ngOnDestroy(): void {
    this.stopElapsedTimer();
  }

  // ── Session ─────────────────────────────────────────────────────────────────────────────

  private loadSession(id: string, siblingsOnly = false): void {
    this.api.session(id).subscribe({
      next: s => {
        if (s.status === 'Confirmed' && s.statementId) {
          this.stopElapsedTimer();
          this.polling?.unsubscribe();
          if (this.origin() === 'reconciliation') this.returnToReconciliation(s, s.statementId);
          else void this.router.navigate(['/accounting/bank-statement-import/statement', s.statementId], { replaceUrl: true });
          return;
        }
        if (siblingsOnly) {
          const current = this.session();
          if (current?.id === id) {
            this.session.set({ ...current, siblings: s.siblings, segmentCount: s.segmentCount });
            this.syncSiblingPreviews();
            this.schedulePollIfNeeded(id);
            return;
          }
        }
        this.session.set(s);
        this.balanceAcknowledged.set(false);
        this.corrections.set(new Map());
        this.editingIndex.set(null);
        this.syncSiblingPreviews();
        this.schedulePollIfNeeded(id);
        this.journalCode = s.journalCode || 'JB';
      },
      error: (err: unknown) => this.fail(err)
    });
  }

  private schedulePollIfNeeded(sessionId: string): void {
    const s = this.session();
    if (!s) return;
    if (s.status === 'Extracting' || s.status === 'Pending') {
      this.startElapsedTimer(sessionId);
      this.schedulePoll(sessionId, 'full');
      return;
    }
    this.stopElapsedTimer();
    if (this.hasSiblingReading(s)) {
      this.schedulePoll(sessionId, 'siblings');
    } else {
      this.polling?.unsubscribe();
      this.pollAttempt = 0;
    }
  }

  private hasSiblingReading(s: BankStatementImportSession): boolean {
    return (s.siblings ?? []).some(x => x.status === 'Extracting' || x.status === 'Pending');
  }

  private syncSiblingPreviews(): void {
    const s = this.session();
    if (!s) return;
    const allowed = new Set((s.siblings ?? []).map(x => x.id));
    const next = new Map(this.siblingPreviews());
    for (const key of [...next.keys()]) {
      if (!allowed.has(key)) next.delete(key);
    }
    if (next.size !== this.siblingPreviews().size) {
      this.siblingPreviews.set(next);
    }
    for (const sib of s.siblings ?? []) {
      if (sib.status !== 'AwaitingReview' || sib.statementId) continue;
      if (next.has(sib.id) || this.siblingPreviewLoading().has(sib.id)) continue;
      this.siblingPreviewLoading.update(set => new Set(set).add(sib.id));
      this.api.session(sib.id).subscribe({
        next: preview => {
          this.siblingPreviewLoading.update(set => {
            const copy = new Set(set);
            copy.delete(sib.id);
            return copy;
          });
          const current = this.session();
          if (!(current?.siblings ?? []).some(x => x.id === preview.id)) return;
          this.siblingPreviews.update(m => new Map(m).set(preview.id, preview));
        },
        error: () => {
          this.siblingPreviewLoading.update(set => {
            const copy = new Set(set);
            copy.delete(sib.id);
            return copy;
          });
        }
      });
    }
  }

  private elapsedSessionId: string | null = null;

  private startElapsedTimer(sessionId: string): void {
    if (this.elapsedTimer && this.elapsedSessionId === sessionId) return;
    this.stopElapsedTimer();
    this.elapsedSessionId = sessionId;
    this.elapsedSeconds.set(0);
    this.elapsedTimer = setInterval(() => this.elapsedSeconds.update(v => v + 1), 1_000);
  }

  private stopElapsedTimer(): void {
    if (!this.elapsedTimer) return;
    clearInterval(this.elapsedTimer);
    this.elapsedTimer = undefined;
  }

  /** Interrogation avec temporisation croissante (2 s → 10 s). */
  private schedulePoll(id: string, mode: 'full' | 'siblings'): void {
    this.polling?.unsubscribe();
    const delay = Math.min(10_000, 2_000 + this.pollAttempt++ * 1_000);
    this.polling = timer(delay).subscribe(() => this.loadSession(id, mode === 'siblings'));
  }

  cancelSession(): void {
    const s = this.session();
    if (!s) return;
    this.busy.set(true);
    this.api.cancel(s.id).subscribe({
      next: () => {
        this.busy.set(false);
        void this.router.navigate([this.origin() === 'reconciliation' ? '/accounting/bank-reconciliation' : '/accounting/manual-entry']);
      },
      error: (err: unknown) => this.fail(err)
    });
  }

  confirmStatement(): void {
    const s = this.session();
    if (!s?.canConfirm || this.busy()) return;
    const corrections = [...this.corrections().values()];
    if (this.balanceMode() === 'warning') {
      if (!this.balanceAcknowledged()) return;
      const difference = formatNumber(Math.abs(s.balanceCheck?.difference ?? 0), this.locale, '1.3-3');
      this.confirmation.confirm({
        size: 'md',
        header: $localize`:@@accounting.bank-statement-import.ts.enregistrer.malgre.l.ecart.de.solde.titre:Enregistrer malgré l'écart de solde ?`,
        message: $localize`:@@accounting.bank-statement-import.ts.ecart.de.tnd.le.releve.sera.enregistre.en.l.etat:Écart de ${difference}:difference: TND. Le relevé sera enregistré en l'état et l'écart consigné dans l'audit.`,
        acceptLabel: $localize`:@@accounting.bank-statement-import.ts.enregistrer.malgre.l.ecart:Enregistrer malgré l'écart`,
        rejectLabel: $localize`:@@accounting.bank-statement-import.ts.revenir.au.controle:Revenir au contrôle`,
        accept: () => this.doConfirm(s, { corrections, acknowledgeBalanceWarning: true })
      });
      return;
    }
    this.doConfirm(s, { corrections });
  }

  private doConfirm(s: BankStatementImportSession, request: ConfirmBankStatementImportRequest): void {
    this.busy.set(true);
    this.error.set(null);
    this.api.confirm(s.id, request).subscribe({
      next: result => {
        this.busy.set(false);
        if (this.origin() === 'reconciliation') {
          this.returnToReconciliation(s, result.statementId, result);
          return;
        }
        const pendingSiblings = (s.siblings ?? []).filter(x => !x.statementId);
        void this.router.navigate(['/accounting/bank-statement-import/statement', result.statementId], {
          replaceUrl: true,
          state: { pendingSiblings }
        });
      },
      error: (err: unknown) => {
        this.fail(err);
        // Le serveur a tranché (contrôles bloquants, accusé manquant) : on recharge son état de référence.
        if (err instanceof BankStatementImportError && (err.code === 'bank_statement_import.blocking_issues' || err.code === 'bank_statement_import.balance_warning_not_acknowledged')) {
          this.loadSession(s.id);
        }
      }
    });
  }

  /** Relance la lecture complète du fichier (nouvelle session, même compte) et s'y rend. */
  retry(): void {
    const s = this.session();
    if (!s || this.busy() || !this.canRetry()) return;
    this.busy.set(true);
    this.error.set(null);
    this.api.retry(s.id).subscribe({
      next: next => {
        this.busy.set(false);
        this.stopElapsedTimer();
        void this.router.navigate(['/accounting/bank-statement-import/session', next.id], {
          queryParams: this.originQuery() ?? {},
          replaceUrl: true
        });
      },
      error: (err: unknown) => this.fail(err)
    });
  }

  // ── Lecture page par page ──────────────────────────────────────────────────────────────

  hasIssue(s: BankStatementImportSession, code: string, severity?: IssueSeverity): boolean {
    return (s.extraction?.issues ?? []).some(i => i.code === code && (!severity || i.severity === severity));
  }

  /** Pourcentage affiché (0–100), identique au serveur. */
  displayPercent(s: BankStatementImportSession): number {
    return Math.min(100, Math.max(0, s.progressPercent ?? 0));
  }

  /** Texte court pour la barre de progression (lecteurs d'écran). */
  progressAriaValueText(s: BankStatementImportSession): string {
    const pct = this.displayPercent(s);
    const total = this.totalPages(s);
    if (total > 0 && (s.extraction?.aiPlan?.engine === 'vision' || this.viaDocStrange(s))) {
      const page = this.currentPage(s);
      return $localize`:@@accounting.bank-statement-import.progress.aria.page.et.pct:${pct}:percent: %, page ${page}:current: sur ${total}:total:`;
    }
    return $localize`:@@accounting.bank-statement-import.progress.aria.pct.seul:${pct}:percent: %`;
  }

  /** Décompte par état pour la synthèse sous la barre (lecture page par page). */
  pageSummaryCounts(s: BankStatementImportSession): { done: number; fallback: number; failed: number; current: number; todo: number } | null {
    const pages = this.pageStates(s);
    if (pages.length === 0) return null;
    let done = 0;
    let fallback = 0;
    let failed = 0;
    let current = 0;
    let todo = 0;
    for (const p of pages) {
      switch (p.state) {
        case 'done':
          done++;
          break;
        case 'fallback':
          fallback++;
          break;
        case 'failed':
          failed++;
          break;
        case 'current':
          current++;
          break;
        default:
          todo++;
          break;
      }
    }
    return { done, fallback, failed, current, todo };
  }

  /** Nombre de pages à lire : celles du plan IA, sinon le nombre de pages du fichier. */
  totalPages(s: BankStatementImportSession): number {
    const plan = s.extraction?.aiPlan;
    const planned = plan ? (plan.scannedPages?.length ?? 0) + (plan.textPages?.length ?? 0) : 0;
    return planned > 0 ? planned : Math.max(0, s.pageCount ?? 0);
  }

  /** Page en cours : la suivante des pages déjà lues, sinon déduite de l'avancement ; bornée au total. */
  currentPage(s: BankStatementImportSession): number {
    const total = this.totalPages(s);
    if (total === 0) return 0;
    const readings = s.extraction?.aiPlan?.pageReadings;
    if (readings && readings.length > 0) return Math.min(total, readings.length + 1);
    const percent = Math.min(100, Math.max(0, s.progressPercent ?? 0));
    return Math.min(total, Math.floor((percent * total) / 100) + 1);
  }

  /** État de chaque page du plan, pour les pastilles de progression. */
  pageStates(s: BankStatementImportSession): { page: number; state: PageState }[] {
    const total = this.totalPages(s);
    if (total === 0) return [];
    const plan = s.extraction?.aiPlan;
    const planned = [...(plan?.scannedPages ?? []), ...(plan?.textPages ?? [])].sort((a, b) => a - b);
    const pages = planned.length === total ? planned : Array.from({ length: total }, (_, i) => i + 1);
    const readings = new Map((plan?.pageReadings ?? []).map(r => [r.page, r]));
    const current = this.currentPage(s);
    let currentAssigned = false;
    return pages.map((page, position) => {
      const reading = readings.get(page);
      if (reading) {
        const state: PageState = reading.engine === 'text-model' ? 'fallback' : reading.engine === 'failed' ? 'failed' : 'done';
        return { page, state };
      }
      if (readings.size === 0) {
        if (position + 1 < current) return { page, state: 'done' as const };
        if (position + 1 === current) return { page, state: 'current' as const };
        return { page, state: 'todo' as const };
      }
      if (!currentAssigned) {
        currentAssigned = true;
        return { page, state: 'current' as const };
      }
      return { page, state: 'todo' as const };
    });
  }

  /** Pages relues par le modèle texte : lectures page par page si présentes, sinon `fallbackPages` du plan. */
  fallbackPagesOf(s: BankStatementImportSession): number[] {
    const plan = s.extraction?.aiPlan;
    if (!plan) return [];
    const readings = plan.pageReadings ?? [];
    const pages = readings.length > 0 ? readings.filter(r => r.engine === 'text-model').map(r => r.page) : (plan.fallbackPages ?? []);
    return [...new Set(pages)].sort((a, b) => a - b);
  }

  /** Liste de numéros de pages triée, séparée par « , » (un seul placeholder dans le message traduit). */
  pageList(pages: number[]): string {
    return [...pages].sort((a, b) => a - b).join(', ');
  }

  /** Durée totale prévue de la lecture complète (minutes, ≥ 1) ; null sans estimation. */
  plannedMinutes(s: BankStatementImportSession): number | null {
    const seconds = s.extraction?.aiPlan?.estimatedSeconds ?? 0;
    return seconds > 0 ? Math.max(1, Math.ceil(seconds / 60)) : null;
  }

  /** Montant imprimé sur le relevé, formaté ; « — » s'il n'a pas été lu. */
  printedAmount(amount: StatementAmount | null | undefined): string {
    return amount ? formatNumber(amount.value, this.locale, '1.3-3') : '—';
  }

  // ── Correction des lignes lues par l'IA ────────────────────────────────────────────────

  isEditable(line: ExtractedStatementLine): boolean {
    return line.source !== 'Layout';
  }

  startLineEdit(line: DisplayLine): void {
    if (!this.isEditable(line) || line.excluded || this.busy()) return;
    this.draft = {
      lineIndex: line.index,
      transactionDate: (line.transactionDate ?? '').slice(0, 10),
      label: line.label ?? '',
      amount: line.amount,
      isDebit: line.isDebit
    };
    this.editingIndex.set(line.index);
  }

  cancelLineEdit(): void {
    this.editingIndex.set(null);
  }

  draftValid(): boolean {
    const d = this.draft;
    const amount = Number(d.amount);
    return /^\d{4}-\d{2}-\d{2}$/.test(d.transactionDate) && d.label.trim().length > 0 && d.label.trim().length <= 200 && Number.isFinite(amount) && amount > 0;
  }

  /** Transforme le brouillon en correction ne contenant que les champs qui diffèrent de la lecture. */
  saveLineEdit(line: DisplayLine): void {
    if (this.editingIndex() !== line.index || !this.draftValid()) return;
    const original = this.session()?.extraction?.lines.find(l => l.index === line.index);
    if (!original) return;
    const d = this.draft;
    const previous = this.corrections().get(line.index);
    const next: StatementLineCorrection = { lineIndex: line.index };
    if (d.transactionDate !== (original.transactionDate ?? '').slice(0, 10)) next.transactionDate = d.transactionDate;
    const amount = Math.round(Number(d.amount) * 1000) / 1000;
    if (amount !== original.amount) next.amount = amount;
    if (d.isDebit !== original.isDebit) next.isDebit = d.isDebit;
    const label = d.label.trim();
    if (label !== original.label) next.label = label;
    if (previous?.exclude) next.exclude = true;
    this.corrections.update(map => {
      const copy = new Map(map);
      if (this.hasFieldChange(next) || next.exclude) copy.set(line.index, next);
      else copy.delete(line.index);
      return copy;
    });
    this.editingIndex.set(null);
  }

  toggleExclude(line: DisplayLine): void {
    if (!this.isEditable(line) || this.busy()) return;
    this.corrections.update(map => {
      const copy = new Map(map);
      const previous = copy.get(line.index);
      if (previous?.exclude) {
        const rest: StatementLineCorrection = { ...previous };
        delete rest.exclude;
        if (this.hasFieldChange(rest)) copy.set(line.index, rest);
        else copy.delete(line.index);
      } else {
        copy.set(line.index, { ...(previous ?? {}), lineIndex: line.index, exclude: true });
      }
      return copy;
    });
    if (this.editingIndex() === line.index) this.editingIndex.set(null);
  }

  /** Depuis un signalement « ligne à corriger » : ouvre la ligne en édition et la rend visible. */
  editLineFromIssue(lineIndex: number): void {
    const line = this.displayLines().find(l => l.index === lineIndex);
    if (!line || !this.isEditable(line) || line.excluded) return;
    const position = this.displayLines().indexOf(line);
    const table = this.linesTable;
    if (table && table.rows && position >= table.rows) table.first = Math.floor(position / table.rows) * table.rows;
    this.startLineEdit(line);
    if (typeof document !== 'undefined') {
      setTimeout(() => document.getElementById(`line-${lineIndex}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    }
  }

  private hasFieldChange(c: Partial<StatementLineCorrection>): boolean {
    return c.transactionDate !== undefined || c.amount !== undefined || c.isDebit !== undefined || c.label !== undefined;
  }

  /**
   * Retour au rapprochement : s'il reste un relevé du même fichier à contrôler, on l'ouvre (même
   * origine) ; sinon le rapprochement s'ouvre sur le premier relevé enregistré du fichier (ordre
   * chronologique). Cibles constantes : seul l'identifiant du relevé est transmis.
   */
  private returnToReconciliation(s: BankStatementImportSession, statementId: string, result?: ConfirmResult): void {
    const next = (s.siblings ?? []).find(x => !x.statementId && (x.status === 'AwaitingReview' || x.status === 'Extracting' || x.status === 'Pending'));
    if (next) {
      void this.router.navigate(['/accounting/bank-statement-import/session', next.id], {
        replaceUrl: true,
        queryParams: { from: 'reconciliation' }
      });
      return;
    }
    const saved = [{ segmentIndex: s.segmentIndex ?? 1, statementId }, ...(s.siblings ?? [])
      .filter(x => !!x.statementId)
      .map(x => ({ segmentIndex: x.segmentIndex, statementId: x.statementId as string }))];
    const first = saved.reduce((a, b) => (b.segmentIndex < a.segmentIndex ? b : a));
    void this.router.navigate(['/accounting/bank-reconciliation'], {
      replaceUrl: true,
      queryParams: { statementId: first.statementId },
      state: result ? { importedStatement: { lineCount: result.lineCount, alreadyImportedCount: result.alreadyImportedCount } } : undefined
    });
  }

  /**
   * Le relevé est lu par le service d'extraction documentaire externe, et par lui seul : ni modèle
   * vision local, ni modèle texte. Le moteur du plan vaut « vision » dans les DEUX cas — c'est le
   * fournisseur, pas le moteur, qui distingue les deux lectures, et les confondre fait annoncer
   * « l'IA » et « une à trois minutes par page » là où rien de tout cela n'a lieu.
   */
  viaDocStrange(s: BankStatementImportSession): boolean {
    return s.aiProviderKind === 'docstrange';
  }

  /** Durée estimée de la lecture IA restante (minutes, arrondie au supérieur) ; null sans estimation. */
  estimatedMinutes(s: BankStatementImportSession): number | null {
    const seconds = s.extraction?.aiPlan?.estimatedSeconds ?? 0;
    if (seconds <= 0) return null;
    const remaining = seconds * (1 - Math.min(100, Math.max(0, s.progressPercent)) / 100);
    return Math.max(1, Math.ceil(remaining / 60));
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
  readonly sessionFailureMessage = sessionFailureMessage;
  readonly sourceLabel = proposalSourceLabel;
  readonly diagnosticText = proposalDiagnosticMessage;

  /** Paramètres conservés dans les liens vers les autres relevés du fichier (origine connue seulement). */
  originQuery(): { from: 'reconciliation' } | null {
    return this.origin() === 'reconciliation' ? { from: 'reconciliation' } : null;
  }

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

  siblingBalanceMode(s: BankStatementImportSession): 'ok' | 'warning' | 'blocking' | null {
    const b = s.balanceCheck;
    if (!b) return null;
    if (b.isBalanced) return 'ok';
    return s.requiresBalanceAcknowledgement === true ? 'warning' : 'blocking';
  }

  siblingPreviewAria(sib: BankStatementImportSibling): string {
    return $localize`:@@accounting.bank-statement-import.ts.apercu.releve.frere:Aperçu du relevé ${sib.segmentIndex}:segmentIndex:`;
  }

  maskRib(rib: string | null): string {
    return rib ? `${rib.slice(0, 2)} … ${rib.slice(-4)}` : '—';
  }

  ribTail(rib: string): string {
    const digits = this.normalizeRibDigits(rib);
    return digits.length >= 4 ? digits.slice(-4) : '????';
  }

  private normalizeRibDigits(rib: string | null | undefined): string {
    return (rib ?? '').replace(/\D/g, '');
  }

  retargetToAccount(bankAccountId: string): void {
    const s = this.session();
    if (!s || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.api.retarget(s.id, bankAccountId).subscribe({
      next: next => {
        this.busy.set(false);
        void this.router.navigate(['/accounting/bank-statement-import/session', next.id], {
          queryParams: this.originQuery() ?? {},
          replaceUrl: true
        });
      },
      error: (err: unknown) => this.fail(err)
    });
  }

  methodLabel(s: BankStatementImportSession): string {
    if (this.hasIssue(s, 'statement.ai_unavailable', 'Blocking') || s.extractionMethod === 'none') {
      return $localize`:@@accounting.bank-statement-import.ts.lecture.ia.non.effectuee:Lecture IA non effectuée`;
    }
    // Le service d'extraction documentaire lit SEUL : aucune page n'est « lue en secours », et
    // aucune de ces lectures n'est le fait d'une IA — locale ou non. Les libellés qui suivent
    // parlent du service, sans jamais le nommer à l'utilisateur.
    if (this.viaDocStrange(s)) {
      switch (s.extractionMethod) {
        case 'ai-vision': {
          const count = s.pageCount ?? 0;
          if (count === 1) return $localize`:@@accounting.bank-statement-import.ts.lu.par.le.service.d.extraction.documentaire.1.pa.d281f138:Lu par le service d'extraction documentaire (1 page)`;
          if (count > 1) return $localize`:@@accounting.bank-statement-import.ts.lu.par.le.service.d.extraction.documentaire.page.d0085280:Lu par le service d'extraction documentaire (${String(count)}:count: pages)`;
          return $localize`:@@accounting.bank-statement-import.ts.lu.par.le.service.d.extraction.documentaire.27912217:Lu par le service d'extraction documentaire`;
        }
        case 'layout+ai':
          return $localize`:@@accounting.bank-statement-import.ts.lecture.directe.completee.par.le.service.d.extra.e232c028:Lecture directe complétée par le service d'extraction documentaire`;
        case 'ai':
        case 'ai-text':
          return $localize`:@@accounting.bank-statement-import.ts.lu.par.le.service.d.extraction.documentaire.27912217:Lu par le service d'extraction documentaire`;
        case 'layout':
          return $localize`:@@accounting.bank-statement-import.ts.lecture.directe.du.pdf.aucune.ia.ba300454:Lecture directe du PDF (aucune IA)`;
        default:
          return '—';
      }
    }

    switch (s.extractionMethod) {
      case 'ai-vision': {
        const fallback = this.fallbackPagesOf(s);
        if (fallback.length > 1) {
          const pages = this.pageList(fallback);
          return $localize`:@@accounting.bank-statement-import.ts.lu.par.l.ia.pages.lues.en.secours.9c5e1339:Lu par l'IA — pages ${pages}:pages: lues en secours`;
        }
        if (fallback.length === 1) {
          const page = String(fallback[0]);
          return $localize`:@@accounting.bank-statement-import.ts.lu.par.l.ia.page.lue.en.secours.6fa79a4c:Lu par l'IA — page ${page}:page: lue en secours`;
        }
        const count = s.pageCount ?? 0;
        if (count === 1) return $localize`:@@accounting.bank-statement-import.ts.lu.par.l.ia.1.page.0bb90ccc:Lu par l'IA (1 page)`;
        return $localize`:@@accounting.bank-statement-import.ts.lu.par.l.ia.pages.d44397d6:Lu par l'IA (${String(count)}:count: pages)`;
      }
      case 'ai-text':
        return $localize`:@@accounting.bank-statement-import.ts.lu.par.l.ia.sans.l.image.des.pages.21167785:Lu par l'IA, sans l'image des pages`;
      case 'layout':
        return $localize`:@@accounting.bank-statement-import.ts.lecture.directe.du.pdf.aucune.ia.ba300454:Lecture directe du PDF (aucune IA)`;
      case 'layout+ai':
        if (s.extraction?.aiPlan?.textPages?.length) {
          return s.aiProviderKind === 'external'
            ? $localize`:@@accounting.bank-statement-import.ts.lecture.directe.completee.par.une.ia.externe.b4615235:Lecture directe complétée par une IA externe`
            : $localize`:@@accounting.bank-statement-import.ts.lecture.directe.completee.par.l.ia.locale.bdf8d38c:Lecture directe complétée par l'IA locale`;
        }
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
    this.stopElapsedTimer();
    this.polling?.unsubscribe();
    if (err instanceof BankStatementImportError && err.status === 403) {
      this.error.set($localize`:@@accounting.bank-statement-import.ts.acces.refuse.vos.droits.ont.peut.etre.change.rec.68412fb2:Accès refusé : vos droits ont peut-être changé, reconnectez-vous.`);
      return;
    }
    this.error.set(importErrorMessage(err instanceof BankStatementImportError ? err.code : null));
  }
}
