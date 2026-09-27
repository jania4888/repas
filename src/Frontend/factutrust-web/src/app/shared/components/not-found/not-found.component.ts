import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { ButtonModule } from 'primeng/button';

@Component({
  selector: 'app-not-found',
  standalone: true,
  imports: [RouterModule, ButtonModule],
  template: `
    <div class="not-found">
      <div class="not-found-content">
        <h1 class="error-code">404</h1>
        <h2 class="error-title" i18n="@@shared.components.not-found.not-found.page.non.trouvee.314ec33e">Page non trouvée</h2>
        <p class="error-message" i18n="@@shared.components.not-found.not-found.la.page.que.vous.recherchez.n.existe.pas.ou.a.et.177090fb"> La page que vous recherchez n'existe pas ou a été déplacée. </p>
        <p-button 
          label="Retour à l'accueil" i18n-label="@@shared.components.not-found.not-found.retour.a.l.accueil.a3cb7af7" 
          icon="pi pi-home" 
          routerLink="/dashboard">
        </p-button>
      </div>
    </div>
  `,
  styles: [`
    .not-found {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--color-neutral-50);
      padding: var(--spacing-4);
    }

    .not-found-content {
      text-align: center;
      max-width: 400px;
    }

    .error-code {
      font-size: 8rem;
      font-weight: var(--font-weight-bold);
      color: var(--color-primary-600);
      line-height: 1;
      margin-bottom: var(--spacing-4);
    }

    .error-title {
      font-size: var(--font-size-2xl);
      color: var(--color-neutral-800);
      margin-bottom: var(--spacing-2);
    }

    .error-message {
      color: var(--color-neutral-600);
      margin-bottom: var(--spacing-6);
    }
  `]
})
export class NotFoundComponent {}
