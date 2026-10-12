import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, Subject, catchError, debounceTime, defer, finalize, map, of, switchMap } from 'rxjs';
import { apiErrorCode } from '@core/utils/api-error-code';
import { ConfirmationService } from '@core/services/confirmation.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { AccountingFeatureFlagsService } from '../../shared/accounting-feature-flags.service';
import {
  AccountingService,
  BulkLetteringResultDto,
  LetteringSuggestionTruncationReason,
  LetteringSuggestionsResultDto
} from '../../services/accounting.service';
import { LETTERING_ERROR_CODES, LetteringFilters } from '../models/lettering.models';
import { LETTERING_SUGGESTIONS_MAX, LetteringSuggestion } from '../models/lettering-suggestions.models';
import {
  bulkLineCount,
  bulkTotalsByCurrency,
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
  /** Rapport du dernier lot (rempli par `runBulk`, p3-20). */
  readonly bulkResult = signal<BulkLetteringResultDto | null>(null);

  private readonly snapshot = signal<SelectionSnapshot | null>(null);
  readonly canUndoSelect = computed(() => this.snapshot() !== null);

  readonly topSuggestions = computed(() => topSuggestions(this.suggestions()));
  readonly bulkEligible = computed(() => this.suggestions().filter(isBulkCandidate));
  readonly bulkTotalsByCurrency = computed(() => bulkTotalsByCurrency(this.suggestions(), this.bulkSelection()));
  readonly bulkLineCount = computed(() => bulkLineCount(this.suggestions(), this.bulkSelection()));
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

  openBulkDialog(): void {
    this.bulkSelection.set(new Set(defaultBulkSelection(this.suggestions())));
    this.bulkResult.set(null);
    this.bulkDialogOpen.set(true);
  }

  closeBulkDialog(): void {
    this.bulkDialogOpen.set(false);
  }

  /** Coche ou décoche une proposition du lot ; seules les propositions éligibles sont acceptées. */
  toggleBulk(key: string): void {
    const suggestion = this.suggestions().find(s => s.key === key);
    if (!suggestion || !isBulkCandidate(suggestion)) return;
    this.bulkSelection.update(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
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
