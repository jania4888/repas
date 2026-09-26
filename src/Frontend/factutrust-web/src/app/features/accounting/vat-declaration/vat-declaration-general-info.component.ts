import { Component, Input, inject } from '@angular/core';

import { CommonModule } from '@angular/common';

import { VatDeclarationDto } from '../services/accounting.service';

import { AuthService } from '@core/services/auth.service';

import { formatDateFr, formatPeriodLabel, resolveCompanyDisplay } from './vat-declaration.view-model';



@Component({

  selector: 'app-vat-declaration-general-info',

  standalone: true,

  imports: [CommonModule],

  template: `

    <div class="card vat-zone-card">

      <h3 class="vat-zone-title" i18n="@@accounting.vat-declaration.1.informations.generales.a7d9a44c">1. Informations générales</h3>

      <div class="vat-info-grid">

        <div class="vat-info-item">

          <span class="vat-info-label" i18n="@@accounting.vat-declaration.periode.de2110b7">Période</span>

          <span class="vat-info-value">{{ periodLabel }}</span>

        </div>

        <div class="vat-info-item">

          <span class="vat-info-label" i18n="@@accounting.vat-declaration.type.de.declaration.1cfe4f4c">Type de déclaration</span>

          <span class="vat-info-value">{{ declaration?.declarationTypeDisplay ?? '—' }}</span>

        </div>

        <div class="vat-info-item">

          <span class="vat-info-label" i18n="@@accounting.vat-declaration.devise.eb2e42c4">Devise</span>

          <span class="vat-info-value">{{ declaration?.currency ?? '—' }}</span>

        </div>

        <div class="vat-info-item">

          <span class="vat-info-label" i18n="@@accounting.vat-declaration.date.limite.de.depot.b80613d2">Date limite de dépôt</span>

          <span class="vat-info-value">{{ filingDeadlineLabel }}</span>

        </div>

        <div class="vat-info-item">

          <span class="vat-info-label" i18n="@@accounting.vat-declaration.societe.2c3fdad8">Société</span>

          <span class="vat-info-value">{{ companyDisplay.companyName }}</span>

        </div>

        <div class="vat-info-item">

          <span class="vat-info-label" i18n="@@accounting.vat-declaration.matricule.fiscal.304096c4">Matricule fiscal</span>

          <span class="vat-info-value">{{ companyDisplay.nif ?? '—' }}</span>

        </div>

        <div class="vat-info-item">

          <span class="vat-info-label" i18n="@@accounting.vat-declaration.regime.d.imposition.46563a5a">Régime d'imposition</span>

          <span class="vat-info-value">{{ companyDisplay.taxRegimeDisplay ?? '—' }}</span>

        </div>

        <div class="vat-info-item">

          <span class="vat-info-label" i18n="@@accounting.vat-declaration.activite.principale.137743e2">Activité principale</span>

          <span class="vat-info-value">{{ companyDisplay.tradeName ?? '—' }}</span>

        </div>

      </div>

    </div>

  `,

  styles: `

    .vat-zone-card { padding: var(--spacing-5); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); margin-bottom: var(--spacing-4); }

    .vat-zone-title { font-size: var(--font-size-md); font-weight: var(--font-weight-semibold); margin: 0 0 var(--spacing-4); color: var(--color-text-primary); }

    .vat-info-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr)); gap: var(--spacing-4); }

    .vat-info-item { display: flex; flex-direction: column; gap: var(--spacing-1); min-width: 0; }

    .vat-info-label { font-size: var(--font-size-xs); font-weight: var(--font-weight-medium); color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.02em; }

    .vat-info-value { font-size: var(--font-size-sm); color: var(--color-text-primary); font-weight: var(--font-weight-medium); }

  `

})

export class VatDeclarationGeneralInfoComponent {

  private readonly auth = inject(AuthService);



  @Input() declaration: VatDeclarationDto | null = null;

  @Input() year = new Date().getFullYear();

  @Input() month = new Date().getMonth() + 1;



  get periodLabel(): string {

    return formatPeriodLabel(this.year, this.month);

  }



  get filingDeadlineLabel(): string {

    return formatDateFr(this.declaration?.filingDeadline);

  }



  get companyDisplay() {

    return resolveCompanyDisplay(this.declaration, null, this.auth.user());

  }

}


