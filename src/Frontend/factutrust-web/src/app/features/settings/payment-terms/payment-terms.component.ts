/// <reference types="@angular/localize" />
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputSwitchModule } from 'primeng/inputswitch';
import { SelectModule } from 'primeng/select';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { DialogModule } from 'primeng/dialog';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { SkeletonTableComponent, SkeletonColumn } from '@shared/components/skeleton/skeleton-table.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import {
  PricingService,
  PaymentTermTemplate,
  PaymentDueMode
} from '@core/services/pricing.service';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { AuthService } from '@core/services/auth.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { PERMISSIONS } from '@core/config/permission-keys';

interface DueModeOption {
  label: string;
  value: PaymentDueMode;
}

@Component({
  selector: 'app-payment-terms',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    TableModule,
    ButtonModule,
    InputTextModule,
    InputNumberModule,
    InputSwitchModule,
    SelectModule,
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
      title="Conditions de règlement" i18n-title="@@settings.payment-terms.conditions.de.reglement.84c9c451"
      subtitle="Délai, échéance et escompte. La condition produit le texte imprimé sur le document et une échéance exploitable pour la balance âgée." i18n-subtitle="@@settings.payment-terms.delai.echeance.et.escompte.la.condition.b9c07798">
      <div class="header-actions">
        <p-button
          label="Retour" i18n-label="@@settings.payment-terms.retour.e5befb1f"
          icon="pi pi-arrow-left"
          [outlined]="true"
          routerLink="/settings">
        </p-button>
        @if (canCreate()) {
          <app-button variant="primary" icon="pi-plus" iconPos="left" (clicked)="openCreate()" i18n="@@settings.payment-terms.nouvelle.condition.67e805e6"> Nouvelle condition </app-button>
        }
      </div>
    </app-page-header>

    @if (loading()) {
      <app-skeleton-table [columns]="skeletonColumns" [rows]="4"></app-skeleton-table>
    } @else if (terms().length === 0) {
      <app-empty-state
        icon="pi-calendar-clock"
        title="Aucune condition de règlement" i18n-title="@@settings.payment-terms.aucune.condition.de.reglement.5a451783"
        message="Créez une condition pour proposer un délai et calculer l'échéance automatiquement." i18n-message="@@settings.payment-terms.creez.une.condition.pour.proposer.un.del.22f38b99">
      </app-empty-state>
    } @else {
      <div class="ft-table-card">
        <p-table [value]="terms()" [rowHover]="true" styleClass="ft-table">
          <ng-template pTemplate="header">
            <tr>
              <th i18n="@@settings.payment-terms.libelle.f5485bba">Libellé</th>
              <th i18n="@@settings.payment-terms.ce.qui.s.imprime.9b7642ed">Ce qui s'imprime</th>
              <th class="ft-num" i18n="@@settings.payment-terms.delai.be9a9403">Délai</th>
              <th i18n="@@settings.payment-terms.echeance.d.un.document.du.jour.fdfd4e70">Échéance d'un document du jour</th>
              <th i18n="@@settings.payment-terms.etat.d3b28a2a">État</th>
              <th class="ft-actions-col" i18n="@@settings.payment-terms.actions.c3cd636a">Actions</th>
            </tr>
          </ng-template>

          <ng-template pTemplate="body" let-term>
            <tr>
              <td>
                {{ term.name }}
                @if (term.isDefault) {
                  <p-tag severity="info" value="Par défaut"></p-tag>
                }
              </td>
              <td class="ft-muted">{{ term.documentLabel }}</td>
              <td class="ft-num">{{ term.delayDays }} j</td>
              <td>{{ term.sampleDueDate | date: 'dd/MM/yyyy' }}</td>
              <td>
                @if (term.isActive) {
                  <p-tag severity="success" value="Active"></p-tag>
                } @else {
                  <p-tag severity="secondary" value="Désactivée"></p-tag>
                }
              </td>
              <td class="ft-actions-col">
                @if (canUpdate()) {
                  <button
                    pButton
                    type="button"
                    icon="pi pi-pencil"
                    class="p-button-text p-button-sm"
                    pTooltip="Modifier" i18n-pTooltip="@@settings.payment-terms.modifier.f260e757"
                    (click)="openEdit(term)"></button>
                }
                @if (canDelete()) {
                  <button
                    pButton
                    type="button"
                    icon="pi pi-trash"
                    class="p-button-text p-button-sm p-button-danger"
                    pTooltip="Supprimer" i18n-pTooltip="@@settings.payment-terms.supprimer.1acfc1c7"
                    (click)="confirmDelete(term)"></button>
                }
              </td>
            </tr>
          </ng-template>
        </p-table>
      </div>
    }

    <p-dialog
      [header]="editing ? loc_ui_tern_modifier_la_condition_1c9065 : loc_ui_tern_nouvelle_condition_67e805"
      [(visible)]="dialogVisible"
      [modal]="true"
      [style]="{ width: '36rem' }"
      [draggable]="false">
      <div class="ft-form-grid">
        <div class="ft-field ft-field--full">
          <label for="pt-name"><ng-container i18n="@@settings.payment-terms.libelle.f5485bba">Libellé </ng-container> <span class="ft-required" i18n="@@settings.payment-terms.text.df58248c">*</span></label>
          <input id="pt-name" pInputText [(ngModel)]="form.name" maxlength="100" />
        </div>

        <div class="ft-field">
          <label for="pt-delay"><ng-container i18n="@@settings.payment-terms.delai.jours.8c106e9f">Délai (jours) </ng-container> <span class="ft-required" i18n="@@settings.payment-terms.text.df58248c">*</span></label>
          <p-inputNumber inputId="pt-delay" [(ngModel)]="form.delayDays" [min]="0" [max]="365"></p-inputNumber>
        </div>

        <div class="ft-field">
          <label for="pt-mode" i18n="@@settings.payment-terms.mode.d.echeance.291cfb78">Mode d'échéance</label>
          <p-select
            inputId="pt-mode"
            [options]="dueModes"
            [(ngModel)]="form.dueMode"
            optionLabel="label"
            optionValue="value"
            appendTo="body"></p-select>
        </div>

        @if (form.dueMode === 'EndOfMonthOnDay') {
          <div class="ft-field">
            <label for="pt-day"><ng-container i18n="@@settings.payment-terms.jour.de.reglement.a7678726">Jour de règlement </ng-container> <span class="ft-required" i18n="@@settings.payment-terms.text.df58248c">*</span></label>
            <p-inputNumber inputId="pt-day" [(ngModel)]="form.dueDayOfMonth" [min]="1" [max]="31"></p-inputNumber>
            <small class="ft-hint" i18n="@@settings.payment-terms.un.jour.inexistant.31.fevrier.est.ramene.au.dern.c56e4c63"> Un jour inexistant (31 février) est ramené au dernier jour du mois. </small>
          </div>
        }

        <div class="ft-field">
          <label for="pt-disc" i18n="@@settings.payment-terms.escompte.b0b6e901">Escompte (%)</label>
          <p-inputNumber
            inputId="pt-disc"
            [(ngModel)]="form.earlyPaymentDiscountPercent"
            mode="decimal"
            [minFractionDigits]="0"
            [maxFractionDigits]="2"
            [min]="0"
            [max]="100"></p-inputNumber>
        </div>

        <div class="ft-field">
          <label for="pt-discdays" i18n="@@settings.payment-terms.escompte.sous.jours.df2a00be">Escompte sous (jours)</label>
          <p-inputNumber inputId="pt-discdays" [(ngModel)]="form.earlyPaymentDays" [min]="1"></p-inputNumber>
          <small class="ft-hint" i18n="@@settings.payment-terms.doit.etre.inferieur.au.delai.sinon.l.escompte.se.c8129ccc"> Doit être inférieur au délai, sinon l'escompte serait toujours acquis. </small>
        </div>

        <div class="ft-field ft-field--inline">
          <p-inputSwitch [(ngModel)]="form.isActive" inputId="pt-active"></p-inputSwitch>
          <label for="pt-active" i18n="@@settings.payment-terms.condition.active.a7d42119">Condition active</label>
        </div>

        <div class="ft-field ft-field--inline">
          <p-inputSwitch [(ngModel)]="form.isDefault" inputId="pt-default"></p-inputSwitch>
          <label for="pt-default" i18n="@@settings.payment-terms.proposee.par.defaut.cfc08e05">Proposée par défaut</label>
          <small class="ft-hint" i18n="@@settings.payment-terms.une.seule.condition.peut.l.etre.l.ancienne.est.l.ddd37b25">Une seule condition peut l'être : l'ancienne est libérée.</small>
        </div>
      </div>

      <ng-template pTemplate="footer">
        <app-button variant="secondary" (clicked)="dialogVisible = false" i18n="@@settings.payment-terms.annuler.49ba3292">Annuler</app-button>
        <app-button variant="primary" [disabled]="!canSave() || saving()" (clicked)="save()" i18n="@@settings.payment-terms.enregistrer.f7c8bcd8"> Enregistrer </app-button>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    .header-actions {
      display: flex;
      gap: var(--spacing-2);
      align-items: center;
    }
  `]
})
export class PaymentTermsComponent implements OnInit {
  readonly loc_ui_tern_modifier_la_condition_1c9065 = $localize`:@@ui.tern.modifier.la.condition.1c9065:Modifier la condition`;
  readonly loc_ui_tern_nouvelle_condition_67e805 = $localize`:@@ui.tern.nouvelle.condition.67e805:Nouvelle condition`;
  private readonly pricingService = inject(PricingService);
  private readonly toastService = inject(ToastService);
  private readonly errorHandler = inject(ErrorHandlerService);
  private readonly auth = inject(AuthService);
  private readonly confirmationService = inject(ConfirmationService);

  readonly terms = signal<PaymentTermTemplate[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);

  dialogVisible = false;
  editing: PaymentTermTemplate | null = null;

  form = {
    name: '',
    delayDays: 30,
    dueMode: 'NetDays' as PaymentDueMode,
    dueDayOfMonth: null as number | null,
    earlyPaymentDiscountPercent: null as number | null,
    earlyPaymentDays: null as number | null,
    isActive: true,
    isDefault: false
  };

  readonly canCreate = computed(() => this.auth.hasPermission(PERMISSIONS.settings.update));
  readonly canUpdate = computed(() => this.auth.hasPermission(PERMISSIONS.settings.update));
  readonly canDelete = computed(() => this.auth.hasPermission(PERMISSIONS.settings.update));

  readonly breadcrumbItems: BreadcrumbItem[] = [
    { label: $localize`:@@settings.payment-terms.ts.tableau.de.bord.a524057f:Tableau de bord`, route: '/dashboard', icon: 'pi-home' },
    { label: $localize`:@@settings.payment-terms.ts.parametres.ef8f0121:Paramètres`, route: '/settings' },
    { label: $localize`:@@settings.payment-terms.ts.conditions.de.reglement.84c9c451:Conditions de règlement` }
  ];

  readonly dueModes: DueModeOption[] = [
    { label: $localize`:@@settings.payment-terms.ts.net.date.delai.40bfbcad:Net (date + délai)`, value: 'NetDays' },
    { label: $localize`:@@settings.payment-terms.ts.fin.de.mois.db654234:Fin de mois`, value: 'EndOfMonth' },
    { label: $localize`:@@settings.payment-terms.ts.fin.de.mois.le.n.cd740fb5:Fin de mois, le N`, value: 'EndOfMonthOnDay' }
  ];

  readonly skeletonColumns: SkeletonColumn[] = [
    { width: '22%' },
    { width: '28%' },
    { width: '10%' },
    { width: '18%' },
    { width: '12%' },
    { width: '10%' }
  ];

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.pricingService.getPaymentTerms().subscribe({
      next: res => {
        this.terms.set(res.data ?? []);
        this.loading.set(false);
      },
      error: err => {
        this.showError(err, $localize`:@@settings.payment-terms.ts.impossible.de.charger.les.conditions.de.098252b2:Impossible de charger les conditions de règlement`);
        this.errorHandler.logError('Failed to load payment terms', err);
        this.terms.set([]);
        this.loading.set(false);
      }
    });
  }

  openCreate(): void {
    this.editing = null;
    this.form = {
      name: '',
      delayDays: 30,
      dueMode: 'NetDays',
      dueDayOfMonth: null,
      earlyPaymentDiscountPercent: null,
      earlyPaymentDays: null,
      isActive: true,
      isDefault: false
    };
    this.dialogVisible = true;
  }

  openEdit(term: PaymentTermTemplate): void {
    this.editing = term;
    this.form = {
      name: term.name,
      delayDays: term.delayDays,
      dueMode: term.dueMode,
      dueDayOfMonth: term.dueDayOfMonth,
      earlyPaymentDiscountPercent: term.earlyPaymentDiscountPercent,
      earlyPaymentDays: term.earlyPaymentDays,
      isActive: term.isActive,
      isDefault: term.isDefault
    };
    this.dialogVisible = true;
  }

  canSave(): boolean {
    if (!this.form.name.trim()) return false;
    if (this.form.dueMode === 'EndOfMonthOnDay' && !this.form.dueDayOfMonth) return false;

    // Le serveur refuse un taux sans fenêtre : autant le bloquer ici plutôt que
    // d'envoyer une saisie que l'on sait invalide.
    if (this.form.earlyPaymentDiscountPercent && !this.form.earlyPaymentDays) return false;

    return true;
  }

  save(): void {
    this.saving.set(true);
    this.pricingService
      .upsertPaymentTerm({
        id: this.editing?.id ?? null,
        name: this.form.name.trim(),
        delayDays: this.form.delayDays,
        dueMode: this.form.dueMode,
        dueDayOfMonth: this.form.dueMode === 'EndOfMonthOnDay' ? this.form.dueDayOfMonth : null,
        earlyPaymentDiscountPercent: this.form.earlyPaymentDiscountPercent,
        earlyPaymentDays: this.form.earlyPaymentDiscountPercent ? this.form.earlyPaymentDays : null,
        isActive: this.form.isActive,
        isDefault: this.form.isDefault
      })
      .subscribe({
        next: () => {
          this.toastService.add({
            severity: 'success',
            summary: $localize`:@@payment-terms.component.summary.Succès:Succès`,
            detail: $localize`:@@payment-terms.component.detail.Condition_de_r_g:Condition de règlement enregistrée.`
          });
          this.dialogVisible = false;
          this.saving.set(false);
          this.load();
        },
        error: err => {
          this.showError(err, $localize`:@@settings.payment-terms.ts.enregistrement.impossible.1e5e1075:Enregistrement impossible`);
          this.errorHandler.logError('Save payment term failed', err);
          this.saving.set(false);
        }
      });
  }

  confirmDelete(term: PaymentTermTemplate): void {
    this.confirmationService.confirm({
      header: $localize`:@@settings.payment-terms.ts.supprimer.la.condition.bd432d9d:Supprimer la condition`,
      message:
        $localize`:@@settings.payment-terms.ts.supprimer.name.les.documents.deja.emis.c.b5285595:Supprimer « ${term.name}:name: » ? Les documents déjà émis conservent leur texte et leur ` +
        $localize`:@@ui.tern.echeance.ils.ne.referencent.pas.le.modele.da0a27:échéance : ils ne référencent pas le modèle.`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: $localize`:@@payment-terms.component.acceptLabel.Supprimer:Supprimer`,
      rejectLabel: $localize`:@@payment-terms.component.rejectLabel.Annuler:Annuler`,
      acceptButtonStyleClass: 'btn-danger',
      accept: () => this.remove(term)
    });
  }

  private remove(term: PaymentTermTemplate): void {
    this.pricingService.deletePaymentTerm(term.id).subscribe({
      next: () => {
        this.toastService.add({ severity: 'success', summary: $localize`:@@payment-terms.component.summary.Succès:Succès`, detail: $localize`:@@payment-terms.component.detail.Condition_suppri:Condition supprimée.` });
        this.load();
      },
      error: err => {
        this.showError(err, $localize`:@@settings.payment-terms.ts.suppression.impossible.55762ff2:Suppression impossible`);
        this.errorHandler.logError('Delete payment term failed', err);
      }
    });
  }

  private showError(err: unknown, fallback: string): void {
    const msg = this.errorHandler.extractErrorMessage(err);
    this.toastService.add({ severity: 'error', summary: $localize`:@@payment-terms.component.summary.Erreur:Erreur`, detail: msg || fallback });
  }
}
