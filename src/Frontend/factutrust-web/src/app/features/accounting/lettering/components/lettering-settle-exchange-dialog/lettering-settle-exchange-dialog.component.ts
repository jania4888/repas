import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';

/**
 * Modale d'apurement de l'écart de change. Le compte d'imputation est saisi à chaque ouverture :
 * aucun défaut n'est persisté (le catalogue NCT 01 fournit 655 / 756 mais un dossier non migré
 * peut n'avoir que 6613).
 */
@Component({
  selector: 'app-lettering-settle-exchange-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, DialogModule, ButtonModule],
  templateUrl: './lettering-settle-exchange-dialog.component.html',
  styleUrl: './lettering-settle-exchange-dialog.component.scss'
})
export class LetteringSettleExchangeDialogComponent {
  @Input() visible = false;
  @Input() currency: string | null = null;
  @Input() gap = 0;
  @Input() busy = false;
  /** Erreur à afficher dans la modale (ex. écart désormais nul après rechargement, droit
   *  insuffisant...) : la modale ne se ferme plus toute seule à l'échec, le conteneur ne ferme
   *  qu'au succès (`settle()` avec `onSuccess`). */
  @Input() error: string | null = null;

  @Output() readonly visibleChange = new EventEmitter<boolean>();
  @Output() readonly settle = new EventEmitter<string>();

  account = '';

  onVisibleChange(value: boolean): void {
    if (value) this.account = '';
    this.visibleChange.emit(value);
  }

  onCancel(): void {
    this.visibleChange.emit(false);
  }

  onSettle(): void {
    const trimmed = this.account.trim();
    if (!trimmed || this.busy) return;
    this.settle.emit(trimmed);
  }
}
