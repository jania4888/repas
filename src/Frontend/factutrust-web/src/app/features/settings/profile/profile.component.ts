/// <reference types="@angular/localize" />
import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { DividerModule } from 'primeng/divider';
import { AvatarModule } from 'primeng/avatar';
import { ToastService } from '@core/services/toast.service';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { ErrorMessageService } from '@core/services/error-message.service';
import { AuthService } from '@core/services/auth.service';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [BackendLabelPipe, 
    CommonModule,
    ReactiveFormsModule,
    RouterModule,
    InputTextModule,
    PasswordModule,
    ButtonModule,
    CardModule,
    DividerModule,
    AvatarModule,
    PageHeaderComponent,
    BreadcrumbComponent
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems"></app-breadcrumb>
    
    <app-page-header 
      title="Mon profil" i18n-title="@@settings.profile.mon.profil.faa6d321" 
      subtitle="Gérez vos informations personnelles" i18n-subtitle="@@settings.profile.gerez.vos.informations.personnelles.add55929">
      <p-button 
        label="Retour" i18n-label="@@settings.profile.retour.e5befb1f" 
        icon="pi pi-arrow-left" 
        [outlined]="true"
        routerLink="/settings">
      </p-button>
    </app-page-header>

    <div class="profile-grid">
      <!-- Profile Info -->
      <p-card header="Informations personnelles" i18n-header="@@settings.profile.informations.personnelles.e1e05861" styleClass="profile-card">
        <div class="profile-header">
          <p-avatar 
            [label]="getInitials()"
            size="xlarge"
            styleClass="profile-avatar">
          </p-avatar>
          <div class="profile-info">
            <h3>{{ user()?.fullName }}</h3>
            <p>{{ user()?.email }}</p>
            <span class="role-badge">{{ user()?.roleDisplay | backendLabel }}</span>
          </div>
        </div>

        <p-divider></p-divider>

        <form [formGroup]="profileForm" (ngSubmit)="saveProfile()">
          <div class="form-row">
            <div class="form-group">
              <label for="firstName" i18n="@@settings.profile.prenom.e4387ade">Prénom</label>
              <input 
                pInputText 
                id="firstName" 
                formControlName="firstName"
                class="w-full">
            </div>

            <div class="form-group">
              <label for="lastName" i18n="@@settings.profile.nom.7ff20370">Nom</label>
              <input 
                pInputText 
                id="lastName" 
                formControlName="lastName"
                class="w-full">
            </div>
          </div>

          <div class="form-group">
            <label for="email" i18n="@@settings.profile.adresse.email.bdf1cc95">Adresse email</label>
            <input 
              pInputText 
              id="email" 
              type="email"
              formControlName="email"
              class="w-full">
          </div>

          <div class="form-actions">
            <p-button 
              type="submit"
              label="Enregistrer" i18n-label="@@settings.profile.enregistrer.f7c8bcd8" 
              icon="pi pi-check"
              [loading]="savingProfile()"
              [disabled]="profileForm.invalid">
            </p-button>
          </div>
        </form>
      </p-card>

      <!-- Security -->
      <p-card header="Sécurité" i18n-header="@@settings.profile.securite.33e96f02" styleClass="security-card">
        <form [formGroup]="passwordForm" (ngSubmit)="changePassword()">
          <div class="form-group">
            <label for="currentPassword" i18n="@@settings.profile.mot.de.passe.actuel.f9242976">Mot de passe actuel</label>
            <p-password 
              id="currentPassword" 
              formControlName="currentPassword"
              [feedback]="false"
              [toggleMask]="true"
              styleClass="w-full"
              inputStyleClass="w-full">
            </p-password>
          </div>

          <div class="form-group">
            <label for="newPassword" i18n="@@settings.profile.nouveau.mot.de.passe.3a713829">Nouveau mot de passe</label>
            <p-password 
              id="newPassword" 
              formControlName="newPassword"
              [toggleMask]="true"
              styleClass="w-full"
              inputStyleClass="w-full"
              promptLabel="Saisissez un nouveau mot de passe"
              weakLabel="Faible"
              mediumLabel="Moyen"
              strongLabel="Fort">
            </p-password>
            <small class="form-hint" i18n="@@settings.profile.minimum.8.caracteres.avec.majuscule.et.chiffre.3751ab62">Minimum 8 caractères avec majuscule et chiffre</small>
          </div>

          <div class="form-group">
            <label for="confirmPassword" i18n="@@settings.profile.confirmer.le.mot.de.passe.88362d0d">Confirmer le mot de passe</label>
            <p-password 
              id="confirmPassword" 
              formControlName="confirmPassword"
              [feedback]="false"
              [toggleMask]="true"
              styleClass="w-full"
              inputStyleClass="w-full">
            </p-password>
          </div>

          <div class="form-actions">
            <p-button 
              type="submit"
              label="Changer le mot de passe" i18n-label="@@settings.profile.changer.le.mot.de.passe.4ad8d631" 
              icon="pi pi-lock"
              [loading]="savingPassword()"
              [disabled]="passwordForm.invalid">
            </p-button>
          </div>
        </form>

        <p-divider></p-divider>

        <div class="two-factor-section">
          <div class="two-factor-info">
            <h4 i18n="@@settings.profile.authentification.a.deux.facteurs.96e8851a">Authentification à deux facteurs</h4>
            <p i18n="@@settings.profile.ajoutez.une.couche.de.securite.supplementaire.a..d93ba706">Ajoutez une couche de sécurité supplémentaire à votre compte</p>
          </div>
          <p-button 
            [label]="user()?.twoFactorEnabled ? loc_ui_tern_desactiver_d28397 : loc_ui_tern_activer_b96fa7"
            [outlined]="true"
            [severity]="user()?.twoFactorEnabled ? 'danger' : 'success'"
            icon="pi pi-shield">
          </p-button>
        </div>
      </p-card>
    </div>

  `,
  styles: [`
    .profile-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: var(--spacing-6);

      @media (max-width: 1024px) {
        grid-template-columns: 1fr;
      }
    }

    .profile-header {
      display: flex;
      align-items: center;
      gap: var(--spacing-4);
      margin-bottom: var(--spacing-4);
    }

    .profile-info {
      h3 {
        margin: 0 0 var(--spacing-1);
        font-size: var(--font-size-xl);
        font-weight: var(--font-weight-semibold);
        color: var(--color-neutral-900);
      }

      p {
        margin: 0 0 var(--spacing-2);
        color: var(--color-neutral-600);
      }

      .role-badge {
        display: inline-block;
        padding: var(--spacing-1) var(--spacing-3);
        background: var(--color-primary-100);
        color: var(--color-primary-700);
        border-radius: var(--radius-full);
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
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

      label {
        display: block;
        margin-bottom: var(--spacing-2);
        font-weight: var(--font-weight-medium);
        color: var(--color-neutral-700);
      }
    }

    .form-hint {
      color: var(--color-neutral-500);
      font-size: var(--font-size-sm);
      margin-top: var(--spacing-1);
      display: block;
    }

    .form-actions {
      display: flex;
      justify-content: flex-end;
      margin-top: var(--spacing-4);
    }

    .two-factor-section {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: var(--spacing-4);

      h4 {
        margin: 0 0 var(--spacing-1);
        font-size: var(--font-size-base);
        color: var(--color-neutral-800);
      }

      p {
        margin: 0;
        font-size: var(--font-size-sm);
        color: var(--color-neutral-500);
      }
    }

    :host ::ng-deep {
      .profile-avatar {
        background: var(--color-primary-500);
        font-size: 1.5rem;
      }

      .profile-card,
      .security-card {
        .p-card-header {
          padding: var(--spacing-4) var(--spacing-5);
          border-bottom: 1px solid var(--color-neutral-200);
          font-weight: var(--font-weight-semibold);
        }

        .p-card-body {
          padding: var(--spacing-5);
        }
      }

      .p-password {
        width: 100%;
      }
    }
  `]
})
export class ProfileComponent implements OnInit {
  readonly loc_ui_tern_desactiver_d28397 = $localize`:@@ui.tern.desactiver.d28397:Désactiver`;
  readonly loc_ui_tern_activer_b96fa7 = $localize`:@@ui.tern.activer.b96fa7:Activer`;
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private toastService = inject(ToastService);
  errorMessageService = inject(ErrorMessageService);

  breadcrumbItems: BreadcrumbItem[] = [
    { label: 'Tableau de bord', route: '/dashboard', icon: 'pi-home' },
    { label: 'Paramètres', route: '/settings' },
    { label: 'Mon profil' }
  ];

  user = this.authService.user;
  savingProfile = signal(false);
  savingPassword = signal(false);

  profileForm: FormGroup = this.fb.group({
    firstName: ['', Validators.required],
    lastName: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]]
  });

  passwordForm: FormGroup = this.fb.group({
    currentPassword: ['', Validators.required],
    newPassword: ['', [Validators.required, Validators.minLength(8)]],
    confirmPassword: ['', Validators.required]
  });

  ngOnInit(): void {
    const user = this.user();
    if (user) {
      this.profileForm.patchValue({
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email
      });
    }
  }

  getInitials(): string {
    const user = this.user();
    if (!user) return '';
    return `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}`.toUpperCase();
  }

  saveProfile(): void {
    if (this.profileForm.invalid) return;

    this.savingProfile.set(true);
    
    // Simulated - Replace with actual API call
    setTimeout(() => {
      this.toastService.add({
        severity: 'success',
        summary: $localize`:@@profile.component.summary.Succès:Succès`,
        detail: $localize`:@@profile.component.detail.Profil mis à:Profil mis à jour avec succès`
      });
      this.savingProfile.set(false);
    }, 1000);
  }

  changePassword(): void {
    if (this.passwordForm.invalid) return;

    const { newPassword, confirmPassword } = this.passwordForm.value;
    if (newPassword !== confirmPassword) {
      this.toastService.add({
        severity: 'error',
        summary: $localize`:@@profile.component.summary.Erreur:Erreur`,
        detail: $localize`:@@profile.component.detail.Les_mots_de_pass:Les mots de passe ne correspondent pas`
      });
      return;
    }

    this.savingPassword.set(true);
    
    // Simulated - Replace with actual API call
    setTimeout(() => {
      this.toastService.add({
        severity: 'success',
        summary: $localize`:@@profile.component.summary.Succès:Succès`,
        detail: $localize`:@@profile.component.detail.Mot de passe:Mot de passe modifié avec succès`
      });
      this.passwordForm.reset();
      this.savingPassword.set(false);
    }, 1000);
  }
}
