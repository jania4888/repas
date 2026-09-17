import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TableModule } from 'primeng/table';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AccountingTableActionsComponent } from '../shared/accounting-table-actions.component';
import { MonthlyDeclarationRubricDto } from '../services/accounting.service';
import {
  describeApplicability,
  describeGross,
  describeWithheld,
  isRubricUnsupported,
  unknownAccountsOf
} from './monthly-declaration-config.view-model';

/**
 * Table des rubriques d'une famille. Composant muet : il affiche et signale, il n'appelle rien.
 *
 * Les colonnes « Montant brut » et « Retenue » portent la règle en toutes lettres plutôt qu'un
 * code de type — c'est cette phrase que le comptable relira le jour où un montant le surprendra.
 */
@Component({
  selector: 'app-dm-rubric-table',
  standalone: true,
  imports: [CommonModule, TableModule, ButtonComponent, AccountingTableActionsComponent],
  template: `
    <p-table
      [value]="rubrics"
      [loading]="loading"
      styleClass="p-datatable-sm accounting-datatable"
      [rowHover]="true">
      <ng-template pTemplate="header">
        <tr>
          <th scope="col">Code</th>
          <th scope="col">Libellé</th>
          <th scope="col">Code rapport</th>
          <th scope="col">Montant brut</th>
          <th scope="col">Retenue</th>
          <th scope="col">Application</th>
          <th scope="col">Actif</th>
          <th scope="col">Actions</th>
        </tr>
      </ng-template>

      <ng-template pTemplate="body" let-r>
        <tr [class.dm-row--inactive]="!r.isActive">
          <td class="dm-mono">{{ r.code }}</td>
          <td>
            {{ r.label }}
            @if (unsupported(r)) {
              <span class="dm-flag dm-flag--warn" title="Le moteur rendra 0 pour cette rubrique.">
                non pris en charge
              </span>
            }
            @if (unknownAccounts(r); as missing) {
              @if (missing.length) {
                <span class="dm-flag dm-flag--warn" [title]="'Comptes absents du plan : ' + missing.join(', ')">
                  compte inconnu
                </span>
              }
            }
          </td>
          <td class="dm-mono">{{ r.reportCode }}</td>
          <td class="dm-rule">{{ gross(r) }}</td>
          <td class="dm-rule">{{ withheld(r) }}</td>
          <td>{{ applicability(r) }}</td>
          <td>{{ r.isActive ? 'Oui' : 'Non' }}</td>
          <td>
            <app-accounting-table-actions>
              <app-button
                variant="ghost"
                size="sm"
                icon="pi-pencil"
                [iconOnly]="true"
                [iconAlwaysVisible]="true"
                type="button"
                [disabled]="readOnly"
                (click)="edit.emit(r)"
                ariaLabel="Modifier" />
              <app-button
                variant="ghost"
                size="sm"
                [icon]="r.isActive ? 'pi-eye-slash' : 'pi-eye'"
                [iconOnly]="true"
                [iconAlwaysVisible]="true"
                type="button"
                [disabled]="readOnly"
                (click)="toggle.emit(r)"
                [attr.aria-label]="r.isActive ? 'Désactiver' : 'Activer'" />
              <app-button
                variant="ghost"
                size="sm"
                icon="pi-trash"
                [iconOnly]="true"
                [iconAlwaysVisible]="true"
                type="button"
                [disabled]="readOnly"
                (click)="remove.emit(r)"
                ariaLabel="Supprimer" />
            </app-accounting-table-actions>
          </td>
        </tr>
      </ng-template>

      <ng-template pTemplate="emptymessage">
        <tr>
          <td colspan="8" class="dm-empty">Aucune rubrique configurée pour cette famille.</td>
        </tr>
      </ng-template>
    </p-table>
  `,
  styles: `
    .dm-mono { font-family: ui-monospace, monospace; }
    .dm-rule { font-size: var(--font-size-sm); color: var(--color-text-secondary); }
    .dm-row--inactive { opacity: 0.6; }
    .dm-flag { display: inline-block; margin-left: var(--spacing-2); padding: 0.1rem 0.45rem; border-radius: var(--radius-pill, 999px); font-size: var(--font-size-xs); font-weight: var(--font-weight-semibold); }
    .dm-flag--warn { background: var(--color-warning-50, #fffbeb); color: var(--color-warning-700, #a16207); border: 1px solid var(--color-warning-200, #fde68a); }
    .dm-empty { text-align: center; padding: var(--spacing-6); color: var(--color-text-tertiary); }
  `
})
export class DmRubricTableComponent {
  @Input() rubrics: MonthlyDeclarationRubricDto[] = [];
  @Input() loading = false;
  @Input() readOnly = false;
  /** Numéros de compte du plan du dossier : sert à signaler ceux qui ont disparu. */
  @Input() knownAccounts: ReadonlySet<string> = new Set<string>();

  @Output() readonly edit = new EventEmitter<MonthlyDeclarationRubricDto>();
  @Output() readonly toggle = new EventEmitter<MonthlyDeclarationRubricDto>();
  @Output() readonly remove = new EventEmitter<MonthlyDeclarationRubricDto>();

  gross(rubric: MonthlyDeclarationRubricDto): string {
    return describeGross(rubric);
  }

  withheld(rubric: MonthlyDeclarationRubricDto): string {
    return describeWithheld(rubric);
  }

  applicability(rubric: MonthlyDeclarationRubricDto): string {
    return describeApplicability(rubric);
  }

  unsupported(rubric: MonthlyDeclarationRubricDto): boolean {
    return isRubricUnsupported(rubric);
  }

  unknownAccounts(rubric: MonthlyDeclarationRubricDto): string[] {
    // Le plan n'est pas encore chargé : ne rien signaler plutôt que tout signaler à tort.
    return this.knownAccounts.size === 0 ? [] : unknownAccountsOf(rubric, this.knownAccounts);
  }
}
