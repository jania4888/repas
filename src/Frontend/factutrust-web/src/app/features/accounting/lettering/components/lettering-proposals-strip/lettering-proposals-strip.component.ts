import { ChangeDetectionStrategy, Component, LOCALE_ID, computed, inject, input, output } from '@angular/core';
import { CommonModule, formatNumber } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { LetteringSuggestionTruncationReason } from '../../../services/accounting.service';
import { LetteringSuggestion, LetteringSuggestionSide } from '../../models/lettering-suggestions.models';
import {
  SuggestionAmountFormatter,
  categoryText,
  confidenceText,
  mainReasonText,
  suggestionSideText
} from '../../utils/lettering-suggestions';

/** Message affiché après un clic sur une carte (géré par le conteneur). */
export type LetteringProposalsNotice = 'selected' | 'linesNotVisible' | 'busy' | 'completion' | null;

/**
 * Bandeau « Propositions de lettrage » (plan v2, Phase 3, annexe C §5) : les 3 meilleures
 * propositions sous forme de cartes. Composant « bête » : l'état vit dans
 * `LetteringSuggestionsStore`, le conteneur relaie les sorties.
 *
 * Accessibilité : le corps de chaque carte est un `<button>` avec un `aria-label` complet ; la
 * confiance est donnée en texte (la couleur n'est qu'un renfort) ; les messages sont annoncés
 * (`role="status"` / `role="alert"`).
 */
@Component({
  selector: 'app-lettering-proposals-strip',
  standalone: true,
  imports: [CommonModule, ButtonModule],
  templateUrl: './lettering-proposals-strip.component.html',
  styleUrl: './lettering-proposals-strip.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LetteringProposalsStripComponent {
  private readonly locale = inject(LOCALE_ID);

  /** Les meilleures propositions (déjà limitées à 3 par le store). */
  readonly suggestions = input.required<readonly LetteringSuggestion[]>();
  /** Nombre total de propositions trouvées (badge). */
  readonly totalFound = input(0);
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  readonly truncated = input(false);
  readonly truncationReason = input<LetteringSuggestionTruncationReason | null>(null);
  /** Vrai si l'utilisateur a le droit de créer un lettrage. */
  readonly canCreate = input(false);
  /** Vrai si une validation peut partir maintenant (droit + aucune action en cours). */
  readonly canValidate = input(false);
  readonly busyKey = input<string | null>(null);
  readonly canUndo = input(false);
  readonly notice = input<LetteringProposalsNotice>(null);

  readonly selectSuggestion = output<LetteringSuggestion>();
  readonly validateSuggestion = output<LetteringSuggestion>();
  readonly undo = output<void>();
  readonly dismissNotice = output<void>();
  /** Ouvre le tiroir « Toutes les propositions ». */
  readonly showAll = output<void>();

  /** Montants : 3 décimales, séparateurs de la langue de l'écran, devise après le montant. */
  protected readonly formatAmount: SuggestionAmountFormatter = (value, currency) =>
    `${formatNumber(value, this.locale, '1.3-3')} ${currency}`.trim();

  protected readonly badge = computed(() => Math.max(this.totalFound(), this.suggestions().length));

  protected readonly loc_validateDisabled = $localize`:@@accounting.lettering.suggestions.strip.validate.noRight:Le droit « Comptabilité : création » est requis pour valider une proposition.`;

  protected category(s: LetteringSuggestion): string {
    return categoryText(s.category);
  }

  protected confidence(s: LetteringSuggestion): string {
    return confidenceText(s.confidence);
  }

  protected reason(s: LetteringSuggestion): string {
    return mainReasonText(s, this.formatAmount);
  }

  protected amount(s: LetteringSuggestion): string {
    return this.formatAmount(s.totalAmount, s.currency);
  }

  protected sideLabel(side: LetteringSuggestionSide): string {
    return suggestionSideText(side);
  }

  protected cardLabel(s: LetteringSuggestion): string {
    return $localize`:@@accounting.lettering.suggestions.strip.card.aria:Sélectionner la proposition ${this.category(s)}:category: : ${this.sideLabel(s.debit)}:debit: au débit, ${this.sideLabel(s.credit)}:credit: au crédit, ${this.amount(s)}:amount:. ${this.confidence(s)}:confidence:.`;
  }

  /** Identifiants des textes visibles lus en description du bouton de carte (raison, écart de change). */
  protected describedBy(s: LetteringSuggestion): string {
    const ids = [`lettering-proposal-reason-${s.key}`];
    if (s.hasExchangeDifference) ids.push(`lettering-proposal-fx-${s.key}`);
    return ids.join(' ');
  }

  protected validateLabel(s: LetteringSuggestion): string {
    return $localize`:@@accounting.lettering.suggestions.strip.validate.aria:Valider la proposition : ${this.sideLabel(s.debit)}:debit: et ${this.sideLabel(s.credit)}:credit:`;
  }

  protected truncationText(): string {
    switch (this.truncationReason()) {
      case 'TimeFuse':
        return $localize`:@@accounting.lettering.suggestions.strip.truncated.time:Recherche interrompue (délai atteint) : affinez les filtres pour obtenir toutes les propositions.`;
      case 'CandidateCap':
        return $localize`:@@accounting.lettering.suggestions.strip.truncated.candidates:Trop de lignes à analyser : affinez les filtres (période, tiers) pour obtenir toutes les propositions.`;
      default:
        return $localize`:@@accounting.lettering.suggestions.strip.truncated.budget:Recherche limitée : d'autres propositions existent peut-être. Affinez les filtres.`;
    }
  }
}
