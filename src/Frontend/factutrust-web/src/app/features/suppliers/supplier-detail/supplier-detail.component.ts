/// <reference types="@angular/localize" />
import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { ToastService } from '@core/services/toast.service';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { SupplierService, Supplier, SupplierRs7IsBracket } from '@core/services/supplier.service';
import {
  normalizeSupplierRs7IsBracket,
  rs7BracketLabel
} from '@core/services/supplier-rs7-enums';

@Component({
  selector: 'app-supplier-detail',
  standalone: true,
  imports: [
    CommonModule, RouterModule, TagModule, ToastModule,
    PageHeaderComponent, BreadcrumbComponent, ButtonComponent
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems"></app-breadcrumb>

    @if (loading()) {
      <div class="loading-container">
        <i class="pi pi-spin pi-spinner" style="font-size: 2rem"></i>
        <p i18n="@@suppliers.supplier-detail.chargement.a209b664">Chargement...</p>
      </div>
    } @else if (supplier()) {
      <app-page-header
        [title]="supplier()!.name"
        [subtitle]="supplier()!.typeDisplay">
        <div class="header-actions">
          <app-button variant="secondary" icon="pi-pencil" iconPos="left"
            [routerLink]="['edit']" i18n="@@suppliers.supplier-detail.modifier.f260e757"> Modifier </app-button>
          <app-button variant="outline"
            [icon]="supplier()!.isActive ? 'pi-ban' : 'pi-check'"
            iconPos="left"
            (click)="toggleActive()">
            {{ supplier()!.isActive ? loc_ui_tern_desactiver_d28397 : loc_ui_tern_activer_b96fa7 }}
          </app-button>
        </div>
      </app-page-header>

      <div class="detail-grid">
        <div class="detail-card">
          <h3 class="card-title" i18n="@@suppliers.supplier-detail.informations.47db4ff5"><i class="pi pi-user"></i> Informations</h3>
          <div class="info-grid">
            <div class="info-item">
              <span class="label" i18n="@@suppliers.supplier-detail.type.3deb7456">Type</span>
              <p-tag [value]="supplier()!.typeDisplay"
                [severity]="supplier()!.type === 1 ? 'success' : 'info'"></p-tag>
            </div>
            <div class="info-item">
              <span class="label" i18n="@@suppliers.supplier-detail.nif.77124a3a">NIF</span>
              <span class="value mono">{{ supplier()!.nif || '-' }}</span>
            </div>
            <div class="info-item">
              <span class="label" i18n="@@suppliers.supplier-detail.statut.659499f3">Statut</span>
              <p-tag [value]="supplier()!.isActive ? loc_ui_tern_actif_2eb75f : loc_ui_tern_inactif_d2e033"
                [severity]="supplier()!.isActive ? 'success' : 'secondary'"></p-tag>
            </div>
            <div class="info-item" i18n="@@suppliers.supplier-detail.delai.paiement.jours.6763f071">
              <span class="label">Délai paiement</span>
              <span class="value">{{ supplier()!.paymentTermDays }} jours</span>
            </div>
          </div>
        </div>

        <div class="detail-card">
          <h3 class="card-title" i18n="@@suppliers.supplier-detail.contact.d472ee2a"><i class="pi pi-envelope"></i> Contact</h3>
          <div class="info-grid">
            <div class="info-item">
              <span class="label" i18n="@@suppliers.supplier-detail.email.84add5b2">Email</span>
              @if (supplier()!.email) {
                <a [href]="'mailto:' + supplier()!.email" class="value link">{{ supplier()!.email }}</a>
              } @else {
                <span class="value" i18n="@@suppliers.supplier-detail.text.1b93795b">—</span>
              }
            </div>
            <div class="info-item">
              <span class="label" i18n="@@suppliers.supplier-detail.telephone.d3b023ea">Téléphone</span>
              <span class="value">{{ supplier()!.phone || '-' }}</span>
            </div>
            <div class="info-item">
              <span class="label" i18n="@@suppliers.supplier-detail.contact.b37456c4">Contact</span>
              <span class="value">{{ supplier()!.contactPerson || '-' }}</span>
            </div>
          </div>
        </div>

        <div class="detail-card full-width">
          <h3 class="card-title" i18n="@@suppliers.supplier-detail.adresse.3959f649"><i class="pi pi-map-marker"></i> Adresse</h3>
          <p class="address-text">{{ supplier()!.address.fullAddress }}</p>
        </div>

        <div class="detail-card full-width">
          <h3 class="card-title" i18n="@@suppliers.supplier-detail.retenue.a.la.source.tej.80fd887a"><i class="pi pi-percentage"></i> Retenue à la source &amp; TEJ</h3>
          <div class="info-grid">
            <div class="info-item">
              <span class="label" i18n="@@suppliers.supplier-detail.soumis.a.la.rs.6a5c753b">Soumis à la RS</span>
              <span class="value">{{ supplier()!.isSubjectToWithholding ? loc_ui_tern_oui_eaa02f : loc_ui_tern_non_a72199 }}</span>
            </div>
            <div class="info-item">
              <span class="label" i18n="@@suppliers.supplier-detail.tranche.is.rs7.bd637bb1">Tranche IS (RS7)</span>
              <span class="value">{{ rs7Label(supplier()!) }}</span>
            </div>
            @if (withholdingTypeLabel(supplier()!)) {
              <div class="info-item">
                <span class="label" i18n="@@suppliers.supplier-detail.type.rs.par.defaut.b08fa503">Type RS par défaut</span>
                <span class="value">{{ withholdingTypeLabel(supplier()!) }}</span>
              </div>
            }
            <div class="info-item">
              <span class="label" i18n="@@suppliers.supplier-detail.resident.0a384a50">Résident</span>
              <span class="value">{{ supplier()!.isResident !== false ? loc_ui_tern_oui_eaa02f : loc_ui_tern_non_a72199 }}</span>
            </div>
            <div class="info-item">
              <span class="label" i18n="@@suppliers.supplier-detail.pays.fiscal.9bd89515">Pays (fiscal)</span>
              <span class="value mono">{{ supplier()!.countryCode || 'TN' }}</span>
            </div>
          </div>
        </div>

        @if (supplier()!.notes) {
          <div class="detail-card full-width">
            <h3 class="card-title" i18n="@@suppliers.supplier-detail.notes.e4c25cd5"><i class="pi pi-file-edit"></i> Notes</h3>
            <p class="notes-text">{{ supplier()!.notes }}</p>
          </div>
        }
      </div>
    }
  `,
  styles: [`
    .loading-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: var(--spacing-12);
      color: var(--color-text-secondary);
      gap: var(--spacing-3);
    }

    .header-actions {
      display: flex;
      gap: var(--spacing-2);
    }

    .detail-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: var(--spacing-4);
    }

    .detail-card {
      background: var(--color-background-elevated);
      border-radius: var(--radius-xl);
      padding: var(--spacing-5);
      box-shadow: var(--shadow-md);
      border: 1px solid var(--color-border-subtle);

      &.full-width {
        grid-column: 1 / -1;
      }
    }

    .card-title {
      font-size: var(--font-size-base);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
      margin: 0 0 var(--spacing-4) 0;
      display: flex;
      align-items: center;
      gap: var(--spacing-2);

      i { color: var(--color-primary-600); }
    }

    .info-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: var(--spacing-4);
    }

    .info-item {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-1);

      .label {
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
        color: var(--color-text-tertiary);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .value {
        font-size: var(--font-size-sm);
        color: var(--color-text-primary);

        &.mono {
          font-family: 'JetBrains Mono', monospace;
        }

        &.link {
          color: var(--color-primary-600);
          text-decoration: none;
          &:hover { text-decoration: underline; }
        }
      }
    }

    .address-text, .notes-text {
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
      line-height: 1.6;
      margin: 0;
    }
  `]
})
export class SupplierDetailComponent implements OnInit {
  readonly loc_ui_tern_desactiver_d28397 = $localize`:@@ui.tern.desactiver.d28397:Désactiver`;
  readonly loc_ui_tern_activer_b96fa7 = $localize`:@@ui.tern.activer.b96fa7:Activer`;
  readonly loc_ui_tern_actif_2eb75f = $localize`:@@ui.tern.actif.2eb75f:Actif`;
  readonly loc_ui_tern_inactif_d2e033 = $localize`:@@ui.tern.inactif.d2e033:Inactif`;
  readonly loc_ui_tern_oui_eaa02f = $localize`:@@ui.tern.oui.eaa02f:Oui`;
  readonly loc_ui_tern_non_a72199 = $localize`:@@ui.tern.non.a72199:Non`;
  rs7Label(s: Supplier): string {
    const bracket = normalizeSupplierRs7IsBracket(s.rs7IsBracket);
    return rs7BracketLabel(bracket) ?? '—';
  }

  withholdingTypeLabel(s: Supplier): string | null {
    const bracket = normalizeSupplierRs7IsBracket(s.rs7IsBracket);
    if (bracket !== SupplierRs7IsBracket.Unspecified) {
      return null;
    }

    return s.defaultWithholdingTaxTypeLabel ?? null;
  }

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private supplierService = inject(SupplierService);
  private toastService = inject(ToastService);

  loading = signal(true);
  supplier = signal<Supplier | null>(null);

  breadcrumbItems: BreadcrumbItem[] = [
    { label: $localize`:@@suppliers.supplier-detail.ts.tableau.de.bord.a524057f:Tableau de bord`, route: '/dashboard', icon: 'pi-home' },
    { label: $localize`:@@suppliers.supplier-detail.ts.fournisseurs.06b6d88c:Fournisseurs`, route: '/suppliers' },
    { label: $localize`:@@suppliers.supplier-detail.ts.detail.7ce06afc:Détail` }
  ];

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.loadSupplier(id);
    }
  }

  private loadSupplier(id: string): void {
    this.supplierService.getSupplier(id).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.supplier.set(response.data);
          this.breadcrumbItems = [
            { label: $localize`:@@suppliers.supplier-detail.ts.tableau.de.bord.a524057f:Tableau de bord`, route: '/dashboard', icon: 'pi-home' },
            { label: $localize`:@@suppliers.supplier-detail.ts.fournisseurs.06b6d88c:Fournisseurs`, route: '/suppliers' },
            { label: response.data.name }
          ];
        }
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.toastService.add({ severity: 'error', summary: $localize`:@@supplier-detail.component.summary.Erreur:Erreur`, detail: $localize`:@@supplier-detail.component.detail.Fournisseur_intr:Fournisseur introuvable` });
        this.router.navigate(['/suppliers']);
      }
    });
  }

  toggleActive(): void {
    const s = this.supplier();
    if (!s) return;

    this.supplierService.toggleActive(s.id).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.supplier.set(response.data);
          this.toastService.add({
            severity: 'success',
            summary: $localize`:@@supplier-detail.component.summary.Succès:Succès`,
            detail: response.data.isActive ? $localize`:@@ui.tern.fournisseur.active.6689d6:Fournisseur activé` : $localize`:@@ui.tern.fournisseur.desactive.e68961:Fournisseur désactivé`
          });
        }
      },
      error: () => {
        this.toastService.add({ severity: 'error', summary: $localize`:@@supplier-detail.component.summary.Erreur:Erreur`, detail: $localize`:@@supplier-detail.component.detail.Erreur_lors_du_c:Erreur lors du changement de statut` });
      }
    });
  }
}
