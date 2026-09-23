import { Component, HostListener, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Subscription } from 'rxjs';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { FirmManagedClientsService, CreateFirmManagedClient, FirmManagedClientCreated } from '@core/services/firm-managed-clients.service';
import { FirmGovernanceService, FirmAssignableAccountant } from '@core/services/firm-governance.service';
import { FirmContextService } from '@core/services/firm-context.service';
import { ToastService } from '@core/services/toast.service';
import { canonicalizeNif, TUNISIAN_GOVERNORATE_OPTIONS } from '@shared/validation/validation-rules';
import { TunisianValidators } from '@shared/validation/tunisian-validators';
import {
  ProvisioningStep,
  applyRunningSchedule,
  completeProvisioningSteps,
  createInitialProvisioningSteps,
  failProvisioningSteps,
  scheduleProvisioningProgress
} from './managed-client-provisioning-progress';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { InputNumberModule } from 'primeng/inputnumber';
import { DatePickerModule } from 'primeng/datepicker';
import { Textarea } from 'primeng/textarea';
import { TagModule } from 'primeng/tag';
import { ProgressBarModule } from 'primeng/progressbar';

interface StepDef {
  id: number;
  label: string;
}

interface Option<T> {
  label: string;
  value: T;
}

const MONTH_OPTIONS: Option<number>[] = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
].map((label, i) => ({ label, value: i + 1 }));

@Component({
  selector: 'app-firm-managed-client-wizard',
  standalone: true,
  imports: [
    CommonModule, RouterModule, ReactiveFormsModule, PageHeaderComponent,
    ButtonModule, InputTextModule, SelectModule, InputNumberModule,
    DatePickerModule, Textarea, TagModule, ProgressBarModule
  ],
  template: `
    <app-page-header
      title="Nouveau dossier client"
      subtitle="Créez et gérez la comptabilité d'un client sans compte sur la plateforme">
      @if (!saving() && !created()) {
        <a routerLink="/firm/clients" pButton label="Annuler" class="p-button-text p-button-sm" icon="pi pi-arrow-left"></a>
      }
    </app-page-header>

    @if (created(); as result) {
      <div class="mc-card mc-success">
        <i class="pi pi-check-circle mc-success-icon"></i>
        <h2>Dossier « {{ result.companyName }} » créé</h2>
        <p>
          La base comptable est provisionnée (plan comptable tunisien et journaux préinstallés),
          l'affectation cabinet est active et le dossier permanent est pré-rempli.
        </p>
        <div class="mc-success-actions">
          <button type="button" pButton label="Ouvrir la comptabilité" icon="pi pi-folder-open"
            [loading]="opening()" (click)="openAccounting(result)"></button>
          <a routerLink="/firm/clients" pButton label="Mes dossiers clients" icon="pi pi-briefcase"
            class="p-button-outlined"></a>
          <a routerLink="/firm/governance/permanent-files" pButton label="Dossiers permanents" icon="pi pi-book"
            class="p-button-text"></a>
        </div>
      </div>
    } @else if (provisioningPhase() === 'running' || provisioningPhase() === 'error') {
      <div class="mc-card mc-provisioning" role="status" aria-live="polite">
        <div class="mc-prov-header">
          @if (provisioningPhase() === 'running') {
            <i class="pi pi-spin pi-spinner mc-prov-spinner" aria-hidden="true"></i>
            <h2>Création du dossier « {{ provisioningCompanyName() }} »…</h2>
          } @else {
            <i class="pi pi-times-circle mc-prov-error-icon" aria-hidden="true"></i>
            <h2>Création interrompue</h2>
          }
        </div>

        <p class="mc-prov-label">{{ progressLabel() }}</p>
        <p-progressBar [value]="progressPercent()" [showValue]="true" styleClass="mc-prov-bar" />
        <p class="mc-prov-elapsed">{{ elapsedSeconds() }} s écoulées</p>

        <ul class="mc-prov-steps">
          @for (s of provisioningSteps(); track s.id) {
            <li [class.mc-prov-step--done]="s.status === 'done'"
                [class.mc-prov-step--running]="s.status === 'running'"
                [class.mc-prov-step--error]="s.status === 'error'"
                [class.mc-prov-step--pending]="s.status === 'pending'">
              <span class="mc-prov-step-icon" aria-hidden="true">
                @if (s.status === 'done') { <i class="pi pi-check"></i> }
                @else if (s.status === 'running') { <i class="pi pi-spin pi-spinner"></i> }
                @else if (s.status === 'error') { <i class="pi pi-times"></i> }
                @else { <i class="pi pi-circle"></i> }
              </span>
              <span>{{ s.label }}</span>
            </li>
          }
        </ul>

        @if (provisioningPhase() === 'running') {
          <p class="mc-prov-hint">
            Cela peut prendre environ une minute. Ne quittez pas cette page.
            La progression est une estimation pendant la préparation de la base comptable.
          </p>
        } @else {
          <p class="mc-prov-error-msg">{{ provisioningError() }}</p>
          <div class="mc-prov-actions">
            <button type="button" pButton label="Réessayer" icon="pi pi-refresh"
              (click)="retryCreate()"></button>
            <button type="button" pButton label="Retour au récapitulatif" icon="pi pi-arrow-left"
              class="p-button-outlined" (click)="returnToRecap()"></button>
          </div>
        }
      </div>
    } @else {
      <div class="mc-steps">
        @for (s of steps; track s.id) {
          <button type="button" class="mc-step"
            [class.mc-step--active]="step() === s.id"
            [class.mc-step--done]="step() > s.id"
            [disabled]="saving()"
            (click)="goTo(s.id)">
            <span class="mc-step-index">
              @if (step() > s.id) { <i class="pi pi-check"></i> } @else { {{ s.id }} }
            </span>
            <span class="mc-step-label">{{ s.label }}</span>
          </button>
          @if (s.id < steps.length) { <span class="mc-step-sep"></span> }
        }
      </div>

      <div class="mc-layout">
        <div class="mc-card mc-main">
          <!-- Étape 1 : Informations générales -->
          @if (step() === 1) {
            <h3 class="mc-section-title">Informations générales</h3>
            <form [formGroup]="generalForm" class="mc-grid">
              <div class="mc-field mc-col-2">
                <label>Raison sociale <span class="req">*</span></label>
                <input pInputText formControlName="companyName" maxlength="200" placeholder="Société Exemple SARL" />
              </div>
              <div class="mc-field">
                <label>Matricule fiscal (NIF) <span class="req">*</span></label>
                <input pInputText formControlName="nif" placeholder="1772793W/A/M/000" (blur)="canonicalizeNifField()" />
              </div>
              <div class="mc-field">
                <label>Forme juridique</label>
                <p-select formControlName="legalForm" [options]="legalFormOptions" optionLabel="label" optionValue="value"
                  placeholder="Sélectionner" [showClear]="true" styleClass="w-full" appendTo="body" />
              </div>
              <div class="mc-field">
                <label>Identifiant RNE</label>
                <input pInputText formControlName="rneIdentifier" maxlength="50" />
              </div>
              <div class="mc-field">
                <label>Date de constitution</label>
                <p-datepicker formControlName="incorporationDate" dateFormat="dd/mm/yy" [showIcon]="true" appendTo="body" styleClass="w-full" />
              </div>
              <div class="mc-field">
                <label>Capital social (TND)</label>
                <p-inputNumber formControlName="shareCapital" mode="decimal" [minFractionDigits]="0" [maxFractionDigits]="3" styleClass="w-full" />
              </div>
              <div class="mc-field mc-col-2">
                <label>Adresse <span class="req">*</span></label>
                <input pInputText formControlName="street" maxlength="200" placeholder="Rue, avenue…" />
              </div>
              <div class="mc-field mc-col-2">
                <label>Complément d'adresse</label>
                <input pInputText formControlName="streetLine2" maxlength="200" />
              </div>
              <div class="mc-field">
                <label>Code postal</label>
                <input pInputText formControlName="postalCode" maxlength="20" />
              </div>
              <div class="mc-field">
                <label>Ville <span class="req">*</span></label>
                <input pInputText formControlName="city" maxlength="100" />
              </div>
              <div class="mc-field">
                <label>Gouvernorat <span class="req">*</span></label>
                <p-select formControlName="governorate" [options]="governorateOptions" optionLabel="label" optionValue="value"
                  placeholder="Sélectionner" [filter]="true" styleClass="w-full" appendTo="body" />
              </div>
              <div class="mc-field">
                <label>Téléphone <span class="req">*</span></label>
                <input pInputText formControlName="phone" placeholder="+216 71 123 456" />
              </div>
              <div class="mc-field">
                <label>Email</label>
                <input pInputText formControlName="email" placeholder="contact@exemple.com" />
              </div>
              <div class="mc-field">
                <label>Site web</label>
                <input pInputText formControlName="website" />
              </div>
            </form>
          }

          <!-- Étape 2 : Options comptables -->
          @if (step() === 2) {
            <h3 class="mc-section-title">Options comptables</h3>
            <div class="mc-info">
              <i class="pi pi-info-circle"></i>
              <div>
                Le <strong>Plan Comptable Tunisien</strong> et les journaux standards
                (achats, ventes, banque, caisse, opérations diverses) sont préinstallés
                automatiquement à la création du dossier.
              </div>
            </div>
            <form [formGroup]="accountingForm" class="mc-grid">
              <div class="mc-field">
                <label>Début d'exercice <span class="req">*</span></label>
                <p-select formControlName="fiscalYearStartMonth" [options]="monthOptions" optionLabel="label" optionValue="value"
                  styleClass="w-full" appendTo="body" />
              </div>
              <div class="mc-field">
                <label>Fin d'exercice <span class="req">*</span></label>
                <p-select formControlName="fiscalYearEndMonth" [options]="monthOptions" optionLabel="label" optionValue="value"
                  styleClass="w-full" appendTo="body" />
              </div>
              <div class="mc-field">
                <label>Premier exercice géré <span class="req">*</span></label>
                <p-inputNumber formControlName="firstFiscalYear" [useGrouping]="false" [min]="2000" [max]="2100" styleClass="w-full" />
              </div>
              <div class="mc-field">
                <label>Devise</label>
                <input pInputText value="TND — Dinar Tunisien" disabled />
              </div>
            </form>
          }

          <!-- Étape 3 : Options fiscales et sociales -->
          @if (step() === 3) {
            <h3 class="mc-section-title">Options fiscales et sociales</h3>
            <form [formGroup]="fiscalForm" class="mc-grid">
              <div class="mc-field">
                <label>Régime fiscal <span class="req">*</span></label>
                <p-select formControlName="taxRegime" [options]="taxRegimeOptions" optionLabel="label" optionValue="value"
                  styleClass="w-full" appendTo="body" />
              </div>
              <div class="mc-field">
                <label>Bureau de contrôle (recette)</label>
                <input pInputText formControlName="taxOffice" maxlength="200" />
              </div>
              <div class="mc-field">
                <label>Taux d'IS (%)</label>
                <p-inputNumber formControlName="isStandardRate" mode="decimal" [minFractionDigits]="0" [maxFractionDigits]="2"
                  [min]="0" [max]="100" placeholder="Défaut légal de l'exercice" styleClass="w-full" />
              </div>
              <div class="mc-field"></div>
              <div class="mc-field">
                <label>Taux CNSS salarial (%)</label>
                <p-inputNumber formControlName="cnssEmployeeRate" mode="decimal" [minFractionDigits]="0" [maxFractionDigits]="2"
                  [min]="0" [max]="100" placeholder="Ex. 9,18" styleClass="w-full" />
              </div>
              <div class="mc-field">
                <label>Taux CNSS patronal (%)</label>
                <p-inputNumber formControlName="cnssEmployerRate" mode="decimal" [minFractionDigits]="0" [maxFractionDigits]="2"
                  [min]="0" [max]="100" placeholder="Ex. 16,57" styleClass="w-full" />
              </div>
              <div class="mc-field">
                <label>Honoraires annuels (TND)</label>
                <p-inputNumber formControlName="annualFeeAmount" mode="decimal" [minFractionDigits]="0" [maxFractionDigits]="3"
                  [min]="0" styleClass="w-full" />
              </div>
              <div class="mc-field">
                <label>Périodicité des honoraires</label>
                <p-select formControlName="billingFrequency" [options]="billingFrequencyOptions" optionLabel="label" optionValue="value"
                  placeholder="Sélectionner" [showClear]="true" styleClass="w-full" appendTo="body" />
              </div>
              <div class="mc-field mc-col-2">
                <label>Notes de facturation</label>
                <textarea pTextarea formControlName="billingNotes" rows="2" maxlength="500"></textarea>
              </div>
            </form>
            <div class="mc-info mc-info--muted">
              <i class="pi pi-info-circle"></i>
              <div>
                Les taux laissés vides utilisent les défauts légaux de l'exercice ; ils restent
                modifiables depuis l'écran « Paramètres fiscaux » du dossier.
              </div>
            </div>
          }

          <!-- Étape 4 : Paramètres & récapitulatif -->
          @if (step() === 4) {
            <h3 class="mc-section-title">Paramètres et récapitulatif</h3>
            <form [formGroup]="settingsForm" class="mc-grid">
              <div class="mc-field">
                <label>Gestionnaire du dossier</label>
                <p-select formControlName="assignedAccountantUserId" [options]="accountantOptions()" optionLabel="label" optionValue="value"
                  placeholder="Affecter plus tard" [showClear]="true" styleClass="w-full" appendTo="body" />
              </div>
              <div class="mc-field mc-col-2">
                <label>Notes internes</label>
                <textarea pTextarea formControlName="notes" rows="2" maxlength="1000"></textarea>
              </div>
            </form>

            <h4 class="mc-recap-title">Récapitulatif complet</h4>
            <dl class="mc-recap-dl">
              <dt>Raison sociale</dt><dd>{{ generalForm.value.companyName || '—' }}</dd>
              <dt>NIF</dt><dd>{{ generalForm.value.nif || '—' }}</dd>
              <dt>Forme juridique</dt><dd>{{ legalFormLabel(generalForm.value.legalForm) }}</dd>
              <dt>Adresse</dt><dd>{{ recapAddress() }}</dd>
              <dt>Contact</dt><dd>{{ generalForm.value.phone }} · {{ generalForm.value.email }}</dd>
              <dt>Exercice</dt><dd>{{ recapExercice() }}</dd>
              <dt>Régime fiscal</dt><dd>{{ taxRegimeLabel(fiscalForm.value.taxRegime) }}</dd>
              <dt>Taux IS</dt><dd>{{ fiscalForm.value.isStandardRate != null ? fiscalForm.value.isStandardRate + ' %' : 'Défaut légal' }}</dd>
              <dt>CNSS</dt>
              <dd>
                {{ fiscalForm.value.cnssEmployeeRate != null || fiscalForm.value.cnssEmployerRate != null
                  ? (fiscalForm.value.cnssEmployeeRate ?? '—') + ' % / ' + (fiscalForm.value.cnssEmployerRate ?? '—') + ' %'
                  : 'Défauts légaux' }}
              </dd>
              <dt>Honoraires</dt><dd>{{ recapBilling() }}</dd>
              <dt>Gestionnaire</dt><dd>{{ accountantLabel(settingsForm.value.assignedAccountantUserId) }}</dd>
            </dl>
          }

          <div class="mc-nav">
            @if (step() > 1) {
              <button type="button" pButton label="Précédent" icon="pi pi-arrow-left" class="p-button-outlined"
                [disabled]="saving()" (click)="previous()"></button>
            }
            <span class="mc-nav-spacer"></span>
            @if (step() < 4) {
              <button type="button" pButton label="Suivant" icon="pi pi-arrow-right" iconPos="right"
                [disabled]="saving()" (click)="next()"></button>
            } @else {
              <button type="button" pButton label="Créer le dossier" icon="pi pi-check"
                [loading]="saving()" (click)="create()"></button>
            }
          </div>
        </div>

        <!-- Panneau récapitulatif latéral (type Sage) -->
        <aside class="mc-card mc-side">
          <h4><i class="pi pi-file"></i> Récapitulatif du dossier</h4>
          <dl class="mc-recap-dl">
            <dt>Nom du dossier</dt><dd>{{ generalForm.value.companyName || '—' }}</dd>
            <dt>Matricule fiscal</dt><dd>{{ generalForm.value.nif || '—' }}</dd>
            <dt>Exercice comptable</dt><dd>{{ recapExercice() }}</dd>
            <dt>Devise</dt><dd>Dinar Tunisien (TND)</dd>
            <dt>Plan comptable</dt><dd>Plan Comptable Tunisien</dd>
            <dt>Régime d'imposition</dt><dd>{{ taxRegimeLabel(fiscalForm.value.taxRegime) }}</dd>
          </dl>
          <div class="mc-side-note">
            <p-tag value="Géré par le cabinet" severity="info" />
            <p>
              Ce client n'a pas de compte sur la plateforme : seul votre cabinet
              accède à sa comptabilité.
            </p>
          </div>
        </aside>
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .mc-card {
      background: var(--color-surface, #fff);
      border: 1px solid var(--color-border-subtle, #e2e8f0);
      border-radius: var(--radius-xl, 16px);
      box-shadow: var(--shadow-soft-sm, 0 1px 2px rgba(15, 23, 42, 0.05));
      padding: 1.25rem;
    }
    .mc-steps {
      display: flex; align-items: center; gap: 0.5rem;
      margin-bottom: 1rem; flex-wrap: wrap;
    }
    .mc-step {
      display: inline-flex; align-items: center; gap: 0.5rem;
      background: transparent; border: none; cursor: pointer;
      padding: 0.35rem 0.5rem; border-radius: 8px;
      color: var(--color-text-muted, #64748b); font-size: 0.9rem;
    }
    .mc-step:disabled { opacity: 0.55; cursor: not-allowed; }
    .mc-step-index {
      display: inline-flex; align-items: center; justify-content: center;
      width: 1.7rem; height: 1.7rem; border-radius: 50%;
      border: 2px solid var(--color-border-subtle, #cbd5e1);
      font-weight: 600; font-size: 0.8rem;
    }
    .mc-step--active { color: var(--color-primary-700, #1d4ed8); font-weight: 600; }
    .mc-step--active .mc-step-index {
      border-color: var(--color-primary-600, #2563eb);
      background: var(--color-primary-600, #2563eb); color: #fff;
    }
    .mc-step--done { color: var(--color-success-600, #16a34a); }
    .mc-step--done .mc-step-index {
      border-color: var(--color-success-600, #16a34a);
      background: var(--color-success-600, #16a34a); color: #fff;
    }
    .mc-step-sep { flex: 0 0 24px; height: 2px; background: var(--color-border-subtle, #e2e8f0); }
    .mc-layout { display: grid; grid-template-columns: 1fr 300px; gap: 1rem; align-items: start; }
    @media (max-width: 960px) { .mc-layout { grid-template-columns: 1fr; } }
    .mc-section-title { margin: 0 0 1rem; font-size: 1.05rem; }
    .mc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.85rem 1rem; }
    @media (max-width: 720px) { .mc-grid { grid-template-columns: 1fr; } }
    .mc-col-2 { grid-column: span 2; }
    @media (max-width: 720px) { .mc-col-2 { grid-column: span 1; } }
    .mc-field { display: flex; flex-direction: column; gap: 0.3rem; }
    .mc-field label { font-size: 0.83rem; font-weight: 500; color: var(--color-text-muted, #475569); }
    .mc-field .req { color: var(--color-danger-600, #dc2626); }
    .mc-field input, .mc-field textarea { width: 100%; }
    .mc-info {
      display: flex; gap: 0.6rem; align-items: flex-start;
      background: var(--color-primary-50, #eff6ff);
      border: 1px solid var(--color-primary-200, #bfdbfe);
      border-radius: 10px; padding: 0.75rem 0.9rem;
      margin-bottom: 1rem; font-size: 0.88rem;
    }
    .mc-info i { color: var(--color-primary-600, #2563eb); margin-top: 2px; }
    .mc-info--muted { background: var(--color-surface-muted, #f8fafc); border-color: var(--color-border-subtle, #e2e8f0); margin-top: 1rem; }
    .mc-info--muted i { color: var(--color-text-muted, #64748b); }
    .mc-nav { display: flex; align-items: center; margin-top: 1.5rem; gap: 0.5rem; }
    .mc-nav-spacer { flex: 1; }
    .mc-side h4 { display: flex; align-items: center; gap: 0.5rem; margin: 0 0 0.75rem; font-size: 0.95rem; }
    .mc-recap-title { margin: 1.5rem 0 0.5rem; font-size: 0.95rem; }
    .mc-recap-dl {
      display: grid; grid-template-columns: auto 1fr; gap: 0.35rem 0.9rem;
      margin: 0; font-size: 0.86rem;
    }
    .mc-recap-dl dt { color: var(--color-text-muted, #64748b); }
    .mc-recap-dl dd { margin: 0; font-weight: 500; overflow-wrap: anywhere; }
    .mc-side-note { margin-top: 1rem; font-size: 0.82rem; color: var(--color-text-muted, #64748b); }
    .mc-side-note p { margin: 0.5rem 0 0; }
    .mc-success { text-align: center; padding: 2.5rem 1.5rem; }
    .mc-success-icon { font-size: 3rem; color: var(--color-success-600, #16a34a); }
    .mc-success h2 { margin: 0.75rem 0 0.4rem; }
    .mc-success p { color: var(--color-text-muted, #64748b); max-width: 560px; margin: 0 auto; }
    .mc-success-actions { display: flex; justify-content: center; gap: 0.6rem; margin-top: 1.5rem; flex-wrap: wrap; }

    .mc-provisioning { max-width: 640px; margin: 0 auto; padding: 2rem 1.75rem; }
    .mc-prov-header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem; }
    .mc-prov-header h2 { margin: 0; font-size: 1.15rem; }
    .mc-prov-spinner { font-size: 1.5rem; color: var(--color-primary-600, #2563eb); }
    .mc-prov-error-icon { font-size: 1.5rem; color: var(--color-danger-600, #dc2626); }
    .mc-prov-label { margin: 0 0 0.65rem; font-weight: 500; color: var(--color-text-muted, #475569); }
    :host ::ng-deep .mc-prov-bar { height: 1.1rem; margin-bottom: 0.4rem; }
    .mc-prov-elapsed { margin: 0 0 1.25rem; font-size: 0.85rem; color: var(--color-text-muted, #64748b); }
    .mc-prov-steps { list-style: none; margin: 0 0 1.25rem; padding: 0; display: flex; flex-direction: column; gap: 0.55rem; }
    .mc-prov-steps li {
      display: flex; align-items: center; gap: 0.6rem;
      font-size: 0.9rem; color: var(--color-text-muted, #64748b);
    }
    .mc-prov-step-icon {
      display: inline-flex; width: 1.25rem; justify-content: center;
    }
    .mc-prov-step--done { color: var(--color-success-700, #15803d); }
    .mc-prov-step--running { color: var(--color-primary-700, #1d4ed8); font-weight: 600; }
    .mc-prov-step--error { color: var(--color-danger-600, #dc2626); font-weight: 600; }
    .mc-prov-hint { margin: 0; font-size: 0.85rem; color: var(--color-text-muted, #64748b); line-height: 1.45; }
    .mc-prov-error-msg { margin: 0 0 1rem; color: var(--color-danger-700, #b91c1c); font-size: 0.9rem; }
    .mc-prov-actions { display: flex; gap: 0.6rem; flex-wrap: wrap; }
  `]
})
export class FirmManagedClientWizardComponent implements OnInit, OnDestroy {
  private readonly fb = inject(FormBuilder);
  private readonly managedClients = inject(FirmManagedClientsService);
  private readonly governance = inject(FirmGovernanceService);
  private readonly firmContext = inject(FirmContextService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  readonly steps: StepDef[] = [
    { id: 1, label: 'Informations générales' },
    { id: 2, label: 'Options comptables' },
    { id: 3, label: 'Options fiscales et sociales' },
    { id: 4, label: 'Paramètres & récapitulatif' }
  ];

  readonly step = signal(1);
  readonly saving = signal(false);
  readonly opening = signal(false);
  readonly created = signal<FirmManagedClientCreated | null>(null);
  readonly accountantOptions = signal<Option<string>[]>([]);

  readonly provisioningPhase = signal<'idle' | 'running' | 'error'>('idle');
  readonly elapsedSeconds = signal(0);
  readonly progressPercent = signal(0);
  readonly progressLabel = signal('');
  readonly provisioningSteps = signal<ProvisioningStep[]>([]);
  readonly provisioningCompanyName = signal('');
  readonly provisioningError = signal('');

  private accountants: FirmAssignableAccountant[] = [];
  private progressTimer: ReturnType<typeof setInterval> | null = null;
  private createSub: Subscription | null = null;
  private successRevealTimer: ReturnType<typeof setTimeout> | null = null;

  readonly governorateOptions = TUNISIAN_GOVERNORATE_OPTIONS;
  readonly monthOptions = MONTH_OPTIONS;

  readonly legalFormOptions: Option<number>[] = [
    { label: 'SARL', value: 0 },
    { label: 'SUARL', value: 1 },
    { label: 'SA', value: 2 },
    { label: 'SNC', value: 3 },
    { label: 'SCS', value: 4 },
    { label: 'Entreprise individuelle', value: 5 },
    { label: 'Autre', value: 99 }
  ];

  readonly taxRegimeOptions: Option<number>[] = [
    { label: 'Régime réel', value: 0 },
    { label: 'Régime forfaitaire', value: 1 },
    { label: 'Exonéré', value: 2 }
  ];

  readonly billingFrequencyOptions: Option<number>[] = [
    { label: 'Mensuelle', value: 0 },
    { label: 'Trimestrielle', value: 1 },
    { label: 'Annuelle', value: 2 },
    { label: 'Ponctuelle', value: 3 }
  ];

  readonly generalForm = this.fb.nonNullable.group({
    companyName: ['', [Validators.required, Validators.maxLength(200)]],
    nif: ['', [Validators.required, TunisianValidators.nif()]],
    legalForm: this.fb.control<number | null>(null),
    rneIdentifier: [''],
    incorporationDate: this.fb.control<Date | null>(null),
    shareCapital: this.fb.control<number | null>(null),
    street: ['', Validators.required],
    streetLine2: [''],
    postalCode: ['', TunisianValidators.postalCode()],
    city: ['', Validators.required],
    governorate: ['', Validators.required],
    phone: ['', [Validators.required, TunisianValidators.tunisianPhone()]],
    email: ['', [TunisianValidators.email()]],
    website: ['']
  });

  readonly accountingForm = this.fb.nonNullable.group({
    fiscalYearStartMonth: [1, Validators.required],
    fiscalYearEndMonth: [12, Validators.required],
    firstFiscalYear: [new Date().getFullYear(), [Validators.required, Validators.min(2000), Validators.max(2100)]]
  });

  readonly fiscalForm = this.fb.nonNullable.group({
    taxRegime: [0, Validators.required],
    taxOffice: [''],
    isStandardRate: this.fb.control<number | null>(null),
    cnssEmployeeRate: this.fb.control<number | null>(null),
    cnssEmployerRate: this.fb.control<number | null>(null),
    annualFeeAmount: this.fb.control<number | null>(null),
    billingFrequency: this.fb.control<number | null>(null),
    billingNotes: ['']
  });

  readonly settingsForm = this.fb.nonNullable.group({
    assignedAccountantUserId: this.fb.control<string | null>(null),
    notes: ['']
  });

  ngOnInit(): void {
    this.governance.listAssignableAccountants().subscribe({
      next: r => {
        if (r.success) {
          this.accountants = r.data;
          this.accountantOptions.set(r.data.map(a => ({ label: `${a.fullName} (${a.roleDisplay})`, value: a.id })));
        }
      },
      error: () => { /* affectation possible plus tard */ }
    });
  }

  ngOnDestroy(): void {
    this.clearProgressTimer();
    this.createSub?.unsubscribe();
    this.createSub = null;
    if (this.successRevealTimer !== null) {
      clearTimeout(this.successRevealTimer);
      this.successRevealTimer = null;
    }
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.saving()) {
      event.preventDefault();
      event.returnValue = true;
    }
  }

  goTo(target: number): void {
    if (this.saving()) return;
    if (target < this.step()) this.step.set(target);
  }

  previous(): void {
    if (this.saving()) return;
    this.step.update(s => Math.max(1, s - 1));
  }

  next(): void {
    if (this.saving()) return;
    const form = this.step() === 1 ? this.generalForm : this.step() === 2 ? this.accountingForm : this.fiscalForm;
    if (form.invalid) {
      form.markAllAsTouched();
      this.toast.add({ severity: 'warn', summary: 'Champs incomplets', detail: 'Complétez les champs obligatoires avant de continuer.' });
      return;
    }
    this.step.update(s => Math.min(4, s + 1));
  }

  create(): void {
    if (this.saving()) return;

    if (this.generalForm.invalid || this.accountingForm.invalid || this.fiscalForm.invalid) {
      this.toast.add({ severity: 'warn', summary: 'Champs incomplets', detail: 'Revenez aux étapes précédentes pour compléter les champs obligatoires.' });
      return;
    }

    const body = this.buildPayload();
    this.saving.set(true);
    this.startProvisioningProgress(body.companyName);

    this.createSub?.unsubscribe();
    this.createSub = this.managedClients.create(body).subscribe({
      next: r => {
        if (r.success) {
          this.completeProvisioningProgress(() => {
            this.saving.set(false);
            this.toast.add({ severity: 'success', summary: 'Dossier créé', detail: `« ${r.data.companyName} » est prêt.` });
            this.created.set(r.data);
          });
        } else {
          this.failProvisioningProgress(r.message ?? 'Une erreur est survenue.');
          this.toast.add({ severity: 'error', summary: 'Création impossible', detail: r.message ?? 'Une erreur est survenue.' });
        }
      },
      error: err => {
        const detail = err?.error?.message ?? 'Une erreur est survenue.';
        this.failProvisioningProgress(detail);
        this.toast.add({ severity: 'error', summary: 'Création impossible', detail });
      }
    });
  }

  retryCreate(): void {
    this.returnToRecap();
    this.create();
  }

  returnToRecap(): void {
    this.clearProgressTimer();
    this.createSub?.unsubscribe();
    this.createSub = null;
    this.saving.set(false);
    this.provisioningPhase.set('idle');
    this.provisioningError.set('');
    this.step.set(4);
  }

  async openAccounting(result: FirmManagedClientCreated): Promise<void> {
    this.opening.set(true);
    try {
      await this.firmContext.switchClient(result.companyTenantId);
      await this.router.navigate(['/accounting/chart']);
    } catch {
      this.toast.add({ severity: 'error', summary: 'Erreur', detail: "Impossible d'ouvrir le dossier." });
    } finally {
      this.opening.set(false);
    }
  }

  legalFormLabel(value: number | null | undefined): string {
    return this.legalFormOptions.find(o => o.value === value)?.label ?? '—';
  }

  taxRegimeLabel(value: number | null | undefined): string {
    return this.taxRegimeOptions.find(o => o.value === value)?.label ?? '—';
  }

  accountantLabel(id: string | null | undefined): string {
    if (!id) return 'À affecter plus tard';
    const acc = this.accountants.find(x => x.id === id);
    return acc ? acc.fullName : '—';
  }

  recapAddress(): string {
    const g = this.generalForm.value;
    const parts = [g.street, g.postalCode, g.city, g.governorate].filter(p => !!p?.toString().trim());
    return parts.length ? parts.join(', ') : '—';
  }

  canonicalizeNifField(): void {
    const control = this.generalForm.controls.nif;
    const canonical = canonicalizeNif(control.value);
    if (canonical && canonical !== control.value) {
      control.setValue(canonical);
    }
  }

  recapExercice(): string {
    const a = this.accountingForm.value;
    const start = MONTH_OPTIONS.find(m => m.value === a.fiscalYearStartMonth)?.label;
    const end = MONTH_OPTIONS.find(m => m.value === a.fiscalYearEndMonth)?.label;
    return start && end ? `${start} → ${end} ${a.firstFiscalYear ?? ''}`.trim() : '—';
  }

  recapBilling(): string {
    const f = this.fiscalForm.value;
    if (f.annualFeeAmount == null && f.billingFrequency == null) return '—';
    const freq = this.billingFrequencyOptions.find(o => o.value === f.billingFrequency)?.label;
    const amount = f.annualFeeAmount != null ? `${f.annualFeeAmount} TND` : '';
    return [amount, freq].filter(Boolean).join(' · ') || '—';
  }

  private buildPayload(): CreateFirmManagedClient {
    const g = this.generalForm.getRawValue();
    const a = this.accountingForm.getRawValue();
    const f = this.fiscalForm.getRawValue();
    const s = this.settingsForm.getRawValue();

    return {
      companyName: g.companyName.trim(),
      nif: canonicalizeNif(g.nif.trim()) || g.nif.trim(),
      legalForm: g.legalForm,
      rneIdentifier: g.rneIdentifier?.trim() || null,
      incorporationDate: g.incorporationDate ? g.incorporationDate.toISOString() : null,
      shareCapital: g.shareCapital,
      street: g.street.trim(),
      streetLine2: g.streetLine2?.trim() || null,
      city: g.city.trim(),
      governorate: g.governorate,
      postalCode: g.postalCode?.trim() || null,
      email: g.email?.trim() || null,
      phone: g.phone.trim(),
      website: g.website?.trim() || null,
      fiscalYearStartMonth: a.fiscalYearStartMonth,
      fiscalYearEndMonth: a.fiscalYearEndMonth,
      firstFiscalYear: a.firstFiscalYear,
      taxRegime: f.taxRegime,
      taxOffice: f.taxOffice?.trim() || null,
      isStandardRate: f.isStandardRate,
      cnssEmployeeRate: f.cnssEmployeeRate,
      cnssEmployerRate: f.cnssEmployerRate,
      annualFeeAmount: f.annualFeeAmount,
      billingFrequency: f.billingFrequency,
      billingNotes: f.billingNotes?.trim() || null,
      assignedAccountantUserId: s.assignedAccountantUserId,
      notes: s.notes?.trim() || null
    };
  }

  private startProvisioningProgress(companyName: string): void {
    this.clearProgressTimer();
    this.provisioningCompanyName.set(companyName);
    this.provisioningError.set('');
    this.provisioningPhase.set('running');
    this.elapsedSeconds.set(0);
    this.provisioningSteps.set(createInitialProvisioningSteps());
    this.tickProgress(0);

    this.progressTimer = setInterval(() => {
      const next = this.elapsedSeconds() + 1;
      this.elapsedSeconds.set(next);
      this.tickProgress(next);
    }, 1000);
  }

  private tickProgress(elapsed: number): void {
    const schedule = scheduleProvisioningProgress(elapsed);
    this.progressPercent.set(schedule.percent);
    this.progressLabel.set(schedule.label);
    this.provisioningSteps.update(steps => applyRunningSchedule(steps, schedule));
  }

  private completeProvisioningProgress(then: () => void): void {
    this.clearProgressTimer();
    this.progressPercent.set(100);
    this.progressLabel.set('Dossier prêt.');
    this.provisioningSteps.update(steps => completeProvisioningSteps(steps));
    this.successRevealTimer = setTimeout(() => {
      this.successRevealTimer = null;
      this.provisioningPhase.set('idle');
      then();
    }, 300);
  }

  private failProvisioningProgress(message: string): void {
    this.clearProgressTimer();
    this.saving.set(false);
    this.provisioningPhase.set('error');
    this.provisioningError.set(message);
    this.provisioningSteps.update(steps => failProvisioningSteps(steps));
  }

  private clearProgressTimer(): void {
    if (this.progressTimer !== null) {
      clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
  }
}
