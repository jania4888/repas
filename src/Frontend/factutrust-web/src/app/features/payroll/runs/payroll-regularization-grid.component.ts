/// <reference types="@angular/localize" />
import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { MessageModule } from 'primeng/message';
import { ButtonComponent } from '@shared/components/button/button.component';
import { PayrollService, IrppRegularization } from '@core/services/payroll.service';
import { ToastService } from '@core/services/toast.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { PayrollSectionComponent, PayrollAmountPipe } from '../shared';
import { outcomeLabel, outcomeSeverity, resolveOutcome } from '../regularization/irpp-regularization.view-model';

/**
 * Régularisations IRPP du cycle : génération batch et consultation.
 *
 * Le parcours est en deux temps volontairement : générer lit les cumuls et propose les
 * montants, un second « Calculer » les porte sur les bulletins. Le gestionnaire voit donc
 * chaque montant avant qu'il n'affecte la paie.
 */
@Component({
  selector: 'app-payroll-regularization-grid',
  standalone: true,
  imports: [
    CommonModule,
    TableModule,
    TagModule,
    MessageModule,
    ButtonComponent,
    PayrollSectionComponent,
    PayrollAmountPipe
  ],
  template: `
    <app-payroll-section
      title="Régularisation IRPP annuelle" i18n-title="@@payroll.runs.regularisation.irpp.annuelle.b7bb1560"
      subtitle="Compare l'impôt dû sur le cumul réel de l'exercice à l'impôt déjà retenu. Après génération, relancez le calcul du cycle pour porter les écarts sur les bulletins." i18n-subtitle="@@payroll.runs.compare.l.impot.du.sur.le.cumul.reel.de.271101e8"
      icon="pi-calculator">

      @if (!readOnly) {
        <div class="payroll-toolbar mb-3">
          <app-button variant="primary" icon="pi-refresh" iconPos="left"
            [disabled]="generating()" (click)="confirmGenerate()" i18n="@@payroll.runs.generer.les.regularisations.594ad942"> Générer les régularisations </app-button>
        </div>
      }

      @if (lines().length > 0 && !readOnly) {
        <p-message severity="info"
          text="Les montants ci-dessous ne sont pas encore portés sur les bulletins. Relancez le calcul du cycle pour les appliquer." i18n-text="@@payroll.runs.les.montants.ci.dessous.ne.sont.pas.enco.90699e62"
          styleClass="mb-3 block" />
      }

      <div class="payroll-table-scroll">
        <p-table [value]="lines()" styleClass="p-datatable-sm">
          <ng-template pTemplate="header">
            <tr>
              <th i18n="@@payroll.runs.salarie.27f97915">Salarié</th>
              <th i18n="@@payroll.runs.motif.2a198f47">Motif</th>
              <th class="text-right" i18n="@@payroll.runs.cumul.net.imposable.c17a5048">Cumul net imposable</th>
              <th class="text-right" i18n="@@payroll.runs.irpp.du.76631bbf">IRPP dû</th>
              <th class="text-right" i18n="@@payroll.runs.irpp.retenu.7cc73d3d">IRPP retenu</th>
              <th class="text-right" i18n="@@payroll.runs.ecart.a.porter.541d946a">Écart à porter</th>
              <th i18n="@@payroll.runs.sens.55928a79">Sens</th>
              @if (!readOnly) { <th></th> }
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-line>
            <tr>
              <td>{{ line.employeeName }}</td>
              <td>{{ line.reasonLabel }}</td>
              <td class="text-right tabnum">{{ line.cumulNetTaxable | payrollAmount:false }}</td>
              <td class="text-right tabnum">{{ line.irppDue | payrollAmount:false }}</td>
              <td class="text-right tabnum">{{ line.cumulIrppWithheld | payrollAmount:false }}</td>
              <td class="text-right tabnum">
                {{ line.effectiveTotalDelta | payrollAmount }}
                @if (line.isOverridden) {
                  <p-tag value="Ajusté manuellement" severity="warn" class="ml-2" />
                }
              </td>
              <td>
                <p-tag [value]="sensLabel(line)" [severity]="sensSeverity(line)" />
              </td>
              @if (!readOnly) {
                <td class="actions">
                  <button type="button" class="p-button p-button-text p-button-danger p-button-sm"
                    (click)="confirmDelete(line)" i18n="@@payroll.runs.supprimer.1acfc1c7">Supprimer</button>
                </td>
              }
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td [attr.colspan]="readOnly ? 7 : 8" i18n="@@payroll.runs.aucune.regularisation.pour.ce.mois.elles.se.gene.656a0fce"> Aucune régularisation pour ce mois. Elles se génèrent en décembre et lors des soldes de tout compte. </td>
            </tr>
          </ng-template>
        </p-table>
      </div>
    </app-payroll-section>
  `,
  styles: [`
    .mb-3 { margin-bottom: var(--spacing-4); }
    .ml-2 { margin-left: var(--spacing-2); }
    .actions { white-space: nowrap; }
    .tabnum { font-variant-numeric: tabular-nums; }
    .block { display: block; }
  `]
})
export class PayrollRegularizationGridComponent implements OnInit {
  @Input({ required: true }) runId!: string;
  @Input({ required: true }) year!: number;
  @Input({ required: true }) month!: number;
  @Input() readOnly = false;

  private readonly payroll = inject(PayrollService);
  private readonly toast = inject(ToastService);
  private readonly confirmation = inject(ConfirmationService);

  readonly lines = signal<IrppRegularization[]>([]);
  readonly generating = signal(false);

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.payroll.listIrppRegularizations(this.year, this.month).subscribe({
      next: res => this.lines.set(res.data ?? []),
      error: () => this.lines.set([])
    });
  }

  sensLabel(line: IrppRegularization): string {
    return outcomeLabel(resolveOutcome(line.effectiveTotalDelta));
  }

  sensSeverity(line: IrppRegularization): 'warn' | 'success' | 'info' {
    return outcomeSeverity(resolveOutcome(line.effectiveTotalDelta));
  }

  confirmGenerate(): void {
    if (this.readOnly) return;
    this.confirmation.confirm({
      message: 'Générer les régularisations IRPP de tous les salariés éligibles ? '
        + 'Les cumuls seront rafraîchis et les montants ajustés manuellement seront conservés.',
      header: 'Régularisation IRPP',
      acceptLabel: $localize`:@@payroll-regularization-grid.component.acceptLabel.G_n_rer:Générer`,
      rejectLabel: $localize`:@@payroll-regularization-grid.component.rejectLabel.Annuler:Annuler`,
      accept: () => this.generate()
    });
  }

  private generate(): void {
    this.generating.set(true);
    this.payroll.generateIrppRegularizations(this.runId).subscribe({
      next: res => {
        this.generating.set(false);
        const data = res.data;
        const preserved = data?.preservedOverrides ?? 0;
        const detail = preserved > 0
          ? `${res.message ?? $localize`:@@ui.tern.generation.terminee.cf83c2:Génération terminée.`} ${preserved} ajustement(s) manuel(s) conservé(s).`
          : res.message ?? $localize`:@@ui.tern.generation.terminee.cf83c2:Génération terminée.`;
        this.toast.add({ severity: 'success', summary: $localize`:@@payroll-regularization-grid.component.summary.R_gularisation_I:Régularisation IRPP`, detail });
        this.reload();
      },
      error: err => {
        this.generating.set(false);
        this.toast.add({
          severity: 'error',
          summary: $localize`:@@payroll-regularization-grid.component.summary.R_gularisation_I:Régularisation IRPP`,
          detail: err?.error?.message ?? $localize`:@@ui.tern.generation.impossible.0031b8:Génération impossible.`
        });
      }
    });
  }

  confirmDelete(line: IrppRegularization): void {
    if (this.readOnly) return;
    this.confirmation.confirm({
      message: `Supprimer la régularisation de ${line.employeeName} ?`,
      header: 'Confirmation',
      acceptLabel: $localize`:@@payroll-regularization-grid.component.acceptLabel.Supprimer:Supprimer`,
      rejectLabel: $localize`:@@payroll-regularization-grid.component.rejectLabel.Annuler:Annuler`,
      acceptButtonStyleClass: 'btn-danger',
      accept: () => this.delete(line.id)
    });
  }

  private delete(id: string): void {
    this.payroll.deleteIrppRegularization(id).subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: $localize`:@@payroll-regularization-grid.component.summary.R_gularisation_I:Régularisation IRPP`, detail: $localize`:@@payroll-regularization-grid.component.detail.Supprimée.:Supprimée.` });
        this.reload();
      },
      error: err => this.toast.add({
        severity: 'error',
        summary: $localize`:@@payroll-regularization-grid.component.summary.R_gularisation_I:Régularisation IRPP`,
        detail: err?.error?.message ?? $localize`:@@ui.tern.suppression.impossible.0dffe4:Suppression impossible.`
      })
    });
  }
}
