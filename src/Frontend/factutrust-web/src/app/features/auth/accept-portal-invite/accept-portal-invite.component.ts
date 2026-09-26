import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '@core/services/auth.service';
import { PortalService } from '@features/portal/portal.service';
import { AuthShellComponent } from '../auth-shell/auth-shell.component';
import { PORTAL_INVITE_AUTH_SHELL_CONFIG } from '../auth-shell/auth-shell.config';
import { PasswordModule } from 'primeng/password';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';

@Component({
  selector: 'app-accept-portal-invite',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, AuthShellComponent, PasswordModule, ButtonModule, MessageModule],
  template: `
    <app-auth-shell [config]="shellConfig">
      <div class="auth-form-card-header">
        <h2 i18n="@@auth.accept-portal-invite.activer.l.espace.client.d7a22239">Activer l’espace client</h2>
        <p i18n="@@auth.accept-portal-invite.choisissez.un.mot.de.passe.12.caracteres.minimum.8a188e70">Choisissez un mot de passe (12 caractères minimum) pour consulter vos factures.</p>
      </div>
      @if (error()) {
        <p-message severity="error" [text]="error()!" />
      }
      <form [formGroup]="form" (ngSubmit)="submit()">
        <label for="password" i18n="@@auth.accept-portal-invite.mot.de.passe.94e2f3ee">Mot de passe</label>
        <p-password inputId="password" formControlName="password" [toggleMask]="true" [feedback]="false" styleClass="w-full" />
        <label for="confirmPassword" i18n="@@auth.accept-portal-invite.confirmation.3424edc2">Confirmation</label>
        <p-password inputId="confirmPassword" formControlName="confirmPassword" [toggleMask]="true" [feedback]="false" styleClass="w-full" />
        <p-button type="submit" label="Activer mon accès" [loading]="loading()" [disabled]="form.invalid" />
      </form>
    </app-auth-shell>
  `
})
export class AcceptPortalInviteComponent implements OnInit {
  readonly shellConfig = PORTAL_INVITE_AUTH_SHELL_CONFIG;

  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly portal = inject(PortalService);
  private readonly auth = inject(AuthService);

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  private token = '';

  readonly form = this.fb.nonNullable.group({
    password: ['', [Validators.required, Validators.minLength(12)]],
    confirmPassword: ['', Validators.required]
  });

  ngOnInit(): void {
    this.token = this.route.snapshot.queryParamMap.get('token') ?? '';
    if (!this.token) {
      this.error.set('Lien d’invitation incomplet.');
    }
  }

  submit(): void {
    if (this.form.invalid || !this.token) return;
    const { password, confirmPassword } = this.form.getRawValue();
    if (password !== confirmPassword) {
      this.error.set('Les mots de passe ne correspondent pas.');
      return;
    }
    this.loading.set(true);
    this.portal.acceptInvite({ token: this.token, password, confirmPassword }).subscribe({
      next: response => {
        this.auth.applyAuthResponse(response);
        void this.router.navigateByUrl('/portal');
      },
      error: err => {
        this.loading.set(false);
        this.error.set(err?.error?.errors?.[0] || err?.error?.message || 'Invitation invalide ou expirée.');
      }
    });
  }
}
