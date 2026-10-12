import { Component, EventEmitter, Input, Output, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DrawerModule } from 'primeng/drawer';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ErpLocaleService } from '@core/i18n/erp-locale.service';
import { LETTERING_FUNCTIONAL_CURRENCY, LetteringGroup } from '../../models/lettering.models';

/**
 * Tiroir de détail d'un groupe de lettrage, ouvert depuis le badge « Lettrée · Lxxxxx » ou
 * « Partiellement · Pxxxxx » des deux volets. Composant « bête » : la donnée (`LetteringGroup`)
 * et les droits (`canUnletterPermission`) viennent du store/conteneur.
 */
@Component({
  selector: 'app-lettering-group-drawer',
  standalone: true,
  imports: [CommonModule, DrawerModule, ButtonModule, TableModule, TagModule],
  templateUrl: './lettering-group-drawer.component.html',
  styleUrl: './lettering-group-drawer.component.scss'
})
export class LetteringGroupDrawerComponent {
  private readonly locale = inject(ErpLocaleService);

  protected readonly loc_partiel = $localize`:@@accounting.lettering.group.drawer.ts.partiel:Partiel`;
  protected readonly loc_definitif = $localize`:@@accounting.lettering.group.drawer.ts.definitif:Définitif`;

  @Input() visible = false;
  @Input() group: LetteringGroup | null = null;
  @Input() loading = false;
  @Input() error: string | null = null;
  @Input() canUnletterPermission = false;
  @Input() unlettering = false;

  @Output() readonly visibleChange = new EventEmitter<boolean>();
  @Output() readonly unletter = new EventEmitter<string>();
  @Output() readonly complete = new EventEmitter<string>();

  readonly functionalCurrency = LETTERING_FUNCTIONAL_CURRENCY;
  readonly position = computed<'left' | 'right'>(() => (this.locale.isRtl() ? 'left' : 'right'));

  /**
   * Montant du groupe dans la devise de l'opération, seulement si elle diffère de la devise de
   * tenue. Le serveur exprime `amount` en devise de tenue (TND) : l'afficher avec la devise de
   * l'opération serait faux (300 TND affichés « 300 EUR »). Le montant en devise est recalculé à
   * partir des lignes, avec la même règle que le serveur : somme des débits pour un groupe soldé,
   * minimum des deux côtés pour un groupe partiel. `null` si les lignes ne portent aucun montant en
   * devise (rien n'est inventé).
   */
  amountInCurrency(): { amount: number; currency: string } | null {
    const g = this.group;
    if (!g || !g.currency || g.currency === this.functionalCurrency) return null;
    let debit = 0;
    let credit = 0;
    for (const line of g.lines) {
      debit += line.debitInCurrency || 0;
      credit += line.creditInCurrency || 0;
    }
    const amount = g.isPartial ? Math.min(debit, credit) : debit;
    return amount > 0 ? { amount, currency: g.currency } : null;
  }

  close(): void {
    this.visibleChange.emit(false);
  }

  canUnletterGroup(): boolean {
    return !!this.group && this.group.canUnletter && this.canUnletterPermission;
  }

  blockedReasonLabel(): string {
    switch (this.group?.unletterBlockedReason) {
      case 'permission':
        return $localize`:@@accounting.lettering.group.drawer.ts.droit.insuffisant:Droit insuffisant pour délettrer ce groupe.`;
      case 'period_locked':
        return $localize`:@@accounting.lettering.group.drawer.ts.periode.cloturee:La période est clôturée : ce groupe ne peut plus être délettré.`;
      default:
        return '';
    }
  }

  isPartialCode(code: string): boolean {
    return code.startsWith('P');
  }

  onUnletter(): void {
    if (this.group) this.unletter.emit(this.group.code);
  }

  /** N'exécute pas la complétion ici : émet le code pour que le conteneur ferme le tiroir et
   *  présélectionne les lignes du groupe dans les deux volets (B2) ; l'utilisateur ajoute ensuite
   *  les lignes à lettrer puis valide depuis la synthèse de sélection. */
  onComplete(): void {
    if (this.group) this.complete.emit(this.group.code);
  }
}
