/// <reference types="@angular/localize" />
import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { SelectModule } from 'primeng/select';
import { DialogModule } from 'primeng/dialog';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { CheckboxModule } from 'primeng/checkbox';
import { CardModule } from 'primeng/card';
import { forkJoin } from 'rxjs';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import {
  APP_MODULE_OPTIONS,
  AppModule,
  CreateTenantUserItem,
  ModuleCatalogFeatureDto,
  ModuleCatalogModuleDto,
  TenantUsersService,
  UserModuleAccessItem,
  UserRole
} from '@core/services/tenant-users.service';
import {
  getModuleFeatureOptions,
  isSubFeatureOn,
  toModuleAccessApiPayload,
  withSubFeatureToggled
} from '@core/config/module-features.config';
import { ToastService } from '@core/services/toast.service';

interface BulkRow {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
  role: UserRole;
  moduleAccess: UserModuleAccessItem[];
}

@Component({
  selector: 'app-tenant-users-bulk',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    TableModule,
    ButtonModule,
    InputTextModule,
    PasswordModule,
    SelectModule,
    DialogModule,
    ToggleSwitchModule,
    CheckboxModule,
    CardModule,
    PageHeaderComponent,
    BreadcrumbComponent
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems"></app-breadcrumb>

    <app-page-header
      title="Ajouter des utilisateurs" i18n-title="@@settings.users.ajouter.des.utilisateurs.0f065e3f"
      subtitle="Créez plusieurs comptes avec rôle et modules pour chacun" i18n-subtitle="@@settings.users.creez.plusieurs.comptes.avec.role.et.mod.4c9c7184">
      <p-button label="Retour à la liste" i18n-label="@@settings.users.retour.a.la.liste.7753f531" icon="pi pi-arrow-left" [outlined]="true" routerLink="/settings/users"></p-button>
    </app-page-header>

    <p-card styleClass="bulk-card">
      <div class="toolbar">
        <p-button label="Ajouter une ligne" i18n-label="@@settings.users.ajouter.une.ligne.ba241fd4" icon="pi pi-plus" [outlined]="true" (onClick)="addRow()"></p-button>
        <p-button
          label="Dupliquer modules (ligne 1 → toutes)" i18n-label="@@settings.users.dupliquer.modules.ligne.1.toutes.6ebd1d76"
          icon="pi pi-copy"
          [outlined]="true"
          severity="secondary"
          (onClick)="copyModulesFromFirst()"
          [disabled]="rows().length < 2"></p-button>
      </div>

      <p-table [value]="rows()" styleClass="bulk-table">
        <ng-template pTemplate="header">
          <tr>
            <th scope="col" i18n="@@settings.users.prenom.e4387ade">Prénom</th>
            <th scope="col" i18n="@@settings.users.nom.7ff20370">Nom</th>
            <th scope="col" i18n="@@settings.users.email.84add5b2">Email</th>
            <th scope="col" i18n="@@settings.users.mot.de.passe.94e2f3ee">Mot de passe</th>
            <th scope="col" i18n="@@settings.users.role.8b824790">Rôle</th>
            <th scope="col" style="width: 12rem" i18n="@@settings.users.modules.04e9462c">Modules</th>
            <th scope="col" class="actions-col" aria-label="Actions" i18n-aria-label="@@settings.users.actions.c3cd636a"></th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-row let-ri="rowIndex">
          <tr>
            <td data-label="Prénom" i18n-data-label="@@settings.tenant-users-bulk.prenom.e4387ade">
              <input
                pInputText
                class="w-full"
                [(ngModel)]="row.firstName"
                [name]="'bulk-firstName-' + ri"
                autocomplete="given-name"
                placeholder="Prénom" i18n-placeholder="@@settings.users.prenom.e4387ade" />
            </td>
            <td data-label="Nom" i18n-data-label="@@settings.tenant-users-bulk.nom.7ff20370">
              <input
                pInputText
                class="w-full"
                [(ngModel)]="row.lastName"
                [name]="'bulk-lastName-' + ri"
                autocomplete="family-name"
                placeholder="Nom" i18n-placeholder="@@settings.users.nom.7ff20370" />
            </td>
            <td data-label="Email">
              <input
                pInputText
                class="w-full"
                [(ngModel)]="row.email"
                type="email"
                [name]="'bulk-email-' + ri"
                autocomplete="off"
                placeholder="nom@entreprise.fr" i18n-placeholder="@@settings.users.nom.entreprise.fr.9626f884" />
            </td>
            <td data-label="Mot de passe" i18n-data-label="@@settings.tenant-users-bulk.mot.de.passe.94e2f3ee">
              <p-password
                [(ngModel)]="row.password"
                [ngModelOptions]="{standalone: true}"
                [inputId]="'bulk-password-' + ri"
                [feedback]="false"
                [toggleMask]="true"
                placeholder="Mot de passe" i18n-placeholder="@@settings.users.mot.de.passe.94e2f3ee"
                styleClass="w-full"
                inputStyleClass="w-full bulk-password-input"></p-password>
            </td>
            <td data-label="Rôle" i18n-data-label="@@settings.tenant-users-bulk.role.8b824790">
              <p-select
                [options]="roleOptions"
                [ngModel]="row.role"
                (ngModelChange)="onRowRoleChange(ri, $event)"
                [name]="'bulk-role-' + ri"
                optionLabel="label"
                optionValue="value"
                placeholder="Rôle" i18n-placeholder="@@settings.users.role.8b824790"
                styleClass="w-full"></p-select>
            </td>
            <td data-label="Modules" i18n-data-label="@@settings.tenant-users-bulk.modules.04e9462c">
              <div class="module-cell">
                <p-button
                  label="Configurer" i18n-label="@@settings.users.configurer.382efbe9"
                  icon="pi pi-sliders-h"
                  [outlined]="true"
                  (onClick)="openModules(ri)"></p-button>
              </div>
            </td>
            <td data-label="Supprimer" i18n-data-label="@@settings.tenant-users-bulk.supprimer.1acfc1c7">
              <p-button
                icon="pi pi-trash"
                [rounded]="true"
                [text]="true"
                severity="danger"
                ariaLabel="Supprimer la ligne" i18n-ariaLabel="@@settings.users.supprimer.la.ligne.7e5f9ae0"
                (onClick)="removeRow(ri)"
                [disabled]="rows().length <= 1"></p-button>
            </td>
          </tr>
        </ng-template>
      </p-table>

      <p class="rows-hint">{{ bulkRowsHint() }}</p>

      <div class="footer-actions">
        <p-button label="Enregistrer tout" i18n-label="@@settings.users.enregistrer.tout.d16a3dcb" icon="pi pi-check" (onClick)="submit()" [loading]="submitting()"></p-button>
      </div>
    </p-card>

    <p-dialog
      [(visible)]="modulesVisible"
      header="Modules autorisés" i18n-header="@@settings.users.modules.autorises.2d0a003a"
      [modal]="true"
      [style]="{ width: 'min(480px, 96vw)' }"
      (onHide)="onModulesDialogHide()">
      <p class="hint" i18n="@@settings.users.les.acces.effectifs.elements.coches.dans.la.limi.cbdf0e2d"> Les accès effectifs = éléments cochés, dans la limite du plafond autorisé pour le rôle.
        Les éléments « Extension » élargissent les accès par défaut du rôle. </p>
      @if (bulkCatalogLoading()) {
        <p class="catalog-state" i18n="@@settings.users.chargement.du.catalogue.2ae07afb">Chargement du catalogue…</p>
      } @else if (bulkCatalogError()) {
        <div class="catalog-error" i18n="@@settings.users.impossible.de.charger.le.catalogue.des.modules.p.b24c3ba2"> Impossible de charger le catalogue des modules pour ce rôle. Fermez puis rouvrez la configuration pour réessayer. </div>
      } @else {
        <div class="module-actions">
          <p-button label="Tout activer" i18n-label="@@settings.users.tout.activer.ce34115c" [text]="true" (onClick)="setAllModules(true)"></p-button>
          <p-button label="Tout désactiver" i18n-label="@@settings.users.tout.desactiver.f09b1c87" [text]="true" (onClick)="setAllModules(false)"></p-button>
        </div>
        <div class="module-list">
          @for (m of workingModules(); track m.module) {
            <div class="module-row">
              <div class="module-row-main">
                <span class="module-title">
                  {{ moduleLabel(m.module) }}
                  @if (isModuleDefaultIncluded(bulkCatalogModule(m.module))) {
                    <span class="default-badge" i18n="@@settings.users.inclus.par.defaut.0d38cc2c">Inclus par défaut</span>
                  }
                </span>
                <p-toggleswitch
                  [(ngModel)]="m.enabled"
                  (ngModelChange)="afterModuleEnabledChange(m)"></p-toggleswitch>
              </div>
              @if (m.enabled && catalogVisibleFeatures(bulkCatalogModule(m.module)).length) {
                <div
                  class="module-subfeatures"
                  role="group"
                  [attr.aria-label]="loc_ui_tern_sous_modules_6ad740 + moduleLabel(m.module)">
                  @for (f of catalogVisibleFeatures(bulkCatalogModule(m.module)); track f.key) {
                    <label class="subfeature-row">
                      <p-checkbox
                        [binary]="true"
                        [ngModel]="isSubFeatureOn(m, f.key)"
                        (ngModelChange)="onWorkingSubFeatureChange(m.module, f.key, $event)"
                        [inputId]="'bulkFeat-' + m.module + '-' + f.key"></p-checkbox>
                      <span class="subfeature-label-text">{{ featureLabel(m.module, f.key) }}</span>
                      @if (f.isExtension) {
                        <span class="extension-badge" i18n="@@settings.users.extension.659087d3">Extension</span>
                      }
                    </label>
                  }
                </div>
              }
            </div>
          }
        </div>
      }
      <div class="dialog-actions">
        <p-button label="Fermer" i18n-label="@@settings.users.fermer.5ab4ec64" (onClick)="modulesVisible = false"></p-button>
      </div>
    </p-dialog>
  `,
  styles: [`
    :host ::ng-deep .bulk-card.p-card {
      align-self: flex-start;
      width: 100%;
    }
    :host ::ng-deep .bulk-card .p-card-body {
      display: flex;
      flex-direction: column;
    }

    .bulk-card { margin-top: var(--spacing-4); }

    .toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--spacing-3);
      margin-bottom: var(--spacing-4);
    }

    .rows-hint {
      margin: var(--spacing-3) 0 0;
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
    }

    .footer-actions {
      display: flex;
      justify-content: flex-end;
      margin-top: var(--spacing-5);
      padding-top: var(--spacing-5);
      border-top: 1px solid var(--color-border-subtle);
    }

    .module-cell {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
    }

    :host ::ng-deep .bulk-table.p-datatable .p-datatable-tbody > tr:nth-child(even):not(.overdue) {
      background: transparent;
    }
    :host ::ng-deep .bulk-table.p-datatable .p-datatable-tbody > tr:hover {
      transform: none;
      box-shadow: none;
      cursor: default;
      background: var(--color-background-hover);
    }
    :host ::ng-deep .bulk-table.p-datatable .p-datatable-tbody > tr:active {
      transform: none;
      background: var(--color-background-hover);
    }
    :host ::ng-deep .bulk-table.p-datatable .p-datatable-tbody > tr > td {
      vertical-align: middle;
    }

    :host ::ng-deep .bulk-table .p-inputtext,
    :host ::ng-deep .bulk-table .bulk-password-input.p-inputtext,
    :host ::ng-deep .bulk-table .p-password .p-inputtext {
      width: 100%;
      min-width: 8rem;
      min-height: 2.75rem;
    }
    :host ::ng-deep .bulk-table .p-password,
    :host ::ng-deep .bulk-table .p-password .p-password-input,
    :host ::ng-deep .bulk-table .p-select {
      width: 100%;
      min-width: 8rem;
    }
    :host ::ng-deep .bulk-table .p-select .p-select-label {
      display: flex;
      align-items: center;
      min-height: 2.75rem;
    }

    .actions-col {
      width: 4rem;
    }

    .hint { font-size: var(--font-size-sm); color: var(--color-neutral-600); margin-top: 0; }
    .module-actions { display: flex; gap: var(--spacing-2); margin-bottom: var(--spacing-2); }
    .module-list { display: flex; flex-direction: column; gap: var(--spacing-2); }
    .module-row {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
      padding: var(--spacing-2) 0;
      border-bottom: 1px solid var(--color-neutral-100);
    }
    .module-row-main { display: flex; justify-content: space-between; align-items: center; gap: var(--spacing-3); }
    .module-title { font-size: var(--font-size-sm); font-weight: var(--font-weight-medium); color: var(--color-neutral-800); }
    .module-subfeatures {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-1);
      padding-top: var(--spacing-2);
      border-top: 1px dashed var(--color-neutral-200);
    }
    .subfeature-row {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      margin: 0;
      font-size: var(--font-size-sm);
      color: var(--color-neutral-700);
      cursor: pointer;
    }
    .subfeature-label-text { line-height: 1.35; }
    .dialog-actions { display: flex; justify-content: flex-end; margin-top: var(--spacing-3); }

    .default-badge,
    .extension-badge {
      display: inline-flex;
      align-items: center;
      margin-inline-start: var(--spacing-2);
      padding: 0 var(--spacing-2);
      font-size: var(--font-size-xs, 0.7rem);
      font-weight: var(--font-weight-medium);
      line-height: 1.5;
      border-radius: var(--radius-full, 9999px);
      white-space: nowrap;
    }
    .default-badge {
      color: var(--color-text-secondary, var(--color-neutral-600));
      background: var(--color-neutral-100, #eef2f7);
    }
    .extension-badge {
      color: var(--color-primary-700, #1d4ed8);
      background: var(--color-primary-50, #eff6ff);
    }
    .catalog-state {
      margin: 0;
      padding: var(--spacing-2) 0;
      font-size: var(--font-size-sm);
      color: var(--color-neutral-500);
    }
    .catalog-error {
      padding: var(--spacing-2) var(--spacing-3);
      border: 1px solid var(--color-danger-200, #fecaca);
      border-radius: var(--radius-lg, 0.5rem);
      background: var(--color-danger-50, #fef2f2);
      color: var(--color-danger-700, #b91c1c);
      font-size: var(--font-size-sm);
    }
  `]
})
export class TenantUsersBulkComponent {
  readonly loc_ui_tern_sous_modules_6ad740 = $localize`:@@ui.tern.sous.modules.6ad740:Sous-modules : `;
  private readonly tenantUsers = inject(TenantUsersService);
  private readonly toast = inject(ToastService);

  readonly getModuleFeatureOptions = getModuleFeatureOptions;
  readonly isSubFeatureOn = isSubFeatureOn;

  readonly breadcrumbItems: BreadcrumbItem[] = [
    { label: $localize`:@@settings.tenant-users-bulk.ts.tableau.de.bord.a524057f:Tableau de bord`, route: '/dashboard', icon: 'pi-home' },
    { label: $localize`:@@settings.tenant-users-bulk.ts.parametres.ef8f0121:Paramètres`, route: '/settings' },
    { label: $localize`:@@settings.tenant-users-bulk.ts.utilisateurs.c661b3bc:Utilisateurs`, route: '/settings/users' },
    { label: $localize`:@@settings.tenant-users-bulk.ts.ajout.groupe.f72bec29:Ajout groupé` }
  ];

  readonly roleOptions = [
    { label: $localize`:@@settings.tenant-users-bulk.ts.administrateur.1d8141b2:Administrateur`, value: 'Administrator' as UserRole },
    { label: $localize`:@@settings.tenant-users-bulk.ts.comptable.36cf0a9e:Comptable`, value: 'Accountant' as UserRole },
    { label: $localize`:@@settings.tenant-users-bulk.ts.commercial.b48513e4:Commercial`, value: 'SalesRep' as UserRole },
    { label: $localize`:@@settings.tenant-users-bulk.ts.responsable.commercial.faf99310:Responsable Commercial`, value: 'SalesManager' as UserRole },
    { label: $localize`:@@settings.tenant-users-bulk.ts.magasinier.c61a86f7:Magasinier`, value: 'Warehouse' as UserRole },
    { label: $localize`:@@settings.tenant-users-bulk.ts.acheteur.0afc4f6e:Acheteur`, value: 'Purchaser' as UserRole },
    { label: $localize`:@@settings.tenant-users-bulk.ts.caissier.8d597a37:Caissier`, value: 'Cashier' as UserRole },
    { label: $localize`:@@settings.tenant-users-bulk.ts.auditeur.eac73f9c:Auditeur`, value: 'Auditor' as UserRole },
    { label: $localize`:@@settings.tenant-users-bulk.ts.superviseur.27e5f8da:Superviseur`, value: 'Supervisor' as UserRole },
    { label: $localize`:@@settings.tenant-users-bulk.ts.developpeur.4819232b:Développeur`, value: 'Developer' as UserRole }
  ];

  rows = signal<BulkRow[]>([this.emptyRow()]);
  submitting = signal(false);

  /** Compteur d’aide sous le tableau (sans effet sur la soumission). */
  bulkRowsHint(): string {
    const n = this.rows().length;
    if (n <= 1) {
      return $localize`:@@settings.tenant-users-bulk.ts.1.ligne.dans.le.formulaire.chaque.ligne.c0a50277:1 ligne dans le formulaire — chaque ligne complète crée un utilisateur à l’enregistrement.`;
    }
    return $localize`:@@settings.tenant-users-bulk.ts.n.lignes.dans.le.formulaire.chaque.ligne.b89f9eba:${n}:n: lignes dans le formulaire — chaque ligne complète crée un utilisateur à l’enregistrement.`;
  }

  modulesVisible = false;
  configRowIndex: number | null = null;
  workingModules = signal<UserModuleAccessItem[]>([]);
  /** Catalogue du rôle de la ligne en cours de configuration (rendu piloté par l'API, plan §4.a). */
  bulkCatalog = signal<ModuleCatalogModuleDto[]>([]);
  bulkCatalogLoading = signal(false);
  bulkCatalogError = signal(false);

  addRow(): void {
    this.rows.update(list => [...list, this.emptyRow()]);
  }

  removeRow(index: number): void {
    this.rows.update(list => (list.length <= 1 ? list : list.filter((_, i) => i !== index)));
  }

  emptyRow(): BulkRow {
    return {
      email: '',
      firstName: '',
      lastName: '',
      password: '',
      role: 'Accountant',
      // Vide : la configuration d'une ligne se fait via le catalogue de son rôle (bouton « Configurer »).
      // Une ligne non configurée produit un utilisateur sans grants (= jeu de base du rôle).
      moduleAccess: []
    };
  }

  /** Changement de rôle d'une ligne : recharge le catalogue et réinitialise les modules sur les défauts du rôle. */
  onRowRoleChange(rowIndex: number, role: UserRole): void {
    this.rows.update(list => {
      const next = [...list];
      next[rowIndex] = { ...next[rowIndex], role };
      return next;
    });
    this.tenantUsers.getModuleCatalog(role).subscribe({
      next: res => {
        if (res.success && res.data) {
          const access = this.accessFromCatalog(res.data.modules);
          this.rows.update(list => {
            const next = [...list];
            next[rowIndex] = { ...next[rowIndex], moduleAccess: access };
            return next;
          });
        }
      },
      error: () => {
        /* Laisser la ligne telle quelle : la modale de configuration affichera l'erreur à l'ouverture. */
      }
    });
  }

  private accessFromCatalog(catalog: ModuleCatalogModuleDto[]): UserModuleAccessItem[] {
    return catalog
      .filter(cm => cm.grantable)
      .map(cm => ({
        module: cm.module,
        enabled: cm.defaultEnabled,
        enabledFeatureKeys: this.defaultFeatureKeys(cm)
      }));
  }

  openModules(rowIndex: number): void {
    this.configRowIndex = rowIndex;
    const row = this.rows()[rowIndex];
    this.modulesVisible = true;
    this.loadBulkCatalog(row.role, row.moduleAccess);
  }

  private loadBulkCatalog(role: UserRole, rowAccess: UserModuleAccessItem[]): void {
    this.bulkCatalogLoading.set(true);
    this.bulkCatalogError.set(false);
    this.tenantUsers.getModuleCatalog(role).subscribe({
      next: res => {
        this.bulkCatalogLoading.set(false);
        if (res.success && res.data) {
          this.bulkCatalog.set(res.data.modules);
          this.buildBulkWorkingModules(res.data.modules, rowAccess);
        } else {
          this.bulkCatalogError.set(true);
          this.bulkCatalog.set([]);
          this.workingModules.set([]);
        }
      },
      error: () => {
        this.bulkCatalogLoading.set(false);
        this.bulkCatalogError.set(true);
        this.bulkCatalog.set([]);
        this.workingModules.set([]);
      }
    });
  }

  /**
   * Brouillon de la modale : un module par module grantable du catalogue, conservant l'état déjà
   * configuré de la ligne s'il existe, sinon les défauts du rôle.
   */
  private buildBulkWorkingModules(catalog: ModuleCatalogModuleDto[], rowAccess: UserModuleAccessItem[]): void {
    this.workingModules.set(
      catalog
        .filter(cm => cm.grantable)
        .map(cm => {
          const existing = rowAccess.find(x => x.module === cm.module);
          return {
            module: cm.module,
            enabled: existing ? existing.enabled : cm.defaultEnabled,
            enabledFeatureKeys: existing ? (existing.enabledFeatureKeys ?? null) : this.defaultFeatureKeys(cm)
          };
        })
    );
  }

  /** Entrée de catalogue du rôle de la ligne en cours pour un module donné. */
  bulkCatalogModule(m: AppModule): ModuleCatalogModuleDto | undefined {
    return this.bulkCatalog().find(cm => cm.module === m);
  }

  catalogVisibleFeatures(cm: ModuleCatalogModuleDto | undefined): ModuleCatalogFeatureDto[] {
    return cm?.features.filter(f => f.allowedPermissions.length > 0) ?? [];
  }

  isModuleDefaultIncluded(cm: ModuleCatalogModuleDto | undefined): boolean {
    return !!cm?.defaultEnabled;
  }

  featureLabel(module: AppModule, key: string): string {
    return getModuleFeatureOptions(module).find(o => o.key === key)?.label ?? key;
  }

  private defaultFeatureKeys(cm: ModuleCatalogModuleDto): string[] {
    return cm.features.filter(f => f.defaultSelected).map(f => f.key);
  }

  afterModuleEnabledChange(m: UserModuleAccessItem): void {
    this.workingModules.update(draft => {
      const i = draft.findIndex(x => x.module === m.module);
      if (i < 0) return draft;
      const prev = draft[i];
      const next = [...draft];
      next[i] = m.enabled
        ? { ...prev, enabled: true }
        : { ...prev, enabled: false, enabledFeatureKeys: null };
      return next;
    });
  }

  onWorkingSubFeatureChange(module: AppModule, featureKey: string, checked: boolean): void {
    this.workingModules.update(draft => {
      const i = draft.findIndex(x => x.module === module);
      if (i < 0) return draft;
      const next = [...draft];
      const visibleKeys = this.catalogVisibleFeatures(this.bulkCatalogModule(module)).map(f => f.key);
      next[i] = withSubFeatureToggled(draft[i], featureKey, checked, visibleKeys);
      return next;
    });
  }

  persistModulesFromWorking(): void {
    const i = this.configRowIndex;
    if (i === null) return;
    const next = [...this.rows()];
    next[i] = {
      ...next[i],
      moduleAccess: this.workingModules().map(x => ({
        ...x,
        enabledFeatureKeys: x.enabledFeatureKeys == null ? null : [...x.enabledFeatureKeys]
      }))
    };
    this.rows.set(next);
  }

  setAllModules(enabled: boolean): void {
    this.workingModules.update(list =>
      list.map(x => ({
        ...x,
        enabled,
        enabledFeatureKeys: enabled ? x.enabledFeatureKeys : null
      }))
    );
  }

  moduleLabel(m: AppModule): string {
    return APP_MODULE_OPTIONS.find(o => o.value === m)?.label ?? String(m);
  }

  onModulesDialogHide(): void {
    // Ne pas écraser la configuration de la ligne si le catalogue n'a pas pu se charger (fail-closed) :
    // la ligne conserve son état précédent, et la soumission re-filtrera par le catalogue du rôle.
    if (this.bulkCatalogError()) return;
    this.persistModulesFromWorking();
  }

  /**
   * « Dupliquer modules (ligne 1 → toutes) » : applique la configuration de la première ligne à chaque
   * autre ligne, mais re-filtre par le rôle cible — les modules non grantables pour un rôle cible sont
   * écartés et signalés par un avertissement visuel (plan §4.a).
   */
  copyModulesFromFirst(): void {
    const list = this.rows();
    if (list.length < 2) return;
    const template = this.cloneModuleAccess(list[0].moduleAccess);
    const targetRoles = [...new Set(list.slice(1).map(r => r.role))];
    this.submitting.set(true);
    forkJoin(targetRoles.map(r => this.tenantUsers.getModuleCatalog(r))).subscribe({
      next: catalogs => {
        this.submitting.set(false);
        const byRole = new Map(targetRoles.map((r, i) => [r, catalogs[i].data?.modules ?? []]));
        let dropped = 0;
        const next = list.map((r, i) => {
          if (i === 0) return r;
          const grantable = new Set(
            (byRole.get(r.role) ?? []).filter(cm => cm.grantable).map(cm => cm.module)
          );
          const filtered = this.cloneModuleAccess(template.filter(x => grantable.has(x.module)));
          dropped += template.length - filtered.length;
          return { ...r, moduleAccess: filtered };
        });
        this.rows.set(next);
        if (dropped > 0) {
          this.toast.add({
            severity: 'warn',
            summary: $localize`:@@tenant-users-bulk.component.summary.Modules copi:Modules copiés`,
            detail: $localize`:@@settings.tenant-users-bulk.ts.configuration.appliquee.dropped.module.s.edb9d430:Configuration appliquée. ${dropped}:dropped: module(s) non disponible(s) pour certains rôles ont été écartés.`
          });
        } else {
          this.toast.add({
            severity: 'info',
            summary: $localize`:@@tenant-users-bulk.component.summary.Modules copi:Modules copiés`,
            detail: $localize`:@@tenant-users-bulk.component.detail.Configuration_de:Configuration de la première ligne appliquée aux autres.`
          });
        }
      },
      error: () => {
        this.submitting.set(false);
        this.toast.add({
          severity: 'error',
          summary: $localize`:@@tenant-users-bulk.component.summary.Erreur:Erreur`,
          detail: $localize`:@@tenant-users-bulk.component.detail.Impossible d:Impossible de charger le catalogue pour la copie des modules.`
        });
      }
    });
  }

  private cloneModuleAccess(items: UserModuleAccessItem[]): UserModuleAccessItem[] {
    return items.map(x => ({
      ...x,
      enabledFeatureKeys: x.enabledFeatureKeys == null ? null : [...x.enabledFeatureKeys]
    }));
  }

  submit(): void {
    this.persistModulesFromWorking();
    const items: CreateTenantUserItem[] = [];
    for (const r of this.rows()) {
      if (!r.email.trim() && !r.firstName.trim() && !r.lastName.trim() && !r.password.trim()) continue;
      if (!r.email.trim() || !r.firstName.trim() || !r.lastName.trim() || !r.password.trim()) {
        this.toast.add({
          severity: 'warn',
          summary: $localize`:@@tenant-users-bulk.component.summary.Formulaire_incom:Formulaire incomplet`,
          detail: $localize`:@@tenant-users-bulk.component.detail.Chaque_ligne_ren:Chaque ligne renseignée doit avoir prénom, nom, email et mot de passe.`
        });
        return;
      }
      items.push({
        email: r.email.trim(),
        firstName: r.firstName.trim(),
        lastName: r.lastName.trim(),
        password: r.password,
        role: r.role,
        moduleAccess: toModuleAccessApiPayload(r.moduleAccess)
      });
    }
    if (items.length === 0) {
      this.toast.add({ severity: 'warn', summary: $localize`:@@tenant-users-bulk.component.summary.Aucune_donn_e:Aucune donnée`, detail: $localize`:@@tenant-users-bulk.component.detail.Ajoutez_au_moins:Ajoutez au moins un utilisateur.` });
      return;
    }

    // Fail-closed / anti-400 : avant l'envoi, on s'assure que chaque ligne ne porte que des modules
    // grantables pour son rôle (re-filtrage par le catalogue servi par l'API). Les catalogues sont
    // mémorisés par le service, donc les rôles déjà chargés ne déclenchent pas de requête réseau.
    const roles = [...new Set(items.map(it => it.role))];
    this.submitting.set(true);
    forkJoin(roles.map(r => this.tenantUsers.getModuleCatalog(r))).subscribe({
      next: catalogs => {
        const byRole = new Map(roles.map((r, i) => [r, catalogs[i].data?.modules ?? []]));
        const finalItems = items.map(it => ({
          ...it,
          moduleAccess: this.filterAccessByCatalog(it.moduleAccess ?? [], byRole.get(it.role) ?? [])
        }));
        this.batchCreate(finalItems);
      },
      error: () => {
        this.submitting.set(false);
        this.toast.add({
          severity: 'error',
          summary: $localize`:@@tenant-users-bulk.component.summary.Erreur:Erreur`,
          detail: $localize`:@@tenant-users-bulk.component.detail.Impossible_de_ch:Impossible de charger le catalogue des modules pour valider l’enregistrement.`
        });
      }
    });
  }

  private filterAccessByCatalog(
    access: UserModuleAccessItem[],
    catalogModules: ModuleCatalogModuleDto[]
  ): UserModuleAccessItem[] {
    const grantable = new Set(catalogModules.filter(cm => cm.grantable).map(cm => cm.module));
    return access.filter(x => grantable.has(x.module));
  }

  private batchCreate(items: CreateTenantUserItem[]): void {
    this.tenantUsers.batchCreate(items).subscribe({
      next: res => {
        this.submitting.set(false);
        if (res.success) {
          this.toast.add({ severity: 'success', summary: $localize`:@@tenant-users-bulk.component.summary.Créé:Créé`, detail: res.message ?? $localize`:@@ui.tern.utilisateurs.crees.12083a:Utilisateurs créés` });
          this.rows.set([this.emptyRow()]);
        } else {
          this.toast.add({ severity: 'error', summary: $localize`:@@tenant-users-bulk.component.summary.Erreur:Erreur`, detail: res.errors?.[0] ?? $localize`:@@ui.tern.echec.0ff45f:Échec` });
        }
      },
      error: () => {
        this.submitting.set(false);
        this.toast.add({ severity: 'error', summary: $localize`:@@tenant-users-bulk.component.summary.Erreur:Erreur`, detail: $localize`:@@tenant-users-bulk.component.detail._chec_de_la_cr_a:Échec de la création` });
      }
    });
  }
}
