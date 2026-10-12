import {
  ChangeDetectionStrategy,
  Component,
  LOCALE_ID,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked
} from '@angular/core';
import { CommonModule, formatNumber } from '@angular/common';
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { BulkLetteringGroupResultDto, BulkLetteringResultDto } from '../../../services/accounting.service';
import { LetteringSuggestion } from '../../models/lettering-suggestions.models';
import { LETTERING_ERROR_CODES } from '../../models/lettering.models';
import { letteringCodeMessage } from '../../utils/lettering-errors';
import {
  BulkIneligibleReason,
  bulkIneligibleReason,
  canAddToBulk,
  categoryText,
  confidenceText,
  suggestionSideText
} from '../../utils/lettering-suggestions';

/** Ligne de la liste cochable : la proposition et ce qui l'empêche, le cas échéant, d'être cochée. */
interface BulkRow {
  suggestion: LetteringSuggestion;
  checked: boolean;
  /** `capOrOverlap` : éligible, mais plafond atteint ou ligne déjà présente dans le lot. */
  blocked: BulkIneligibleReason | 'capOrOverlap' | null;
}

/**
 * Dialogue de lettrage en masse (plan v2, Phase 3, p3-20). Composant « bête » : la liste, la
 * sélection, les totaux et l'état de l'envoi viennent de `LetteringSuggestionsStore` via le conteneur.
 *
 * Trois vues :
 * 1. choix : liste cochable (éligibles de confiance haute cochées par défaut, non éligibles
 *    grisées avec leur raison), récapitulatif (propositions, lignes, total par devise, comptes) ;
 * 2. confirmation explicite : nombre, caractère définitif, une transaction par proposition ;
 * 3. rapport : compteurs et résultat par proposition.
 *
 * La confirmation est une vue du dialogue et pas une modale `ConfirmationService` empilée : pas de
 * conflit de focus ni d'ordre d'affichage entre `p-dialog` et `ngb-modal`.
 */
@Component({
  selector: 'app-lettering-bulk-dialog',
  standalone: true,
  imports: [CommonModule, DialogModule, ButtonModule],
  templateUrl: './lettering-bulk-dialog.component.html',
  styleUrl: './lettering-bulk-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LetteringBulkDialogComponent {
  private readonly locale = inject(LOCALE_ID);

  readonly visible = input(false);
  readonly suggestions = input.required<readonly LetteringSuggestion[]>();
  readonly selection = input<ReadonlySet<string>>(new Set<string>());
  readonly selectedCount = input(0);
  readonly lineCount = input(0);
  readonly totals = input<ReadonlyMap<string, number>>(new Map<string, number>());
  readonly accounts = input<readonly string[]>([]);
  readonly running = input(false);
  readonly result = input<BulkLetteringResultDto | null>(null);
  readonly error = input<string | null>(null);
  readonly canRun = input(false);
  readonly canRetry = input(false);

  readonly visibleChange = output<boolean>();
  readonly toggle = output<string>();
  readonly selectAll = output<void>();
  readonly clearAll = output<void>();
  readonly run = output<void>();
  readonly retry = output<void>();

  /** `choose` puis `confirm` ; le rapport s'affiche dès qu'un résultat existe. */
  readonly step = signal<'choose' | 'confirm'>('choose');

  readonly rows = computed<BulkRow[]>(() => {
    const list = this.suggestions();
    const keys = this.selection();
    return [...list]
      .sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .map(s => {
        const checked = keys.has(s.key);
        const reason = bulkIneligibleReason(s);
        const blocked = checked ? null : reason ?? (canAddToBulk(list, keys, s) ? null : 'capOrOverlap');
        return { suggestion: s, checked, blocked };
      });
  });

  readonly eligibleCount = computed(() => this.rows().filter(r => bulkIneligibleReason(r.suggestion) === null).length);

  readonly totalsList = computed(() => [...this.totals()].map(([currency, total]) => this.formatAmount(total, currency)));

  private readonly byKey = computed(() => new Map(this.suggestions().map(s => [s.key, s])));

  constructor() {
    // Chaque ouverture repart de la vue « choix ».
    effect(() => {
      if (this.visible()) untracked(() => this.step.set('choose'));
    });
  }

  /** Fermeture refusée pendant l'envoi : le résultat du lot doit s'afficher. */
  close(): void {
    if (this.running()) return;
    this.visibleChange.emit(false);
  }

  onVisibleChange(visible: boolean): void {
    if (!visible) this.close();
  }

  toConfirm(): void {
    if (this.selectedCount() > 0) this.step.set('confirm');
  }

  back(): void {
    if (!this.running()) this.step.set('choose');
  }

  confirm(): void {
    if (this.running() || !this.canRun()) return;
    this.run.emit();
  }

  protected formatAmount(value: number, currency: string): string {
    return `${formatNumber(value, this.locale, '1.3-3')} ${currency}`.trim();
  }

  protected categoryLabel(s: LetteringSuggestion): string {
    return categoryText(s.category);
  }

  protected confidenceLabel(s: LetteringSuggestion): string {
    return confidenceText(s.confidence);
  }

  protected sides(s: LetteringSuggestion): string {
    return `${suggestionSideText(s.debit)} ↔ ${suggestionSideText(s.credit)}`;
  }

  protected checkboxId(s: LetteringSuggestion): string {
    return `lettering-bulk-${s.key}`;
  }

  protected blockedText(blocked: BulkRow['blocked']): string {
    switch (blocked) {
      case 'exchangeDifference':
        return $localize`:@@accounting.lettering.suggestions.bulk.blocked.fx:Écart de change : à valider seule.`;
      case 'tooManyLines':
        return $localize`:@@accounting.lettering.suggestions.bulk.blocked.lines:Trop de lignes pour un lot : à valider seule.`;
      case 'capOrOverlap':
        return $localize`:@@accounting.lettering.suggestions.bulk.blocked.cap:Plafond du lot atteint, ou une ligne est déjà dans le lot.`;
      case 'notEligible':
        return $localize`:@@accounting.lettering.suggestions.bulk.blocked.other:Non éligible au lettrage en masse.`;
      default:
        return '';
    }
  }

  protected resultLabel(r: BulkLetteringGroupResultDto): string {
    const s = this.byKey().get(r.clientKey);
    return s ? this.sides(s) : r.clientKey;
  }

  /**
   * Raison d'un refus dans le rapport. Les messages unitaires qui annoncent « La liste a été
   * actualisée » ont ici leur propre texte : la liste ne se recharge qu'à la fermeture du dialogue.
   */
  private rejectedReason(code: string | null | undefined): string {
    switch (code) {
      case LETTERING_ERROR_CODES.alreadyLettered:
        return $localize`:@@accounting.lettering.suggestions.bulk.rejected.alreadyLettered:une ligne est déjà lettrée.`;
      case LETTERING_ERROR_CODES.linesNotFound:
        return $localize`:@@accounting.lettering.suggestions.bulk.rejected.linesNotFound:une ligne est introuvable.`;
      case LETTERING_ERROR_CODES.periodLocked:
        return $localize`:@@accounting.lettering.suggestions.bulk.rejected.periodLocked:la période est clôturée.`;
      default:
        return (
          letteringCodeMessage(code) ??
          $localize`:@@accounting.lettering.suggestions.bulk.result.rejectedGeneric:refusé par les contrôles du serveur.`
        );
    }
  }

  protected resultText(r: BulkLetteringGroupResultDto): string {
    switch (r.status) {
      case 'Lettered':
        return $localize`:@@accounting.lettering.suggestions.bulk.result.lettered:Lettré ${r.code ?? ''}:code:`;
      case 'AlreadyLettered':
        return r.code
          ? $localize`:@@accounting.lettering.suggestions.bulk.result.already:Déjà lettré (${r.code}:code:)`
          : $localize`:@@accounting.lettering.suggestions.bulk.result.alreadyNoCode:Déjà lettré`;
      case 'Rejected':
        return $localize`:@@accounting.lettering.suggestions.bulk.result.rejected:Refusé : ${this.rejectedReason(r.errorCode)}:reason:`;
      case 'NotProcessed':
        return $localize`:@@accounting.lettering.suggestions.bulk.result.notProcessed:Non traité (lot interrompu)`;
      default:
        return r.status;
    }
  }
}
