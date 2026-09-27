/// <reference types="@angular/localize" />
import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { FormSectionComponent } from '@shared/components/form-section/form-section.component';
import { SkeletonComponent } from '@shared/components/skeleton/skeleton.component';
import { TableTotalsBarComponent, TotalMetric } from '@shared/components/table-totals-bar/table-totals-bar.component';
import {
  BillingFrequency,
  RecurringContractDetail,
  RecurringContractService,
  UsageMetric,
  UpsertRecurringContractPayload
} from '@core/services/recurring-contract.service';
import { ClientService, ClientListItem } from '@core/services/client.service';
import { PricingService, PaymentTermTemplate } from '@core/services/pricing.service';
import { ProductService, ProductListItem } from '@core/services/product.service';
import { QuoteDetail, QuoteService } from '@core/services/quote.service';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { ContractLinePayloadSource, fixedLinesMonthlyEstimate, toLinePayloads } from '../../recurring-contracts.ui-utils';

interface ContractLineForm extends ContractLinePayloadSource {
  sortOrder: number;
}

@Component({
  selector: 'app-contract-form',
  standalone: true,
  imports: [
    CommonModule, RouterModule, FormsModule,
    PageHeaderComponent, BreadcrumbComponent, ButtonComponent,
    FormSectionComponent, SkeletonComponent, TableTotalsBarComponent
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems"></app-breadcrumb>

    <app-page-header
      [title]="isEdit() ? loc_ui_tern_modifier_le_contrat_2ed431 : loc_ui_tern_nouveau_contrat_recurrent_811d0c"
      subtitle="Définissez la périodicité, les lignes et les conditions de facturation">
    </app-page-header>

    @if (pageLoading()) {
      <div class="loading-stack">
        <app-skeleton height="6rem" shape="rounded"></app-skeleton>
        <app-skeleton height="6rem" shape="rounded"></app-skeleton>
        <app-skeleton height="10rem" shape="rounded"></app-skeleton>
      </div>
    } @else {
    <form (ngSubmit)="save()">
      <app-form-section [number]="1" title="Client et référence" i18n-title="@@recurring-contracts.pages.client.et.reference.72896cf8" icon="pi-user">
        <div class="grid">
          <label>
            <span class="field-label required" i18n="@@recurring-contracts.pages.client.1bdd79b1">Client</span>
            <select class="ft-input" [(ngModel)]="clientId" name="clientId" required [disabled]="!!quoteId">
              <option value="" i18n="@@recurring-contracts.pages.selectionner.7ae1afc7">— Sélectionner —</option>
              @for (c of clients(); track c.id) {
                <option [value]="c.id">{{ c.name }}</option>
              }
            </select>
            @if (quoteId) {
              <span class="field-hint" i18n="@@recurring-contracts.pages.client.et.lignes.repris.du.devis.d.origine.ajust.674eda11">Client et lignes repris du devis d'origine (ajustables avant enregistrement).</span>
            }
          </label>
          <label>Référence
            <input class="ft-input" [(ngModel)]="reference" name="reference" placeholder="Référence interne ou client" i18n-placeholder="@@recurring-contracts.pages.reference.interne.ou.client.b661bb17" />
          </label>
        </div>
      </app-form-section>

      <app-form-section [number]="2" title="Facturation" i18n-title="@@recurring-contracts.pages.facturation.04716c6b" icon="pi-calendar">
        <div class="grid">
          <label>Périodicité
            <select class="ft-input" [(ngModel)]="billingFrequency" name="billingFrequency">
              <option [ngValue]="'Monthly'" i18n="@@recurring-contracts.pages.mensuel.272c1b22">Mensuel</option>
              <option [ngValue]="'Quarterly'" i18n="@@recurring-contracts.pages.trimestriel.d6432184">Trimestriel</option>
              <option [ngValue]="'Annual'" i18n="@@recurring-contracts.pages.annuel.11aad2fa">Annuel</option>
            </select>
          </label>
          <label>Jour de facturation
            <input class="ft-input" type="number" min="1" max="31" [(ngModel)]="billingDayOfMonth" name="billingDay" />
          </label>
          <label>
            <span class="field-label required" i18n="@@recurring-contracts.pages.date.de.debut.706438ab">Date de début</span>
            <input class="ft-input" type="date" [(ngModel)]="startDate" name="startDate" required />
          </label>
          <label>Date de fin
            <input class="ft-input" type="date" [(ngModel)]="endDate" name="endDate" />
          </label>
          <label>Condition de règlement
            <select class="ft-input" [(ngModel)]="paymentTermTemplateId" name="paymentTermTemplateId">
              <option [ngValue]="null" i18n="@@recurring-contracts.pages.par.defaut.84534de7">— Par défaut —</option>
              @for (pt of paymentTerms(); track pt.id) {
                <option [ngValue]="pt.id">{{ pt.name }}</option>
              }
            </select>
          </label>
        </div>
      </app-form-section>

      <app-form-section [number]="3" title="Renouvellement" i18n-title="@@recurring-contracts.pages.renouvellement.5b961f3a" icon="pi-refresh">
        <div class="grid">
          <label class="checkbox-label">
            <input type="checkbox" [(ngModel)]="autoRenew" name="autoRenew" />
            Renouvellement automatique
          </label>
          <label>Préavis (jours)
            <input class="ft-input" type="number" min="0" [(ngModel)]="noticePeriodDays" name="noticePeriodDays" />
          </label>
        </div>
      </app-form-section>

      <app-form-section [number]="4" title="Lignes du contrat" i18n-title="@@recurring-contracts.pages.lignes.du.contrat.b39acc9e" icon="pi-list">
        @for (line of lines; track $index; let i = $index) {
          <div class="line-card">
            <div class="line-card__head">
              <label>Type
                <select class="ft-input" [(ngModel)]="line.lineType" [name]="'lineType' + i">
                  <option [ngValue]="'FixedRecurring'" i18n="@@recurring-contracts.pages.recurrent.fixe.9f36de5c">Récurrent fixe</option>
                  <option [ngValue]="'UsageMetered'" i18n="@@recurring-contracts.pages.a.la.consommation.a9497352">À la consommation</option>
                  <option [ngValue]="'OneTimeSetup'" i18n="@@recurring-contracts.pages.frais.d.installation.f39459df">Frais d'installation</option>
                </select>
              </label>
              <app-button type="button" variant="ghost" size="sm" icon="pi-trash" (clicked)="removeLine(i)" i18n="@@recurring-contracts.pages.supprimer.1acfc1c7"> Supprimer </app-button>
            </div>
            <div class="grid">
              <label class="span-2">Description
                <input class="ft-input" placeholder="Description (optionnelle)" i18n-placeholder="@@recurring-contracts.pages.description.optionnelle.27856f3e" [(ngModel)]="line.description" [name]="'desc' + i" />
              </label>
              @if (line.lineType !== 'OneTimeSetup') {
                <label>
                  <span class="field-label required" i18n="@@recurring-contracts.pages.produit.ff673dc2">Produit</span>
                  <select class="ft-input" [(ngModel)]="line.productId" [name]="'product' + i">
                    <option [ngValue]="null" disabled i18n="@@recurring-contracts.pages.selectionner.7ae1afc7">— Sélectionner —</option>
                    @for (p of products(); track p.id) {
                      <option [ngValue]="p.id">{{ p.code }} — {{ p.name }}</option>
                    }
                  </select>
                </label>
              }
              <label>Qté
                <input class="ft-input" type="number" placeholder="Qté" i18n-placeholder="@@recurring-contracts.pages.qte.a4772129" [(ngModel)]="line.quantity" [name]="'qty' + i" />
              </label>
              <label>Prix unitaire HT
                <input class="ft-input" type="number" step="0.001" min="0" placeholder="Prix HT" i18n-placeholder="@@recurring-contracts.pages.prix.ht.362207ca" [(ngModel)]="line.unitPriceHT" [name]="'price' + i" />
              </label>
              <label>TVA %
                <input class="ft-input" type="number" step="0.001" min="0" placeholder="TVA %" i18n-placeholder="@@recurring-contracts.pages.tva.b984d709" [(ngModel)]="line.vatRate" [name]="'vat' + i" />
              </label>
              @if (line.lineType === 'UsageMetered') {
                <label>
                  <span class="field-label required" i18n="@@recurring-contracts.pages.metrique.066ebc60">Métrique</span>
                  <select class="ft-input" [(ngModel)]="line.usageMetricId" [name]="'metric' + i">
                    <option [ngValue]="null" i18n="@@recurring-contracts.pages.selectionner.7ae1afc7">— Sélectionner —</option>
                    @for (m of usageMetrics(); track m.id) {
                      <option [ngValue]="m.id">{{ m.name }} ({{ m.unit }})</option>
                    }
                  </select>
                </label>
                <label>Quantité incluse
                  <input class="ft-input" type="number" min="0" [(ngModel)]="line.includedQuantity" [name]="'includedQty' + i" />
                </label>
                <label>Prix unitaire dépassement HT
                  <input class="ft-input" type="number" step="0.001" min="0" [(ngModel)]="line.overageUnitPriceHT" [name]="'overagePrice' + i" />
                </label>
              }
            </div>
          </div>
        }
        <app-button type="button" variant="outline" icon="pi-plus" (clicked)="addLine()" i18n="@@recurring-contracts.pages.ajouter.une.ligne.ba241fd4">Ajouter une ligne</app-button>

        <app-table-totals-bar [metrics]="totalsMetrics()"></app-table-totals-bar>
      </app-form-section>

      <app-form-section [number]="5" title="Notes" i18n-title="@@recurring-contracts.pages.notes.70440046" icon="pi-comment">
        <label>Notes internes
          <textarea class="ft-input" rows="3" [(ngModel)]="notes" name="notes"></textarea>
        </label>
      </app-form-section>

      <div class="actions">
        <app-button type="button" variant="outline" [routerLink]="cancelRoute" i18n="@@recurring-contracts.pages.annuler.49ba3292">Annuler</app-button>
        <app-button type="submit" variant="primary" icon="pi-check" [disabled]="saving() || !canSave">
          {{ saving() ? loc_ui_tern_enregistrement_e7d5f2 : loc_ui_tern_enregistrer_f7c8bc }}
        </app-button>
      </div>
    </form>
    }
  `,
  styles: [`
    .loading-stack { display: flex; flex-direction: column; gap: var(--spacing-4); }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: var(--spacing-4);
    }

    label {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-1);
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
    }

    .field-label.required::after {
      content: ' *';
      color: var(--color-error-500);
    }

    .span-2 { grid-column: span 2; }

    .checkbox-label {
      flex-direction: row;
      align-items: center;
      gap: var(--spacing-2);
      color: var(--color-text-primary);
    }

    .field-hint {
      font-size: var(--font-size-xs);
      color: var(--color-text-tertiary);
    }

    .ft-input {
      padding: var(--spacing-2) var(--spacing-3);
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-lg);
      font-size: var(--font-size-sm);
      font-family: inherit;
      background: var(--color-background-elevated);
      color: var(--color-text-primary);
    }

    .ft-input:focus-visible {
      outline: 2px solid var(--color-primary-500);
      outline-offset: 1px;
    }

    .line-card {
      border: 1px solid var(--color-border-subtle);
      border-radius: var(--radius-xl);
      padding: var(--spacing-4);
      margin-bottom: var(--spacing-4);
      background: var(--color-background-subtle);
    }

    .line-card__head {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: var(--spacing-3);
      margin-bottom: var(--spacing-3);
    }

    app-table-totals-bar { display: block; margin-top: var(--spacing-4); }

    .actions {
      display: flex;
      gap: var(--spacing-3);
      justify-content: flex-end;
      margin-top: var(--spacing-4);
    }
  `]
})
export class ContractFormComponent implements OnInit {
  readonly loc_ui_tern_modifier_le_contrat_2ed431 = $localize`:@@ui.tern.modifier.le.contrat.2ed431:Modifier le contrat`;
  readonly loc_ui_tern_nouveau_contrat_recurrent_811d0c = $localize`:@@ui.tern.nouveau.contrat.recurrent.811d0c:Nouveau contrat récurrent`;
  readonly loc_ui_tern_enregistrement_e7d5f2 = $localize`:@@ui.tern.enregistrement.e7d5f2:Enregistrement…`;
  readonly loc_ui_tern_enregistrer_f7c8bc = $localize`:@@ui.tern.enregistrer.f7c8bc:Enregistrer`;
  private readonly service = inject(RecurringContractService);
  private readonly clientService = inject(ClientService);
  private readonly pricingService = inject(PricingService);
  private readonly productService = inject(ProductService);
  private readonly quoteService = inject(QuoteService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly errorHandler = inject(ErrorHandlerService);

  readonly clients = signal<ClientListItem[]>([]);
  readonly paymentTerms = signal<PaymentTermTemplate[]>([]);
  readonly products = signal<ProductListItem[]>([]);
  readonly usageMetrics = signal<UsageMetric[]>([]);
  readonly isEdit = signal(false);
  readonly saving = signal(false);
  readonly pageLoading = signal(false);
  contractId: string | null = null;
  quoteId: string | null = null;

  clientId = '';
  billingFrequency: BillingFrequency = 'Monthly';
  billingDayOfMonth = 1;
  startDate = new Date().toISOString().slice(0, 10);
  endDate = '';
  autoRenew = true;
  noticePeriodDays = 30;
  paymentTermTemplateId: string | null = null;
  reference = '';
  notes = '';
  lines: ContractLineForm[] = [this.newLine(0)];

  get breadcrumbItems(): BreadcrumbItem[] {
    return [
      { label: 'Accueil', route: '/', icon: 'pi-home' },
      { label: 'Contrats récurrents', route: '/recurring-contracts' },
      { label: this.isEdit() ? $localize`:@@ui.tern.modifier.le.contrat.2ed431:Modifier le contrat` : $localize`:@@ui.tern.nouveau.contrat.13fabd:Nouveau contrat` }
    ];
  }

  get cancelRoute(): string {
    return this.isEdit() && this.contractId
      ? `/recurring-contracts/${this.contractId}`
      : '/recurring-contracts';
  }

  get totalHT(): number {
    return this.lines.reduce((sum, l) => sum + (l.quantity || 0) * (l.unitPriceHT || 0), 0);
  }

  get totalVAT(): number {
    return this.lines.reduce((sum, l) => sum + (l.quantity || 0) * (l.unitPriceHT || 0) * (l.vatRate || 0) / 100, 0);
  }

  /** Estimation mensuelle : lignes fixes ramenées au mois selon la périodicité. */
  get monthlyEstimate(): number {
    return fixedLinesMonthlyEstimate(this.lines, this.billingFrequency);
  }

  totalsMetrics(): TotalMetric[] {
    return [
      { label: 'Total HT', value: this.totalHT, format: 'currency', currency: 'TND', icon: 'pi-calculator', tone: 'primary' },
      { label: 'TVA', value: this.totalVAT, format: 'currency', currency: 'TND', icon: 'pi-percentage', tone: 'cyan' },
      { label: 'Total TTC', value: this.totalHT + this.totalVAT, format: 'currency', currency: 'TND', icon: 'pi-wallet', tone: 'emerald' },
      { label: 'Estimation mensuelle', value: this.monthlyEstimate, format: 'currency', currency: 'TND', icon: 'pi-sync', tone: 'violet', hint: 'Lignes fixes ramenées au mois' }
    ];
  }

  ngOnInit(): void {
    this.loadReferentials();
    this.quoteId = this.route.snapshot.queryParamMap.get('quoteId');
    const id = this.route.snapshot.paramMap.get('id');
    if (id && this.route.snapshot.url.some(s => s.path === 'edit')) {
      this.isEdit.set(true);
      this.contractId = id;
      this.pageLoading.set(true);
      this.service.get(id).subscribe({
        next: c => {
          this.patchForm(c);
          this.pageLoading.set(false);
        },
        error: err => {
          this.pageLoading.set(false);
          this.errorHandler.logError('RecurringContracts: form load', err);
          this.toast.add({ severity: 'error', summary: $localize`:@@contract-form.component.summary.Erreur:Erreur`, detail: this.errorHandler.extractErrorMessage(err) });
          void this.router.navigate(['/recurring-contracts']);
        }
      });
    } else if (this.quoteId) {
      // Pré-remplissage depuis un devis : client ET lignes repris (ajustables avant soumission —
      // le payload envoyé porte toujours les lignes affichées, la reprise côté serveur ne
      // sert que de secours au flux direct depuis la fiche devis).
      this.quoteService.getQuote(this.quoteId).subscribe({
        next: res => {
          if (res.success && res.data) this.prefillFromQuote(res.data);
        },
        error: () => { /* le select client reste éditable en secours */ }
      });
    }
  }

  addLine(): void {
    this.lines.push(this.newLine(this.lines.length));
  }

  removeLine(index: number): void {
    this.lines.splice(index, 1);
  }

  save(): void {
    if (!this.validate()) return;

    const payload: UpsertRecurringContractPayload = {
      clientId: this.clientId,
      billingFrequency: this.billingFrequency,
      billingDayOfMonth: this.billingDayOfMonth,
      startDate: this.startDate,
      endDate: this.endDate || null,
      autoRenew: this.autoRenew,
      noticePeriodDays: this.noticePeriodDays,
      paymentTermTemplateId: this.paymentTermTemplateId,
      reference: this.reference || null,
      notes: this.notes || null,
      lines: toLinePayloads(this.lines)
    };
    this.saving.set(true);

    if (this.isEdit() && this.contractId) {
      this.service.update(this.contractId, payload).subscribe({
        next: () => {
          this.saving.set(false);
          this.toast.add({ severity: 'success', summary: $localize`:@@contract-form.component.summary.Contrat_enregist:Contrat enregistré`, detail: $localize`:@@contract-form.component.detail.Les_modification:Les modifications ont été enregistrées.` });
          void this.router.navigate(['/recurring-contracts', this.contractId!]);
        },
        error: err => {
          this.saving.set(false);
          this.errorHandler.logError('RecurringContracts: update', err);
          this.toast.add({ severity: 'error', summary: $localize`:@@contract-form.component.summary.Erreur:Erreur`, detail: this.errorHandler.extractErrorMessage(err) });
        }
      });
      return;
    }

    if (this.quoteId) {
      this.service.convertFromQuote(this.quoteId, payload).subscribe({
        next: id => {
          this.saving.set(false);
          this.toast.add({ severity: 'success', summary: $localize`:@@contract-form.component.summary.Contrat_cr_:Contrat créé`, detail: $localize`:@@contract-form.component.detail.Contrat_cr_dep:Contrat créé depuis le devis.` });
          void this.router.navigate(['/recurring-contracts', id]);
        },
        error: err => {
          this.saving.set(false);
          this.errorHandler.logError('RecurringContracts: convertFromQuote', err);
          this.toast.add({ severity: 'error', summary: $localize`:@@contract-form.component.summary.Erreur:Erreur`, detail: this.errorHandler.extractErrorMessage(err) });
        }
      });
      return;
    }

    this.service.create(payload).subscribe({
      next: id => {
        this.saving.set(false);
        this.toast.add({ severity: 'success', summary: $localize`:@@contract-form.component.summary.Contrat_cr_:Contrat créé`, detail: $localize`:@@contract-form.component.detail.Le_brouillon_de_:Le brouillon de contrat a été créé.` });
        void this.router.navigate(['/recurring-contracts', id]);
      },
      error: err => {
        this.saving.set(false);
        this.errorHandler.logError('RecurringContracts: create', err);
        this.toast.add({ severity: 'error', summary: $localize`:@@contract-form.component.summary.Erreur:Erreur`, detail: this.errorHandler.extractErrorMessage(err) });
      }
    });
  }

  /**
   * Première erreur de validation du formulaire, ou null s'il est valide.
   * Source unique des règles : utilisée par le getter `canSave` (désactivation
   * du bouton Enregistrer) et par `validate()` (filet de sécurité à la soumission).
   */
  private firstValidationError(): string | null {
    if (!this.clientId) return 'Sélectionnez un client.';
    if (this.billingDayOfMonth < 1 || this.billingDayOfMonth > 31) {
      return 'Le jour de facturation doit être compris entre 1 et 31.';
    }
    if (!this.startDate) return 'La date de début est obligatoire.';
    if (this.endDate && this.endDate < this.startDate) {
      return 'La date de fin doit être postérieure ou égale à la date de début.';
    }
    if (this.lines.length === 0) return 'Ajoutez au moins une ligne au contrat.';
    for (const line of this.lines) {
      if (line.lineType !== 'OneTimeSetup' && !line.productId) {
        if (this.products().length === 0) {
          return 'Le catalogue produits est indisponible : impossible d\'enregistrer une ligne sans produit.';
        }
        return 'Le produit est obligatoire pour chaque ligne (sauf frais d\'installation).';
      }
      if (line.lineType === 'UsageMetered' && !line.usageMetricId) {
        return 'La métrique est obligatoire pour une ligne à la consommation.';
      }
    }
    return null;
  }

  /** Le bouton Enregistrer n'est actif que lorsque tous les champs obligatoires sont valides. */
  get canSave(): boolean {
    return this.firstValidationError() === null;
  }

  /** Validation client : toast warn et aucune requête en cas d'invalidité. */
  private validate(): boolean {
    const error = this.firstValidationError();
    if (error) {
      this.toast.add({ severity: 'warn', summary: $localize`:@@contract-form.component.summary.Formulaire_incom:Formulaire incomplet`, detail: error });
      return false;
    }
    return true;
  }

  private loadReferentials(): void {
    this.clientService.getClients({ page: 1, pageSize: 200 }).subscribe({
      next: res => { if (res.success) this.clients.set(res.data.items); },
      error: () => this.clients.set([])
    });
    this.pricingService.getPaymentTerms(true).subscribe({
      next: res => this.paymentTerms.set(res.data ?? []),
      error: () => this.paymentTerms.set([])
    });
    // Catalogue non critique : une 403 (pas de permission produits) laisse le select vide.
    this.productService.getProducts({ pageSize: 200 }).subscribe({
      next: res => this.products.set(res.data?.items ?? []),
      error: () => this.products.set([])
    });
    this.service.listUsageMetrics().subscribe({
      next: m => this.usageMetrics.set(m),
      error: () => this.usageMetrics.set([])
    });
  }

  /** Pré-remplit client, référence et lignes depuis le devis d'origine (flux ?quoteId=). */
  private prefillFromQuote(q: QuoteDetail): void {
    this.clientId = q.clientId;
    if (q.reference && !this.reference) this.reference = q.reference;
    if (!q.lines?.length) return;
    this.lines = q.lines.map((ql, i) => ({
      id: null,
      lineType: 'FixedRecurring' as const,
      productId: ql.productId ?? null,
      description: ql.productDescription?.trim()
        ? `${ql.productName} — ${ql.productDescription.trim()}`
        : ql.productName,
      quantity: ql.quantity,
      // Prix unitaire HT net de remise éventuelle (les lignes de contrat n'ont pas de remise).
      unitPriceHT: +(ql.unitPrice * (1 - (ql.discountPercent ?? 0) / 100)).toFixed(3),
      vatRate: ql.vatRatePercent,
      usageMetricId: null,
      includedQuantity: null,
      overageUnitPriceHT: null,
      sortOrder: i
    }));
  }

  private newLine(sortOrder: number): ContractLineForm {
    return {
      id: null,
      lineType: 'FixedRecurring',
      productId: null,
      description: '',
      quantity: 1,
      unitPriceHT: 0,
      vatRate: 19,
      usageMetricId: null,
      includedQuantity: null,
      overageUnitPriceHT: null,
      sortOrder
    };
  }

  /** Reprend TOUTES les valeurs du contrat (correction B3 : plus aucun champ écrasé). */
  private patchForm(c: RecurringContractDetail): void {
    this.clientId = c.clientId;
    this.billingFrequency = c.billingFrequency === 'OneOff' ? 'Monthly' : c.billingFrequency;
    this.billingDayOfMonth = c.billingDayOfMonth;
    this.startDate = c.startDate.slice(0, 10);
    this.endDate = c.endDate?.slice(0, 10) ?? '';
    this.autoRenew = c.autoRenew;
    this.noticePeriodDays = c.noticePeriodDays;
    this.paymentTermTemplateId = c.paymentTermTemplateId ?? null;
    this.reference = c.reference ?? '';
    this.notes = c.notes ?? '';
    this.lines = c.lines.map((l, i) => ({
      id: l.id ?? null,
      lineType: l.lineType,
      productId: l.productId ?? null,
      description: l.description,
      quantity: l.quantity,
      unitPriceHT: l.unitPriceHT,
      vatRate: l.vatRate,
      usageMetricId: l.usageMetricId ?? null,
      includedQuantity: l.includedQuantity ?? null,
      overageUnitPriceHT: l.overageUnitPriceHT ?? null,
      sortOrder: i
    }));
  }
}
