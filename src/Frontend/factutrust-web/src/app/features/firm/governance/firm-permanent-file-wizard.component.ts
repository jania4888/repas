import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators, FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { FirmGovernanceService, PermanentFile, LegalRepresentative, Shareholder } from '@core/services/firm-governance.service';
import { FirmAssignmentService } from '@core/services/firm-assignment.service';
import { TUNISIAN_GOVERNORATE_OPTIONS } from '@shared/validation/validation-rules';
import { TunisianValidators } from '@shared/validation/tunisian-validators';
import { ToastService } from '@core/services/toast.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { CheckboxModule } from 'primeng/checkbox';
import { InputNumberModule } from 'primeng/inputnumber';
import { DatePickerModule } from 'primeng/datepicker';
import { Textarea } from 'primeng/textarea';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { DialogModule } from 'primeng/dialog';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';

interface StepDef {
  id: number;
  label: string;
}

interface FirmUserOption {
  id: string;
  label: string;
}

@Component({
  selector: 'app-firm-permanent-file-wizard',
  standalone: true,
  imports: [
    CommonModule, RouterModule, ReactiveFormsModule, FormsModule, PageHeaderComponent,
    ButtonModule, InputTextModule, SelectModule, CheckboxModule, InputNumberModule,
    DatePickerModule, TableModule, TagModule, Textarea, TooltipModule, DialogModule, EmptyStateComponent
  ],
  template: `
    <app-page-header
      [title]="isViewMode() ? 'Consultation dossier permanent' : 'Dossier permanent'"
      [subtitle]="file()?.companyName || (isViewMode() ? 'Lecture seule' : 'Wizard TN — 6 étapes')">
      <a routerLink="/firm/governance/permanent-files" pButton label="Retour à la liste" class="p-button-text p-button-sm" icon="pi pi-arrow-left"></a>
    </app-page-header>

    @if (loadError()) {
      <app-empty-state
        icon="pi-exclamation-triangle"
        title="Consultation impossible"
        [description]="loadError()!"
        actionLabel="Retour à la liste"
        actionRoute="/firm/governance/permanent-files">
      </app-empty-state>
    } @else {
      @if (file()) {
      <div class="status-bar">
        <p-tag [value]="file()!.statusDisplay" [severity]="statusSeverity(file()!.status)" />
        <span class="sync-info">
          Sync : {{ file()!.syncedToTenantAt ? (file()!.syncedToTenantAt | date:'dd/MM/yyyy HH:mm') : 'Non synchronisé' }}
        </span>
        @if (isViewMode()) {
          <button type="button" pButton label="Modifier le dossier" icon="pi pi-pencil" class="p-button-sm"
            (click)="enterEditMode()"></button>
          @if (file()!.status === 2) {
            <button type="button" pButton label="Synchroniser" icon="pi pi-sync" class="p-button-sm p-button-outlined"
              [loading]="syncing()" (click)="openSyncPreview()"></button>
            <button type="button" pButton label="Archiver" icon="pi pi-inbox" class="p-button-sm p-button-secondary p-button-outlined"
              (click)="archive()"></button>
          }
        }
      </div>
    }

    @if (isViewMode() && file(); as f) {
      <div class="fc-card view-sections">
        <section class="view-banner">
          <p-tag [value]="f.statusDisplay" [severity]="statusSeverity(f.status)" />
          @if (f.assignedAccountantName) {
            <span>Gestionnaire : {{ f.assignedAccountantName }}</span>
          }
          @if (f.completionPercent != null) {
            <span>Complétion : {{ f.completionPercent }}%</span>
          }
        </section>
        <section>
          <h3>Identité</h3>
          <dl class="recap-dl">
            <dt>Raison sociale</dt><dd>{{ f.companyName || '—' }}</dd>
            <dt>NIF</dt><dd>{{ f.nif || '—' }}</dd>
            <dt>RNE</dt><dd>{{ f.rneIdentifier || '—' }}</dd>
            <dt>Forme</dt><dd>{{ f.legalFormDisplay || '—' }}</dd>
            <dt>Capital</dt><dd>{{ f.shareCapital != null ? (f.shareCapital | number:'1.0-3') + ' TND' : '—' }}</dd>
            <dt>Date création</dt><dd>{{ f.incorporationDate ? (f.incorporationDate | date:'dd/MM/yyyy') : '—' }}</dd>
          </dl>
        </section>
        <section>
          <h3>Fiscal</h3>
          <dl class="recap-dl">
            <dt>Régime</dt><dd>{{ taxRegimeLabel(f.taxRegime) }}</dd>
            <dt>Recette</dt><dd>{{ f.taxOffice || '—' }}</dd>
            <dt>Attestation</dt><dd>{{ f.hasTaxCertificate ? 'À jour' : 'Non renseignée' }}</dd>
          </dl>
        </section>
        <section>
          <h3>Dirigeants</h3>
          @if (f.representatives.length === 0) {
            <p class="muted">Aucun dirigeant.</p>
          } @else {
            <p-table [value]="f.representatives" styleClass="p-datatable-sm">
              <ng-template pTemplate="header">
                <tr><th>Nom</th><th>Rôle</th><th>CIN</th><th>Contact</th></tr>
              </ng-template>
              <ng-template pTemplate="body" let-r>
                <tr>
                  <td>{{ r.firstName }} {{ r.lastName }}</td>
                  <td>{{ r.role }}</td>
                  <td>{{ r.cin || '—' }}</td>
                  <td>{{ r.email || r.phone || '—' }}</td>
                </tr>
              </ng-template>
            </p-table>
          }
        </section>
        <section>
          <h3>Associés</h3>
          @if (f.shareholders.length === 0) {
            <p class="muted">Aucun associé.</p>
          } @else {
            <p-table [value]="f.shareholders" styleClass="p-datatable-sm">
              <ng-template pTemplate="header">
                <tr><th>Nom</th><th>Parts</th><th>%</th></tr>
              </ng-template>
              <ng-template pTemplate="body" let-s>
                <tr>
                  <td>{{ s.name }} {{ s.isLegalEntity ? '(PM)' : '' }}</td>
                  <td>{{ s.shareCount }}</td>
                  <td>{{ s.sharePercentage }}%</td>
                </tr>
              </ng-template>
            </p-table>
          }
        </section>
        <section>
          <h3>Siège</h3>
          <dl class="recap-dl">
            <dt>Adresse</dt><dd>{{ formatAddress(f) }}</dd>
            <dt>Exercice fiscal</dt>
            <dd>{{ f.fiscalYearStartMonth && f.fiscalYearEndMonth ? 'Mois ' + f.fiscalYearStartMonth + ' → ' + f.fiscalYearEndMonth : '—' }}</dd>
          </dl>
        </section>
        <section>
          <h3>LAB & mission</h3>
          <dl class="recap-dl">
            <dt>LAB</dt>
            <dd>{{ f.labCompleted ? 'Complété' : 'Non' }}{{ f.labCompletedAt ? ' (' + (f.labCompletedAt | date:'dd/MM/yyyy') + ')' : '' }}</dd>
            <dt>Mission</dt>
            <dd>{{ f.missionAccepted ? 'Acceptée' : 'Non' }}{{ f.missionAcceptedAt ? ' (' + (f.missionAcceptedAt | date:'dd/MM/yyyy') + ')' : '' }}</dd>
            <dt>Statut mission</dt><dd>{{ f.missionStatus || '—' }}</dd>
          </dl>
          @if (f.missionResigned) {
            <h4>Démission</h4>
            <dl class="recap-dl">
              <dt>Exercice</dt><dd>{{ f.resignationFiscalYear ?? '—' }}</dd>
              <dt>Notes</dt><dd>{{ f.resignationNotes || '—' }}</dd>
            </dl>
          }
        </section>
        <section>
          <h3>Honoraires</h3>
          <dl class="recap-dl">
            <dt>Montant</dt>
            <dd>{{ f.annualFeeAmount != null ? (f.annualFeeAmount | number:'1.0-3') + ' ' + (f.currency || 'TND') : '—' }}</dd>
            <dt>Périodicité</dt><dd>{{ f.billingFrequencyDisplay || '—' }}</dd>
            <dt>Notes</dt><dd>{{ f.billingNotes || '—' }}</dd>
          </dl>
        </section>
        <section>
          <h3>Gestionnaire</h3>
          <p>{{ f.assignedAccountantName || '—' }}</p>
        </section>
      </div>
    } @else {
      <nav class="steps">
        @for (s of stepDefs; track s.id) {
          <button type="button"
            class="step-btn"
            [class.active]="step() === s.id"
            [class.done]="s.id < step() || (file()?.wizardStep ?? 0) >= s.id"
            [class.locked]="s.id > maxReachable()"
            (click)="goToStep(s.id)">
            <span class="step-num">{{ s.id }}</span>
            <span class="step-label">{{ s.label }}</span>
          </button>
        }
      </nav>

      <form [formGroup]="form" (ngSubmit)="save()" class="fc-card">
        @if (step() === 1) {
          <fieldset>
            <legend>Identité & statut administratif</legend>
            <div class="grid-2">
              <label>Raison sociale *
                <input pInputText formControlName="companyName" />
              </label>
              <label>Matricule fiscal (NIF) *
                <input pInputText formControlName="nif" placeholder="1234567/A/B/C/000" />
              </label>
              <label>Identifiant RNE
                <input pInputText formControlName="rneIdentifier" />
              </label>
              <label>Forme juridique *
                <p-select formControlName="legalForm" [options]="legalForms" optionLabel="label" optionValue="value"
                  placeholder="—" [showClear]="true" appendTo="body" />
              </label>
              <label>Date de création
                <p-datepicker formControlName="incorporationDate" dateFormat="dd/mm/yy" [showIcon]="true" appendTo="body" />
              </label>
              <label>Capital social (TND)
                <p-inputNumber formControlName="shareCapital" mode="decimal" [minFractionDigits]="0" [maxFractionDigits]="3" />
              </label>
              <label>Régime fiscal
                <p-select formControlName="taxRegime" [options]="taxRegimes" optionLabel="label" optionValue="value" appendTo="body" />
              </label>
              <label>Recette des Finances
                <input pInputText formControlName="taxOffice" />
              </label>
              <label class="checkbox-row">
                <p-checkbox formControlName="hasTaxCertificate" [binary]="true" inputId="taxCert" />
                <span>Attestation fiscale à jour</span>
              </label>
            </div>
            @if (step1Invalid()) {
              <p class="err">Raison sociale, NIF (format TN) et forme juridique sont obligatoires.</p>
            }
          </fieldset>
        }

        @if (step() === 2) {
          <fieldset>
            <legend>Dirigeants & associés</legend>
            <div class="person-grid">
              <label>Nom <input pInputText [(ngModel)]="repForm.lastName" [ngModelOptions]="{standalone: true}" /></label>
              <label>Prénom <input pInputText [(ngModel)]="repForm.firstName" [ngModelOptions]="{standalone: true}" /></label>
              <label>CIN <input pInputText [(ngModel)]="repForm.cin" [ngModelOptions]="{standalone: true}" maxlength="8" /></label>
              <label>Rôle <input pInputText [(ngModel)]="repForm.role" [ngModelOptions]="{standalone: true}" /></label>
              <label>Email <input pInputText [(ngModel)]="repForm.email" [ngModelOptions]="{standalone: true}" /></label>
              <label>Téléphone <input pInputText [(ngModel)]="repForm.phone" [ngModelOptions]="{standalone: true}" /></label>
              <label>Nationalité <input pInputText [(ngModel)]="repForm.nationality" [ngModelOptions]="{standalone: true}" /></label>
              <label>CNSS <input pInputText [(ngModel)]="repForm.cnssNumber" [ngModelOptions]="{standalone: true}" /></label>
              @if (editingRepId()) {
                <button type="button" pButton label="Mettre à jour" icon="pi pi-check" class="p-button-sm" (click)="saveRepresentative()"></button>
                <button type="button" pButton label="Annuler" class="p-button-sm p-button-text" (click)="cancelEditRep()"></button>
              } @else {
                <button type="button" pButton label="Ajouter dirigeant" icon="pi pi-plus" class="p-button-sm" (click)="saveRepresentative()"></button>
              }
            </div>
            <p-table [value]="file()?.representatives || []" styleClass="p-datatable-sm" [style]="{ marginBottom: '1.5rem' }">
              <ng-template pTemplate="header">
                <tr><th>Nom</th><th>Rôle</th><th>CIN</th><th>Contact</th><th></th></tr>
              </ng-template>
              <ng-template pTemplate="body" let-r>
                <tr>
                  <td>{{ r.firstName }} {{ r.lastName }}</td>
                  <td>{{ r.role }}</td>
                  <td>{{ r.cin || '—' }}</td>
                  <td>{{ r.email || r.phone || '—' }}</td>
                  <td class="row-actions">
                    <button type="button" pButton icon="pi pi-pencil" class="p-button-text p-button-sm"
                      (click)="editRepresentative(r)"></button>
                    <button type="button" pButton icon="pi pi-trash" class="p-button-text p-button-danger p-button-sm"
                      (click)="deactivateRep(r)"></button>
                  </td>
                </tr>
              </ng-template>
              <ng-template pTemplate="emptymessage">
                <tr><td colspan="5">Aucun dirigeant. Au moins un est requis pour finaliser.</td></tr>
              </ng-template>
            </p-table>

            <div class="person-grid">
              <label>Nom associé <input pInputText [(ngModel)]="shForm.name" [ngModelOptions]="{standalone: true}" /></label>
              <label>CIN / NIF <input pInputText [(ngModel)]="shForm.cinOrNif" [ngModelOptions]="{standalone: true}" /></label>
              <label>Parts <p-inputNumber [(ngModel)]="shForm.shareCount" [ngModelOptions]="{standalone: true}" [min]="0" /></label>
              <label>% <p-inputNumber [(ngModel)]="shForm.sharePercentage" [ngModelOptions]="{standalone: true}" [min]="0" [max]="100" /></label>
              <label class="checkbox-row">
                <p-checkbox [(ngModel)]="shForm.isLegalEntity" [ngModelOptions]="{standalone: true}" [binary]="true" />
                <span>Personne morale</span>
              </label>
              @if (editingShId()) {
                <button type="button" pButton label="Mettre à jour" icon="pi pi-check" class="p-button-sm" (click)="saveShareholder()"></button>
                <button type="button" pButton label="Annuler" class="p-button-sm p-button-text" (click)="cancelEditSh()"></button>
              } @else {
                <button type="button" pButton label="Ajouter associé" icon="pi pi-plus" class="p-button-sm" (click)="saveShareholder()"></button>
              }
            </div>
            @if (sharePercentWarning()) {
              <p class="warn">La somme des parts actives est {{ sharePercentTotal() | number:'1.0-2' }}% (attendu ≈ 100%).</p>
            }
            <p-table [value]="file()?.shareholders || []" styleClass="p-datatable-sm">
              <ng-template pTemplate="header">
                <tr><th>Nom</th><th>Parts</th><th>%</th><th></th></tr>
              </ng-template>
              <ng-template pTemplate="body" let-s>
                <tr>
                  <td>
                    {{ s.name }} {{ s.isLegalEntity ? '(PM)' : '' }}
                    @if (s.warnings?.length) {
                      <p-tag value="Parts ≠ 100%" severity="warning" styleClass="ml-1" />
                    }
                  </td>
                  <td>{{ s.shareCount }}</td>
                  <td>{{ s.sharePercentage }}%</td>
                  <td class="row-actions">
                    <button type="button" pButton icon="pi pi-pencil" class="p-button-text p-button-sm"
                      (click)="editShareholder(s)"></button>
                    <button type="button" pButton icon="pi pi-trash" class="p-button-text p-button-danger p-button-sm"
                      (click)="deactivateSh(s)"></button>
                  </td>
                </tr>
              </ng-template>
              <ng-template pTemplate="emptymessage">
                <tr><td colspan="4">Aucun associé.</td></tr>
              </ng-template>
            </p-table>
          </fieldset>
        }

        @if (step() === 3) {
          <fieldset>
            <legend>Siège social & exercice</legend>
            <div class="grid-2">
              <label>Adresse <input pInputText formControlName="street" /></label>
              <label>Ville <input pInputText formControlName="city" /></label>
              <label>Gouvernorat
                <p-select formControlName="governorate" [options]="governorates" optionLabel="label" optionValue="value"
                  placeholder="—" [showClear]="true" appendTo="body" />
              </label>
              <label>Code postal <input pInputText formControlName="postalCode" maxlength="4" /></label>
              <label>Mois début exercice
                <p-select formControlName="fiscalYearStartMonth" [options]="months" optionLabel="label" optionValue="value" appendTo="body" />
              </label>
              <label>Mois fin exercice
                <p-select formControlName="fiscalYearEndMonth" [options]="months" optionLabel="label" optionValue="value" appendTo="body" />
              </label>
            </div>
          </fieldset>
        }

        @if (step() === 4) {
          <fieldset>
            <legend>LAB & acceptation mission</legend>
            <label class="checkbox-row" pTooltip="Lutte Anti-Blanchiment : questionnaire cabinet complété pour ce client." tooltipPosition="top">
              <p-checkbox formControlName="labCompleted" [binary]="true" inputId="lab" />
              <span>Questionnaire LAB complété</span>
              <i class="pi pi-info-circle hint-icon"></i>
            </label>
            <label class="checkbox-row" pTooltip="La lettre de mission a été signée / acceptée par le client." tooltipPosition="top">
              <p-checkbox formControlName="missionAccepted" [binary]="true" inputId="mission" />
              <span>Lettre de mission acceptée</span>
              <i class="pi pi-info-circle hint-icon"></i>
            </label>
            <div class="grid-2" style="margin-top: 1rem;">
              <label>Statut de mission
                <p-select formControlName="missionStatus" [options]="missionStatuses" optionLabel="label" optionValue="value"
                  placeholder="—" [showClear]="true" appendTo="body" />
              </label>
              <label>Acte juridique courant
                <input pInputText formControlName="currentLegalAct" />
              </label>
            </div>
            <label class="checkbox-row" style="margin-top: 1rem;">
              <p-checkbox formControlName="missionResigned" [binary]="true" inputId="resigned" />
              <span>Mission démissionnée</span>
            </label>
            @if (form.value.missionResigned) {
              <div class="grid-2" style="margin-top: .75rem;">
                <label>Exercice de démission
                  <p-inputNumber formControlName="resignationFiscalYear" [useGrouping]="false" [min]="2000" [max]="2100" />
                </label>
                <label class="full-span">Notes démission
                  <textarea pTextarea formControlName="resignationNotes" rows="3" [autoResize]="true"></textarea>
                </label>
              </div>
            }
          </fieldset>
        }

        @if (step() === 5) {
          <fieldset>
            <legend>Facturation & honoraires</legend>
            <div class="grid-2">
              <label>Montant honoraires
                <p-inputNumber formControlName="annualFeeAmount" mode="decimal" [minFractionDigits]="0" [maxFractionDigits]="3"
                  [min]="0" suffix=" TND" />
              </label>
              <label>Périodicité
                <p-select formControlName="billingFrequency" [options]="billingFrequencies" optionLabel="label" optionValue="value"
                  placeholder="—" [showClear]="true" appendTo="body" />
              </label>
              <label>Devise
                <p-select formControlName="currency" [options]="currencies" optionLabel="label" optionValue="value" appendTo="body" />
              </label>
              <label class="full-span">Notes
                <textarea pTextarea formControlName="billingNotes" rows="4" [autoResize]="true"></textarea>
              </label>
            </div>
          </fieldset>
        }

        @if (step() === 6) {
          <fieldset>
            <legend>Confirmation</legend>
            <div class="checklist">
              @for (item of checklist(); track item.label) {
                <div class="check-item" [class.ok]="item.ok" [class.ko]="!item.ok">
                  <i class="pi" [class.pi-check-circle]="item.ok" [class.pi-times-circle]="!item.ok"></i>
                  {{ item.label }}
                </div>
              }
            </div>
            <div class="recap">
              <h4>Récapitulatif</h4>
              <dl>
                <dt>Raison sociale</dt><dd>{{ form.value.companyName || '—' }}</dd>
                <dt>NIF</dt><dd>{{ form.value.nif || '—' }}</dd>
                <dt>Forme</dt><dd>{{ legalFormLabel() }}</dd>
                <dt>Siège</dt><dd>{{ formatAddressFromForm() }}</dd>
                <dt>LAB / Mission</dt>
                <dd>{{ form.value.labCompleted ? 'LAB OK' : 'LAB manquant' }} · {{ form.value.missionAccepted ? 'Mission OK' : 'Mission manquante' }}</dd>
                <dt>Honoraires</dt>
                <dd>
                  {{ form.value.annualFeeAmount != null ? (form.value.annualFeeAmount | number:'1.0-3') + ' ' + (form.value.currency || 'TND') : '—' }}
                  · {{ billingFrequencyLabel() }}
                </dd>
                <dt>Dirigeants</dt><dd>{{ file()?.representatives?.length || 0 }}</dd>
                <dt>Associés</dt><dd>{{ file()?.shareholders?.length || 0 }}</dd>
              </dl>
            </div>
            <label>Gestionnaire comptable
              <p-select formControlName="assignedAccountantUserId" [options]="firmUsers()" optionLabel="label" optionValue="id"
                placeholder="—" [showClear]="true" appendTo="body" (onChange)="onAccountantChange($event.value)" />
            </label>
          </fieldset>
        }

        <div class="actions">
          @if (step() > 1) {
            <button type="button" pButton label="Précédent" class="p-button-outlined" icon="pi pi-arrow-left"
              (click)="step.set(step() - 1)"></button>
          }
          @if (step() < 6) {
            <button type="button" pButton label="Suivant" icon="pi pi-arrow-right" iconPos="right"
              [loading]="saving()" (click)="next()"></button>
          }
          <button type="submit" pButton label="Enregistrer" class="p-button-secondary" [loading]="saving()"></button>
          @if (step() === 6) {
            <button type="button" pButton label="Finaliser le dossier" icon="pi pi-check"
              [disabled]="!canFinalize()" [loading]="finalizing()" (click)="finalize()"></button>
            <button type="button" pButton label="Synchroniser vers client" icon="pi pi-sync"
              [disabled]="file()?.status !== 2" [loading]="syncing()" (click)="openSyncPreview()"></button>
          }
        </div>
      </form>
    }
    }

    <p-dialog header="Synchroniser vers le client" [visible]="syncPreviewVisible()" (visibleChange)="syncPreviewVisible.set($event)"
      [modal]="true" [style]="{ width: '420px' }">
      <p>Les éléments suivants seront copiés vers l'espace client :</p>
      <ul class="sync-preview-list">
        @for (item of syncPreviewItems(); track item) {
          <li>{{ item }}</li>
        }
      </ul>
      <ng-template pTemplate="footer">
        <button type="button" pButton label="Annuler" class="p-button-text" (click)="syncPreviewVisible.set(false)"></button>
        <button type="button" pButton label="Confirmer" icon="pi pi-sync" [loading]="syncing()" (click)="confirmSync()"></button>
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .status-bar { display: flex; gap: 1rem; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; }
    .sync-info { font-size: .875rem; color: #64748b; }
    .steps { display: flex; gap: .5rem; margin-bottom: 1rem; flex-wrap: wrap; }
    .step-btn {
      display: flex; align-items: center; gap: .4rem; padding: .4rem .75rem;
      border: 1px solid #e2e8f0; background: #f8fafc; border-radius: .5rem; cursor: pointer; font-size: .8rem;
    }
    .step-btn.active { background: #0d9488; color: #fff; border-color: #0d9488; }
    .step-btn.done:not(.active) { border-color: #0d9488; color: #0f766e; }
    .step-btn.locked { opacity: .45; cursor: not-allowed; }
    .step-num { font-weight: 700; }
    .fc-card {
      background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 1.25rem;
      box-shadow: 0 1px 2px rgba(15,23,42,.05);
    }
    fieldset { border: none; padding: 0; margin: 0; }
    legend { font-weight: 600; margin-bottom: 1rem; font-size: 1.05rem; }
    .grid-2 { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: .85rem; }
    .full-span { grid-column: 1 / -1; }
    label { display: flex; flex-direction: column; gap: .3rem; font-size: .875rem; }
    .checkbox-row { flex-direction: row !important; align-items: center; gap: .5rem; }
    .person-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .75rem; align-items: end; margin-bottom: 1rem; }
    @media (min-width: 900px) {
      .person-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    }
    .actions { display: flex; gap: .5rem; margin-top: 1.25rem; flex-wrap: wrap; }
    .err { color: #dc2626; font-size: .85rem; margin-top: .75rem; }
    .warn { color: #b45309; font-size: .85rem; margin: 0 0 .75rem; }
    .checklist { display: grid; gap: .4rem; margin-bottom: 1rem; }
    .check-item { display: flex; align-items: center; gap: .5rem; font-size: .9rem; }
    .check-item.ok { color: #059669; }
    .check-item.ko { color: #dc2626; }
    .recap { background: #f8fafc; border-radius: .75rem; padding: 1rem; margin-bottom: 1rem; }
    .recap h4 { margin: 0 0 .75rem; }
    .recap dl, .recap-dl { display: grid; grid-template-columns: 140px 1fr; gap: .35rem .75rem; margin: 0; font-size: .875rem; }
    .recap dt, .recap-dl dt { color: #64748b; }
    .recap dd, .recap-dl dd { margin: 0; }
    .view-sections section { margin-bottom: 1.25rem; }
    .view-banner { display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; font-size: .875rem; color: #64748b; }
    .view-sections h3 { margin: 0 0 .5rem; font-size: 1rem; }
    .view-sections h4 { margin: .75rem 0 .35rem; font-size: .9rem; color: #64748b; }
    .muted { color: #64748b; font-size: .9rem; }
    .plain-list { margin: 0; padding-left: 1.1rem; }
    .row-actions { white-space: nowrap; }
    .hint-icon { color: #64748b; font-size: .85rem; }
    .sync-preview-list { margin: .5rem 0 0; padding-left: 1.1rem; font-size: .9rem; }
  `
})
export class FirmPermanentFileWizardComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(FirmGovernanceService);
  private readonly assignments = inject(FirmAssignmentService);
  private readonly fb = inject(FormBuilder);
  private readonly toast = inject(ToastService);
  private readonly confirmation = inject(ConfirmationService);
  private querySub?: Subscription;

  readonly stepDefs: StepDef[] = [
    { id: 1, label: 'Identité' },
    { id: 2, label: 'Dirigeants' },
    { id: 3, label: 'Siège' },
    { id: 4, label: 'LAB' },
    { id: 5, label: 'Honoraires' },
    { id: 6, label: 'Confirmation' }
  ];
  readonly governorates = TUNISIAN_GOVERNORATE_OPTIONS;
  readonly legalForms = [
    { value: 0, label: 'SARL' }, { value: 1, label: 'SUARL' }, { value: 2, label: 'SA' },
    { value: 3, label: 'SNC' }, { value: 4, label: 'SCS' }, { value: 5, label: 'Entreprise individuelle' }
  ];
  readonly taxRegimes = [
    { value: 0, label: 'Régime réel' },
    { value: 1, label: 'Régime forfaitaire' },
    { value: 2, label: 'Exonéré' }
  ];
  readonly months = Array.from({ length: 12 }, (_, i) => ({ label: String(i + 1), value: i + 1 }));
  readonly billingFrequencies = [
    { value: 0, label: 'Mensuel' },
    { value: 1, label: 'Trimestriel' },
    { value: 2, label: 'Annuel' },
    { value: 3, label: 'Ponctuel' }
  ];
  readonly currencies = [{ value: 'TND', label: 'TND' }];
  readonly missionStatuses = [
    { value: 'Active', label: 'Active' },
    { value: 'Suspendue', label: 'Suspendue' },
    { value: 'Démission', label: 'Démission' }
  ];

  step = signal(1);
  file = signal<PermanentFile | null>(null);
  saving = signal(false);
  finalizing = signal(false);
  syncing = signal(false);
  syncPreviewVisible = signal(false);
  loadError = signal<string | null>(null);
  firmUsers = signal<FirmUserOption[]>([]);
  step1Tried = signal(false);
  modeOverride = signal<'view' | 'edit' | null>(null);
  editingRepId = signal<string | null>(null);
  editingShId = signal<string | null>(null);
  assignmentId = '';

  maxReachable = computed(() => Math.max(this.file()?.wizardStep ?? 1, this.step()));

  isViewMode = computed(() => {
    const override = this.modeOverride();
    if (override) return override === 'view';
    return (this.file()?.status ?? 0) === 2;
  });

  sharePercentTotal = computed(() =>
    (this.file()?.shareholders ?? []).reduce((sum, s) => sum + (Number(s.sharePercentage) || 0), 0)
  );

  sharePercentWarning = computed(() => {
    const total = this.sharePercentTotal();
    if ((this.file()?.shareholders?.length ?? 0) === 0) return false;
    return Math.abs(total - 100) > 0.01;
  });

  repForm = { lastName: '', firstName: '', cin: '', role: 'Gérant', cnssNumber: '', email: '', phone: '', nationality: '' };
  shForm = { name: '', cinOrNif: '', shareCount: 0, sharePercentage: 0, isLegalEntity: false };

  form = this.fb.group({
    companyName: ['', Validators.required],
    nif: ['', [Validators.required, TunisianValidators.nif()]],
    rneIdentifier: [''],
    legalForm: [null as number | null, Validators.required],
    incorporationDate: [null as Date | null],
    shareCapital: [null as number | null],
    taxRegime: [0],
    taxOffice: [''],
    hasTaxCertificate: [false],
    street: [''],
    city: [''],
    governorate: [''],
    postalCode: [''],
    fiscalYearStartMonth: [1, Validators.required],
    fiscalYearEndMonth: [12, Validators.required],
    labCompleted: [false],
    missionAccepted: [false],
    missionStatus: [null as string | null],
    currentLegalAct: [''],
    missionResigned: [false],
    resignationFiscalYear: [null as number | null],
    resignationNotes: [''],
    annualFeeAmount: [null as number | null],
    billingFrequency: [null as number | null],
    currency: ['TND'],
    billingNotes: [''],
    assignedAccountantUserId: [null as string | null],
    assignedAccountantName: ['']
  });

  canFinalize = computed(() => this.checklist().every(item => item.ok));

  syncPreviewItems = computed(() => {
    const f = this.file();
    if (!f) return [];
    return [
      `Raison sociale : ${f.companyName || '—'}`,
      `NIF : ${f.nif || '—'}`,
      `Régime fiscal : ${this.taxRegimeLabel(f.taxRegime)}`
    ];
  });

  checklist = computed(() => {
    const f = this.file();
    const v = this.form.getRawValue();
    return [
      { label: 'Raison sociale', ok: !!v.companyName?.trim() },
      { label: 'NIF valide', ok: !!v.nif && !this.form.controls.nif.errors },
      { label: 'Forme juridique', ok: v.legalForm != null },
      { label: 'Questionnaire LAB', ok: !!v.labCompleted },
      { label: 'Lettre de mission', ok: !!v.missionAccepted },
      { label: 'Au moins un dirigeant', ok: (f?.representatives?.length ?? 0) > 0 }
    ];
  });

  ngOnInit(): void {
    this.assignmentId = this.route.snapshot.paramMap.get('assignmentId') ?? '';
    this.loadFirmUsers();
    this.querySub = this.route.queryParamMap.subscribe(params => {
      const modeParam = params.get('mode');
      if (modeParam === 'view' || modeParam === 'edit') {
        this.modeOverride.set(modeParam);
        if (modeParam === 'edit' && this.file()) {
          this.restoreEditStep(this.file()!);
        }
      }
      const stepParam = params.get('step');
      if (stepParam && !this.isViewMode()) {
        const s = Math.min(6, Math.max(1, Number(stepParam) || 1));
        this.step.set(s);
      }
    });
    const modeParam = this.route.snapshot.queryParamMap.get('mode');
    if (modeParam === 'view' || modeParam === 'edit') {
      this.modeOverride.set(modeParam);
    }
    if (!this.assignmentId) return;
    this.api.getPermanentFile(this.assignmentId).subscribe({
      next: res => {
        if (res.success && res.data) {
          this.applyFile(res.data);
        } else if (this.isViewModeRequested()) {
          this.loadError.set(res.message ?? 'Dossier permanent introuvable ou inaccessible.');
        } else {
          this.autoInitialize();
        }
      },
      error: err => {
        if (this.isViewModeRequested()) {
          const msg = (err as { error?: { message?: string } })?.error?.message
            ?? 'Impossible de charger ce dossier permanent.';
          this.loadError.set(msg);
          this.toast.add({ severity: 'error', summary: 'Consultation', detail: msg });
        } else {
          this.autoInitialize();
        }
      }
    });
  }

  private isViewModeRequested(): boolean {
    const mode = this.modeOverride() ?? this.route.snapshot.queryParamMap.get('mode');
    return mode === 'view';
  }

  ngOnDestroy(): void {
    this.querySub?.unsubscribe();
  }

  enterEditMode(): void {
    const f = this.file();
    if (f) this.restoreEditStep(f);
    this.modeOverride.set('edit');
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { mode: 'edit' },
      queryParamsHandling: 'merge'
    });
  }

  private restoreEditStep(f: PermanentFile): void {
    this.step.set(Math.min(6, Math.max(1, f.wizardStep || 6)));
  }

  formatAddress(f: PermanentFile): string {
    const parts = [f.street, f.city, f.postalCode, f.governorate].filter(p => !!p?.trim());
    return parts.length ? parts.join(', ') : 'Siège non renseigné';
  }

  formatAddressFromForm(): string {
    const v = this.form.getRawValue();
    const parts = [v.street, v.city, v.postalCode, v.governorate].filter(p => !!p?.trim());
    return parts.length ? parts.join(', ') : 'Siège non renseigné';
  }

  taxRegimeLabel(value?: number): string {
    return this.taxRegimes.find(t => t.value === value)?.label ?? '—';
  }

  onAccountantChange(userId: string | null): void {
    const user = this.firmUsers().find(u => u.id === userId);
    this.form.patchValue({ assignedAccountantName: user?.label ?? '' });
  }

  private loadFirmUsers(): void {
    this.api.listAssignableAccountants().subscribe({
      next: res => {
        const options = (res.data ?? []).map(u => ({
          id: u.id,
          label: u.fullName
        }));
        this.firmUsers.set(options);
      }
    });
  }

  openSyncPreview(): void {
    if (this.file()?.status !== 2) return;
    this.syncPreviewVisible.set(true);
  }

  confirmSync(): void {
    this.sync();
  }

  finalize(): void {
    if (!this.canFinalize()) {
      this.toast.add({ severity: 'warn', summary: 'Finalisation', detail: 'Complétez la checklist avant de finaliser.' });
      return;
    }
    this.step.set(6);
    this.form.patchValue({ missionAccepted: true, labCompleted: true });
    this.save(false, undefined, true);
  }

  archive(): void {
    const f = this.file();
    if (!f || f.status !== 2) return;
    this.confirmation.confirm({
      header: 'Archiver le dossier',
      message: `Archiver « ${f.companyName || 'ce dossier'} » ? Les données sont conservées.`,
      icon: 'pi pi-inbox',
      acceptLabel: 'Archiver',
      rejectLabel: 'Annuler',
      acceptButtonStyleClass: 'btn-secondary',
      accept: () => {
        this.api.archivePermanentFile(this.assignmentId).subscribe({
          next: r => {
            if (r.success) {
              this.toast.add({ severity: 'success', summary: 'Archivage', detail: 'Dossier archivé.' });
              void this.router.navigate(['/firm/governance/permanent-files']);
            } else {
              this.toast.add({ severity: 'error', summary: 'Archivage', detail: r.message ?? 'Impossible.' });
            }
          },
          error: () => this.toast.add({ severity: 'error', summary: 'Archivage', detail: 'Impossible.' })
        });
      }
    });
  }

  step1Invalid(): boolean {
    if (!this.step1Tried()) return false;
    const c = this.form.controls;
    return c.companyName.invalid || c.nif.invalid || c.legalForm.invalid;
  }

  legalFormLabel(): string {
    const v = this.form.value.legalForm;
    return this.legalForms.find(l => l.value === v)?.label ?? '—';
  }

  billingFrequencyLabel(): string {
    const v = this.form.value.billingFrequency;
    return this.billingFrequencies.find(l => l.value === v)?.label ?? '—';
  }

  statusSeverity(status: number): 'success' | 'info' | 'warning' | 'secondary' {
    switch (status) {
      case 2: return 'success';
      case 1: return 'warning';
      case 9: return 'secondary';
      default: return 'info';
    }
  }

  goToStep(s: number): void {
    if (s > this.maxReachable()) return;
    if (s > this.step() && this.step() === 1 && !this.validateStep1()) return;
    this.step.set(s);
  }

  private applyFile(data: PermanentFile): void {
    this.file.set(data);
    this.form.patchValue({
      ...data,
      incorporationDate: data.incorporationDate ? new Date(data.incorporationDate) : null,
      currency: data.currency || 'TND'
    } as never);
    if (!this.modeOverride()) {
      this.modeOverride.set(data.status === 2 ? 'view' : 'edit');
    }
    if (!this.isViewMode()) {
      const stepParam = this.route.snapshot.queryParamMap.get('step');
      if (stepParam) {
        this.step.set(Math.min(6, Math.max(1, Number(stepParam) || 1)));
      } else {
        this.step.set(Math.min(6, Math.max(1, data.wizardStep)));
      }
    }
  }

  private autoInitialize(): void {
    this.modeOverride.set('edit');
    this.assignments.getActiveClients().subscribe({
      next: r => {
        const client = r.data?.find(c => c.assignmentId === this.assignmentId);
        if (!client) {
          this.toast.add({ severity: 'error', summary: 'Dossier introuvable', detail: 'Ce dossier client n\'est pas actif.' });
          void this.router.navigate(['/firm/clients']);
          return;
        }
        this.api.upsertPermanentFile(this.assignmentId, {
          wizardStep: 1,
          companyName: client.companyName
        }).subscribe({
          next: res => { if (res.data) this.applyFile(res.data); },
          error: () => {
            this.toast.add({ severity: 'error', summary: 'Erreur', detail: 'Initialisation impossible.' });
            void this.router.navigate(['/firm/clients']);
          }
        });
      },
      error: () => void this.router.navigate(['/firm/clients'])
    });
  }

  private validateStep1(): boolean {
    this.step1Tried.set(true);
    this.form.controls.companyName.markAsTouched();
    this.form.controls.nif.markAsTouched();
    this.form.controls.legalForm.markAsTouched();
    return this.form.controls.companyName.valid
      && this.form.controls.nif.valid
      && this.form.controls.legalForm.valid;
  }

  next(): void {
    if (this.step() === 1 && !this.validateStep1()) {
      this.toast.add({ severity: 'warn', summary: 'Étape 1', detail: 'Complétez les champs obligatoires.' });
      return;
    }
    this.save(false, () => this.step.set(Math.min(6, this.step() + 1)));
  }

  save(showToast = true, onSuccess?: () => void, requestCompletion = false): void {
    this.saving.set(true);
    if (requestCompletion) this.finalizing.set(true);
    const raw = this.form.getRawValue();
    const body: Record<string, unknown> = {
      wizardStep: this.step(),
      companyName: raw.companyName ?? undefined,
      nif: raw.nif ?? undefined,
      rneIdentifier: raw.rneIdentifier ?? undefined,
      legalForm: raw.legalForm ?? undefined,
      incorporationDate: raw.incorporationDate
        ? (raw.incorporationDate instanceof Date ? raw.incorporationDate.toISOString() : raw.incorporationDate)
        : undefined,
      shareCapital: raw.shareCapital ?? undefined,
      taxRegime: raw.taxRegime ?? undefined,
      taxOffice: raw.taxOffice ?? undefined,
      hasTaxCertificate: raw.hasTaxCertificate ?? false,
      street: raw.street ?? undefined,
      city: raw.city ?? undefined,
      governorate: raw.governorate ?? undefined,
      postalCode: raw.postalCode ?? undefined,
      fiscalYearStartMonth: raw.fiscalYearStartMonth ?? undefined,
      fiscalYearEndMonth: raw.fiscalYearEndMonth ?? undefined,
      labCompleted: raw.labCompleted ?? false,
      missionAccepted: raw.missionAccepted ?? false,
      missionStatus: raw.missionStatus ?? undefined,
      currentLegalAct: raw.currentLegalAct ?? undefined,
      missionResigned: raw.missionResigned ?? false,
      resignationFiscalYear: raw.resignationFiscalYear ?? undefined,
      resignationNotes: raw.resignationNotes ?? undefined,
      annualFeeAmount: raw.annualFeeAmount ?? undefined,
      billingFrequency: raw.billingFrequency ?? undefined,
      currency: raw.currency ?? 'TND',
      billingNotes: raw.billingNotes ?? undefined,
      assignedAccountantUserId: raw.assignedAccountantUserId ?? undefined,
      assignedAccountantName: raw.assignedAccountantName ?? undefined,
      requestCompletion
    };

    this.api.upsertPermanentFile(this.assignmentId, body as never).subscribe({
      next: res => {
        this.saving.set(false);
        this.finalizing.set(false);
        if (res.success && res.data) {
          this.file.set(res.data);
          if (requestCompletion && res.data.status === 2) {
            this.modeOverride.set('view');
            void this.router.navigate([], {
              relativeTo: this.route,
              queryParams: { mode: 'view' },
              queryParamsHandling: 'merge'
            });
            this.toast.add({ severity: 'success', summary: 'Dossier permanent', detail: 'Dossier finalisé.' });
          } else if (showToast) {
            this.toast.add({ severity: 'success', summary: 'Dossier permanent', detail: 'Enregistré.' });
          }
          onSuccess?.();
        } else {
          this.toast.add({ severity: 'error', summary: 'Enregistrement', detail: res.message ?? 'Impossible.' });
        }
      },
      error: err => {
        this.saving.set(false);
        this.finalizing.set(false);
        const msg = (err as { error?: { message?: string } })?.error?.message ?? 'Enregistrement impossible.';
        this.toast.add({ severity: 'error', summary: 'Erreur', detail: msg });
      }
    });
  }

  sync(): void {
    if (this.file()?.status !== 2) return;
    this.syncing.set(true);
    this.api.syncPermanentFile(this.assignmentId).subscribe({
      next: () => {
        this.syncing.set(false);
        this.syncPreviewVisible.set(false);
        this.toast.add({ severity: 'success', summary: 'Sync', detail: 'Données synchronisées vers le client.' });
        this.api.getPermanentFile(this.assignmentId).subscribe({
          next: res => { if (res.data) this.applyFile(res.data); }
        });
      },
      error: err => {
        this.syncing.set(false);
        const msg = (err as { error?: { message?: string } })?.error?.message ?? 'Synchronisation impossible.';
        this.toast.add({ severity: 'error', summary: 'Erreur', detail: msg });
      }
    });
  }

  editRepresentative(r: LegalRepresentative): void {
    if (!r.id) return;
    this.editingRepId.set(r.id);
    this.repForm = {
      lastName: r.lastName,
      firstName: r.firstName,
      cin: r.cin ?? '',
      role: r.role,
      cnssNumber: r.cnssNumber ?? '',
      email: r.email ?? '',
      phone: r.phone ?? '',
      nationality: r.nationality ?? ''
    };
  }

  cancelEditRep(): void {
    this.editingRepId.set(null);
    this.repForm = { lastName: '', firstName: '', cin: '', role: 'Gérant', cnssNumber: '', email: '', phone: '', nationality: '' };
  }

  saveRepresentative(): void {
    if (!this.repForm.lastName.trim() || !this.repForm.firstName.trim()) {
      this.toast.add({ severity: 'warn', summary: 'Dirigeant', detail: 'Nom et prénom obligatoires.' });
      return;
    }
    const editingId = this.editingRepId();
    const payload = { ...this.repForm, isActive: true };
    const req = editingId
      ? this.api.updateRepresentative(this.assignmentId, editingId, payload)
      : this.api.addRepresentative(this.assignmentId, payload);

    req.subscribe({
      next: res => {
        if (!res.data) return;
        this.file.update(f => {
          if (!f) return f;
          if (editingId) {
            return {
              ...f,
              representatives: f.representatives.map(x => x.id === editingId ? res.data! : x)
            };
          }
          return { ...f, representatives: [...f.representatives, res.data!] };
        });
        this.cancelEditRep();
      },
      error: () => this.toast.add({
        severity: 'error',
        summary: 'Erreur',
        detail: editingId ? 'Mise à jour dirigeant impossible.' : 'Ajout dirigeant impossible.'
      })
    });
  }

  editShareholder(s: Shareholder): void {
    if (!s.id) return;
    this.editingShId.set(s.id);
    this.shForm = {
      name: s.name,
      cinOrNif: s.cinOrNif ?? '',
      shareCount: s.shareCount,
      sharePercentage: s.sharePercentage,
      isLegalEntity: s.isLegalEntity
    };
  }

  cancelEditSh(): void {
    this.editingShId.set(null);
    this.shForm = { name: '', cinOrNif: '', shareCount: 0, sharePercentage: 0, isLegalEntity: false };
  }

  private warnSharePercent(nextShareholders: Shareholder[]): void {
    const total = nextShareholders.reduce((sum, s) => sum + (Number(s.sharePercentage) || 0), 0);
    if (nextShareholders.length > 0 && Math.abs(total - 100) > 0.01) {
      this.toast.add({
        severity: 'warn',
        summary: 'Parts sociales',
        detail: `Somme des % = ${total.toFixed(2)} (attendu ≈ 100).`
      });
    }
  }

  saveShareholder(): void {
    if (!this.shForm.name.trim()) {
      this.toast.add({ severity: 'warn', summary: 'Associé', detail: 'Nom obligatoire.' });
      return;
    }
    const editingId = this.editingShId();
    const payload = { ...this.shForm, isActive: true };
    const req = editingId
      ? this.api.updateShareholder(this.assignmentId, editingId, payload)
      : this.api.addShareholder(this.assignmentId, payload);

    req.subscribe({
      next: res => {
        if (!res.data) return;
        this.file.update(f => {
          if (!f) return f;
          const shareholders = editingId
            ? f.shareholders.map(x => x.id === editingId ? res.data! : x)
            : [...f.shareholders, res.data!];
          this.warnSharePercent(shareholders);
          return { ...f, shareholders };
        });
        this.cancelEditSh();
      },
      error: () => this.toast.add({
        severity: 'error',
        summary: 'Erreur',
        detail: editingId ? 'Mise à jour associé impossible.' : 'Ajout associé impossible.'
      })
    });
  }

  deactivateRep(r: LegalRepresentative): void {
    if (!r.id) return;
    this.api.deactivateRepresentative(this.assignmentId, r.id).subscribe({
      next: () => {
        if (this.editingRepId() === r.id) this.cancelEditRep();
        this.toast.add({ severity: 'success', summary: 'Dirigeant', detail: 'Désactivé.' });
        this.api.getPermanentFile(this.assignmentId).subscribe({
          next: res => { if (res.data) this.applyFile(res.data); }
        });
      },
      error: () => this.toast.add({ severity: 'error', summary: 'Erreur', detail: 'Désactivation impossible.' })
    });
  }

  deactivateSh(s: Shareholder): void {
    if (!s.id) return;
    this.api.deactivateShareholder(this.assignmentId, s.id).subscribe({
      next: () => {
        this.file.update(f => {
          if (!f) return f;
          const shareholders = f.shareholders.filter(x => x.id !== s.id);
          this.warnSharePercent(shareholders);
          return { ...f, shareholders };
        });
        if (this.editingShId() === s.id) this.cancelEditSh();
        this.toast.add({ severity: 'success', summary: 'Associé', detail: 'Désactivé.' });
      },
      error: () => this.toast.add({ severity: 'error', summary: 'Erreur', detail: 'Désactivation impossible.' })
    });
  }
}
