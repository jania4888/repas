/// <reference types="@angular/localize" />
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators, FormsModule } from '@angular/forms';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { ToastModule } from 'primeng/toast';
import { ToastService } from '@core/services/toast.service';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { FormSectionComponent } from '@shared/components/form-section/form-section.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import {
  ProductService,
  ProductAttributeValueDto,
  CreateProductAttributeRequest
} from '@core/services/product.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { VARIANT_AXES_PATH } from '../variant-axes.paths';

interface NewValueRow {
  code: string;
  name: string;
}

@Component({
  selector: 'app-product-attribute-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    RouterModule,
    InputTextModule,
    InputNumberModule,
    ToastModule,
    PageHeaderComponent,
    BreadcrumbComponent,
    FormSectionComponent,
    ButtonComponent
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems()"></app-breadcrumb>

    <app-page-header
      [title]="formTitle()"
      [subtitle]="formSubtitle()">
      <app-button variant="outline" icon="pi-times" iconPos="left" [routerLink]="variantAxesPath" i18n="@@settings.variant-axes.annuler.49ba3292"> Annuler </app-button>
    </app-page-header>

    @if (loading()) {
      <div class="loading-container">
        <i class="pi pi-spin pi-spinner"></i>
        <p i18n="@@settings.variant-axes.chargement.a209b664">Chargement...</p>
      </div>
    } @else {
      <form [formGroup]="form" (ngSubmit)="onSubmit()">
        <app-form-section title="Informations" i18n-title="@@settings.variant-axes.informations.54937b3a" icon="pi-tag" [number]="1">
          @if (isEditMode()) {
            <div class="form-group">
              <label i18n="@@settings.variant-axes.code.adac6937">Code</label>
              <input pInputText [value]="attributeCode()" class="w-full" readonly disabled />
              <small class="form-hint" i18n="@@settings.variant-axes.le.code.n.est.pas.modifiable.366c19a3">Le code n'est pas modifiable.</small>
            </div>
          } @else {
            <div class="form-group">
              <label for="code"><ng-container i18n="@@settings.variant-axes.code.adac6937">Code </ng-container> <span class="required" i18n="@@settings.variant-axes.text.df58248c">*</span></label>
              <input pInputText id="code" formControlName="code" placeholder="Ex: SIZE" i18n-placeholder="@@settings.variant-axes.ex.size.394fd236" class="w-full" maxlength="50" />
            </div>
          }
          <div class="form-group">
            <label for="name"><ng-container i18n="@@settings.variant-axes.nom.7ff20370">Nom </ng-container> <span class="required" i18n="@@settings.variant-axes.text.df58248c">*</span></label>
            <input pInputText id="name" formControlName="name" placeholder="Ex: Taille" i18n-placeholder="@@settings.variant-axes.ex.taille.eafec36e" class="w-full" maxlength="100" />
          </div>
        </app-form-section>

        <app-form-section title="Valeurs" i18n-title="@@settings.variant-axes.valeurs.1f2cbf36" icon="pi-list" [number]="2">
          @if (isEditMode()) {
            <table class="values-table">
              <thead>
                <tr>
                  <th i18n="@@settings.variant-axes.code.adac6937">Code</th>
                  <th i18n="@@settings.variant-axes.nom.7ff20370">Nom</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (value of existingValues(); track value.id) {
                  <tr>
                    <td><code>{{ value.code }}</code></td>
                    <td>
                      <input pInputText [(ngModel)]="value.name" [ngModelOptions]="{ standalone: true }" class="w-full" />
                    </td>
                    <td class="actions">
                      <app-button type="button" variant="ghost" size="sm" icon="pi-check" (clicked)="saveValue(value)" i18n="@@settings.variant-axes.enregistrer.f7c8bcd8"> Enregistrer </app-button>
                      <app-button type="button" variant="ghost" size="sm" icon="pi-trash" (clicked)="deleteValue(value)" i18n="@@settings.variant-axes.supprimer.1acfc1c7"> Supprimer </app-button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>

            <h4 class="sub-title" i18n="@@settings.variant-axes.ajouter.une.valeur.8ea96adb">Ajouter une valeur</h4>
            <div class="form-row">
              <input pInputText [(ngModel)]="newValueCode" [ngModelOptions]="{ standalone: true }" placeholder="Code" i18n-placeholder="@@settings.variant-axes.code.adac6937" class="w-full" />
              <input pInputText [(ngModel)]="newValueName" [ngModelOptions]="{ standalone: true }" placeholder="Nom" i18n-placeholder="@@settings.variant-axes.nom.7ff20370" class="w-full" />
              <app-button type="button" variant="outline" icon="pi-plus" (clicked)="addValue()" [disabled]="savingValue()" i18n="@@settings.variant-axes.ajouter.87c57ed1"> Ajouter </app-button>
            </div>
          } @else {
            <p class="form-hint" i18n="@@settings.variant-axes.ajoutez.les.valeurs.initiales.ex.s.m.l.pour.tail.dc1f2157">Ajoutez les valeurs initiales (ex. S, M, L pour Taille).</p>
            @for (row of newValues; track $index; let i = $index) {
              <div class="form-row">
                <input pInputText [(ngModel)]="row.code" [ngModelOptions]="{ standalone: true }" placeholder="Code" i18n-placeholder="@@settings.variant-axes.code.adac6937" class="w-full" />
                <input pInputText [(ngModel)]="row.name" [ngModelOptions]="{ standalone: true }" placeholder="Nom" i18n-placeholder="@@settings.variant-axes.nom.7ff20370" class="w-full" />
                <button type="button" class="btn-icon" (click)="removeNewValue(i)" aria-label="Retirer" i18n-aria-label="@@settings.variant-axes.retirer.54ec24a1">
                  <i class="pi pi-times"></i>
                </button>
              </div>
            }
            <app-button type="button" variant="ghost" size="sm" icon="pi-plus" (clicked)="addNewValueRow()" i18n="@@settings.variant-axes.ajouter.une.valeur.8ea96adb"> Ajouter une valeur </app-button>
          }
        </app-form-section>

        <div class="form-actions">
          <app-button type="submit" variant="primary" icon="pi-check" [disabled]="saving() || form.invalid">
            {{ isEditMode() ? loc_ui_tern_enregistrer_f7c8bc : loc_ui_tern_creer_l_axe_8d2cb9 }}
          </app-button>
        </div>
      </form>
    }
  `,
  styles: [`
    .form-group { margin-bottom: 1rem; }
    .form-hint { color: #64748b; font-size: 0.875rem; }
    .required { color: #dc2626; }
    .form-row {
      display: flex;
      gap: 0.75rem;
      align-items: center;
      margin-bottom: 0.5rem;
    }
    .values-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 1rem;
    }
    .values-table th, .values-table td {
      padding: 0.5rem;
      border-bottom: 1px solid #e2e8f0;
      text-align: left;
    }
    .actions { text-align: right; white-space: nowrap; }
    .sub-title { margin: 1rem 0 0.5rem; font-size: 0.95rem; }
    .form-actions { margin-top: 1.5rem; }
    .loading-container {
      text-align: center;
      padding: 2rem;
      color: #64748b;
    }
    .btn-icon {
      background: none;
      border: none;
      color: #64748b;
      cursor: pointer;
    }
  `]
})
export class ProductAttributeFormComponent implements OnInit {
  readonly loc_ui_tern_enregistrer_f7c8bc = $localize`:@@ui.tern.enregistrer.f7c8bc:Enregistrer`;
  readonly loc_ui_tern_creer_l_axe_8d2cb9 = $localize`:@@ui.tern.creer.l.axe.8d2cb9:Créer l'axe`;
  readonly variantAxesPath = VARIANT_AXES_PATH;
  private fb = inject(FormBuilder);
  private productService = inject(ProductService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private toastService = inject(ToastService);
  private errorHandler = inject(ErrorHandlerService);
  private confirmationService = inject(ConfirmationService);

  form: FormGroup = this.fb.group({
    code: ['', [Validators.required, Validators.maxLength(50)]],
    name: ['', [Validators.required, Validators.maxLength(100)]]
  });

  loading = signal(false);
  saving = signal(false);
  savingValue = signal(false);
  attributeId = signal<string | null>(null);
  attributeCode = signal('');
  existingValues = signal<ProductAttributeValueDto[]>([]);
  newValues: NewValueRow[] = [{ code: '', name: '' }];
  newValueCode = '';
  newValueName = '';

  isEditMode = computed(() => this.attributeId() !== null);

  formTitle = computed(() =>
    this.isEditMode() ? $localize`:@@ui.tern.modifier.l.axe.de.variantes.08ffd6:Modifier l'axe de variantes` : $localize`:@@ui.tern.nouvel.axe.de.variantes.4610a3:Nouvel axe de variantes`
  );
  formSubtitle = computed(() =>
    this.isEditMode()
      ? $localize`:@@ui.tern.modifiez.le.nom.et.les.valeurs.de.cet.axe.82548a:Modifiez le nom et les valeurs de cet axe.`
      : $localize`:@@ui.tern.definissez.un.axe.taille.couleur.etc.et.se.3f2274:Définissez un axe (taille, couleur, etc.) et ses valeurs pour générer les SKU.`
  );

  breadcrumbItems = computed<BreadcrumbItem[]>(() => [
    { label: 'Tableau de bord', route: '/dashboard', icon: 'pi-home' },
    { label: 'Paramètres', route: '/settings' },
    { label: 'Axes de variantes', route: VARIANT_AXES_PATH },
    { label: this.isEditMode() ? $localize`:@@ui.tern.modifier.l.axe.de.variantes.08ffd6:Modifier l'axe de variantes` : $localize`:@@ui.tern.nouvel.axe.de.variantes.4610a3:Nouvel axe de variantes` }
  ]);

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.attributeId.set(id);
      this.form.get('code')?.disable();
      this.loadAttribute(id);
    }
  }

  private loadAttribute(id: string): void {
    this.loading.set(true);
    this.productService.getAttribute(id).subscribe({
      next: res => {
        this.loading.set(false);
        if (!res.success || !res.data) return;
        this.attributeCode.set(res.data.code);
        this.form.patchValue({ name: res.data.name });
        this.existingValues.set(res.data.values.map(v => ({ ...v })));
      },
      error: err => {
        this.loading.set(false);
        this.toastService.add({
          severity: 'error',
          summary: $localize`:@@product-attribute-form.component.summary.Erreur:Erreur`,
          detail: this.errorHandler.extractErrorMessage(err)
        });
      }
    });
  }

  addNewValueRow(): void {
    this.newValues.push({ code: '', name: '' });
  }

  removeNewValue(index: number): void {
    if (this.newValues.length <= 1) return;
    this.newValues.splice(index, 1);
  }

  addValue(): void {
    const id = this.attributeId();
    const code = this.newValueCode.trim();
    const name = this.newValueName.trim();
    if (!id || !code || !name) return;

    this.savingValue.set(true);
    this.productService.addAttributeValue(id, { code, name }).subscribe({
      next: res => {
        this.savingValue.set(false);
        if (res.success) {
          this.newValueCode = '';
          this.newValueName = '';
          this.loadAttribute(id);
          this.toastService.add({ severity: 'success', summary: $localize`:@@product-attribute-form.component.summary.Ajouté:Ajouté`, detail: $localize`:@@product-attribute-form.component.detail.Valeur ajout:Valeur ajoutée` });
        }
      },
      error: err => {
        this.savingValue.set(false);
        this.toastService.add({
          severity: 'error',
          summary: $localize`:@@product-attribute-form.component.summary.Erreur:Erreur`,
          detail: this.errorHandler.extractErrorMessage(err)
        });
      }
    });
  }

  saveValue(value: ProductAttributeValueDto): void {
    const id = this.attributeId();
    if (!id) return;

    this.savingValue.set(true);
    this.productService.updateAttributeValue(id, value.id, { name: value.name.trim() }).subscribe({
      next: res => {
        this.savingValue.set(false);
        if (res.success) {
          this.toastService.add({ severity: 'success', summary: $localize`:@@product-attribute-form.component.summary.Enregistr_:Enregistré`, detail: $localize`:@@product-attribute-form.component.detail.Valeur mise :Valeur mise à jour` });
        }
      },
      error: err => {
        this.savingValue.set(false);
        this.toastService.add({
          severity: 'error',
          summary: $localize`:@@product-attribute-form.component.summary.Erreur:Erreur`,
          detail: this.errorHandler.extractErrorMessage(err)
        });
      }
    });
  }

  deleteValue(value: ProductAttributeValueDto): void {
    const id = this.attributeId();
    if (!id) return;

    this.confirmationService.confirm({
      header: 'Supprimer la valeur',
      message: `Supprimer « ${value.name} » ?`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: $localize`:@@product-attribute-form.component.acceptLabel.Supprimer:Supprimer`,
      rejectLabel: $localize`:@@product-attribute-form.component.rejectLabel.Annuler:Annuler`,
      accept: () => {
        this.productService.deleteAttributeValue(id, value.id).subscribe({
          next: res => {
            if (res.success) {
              this.loadAttribute(id);
              this.toastService.add({ severity: 'success', summary: $localize`:@@product-attribute-form.component.summary.Supprimé:Supprimé`, detail: $localize`:@@product-attribute-form.component.detail.Valeur suppr:Valeur supprimée` });
            }
          },
          error: err => {
            this.toastService.add({
              severity: 'error',
              summary: $localize`:@@product-attribute-form.component.summary.Erreur:Erreur`,
              detail: this.errorHandler.extractErrorMessage(err)
            });
          }
        });
      }
    });
  }

  onSubmit(): void {
    if (this.form.invalid) return;
    this.saving.set(true);

    if (this.isEditMode()) {
      const id = this.attributeId()!;
      this.productService.updateAttribute(id, { name: this.form.get('name')!.value.trim() }).subscribe({
        next: res => {
          this.saving.set(false);
          if (res.success) {
            this.toastService.add({ severity: 'success', summary: $localize`:@@product-attribute-form.component.summary.Enregistr_:Enregistré`, detail: $localize`:@@product-attribute-form.component.detail.axe.de.variantes.mis.a.jour.2224b7ff:Axe de variantes mis à jour` });
            this.router.navigate([VARIANT_AXES_PATH]);
          }
        },
        error: err => {
          this.saving.set(false);
          this.toastService.add({
            severity: 'error',
            summary: $localize`:@@product-attribute-form.component.summary.Erreur:Erreur`,
            detail: this.errorHandler.extractErrorMessage(err)
          });
        }
      });
      return;
    }

    const values = this.newValues
      .map(v => ({ code: v.code.trim(), name: v.name.trim() }))
      .filter(v => v.code && v.name);

    if (values.length === 0) {
      this.saving.set(false);
      this.toastService.add({
        severity: 'warn',
        summary: $localize`:@@product-attribute-form.component.summary.Valeurs requ:Valeurs requises`,
        detail: $localize`:@@product-attribute-form.component.detail.Ajoutez_au_moins:Ajoutez au moins une valeur (ex. S, M, L).`
      });
      return;
    }

    const request: CreateProductAttributeRequest = {
      code: this.form.get('code')!.value.trim(),
      name: this.form.get('name')!.value.trim(),
      values
    };

    this.productService.createAttribute(request).subscribe({
      next: res => {
        this.saving.set(false);
        if (res.success) {
          this.toastService.add({ severity: 'success', summary: $localize`:@@product-attribute-form.component.summary.Créé:Créé`, detail: $localize`:@@product-attribute-form.component.detail.axe.de.variantes.cree.8000945d:Axe de variantes créé` });
          this.router.navigate([VARIANT_AXES_PATH]);
        }
      },
      error: err => {
        this.saving.set(false);
        this.toastService.add({
          severity: 'error',
          summary: $localize`:@@product-attribute-form.component.summary.Erreur:Erreur`,
          detail: this.errorHandler.extractErrorMessage(err)
        });
      }
    });
  }
}
