/// <reference types="@angular/localize" />
import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

/** Les 5 étapes nommées du parcours dédié (D1), partagées par les 3 écrans de la fonctionnalité. */
export interface BseStep {
  label: string;
  hint: string;
}

export const BSE_STEPS: readonly BseStep[] = [
  {
    label: $localize`:@@accounting.bank-statement-entries.ts.source.6da13add:Source`,
    hint: $localize`:@@accounting.bank-statement-entries.ts.compte.journal.fichier.ae422d7a:Compte, journal, fichier`
  },
  {
    label: $localize`:@@accounting.bank-statement-entries.ts.mappage.des.colonnes.29edf60d:Mappage des colonnes`,
    hint: $localize`:@@accounting.bank-statement-entries.ts.csv.excel.uniquement.15e658b0:CSV / Excel uniquement`
  },
  {
    label: $localize`:@@accounting.bank-statement-entries.ts.controle.des.lignes.lues.0b7b2d23:Contrôle des lignes lues`,
    hint: $localize`:@@accounting.bank-statement-entries.ts.soldes.et.anomalies.32b6653f:Soldes et anomalies`
  },
  {
    label: $localize`:@@accounting.bank-statement-entries.ts.propositions.d.ecritures.f9251387:Propositions d'écritures`,
    hint: $localize`:@@accounting.bank-statement-entries.ts.contreparties.a.valider.5c1bc756:Contreparties à valider`
  },
  {
    label: $localize`:@@accounting.bank-statement-entries.ts.resultat.7186e8ff:Résultat`,
    hint: $localize`:@@accounting.bank-statement-entries.ts.brouillons.crees.f7809bbc:Brouillons créés`
  }
];

/** Repère visuel des 5 étapes nommées (D1), identique sur les 3 écrans. `activeIndex` est 0-based. */
@Component({
  selector: 'app-bse-stepper',
  standalone: true,
  imports: [CommonModule],
  template: `
    <ol class="bse-stepper" data-testid="bse-stepper">
      @for (step of steps; track step.label; let i = $index) {
        <li
          class="bse-stepper-item"
          [class.bse-stepper-item--done]="i < activeIndex"
          [class.bse-stepper-item--current]="i === activeIndex"
          [attr.data-testid]="'bse-stepper-step-' + i"
          [attr.aria-current]="i === activeIndex ? 'step' : null">
          <span class="bse-stepper-index">{{ i < activeIndex ? '✓' : i + 1 }}</span>
          <span class="bse-stepper-text">
            <strong>{{ step.label }}</strong>
            <small>{{ step.hint }}</small>
          </span>
        </li>
      }
    </ol>
  `,
  styles: [
    `
      .bse-stepper { display: flex; gap: 0.75rem; list-style: none; margin: 0 0 1.25rem; padding: 0; flex-wrap: wrap; }
      .bse-stepper-item { display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem 0.75rem; border-radius: 999px; background: #f1f3f5; color: #6c757d; }
      .bse-stepper-item--current { background: #e7f1ff; color: #0d6efd; font-weight: 600; }
      .bse-stepper-item--done { background: #e6f6ec; color: #1a7f4e; }
      .bse-stepper-index { display: inline-flex; align-items: center; justify-content: center; width: 1.5rem; height: 1.5rem; border-radius: 50%; background: rgba(0, 0, 0, 0.08); font-size: 0.75rem; }
      .bse-stepper-text { display: flex; flex-direction: column; line-height: 1.1; }
      .bse-stepper-text small { font-size: 0.7rem; opacity: 0.8; }
    `
  ]
})
export class BseStepperComponent {
  @Input() steps: readonly BseStep[] = BSE_STEPS;
  @Input() activeIndex = 0;
}
