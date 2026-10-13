import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  LOCALE_ID,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild
} from '@angular/core';
import { CommonModule, formatNumber } from '@angular/common';
import { DrawerModule } from 'primeng/drawer';
import { ButtonModule } from 'primeng/button';
import { ErpLocaleService } from '@core/i18n/erp-locale.service';
import {
  LetteringSuggestionCategory,
  LetteringSuggestionConfidence,
  LetteringSuggestionReasonDto
} from '../../../services/accounting.service';
import { LetteringSuggestion } from '../../models/lettering-suggestions.models';
import type { LetteringProposalsNotice } from '../lettering-proposals-strip/lettering-proposals-strip.component';
import {
  SuggestionAmountFormatter,
  categoryText,
  confidenceText,
  mainReasonText,
  reasonText,
  suggestionSideText
} from '../../utils/lettering-suggestions';

/** Nombre de propositions par page du tiroir (pagination côté client, ≤ 200 propositions). */
export const LETTERING_PROPOSALS_PAGE_SIZE = 20;

export type LetteringProposalsCategoryFilter = LetteringSuggestionCategory | 'all';
export type LetteringProposalsConfidenceFilter = LetteringSuggestionConfidence | 'all';

const CATEGORIES: readonly LetteringSuggestionCategory[] = ['Exact', 'Multiple', 'SameAmount'];
const CONFIDENCES: readonly LetteringSuggestionConfidence[] = ['High', 'Medium', 'Low'];

/**
 * Tiroir « Toutes les propositions » (plan v2, Phase 3, p3-19). Composant « bête » : la liste,
 * les droits et l'action en cours viennent de `LetteringSuggestionsStore` via le conteneur.
 *
 * - tri par score décroissant (puis par clé, pour un ordre stable) ;
 * - filtres catégorie et confiance ; pagination côté client ({@link LETTERING_PROPOSALS_PAGE_SIZE}) ;
 * - par ligne : « Sélectionner », « Valider », détail dépliable avec toutes les raisons ;
 * - accès au dialogue de lettrage en masse (bouton masqué tant que `showBulk` est faux).
 *
 * Même patron que `lettering-group-drawer` : `p-drawer` modal, à droite (à gauche en RTL).
 */
@Component({
  selector: 'app-lettering-proposals-drawer',
  standalone: true,
  imports: [CommonModule, DrawerModule, ButtonModule],
  templateUrl: './lettering-proposals-drawer.component.html',
  styleUrl: './lettering-proposals-drawer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LetteringProposalsDrawerComponent {
  private readonly locale = inject(LOCALE_ID);
  private readonly erpLocale = inject(ErpLocaleService);

  readonly visible = input(false);
  readonly suggestions = input.required<readonly LetteringSuggestion[]>();
  readonly totalFound = input(0);
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  readonly truncated = input(false);
  readonly canCreate = input(false);
  readonly canValidate = input(false);
  readonly busyKey = input<string | null>(null);
  /** Affiche l'accès au lettrage en masse (dialogue livré par p3-20). */
  readonly showBulk = input(false);
  readonly bulkEligibleCount = input(0);
  /** Résultat de la dernière action (« Valider ») : le message de la page est caché par le masque. */
  readonly successMessage = input<string | null>(null);
  readonly errorMessage = input<string | null>(null);
  /** Message de « Sélectionner » quand la sélection n'a pas eu lieu (le tiroir reste ouvert). */
  readonly notice = input<LetteringProposalsNotice>(null);

  readonly visibleChange = output<boolean>();
  readonly selectSuggestion = output<LetteringSuggestion>();
  readonly validateSuggestion = output<LetteringSuggestion>();
  readonly openBulk = output<void>();
  readonly dismissNotice = output<void>();

  private readonly list = viewChild<ElementRef<HTMLElement>>('list');

  protected readonly categories = CATEGORIES;
  protected readonly confidences = CONFIDENCES;

  readonly category = signal<LetteringProposalsCategoryFilter>('all');
  readonly confidence = signal<LetteringProposalsConfidenceFilter>('all');
  readonly page = signal(0);
  private readonly expanded = signal<ReadonlySet<string>>(new Set<string>());

  readonly position = computed<'left' | 'right'>(() => (this.erpLocale.isRtl() ? 'left' : 'right'));

  readonly sorted = computed(() =>
    [...this.suggestions()].sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  );

  readonly filtered = computed(() => {
    const category = this.category();
    const confidence = this.confidence();
    return this.sorted().filter(
      s => (category === 'all' || s.category === category) && (confidence === 'all' || s.confidence === confidence)
    );
  });

  readonly pageCount = computed(() => Math.max(1, Math.ceil(this.filtered().length / LETTERING_PROPOSALS_PAGE_SIZE)));

  /** Page courante bornée : une liste raccourcie (validation, recalcul) ne laisse jamais une page vide. */
  readonly currentPage = computed(() => Math.min(this.page(), this.pageCount() - 1));

  readonly pageItems = computed(() => {
    const start = this.currentPage() * LETTERING_PROPOSALS_PAGE_SIZE;
    return this.filtered().slice(start, start + LETTERING_PROPOSALS_PAGE_SIZE);
  });

  readonly rangeStart = computed(() => (this.filtered().length === 0 ? 0 : this.currentPage() * LETTERING_PROPOSALS_PAGE_SIZE + 1));
  readonly rangeEnd = computed(() => Math.min(this.filtered().length, (this.currentPage() + 1) * LETTERING_PROPOSALS_PAGE_SIZE));

  /** Propositions trouvées par le moteur mais non renvoyées (au-delà de la limite `maxResults`). */
  readonly notReturned = computed(() => Math.max(0, this.totalFound() - this.suggestions().length));

  protected readonly loc_validateDisabled = $localize`:@@accounting.lettering.suggestions.strip.validate.noRight:Le droit « Comptabilité : création » est requis pour valider une proposition.`;

  /** Montants : 3 décimales, séparateurs de la langue de l'écran, devise après le montant. */
  protected readonly formatAmount: SuggestionAmountFormatter = (value, currency) =>
    `${formatNumber(value, this.locale, '1.3-3')} ${currency}`.trim();

  constructor() {
    // Une nouvelle liste (recalcul) replie les détails ouverts : les clés peuvent avoir disparu.
    effect(() => {
      this.suggestions();
      untracked(() => this.expanded.set(new Set<string>()));
    });
  }

  setCategory(value: string): void {
    this.category.set(value === 'all' || (CATEGORIES as readonly string[]).includes(value) ? (value as LetteringProposalsCategoryFilter) : 'all');
    this.page.set(0);
  }

  setConfidence(value: string): void {
    this.confidence.set(value === 'all' || (CONFIDENCES as readonly string[]).includes(value) ? (value as LetteringProposalsConfidenceFilter) : 'all');
    this.page.set(0);
  }

  resetFilters(): void {
    this.category.set('all');
    this.confidence.set('all');
    this.page.set(0);
  }

  previousPage(): void {
    this.goToPage(this.currentPage() - 1);
  }

  nextPage(): void {
    this.goToPage(this.currentPage() + 1);
  }

  /**
   * Change de page, puis met le focus sur la liste : le bouton cliqué peut devenir désactivé
   * (première ou dernière page) et la liste revient en haut.
   */
  private goToPage(target: number): void {
    const page = Math.max(0, Math.min(this.pageCount() - 1, target));
    if (page === this.currentPage()) return;
    this.page.set(page);
    // La liste reste dans le DOM d'une page à l'autre : focus immédiat, puis retour en haut.
    const list = this.list()?.nativeElement;
    if (!list) return;
    list.focus({ preventScroll: true });
    if (typeof list.scrollIntoView === 'function') list.scrollIntoView({ block: 'start' });
  }

  isExpanded(key: string): boolean {
    return this.expanded().has(key);
  }

  toggleDetails(key: string): void {
    this.expanded.update(set => {
      const next = new Set(set);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  protected categoryLabel(c: LetteringSuggestionCategory): string {
    return categoryText(c);
  }

  protected confidenceLabel(c: LetteringSuggestionConfidence): string {
    return confidenceText(c);
  }

  protected side(s: LetteringSuggestion, which: 'debit' | 'credit'): string {
    return suggestionSideText(s[which]);
  }

  protected amount(s: LetteringSuggestion): string {
    return this.formatAmount(s.totalAmount, s.currency);
  }

  protected mainReason(s: LetteringSuggestion): string {
    return mainReasonText(s, this.formatAmount);
  }

  protected reason(r: LetteringSuggestionReasonDto): string {
    return reasonText(r, this.formatAmount);
  }

  protected selectLabel(s: LetteringSuggestion): string {
    return $localize`:@@accounting.lettering.suggestions.drawer.select.aria:Sélectionner la proposition : ${this.side(s, 'debit')}:debit: et ${this.side(s, 'credit')}:credit:`;
  }

  protected validateLabel(s: LetteringSuggestion): string {
    return $localize`:@@accounting.lettering.suggestions.strip.validate.aria:Valider la proposition : ${this.side(s, 'debit')}:debit: et ${this.side(s, 'credit')}:credit:`;
  }

  protected detailsId(s: LetteringSuggestion): string {
    return `lettering-proposal-details-${s.key}`;
  }
}
