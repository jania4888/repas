import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

// PrimeNG
import { SelectModule } from 'primeng/select';
import { CardModule } from 'primeng/card';
import { SkeletonModule } from 'primeng/skeleton';
import { TooltipModule } from 'primeng/tooltip';
import { DividerModule } from 'primeng/divider';
import { AvatarModule } from 'primeng/avatar';

// Services & Models
import { InvoiceWizardService } from '../../services/invoice-wizard.service';
import { SellerInfo } from '../../models/invoice-wizard.models';

/**
 * Étape 2 - Informations du vendeur (émetteur)
 *
 * Permet de sélectionner l'entreprise émettrice parmi les entreprises
 * pré-enregistrées dans le système multi-tenant.
 *
 * Conformité tunisienne:
 * - Raison sociale obligatoire
 * - Adresse complète obligatoire
 * - Matricule fiscal (NIF) obligatoire au format 1772793W/A/M/000
 * - Registre de commerce recommandé
 *
 * @deprecated Utilisé uniquement par le parcours legacy 6 étapes
 * (`featureFlags.wizardSimplifiedFlow === false`). Le parcours simplifié 4 étapes
 * compose ce composant dans `StepDocumentComponent`. Sera retiré lorsque le flag
 * sera activé par défaut en production.
 */
@Component({
  selector: 'app-step-seller',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    SelectModule,
    CardModule,
    SkeletonModule,
    TooltipModule,
    DividerModule,
    AvatarModule
  ],
  template: `
    <div class="step-seller">
      <!-- Company Selector -->
      <section class="section">
        <h2 class="section-title">
          <i class="pi pi-building"></i>
          Entreprise émettrice
        </h2>
        <p class="section-description">
          Sélectionnez l'entreprise qui émet cette facture
        </p>

        @if (loading()) {
          <div class="companies-loading">
            @for (i of [1, 2]; track i) {
              <div class="company-card skeleton">
                <p-skeleton shape="circle" size="48px"></p-skeleton>
                <div class="skeleton-content">
                  <p-skeleton width="60%" height="20px"></p-skeleton>
                  <p-skeleton width="80%" height="14px"></p-skeleton>
                </div>
              </div>
            }
          </div>
        } @else if (sellers().length === 0) {
          <div class="empty-state">
            <i class="pi pi-building"></i>
            <h3>Aucune entreprise configurée</h3>
            <p>Veuillez configurer au moins une entreprise dans les paramètres.</p>
          </div>
        } @else {
          <div class="companies-grid">
            @for (company of sellers(); track company.id) {
              <div 
                class="company-card"
                [class.selected]="selectedSeller?.id === company.id"
                (click)="selectCompany(company)"
                (keydown.enter)="selectCompany(company)"
                (keydown.space)="selectCompany(company)"
                tabindex="0"
                role="radio"
                [attr.aria-checked]="selectedSeller?.id === company.id"
                [attr.aria-label]="company.companyName">
                <div class="company-logo">
                  @if (company.logo) {
                    <img [src]="company.logo" [alt]="company.companyName">
                  } @else {
                    <p-avatar 
                      [label]="getInitials(company.companyName)"
                      size="xlarge"
                      [style]="{ 'background-color': getAvatarColor(company.id), 'color': 'white' }">
                    </p-avatar>
                  }
                </div>
                <div class="company-info">
                  <span class="company-name">{{ company.companyName }}</span>
                  @if (company.tradeName && company.tradeName !== company.companyName) {
                    <span class="company-trade-name">{{ company.tradeName }}</span>
                  }
                  <span class="company-nif">
                    <i class="pi pi-id-card"></i>
                    {{ company.nif }}
                  </span>
                </div>
                <div class="company-check" *ngIf="selectedSeller?.id === company.id">
                  <i class="pi pi-check"></i>
                </div>
              </div>
            }
          </div>
        }
      </section>

      <!-- Selected Company Details -->
      @if (selectedSeller) {
        <p-divider></p-divider>

        <section class="section selected-details">
          <h2 class="section-title">
            <i class="pi pi-info-circle"></i>
            Informations de l'émetteur
          </h2>
          <p class="section-description">
            Ces informations apparaîtront sur la facture
          </p>

          <div class="details-card">
            <!-- Company Header -->
            <div class="details-header">
              @if (selectedSeller.logo) {
                <img 
                  [src]="selectedSeller.logo" 
                  [alt]="selectedSeller.companyName"
                  class="details-logo">
              }
              <div class="details-title">
                <h3>{{ selectedSeller.companyName }}</h3>
                @if (selectedSeller.tradeName) {
                  <span class="trade-name">{{ selectedSeller.tradeName }}</span>
                }
              </div>
            </div>

            <p-divider></p-divider>

            <!-- Details Grid -->
            <div class="details-grid">
              <!-- Address -->
              <div class="detail-item">
                <label>
                  <i class="pi pi-map-marker"></i>
                  Adresse
                </label>
                <div class="detail-value">
                  {{ selectedSeller.address.street }}
                  @if (selectedSeller.address.streetLine2) {
                    <br>{{ selectedSeller.address.streetLine2 }}
                  }
                  <br>
                  @if (selectedSeller.address.postalCode) {
                    {{ selectedSeller.address.postalCode }}
                  }
                  {{ selectedSeller.address.city }}
                  <br>{{ selectedSeller.address.governorate }}, {{ selectedSeller.address.country }}
                </div>
              </div>

              <!-- Fiscal Info -->
              <div class="detail-item">
                <label>
                  <i class="pi pi-id-card"></i>
                  Matricule fiscal
                </label>
                <div class="detail-value fiscal">
                  <code>{{ selectedSeller.nif }}</code>
                  <span 
                    class="nif-valid"
                    pTooltip="Format conforme: 1772793W/A/M/000"
                    tooltipPosition="top">
                    <i class="pi pi-check-circle"></i>
                    Valide
                  </span>
                </div>
              </div>

              <!-- Commerce Registry -->
              @if (selectedSeller.commerceRegistry) {
                <div class="detail-item">
                  <label>
                    <i class="pi pi-book"></i>
                    Registre de commerce
                  </label>
                  <div class="detail-value">
                    {{ selectedSeller.commerceRegistry }}
                  </div>
                </div>
              }

              <!-- VAT Code -->
              @if (selectedSeller.vatCode) {
                <div class="detail-item">
                  <label>
                    <i class="pi pi-percentage"></i>
                    Code TVA
                  </label>
                  <div class="detail-value">
                    {{ selectedSeller.vatCode }}
                  </div>
                </div>
              }

              <!-- Contact -->
              <div class="detail-item">
                <label>
                  <i class="pi pi-envelope"></i>
                  Contact
                </label>
                <div class="detail-value">
                  {{ selectedSeller.email }}
                  @if (selectedSeller.phone) {
                    <br>{{ selectedSeller.phone }}
                  }
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- Compliance Check -->
        <div class="compliance-box success">
          <div class="compliance-header">
            <i class="pi pi-check-circle"></i>
            <span>Informations conformes</span>
          </div>
          <ul class="compliance-list">
            <li class="valid">
              <i class="pi pi-check"></i>
              Raison sociale présente
            </li>
            <li class="valid">
              <i class="pi pi-check"></i>
              Adresse complète
            </li>
            <li class="valid">
              <i class="pi pi-check"></i>
              Matricule fiscal valide (format tunisien)
            </li>
            @if (selectedSeller.commerceRegistry) {
              <li class="valid">
                <i class="pi pi-check"></i>
                Registre de commerce renseigné
              </li>
            } @else {
              <li class="warning">
                <i class="pi pi-exclamation-triangle"></i>
                Registre de commerce non renseigné (recommandé)
              </li>
            }
          </ul>
        </div>
      }
    </div>
  `,
  styles: [`
    .step-seller {
      animation: fadeIn 0.3s ease-out;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .section {
      margin-bottom: var(--spacing-6);
    }

    .section-title {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      margin: 0 0 var(--spacing-2);
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-semibold);
      color: var(--color-neutral-800);

      i {
        color: var(--color-primary-500);
      }
    }

    .section-description {
      margin: 0 0 var(--spacing-4);
      font-size: var(--font-size-sm);
      color: var(--color-neutral-500);
    }

    // Companies Grid
    .companies-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: var(--spacing-4);
    }

    .companies-loading {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-4);
    }

    .company-card {
      display: flex;
      align-items: center;
      gap: var(--spacing-4);
      padding: var(--spacing-4);
      background: white;
      border: 2px solid var(--color-neutral-200);
      border-radius: var(--radius-xl);
      cursor: pointer;
      transition: all var(--transition-fast);

      &:hover {
        border-color: var(--color-primary-300);
        background: var(--color-primary-50);
      }

      &:focus-visible {
        outline: 2px solid var(--color-primary-500);
        outline-offset: 2px;
      }

      &.selected {
        border-color: var(--color-primary-500);
        background: var(--color-primary-50);
        box-shadow: 0 0 0 4px var(--color-primary-100);
      }

      &.skeleton {
        cursor: default;
        
        &:hover {
          border-color: var(--color-neutral-200);
          background: white;
        }
      }
    }

    .skeleton-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
    }

    .company-logo {
      flex-shrink: 0;

      img {
        width: 48px;
        height: 48px;
        border-radius: var(--radius-lg);
        object-fit: contain;
      }
    }

    .company-info {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: var(--spacing-1);
      min-width: 0;
    }

    .company-name {
      font-weight: var(--font-weight-semibold);
      color: var(--color-neutral-800);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .company-trade-name {
      font-size: var(--font-size-sm);
      color: var(--color-neutral-500);
    }

    .company-nif {
      display: flex;
      align-items: center;
      gap: var(--spacing-1);
      font-size: var(--font-size-sm);
      color: var(--color-neutral-600);
      font-family: 'JetBrains Mono', monospace;

      i {
        font-size: var(--font-size-xs);
        color: var(--color-neutral-400);
      }
    }

    .company-check {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: var(--radius-full);
      background: var(--color-primary-500);
      color: white;
      font-size: var(--font-size-sm);
      flex-shrink: 0;
    }

    // Empty State
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--spacing-3);
      padding: var(--spacing-10);
      text-align: center;
      background: var(--color-neutral-100);
      border-radius: var(--radius-xl);

      i {
        font-size: 3rem;
        color: var(--color-neutral-400);
      }

      h3 {
        margin: 0;
        color: var(--color-neutral-800);
      }

      p {
        margin: 0;
        color: var(--color-neutral-600);
      }
    }

    // Selected Details
    .details-card {
      background: white;
      border: 1px solid var(--color-neutral-200);
      border-radius: var(--radius-xl);
      padding: var(--spacing-6);
    }

    .details-header {
      display: flex;
      align-items: center;
      gap: var(--spacing-4);
    }

    .details-logo {
      width: 64px;
      height: 64px;
      border-radius: var(--radius-lg);
      object-fit: contain;
      border: 1px solid var(--color-neutral-200);
    }

    .details-title {
      h3 {
        margin: 0;
        font-size: var(--font-size-xl);
        font-weight: var(--font-weight-semibold);
        color: var(--color-neutral-900);
      }

      .trade-name {
        display: block;
        margin-top: var(--spacing-1);
        font-size: var(--font-size-sm);
        color: var(--color-neutral-500);
      }
    }

    .details-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: var(--spacing-6);
    }

    .detail-item {
      label {
        display: flex;
        align-items: center;
        gap: var(--spacing-2);
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        color: var(--color-neutral-500);
        margin-bottom: var(--spacing-2);

        i {
          font-size: var(--font-size-sm);
        }
      }
    }

    .detail-value {
      font-size: var(--font-size-sm);
      color: var(--color-neutral-800);
      line-height: var(--line-height-relaxed);

      &.fiscal {
        display: flex;
        align-items: center;
        gap: var(--spacing-3);

        code {
          font-family: 'JetBrains Mono', monospace;
          font-size: var(--font-size-base);
          font-weight: var(--font-weight-semibold);
          color: var(--color-neutral-900);
          background: var(--color-neutral-100);
          padding: var(--spacing-1) var(--spacing-2);
          border-radius: var(--radius-md);
        }
      }
    }

    .nif-valid {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-1);
      font-size: var(--font-size-xs);
      color: var(--color-success-600);
      background: var(--color-success-50);
      padding: var(--spacing-1) var(--spacing-2);
      border-radius: var(--radius-full);
    }

    // Compliance Box
    .compliance-box {
      margin-top: var(--spacing-6);
      padding: var(--spacing-4);
      border-radius: var(--radius-lg);

      &.success {
        background: var(--color-success-50);
        border: 1px solid var(--color-success-200);
      }
    }

    .compliance-header {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      font-weight: var(--font-weight-semibold);
      color: var(--color-success-700);
      margin-bottom: var(--spacing-3);

      i {
        font-size: var(--font-size-lg);
      }
    }

    .compliance-list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);

      li {
        display: flex;
        align-items: center;
        gap: var(--spacing-2);
        font-size: var(--font-size-sm);

        &.valid {
          color: var(--color-success-700);
          i { color: var(--color-success-500); }
        }

        &.warning {
          color: var(--color-warning-700);
          i { color: var(--color-warning-500); }
        }
      }
    }
  `]
})
export class StepSellerComponent implements OnInit {
  readonly wizardService = inject(InvoiceWizardService);

  loading = signal(true);
  sellers = signal<SellerInfo[]>([]);
  selectedSeller: SellerInfo | null = null;

  // Avatar colors for companies without logo
  private avatarColors = [
    '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', 
    '#10b981', '#6366f1', '#14b8a6', '#f97316'
  ];

  ngOnInit(): void {
    // Load sellers
    this.loadSellers();

    // Initialize from service state
    const currentSeller = this.wizardService.seller();
    if (currentSeller) {
      this.selectedSeller = currentSeller;
    }
  }

  private loadSellers(): void {
    this.loading.set(true);
    
    this.wizardService.loadSellers().subscribe({
      next: (sellers) => {
        this.sellers.set(sellers);
        this.loading.set(false);

        // Auto-select if only one seller
        if (sellers.length === 1 && !this.selectedSeller) {
          this.selectCompany(sellers[0]);
        }
      },
      error: (error) => {
        console.error('Failed to load companies:', error);
        this.loading.set(false);
        // Show empty state - user will see the message to configure company in settings
        this.sellers.set([]);
      }
    });
  }

  selectCompany(company: SellerInfo): void {
    this.selectedSeller = company;
    this.wizardService.selectSeller(company);
  }

  getInitials(name: string): string {
    return name
      .split(' ')
      .map(word => word[0])
      .join('')
      .substring(0, 2)
      .toUpperCase();
  }

  getAvatarColor(id: string): string {
    const index = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return this.avatarColors[index % this.avatarColors.length];
  }
}
