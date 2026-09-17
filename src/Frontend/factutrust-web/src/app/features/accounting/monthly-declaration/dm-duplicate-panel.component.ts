import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonComponent } from '@shared/components/button/button.component';
import {
  DuplicateMonthlyDeclarationConfigRequest,
  MonthlyDeclarationDuplicationResultDto
} from '../services/accounting.service';

export interface DmDuplicateSource {
  companyTenantId: string;
  companyName: string;
}

/**
 * « Dupliquer la configuration DM » — reprise de la configuration d'un autre dossier du cabinet.
 *
 * La liste proposée ici est un confort : le serveur revalide le dossier source contre le
 * portefeuille du cabinet et le périmètre du collaborateur. Ce que cet écran affiche n'autorise
 * rien.
 */
@Component({
  selector: 'app-dm-duplicate-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent],
  template: `
    <div class="dm-dup">
      <h3 class="dm-dup__title">Dupliquer la configuration DM</h3>
      <p class="dm-dup__lead">
        Reprend les rubriques et les comptes d’un autre dossier du cabinet. Les rubriques existantes
        de même code sont conservées, sauf remplacement explicite.
      </p>

      <div class="dm-dup__row">
        <div class="dm-dup__field">
          <label class="dm-lbl" for="dm-dup-source">Dossier source</label>
          <select id="dm-dup-source" class="dm-inp" [(ngModel)]="sourceTenantId" [disabled]="busy || readOnly">
            <option [ngValue]="null">— Choisir un dossier —</option>
            @for (s of sources; track s.companyTenantId) {
              <option [ngValue]="s.companyTenantId">{{ s.companyName }}</option>
            }
          </select>
          @if (!sources.length) {
            <small class="dm-hint">Aucun autre dossier accessible dans le portefeuille du cabinet.</small>
          }
        </div>

        <label class="dm-dup__check">
          <input type="checkbox" [(ngModel)]="overwrite" [disabled]="busy || readOnly" />
          <span>Remplacer les rubriques de même code</span>
        </label>

        <app-button
          variant="primary"
          size="sm"
          type="button"
          [disabled]="busy || readOnly || !sourceTenantId"
          (click)="emitDuplicate()">
          {{ busy ? 'Duplication…' : 'Dupliquer' }}
        </app-button>
      </div>

      @if (result; as r) {
        <div class="dm-dup__result" role="status">
          <p class="dm-dup__counts">{{ r.inserted }} rubrique(s) insérée(s), {{ r.replaced }} remplacée(s).</p>
          @if (r.skippedCodes.length) {
            <p class="dm-hint">Codes déjà présents et laissés intacts : {{ r.skippedCodes.join(', ') }}</p>
          }
          @if (r.unknownAccounts.length) {
            <p class="dm-hint dm-hint--warn">
              Comptes absents du plan de ce dossier, copiés tels quels :
              {{ r.unknownAccounts.join(', ') }}
            </p>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .dm-dup { display: flex; flex-direction: column; gap: var(--spacing-3); }
    .dm-dup__title { margin: 0; font-size: var(--font-size-md); font-weight: var(--font-weight-semibold); }
    .dm-dup__lead { margin: 0; font-size: var(--font-size-sm); color: var(--color-text-secondary); }
    .dm-dup__row { display: flex; flex-wrap: wrap; gap: var(--spacing-3); align-items: flex-end; }
    .dm-dup__field { display: flex; flex-direction: column; gap: var(--spacing-1); min-width: 16rem; flex: 1 1 18rem; }
    .dm-dup__check { display: flex; align-items: center; gap: var(--spacing-2); font-size: var(--font-size-sm); }
    .dm-dup__result { border-top: 1px solid var(--color-border-default); padding-top: var(--spacing-3); }
    .dm-dup__counts { margin: 0 0 var(--spacing-1); font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); }
    .dm-lbl { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); }
    .dm-inp { padding: var(--spacing-2) var(--spacing-3); border: 1px solid var(--color-border-default); border-radius: var(--radius-md); background: var(--color-background-elevated); color: var(--color-text-primary); font-size: var(--font-size-sm); width: 100%; }
    .dm-hint { margin: 0; font-size: var(--font-size-xs); color: var(--color-text-secondary); }
    .dm-hint--warn { color: var(--color-warning-700, #a16207); }
  `
})
export class DmDuplicatePanelComponent {
  @Input() sources: DmDuplicateSource[] = [];
  @Input() busy = false;
  @Input() readOnly = false;
  @Input() result: MonthlyDeclarationDuplicationResultDto | null = null;

  @Output() readonly duplicate = new EventEmitter<DuplicateMonthlyDeclarationConfigRequest>();

  sourceTenantId: string | null = null;
  overwrite = false;

  emitDuplicate(): void {
    if (!this.sourceTenantId) {
      return;
    }
    this.duplicate.emit({ sourceCompanyTenantId: this.sourceTenantId, overwrite: this.overwrite });
  }
}
