import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, Subject, catchError, debounceTime, defer, finalize, map, of, switchMap } from 'rxjs';
import { apiErrorCode } from '@core/utils/api-error-code';
import { ConfirmationService } from '@core/services/confirmation.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { AccountingFeatureFlagsService } from '../../shared/accounting-feature-flags.service';
import {
  AccountingService,
  BulkLetterGroupRequest,
  BulkLetteringResultDto,
  LetteringSuggestionTruncationReason,
  LetteringSuggestionsResultDto
} from '../../services/accounting.service';
import { LETTERING_ERROR_CODES, LetteringFilters } from '../models/lettering.models';
import { LETTERING_SUGGESTIONS_MAX, LetteringSuggestion } from '../models/lettering-suggestions.models';
import {
  bulkAccounts,
  bulkGroups,
  bulkLineCount,
  bulkTotalsByCurrency,
  canAddToBulk,
  defaultBulkSelection,
  isBulkCandidate,
  mapSuggestion,
  topSuggestions
} from '../utils/lettering-suggestions';
import { splitBySide } from '../utils/lettering-selection';
import { shouldReloadOnLetteringError, translateLetteringError } from '../utils/lettering-errors';
import { LetteringStore } from './lettering.store';

/** Délai d'anti-rebond des recalculs (filtres modifiés, rechargements en rafale). */
export const LETTERING_SUGGESTIONS_DEBOUNCE_MS = 300;

/** Résultat de `select()` : l'écran affiche un message adapté quand la sélection n'a pas eu lieu. */
export type LetteringSuggestionSelectResult = 'selected' | 'linesNotVisible' | 'busy';

interface SelectionSnapshot {
  debit: string[];
  credit: string[];
}

type SuggestionsOutcome = { seq: number } & (
  | { kind: 'ok'; data: LetteringSuggestionsResultDto }
  | { kind: 'error'; err: unknown; message: string | null }
);

interface RefreshRequest {
  seq: number;
  filters: LetteringFilters;
}

/** Un lot envoyé : rejouable à l'identique (même `requestId`, mêmes groupes) après une coupure. */
interface BulkAttempt {
  requestId: string;
  groups: BulkLetterGroupRequest[];
}

/**
 * Nouvel identifiant de lot (UUID v4). `crypto.randomUUID` n'existe qu'en contexte sécurisé (HTTPS
 * ou localhost) : sinon, même format construit avec `crypto.getRandomValues`.
 */
export function newBulkRequestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * État des propositions de lettrage (plan v2, Phase 3, annexe C §5). Store séparé de
 * `LetteringStore` pour ne pas l'alourdir ; fourni par `LetteringComponent` à côté de lui.
 *
 * Règles :
 * - aucun appel si le drapeau front `letteringProposals` est éteint (défaut) ; la réponse
 *   `LETTERING_FEATURE_DISABLED` (drapeau serveur éteint) masque le panneau (`hidden`) et coupe
 *   tout appel ultérieur ; la requête ne déclenche jamais le toast d'erreur global ;
 * - les propositions portent sur les filtres du dernier chargement réussi (`loadedFilters`),
 *   jamais sur le brouillon des filtres ;
 * - pendant un recalcul (`pending`), la liste affichée est périmée : « Valider » est désactivé ;
 *   une réponse partie avant une validation réussie est ignorée (la proposition ne revient pas) ;
 * - recalcul après chaque chargement réussi de `LetteringStore` (`reloadSeq`, observé ici) ; anti-rebond de 300 ms et `switchMap` : seule la dernière réponse compte ;
 * - « Valider » passe par `POST letter` avec `origin = 'Suggestion'` et la clé, puis recharge
 *   l'écran (ce qui recalcule les propositions) ;
 * - « Sélectionner » remplace la sélection des deux volets, avec un retour arrière (`undoSelect`).
 */
@Injectable()
export class LetteringSuggestionsStore {
  private readonly api = inject(AccountingService);
  private readonly confirmation = inject(ConfirmationService);
  private readonly errors = inject(ErrorHandlerService);
  private readonly lettering = inject(LetteringStore);
  private readonly flags = inject(AccountingFeatureFlagsService);

  readonly suggestions = signal<readonly LetteringSuggestion[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly truncated = signal(false);
  readonly truncationReason = signal<LetteringSuggestionTruncationReason | null>(null);
  readonly totalFound = signal(0);
  /** Vrai après `LETTERING_FEATURE_DISABLED` : le panneau disparaît et plus aucun appel ne part. */
  readonly hidden = signal(false);
  /** Vrai entre une demande de recalcul et sa réponse : la liste affichée est périmée. */
  readonly pending = signal(false);
  /** Clé de la proposition en cours de validation (bouton désactivé + indicateur). */
  readonly busyKey = signal<string | null>(null);

  readonly bulkDialogOpen = signal(false);
  readonly bulkSelection = signal<ReadonlySet<string>>(new Set<string>());
  /** Rapport du dernier lot (rempli par `runBulk`). */
  readonly bulkResult = signal<BulkLetteringResultDto | null>(null);
  /** Vrai pendant `POST lettering/bulk`. */
  readonly bulkRunning = signal(false);
  /** Message d'échec du lot entier (aucun rapport reçu). */
  readonly bulkError = signal<string | null>(null);
  /**
   * Lot à rejouer après une coupure réseau, une erreur serveur (5xx) ou un 409 (même lot en cours) :
   * le serveur renvoie le rapport en cache ou classe les groupes déjà faits « Déjà lettré ».
   */
  private readonly bulkRetry = signal<BulkAttempt | null>(null);
  readonly canRetryBulk = computed(() => this.bulkRetry() !== null && !this.bulkRunning() && !this.lettering.busy());

  private readonly snapshot = signal<SelectionSnapshot | null>(null);
  readonly canUndoSelect = computed(() => this.snapshot() !== null);

  readonly topSuggestions = computed(() => topSuggestions(this.suggestions()));
  readonly bulkEligible = computed(() => this.suggestions().filter(isBulkCandidate));
  readonly bulkTotalsByCurrency = computed(() => bulkTotalsByCurrency(this.suggestions(), this.bulkSelection()));
  readonly bulkLineCount = computed(() => bulkLineCount(this.suggestions(), this.bulkSelection()));
  readonly bulkAccounts = computed(() => bulkAccounts(this.suggestions(), this.bulkSelection()));
  /** Propositions cochées encore présentes dans la liste (une clé disparue ne compte pas). */
  readonly bulkSelectedCount = computed(() => {
    const keys = this.bulkSelection();
    return this.suggestions().filter(s => keys.has(s.key)).length;
  });
  /** Envoi possible : droit, aucune action en cours, liste à jour, au moins une proposition cochée. */
  readonly canRunBulk = computed(
    () =>
      this.lettering.canCreate() &&
      !this.bulkRunning() &&
      this.busyKey() === null &&
      !this.lettering.busy() &&
      !this.pending() &&
      this.bulkResult() === null &&
      this.bulkSelectedCount() > 0
  );
  readonly canValidate = computed(
    () => this.lettering.canCreate() && this.busyKey() === null && !this.lettering.busy() && !this.pending()
  );

  private readonly refresh$ = new Subject<RefreshRequest | null>();
  /** Numéro de la dernière demande de recalcul. */
  private requestSeq = 0;
  /** Les réponses de numéro inférieur sont ignorées (relevé après une validation réussie). */
  private acceptFrom = 0;

  constructor() {
    this.refresh$
      .pipe(
        debounceTime(LETTERING_SUGGESTIONS_DEBOUNCE_MS),
        switchMap(request => (request ? this.fetch(request) : of(null))),
        takeUntilDestroyed(inject(DestroyRef))
      )
      .subscribe(outcome => {
        if (outcome) this.apply(outcome);
      });

    // Recalcul après chaque chargement réussi de l'écran (filtres appliqués, lettrage, délettrage,
    // complétion). `reloadSeq` vaut 0 avant le premier chargement : aucun appel à l'ouverture.
    // L'instantané de « Sélectionner » est oublié : load() a vidé la sélection.
    effect(() => {
      if (this.lettering.reloadSeq() === 0) return;
      untracked(() => {
        this.snapshot.set(null);
        this.refresh();
      });
    });
  }

  /** Vrai si le drapeau front est allumé et que le serveur n'a pas répondu « désactivé ». */
  readonly enabled = computed(() => this.flags.isEnabled('letteringProposals') && !this.hidden());

  /**
   * Demande un recalcul pour les filtres du dernier chargement réussi. Sans effet si le drapeau
   * front est éteint ou si le panneau est masqué. Sans chargement réussi : vide la liste et
   * annule une demande en attente.
   */
  refresh(): void {
    if (!this.enabled()) return;
    const filters = this.lettering.loadedFilters();
    if (!filters?.account) {
      this.refresh$.next(null);
      this.pending.set(false);
      this.clear();
      return;
    }
    this.pending.set(true);
    this.refresh$.next({ seq: ++this.requestSeq, filters: { ...filters } });
  }

  /**
   * Valide une proposition après confirmation : `POST letter` avec l'origine `Suggestion` et la
   * clé. Succès → retrait local et rechargement de l'écran (qui recalcule les propositions).
   */
  validate(suggestion: LetteringSuggestion): void {
    if (!this.canValidate()) return;
    this.confirmation.confirm({
      message: $localize`:@@accounting.lettering.suggestions.confirm.message:Lettrer les ${suggestion.lineIds.length}:count: lignes de cette proposition ?`,
      header: $localize`:@@accounting.lettering.suggestions.confirm.header:Valider la proposition`,
      icon: 'pi pi-check-circle',
      acceptLabel: $localize`:@@accounting.lettering.suggestions.confirm.accept:Lettrer`,
      rejectLabel: $localize`:@@lettering.component.rejectLabel.Annuler:Annuler`,
      accept: () => this.letter(suggestion)
    });
  }

  /**
   * Remplace la sélection des deux volets par les lignes de la proposition. Garde un instantané
   * de la sélection précédente pour `undoSelect()`. Refusé si une ligne n'est pas affichée
   * (filtre d'état, par exemple) ou si une action est en cours.
   */
  select(suggestion: LetteringSuggestion): LetteringSuggestionSelectResult {
    if (this.lettering.busy() || this.busyKey() !== null || this.lettering.completionGroup() !== null) return 'busy';
    const visible = new Set(this.lettering.lines().map(l => l.lineId));
    if (!suggestion.lineIds.every(id => visible.has(id))) return 'linesNotVisible';

    const current = splitBySide(this.lettering.selectedLines());
    this.snapshot.set({ debit: current.debit.map(l => l.lineId), credit: current.credit.map(l => l.lineId) });
    this.lettering.setAllowPartial(false);
    this.lettering.setPaneSelection('debit', suggestion.debit.lines.map(l => l.lineId));
    this.lettering.setPaneSelection('credit', suggestion.credit.lines.map(l => l.lineId));
    return 'selected';
  }

  /** Rétablit la sélection d'avant le dernier `select()`. */
  undoSelect(): void {
    const previous = this.snapshot();
    if (previous === null) return;
    this.lettering.setPaneSelection('debit', previous.debit);
    this.lettering.setPaneSelection('credit', previous.credit);
    this.snapshot.set(null);
  }

  /** Oublie l'instantané (par exemple quand l'utilisateur modifie lui-même la sélection). */
  forgetSelectSnapshot(): void {
    this.snapshot.set(null);
  }

  /** Ouvre le dialogue de masse : propositions éligibles de confiance haute cochées par défaut. */
  openBulkDialog(): void {
    if (!this.canValidate()) return;
    this.bulkSelection.set(new Set(defaultBulkSelection(this.suggestions())));
    this.bulkResult.set(null);
    this.bulkError.set(null);
    this.bulkRetry.set(null);
    this.bulkDialogOpen.set(true);
  }

  /**
   * Ferme le dialogue (refusé pendant l'envoi). Après un rapport : rechargement des lignes, qui
   * recalcule les propositions. Après un échec sans rapport : recalcul des propositions seulement.
   */
  closeBulkDialog(): void {
    if (this.bulkRunning()) return;
    this.bulkDialogOpen.set(false);
    const hadResult = this.bulkResult() !== null;
    const hadError = this.bulkError() !== null || this.bulkRetry() !== null;
    this.bulkResult.set(null);
    this.bulkError.set(null);
    this.bulkRetry.set(null);
    if (hadResult) this.lettering.load();
    else if (hadError) this.refresh();
  }

  /**
   * Coche ou décoche une proposition du lot. Seules les propositions éligibles sont acceptées, et
   * seulement dans les plafonds serveur et sans ligne commune (sinon tout le lot serait refusé).
   */
  toggleBulk(key: string): void {
    if (this.bulkRunning() || this.bulkResult() !== null) return;
    const list = this.suggestions();
    const suggestion = list.find(s => s.key === key);
    if (!suggestion || !isBulkCandidate(suggestion)) return;
    const current = this.bulkSelection();
    if (!current.has(key) && !canAddToBulk(list, current, suggestion)) return;
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.bulkSelection.set(next);
    this.bulkRetry.set(null);
  }

  /** Coche toutes les propositions éligibles (toutes confiances), dans les plafonds. */
  selectAllBulk(): void {
    if (this.bulkRunning() || this.bulkResult() !== null) return;
    this.bulkSelection.set(new Set(defaultBulkSelection(this.suggestions(), { onlyHighConfidence: false })));
    this.bulkRetry.set(null);
  }

  clearBulkSelection(): void {
    if (this.bulkRunning() || this.bulkResult() !== null) return;
    this.bulkSelection.set(new Set<string>());
    this.bulkRetry.set(null);
  }

  /**
   * Envoie le lot coché après la confirmation explicite du dialogue. Un nouvel identifiant de lot
   * par confirmation ; un second appel pendant l'envoi est ignoré (`canRunBulk`).
   */
  runBulk(): void {
    if (!this.canRunBulk()) return;
    const groups = bulkGroups(this.suggestions(), this.bulkSelection());
    this.sendBulk({ requestId: newBulkRequestId(), groups });
  }

  /** Rejoue exactement le dernier lot (même identifiant, mêmes groupes) après une coupure. */
  retryBulk(): void {
    const attempt = this.bulkRetry();
    if (attempt === null || !this.canRetryBulk() || !this.lettering.canCreate()) return;
    this.sendBulk(attempt);
  }

  private sendBulk(attempt: BulkAttempt): void {
    this.bulkRunning.set(true);
    this.bulkError.set(null);
    this.bulkRetry.set(null);
    this.lettering.busyAction.set('bulk');
    this.lettering.error.set(null);
    this.lettering.success.set(null);

    this.api
      .bulkLetter(attempt.requestId, attempt.groups)
      .pipe(
        finalize(() => {
          this.bulkRunning.set(false);
          if (this.lettering.busyAction() === 'bulk') this.lettering.busyAction.set(null);
        })
      )
      .subscribe({
        next: res => {
          if (res.success && res.data) {
            // Les réponses demandées avant le lot contiennent des propositions lettrées depuis.
            this.acceptFrom = this.requestSeq + 1;
            this.bulkResult.set(res.data);
          } else {
            this.bulkError.set(
              res.error ?? $localize`:@@accounting.lettering.suggestions.bulk.error.generic:Le lettrage en masse a échoué.`
            );
          }
        },
        error: err => this.onBulkError(err, attempt)
      });
  }

  private onBulkError(err: unknown, attempt: BulkAttempt): void {
    const code = apiErrorCode(err);
    const status = (err as { status?: number } | null)?.status ?? 0;
    if (code === LETTERING_ERROR_CODES.featureDisabled) {
      this.hidden.set(true);
      this.pending.set(false);
      this.clear();
      this.bulkError.set(translateLetteringError(err, '', this.errors));
      return;
    }
    if (code === LETTERING_ERROR_CODES.bulkInProgress) {
      // 409 : ce même lot tourne encore. Le rejouer plus tard renvoie son rapport.
      this.bulkRetry.set(attempt);
      this.bulkError.set(translateLetteringError(err, '', this.errors));
      return;
    }
    if (status === 400) {
      // Lot refusé en entier (plafonds serveur plus bas, proposition périmée, doublon) : rien n'a
      // été lettré. Le rejouer à l'identique échouerait de la même façon.
      this.bulkError.set(
        $localize`:@@accounting.lettering.suggestions.bulk.error.rejected:Le serveur a refusé le lot entier : aucune écriture n'a été lettrée. Il dépasse peut-être les limites du dossier, ou une proposition n'est plus valable. Fermez ce dialogue, puis réessayez avec moins de propositions.`
      );
      return;
    }
    if (status === 0 || status >= 500) {
      // Issue inconnue : une partie du lot a pu être lettrée. Le rejeu est sûr (même identifiant).
      this.bulkRetry.set(attempt);
      this.bulkError.set(
        $localize`:@@accounting.lettering.suggestions.bulk.error.unknown:Le serveur n'a pas confirmé le lot : une partie a pu être lettrée. « Réessayer » renvoie le même lot ; une proposition déjà lettrée ne l'est pas deux fois.`
      );
      return;
    }
    this.bulkError.set(
      translateLetteringError(
        err,
        $localize`:@@accounting.lettering.suggestions.bulk.error.generic:Le lettrage en masse a échoué.`,
        this.errors
      )
    );
  }

  private letter(suggestion: LetteringSuggestion): void {
    // L'état a pu changer pendant que la confirmation était ouverte.
    if (!this.canValidate()) return;
    this.busyKey.set(suggestion.key);
    // Verrou partagé : les actions principales (Valider, Équilibrer, Délettrer, Compléter)
    // vérifient toutes `busyAction` et restent désactivées pendant l'appel.
    this.lettering.busyAction.set('suggestion');
    this.lettering.error.set(null);
    this.lettering.success.set(null);

    this.api
      .letterEntries(suggestion.lineIds, false, 'Suggestion', suggestion.key)
      .pipe(
        finalize(() => {
          this.busyKey.set(null);
          if (this.lettering.busyAction() === 'suggestion') this.lettering.busyAction.set(null);
        })
      )
      .subscribe({
        next: res => {
          if (res.success && res.data) {
            // Toute réponse demandée avant ce lettrage est périmée (elle contiendrait encore la
            // proposition) ; le rechargement ci-dessous déclenche un recalcul accepté.
            this.acceptFrom = this.requestSeq + 1;
            this.suggestions.update(list => list.filter(s => s.key !== suggestion.key));
            this.snapshot.set(null);
            this.lettering.load();
            this.lettering.success.set(
              $localize`:@@accounting.lettering.suggestions.validated:Proposition validée : lettrage ${res.data.code}:code: créé.`
            );
          } else {
            this.lettering.error.set(
              res.error ?? $localize`:@@accounting.lettering.store.erreur.lettrage:Erreur lors du lettrage.`
            );
            this.refresh();
          }
        },
        error: err => {
          const message = translateLetteringError(
            err,
            $localize`:@@accounting.lettering.ts.erreur.reseau.lors.du.lettrage.1358d80e:Erreur réseau lors du lettrage.`,
            this.errors
          );
          // Comme dans LetteringStore : load() remet error à null, le message est posé après.
          if (shouldReloadOnLetteringError(err)) this.lettering.load();
          else this.refresh();
          this.lettering.error.set(message);
        }
      });
  }

  private fetch({ seq, filters }: RefreshRequest): Observable<SuggestionsOutcome> {
    this.loading.set(true);
    // `defer` : une exception synchrone reste dans ce flux (catchError) au lieu de couper le Subject.
    return defer(() =>
      this.api.getLetteringSuggestions({
        account: filters.account,
        accountMatch: filters.accountMatch,
        from: filters.from,
        to: filters.to,
        journalCode: filters.journalCode ?? undefined,
        sourceCategories: filters.documentType ? [filters.documentType] : undefined,
        thirdPartyId: filters.thirdParty?.id ?? undefined,
        thirdPartyKind: filters.thirdParty?.kind ?? undefined,
        minAmount: filters.minAmount ?? undefined,
        maxAmount: filters.maxAmount ?? undefined,
        maxResults: LETTERING_SUGGESTIONS_MAX
      })
    ).pipe(
        map((res): SuggestionsOutcome =>
          res.success && res.data
            ? { seq, kind: 'ok', data: res.data }
            : { seq, kind: 'error', err: null, message: res.error ?? null }
        ),
        catchError(err => of<SuggestionsOutcome>({ seq, kind: 'error', err, message: null })),
        finalize(() => this.loading.set(false))
      );
  }

  private apply(outcome: SuggestionsOutcome): void {
    if (outcome.seq < this.acceptFrom) return;
    if (outcome.seq === this.requestSeq) this.pending.set(false);
    if (outcome.kind === 'ok') {
      const data = outcome.data;
      this.suggestions.set((data.suggestions ?? []).map(mapSuggestion));
      this.totalFound.set(data.totalFound);
      this.truncated.set(data.truncated);
      this.truncationReason.set(data.truncationReason ?? null);
      this.error.set(null);
      return;
    }
    if (apiErrorCode(outcome.err) === LETTERING_ERROR_CODES.featureDisabled) {
      this.hidden.set(true);
      this.pending.set(false);
      this.clear();
      return;
    }
    this.clear();
    this.error.set(
      outcome.message ??
        translateLetteringError(
          outcome.err,
          $localize`:@@accounting.lettering.suggestions.error.load:Erreur lors du calcul des propositions.`,
          this.errors
        )
    );
  }

  private clear(): void {
    this.suggestions.set([]);
    this.totalFound.set(0);
    this.truncated.set(false);
    this.truncationReason.set(null);
    this.error.set(null);
  }
}
