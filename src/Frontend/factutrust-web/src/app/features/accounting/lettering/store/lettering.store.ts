import { Injectable, computed, inject, signal } from '@angular/core';
import { finalize } from 'rxjs';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { apiErrorCode } from '@core/utils/api-error-code';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import {
  AccountingService,
  LetteringGroupDto,
  LetteringLineDto
} from '../../services/accounting.service';
import { parseLocalDateString, validateDateRange } from '../../shared/accounting-date-utils';
import {
  LETTERING_ERROR_CODES,
  LETTERING_FUNCTIONAL_CURRENCY,
  LetteringBusyAction,
  LetteringFilters,
  LetteringGroup,
  LetteringLine,
  LetteringTotals,
  createDefaultLetteringFilters
} from '../models/lettering.models';
import { LETTERING_UNLETTER_PERMISSION } from '../lettering-permissions';
import { computeSelectionSummary, paneTotal, selectionGuards, splitBySide } from '../utils/lettering-selection';

const EMPTY_TOTALS: LetteringTotals = { count: 0, debitCount: 0, creditCount: 0, totalDebit: 0, totalCredit: 0 };

function mapLine(dto: LetteringLineDto): LetteringLine {
  return {
    lineId: dto.lineId,
    entryId: dto.entryId,
    entryDate: dto.entryDate,
    journalCode: dto.journalCode,
    entryNumber: dto.entryNumber,
    lineNumber: dto.lineNumber,
    accountNumber: dto.accountNumber,
    label: dto.label,
    entryLabel: dto.entryLabel,
    pieceRef: dto.pieceRef ?? null,
    documentType: dto.sourceCategory ?? null,
    thirdPartyId: dto.thirdPartyId ?? null,
    thirdPartyKind: dto.thirdPartyKind ?? null,
    thirdPartyName: dto.thirdPartyName ?? null,
    debit: dto.debit,
    credit: dto.credit,
    // Devise de l'opération : jamais la devise de tenue (contrat §4.1).
    currency: dto.operationCurrency ?? LETTERING_FUNCTIONAL_CURRENCY,
    debitInCurrency: dto.debitInCurrency ?? 0,
    creditInCurrency: dto.creditInCurrency ?? 0,
    letteringCode: dto.letteringCode ?? null,
    isPartiallyLettered: dto.isPartiallyLettered,
    isDraft: dto.isDraft,
    isReversed: dto.isReversed,
    isReversal: dto.isReversal,
    periodLocked: dto.periodLocked
  };
}

function mapGroup(dto: LetteringGroupDto): LetteringGroup {
  return {
    code: dto.code,
    accountNumber: dto.accountNumber,
    amount: dto.amount,
    currency: dto.operationCurrency ?? LETTERING_FUNCTIONAL_CURRENCY,
    isPartial: dto.isPartial,
    letteredAt: dto.letteredAt,
    createdByDisplayName: dto.createdByDisplayName ?? null,
    lines: dto.lines.map(mapLine),
    canUnletter: dto.canUnletter,
    unletterBlockedReason: dto.unletterBlockedReason ?? null,
    canComplete: dto.canComplete
  };
}

/**
 * État et actions de l'écran de lettrage (Phase 2). `@Injectable()` (pas `providedIn: 'root'`) :
 * fourni par `lettering.component.ts` (`providers: [LetteringStore]`), suivant le patron
 * `EntryFormStore`. Toute la logique de calcul pur (équilibre, garde-fous) vit dans
 * `utils/lettering-selection.ts` ; ce store ne fait que l'orchestration HTTP + sélection.
 */
@Injectable()
export class LetteringStore {
  private readonly api = inject(AccountingService);
  private readonly auth = inject(AuthService);
  private readonly errors = inject(ErrorHandlerService);
  private readonly confirmation = inject(ConfirmationService);

  // ── Filtres et résultat du dernier chargement ──
  readonly filters = signal<LetteringFilters>(createDefaultLetteringFilters('', ''));
  readonly lines = signal<readonly LetteringLine[]>([]);
  readonly totals = signal<LetteringTotals>(EMPTY_TOTALS);
  readonly truncated = signal(false);
  readonly loadedOnce = signal(false);

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly success = signal<string | null>(null);

  // ── Sélection ──
  private readonly debitSelectedIds = signal<ReadonlySet<string>>(new Set<string>());
  private readonly creditSelectedIds = signal<ReadonlySet<string>>(new Set<string>());
  readonly allowPartial = signal(false);

  // ── Actions en cours ──
  readonly busyAction = signal<LetteringBusyAction>(null);

  // ── Tiroir du groupe ──
  readonly group = signal<LetteringGroup | null>(null);
  readonly groupLoading = signal(false);
  readonly groupError = signal<string | null>(null);

  // ── Droits ──
  readonly canCreate = computed(() => this.auth.hasPermission(PERMISSIONS.accounting.create));
  readonly canUnletter = computed(() => this.auth.hasPermission(LETTERING_UNLETTER_PERMISSION));

  // ── Dérivés ──
  readonly debitLines = computed(() => splitBySide(this.lines()).debit);
  readonly creditLines = computed(() => splitBySide(this.lines()).credit);

  private readonly selectedIds = computed(() => {
    const merged = new Set<string>(this.debitSelectedIds());
    for (const id of this.creditSelectedIds()) merged.add(id);
    return merged;
  });

  readonly selectedLines = computed(() => {
    const ids = this.selectedIds();
    return this.lines().filter(l => ids.has(l.lineId));
  });

  readonly summary = computed(() => computeSelectionSummary(this.selectedLines()));
  readonly guards = computed(() => selectionGuards(this.selectedLines()));

  readonly debitPaneTotal = computed(() => paneTotal(this.debitLines(), 'debit'));
  readonly creditPaneTotal = computed(() => paneTotal(this.creditLines(), 'credit'));

  readonly debitSelectedTotal = computed(() => {
    const ids = this.debitSelectedIds();
    return paneTotal(this.debitLines().filter(l => ids.has(l.lineId)), 'debit');
  });
  readonly creditSelectedTotal = computed(() => {
    const ids = this.creditSelectedIds();
    return paneTotal(this.creditLines().filter(l => ids.has(l.lineId)), 'credit');
  });

  readonly isPartialMode = computed(() => !this.summary().balanced && this.allowPartial());

  readonly canLetter = computed(() => {
    const s = this.summary();
    const g = this.guards();
    return (
      s.count >= 2 &&
      (s.balanced || this.allowPartial()) &&
      !g.mixedCurrencies &&
      !g.multipleAccounts &&
      this.canCreate() &&
      this.busyAction() === null
    );
  });

  readonly canSettleExchangeDifference = computed(
    () => this.summary().hasExchangeDifference && this.canCreate() && this.busyAction() === null
  );

  readonly busy = computed(() => this.loading() || this.busyAction() !== null);

  private loadSeq = 0;

  isSelected(id: string): boolean {
    return this.selectedIds().has(id);
  }

  /** Remplace la sélection d'un seul volet (débit ou crédit), conserve l'autre. */
  setPaneSelection(side: 'debit' | 'credit', ids: readonly string[]): void {
    const set = new Set(ids);
    if (side === 'debit') {
      this.debitSelectedIds.set(set);
    } else {
      this.creditSelectedIds.set(set);
    }
    this.success.set(null);
  }

  updateFilters(patch: Partial<LetteringFilters>): void {
    this.filters.update(f => ({ ...f, ...patch }));
  }

  reset(): void {
    this.debitSelectedIds.set(new Set());
    this.creditSelectedIds.set(new Set());
    this.allowPartial.set(false);
    this.error.set(null);
    this.success.set(null);
  }

  setAllowPartial(value: boolean): void {
    this.allowPartial.set(value);
  }

  /** Charge les lignes selon les filtres courants. Ignore toute réponse devenue obsolète. */
  load(): void {
    const f = this.filters();
    if (!f.account) {
      this.error.set($localize`:@@accounting.lettering.store.compte.obligatoire:Le compte est obligatoire.`);
      return;
    }
    const range = validateDateRange(parseLocalDateString(f.from), parseLocalDateString(f.to));
    if (!range.valid) {
      this.error.set(range.message ?? $localize`:@@accounting.lettering.store.dates.invalides:Dates invalides.`);
      return;
    }

    const seq = ++this.loadSeq;
    this.loading.set(true);
    this.error.set(null);

    this.api
      .getLetteringLines({
        account: f.account,
        accountMatch: f.accountMatch,
        from: f.from,
        to: f.to,
        state: f.state,
        journalCode: f.journalCode ?? undefined,
        sourceCategories: f.documentType ? [f.documentType] : undefined,
        thirdPartyId: f.thirdParty?.id ?? undefined,
        thirdPartyKind: f.thirdParty?.kind ?? undefined,
        minAmount: f.minAmount ?? undefined,
        maxAmount: f.maxAmount ?? undefined,
        page: 1,
        pageSize: 2000
      })
      .pipe(
        finalize(() => {
          if (seq === this.loadSeq) this.loading.set(false);
        })
      )
      .subscribe({
        next: res => {
          if (seq !== this.loadSeq) return;
          if (res.success && res.data) {
            this.lines.set(res.data.items.map(mapLine));
            this.totals.set({
              count: res.data.totals.count,
              debitCount: res.data.totals.debitCount,
              creditCount: res.data.totals.creditCount,
              totalDebit: res.data.totals.totalDebit,
              totalCredit: res.data.totals.totalCredit
            });
            this.truncated.set(res.data.truncated);
            this.loadedOnce.set(true);
            this.debitSelectedIds.set(new Set());
            this.creditSelectedIds.set(new Set());
          } else {
            this.error.set(
              res.error ?? $localize`:@@accounting.lettering.store.erreur.chargement:Erreur lors du chargement des écritures.`
            );
          }
        },
        error: err => {
          if (seq !== this.loadSeq) return;
          this.error.set(this.translateError(err, $localize`:@@accounting.lettering.store.erreur.reseau.chargement:Erreur réseau lors du chargement.`));
        }
      });
  }

  letter(): void {
    if (!this.canLetter() || this.busyAction() !== null) return;
    const ids = this.selectedLines().map(l => l.lineId);
    const partial = this.isPartialMode();

    this.busyAction.set('letter');
    this.error.set(null);
    this.success.set(null);

    this.api
      .letterEntries(ids, partial)
      .pipe(finalize(() => this.busyAction.set(null)))
      .subscribe({
        next: res => {
          if (res.success && res.data) {
            this.success.set(
              partial
                ? $localize`:@@accounting.lettering.store.lettrage.partiel:Lettrage partiel effectué (code ${res.data.code}:code:).`
                : $localize`:@@accounting.lettering.store.lettrage.succes:Lettrage effectué avec succès (code ${res.data.code}:code:).`
            );
            this.debitSelectedIds.set(new Set());
            this.creditSelectedIds.set(new Set());
            this.allowPartial.set(false);
            this.load();
          } else {
            this.error.set(res.error ?? $localize`:@@accounting.lettering.store.erreur.lettrage:Erreur lors du lettrage.`);
          }
        },
        error: err => {
          const message = this.translateError(err, $localize`:@@accounting.lettering.store.erreur.reseau.lettrage:Erreur réseau lors du lettrage.`);
          // Le rechargement (load()) remet error à null en entrée : on ne fixe le message
          // qu'une fois le rechargement lancé, pour qu'il ne soit pas effacé aussitôt.
          if (apiErrorCode(err) === LETTERING_ERROR_CODES.alreadyLettered) this.load();
          this.error.set(message);
        }
      });
  }

  settle(accountNumber: string): void {
    if (!this.canSettleExchangeDifference() || this.busyAction() !== null) return;
    const account = accountNumber.trim();
    if (!account) return;
    const ids = this.selectedLines().map(l => l.lineId);

    this.busyAction.set('settle');
    this.error.set(null);
    this.success.set(null);

    this.api
      .settleExchangeDifference(ids, account)
      .pipe(finalize(() => this.busyAction.set(null)))
      .subscribe({
        next: res => {
          if (res.success) {
            this.success.set(
              $localize`:@@accounting.lettering.store.ecart.change.apure:Écart de change apuré sur le compte ${account}:account:, puis lettrage effectué.`
            );
            this.debitSelectedIds.set(new Set());
            this.creditSelectedIds.set(new Set());
            this.allowPartial.set(false);
            this.load();
          } else {
            this.error.set(res.error ?? $localize`:@@accounting.lettering.store.erreur.equilibrage:Erreur lors de l'équilibrage.`);
          }
        },
        error: err => this.error.set(this.translateError(err, $localize`:@@accounting.lettering.store.erreur.reseau.equilibrage:Erreur réseau lors de l'équilibrage.`))
      });
  }

  openGroup(code: string): void {
    this.group.set(null);
    this.groupError.set(null);
    this.groupLoading.set(true);

    this.api
      .getLetteringGroup(code)
      .pipe(finalize(() => this.groupLoading.set(false)))
      .subscribe({
        next: res => {
          if (res.success && res.data) {
            this.group.set(mapGroup(res.data));
          } else {
            this.groupError.set(res.error ?? $localize`:@@accounting.lettering.store.erreur.groupe:Erreur lors du chargement du groupe.`);
          }
        },
        error: err => this.groupError.set(this.translateError(err, $localize`:@@accounting.lettering.store.erreur.reseau.groupe:Erreur réseau lors du chargement du groupe.`))
      });
  }

  closeGroup(): void {
    this.group.set(null);
    this.groupError.set(null);
  }

  unletter(code: string): void {
    if (!code || this.busyAction() !== null) return;
    this.confirmation.confirm({
      message: $localize`:@@accounting.lettering.store.confirm.delettrer:Délettrer le groupe ${code}:code: ? Toutes ses lignes redeviendront lettrables.`,
      header: $localize`:@@accounting.lettering.store.confirm.header:Confirmation de délettrage`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: $localize`:@@accounting.lettering.store.confirm.accept:Délettrer`,
      rejectLabel: $localize`:@@accounting.lettering.store.confirm.reject:Annuler`,
      acceptButtonStyleClass: 'btn-danger',
      accept: () => {
        this.busyAction.set('unletter');
        this.error.set(null);
        this.success.set(null);

        this.api
          .unletterEntries(code)
          .pipe(finalize(() => this.busyAction.set(null)))
          .subscribe({
            next: res => {
              if (res.success) {
                this.success.set($localize`:@@accounting.lettering.store.groupe.delettre:Groupe ${code}:code: délettré.`);
                this.closeGroup();
                this.load();
              } else {
                this.error.set(res.error ?? $localize`:@@accounting.lettering.store.erreur.delettrage:Erreur lors du délettrage.`);
              }
            },
            error: err => this.error.set(this.translateError(err, $localize`:@@accounting.lettering.store.erreur.reseau.delettrage:Erreur réseau lors du délettrage.`))
          });
      }
    });
  }

  /** Complète un lettrage partiel (D7) : ajoute les lignes sélectionnées au groupe P existant. */
  complete(code: string): void {
    if (!code || this.busyAction() !== null) return;
    const ids = this.selectedLines().map(l => l.lineId);
    if (ids.length === 0) return;
    const partial = this.isPartialMode();

    this.busyAction.set('complete');
    this.error.set(null);
    this.success.set(null);

    this.api
      .completePartialLettering(code, ids, partial)
      .pipe(finalize(() => this.busyAction.set(null)))
      .subscribe({
        next: res => {
          if (res.success && res.data) {
            this.success.set($localize`:@@accounting.lettering.store.lettrage.complete:Lettrage complété (code ${res.data.code}:code:).`);
            this.debitSelectedIds.set(new Set());
            this.creditSelectedIds.set(new Set());
            this.allowPartial.set(false);
            this.closeGroup();
            this.load();
          } else {
            this.error.set(res.error ?? $localize`:@@accounting.lettering.store.erreur.completion:Erreur lors de la complétion du lettrage.`);
          }
        },
        error: err => this.error.set(this.translateError(err, $localize`:@@accounting.lettering.store.erreur.reseau.completion:Erreur réseau lors de la complétion du lettrage.`))
      });
  }

  private translateError(err: unknown, networkFallback: string): string {
    const code = apiErrorCode(err);
    if (code === LETTERING_ERROR_CODES.periodLocked) {
      return $localize`:@@accounting.lettering.store.erreur.periode.cloturee:Impossible : la période est clôturée.`;
    }
    if (code === LETTERING_ERROR_CODES.alreadyLettered) {
      return $localize`:@@accounting.lettering.store.erreur.deja.lettree:Une ligne est déjà lettrée. La liste a été actualisée.`;
    }
    if ((err as { status?: number } | null)?.status === 403) {
      return $localize`:@@accounting.lettering.store.erreur.droit.insuffisant:Droit insuffisant pour effectuer cette action.`;
    }
    return this.errors.extractErrorMessage(err, networkFallback);
  }
}
