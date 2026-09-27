import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { AuthService } from '@core/services/auth.service';
import { ErrorMessageService } from '@core/services/error-message.service';
import { AuthShellComponent } from '../auth-shell/auth-shell.component';
import { RESET_PASSWORD_AUTH_SHELL_CONFIG } from '../auth-shell/auth-shell.config';

function passwordsMatch(control: AbstractControl): ValidationErrors | null {
  const password = control.get('newPassword')?.value;
  const confirm = control.get('confirmPassword')?.value;
  if (password && confirm && password !== confirm) {
    return { passwordMismatch: true };
  }
  return null;
}

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterModule,
    InputTextModule,
    PasswordModule,
    ButtonModule,
    MessageModule,
    AuthShellComponent,
  ],
  templateUrl: './reset-password.component.html',
  styleUrl: './reset-password.component.scss',
})
export class ResetPasswordComponent implements OnInit {
  readonly shellConfig = RESET_PASSWORD_AUTH_SHELL_CONFIG;

  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  errorMessageService = inject(ErrorMessageService);

  loading = signal(false);
  error = signal<string | null>(null);
  tokenMissing = signal(false);

  email = '';
  token = '';

  form = this.fb.group(
    {
      newPassword: ['', [Validators.required, Validators.minLength(12)]],
      confirmPassword: ['', Validators.required],
    },
    { validators: passwordsMatch }
  );

  ngOnInit(): void {
    this.email = this.route.snapshot.queryParams['email'] ?? '';
    this.token = this.route.snapshot.queryParams['token'] ?? '';
    if (!this.email || !this.token) {
      this.tokenMissing.set(true);
    }
  }

  isFieldInvalid(name: 'newPassword' | 'confirmPassword'): boolean {
    const c = this.form.get(name);
    return !!(c?.invalid && c.touched);
  }

  onSubmit(): void {
    if (this.tokenMissing()) {
      return;
    }

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    const { newPassword, confirmPassword } = this.form.getRawValue();
    this.authService
      .resetPassword({
        email: this.email,
        token: this.token,
        newPassword: newPassword!,
        confirmNewPassword: confirmPassword!,
      })
      .subscribe({
        next: (response) => {
          if (response.success) {
            void this.router.navigate(['/auth/login'], {
              queryParams: { reset: 'success' },
            });
          } else {
            this.error.set(response.errors[0] || $localize`:@@auth.reset-password.ts.une.erreur.est.survenue.0419f56e:Une erreur est survenue`);
          }
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
        },
      });
  }
}
