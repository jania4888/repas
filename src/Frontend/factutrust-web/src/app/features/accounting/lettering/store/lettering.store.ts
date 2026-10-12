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
import { downloadBlob, exportExtension } from '../../shared/accounting-download.util';
import {
  LETTERING_ERROR_CODES,
  LETTERING_FUNCTIONAL_CURRENCY,
  LETTERING_SEARCH_MAX_LENGTH,
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
  /** Information neutre (zone `role="status"`), distincte du succès : p. ex. une complétion
   *  abandonnée par un rechargement des écritures. Effacée au chargement suivant et à toute action. */
  readonly info = signal<string | null>(null);

  // ── Sélection ──
  private readonly debitSelectedIds = signal<ReadonlySet<string>>(new Set<string>());
  private readonly creditSelectedIds = signal<ReadonlySet<string>>(new Set<string>());
  readonly allowPartial = signal(false);

  /**
   * Groupe partiel « P » en cours de complétion depuis le tiroir (« Compléter ce lettrage »), avec
   * TOUS ses membres. Indépendant des lignes chargées : avec le filtre par défaut « non lettrées »,
   * les membres du groupe ne sont pas dans `lines()`. Sans ce signal, ils seraient perdus et la
   * validation créerait un nouveau groupe au lieu de compléter le groupe P (correctif Qodex).
   * Les membres comptent toujours dans la sélection tant que la complétion est active.
   */
  readonly completionGroup = signal<LetteringGroup | null>(null);

  // ── Actions en cours ──
  readonly busyAction = signal<LetteringBusyAction>(null);
  /** Export du grand livre en cours (menu Actions). Distinct de `busyAction` : un export ne bloque
   *  pas la sélection ni la validation d'un lettrage. */
  readonly exporting = signal(false);

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

  private readonly completionMemberIds = computed(
    () => new Set<string>((this.completionGroup()?.lines ?? []).map(l => l.lineId))
  );

  /** Lignes chargées sélectionnées, plus tous les membres du groupe en cours de complétion (sans
   *  doublon). Sans complétion active, identique au comportement historique. */
  readonly selectedLines = computed(() => {
    const ids = this.selectedIds();
    const selected = this.lines().filter(l => ids.has(l.lineId));
    const completion = this.completionGroup();
    if (!completion) return selected;
    const seen = new Set(selected.map(l => l.lineId));
    const members = completion.lines.filter(l => !seen.has(l.lineId));
    return [...selected, ...members];
  });

  readonly summary = computed(() => computeSelectionSummary(this.selectedLines()));
  readonly guards = computed(() => selectionGuards(this.selectedLines(), this.completionMemberIds()));

  readonly debitPaneTotal = computed(() => paneTotal(this.debitLines(), 'debit'));
  readonly creditPaneTotal = computed(() => paneTotal(this.creditLines(), 'credit'));

  /** Totaux sélectionnés par volet. Calculés sur `selectedLines` pour inclure les membres d'un
   *  groupe en cours de complétion, même s'ils ne sont pas affichés (filtre « non lettrées »). */
  private readonly selectedBySide = computed(() => splitBySide(this.selectedLines()));
  readonly debitSelectedTotal = computed(() => paneTotal(this.selectedBySide().debit, 'debit'));
  readonly creditSelectedTotal = computed(() => paneTotal(this.selectedBySide().credit, 'credit'));

  readonly isPartialMode = computed(() => !this.summary().balanced && this.allowPartial());

  /**
   * Code du groupe « P » que la sélection courante complète (B1) : exactement un groupe partiel
   * représenté dans la sélection, et au moins une ligne de la sélection qui n'en fait pas déjà
   * partie (sinon « compléter » n'ajouterait rien). `null` sinon (lettrage normal, ou ambigu
   * avec plusieurs groupes partiels à la fois).
   */
  readonly completionTarget = computed<string | null>(() => {
    const completion = this.completionGroup();
    if (completion) {
      // Même garde-fou qu'hors complétion : un AUTRE groupe partiel dans la sélection rend la
      // cible ambiguë (le bandeau « plusieurs lettrages partiels » s'affiche alors).
      if (this.guards().partialGroupCodes.some(c => c !== completion.code)) return null;
      const hasNew = this.selectedLines().some(l => !this.completionMemberIds().has(l.lineId));
      return hasNew ? completion.code : null;
    }
    const codes = this.guards().partialGroupCodes;
    if (codes.length !== 1) return null;
    const [code] = codes;
    const hasNewLine = this.selectedLines().some(l => l.letteringCode !== code);
    return hasNewLine ? code : null;
  });

  readonly canLetter = computed(() => {
    const s = this.summary();
    const g = this.guards();
    if (this.completionGroup() !== null || this.completionTarget() !== null || g.partialGroupCodes.length >= 2) return false;
    return (
      s.count >= 2 &&
      (s.balanced || this.allowPartial()) &&
      !g.mixedCurrencies &&
      !g.multipleAccounts &&
      !g.lockedLines &&
      this.canCreate() &&
      this.busyAction() === null
    );
  });

  /** Garde-fous équivalents à `canLetter`, pour l'action « Compléter » (B1). */
  readonly canComplete = computed(() => {
    if (this.completionTarget() === null) return false;
    const g = this.guards();
    return !g.mixedCurrencies && !g.multipleAccounts && !g.lockedLines && this.canCreate() && this.busyAction() === null;
  });

  /** Désactivé pendant une complétion : « Équilibrer » enverrait aussi les membres déjà lettrés du
   *  groupe P, que le serveur refuserait (`LETTERING_ALREADY_LETTERED`). */
  readonly canSettleExchangeDifference = computed(
    () =>
      this.summary().hasExchangeDifference &&
      this.completionGroup() === null &&
      !this.guards().lockedLines &&
      this.canCreate() &&
      this.busyAction() === null
  );

  readonly busy = computed(() => this.loading() || this.busyAction() !== null);

  private loadSeq = 0;

  isSelected(id: string): boolean {
    return this.selectedIds().has(id) || this.completionMemberIds().has(id);
  }

  /**
   * Démarre la complétion d'un groupe partiel depuis le tiroir : garde le groupe et tous ses
   * membres dans le store, indépendamment des lignes chargées, puis vide la sélection des volets
   * pour que l'utilisateur y choisisse les lignes à ajouter.
   */
  startCompletion(group: LetteringGroup): void {
    if (!group.isPartial || group.lines.length === 0) return;
    this.completionGroup.set(group);
    this.debitSelectedIds.set(new Set());
    this.creditSelectedIds.set(new Set());
    this.error.set(null);
    this.success.set(null);
    this.info.set(null);
  }

  /**
   * Abandonne la complétion en cours : les membres du groupe sortent de la sélection, y compris
   * ceux affichés dans les volets (filtres « Toutes » / « Partiellement lettrées ») que les volets
   * auraient renvoyés dans leur sélection.
   */
  cancelCompletion(): void {
    const members = this.completionMemberIds();
    this.completionGroup.set(null);
    this.debitSelectedIds.update(ids => LetteringStore.without(ids, members));
    this.creditSelectedIds.update(ids => LetteringStore.without(ids, members));
  }

  /**
   * Remplace la sélection d'un seul volet (débit ou crédit), conserve l'autre. Pendant une
   * complétion, les membres du groupe ne sont jamais stockés ici : ils restent portés par
   * `completionGroup` (cochés et inclus tant que la complétion est active), sinon ils
   * survivraient à « Annuler la complétion ».
   */
  setPaneSelection(side: 'debit' | 'credit', ids: readonly string[]): void {
    const set = LetteringStore.without(new Set(ids), this.completionMemberIds());
    if (side === 'debit') {
      this.debitSelectedIds.set(set);
    } else {
      this.creditSelectedIds.set(set);
    }
    this.success.set(null);
  }

  private static without(ids: ReadonlySet<string>, excluded: ReadonlySet<string>): ReadonlySet<string> {
    if (excluded.size === 0) return ids;
    const next = new Set<string>();
    for (const id of ids) if (!excluded.has(id)) next.add(id);
    return next;
  }

  updateFilters(patch: Partial<LetteringFilters>): void {
    this.filters.update(f => ({ ...f, ...patch }));
  }

  reset(): void {
    this.completionGroup.set(null);
    this.debitSelectedIds.set(new Set());
    this.creditSelectedIds.set(new Set());
    this.allowPartial.set(false);
    this.error.set(null);
    this.success.set(null);
    this.info.set(null);
  }

  setAllowPartial(value: boolean): void {
    this.allowPartial.set(value);
  }

  /**
   * Charge les lignes selon les filtres courants. Ignore toute réponse devenue obsolète.
   * `onSuccess` est appelé uniquement après un chargement réussi (jamais en cas d'erreur ni de
   * réponse obsolète) : le conteneur s'en sert pour réécrire l'URL (M3), sans `effect()` réactif
   * qui s'exécuterait aussi en dehors des chargements explicites.
   */
  load(onSuccess?: () => void): void {
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
    this.info.set(null);

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
        search: f.search?.trim().slice(0, LETTERING_SEARCH_MAX_LENGTH) || undefined,
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
            // Un rechargement vide la sélection : une complétion encore active est donc abandonnée.
            // L'utilisateur en est informé (avant, elle disparaissait sans message).
            const dropped = this.completionGroup();
            if (dropped) {
              this.completionGroup.set(null);
              this.info.set(
                $localize`:@@accounting.lettering.store.info.completion.abandonnee:La complétion du lettrage ${dropped.code}:code: est annulée : les écritures ont été rechargées.`
              );
            }
            onSuccess?.();
          } else {
            // `ApiResponse.error` n'embarque pas de code métier (ce champ n'existe que sur les
            // réponses HTTP d'erreur 4xx/409, lues via `apiErrorCode` dans le bloc `error:`
            // ci-dessous) : ce message est déjà la chaîne renvoyée par le serveur.
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
    this.info.set(null);

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
          const message = this.translateError(err, $localize`:@@accounting.lettering.ts.erreur.reseau.lors.du.lettrage.1358d80e:Erreur réseau lors du lettrage.`);
          // Le rechargement (load()) remet error à null en entrée : on ne fixe le message
          // qu'une fois le rechargement lancé, pour qu'il ne soit pas effacé aussitôt.
          if (this.shouldReloadOnError(err)) this.load();
          this.error.set(message);
        }
      });
  }

  /** `onSuccess` n'est appelé qu'après une mise à l'équilibre réellement réussie : le conteneur
   *  s'en sert pour ne fermer la modale qu'au succès (jamais sur une erreur affichée dans la
   *  modale elle-même). */
  settle(accountNumber: string, onSuccess?: () => void): void {
    if (!this.canSettleExchangeDifference() || this.busyAction() !== null) return;
    const account = accountNumber.trim();
    if (!account) return;
    const ids = this.selectedLines().map(l => l.lineId);

    this.busyAction.set('settle');
    this.error.set(null);
    this.success.set(null);
    this.info.set(null);

    this.api
      .settleExchangeDifference(ids, account)
      .pipe(finalize(() => this.busyAction.set(null)))
      .subscribe({
        next: res => {
          if (res.success) {
            this.success.set(
              $localize`:@@accounting.lettering.ts.ecart.de.change.apure.sur.le.compte.acco.662b4773:Écart de change apuré sur le compte ${account}:account:, puis lettrage effectué.`
            );
            this.debitSelectedIds.set(new Set());
            this.creditSelectedIds.set(new Set());
            this.allowPartial.set(false);
            this.load();
            onSuccess?.();
          } else {
            this.error.set(res.error ?? $localize`:@@accounting.lettering.store.erreur.equilibrage:Erreur lors de l'équilibrage.`);
          }
        },
        error: err => {
          const message = this.translateError(err, $localize`:@@accounting.lettering.ts.erreur.reseau.lors.de.l.equilibrage.86743867:Erreur réseau lors de l'équilibrage.`);
          if (this.shouldReloadOnError(err)) this.load();
          this.error.set(message);
        }
      });
  }

  /**
   * Exporte au format Excel le grand livre du compte filtré, sur la période filtrée (plan §7.6),
   * via l'export existant `GET accounting/ledger/export` (droit lecture comptable). Sans effet si
   * aucun compte n'est saisi ou si un export est déjà en cours.
   */
  exportLedger(): void {
    const f = this.filters();
    const account = f.account.trim();
    if (!account || this.exporting()) return;
    const from = parseLocalDateString(f.from);
    const to = parseLocalDateString(f.to);
    const range = validateDateRange(from, to);
    if (!range.valid) {
      this.error.set(range.message ?? $localize`:@@accounting.lettering.store.dates.invalides:Dates invalides.`);
      return;
    }
    this.exporting.set(true);
    this.error.set(null);
    this.api
      .exportLedger(account, from, to, 'excel')
      .pipe(finalize(() => this.exporting.set(false)))
      .subscribe({
        next: blob => downloadBlob(blob, `grand_livre_${account}_${f.from}_${f.to}.${exportExtension('excel')}`),
        error: err =>
          this.error.set(
            this.errors.extractErrorMessage(
              err,
              $localize`:@@accounting.lettering.store.erreur.export.grand.livre:Erreur lors de l'export du grand livre.`
            )
          )
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
      message: $localize`:@@accounting.lettering.ts.delettrer.le.groupe.code.toutes.ses.lign.aa9895a9:Délettrer le groupe ${code}:code: ? Toutes ses lignes redeviendront lettrables.`,
      header: $localize`:@@accounting.lettering.ts.confirmation.de.delettrage.db4ca457:Confirmation de délettrage`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: $localize`:@@lettering.component.acceptLabel.Délettrer:Délettrer`,
      rejectLabel: $localize`:@@lettering.component.rejectLabel.Annuler:Annuler`,
      acceptButtonStyleClass: 'btn-danger',
      accept: () => {
        this.busyAction.set('unletter');
        this.error.set(null);
        this.success.set(null);
        this.info.set(null);

        this.api
          .unletterEntries(code)
          .pipe(finalize(() => this.busyAction.set(null)))
          .subscribe({
            next: res => {
              if (res.success) {
                this.success.set($localize`:@@accounting.lettering.ts.groupe.code.delettre.7a5b5fd3:Groupe ${code}:code: délettré.`);
                this.closeGroup();
                this.load();
              } else {
                this.error.set(res.error ?? $localize`:@@accounting.lettering.store.erreur.delettrage:Erreur lors du délettrage.`);
              }
            },
            error: err => {
              const message = this.translateError(err, $localize`:@@accounting.lettering.ts.erreur.reseau.lors.du.delettrage.ae259626:Erreur réseau lors du délettrage.`);
              if (this.shouldReloadOnError(err)) this.load();
              this.error.set(message);
            }
          });
      }
    });
  }

  /** Complète un lettrage partiel (D7) : ajoute à un groupe P existant les lignes sélectionnées
   *  qui n'en sont pas déjà membres. Le serveur recalcule l'équilibre sur membres + nouvelles
   *  lignes (contrat §5.4) : seules les nouvelles lignes sont envoyées. */
  complete(code: string): void {
    if (!code || this.busyAction() !== null || !this.canComplete() || this.completionTarget() !== code) return;
    const members = this.completionMemberIds();
    const ids = this.selectedLines()
      .filter(l => l.letteringCode !== code && !members.has(l.lineId))
      .map(l => l.lineId);
    if (ids.length === 0) return;
    const partial = this.isPartialMode();

    this.busyAction.set('complete');
    this.error.set(null);
    this.success.set(null);
    this.info.set(null);

    this.api
      .completePartialLettering(code, ids, partial)
      .pipe(finalize(() => this.busyAction.set(null)))
      .subscribe({
        next: res => {
          if (res.success && res.data) {
            this.success.set($localize`:@@accounting.lettering.store.lettrage.complete:Lettrage complété (code ${res.data.code}:code:).`);
            // Complétion terminée : ce n'est pas un abandon, le rechargement ne doit pas l'annoncer.
            this.completionGroup.set(null);
            this.debitSelectedIds.set(new Set());
            this.creditSelectedIds.set(new Set());
            this.allowPartial.set(false);
            this.closeGroup();
            this.load();
          } else {
            this.error.set(res.error ?? $localize`:@@accounting.lettering.store.erreur.completion:Erreur lors de la complétion du lettrage.`);
          }
        },
        error: err => {
          const message = this.translateError(err, $localize`:@@accounting.lettering.store.erreur.reseau.completion:Erreur réseau lors de la complétion du lettrage.`);
          if (this.shouldReloadOnError(err)) this.load();
          this.error.set(message);
        }
      });
  }

  /**
   * Recharge automatiquement la liste quand l'erreur reflète un état serveur désynchronisé de ce
   * que l'utilisateur voit (ligne déjà lettrée par quelqu'un d'autre) : la liste affichée redevient
   * cohérente sans action de l'utilisateur. `LETTERING_PERIOD_LOCKED` n'en fait PAS partie (plan
   * §4.6/§5.5) : le message s'affiche, la sélection est conservée et rien n'est rechargé.
   */
  private readonly RELOAD_ON_CODES: readonly string[] = [LETTERING_ERROR_CODES.alreadyLettered];

  private shouldReloadOnError(err: unknown): boolean {
    const code = apiErrorCode(err);
    return code !== undefined && this.RELOAD_ON_CODES.includes(code);
  }

  /** Centralise la traduction des 11 codes métier `LETTERING_*` (contrat §5) en messages FR. */
  private translateError(err: unknown, networkFallback: string): string {
    const code = apiErrorCode(err);
    switch (code) {
      case LETTERING_ERROR_CODES.validation:
        return $localize`:@@accounting.lettering.store.erreur.validation:Requête invalide.`;
      case LETTERING_ERROR_CODES.linesNotFound:
        return $localize`:@@accounting.lettering.store.erreur.lignes.introuvables:Une ou plusieurs lignes sont introuvables. La liste a été actualisée.`;
      case LETTERING_ERROR_CODES.alreadyLettered:
        return $localize`:@@accounting.lettering.store.erreur.deja.lettree:Une ligne est déjà lettrée. La liste a été actualisée.`;
      case LETTERING_ERROR_CODES.accountMismatch:
        return $localize`:@@accounting.lettering.store.erreur.compte.incoherent:Les lignes sélectionnées ne portent pas toutes sur le même compte.`;
      case LETTERING_ERROR_CODES.currencyMismatch:
        return $localize`:@@accounting.lettering.store.erreur.devise.incoherente:Les lignes sélectionnées ne sont pas dans la même devise.`;
      case LETTERING_ERROR_CODES.unbalanced:
        return $localize`:@@accounting.lettering.store.erreur.non.equilibre:La sélection n'est pas équilibrée (débit ≠ crédit).`;
      case LETTERING_ERROR_CODES.periodLocked:
        return $localize`:@@accounting.lettering.store.erreur.periode.cloturee.v2:Impossible : une ligne sélectionnée appartient à une période clôturée. Retirez-la de la sélection.`;
      case LETTERING_ERROR_CODES.groupNotFound:
        return $localize`:@@accounting.lettering.store.erreur.groupe.introuvable:Ce groupe de lettrage n'existe pas ou plus.`;
      case LETTERING_ERROR_CODES.groupNotPartial:
        return $localize`:@@accounting.lettering.store.erreur.groupe.non.partiel:Ce groupe n'est pas (ou plus) un lettrage partiel.`;
      case LETTERING_ERROR_CODES.exchangeDifference:
        return $localize`:@@accounting.lettering.store.erreur.ecart.de.change:La sélection présente un écart de change : utilisez « Équilibrer ».`;
      case LETTERING_ERROR_CODES.featureDisabled:
        return $localize`:@@accounting.lettering.store.erreur.fonctionnalite.desactivee:Cette fonctionnalité n'est pas activée.`;
      default:
        break;
    }
    if ((err as { status?: number } | null)?.status === 403) {
      return $localize`:@@accounting.lettering.store.erreur.droit.insuffisant:Droit insuffisant pour effectuer cette action.`;
    }
    return this.errors.extractErrorMessage(err, networkFallback);
  }
}
