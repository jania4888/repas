/// <reference types="@angular/localize" />
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { DialogModule } from 'primeng/dialog';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { SkeletonTableComponent, SkeletonColumn } from '@shared/components/skeleton/skeleton-table.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { PricingService, PriceListListItem } from '@core/services/pricing.service';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { AuthService } from '@core/services/auth.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { PERMISSIONS } from '@core/config/permission-keys';

@Component({
  selector: 'app-price-list-list',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    TableModule,
    ButtonModule,
    InputTextModule,
    TagModule,
    TooltipModule,
    DialogModule,
    PageHeaderComponent,
    BreadcrumbComponent,
    SkeletonTableComponent,
    EmptyStateComponent,
    ButtonComponent
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems"></app-breadcrumb>

    <app-page-header
      title="Grilles tarifaires" i18n-title="@@pricing.price-list-list.grilles.tarifaires.21b96006"
      subtitle="Définissez des jeux de prix par produit, puis affectez-les à vos clients. Un client sans grille reste au tarif catalogue." i18n-subtitle="@@pricing.price-list-list.definissez.des.jeux.de.prix.par.produit.1a213349">
      @if (canCreate()) {
        <app-button variant="primary" icon="pi-plus" iconPos="left" (clicked)="openCreate()" i18n="@@pricing.price-list-list.nouvelle.grille.a8012b9e"> Nouvelle grille </app-button>
      }
    </app-page-header>

    @if (loading()) {
      <app-skeleton-table [columns]="skeletonColumns" [rows]="5"></app-skeleton-table>
    } @else if (priceLists().length === 0) {
      <app-empty-state
        icon="pi-tags"
        title="Aucune grille tarifaire" i18n-title="@@pricing.price-list-list.aucune.grille.tarifaire.0625f0f9"
        message="Créez une grille pour appliquer des prix négociés à un groupe de clients." i18n-message="@@pricing.price-list-list.creez.une.grille.pour.appliquer.des.prix.f422ab1c">
      </app-empty-state>
    } @else {
      <div class="ft-table-card">
        <p-table [value]="priceLists()" [rowHover]="true" styleClass="ft-table">
          <ng-template pTemplate="header">
            <tr>
              <th i18n="@@pricing.price-list-list.nom.7ff20370">Nom</th>
              <th class="ft-num" i18n="@@pricing.price-list-list.produits.48000473">Produits</th>
              <th i18n="@@pricing.price-list-list.validite.8be7d506">Validité</th>
              <th i18n="@@pricing.price-list-list.devise.eb2e42c4">Devise</th>
              <th i18n="@@pricing.price-list-list.etat.d3b28a2a">État</th>
              <th class="ft-actions-col" i18n="@@pricing.price-list-list.actions.c3cd636a">Actions</th>
            </tr>
          </ng-template>

          <ng-template pTemplate="body" let-row>
            <tr>
              <td>
                <a [routerLink]="[row.id]" class="ft-link">{{ row.name }}</a>
              </td>
              <td class="ft-num">{{ row.itemCount }}</td>
              <td>{{ validityLabel(row) }}</td>
              <td>{{ row.currency }}</td>
              <td>
                @if (!row.isActive) {
                  <p-tag severity="secondary" value="Désactivée"></p-tag>
                } @else if (!row.isApplicableToday) {
                  <p-tag
                    severity="warn"
                    value="Hors période"
                    pTooltip="Grille active mais en dehors de sa période de validité : elle n'applique aucun prix aujourd'hui." i18n-pTooltip="@@pricing.price-list-list.grille.active.mais.en.dehors.de.sa.periode.de.va.77529196"></p-tag>
                } @else {
                  <p-tag severity="success" value="Applicable"></p-tag>
                }
              </td>
              <td class="ft-actions-col">
                <button
                  pButton
                  type="button"
                  icon="pi pi-pencil"
                  class="p-button-text p-button-sm"
                  pTooltip="Ouvrir" i18n-pTooltip="@@pricing.price-list-list.ouvrir.42c07747"
                  [routerLink]="[row.id]"></button>
                @if (canDelete()) {
                  <button
                    pButton
                    type="button"
                    icon="pi pi-trash"
                    class="p-button-text p-button-sm p-button-danger"
                    pTooltip="Supprimer" i18n-pTooltip="@@pricing.price-list-list.supprimer.1acfc1c7"
                    (click)="confirmDelete(row)"></button>
                }
              </td>
            </tr>
          </ng-template>
        </p-table>
      </div>
    }

    <!-- Création -->
    <p-dialog
      header="Nouvelle grille tarifaire" i18n-header="@@pricing.price-list-list.nouvelle.grille.tarifaire.236ac2fe"
      [(visible)]="createVisible"
      [modal]="true"
      [style]="{ width: '32rem' }"
      [draggable]="false">
      <div class="ft-form-grid">
        <div class="ft-field">
          <label for="pl-name"><ng-container i18n="@@pricing.price-list-list.nom.7ff20370">Nom </ng-container> <span class="ft-required" i18n="@@pricing.price-list-list.text.df58248c">*</span></label>
          <input id="pl-name" pInputText [(ngModel)]="form.name" maxlength="100" />
        </div>

        <div class="ft-field">
          <label for="pl-from" i18n="@@pricing.price-list-list.debut.de.validite.10f1f74c">Début de validité</label>
          <input id="pl-from" type="date" pInputText [(ngModel)]="form.validFrom" />
        </div>

        <div class="ft-field">
          <label for="pl-until" i18n="@@pricing.price-list-list.fin.de.validite.3cfa7402">Fin de validité</label>
          <input id="pl-until" type="date" pInputText [(ngModel)]="form.validUntil" />
          <small class="ft-hint" i18n="@@pricing.price-list-list.laissez.vide.pour.une.grille.sans.limite.de.date.1ce1488a">Laissez vide pour une grille sans limite de date.</small>
        </div>
      </div>

      <ng-template pTemplate="footer">
        <app-button variant="secondary" (clicked)="createVisible = false" i18n="@@pricing.price-list-list.annuler.49ba3292">Annuler</app-button>
        <app-button
          variant="primary"
          [disabled]="!form.name.trim() || saving()"
          (clicked)="create()" i18n="@@pricing.price-list-list.creer.1a686172"> Créer </app-button>
      </ng-template>
    </p-dialog>
  `
})
export class PriceListListComponent implements OnInit {
  private readonly pricingService = inject(PricingService);
  private readonly toastService = inject(ToastService);
  private readonly errorHandler = inject(ErrorHandlerService);
  private readonly auth = inject(AuthService);
  private readonly confirmationService = inject(ConfirmationService);

  readonly priceLists = signal<PriceListListItem[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);

  createVisible = false;
  form = { name: '', validFrom: '', validUntil: '' };

  readonly canCreate = computed(() => this.auth.hasPermission(PERMISSIONS.pricing.create));
  readonly canDelete = computed(() => this.auth.hasPermission(PERMISSIONS.pricing.delete));

  readonly breadcrumbItems: BreadcrumbItem[] = [
    { label: $localize`:@@pricing.price-list-list.ts.ventes.9087fc4f:Ventes` },
    { label: $localize`:@@pricing.price-list-list.ts.grilles.tarifaires.21b96006:Grilles tarifaires` }
  ];

  readonly skeletonColumns: SkeletonColumn[] = [
    { width: '30%' },
    { width: '10%' },
    { width: '25%' },
    { width: '10%' },
    { width: '15%' },
    { width: '10%' }
  ];

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.pricingService.getPriceLists().subscribe({
      next: res => {
        this.priceLists.set(res.data ?? []);
        this.loading.set(false);
      },
      error: err => {
        this.showError(err, $localize`:@@pricing.price-list-list.ts.impossible.de.charger.les.grilles.tarifa.0668bab1:Impossible de charger les grilles tarifaires`);
        this.errorHandler.logError('Failed to load price lists', err);
        this.priceLists.set([]);
        this.loading.set(false);
      }
    });
  }

  validityLabel(row: PriceListListItem): string {
    if (!row.validFrom && !row.validUntil) return $localize`:@@pricing.price-list-list.ts.sans.limite.b90ed767:Sans limite`;
    const from = row.validFrom ? new Date(row.validFrom).toLocaleDateString('fr-TN') : '…';
    const until = row.validUntil ? new Date(row.validUntil).toLocaleDateString('fr-TN') : '…';
    return `${from} → ${until}`;
  }

  openCreate(): void {
    this.form = { name: '', validFrom: '', validUntil: '' };
    this.createVisible = true;
  }

  create(): void {
    this.saving.set(true);
    this.pricingService
      .createPriceList({
        name: this.form.name.trim(),
        validFrom: this.form.validFrom || null,
        validUntil: this.form.validUntil || null
      })
      .subscribe({
        next: () => {
          this.toastService.add({
            severity: 'success',
            summary: $localize`:@@price-list-list.component.summary.Succ_s:Succès`,
            detail: $localize`:@@price-list-list.component.detail.grille.tarifaire.creee.5749befd:Grille tarifaire créée.`
          });
          this.createVisible = false;
          this.saving.set(false);
          this.load();
        },
        error: err => {
          this.showError(err, $localize`:@@pricing.price-list-list.ts.impossible.de.creer.la.grille.292f9062:Impossible de créer la grille`);
          this.errorHandler.logError('Create price list failed', err);
          this.saving.set(false);
        }
      });
  }

  confirmDelete(row: PriceListListItem): void {
    this.confirmationService.confirm({
      header: $localize`:@@pricing.price-list-list.ts.supprimer.la.grille.5dc9e31f:Supprimer la grille`,
      message: $localize`:@@pricing.price-list-list.ts.supprimer.definitivement.la.grille.name.85f0cd97:Supprimer définitivement la grille « ${row.name}:name: » ?`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: $localize`:@@price-list-list.component.acceptLabel.Supprimer:Supprimer`,
      rejectLabel: $localize`:@@price-list-list.component.rejectLabel.Annuler:Annuler`,
      acceptButtonStyleClass: 'btn-danger',
      accept: () => this.delete(row)
    });
  }

  private delete(row: PriceListListItem): void {
    this.pricingService.deletePriceList(row.id).subscribe({
      next: () => {
        this.toastService.add({
          severity: 'success',
          summary: $localize`:@@price-list-list.component.summary.Succ_s:Succès`,
          detail: $localize`:@@price-list-list.component.detail.grille.tarifaire.supprimee.160dd522:Grille tarifaire supprimée.`
        });
        this.load();
      },
      // Le serveur refuse la suppression d'une grille encore affectée : son message dit
      // quoi faire (retirer l'affectation, ou désactiver plutôt que supprimer).
      error: err => {
        this.showError(err, $localize`:@@pricing.price-list-list.ts.suppression.impossible.55762ff2:Suppression impossible`);
        this.errorHandler.logError('Delete price list failed', err);
      }
    });
  }

  private showError(err: unknown, fallback: string): void {
    const msg = this.errorHandler.extractErrorMessage(err);
    this.toastService.add({
      severity: 'error',
      summary: $localize`:@@price-list-list.component.summary.Erreur:Erreur`,
      detail: msg || fallback
    });
  }
}
