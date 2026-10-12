import { Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CheckboxModule } from 'primeng/checkbox';
import { ButtonModule } from 'primeng/button';
import { FormsModule } from '@angular/forms';
import {
  LetteringBusyAction,
  LetteringSelectionGuards,
  LetteringSelectionSummary,
  LetteringSideCounts
} from '../../models/lettering.models';

/**
 * Synthèse de la sélection courante (débit/crédit/écart/garde-fous) et actions de validation.
 * Composant « bête » : toute la logique de calcul vit dans `LetteringStore` / `lettering-selection.ts`.
 */
@Component({
  selector: 'app-lettering-selection-summary',
  standalone: true,
  imports: [CommonModule, FormsModule, CheckboxModule, ButtonModule],
  templateUrl: './lettering-selection-summary.component.html',
  styleUrl: './lettering-selection-summary.component.scss'
})
export class LetteringSelectionSummaryComponent {
  protected readonly loc_valider = $localize`:@@accounting.lettering.selection.summary.ts.valider.le.lettrage:Valider le lettrage`;
  protected readonly loc_valider_partiel = $localize`:@@accounting.lettering.selection.summary.ts.valider.le.lettrage.partiel:Valider le lettrage partiel`;

  @Input({ required: true }) summary!: LetteringSelectionSummary;
  @Input({ required: true }) sideCounts!: LetteringSideCounts;
  @Input({ required: true }) guards!: LetteringSelectionGuards;
  @Input() allowPartial = false;
  @Input() canLetter = false;
  @Input() isPartialMode = false;
  @Input() busyAction: LetteringBusyAction = null;
  @Input() accountLabel = '';
  @Input() readOnly = false;
  /** B1 : code du groupe « P » que la sélection complète, le cas échéant. */
  @Input() completionTarget: string | null = null;
  @Input() canComplete = false;

  @Output() readonly allowPartialChange = new EventEmitter<boolean>();
  @Output() readonly reset = new EventEmitter<void>();
  @Output() readonly validate = new EventEmitter<void>();
  @Output() readonly settle = new EventEmitter<void>();

  /** Référence du bouton « Équilibrer » : le conteneur y rend le focus à la fermeture de la
   *  modale d'équilibrage, puisque c'est ce bouton qui l'a ouverte. */
  @ViewChild('settleTrigger', { read: ElementRef }) private readonly settleTriggerRef?: ElementRef<HTMLElement>;

  onAllowPartialChange(value: boolean): void {
    this.allowPartialChange.emit(value);
  }

  focusSettleTrigger(): void {
    this.settleTriggerRef?.nativeElement.querySelector('button')?.focus();
  }

  validateLabel(): string {
    if (this.completionTarget) {
      return $localize`:@@accounting.lettering.selection.summary.ts.completer.le.lettrage.code:Compléter le lettrage ${this.completionTarget}:code:`;
    }
    return this.isPartialMode ? this.loc_valider_partiel : this.loc_valider;
  }

  validateDisabled(): boolean {
    return this.completionTarget ? !this.canComplete : !this.canLetter;
  }
}
