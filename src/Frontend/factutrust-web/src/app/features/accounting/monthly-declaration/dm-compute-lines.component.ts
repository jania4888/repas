import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TableModule } from 'primeng/table';
import { MonthlyDeclarationDiagnosticDto, MonthlyDeclarationLineDto } from '../services/accounting.service';
import {
  DmComputeFamilyView,
  describeDiagnostic,
  diagnosticSeverity,
  distinctDiagnostics
} from './monthly-declaration-compute.view-model';

/**
 * Détail du calcul, une table par famille. Composant muet : il affiche ce que le conteneur lui
 * donne et n'appelle rien.
 *
 * Chaque en-tête de famille porte le rapprochement — total du détail, montant déclaré, et la
 * phrase qui dit ce que l'écart signifie. Le mettre là plutôt que dans une
 * table séparée épargne au lecteur d'avoir à faire la correspondance lui-même.
 */
@Component({
  selector: 'app-dm-compute-lines',
  standalone: true,
  imports: [CommonModule, TableModule],
  template: `
    @for (view of views; track view.family) {
      <section class="card dm-family">
        <header class="dm-family__head">
          <div class="dm-family__title">
            <h3>{{ view.label }}</h3>
            @if (view.errorCount) {
              <span class="dm-chip dm-chip--error" i18n="@@accounting.monthly-declaration.erreur.s.857d2908">{{ view.errorCount }} erreur(s)</span>
            }
            @if (view.warningCount) {
              <span class="dm-chip dm-chip--warn" i18n="@@accounting.monthly-declaration.avertissement.s.7beb8788">{{ view.warningCount }} avertissement(s)</span>
            }
            @if (view.hasManualInput) {
              <span class="dm-chip dm-chip--warn" i18n="@@accounting.monthly-declaration.saisie.manuelle.attendue.0b611312">saisie manuelle attendue</span>
            }
          </div>

          <dl class="dm-family__totals">
            <div>
              <dt i18n="@@accounting.monthly-declaration.detail.7ce06afc">Détail</dt>
              <dd>{{ view.withheldTotal | number: '1.3-3' }}</dd>
            </div>
            @if (view.declaredAmount !== null) {
              <div>
                <dt i18n="@@accounting.monthly-declaration.declare.8b244d70">Déclaré</dt>
                <dd>{{ view.declaredAmount | number: '1.3-3' }}</dd>
              </div>
            }
          </dl>
        </header>

        <p class="dm-family__gap" [class.dm-family__gap--flag]="view.gapMillimes !== 0 && view.gapMillimes !== null">
          {{ view.gapText }}
        </p>

        <p-table
          [value]="view.lines"
          styleClass="p-datatable-sm accounting-datatable"
          [rowHover]="true">
          <ng-template pTemplate="header">
            <tr>
              <th scope="col" i18n="@@accounting.monthly-declaration.code.adac6937">Code</th>
              <th scope="col" i18n="@@accounting.monthly-declaration.libelle.f5485bba">Libellé</th>
              <th scope="col" i18n="@@accounting.monthly-declaration.code.rapport.149223b0">Code rapport</th>
              <th scope="col" class="dm-num" i18n="@@accounting.monthly-declaration.montant.brut.6c8cf046">Montant brut</th>
              <th scope="col" class="dm-num" i18n="@@accounting.monthly-declaration.taux.18bc95b8">Taux</th>
              <th scope="col" class="dm-num" i18n="@@accounting.monthly-declaration.retenue.88cf18f4">Retenue</th>
            </tr>
          </ng-template>

          <ng-template pTemplate="body" let-line>
            <tr>
              <td class="dm-mono">{{ line.code }}</td>
              <td>
                {{ line.label }}
                @if (line.requiresManualInput) {
                  <span class="dm-chip dm-chip--warn" title="Rubrique « Fixe » sans constante enregistrée." i18n-title="@@accounting.monthly-declaration.rubrique.fixe.sans.constante.enregistree.bae9ebd1" i18n="@@accounting.monthly-declaration.a.saisir.3e42af61"> à saisir </span>
                }
                @for (d of diagnostics(line); track $index) {
                  <p class="dm-diag" [class.dm-diag--error]="severity(d) === 'error'">
                    {{ describe(d) }}
                  </p>
                }
              </td>
              <td class="dm-mono">{{ line.reportCode }}</td>
              <td class="dm-num">{{ line.gross | number: '1.3-3' }}</td>
              <td class="dm-num">
                {{ line.ratePercentApplied ? (line.ratePercentApplied | number: '1.0-3') + ' %' : '—' }}
              </td>
              <td class="dm-num dm-num--strong">{{ line.withheld | number: '1.3-3' }}</td>
            </tr>
          </ng-template>
        </p-table>
      </section>
    } @empty {
      <div class="card dm-empty" i18n="@@accounting.dm-compute-lines.ts.aucune.ligne.produite.3a7f12c8"> Aucune ligne produite pour cette période : ce dossier ne déclare aucune famille, ou aucune de
        ses rubriques ne s’applique au mois choisi. Les montants déclarés vaudront 0. </div>
    }
  `,
  styles: `
    .dm-family { margin-bottom: var(--spacing-4); }
    .dm-family__head { display: flex; flex-wrap: wrap; gap: var(--spacing-3); align-items: flex-start; justify-content: space-between; }
    .dm-family__title { display: flex; flex-wrap: wrap; align-items: center; gap: var(--spacing-2); }
    .dm-family__title h3 { margin: 0; font-size: var(--font-size-base); font-weight: var(--font-weight-semibold); }
    .dm-family__totals { display: flex; gap: var(--spacing-5); margin: 0; }
    .dm-family__totals dt { font-size: var(--font-size-xs); color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.04em; }
    .dm-family__totals dd { margin: 0; font-family: ui-monospace, monospace; font-weight: var(--font-weight-semibold); }
    .dm-family__gap { margin: var(--spacing-2) 0 var(--spacing-3); font-size: var(--font-size-sm); color: var(--color-text-secondary); }
    .dm-family__gap--flag { color: var(--color-warning-700, #a16207); font-weight: var(--font-weight-medium); }
    .dm-mono { font-family: ui-monospace, monospace; }
    .dm-num { text-align: end; font-family: ui-monospace, monospace; }
    .dm-num--strong { font-weight: var(--font-weight-semibold); }
    .dm-chip { display: inline-block; margin-inline-start: var(--spacing-2); padding: 0.1rem 0.45rem; border-radius: var(--radius-pill, 999px); font-size: var(--font-size-xs); font-weight: var(--font-weight-semibold); }
    .dm-chip--warn { background: var(--color-warning-50, #fffbeb); color: var(--color-warning-700, #a16207); border: 1px solid var(--color-warning-200, #fde68a); }
    .dm-chip--error { background: var(--color-error-50, #fef2f2); color: var(--color-error-700, #b91c1c); border: 1px solid var(--color-error-200, #fecaca); }
    .dm-diag { margin: var(--spacing-1) 0 0; font-size: var(--font-size-xs); color: var(--color-warning-700, #a16207); }
    .dm-diag--error { color: var(--color-error-700, #b91c1c); }
    .dm-empty { text-align: center; padding: var(--spacing-6); color: var(--color-text-tertiary); }
  `
})
export class DmComputeLinesComponent {
  @Input() views: DmComputeFamilyView[] = [];

  diagnostics(line: MonthlyDeclarationLineDto): MonthlyDeclarationDiagnosticDto[] {
    return distinctDiagnostics(line.diagnostics);
  }

  describe(d: MonthlyDeclarationDiagnosticDto): string {
    return describeDiagnostic(d);
  }

  severity(d: MonthlyDeclarationDiagnosticDto): string {
    return diagnosticSeverity(d.kind);
  }
}
