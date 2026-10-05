/// <reference types="@angular/localize" />
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import { InputTextModule } from 'primeng/inputtext';
import { InputMaskModule } from 'primeng/inputmask';
import { InputNumberModule } from 'primeng/inputnumber';
import { Textarea } from 'primeng/textarea';
import { SelectModule } from 'primeng/select';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { DividerModule } from 'primeng/divider';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { ToastModule } from 'primeng/toast';
import { ToastService } from '@core/services/toast.service';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { FormSectionComponent } from '@shared/components/form-section/form-section.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { ErrorMessageService } from '@core/services/error-message.service';
import { canonicalizeNif, NIF_PATTERN } from '@shared/validation';
import { nifAcceptsEitherSpelling } from '@shared/validation/tunisian-validators';
import { NifMaskPasteDirective } from '@shared/validation/nif-mask-paste.directive';
import { ClientService, Client, ClientType, CreateClientRequest, UpdateClientRequest } from '@core/services/client.service';

interface TypeOption {
  label: string;
  value: ClientType;
}

interface GovernorateOption {
  label: string;
  value: string;
}

@Component({
  selector: 'app-client-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterModule,
    InputTextModule,
    InputMaskModule,
    NifMaskPasteDirective,
    InputNumberModule,
    Textarea,
    SelectModule,
    ButtonModule,
    CardModule,
    DividerModule,
    ToggleSwitchModule,
    ToastModule,
    PageHeaderComponent,
    BreadcrumbComponent,
    FormSectionComponent,
    ButtonComponent
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems()"></app-breadcrumb>
    
    <app-page-header 
      [title]="isEditMode() ? loc_ui_tern_modifier_le_client_5c0584 : loc_ui_tern_nouveau_client_9e7edf" 
      [subtitle]="isEditMode() ? loc_ui_tern_mettez_a_jour_les_informations_du_client_fdd2c8 : loc_ui_tern_renseignez_les_informations_essentielles_p_730075">
      <app-button 
        variant="outline"
        icon="pi-times"
        iconPos="left"
        routerLink="/clients" i18n="@@clients.client-form.annuler.49ba3292"> Annuler </app-button>
    </app-page-header>

    @if (loading()) {
      <div class="loading-container">
        <i class="pi pi-spin pi-spinner" style="font-size: 2rem;"></i>
        <p i18n="@@clients.client-form.chargement.a209b664">Chargement...</p>
      </div>
    } @else {
      <form [formGroup]="form" (ngSubmit)="onSubmit()">
        <div class="form-grid">
          <!-- General Information -->
          <app-form-section title="Informations générales" i18n-title="@@clients.client-form.informations.generales.be6ba6e5" icon="pi-user" [number]="1">
            <div class="form-group">
              <label for="name"><ng-container i18n="@@clients.client-form.nom.ou.raison.sociale.2983b5c6">Nom ou raison sociale </ng-container> <span class="required" i18n="@@clients.client-form.text.df58248c">*</span></label>
              <input 
                pInputText 
                id="name" 
                formControlName="name"
                placeholder="Ex. Jean Dupont ou ABC SARL" i18n-placeholder="@@clients.client-form.ex.jean.dupont.ou.abc.sarl.92bd3a72"
                class="w-full"
                [class.ng-invalid]="isInvalid('name')">
              @if (isInvalid('name')) {
                <div class="form-error">
                  <i class="pi pi-exclamation-circle"></i>
                  <span>{{ errorMessageService.getErrorMessage(form.get('name')) }}</span>
                </div>
              }
            </div>

            <div class="form-row">
              <div class="form-group">
                <label for="type"><ng-container i18n="@@clients.client-form.type.de.client.b2406987">Type de client </ng-container> <span class="required" i18n="@@clients.client-form.text.df58248c">*</span></label>
                <p-select 
                  id="type"
                  [options]="typeOptions" 
                  formControlName="type"
                  optionLabel="label"
                  optionValue="value"
                  placeholder="Sélectionner" i18n-placeholder="@@clients.client-form.selectionner.ab31a36f"
                  styleClass="w-full">
                </p-select>
                @if (isInvalid('type')) {
                  <div class="form-error">
                    <i class="pi pi-exclamation-circle"></i>
                    <span>{{ errorMessageService.getErrorMessage(form.get('type')) }}</span>
                  </div>
                }
              </div>

              <div class="form-group">
                <label for="nif"><ng-container i18n="@@clients.client-form.nif.matricule.fiscal.a5458ed7">NIF / Matricule fiscal </ng-container>@if (form.get('type')?.value === ClientType.Business) {<span class="required" i18n="@@clients.client-form.text.df58248c">*</span>}</label>
                <p-inputMask
                  id="nif"
                  formControlName="nif"
                  appNifMaskPaste
                  mask="9999999a/a/a/999"
                  placeholder="Ex. 1772793W/A/M/000" i18n-placeholder="@@clients.client-form.ex.1772793w.a.m.000.f3190bfc"
                  styleClass="w-full"
                  [style]="{'text-transform': 'uppercase'}"
                  [class.ng-invalid]="isInvalid('nif')"
                  (onBlur)="normalizeNif()">
                </p-inputMask>
                @if (form.get('type')?.value === ClientType.Business) {
                  <small class="form-hint" i18n="@@clients.client-form.format.1772793w.a.m.000.953218ad">Format : 1772793W/A/M/000</small>
                }
                @if (isInvalid('nif')) {
                  <div class="form-error">
                    <i class="pi pi-exclamation-circle"></i>
                    <span>{{ getNifErrorMessage() }}</span>
                  </div>
                }
              </div>
            </div>

            @if (isEditMode()) {
              <div class="form-group">
                <label for="isActive" i18n="@@clients.client-form.statut.659499f3">Statut</label>
                <div class="status-switch">
                  <p-toggleswitch 
                    id="isActive"
                    formControlName="isActive">
                  </p-toggleswitch>
                  <span [class.active]="form.get('isActive')?.value">
                    {{ form.get('isActive')?.value ? loc_ui_tern_actif_2eb75f : loc_ui_tern_inactif_d2e033 }}
                  </span>
                </div>
              </div>
            }
          </app-form-section>

          <!-- Contact Information -->
          <app-form-section title="Coordonnées" i18n-title="@@clients.client-form.coordonnees.7c309d77" icon="pi-envelope" [number]="2">
            <div class="form-group">
              <label for="email" i18n="@@clients.client-form.adresse.email.bdf1cc95">Adresse email</label>
              <input 
                pInputText 
                id="email" 
                type="email"
                formControlName="email"
                placeholder="contact@exemple.tn" i18n-placeholder="@@clients.client-form.contact.exemple.tn.c035c2ff"
                class="w-full"
                [class.ng-invalid]="isInvalid('email')">
              @if (isInvalid('email')) {
                <div class="form-error">
                  <i class="pi pi-exclamation-circle"></i>
                  <span>{{ errorMessageService.getErrorMessage(form.get('email')) }}</span>
                </div>
              }
            </div>

            <div class="form-group">
              <label for="phone" i18n="@@clients.client-form.telephone.d3b023ea">Téléphone</label>
              <p-inputMask 
                id="phone" 
                formControlName="phone"
                mask="99 999 999"
                placeholder="+216 XX XXX XXX" i18n-placeholder="@@clients.client-form.216.xx.xxx.xxx.e336394e"
                styleClass="w-full">
              </p-inputMask>
            </div>

            <div class="form-group">
              <label for="contactPerson" i18n="@@clients.client-form.personne.de.contact.148fdd96">Personne de contact</label>
              <input 
                pInputText 
                id="contactPerson" 
                formControlName="contactPerson"
                placeholder="Nom du responsable" i18n-placeholder="@@clients.client-form.nom.du.responsable.45818ee5"
                class="w-full">
            </div>
          </app-form-section>

          <!-- Address -->
          <app-form-section title="Adresse" i18n-title="@@clients.client-form.adresse.522e1466" icon="pi-map-marker" [number]="3" class="address-card">
            <div class="form-group">
              <label for="street"><ng-container i18n="@@clients.client-form.adresse.522e1466">Adresse </ng-container> <span class="required" i18n="@@clients.client-form.text.df58248c">*</span></label>
              <input 
                pInputText 
                id="street" 
                formControlName="street"
                placeholder="Numéro et nom de rue" i18n-placeholder="@@clients.client-form.numero.et.nom.de.rue.a6fd8173"
                maxlength="200"
                class="w-full"
                [class.ng-invalid]="isInvalid('street')">
              @if (isInvalid('street')) {
                <div class="form-error">
                  <i class="pi pi-exclamation-circle"></i>
                  <span>{{ errorMessageService.getErrorMessage(form.get('street')) }}</span>
                </div>
              }
            </div>

            <div class="form-group">
              <label for="streetLine2" i18n="@@clients.client-form.complement.d.adresse.fba484a7">Complément d'adresse</label>
              <input 
                pInputText 
                id="streetLine2" 
                formControlName="streetLine2"
                placeholder="Bâtiment, étage…" i18n-placeholder="@@clients.client-form.batiment.etage.73c5abc1"
                class="w-full">
            </div>

            <div class="form-row">
              <div class="form-group">
                <label for="city"><ng-container i18n="@@clients.client-form.ville.97217611">Ville </ng-container> <span class="required" i18n="@@clients.client-form.text.df58248c">*</span></label>
                <input 
                  pInputText 
                  id="city" 
                  formControlName="city"
                  placeholder="Tunis" i18n-placeholder="@@clients.client-form.tunis.e58b2d54"
                  class="w-full"
                  [class.ng-invalid]="isInvalid('city')">
                @if (isInvalid('city')) {
                  <div class="form-error">
                    <i class="pi pi-exclamation-circle"></i>
                    <span>{{ errorMessageService.getErrorMessage(form.get('city')) }}</span>
                  </div>
                }
              </div>

              <div class="form-group">
                <label for="postalCode" i18n="@@clients.client-form.code.postal.74779109">Code postal</label>
                <p-inputMask 
                  id="postalCode" 
                  formControlName="postalCode"
                  mask="9999"
                  placeholder="1000" i18n-placeholder="@@clients.client-form.1000.e3cbba88"
                  styleClass="w-full">
                </p-inputMask>
              </div>
            </div>

            <div class="form-group">
              <label for="governorate"><ng-container i18n="@@clients.client-form.gouvernorat.b9cd1d99">Gouvernorat </ng-container> <span class="required" i18n="@@clients.client-form.text.df58248c">*</span></label>
              <p-select 
                id="governorate"
                [options]="governorates" 
                formControlName="governorate"
                placeholder="Sélectionner" i18n-placeholder="@@clients.client-form.selectionner.ab31a36f"
                [filter]="true"
                filterBy="label"
                styleClass="w-full">
              </p-select>
              @if (isInvalid('governorate')) {
                <div class="form-error">
                  <i class="pi pi-exclamation-circle"></i>
                  <span>{{ errorMessageService.getErrorMessage(form.get('governorate')) }}</span>
                </div>
              }
            </div>
          </app-form-section>

          <!-- Notes -->
          <app-form-section title="Notes" i18n-title="@@clients.client-form.notes.70440046" icon="pi-file-edit" [number]="4" class="notes-card">
            <div class="form-group">
              <label for="notes" i18n="@@clients.client-form.notes.internes.1a81fb4e">Notes internes</label>
              <textarea 
                pTextarea 
                id="notes" 
                formControlName="notes"
                placeholder="Préférences, instructions particulières…" i18n-placeholder="@@clients.client-form.preferences.instructions.particulieres.7f4b138b"
                [rows]="4"
                class="w-full">
              </textarea>
              <small class="form-hint" i18n="@@clients.client-form.non.visibles.par.le.client.f5513dc9">Non visibles par le client.</small>
            </div>
          </app-form-section>

          <!-- Conditions financières -->
          <app-form-section title="Conditions financières" i18n-title="@@clients.client-form.conditions.financieres.ae9a6ff2" icon="pi-wallet" [number]="5" class="finance-card">
            <div class="form-row">
              <div class="form-group">
                <label for="creditLimit" i18n="@@clients.client-form.plafond.d.encours.tnd.9a9150cb">Plafond d'encours (TND)</label>
                <p-inputNumber
                  inputId="creditLimit"
                  formControlName="creditLimit"
                  mode="decimal"
                  [min]="0"
                  [minFractionDigits]="3"
                  [maxFractionDigits]="3"
                  [useGrouping]="true"
                  locale="fr-TN"
                  placeholder="Aucun plafond" i18n-placeholder="@@clients.client-form.aucun.plafond.d8c852de"
                  styleClass="w-full">
                </p-inputNumber>
                <small class="form-hint" i18n="@@clients.client-form.laisser.vide.pour.aucun.plafond.le.depassement.a.3de2a34c">Laisser vide pour aucun plafond. Le dépassement avertit sans bloquer les ventes.</small>
                @if (isInvalid('creditLimit')) {
                  <div class="form-error">
                    <i class="pi pi-exclamation-circle"></i>
                    <span>{{ errorMessageService.getErrorMessage(form.get('creditLimit')) }}</span>
                  </div>
                }
              </div>

              <div class="form-group">
                <label for="defaultPaymentTermDays" i18n="@@clients.client-form.delai.de.reglement.jours.a445720b">Délai de règlement (jours)</label>
                <p-inputNumber
                  inputId="defaultPaymentTermDays"
                  formControlName="defaultPaymentTermDays"
                  [min]="0"
                  [max]="365"
                  [useGrouping]="false"
                  placeholder="Ex. 30" i18n-placeholder="@@clients.client-form.ex.30.e155bc3a"
                  styleClass="w-full">
                </p-inputNumber>
                <small class="form-hint" i18n="@@clients.client-form.propose.a.la.saisie.des.factures.et.commandes.3b2e61c6">Proposé à la saisie des factures et commandes.</small>
                @if (isInvalid('defaultPaymentTermDays')) {
                  <div class="form-error">
                    <i class="pi pi-exclamation-circle"></i>
                    <span>{{ errorMessageService.getErrorMessage(form.get('defaultPaymentTermDays')) }}</span>
                  </div>
                }
              </div>
            </div>
          </app-form-section>
        </div>

        <!-- Actions -->
        <div class="form-actions">
          <app-button 
            variant="outline"
            icon="pi-times"
            iconPos="left"
            routerLink="/clients" i18n="@@clients.client-form.annuler.49ba3292"> Annuler </app-button>
          <app-button 
            variant="primary"
            type="submit"
            [icon]="saving() ? 'pi-spin pi-spinner' : 'pi-check'"
            iconPos="left"
            [disabled]="form.invalid || saving()">
            {{ isEditMode() ? loc_ui_tern_enregistrer_f7c8bc : loc_ui_tern_creer_le_client_aba191 }}
          </app-button>
        </div>
      </form>
    }

  `,
  styles: [`
    .loading-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: var(--spacing-12);
      gap: var(--spacing-4);
      color: var(--color-neutral-600);
    }

    .form-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: var(--spacing-4);

      @media (max-width: 1024px) {
        grid-template-columns: 1fr;
      }
    }

    .address-card {
      grid-column: 1;
    }

    .notes-card {
      grid-column: 2;

      @media (max-width: 1024px) {
        grid-column: 1;
      }
    }

    .finance-card {
      grid-column: 1 / -1;
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
      margin-bottom: var(--spacing-5);

      &:last-child {
        margin-bottom: 0;
      }

      label {
        display: block;
        margin-bottom: var(--spacing-2);
        font-weight: var(--font-weight-semibold);
        font-size: var(--font-size-sm);
        color: var(--color-text-primary);
      }

      .required {
        color: var(--color-error-600);
        margin-inline-start: var(--spacing-1);
      }
    }

    .form-error {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      margin-top: var(--spacing-1);
      font-size: var(--font-size-sm);
      color: var(--color-error-600);

      i {
        font-size: var(--font-size-base);
      }

      .form-hint {
        display: block;
        margin-top: var(--spacing-1);
        color: var(--color-neutral-600);
        font-size: var(--font-size-xs);
      }
    }

    .form-hint {
      color: var(--color-neutral-500);
      font-size: var(--font-size-sm);
      margin-top: var(--spacing-1);
      display: block;
    }

    .status-switch {
      display: flex;
      align-items: center;
      gap: var(--spacing-3);

      span {
        color: var(--color-neutral-600);

        &.active {
          color: var(--color-success-600);
          font-weight: var(--font-weight-medium);
        }
      }
    }

    .form-actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--spacing-4);
      margin-top: var(--spacing-8);
      padding-top: var(--spacing-6);
      border-top: 1px solid var(--color-border-subtle);
    }

    :host ::ng-deep {
      .p-inputmask,
      .p-select,
      .p-inputnumber,
      .p-inputnumber-input {
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
export class ClientFormComponent implements OnInit {
  readonly loc_ui_tern_modifier_le_client_5c0584 = $localize`:@@ui.tern.modifier.le.client.5c0584:Modifier le client`;
  readonly loc_ui_tern_nouveau_client_9e7edf = $localize`:@@ui.tern.nouveau.client.9e7edf:Nouveau client`;
  readonly loc_ui_tern_mettez_a_jour_les_informations_du_client_fdd2c8 = $localize`:@@ui.tern.mettez.a.jour.les.informations.du.client.fdd2c8:Mettez à jour les informations du client.`;
  readonly loc_ui_tern_renseignez_les_informations_essentielles_p_730075 = $localize`:@@ui.tern.renseignez.les.informations.essentielles.p.730075:Renseignez les informations essentielles pour facturer ce client.`;
  readonly loc_ui_tern_actif_2eb75f = $localize`:@@ui.tern.actif.2eb75f:Actif`;
  readonly loc_ui_tern_inactif_d2e033 = $localize`:@@ui.tern.inactif.d2e033:Inactif`;
  readonly loc_ui_tern_enregistrer_f7c8bc = $localize`:@@ui.tern.enregistrer.f7c8bc:Enregistrer`;
  readonly loc_ui_tern_creer_le_client_aba191 = $localize`:@@ui.tern.creer.le.client.aba191:Créer le client`;
  private fb = inject(FormBuilder);
  private clientService = inject(ClientService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private toastService = inject(ToastService);
  errorMessageService = inject(ErrorMessageService);

  loading = signal(false);
  saving = signal(false);
  clientId = signal<string | null>(null);
  
  isEditMode = computed(() => !!this.clientId());

  readonly ClientType = ClientType;

  breadcrumbItems = computed<BreadcrumbItem[]>(() => {
    const base: BreadcrumbItem[] = [
      { label: $localize`:@@clients.client-form.ts.tableau.de.bord.a524057f:Tableau de bord`, route: '/dashboard', icon: 'pi-home' },
      { label: $localize`:@@clients.client-form.ts.clients.28e22fe3:Clients`, route: '/clients' }
    ];
    if (this.isEditMode()) {
      base.push({ label: $localize`:@@clients.client-form.ts.modifier.f260e757:Modifier` });
    } else {
      base.push({ label: $localize`:@@clients.client-form.ts.nouveau.client.9e7edfed:Nouveau client` });
    }
    return base;
  });

  typeOptions: TypeOption[] = [
    { label: $localize`:@@clients.client-form.ts.particulier.281680dd:Particulier`, value: ClientType.Individual },
    { label: $localize`:@@clients.client-form.ts.entreprise.d03e74b6:Entreprise`, value: ClientType.Business }
  ];

  governorates: GovernorateOption[] = [
    { label: $localize`:@@clients.client-form.ts.ariana.4787a016:Ariana`, value: 'Ariana' },
    { label: $localize`:@@clients.client-form.ts.beja.603d1fac:Béja`, value: 'Béja' },
    { label: $localize`:@@clients.client-form.ts.ben.arous.3fab69ae:Ben Arous`, value: 'Ben Arous' },
    { label: $localize`:@@clients.client-form.ts.bizerte.2e83a969:Bizerte`, value: 'Bizerte' },
    { label: $localize`:@@clients.client-form.ts.gabes.e4b74f5d:Gabès`, value: 'Gabès' },
    { label: $localize`:@@clients.client-form.ts.gafsa.eae1e5d1:Gafsa`, value: 'Gafsa' },
    { label: $localize`:@@clients.client-form.ts.jendouba.c6f39067:Jendouba`, value: 'Jendouba' },
    { label: $localize`:@@clients.client-form.ts.kairouan.62201cff:Kairouan`, value: 'Kairouan' },
    { label: $localize`:@@clients.client-form.ts.kasserine.2ac4b4c3:Kasserine`, value: 'Kasserine' },
    { label: $localize`:@@clients.client-form.ts.kebili.5c50d601:Kébili`, value: 'Kébili' },
    { label: $localize`:@@clients.client-form.ts.le.kef.6dfe486f:Le Kef`, value: 'Le Kef' },
    { label: $localize`:@@clients.client-form.ts.mahdia.00f1b39b:Mahdia`, value: 'Mahdia' },
    { label: $localize`:@@clients.client-form.ts.la.manouba.25ff50d2:La Manouba`, value: 'La Manouba' },
    { label: $localize`:@@clients.client-form.ts.medenine.0e0d3c6a:Médenine`, value: 'Médenine' },
    { label: $localize`:@@clients.client-form.ts.monastir.aef3b69f:Monastir`, value: 'Monastir' },
    { label: $localize`:@@clients.client-form.ts.nabeul.43036f00:Nabeul`, value: 'Nabeul' },
    { label: $localize`:@@clients.client-form.ts.sfax.7f5b35de:Sfax`, value: 'Sfax' },
    { label: $localize`:@@clients.client-form.ts.sidi.bouzid.923cd336:Sidi Bouzid`, value: 'Sidi Bouzid' },
    { label: $localize`:@@clients.client-form.ts.siliana.279c3c64:Siliana`, value: 'Siliana' },
    { label: $localize`:@@clients.client-form.ts.sousse.e45910eb:Sousse`, value: 'Sousse' },
    { label: $localize`:@@clients.client-form.ts.tataouine.d3f11bd9:Tataouine`, value: 'Tataouine' },
    { label: $localize`:@@clients.client-form.ts.tozeur.0c755425:Tozeur`, value: 'Tozeur' },
    { label: $localize`:@@clients.client-form.ts.tunis.e58b2d54:Tunis`, value: 'Tunis' },
    { label: $localize`:@@clients.client-form.ts.zaghouan.65a3dc81:Zaghouan`, value: 'Zaghouan' }
  ];

  form: FormGroup = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    type: [ClientType.Business, Validators.required],
    nif: [''],
    email: ['', [Validators.email]],
    phone: [''],
    contactPerson: [''],
    street: ['', Validators.required],
    streetLine2: [''],
    city: ['', Validators.required],
    postalCode: [''],
    governorate: ['', Validators.required],
    notes: [''],
    isActive: [true],
    creditLimit: [null as number | null, [Validators.min(0)]],
    defaultPaymentTermDays: [null as number | null, [Validators.min(0), Validators.max(365)]]
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.clientId.set(id);
      this.loadClient(id);
    }
    this.form.get('type')?.valueChanges.subscribe(() => this.updateNifValidators());
    this.updateNifValidators();
  }

  private updateNifValidators(): void {
    const nif = this.form.get('nif');
    const isCompany = this.form.get('type')?.value === ClientType.Business;
    if (isCompany) {
      nif?.setValidators([Validators.required, nifAcceptsEitherSpelling]);
    } else {
      nif?.setValidators([]);
    }
    nif?.updateValueAndValidity({ emitEvent: false });
  }

  /**
   * Normalise le NIF au blur (aligné sur formulaire fournisseur).
   * Nettoye les placeholders du masque (_), espaces, et force le format avec slashes.
   */
  normalizeNif(): void {
    const nifControl = this.form.get('nif');
    if (!nifControl) return;

    const value = nifControl.value as string;
    if (!value || typeof value !== 'string') return;

    const normalized = canonicalizeNif(value);

    // Ne mettre à jour le contrôle que si vide ou NIF complet valide (évite conflit avec p-inputMask)
    const isEmpty = normalized === '';
    const isValidComplete = normalized.length > 0 && NIF_PATTERN.test(normalized);
    if ((isEmpty || isValidComplete) && normalized !== value) {
      nifControl.setValue(normalized, { emitEvent: false });
      nifControl.updateValueAndValidity({ emitEvent: false });
    }
  }

  isInvalid(field: string): boolean {
    const control = this.form.get(field);
    return !!(control?.invalid && control?.touched);
  }

  /**
   * Message d'erreur NIF aligné sur step-client (wizard facture).
   */
  getNifErrorMessage(): string {
    const control = this.form.get('nif');
    if (!control?.errors) return '';
    if (control.errors['required']) {
      return $localize`:@@clients.client-form.ts.le.matricule.fiscal.est.obligatoire.pour.51ef6b29:Le matricule fiscal est obligatoire pour un client assujetti`;
    }
    if (control.errors['pattern']) {
      return $localize`:@@clients.client-form.ts.matricule.fiscal.invalide.format.attendu.7da88009:Matricule fiscal invalide. Format attendu: 1772793W/A/M/000`;
    }
    return '';
  }

  private loadClient(id: string): void {
    this.loading.set(true);
    
    this.clientService.getClient(id).subscribe({
      next: (response) => {
        if (response.success) {
          this.populateForm(response.data);
        } else {
          this.toastService.add({
            severity: 'error',
            summary: $localize`:@@client-form.component.summary.Erreur:Erreur`,
            detail: $localize`:@@client-form.component.detail.Client_non_trouv:Client non trouvé`
          });
          this.router.navigate(['/clients']);
        }
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.toastService.add({
          severity: 'error',
          summary: $localize`:@@client-form.component.summary.Erreur:Erreur`,
          detail: $localize`:@@client-form.component.detail.Impossible_de_ch:Impossible de charger le client`
        });
        this.router.navigate(['/clients']);
      }
    });
  }

  private populateForm(client: Client): void {
    this.form.patchValue({
      name: client.name,
      type: client.type,
      nif: client.nif ?? '',
      email: client.email ?? '',
      phone: client.phone ?? '',
      contactPerson: client.contactPerson ?? '',
      street: client.address.street,
      streetLine2: client.address.streetLine2 ?? '',
      city: client.address.city,
      postalCode: client.address.postalCode ?? '',
      governorate: client.address.governorate,
      notes: client.notes ?? '',
      isActive: client.isActive,
      creditLimit: client.creditLimit ?? null,
      defaultPaymentTermDays: client.defaultPaymentTermDays ?? null
    });
    this.updateNifValidators();
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.saving.set(true);

    const formValue = this.form.value;

    if (this.isEditMode()) {
      const cleanNif = formValue.nif ? canonicalizeNif(formValue.nif as string) : '';

      const request: UpdateClientRequest = {
        name: formValue.name.trim(),
        email: formValue.email?.trim() || null,
        phone: (formValue.phone as string)?.trim() || undefined,
        nif: cleanNif || undefined,
        type: formValue.type,
        street: formValue.street.trim(),
        streetLine2: (formValue.streetLine2 as string)?.trim() || undefined,
        city: formValue.city.trim(),
        postalCode: (formValue.postalCode as string)?.trim() || undefined,
        governorate: formValue.governorate,
        contactPerson: (formValue.contactPerson as string)?.trim() || undefined,
        notes: (formValue.notes as string)?.trim() || undefined,
        isActive: formValue.isActive,
        creditLimit: formValue.creditLimit ?? null,
        defaultPaymentTermDays: formValue.defaultPaymentTermDays ?? null
      };

      this.clientService.updateClient(this.clientId()!, request).subscribe({
        next: (response) => {
          if (response.success) {
            this.toastService.add({
              severity: 'success',
              summary: $localize`:@@client-form.component.summary.Succès:Succès`,
              detail: $localize`:@@client-form.component.detail.Client_mis_jou:Client mis à jour avec succès`
            });
            this.router.navigate(['/clients', this.clientId()]);
          } else {
            this.toastService.add({
              severity: 'error',
              summary: $localize`:@@client-form.component.summary.Erreur:Erreur`,
              detail: response.errors[0] || $localize`:@@clients.client-form.ts.impossible.de.mettre.a.jour.le.client.fe6146f9:Impossible de mettre à jour le client`
            });
          }
          this.saving.set(false);
        },
        error: (err) => {
          this.saving.set(false);
          this.toastService.add({
            severity: 'error',
            summary: $localize`:@@client-form.component.summary.Erreur:Erreur`,
            detail: err.error?.errors?.[0] || $localize`:@@clients.client-form.ts.impossible.de.mettre.a.jour.le.client.fe6146f9:Impossible de mettre à jour le client`
          });
        }
      });
    } else {
      const cleanNif = formValue.nif ? canonicalizeNif(formValue.nif as string) : '';

      const request: CreateClientRequest = {
        name: formValue.name.trim(),
        email: formValue.email?.trim() || null,
        phone: (formValue.phone as string)?.trim() || undefined,
        nif: cleanNif || undefined,
        type: formValue.type,
        street: formValue.street.trim(),
        streetLine2: (formValue.streetLine2 as string)?.trim() || undefined,
        city: formValue.city.trim(),
        postalCode: (formValue.postalCode as string)?.trim() || undefined,
        governorate: formValue.governorate,
        contactPerson: (formValue.contactPerson as string)?.trim() || undefined,
        notes: (formValue.notes as string)?.trim() || undefined,
        creditLimit: formValue.creditLimit ?? null,
        defaultPaymentTermDays: formValue.defaultPaymentTermDays ?? null
      };

      this.clientService.createClient(request).subscribe({
        next: (response) => {
          if (response.success && response.data) {
            this.toastService.add({
              severity: 'success',
              summary: $localize`:@@client-form.component.summary.Succès:Succès`,
              detail: $localize`:@@client-form.component.detail.Client_cr_Vou:Client créé. Vous pouvez maintenant créer un devis ou une facture.`
            });
            // response.data est un Guid (string), pas un objet Client
            this.router.navigate(['/clients', response.data]);
          } else {
            this.toastService.add({
              severity: 'error',
              summary: $localize`:@@client-form.component.summary.Erreur:Erreur`,
              detail: response.errors[0] || $localize`:@@clients.client-form.ts.impossible.de.creer.le.client.027d8009:Impossible de créer le client`
            });
          }
          this.saving.set(false);
        },
        error: (err) => {
          this.saving.set(false);
          
          // Extraire les erreurs de validation détaillées
          let errorMessage = $localize`:@@clients.client-form.ts.impossible.de.creer.le.client.027d8009:Impossible de créer le client`;
          
          if (err.error?.errors && Array.isArray(err.error.errors) && err.error.errors.length > 0) {
            errorMessage = err.error.errors[0];
          } else if (err.error?.message) {
            errorMessage = err.error.message;
          } else if (err.status === 400) {
            errorMessage = $localize`:@@clients.client-form.ts.les.donnees.fournies.sont.invalides.veui.4905785a:Les données fournies sont invalides. Veuillez vérifier les champs obligatoires et le format du matricule fiscal (NIF).`;
          } else if (err.status === 409) {
            errorMessage = $localize`:@@clients.client-form.ts.un.client.existe.deja.avec.cet.email.ou.6506038c:Un client existe déjà avec cet email ou ce matricule fiscal.`;
          } else if (err.status === 0) {
            errorMessage = $localize`:@@clients.client-form.ts.impossible.de.contacter.le.serveur.verif.56ab13d5:Impossible de contacter le serveur. Vérifiez votre connexion.`;
          }
          
          this.toastService.add({
            severity: 'error',
            summary: $localize`:@@client-form.component.summary.Erreur:Erreur`,
            detail: errorMessage
          });
        }
      });
    }
  }
}
