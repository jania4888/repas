/// <reference types="@angular/localize" />
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputSwitchModule } from 'primeng/inputswitch';
import { ToastModule } from 'primeng/toast';
import { ToastService } from '@core/services/toast.service';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { FormSectionComponent } from '@shared/components/form-section/form-section.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { ErrorMessageService } from '@core/services/error-message.service';
import { ProductCategoryService, CreateProductCategoryRequest, UpdateProductCategoryRequest } from '@core/services/product-category.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';

@Component({
  selector: 'app-product-category-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterModule,
    InputTextModule,
    InputNumberModule,
    InputSwitchModule,
    ToastModule,
    PageHeaderComponent,
    BreadcrumbComponent,
    FormSectionComponent,
    ButtonComponent
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems()"></app-breadcrumb>

    <app-page-header
      [title]="isEditMode() ? loc_ui_tern_modifier_la_categorie_b9c31a : loc_ui_tern_nouvelle_categorie_8c5f92"
      [subtitle]="isEditMode() ? loc_ui_tern_modifiez_les_informations_de_la_categorie_1c40c7 : loc_ui_tern_creez_une_categorie_pour_classer_vos_produ_c1599a">
      <app-button
        variant="outline"
        icon="pi-times"
        iconPos="left"
        routerLink="/product-categories" i18n="@@product-categories.product-category-form.annuler.49ba3292"> Annuler </app-button>
    </app-page-header>

    @if (loading()) {
      <div class="loading-container">
        <i class="pi pi-spin pi-spinner" style="font-size: 2rem;"></i>
        <p i18n="@@product-categories.product-category-form.chargement.a209b664">Chargement...</p>
      </div>
    } @else {
      <form [formGroup]="form" (ngSubmit)="onSubmit()">
        <div class="form-grid">
          <app-form-section title="Informations générales" i18n-title="@@product-categories.product-category-form.informations.generales.be6ba6e5" icon="pi-tag" [number]="1">
            @if (isEditMode()) {
              <div class="form-group">
                <label for="code" i18n="@@product-categories.product-category-form.code.adac6937">Code</label>
                <input
                  pInputText
                  id="code"
                  [value]="form.get('code')?.value"
                  class="w-full"
                  readonly
                  disabled>
                <small class="form-hint" i18n="@@product-categories.product-category-form.le.code.n.est.pas.modifiable.366c19a3">Le code n'est pas modifiable.</small>
              </div>
            } @else {
              <div class="form-group">
                <label for="code"><ng-container i18n="@@product-categories.product-category-form.code.adac6937">Code </ng-container> <span class="required" i18n="@@product-categories.product-category-form.text.df58248c">*</span></label>
                <input
                  pInputText
                  id="code"
                  formControlName="code"
                  placeholder="Ex: SERVICES" i18n-placeholder="@@product-categories.product-category-form.ex.services.14082c60"
                  maxlength="50"
                  class="w-full"
                  [class.ng-invalid]="isInvalid('code')">
                @if (isInvalid('code')) {
                  <div class="form-error">
                    <i class="pi pi-exclamation-circle"></i>
                    <span>{{ errorMessageService.getErrorMessage(form.get('code')) }}</span>
                  </div>
                }
                <small class="form-hint" i18n="@@product-categories.product-category-form.code.unique.en.majuscules.max.50.caracteres.e9a39e13">Code unique, en majuscules (max. 50 caractères).</small>
              </div>
            }

            <div class="form-group">
              <label for="name"><ng-container i18n="@@product-categories.product-category-form.nom.7ff20370">Nom </ng-container> <span class="required" i18n="@@product-categories.product-category-form.text.df58248c">*</span></label>
              <input
                pInputText
                id="name"
                formControlName="name"
                placeholder="Ex: Services" i18n-placeholder="@@product-categories.product-category-form.ex.services.a72bb800"
                maxlength="100"
                class="w-full"
                [class.ng-invalid]="isInvalid('name')">
              @if (isInvalid('name')) {
                <div class="form-error">
                  <i class="pi pi-exclamation-circle"></i>
                  <span>{{ errorMessageService.getErrorMessage(form.get('name')) }}</span>
                </div>
              }
              <small class="form-hint" i18n="@@product-categories.product-category-form.nom.affiche.dans.les.listes.et.le.formulaire.pro.a4010abb">Nom affiché dans les listes et le formulaire produit (max. 100 caractères).</small>
            </div>

            <div class="form-group">
              <label for="displayOrder" i18n="@@product-categories.product-category-form.ordre.d.affichage.6978b883">Ordre d'affichage</label>
              <p-inputNumber
                id="displayOrder"
                formControlName="displayOrder"
                [min]="0"
                [max]="9999"
                [showButtons]="false"
                placeholder="0" i18n-placeholder="@@product-categories.product-category-form.0.b6589fc6"
                styleClass="w-full">
              </p-inputNumber>
              @if (isInvalid('displayOrder')) {
                <div class="form-error">
                  <i class="pi pi-exclamation-circle"></i>
                  <span>{{ errorMessageService.getErrorMessage(form.get('displayOrder')) }}</span>
                </div>
              }
              <small class="form-hint" i18n="@@product-categories.product-category-form.plus.le.nombre.est.petit.plus.la.categorie.appar.df443502">Plus le nombre est petit, plus la catégorie apparaît en premier.</small>
            </div>

            @if (isEditMode()) {
              <div class="form-group">
                <label for="isActive" i18n="@@product-categories.product-category-form.statut.659499f3">Statut</label>
                <div class="status-switch">
                  <p-inputSwitch
                    id="isActive"
                    formControlName="isActive">
                  </p-inputSwitch>
                  <span [class.active]="form.get('isActive')?.value">
                    {{ form.get('isActive')?.value ? loc_ui_tern_actif_2eb75f : loc_ui_tern_inactif_d2e033 }}
                  </span>
                </div>
                <small class="form-hint" i18n="@@product-categories.product-category-form.une.categorie.inactive.n.apparait.plus.dans.le.c.ae1fa8e6">Une catégorie inactive n'apparaît plus dans le choix du formulaire produit.</small>
              </div>
            }
          </app-form-section>
        </div>

        <div class="form-actions">
          <app-button
            variant="outline"
            icon="pi-times"
            iconPos="left"
            routerLink="/product-categories" i18n="@@product-categories.product-category-form.annuler.49ba3292"> Annuler </app-button>
          <app-button
            variant="primary"
            type="submit"
            [icon]="saving() ? 'pi-spin pi-spinner' : 'pi-check'"
            iconPos="left"
            [disabled]="form.invalid || saving()">
            {{ isEditMode() ? loc_ui_tern_enregistrer_f7c8bc : loc_ui_tern_creer_la_categorie_e150d5 }}
          </app-button>
        </div>
      </form>
    }
  `,
  styles: [`
    .loading-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: var(--spacing-12);
      gap: var(--spacing-4);
      color: var(--color-neutral-600);
    }

    .form-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: var(--spacing-4);
    }

    .form-group {
      margin-bottom: var(--spacing-5);
    }

    .form-group:last-child {
      margin-bottom: 0;
    }

    .form-group label {
      display: block;
      margin-bottom: var(--spacing-2);
      font-weight: var(--font-weight-semibold);
      font-size: var(--font-size-sm);
      color: var(--color-text-primary);
    }

    .required {
      color: var(--color-error-600);
      margin-inline-start: var(--spacing-1);
    }

    .form-error {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      margin-top: var(--spacing-1);
      font-size: var(--font-size-sm);
      color: var(--color-error-600);
    }

    .form-hint {
      color: var(--color-neutral-500);
      font-size: var(--font-size-sm);
      margin-top: var(--spacing-1);
      display: block;
    }

    .status-switch {
      display: flex;
      align-items: center;
      gap: var(--spacing-3);
    }

    .status-switch span {
      color: var(--color-neutral-600);
    }

    .status-switch span.active {
      color: var(--color-success-600);
      font-weight: var(--font-weight-medium);
    }

    .form-actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--spacing-4);
      margin-top: var(--spacing-8);
      padding-top: var(--spacing-6);
      border-top: 1px solid var(--color-border-subtle);
    }

    :host ::ng-deep .p-inputnumber {
      width: 100%;
    }

    // Les champs natifs ne sont PAS couverts par la règle ::ng-deep ci-dessus : ils
    // vivent dans ce template, pas dans un composant enfant. Sans cette règle ils
    // restent à leur largeur intrinsèque (~185 px) pendant que le p-inputNumber
    // voisin occupe toute la colonne — les « class="w-full" » posées sur eux ne
    // portent rien (Tailwind est préfixé « tw- », cf. tailwind.config.js).
    .form-group > input[pInputText],
    .form-group > textarea[pTextarea] {
      width: 100%;
    }
  `]
})
export class ProductCategoryFormComponent implements OnInit {
  readonly loc_ui_tern_modifier_la_categorie_b9c31a = $localize`:@@ui.tern.modifier.la.categorie.b9c31a:Modifier la catégorie`;
  readonly loc_ui_tern_nouvelle_categorie_8c5f92 = $localize`:@@ui.tern.nouvelle.categorie.8c5f92:Nouvelle catégorie`;
  readonly loc_ui_tern_modifiez_les_informations_de_la_categorie_1c40c7 = $localize`:@@ui.tern.modifiez.les.informations.de.la.categorie.1c40c7:Modifiez les informations de la catégorie.`;
  readonly loc_ui_tern_creez_une_categorie_pour_classer_vos_produ_c1599a = $localize`:@@ui.tern.creez.une.categorie.pour.classer.vos.produ.c1599a:Créez une catégorie pour classer vos produits.`;
  readonly loc_ui_tern_actif_2eb75f = $localize`:@@ui.tern.actif.2eb75f:Actif`;
  readonly loc_ui_tern_inactif_d2e033 = $localize`:@@ui.tern.inactif.d2e033:Inactif`;
  readonly loc_ui_tern_enregistrer_f7c8bc = $localize`:@@ui.tern.enregistrer.f7c8bc:Enregistrer`;
  readonly loc_ui_tern_creer_la_categorie_e150d5 = $localize`:@@ui.tern.creer.la.categorie.e150d5:Créer la catégorie`;
  private fb = inject(FormBuilder);
  private productCategoryService = inject(ProductCategoryService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private toastService = inject(ToastService);
  private errorHandler = inject(ErrorHandlerService);

  errorMessageService = inject(ErrorMessageService);

  loading = signal(false);
  saving = signal(false);
  categoryId = signal<string | null>(null);

  isEditMode = computed(() => !!this.categoryId());

  breadcrumbItems = computed<BreadcrumbItem[]>(() => {
    const base: BreadcrumbItem[] = [
      { label: $localize`:@@product-categories.product-category-form.ts.tableau.de.bord.a524057f:Tableau de bord`, route: '/dashboard', icon: 'pi-home' },
      { label: $localize`:@@product-categories.product-category-form.ts.categories.d463d7d2:Catégories`, route: '/product-categories' }
    ];
    if (this.isEditMode()) {
      base.push({ label: $localize`:@@product-categories.product-category-form.ts.modifier.la.categorie.b9c31a75:Modifier la catégorie` });
    } else {
      base.push({ label: $localize`:@@product-categories.product-category-form.ts.nouvelle.categorie.8c5f928e:Nouvelle catégorie` });
    }
    return base;
  });

  form: FormGroup = this.fb.group({
    code: ['', [Validators.required, Validators.maxLength(50)]],
    name: ['', [Validators.required, Validators.maxLength(100)]],
    displayOrder: [0, [Validators.required, Validators.min(0)]],
    isActive: [true]
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.categoryId.set(id);
      this.loadCategory(id);
    } else {
      this.loading.set(false);
    }
  }

  private loadCategory(id: string): void {
    this.loading.set(true);
    this.productCategoryService.getCategoryById(id).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.form.patchValue({
            code: response.data.code,
            name: response.data.name,
            displayOrder: response.data.displayOrder,
            isActive: response.data.isActive
          });
        } else {
          this.toastService.add({
            severity: 'error',
            summary: $localize`:@@product-category-form.component.summary.Erreur:Erreur`,
            detail: $localize`:@@product-category-form.component.detail.Cat_gorie_non_tr:Catégorie non trouvée`
          });
          this.router.navigate(['/product-categories']);
        }
        this.loading.set(false);
      },
      error: (err) => {
        const msg = this.errorHandler.extractErrorMessage(err);
        this.toastService.add({
          severity: 'error',
          summary: $localize`:@@product-category-form.component.summary.Erreur:Erreur`,
          detail: msg || $localize`:@@product-categories.product-category-form.ts.impossible.de.charger.la.categorie.e756ad05:Impossible de charger la catégorie`
        });
        this.router.navigate(['/product-categories']);
        this.loading.set(false);
      }
    });
  }

  isInvalid(field: string): boolean {
    const control = this.form.get(field);
    return !!(control?.invalid && control?.touched);
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.saving.set(true);
    const formValue = this.form.value;

    if (this.isEditMode()) {
      const request: UpdateProductCategoryRequest = {
        name: (formValue.name as string).trim(),
        displayOrder: Number(formValue.displayOrder) ?? 0,
        isActive: !!formValue.isActive
      };
      this.productCategoryService.updateCategory(this.categoryId()!, request).subscribe({
        next: (response) => {
          if (response.success) {
            this.toastService.add({
              severity: 'success',
              summary: $localize`:@@product-category-form.component.summary.Succès:Succès`,
              detail: response.message || $localize`:@@product-categories.product-category-form.ts.categorie.mise.a.jour.6c887ee2:Catégorie mise à jour.`
            });
            this.router.navigate(['/product-categories']);
          } else {
            this.toastService.add({
              severity: 'error',
              summary: $localize`:@@product-category-form.component.summary.Erreur:Erreur`,
              detail: response.errors?.join(', ') || response.message || $localize`:@@product-categories.product-category-form.ts.impossible.de.mettre.a.jour.la.categorie.25dbddc0:Impossible de mettre à jour la catégorie`
            });
          }
          this.saving.set(false);
        },
        error: (err) => {
          const msg = this.errorHandler.extractErrorMessage(err);
          this.toastService.add({
            severity: 'error',
            summary: $localize`:@@product-category-form.component.summary.Erreur:Erreur`,
            detail: msg || $localize`:@@product-categories.product-category-form.ts.impossible.de.mettre.a.jour.la.categorie.25dbddc0:Impossible de mettre à jour la catégorie`
          });
          this.saving.set(false);
        }
      });
    } else {
      const code = (formValue.code as string).trim().toUpperCase();
      const request: CreateProductCategoryRequest = {
        code,
        name: (formValue.name as string).trim(),
        displayOrder: Number(formValue.displayOrder) ?? 0
      };
      this.productCategoryService.createCategory(request).subscribe({
        next: (response) => {
          if (response.success && response.data) {
            this.toastService.add({
              severity: 'success',
              summary: $localize`:@@product-category-form.component.summary.Succès:Succès`,
              detail: response.message || $localize`:@@product-categories.product-category-form.ts.categorie.creee.avec.succes.1cd52beb:Catégorie créée avec succès.`
            });
            this.router.navigate(['/product-categories']);
          } else {
            this.toastService.add({
              severity: 'error',
              summary: $localize`:@@product-category-form.component.summary.Erreur:Erreur`,
              detail: response.errors?.join(', ') || response.message || $localize`:@@product-categories.product-category-form.ts.impossible.de.creer.la.categorie.1ee25d75:Impossible de créer la catégorie`
            });
          }
          this.saving.set(false);
        },
        error: (err) => {
          const status = err?.status;
          const msg = this.errorHandler.extractErrorMessage(err);
          if (status === 409) {
            this.toastService.add({
              severity: 'error',
              summary: $localize`:@@product-category-form.component.summary.Conflit:Conflit`,
              detail: msg || $localize`:@@product-categories.product-category-form.ts.une.categorie.existe.deja.avec.ce.code.f3791d5d:Une catégorie existe déjà avec ce code.`
            });
          } else {
            this.toastService.add({
              severity: 'error',
              summary: $localize`:@@product-category-form.component.summary.Erreur:Erreur`,
              detail: msg || $localize`:@@product-categories.product-category-form.ts.impossible.de.creer.la.categorie.1ee25d75:Impossible de créer la catégorie`
            });
          }
          this.saving.set(false);
        }
      });
    }
  }
}
