import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';

/**
 * Enveloppe table : état chargement global optionnel + message vide.
 * Le contenu (p-table) est projeté ; ne pas imbriquer un second p-table.
 */
@Component({
  selector: 'app-accounting-table-shell',
  standalone: true,
  imports: [CommonModule, ProgressSpinnerModule, EmptyStateComponent],
  template: `
    <div class="accounting-table-shell">
      @if (loadingOverlay) {
        <div class="accounting-table-shell__overlay" role="status" aria-live="polite" aria-busy="true">
          <p-progressSpinner strokeWidth="3" [style]="{ width: '48px', height: '48px' }" />
          <span class="sr-only">{{ loadingMessage }}</span>
        </div>
      }
      @if (showEmpty && !loadingOverlay) {
        <app-empty-state
          [icon]="emptyIcon"
          [title]="emptyTitle"
          [description]="emptyDescription" />
      } @else {
        <ng-content></ng-content>
      }
    </div>
  `,
  styles: `
    .accounting-table-shell {
      position: relative;
      min-height: 0;
    }
    .accounting-table-shell__overlay {
      position: absolute;
      inset: 0;
      z-index: 2;
      display: flex;
      align-items: center;
      justify-content: center;
      background: color-mix(in srgb, var(--color-background-elevated) 85%, transparent);
      border-radius: var(--radius-lg);
    }
  `
})
export class AccountingTableShellComponent {
  @Input() loadingOverlay = false;
  @Input() loadingMessage = $localize`:@@accounting.accounting-table-shell.ts.chargement.01cba1df:Chargement…`;
  @Input() showEmpty = false;
  @Input() emptyTitle = $localize`:@@accounting.accounting-table-shell.ts.aucune.donnee.434e5488:Aucune donnée`;
  @Input() emptyDescription = '';
  @Input() emptyIcon = 'pi-inbox';
}
