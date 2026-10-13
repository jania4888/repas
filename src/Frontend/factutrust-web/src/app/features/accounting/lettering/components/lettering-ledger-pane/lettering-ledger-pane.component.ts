import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { LETTERING_FUNCTIONAL_CURRENCY, LetteringLine, LetteringSide } from '../../models/lettering.models';

/**
 * Volet (débit ou crédit) de l'écran de lettrage. Composant « bête » : reçoit les lignes déjà
 * filtrées par côté (`LetteringStore.debitLines` / `creditLines`), affiche un `p-table` avec
 * sélection multiple par cases à cocher, et se contente d'émettre les identifiants sélectionnés.
 *
 * Règle D9 (stricte) : une ligne verrouillée (`periodLocked`) n'est jamais cochable, même si elle
 * porte déjà un code de lettrage. Une ligne partiellement lettrée (« P ») reste cochable pour
 * permettre de compléter le groupe.
 */
@Component({
  selector: 'app-lettering-ledger-pane',
  standalone: true,
  imports: [CommonModule, TableModule, TagModule, EmptyStateComponent],
  templateUrl: './lettering-ledger-pane.component.html',
  styleUrl: './lettering-ledger-pane.component.scss'
})
export class LetteringLedgerPaneComponent {
  @Input({ required: true }) side!: LetteringSide;
  @Input() lines: readonly LetteringLine[] = [];
  @Input() selectedIds: ReadonlySet<string> = new Set();
  @Input() hasForeignLines = false;
  @Input() readOnly = false;
  @Input() loading = false;
  @Input() total = 0;
  @Input() totalInCurrency = 0;
  @Input() currency: string | null = null;

  @Output() readonly selectionChange = new EventEmitter<readonly string[]>();
  @Output() readonly openGroup = new EventEmitter<string>();

  readonly functionalCurrency = LETTERING_FUNCTIONAL_CURRENCY;

  /** `p-table` exige un tableau mutable pour `[value]` ; les lignes du store sont `readonly`. */
  get rows(): LetteringLine[] {
    return this.lines as LetteringLine[];
  }

  /** Champ de tri de la colonne Montant : chaque volet trie sur son propre côté. */
  get amountSortField(): string {
    return this.side === 'debit' ? 'debit' : 'credit';
  }

  /** Lié en propriété de classe (et non en expression de template) : Angular n'autorise pas les
   *  arrow functions inline dans les expressions de liaison. */
  readonly rowSelectableFn = (row: { data: LetteringLine }): boolean => this.isRowSelectable(row.data);

  get selectedLines(): LetteringLine[] {
    return this.lines.filter(l => this.selectedIds.has(l.lineId));
  }

  set selectedLines(selected: LetteringLine[]) {
    this.selectionChange.emit(selected.map(l => l.lineId));
  }

  isRowSelectable(line: LetteringLine): boolean {
    return !this.readOnly && !line.periodLocked && (!line.letteringCode || line.isPartiallyLettered);
  }

  isLettered(line: LetteringLine): boolean {
    return !!line.letteringCode;
  }

  isPartialCode(code: string | null | undefined): boolean {
    return !!code && code.startsWith('P');
  }

  rowStateLabel(line: LetteringLine): string {
    if (!line.letteringCode) {
      return $localize`:@@accounting.lettering.ledger.pane.ts.non.lettree:Non lettrée`;
    }
    return line.isPartiallyLettered
      ? $localize`:@@accounting.lettering.ledger.pane.ts.partiellement.lettree:Partiellement · ${line.letteringCode}:code:`
      : $localize`:@@accounting.lettering.ledger.pane.ts.lettree:Lettrée · ${line.letteringCode}:code:`;
  }

  openGroupFor(line: LetteringLine): void {
    if (line.letteringCode) this.openGroup.emit(line.letteringCode);
  }

  paneTitle(): string {
    return this.side === 'debit'
      ? $localize`:@@accounting.lettering.ledger.pane.ts.debit.n:Écritures au débit (${this.lines.length}:count:)`
      : $localize`:@@accounting.lettering.ledger.pane.ts.credit.n:Écritures au crédit (${this.lines.length}:count:)`;
  }

  checkboxAriaLabel(line: LetteringLine): string {
    if (line.periodLocked) {
      return $localize`:@@accounting.lettering.ledger.pane.ts.selectionner.la.ligne.verrouillee:Ligne du ${line.entryDate}:date: — ${line.label}:label: — verrouillée, période clôturée`;
    }
    return $localize`:@@accounting.lettering.ledger.pane.ts.selectionner.la.ligne.du.date.mo:Sélectionner la ligne du ${line.entryDate}:date: — ${line.label}:label:`;
  }

  /** Évite la concaténation de chaînes dans le template (gate i18n). */
  pieceLabel(line: LetteringLine): string {
    return line.pieceRef || $localize`:@@accounting.lettering.ledger.pane.ts.piece.numero:N° ${line.entryNumber}:number:`;
  }

  lockedTooltip(): string {
    return $localize`:@@accounting.lettering.ledger.pane.ts.lettrage.impossible.periode.cloturee:Lettrage impossible : période clôturée`;
  }
}
