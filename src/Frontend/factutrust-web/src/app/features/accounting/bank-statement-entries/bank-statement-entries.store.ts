import { Injectable, computed, inject, signal } from '@angular/core';
import { catchError, of } from 'rxjs';
import { AccountingService } from '../services/accounting.service';
import { AccountingJournalCatalogService } from '../shared/accounting-journal-catalog.service';
import { AccountingJournalTab } from '../shared/accounting-journal-tabs.model';
import { BankAccountDto } from '@core/services/bank-account.service';
import {
  BankLineProposal,
  BankStatementImportCapabilities,
  BankStatementImportHistoryItem,
  BankStatementProposals,
  BankStatementTabularMapping,
  BankStatementTabularPreview
} from '../bank-statement-import/bank-statement-import.models';
import { ReviewRowLike, isSettledRow, toReviewRow } from '../bank-statement-import/bank-statement-posting.logic';
import { tabularMappingRolesFilled } from '../bank-statement-import/bank-statement-tabular-mapping.logic';

export type BankStatementEntriesFileKind = 'document' | 'tabular';

/** Filtre de la grille de contreparties (étape 4). */
export type EntriesRowFilter = 'all' | 'todo' | 'at471' | 'proposed' | 'settled' | 'rejected';

/** `ReviewRowLike` + libellé d'écriture éditable (propre à cette page, ≤ 500 caractères, vide = libellé du relevé). */
export interface EntriesRow extends ReviewRowLike {
  label: string;
  /** Vrai si cette ligne a été refusée par une génération atomique précédente (à corriger avant de relancer). */
  needsCorrection: boolean;
}

/**
 * État de la page dédiée « Relevé bancaire → écritures », sans rapprochement. Chaque conteneur
 * (Source, Session, Écritures) en reçoit sa propre instance (`providers: [BankStatementEntriesStore]`)
 * et met à jour l'état par remplacement (jamais de mutation en place des tableaux/objets).
 */
@Injectable()
export class BankStatementEntriesStore {
  private readonly accounting = inject(AccountingService);
  private readonly journalCatalog = inject(AccountingJournalCatalogService);

  // ── Étape 1 : source ──────────────────────────────────────────────────────────────────────
  readonly capabilities = signal<BankStatementImportCapabilities | null>(null);
  readonly bankAccounts = signal<BankAccountDto[]>([]);
  readonly bankAccountsLoaded = signal(false);
  readonly bankAccountsError = signal(false);
  readonly journals = signal<AccountingJournalTab[]>([]);
  readonly bankAccountId = signal<string | null>(null);
  readonly journalCode = signal<string>('JB');
  readonly file = signal<File | null>(null);
  readonly fileKind = signal<BankStatementEntriesFileKind | null>(null);
  readonly sourceError = signal<string | null>(null);
  readonly submitting = signal(false);

  readonly selectedAccount = computed<BankAccountDto | null>(() => {
    const id = this.bankAccountId();
    return id ? this.bankAccounts().find(a => a.id === id) ?? null : null;
  });

  readonly isDinarAccount = (account: BankAccountDto | null): boolean => (account?.currency ?? 'TND') === 'TND';

  /** Compte éligible pour cette comptabilisation : relié à un plan comptable 532 ET en dinars. */
  isEligible(account: BankAccountDto | null): boolean {
    return !!account?.chartOfAccountNumber && this.isDinarAccount(account);
  }

  readonly hasEligibleAccount = computed(() => this.bankAccounts().some(a => this.isEligible(a)));

  readonly canSubmitSource = computed(() => {
    const account = this.selectedAccount();
    const file = this.file();
    return this.isEligible(account) && !!this.journalCode() && !!file && !this.submitting();
  });

  loadSourceReferences(): void {
    this.accounting.ensureBankGlProjections().pipe(catchError(() => of(null))).subscribe(() => {
      this.accounting.listImportableBankAccounts().subscribe({
        next: res => {
          const accounts = (res?.data ?? [])
            .filter(a => a.isActive)
            .map<BankAccountDto>(a => ({
              id: a.id,
              companyId: '',
              bankCode: '',
              bankName: a.bankName,
              designation: a.designation ?? null,
              agencyName: null,
              rib: '',
              iban: '',
              swiftBic: null,
              isDefault: a.isDefault,
              isActive: a.isActive,
              chartOfAccountNumber: a.chartOfAccountNumber,
              currency: a.currency,
              hasBankingIdentity: a.hasBankingIdentity
            }));
          this.bankAccounts.set(accounts);
          this.bankAccountsLoaded.set(true);
          if (!this.bankAccountId()) {
            const preferred = accounts.find(a => a.isDefault && this.isEligible(a)) ?? accounts.find(a => this.isEligible(a)) ?? null;
            if (preferred) this.bankAccountId.set(preferred.id);
          }
        },
        error: () => {
          this.bankAccountsError.set(true);
          this.bankAccountsLoaded.set(true);
        }
      });
    });

    this.journalCatalog.listBankJournals().subscribe(bankJournals => {
      this.journals.set([...bankJournals]);
      if (!bankJournals.some(j => j.code === this.journalCode())) {
        this.journalCode.set(bankJournals[0]?.code ?? 'JB');
      }
    });
  }

  /**
   * Charge le code de journal transmis par l'étape précédente (session → contreparties) et le
   * valide contre les journaux de banque actifs du dossier ; retombe sur `JB` si absent ou invalide.
   */
  loadJournalCode(requested: string | null): void {
    this.journalCode.set(requested ?? 'JB');
    this.journalCatalog.listBankJournals().subscribe(bankJournals => {
      this.journals.set([...bankJournals]);
      if (!bankJournals.some(j => j.code === this.journalCode())) {
        this.journalCode.set(bankJournals[0]?.code ?? 'JB');
      }
    });
  }

  setFile(file: File | null, kind: BankStatementEntriesFileKind | null): void {
    this.file.set(file);
    this.fileKind.set(kind);
    this.sourceError.set(null);
    if (kind !== 'tabular') {
      this.mapping.set(null);
      this.tabularPreview.set(null);
    }
  }

  // ── Étape 2 : mappage CSV/XLSX ───────────────────────────────────────────────────────────
  readonly tabularPreview = signal<BankStatementTabularPreview | null>(null);
  readonly tabularPreviewLoading = signal(false);
  readonly tabularPreviewError = signal<string | null>(null);
  readonly mapping = signal<BankStatementTabularMapping | null>(null);
  readonly rememberMapping = signal(false);

  /** Rôles obligatoires associés (date, libellé, montant) ET un solde exploitable (D1, plan §9.1). */
  readonly mappingRequiredRolesFilled = computed(() => tabularMappingRolesFilled(this.mapping()));

  /** Remplace le mappage en entier (nouvelle référence) : jamais de mutation d'un champ isolé. */
  updateMapping(patch: Partial<BankStatementTabularMapping>): void {
    const current = this.mapping();
    if (!current) return;
    this.mapping.set({ ...current, ...patch });
  }

  // ── Historique ────────────────────────────────────────────────────────────────────────────
  readonly historyItems = signal<BankStatementImportHistoryItem[]>([]);
  readonly historyPage = signal(1);
  readonly historyPageSize = signal(20);
  readonly historyTotal = signal(0);
  readonly historyLoading = signal(false);

  // ── Étape 4 : contreparties ───────────────────────────────────────────────────────────────
  readonly proposals = signal<BankStatementProposals | null>(null);
  readonly rows = signal<EntriesRow[]>([]);
  readonly rowFilter = signal<EntriesRowFilter>('all');

  readonly visibleRows = computed(() => {
    const filter = this.rowFilter();
    const rows = this.rows();
    switch (filter) {
      case 'todo':
        return rows.filter(r => !isSettledRow(r) && (!r.account || r.proposal.status === 'ToComplete'));
      case 'at471':
        return rows.filter(r => r.proposal.source === 'Fallback');
      case 'proposed':
        return rows.filter(r => !isSettledRow(r) && r.proposal.status === 'Proposed');
      case 'settled':
        return rows.filter(r => isSettledRow(r));
      case 'rejected':
        return rows.filter(r => r.needsCorrection);
      default:
        return rows;
    }
  });

  readonly selectedCount = computed(() => this.rows().filter(r => r.selected).length);

  /** Remplace la liste des propositions reçue du serveur par ses lignes éditables (D2). */
  setProposals(proposals: BankStatementProposals): void {
    this.proposals.set(proposals);
    this.rows.set(proposals.lines.map(toReviewRow).map(r => ({ ...r, label: '', needsCorrection: false })));
  }

  /** Marque les lignes refusées par une génération atomique précédente (plan §4.4 étape 4 — à corriger). */
  markNeedsCorrection(lineIds: readonly string[]): void {
    const ids = new Set(lineIds);
    this.rows.set(this.rows().map(r => (ids.has(r.proposal.lineId) ? { ...r, needsCorrection: true } : r)));
  }

  /** Remplace UNE ligne par une nouvelle valeur (jamais de mutation en place). */
  updateRow(lineId: string, patch: Partial<EntriesRow>): void {
    this.rows.set(this.rows().map(r => (r.proposal.lineId === lineId ? { ...r, ...patch } : r)));
  }

  setRowSelected(lineId: string, selected: boolean): void {
    this.updateRow(lineId, { selected });
  }

  selectAllVisible(selected: boolean): void {
    const visibleIds = new Set(this.visibleRows().filter(r => !isSettledRow(r) && r.proposal.status !== 'Blocked').map(r => r.proposal.lineId));
    this.rows.set(this.rows().map(r => (visibleIds.has(r.proposal.lineId) ? { ...r, selected } : r)));
  }

  // ── Étape 5 : résultat ────────────────────────────────────────────────────────────────────
  readonly atomicRejected = signal(false);
  readonly rejectedOutcomes = signal<ReadonlyArray<{ lineId: string; code: string | null; message: string | null }>>([]);

  failedProposal(lineId: string): BankLineProposal | undefined {
    return this.proposals()?.lines.find(l => l.lineId === lineId);
  }
}
