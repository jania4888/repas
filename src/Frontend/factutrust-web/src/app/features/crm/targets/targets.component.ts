/// <reference types="@angular/localize" />
import { Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { SelectModule } from 'primeng/select';
import { InputNumberModule } from 'primeng/inputnumber';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { CrmService, CrmAssignableUserDto, SalesTargetDto } from '../services/crm.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { ToastService } from '@core/services/toast.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { AuthService } from '@core/services/auth.service';
import { OverlayOptions } from 'primeng/api';

const MONTH_NAMES_FR = [
  '',
  'Janvier',
  'Février',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Août',
  'Septembre',
  'Octobre',
  'Novembre',
  'Décembre'
];

@Component({
  selector: 'app-targets',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    TableModule,
    SelectModule,
    InputNumberModule,
    PageHeaderComponent,
    ButtonComponent
  ],
  template: `
    <app-page-header title="Objectifs commerciaux" i18n-title="@@crm.targets.objectifs.commerciaux.48084d31" subtitle="Suivi mensuel par commercial" />

    <div class="card p-3 mb-3 targets-toolbar">
      <div class="toolbar-row">
        <p-select
          [options]="yearOptions"
          [(ngModel)]="filterYear"
          optionLabel="label"
          optionValue="value"
          inputId="tgtYear"
          styleClass="toolbar-dropdown"
          (onChange)="load()"
          [attr.aria-label]="'Filtrer par année'"></p-select>
        <p-select
          [options]="monthFilterOptions"
          [(ngModel)]="filterMonth"
          optionLabel="label"
          optionValue="value"
          placeholder="Mois" i18n-placeholder="@@crm.targets.mois.0d304bea"
          [showClear]="true"
          inputId="tgtMonth"
          styleClass="toolbar-dropdown"
          (onChange)="load()"
          [attr.aria-label]="'Filtrer par mois'"></p-select>
        <p-select
          [options]="assignableUsers()"
          [(ngModel)]="filterUserId"
          optionLabel="displayName"
          optionValue="id"
          placeholder="Tous les commerciaux" i18n-placeholder="@@crm.targets.tous.les.commerciaux.7a7d8012"
          [showClear]="true"
          [filter]="true"
          filterBy="displayName"
          inputId="tgtUser"
          styleClass="toolbar-dropdown"
          (onChange)="load()"
          [attr.aria-label]="'Filtrer par commercial'"></p-select>
        <app-button variant="secondary" icon="pi pi-refresh" iconPos="left" (click)="load()" ariaLabel="Actualiser" i18n="@@crm.targets.actualiser.9d3b2a7d"> Actualiser </app-button>
        @if (canManage()) {
          <app-button variant="primary" icon="pi pi-plus" iconPos="left" (click)="openCreate()" ariaLabel="Nouvel objectif" i18n="@@crm.targets.nouvel.objectif.3f57fc8a"> Nouvel objectif </app-button>
        }
        <app-button
          variant="outline"
          icon="pi pi-download"
          iconPos="left"
          type="button"
          (click)="exportCsv()"
          [disabled]="items().length === 0"
          ariaLabel="Exporter en CSV" i18n="@@crm.targets.export.csv.5755f9ac"> Export CSV </app-button>
      </div>
    </div>

    @if (error()) {
      <p class="text-danger p-3" role="alert">{{ error() }}</p>
    }

    <p-table
      [value]="items()"
      [loading]="loading()"
      [paginator]="true"
      [rows]="12"
      [rowsPerPageOptions]="[12, 24, 48]"
      [showCurrentPageReport]="true"
      currentPageReportTemplate="Affichage de {first} à {last} sur {totalRecords} objectifs" i18n-currentPageReportTemplate="@@crm.targets.affichage.de.first.a.last.sur.totalrecords.objec.abda057a"
      styleClass="p-datatable-sm targets-table">
      <ng-template pTemplate="header">
        <tr>
          <th scope="col" i18n="@@crm.targets.commercial.b48513e4">Commercial</th>
          <th scope="col" i18n="@@crm.targets.annee.1f910d98">Année</th>
          <th scope="col" i18n="@@crm.targets.mois.0d304bea">Mois</th>
          <th scope="col" class="text-right" i18n="@@crm.targets.objectif.47d1c260">Objectif</th>
          <th scope="col" class="text-right" i18n="@@crm.targets.realise.eed7fe3a">Réalisé</th>
          <th scope="col" i18n="@@crm.targets.progression.685e2622">Progression</th>
          @if (canManage()) {
            <th scope="col" class="col-actions" i18n="@@crm.targets.actions.c3cd636a">Actions</th>
          }
        </tr>
      </ng-template>
      <ng-template pTemplate="body" let-t>
        <tr>
          <td>{{ t.userName }}</td>
          <td>{{ t.year }}</td>
          <td>{{ monthLabel(t.month) }}</td>
          <td class="text-right">{{ t.targetAmount | number:'1.0-0' }} {{ t.currency }}</td>
          <td class="text-right">{{ t.achievedAmount | number:'1.0-0' }} {{ t.currency }}</td>
          <td>
            <div class="progress-wrap">
              <div class="progress-track" role="progressbar" [attr.aria-valuenow]="t.progressPercent" aria-valuemin="0" aria-valuemax="100" [attr.aria-label]="loc_ui_tern_progression_a6e180 + (t.progressPercent | number:'1.0-0') + loc_ui_tern_pourcent_da28b6">
                <div
                  class="progress-fill"
                  [class.progress-fill--done]="t.progressPercent >= 100"
                  [style.width.%]="Math.min(t.progressPercent, 100)"></div>
              </div>
              <span class="progress-pct">{{ t.progressPercent | number:'1.0-0' }}%</span>
            </div>
          </td>
          @if (canManage()) {
            <td class="col-actions">
              <div class="action-cell">
                <app-button
                  variant="ghost"
                  size="sm"
                  [iconOnly]="true"
                  icon="pi pi-pencil"
                  ariaLabel="Modifier l’objectif"
                  title="Modifier" i18n-title="@@crm.targets.modifier.f260e757"
                  [iconAlwaysVisible]="true"
                  (click)="openEdit(t)"></app-button>
                <app-button
                  variant="ghost"
                  size="sm"
                  [iconOnly]="true"
                  icon="pi pi-trash"
                  ariaLabel="Supprimer l’objectif"
                  title="Supprimer" i18n-title="@@crm.targets.supprimer.1acfc1c7"
                  [iconAlwaysVisible]="true"
                  (click)="confirmDelete(t)"></app-button>
              </div>
            </td>
          }
        </tr>
      </ng-template>
      <ng-template pTemplate="footer">
        @if (items().length > 0) {
          <tr class="targets-footer-row">
            <td colspan="3"><strong i18n="@@crm.targets.totaux.liste.affichee.c8c8c70c">Totaux (liste affichée)</strong></td>
            <td class="text-right">
              <strong>{{ totals().target | number:'1.0-0' }} TND</strong>
            </td>
            <td class="text-right">
              <strong>{{ totals().achieved | number:'1.0-0' }} TND</strong>
            </td>
            <td [attr.colspan]="canManage() ? 2 : 1" class="targets-footer-spacer"></td>
          </tr>
        }
      </ng-template>
      <ng-template pTemplate="emptymessage">
        <tr>
          <td [attr.colspan]="canManage() ? 7 : 6" class="empty-cell">
            <div class="empty-state">
              <p class="empty-title" i18n="@@crm.targets.aucun.objectif.pour.ces.criteres.5b8e7098">Aucun objectif pour ces critères</p>
              <p class="empty-hint" i18n="@@crm.targets.definissez.un.objectif.de.vente.par.commercial.e.9246bfad">Définissez un objectif de vente par commercial et par mois pour suivre la performance.</p>
              @if (canManage()) {
                <app-button variant="primary" icon="pi pi-plus" iconPos="left" (click)="openCreate()" ariaLabel="Créer un objectif" i18n="@@crm.targets.nouvel.objectif.3f57fc8a"> Nouvel objectif </app-button>
              }
            </div>
          </td>
        </tr>
      </ng-template>
    </p-table>

    @if (formDialogVisible) {
      <div class="targets-panel-overlay" (click)="closeTargetsPanel()" role="presentation">
        <div
          class="targets-panel"
          (click)="$event.stopPropagation()"
          role="dialog"
          aria-modal="true"
          aria-labelledby="targets-panel-title"
          [attr.aria-describedby]="'tgt-form-desc'">
          <div class="targets-panel-header">
            <div class="targets-panel-header-text">
              <h2 id="targets-panel-title">{{ editingTarget() ? loc_ui_tern_modifier_l_objectif_009458 : loc_ui_tern_nouvel_objectif_3f57fc }}</h2>
              <p class="targets-panel-subtitle">
                @if (editingTarget()) {
                  Édition · {{ editingTarget()!.userName }} — {{ monthLabel(editingTarget()!.month) }} {{ editingTarget()!.year }}
                } @else {
                  Création · Objectif mensuel par commercial
                }
              </p>
            </div>
            <button
              type="button"
              class="targets-panel-close"
              (click)="closeTargetsPanel()"
              aria-label="Fermer le panneau" i18n-aria-label="@@crm.targets.fermer.le.panneau.e1210a2f">
              <i class="pi pi-times" aria-hidden="true"></i>
            </button>
          </div>
          <div class="targets-panel-body">
            <p id="tgt-form-desc" class="sr-only" i18n="@@crm.targets.renseignez.le.montant.cible.pour.le.mois.selecti.671b6e1a">Renseignez le montant cible pour le mois sélectionné.</p>
            @if (editingTarget()) {
              <form [formGroup]="editForm" (ngSubmit)="saveEdit()" class="tgt-form">
                <section class="tgt-form-section" aria-labelledby="tgt-section-edit">
                  <h3 id="tgt-section-edit" class="form-block-title targets-panel-section-title" i18n="@@crm.targets.montant.4adcd9fc">Montant</h3>
                  <div class="form-field">
                    <label class="field-label" for="tgtAmountEdit"><ng-container i18n="@@crm.targets.objectif.tnd.dbdf229b">Objectif (TND) </ng-container> <span class="required" aria-hidden="true" i18n="@@crm.targets.text.df58248c">*</span></label>
                    <p-inputNumber
                      inputId="tgtAmountEdit"
                      formControlName="targetAmount"
                      mode="decimal"
                      [minFractionDigits]="0"
                      [maxFractionDigits]="3"
                      [min]="0.001"
                      styleClass="w-full"></p-inputNumber>
                  </div>
                  @if (formError()) {
                    <p class="text-danger text-sm" role="alert">{{ formError() }}</p>
                  }
                </section>
              </form>
            } @else {
              <form [formGroup]="createForm" (ngSubmit)="saveCreate()" class="tgt-form">
                <section class="tgt-form-section" aria-labelledby="tgt-section-create">
                  <h3 id="tgt-section-create" class="form-block-title targets-panel-section-title" i18n="@@crm.targets.definir.l.objectif.22a4ab78">Définir l’objectif</h3>
                  <div class="form-field">
                    <label class="field-label" for="tgtUserCreate"><ng-container i18n="@@crm.targets.commercial.b48513e4">Commercial </ng-container> <span class="required" aria-hidden="true" i18n="@@crm.targets.text.df58248c">*</span></label>
                    <p-select
                      inputId="tgtUserCreate"
                      formControlName="userId"
                      [options]="assignableUsers()"
                      optionLabel="displayName"
                      optionValue="id"
                      placeholder="Sélectionner" i18n-placeholder="@@crm.targets.selectionner.ab31a36f"
                      [filter]="true"
                      filterBy="displayName"
                      styleClass="w-full"
                      appendTo="body"
                      [overlayOptions]="targetsPanelPrimeOverlayOptions"></p-select>
                  </div>
                  <div class="form-grid-2">
                    <div class="form-field">
                      <label class="field-label" for="tgtYearCreate" i18n="@@crm.targets.annee.1f910d98">Année</label>
                      <p-select
                        inputId="tgtYearCreate"
                        formControlName="year"
                        [options]="yearOptions"
                        optionLabel="label"
                        optionValue="value"
                        styleClass="w-full"
                        appendTo="body"
                        [overlayOptions]="targetsPanelPrimeOverlayOptions"></p-select>
                    </div>
                    <div class="form-field">
                      <label class="field-label" for="tgtMonthCreate" i18n="@@crm.targets.mois.0d304bea">Mois</label>
                      <p-select
                        inputId="tgtMonthCreate"
                        formControlName="month"
                        [options]="monthCreateOptions"
                        optionLabel="label"
                        optionValue="value"
                        styleClass="w-full"
                        appendTo="body"
                        [overlayOptions]="targetsPanelPrimeOverlayOptions"></p-select>
                    </div>
                  </div>
                  <div class="form-field">
                    <label class="field-label" for="tgtAmountCreate"><ng-container i18n="@@crm.targets.objectif.tnd.dbdf229b">Objectif (TND) </ng-container> <span class="required" aria-hidden="true" i18n="@@crm.targets.text.df58248c">*</span></label>
                    <p-inputNumber
                      inputId="tgtAmountCreate"
                      formControlName="targetAmount"
                      mode="decimal"
                      [minFractionDigits]="0"
                      [maxFractionDigits]="3"
                      [min]="0.001"
                      styleClass="w-full"></p-inputNumber>
                  </div>
                  @if (formError()) {
                    <p class="text-danger text-sm" role="alert">{{ formError() }}</p>
                  }
                </section>
              </form>
            }
          </div>
          <div class="targets-panel-footer">
            <div class="targets-panel-footer-actions">
              <app-button variant="ghost" size="sm" type="button" (click)="closeTargetsPanel()" ariaLabel="Annuler" i18n="@@crm.targets.annuler.49ba3292">Annuler</app-button>
              @if (editingTarget()) {
                <app-button
                  variant="primary"
                  type="button"
                  [icon]="saving() ? 'pi-spin pi-spinner' : 'pi-check'"
                  iconPos="left"
                  (click)="saveEdit()"
                  [disabled]="editForm.invalid || saving()">
                  {{ saving() ? loc_ui_tern_enregistrement_e7d5f2 : loc_ui_tern_enregistrer_f7c8bc }}
                </app-button>
              } @else {
                <app-button
                  variant="primary"
                  type="button"
                  [icon]="saving() ? 'pi-spin pi-spinner' : 'pi-check'"
                  iconPos="left"
                  (click)="saveCreate()"
                  [disabled]="createForm.invalid || saving()">
                  {{ saving() ? loc_ui_tern_creation_2a06d1 : loc_ui_tern_creer_1a6861 }}
                </app-button>
              }
            </div>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    .targets-toolbar .toolbar-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.75rem 1rem;
    }
    :host ::ng-deep .toolbar-dropdown {
      min-width: 180px;
    }
    .text-right {
      text-align: right;
    }
    .progress-wrap {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .progress-track {
      flex: 1;
      height: 8px;
      background: var(--surface-200, #e2e8f0);
      border-radius: 4px;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      background: var(--primary-color, #2563eb);
      border-radius: 4px;
    }
    .progress-fill--done {
      background: var(--color-success-600, #16a34a);
    }
    .progress-pct {
      min-width: 48px;
      text-align: right;
      font-size: var(--font-size-sm);
    }
    .col-actions {
      width: 1%;
      white-space: nowrap;
    }
    .action-cell {
      display: flex;
      gap: 0.25rem;
      justify-content: flex-end;
    }
    .empty-cell {
      text-align: center;
      padding: 2.5rem 1rem !important;
      border: none !important;
    }
    .empty-title {
      font-weight: var(--font-weight-semibold);
      margin-bottom: 0.25rem;
    }
    .empty-hint {
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
      margin-bottom: 1rem;
    }
    .targets-footer-row td {
      background: var(--color-background-subtle, #f8fafc);
      font-size: var(--font-size-sm);
    }
    .targets-panel-overlay {
      position: fixed;
      inset: 0;
      z-index: 1100;
      display: flex;
      justify-content: flex-end;
      align-items: stretch;
      background: rgba(15, 23, 42, 0.28);
      backdrop-filter: blur(4px);
      animation: targetsPanelFadeIn 200ms ease-out;
    }
    .targets-panel {
      position: relative;
      z-index: 1101;
      display: flex;
      flex-direction: column;
      width: min(520px, 100vw);
      max-height: 100dvh;
      height: 100%;
      background: var(--color-background-elevated, var(--color-white));
      box-shadow: -12px 0 40px rgba(15, 23, 42, 0.12);
      animation: targetsPanelSlideIn 260ms cubic-bezier(0.4, 0, 0.2, 1);
      overflow: hidden;
    }
    .targets-panel-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--spacing-4);
      padding: var(--spacing-5) var(--spacing-5) var(--spacing-4);
      border-bottom: 1px solid var(--color-border-subtle);
      background: linear-gradient(
        180deg,
        var(--color-background-elevated) 0%,
        var(--color-background-subtle) 100%
      );
      flex-shrink: 0;
    }
    .targets-panel-header-text {
      min-width: 0;
    }
    .targets-panel-header h2 {
      margin: 0 0 var(--spacing-1);
      font-size: var(--font-size-xl);
      font-weight: var(--font-weight-bold);
      color: var(--color-text-primary);
      line-height: 1.25;
    }
    .targets-panel-subtitle {
      margin: 0;
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
      line-height: 1.4;
    }
    .targets-panel-close {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      flex-shrink: 0;
      border: none;
      border-radius: var(--radius-lg);
      background: var(--color-neutral-100);
      color: var(--color-text-tertiary);
      cursor: pointer;
      transition: background 200ms ease, color 200ms ease;
    }
    .targets-panel-close:hover {
      background: var(--color-neutral-200);
      color: var(--color-text-primary);
    }
    .targets-panel-body {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: var(--spacing-5);
    }
    .targets-panel-footer {
      flex-shrink: 0;
      padding: var(--spacing-4) var(--spacing-5);
      border-top: 1px solid var(--color-border-subtle);
      background: var(--color-background-subtle);
    }
    .targets-panel-footer-actions {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: var(--spacing-4);
      flex-wrap: wrap;
      width: 100%;
    }
    .targets-panel .targets-panel-section-title {
      border-left: 3px solid var(--color-primary-500);
      padding-left: var(--spacing-3);
    }
    @keyframes targetsPanelFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes targetsPanelSlideIn {
      from { transform: translateX(100%); }
      to { transform: translateX(0); }
    }
    .tgt-form {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-4);
    }
    .tgt-form-section {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-4);
    }
    .form-block-title {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-tertiary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin: 0;
    }
    .form-field {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
    }
    .field-label {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
      margin: 0;
    }
    .text-sm {
      font-size: var(--font-size-sm);
    }
    .required {
      color: var(--color-error-600);
    }
    .form-grid-2 {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--spacing-4);
    }
    @media (max-width: 520px) {
      .form-grid-2 {
        grid-template-columns: 1fr;
      }
    }
    :host ::ng-deep .targets-panel .p-select,
    :host ::ng-deep .targets-panel .p-inputnumber {
      width: 100%;
    }
    .w-full {
      width: 100%;
    }
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
  `
})
export class TargetsComponent implements OnInit {
  readonly loc_ui_tern_progression_a6e180 = $localize`:@@ui.tern.progression.a6e180:Progression `;
  readonly loc_ui_tern_pourcent_da28b6 = $localize`:@@ui.tern.pourcent.da28b6: pourcent`;
  readonly loc_ui_tern_modifier_l_objectif_009458 = $localize`:@@ui.tern.modifier.l.objectif.009458:Modifier l’objectif`;
  readonly loc_ui_tern_nouvel_objectif_3f57fc = $localize`:@@ui.tern.nouvel.objectif.3f57fc:Nouvel objectif`;
  readonly loc_ui_tern_enregistrement_e7d5f2 = $localize`:@@ui.tern.enregistrement.e7d5f2:Enregistrement…`;
  readonly loc_ui_tern_enregistrer_f7c8bc = $localize`:@@ui.tern.enregistrer.f7c8bc:Enregistrer`;
  readonly loc_ui_tern_creation_2a06d1 = $localize`:@@ui.tern.creation.2a06d1:Création…`;
  readonly loc_ui_tern_creer_1a6861 = $localize`:@@ui.tern.creer.1a6861:Créer`;
  private readonly crm = inject(CrmService);
  private readonly auth = inject(AuthService);
  private readonly confirm = inject(ConfirmationService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  readonly items = signal<SalesTargetDto[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly assignableUsers = signal<CrmAssignableUserDto[]>([]);
  readonly editingTarget = signal<SalesTargetDto | null>(null);
  readonly saving = signal(false);
  readonly formError = signal<string | null>(null);

  readonly Math = Math;

  readonly totals = computed(() => {
    const list = this.items();
    let target = 0;
    let achieved = 0;
    for (const t of list) {
      target += Number(t.targetAmount);
      achieved += Number(t.achievedAmount);
    }
    return { target, achieved };
  });

  filterYear = new Date().getFullYear();
  filterMonth: number | null = null;
  filterUserId: string | null = null;

  yearOptions: { label: string; value: number }[] = [];
  monthFilterOptions: { label: string; value: number | null }[] = [];
  monthCreateOptions: { label: string; value: number }[] = [];

  formDialogVisible = false;

  /** Above targets drawer overlay (1100) / panel (1101) for PrimeNG appendTo="body" dropdowns */
  readonly targetsPanelPrimeOverlayOptions: OverlayOptions = { baseZIndex: 1200 };

  createForm = this.fb.nonNullable.group({
    userId: ['', Validators.required],
    year: [new Date().getFullYear(), Validators.required],
    month: [new Date().getMonth() + 1, [Validators.required, Validators.min(1), Validators.max(12)]],
    targetAmount: [null as number | null, [Validators.required, Validators.min(0.001)]]
  });

  editForm = this.fb.nonNullable.group({
    targetAmount: [null as number | null, [Validators.required, Validators.min(0.001)]]
  });

  ngOnInit(): void {
    const y = new Date().getFullYear();
    this.yearOptions = [];
    for (let yr = 2020; yr <= y + 1; yr++) {
      this.yearOptions.push({ label: String(yr), value: yr });
    }
    this.monthFilterOptions = [{ label: 'Tous les mois', value: null }];
    for (let m = 1; m <= 12; m++) {
      this.monthFilterOptions.push({ label: MONTH_NAMES_FR[m], value: m });
    }
    this.monthCreateOptions = [];
    for (let m = 1; m <= 12; m++) {
      this.monthCreateOptions.push({ label: MONTH_NAMES_FR[m], value: m });
    }

    this.crm.getTargetsAssignableUsers().subscribe({
      next: res => {
        if (res.success && res.data) this.assignableUsers.set(res.data);
      },
      error: () => {
        this.toast.add({ severity: 'warn', summary: $localize`:@@targets.component.summary.Liste des co:Liste des commerciaux`, detail: $localize`:@@targets.component.detail.Chargement_parti:Chargement partiel des filtres.`, life: 4000 });
      }
    });

    this.load();
  }

  canRead(): boolean {
    return this.auth.hasAllPermissions([PERMISSIONS.salesTargets.read]);
  }

  canManage(): boolean {
    return this.auth.hasAllPermissions([PERMISSIONS.salesTargets.manage]);
  }

  monthLabel(m: number): string {
    return m >= 1 && m <= 12 ? MONTH_NAMES_FR[m] : String(m);
  }

  load(): void {
    if (!this.canRead()) {
      this.error.set('Vous n’avez pas accès aux objectifs commerciaux.');
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    this.crm.getTargets(this.filterYear, this.filterUserId ?? undefined, this.filterMonth).subscribe({
      next: r => {
        this.loading.set(false);
        if (r.success && r.data) {
          this.items.set(r.data);
        } else {
          this.error.set(r.errors?.[0] ?? r.message ?? r.error ?? $localize`:@@ui.tern.erreur.ab546c:Erreur`);
        }
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Erreur réseau');
      }
    });
  }

  openCreate(): void {
    this.editingTarget.set(null);
    this.formError.set(null);
    const y = this.filterYear;
    const m = this.filterMonth && this.filterMonth >= 1 && this.filterMonth <= 12 ? this.filterMonth : new Date().getMonth() + 1;
    this.createForm.reset({
      userId: this.filterUserId ?? '',
      year: y,
      month: m,
      targetAmount: null
    });
    this.formDialogVisible = true;
  }

  openEdit(t: SalesTargetDto): void {
    this.editingTarget.set(t);
    this.formError.set(null);
    this.editForm.patchValue({ targetAmount: t.targetAmount });
    this.formDialogVisible = true;
  }

  onDialogHide(): void {
    this.formError.set(null);
    this.editingTarget.set(null);
  }

  closeTargetsPanel(): void {
    this.formDialogVisible = false;
    this.onDialogHide();
  }

  @HostListener('document:keydown.escape')
  onTargetsPanelEscape(): void {
    if (this.formDialogVisible) {
      this.closeTargetsPanel();
    }
  }

  saveCreate(): void {
    if (this.createForm.invalid) {
      this.createForm.markAllAsTouched();
      return;
    }
    const v = this.createForm.getRawValue();
    const user = this.assignableUsers().find(u => u.id === v.userId);
    if (!user) {
      this.formError.set('Sélectionnez un commercial valide.');
      return;
    }
    this.saving.set(true);
    this.formError.set(null);
    this.crm
      .createTarget({
        userId: v.userId,
        userName: user.displayName,
        year: v.year,
        month: v.month,
        targetAmount: v.targetAmount!
      })
      .subscribe({
        next: r => {
          this.saving.set(false);
          if (r.success) {
            this.closeTargetsPanel();
            this.load();
            this.toast.add({ severity: 'success', summary: $localize`:@@targets.component.summary.Objectif cré:Objectif créé`, life: 3000 });
          } else {
            this.formError.set(r.errors?.[0] ?? r.message ?? r.error ?? $localize`:@@ui.tern.erreur.ab546c:Erreur`);
          }
        },
        error: () => {
          this.saving.set(false);
          this.formError.set('Erreur réseau');
        }
      });
  }

  saveEdit(): void {
    const t = this.editingTarget();
    if (!t || this.editForm.invalid) {
      this.editForm.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.formError.set(null);
    const amt = this.editForm.getRawValue().targetAmount!;
    this.crm.updateTarget(t.id, { targetAmount: amt }).subscribe({
      next: r => {
        this.saving.set(false);
        if (r.success) {
          this.closeTargetsPanel();
          this.load();
          this.toast.add({ severity: 'success', summary: $localize`:@@targets.component.summary.Objectif mis:Objectif mis à jour`, life: 3000 });
        } else {
          this.formError.set(r.errors?.[0] ?? r.message ?? r.error ?? $localize`:@@ui.tern.erreur.ab546c:Erreur`);
        }
      },
      error: () => {
        this.saving.set(false);
        this.formError.set('Erreur réseau');
      }
    });
  }

  confirmDelete(t: SalesTargetDto): void {
    this.confirm.confirm({
      header: 'Supprimer l’objectif',
      message: `Supprimer l’objectif ${this.monthLabel(t.month)} ${t.year} pour ${t.userName} ?`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: $localize`:@@targets.component.acceptLabel.Supprimer:Supprimer`,
      rejectLabel: $localize`:@@targets.component.rejectLabel.Annuler:Annuler`,
      acceptButtonStyleClass: 'btn-danger',
      accept: () => {
        this.crm.deleteTarget(t.id).subscribe({
          next: r => {
            if (r.success) {
              this.load();
              this.toast.add({ severity: 'success', summary: $localize`:@@targets.component.summary.Objectif sup:Objectif supprimé`, life: 3000 });
            } else {
              const msg = r.errors?.[0] ?? r.message ?? r.error ?? $localize`:@@ui.tern.suppression.impossible.55762f:Suppression impossible`;
              this.toast.add({ severity: 'error', summary: $localize`:@@targets.component.summary.Erreur:Erreur`, detail: msg, life: 6000 });
            }
          },
          error: () => {
            this.toast.add({ severity: 'error', summary: $localize`:@@targets.component.summary.Erreur résea:Erreur réseau`, life: 6000 });
          }
        });
      }
    });
  }

  exportCsv(): void {
    const rows = this.items();
    if (rows.length === 0) return;
    const sep = ';';
    const header = ['Commercial', 'Année', 'Mois', 'Objectif TND', 'Réalisé TND', 'Progression %'];
    const lines = [
      header.join(sep),
      ...rows.map(t =>
        [
          this.escapeCsv(t.userName),
          t.year,
          this.monthLabel(t.month),
          this.fmtNum(t.targetAmount),
          this.fmtNum(t.achievedAmount),
          this.fmtNum(t.progressPercent)
        ].join(sep)
      )
    ];
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `objectifs_${this.filterYear}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private fmtNum(n: number): string {
    return String(n).replace('.', ',');
  }

  private escapeCsv(s: string): string {
    if (s.includes(';') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }
}
