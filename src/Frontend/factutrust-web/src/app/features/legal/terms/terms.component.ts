import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { ButtonModule } from 'primeng/button';

@Component({
  selector: 'app-terms',
  standalone: true,
  imports: [RouterModule, ButtonModule],
  template: `
    <div class="terms-page">
      <div class="terms-content">
        <h1 i18n="@@legal.terms.conditions.d.utilisation.3e2c6e00">Conditions d'utilisation</h1>
        <p i18n="@@legal.terms.les.conditions.d.utilisation.de.instafact.seront.b251f56d">Les conditions d'utilisation de InstaFact seront disponibles ici. Consultez cette page après la mise en place définitive des mentions légales.</p>
        <p-button label="Retour" icon="pi pi-arrow-left" routerLink="/auth/register"></p-button>
      </div>
    </div>
  `,
  styles: [`
    .terms-page {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--color-neutral-50);
      padding: var(--spacing-6);
    }
    .terms-content {
      max-width: 560px;
      background: var(--color-white);
      padding: var(--spacing-8);
      border-radius: var(--radius-2xl);
      box-shadow: var(--shadow-lg);
    }
    .terms-content h1 {
      margin: 0 0 var(--spacing-4);
      font-size: var(--font-size-2xl);
      color: var(--color-neutral-900);
    }
    .terms-content p {
      margin: 0 0 var(--spacing-4);
      color: var(--color-neutral-700);
      line-height: var(--line-height-relaxed);
    }
  `]
})
export class TermsComponent {}
