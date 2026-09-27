/// <reference types="@angular/localize" />
import { Component, ElementRef, HostListener, OnInit, ViewChild, afterNextRender, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { TableModule } from 'primeng/table';
import { TabsModule } from 'primeng/tabs';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { SupplierService, SupplierListItem } from '@core/services/supplier.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import {
  ACCELERATION_COEFFICIENTS,
  DEPRECIATION_METHOD_LABELS,
  DepreciationMethod,
  DepreciationRateCategoryDto,
  DisposeFixedAssetRequest,
  FixedAssetDto,
  FixedAssetScheduleDto,
  FixedAssetsService,
  FIXED_ASSET_STATUS_LABELS,
  LOW_VALUE_ASSET_CEILING_TND,
  UpdateFixedAssetRequest
} from '../services/fixed-assets.service';
import {
  canDisposeStatus,
  isActiveAssetStatus,
  isDraftStatus,
  isInServiceOrBeyond,
  parseDepreciationMethod
} from '../services/fixed-asset-enums';
import {
  FixedAssetSettingsForm,
  defaultFiscalYearSettings,
  normalizeFiscalYearSettings
} from '../services/fixed-asset-settings-defaults';
import { fiscalYearLabel } from '../services/fiscal-year.util';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import { AccountingAmountInputComponent } from '../shared/accounting-amount-input.component';
import { todayLocalYmd } from '../shared/accounting-date-utils';
import { validateAccountTriplet } from './fixed-asset-account-rules';
import { AccountingAmountPipe } from '../shared/accounting-amount.pipe';

interface AssetFormModel {
  label: string;
  depreciationRateCategoryId: string;
  description: string;
  location: string;
  depreciationMethod: DepreciationMethod;
  accelerationCoefficient: number;
  depreciationRatePercent: number | null;
  usefulLifeYears: number | null;
  acquisitionDate: string;
  supplierId: string;
  acquisitionCost: number | null;
  vatAmount: number | null;
  capitalizedFees: number | null;
  residualValue: number | null;
  assetAccountNumber: string;
  depreciationAccountNumber: string;
  expenseAccountNumber: string;
}

/** Mode de règlement d'une cession (T15 / C9), aligné sur T4 :
 *  - `cash`       : règlement comptant → `treasuryAccountNumber` (5321, 5411…).
 *  - `receivable` : cession à terme   → `receivableAccountNumber` (créance, préfixe 452).
 *  - `scrap`      : mise au rebut      → produit forcé à 0, aucun compte de règlement. */
type DisposalMode = 'cash' | 'receivable' | 'scrap';

@Component({
  selector: 'app-fixed-asset-detail',
  standalone: true,
  imports: [AccountingAmountPipe, 
    CommonModule,
    FormsModule,
    RouterModule,
    TableModule,
    TabsModule,
    PageHeaderComponent,
    ButtonComponent,
    AccountingStatusBannerComponent,
    AccountingAmountInputComponent
  ],
  template: `
    <app-page-header
      [title]="pageTitle()"
      [subtitle]="pageSubtitle()" />

    <app-accounting-status-banner [message]="error() ?? ''" variant="error" *ngIf="error()" />
    <div class="refresh-row" *ngIf="error() && asset()">
      <app-button variant="secondary" type="button" icon="pi pi-refresh" (click)="refreshAsset()" [disabled]="saving()" i18n="@@accounting.fixed-assets.actualiser.la.fiche.d0adb1cb"> Actualiser la fiche </app-button>
    </div>
    <app-accounting-status-banner [message]="success() ?? ''" variant="success" *ngIf="success()" />
    <app-accounting-status-banner
      *ngIf="isDraftAsset()"
      message="Immobilisation en brouillon — enregistrez vos modifications puis mettez en service dans la section ci-dessous." i18n-message="@@accounting.fixed-assets.immobilisation.en.brouillon.enregistrez.3f7bc795"
      variant="info" />

    <!-- ============ Fiche immobilisation (création / brouillon / consultation) ============ -->
    <div class="card" *ngIf="isNew() || asset()">
      <p-tabs [lazy]="true">
        <p-tablist>
          <p-tab [value]="0" i18n="@@accounting.fixed-assets.generalites.2e49e62e">Généralités</p-tab>
          <p-tab [value]="1" i18n="@@accounting.fixed-assets.acquisition.e85b4567">Acquisition</p-tab>
        </p-tablist>
        <p-tabpanels>
        <p-tabpanel [value]="0">
          <div class="form-grid">
            <label>
              <ng-container i18n="@@accounting.fixed-assets.designation.26ab8d5c"> Désignation * </ng-container>
              <input class="accounting-filter-input" [(ngModel)]="form.label" [disabled]="readonly()" />
              <span class="field-error" *ngIf="fieldErrors()['label']">{{ fieldErrors()['label'] }}</span>
            </label>
            <label *ngIf="asset()">
              <ng-container i18n="@@accounting.fixed-assets.n.inventaire.160c8b37"> N° inventaire </ng-container>
              <input class="accounting-filter-input" [value]="asset()!.inventoryNumber" disabled />
            </label>
            <label>
              <ng-container i18n="@@accounting.fixed-assets.categorie.taux.legal.tunisien.89d4ee0a"> Catégorie (taux légal tunisien) * </ng-container>
              <select
                class="accounting-filter-input"
                [(ngModel)]="form.depreciationRateCategoryId"
                (ngModelChange)="onCategoryChange($event)"
                [disabled]="readonly()">
                <option value="" i18n="@@accounting.fixed-assets.selectionner.7ae1afc7">— Sélectionner —</option>
                <option *ngFor="let c of categories()" [value]="c.id">
                  {{ c.label }} ({{ c.legalRatePercent | number: '1.2-2' }} %)
                </option>
              </select>
              <span class="field-error" *ngIf="fieldErrors()['category']">{{ fieldErrors()['category'] }}</span>
            </label>
            <label>
              <ng-container i18n="@@accounting.fixed-assets.emplacement.fecbe05d"> Emplacement </ng-container>
              <input class="accounting-filter-input" [(ngModel)]="form.location" [disabled]="readonly()" />
            </label>
            <label class="span-2">
              <ng-container i18n="@@accounting.fixed-assets.description.55f8ebc8"> Description </ng-container>
              <textarea class="accounting-filter-input" rows="2" [(ngModel)]="form.description" [disabled]="readonly()"></textarea>
            </label>
          </div>

          <fieldset class="form-section">
            <legend i18n="@@accounting.fixed-assets.amortissement.403d7802">Amortissement</legend>
            <app-accounting-status-banner
              *ngIf="suggestIntegral()"
              [message]="integralSuggestionMessage"
              variant="info" />
            <div class="form-grid">
              <label>
                <ng-container i18n="@@accounting.fixed-assets.type.d.amortissement.284f07c1"> Type d'amortissement </ng-container>
                <select
                  class="accounting-filter-input"
                  [(ngModel)]="form.depreciationMethod"
                  (ngModelChange)="onMethodChange($event)"
                  [disabled]="readonly() || isNonDepreciable()">
                  <option [ngValue]="DepreciationMethod.Linear" i18n="@@accounting.fixed-assets.lineaire.a5db4cfe">Linéaire</option>
                  <option [ngValue]="DepreciationMethod.Accelerated" i18n="@@accounting.fixed-assets.accelere.064a76be">Accéléré</option>
                  <option [ngValue]="DepreciationMethod.Integral" i18n="@@accounting.fixed-assets.integral.02387577">Intégral</option>
                </select>
              </label>
              <label *ngIf="form.depreciationMethod === DepreciationMethod.Accelerated">
                <ng-container i18n="@@accounting.fixed-assets.coefficient.materiel.industriel.multi.equipes.185e972f"> Coefficient (matériel industriel multi-équipes) * </ng-container>
                <select class="accounting-filter-input" [(ngModel)]="form.accelerationCoefficient" [disabled]="readonly()">
                  <option *ngFor="let c of ACCELERATION_COEFFICIENTS" [ngValue]="c">
                    {{ c === 1.5 ? loc_ui_tern_1_5_deux_equipes_taux_1_5_39373e : loc_ui_tern_2_trois_equipes_taux_2_65be4b }}
                  </option>
                </select>
                <span class="field-error" *ngIf="fieldErrors()['coefficient']">{{ fieldErrors()['coefficient'] }}</span>
                <span class="hint" i18n="@@accounting.fixed-assets.decret.2008.492.art.2.reserve.au.materiel.indust.cbda97ba">Décret 2008-492 art. 2 — réservé au matériel industriel des industries manufacturières non saisonnières.</span>
              </label>
              <label>
                <ng-container i18n="@@accounting.fixed-assets.duree.d.utilisation.annees.b376ba58"> Durée d'utilisation (années) </ng-container>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  class="accounting-filter-input"
                  [(ngModel)]="form.usefulLifeYears"
                  (ngModelChange)="onLifeChange($event)"
                  [disabled]="readonly() || isNonDepreciable()" />
              </label>
              <label>
                <ng-container i18n="@@accounting.fixed-assets.taux.d.amortissement.b4989373"> Taux d'amortissement (%) </ng-container>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  class="accounting-filter-input"
                  [(ngModel)]="form.depreciationRatePercent"
                  (ngModelChange)="onRateChange($event)"
                  [disabled]="readonly() || isNonDepreciable()" />
                <span class="field-error" *ngIf="fieldErrors()['rate']">{{ fieldErrors()['rate'] }}</span>
              </label>
            </div>
            <p class="hint" *ngIf="isNonDepreciable()" i18n="@@accounting.fixed-assets.cette.categorie.n.est.pas.amortissable.ex.terrai.5eb9efc9">Cette catégorie n'est pas amortissable (ex. terrains).</p>
            <p class="hint" *ngIf="!isNonDepreciable()" i18n="@@accounting.fixed-assets.le.taux.et.la.duree.sont.synchronises.taux.100.d.18bbd38f"> Le taux et la durée sont synchronisés (taux = 100 / durée). Le taux légal de la catégorie est proposé par défaut. </p>
          </fieldset>

          <fieldset class="form-section">
            <legend i18n="@@accounting.fixed-assets.comptabilisation.87cf8493">Comptabilisation</legend>
            <div class="form-grid">
              <label>
                <ng-container i18n="@@accounting.fixed-assets.compte.d.immobilisation.21x.4a9f36f0"> Compte d'immobilisation (21x) * </ng-container>
                <input class="accounting-filter-input" [(ngModel)]="form.assetAccountNumber" [disabled]="readonly()" />
                <span class="field-error" *ngIf="fieldErrors()['assetAccount']">{{ fieldErrors()['assetAccount'] }}</span>
              </label>
              <label>
                <ng-container i18n="@@accounting.fixed-assets.compte.d.amortissement.28x.a51a075a"> Compte d'amortissement (28x) * </ng-container>
                <input class="accounting-filter-input" [(ngModel)]="form.depreciationAccountNumber" [disabled]="readonly()" />
                <span class="field-error" *ngIf="fieldErrors()['depreciationAccount']">{{ fieldErrors()['depreciationAccount'] }}</span>
              </label>
              <label>
                <ng-container i18n="@@accounting.fixed-assets.compte.de.dotation.68x.def515bc"> Compte de dotation (68x) * </ng-container>
                <input class="accounting-filter-input" [(ngModel)]="form.expenseAccountNumber" [disabled]="readonly()" />
                <span class="field-error" *ngIf="fieldErrors()['expenseAccount']">{{ fieldErrors()['expenseAccount'] }}</span>
              </label>
            </div>
          </fieldset>
        </p-tabpanel>

        <p-tabpanel [value]="1">
          <div class="form-grid">
            <label>
              <ng-container i18n="@@accounting.fixed-assets.date.d.acquisition.2f4e592d"> Date d'acquisition * </ng-container>
              <input type="date" class="accounting-filter-input" [(ngModel)]="form.acquisitionDate" [disabled]="readonly()" />
              <span class="field-error" *ngIf="fieldErrors()['acquisitionDate']">{{ fieldErrors()['acquisitionDate'] }}</span>
            </label>
            <label>
              <ng-container i18n="@@accounting.fixed-assets.fournisseur.97d91d89"> Fournisseur </ng-container>
              <select class="accounting-filter-input" [(ngModel)]="form.supplierId" [disabled]="readonly()">
                <option value="" i18n="@@accounting.fixed-assets.aucun.67323ce2">— Aucun —</option>
                <option *ngFor="let s of suppliers()" [value]="s.id">{{ s.name }}</option>
              </select>
            </label>
            <label>
              <ng-container i18n="@@accounting.fixed-assets.prix.d.achat.ht.7c620c71"> Prix d'achat HT * </ng-container>
              <app-accounting-amount-input
                [(ngModel)]="form.acquisitionCost"
                [disabled]="readonly()"
                side="debit"
                inputId="acquisitionCost"
                ariaLabel="Prix d'achat HT" i18n-ariaLabel="@@accounting.fixed-assets.prix.d.achat.ht.5cc09c1b" />
              <span class="field-error" *ngIf="fieldErrors()['cost']">{{ fieldErrors()['cost'] }}</span>
            </label>
            <label>
              <ng-container i18n="@@accounting.fixed-assets.montant.tva.f0c1b7cc"> Montant TVA </ng-container>
              <app-accounting-amount-input
                [(ngModel)]="form.vatAmount"
                [disabled]="readonly()"
                side="debit"
                inputId="vatAmount"
                ariaLabel="Montant TVA" i18n-ariaLabel="@@accounting.fixed-assets.montant.tva.d1afc4f8" />
            </label>
            <label>
              <ng-container i18n="@@accounting.fixed-assets.frais.capitalises.a20d3797"> Frais capitalisés </ng-container>
              <app-accounting-amount-input
                [(ngModel)]="form.capitalizedFees"
                [disabled]="readonly()"
                side="debit"
                inputId="capitalizedFees"
                ariaLabel="Frais capitalisés" i18n-ariaLabel="@@accounting.fixed-assets.frais.capitalises.6f02250a" />
            </label>
            <label>
              <ng-container i18n="@@accounting.fixed-assets.valeur.residuelle.98da787c"> Valeur résiduelle </ng-container>
              <app-accounting-amount-input
                [(ngModel)]="form.residualValue"
                [disabled]="readonly()"
                side="debit"
                inputId="residualValue"
                ariaLabel="Valeur résiduelle" i18n-ariaLabel="@@accounting.fixed-assets.valeur.residuelle.ca8b8ac3" />
              <span class="field-error" *ngIf="fieldErrors()['residual']">{{ fieldErrors()['residual'] }}</span>
            </label>
            <label>
              <ng-container i18n="@@accounting.fixed-assets.montant.amortissable.c6d09753"> Montant amortissable </ng-container>
              <input class="accounting-filter-input" [value]="depreciableBase() | number: '1.3-3'" disabled />
            </label>
          </div>
        </p-tabpanel>
        </p-tabpanels>
      </p-tabs>

      <div class="actions" *ngIf="!readonly()">
        <app-button variant="primary" type="button" (click)="save()" [disabled]="saving()">
          {{ isNew() ? loc_ui_tern_enregistrer_f7c8bc : loc_ui_tern_enregistrer_les_modifications_2a9459 }}
        </app-button>
        <app-button variant="secondary" type="button" routerLink="/accounting/fixed-assets">
          {{ isNew() ? loc_ui_tern_annuler_49ba32 : loc_ui_tern_retour_au_registre_aa646c }}
        </app-button>
      </div>
    </div>

    <!-- ============ Simulation du tableau (brouillon) ============ -->
    <div class="card" *ngIf="isDraftAsset() && !isNonDepreciable()">
      <div class="schedule-header">
        <h3 i18n="@@accounting.fixed-assets.simulation.du.tableau.d.amortissement.d8d3d134">Simulation du tableau d'amortissement</h3>
        <div class="actions-inline">
          <label class="inline-field">
            <ng-container i18n="@@accounting.fixed-assets.date.de.mise.en.service.hypothetique.fc89622a"> Date de mise en service hypothétique </ng-container>
            <input type="date" class="accounting-filter-input" [(ngModel)]="previewDate" />
          </label>
          <app-button variant="secondary" type="button" (click)="previewSchedule()" [disabled]="saving()" i18n="@@accounting.fixed-assets.simuler.le.tableau.6cff95d9"> Simuler le tableau </app-button>
        </div>
      </div>
      <ng-container *ngIf="preview() as p">
        <ng-container *ngTemplateOutlet="normTable; context: { $implicit: p, simulated: true }"></ng-container>
      </ng-container>
    </div>

    <!-- ============ Mise en service ============ -->
    <div class="card" #putInServiceSection id="put-in-service" *ngIf="isDraftAsset()">
      <h3 i18n="@@accounting.fixed-assets.mise.en.service.9d7a72cb">Mise en service</h3>
      <p class="hint" *ngIf="!hasPositiveAcquisitionCost()" i18n="@@accounting.fixed-assets.renseignez.un.prix.d.achat.ht.positif.onglet.acq.80ad42b1"> Renseignez un prix d'achat HT positif (onglet Acquisition) avant la mise en service et la comptabilisation JIM. </p>
      <p class="hint" *ngIf="isFromSupplierInvoice()" i18n="@@accounting.fixed-assets.cet.actif.provient.d.une.facture.fournisseur.dej.20cd16a1"> Cet actif provient d'une facture fournisseur déjà comptabilisée (journal des achats) :
        aucune écriture d'acquisition supplémentaire ne sera générée. </p>
      <div class="form-grid">
        <label>
          <ng-container i18n="@@accounting.fixed-assets.date.de.mise.en.service.4f4fe8a6"> Date de mise en service * </ng-container>
          <input type="date" class="accounting-filter-input" [(ngModel)]="inServiceDate" />
        </label>
        <label *ngIf="!isFromSupplierInvoice()">
          <ng-container i18n="@@accounting.fixed-assets.compte.de.credit.404.532.101.72e064b6"> Compte de crédit (404, 532, 101…) * </ng-container>
          <input class="accounting-filter-input" [(ngModel)]="creditAccount" placeholder="404" i18n-placeholder="@@accounting.fixed-assets.404.c35a9fc5" />
        </label>
      </div>
      <app-button variant="primary" type="button" (click)="putInService()" [disabled]="saving()">
        {{ isFromSupplierInvoice() ? loc_ui_tern_mettre_en_service_79c6d1 : loc_ui_tern_mettre_en_service_et_comptabiliser_920942 }}
      </app-button>
    </div>

    <!-- ============ Tableau d'amortissement (actif en service) ============ -->
    <div class="card" *ngIf="isInServiceAsset()">
      <div class="schedule-header">
        <h3 i18n="@@accounting.fixed-assets.tableau.d.amortissement.2a7cef27">Tableau d'amortissement</h3>
        <div class="actions-inline" *ngIf="canShowScheduleActions()">
          <app-button variant="secondary" type="button" (click)="generateSchedule()" [disabled]="saving() || hasPostedLines()">
            {{ schedule()?.lines?.length ? locRegenererTableau : locGenererTableau }}
          </app-button>
          <app-button
            variant="outline"
            type="button"
            icon="pi-download"
            (click)="exportSchedule()"
            [disabled]="saving() || !schedule()?.lines?.length" i18n="@@accounting.fixed-assets.export.excel.4a245944"> Export Excel </app-button>
        </div>
      </div>
      <p class="hint" *ngIf="hasPostedLines()" i18n="@@accounting.fixed-assets.des.dotations.non.extournees.sont.deja.comptabil.02b3196b"> Des dotations non extournées sont déjà comptabilisées : le tableau ne peut plus être regénéré.
        Extournez l'écriture concernée pour autoriser la régénération. </p>

      <ng-container *ngIf="schedule() as s">
        <ng-container *ngTemplateOutlet="normTable; context: { $implicit: s, simulated: false }"></ng-container>

        <h4 class="detail-title" *ngIf="s.lines.length" i18n="@@accounting.fixed-assets.detail.cp17.b3001501">Détail CP17</h4>
        <p-table *ngIf="s.lines.length" [value]="s.lines" styleClass="p-datatable-sm">
          <ng-template pTemplate="header">
            <tr>
              <th i18n="@@accounting.fixed-assets.exercice.e171e2b0">Exercice</th>
              <th class="text-right" i18n="@@accounting.fixed-assets.vnc.debut.d0ad0de9">VNC début</th>
              <th class="text-right" i18n="@@accounting.fixed-assets.annuite.normale.0c0af391">Annuité normale</th>
              <th class="text-right" i18n="@@accounting.fixed-assets.amort.anterieurs.9487b2d6">Amort. antérieurs</th>
              <th class="text-right" i18n="@@accounting.fixed-assets.dotation.exercice.614cb9fd">Dotation exercice</th>
              <th class="text-right" i18n="@@accounting.fixed-assets.cumul.ff6c23db">Cumul</th>
              <th class="text-right" i18n="@@accounting.fixed-assets.vnc.fin.20096b25">VNC fin</th>
              <th i18n="@@accounting.fixed-assets.comptabilise.ec941159">Comptabilisé</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-line>
            <tr>
              <td>{{ fiscalYearLineLabel(line.fiscalYear) }}</td>
              <td class="text-right">{{ line.openingNbv | number: '1.3-3' }}</td>
              <td class="text-right">{{ line.normalAnnualAmount | number: '1.3-3' }}</td>
              <td class="text-right">{{ line.priorAccumulatedDepreciation | number: '1.3-3' }}</td>
              <td class="text-right">{{ line.depreciationAmount | number: '1.3-3' }}</td>
              <td class="text-right">{{ line.accumulatedDepreciation | number: '1.3-3' }}</td>
              <td class="text-right">{{ line.closingNbv | number: '1.3-3' }}</td>
              <td>{{ line.isPosted ? loc_ui_tern_oui_eaa02f : loc_ui_tern_non_a72199 }}</td>
            </tr>
          </ng-template>
        </p-table>
      </ng-container>
    </div>

    <!-- ============ Tableau au format norme tunisienne (template partagé) ============ -->
    <ng-template #normTable let-s let-simulated="simulated">
      <div class="norm-summary" *ngIf="s.lines.length">
        <div><strong i18n="@@accounting.fixed-assets.nature.du.bien.3cc65233">Nature du bien :</strong> {{ s.label }}</div>
        <div><strong i18n="@@accounting.fixed-assets.montant.amortissable.44db17e0">Montant amortissable :</strong> {{ s.depreciableBase | accountingAmount }}</div>
        <div><strong i18n="@@accounting.fixed-assets.date.de.mise.en.service.ec568998">Date de mise en service :</strong> {{ s.inServiceDate ? (s.inServiceDate | date: 'dd/MM/yyyy') : '—' }}</div>
        <div i18n="@@accounting.fixed-assets.duree.de.vie.ans.5116d2de"><strong>Durée de vie :</strong> {{ s.usefulLifeYears | number: '1.0-2' }} ans</div>
        <div><strong i18n="@@accounting.fixed-assets.taux.d.amortissement.9e76b4fd">Taux d'amortissement :</strong> {{ s.depreciationRatePercent | number: '1.2-2' }} %</div>
        <div i18n="@@accounting.fixed-assets.methode.coefficient.70f02144">
          <strong>Méthode :</strong> {{ methodLabel(s.depreciationMethod) }}
          <ng-container *ngIf="s.depreciationMethod === DepreciationMethod.Accelerated"> (coefficient {{ s.accelerationCoefficient | number: '1.1-2' }})</ng-container>
        </div>
      </div>
      <table class="norm-table" *ngIf="s.lines.length">
        <thead>
          <tr>
            <th i18n="@@accounting.fixed-assets.annee.1f910d98">Année</th>
            <th class="text-right" i18n="@@accounting.fixed-assets.base.077fe9c5">Base</th>
            <th class="text-right" i18n="@@accounting.fixed-assets.annuite.a3535b86">Annuité</th>
            <th class="text-right" i18n="@@accounting.fixed-assets.annuites.cumulees.dd1a2fe5">Annuités cumulées</th>
            <th class="text-right" i18n="@@accounting.fixed-assets.valeur.nette.comptable.f4d6eaf4">Valeur nette comptable</th>
          </tr>
        </thead>
        <tbody>
          <tr *ngFor="let line of s.lines">
            <td>{{ fiscalYearLineLabel(line.fiscalYear) }}</td>
            <td class="text-right">{{ s.depreciableBase | number: '1.3-3' }}</td>
            <td class="text-right">{{ line.depreciationAmount | number: '1.3-3' }}</td>
            <td class="text-right">{{ line.accumulatedDepreciation | number: '1.3-3' }}</td>
            <td class="text-right">{{ line.closingNbv | number: '1.3-3' }}</td>
          </tr>
          <tr class="total-row">
            <td><strong i18n="@@accounting.fixed-assets.total.5c6505ae">TOTAL</strong></td>
            <td></td>
            <td class="text-right"><strong>{{ totalDepreciation(s) | number: '1.3-3' }}</strong></td>
            <td></td>
            <td></td>
          </tr>
        </tbody>
      </table>
      <p class="hint" *ngIf="!s.lines.length" i18n="@@accounting.fixed-assets.aucune.ligne.d.amortissement.bien.non.amortissab.170eff32">Aucune ligne d'amortissement (bien non amortissable ou base nulle).</p>
    </ng-template>

    <!-- ============ Cession ============ -->
    <div class="card" *ngIf="canDisposeAsset()">
      <h3 i18n="@@accounting.fixed-assets.cession.mise.au.rebut.cabc2596">Cession / mise au rebut</h3>
      <div class="form-grid">
        <label>
          <ng-container i18n="@@accounting.fixed-assets.date.de.cession.6a6f45a3"> Date de cession * </ng-container>
          <input type="date" class="accounting-filter-input" [(ngModel)]="disposalDate" />
        </label>
        <label>
          <ng-container i18n="@@accounting.fixed-assets.prix.de.cession.tnd.47897c3e"> Prix de cession (TND) </ng-container>
          <app-accounting-amount-input
            [(ngModel)]="disposalProceeds"
            [disabled]="disposalMode === 'scrap'"
            side="debit"
            inputId="disposalProceeds"
            ariaLabel="Prix de cession" i18n-ariaLabel="@@accounting.fixed-assets.prix.de.cession.c1619878" />
        </label>
      </div>

      <fieldset class="form-section">
        <legend i18n="@@accounting.fixed-assets.mode.de.reglement.c82ec4a6">Mode de règlement</legend>
        <div class="disposal-mode-grid">
          <label class="radio-option">
            <input type="radio" name="disposalMode" value="cash" [ngModel]="disposalMode" (ngModelChange)="onDisposalModeChange($event)" /><ng-container i18n="@@accounting.fixed-assets.comptant.compte.de.tresorerie.5321.5411.ebcb7c50">
            Comptant — compte de trésorerie (5321, 5411…)
          </ng-container></label>
          <label *ngIf="disposalMode === 'cash'">
            <ng-container i18n="@@accounting.fixed-assets.compte.tresorerie.d0134786"> Compte trésorerie * </ng-container>
            <input class="accounting-filter-input" [(ngModel)]="treasuryAccount" placeholder="5321" i18n-placeholder="@@accounting.fixed-assets.5321.c17ece1e" />
          </label>
          <label class="radio-option">
            <input type="radio" name="disposalMode" value="receivable" [ngModel]="disposalMode" (ngModelChange)="onDisposalModeChange($event)" /><ng-container i18n="@@accounting.fixed-assets.a.terme.creance.sur.cession.prerempli.45.3db03bad">
            À terme — créance sur cession (prérempli 452)
          </ng-container></label>
          <label *ngIf="disposalMode === 'receivable'">
            <ng-container i18n="@@accounting.fixed-assets.compte.creance.f64b8a52"> Compte créance * </ng-container>
            <input class="accounting-filter-input" [(ngModel)]="receivableAccount" placeholder="452" i18n-placeholder="@@accounting.fixed-assets.452.3af0af21" />
          </label>
          <label class="radio-option">
            <input type="radio" name="disposalMode" value="scrap" [ngModel]="disposalMode" (ngModelChange)="onDisposalModeChange($event)" /><ng-container i18n="@@accounting.fixed-assets.mise.au.rebut.produit.nul.aucun.compte.d.cecce5c9">
            Mise au rebut — produit nul, aucun compte de règlement
          </ng-container></label>
        </div>
        <p class="hint" *ngIf="disposalMode === 'scrap'" i18n="@@accounting.fixed-assets.la.mise.au.rebut.force.un.prix.de.cession.nul.au.3560e640"> La mise au rebut force un prix de cession nul : aucune écriture de règlement n'est générée (sortie 2xx / 28x / 636 uniquement). </p>
      </fieldset>

      <app-button variant="danger" type="button" (click)="confirmDispose()" [disabled]="saving()" i18n="@@accounting.fixed-assets.enregistrer.la.cession.9bdc21df">Enregistrer la cession</app-button>
    </div>

    <!-- ============ Méta ============ -->
    <div class="card meta" *ngIf="asset()">
      <p><strong i18n="@@accounting.fixed-assets.statut.b20e7fc2">Statut :</strong> {{ statusLabel(asset()!) }}</p>
      <p i18n="@@accounting.fixed-assets.methode.coefficient.afbaed33"><strong>Méthode :</strong> {{ methodLabel(asset()!.depreciationMethod) }}
        <ng-container *ngIf="asset()!.depreciationMethod === DepreciationMethod.Accelerated"> (coefficient {{ asset()!.accelerationCoefficient | number: '1.1-2' }})</ng-container>
      </p>
      <p><strong i18n="@@accounting.fixed-assets.comptes.d35dab21">Comptes :</strong> {{ asset()!.assetAccountNumber }} / {{ asset()!.depreciationAccountNumber }} / {{ asset()!.expenseAccountNumber }}</p>
      <p><strong i18n="@@accounting.fixed-assets.vnc.actuelle.b1f08efc">VNC actuelle :</strong> {{ asset()!.netBookValue | accountingAmount }}</p>
      <p *ngIf="asset()!.supplierInvoiceId">
        <strong i18n="@@accounting.fixed-assets.facture.fournisseur.acffd398">Facture fournisseur :</strong>
        <a [routerLink]="['/supplier-invoices', asset()!.supplierInvoiceId]" i18n="@@accounting.fixed-assets.voir.la.facture.source.03c66c7b">Voir la facture source</a>
      </p>
    </div>
  `,
  styles: [
    `
      .form-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 1rem;
        margin-bottom: 1rem;
      }
      .span-2 {
        grid-column: 1 / -1;
      }
      label {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        font-size: 0.85rem;
        font-weight: 500;
      }
      .inline-field {
        flex-direction: row;
        align-items: center;
        gap: 0.5rem;
        white-space: nowrap;
      }
      .disposal-mode-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 0.75rem 1rem;
        align-items: start;
      }
      .radio-option {
        flex-direction: row;
        align-items: center;
        gap: 0.5rem;
        font-weight: 400;
      }
      .form-section {
        border: 1px solid #dbeafe;
        border-radius: 8px;
        padding: 0.75rem 1rem 1rem;
        margin-bottom: 1rem;
      }
      .form-section legend {
        font-size: 0.85rem;
        font-weight: 600;
        color: #1d4ed8;
        padding: 0 0.4rem;
      }
      .field-error {
        color: #dc2626;
        font-size: 0.78rem;
        font-weight: 400;
      }
      .hint {
        font-size: 0.8rem;
        color: #64748b;
        margin: 0.25rem 0 0.75rem;
      }
      .actions,
      .actions-inline {
        display: flex;
        gap: 0.75rem;
        flex-wrap: wrap;
        align-items: center;
      }
      .schedule-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1rem;
        flex-wrap: wrap;
        gap: 0.75rem;
      }
      .text-right {
        text-align: right;
      }
      .meta p {
        margin: 0.25rem 0;
      }
      .norm-summary {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 0.35rem 1.5rem;
        font-size: 0.85rem;
        margin-bottom: 0.85rem;
        padding: 0.65rem 0.85rem;
        background: #f8fafc;
        border-radius: 8px;
      }
      .norm-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.875rem;
        margin-bottom: 1rem;
      }
      .norm-table th,
      .norm-table td {
        border: 1px solid #cbd5e1;
        padding: 0.4rem 0.65rem;
      }
      .norm-table thead th {
        background: #e0f2fe;
        font-weight: 600;
      }
      .norm-table .total-row td {
        background: #f1f5f9;
      }
      .detail-title {
        margin: 1rem 0 0.5rem;
        font-size: 0.95rem;
      }
      .refresh-row {
        margin: 0 0 0.75rem;
      }
    `
  ]
})
export class FixedAssetDetailComponent implements OnInit {
  readonly loc_ui_tern_1_5_deux_equipes_taux_1_5_39373e = $localize`:@@ui.tern.1.5.deux.equipes.taux.1.5.39373e:1,5 — deux équipes (taux × 1,5)`;
  readonly loc_ui_tern_2_trois_equipes_taux_2_65be4b = $localize`:@@ui.tern.2.trois.equipes.taux.2.65be4b:2 — trois équipes (taux × 2)`;
  readonly loc_ui_tern_enregistrer_f7c8bc = $localize`:@@ui.tern.enregistrer.f7c8bc:Enregistrer`;
  readonly loc_ui_tern_enregistrer_les_modifications_2a9459 = $localize`:@@ui.tern.enregistrer.les.modifications.2a9459:Enregistrer les modifications`;
  readonly loc_ui_tern_annuler_49ba32 = $localize`:@@ui.tern.annuler.49ba32:Annuler`;
  readonly loc_ui_tern_retour_au_registre_aa646c = $localize`:@@ui.tern.retour.au.registre.aa646c:Retour au registre`;
  readonly loc_ui_tern_mettre_en_service_79c6d1 = $localize`:@@ui.tern.mettre.en.service.79c6d1:Mettre en service`;
  readonly loc_ui_tern_mettre_en_service_et_comptabiliser_920942 = $localize`:@@ui.tern.mettre.en.service.et.comptabiliser.920942:Mettre en service et comptabiliser`;
  readonly locRegenererTableau = $localize`:@@accounting.fixed-assets.regenerer.le.tableau:Regénérer le tableau`;
  readonly locGenererTableau = $localize`:@@accounting.fixed-assets.generer.le.tableau:Générer le tableau`;
  readonly loc_ui_tern_oui_eaa02f = $localize`:@@ui.tern.oui.eaa02f:Oui`;
  readonly loc_ui_tern_non_a72199 = $localize`:@@ui.tern.non.a72199:Non`;
  private readonly api = inject(FixedAssetsService);
  private readonly supplierApi = inject(SupplierService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly confirmation = inject(ConfirmationService);

  @ViewChild('putInServiceSection') putInServiceSection?: ElementRef<HTMLElement>;

  readonly DepreciationMethod = DepreciationMethod;
  readonly ACCELERATION_COEFFICIENTS = ACCELERATION_COEFFICIENTS;
  readonly LOW_VALUE_ASSET_CEILING_TND = LOW_VALUE_ASSET_CEILING_TND;
  readonly integralSuggestionMessage =
    $localize`:@@accounting.fixed-asset-detail.ts.base.amortissable.low.value.asset.ceilin.bd5644b4:Base amortissable ≤ ${LOW_VALUE_ASSET_CEILING_TND}:LOW_VALUE_ASSET_CEILING_TND: DT : l'amortissement intégral est recommandé (Décret 2008-492 art. 4).`;

  readonly isNew = signal(false);
  readonly asset = signal<FixedAssetDto | null>(null);
  readonly schedule = signal<FixedAssetScheduleDto | null>(null);
  readonly preview = signal<FixedAssetScheduleDto | null>(null);
  readonly categories = signal<DepreciationRateCategoryDto[]>([]);
  readonly suppliers = signal<SupplierListItem[]>([]);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly success = signal<string | null>(null);
  readonly fieldErrors = signal<Record<string, string>>({});

  /** Paramètres d'exercice du dossier (repli civil tant que non chargés) — plan « Exercices décalés ». */
  readonly settings = signal<FixedAssetSettingsForm>(defaultFiscalYearSettings());

  /** Lecture seule dès que l'actif est en service, totalement amorti ou cédé. */
  readonly readonly = computed(() => {
    const a = this.asset();
    return !this.isNew() && (!a || isInServiceOrBeyond(a.status));
  });

  form: AssetFormModel = this.emptyForm();

  inServiceDate = todayLocalYmd();
  creditAccount = '404';
  previewDate = todayLocalYmd();
  disposalDate = todayLocalYmd();
  disposalProceeds: number | null = 0;
  treasuryAccount = '5321';
  receivableAccount = '452';
  disposalMode: DisposalMode = 'cash';

  ngOnInit(): void {
    this.api.getRateCategories().subscribe(res => this.categories.set(res.data ?? []));
    this.loadFiscalYearSettings();

    const id = this.route.snapshot.paramMap.get('id');
    if (this.route.snapshot.data['mode'] === 'new' || id === 'new' || !id) {
      this.isNew.set(true);
      this.loadSuppliers();
      this.markFormPristine();
      return;
    }
    this.loadAsset(id);
    if (this.route.snapshot.queryParamMap.get('created') === '1') {
      this.success.set($localize`:@@accounting.fixed-asset-detail.ts.brouillon.cree.completez.la.fiche.puis.p.3afca311:Brouillon créé — complétez la fiche puis procédez à la mise en service.`);
      afterNextRender(() => this.scrollToPutInService());
    }
  }

  isDraftAsset(): boolean {
    const a = this.asset();
    return !!a && isDraftStatus(a.status);
  }

  isInServiceAsset(): boolean {
    const a = this.asset();
    return !!a && isInServiceOrBeyond(a.status);
  }

  canShowScheduleActions(): boolean {
    const a = this.asset();
    return !!a && isActiveAssetStatus(a.status);
  }

  canDisposeAsset(): boolean {
    const a = this.asset();
    return !!a && canDisposeStatus(a.status);
  }

  hasPositiveAcquisitionCost(): boolean {
    return (this.form.acquisitionCost || 0) + (this.form.capitalizedFees || 0) > 0;
  }

  /** Libellé d'exercice d'une ligne d'échéancier (« N/N+1 » si décalé, sinon « N ») — calculé côté
   *  client depuis le paramétrage tenant (le DTO ligne n'expose pas de libellé). */
  fiscalYearLineLabel(fiscalYear: number): string {
    const { fiscalYearStartMonth, fiscalYearLabelFormat } = this.settings();
    return fiscalYearLabel(fiscalYear, fiscalYearStartMonth, fiscalYearLabelFormat);
  }

  private loadFiscalYearSettings(): void {
    this.api.getSettings().subscribe({
      next: res => this.settings.set(normalizeFiscalYearSettings(res.data)),
      error: () => this.settings.set(defaultFiscalYearSettings())
    });
  }

  private scrollToPutInService(): void {
    setTimeout(() => {
      this.putInServiceSection?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);
  }

  // ----------------------------------------------------------------
  // Formulaire
  // ----------------------------------------------------------------

  private emptyForm(): AssetFormModel {
    return {
      label: '',
      depreciationRateCategoryId: '',
      description: '',
      location: '',
      depreciationMethod: DepreciationMethod.Linear,
      accelerationCoefficient: 1.5,
      depreciationRatePercent: null,
      usefulLifeYears: null,
      acquisitionDate: todayLocalYmd(),
      supplierId: '',
      acquisitionCost: 0,
      vatAmount: 0,
      capitalizedFees: 0,
      residualValue: 0,
      assetAccountNumber: '',
      depreciationAccountNumber: '',
      expenseAccountNumber: ''
    };
  }

  private fillFormFromAsset(a: FixedAssetDto): void {
    this.form = {
      label: a.label,
      depreciationRateCategoryId: a.depreciationRateCategoryId,
      description: a.description ?? '',
      location: a.location ?? '',
      depreciationMethod: parseDepreciationMethod(a.depreciationMethod),
      accelerationCoefficient: a.accelerationCoefficient === 2 ? 2 : 1.5,
      depreciationRatePercent: a.depreciationRatePercent || null,
      usefulLifeYears: a.usefulLifeYears || null,
      acquisitionDate: (a.acquisitionDate ?? '').substring(0, 10),
      supplierId: a.supplierId ?? '',
      acquisitionCost: a.acquisitionCost,
      vatAmount: a.vatAmount,
      capitalizedFees: a.capitalizedFees,
      residualValue: a.residualValue,
      assetAccountNumber: a.assetAccountNumber,
      depreciationAccountNumber: a.depreciationAccountNumber,
      expenseAccountNumber: a.expenseAccountNumber
    };
  }

  suggestIntegral(): boolean {
    return !this.isNonDepreciable() && this.depreciableBase() > 0 && this.depreciableBase() <= LOW_VALUE_ASSET_CEILING_TND;
  }

  onMethodChange(method: DepreciationMethod): void {
    if (method === DepreciationMethod.Accelerated && !ACCELERATION_COEFFICIENTS.includes(this.form.accelerationCoefficient)) {
      this.form.accelerationCoefficient = 1.5;
    }
  }

  isNonDepreciable(): boolean {
    const cat = this.categories().find(c => c.id === this.form.depreciationRateCategoryId);
    return cat?.isNonDepreciable ?? false;
  }

  isFromSupplierInvoice(): boolean {
    return !!this.asset()?.supplierInvoiceId;
  }

  hasPostedLines(): boolean {
    // T13 (C6) — une ligne extournée (isReversed) ne bloque plus la régénération même si son
    // écriture d'origine reste rattachée (isPosted true, dé-postage différé côté serveur). On ne
    // bloque que sur les dotations encore actives (comptabilisées ET non extournées).
    return this.schedule()?.lines?.some(l => l.isPosted && !l.isReversed) ?? false;
  }

  // ----------------------------------------------------------------
  // Garde de navigation (T15 / C9) — formulaire « dirty »
  // ----------------------------------------------------------------
  // `beforeunload` ne couvre que la fermeture/rechargement de l'onglet ; la navigation interne
  // Angular (routerLink, retour au registre) est gérée par le guard CanDeactivate
  // (`pendingChangesGuard`) qui appelle `canDeactivate()`. Les deux se branchent sur `isDirty()`.
  private pristineSnapshot = '';

  /** État sérialisé de tous les champs éditables (fiche + mise en service + cession). La simulation
   *  (`previewDate`) est exclue : ce n'est qu'un paramètre de prévisualisation, pas une saisie. */
  private serializeEditableState(): string {
    return JSON.stringify({
      form: this.form,
      inServiceDate: this.inServiceDate,
      creditAccount: this.creditAccount,
      disposalDate: this.disposalDate,
      disposalProceeds: this.disposalProceeds,
      disposalMode: this.disposalMode,
      treasuryAccount: this.treasuryAccount,
      receivableAccount: this.receivableAccount
    });
  }

  private markFormPristine(): void {
    this.pristineSnapshot = this.serializeEditableState();
  }

  /** Vrai si l'utilisateur a modifié des champs depuis le dernier état propre (chargement, sauvegarde,
   *  mise en service ou cession). Utilisé par le guard CanDeactivate et le @HostListener beforeunload. */
  isDirty(): boolean {
    return this.serializeEditableState() !== this.pristineSnapshot;
  }

  /** Appelé par `pendingChangesGuard` (CanDeactivate) avant une navigation interne Angular. */
  canDeactivate(): boolean {
    if (!this.isDirty()) return true;
    return window.confirm(
      $localize`:@@accounting.fixed-asset-detail.ts.vous.avez.des.modifications.non.enregist.84457463:Vous avez des modifications non enregistrées. Quitter cette page ? Les changements seront perdus.`
    );
  }

  @HostListener('window:beforeunload', ['$event'])
  unloadNotification(event: BeforeUnloadEvent): void {
    if (this.isDirty()) {
      // Affecter returnValue déclenche la boîte de confirmation native du navigateur.
      event.returnValue = $localize`:@@accounting.fixed-asset-detail.ts.vous.avez.des.modifications.non.enregist.80479b8a:Vous avez des modifications non enregistrées.`;
    }
  }

  depreciableBase(): number {
    const base = (this.form.acquisitionCost || 0) + (this.form.capitalizedFees || 0) - (this.form.residualValue || 0);
    return base > 0 ? base : 0;
  }

  onCategoryChange(categoryId: string): void {
    const cat = this.categories().find(c => c.id === categoryId);
    if (!cat) return;
    this.form.assetAccountNumber = cat.defaultAssetAccount;
    this.form.depreciationAccountNumber = cat.defaultDepreciationAccount;
    this.form.expenseAccountNumber = cat.defaultExpenseAccount;
    if (cat.isNonDepreciable) {
      this.form.depreciationRatePercent = null;
      this.form.usefulLifeYears = null;
      this.form.depreciationMethod = DepreciationMethod.Linear;
    } else {
      this.form.depreciationRatePercent = cat.legalRatePercent;
      this.form.usefulLifeYears = cat.usefulLifeYears;
    }
  }

  // Marqueur « champ maître » : le champ que l'utilisateur vient d'éditer est la seule source de
  // vérité, l'autre champ n'est que dérivé. Chaque handler ne modifie jamais le champ qu'il reçoit
  // en paramètre (déjà à jour via le two-way binding [(ngModel)]) — il ne fait que recalculer
  // l'AUTRE champ, aligné sur `FixedAssetRateResolver.Resolve` (backend) : durée dérivée = 2
  // décimales, taux dérivé = 4 décimales. Un mutex (`isSyncingRateAndLife`) empêche toute
  // ré-entrance : si la dérivation déclenchait par erreur le handler du champ maître, celui-ci ne
  // pourrait pas réécrire (et donc dégrader) la valeur que l'utilisateur vient de saisir
  // (élimine le cas 3 % → 33,33 ans → 3,0003 %).
  private isSyncingRateAndLife = false;

  onRateChange(rate: number | null): void {
    if (this.isSyncingRateAndLife) return;
    if (rate && rate > 0 && rate <= 100) {
      this.isSyncingRateAndLife = true;
      try {
        this.form.usefulLifeYears = Math.round((100 / rate) * 100) / 100;
      } finally {
        this.isSyncingRateAndLife = false;
      }
    }
  }

  onLifeChange(years: number | null): void {
    if (this.isSyncingRateAndLife) return;
    if (years && years > 0 && years <= 100) {
      this.isSyncingRateAndLife = true;
      try {
        this.form.depreciationRatePercent = Math.round((100 / years) * 10000) / 10000;
      } finally {
        this.isSyncingRateAndLife = false;
      }
    }
  }

  private validate(): boolean {
    const errors: Record<string, string> = {};
    if (!this.form.label.trim()) errors['label'] = $localize`:@@accounting.fixed-asset-detail.ts.la.designation.est.obligatoire.bdb532f0:La désignation est obligatoire.`;
    if (!this.form.depreciationRateCategoryId) errors['category'] = $localize`:@@accounting.fixed-asset-detail.ts.la.categorie.est.obligatoire.33b95b04:La catégorie est obligatoire.`;
    if (!this.form.acquisitionDate) errors['acquisitionDate'] = $localize`:@@accounting.fixed-asset-detail.ts.la.date.d.acquisition.est.obligatoire.53122395:La date d'acquisition est obligatoire.`;
    const total = (this.form.acquisitionCost || 0) + (this.form.capitalizedFees || 0);
    if (total <= 0) errors['cost'] = $localize`:@@accounting.fixed-asset-detail.ts.le.cout.d.acquisition.doit.etre.positif.294d9b47:Le coût d'acquisition doit être positif.`;
    if ((this.form.residualValue || 0) >= total && total > 0)
      errors['residual'] = $localize`:@@accounting.fixed-asset-detail.ts.la.valeur.residuelle.doit.etre.inferieur.ab484d23:La valeur résiduelle doit être inférieure au coût total.`;
    if (!this.isNonDepreciable()) {
      const rate = this.form.depreciationRatePercent;
      if (rate !== null && (rate <= 0 || rate > 100)) errors['rate'] = $localize`:@@accounting.fixed-asset-detail.ts.le.taux.doit.etre.compris.entre.0.et.100.af09f376:Le taux doit être compris entre 0 et 100 %.`;
      if (this.form.depreciationMethod === DepreciationMethod.Accelerated && !ACCELERATION_COEFFICIENTS.includes(this.form.accelerationCoefficient))
        errors['coefficient'] = $localize`:@@accounting.fixed-asset-detail.ts.le.coefficient.accelere.doit.etre.1.5.ou.dc27b9de:Le coefficient accéléré doit être 1,5 ou 2 (Décret 2008-492 art. 2).`;
    }
    // C1 — validation des comptes alignée serveur (FixedAssetAccountRules) : format, préfixes NCT
    // et cohérence corporel/incorporel. Affichage par champ via fieldErrors.
    const accountResult = validateAccountTriplet(
      this.form.assetAccountNumber,
      this.form.depreciationAccountNumber,
      this.form.expenseAccountNumber
    );
    if (!accountResult.valid && accountResult.field) {
      errors[accountResult.field] = accountResult.message;
    }
    this.fieldErrors.set(errors);
    return Object.keys(errors).length === 0;
  }

  // ----------------------------------------------------------------
  // Actions
  // ----------------------------------------------------------------

  save(): void {
    this.error.set(null);
    this.success.set(null);
    if (!this.validate()) {
      this.error.set($localize`:@@accounting.fixed-asset-detail.ts.veuillez.corriger.les.champs.en.erreur.85783828:Veuillez corriger les champs en erreur.`);
      return;
    }
    if (this.isNew()) this.create();
    else this.updateDraft();
  }

  private create(): void {
    this.saving.set(true);
    this.api
      .create({
        label: this.form.label,
        depreciationRateCategoryId: this.form.depreciationRateCategoryId,
        acquisitionCost: this.form.acquisitionCost || 0,
        capitalizedFees: this.form.capitalizedFees || 0,
        residualValue: this.form.residualValue || 0,
        acquisitionDate: this.form.acquisitionDate,
        description: this.form.description || undefined,
        vatAmount: this.form.vatAmount || 0,
        location: this.form.location || undefined,
        supplierId: this.form.supplierId || undefined,
        assetAccountNumber: this.form.assetAccountNumber || undefined,
        depreciationAccountNumber: this.form.depreciationAccountNumber || undefined,
        expenseAccountNumber: this.form.expenseAccountNumber || undefined,
        depreciationMethod: this.form.depreciationMethod,
        accelerationCoefficient: this.form.depreciationMethod === DepreciationMethod.Accelerated ? this.form.accelerationCoefficient : 1,
        depreciationRatePercent: this.isNonDepreciable() ? null : this.form.depreciationRatePercent,
        usefulLifeYears: this.isNonDepreciable() ? null : this.form.usefulLifeYears
      })
      .subscribe({
        next: res => {
          this.saving.set(false);
          if (res.data) {
            this.router.navigate(['/accounting/fixed-assets', res.data], { queryParams: { created: '1' } });
          } else {
            this.error.set(res.message ?? $localize`:@@ui.tern.erreur.lors.de.la.creation.e406e7:Erreur lors de la création.`);
          }
        },
        error: err => {
          this.saving.set(false);
          this.error.set(err?.error?.message ?? $localize`:@@ui.tern.erreur.lors.de.la.creation.e406e7:Erreur lors de la création.`);
        }
      });
  }

  private updateDraft(): void {
    const id = this.asset()?.id;
    if (!id) return;
    const req: UpdateFixedAssetRequest = {
      label: this.form.label,
      acquisitionCost: this.form.acquisitionCost || 0,
      capitalizedFees: this.form.capitalizedFees || 0,
      residualValue: this.form.residualValue || 0,
      acquisitionDate: this.form.acquisitionDate,
      description: this.form.description || undefined,
      location: this.form.location || undefined,
      assetAccountNumber: this.form.assetAccountNumber || undefined,
      depreciationAccountNumber: this.form.depreciationAccountNumber || undefined,
      expenseAccountNumber: this.form.expenseAccountNumber || undefined,
      depreciationRateCategoryId: this.form.depreciationRateCategoryId || null,
      depreciationMethod: this.form.depreciationMethod,
      accelerationCoefficient: this.form.depreciationMethod === DepreciationMethod.Accelerated ? this.form.accelerationCoefficient : 1,
      depreciationRatePercent: this.isNonDepreciable() ? null : this.form.depreciationRatePercent,
      usefulLifeYears: this.isNonDepreciable() ? null : this.form.usefulLifeYears,
      vatAmount: this.form.vatAmount || 0
    };
    this.saving.set(true);
    this.api.update(id, req).subscribe({
      next: () => {
        this.saving.set(false);
        this.error.set(null);
        this.success.set($localize`:@@accounting.fixed-asset-detail.ts.modifications.enregistrees.563f985e:Modifications enregistrées.`);
        this.preview.set(null);
        this.loadAsset(id);
      },
      error: err => {
        this.saving.set(false);
        this.error.set(err?.error?.message ?? $localize`:@@ui.tern.erreur.lors.de.l.enregistrement.e952ae:Erreur lors de l'enregistrement.`);
      }
    });
  }

  previewSchedule(): void {
    const id = this.asset()?.id;
    if (!id) return;
    this.saving.set(true);
    this.error.set(null);
    this.api.previewSchedule(id, this.previewDate).subscribe({
      next: res => {
        this.saving.set(false);
        this.preview.set(res.data ?? null);
      },
      error: err => {
        this.saving.set(false);
        this.error.set(err?.error?.message ?? $localize`:@@ui.tern.erreur.lors.de.la.simulation.428d66:Erreur lors de la simulation.`);
      }
    });
  }

  putInService(): void {
    if (this.saving()) return;
    const id = this.asset()?.id;
    if (!id) return;
    this.saving.set(true);
    this.error.set(null);
    this.success.set(null);
    this.api.putInService(id, { inServiceDate: this.inServiceDate, creditAccountNumber: this.creditAccount || '404' }).subscribe({
      next: () => {
        this.saving.set(false);
        this.error.set(null);
        this.success.set(
          this.isFromSupplierInvoice()
            ? $localize`:@@ui.tern.immobilisation.mise.en.service.et.tableau..12cfa5:Immobilisation mise en service et tableau d'amortissement généré.`
            : $localize`:@@ui.tern.immobilisation.mise.en.service.ecriture.ji.4c86f5:Immobilisation mise en service, écriture JIM générée et tableau d'amortissement créé.`
        );
        this.preview.set(null);
        this.loadAsset(id);
      },
      error: err => {
        this.saving.set(false);
        this.success.set(null);
        const body = err?.error;
        if (body?.code === 'CONCURRENCY_CONFLICT') {
          this.error.set(
            $localize`:@@accounting.fixed-asset-detail.ts.les.donnees.ont.ete.modifiees.entre.temp.6e498430:Les données ont été modifiées entre-temps. La fiche a été actualisée — vérifiez le statut puis réessayez si nécessaire.`
          );
        } else {
          this.error.set(body?.message ?? $localize`:@@ui.tern.erreur.mise.en.service.e7b505:Erreur mise en service.`);
        }
        this.loadAsset(id);
      }
    });
  }

  refreshAsset(): void {
    const id = this.asset()?.id;
    if (!id) return;
    this.error.set(null);
    this.success.set(null);
    this.loadAsset(id);
  }

  generateSchedule(): void {
    const id = this.asset()?.id;
    if (!id) return;
    this.saving.set(true);
    this.api.generateSchedule(id).subscribe({
      next: res => {
        this.schedule.set(res.data ?? null);
        this.saving.set(false);
        this.success.set($localize`:@@accounting.fixed-asset-detail.ts.tableau.d.amortissement.genere.73981911:Tableau d'amortissement généré.`);
      },
      error: err => {
        this.saving.set(false);
        this.error.set(err?.error?.message ?? $localize`:@@ui.tern.erreur.generation.tableau.14036b:Erreur génération tableau.`);
      }
    });
  }

  exportSchedule(): void {
    const id = this.asset()?.id;
    if (!id) return;
    this.saving.set(true);
    this.error.set(null);
    this.api.exportScheduleExcel(id).subscribe({
      next: blob => {
        this.saving.set(false);
        const label = this.asset()?.inventoryNumber ?? id;
        this.downloadBlob(blob, `tableau-amortissement-${label}.xlsx`);
        this.success.set($localize`:@@accounting.fixed-asset-detail.ts.export.excel.telecharge.08b3bed0:Export Excel téléchargé.`);
      },
      error: err => {
        this.saving.set(false);
        this.error.set(err?.error?.message ?? $localize`:@@ui.tern.erreur.export.excel.dd1ee1:Erreur export Excel.`);
      }
    });
  }

  onDisposalModeChange(mode: DisposalMode): void {
    this.disposalMode = mode;
    if (mode === 'scrap') {
      // Mise au rebut : produit nul, aucun compte de règlement (aligné T4).
      this.disposalProceeds = 0;
    } else if (mode === 'receivable' && !this.receivableAccount) {
      this.receivableAccount = '452';
    }
  }

  /** Construit le payload de cession selon le mode de règlement (T15 / T4). */
  private buildDisposalRequest(): DisposeFixedAssetRequest {
    const disposalProceeds = this.disposalMode === 'scrap' ? 0 : this.disposalProceeds || 0;
    const request: DisposeFixedAssetRequest = {
      disposalDate: this.disposalDate,
      disposalProceeds
    };
    if (this.disposalMode === 'cash') {
      request.treasuryAccountNumber = this.treasuryAccount || undefined;
    } else if (this.disposalMode === 'receivable') {
      request.receivableAccountNumber = this.receivableAccount || '452';
    }
    // scrap : aucun compte de règlement.
    return request;
  }

  /** Récapitulatif date/prix/compte affiché dans la modale de confirmation (T15 / C9). */
  private disposalRecap(): string {
    const proceeds = this.disposalMode === 'scrap' ? 0 : this.disposalProceeds || 0;
    const account =
      this.disposalMode === 'scrap'
        ? $localize`:@@ui.tern.mise.au.rebut.aucun.compte.de.reglement.c29e73:Mise au rebut — aucun compte de règlement`
        : this.disposalMode === 'receivable'
          ? $localize`:@@ui.tern.a.terme.creance.ph.4d7fd9:À terme — créance ${this.receivableAccount || '452'}:p0:`
          : $localize`:@@ui.tern.comptant.tresorerie.ph.23ed5e:Comptant — trésorerie ${this.treasuryAccount || '5321'}:p0:`;
    return (
      $localize`:@@accounting.fixed-asset-detail.ts.confirmer.la.cession.de.cette.immobilisa.bf7bb043:Confirmer la cession de cette immobilisation ?\nDate de cession : ${this.disposalDate}:disposalDate:\nPrix de cession : ${proceeds}:proceeds: TND\nRèglement : ${account}:account:\n\nCette action est irréversible.`
    );
  }

  /** Demande confirmation avant d'enregistrer la cession (action irréversible — T15 / C9). */
  confirmDispose(): void {
    const id = this.asset()?.id;
    if (!id) return;
    this.error.set(null);
    this.success.set(null);
    this.confirmation.confirm({
      header: $localize`:@@accounting.fixed-asset-detail.ts.enregistrer.la.cession.9bdc21df:Enregistrer la cession`,
      message: this.disposalRecap(),
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: $localize`:@@fixed-asset-detail.component.acceptLabel.Enregistrer_la_c:Enregistrer la cession`,
      rejectLabel: $localize`:@@fixed-asset-detail.component.rejectLabel.Annuler:Annuler`,
      acceptButtonStyleClass: 'btn-danger',
      size: 'md',
      accept: () => this.dispose()
    });
  }

  dispose(): void {
    const id = this.asset()?.id;
    if (!id) return;
    this.saving.set(true);
    this.api
      .dispose(id, this.buildDisposalRequest())
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.success.set($localize`:@@accounting.fixed-asset-detail.ts.cession.enregistree.et.ecritures.comptab.53b1d27c:Cession enregistrée et écritures comptables générées.`);
          this.loadAsset(id);
        },
        error: err => {
          this.saving.set(false);
          this.error.set(err?.error?.message ?? $localize`:@@ui.tern.erreur.cession.4817ce:Erreur cession.`);
        }
      });
  }

  private downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  private loadSuppliers(): void {
    this.supplierApi.getSuppliers({ isActive: true, pageSize: 200, skipGlobalErrorUi: true }).subscribe({
      next: res => this.suppliers.set(res.data?.items ?? []),
      error: () => this.suppliers.set([])
    });
  }

  private loadAsset(id: string): void {
    this.api.getById(id).subscribe({
      next: res => {
        this.asset.set(res.data ?? null);
        if (res.data) {
          this.fillFormFromAsset(res.data);
          this.markFormPristine();
          if (isDraftStatus(res.data.status)) {
            this.loadSuppliers();
          }
          this.api.getSchedule(id).subscribe(s => this.schedule.set(s.data ?? null));
        }
      },
      error: () => this.error.set($localize`:@@accounting.fixed-asset-detail.ts.immobilisation.introuvable.cd4a3ada:Immobilisation introuvable.`)
    });
  }

  totalDepreciation(s: FixedAssetScheduleDto): number {
    return s.lines.reduce((sum, l) => sum + l.depreciationAmount, 0);
  }

  statusLabel(a: FixedAssetDto): string {
    return FIXED_ASSET_STATUS_LABELS[a.status] ?? '—';
  }

  methodLabel(m: DepreciationMethod): string {
    return DEPRECIATION_METHOD_LABELS[m] ?? $localize`:@@ui.tern.lineaire.a5db4c:Linéaire`;
  }

  pageTitle(): string {
    return this.isNew() ? $localize`:@@ui.tern.nouvelle.immobilisation.477db8:Nouvelle immobilisation` : (this.asset()?.label ?? $localize`:@@ui.tern.immobilisation.b42edd:Immobilisation`);
  }

  pageSubtitle(): string {
    return this.asset()?.inventoryNumber ?? $localize`:@@ui.tern.saisie.et.tableau.d.amortissement.1d761c:Saisie et tableau d'amortissement`;
  }
}
