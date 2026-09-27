/// <reference types="@angular/localize" />
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SelectModule } from 'primeng/select';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputSwitchModule } from 'primeng/inputswitch';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TabsModule } from 'primeng/tabs';
import { PayrollService, PayrollParameters, PayrollGarnishmentBracket, PayrollFeatureFlags, PayrollLegalPreset, PayrollAccountingSettings } from '@core/services/payroll.service';
import { ToastService } from '@core/services/toast.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { TooltipModule } from 'primeng/tooltip';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { FormSectionComponent } from '@shared/components/form-section/form-section.component';
import { PayrollSocialFundsSettingsComponent } from './payroll-social-funds-settings.component';

@Component({
  selector: 'app-payroll-settings',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TabsModule,
    SelectModule,
    InputNumberModule,
    InputSwitchModule,
    TableModule,
    ButtonModule,
    PageHeaderComponent,
    ButtonComponent,
    FormSectionComponent,
    TooltipModule,
    PayrollSocialFundsSettingsComponent
  ],
  template: `
    <app-page-header title="Paramètres de paie" i18n-title="@@payroll.settings.parametres.de.paie.bdda7686" subtitle="Barème IRPP, taux légaux et conformité par exercice." i18n-subtitle="@@payroll.settings.bareme.irpp.taux.legaux.et.conformite.pa.88cf0295" />

    <div class="payroll-toolbar mb-3">
      <label for="fiscalYear" i18n="@@payroll.settings.exercice.e171e2b0">Exercice</label>
      <p-inputNumber id="fiscalYear" [(ngModel)]="fiscalYear" (ngModelChange)="load()" [useGrouping]="false" [min]="2000" [max]="2100" styleClass="w-8rem" />
      <app-button type="button" variant="secondary" label="Recharger défauts LF" i18n-label="@@payroll.settings.recharger.defauts.lf.0c7024bd" icon="pi pi-refresh" (clicked)="reloadLegalPreset()" class="ml-3" />
    </div>

    @if (accountingForm(); as acc) {
      <div class="sce-config-card mb-3">
        <div class="sce-config-card__title" i18n="@@payroll.settings.comptabilisation.de.la.paie.imputation.c.897b3085">
          <i class="pi pi-calculator"></i>
          Comptabilisation de la paie — imputation comptable du dossier
        </div>
        <div class="sce-config-card__grid">
          <div>
            <label class="sce-config-card__label" for="sceProfile" i18n="@@payroll.settings.profil.de.comptabilisation.b4b5d82d">Profil de comptabilisation</label>
            <p-select
              inputId="sceProfile"
              [options]="accountProfileOptions"
              [(ngModel)]="acc.accountProfile"
              [ngModelOptions]="{ standalone: true }"
              (ngModelChange)="onProfileChange($event)"
              optionLabel="label"
              optionValue="value"
              appendTo="body"
              styleClass="w-full" />
          </div>
          <div>
            <label class="sce-config-card__label" for="sceEffectiveDate" i18n="@@payroll.settings.date.de.bascule.1er.du.mois.faf864ed">Date de bascule (1er du mois)</label>
            <input
              id="sceEffectiveDate"
              type="month"
              class="form-control"
              [ngModel]="effectiveMonth()"
              [ngModelOptions]="{ standalone: true }"
              (ngModelChange)="onEffectiveMonthChange($event)"
              [min]="earliestMonth()" />
            <small class="sce-config-card__hint">
              @if (accountingSettings()?.lastSettledPeriod) {<ng-container i18n="@@payroll.settings.dernier.cycle.arrete.1a01a895">
                Dernier cycle arrêté : {{ accountingSettings()?.lastSettledPeriod }}.
              </ng-container>} @else {<ng-container i18n="@@payroll.settings.aucun.cycle.arrete.a.ce.jour.add4b7f7">
                Aucun cycle arrêté à ce jour.
              </ng-container>}
            </small>
          </div>
          <div>
            <label class="sce-config-card__label" for="sceInKindAccount" i18n="@@payroll.settings.compte.de.compensation.avantage.en.nature.dcbd8630">Compte de compensation avantage en nature</label>
            <input
              id="sceInKindAccount"
              type="text"
              class="form-control"
              maxlength="20"
              [(ngModel)]="acc.inKindOffsetAccount"
              [ngModelOptions]="{ standalone: true }" />
          </div>
          <div>
            <span class="sce-config-card__label" i18n="@@payroll.settings.reglement.strict.avances.prets.saisies.8f4f09d5">Règlement strict (avances/prêts/saisies)</span>
            <span class="sce-config-card__value">{{ featureFlags()?.payrollStrictSettlementEnabled ? loc_ui_tern_active_42ce0b : loc_ui_tern_desactive_2d32fa }}</span>
          </div>
          <div>
            <label class="sce-config-card__label" for="sceDisbursement" i18n="@@payroll.settings.ecritures.de.decaissement.avances.prets.fc6fcade">Écritures de décaissement (avances/prêts)</label>
            <p-inputSwitch inputId="sceDisbursement" [(ngModel)]="acc.disbursementEntriesEnabled" [ngModelOptions]="{ standalone: true }" />
          </div>
          <div>
            <label class="sce-config-card__label" for="sceSalarySplit" i18n="@@payroll.settings.ventilation.detaillee.des.salaires.640.2cd2becc">Ventilation détaillée des salaires (640)</label>
            <p-inputSwitch inputId="sceSalarySplit" [(ngModel)]="acc.detailedSalarySplitEnabled" [ngModelOptions]="{ standalone: true }" />
          </div>
        </div>

        @if (acc.accountProfile === 'Sce2026' && !acc.accountProfileEffectiveDate) {
          <p class="sce-warn-panel mt-2" role="alert">
            <i class="pi pi-exclamation-triangle"></i>
            <span i18n="@@payroll.settings.le.profil.sce.2026.exige.une.date.de.bascule.san.01ad32a6"> Le profil SCE 2026 exige une date de bascule. Sans elle, il s'appliquerait aussi aux cycles
              antérieurs : rouvrir puis revalider l'un d'eux en réécrirait l'imputation. </span>
          </p>
        }

        <p class="sce-config-card__note">
          @if (accountingSettings()?.isTenantOverride) {<ng-container i18n="@@payroll.settings.reglage.propre.a.ce.dossier.4929cd5b">
            Réglage propre à ce dossier.
          </ng-container>} @else {<ng-container i18n="@@payroll.settings.ce.dossier.herite.de.la.configuration.gl.908301ef">
            Ce dossier hérite de la configuration globale ; enregistrer créera son réglage propre.
          </ng-container>}<ng-container i18n="@@payroll.settings.les.cycles.anterieurs.a.la.date.de.bascu.9daa86dd">
          Les cycles antérieurs à la date de bascule conservent leur imputation d'origine.
          Les comptes SCE par régime de fonds social (part salarié / part employeur) sont configurés ci-dessous.
        </ng-container></p>
        <div class="sce-config-card__actions">
          <app-button
            type="button"
            variant="primary"
            label="Enregistrer l'imputation" i18n-label="@@payroll.settings.enregistrer.l.imputation.12a551f1"
            icon="pi pi-save"
            [disabled]="savingAccounting()"
            (clicked)="saveAccountingSettings()" />
        </div>
      </div>
    }

    @if (presetDrift().length > 0) {
      <div class="preset-drift-banner mb-3" role="alert" aria-live="polite">
        <div class="preset-drift-banner__title" i18n="@@payroll.settings.ecart.preset.legal.les.parametres.de.l.e.9f1527d6">
          <i class="pi pi-exclamation-triangle"></i>
          Écart preset légal — les paramètres de l'exercice {{ fiscalYear }} divergent du défaut LF
        </div>
        <ul class="preset-drift-banner__list">
          @for (d of presetDrift(); track d.label) {
            <li i18n="@@payroll.settings.tenant.lf.e603a191"><strong>{{ d.label }}</strong> : tenant {{ d.current }} → LF {{ d.expected }}</li>
          }
        </ul>
        <div class="preset-drift-banner__actions">
          <app-button type="button" variant="secondary" label="Recharger défauts LF" i18n-label="@@payroll.settings.recharger.defauts.lf.0c7024bd" icon="pi pi-refresh" (clicked)="reloadLegalPreset()" />
        </div>
      </div>
    }

    @if (params()) {
      <form (ngSubmit)="save()">
        <p-tabs class="ft-tabs" [lazy]="true">
          <p-tablist>
            <p-tab [value]="0"><i class="pi pi-percentage mr-2"></i><span i18n="@@payroll.settings.taux.legaux.1f4d328a">Taux légaux</span></p-tab>
            <p-tab [value]="1"><i class="pi pi-table mr-2"></i><span i18n="@@payroll.settings.bareme.irpp.b6da2fe0">Barème IRPP</span></p-tab>
            <p-tab [value]="2"><i class="pi pi-users mr-2"></i><span i18n="@@payroll.settings.deductions.familiales.ebcbf9e4">Déductions familiales</span></p-tab>
            <p-tab [value]="3"><i class="pi pi-shield mr-2"></i><span i18n="@@payroll.settings.conformite.905cab8c">Conformité</span></p-tab>
            <p-tab [value]="4"><i class="pi pi-exclamation-triangle mr-2"></i><span i18n="@@payroll.settings.saisies.1b5fdae4">Saisies</span></p-tab>
            <p-tab [value]="5"><i class="pi pi-heart mr-2"></i><span i18n="@@payroll.settings.mutuelles.5a091ac3">Mutuelles</span></p-tab>
          </p-tablist>
          <p-tabpanels>
          <p-tabpanel [value]="0">
            <app-form-section title="CNSS" i18n-title="@@payroll.settings.cnss.a04d171a" icon="pi-building" variant="compact">
              <div class="payroll-form-row payroll-form-row--cols-4">
                <div class="payroll-form-group">
                  <label i18n="@@payroll.settings.cnss.salarie.b1cf7b5e">CNSS salarié (%)</label>
                  <p-inputNumber [(ngModel)]="params()!.cnssEmployeeRate" name="cnssEmployeeRate" [minFractionDigits]="2" [maxFractionDigits]="4" [min]="0" [max]="100" [locale]="'fr-TN'" styleClass="w-full" />
                </div>
                <div class="payroll-form-group">
                  <label i18n="@@payroll.settings.cnss.employeur.b5fc90d8">CNSS employeur (%)</label>
                  <p-inputNumber [(ngModel)]="params()!.cnssEmployerRate" name="cnssEmployerRate" [minFractionDigits]="2" [maxFractionDigits]="4" [min]="0" [max]="100" [locale]="'fr-TN'" styleClass="w-full" />
                </div>
                <div class="payroll-form-group">
                  <label i18n="@@payroll.settings.cnss.salarie.rsa.cf0f2f35">CNSS salarié RSA (%)</label>
                  <p-inputNumber [(ngModel)]="params()!.cnssEmployeeRateRsa" name="cnssEmployeeRateRsa" [minFractionDigits]="2" [maxFractionDigits]="4" [min]="0" [max]="100" [locale]="'fr-TN'" styleClass="w-full" />
                </div>
                <div class="payroll-form-group">
                  <label i18n="@@payroll.settings.cnss.employeur.rsa.b82fd870">CNSS employeur RSA (%)</label>
                  <p-inputNumber [(ngModel)]="params()!.cnssEmployerRateRsa" name="cnssEmployerRateRsa" [minFractionDigits]="2" [maxFractionDigits]="4" [min]="0" [max]="100" [locale]="'fr-TN'" styleClass="w-full" />
                </div>
              </div>
            </app-form-section>

            <app-form-section title="CSS" i18n-title="@@payroll.settings.css.194e13da" icon="pi-percentage" variant="compact">
              <div class="payroll-form-row payroll-form-row--cols-3">
                <div class="payroll-form-group">
                  <label i18n="@@payroll.settings.css.651e5f38">CSS (%)</label>
                  <p-inputNumber [(ngModel)]="params()!.cssRate" name="cssRate" [minFractionDigits]="2" [maxFractionDigits]="4" [min]="0" [max]="100" [locale]="'fr-TN'" styleClass="w-full" />
                </div>
                <div class="payroll-form-group">
                  <label pTooltip="Seuil d'exonération CSS annuel" i18n-pTooltip="@@payroll.settings.seuil.d.exoneration.css.annuel.0048d5a7" i18n="@@payroll.settings.seuil.exoneration.css.tnd.an.a37b383d">Seuil exonération CSS (TND/an)</label>
                  <p-inputNumber [(ngModel)]="params()!.cssAnnualExemptionThreshold" name="cssExemption" [minFractionDigits]="3" [min]="0" [locale]="'fr-TN'" styleClass="w-full" />
                </div>
                <div class="payroll-form-group">
                  <label i18n="@@payroll.settings.css.patronale.860c17e1">CSS patronale (%)</label>
                  <p-inputNumber [(ngModel)]="params()!.cssEmployerRate" name="cssEmployerRate" [minFractionDigits]="2" [maxFractionDigits]="4" [min]="0" [max]="100" [locale]="'fr-TN'" styleClass="w-full" />
                </div>
              </div>
            </app-form-section>

            <app-form-section title="TFP &amp; FOPROLOS" i18n-title="@@payroll.settings.tfp.foprolos.64fa1b47" icon="pi-briefcase" variant="compact">
              <div class="payroll-form-row payroll-form-row--cols-3">
                <div class="payroll-form-group">
                  <label i18n="@@payroll.settings.tfp.industrie.f955848c">TFP industrie (%)</label>
                  <p-inputNumber [(ngModel)]="params()!.tfpRateIndustry" name="tfpIndustry" [minFractionDigits]="2" [maxFractionDigits]="4" [min]="0" [max]="100" [locale]="'fr-TN'" styleClass="w-full" />
                </div>
                <div class="payroll-form-group">
                  <label i18n="@@payroll.settings.tfp.autres.43f0734a">TFP autres (%)</label>
                  <p-inputNumber [(ngModel)]="params()!.tfpRateOther" name="tfpOther" [minFractionDigits]="2" [maxFractionDigits]="4" [min]="0" [max]="100" [locale]="'fr-TN'" styleClass="w-full" />
                </div>
                <div class="payroll-form-group">
                  <label i18n="@@payroll.settings.foprolos.7ae9da03">FOPROLOS (%)</label>
                  <p-inputNumber [(ngModel)]="params()!.foprolosRate" name="foprolos" [minFractionDigits]="2" [maxFractionDigits]="4" [min]="0" [max]="100" [locale]="'fr-TN'" styleClass="w-full" />
                </div>
              </div>
            </app-form-section>

            <app-form-section title="SMIG &amp; avantages" i18n-title="@@payroll.settings.smig.avantages.1a084908" icon="pi-wallet" variant="compact">
              <div class="payroll-form-row payroll-form-row--cols-2">
                <div class="payroll-form-group">
                  <label i18n="@@payroll.settings.smig.mensuel.tnd.81332ee6">SMIG mensuel (TND)</label>
                  <p-inputNumber [(ngModel)]="params()!.monthlySmig" name="smig" [minFractionDigits]="3" [min]="0" [locale]="'fr-TN'" styleClass="w-full" />
                </div>
                <div class="payroll-form-group">
                  <label pTooltip="Plafond exonération ticket restaurant / jour (TND)" i18n-pTooltip="@@payroll.settings.plafond.exoneration.ticket.restaurant.jour.tnd.42da821e" i18n="@@payroll.settings.plafond.ticket.resto.jour.tnd.d6820062">Plafond ticket resto. / jour (TND)</label>
                  <p-inputNumber [(ngModel)]="params()!.mealVoucherDailyExemptionCap" name="mealVoucherCap" [minFractionDigits]="3" [min]="0" [locale]="'fr-TN'" styleClass="w-full" />
                </div>
              </div>
            </app-form-section>

            <app-form-section title="Frais professionnels" i18n-title="@@payroll.settings.frais.professionnels.21e6559e" icon="pi-calculator" variant="compact">
              <div class="payroll-form-row payroll-form-row--cols-2">
                <div class="payroll-form-group">
                  <label i18n="@@payroll.settings.frais.pro.80090a41">Frais pro. (%)</label>
                  <p-inputNumber [(ngModel)]="params()!.professionalExpensesRate" name="proExpRate" [minFractionDigits]="2" [maxFractionDigits]="4" [min]="0" [max]="100" [locale]="'fr-TN'" styleClass="w-full" />
                </div>
                <div class="payroll-form-group">
                  <label i18n="@@payroll.settings.plafond.frais.pro.annuel.cdca3768">Plafond frais pro. (annuel)</label>
                  <p-inputNumber [(ngModel)]="params()!.professionalExpensesAnnualCap" name="proExpCap" [minFractionDigits]="3" [min]="0" [locale]="'fr-TN'" styleClass="w-full" />
                </div>
              </div>
            </app-form-section>

            <p class="payroll-info-panel" i18n="@@payroll.settings.references.legales.tunisiennes.cnss.9.18.16.57.c.84e653d6">Références légales tunisiennes : CNSS 9,18 % / 16,57 % — CSS 0,5 % (seuil 5 000 TND/an) — TFP 1 % industrie, 2 % autres — FOPROLOS 1 % — frais professionnels 10 % plafonnés à 2 000 TND/an.</p>
          </p-tabpanel>

          <p-tabpanel [value]="1">
            <p-table [value]="params()!.irppBrackets" styleClass="p-datatable-sm mb-3">
              <ng-template pTemplate="header">
                <tr>
                  <th i18n="@@payroll.settings.seuil.inferieur.tnd.ff1ecd2c">Seuil inférieur (TND)</th>
                  <th i18n="@@payroll.settings.taux.bb9a8c5a">Taux (%)</th>
                  <th></th>
                </tr>
              </ng-template>
              <ng-template pTemplate="body" let-bracket let-i="rowIndex">
                <tr>
                  <td>
                    <p-inputNumber [(ngModel)]="bracket.lowerBound" [name]="'lb' + i" [minFractionDigits]="3" [min]="0" [locale]="'fr-TN'" styleClass="w-full" />
                  </td>
                  <td>
                    <p-inputNumber [(ngModel)]="bracket.rate" [name]="'rate' + i" [minFractionDigits]="2" [maxFractionDigits]="4" [min]="0" [max]="100" [locale]="'fr-TN'" styleClass="w-full" />
                  </td>
                  <td>
                    <button type="button" pButton icon="pi pi-trash" class="p-button-text p-button-danger p-button-sm" (click)="removeBracket(i)"></button>
                  </td>
                </tr>
              </ng-template>
            </p-table>
            <app-button type="button" variant="outline" icon="pi-plus" iconPos="left" (click)="addBracket()" i18n="@@payroll.settings.ajouter.une.tranche.8b0e5f5b">Ajouter une tranche</app-button>
            <p class="payroll-info-text mt-2" i18n="@@payroll.settings.bareme.lf.2025.0.jusqu.a.5.000.15.25.30.33.36.38.010647b1">Barème LF 2025 : 0 % jusqu'à 5 000 — 15 % — 25 % — 30 % — 33 % — 36 % — 38 % — 40 % au-delà de 70 000 TND/an. La première tranche doit démarrer à 0 et les seuils être strictement croissants.</p>
          </p-tabpanel>

          <p-tabpanel [value]="2">
            <app-form-section title="Déductions de base" i18n-title="@@payroll.settings.deductions.de.base.954cfa41" icon="pi-home" variant="compact">
              <div class="payroll-form-row payroll-form-row--cols-3">
                <div class="payroll-form-group">
                  <label i18n="@@payroll.settings.chef.de.famille.annuel.tnd.783f610d">Chef de famille (annuel, TND)</label>
                  <p-inputNumber [(ngModel)]="params()!.headOfFamilyAnnualDeduction" name="headDeduction" [minFractionDigits]="3" [min]="0" [locale]="'fr-TN'" styleClass="w-full" />
                </div>
                <div class="payroll-form-group">
                  <label i18n="@@payroll.settings.enfant.a.charge.annuel.tnd.168ddbe7">Enfant à charge (annuel, TND)</label>
                  <p-inputNumber [(ngModel)]="params()!.childAnnualDeduction" name="childDeduction" [minFractionDigits]="3" [min]="0" [locale]="'fr-TN'" styleClass="w-full" />
                </div>
                <div class="payroll-form-group">
                  <label i18n="@@payroll.settings.enfants.deductibles.max.b270f5a1">Enfants déductibles max.</label>
                  <p-inputNumber [(ngModel)]="params()!.maxDeductibleChildren" name="maxChildren" [min]="0" [useGrouping]="false" [locale]="'fr-TN'" styleClass="w-full" />
                </div>
              </div>
            </app-form-section>

            <app-form-section title="Enfants à cas particulier" i18n-title="@@payroll.settings.enfants.a.cas.particulier.bb2e4f3f" icon="pi-user-plus" variant="compact">
              <div class="payroll-form-row payroll-form-row--cols-2">
                <div class="payroll-form-group">
                  <label pTooltip="Non boursier, âge &lt; 25 ans" i18n-pTooltip="@@payroll.settings.non.boursier.age.25.ans.71c74648" i18n="@@payroll.settings.enfant.etudiant.annuel.tnd.6d3a6cad">Enfant étudiant (annuel, TND)</label>
                  <p-inputNumber [(ngModel)]="params()!.studentChildAnnualDeduction" name="studentDeduction" [minFractionDigits]="3" [min]="0" [locale]="'fr-TN'" styleClass="w-full" />
                </div>
                <div class="payroll-form-group">
                  <label pTooltip="Hors plafond du nombre d'enfants déductibles" i18n-pTooltip="@@payroll.settings.hors.plafond.du.nombre.d.enfants.deductibles.a1cd7c51" i18n="@@payroll.settings.enfant.infirme.annuel.tnd.cd3c0c1d">Enfant infirme (annuel, TND)</label>
                  <p-inputNumber [(ngModel)]="params()!.disabledChildAnnualDeduction" name="disabledDeduction" [minFractionDigits]="3" [min]="0" [locale]="'fr-TN'" styleClass="w-full" />
                </div>
              </div>
            </app-form-section>

            <app-form-section title="Parents à charge" i18n-title="@@payroll.settings.parents.a.charge.ce5fcb65" icon="pi-users" variant="compact">
              <div class="payroll-form-row payroll-form-row--cols-2">
                <div class="payroll-form-group">
                  <label pTooltip="Pourcentage du revenu net imposable" i18n-pTooltip="@@payroll.settings.pourcentage.du.revenu.net.imposable.633aa3de" i18n="@@payroll.settings.parent.a.charge.taux.15ff076b">Parent à charge — taux (%)</label>
                  <p-inputNumber [(ngModel)]="params()!.parentDeductionRatePercent" name="parentRate" [minFractionDigits]="2" [maxFractionDigits]="4" [min]="0" [max]="100" [locale]="'fr-TN'" styleClass="w-full" />
                </div>
                <div class="payroll-form-group">
                  <label i18n="@@payroll.settings.parent.a.charge.plafond.annuel.tnd.de006f6e">Parent à charge — plafond annuel (TND)</label>
                  <p-inputNumber [(ngModel)]="params()!.parentAnnualDeductionCap" name="parentCap" [minFractionDigits]="3" [min]="0" [locale]="'fr-TN'" styleClass="w-full" />
                </div>
              </div>
            </app-form-section>

            <p class="payroll-info-panel" i18n="@@payroll.settings.deductions.familiales.annuelles.art.40.code.irpp.15829783">Déductions familiales annuelles (art. 40 code IRPP), mensualisées lors du calcul de paie. Les montants s'appliquent par exercice fiscal.</p>
          </p-tabpanel>

          <p-tabpanel [value]="3">
            <app-form-section title="Options de calcul" i18n-title="@@payroll.settings.options.de.calcul.f82369cb" icon="pi-cog" variant="compact">
              <div class="payroll-form-row payroll-form-row--cols-2">
                <div class="payroll-form-group switch-row">
                  <label for="enforceSmig" i18n="@@payroll.settings.controle.smig.sur.les.contrats.120f8cc7">Contrôle SMIG sur les contrats</label>
                  <p-inputSwitch inputId="enforceSmig" [(ngModel)]="params()!.enforceSmigOnContracts" name="enforceSmig" />
                </div>
                <div class="payroll-form-group switch-row">
                  <label for="extendedOvertime" i18n="@@payroll.settings.taux.hs.etendus.175.200.001e8643">Taux HS étendus (175 %, 200 %)</label>
                  <p-inputSwitch inputId="extendedOvertime" [(ngModel)]="params()!.enableExtendedOvertimeRates" name="extendedOvertime" />
                </div>
                <div class="payroll-form-group switch-row">
                  <label for="allowanceMatrix" i18n="@@payroll.settings.matrice.primes.imposable.cnss.b517a503">Matrice primes (imposable × CNSS)</label>
                  <p-inputSwitch inputId="allowanceMatrix" [(ngModel)]="params()!.enableAllowanceQuadrantMatrix" name="allowanceMatrix" />
                </div>
                <div class="payroll-form-group switch-row">
                  <label for="industrialSector" i18n="@@payroll.settings.secteur.industriel.tfp.1.au.lieu.de.2.080374b6">Secteur industriel (TFP 1 % au lieu de 2 %)</label>
                  <p-inputSwitch inputId="industrialSector" [(ngModel)]="params()!.isIndustrialSector" name="industrialSector" />
                </div>
                <div class="payroll-form-group switch-row">
                  <label for="irppRegularization" i18n="@@payroll.settings.regularisation.irpp.annuelle.solde.de.tout.compt.6ba9bbeb">Régularisation IRPP annuelle (solde de tout compte)</label>
                  <p-inputSwitch inputId="irppRegularization" [(ngModel)]="params()!.enableIrppRegularization" name="irppRegularization" />
                </div>
                <div class="payroll-form-group switch-row">
                  <label for="automaticProrata" i18n="@@payroll.settings.prorata.automatique.absences.suspensions.departs.1a4ac29b">Prorata automatique (absences, suspensions, départs)</label>
                  <p-inputSwitch inputId="automaticProrata" [(ngModel)]="params()!.enableAutomaticProrata" name="automaticProrata" />
                </div>
              </div>
            </app-form-section>

            <app-form-section title="Exonération IRPP SMIG" i18n-title="@@payroll.settings.exoneration.irpp.smig.6ac040e7" icon="pi-shield" variant="compact">
              <div class="payroll-form-row payroll-form-row--cols-2">
                <div class="payroll-form-group">
                  <label for="smigExemptionMode" i18n="@@payroll.settings.exoneration.irpp.smig.6ac040e7">Exonération IRPP SMIG</label>
                  <p-select
                    inputId="smigExemptionMode"
                    [(ngModel)]="params()!.smigIrppExemptionMode"
                    name="smigExemptionMode"
                    [options]="smigExemptionModeOptions"
                    optionLabel="label"
                    optionValue="value"
                    styleClass="w-full" />
                </div>
                @if (params()!.smigIrppExemptionMode === 'SmigPortion') {
                  <div class="payroll-form-group">
                    <label i18n="@@payroll.settings.taux.applicable.a.la.portion.smig.8bfa3778">Taux applicable à la portion SMIG (%)</label>
                    <p-inputNumber
                      [(ngModel)]="params()!.smigIrppExemptionRateOverride"
                      name="smigExemptionRate"
                      [minFractionDigits]="2"
                      [maxFractionDigits]="2"
                      [min]="0"
                      [max]="100"
                      [locale]="'fr-TN'"
                      placeholder="15 (barème)" i18n-placeholder="@@payroll.settings.15.bareme.cbb1f5b4"
                      styleClass="w-full" />
                    <small class="field-hint" i18n="@@payroll.settings.laisser.vide.pour.utiliser.le.premier.taux.non.n.e9efc786">Laisser vide pour utiliser le premier taux non nul du barème IRPP.</small>
                  </div>
                }
              </div>
              @if (params()!.smigIrppExemptionMode === 'SmigPortion') {
                <p class="sce-warn-panel" role="alert" i18n="@@payroll.settings.ce.mode.n.a.pas.de.base.legale.verifiee.d29a7204">
                  <i class="pi pi-exclamation-triangle"></i>
                  Ce mode n'a pas de base légale vérifiée et sous-déclare l'IRPP pour l'ensemble des salariés
                  lorsqu'il est actif. Pour la conformité, préférez le mode « Déduction annuelle 500 TND (SMIG/SMAG) »
                  qui applique une déduction annuelle supplémentaire de 500 TND à l'assiette imposable des salariés
                  payés au SMIG/SMAG.
                </p>
              }
            </app-form-section>

            <p class="payroll-info-panel" i18n="@@payroll.settings.la.deduction.annuelle.de.500.tnd.mode.conforme.s.804f6691"> La déduction annuelle de 500 TND (mode conforme) s'applique à l'assiette imposable des salariés payés
              au SMIG/SMAG et s'intègre naturellement à la projection mensuelle et à la régularisation IRPP.
              Le mode « Portion SMIG exonérée » est conservé pour les tenants qui l'utilisent mais n'a pas de base
              légale vérifiée ; le mode « Exonération totale » ne concerne que les salaires de base ≤ SMIG.
              La CSS n'est pas impactée. </p>
            <p class="payroll-info-panel" i18n="@@payroll.settings.le.taux.tfp.applique.aux.cycles.de.paie.de.cet.e.e62a13a5">Le taux TFP appliqué aux cycles de paie de cet exercice suit ce paramètre ; recalculez les cycles en brouillon pour l'appliquer.</p>
            <p class="payroll-info-panel" i18n="@@payroll.settings.la.regularisation.irpp.calcule.l.ecart.annuel.ir.8bfa88ab"> La régularisation IRPP calcule l'écart annuel IRPP/CSS lors d'un départ ou en fin d'exercice.
              Le prorata automatique réduit le brut des jours non travaillés (congés sans solde, suspensions non rémunérées, sortie en cours de mois).
              Les deux options s'appliquent aux cycles recalculés après modification. </p>
          </p-tabpanel>

          <p-tabpanel [value]="4">
            <p class="payroll-info-text mb-3" i18n="@@payroll.settings.bareme.de.quotite.saisissable.sur.le.net.mensuel.833f05b4">Barème de quotité saisissable sur le net mensuel (fraction saisissable par tranche). Si vide, 33 % du net s'applique par défaut.</p>
            <p-table [value]="garnishmentBrackets()" styleClass="p-datatable-sm mb-3">
              <ng-template pTemplate="header">
                <tr>
                  <th i18n="@@payroll.settings.seuil.net.mensuel.tnd.b1e03e5b">Seuil net mensuel (TND)</th>
                  <th i18n="@@payroll.settings.fraction.saisissable.f7b2fe2b">Fraction saisissable (%)</th>
                  <th></th>
                </tr>
              </ng-template>
              <ng-template pTemplate="body" let-bracket let-i="rowIndex">
                <tr>
                  <td>
                    <p-inputNumber [(ngModel)]="bracket.lowerBoundMonthlyNet" [name]="'gbLb' + i" [minFractionDigits]="3" [min]="0" [locale]="'fr-TN'" styleClass="w-full" />
                  </td>
                  <td>
                    <p-inputNumber [(ngModel)]="bracket.seizableFractionPercent" [name]="'gbFrac' + i" [minFractionDigits]="2" [maxFractionDigits]="4" [min]="0" [max]="100" [locale]="'fr-TN'" styleClass="w-full" />
                  </td>
                  <td>
                    <button type="button" pButton icon="pi pi-trash" class="p-button-text p-button-danger p-button-sm" (click)="removeGarnishmentBracket(i)"></button>
                  </td>
                </tr>
              </ng-template>
            </p-table>
            <app-button type="button" variant="outline" icon="pi-plus" iconPos="left" (click)="addGarnishmentBracket()" i18n="@@payroll.settings.ajouter.une.tranche.8b0e5f5b">Ajouter une tranche</app-button>
            <div class="form-actions mt-4">
              <app-button type="button" variant="primary" icon="pi-check" iconPos="left" (click)="saveGarnishmentBrackets()" i18n="@@payroll.settings.enregistrer.le.bareme.saisies.d8700aea">Enregistrer le barème saisies</app-button>
            </div>
          </p-tabpanel>

          <p-tabpanel [value]="5">
            <app-payroll-social-funds-settings [fiscalYear]="fiscalYear" />
          </p-tabpanel>
          </p-tabpanels>
        </p-tabs>

        <div class="form-actions mt-4">
          <app-button type="submit" variant="primary" icon="pi-check" iconPos="left" i18n="@@payroll.settings.enregistrer.f7c8bcd8">Enregistrer</app-button>
        </div>
      </form>
    }
  `,
  styles: [`
    .mb-3 { margin-bottom: var(--spacing-4); }
    .mt-2 { margin-top: var(--spacing-2); }
    .mt-4 { margin-top: var(--spacing-6); }
    .mr-2 { margin-right: var(--spacing-2); }
    .w-full { width: 100%; }
    .w-8rem { width: 8rem; }
    .form-actions { display: flex; gap: var(--spacing-3); }
    .sce-config-card { background: var(--surface-ground, #f8fafc); border: 1px solid var(--surface-border, #e2e8f0); border-radius: 8px; padding: var(--spacing-3); }
    .sce-config-card__title { display: flex; align-items: center; gap: var(--spacing-2); font-weight: 600; margin-bottom: var(--spacing-2); }
    .sce-config-card__title i { color: var(--primary-color, #2563eb); }
    .sce-config-card__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); gap: var(--spacing-2) var(--spacing-4); }
    .sce-config-card__label { display: block; font-size: .75rem; color: var(--text-color-secondary, #64748b); }
    .sce-config-card__value { display: block; font-weight: 600; }
    .sce-config-card__note { margin: var(--spacing-2) 0 0; font-size: .8rem; color: var(--text-color-secondary, #64748b); }
    .sce-config-card__hint { display: block; margin-top: 2px; font-size: .72rem; color: var(--text-color-secondary, #64748b); }
    .sce-config-card__actions { display: flex; justify-content: flex-end; margin-top: var(--spacing-2); }
    .sce-warn-panel {
      display: flex; gap: var(--spacing-2); align-items: flex-start;
      margin: var(--spacing-2) 0 0; padding: var(--spacing-2) var(--spacing-3);
      background: var(--color-warning-50, #fffbeb); border: 1px solid var(--color-warning-300, #fcd34d);
      border-radius: var(--radius-md, 0.5rem); font-size: .85rem; color: var(--color-warning-800, #92400e);
    }
    .sce-warn-panel i { color: var(--color-warning-600, #d97706); flex-shrink: 0; margin-top: 2px; }
    .preset-drift-banner {
      background: var(--color-warning-50, #fffbeb); border: 1px solid var(--color-warning-300, #fcd34d);
      border-radius: 8px; padding: var(--spacing-3);
    }
    .preset-drift-banner__title { display: flex; align-items: center; gap: var(--spacing-2); font-weight: 600; color: var(--color-warning-800, #92400e); margin-bottom: var(--spacing-2); }
    .preset-drift-banner__title i { color: var(--color-warning-600, #d97706); }
    .preset-drift-banner__list { margin: 0 0 var(--spacing-2); padding-left: var(--spacing-4); font-size: .85rem; color: var(--color-warning-900, #78350f); }
    .preset-drift-banner__actions { display: flex; justify-content: flex-end; }
  `]
})
export class PayrollSettingsComponent implements OnInit {
  readonly loc_ui_tern_active_42ce0b = $localize`:@@ui.tern.active.42ce0b:Activé`;
  readonly loc_ui_tern_desactive_2d32fa = $localize`:@@ui.tern.desactive.2d32fa:Désactivé`;
  private readonly payroll = inject(PayrollService);
  private readonly toast = inject(ToastService);
  private readonly confirmation = inject(ConfirmationService);
  fiscalYear = new Date().getFullYear();
  params = signal<PayrollParameters | null>(null);
  garnishmentBrackets = signal<GarnishmentBracketFormRow[]>([]);
  /** Drapeaux paie du dossier (dont le réglage d'imputation effectivement appliqué). */
  featureFlags = signal<PayrollFeatureFlags | null>(null);
  /** Réglage d'imputation renvoyé par le serveur (référence pour les bornes et l'état d'origine). */
  accountingSettings = signal<PayrollAccountingSettings | null>(null);
  /** Copie éditable liée au formulaire. */
  accountingForm = signal<PayrollAccountingSettings | null>(null);
  savingAccounting = signal(false);

  readonly accountProfileOptions = [
    { label: 'Legacy (historique)', value: 'Legacy' },
    { label: 'SCE 2026 (comptes NCT 01)', value: 'Sce2026' }
  ];

  /** Date de bascule au format `yyyy-MM` attendu par l'input `type="month"`. */
  effectiveMonth = computed(() => {
    const value = this.accountingForm()?.accountProfileEffectiveDate;
    return value ? value.substring(0, 7) : '';
  });

  /** Borne basse proposée par le serveur : le mois suivant le dernier cycle arrêté. */
  earliestMonth = computed(() => {
    const value = this.accountingSettings()?.earliestEffectiveDate;
    return value ? value.substring(0, 7) : '';
  });
  /** Preset légal officiel de l'exercice (pour la bannière de dérive preset vs tenant). */
  legalPreset = signal<PayrollLegalPreset | null>(null);
  readonly smigExemptionModeOptions = [
    { label: 'Désactivée', value: 'None' },
    { label: 'Déduction annuelle 500 TND (SMIG/SMAG)', value: 'SmigAnnualDeduction' },
    { label: 'Portion SMIG exonérée', value: 'SmigPortion' },
    { label: 'Exonération totale si salaire ≤ SMIG', value: 'FullIfBelow' }
  ];

  /** Écarts entre les paramètres persistés du tenant et le preset légal de l'exercice (plan §4 WS-3). */
  presetDrift = computed<PresetDriftItem[]>(() => {
    const p = this.params();
    const preset = this.legalPreset();
    if (!p || !preset) return [];
    const drift: PresetDriftItem[] = [];
    const rate = (label: string, current: number, expected: number, unit = '%') => {
      if (Math.abs(current - expected) > 0.0001) {
        drift.push({ label, current: `${current.toFixed(2)} ${unit}`, expected: `${expected.toFixed(2)} ${unit}` });
      }
    };
    rate('CNSS salarié', p.cnssEmployeeRate, preset.cnssEmployeeRate);
    rate('CNSS employeur', p.cnssEmployerRate, preset.cnssEmployerRate);
    rate('CSS', p.cssRate, preset.cssRate);
    rate('SMIG mensuel', p.monthlySmig, preset.monthlySmig, 'TND');
    const pb = [...preset.irppBrackets].sort((a, b) => a.lowerBound - b.lowerBound);
    const cb = [...p.irppBrackets].sort((a, b) => a.lowerBound - b.lowerBound);
    const bracketsDiffer = cb.length !== pb.length
      || cb.some((b, i) => Math.abs(b.lowerBound - pb[i].lowerBound) > 0.01 || Math.abs(b.rate - pb[i].rate) > 0.0001);
    if (bracketsDiffer) {
      drift.push({ label: 'Barème IRPP', current: `${cb.length} tranche(s)`, expected: `${pb.length} tranche(s) LF` });
    }
    return drift;
  });

  ngOnInit(): void {
    this.load();
    this.loadFeatureFlags();
  }

  private loadFeatureFlags(): void {
    this.payroll.getFeatureFlags().subscribe({
      next: res => this.featureFlags.set(res.data ?? null),
      error: () => this.featureFlags.set(null)
    });
    this.loadAccountingSettings();
  }

  private loadAccountingSettings(): void {
    this.payroll.getAccountingSettings().subscribe({
      next: res => {
        const data = res.data ?? null;
        this.accountingSettings.set(data);
        this.accountingForm.set(data ? { ...data } : null);
      },
      error: () => {
        this.accountingSettings.set(null);
        this.accountingForm.set(null);
      }
    });
  }

  /**
   * Passer à SCE 2026 sans date de bascule appliquerait le profil à tous les cycles, y compris
   * arrêtés. On prérenseigne donc la première date acceptable calculée par le serveur, ou le mois
   * prochain quand aucun cycle n'est encore arrêté.
   */
  onProfileChange(profile: string): void {
    const form = this.accountingForm();
    if (!form) return;

    if (profile === 'Sce2026' && !form.accountProfileEffectiveDate) {
      const earliest = this.accountingSettings()?.earliestEffectiveDate;
      const fallback = new Date();
      fallback.setDate(1);
      fallback.setMonth(fallback.getMonth() + 1);
      const suggested = earliest ?? `${fallback.getFullYear()}-${String(fallback.getMonth() + 1).padStart(2, '0')}-01`;
      this.accountingForm.set({ ...form, accountProfile: profile, accountProfileEffectiveDate: suggested });
      return;
    }

    this.accountingForm.set({ ...form, accountProfile: profile });
  }

  onEffectiveMonthChange(month: string): void {
    const form = this.accountingForm();
    if (!form) return;
    this.accountingForm.set({
      ...form,
      accountProfileEffectiveDate: month ? `${month}-01` : null
    });
  }

  saveAccountingSettings(): void {
    const form = this.accountingForm();
    if (!form) return;

    const wasLegacy = (this.accountingSettings()?.accountProfile ?? 'Legacy') !== 'Sce2026';
    const becomesSce = form.accountProfile === 'Sce2026';

    // La bascule engage toutes les OD de paie à venir : on la fait confirmer explicitement, en
    // rappelant que les cycles antérieurs à la date d'effet gardent leur imputation.
    if (wasLegacy && becomesSce) {
      const from = form.accountProfileEffectiveDate
        ? new Date(form.accountProfileEffectiveDate).toLocaleDateString('fr-TN')
        : '—';
      this.confirmation.confirm({
        header: 'Basculer en imputation SCE 2026',
        message:
          `À partir du ${from}, les écritures de paie utiliseront les comptes NCT 01 : TFP en 6611, `
          + 'FOPROLOS en 6612, taxes patronales en 437, indemnités de rupture en 64602. Les cycles '
          + 'antérieurs à cette date conservent leur imputation actuelle et ne sont pas réécrits. Continuer ?',
        icon: 'pi pi-exclamation-triangle',
        acceptLabel: $localize`:@@payroll-settings.component.acceptLabel.Basculer:Basculer`,
        rejectLabel: $localize`:@@payroll-settings.component.rejectLabel.Annuler:Annuler`,
        size: 'md',
        accept: () => this.submitAccountingSettings(form)
      });
      return;
    }

    this.submitAccountingSettings(form);
  }

  private submitAccountingSettings(form: PayrollAccountingSettings): void {
    this.savingAccounting.set(true);
    this.payroll.updateAccountingSettings({
      accountProfile: form.accountProfile,
      accountProfileEffectiveDate: form.accountProfileEffectiveDate ?? null,
      inKindOffsetAccount: form.inKindOffsetAccount?.trim() || null,
      disbursementEntriesEnabled: form.disbursementEntriesEnabled,
      detailedSalarySplitEnabled: form.detailedSalarySplitEnabled
    }).subscribe({
      next: res => {
        this.savingAccounting.set(false);
        const data = res.data ?? null;
        this.accountingSettings.set(data);
        this.accountingForm.set(data ? { ...data } : null);
        this.loadFeatureFlags();
        this.toast.add({
          severity: 'success',
          summary: $localize`:@@payroll-settings.component.summary.Comptabilisation:Comptabilisation`,
          detail: $localize`:@@payroll-settings.component.detail.Profildimputationcomp:Profil d'imputation comptable enregistré.`
        });
      },
      error: err => {
        this.savingAccounting.set(false);
        this.toast.add({
          severity: 'error',
          summary: $localize`:@@payroll-settings.component.summary.Comptabilisation:Comptabilisation`,
          detail: err?.error?.message ?? $localize`:@@ui.tern.profil.d.imputation.non.enregistre.3934f4:Profil d'imputation non enregistré.`
        });
      }
    });
  }

  private loadLegalPreset(): void {
    this.payroll.getLegalPreset(this.fiscalYear).subscribe({
      next: res => this.legalPreset.set(res.data ?? null),
      error: () => this.legalPreset.set(null)
    });
  }

  load(): void {
    this.payroll.getParameters(this.fiscalYear).subscribe({
      next: res => {
        const data = res.data;
        if (data) {
          this.params.set({
            ...data,
            enableIrppRegularization: data.enableIrppRegularization ?? false,
            enableAutomaticProrata: data.enableAutomaticProrata ?? false,
            smigIrppExemptionMode: data.smigIrppExemptionMode ?? 'None',
            smigIrppExemptionModeDisplay: data.smigIrppExemptionModeDisplay ?? $localize`:@@ui.tern.desactivee.74cc3b:Désactivée`,
            smigIrppExemptionRateOverride: data.smigIrppExemptionRateOverride ?? null,
            mealVoucherDailyExemptionCap: data.mealVoucherDailyExemptionCap ?? 0,
            irppBrackets: data.irppBrackets.map(b => ({ ...b }))
          });
        } else {
          this.params.set(null);
        }
      },
      error: () => this.toast.add({ severity: 'error', summary: $localize`:@@payroll-settings.component.summary.Paramètres:Paramètres`, detail: $localize`:@@payroll-settings.component.detail.Param_tres_intro:Paramètres introuvables.` })
    });
    this.loadGarnishmentBrackets();
    this.loadLegalPreset();
  }

  private loadGarnishmentBrackets(): void {
    this.payroll.getGarnishmentBrackets(this.fiscalYear).subscribe({
      next: res => {
        const rows = (res.data ?? []).map(b => ({
          lowerBoundMonthlyNet: b.lowerBoundMonthlyNet,
          seizableFractionPercent: b.seizableFraction * 100
        }));
        this.garnishmentBrackets.set(rows);
      },
      error: () => this.garnishmentBrackets.set([])
    });
  }

  addGarnishmentBracket(): void {
    this.garnishmentBrackets.update(rows => [...rows, { lowerBoundMonthlyNet: 0, seizableFractionPercent: 0 }]);
  }

  removeGarnishmentBracket(index: number): void {
    this.garnishmentBrackets.update(rows => rows.filter((_, i) => i !== index));
  }

  saveGarnishmentBrackets(): void {
    const rows = this.garnishmentBrackets();
    const sorted = [...rows].sort((a, b) => a.lowerBoundMonthlyNet - b.lowerBoundMonthlyNet);
    if (sorted.some(b => b.seizableFractionPercent < 0 || b.seizableFractionPercent > 100)) {
      this.toast.add({ severity: 'error', summary: $localize`:@@payroll-settings.component.summary.Barème saisi:Barème saisies`, detail: $localize`:@@payroll-settings.component.detail.Les_fractions_do:Les fractions doivent être entre 0 et 100 %.` });
      return;
    }
    const payload: PayrollGarnishmentBracket[] = sorted.map(b => ({
      lowerBoundMonthlyNet: b.lowerBoundMonthlyNet,
      seizableFraction: b.seizableFractionPercent / 100
    }));
    this.payroll.updateGarnishmentBrackets(this.fiscalYear, payload).subscribe({
      next: () => this.toast.add({ severity: 'success', summary: $localize`:@@payroll-settings.component.summary.Barème saisi:Barème saisies`, detail: $localize`:@@payroll-settings.component.detail.Bar_me_enregistr:Barème enregistré.` }),
      error: err => this.toast.add({
        severity: 'error',
        summary: $localize`:@@payroll-settings.component.summary.Barème saisi:Barème saisies`,
        detail: err?.error?.message ?? $localize`:@@ui.tern.enregistrement.impossible.206044:Enregistrement impossible.`
      })
    });
  }

  addBracket(): void {
    const p = this.params();
    if (!p) return;
    p.irppBrackets.push({ lowerBound: 0, rate: 0 });
    this.params.set({ ...p, irppBrackets: [...p.irppBrackets] });
  }

  removeBracket(index: number): void {
    const p = this.params();
    if (!p) return;
    const brackets = p.irppBrackets.filter((_, i) => i !== index);
    this.params.set({ ...p, irppBrackets: brackets });
  }

  /** Contrôle client du barème IRPP ; renvoie null si valide, sinon le message d'erreur. */
  private validateBrackets(brackets: { lowerBound: number; rate: number }[]): string | null {
    if (!brackets.length) return 'Le barème IRPP doit comporter au moins une tranche.';
    const sorted = [...brackets].sort((a, b) => a.lowerBound - b.lowerBound);
    if (sorted[0].lowerBound !== 0) return 'La première tranche IRPP doit démarrer à 0.';
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].lowerBound === sorted[i - 1].lowerBound)
        return 'Deux tranches IRPP ne peuvent pas avoir le même seuil inférieur.';
    }
    if (sorted.some(b => b.rate < 0 || b.rate > 100)) return 'Les taux IRPP doivent être compris entre 0 et 100 %.';
    return null;
  }

  reloadLegalPreset(): void {
    this.payroll.getLegalPreset(this.fiscalYear).subscribe({
      next: res => {
        const preset = res.data;
        const current = this.params();
        if (!preset || !current) return;
        this.params.set({
          ...current,
          cnssEmployeeRate: preset.cnssEmployeeRate,
          cnssEmployerRate: preset.cnssEmployerRate,
          cssRate: preset.cssRate,
          monthlySmig: preset.monthlySmig,
          irppBrackets: preset.irppBrackets.map(b => ({ ...b }))
        });
        this.toast.add({
          severity: 'info',
          summary: $localize`:@@payroll-settings.component.summary.Preset LF:Preset LF`,
          detail: `${preset.label} chargé — enregistrez pour appliquer.`
        });
      },
      error: () => this.toast.add({ severity: 'error', summary: $localize`:@@payroll-settings.component.summary.Preset LF:Preset LF`, detail: $localize`:@@payroll-settings.component.detail.Chargement_impos:Chargement impossible.` })
    });
  }

  save(): void {
    const p = this.params();
    if (!p) return;
    const bracketError = this.validateBrackets(p.irppBrackets);
    if (bracketError) {
      this.toast.add({ severity: 'error', summary: $localize`:@@payroll-settings.component.summary.Barème IRPP:Barème IRPP`, detail: bracketError });
      return;
    }
    const { id, fiscalYear, ...body } = p;
    this.payroll.updateParameters(this.fiscalYear, body).subscribe({
      next: () => this.toast.add({ severity: 'success', summary: $localize`:@@payroll-settings.component.summary.Paramètres:Paramètres`, detail: $localize`:@@payroll-settings.component.detail.Param_tres_enreg:Paramètres enregistrés.` }),
      error: err => this.toast.add({
        severity: 'error',
        summary: $localize`:@@payroll-settings.component.summary.Paramètres:Paramètres`,
        detail: err?.error?.message ?? $localize`:@@ui.tern.enregistrement.impossible.206044:Enregistrement impossible.`
      })
    });
  }
}

interface GarnishmentBracketFormRow {
  lowerBoundMonthlyNet: number;
  seizableFractionPercent: number;
}

interface PresetDriftItem {
  label: string;
  current: string;
  expected: string;
}
