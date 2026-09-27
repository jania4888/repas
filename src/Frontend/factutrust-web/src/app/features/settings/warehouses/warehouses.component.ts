/// <reference types="@angular/localize" />
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject, takeUntil } from 'rxjs';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { Textarea } from 'primeng/textarea';
import { InputSwitchModule } from 'primeng/inputswitch';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { ToastService } from '@core/services/toast.service';
import { erpCollatorCompare } from '@core/i18n/erp-format';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import {
  StockService,
  Warehouse,
  CreateWarehouseRequest,
  UpdateWarehouseRequest
} from '@core/services/stock.service';
import { CashRegisterDto, PosRegisterSessionService } from '../../pos/services/pos-register-session.service';

@Component({
  selector: 'app-warehouses',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ReactiveFormsModule,
    TableModule,
    ButtonModule,
    DialogModule,
    InputTextModule,
    Textarea,
    InputSwitchModule,
    CardModule,
    TagModule,
    PageHeaderComponent,
    BreadcrumbComponent
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems"></app-breadcrumb>

    <app-page-header
      title="Entrepôts" i18n-title="@@settings.warehouses.entrepots.c0906d10"
      subtitle="Lieux de stockage utilisés pour le stock, les transferts et les documents" i18n-subtitle="@@settings.warehouses.lieux.de.stockage.utilises.pour.le.stock.0b3fad57">
      <div class="header-actions">
        <p-button
          label="Retour" i18n-label="@@settings.warehouses.retour.e5befb1f"
          icon="pi pi-arrow-left"
          [outlined]="true"
          severity="secondary"
          routerLink="/settings">
        </p-button>
        <p-button
          label="Ajouter" i18n-label="@@settings.warehouses.ajouter.87c57ed1"
          icon="pi pi-plus"
          severity="primary"
          (onClick)="openCreateDialog()"
          [disabled]="loading()">
        </p-button>
      </div>
    </app-page-header>

    @if (loadError()) {
      <div class="error-banner" role="alert">
        <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
        <p>{{ loadError() }}</p>
        <p-button label="Réessayer" i18n-label="@@settings.warehouses.reessayer.895d416b" icon="pi pi-refresh" [outlined]="true" (onClick)="loadWarehouses()"></p-button>
      </div>
    }

    @if (loading() && !warehouses().length && !loadError()) {
      <div class="loading-container" role="status" aria-live="polite">
        <i class="pi pi-spin pi-spinner" style="font-size: 2rem" aria-hidden="true"></i>
        <p i18n="@@settings.warehouses.chargement.des.entrepots.d1d834ab">Chargement des entrepôts...</p>
      </div>
    } @else if (!loadError()) {
      <div class="warehouses-page">
        <p-card header="Liste des entrepôts" i18n-header="@@settings.warehouses.liste.des.entrepots.e4e1d3be" styleClass="warehouses-card">
          <div class="card-toolbar">
            <div class="search-field">
              <label class="sr-only" for="warehouse-search" i18n="@@settings.warehouses.rechercher.un.entrepot.80fc0c59">Rechercher un entrepôt</label>
              <span class="search-input-wrap">
                <i class="pi pi-search search-icon" aria-hidden="true"></i>
                <input
                  id="warehouse-search"
                  type="text"
                  pInputText
                  class="search-input"
                  placeholder="Rechercher par code, nom ou adresse…" i18n-placeholder="@@settings.warehouses.rechercher.par.code.nom.ou.adresse.5be498b3"
                  [value]="searchQuery()"
                  (input)="onSearchInput($event)"
                  autocomplete="off" />
              </span>
              @if (searchQuery().trim()) {
                <p-button
                  type="button"
                  label="Effacer" i18n-label="@@settings.warehouses.effacer.fe23de7b"
                  icon="pi pi-times"
                  [text]="true"
                  (onClick)="clearSearch()"
                  styleClass="p-button-sm">
                </p-button>
              }
            </div>
          </div>

          @if (warehouses().length > 0 && filteredWarehouses().length === 0 && searchQuery().trim()) {
            <div class="filter-empty" role="status">
              <i class="pi pi-filter-slash" aria-hidden="true"></i>
              <p i18n="@@settings.warehouses.aucun.resultat.pour.cette.recherche.7e7f8c98">Aucun résultat pour cette recherche.</p>
              <p-button label="Réinitialiser le filtre" i18n-label="@@settings.warehouses.reinitialiser.le.filtre.d3da2f54" [outlined]="true" (onClick)="clearSearch()"></p-button>
            </div>
          } @else {
            <p-table
              [value]="filteredWarehouses()"
              [paginator]="filteredWarehouses().length > 10"
              [rows]="10"
              responsiveLayout="scroll"
              styleClass="p-datatable-sm warehouses-table">
              <ng-template pTemplate="header">
                <tr>
                  <th scope="col" i18n="@@settings.warehouses.code.adac6937">Code</th>
                  <th scope="col" i18n="@@settings.warehouses.nom.7ff20370">Nom</th>
                  <th scope="col" i18n="@@settings.warehouses.adresse.522e1466">Adresse</th>
                  <th scope="col" i18n="@@settings.warehouses.par.defaut.4550c68e">Par défaut</th>
                  <th scope="col" i18n="@@settings.warehouses.etat.d3b28a2a">État</th>
                  <th scope="col" class="col-actions" i18n="@@settings.warehouses.actions.c3cd636a">Actions</th>
                </tr>
              </ng-template>
              <ng-template pTemplate="body" let-row>
                <tr>
                  <td><span class="code-cell">{{ row.code }}</span></td>
                  <td>{{ row.name }}</td>
                  <td class="address-cell">{{ row.address || '—' }}</td>
                  <td>
                    <p-tag
                      [value]="row.isDefault ? loc_ui_tern_oui_eaa02f : loc_ui_tern_non_a72199"
                      [severity]="row.isDefault ? 'success' : 'secondary'">
                    </p-tag>
                  </td>
                  <td>
                    <p-tag
                      [value]="row.isActive ? loc_ui_tern_actif_2eb75f : loc_ui_tern_inactif_d2e033"
                      [severity]="row.isActive ? 'success' : 'warn'">
                    </p-tag>
                  </td>
                  <td class="col-actions">
                    <p-button
                      icon="pi pi-inbox"
                      [text]="true"
                      [rounded]="true"
                      (onClick)="openRegistersDialog(row)"
                      [attr.aria-label]="loc_ui_tern_caisses_pos_891ab7 + row.name">
                    </p-button>
                    <p-button
                      icon="pi pi-pencil"
                      [text]="true"
                      [rounded]="true"
                      (onClick)="openEditDialog(row)"
                      [attr.aria-label]="loc_ui_tern_modifier_6efdfe + row.name">
                    </p-button>
                  </td>
                </tr>
              </ng-template>
              <ng-template pTemplate="emptymessage">
                <tr>
                  <td colspan="6" class="empty-cell" i18n="@@settings.warehouses.aucun.entrepot.utilisez.ajouter.pour.creer.votre.0bda79b8"> Aucun entrepôt. Utilisez « Ajouter » pour créer votre premier lieu de stockage. </td>
                </tr>
              </ng-template>
            </p-table>
          }
        </p-card>
      </div>
    }

    <p-dialog
      [header]="dialogTitle()"
      [(visible)]="dialogVisible"
      [modal]="true"
      [style]="{ width: 'min(520px, 95vw)' }"
      [draggable]="false"
      [dismissableMask]="true"
      [breakpoints]="{ '576px': '95vw' }"
      (onHide)="onDialogHide()"
      [attr.aria-modal]="true"
      styleClass="warehouses-dialog">
      <p class="dialog-intro" i18n="@@settings.warehouses.indiquez.un.nom.court.libelle.interne.ma.1653cc24">
        <ng-container> Indiquez un </ng-container> <strong>nom</strong> court (libellé interne : magasin, dépôt principal, etc.).
        L’<strong>adresse</strong>, facultative, peut reprendre rue, ville, code postal et pays sur plusieurs lignes.
      </p>
      <form [formGroup]="form" (ngSubmit)="onSubmitForm()" class="wh-form">
        @if (isEditMode()) {
          <label class="form-field" for="wh-code-readonly">
            <span class="label-text" i18n="@@settings.warehouses.code.adac6937">Code</span>
            <input
              pInputText
              id="wh-code-readonly"
              [value]="editingWarehouse()?.code ?? ''"
              class="w-full"
              readonly
              tabindex="-1" />
            <small class="hint" i18n="@@settings.warehouses.le.code.ne.peut.pas.etre.modifie.apres.la.creati.fa3d64d7">Le code ne peut pas être modifié après la création.</small>
          </label>
        } @else {
          <label class="form-field" for="wh-code">
            <span class="label-text"><ng-container i18n="@@settings.warehouses.code.adac6937">Code </ng-container> <span class="required" aria-hidden="true" i18n="@@settings.warehouses.text.df58248c">*</span></span>
            <input
              pInputText
              id="wh-code"
              formControlName="code"
              class="w-full"
              autocomplete="off"
              maxlength="20"
              [class.ng-invalid]="isInvalid('code')" />
            @if (isInvalid('code')) {
              <small class="error-text">{{ fieldError('code') }}</small>
            }
          </label>
        }

        <label class="form-field" for="wh-name">
          <span class="label-text"><ng-container i18n="@@settings.warehouses.nom.7ff20370">Nom </ng-container> <span class="required" aria-hidden="true" i18n="@@settings.warehouses.text.df58248c">*</span></span>
          <input
            pInputText
            id="wh-name"
            formControlName="name"
            class="w-full"
            autocomplete="organization"
            maxlength="100"
            [class.ng-invalid]="isInvalid('name')" />
          @if (isInvalid('name')) {
            <small class="error-text">{{ fieldError('name') }}</small>
          }
        </label>

        <label class="form-field" for="wh-address">
          <span class="label-text" i18n="@@settings.warehouses.adresse.522e1466">Adresse</span>
          <textarea
            pTextarea
            id="wh-address"
            formControlName="address"
            class="w-full"
            [rows]="3"
            placeholder="Rue, ville, code postal, pays…" i18n-placeholder="@@settings.warehouses.rue.ville.code.postal.pays.d89c1b2e">
          </textarea>
        </label>

        <div class="form-field switch-block">
          <div class="switch-field">
            <span class="label-text" id="wh-default-label" i18n="@@settings.warehouses.entrepot.par.defaut.5dc0b8c6">Entrepôt par défaut</span>
            <p-inputSwitch
              formControlName="isDefault"
              inputId="wh-default"
              [attr.aria-labelledby]="'wh-default-label'">
            </p-inputSwitch>
          </div>
          <small class="hint switch-hint" i18n="@@settings.warehouses.utilise.par.defaut.pour.le.stock.et.les.document.b0aef0d3"> Utilisé par défaut pour le stock et les documents lorsqu’aucun autre entrepôt n’est précisé. </small>
        </div>

        <div class="dialog-actions">
          <p-button
            type="button"
            label="Annuler" i18n-label="@@settings.warehouses.annuler.49ba3292"
            [outlined]="true"
            severity="secondary"
            (onClick)="dialogVisible = false">
          </p-button>
          <p-button
            type="submit"
            label="Enregistrer" i18n-label="@@settings.warehouses.enregistrer.f7c8bcd8"
            icon="pi pi-check"
            severity="primary"
            [loading]="saving()"
            [disabled]="form.invalid || saving()">
          </p-button>
        </div>
      </form>
    </p-dialog>

    <p-dialog
      header="Caisses POS" i18n-header="@@settings.warehouses.caisses.pos.4ec932cb"
      [(visible)]="registersDialogVisible"
      [modal]="true"
      [style]="{ width: 'min(560px, 95vw)' }"
      [draggable]="false"
      [dismissableMask]="true">
      <p class="dialog-intro" i18n="@@settings.warehouses.caisses.du.magasin.une.seule.caisse.est.baee9d8d">
        <ng-container> Caisses du magasin </ng-container> <strong>{{ registersWarehouse()?.name }}</strong>. Une seule caisse est
        marquée défaut (utilisée si aucune caisse n'est choisie).
      </p>
      @if (registersLoading()) {
        <p i18n="@@settings.warehouses.chargement.01cba1df">Chargement…</p>
      } @else {
        <ul class="registers-list">
          @for (reg of warehouseRegisters(); track reg.id) {
            <li>
              <strong>{{ reg.code }}</strong> — {{ reg.name }}
              @if (reg.isDefault) {
                <p-tag value="Défaut" severity="success"></p-tag>
              }
            </li>
          }
        </ul>
      }
      <form [formGroup]="registerForm" (ngSubmit)="submitCreateRegister()" class="wh-form">
        <label class="form-field" for="reg-code">
          <span class="label-text" i18n="@@settings.warehouses.code.adac6937">Code</span>
          <input pInputText id="reg-code" formControlName="code" class="w-full" maxlength="20" />
        </label>
        <label class="form-field" for="reg-name">
          <span class="label-text" i18n="@@settings.warehouses.nom.7ff20370">Nom</span>
          <input pInputText id="reg-name" formControlName="name" class="w-full" maxlength="100" />
        </label>
        <div class="switch-field">
          <span i18n="@@settings.warehouses.caisse.par.defaut.f4c511df">Caisse par défaut</span>
          <p-inputSwitch formControlName="isDefault"></p-inputSwitch>
        </div>
        <div class="dialog-actions">
          <p-button type="button" label="Fermer" i18n-label="@@settings.warehouses.fermer.5ab4ec64" [outlined]="true" (onClick)="registersDialogVisible = false"></p-button>
          <p-button type="submit" label="Ajouter une caisse" i18n-label="@@settings.warehouses.ajouter.une.caisse.b0733ef1" icon="pi pi-plus" [loading]="registerSaving()"></p-button>
        </div>
      </form>
    </p-dialog>
  `,
  styles: [`
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    .warehouses-page {
      width: 100%;
      max-width: min(1200px, 100%);
      margin: 0 auto;
    }

    :host ::ng-deep .warehouses-card.p-card {
      border-radius: var(--radius-xl);
      box-shadow: var(--shadow-sm, 0 1px 3px rgba(0, 0, 0, 0.08));
      border: 1px solid var(--color-neutral-200);
    }

    :host ::ng-deep .warehouses-card .p-card-title {
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-semibold);
      color: var(--color-neutral-900);
      margin-bottom: 0;
    }

    :host ::ng-deep .warehouses-card .p-card-body {
      padding-top: var(--spacing-3);
    }

    .card-toolbar {
      margin-bottom: var(--spacing-4);
    }

    .search-field {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--spacing-2);
    }

    .search-input-wrap {
      position: relative;
      flex: 1;
      min-width: min(100%, 280px);
      max-width: 420px;
    }

    .search-icon {
      position: absolute;
      left: 0.75rem;
      top: 50%;
      transform: translateY(-50%);
      color: var(--color-neutral-400);
      font-size: 0.9rem;
      pointer-events: none;
      z-index: 1;
    }

    .search-input {
      width: 100%;
      padding-left: 2.25rem !important;
    }

    .filter-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--spacing-3);
      padding: var(--spacing-8) var(--spacing-4);
      text-align: center;
      color: var(--color-neutral-600);
      background: var(--color-neutral-50);
      border-radius: var(--radius-lg);
      border: 1px dashed var(--color-neutral-200);
    }

    .filter-empty i {
      font-size: 1.75rem;
      color: var(--color-neutral-400);
    }

    .filter-empty p {
      margin: 0;
    }

    :host ::ng-deep .warehouses-table.p-datatable .p-datatable-thead > tr > th {
      background: var(--color-neutral-50);
      color: var(--color-neutral-700);
      font-weight: var(--font-weight-semibold);
      font-size: var(--font-size-xs);
      text-transform: uppercase;
      letter-spacing: 0.03em;
      border-bottom: 1px solid var(--color-neutral-200);
    }

    :host ::ng-deep .warehouses-table.p-datatable .p-datatable-tbody > tr > td {
      border-color: var(--color-neutral-100);
      vertical-align: middle;
    }

    :host ::ng-deep .warehouses-table.p-datatable .p-datatable-tbody > tr:nth-child(even) {
      background: var(--color-neutral-25, rgba(0, 0, 0, 0.02));
    }

    :host ::ng-deep .warehouses-table.p-datatable .p-datatable-tbody > tr:hover {
      background: var(--color-primary-50, rgba(59, 130, 246, 0.06));
    }

    :host ::ng-deep .warehouses-table.p-datatable {
      border-radius: var(--radius-md);
      overflow: hidden;
    }

    .header-actions {
      display: flex;
      gap: var(--spacing-2);
      flex-wrap: wrap;
      align-items: center;
    }
    .loading-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: var(--spacing-8);
      gap: var(--spacing-3);
      color: var(--color-neutral-600);
    }
    .error-banner {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--spacing-3);
      padding: var(--spacing-4);
      margin-bottom: var(--spacing-4);
      background: var(--color-error-50, #fef2f2);
      border: 1px solid var(--color-error-200, #fecaca);
      border-radius: var(--radius-lg);
      color: var(--color-neutral-800);
    }
    .error-banner i {
      color: var(--color-error-600, #dc2626);
    }
    .error-banner p {
      margin: 0;
      flex: 1;
      min-width: 200px;
    }
    .dialog-intro {
      margin: 0 0 var(--spacing-4);
      padding: var(--spacing-3);
      font-size: var(--font-size-sm);
      color: var(--color-neutral-600);
      line-height: 1.5;
      background: var(--color-neutral-50);
      border-radius: var(--radius-md);
      border: 1px solid var(--color-neutral-100);
    }
    .wh-form {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-4);
    }
    .form-field {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
    }
    .switch-block {
      gap: var(--spacing-1);
    }
    .switch-hint {
      margin-top: 0;
    }
    .label-text {
      font-weight: var(--font-weight-medium);
      color: var(--color-neutral-700);
      font-size: var(--font-size-sm);
    }
    .required {
      color: var(--color-error-500);
    }
    .hint {
      font-size: var(--font-size-xs);
      color: var(--color-neutral-500);
    }
    .error-text {
      color: var(--color-error-600);
      font-size: var(--font-size-xs);
    }
    .switch-field {
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
    }
    .dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--spacing-2);
      margin-top: var(--spacing-2);
      padding-top: var(--spacing-4);
      border-top: 1px solid var(--color-neutral-200);
    }
    .empty-cell {
      text-align: center;
      color: var(--color-neutral-500);
      padding: var(--spacing-6) !important;
    }
    .col-actions {
      white-space: nowrap;
      text-align: right;
    }
    .registers-list {
      list-style: none;
      padding: 0;
      margin: 0 0 var(--spacing-4);
    }
    .registers-list li {
      display: flex;
      gap: var(--spacing-2);
      align-items: center;
      padding: var(--spacing-2) 0;
      border-bottom: 1px solid var(--color-neutral-200);
    }
    .code-cell {
      font-family: ui-monospace, monospace;
      font-size: var(--font-size-sm);
    }
    .address-cell {
      max-width: 280px;
      white-space: pre-wrap;
      word-break: break-word;
    }
  `]
})
export class WarehousesComponent implements OnInit, OnDestroy {
  readonly loc_ui_tern_oui_eaa02f = $localize`:@@ui.tern.oui.eaa02f:Oui`;
  readonly loc_ui_tern_non_a72199 = $localize`:@@ui.tern.non.a72199:Non`;
  readonly loc_ui_tern_actif_2eb75f = $localize`:@@ui.tern.actif.2eb75f:Actif`;
  readonly loc_ui_tern_inactif_d2e033 = $localize`:@@ui.tern.inactif.d2e033:Inactif`;
  readonly loc_ui_tern_caisses_pos_891ab7 = $localize`:@@ui.tern.caisses.pos.891ab7:Caisses POS `;
  readonly loc_ui_tern_modifier_6efdfe = $localize`:@@ui.tern.modifier.6efdfe:Modifier `;
  private readonly stockService = inject(StockService);
  private readonly toast = inject(ToastService);
  private readonly errorHandler = inject(ErrorHandlerService);
  private readonly fb = inject(FormBuilder);
  private readonly posRegisters = inject(PosRegisterSessionService);
  private readonly destroy$ = new Subject<void>();

  breadcrumbItems: BreadcrumbItem[] = [
    { label: 'Tableau de bord', route: '/dashboard', icon: 'pi-home' },
    { label: 'Paramètres', route: '/settings' },
    { label: 'Entrepôts' }
  ];

  loading = signal(false);
  saving = signal(false);
  warehouses = signal<Warehouse[]>([]);
  loadError = signal<string | null>(null);

  searchQuery = signal('');

  filteredWarehouses = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const list = this.warehouses();
    if (!q) {
      return list;
    }
    return list.filter(
      (w) =>
        w.code.toLowerCase().includes(q) ||
        w.name.toLowerCase().includes(q) ||
        (w.address !== null && w.address.toLowerCase().includes(q))
    );
  });

  dialogVisible = false;
  editingWarehouse = signal<Warehouse | null>(null);

  isEditMode = computed(() => this.editingWarehouse() !== null);

  dialogTitle = computed(() => (this.editingWarehouse() ? $localize`:@@ui.tern.modifier.l.entrepot.141e5c:Modifier l’entrepôt` : $localize`:@@ui.tern.nouvel.entrepot.4829f5:Nouvel entrepôt`));

  form = this.fb.nonNullable.group({
    code: ['', [Validators.required, Validators.maxLength(20)]],
    name: ['', [Validators.required, Validators.maxLength(100)]],
    address: [''],
    isDefault: [false]
  });

  registersDialogVisible = false;
  registersWarehouse = signal<Warehouse | null>(null);
  warehouseRegisters = signal<CashRegisterDto[]>([]);
  registersLoading = signal(false);
  registerSaving = signal(false);
  registerForm = this.fb.nonNullable.group({
    code: ['', [Validators.required, Validators.maxLength(20)]],
    name: ['', [Validators.required, Validators.maxLength(100)]],
    isDefault: [false]
  });

  openRegistersDialog(row: Warehouse): void {
    this.registersWarehouse.set(row);
    this.registersDialogVisible = true;
    this.registerForm.reset({ code: '', name: '', isDefault: false });
    this.registersLoading.set(true);
    this.posRegisters.listRegisters(row.id).pipe(takeUntil(this.destroy$)).subscribe({
      next: list => {
        this.warehouseRegisters.set(list);
        this.registersLoading.set(false);
      },
      error: () => {
        this.warehouseRegisters.set([]);
        this.registersLoading.set(false);
      }
    });
  }

  submitCreateRegister(): void {
    const warehouse = this.registersWarehouse();
    if (!warehouse || this.registerForm.invalid) {
      this.registerForm.markAllAsTouched();
      return;
    }
    const v = this.registerForm.getRawValue();
    this.registerSaving.set(true);
    this.posRegisters
      .createRegister({
        warehouseId: warehouse.id,
        code: v.code.trim(),
        name: v.name.trim(),
        isDefault: v.isDefault
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: created => {
          this.registerSaving.set(false);
          this.warehouseRegisters.update(list => [...list, created]);
          this.registerForm.reset({ code: '', name: '', isDefault: false });
          this.toast.add({ severity: 'success', summary: $localize`:@@warehouses.component.summary.Caisse créée:Caisse créée`, detail: created.code, life: 3000 });
        },
        error: (err: HttpErrorResponse) => {
          this.registerSaving.set(false);
          this.toast.add({
            severity: 'error',
            summary: $localize`:@@warehouses.component.summary.Erreur:Erreur`,
            detail: this.errorHandler.extractErrorMessage(err) || 'Création de caisse impossible'
          });
        }
      });
  }

  ngOnInit(): void {
    this.loadWarehouses();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onSearchInput(event: Event): void {
    const v = (event.target as HTMLInputElement).value;
    this.searchQuery.set(v);
  }

  clearSearch(): void {
    this.searchQuery.set('');
  }

  loadWarehouses(): void {
    this.loadError.set(null);
    this.loading.set(true);
    this.stockService
      .getWarehouses(false)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          if (res.success && res.data) {
            this.warehouses.set([...res.data].sort((a, b) => erpCollatorCompare(a.name, b.name)));
          } else {
            this.loadError.set(res.errors?.join(', ') || res.message || 'Chargement impossible');
          }
          this.loading.set(false);
        },
        error: (err: HttpErrorResponse) => {
          this.errorHandler.logError('Failed to load warehouses', err);
          this.loadError.set(
            this.errorHandler.extractErrorMessage(err) || 'Impossible de charger les entrepôts'
          );
          this.loading.set(false);
        }
      });
  }

  openCreateDialog(): void {
    this.editingWarehouse.set(null);
    this.form.reset({
      code: '',
      name: '',
      address: '',
      isDefault: false
    });
    this.form.get('code')?.enable();
    this.dialogVisible = true;
  }

  openEditDialog(row: Warehouse): void {
    this.editingWarehouse.set(row);
    this.form.patchValue({
      code: row.code,
      name: row.name,
      address: row.address ?? '',
      isDefault: row.isDefault
    });
    this.form.get('code')?.disable();
    this.dialogVisible = true;
  }

  onDialogHide(): void {
    this.editingWarehouse.set(null);
    this.form.get('code')?.enable();
  }

  isInvalid(name: 'code' | 'name'): boolean {
    const c = this.form.get(name);
    return !!c && c.invalid && (c.dirty || c.touched);
  }

  fieldError(name: 'code' | 'name'): string {
    const c = this.form.get(name);
    if (!c?.errors) return '';
    if (c.errors['required']) return 'Ce champ est obligatoire';
    if (c.errors['maxlength']) return 'Longueur maximale dépassée';
    return '';
  }

  onSubmitForm(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const w = this.editingWarehouse();
    if (w) {
      this.submitUpdate(w.id);
    } else {
      this.submitCreate();
    }
  }

  private submitCreate(): void {
    const v = this.form.getRawValue();
    const code = v.code.trim();
    const name = v.name.trim();
    if (!code || !name) {
      this.toast.add({ severity: 'warn', summary: $localize`:@@warehouses.component.summary.Validation:Validation`, detail: $localize`:@@warehouses.component.detail.Code_et_nom_sont:Code et nom sont obligatoires` });
      return;
    }

    const request: CreateWarehouseRequest = {
      code,
      name,
      address: v.address?.trim() || null,
      isDefault: v.isDefault
    };

    this.saving.set(true);
    this.stockService
      .createWarehouse(request)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.saving.set(false);
          if (res.success) {
            this.toast.add({
              severity: 'success',
              summary: $localize`:@@warehouses.component.summary.Succès:Succès`,
              detail: res.message || 'Entrepôt créé',
              life: 3000
            });
            this.dialogVisible = false;
            this.loadWarehouses();
          } else {
            this.toast.add({
              severity: 'error',
              summary: $localize`:@@warehouses.component.summary.Erreur:Erreur`,
              detail: res.errors?.join(', ') || res.message || 'Création impossible'
            });
          }
        },
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          this.errorHandler.logError('Create warehouse failed', err);
          this.toast.add({
            severity: 'error',
            summary: $localize`:@@warehouses.component.summary.Erreur:Erreur`,
            detail: this.errorHandler.extractErrorMessage(err) || 'Création impossible'
          });
        }
      });
  }

  private submitUpdate(id: string): void {
    const v = this.form.getRawValue();
    const name = v.name.trim();
    if (!name) {
      this.toast.add({ severity: 'warn', summary: $localize`:@@warehouses.component.summary.Validation:Validation`, detail: $localize`:@@warehouses.component.detail.Le_nom_est_oblig:Le nom est obligatoire` });
      return;
    }

    const request: UpdateWarehouseRequest = {
      id,
      name,
      address: v.address?.trim() || null,
      isDefault: v.isDefault
    };

    this.saving.set(true);
    this.stockService
      .updateWarehouse(id, request)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.toast.add({
            severity: 'success',
            summary: $localize`:@@warehouses.component.summary.Succès:Succès`,
            detail: $localize`:@@warehouses.component.detail.Entrep_t_mis_j:Entrepôt mis à jour`,
            life: 3000
          });
          this.dialogVisible = false;
          this.loadWarehouses();
        },
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          this.errorHandler.logError('Update warehouse failed', err);
          this.toast.add({
            severity: 'error',
            summary: $localize`:@@warehouses.component.summary.Erreur:Erreur`,
            detail: this.errorHandler.extractErrorMessage(err) || 'Mise à jour impossible'
          });
        }
      });
  }
}
