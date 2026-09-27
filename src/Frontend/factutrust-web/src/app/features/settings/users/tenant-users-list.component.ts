/// <reference types="@angular/localize" />
import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { InputSwitchModule } from 'primeng/inputswitch';
import { CheckboxModule } from 'primeng/checkbox';
import { PasswordModule } from 'primeng/password';
import { InputTextModule } from 'primeng/inputtext';
import { CardModule } from 'primeng/card';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { TableTotalsBarComponent, TotalMetric } from '@shared/components/table-totals-bar/table-totals-bar.component';
import {
  APP_MODULE_OPTIONS,
  AppModule,
  ModuleCatalogFeatureDto,
  ModuleCatalogModuleDto,
  TenantUserListItem,
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
import { AuthService } from '@core/services/auth.service';

/**
 * Brouillon d'un module dans la modale : étend `UserModuleAccessItem` d'un drapeau `dirty` qui suit
 * si l'administrateur a touché le toggle ou l'une des sous-features. Règle de persistance §5.2 /
 * décision E : un module non touché reproduit exactement son état stocké initial (absent reste absent,
 * `null` reste `null`, liste explicite reste identique) — seuls les modules touchés sont normalisés.
 */
interface ModuleDraft extends UserModuleAccessItem {
  dirty: boolean;
}

@Component({
  selector: 'app-tenant-users-list',
  standalone: true,
  imports: [BackendLabelPipe, 
    CommonModule,
    FormsModule,
    RouterModule,
    TableModule,
    ButtonModule,
    TagModule,
    DialogModule,
    SelectModule,
    InputSwitchModule,
    CheckboxModule,
    PasswordModule,
    InputTextModule,
    CardModule,
    PageHeaderComponent,
    BreadcrumbComponent,
    TableTotalsBarComponent
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems"></app-breadcrumb>

    <app-page-header
      title="Utilisateurs et rôles" i18n-title="@@settings.users.utilisateurs.et.roles.57ee1f2a"
      subtitle="Gérez les accès de votre équipe" i18n-subtitle="@@settings.users.gerez.les.acces.de.votre.equipe.6b3b4aa7">
      <p-button label="Retour" i18n-label="@@settings.users.retour.e5befb1f" icon="pi pi-arrow-left" [outlined]="true" routerLink="/settings"></p-button>
      <p-button label="Ajouter un utilisateur" i18n-label="@@settings.users.ajouter.un.utilisateur.41e8fc45" icon="pi pi-user-plus" (onClick)="openCreate()"></p-button>
      <p-button label="Ajouter plusieurs" i18n-label="@@settings.users.ajouter.plusieurs.437aba7d" icon="pi pi-users" [outlined]="true" routerLink="/settings/users/add"></p-button>
    </app-page-header>

    <app-table-totals-bar [metrics]="summaryMetrics()" [loading]="loading()"></app-table-totals-bar>

    <p-card styleClass="users-card">
      <p-table [value]="users()" [loading]="loading()" [rows]="15" [paginator]="true" responsiveLayout="scroll">
        <ng-template pTemplate="header">
          <tr>
            <th i18n="@@settings.users.utilisateur.0b20cd7f">Utilisateur</th>
            <th i18n="@@settings.users.role.8b824790">Rôle</th>
            <th i18n="@@settings.users.derniere.connexion.fcbd6dc7">Dernière connexion</th>
            <th i18n="@@settings.users.statut.659499f3">Statut</th>
            <th style="width: 8rem" i18n="@@settings.users.actions.c3cd636a">Actions</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-row>
          <tr>
            <td>
              <div class="user-cell">
                <span class="name">{{ row.firstName }} {{ row.lastName }}</span>
                <span class="email">{{ row.email }}</span>
              </div>
            </td>
            <td>{{ row.roleDisplay | backendLabel }}</td>
            <td>{{ formatDate(row.lastLoginAt) }}</td>
            <td>
              <p-tag [severity]="row.isActive ? 'success' : 'danger'" [value]="row.isActive ? loc_ui_tern_actif_2eb75f : loc_ui_tern_inactif_d2e033"></p-tag>
            </td>
            <td>
              <p-button icon="pi pi-cog" [rounded]="true" [text]="true" (onClick)="openEdit(row)" ariaLabel="Configurer" i18n-ariaLabel="@@settings.users.configurer.4f91fd6e"></p-button>
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="5" class="empty-msg" i18n="@@settings.users.aucun.utilisateur.a.afficher.5c67af5c">Aucun utilisateur à afficher</td>
          </tr>
        </ng-template>
      </p-table>
    </p-card>

    <p-dialog
      [(visible)]="createVisible"
      [modal]="true"
      [draggable]="false"
      styleClass="user-form-dialog"
      [style]="{ width: 'min(700px, 96vw)' }"
      [contentStyle]="{ overflow: 'auto', maxHeight: 'min(62vh, 520px)', padding: 0 }"
      header="Ajouter un utilisateur" i18n-header="@@settings.users.ajouter.un.utilisateur.41e8fc45"
      (onHide)="resetCreateForm()">
      <div class="user-dialog-body">
        <div class="user-form-grid">
          <div class="form-field">
            <label class="field-label" for="createFirstName" i18n="@@settings.users.prenom.e4387ade">Prénom</label>
            <input pInputText id="createFirstName" class="w-full" [(ngModel)]="createFirstName" autocomplete="given-name" />
          </div>
          <div class="form-field">
            <label class="field-label" for="createLastName" i18n="@@settings.users.nom.7ff20370">Nom</label>
            <input pInputText id="createLastName" class="w-full" [(ngModel)]="createLastName" autocomplete="family-name" />
          </div>
          <div class="form-field field-span-full">
            <label class="field-label" for="createEmail" i18n="@@settings.users.email.84add5b2">Email</label>
            <input pInputText id="createEmail" class="w-full" [(ngModel)]="createEmail" type="email" autocomplete="off" />
          </div>
          <div class="form-field field-span-full">
            <label class="field-label" for="createPassword" i18n="@@settings.users.mot.de.passe.94e2f3ee">Mot de passe</label>
            <p-password
              inputId="createPassword"
              [(ngModel)]="createPassword"
              [feedback]="true"
              [toggleMask]="true"
              styleClass="w-full"
              inputStyleClass="w-full"></p-password>
          </div>
          <div class="form-field">
            <label class="field-label" for="createPhone" i18n="@@settings.users.telephone.optionnel.23768a3e">Téléphone (optionnel)</label>
            <input pInputText id="createPhone" class="w-full" [(ngModel)]="createPhone" type="tel" autocomplete="tel" />
          </div>
          <div class="form-field">
            <label class="field-label" for="createRole" i18n="@@settings.users.role.8b824790">Rôle</label>
            <p-select
              inputId="createRole"
              [options]="roleOptions"
              [ngModel]="createRole"
              (ngModelChange)="onCreateRoleChange($event)"
              optionLabel="label"
              optionValue="value"
              styleClass="w-full"></p-select>
          </div>
        </div>

        <section class="form-section modules-section" aria-labelledby="create-modules-heading">
          <div class="form-section-head">
            <h4 id="create-modules-heading" class="form-section-title" i18n="@@settings.users.modules.04e9462c">Modules</h4>
            <p class="modules-hint" i18n="@@settings.users.les.acces.effectifs.elements.coches.dans.la.limi.68814cf7"> Les accès effectifs = éléments cochés, dans la limite du plafond autorisé pour le rôle.
              Les éléments « Extension » élargissent les accès par défaut du rôle. </p>
          </div>
          @if (createCatalogLoading()) {
            <p class="catalog-state" i18n="@@settings.users.chargement.du.catalogue.2ae07afb">Chargement du catalogue…</p>
          } @else if (createCatalogError()) {
            <div class="catalog-error">
              <p i18n="@@settings.users.impossible.de.charger.le.catalogue.des.modules.p.0ec32b10">Impossible de charger le catalogue des modules pour ce rôle. L’enregistrement est désactivé.</p>
              <p-button label="Réessayer" i18n-label="@@settings.users.reessayer.895d416b" [outlined]="true" (onClick)="onCreateRoleChange(createRole)"></p-button>
            </div>
          } @else {
            <div class="module-list">
              @for (m of createModuleDraft(); track m.module) {
                <div class="module-row">
                  <div class="module-row-main">
                    <label class="module-row-label" [for]="'createMod' + m.module">
                      {{ moduleLabel(m.module) }}
                      @if (isModuleDefaultIncluded(createCatalogModule(m.module))) {
                        <span class="default-badge" i18n="@@settings.users.inclus.par.defaut.0d38cc2c">Inclus par défaut</span>
                      }
                    </label>
                    <p-inputSwitch
                      [(ngModel)]="m.enabled"
                      (ngModelChange)="afterCreateModuleEnabledChange(m)"
                      [inputId]="'createMod' + m.module"></p-inputSwitch>
                  </div>
                  @if (m.enabled && catalogVisibleFeatures(createCatalogModule(m.module)).length) {
                    <div
                      class="module-subfeatures"
                      role="group"
                      [attr.aria-label]="loc_ui_tern_sous_modules_6ad740 + moduleLabel(m.module)">
                      @for (f of catalogVisibleFeatures(createCatalogModule(m.module)); track f.key) {
                        <label class="subfeature-row">
                          <p-checkbox
                            [binary]="true"
                            [ngModel]="isSubFeatureOn(m, f.key)"
                            (ngModelChange)="onCreateSubFeatureChange(m.module, f.key, $event)"
                            [inputId]="'createFeat-' + m.module + '-' + f.key"></p-checkbox>
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
        </section>
      </div>
      <ng-template pTemplate="footer">
        <div class="user-dialog-footer-actions">
          <p-button label="Annuler" i18n-label="@@settings.users.annuler.49ba3292" [outlined]="true" type="button" (onClick)="closeCreate()"></p-button>
          <p-button
            label="Créer" i18n-label="@@settings.users.creer.1a686172"
            icon="pi pi-check"
            type="button"
            (onClick)="saveCreate()"
            [loading]="createSaving()"
            [disabled]="createCatalogError() || createCatalogLoading()"></p-button>
        </div>
      </ng-template>
    </p-dialog>

    <p-dialog
      [(visible)]="editVisible"
      [modal]="true"
      [draggable]="false"
      styleClass="user-form-dialog"
      [style]="{ width: 'min(700px, 96vw)' }"
      [contentStyle]="{ overflow: 'auto', maxHeight: 'min(62vh, 520px)', padding: 0 }"
      header="Modifier l'utilisateur" i18n-header="@@settings.users.modifier.l.utilisateur.75ea88e1"
      (onHide)="closeEdit()">
      @if (editUser()) {
        <div class="user-dialog-body">
          <p class="edit-email">{{ editUser()!.email }}</p>

          <div class="user-form-grid edit-role-grid">
            <div class="form-field">
              <label class="field-label" for="editRole" i18n="@@settings.users.role.8b824790">Rôle</label>
              <p-select
                inputId="editRole"
                [options]="roleOptions"
                [ngModel]="editRole"
                (ngModelChange)="onEditRoleChange($event)"
                optionLabel="label"
                optionValue="value"
                styleClass="w-full"></p-select>
            </div>
            <div class="form-field switch-field">
              <label class="field-label" for="activeSw" i18n="@@settings.users.compte.actif.ea95f801">Compte actif</label>
              <div class="switch-field-control">
                <p-inputSwitch inputId="activeSw" [(ngModel)]="editActive"></p-inputSwitch>
              </div>
            </div>
          </div>

          <div class="form-field field-span-full">
            <label class="field-label" for="editNewPassword" i18n="@@settings.users.nouveau.mot.de.passe.optionnel.c5261f5f">Nouveau mot de passe (optionnel)</label>
            <p-password
              inputId="editNewPassword"
              [(ngModel)]="editNewPassword"
              [feedback]="false"
              [toggleMask]="true"
              styleClass="w-full"
              inputStyleClass="w-full"></p-password>
          </div>

          <section class="form-section modules-section" aria-labelledby="edit-modules-heading">
            <div class="form-section-head">
              <h4 id="edit-modules-heading" class="form-section-title" i18n="@@settings.users.modules.04e9462c">Modules</h4>
              <p class="modules-hint" i18n="@@settings.users.les.acces.effectifs.elements.coches.dans.la.limi.60a55792"> Les accès effectifs = éléments cochés, dans la limite du plafond autorisé pour le rôle.
                Les éléments « Extension » élargissent les accès par défaut du rôle. </p>
            </div>
            @if (editCatalogLoading()) {
              <p class="catalog-state" i18n="@@settings.users.chargement.du.catalogue.2ae07afb">Chargement du catalogue…</p>
            } @else if (editCatalogError()) {
              <div class="catalog-error">
                <p i18n="@@settings.users.impossible.de.charger.le.catalogue.des.modules.p.0ec32b10">Impossible de charger le catalogue des modules pour ce rôle. L’enregistrement est désactivé.</p>
                <p-button label="Réessayer" i18n-label="@@settings.users.reessayer.895d416b" [outlined]="true" (onClick)="onEditRoleChange(editRole)"></p-button>
              </div>
            } @else {
              <div class="module-list">
                @for (m of moduleDraft(); track m.module) {
                  <div class="module-row">
                    <div class="module-row-main">
                      <label class="module-row-label" [for]="'editMod' + m.module">
                        {{ moduleLabel(m.module) }}
                        @if (isModuleDefaultIncluded(editCatalogModule(m.module))) {
                          <span class="default-badge" i18n="@@settings.users.inclus.par.defaut.0d38cc2c">Inclus par défaut</span>
                        }
                      </label>
                      <p-inputSwitch
                        [(ngModel)]="m.enabled"
                        (ngModelChange)="afterEditModuleEnabledChange(m)"
                        [inputId]="'editMod' + m.module"
                        [disabled]="isAdministrationModuleLockedForEdit(m)"></p-inputSwitch>
                    </div>
                    @if (m.enabled && catalogVisibleFeatures(editCatalogModule(m.module)).length) {
                      <div
                        class="module-subfeatures"
                        role="group"
                        [attr.aria-label]="loc_ui_tern_sous_modules_6ad740 + moduleLabel(m.module)">
                        @for (f of catalogVisibleFeatures(editCatalogModule(m.module)); track f.key) {
                          <label class="subfeature-row">
                            <p-checkbox
                              [binary]="true"
                              [ngModel]="isSubFeatureOn(m, f.key)"
                              (ngModelChange)="onEditSubFeatureChange(m.module, f.key, $event)"
                              [inputId]="'editFeat-' + m.module + '-' + f.key"
                              [disabled]="isAdministrationModuleLockedForEdit(m)"></p-checkbox>
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
          </section>
        </div>
      }
      <ng-template pTemplate="footer">
        @if (editUser()) {
          <div class="user-dialog-footer-actions">
            <p-button label="Annuler" i18n-label="@@settings.users.annuler.49ba3292" [outlined]="true" type="button" (onClick)="closeEdit()"></p-button>
            <p-button
              label="Enregistrer" i18n-label="@@settings.users.enregistrer.f7c8bcd8"
              type="button"
              (onClick)="saveEdit()"
              [loading]="saving()"
              [disabled]="editCatalogError() || editCatalogLoading()"></p-button>
          </div>
        }
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    .users-card { margin-top: var(--spacing-4); }
    .user-cell { display: flex; flex-direction: column; gap: 0.15rem; }
    .user-cell .name { font-weight: var(--font-weight-medium); color: var(--color-neutral-900); }
    .user-cell .email { font-size: var(--font-size-sm); color: var(--color-neutral-500); }
    .empty-msg { text-align: center; padding: var(--spacing-6); color: var(--color-neutral-500); }

    .user-dialog-body {
      padding: var(--spacing-5) var(--spacing-6);
      display: flex;
      flex-direction: column;
      gap: var(--spacing-5);
    }

    .user-form-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: var(--spacing-3) var(--spacing-4);
    }

    @media (min-width: 560px) {
      .user-form-grid {
        grid-template-columns: 1fr 1fr;
      }
      .field-span-full {
        grid-column: 1 / -1;
      }
    }

    .form-field {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
      min-width: 0;
    }

    .edit-email {
      margin: 0;
      color: var(--color-neutral-600);
      font-size: var(--font-size-sm);
    }

    .field-label {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      color: var(--color-neutral-700);
    }

    .switch-field .switch-field-control {
      display: flex;
      align-items: center;
      min-height: 2.5rem;
    }

    @media (min-width: 560px) {
      .edit-role-grid {
        align-items: end;
      }
      .switch-field .field-label {
        margin-bottom: 0;
      }
    }

    .form-section {
      margin: 0;
      padding: 0;
      border: none;
    }

    .form-section-head {
      margin-bottom: var(--spacing-2);
    }

    .form-section-title {
      margin: 0 0 var(--spacing-1);
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-tertiary, var(--color-neutral-500));
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .modules-hint {
      margin: 0;
      font-size: var(--font-size-sm);
      color: var(--color-neutral-500);
      line-height: 1.45;
    }

    .modules-section {
      padding-top: var(--spacing-2);
      border-top: 1px solid var(--color-border-subtle, var(--color-neutral-100));
    }

    .module-list {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
      margin-top: var(--spacing-3);
    }

    .module-row {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: var(--spacing-2);
      padding: var(--spacing-3);
      background: var(--color-neutral-50, #f8fafc);
      border: 1px solid var(--color-border-subtle, var(--color-neutral-100));
      border-radius: var(--radius-lg, 0.5rem);
    }

    .module-row-main {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--spacing-3);
    }

    .module-subfeatures {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-1);
      padding: var(--spacing-2) 0 0;
      margin: 0;
      border-top: 1px dashed var(--color-border-subtle, var(--color-neutral-200));
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

    .subfeature-label-text {
      line-height: 1.35;
    }

    .default-badge,
    .extension-badge {
      display: inline-flex;
      align-items: center;
      margin-left: var(--spacing-2);
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
      padding: var(--spacing-3);
      font-size: var(--font-size-sm);
      color: var(--color-neutral-500);
    }

    .catalog-error {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--spacing-2);
      padding: var(--spacing-3);
      border: 1px solid var(--color-danger-200, #fecaca);
      border-radius: var(--radius-lg, 0.5rem);
      background: var(--color-danger-50, #fef2f2);
      color: var(--color-danger-700, #b91c1c);
      font-size: var(--font-size-sm);
    }

    .module-row-label {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      color: var(--color-neutral-800);
      cursor: pointer;
      line-height: 1.35;
      flex: 1;
      min-width: 0;
    }

    .user-dialog-footer-actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--spacing-3);
      width: 100%;
    }

    .user-dialog-body .w-full { width: 100%; }

    :host ::ng-deep .user-form-dialog.p-dialog {
      border-radius: var(--radius-xl, 0.75rem);
      box-shadow: var(--shadow-xl);
      overflow: hidden;
    }

    :host ::ng-deep .user-form-dialog .p-dialog-header {
      padding: var(--spacing-4) var(--spacing-6);
      border-bottom: 1px solid var(--color-border-subtle, #e2e8f0);
      background: var(--color-background-elevated, var(--color-white));
    }

    :host ::ng-deep .user-form-dialog .p-dialog-title {
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary, var(--color-neutral-900));
    }

    :host ::ng-deep .user-form-dialog .p-dialog-content {
      border-radius: 0;
    }

    :host ::ng-deep .user-form-dialog .p-dialog-footer {
      padding: var(--spacing-4) var(--spacing-6);
      border-top: 1px solid var(--color-border-subtle, #e2e8f0);
      background: var(--color-background-subtle, #f8fafc);
    }

    :host ::ng-deep .user-form-dialog .p-select,
    :host ::ng-deep .user-form-dialog .p-password,
    :host ::ng-deep .user-form-dialog .p-password .p-inputtext {
      width: 100%;
    }
  `]
})
export class TenantUsersListComponent implements OnInit {
  readonly loc_ui_tern_actif_2eb75f = $localize`:@@ui.tern.actif.2eb75f:Actif`;
  readonly loc_ui_tern_inactif_d2e033 = $localize`:@@ui.tern.inactif.d2e033:Inactif`;
  readonly loc_ui_tern_sous_modules_6ad740 = $localize`:@@ui.tern.sous.modules.6ad740:Sous-modules : `;
  private readonly tenantUsers = inject(TenantUsersService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);

  /** Exposés au template (fonctions importées). */
  readonly getModuleFeatureOptions = getModuleFeatureOptions;
  readonly isSubFeatureOn = isSubFeatureOn;

  readonly breadcrumbItems: BreadcrumbItem[] = [
    { label: $localize`:@@settings.tenant-users-list.ts.tableau.de.bord.a524057f:Tableau de bord`, route: '/dashboard', icon: 'pi-home' },
    { label: $localize`:@@settings.tenant-users-list.ts.parametres.ef8f0121:Paramètres`, route: '/settings' },
    { label: $localize`:@@settings.tenant-users-list.ts.utilisateurs.c661b3bc:Utilisateurs` }
  ];

  users = signal<TenantUserListItem[]>([]);
  loading = signal(false);
  saving = signal(false);
  createSaving = signal(false);

  /** Totaux de la zone, calculés sur les utilisateurs chargés (liste côté client). */
  summaryMetrics = computed<TotalMetric[]>(() => {
    const rows = this.users();
    return [
      { label: $localize`:@@settings.tenant-users-list.ts.utilisateurs.c661b3bc:Utilisateurs`, value: rows.length, format: 'number', icon: 'pi-users', tone: 'primary' },
      { label: $localize`:@@settings.tenant-users-list.ts.actifs.4fc3a980:Actifs`, value: rows.filter(u => u.isActive).length, format: 'number', icon: 'pi-check-circle', tone: 'emerald' },
      { label: $localize`:@@settings.tenant-users-list.ts.inactifs.41c2d03e:Inactifs`, value: rows.filter(u => !u.isActive).length, format: 'number', icon: 'pi-ban', tone: 'neutral' }
    ];
  });

  createVisible = false;
  createFirstName = '';
  createLastName = '';
  createEmail = '';
  createPassword = '';
  createPhone = '';
  createRole: UserRole = 'Accountant';
  createModuleDraft = signal<ModuleDraft[]>([]);
  /** Catalogue du rôle courant de la modale de création (rendu piloté par l'API, plan §4.a). */
  createCatalog = signal<ModuleCatalogModuleDto[]>([]);
  createCatalogLoading = signal(false);
  createCatalogError = signal(false);

  editVisible = false;
  editUser = signal<TenantUserListItem | null>(null);
  editRole: UserRole = 'Accountant';
  editActive = true;
  editNewPassword = '';
  moduleDraft = signal<ModuleDraft[]>([]);
  /** Catalogue du rôle courant de la modale d'édition. */
  editCatalog = signal<ModuleCatalogModuleDto[]>([]);
  editCatalogLoading = signal(false);
  editCatalogError = signal(false);
  /**
   * État stocké initial capturé à l'ouverture de l'édition (une entrée par ligne de grant persistée).
   * Un module absent de cette map est « absent » côté base : à l'enregistrement sans toucher, il est
   * omis du payload (absent reste absent). Utilisé uniquement pour la règle no-op (décision E).
   */
  private editInitialGrants = new Map<AppModule, { enabled: boolean; featureKeys: string[] | null }>();

  readonly roleOptions = [
    { label: $localize`:@@settings.tenant-users-list.ts.administrateur.1d8141b2:Administrateur`, value: 'Administrator' as UserRole },
    { label: $localize`:@@settings.tenant-users-list.ts.comptable.36cf0a9e:Comptable`, value: 'Accountant' as UserRole },
    { label: $localize`:@@settings.tenant-users-list.ts.commercial.b48513e4:Commercial`, value: 'SalesRep' as UserRole },
    { label: $localize`:@@settings.tenant-users-list.ts.responsable.commercial.faf99310:Responsable Commercial`, value: 'SalesManager' as UserRole },
    { label: $localize`:@@settings.tenant-users-list.ts.magasinier.c61a86f7:Magasinier`, value: 'Warehouse' as UserRole },
    { label: $localize`:@@settings.tenant-users-list.ts.acheteur.0afc4f6e:Acheteur`, value: 'Purchaser' as UserRole },
    { label: $localize`:@@settings.tenant-users-list.ts.caissier.8d597a37:Caissier`, value: 'Cashier' as UserRole },
    { label: $localize`:@@settings.tenant-users-list.ts.auditeur.eac73f9c:Auditeur`, value: 'Auditor' as UserRole },
    { label: $localize`:@@settings.tenant-users-list.ts.superviseur.27e5f8da:Superviseur`, value: 'Supervisor' as UserRole },
    { label: $localize`:@@settings.tenant-users-list.ts.developpeur.4819232b:Développeur`, value: 'Developer' as UserRole }
  ];

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.tenantUsers.list().subscribe({
      next: res => {
        this.loading.set(false);
        if (res.success && res.data) {
          this.users.set(res.data);
        } else {
          this.toast.add({ severity: 'error', summary: $localize`:@@tenant-users-list.component.summary.Erreur:Erreur`, detail: res.errors?.[0] ?? $localize`:@@ui.tern.chargement.impossible.4c82ff:Chargement impossible` });
        }
      },
      error: () => {
        this.loading.set(false);
        this.toast.add({ severity: 'error', summary: $localize`:@@tenant-users-list.component.summary.Erreur:Erreur`, detail: $localize`:@@tenant-users-list.component.detail.Impossible d:Impossible de charger les utilisateurs` });
      }
    });
  }

  formatDate(iso: string | null): string {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
    } catch {
      return '—';
    }
  }

  moduleLabel(m: AppModule): string {
    return APP_MODULE_OPTIONS.find(o => o.value === m)?.label ?? String(m);
  }

  /** Aligné avec l’API : un administrateur ne peut pas retirer le module Administration sur son propre compte. */
  isAdministrationModuleLockedForEdit(m: UserModuleAccessItem): boolean {
    if (m.module !== AppModule.Administration) {
      return false;
    }
    const row = this.editUser();
    const me = this.auth.user();
    return !!row && !!me && row.id === me.id;
  }

  /** Entrée de catalogue du rôle courant d'édition pour un module donné. */
  editCatalogModule(m: AppModule): ModuleCatalogModuleDto | undefined {
    return this.editCatalog().find(cm => cm.module === m);
  }

  /** Entrée de catalogue du rôle courant de création pour un module donné. */
  createCatalogModule(m: AppModule): ModuleCatalogModuleDto | undefined {
    return this.createCatalog().find(cm => cm.module === m);
  }

  /** Features cochables d'un module = celles avec `allowedPermissions` non vide (les autres sont masquées). */
  catalogVisibleFeatures(cm: ModuleCatalogModuleDto | undefined): ModuleCatalogFeatureDto[] {
    return cm?.features.filter(f => f.allowedPermissions.length > 0) ?? [];
  }

  /** Badge « Inclus par défaut » lorsque le module figure dans la base du rôle (`defaultEnabled`). */
  isModuleDefaultIncluded(cm: ModuleCatalogModuleDto | undefined): boolean {
    return !!cm?.defaultEnabled;
  }

  /** Libellé français d'une feature depuis le catalogue (la clé seule n'est pas localisée). */
  featureLabel(module: AppModule, key: string): string {
    return getModuleFeatureOptions(module).find(o => o.key === key)?.label ?? key;
  }

  /** Clés des features incluses par défaut (`defaultSelected`) — sert à pré-cocher la base du rôle. */
  private defaultFeatureKeys(cm: ModuleCatalogModuleDto): string[] {
    return cm.features.filter(f => f.defaultSelected).map(f => f.key);
  }

  openCreate(): void {
    this.closeEdit();
    this.resetCreateForm();
    this.createVisible = true;
    this.loadCreateCatalog(this.createRole);
  }

  closeCreate(): void {
    this.createVisible = false;
    this.resetCreateForm();
  }

  resetCreateForm(): void {
    this.createFirstName = '';
    this.createLastName = '';
    this.createEmail = '';
    this.createPassword = '';
    this.createPhone = '';
    this.createRole = 'Accountant';
    this.createCatalog.set([]);
    this.createCatalogError.set(false);
    this.createCatalogLoading.set(false);
    this.createModuleDraft.set([]);
  }

  onCreateRoleChange(role: UserRole): void {
    this.createRole = role;
    this.loadCreateCatalog(role);
  }

  private loadCreateCatalog(role: UserRole): void {
    this.createCatalogLoading.set(true);
    this.createCatalogError.set(false);
    this.tenantUsers.getModuleCatalog(role).subscribe({
      next: res => {
        this.createCatalogLoading.set(false);
        if (res.success && res.data) {
          this.createCatalog.set(res.data.modules);
          this.rebuildCreateDraft(res.data.modules);
        } else {
          this.createCatalogError.set(true);
          this.createCatalog.set([]);
          this.createModuleDraft.set([]);
        }
      },
      error: () => {
        this.createCatalogLoading.set(false);
        this.createCatalogError.set(true);
        this.createCatalog.set([]);
        this.createModuleDraft.set([]);
      }
    });
  }

  private rebuildCreateDraft(catalog: ModuleCatalogModuleDto[]): void {
    this.createModuleDraft.set(
      catalog
        // Deux filtres cumulatifs et indépendants : `grantable` = plafond du RÔLE,
        // `availableForTenant` = périmètre de la SOCIÉTÉ (module activé et couvert par l'offre).
        // Offrir un module que la société ne possède pas n'a aucun sens à la création, et le
        // serveur le refuserait de toute façon (ValidateModuleAccessItems).
        .filter(cm => cm.grantable && cm.availableForTenant !== false)
        .map(cm => ({
          module: cm.module,
          enabled: cm.defaultEnabled,
          enabledFeatureKeys: this.defaultFeatureKeys(cm),
          dirty: false
        }))
    );
  }

  onCreateSubFeatureChange(module: AppModule, featureKey: string, checked: boolean): void {
    this.createModuleDraft.update(draft => {
      const i = draft.findIndex(x => x.module === module);
      if (i < 0) return draft;
      const next = [...draft];
      next[i] = {
        ...withSubFeatureToggled(draft[i], featureKey, checked, this.visibleFeatureKeys(this.createCatalogModule(module))),
        dirty: true
      };
      return next;
    });
  }

  onEditSubFeatureChange(module: AppModule, featureKey: string, checked: boolean): void {
    this.moduleDraft.update(draft => {
      const i = draft.findIndex(x => x.module === module);
      if (i < 0) return draft;
      const next = [...draft];
      next[i] = {
        ...withSubFeatureToggled(draft[i], featureKey, checked, this.visibleFeatureKeys(this.editCatalogModule(module))),
        dirty: true
      };
      return next;
    });
  }

  /** Clés cochables du catalogue (plafond du rôle) — univers de normalisation d’un module touché. */
  private visibleFeatureKeys(cm: ModuleCatalogModuleDto | undefined): string[] {
    return this.catalogVisibleFeatures(cm).map(f => f.key);
  }

  afterCreateModuleEnabledChange(m: ModuleDraft): void {
    this.syncModuleEnabledInDraft(this.createModuleDraft, m);
  }

  afterEditModuleEnabledChange(m: ModuleDraft): void {
    this.syncModuleEnabledInDraft(this.moduleDraft, m);
  }

  private syncModuleEnabledInDraft(
    target: { update: (fn: (d: ModuleDraft[]) => ModuleDraft[]) => void },
    m: ModuleDraft
  ): void {
    target.update(draft => {
      const i = draft.findIndex(x => x.module === m.module);
      if (i < 0) return draft;
      const prev = draft[i];
      const next = [...draft];
      next[i] = m.enabled
        ? { ...prev, enabled: true, dirty: true }
        : { ...prev, enabled: false, enabledFeatureKeys: null, dirty: true };
      return next;
    });
  }

  saveCreate(): void {
    if (!this.createFirstName.trim() || !this.createLastName.trim() || !this.createEmail.trim() || !this.createPassword) {
      this.toast.add({
        severity: 'warn',
        summary: $localize`:@@tenant-users-list.component.summary.Champs requi:Champs requis`,
        detail: $localize`:@@tenant-users-list.component.detail.Renseignez_le_pr:Renseignez le prénom, le nom, l’email et le mot de passe.`
      });
      return;
    }

    this.createSaving.set(true);
    const payload = {
      email: this.createEmail.trim(),
      firstName: this.createFirstName.trim(),
      lastName: this.createLastName.trim(),
      password: this.createPassword,
      role: this.createRole,
      phoneNumber: this.createPhone.trim() || undefined,
      // Nouvel utilisateur : aucun état stocké initial → les modules non touchés restent absents
      // (jeu de base du rôle), seuls les modules explicitement configurés sont normalisés.
      moduleAccess: this.buildModuleAccessPayload(this.createModuleDraft(), new Map())
    };

    this.tenantUsers.create(payload).subscribe({
      next: res => {
        this.createSaving.set(false);
        if (res.success) {
          this.toast.add({ severity: 'success', summary: $localize`:@@tenant-users-list.component.summary.Créé:Créé`, detail: res.message ?? $localize`:@@ui.tern.utilisateur.cree.ba6887:Utilisateur créé` });
          this.createVisible = false;
          this.resetCreateForm();
          this.load();
        } else {
          this.toast.add({ severity: 'error', summary: $localize`:@@tenant-users-list.component.summary.Erreur:Erreur`, detail: res.errors?.[0] ?? $localize`:@@ui.tern.echec.de.la.creation.4fa170:Échec de la création` });
        }
      },
      error: () => {
        this.createSaving.set(false);
        this.toast.add({ severity: 'error', summary: $localize`:@@tenant-users-list.component.summary.Erreur:Erreur`, detail: $localize`:@@tenant-users-list.component.detail._chec_de_la_cr_a:Échec de la création` });
      }
    });
  }

  openEdit(row: TenantUserListItem): void {
    this.createVisible = false;
    this.resetCreateForm();
    this.editUser.set(row);
    this.editRole = row.role;
    this.editActive = row.isActive;
    this.editNewPassword = '';
    this.captureEditInitialGrants(row.moduleFeatures);
    this.editVisible = true;
    this.loadEditCatalog(row.role, false);
  }

  closeEdit(): void {
    this.editVisible = false;
    this.editUser.set(null);
    this.editCatalog.set([]);
    this.editCatalogError.set(false);
    this.editCatalogLoading.set(false);
    this.moduleDraft.set([]);
    this.editInitialGrants = new Map();
  }

  onEditRoleChange(role: UserRole): void {
    if (role === this.editRole) return;
    this.editRole = role;
    // Changement de rôle : on recharge le catalogue et reconstruit le brouillon sur les défauts du
    // nouveau rôle en marquant tous les modules visibles « touchés » — on ne reproduit jamais les
    // grants stockés de l'ancien rôle (potentiellement hors plafond pour le nouveau rôle).
    this.loadEditCatalog(role, true);
  }

  private captureEditInitialGrants(stored: TenantUserListItem['moduleFeatures']): void {
    this.editInitialGrants = new Map();
    if (!stored || stored.length === 0) return;
    for (const sf of stored) {
      this.editInitialGrants.set(sf.module, {
        enabled: sf.enabled,
        featureKeys: sf.featureKeys == null ? null : [...sf.featureKeys]
      });
    }
  }

  private loadEditCatalog(role: UserRole, markAllDirty: boolean): void {
    this.editCatalogLoading.set(true);
    this.editCatalogError.set(false);
    this.tenantUsers.getModuleCatalog(role).subscribe({
      next: res => {
        this.editCatalogLoading.set(false);
        if (res.success && res.data) {
          this.editCatalog.set(res.data.modules);
          this.rebuildEditDraft(res.data.modules, markAllDirty);
        } else {
          this.editCatalogError.set(true);
          this.editCatalog.set([]);
          this.moduleDraft.set([]);
        }
      },
      error: () => {
        this.editCatalogLoading.set(false);
        this.editCatalogError.set(true);
        this.editCatalog.set([]);
        this.moduleDraft.set([]);
      }
    });
  }

  /**
   * Reconstruit le brouillon d'édition depuis le catalogue. `markAllDirty=false` (ouverture) conserve
   * l'état stocké initial par module (`null` reste `null`, liste explicite reste identique) et les
   * modules absents affichent le défaut du rôle (reproduits absents à l'enregistrement). `markAllDirty=true`
   * (changement de rôle) repart des défauts du nouveau rôle, tous marqués touchés.
   */
  private rebuildEditDraft(catalog: ModuleCatalogModuleDto[], markAllDirty: boolean): void {
    const draft: ModuleDraft[] = [];
    for (const cm of catalog) {
      if (!cm.grantable) continue; // masqué (plafond vide / rôle exclu)

      // Périmètre de la société : on masque un module indisponible SAUF si l'utilisateur le détient
      // déjà. Un droit hérité d'avant la désactivation du module reste visible et modifiable —
      // sinon la simple ouverture de la modale le supprimerait au premier enregistrement, alors
      // qu'un retrait doit rester une action explicite. Le serveur tolère symétriquement les droits
      // préexistants sur le PATCH (ensemble « tolerated » de TenantUsersController).
      if (cm.availableForTenant === false && !this.editInitialGrants.get(cm.module)?.enabled) continue;
      let enabled: boolean;
      let featureKeys: string[] | null;
      if (markAllDirty) {
        enabled = cm.defaultEnabled;
        featureKeys = this.defaultFeatureKeys(cm);
      } else {
        const stored = this.editInitialGrants.get(cm.module);
        if (stored) {
          enabled = stored.enabled;
          featureKeys = stored.featureKeys;
        } else {
          enabled = cm.defaultEnabled;
          featureKeys = this.defaultFeatureKeys(cm);
        }
      }
      draft.push({ module: cm.module, enabled, enabledFeatureKeys: featureKeys, dirty: markAllDirty });
    }
    this.moduleDraft.set(draft);
  }

  saveEdit(): void {
    const u = this.editUser();
    if (!u) return;
    this.saving.set(true);
    const body: Parameters<TenantUsersService['update']>[1] = {
      role: this.editRole,
      isActive: this.editActive,
      moduleAccess: this.buildModuleAccessPayload(this.moduleDraft(), this.editInitialGrants)
    };
    if (this.editNewPassword.trim()) {
      body.newPassword = this.editNewPassword.trim();
    }
    this.tenantUsers.update(u.id, body).subscribe({
      next: res => {
        this.saving.set(false);
        if (res.success) {
          // Message de révocation renvoyé par l'API (sessions en cours révoquées) affiché en toast.
          this.toast.add({ severity: 'success', summary: $localize`:@@tenant-users-list.component.summary.Enregistr_:Enregistré`, detail: res.message ?? $localize`:@@ui.tern.utilisateur.mis.a.jour.41ad5f:Utilisateur mis à jour` });
          this.closeEdit();
          this.load();
        } else {
          this.toast.add({ severity: 'error', summary: $localize`:@@tenant-users-list.component.summary.Erreur:Erreur`, detail: res.errors?.[0] ?? $localize`:@@ui.tern.echec.de.la.mise.a.jour.4b4c25:Échec de la mise à jour` });
        }
      },
      error: () => {
        this.saving.set(false);
        this.toast.add({ severity: 'error', summary: $localize`:@@tenant-users-list.component.summary.Erreur:Erreur`, detail: $localize`:@@tenant-users-list.component.detail.Échec de la :Échec de la mise à jour` });
      }
    });
  }

  /**
   * Règle de persistance §5.2 / décision E : un module non touché reproduit exactement son état stocké
   * initial (absent → omis, `null` → omis, liste explicite → identique) via `toModuleAccessApiPayload` ;
   * un module touché est normalisé vers la sélection visible. Aucune normalisation silencieuse.
   */
  private buildModuleAccessPayload(
    draft: ModuleDraft[],
    initial: Map<AppModule, { enabled: boolean; featureKeys: string[] | null }>
  ): Array<{ module: AppModule; enabled: boolean; enabledFeatureKeys?: string[] | null }> {
    const result: Array<{ module: AppModule; enabled: boolean; enabledFeatureKeys?: string[] | null }> = [];
    for (const m of draft) {
      if (m.dirty) {
        result.push(...toModuleAccessApiPayload([m]));
      } else {
        const stored = initial.get(m.module);
        if (!stored) continue; // absent reste absent
        result.push(
          ...toModuleAccessApiPayload([
            { module: m.module, enabled: stored.enabled, enabledFeatureKeys: stored.featureKeys }
          ])
        );
      }
    }
    return result;
  }
}
