/// <reference types="@angular/localize" />
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { TagModule } from 'primeng/tag';
import { SkeletonModule } from 'primeng/skeleton';
import { TooltipModule } from 'primeng/tooltip';
import { BankAccountDto, BankAccountService } from '@core/services/bank-account.service';
import { ToastService } from '@core/services/toast.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { AddBankAccountDialogComponent } from './components/add-bank-account-dialog/add-bank-account-dialog.component';

@Component({
  selector: 'app-bank-accounts',
  standalone: true,
  imports: [
    CommonModule,
    PageHeaderComponent,
    EmptyStateComponent,
    ButtonComponent,
    TagModule,
    SkeletonModule,
    TooltipModule,
    AddBankAccountDialogComponent
  ],
  template: `
    <app-page-header
      title="Comptes bancaires" i18n-title="@@payments.bank-accounts.comptes.bancaires.3af6caeb"
      subtitle="Gérez vos comptes tunisiens (RIB / IBAN) pour la trésorerie." i18n-subtitle="@@payments.bank-accounts.gerez.vos.comptes.tunisiens.rib.iban.pou.21e878c1">
    </app-page-header>

    @if (!auth.isFirmDelegatedReadonly() && canCreate()) {
      <div class="page-actions">
        <app-button variant="primary" icon="pi pi-plus" (click)="openCreate()" ariaLabel="Ajouter un compte bancaire" i18n-ariaLabel="@@payments.bank-accounts.ajouter.un.compte.bancaire.64427e80" i18n="@@payments.bank-accounts.ajouter.un.compte.351ab0a7"> Ajouter un compte </app-button>
      </div>
    }

    <div class="content-card">
      @if (loading()) {
        <div class="skeleton-grid" aria-busy="true" aria-label="Chargement" i18n-aria-label="@@payments.bank-accounts.chargement.c7ac0481">
          @for (i of [1, 2, 3]; track i) {
            <p-skeleton height="180px" styleClass="skeleton-card"></p-skeleton>
          }
        </div>
      } @else if (accounts().length === 0) {
        @if (auth.isFirmDelegatedReadonly()) {
          <app-empty-state
            icon="pi pi-building"
            title="Vous n'avez pas encore de compte bancaire" i18n-title="@@payments.bank-accounts.vous.n.avez.pas.encore.de.compte.bancaire.e6e57039"
            description="Aucun compte bancaire n'est configuré pour ce dossier." i18n-description="@@payments.bank-accounts.aucun.compte.bancaire.n.est.configure.po.09887b0b">
          </app-empty-state>
        } @else if (canCreate()) {
          <app-empty-state
            icon="pi pi-building"
            title="Vous n'avez pas encore de compte bancaire" i18n-title="@@payments.bank-accounts.vous.n.avez.pas.encore.de.compte.bancaire.e6e57039"
            description="Ajoutez un compte pour suivre vos virements et votre trésorerie." i18n-description="@@payments.bank-accounts.ajoutez.un.compte.pour.suivre.vos.vireme.ff8b3076"
            actionLabel="Ajouter un compte" i18n-actionLabel="@@payments.bank-accounts.ajouter.un.compte.f478ef40"
            (actionClick)="openCreate()">
          </app-empty-state>
        } @else {
          <app-empty-state
            icon="pi pi-building"
            title="Vous n'avez pas encore de compte bancaire" i18n-title="@@payments.bank-accounts.vous.n.avez.pas.encore.de.compte.bancaire.e6e57039"
            description="Autorisation « Trésorerie — saisie » requise pour ajouter un compte." i18n-description="@@payments.bank-accounts.autorisation.tresorerie.saisie.requise.p.7dad37ab">
          </app-empty-state>
        }
      } @else {
        <div class="cards-grid" role="list">
          @for (a of accounts(); track a.id) {
            <article class="bank-card" role="listitem">
              <div class="bank-card-header">
                <h3 class="bank-title">{{ a.designation || a.bankName }}</h3>
                @if (a.isDefault) {
                  <p-tag severity="success" value="Par défaut" styleClass="tag-compact"></p-tag>
                }
              </div>
              <p class="bank-sub">{{ a.bankName }}</p>
              @if (a.agencyName) {
                <p class="bank-meta"><span class="label" i18n="@@payments.bank-accounts.agence.37c58081">Agence</span> {{ a.agencyName }}</p>
              }
              <div class="bank-lines">
                <div>
                  <span class="label" i18n="@@payments.bank-accounts.iban.e81566a5">IBAN</span>
                  <span class="mono">{{ formatIban(a.iban) }}</span>
                </div>
                <div>
                  <span class="label" i18n="@@payments.bank-accounts.rib.61f3ea57">RIB</span>
                  <span class="mono">{{ formatRib(a.rib) }}</span>
                </div>
                @if (a.chartOfAccountNumber) {
                  <div>
                    <span class="label" i18n="@@payments.bank-accounts.compte.comptable.6d979a32">Compte comptable</span>
                    <span class="mono">{{ a.chartOfAccountNumber }}</span>
                  </div>
                }
                @if (a.swiftBic) {
                  <div>
                    <span class="label" i18n="@@payments.bank-accounts.swift.19e6802b">SWIFT</span>
                    <span class="mono">{{ a.swiftBic }}</span>
                  </div>
                }
              </div>
              @if (!auth.isFirmDelegatedReadonly() && canUpdate()) {
                <div class="bank-actions">
                  @if (!a.isDefault) {
                    <app-button
                      variant="outline"
                      size="sm"
                      icon="pi pi-star"
                      (click)="setDefault(a)"
                      pTooltip="Définir comme compte par défaut" i18n-pTooltip="@@payments.bank-accounts.definir.comme.compte.par.defaut.6a8425f5"
                      ariaLabel="Définir comme compte par défaut" i18n-ariaLabel="@@payments.bank-accounts.definir.comme.compte.par.defaut.ed2b1b7f" i18n="@@payments.bank-accounts.defaut.47456751"> Défaut </app-button>
                  }
                  <app-button
                    variant="outline"
                    size="sm"
                    icon="pi pi-pencil"
                    (click)="openEdit(a)"
                    ariaLabel="Modifier le compte" i18n-ariaLabel="@@payments.bank-accounts.modifier.le.compte.78ea5a74" i18n="@@payments.bank-accounts.modifier.f260e757"> Modifier </app-button>
                  <app-button
                    variant="danger"
                    size="sm"
                    icon="pi pi-trash"
                    (click)="confirmDelete(a)"
                    ariaLabel="Supprimer le compte" i18n-ariaLabel="@@payments.bank-accounts.supprimer.le.compte.c0b3f815" i18n="@@payments.bank-accounts.supprimer.1acfc1c7"> Supprimer </app-button>
                </div>
              }
            </article>
          }
        </div>
      }
    </div>

    <app-add-bank-account-dialog
      [visible]="dialogVisible"
      (visibleChange)="onDialogVisibleChange($event)"
      [editingAccount]="accountToEdit"
      (saved)="onSaved()">
    </app-add-bank-account-dialog>
  `,
  styles: [
    `
      .page-actions {
        display: flex;
        justify-content: flex-end;
        margin-bottom: var(--spacing-4);
      }
      .content-card {
        background: var(--color-background-elevated);
        border: 1px solid var(--color-border-subtle);
        border-radius: var(--radius-xl);
        padding: var(--spacing-6);
        min-height: 280px;
      }
      .skeleton-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: var(--spacing-4);
      }
      .cards-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: var(--spacing-4);
      }
      .bank-card {
        border: 1px solid var(--color-border-subtle);
        border-radius: var(--radius-lg);
        padding: var(--spacing-4);
        background: var(--color-background-subtle);
        display: flex;
        flex-direction: column;
        gap: var(--spacing-2);
      }
      .bank-card-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--spacing-2);
      }
      .bank-title {
        margin: 0;
        font-size: var(--font-size-lg);
        font-weight: var(--font-weight-semibold);
        color: var(--color-text-primary);
      }
      .bank-sub {
        margin: 0;
        color: var(--color-text-secondary);
        font-size: var(--font-size-sm);
      }
      .bank-meta {
        margin: 0;
        font-size: var(--font-size-sm);
        color: var(--color-text-secondary);
      }
      .bank-lines {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-2);
        margin-top: var(--spacing-2);
        padding-top: var(--spacing-3);
        border-top: 1px dashed var(--color-border-subtle);
      }
      .bank-lines .label {
        display: block;
        font-size: var(--font-size-xs);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--color-text-tertiary);
        margin-bottom: 2px;
      }
      .mono {
        font-family: 'JetBrains Mono', ui-monospace, monospace;
        font-size: var(--font-size-sm);
        word-break: break-all;
      }
      .bank-actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-2);
        margin-top: auto;
        padding-top: var(--spacing-3);
      }
      :host ::ng-deep .tag-compact .p-tag {
        font-size: var(--font-size-xs);
      }
    `
  ]
})
export class BankAccountsComponent implements OnInit {
  private readonly bankAccountService = inject(BankAccountService);
  private readonly toast = inject(ToastService);
  private readonly confirmation = inject(ConfirmationService);
  readonly auth = inject(AuthService);

  /** Création d'un compte bancaire — `payments:create`. */
  readonly canCreate = computed(() => this.auth.hasPermission(PERMISSIONS.payments.create));
  /** Modification / suppression / défaut — `payments:update`. */
  readonly canUpdate = computed(() => this.auth.hasPermission(PERMISSIONS.payments.update));

  loading = signal(true);
  accounts = signal<BankAccountDto[]>([]);

  dialogVisible = false;
  accountToEdit: BankAccountDto | null = null;

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.bankAccountService.list().subscribe({
      next: res => {
        this.loading.set(false);
        if (res.success && res.data) {
          this.accounts.set(res.data);
        } else {
          this.accounts.set([]);
        }
      },
      error: () => {
        this.loading.set(false);
        this.accounts.set([]);
        this.toast.add({
          severity: 'error',
          summary: $localize`:@@bank-accounts.component.summary.Erreur:Erreur`,
          detail: $localize`:@@bank-accounts.component.detail.Impossible_de_ch:Impossible de charger les comptes bancaires.`
        });
      }
    });
  }

  openCreate(): void {
    if (this.auth.isFirmDelegatedReadonly() || !this.canCreate()) return;
    this.accountToEdit = null;
    this.dialogVisible = true;
  }

  openEdit(a: BankAccountDto): void {
    if (this.auth.isFirmDelegatedReadonly() || !this.canUpdate()) return;
    this.accountToEdit = { ...a };
    this.dialogVisible = true;
  }

  onDialogVisibleChange(v: boolean): void {
    this.dialogVisible = v;
    if (!v) {
      this.accountToEdit = null;
    }
  }

  onSaved(): void {
    this.accountToEdit = null;
    this.load();
  }

  setDefault(a: BankAccountDto): void {
    if (this.auth.isFirmDelegatedReadonly() || !this.canUpdate()) return;
    this.bankAccountService.setDefault(a.id).subscribe({
      next: res => {
        if (res.success) {
          this.toast.add({
            severity: 'success',
            summary: $localize`:@@bank-accounts.component.summary.Succès:Succès`,
            detail: res.message ?? $localize`:@@ui.tern.compte.par.defaut.mis.a.jour.02dd1f:Compte par défaut mis à jour.`
          });
          this.load();
        } else {
          this.toast.add({
            severity: 'error',
            summary: $localize`:@@bank-accounts.component.summary.Erreur:Erreur`,
            detail: res.errors?.[0] ?? $localize`:@@ui.tern.action.impossible.cd5717:Action impossible.`
          });
        }
      },
      error: (err: HttpErrorResponse) => {
        // 403 (payments:update) → message métier français ; autre → message générique.
        const detail = err.status === 403
          ? $localize`:@@ui.tern.action.refusee.autorisations.insuffisantes.86b982:Action refusée : autorisations insuffisantes (Trésorerie — mise à jour).`
          : $localize`:@@ui.tern.action.impossible.cd5717:Action impossible.`;
        this.toast.add({ severity: 'error', summary: $localize`:@@bank-accounts.component.summary.Erreur:Erreur`, detail });
      }
    });
  }

  confirmDelete(a: BankAccountDto): void {
    if (this.auth.isFirmDelegatedReadonly() || !this.canUpdate()) return;
    this.confirmation.confirm({
      header: 'Supprimer le compte',
      message: `Supprimer le compte ${a.designation || a.bankName} ? Cette action est irréversible.`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: $localize`:@@bank-accounts.component.acceptLabel.Supprimer:Supprimer`,
      rejectLabel: $localize`:@@bank-accounts.component.rejectLabel.Annuler:Annuler`,
      acceptButtonStyleClass: 'btn-danger',
      accept: () => {
        this.bankAccountService.delete(a.id).subscribe({
          next: res => {
            if (res.success) {
              this.toast.add({
                severity: 'success',
                summary: $localize`:@@bank-accounts.component.summary.Succès:Succès`,
                detail: res.message ?? $localize`:@@ui.tern.compte.supprime.f2d6e9:Compte supprimé.`
              });
              this.load();
            } else {
              this.toast.add({
                severity: 'error',
                summary: $localize`:@@bank-accounts.component.summary.Erreur:Erreur`,
                detail: res.errors?.[0] ?? $localize`:@@ui.tern.suppression.impossible.0dffe4:Suppression impossible.`
              });
            }
          },
          error: (err: HttpErrorResponse) => {
            // 403 (payments:update) → message métier français ; autre → message générique.
            const detail = err.status === 403
              ? $localize`:@@ui.tern.action.refusee.autorisations.insuffisantes.86b982:Action refusée : autorisations insuffisantes (Trésorerie — mise à jour).`
              : $localize`:@@ui.tern.suppression.impossible.0dffe4:Suppression impossible.`;
            this.toast.add({ severity: 'error', summary: $localize`:@@bank-accounts.component.summary.Erreur:Erreur`, detail });
          }
        });
      }
    });
  }

  formatIban(iban: string): string {
    const c = iban.replace(/\s/g, '').toUpperCase();
    if (c.length !== 24) return iban;
    return c.replace(/(.{4})/g, '$1 ').trim();
  }

  formatRib(rib: string): string {
    const d = rib.replace(/\D/g, '');
    if (d.length !== 20) return rib;
    return `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 18)} ${d.slice(18, 20)}`;
  }
}
