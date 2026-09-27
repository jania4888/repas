import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CanDeactivateFn } from '@angular/router';
import { Subject, of } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AccountingFilterBarComponent } from '../shared/accounting-filter-bar.component';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import { AccountingExportMenuComponent } from '../shared/accounting-export-menu.component';
import { AccountingExportFormat, downloadBlob, exportExtension } from '../shared/accounting-download.util';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { canValidateAccountingEntries } from '@core/utils/accounting-access';
import {
  AccountingService,
  FiscalAdjustmentCatalogEntryDto,
  FiscalAdjustmentLineDto,
  FiscalCarryForwardDto,
  FiscalResultDeclarationDto,
  UpsertFiscalResultRequest
} from '../services/accounting.service';

/** Réponse d'API générique (miroir non exporté de `ApiResponse<T>` du service). */
interface FiscalResultApiResponse {
  success: boolean;
  data?: FiscalResultDeclarationDto;
  error?: string;
}

const MIN_FISCAL_YEAR = 2000;
const MAX_FISCAL_YEAR = 2100;
const UNSAVED_CHANGES_MESSAGE =
  $localize`:@@accounting.fiscal-result.ts.des.modifications.non.enregistrees.seron.a18f027c:Des modifications non enregistrées seront perdues. Continuer ?`;

/** Modèle éditable local (copie mutable de la feuille de détermination). */
interface EditableModel {
  taxpayerKind: number;
  accountingResult: number;
  appliedIsRate: number;
  localTurnoverTtc: number;
  minimumTaxRegime: number;
  acomptesPaid: number;
  withholdingSuffered: number;
  priorTaxCredit: number;
  adjustments: FiscalAdjustmentLineDto[];
  carryForwards: FiscalCarryForwardDto[];
}

/**
 * Détermination du résultat fiscal (liasse fiscale tunisienne) : passage du résultat comptable au
 * résultat fiscal (réintégrations / déductions), imputation des reports, puis calcul de l'IS ou de
 * l'IRPP-BIC. Le calcul est fait CÔTÉ SERVEUR à l'enregistrement (aucune duplication du moteur ici).
 */
@Component({
  selector: 'app-fiscal-result',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    PageHeaderComponent,
    ButtonComponent,
    AccountingFilterBarComponent,
    AccountingStatusBannerComponent,
    AccountingExportMenuComponent
  ],
  template: `
    <app-page-header title="Détermination du résultat fiscal" i18n-title="@@accounting.fiscal-result.determination.du.resultat.fiscal.72c4a438"
      subtitle="Passage du résultat comptable au résultat fiscal, imputation des reports et calcul de l'impôt (IS / IRPP)" i18n-subtitle="@@accounting.fiscal-result.passage.du.resultat.comptable.au.resulta.82bcc745" />

    @if (isDirty()) {
      <p class="fr-dirty-indicator" role="status" i18n="@@accounting.fiscal-result.modifications.non.enregistrees.af44fff0"><i class="pi pi-circle-fill" aria-hidden="true"></i> Modifications non enregistrées</p>
    }

    <div class="card accounting-filters-card">
      <app-accounting-filter-bar ariaLabel="Exercice et type de contribuable" i18n-ariaLabel="@@accounting.fiscal-result.exercice.et.type.de.contribuable.16a6757f">
        <div accountingFilterFields class="fr-fields">
          <div class="accounting-filter-field">
            <label class="accounting-filter-label" for="fr-year" i18n="@@accounting.fiscal-result.exercice.e171e2b0">Exercice</label>
            <input id="fr-year" type="number" [ngModel]="fiscalYear" (ngModelChange)="onYearInputChange($event)"
              class="accounting-filter-input fr-year-input" min="2000" max="2100"
              [attr.aria-invalid]="!isYearValid()" />
            @if (!isYearValid()) {
              <span class="fr-year-error" role="alert" i18n="@@accounting.fiscal-result.exercice.invalide.doit.etre.compris.entre.2000.e.db4c8a16">Exercice invalide : doit être compris entre 2000 et 2100.</span>
            }
          </div>
          <div class="accounting-filter-field">
            <label class="accounting-filter-label" for="fr-kind" i18n="@@accounting.fiscal-result.contribuable.30fa0764">Contribuable</label>
            <select id="fr-kind" [(ngModel)]="model.taxpayerKind" class="accounting-filter-input" [disabled]="readonly()">
              <option [ngValue]="0" i18n="@@accounting.fiscal-result.societe.is.f1d3df19">Société (IS)</option>
              <option [ngValue]="1" i18n="@@accounting.fiscal-result.personne.physique.irpp.bic.6d217eb6">Personne physique (IRPP-BIC)</option>
            </select>
          </div>
        </div>
        <div accountingFilterActions>
          <app-button variant="secondary" icon="pi pi-refresh" type="button" (click)="load()" [disabled]="loading() || !isYearValid()"
            ariaLabel="Charger la feuille de détermination" i18n-ariaLabel="@@accounting.fiscal-result.charger.la.feuille.de.determination.63e2d09f" i18n="@@accounting.fiscal-result.charger.8f860300">Charger</app-button>
          @if (canMutate()) {
            <app-button variant="primary" icon="pi pi-save" type="button" (click)="save()"
              [disabled]="loading() || saving() || readonly()"
              ariaLabel="Enregistrer et recalculer" i18n-ariaLabel="@@accounting.fiscal-result.enregistrer.et.recalculer.4dd2112b" i18n="@@accounting.fiscal-result.enregistrer.et.recalculer.0b6f2782">Enregistrer et recalculer</app-button>
          }
          <app-accounting-export-menu label="Exporter la détermination" i18n-label="@@accounting.fiscal-result.exporter.la.determination.03b0da45"
            [disabled]="loading() || !data()" (exportFormat)="onExportDetermination($event)" />
          <app-accounting-export-menu label="Exporter la liasse complète" i18n-label="@@accounting.fiscal-result.exporter.la.liasse.complete.1549c0dd"
            [disabled]="loading() || !data()" (exportFormat)="onExportLiasse($event)" />
          @if (canFinalize()) {
            <app-button variant="secondary" icon="pi pi-lock" type="button" (click)="finalize()"
              [disabled]="loading() || saving() || readonly()"
              ariaLabel="Finaliser la feuille (cabinet en mode dossier délégué)" i18n-ariaLabel="@@accounting.fiscal-result.finaliser.la.feuille.cabinet.en.mode.dos.93a2e40b" i18n="@@accounting.fiscal-result.finaliser.ad181d5f">Finaliser</app-button>
          }
        </div>
      </app-accounting-filter-bar>
    </div>

    <app-accounting-status-banner variant="error" [message]="error() ?? ''" [showRetry]="!!error()" retryLabel="Réessayer" i18n-retryLabel="@@accounting.fiscal-result.reessayer.c4f78b12" (retry)="load()" />

    @if (info(); as msg) {
      <div class="fr-info-banner" role="status"><i class="pi pi-check-circle" aria-hidden="true"></i><span>{{ msg }}</span></div>
    }

    @if (data(); as d) {
      @if (!d.fiscalLiasseEnabled) {
        <div class="fr-warn-banner" role="status">
          <i class="pi pi-info-circle" aria-hidden="true"></i>
          <span i18n="@@accounting.fiscal-result.la.liasse.fiscale.n.est.pas.activee.pour.ce.doss.9f5fbc2e">La liasse fiscale n'est pas activée pour ce dossier. La détermination ci-dessous reste indicative.</span>
        </div>
      }
      @if (d.isFinalized) {
        <div class="fr-lock-banner" role="status" i18n="@@accounting.fiscal-result.feuille.finalisee.lecture.seule.622c43f5.if">
          <i class="pi pi-lock" aria-hidden="true"></i>
          <span>@if (d.finalizedAt) {Feuille finalisée le {{ d.finalizedAt | date : 'shortDate' }} — lecture seule.} @else {Feuille finalisée — lecture seule.}</span>
        </div>
      }
      @if (d.warnings.length) {
        <div class="fr-alert-banner" role="alert">
          <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
          <div>
            <strong i18n="@@accounting.fiscal-result.controles.fiscaux.220d222f">Contrôles fiscaux</strong>
            <ul class="fr-warn-list">
              @for (w of d.warnings; track w) { <li>{{ w }}</li> }
            </ul>
          </div>
        </div>
      }

      <div class="fr-grid">
        <!-- Colonne saisie -->
        <div class="fr-col">
          <div class="card fr-card">
            <h3 class="fr-card-title" i18n="@@accounting.fiscal-result.donnees.de.base.6f1650ac">Données de base</h3>
            <div class="fr-input-row">
              <label i18n="@@accounting.fiscal-result.resultat.comptable.net.apres.impot.458080eb">Résultat comptable net (après impôt)</label>
              <input type="number" step="0.001" [(ngModel)]="model.accountingResult" [disabled]="readonly()" />
              <span class="fr-hint" i18n="@@accounting.fiscal-result.l.is.comptabilise.compte.69.est.reintegre.ci.des.679099ef">l'IS comptabilisé (compte 69) est réintégré ci-dessous</span>
            </div>
            <p class="fr-formula" i18n="@@accounting.fiscal-result.resultat.comptable.resultat.avant.impot.is.compt.a7664da8">Résultat comptable = résultat avant impôt − IS comptabilisé</p>
            @if (suggestedAccountingResult() != null) {
              <div class="fr-suggest-row">
                <span class="fr-hint" i18n="@@accounting.fiscal-result.resultat.comptable.calcule.e5323181">Résultat comptable calculé : {{ suggestedAccountingResult() | number : '1.3-3' }}</span>
                <app-button variant="ghost" size="sm" icon="pi pi-arrow-down-left" type="button"
                  (click)="applySuggestedAccountingResult()" [disabled]="readonly()"
                  ariaLabel="Reprendre le résultat comptable calculé" i18n-ariaLabel="@@accounting.fiscal-result.reprendre.le.resultat.comptable.calcule.4305db95" i18n="@@accounting.fiscal-result.reprendre.1c56710b">Reprendre</app-button>
              </div>
            }
            @if (model.taxpayerKind === 0) {
              <div class="fr-input-row">
                <label i18n="@@accounting.fiscal-result.taux.is.applicable.5255ef1e">Taux IS applicable</label>
                <input type="number" step="0.01" min="0" max="1" [(ngModel)]="model.appliedIsRate" [disabled]="readonly()" />
                <span class="fr-hint" i18n="@@accounting.fiscal-result.ex.0.15.15.21428cc2">ex. 0.15 = 15 %</span>
              </div>
            }
            <div class="fr-input-row">
              <label i18n="@@accounting.fiscal-result.chiffre.d.affaires.local.ttc.fa269f8a">Chiffre d'affaires local TTC</label>
              <input type="number" step="0.001" [(ngModel)]="model.localTurnoverTtc" [disabled]="readonly()" />
              <span class="fr-hint" i18n="@@accounting.fiscal-result.base.du.minimum.d.impot.183be405">base du minimum d'impôt</span>
            </div>
            @if (suggestedTurnover() > 0) {
              <div class="fr-suggest-row">
                <span class="fr-hint" i18n="@@accounting.fiscal-result.ca.comptable.calcule.08d13414">CA comptable calculé : {{ suggestedTurnover() | number : '1.3-3' }}</span>
                <app-button variant="ghost" size="sm" icon="pi pi-arrow-down-left" type="button"
                  (click)="applySuggestedTurnover()" [disabled]="readonly()"
                  ariaLabel="Reprendre le chiffre d'affaires comptable" i18n-ariaLabel="@@accounting.fiscal-result.reprendre.le.chiffre.d.affaires.comptabl.35c7e4b6" i18n="@@accounting.fiscal-result.reprendre.1c56710b">Reprendre</app-button>
              </div>
            }
            @if (caVarianceWarning(); as w) {
              <p class="fr-ca-warning" role="alert">
                <i class="pi pi-exclamation-triangle" aria-hidden="true"></i> {{ w }}
              </p>
            }
            <div class="fr-input-row">
              <label i18n="@@accounting.fiscal-result.regime.de.minimum.d.impot.803fc406">Régime de minimum d'impôt</label>
              <select [(ngModel)]="model.minimumTaxRegime" [disabled]="readonly()" aria-label="Régime de minimum d'impôt" i18n-aria-label="@@accounting.fiscal-result.regime.de.minimum.d.impot.803fc406">
                <option [ngValue]="0" i18n="@@accounting.fiscal-result.droit.commun.dda4790e">Droit commun</option>
                <option [ngValue]="1" i18n="@@accounting.fiscal-result.reduit.1fb773e1">Réduit</option>
                <option [ngValue]="2" i18n="@@accounting.fiscal-result.exonere.5d577ae9">Exonéré</option>
              </select>
              <span class="fr-hint" i18n="@@accounting.fiscal-result.exonere.societe.nouvellement.creee.zdr.totalemen.e806e153">exonéré : société nouvellement créée, ZDR, totalement exportatrice…</span>
            </div>
            <div class="fr-input-row">
              <label i18n="@@accounting.fiscal-result.acomptes.provisionnels.payes.afc8ee64">Acomptes provisionnels payés</label>
              <input type="number" step="0.001" [(ngModel)]="model.acomptesPaid" [disabled]="readonly()" />
            </div>
            <div class="fr-input-row">
              <label i18n="@@accounting.fiscal-result.retenues.a.la.source.subies.80fbccbf">Retenues à la source subies</label>
              <input type="number" step="0.001" [(ngModel)]="model.withholdingSuffered" [disabled]="readonly()" />
            </div>
            <div class="fr-input-row">
              <label i18n="@@accounting.fiscal-result.credit.d.impot.anterieur.844b4dae">Crédit d'impôt antérieur</label>
              <input type="number" step="0.001" [(ngModel)]="model.priorTaxCredit" [disabled]="readonly()" />
            </div>
          </div>

          <div class="card fr-card">
            <div class="fr-card-head">
              <h3 class="fr-card-title"><ng-container i18n="@@accounting.fiscal-result.reintegrations.a09780f3">Réintégrations </ng-container> <span class="fr-sum">+{{ reintegrationsTotal() | number : '1.3-3' }}</span></h3>
              <div class="fr-add">
                <select #reCat class="fr-cat-select" [disabled]="readonly()" aria-label="Ajouter une réintégration du catalogue" i18n-aria-label="@@accounting.fiscal-result.ajouter.une.reintegration.du.catalogue.6d58e5fc">
                  <option value="" i18n="@@accounting.fiscal-result.ajouter.du.catalogue.e2d6bfbf">Ajouter du catalogue…</option>
                  @for (c of catalogReintegrations(); track c.code) { <option [value]="c.code">{{ c.label }}</option> }
                </select>
                <app-button variant="ghost" size="sm" icon="pi pi-plus" type="button" (click)="addFromCatalog(reCat.value, 0); reCat.value=''"
                  [disabled]="readonly()" ariaLabel="Ajouter la réintégration sélectionnée" i18n-ariaLabel="@@accounting.fiscal-result.ajouter.la.reintegration.selectionnee.cccc5b49" i18n="@@accounting.fiscal-result.catalogue.5a241023">Catalogue</app-button>
                <app-button variant="ghost" size="sm" icon="pi pi-plus" type="button" (click)="addLine(0)" [disabled]="readonly()"
                  ariaLabel="Ajouter une ligne libre de réintégration" i18n-ariaLabel="@@accounting.fiscal-result.ajouter.une.ligne.libre.de.reintegration.50b60139" i18n="@@accounting.fiscal-result.ligne.libre.b78b7032">Ligne libre</app-button>
              </div>
            </div>
            <ng-container [ngTemplateOutlet]="linesTpl" [ngTemplateOutletContext]="{ kind: 0 }"></ng-container>
          </div>

          <div class="card fr-card">
            <div class="fr-card-head">
              <h3 class="fr-card-title"><ng-container i18n="@@accounting.fiscal-result.deductions.9690592b">Déductions </ng-container> <span class="fr-sum fr-sum--neg">−{{ deductionsTotal() | number : '1.3-3' }}</span></h3>
              <div class="fr-add">
                <select #deCat class="fr-cat-select" [disabled]="readonly()" aria-label="Ajouter une déduction du catalogue" i18n-aria-label="@@accounting.fiscal-result.ajouter.une.deduction.du.catalogue.72f0d617">
                  <option value="" i18n="@@accounting.fiscal-result.ajouter.du.catalogue.e2d6bfbf">Ajouter du catalogue…</option>
                  @for (c of catalogDeductions(); track c.code) { <option [value]="c.code">{{ c.label }}</option> }
                </select>
                <app-button variant="ghost" size="sm" icon="pi pi-plus" type="button" (click)="addFromCatalog(deCat.value, 1); deCat.value=''"
                  [disabled]="readonly()" ariaLabel="Ajouter la déduction sélectionnée" i18n-ariaLabel="@@accounting.fiscal-result.ajouter.la.deduction.selectionnee.01a693d4" i18n="@@accounting.fiscal-result.catalogue.5a241023">Catalogue</app-button>
                <app-button variant="ghost" size="sm" icon="pi pi-plus" type="button" (click)="addLine(1)" [disabled]="readonly()"
                  ariaLabel="Ajouter une ligne libre de déduction" i18n-ariaLabel="@@accounting.fiscal-result.ajouter.une.ligne.libre.de.deduction.d7628953" i18n="@@accounting.fiscal-result.ligne.libre.b78b7032">Ligne libre</app-button>
              </div>
            </div>
            <ng-container [ngTemplateOutlet]="linesTpl" [ngTemplateOutletContext]="{ kind: 1 }"></ng-container>
          </div>

          <div class="card fr-card">
            <div class="fr-card-head">
              <h3 class="fr-card-title" i18n="@@accounting.fiscal-result.deficits.amortissements.differes.reportables.bd922f05">Déficits & amortissements différés reportables</h3>
              <div class="fr-add">
                <app-button variant="ghost" size="sm" icon="pi pi-plus" type="button" (click)="addCarryForward(0)" [disabled]="readonly()"
                  ariaLabel="Ajouter un déficit reportable" i18n-ariaLabel="@@accounting.fiscal-result.ajouter.un.deficit.reportable.7a80915b" i18n="@@accounting.fiscal-result.deficit.3a860854">Déficit</app-button>
                <app-button variant="ghost" size="sm" icon="pi pi-plus" type="button" (click)="addCarryForward(1)" [disabled]="readonly()"
                  ariaLabel="Ajouter un amortissement différé" i18n-ariaLabel="@@accounting.fiscal-result.ajouter.un.amortissement.differe.98e3a2ea" i18n="@@accounting.fiscal-result.amort.differe.6bcbc045">Amort. différé</app-button>
              </div>
            </div>
            @if (model.carryForwards.length === 0) {
              <p class="fr-empty" i18n="@@accounting.fiscal-result.aucun.report.imputable.84095cb8">Aucun report imputable.</p>
            } @else {
              <table class="fr-table">
                <thead>
                  <tr><th i18n="@@accounting.fiscal-result.type.3deb7456">Type</th><th i18n="@@accounting.fiscal-result.origine.62e96258">Origine</th><th class="fr-num" i18n="@@accounting.fiscal-result.montant.initial.1a127883">Montant initial</th><th class="fr-num" i18n="@@accounting.fiscal-result.impute.cette.annee.8ab9b926">Imputé cette année</th><th i18n="@@accounting.fiscal-result.expire.3da5d6c1">Expire</th><th></th></tr>
                </thead>
                <tbody>
                  @for (cf of model.carryForwards; track $index) {
                    <tr>
                      <td>
                        <select [(ngModel)]="cf.kind" [disabled]="readonly()" aria-label="Type de report" i18n-aria-label="@@accounting.fiscal-result.type.de.report.fe6c2064">
                          <option [ngValue]="0" i18n="@@accounting.fiscal-result.deficit.3a860854">Déficit</option><option [ngValue]="1" i18n="@@accounting.fiscal-result.amort.differe.6bcbc045">Amort. différé</option>
                        </select>
                      </td>
                      <td>
                        <input type="number" class="fr-yr" [(ngModel)]="cf.originYear" [disabled]="readonly()"
                          [max]="fiscalYear - 1" aria-label="Année d'origine" i18n-aria-label="@@accounting.fiscal-result.annee.d.origine.1d5b5d49" />
                        @if (!isOriginYearValid(cf)) {
                          <span class="fr-yr-error" role="alert" i18n="@@accounting.fiscal-result.annee.d.origine.invalide.doit.etre.6b2d3ac6">Année d'origine invalide (doit être &lt; {{ fiscalYear }})</span>
                        }
                      </td>
                      <td class="fr-num"><input type="number" step="0.001" [(ngModel)]="cf.initialAmount" [disabled]="readonly()" aria-label="Montant initial" i18n-aria-label="@@accounting.fiscal-result.montant.initial.1a127883" /></td>
                      <td class="fr-num"><input type="number" step="0.001" [(ngModel)]="cf.imputedThisYear" [disabled]="readonly()" aria-label="Imputé cette année" i18n-aria-label="@@accounting.fiscal-result.impute.cette.annee.8ab9b926" /></td>
                      <td>
                        <input type="number" class="fr-yr" [value]="cf.expiryYear" disabled
                          aria-label="Année d'expiration (calculée automatiquement)" i18n-aria-label="@@accounting.fiscal-result.annee.d.expiration.calculee.automatiquement.22b048ad"
                          title="calculée automatiquement" i18n-title="@@accounting.fiscal-result.calculee.automatiquement.8bc241b3" placeholder="calculée automatiquement" i18n-placeholder="@@accounting.fiscal-result.calculee.automatiquement.8bc241b3" />
                      </td>
                      <td><app-button variant="ghost" size="sm" icon="pi pi-trash" type="button" (click)="removeCarryForward($index)" [disabled]="readonly()" ariaLabel="Supprimer ce report" i18n-ariaLabel="@@accounting.fiscal-result.supprimer.ce.report.2538bc39" /></td>
                    </tr>
                  }
                </tbody>
              </table>
            }
          </div>
        </div>

        <!-- Colonne calcul -->
        <div class="fr-col">
          <div class="card fr-card fr-compute">
            <h3 class="fr-card-title" i18n="@@accounting.fiscal-result.calcul.de.l.impot.bf1b0aab">Calcul de l'impôt</h3>
            <p class="fr-compute-note" i18n="@@accounting.fiscal-result.calcul.effectue.cote.serveur.mis.a.jour.apres.ch.9b94c666">Calcul effectué côté serveur, mis à jour après chaque enregistrement.</p>
            <table class="fr-compute-table">
              <tbody>
                <tr><td i18n="@@accounting.fiscal-result.resultat.comptable.net.apres.impot.458080eb">Résultat comptable net (après impôt)</td><td class="fr-num">{{ d.computation.accountingResult | number : '1.3-3' }}</td></tr>
                <tr><td i18n="@@accounting.fiscal-result.reintegrations.f41d5671">+ Réintégrations</td><td class="fr-num">{{ d.computation.totalReintegrations | number : '1.3-3' }}</td></tr>
                <tr><td i18n="@@accounting.fiscal-result.deductions.18713909">− Déductions</td><td class="fr-num">{{ d.computation.totalDeductions | number : '1.3-3' }}</td></tr>
                <tr class="fr-sub"><td i18n="@@accounting.fiscal-result.resultat.fiscal.avant.reports.ae6e14a8">= Résultat fiscal avant reports</td><td class="fr-num">{{ d.computation.resultBeforeCarryForward | number : '1.3-3' }}</td></tr>
                <tr><td i18n="@@accounting.fiscal-result.deficits.imputes.4a11147e">− Déficits imputés</td><td class="fr-num">{{ d.computation.deficitsImputed | number : '1.3-3' }}</td></tr>
                <tr><td i18n="@@accounting.fiscal-result.amortissements.differes.imputes.19824b2d">− Amortissements différés imputés</td><td class="fr-num">{{ d.computation.deferredDepreciationImputed | number : '1.3-3' }}</td></tr>
                <tr class="fr-sub"><td i18n="@@accounting.fiscal-result.resultat.fiscal.imposable.6e1e0535">= Résultat fiscal imposable</td><td class="fr-num">{{ d.computation.taxableResult | number : '1.3-3' }}</td></tr>
                @if (d.computation.deficitGeneratedThisYear > 0) {
                  <tr class="fr-deficit"><td i18n="@@accounting.fiscal-result.deficit.genere.reportable.bae87c7e">Déficit généré (reportable)</td><td class="fr-num">{{ d.computation.deficitGeneratedThisYear | number : '1.3-3' }}</td></tr>
                }
                <tr><td i18n="@@accounting.fiscal-result.impot.sur.le.resultat.7419068e.if">@if (d.computation.taxpayerKind === 0) {Impôt sur le résultat (IS {{ d.computation.appliedIsRate * 100 | number : '1.0-2' }} %)} @else {Impôt sur le résultat (barème IRPP)}</td><td class="fr-num">{{ d.computation.taxOnResult | number : '1.3-3' }}</td></tr>
                <tr><td i18n="@@accounting.fiscal-result.minimum.d.impot.8689385e">Minimum d'impôt</td><td class="fr-num">{{ d.computation.minimumTax | number : '1.3-3' }}</td></tr>
                <tr class="fr-sub"><td i18n="@@accounting.fiscal-result.impot.du.max.68b3784b">= Impôt dû (max)</td><td class="fr-num">{{ d.computation.taxDue | number : '1.3-3' }}</td></tr>
                <tr><td i18n="@@accounting.fiscal-result.contribution.sociale.de.solidarite.css.40731cb7">+ Contribution sociale de solidarité (CSS)</td><td class="fr-num">{{ d.computation.css | number : '1.3-3' }}</td></tr>
                <tr class="fr-sub"><td i18n="@@accounting.fiscal-result.total.impot.du.31b061e8">= Total impôt dû</td><td class="fr-num">{{ d.computation.totalTaxDue | number : '1.3-3' }}</td></tr>
                <tr><td i18n="@@accounting.fiscal-result.acomptes.provisionnels.80d50031">− Acomptes provisionnels</td><td class="fr-num">{{ d.computation.acomptesPaid | number : '1.3-3' }}</td></tr>
                <tr><td i18n="@@accounting.fiscal-result.retenues.a.la.source.subies.806e0dd7">− Retenues à la source subies</td><td class="fr-num">{{ d.computation.withholdingSuffered | number : '1.3-3' }}</td></tr>
                <tr><td i18n="@@accounting.fiscal-result.credit.d.impot.anterieur.77a9b786">− Crédit d'impôt antérieur</td><td class="fr-num">{{ d.computation.priorTaxCredit | number : '1.3-3' }}</td></tr>
                <tr class="fr-total"><td i18n="@@accounting.fiscal-result.net.a.payer.5d7fbe51">NET À PAYER</td><td class="fr-num">{{ d.computation.netToPay | number : '1.3-3' }}</td></tr>
                @if (d.computation.creditToCarry > 0) {
                  <tr class="fr-credit"><td i18n="@@accounting.fiscal-result.credit.d.impot.a.reporter.cd3bf8eb">Crédit d'impôt à reporter</td><td class="fr-num">{{ d.computation.creditToCarry | number : '1.3-3' }}</td></tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>
    }

    <ng-template #linesTpl let-kind="kind">
      @if (linesFor(kind).length === 0) {
        <p class="fr-empty" i18n="@@accounting.fiscal-result.aucune.ligne.3629c41e">Aucune ligne.</p>
      } @else {
        <table class="fr-table">
          <thead><tr><th i18n="@@accounting.fiscal-result.libelle.f5485bba">Libellé</th><th class="fr-num" i18n="@@accounting.fiscal-result.montant.4adcd9fc">Montant</th><th></th></tr></thead>
          <tbody>
            @for (line of linesFor(kind); track $index) {
              <tr>
                <td>
                  <input type="text" [(ngModel)]="line.label" [disabled]="readonly()" aria-label="Libellé de la ligne" i18n-aria-label="@@accounting.fiscal-result.libelle.de.la.ligne.2ba2a332" />
                  @if (!isLabelValid(line)) {
                    <span class="fr-label-error" role="alert" i18n="@@accounting.fiscal-result.libelle.requis.ad23b5c7">Libellé requis</span>
                  }
                  @if (line.isAutoSuggested) { <span class="fr-auto" title="Suggestion automatique" i18n-title="@@accounting.fiscal-result.suggestion.automatique.7351a28b" i18n="@@accounting.fiscal-result.auto.0d612c12">auto</span> }
                </td>
                <td class="fr-num"><input type="number" step="0.001" [(ngModel)]="line.amount" [disabled]="readonly()" aria-label="Montant" i18n-aria-label="@@accounting.fiscal-result.montant.4adcd9fc" /></td>
                <td><app-button variant="ghost" size="sm" icon="pi pi-trash" type="button" (click)="removeLine(line)" [disabled]="readonly()" ariaLabel="Supprimer la ligne" i18n-ariaLabel="@@accounting.fiscal-result.supprimer.la.ligne.7e5f9ae0" /></td>
              </tr>
            }
          </tbody>
        </table>
      }
    </ng-template>
  `,
  styles: `
    @use '../shared/accounting-layout';
    .fr-fields { display:flex; flex-wrap:wrap; align-items:flex-end; gap:var(--spacing-4); }
    .fr-year-input { max-width:7rem; }
    .fr-year-error, .fr-yr-error, .fr-label-error { display:block; font-size:var(--font-size-xs); color:var(--color-danger-600,#dc2626); margin-top:0.2rem; }
    .fr-ca-warning { display:flex; align-items:center; gap:var(--spacing-2); margin:0 0 var(--spacing-2); font-size:var(--font-size-xs); color:var(--color-warning-700,#b45309); }
    .fr-dirty-indicator { display:flex; align-items:center; gap:var(--spacing-2); margin:0 0 var(--spacing-2); font-size:var(--font-size-xs); color:var(--color-warning-700,#b45309); }
    .fr-dirty-indicator i { font-size:0.5rem; }
    .fr-info-banner, .fr-warn-banner, .fr-lock-banner { display:flex; align-items:center; gap:var(--spacing-2); margin-bottom:var(--spacing-4); padding:var(--spacing-3) var(--spacing-4); border-radius:var(--radius-md); font-size:var(--font-size-sm); }
    .fr-info-banner { background:var(--color-success-50,#f0fdf4); border:1px solid var(--color-success-200,#bbf7d0); color:var(--color-success-700,#15803d); }
    .fr-warn-banner { background:var(--color-primary-50,#eff6ff); border:1px solid var(--color-primary-200,#bfdbfe); color:var(--color-primary-700,#1d4ed8); }
    .fr-lock-banner { background:var(--color-background-subtle,#f1f5f9); border:1px solid var(--color-border-default,#cbd5e1); color:var(--color-text-secondary,#475569); }
    .fr-grid { display:grid; grid-template-columns:1fr; gap:var(--spacing-4); }
    @media (min-width:1100px){ .fr-grid { grid-template-columns:1.4fr 1fr; align-items:start; } }
    .fr-col { display:flex; flex-direction:column; gap:var(--spacing-4); }
    .fr-card { padding:var(--spacing-4) var(--spacing-5); border-radius:var(--radius-lg); box-shadow:var(--shadow-sm); }
    .fr-card-head { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:var(--spacing-2); }
    .fr-card-title { font-size:var(--font-size-base); font-weight:var(--font-weight-bold); margin:0 0 var(--spacing-3); }
    .fr-sum { font-size:var(--font-size-sm); color:var(--color-success-700,#15803d); font-variant-numeric:tabular-nums; }
    .fr-sum--neg { color:var(--color-danger-600,#dc2626); }
    .fr-add { display:flex; align-items:center; gap:var(--spacing-2); flex-wrap:wrap; }
    .fr-cat-select { max-width:16rem; padding:0.35rem 0.5rem; border:1px solid var(--color-border-default,#cbd5e1); border-radius:var(--radius-md); font-size:var(--font-size-sm); }
    .fr-input-row { display:grid; grid-template-columns:1fr 10rem auto; align-items:center; gap:var(--spacing-2); margin-bottom:var(--spacing-2); }
    .fr-input-row label { font-size:var(--font-size-sm); color:var(--color-text-secondary); }
    .fr-input-row input { padding:0.4rem 0.55rem; border:1px solid var(--color-border-default,#cbd5e1); border-radius:var(--radius-md); text-align:right; font-variant-numeric:tabular-nums; }
    .fr-input-row select { padding:0.4rem 0.55rem; border:1px solid var(--color-border-default,#cbd5e1); border-radius:var(--radius-md); }
    .fr-hint { font-size:var(--font-size-xs); color:var(--color-text-tertiary); }
    .fr-formula { font-size:var(--font-size-xs); color:var(--color-text-tertiary); margin:0 0 var(--spacing-2); }
    .fr-suggest-row { display:flex; align-items:center; justify-content:flex-end; gap:var(--spacing-2); margin:-0.25rem 0 var(--spacing-2); }
    .fr-alert-banner { display:flex; align-items:flex-start; gap:var(--spacing-2); margin-bottom:var(--spacing-4); padding:var(--spacing-3) var(--spacing-4); border-radius:var(--radius-md); font-size:var(--font-size-sm); background:var(--color-warning-50,#fffbeb); border:1px solid var(--color-warning-200,#fde68a); color:var(--color-warning-800,#92400e); }
    .fr-warn-list { margin:0.25rem 0 0; padding-left:1.1rem; }
    .fr-warn-list li { margin:0.15rem 0; }
    .fr-empty { font-size:var(--font-size-sm); color:var(--color-text-tertiary); margin:var(--spacing-2) 0 0; }
    .fr-table { width:100%; border-collapse:collapse; margin-top:var(--spacing-2); }
    .fr-table th { font-size:var(--font-size-xs); text-transform:uppercase; letter-spacing:0.04em; color:var(--color-text-tertiary); text-align:left; padding:var(--spacing-1) var(--spacing-2); border-bottom:1px solid var(--color-border-subtle); }
    .fr-table td { padding:var(--spacing-1) var(--spacing-2); vertical-align:middle; }
    .fr-table input, .fr-table select { width:100%; padding:0.3rem 0.45rem; border:1px solid var(--color-border-default,#cbd5e1); border-radius:var(--radius-sm,4px); }
    .fr-num { text-align:right; font-variant-numeric:tabular-nums; }
    .fr-table .fr-num input { text-align:right; }
    .fr-yr { max-width:6rem; }
    .fr-auto { margin-left:0.4rem; font-size:var(--font-size-xs); color:var(--color-primary-600,#2563eb); border:1px solid var(--color-primary-200,#bfdbfe); border-radius:var(--radius-pill,999px); padding:0 0.4rem; }
    .fr-compute { position:sticky; top:var(--spacing-4); }
    .fr-compute-note { font-size:var(--font-size-xs); color:var(--color-text-tertiary); margin:0 0 var(--spacing-3); }
    .fr-compute-table { width:100%; border-collapse:collapse; }
    .fr-compute-table td { padding:var(--spacing-2) var(--spacing-2); font-size:var(--font-size-sm); border-bottom:1px solid var(--color-border-subtle); }
    .fr-compute-table td.fr-num { font-variant-numeric:tabular-nums; font-weight:var(--font-weight-medium); white-space:nowrap; }
    .fr-compute-table .fr-sub td { font-weight:var(--font-weight-bold); background:var(--color-background-subtle); }
    .fr-compute-table .fr-total td { font-weight:var(--font-weight-bold); font-size:var(--font-size-base); color:var(--color-primary-700,#1d4ed8); border-top:2px solid var(--color-border-default); }
    .fr-compute-table .fr-credit td, .fr-compute-table .fr-deficit td { color:var(--color-warning-700,#b45309); }
  `
})
export class FiscalResultComponent implements OnInit {
  private readonly api = inject(AccountingService);
  private readonly auth = inject(AuthService);

  fiscalYear = new Date().getFullYear() - 1;
  readonly data = signal<FiscalResultDeclarationDto | null>(null);
  readonly catalog = signal<FiscalAdjustmentCatalogEntryDto[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly info = signal<string | null>(null);
  /**
   * CA local TTC calculé depuis la comptabilité. Conservé côté client : l'enregistrement ne le
   * recalcule pas (il l'est au chargement), la valeur reste donc disponible après sauvegarde.
   */
  readonly suggestedTurnover = signal(0);
  /**
   * Résultat comptable net (après impôt) recalculé depuis les états NCT (miroir du patron
   * `suggestedTurnover`) ; n'écrase jamais la valeur saisie sans action utilisateur (T24).
   */
  readonly suggestedAccountingResult = signal<number | null>(null);

  model: EditableModel = this.blankModel();
  private snapshot: EditableModel | null = null;

  readonly readonly = computed(() => this.data()?.isFinalized ?? false);
  readonly catalogReintegrations = computed(() => this.catalog().filter(c => c.kind === 0));
  readonly catalogDeductions = computed(() => this.catalog().filter(c => c.kind === 1));
  /** Boutons de mutation (Enregistrer, lignes d'ajustement…) : nécessite `accounting:create`. */
  readonly canMutate = computed(() => this.auth.hasPermission(PERMISSIONS.accounting.create));
  /** Bouton Finaliser : réservé au cabinet en mode dossier délégué (aligné sur la policy backend). */
  readonly canFinalize = computed(() => canValidateAccountingEntries(this.auth));

  private readonly loadRequests$ = new Subject<number>();

  constructor() {
    this.loadRequests$
      .pipe(
        switchMap(year =>
          this.api.getFiscalResult(year).pipe(
            catchError(() => of<FiscalResultApiResponse>({ success: false, error: 'Erreur réseau' }))
          )
        ),
        takeUntilDestroyed()
      )
      .subscribe(res => {
        this.loading.set(false);
        if (res.success && res.data) {
          this.data.set(res.data);
          this.model = this.toModel(res.data);
          this.snapshot = this.toModel(res.data);
          this.suggestedTurnover.set(res.data.suggestedLocalTurnoverTtc ?? 0);
          this.suggestedAccountingResult.set(res.data.suggestedAccountingResult ?? null);
        } else {
          this.error.set(res.error ?? $localize`:@@ui.tern.erreur.ab546c:Erreur`);
        }
      });
  }

  ngOnInit(): void {
    this.api.getFiscalAdjustmentCatalog().subscribe({
      next: res => { if (res.success && res.data) this.catalog.set(res.data); }
    });
    this.load();
  }

  /** Lignes de réintégration (kind=0) ou déduction (kind=1) du modèle courant. */
  linesFor(kind: number): FiscalAdjustmentLineDto[] {
    return this.model.adjustments.filter(a => a.kind === kind);
  }
  reintegrationsTotal(): number {
    return this.linesFor(0).reduce((s, l) => s + (Number(l.amount) || 0), 0);
  }
  deductionsTotal(): number {
    return this.linesFor(1).reduce((s, l) => s + (Number(l.amount) || 0), 0);
  }

  load(): void {
    if (!this.confirmDiscardIfDirty()) return;
    const y = this.clampYear(this.fiscalYear);
    this.fiscalYear = y;
    this.loading.set(true);
    this.error.set(null);
    this.info.set(null);
    this.loadRequests$.next(y);
  }

  /** Année saisie via l'input « Exercice » : demande confirmation si des modifications sont en cours. */
  onYearInputChange(value: number): void {
    if (this.isDirty() && !confirm(UNSAVED_CHANGES_MESSAGE)) {
      return;
    }
    this.fiscalYear = value;
  }

  isYearValid(): boolean {
    const y = Number(this.fiscalYear);
    return Number.isInteger(y) && y >= MIN_FISCAL_YEAR && y <= MAX_FISCAL_YEAR;
  }

  private clampYear(y: number): number {
    return Math.min(MAX_FISCAL_YEAR, Math.max(MIN_FISCAL_YEAR, Math.floor(Number(y)) || new Date().getFullYear()));
  }

  /** État « modifications non enregistrées » : compare le modèle courant au dernier instantané chargé/sauvegardé. */
  isDirty(): boolean {
    if (!this.snapshot) return false;
    return JSON.stringify(this.model) !== JSON.stringify(this.snapshot);
  }

  private confirmDiscardIfDirty(): boolean {
    if (!this.isDirty()) return true;
    return confirm(UNSAVED_CHANGES_MESSAGE);
  }

  /** Garde fonctionnelle de désactivation de route (T23) : confirmation si des modifications sont en cours. */
  canDeactivate(): boolean {
    return this.confirmDiscardIfDirty();
  }

  /** Avertissement non bloquant si le CA saisi diverge de plus de 5 % du CA comptable calculé. */
  caVarianceWarning(): string | null {
    const suggested = this.suggestedTurnover();
    if (!suggested) return null;
    const entered = Number(this.model.localTurnoverTtc) || 0;
    const diff = Math.abs(entered - suggested);
    const ratio = diff / suggested;
    if (ratio <= 0.05) return null;
    const pct = (ratio * 100).toFixed(1);
    return `Le chiffre d'affaires saisi s'écarte de ${pct} % du CA comptable calculé.`;
  }

  isLabelValid(line: FiscalAdjustmentLineDto): boolean {
    return line.label.trim().length > 0;
  }

  isOriginYearValid(cf: FiscalCarryForwardDto): boolean {
    const y = Number(cf.originYear);
    return Number.isInteger(y) && y < this.fiscalYear && y >= this.fiscalYear - 100;
  }

  save(): void {
    if (this.readonly() || !this.canMutate()) return;
    if (!this.isYearValid()) {
      this.error.set($localize`:@@accounting.fiscal-result.ts.exercice.invalide.doit.etre.compris.entr.db4c8a16:Exercice invalide : doit être compris entre 2000 et 2100.`);
      return;
    }
    const invalidLabel = this.model.adjustments.find(a => !this.isLabelValid(a));
    if (invalidLabel) {
      this.error.set($localize`:@@accounting.fiscal-result.ts.toutes.les.lignes.de.reintegration.deduc.9e21ee00:Toutes les lignes de réintégration/déduction doivent avoir un libellé.`);
      return;
    }
    const invalidOrigin = this.model.carryForwards.find(c => !this.isOriginYearValid(c));
    if (invalidOrigin) {
      this.error.set($localize`:@@accounting.fiscal-result.ts.annee.d.origine.invalide.sur.un.report.d.ed19e6ca:Année d'origine invalide sur un report (doit être antérieure à l'exercice).`);
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    this.info.set(null);
    const request: UpsertFiscalResultRequest = {
      taxpayerKind: this.model.taxpayerKind,
      accountingResult: Number(this.model.accountingResult) || 0,
      appliedIsRate: Number(this.model.appliedIsRate) || 0,
      localTurnoverTtc: Number(this.model.localTurnoverTtc) || 0,
      minimumTaxRegime: Number(this.model.minimumTaxRegime) || 0,
      acomptesPaid: Number(this.model.acomptesPaid) || 0,
      withholdingSuffered: Number(this.model.withholdingSuffered) || 0,
      priorTaxCredit: Number(this.model.priorTaxCredit) || 0,
      adjustments: this.model.adjustments.map(a => ({
        catalogCode: a.catalogCode ?? null,
        kind: a.kind,
        label: a.label,
        amount: Number(a.amount) || 0,
        isAutoSuggested: a.isAutoSuggested
      })),
      carryForwards: this.model.carryForwards.map(c => ({
        kind: c.kind,
        originYear: Number(c.originYear) || 0,
        initialAmount: Number(c.initialAmount) || 0,
        imputedThisYear: Number(c.imputedThisYear) || 0,
        expiryYear: c.expiryYear ?? null
      }))
    };
    this.api.upsertFiscalResult(this.fiscalYear, request).subscribe({
      next: res => {
        this.saving.set(false);
        if (res.success && res.data) {
          this.data.set(res.data);
          this.model = this.toModel(res.data);
          this.snapshot = this.toModel(res.data);
          this.info.set($localize`:@@accounting.fiscal-result.ts.feuille.enregistree.et.recalculee.e4350c9c:Feuille enregistrée et recalculée.`);
        } else {
          this.error.set(res.error ?? $localize`:@@ui.tern.l.enregistrement.a.echoue.3f69ec:L'enregistrement a échoué.`);
        }
      },
      error: () => {
        this.saving.set(false);
        this.error.set($localize`:@@accounting.fiscal-result.ts.l.enregistrement.a.echoue.3f69ec30:L'enregistrement a échoué.`);
      }
    });
  }

  finalize(): void {
    if (this.readonly() || !this.canFinalize()) return;
    if (!confirm($localize`:@@accounting.fiscal-result.ts.finaliser.la.feuille.de.determination.el.fc3b7475:Finaliser la feuille de détermination ? Elle deviendra non modifiable.`)) return;
    this.saving.set(true);
    this.error.set(null);
    this.api.finalizeFiscalResult(this.fiscalYear).subscribe({
      next: res => {
        this.saving.set(false);
        if (res.success) {
          this.info.set($localize`:@@accounting.fiscal-result.ts.feuille.finalisee.20a97ec0:Feuille finalisée.`);
          this.load();
        } else {
          this.error.set(res.error ?? $localize`:@@ui.tern.la.finalisation.a.echoue.81aa71:La finalisation a échoué.`);
        }
      },
      error: () => {
        this.saving.set(false);
        this.error.set($localize`:@@accounting.fiscal-result.ts.la.finalisation.a.echoue.reservee.au.cab.0fec5751:La finalisation a échoué (réservée au cabinet en mode dossier délégué).`);
      }
    });
  }

  addLine(kind: number): void {
    this.model.adjustments.push({ catalogCode: null, kind, label: '', amount: 0, isAutoSuggested: false });
  }
  addFromCatalog(code: string, kind: number): void {
    if (!code) return;
    const entry = this.catalog().find(c => c.code === code);
    if (!entry) return;
    this.model.adjustments.push({ catalogCode: entry.code, kind, label: entry.label, amount: 0, isAutoSuggested: false });
  }
  removeLine(line: FiscalAdjustmentLineDto): void {
    const i = this.model.adjustments.indexOf(line);
    if (i >= 0) this.model.adjustments.splice(i, 1);
  }
  addCarryForward(kind: number): void {
    this.model.carryForwards.push({ kind, originYear: this.fiscalYear - 1, initialAmount: 0, imputedThisYear: 0, expiryYear: null });
  }
  removeCarryForward(index: number): void {
    this.model.carryForwards.splice(index, 1);
  }

  onExportDetermination(format: AccountingExportFormat): void {
    this.api.exportFiscalResult(this.fiscalYear, format).subscribe({
      next: blob => downloadBlob(blob, `determination_fiscale_${this.fiscalYear}.${exportExtension(format)}`),
      error: () => this.error.set($localize`:@@accounting.fiscal-result.ts.l.export.a.echoue.d3506fe9:L'export a échoué.`)
    });
  }
  onExportLiasse(format: AccountingExportFormat): void {
    this.api.exportConsolidatedLiasse(this.fiscalYear, format).subscribe({
      next: blob => downloadBlob(blob, `liasse_fiscale_${this.fiscalYear}.${exportExtension(format)}`),
      error: () => this.error.set($localize`:@@accounting.fiscal-result.ts.l.export.a.echoue.d3506fe9:L'export a échoué.`)
    });
  }

  /** Reprend le CA local TTC calculé depuis la comptabilité comme base du minimum d'impôt. */
  applySuggestedTurnover(): void {
    if (this.readonly()) return;
    this.model.localTurnoverTtc = this.suggestedTurnover();
  }

  /** Reprend le résultat comptable net (après impôt) calculé depuis les états NCT (T24). */
  applySuggestedAccountingResult(): void {
    if (this.readonly()) return;
    const suggested = this.suggestedAccountingResult();
    if (suggested == null) return;
    this.model.accountingResult = suggested;
  }

  private toModel(d: FiscalResultDeclarationDto): EditableModel {
    return {
      taxpayerKind: d.taxpayerKind,
      accountingResult: d.accountingResult,
      appliedIsRate: d.appliedIsRate,
      localTurnoverTtc: d.localTurnoverTtc,
      minimumTaxRegime: d.minimumTaxRegime ?? 0,
      acomptesPaid: d.acomptesPaid,
      withholdingSuffered: d.withholdingSuffered,
      priorTaxCredit: d.priorTaxCredit,
      adjustments: d.adjustments.map(a => ({ ...a })),
      carryForwards: d.carryForwards.map(c => ({ ...c }))
    };
  }
  private blankModel(): EditableModel {
    return {
      taxpayerKind: 0, accountingResult: 0, appliedIsRate: 0.15, localTurnoverTtc: 0, minimumTaxRegime: 0,
      acomptesPaid: 0, withholdingSuffered: 0, priorTaxCredit: 0, adjustments: [], carryForwards: []
    };
  }
}

/** Garde de désactivation de route (T23) : confirme la perte des modifications non enregistrées. */
export const fiscalResultCanDeactivateGuard: CanDeactivateFn<FiscalResultComponent> = component =>
  component.canDeactivate();
