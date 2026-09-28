import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { AuthService } from '@core/services/auth.service';
import { ErrorMessageService } from '@core/services/error-message.service';
import { AuthShellComponent } from '../auth-shell/auth-shell.component';
import { FORGOT_PASSWORD_AUTH_SHELL_CONFIG } from '../auth-shell/auth-shell.config';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterModule,
    InputTextModule,
    ButtonModule,
    MessageModule,
    AuthShellComponent,
  ],
  templateUrl: './forgot-password.component.html',
  styleUrl: './forgot-password.component.scss',
})
export class ForgotPasswordComponent {
  readonly shellConfig = FORGOT_PASSWORD_AUTH_SHELL_CONFIG;

  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  errorMessageService = inject(ErrorMessageService);

  loading = signal(false);
  error = signal<string | null>(null);
  submitted = signal(false);

  form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
  });

  isEmailInvalid(): boolean {
    const c = this.form.get('email');
    return !!(c?.invalid && c.touched);
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    const email = this.form.get('email')!.value!;
    this.authService.forgotPassword(email).subscribe({
      next: (response) => {
        if (response.success) {
          this.submitted.set(true);
        } else {
          this.error.set(response.errors[0] || $localize`:@@auth.forgot-password.ts.une.erreur.est.survenue.0419f56e:Une erreur est survenue`);
        }
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      },
    });
  }
}
