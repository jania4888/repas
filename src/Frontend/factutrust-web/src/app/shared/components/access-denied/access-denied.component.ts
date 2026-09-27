import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { ButtonModule } from 'primeng/button';

@Component({
  selector: 'app-access-denied',
  standalone: true,
  imports: [RouterModule, ButtonModule],
  template: `
    <div class="access-denied">
      <div class="access-denied-content">
        <h1 class="code">403</h1>
        <h2 class="title" i18n="@@shared.components.access-denied.access-denied.acces.refuse.db4ecaf4">Accès refusé</h2>
        <p class="message" i18n="@@shared.components.access-denied.access-denied.votre.compte.n.inclut.pas.les.droits.necessaires.ab8053df"> Votre compte n’inclut pas les droits nécessaires pour cette section. Contactez un administrateur
          si vous pensez qu’il s’agit d’une erreur. </p>
        <p-button label="Tableau de bord" i18n-label="Tableau de bord" icon="pi pi-home" routerLink="/dashboard" />
      </div>
    </div>
  `,
  styles: [
    `
      .access-denied {
        min-height: 60vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-4);
      }
      .access-denied-content {
        text-align: center;
        max-width: 420px;
      }
      .code {
        font-size: 5rem;
        font-weight: var(--font-weight-bold);
        color: var(--color-danger-600, #b91c1c);
        line-height: 1;
        margin-bottom: var(--spacing-3);
      }
      .title {
        font-size: var(--font-size-2xl);
        color: var(--color-neutral-800);
        margin-bottom: var(--spacing-2);
      }
      .message {
        color: var(--color-neutral-600);
        margin-bottom: var(--spacing-6);
        line-height: 1.5;
      }
    `
  ]
})
export class AccessDeniedComponent {}
