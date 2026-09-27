/// <reference types="@angular/localize" />
import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { InputTextModule } from 'primeng/inputtext';
import { InputMaskModule } from 'primeng/inputmask';
import { Textarea } from 'primeng/textarea';
import { SelectModule } from 'primeng/select';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { DividerModule } from 'primeng/divider';
import { FileUploadModule } from 'primeng/fileupload';
import { TagModule } from 'primeng/tag';
import { InputSwitchModule } from 'primeng/inputswitch';
import { DialogModule } from 'primeng/dialog';
import { ToastService } from '@core/services/toast.service';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { ErrorMessageService } from '@core/services/error-message.service';
import { CompanyService, UpdateCompanyRequest, Company } from '@core/services/company.service';
import { StockService, Warehouse, UpdateWarehouseRequest } from '@core/services/stock.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { canonicalizeNif, TUNISIAN_GOVERNORATE_OPTIONS } from '@shared/validation/validation-rules';
import { NifMaskPasteDirective } from '@shared/validation/nif-mask-paste.directive';
import { AuthService } from '@core/services/auth.service';
import { computeCompanyProfileCompletion } from './company-profile-completion.helpers';
import {
  CompanySectorPreviewResponse,
  CompanySectorService,
  SectorOptionDto
} from '@core/services/company-sector.service';

@Component({
  selector: 'app-company',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    RouterModule,
    InputTextModule,
    InputMaskModule,
    NifMaskPasteDirective,
    Textarea,
    SelectModule,
    ButtonModule,
    CardModule,
    DividerModule,
    FileUploadModule,
    TagModule,
    InputSwitchModule,
    DialogModule,
    PageHeaderComponent,
    BreadcrumbComponent
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems"></app-breadcrumb>
    
    <app-page-header 
      title="Mon entreprise" i18n-title="@@settings.company.mon.entreprise.e950c285" 
      subtitle="Informations légales et paramètres de facturation">
      <p-button 
        label="Retour" i18n-label="@@settings.company.retour.e5befb1f" 
        icon="pi pi-arrow-left" 
        [outlined]="true"
        routerLink="/settings">
      </p-button>
    </app-page-header>

    @if (loading()) {
      <div class="loading-container">
        <i class="pi pi-spin pi-spinner" style="font-size: 2rem"></i>
        <p i18n="@@settings.company.chargement.des.informations.c52577f2">Chargement des informations...</p>
      </div>
    } @else {
    
    @if (errorMessage() && isRateLimited()) {
      <div class="error-banner">
        <div class="error-content">
          <i class="pi pi-exclamation-triangle error-icon"></i>
          <div class="error-text">
            <strong i18n="@@settings.company.erreur.ab546c23">Erreur</strong>
            <p>{{ errorMessage() }}</p>
          </div>
        </div>
        <p-button 
          label="Réessayer" i18n-label="@@settings.company.reessayer.895d416b" 
          icon="pi pi-refresh"
          [disabled]="loading()"
          (onClick)="loadCompanyData()"
          styleClass="p-button-sm">
        </p-button>
      </div>
    }

    @if (profileCompletionPct() < 100) {
      <div class="profile-completion-banner" role="status" aria-live="polite">
        <div class="pcb-icon"><i class="pi pi-chart-line" aria-hidden="true"></i></div>
        <div class="pcb-body">
          <div class="pcb-title">Profil complété à {{ profileCompletionPct() }} %</div>
          <div class="pcb-bar">
            <div class="pcb-bar__fill" [style.width.%]="profileCompletionPct()"></div>
          </div>
          <p class="pcb-text" i18n="@@settings.company.completez.votre.logo.rib.et.coordonnees.pour.des.929a781f">Complétez votre logo, RIB et coordonnées pour des documents plus professionnels.</p>
        </div>
      </div>
    }

    <form [formGroup]="form" (ngSubmit)="onSubmit()">
      <div class="form-grid">
        <!-- Company Identity -->
        <p-card header="Identité de l'entreprise" i18n-header="@@settings.company.identite.de.l.entreprise.cd961dae" styleClass="form-card">
          <div class="logo-section">
            <div class="logo-preview">
              @if (logoUrl()) {
                <img [src]="logoUrl()" alt="Logo" i18n-alt="@@settings.company.logo.83fce832">
              } @else {
                <i class="pi pi-image"></i>
              }
            </div>
            <div class="logo-actions">
              <p-fileUpload
                mode="basic"
                accept="image/*"
                [maxFileSize]="1000000"
                chooseLabel="Choisir un logo"
                (onSelect)="onLogoSelect($event)">
              </p-fileUpload>
              <small i18n="@@settings.company.png.jpg.max.1mb.recommande.200x200px.d501e6b5">PNG, JPG. Max 1MB. Recommandé: 200x200px</small>
            </div>
          </div>

          <p-divider></p-divider>

          <div class="form-group">
            <label for="companyName"><ng-container i18n="@@settings.company.raison.sociale.28eaf8b0">Raison sociale </ng-container> <span class="required" i18n="@@settings.company.text.df58248c">*</span></label>
            <input 
              pInputText 
              id="companyName" 
              formControlName="companyName"
              class="w-full"
              [class.ng-invalid]="isInvalid('companyName')">
          </div>

          <div class="form-group">
            <label for="tradeName" i18n="@@settings.company.nom.commercial.beb9d235">Nom commercial</label>
            <input 
              pInputText 
              id="tradeName" 
              formControlName="tradeName"
              placeholder="Si différent de la raison sociale" i18n-placeholder="@@settings.company.si.different.de.la.raison.sociale.5e35b18c"
              class="w-full">
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="nif"><ng-container i18n="@@settings.company.matricule.fiscal.304096c4">Matricule fiscal </ng-container> <span class="required" i18n="@@settings.company.text.df58248c">*</span></label>
              <p-inputMask
                id="nif"
                formControlName="nif"
                appNifMaskPaste
                mask="9999999a/a/a/999"
                placeholder="1772793W/A/M/000" i18n-placeholder="@@settings.company.1772793w.a.m.000.e4c6f482"
                styleClass="w-full"
                (onBlur)="onNifBlur()">
              </p-inputMask>
            </div>

            <div class="form-group">
              <label for="commerceRegistry" i18n="@@settings.company.registre.de.commerce.240423de">Registre de commerce</label>
              <input 
                pInputText 
                id="commerceRegistry" 
                formControlName="commerceRegistry"
                placeholder="Ex: B123456789" i18n-placeholder="@@settings.company.ex.b123456789.f5792375"
                class="w-full">
            </div>
          </div>

          <div class="form-group">
            <label for="cnssEmployerNumber" class="label-with-tag">
              <span i18n="@@settings.company.matricule.employeur.cnss.877c7c12">Matricule employeur CNSS</span>
              @if (!form.get('cnssEmployerNumber')?.value) {
                <p-tag value="Recommandé" severity="warn" />
              }
            </label>
            <input
              pInputText
              id="cnssEmployerNumber"
              formControlName="cnssEmployerNumber"
              placeholder="Numéro d'affiliation CNSS de l'entreprise" i18n-placeholder="@@settings.company.numero.d.affiliation.cnss.de.l.entreprise.c7aa9548"
              class="w-full">
            <small class="form-hint" i18n="@@settings.company.requis.pour.generer.le.bordereau.mensuel.cnss.et.57c348d5">Requis pour générer le bordereau mensuel CNSS et enregistrer les versements de cotisations.</small>
          </div>

          <div class="form-group">
            <label for="taxRegime"><ng-container i18n="@@settings.company.regime.fiscal.ddf8b3c2">Régime fiscal </ng-container> <span class="required" i18n="@@settings.company.text.df58248c">*</span></label>
            <p-select 
              id="taxRegime"
              [options]="taxRegimes" 
              formControlName="taxRegime"
              placeholder="Sélectionner" i18n-placeholder="@@settings.company.selectionner.ab31a36f"
              styleClass="w-full">
            </p-select>
          </div>
        </p-card>

        <!-- Contact & Address -->
        <p-card header="Coordonnées" i18n-header="@@settings.company.coordonnees.7c309d77" styleClass="form-card">
          <div class="form-group">
            <label for="street"><ng-container i18n="@@settings.company.adresse.522e1466">Adresse </ng-container> <span class="required" i18n="@@settings.company.text.df58248c">*</span></label>
            <input 
              pInputText 
              id="street" 
              formControlName="street"
              class="w-full"
              [class.ng-invalid]="isInvalid('street')">
          </div>

          <div class="form-group">
            <label for="streetLine2" i18n="@@settings.company.complement.d.adresse.fba484a7">Complément d'adresse</label>
            <input 
              pInputText 
              id="streetLine2" 
              formControlName="streetLine2"
              class="w-full">
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="postalCode" i18n="@@settings.company.code.postal.74779109">Code postal</label>
              <p-inputMask
                id="postalCode"
                formControlName="postalCode"
                mask="9999"
                styleClass="w-full">
              </p-inputMask>
            </div>

            <div class="form-group">
              <label for="city"><ng-container i18n="@@settings.company.ville.97217611">Ville </ng-container> <span class="required" i18n="@@settings.company.text.df58248c">*</span></label>
              <input 
                pInputText 
                id="city" 
                formControlName="city"
                class="w-full">
            </div>
          </div>

          <div class="form-group">
            <label for="governorate"><ng-container i18n="@@settings.company.gouvernorat.b9cd1d99">Gouvernorat </ng-container> <span class="required" i18n="@@settings.company.text.df58248c">*</span></label>
            <p-select 
              id="governorate"
              [options]="governorates" 
              formControlName="governorate"
              placeholder="Sélectionner" i18n-placeholder="@@settings.company.selectionner.ab31a36f"
              [filter]="true"
              styleClass="w-full">
            </p-select>
          </div>

          <p-divider></p-divider>

          <div class="form-row">
            <div class="form-group">
              <label for="email"><ng-container i18n="@@settings.company.email.84add5b2">Email </ng-container> <span class="required" i18n="@@settings.company.text.df58248c">*</span></label>
              <input 
                pInputText 
                id="email" 
                type="email"
                formControlName="email"
                class="w-full">
            </div>

            <div class="form-group">
              <label for="phone"><ng-container i18n="@@settings.company.telephone.d3b023ea">Téléphone </ng-container> <span class="required" i18n="@@settings.company.text.df58248c">*</span></label>
              <p-inputMask
                id="phone"
                formControlName="phone"
                mask="99 999 999"
                styleClass="w-full">
              </p-inputMask>
            </div>
          </div>

          <div class="form-group">
            <label for="website" i18n="@@settings.company.site.web.7e78af33">Site web</label>
            <input 
              pInputText 
              id="website" 
              formControlName="website"
              placeholder="https://www.exemple.tn" i18n-placeholder="@@settings.company.https.www.exemple.tn.7362c7f7"
              class="w-full">
          </div>
        </p-card>

        <!-- Bank Information -->
        <p-card header="Informations bancaires" i18n-header="@@settings.company.informations.bancaires.1a7496a8" styleClass="form-card bank-card">
          <div class="form-group">
            <label for="bankName" i18n="@@settings.company.nom.de.la.banque.9848ce74">Nom de la banque</label>
            <input 
              pInputText 
              id="bankName" 
              formControlName="bankName"
              placeholder="Ex: Banque Internationale Arabe de Tunisie" i18n-placeholder="@@settings.company.ex.banque.internationale.arabe.de.tunisie.bbdce49b"
              class="w-full">
          </div>

          <div class="form-group">
            <label for="rib" i18n="@@settings.company.rib.61f3ea57">RIB</label>
            <p-inputMask
              id="rib"
              formControlName="rib"
              mask="99 999 9999999999999 99"
              placeholder="XX XXX XXXXXXXXXXXXX XX" i18n-placeholder="@@settings.company.xx.xxx.xxxxxxxxxxxxx.xx.88bae40a"
              styleClass="w-full">
            </p-inputMask>
            <small class="form-hint" i18n="@@settings.company.releve.d.identite.bancaire.a.20.chiffres.604e850f">Relevé d'Identité Bancaire à 20 chiffres</small>
          </div>

          <div class="form-group">
            <label for="iban" i18n="@@settings.company.iban.e81566a5">IBAN</label>
            <input 
              pInputText 
              id="iban" 
              formControlName="iban"
              placeholder="TN59 XXXX XXXX XXXX XXXX XXXX" i18n-placeholder="@@settings.company.tn59.xxxx.xxxx.xxxx.xxxx.xxxx.010b6a21"
              class="w-full">
          </div>
        </p-card>

        <!-- Invoice Settings -->
        <p-card header="Paramètres de facturation" i18n-header="@@settings.company.parametres.de.facturation.b89b8dd4" styleClass="form-card invoice-card">
          <div class="form-group numbering-link">
            <label i18n="@@settings.company.numerotation.des.documents.6857c7f1">Numérotation des documents</label>
            <p class="form-hint" i18n="@@settings.company.configurez.le.format.et.le.debut.de.numerotation.2d1005c7"> Configurez le format et le début de numérotation de vos factures et autres documents. </p>
            <a routerLink="/settings/numbering" class="numbering-settings-link">
              <i class="pi pi-sort-numeric-down"></i>
              Ouvrir les numérotations
            </a>
          </div>

          <div class="form-group">
            <label for="defaultPaymentTerms" i18n="@@settings.company.conditions.de.paiement.par.defaut.3e7f9ec2">Conditions de paiement par défaut</label>
            <textarea 
              pTextarea 
              id="defaultPaymentTerms" 
              formControlName="defaultPaymentTerms"
              placeholder="Ex: Paiement à 30 jours" i18n-placeholder="@@settings.company.ex.paiement.a.30.jours.7b0ae978"
              [rows]="2"
              class="w-full">
            </textarea>
          </div>

          <div class="form-group">
            <label for="invoiceFooter" i18n="@@settings.company.pied.de.page.des.factures.763a451a">Pied de page des factures</label>
            <textarea 
              pTextarea 
              id="invoiceFooter" 
              formControlName="invoiceFooter"
              placeholder="Texte qui apparaîtra en bas de chaque facture" i18n-placeholder="@@settings.company.texte.qui.apparaitra.en.bas.de.chaque.facture.348f766a"
              [rows]="3"
              class="w-full">
            </textarea>
          </div>
        </p-card>

        <p-card header="Espace client" i18n-header="@@settings.company.espace.client.997229dc" styleClass="form-card">
          <div class="form-group">
            <label for="clientPortalEnabled" i18n="@@settings.company.activer.l.espace.client.d7a22239">Activer l’espace client</label>
            <p-inputSwitch inputId="clientPortalEnabled" formControlName="clientPortalEnabled"></p-inputSwitch>
            <small class="form-hint" i18n="@@settings.company.permet.d.inviter.des.contacts.depuis.la.fiche.cl.a5481538">Permet d’inviter des contacts depuis la fiche client pour consulter leurs factures.</small>
          </div>
        </p-card>

        <!-- Stock Configuration -->
        <p-card header="Configuration du Stock" i18n-header="@@settings.company.configuration.du.stock.d42e7f9c" styleClass="form-card stock-card">
          <div class="form-group">
            <label for="warehouseName" i18n="@@settings.company.nom.de.l.entrepot.principal.2f77abf6">Nom de l'entrepôt principal</label>
            <input 
              pInputText 
              id="warehouseName" 
              formControlName="warehouseName"
              placeholder="Entrepôt Principal" i18n-placeholder="@@settings.company.entrepot.principal.3a017cfb"
              class="w-full">
            <small class="form-hint" i18n="@@settings.company.ce.nom.sera.utilise.pour.votre.entrepot.par.defa.fcaa6d42">Ce nom sera utilisé pour votre entrepôt par défaut.</small>
            <small class="form-hint warehouse-link">
              <ng-container i18n="@@settings.company.pour.gerer.plusieurs.entrepots.ou.leurs.adresses.034f4fd9"> Pour gérer plusieurs entrepôts ou leurs adresses, </ng-container>
              <a routerLink="/settings/warehouses" i18n="@@settings.company.ouvrez.la.gestion.des.entrepots.2d309303">ouvrez la gestion des entrepôts</a>.
            </small>
          </div>
        </p-card>
      </div>

      <!-- Actions -->
      <div class="form-actions">
        <p-button 
          label="Annuler" i18n-label="@@settings.company.annuler.49ba3292" 
          icon="pi pi-times" 
          [outlined]="true"
          routerLink="/settings">
        </p-button>
        <p-button 
          type="submit" 
          label="Enregistrer" i18n-label="@@settings.company.enregistrer.f7c8bcd8" 
          icon="pi pi-check"
          [loading]="saving()"
          [disabled]="form.invalid || saving()">
        </p-button>
      </div>
    </form>

    <p-card header="Secteur d'activité" i18n-header="@@settings.company.secteur.d.activite.eb3e69af" styleClass="form-card sector-card" id="secteur">
      @if (sectorLoading()) {
        <div class="loading-container">
          <i class="pi pi-spin pi-spinner" style="font-size: 1.5rem"></i>
          <p i18n="@@settings.company.chargement.du.secteur.89ee32a8">Chargement du secteur...</p>
        </div>
      } @else {
        <p class="form-hint" i18n="@@settings.company.votre.secteur.d.activite.permet.de.recommander.a.3c90238a"> Votre secteur d'activité permet de recommander automatiquement les modules et modèles de documents adaptés à votre métier. Ce changement peut être effectué une fois par jour. </p>
        <div class="form-grid sector-grid">
          <div class="form-group">
            <label for="sectorSegment" i18n="@@settings.company.segment.44986cef">Segment</label>
            <p-select
              inputId="sectorSegment"
              [options]="availableSegments()"
              optionLabel="labelFr"
              optionValue="code"
              [(ngModel)]="selectedSegmentCode"
              [ngModelOptions]="{standalone: true}"
              placeholder="Sélectionnez un segment" i18n-placeholder="@@settings.company.selectionnez.un.segment.fa750c19"
              class="w-full">
            </p-select>
          </div>
          <div class="form-group">
            <label for="sectorDomain" i18n="@@settings.company.domaine.d.activite.2582f8ea">Domaine d'activité</label>
            <p-select
              inputId="sectorDomain"
              [options]="availableDomains()"
              optionLabel="labelFr"
              optionValue="code"
              [(ngModel)]="selectedDomainCode"
              [ngModelOptions]="{standalone: true}"
              placeholder="Sélectionnez un domaine" i18n-placeholder="@@settings.company.selectionnez.un.domaine.3aea32d3"
              class="w-full">
            </p-select>
          </div>
        </div>
        @if (sectorError()) {
          <p class="sector-error" role="alert">
            <i class="pi pi-exclamation-triangle"></i> {{ sectorError() }}
          </p>
        }
        <div class="sector-actions">
          <p-button
            label="Prévisualiser les changements" i18n-label="@@settings.company.previsualiser.les.changements.6df33362"
            icon="pi pi-eye"
            [outlined]="true"
            [disabled]="!isSectorChanged() || sectorPreviewLoading()"
            [loading]="sectorPreviewLoading()"
            (onClick)="previewSectorChange()">
          </p-button>
        </div>
      }
    </p-card>

    <p-dialog
      header="Aperçu du changement de secteur" i18n-header="@@settings.company.apercu.du.changement.de.secteur.50ee52dc"
      [(visible)]="previewDialogVisible"
      [modal]="true"
      [style]="{ width: 'min(480px, 95vw)' }"
      [draggable]="false"
      [dismissableMask]="true">
      @if (sectorPreview(); as preview) {
        <div class="preview-content">
          @if (preview.modulesToEnable.length > 0) {
            <p class="preview-section-title"><i class="pi pi-th-large"></i> Ce changement activera :</p>
            <ul class="preview-list">
              @for (m of preview.modulesToEnable; track m.id) {
                <li>{{ m.labelFr }}</li>
              }
            </ul>
          }
          @if (preview.templates.length > 0) {
            <p class="preview-section-title"><i class="pi pi-file"></i> Modèles pré-remplis :</p>
            <ul class="preview-list">
              @for (t of preview.templates; track t) {
                <li>{{ t }}</li>
              }
            </ul>
          }
          @if (preview.warnings.length > 0) {
            <div class="preview-warnings">
              @for (w of preview.warnings; track w) {
                <p><i class="pi pi-exclamation-triangle"></i> {{ w }}</p>
              }
            </div>
          }
          @if (preview.modulesToEnable.length === 0 && preview.templates.length === 0) {
            <p i18n="@@settings.company.aucun.module.ou.modele.supplementaire.ne.sera.ac.b059f7a6">Aucun module ou modèle supplémentaire ne sera activé.</p>
          }
        </div>
      }
      <div class="dialog-actions">
        <p-button label="Annuler" i18n-label="@@settings.company.annuler.49ba3292" [outlined]="true" severity="secondary" (onClick)="previewDialogVisible = false"></p-button>
        <p-button
          label="Confirmer" i18n-label="@@settings.company.confirmer.80a664c8"
          icon="pi pi-check"
          [loading]="sectorSaving()"
          (onClick)="confirmSectorChange()">
        </p-button>
      </div>
    </p-dialog>
    }

  `,
  styles: [`
    .profile-completion-banner {
      display: flex;
      align-items: flex-start;
      gap: var(--spacing-3);
      background: linear-gradient(135deg, var(--color-primary-50), #fff);
      border: 1px solid var(--color-primary-100);
      border-radius: var(--radius-lg);
      padding: var(--spacing-4);
      margin-bottom: var(--spacing-4);
    }
    .pcb-icon {
      width: 36px;
      height: 36px;
      flex: 0 0 36px;
      border-radius: 9px;
      background: var(--color-primary-100);
      color: var(--color-primary-600);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .pcb-body { flex: 1; min-width: 0; }
    .pcb-title {
      font-size: 0.9rem;
      font-weight: 700;
      color: var(--color-primary-700);
    }
    .pcb-bar {
      height: 6px;
      border-radius: 999px;
      background: var(--color-primary-100);
      margin: 0.5rem 0;
      overflow: hidden;
    }
    .pcb-bar__fill {
      height: 100%;
      border-radius: 999px;
      background: var(--color-primary-600);
      transition: width 400ms ease-out;
    }
    .pcb-text {
      font-size: 0.78rem;
      color: var(--color-neutral-600);
      margin: 0;
    }

    .form-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: var(--spacing-4);

      @media (max-width: 1024px) {
        grid-template-columns: 1fr;
      }
    }

    .bank-card {
      grid-column: 1;
    }

    .invoice-card {
      grid-column: 2;

      @media (max-width: 1024px) {
        grid-column: 1;
      }
    }

    .numbering-link {
      margin-bottom: var(--spacing-4);
    }

    .numbering-settings-link {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-2);
      margin-top: var(--spacing-2);
      color: var(--color-primary-600);
      font-weight: var(--font-weight-medium);
      text-decoration: none;

      &:hover {
        text-decoration: underline;
      }
    }

    .label-with-tag {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-2);
    }

    .stock-card {
      grid-column: 1 / span 2;
    }

    .logo-section {
      display: flex;
      align-items: center;
      gap: var(--spacing-4);
      margin-bottom: var(--spacing-4);
    }

    .logo-preview {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100px;
      height: 100px;
      background: var(--color-neutral-100);
      border: 2px dashed var(--color-neutral-300);
      border-radius: var(--radius-lg);
      overflow: hidden;

      img {
        width: 100%;
        height: 100%;
        object-fit: contain;
      }

      i {
        font-size: 2rem;
        color: var(--color-neutral-400);
      }
    }

    .logo-actions {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);

      small {
        color: var(--color-neutral-500);
        font-size: var(--font-size-xs);
      }
    }

    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--spacing-4);

      @media (max-width: 640px) {
        grid-template-columns: 1fr;
      }
    }

    .form-group {
      margin-bottom: var(--spacing-4);

      &:last-child {
        margin-bottom: 0;
      }

      label {
        display: block;
        margin-bottom: var(--spacing-2);
        font-weight: var(--font-weight-medium);
        color: var(--color-neutral-700);
      }

      .required {
        color: var(--color-error-500);
      }
    }

    .form-hint {
      color: var(--color-neutral-500);
      font-size: var(--font-size-sm);
      margin-top: var(--spacing-1);
      display: block;
    }

    .warehouse-link a {
      color: var(--color-primary-600);
      text-decoration: underline;
      font-weight: var(--font-weight-medium);
    }

    .sector-card {
      margin-top: var(--spacing-4);
    }

    .sector-grid {
      grid-template-columns: repeat(2, 1fr);
      margin-top: var(--spacing-3);

      @media (max-width: 640px) {
        grid-template-columns: 1fr;
      }
    }

    .sector-error {
      color: var(--color-error-600, #dc2626);
      font-size: var(--font-size-sm);
      margin-top: var(--spacing-2);

      i {
        margin-right: var(--spacing-1);
      }
    }

    .sector-actions {
      display: flex;
      justify-content: flex-end;
      margin-top: var(--spacing-4);
    }

    .preview-content {
      .preview-section-title {
        font-weight: var(--font-weight-semibold);
        color: var(--color-neutral-700);
        margin-bottom: var(--spacing-1);

        i {
          margin-right: var(--spacing-1);
        }
      }

      .preview-list {
        margin: 0 0 var(--spacing-3);
        padding-left: var(--spacing-5);
      }

      .preview-warnings {
        p {
          color: var(--color-warning-700, #92400e);
          background: var(--color-warning-50, #fffaf0);
          border: 1px solid var(--color-warning-200, #fbe3b7);
          border-radius: var(--radius-md);
          padding: var(--spacing-2) var(--spacing-3);
          font-size: var(--font-size-sm);
        }
      }
    }

    .dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--spacing-3);
      margin-top: var(--spacing-5);
    }

    .form-actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--spacing-3);
      margin-top: var(--spacing-6);
      padding-top: var(--spacing-6);
      border-top: 1px solid var(--color-neutral-200);
    }

    .loading-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: var(--spacing-8);
      gap: var(--spacing-4);
      color: var(--color-neutral-600);

      p {
        margin: 0;
      }
    }

    .error-banner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--spacing-4);
      margin-bottom: var(--spacing-4);
      background: var(--color-error-50);
      border: 1px solid var(--color-error-200);
      border-radius: var(--radius-md);
      border-left: 4px solid var(--color-error-500);
      animation: slideIn 0.3s ease-out;

      .error-content {
        display: flex;
        align-items: center;
        gap: var(--spacing-3);
        flex: 1;

        .error-icon {
          color: var(--color-error-500);
          font-size: 1.5rem;
        }

        .error-text {
          flex: 1;

          strong {
            display: block;
            color: var(--color-error-700);
            margin-bottom: var(--spacing-1);
          }

          p {
            margin: 0;
            color: var(--color-error-600);
            font-size: var(--font-size-sm);
          }
        }
      }
    }

    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateY(-10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    :host ::ng-deep {
      .form-card {
        .p-card-header {
          padding: var(--spacing-4) var(--spacing-5);
          border-bottom: 1px solid var(--color-neutral-200);
          font-weight: var(--font-weight-semibold);
        }

        .p-card-body {
          padding: var(--spacing-5);
        }
      }

      .p-inputmask,
      .p-select {
        width: 100%;
      }
    }

    // Les champs natifs ne sont PAS couverts par le bloc ::ng-deep ci-dessus : ils
    // vivent dans ce template, pas dans un composant enfant. Sans cette règle ils
    // restent à leur largeur intrinsèque (~185 px) pendant que les p-select et
    // p-inputMask voisins occupent toute la colonne — les « class="w-full" » posées
    // sur eux ne portent rien (Tailwind est préfixé « tw- », cf. tailwind.config.js).
    .form-group > input[pInputText],
    .form-group > textarea[pTextarea] {
      width: 100%;
    }
  `]
})
export class CompanyComponent implements OnInit, OnDestroy {
  private fb = inject(FormBuilder);
  private toastService = inject(ToastService);
  private companyService = inject(CompanyService);
  private stockService = inject(StockService);
  private errorHandler = inject(ErrorHandlerService);
  errorMessageService = inject(ErrorMessageService);
  private sectorService = inject(CompanySectorService);
  private authService = inject(AuthService);

  breadcrumbItems: BreadcrumbItem[] = [
    { label: 'Tableau de bord', route: '/dashboard', icon: 'pi-home' },
    { label: 'Paramètres', route: '/settings' },
    { label: 'Mon entreprise' }
  ];

  saving = signal(false);
  loading = signal(false);
  logoUrl = signal<string | null>(null);
  errorMessage = signal<string | null>(null);
  isRateLimited = signal(false);
  defaultWarehouseId = signal<string | null>(null);

  /** Raw company data from the API — used to compute profile completion (plan §3.5). */
  company = signal<Company | null>(null);
  /** Profile completion percentage (plan §3.5) — 0–100, rounded. */
  profileCompletionPct = computed(() => computeCompanyProfileCompletion(this.company()));

  // Secteur d'activité (plan v1 §2.3)
  sectorLoading = signal(false);
  sectorSaving = signal(false);
  sectorPreviewLoading = signal(false);
  sectorError = signal<string | null>(null);
  availableSegments = signal<SectorOptionDto[]>([]);
  availableDomains = signal<SectorOptionDto[]>([]);
  currentSegmentCode = signal<string | null>(null);
  currentDomainCode = signal<string | null>(null);
  selectedSegmentCode: string | null = null;
  selectedDomainCode: string | null = null;
  previewDialogVisible = false;
  sectorPreview = signal<CompanySectorPreviewResponse | null>(null);

  // Protection against multiple simultaneous requests
  private isLoadingInProgress = false;
  private lastToastTime = 0;
  private readonly ERROR_DEBOUNCE_MS = 2000; // 2 seconds between error toasts

  // Subject pour nettoyer les subscriptions
  private destroy$ = new Subject<void>();

  taxRegimes = [
    { label: 'Régime réel', value: 0 },
    { label: 'Régime forfaitaire', value: 1 },
    { label: 'Exonéré', value: 2 }
  ];

  governorates = TUNISIAN_GOVERNORATE_OPTIONS;

  form: FormGroup = this.fb.group({
    companyName: ['', Validators.required],
    tradeName: [''],
    nif: ['', Validators.required],
    commerceRegistry: [''],
    taxRegime: [0, Validators.required],
    street: ['', Validators.required],
    streetLine2: [''],
    postalCode: [''],
    city: ['', Validators.required],
    governorate: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    phone: ['', Validators.required],
    website: [''],
    bankName: [''],
    rib: [''],
    iban: [''],
    cnssEmployerNumber: [''],
    defaultPaymentTerms: ['Paiement à 30 jours'],
    invoiceFooter: [''],
    warehouseName: [''],
    clientPortalEnabled: [true]
  });

  ngOnInit(): void {
    this.loadCompanyData();
    this.loadSector();
  }

  ngOnDestroy(): void {
    // Nettoyer toutes les subscriptions
    this.destroy$.next();
    this.destroy$.complete();
  }

  isInvalid(field: string): boolean {
    const control = this.form.get(field);
    return !!(control?.invalid && control?.touched);
  }

  onLogoSelect(event: any): void {
    const file = event.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        this.logoUrl.set(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  }

  /**
   * Nettoie et ramène le NIF au blur vers la forme carte.
   * Ex: 1234567/A/B/C/000 → 1234567A/B/C/000
   */
  onNifBlur(): void {
    const nifControl = this.form.get('nif');
    if (nifControl) {
      const currentValue = nifControl.value || '';
      const cleaned = canonicalizeNif(currentValue);
      if (cleaned !== currentValue) {
        nifControl.setValue(cleaned, { emitEvent: false });
        nifControl.updateValueAndValidity({ emitEvent: false });
        nifControl.markAsTouched();
      } else if (cleaned) {
        nifControl.updateValueAndValidity({ emitEvent: false });
      }
    }
  }

  loadCompanyData(): void {
    // Prevent multiple simultaneous requests
    if (this.isLoadingInProgress) {
      return;
    }

    this.isLoadingInProgress = true;
    this.loading.set(true);
    this.errorMessage.set(null);
    this.isRateLimited.set(false);

    this.companyService.getCompany().pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          const company = response.data;
          this.company.set(company);

          // Format phone number for display (add spaces)
          const phoneFormatted = company.phone.length === 8
            ? `${company.phone.substring(0, 2)} ${company.phone.substring(2, 5)} ${company.phone.substring(5)}`
            : company.phone;

          this.form.patchValue({
            companyName: company.companyName,
            tradeName: company.tradeName || '',
            nif: company.nif,
            commerceRegistry: company.commerceRegistry || '',
            taxRegime: company.taxRegime,
            street: company.address.street,
            streetLine2: company.address.streetLine2 || '',
            postalCode: company.address.postalCode || '',
            city: company.address.city,
            governorate: company.address.governorate,
            email: company.email,
            phone: phoneFormatted,
            website: company.website || '',
            bankName: company.bankName || '',
            rib: company.rib || '',
            iban: company.iban || '',
            cnssEmployerNumber: company.cnssEmployerNumber || '',
            defaultPaymentTerms: company.defaultPaymentTerms || 'Paiement à 30 jours',
            invoiceFooter: company.invoiceFooter || '',
            clientPortalEnabled: company.clientPortalEnabled ?? true
          });

          const warehouseName = company.warehouseName?.trim();
          if (warehouseName) {
            this.form.patchValue({
              warehouseName
            });
          }

          if (company.logoUrl) {
            this.logoUrl.set(company.logoUrl);
          }
        } else {
          const errorMsg = response.errors?.join(', ') || 'Impossible de charger les informations de l\'entreprise';
          this.errorMessage.set(errorMsg);
          this.showErrorToast('Erreur', errorMsg);
        }
        this.isLoadingInProgress = false;
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.isLoadingInProgress = false;
        this.loading.set(false);

        // Handle rate limiting specifically
        // Note: Le service gère déjà les retries automatiques (3 tentatives avec backoff exponentiel)
        // On ne fait pas de retry supplémentaire ici pour éviter les boucles infinies
        if (err.status === 429) {
          this.isRateLimited.set(true);
          const errorMsg = 'Trop de requêtes. Veuillez patienter avant de réessayer.';
          this.errorMessage.set(errorMsg);
          // Ne pas afficher de toast ici car l'intercepteur le gère déjà
          // Le composant affiche juste le message inline
        } else {
          const errorMessage = this.errorHandler.extractErrorMessage(err) ||
            'Une erreur est survenue lors du chargement des informations';
          this.errorMessage.set(errorMessage);
          this.showErrorToast('Erreur', errorMessage);
        }
        this.errorHandler.logError('Failed to load company data', err);
      }
    });

    // Load default warehouse
    this.stockService.getWarehouses(true).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          const defaultWarehouse = response.data.find(w => w.isDefault);
          if (defaultWarehouse) {
            this.defaultWarehouseId.set(defaultWarehouse.id);
            this.form.patchValue({
              warehouseName: defaultWarehouse.name
            });
          }
        }
      },
      error: (err) => {
        console.error('Failed to load warehouses', err);
      }
    });
  }

  private showErrorToast(summary: string, detail: string): void {
    const now = Date.now();
    // Debounce toast notifications to prevent spamming
    if (now - this.lastToastTime < this.ERROR_DEBOUNCE_MS) {
      return;
    }
    this.lastToastTime = now;

    this.toastService.add({
      severity: 'error',
      summary,
      detail,
      life: 5000
    });
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.saving.set(true);

    const formValue = this.form.value;

    // Remove spaces from phone number (backend expects 8 digits without spaces)
    const phoneCleaned = formValue.phone?.replace(/\s/g, '') || '';

    const nifSource = formValue.nif ?? this.form.get('nif')?.value ?? '';
    const nifCleaned = canonicalizeNif(nifSource) || String(nifSource).trim();

    const request: UpdateCompanyRequest = {
      companyName: (formValue.companyName || '').trim(),
      tradeName: formValue.tradeName?.trim() || null,
      nif: nifCleaned,
      commerceRegistry: formValue.commerceRegistry?.trim() || null,
      taxRegime: formValue.taxRegime ?? 0,
      street: (formValue.street || '').trim(),
      streetLine2: formValue.streetLine2?.trim() || null,
      city: (formValue.city || '').trim(),
      postalCode: formValue.postalCode?.trim() || null,
      governorate: typeof formValue.governorate === 'string'
        ? formValue.governorate.trim()
        : (formValue.governorate?.value || '').trim(),
      email: (formValue.email || '').trim(),
      phone: phoneCleaned,
      website: formValue.website?.trim() || null,
      logoUrl: this.logoUrl() || null,
      bankName: formValue.bankName?.trim() || null,
      rib: formValue.rib?.trim() || null,
      iban: formValue.iban?.trim() || null,
      cnssEmployerNumber: formValue.cnssEmployerNumber?.trim() || null,
      defaultPaymentTerms: formValue.defaultPaymentTerms?.trim() || null,
      invoiceFooter: formValue.invoiceFooter?.trim() || null,
      clientPortalEnabled: !!formValue.clientPortalEnabled
    };

    this.companyService.updateCompany(request).pipe(
      takeUntil(this.destroy$)
    ).subscribe({
      next: (response) => {
        if (response.success) {
          this.toastService.add({
            severity: 'success',
            summary: $localize`:@@company.component.summary.Succès:Succès`,
            detail: response.message || 'Informations de l\'entreprise mises à jour',
            life: 3000
          });

          // Invalider le cache pour forcer un refresh lors du prochain chargement
          this.companyService.invalidateCache();

          // Cela évite une requête supplémentaire qui pourrait déclencher un rate limit

          // Update warehouse if changed
          const warehouseName = formValue.warehouseName?.trim();
          const defaultId = this.defaultWarehouseId();

          if (defaultId && warehouseName) {
            this.stockService.updateWarehouse(defaultId, {
              id: defaultId,
              name: warehouseName,
              isDefault: true
            }).pipe(
              takeUntil(this.destroy$)
            ).subscribe({
              error: (err) => {
                console.error('Failed to update warehouse', err);
                this.showErrorToast('Attention', 'Entreprise mise à jour mais erreur lors de la mise à jour de l\'entrepôt');
              }
            });
          }

          this.saving.set(false);
        } else {
          const errorMsg = response.errors?.join(', ') || 'Une erreur est survenue lors de la mise à jour';
          this.errorMessage.set(errorMsg);
          this.showErrorToast('Erreur', errorMsg);
        }
        this.saving.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);

        // Handle rate limiting specifically
        // Note: Le service gère déjà les retries automatiques (3 tentatives avec backoff exponentiel)
        // On ne fait pas de retry supplémentaire ici pour éviter les boucles infinies
        if (err.status === 429) {
          this.isRateLimited.set(true);
          const errorMsg = 'Trop de requêtes. Veuillez patienter avant de réessayer.';
          this.errorMessage.set(errorMsg);
          // Ne pas afficher de toast ici car l'intercepteur le gère déjà
          // Le composant affiche juste le message inline
        } else {
          const errorMessage = this.errorHandler.extractErrorMessage(err) ||
            'Une erreur est survenue lors de la mise à jour';
          this.errorMessage.set(errorMessage);
          this.showErrorToast('Erreur', errorMessage);
        }
        this.errorHandler.logError('Failed to update company', err);
      }
    });
  }

  // --- Secteur d'activité (plan v1 §2.3) ---

  loadSector(): void {
    this.sectorLoading.set(true);
    this.sectorError.set(null);

    this.sectorService.getSector().pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.sectorLoading.set(false);
        if (res.success && res.data) {
          this.availableSegments.set(res.data.availableSegments || []);
          this.availableDomains.set(res.data.availableDomains || []);
          this.currentSegmentCode.set(res.data.companySegment);
          this.currentDomainCode.set(res.data.businessDomain);
          this.selectedSegmentCode = res.data.companySegment;
          this.selectedDomainCode = res.data.businessDomain;
        } else {
          this.sectorError.set(res.message || 'Impossible de charger le secteur d\'activité.');
        }
      },
      error: (err: HttpErrorResponse) => {
        this.sectorLoading.set(false);
        this.sectorError.set(this.errorHandler.extractErrorMessage(err));
      }
    });
  }

  isSectorChanged(): boolean {
    return (
      !!this.selectedSegmentCode &&
      !!this.selectedDomainCode &&
      (this.selectedSegmentCode !== this.currentSegmentCode() ||
        this.selectedDomainCode !== this.currentDomainCode())
    );
  }

  previewSectorChange(): void {
    if (!this.isSectorChanged() || this.sectorPreviewLoading()) {
      return;
    }

    this.sectorPreviewLoading.set(true);
    this.sectorError.set(null);

    this.sectorService
      .previewSector({
        companySegment: this.selectedSegmentCode!,
        businessDomain: this.selectedDomainCode!
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sectorPreviewLoading.set(false);
          if (res.success && res.data) {
            this.sectorPreview.set(res.data);
            this.previewDialogVisible = true;
          } else {
            this.showErrorToast('Erreur', res.message || 'Impossible de prévisualiser ce changement.');
          }
        },
        error: (err: HttpErrorResponse) => {
          this.sectorPreviewLoading.set(false);
          this.showErrorToast('Erreur', this.errorHandler.extractErrorMessage(err));
        }
      });
  }

  confirmSectorChange(): void {
    if (!this.selectedSegmentCode || !this.selectedDomainCode || this.sectorSaving()) {
      return;
    }

    this.sectorSaving.set(true);

    this.sectorService
      .applySector({
        companySegment: this.selectedSegmentCode,
        businessDomain: this.selectedDomainCode
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.sectorSaving.set(false);
          this.previewDialogVisible = false;

          if (!res.success || !res.data) {
            this.showErrorToast('Erreur', res.message || 'Impossible de mettre à jour le secteur d\'activité.');
            return;
          }

          this.currentSegmentCode.set(res.data.companySegment);
          this.currentDomainCode.set(res.data.businessDomain);

          // La navigation/le tableau de bord doivent refléter les nouveaux modules
          // immédiatement, sans relogin (plan 1.3/2.3).
          this.authService.refreshUserProfile().pipe(takeUntil(this.destroy$)).subscribe();

          const warnings = (res.data.warnings || []).filter(w => !!w?.trim());
          if (warnings.length > 0) {
            this.toastService.add({
              severity: 'warn',
              summary: $localize`:@@company.component.summary.Secteur_mis_jo:Secteur mis à jour avec avertissements`,
              detail: warnings.join(' '),
              life: 8000
            });
          } else {
            this.toastService.add({
              severity: 'success',
              summary: $localize`:@@company.component.summary.Secteur_d_activi:Secteur d'activité mis à jour`,
              detail: $localize`:@@company.component.detail.Vos_recommandati:Vos recommandations de modules ont été actualisées.`
            });
          }
        },
        error: (err: HttpErrorResponse) => {
          this.sectorSaving.set(false);
          this.showErrorToast('Erreur', this.errorHandler.extractErrorMessage(err));
        }
      });
  }
}
