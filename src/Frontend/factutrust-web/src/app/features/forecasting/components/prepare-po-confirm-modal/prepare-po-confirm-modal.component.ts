import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  HostListener,
  Input,
  OnInit,
  Output,
  computed,
  inject,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { erpCollatorCompare } from '@core/i18n/erp-format';
import { firstValueFrom } from 'rxjs';
import { ReplenishmentRecommendation } from '../../models/forecasting.models';
import { QuantityFormatPipe } from '../../pipes/quantity-format.pipe';
import { FocusTrapDirective } from '../../directives/focus-trap.directive';
import { SupplierService, SupplierListItem } from '@core/services/supplier.service';

interface SupplierGroup {
  supplierId: string | null;
  /** Stable, non-null key for @for tracking (the null group maps to 'unassigned'). */
  trackKey: string;
  supplierName: string;
  recommendations: ReplenishmentRecommendation[];
  totalQty: number;
}

/** A supplier chosen inside the modal for a recommendation that had none. */
export interface PreparePoAssignment {
  recommendationId: string;
  supplierId: string;
}

/** Persisted via POST override before create-purchase-orders (qty and/or supplier). */
export interface PreparePoLineUpdate {
  recommendationId: string;
  manualQty: number | null;
  manualSupplierId: string | null;
}

export interface PreparePoLinePrice {
  recommendationId: string;
  unitPrice: number;
}

/**
 * Confirmation modal shown before creating draft purchase orders from selected recommendations.
 * Groups the selection by effective supplier (manual override > preferred) and warns about
 * recommendations that would be skipped (no supplier resolvable).
 *
 * The actual API call lives in the parent component — this modal only confirms intent.
 */
@Component({
  selector: 'app-prepare-po-confirm-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, QuantityFormatPipe, FocusTrapDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="modal-backdrop" (click)="onCancel()" role="presentation">
      <div
        class="modal-panel"
        appFocusTrap
        (click)="$event.stopPropagation()"
        role="dialog"
        aria-modal="true"
        aria-labelledby="prepare-modal-title">
        <header class="modal-header">
          <div>
            <h3 id="prepare-modal-title" i18n="@@forecasting.components.creer.les.bons.de.commande.8e7effb0">Créer les bons de commande</h3>
            <span class="modal-subtitle" i18n="@@forecasting.components.recommandation.s.selectionnee.s.89aa030e">{{ recommendations.length }} recommandation(s) sélectionnée(s)</span>
          </div>
          <button class="close-btn" type="button" (click)="onCancel()" aria-label="Fermer" i18n-aria-label="@@forecasting.components.fermer.5ab4ec64">
            <i class="pi pi-times" aria-hidden="true"></i>
          </button>
        </header>

        <div class="modal-body">
          @if (groups().length > 0) {
            <p class="hint" i18n="@@forecasting.components.verifiez.les.quantites.et.les.fournisseu.0e0b021c">
              Vérifiez les quantités et les fournisseurs ci-dessous.
              {{ linkableCount() }} bon(s) de commande sera(seront) créé(s) en statut <strong>Brouillon</strong>,
              regroupé(s) par fournisseur. Vous pourrez les valider ensuite depuis le module Achats.
            </p>
            <ul class="supplier-groups">
              @for (g of groups(); track g.trackKey) {
                <li class="supplier-group" [class.has-issue]="g.supplierId === null">
                  <header class="group-header">
                    <span class="supplier-name">
                      @if (g.supplierId) {
                        <i class="pi pi-truck" aria-hidden="true"></i>
                        {{ g.supplierName }}
                      } @else {<ng-container i18n="@@forecasting.components.sans.fournisseur.849f6b64">
                        <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
                        Sans fournisseur
                      </ng-container>}
                    </span>
                    <span class="group-count" i18n="@@forecasting.components.ligne.s.total.u.61c817f2">
                      {{ g.recommendations.length }} ligne(s) — total
                      {{ g.totalQty | qtyFmt: groupFormatUnit(g) }} u.
                    </span>
                  </header>
                  <!-- Bulk assign — one supplier for every still-unassigned line (≥2 lines). -->
                  @if (g.supplierId === null && g.recommendations.length > 1 && !loadingSuppliers() && suppliers().length > 0) {
                    <div class="po-bulk-assign">
                      <i class="pi pi-bolt" aria-hidden="true"></i>
                      <select
                        class="po-bulk-select"
                        [ngModel]="bulkSupplierId()"
                        (ngModelChange)="onBulkAssign($event)"
                        aria-label="Assigner un fournisseur à toutes les lignes sans fournisseur" i18n-aria-label="@@forecasting.components.assigner.un.fournisseur.a.toutes.les.lignes.sans.dc01867b">
                        <option [ngValue]="null" i18n="@@forecasting.components.assigner.un.fournisseur.a.toutes.ces.lig.f6149a60">— Assigner un fournisseur à toutes ces lignes ({{ g.recommendations.length }}) —</option>
                        @for (s of suppliers(); track s.id) {
                          <option [ngValue]="s.id">{{ s.name }}</option>
                        }
                      </select>
                    </div>
                  }
                  <ul class="po-lines">
                    <li class="po-lines-header" aria-hidden="true">
                      <span class="po-col-code" i18n="@@forecasting.components.code.adac6937">Code</span>
                      <span class="po-col-name" i18n="@@forecasting.components.produit.ff673dc2">Produit</span>
                      <span class="po-col-supplier" i18n="@@forecasting.components.fournisseur.97d91d89">Fournisseur</span>
                      <span class="po-col-price" i18n="@@forecasting.components.pu.ht.79388cae">PU HT</span>
                      <span class="po-col-qty" i18n="@@forecasting.components.qte.a4772129">Qté</span>
                    </li>
                    @for (r of g.recommendations; track r.id) {
                      <li class="po-line" [class.po-line--unassigned]="effectiveSupplierId(r) === null">
                        <div class="po-line__head">
                          <span class="po-code">{{ r.productCode }}</span>
                          <span class="po-name">{{ r.productName }}</span>
                          <div class="po-supplier-block">
                            @if (loadingSuppliers()) {
                              <span class="assign-state" i18n="@@forecasting.components.chargement.01cba1df">Chargement…</span>
                            } @else if (suppliers().length === 0) {
                              <span class="assign-state" i18n="@@forecasting.components.aucun.fournisseur.module.achats.d1ff1364">Aucun fournisseur — module Achats.</span>
                            } @else {
                              <label class="po-supplier-field">
                                <select
                                  class="assign-select po-supplier-select"
                                  [class.po-supplier-select--issue]="effectiveSupplierId(r) === null"
                                  [ngModel]="displaySupplierId(r)"
                                  (ngModelChange)="assign(r.id, $event)"
                                  [attr.aria-label]="loc_ui_tern_fournisseur_pour_ac3489 + r.productCode">
                                  <option [ngValue]="null" i18n="@@forecasting.components.choisir.un.fournisseur.6593f4d4">— Choisir un fournisseur —</option>
                                  @for (s of suppliers(); track s.id) {
                                    <option [ngValue]="s.id">{{ s.name }}</option>
                                  }
                                </select>
                              </label>
                            }
                          </div>
                          <div class="po-price-block">
                            <label class="po-price-field">
                              <input
                                type="number"
                                class="po-price-input"
                                min="0"
                                step="0.001"
                                [ngModel]="draftPriceValue(r.id)"
                                (ngModelChange)="setDraftPrice(r.id, $event)"
                                [class.invalid]="priceInvalidForLinkable(r)"
                                [attr.aria-label]="loc_ui_tern_prix_unitaire_ht_pour_083196 + r.productCode"
                                placeholder="—" i18n-placeholder="@@forecasting.components.text.1b93795b" />
                            </label>
                            <span class="po-price-suffix" i18n="@@forecasting.components.tnd.51da21a7">TND</span>
                          </div>
                          <div class="po-qty-block">
                            <label class="po-qty-field">
                              <input
                                type="number"
                                class="po-qty-input"
                                min="0"
                                [attr.step]="isDiscreteUnit(r) ? 1 : 'any'"
                                [ngModel]="draftQtyValue(r.id)"
                                (ngModelChange)="setDraftQty(r.id, $event)"
                                [class.invalid]="qtyInvalidFor(r.id)"
                                [attr.aria-label]="loc_ui_tern_quantite_a_commander_pour_8e4c05 + r.productCode" />
                            </label>
                            <span class="po-rec-hint" title="Quantité recommandée par le moteur" i18n-title="@@forecasting.components.quantite.recommandee.par.le.moteur.d20840f9" i18n="@@forecasting.components.rec.b95cb5dc">
                              Rec. {{ r.recommendedQty | qtyFmt: r.productUnit }}
                            </span>
                          </div>
                        </div>
                      </li>
                    }
                  </ul>
                </li>
              }
            </ul>

            @if (anyQtyInvalid()) {
              <p class="qty-error" role="alert" i18n="@@forecasting.components.chaque.quantite.doit.etre.un.nombre.strictement..e15fdb5e"> Chaque quantité doit être un nombre strictement supérieur à 0. </p>
            }

            @if (anyPriceMissing()) {
              <p class="qty-error" role="alert" i18n="@@forecasting.components.chaque.ligne.avec.fournisseur.doit.avoir.un.prix.660b9bab"> Chaque ligne avec fournisseur doit avoir un prix unitaire HT strictement supérieur à 0. </p>
            }

            @if (skippedCount() > 0) {
              <div class="warning" role="alert" i18n="@@forecasting.components.recommandation.s.sans.fournisseur.ne.ser.beb606ad">
                <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
                <span>
                  <strong>{{ skippedCount() }} recommandation(s) sans fournisseur</strong>
                  ne seront pas liées à un bon de commande. Choisissez un fournisseur ci-dessus
                  (par ligne, ou pour toutes les lignes en une fois). Astuce : définissez un
                  <strong>fournisseur préféré</strong> sur la fiche produit pour que les prochaines
                  recommandations arrivent déjà rattachées.
                </span>
              </div>
            }
          } @else {
            <p class="state empty" i18n="@@forecasting.components.aucune.recommandation.a.traiter.7d661bf4">Aucune recommandation à traiter.</p>
          }
        </div>

        <footer class="modal-footer">
          <button class="btn btn-secondary" type="button" (click)="onCancel()" i18n="@@forecasting.components.annuler.49ba3292">Annuler</button>
          <button
            class="btn btn-primary"
            type="button"
            (click)="onConfirm()"
            [disabled]="!canConfirm()" i18n="@@forecasting.components.confirmer.la.creation.bc.28f0aedb">
            <i class="pi pi-check" aria-hidden="true"></i>
            Confirmer la création ({{ linkableCount() }} BC)
          </button>
        </footer>
      </div>
    </div>
  `,
  styles: [`
    .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 1rem; }
    .modal-panel { background: white; border-radius: 10px; width: 100%; max-width: 920px; box-shadow: 0 20px 60px rgba(0,0,0,.18); display: flex; flex-direction: column; max-height: 90vh; }
    .modal-header { display: flex; justify-content: space-between; align-items: flex-start; padding: 1.25rem 1.25rem .75rem; border-bottom: 1px solid var(--color-neutral-200, #e5e7eb); }
    .modal-header h3 { margin: 0 0 .15rem; font-size: 1.1rem; font-weight: 600; color: var(--color-neutral-900, #111827); }
    .modal-subtitle { font-size: .8rem; color: var(--color-neutral-500, #9ca3af); }
    .close-btn { background: none; border: none; cursor: pointer; padding: .25rem .5rem; color: var(--color-neutral-400, #9ca3af); font-size: 1.1rem; }
    .close-btn:hover { color: var(--color-neutral-700, #374151); }
    .modal-body { padding: 1rem 1.25rem; overflow-y: auto; }
    .hint { margin: 0 0 1rem; color: var(--color-neutral-600, #6b7280); font-size: .9rem; }
    .supplier-groups { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: .75rem; }
    .supplier-group { border: 1px solid var(--color-neutral-200, #e5e7eb); border-radius: 8px; overflow: hidden; }
    .supplier-group.has-issue { border-color: #fde68a; background: #fffbeb; }
    .group-header { display: flex; justify-content: space-between; align-items: center; padding: .55rem .85rem; background: var(--color-neutral-50, #f9fafb); font-size: .85rem; }
    .supplier-group.has-issue .group-header { background: #fef3c7; color: #92400e; }
    .supplier-name { display: flex; align-items: center; gap: .4rem; font-weight: 600; color: var(--color-neutral-800, #1f2937); }
    .supplier-group.has-issue .supplier-name { color: #92400e; }
    .group-count { color: var(--color-neutral-500, #6b7280); font-size: .8rem; }
    /* Namespaced (.po-*) so generic global rules (.line/.code/.name/.qty) can't leak in and
       break the layout — the cause of the overlapping rows reported in the bug. */
    .po-lines { list-style: none; margin: 0; padding: .35rem .85rem .55rem; display: flex; flex-direction: column; gap: .3rem; font-size: .85rem; }
    .po-lines-header { display: grid; grid-template-columns: 4.5rem 1fr minmax(9rem, 1.2fr) 5.5rem 5.5rem; gap: .5rem; padding: 0 .1rem .25rem; font-size: .7rem; font-weight: 600; text-transform: uppercase; color: var(--color-neutral-500, #6b7280); border-bottom: 1px solid var(--color-neutral-200, #e5e7eb); }
    .po-line { display: flex; flex-direction: column; gap: .3rem; padding: .15rem 0; min-width: 0; }
    .po-line--unassigned { background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: .4rem .55rem; }
    .po-line__head { display: grid; grid-template-columns: 4.5rem 1fr minmax(9rem, 1.2fr) 5.5rem 5.5rem; align-items: center; gap: .5rem; min-width: 0; }
    .po-code { font-family: monospace; font-size: .75rem; color: var(--color-neutral-500, #6b7280); align-self: center; }
    .po-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; align-self: center; }
    .po-supplier-block { min-width: 0; }
    .po-supplier-field { display: block; margin: 0; min-width: 0; }
    .po-supplier-select { border-color: var(--color-neutral-300, #d1d5db); width: 100%; }
    .po-supplier-select--issue { border-color: #fcd34d; }
    .po-price-block { display: flex; flex-direction: column; align-items: flex-end; gap: .1rem; min-width: 0; }
    .po-price-field { display: block; margin: 0; }
    .po-price-input { width: 4.75rem; padding: .25rem .4rem; border: 1px solid var(--color-neutral-300, #d1d5db); border-radius: 6px; font: inherit; font-variant-numeric: tabular-nums; text-align: end; }
    .po-price-input:focus { outline: 2px solid var(--color-primary-400, #60a5fa); outline-offset: 1px; }
    .po-price-input.invalid { border-color: #f87171; background: #fef2f2; }
    .po-price-suffix { font-size: .65rem; color: var(--color-neutral-500, #6b7280); }
    .po-qty-block { display: flex; flex-direction: column; align-items: flex-end; gap: .1rem; min-width: 0; }
    .po-qty-field { display: block; margin: 0; }
    .po-qty-input { width: 4.5rem; padding: .25rem .4rem; border: 1px solid var(--color-neutral-300, #d1d5db); border-radius: 6px; font: inherit; font-variant-numeric: tabular-nums; font-weight: 600; text-align: end; }
    .po-qty-input:focus { outline: 2px solid var(--color-primary-400, #60a5fa); outline-offset: 1px; }
    .po-qty-input.invalid { border-color: #f87171; background: #fef2f2; }
    .po-rec-hint { font-size: .7rem; color: var(--color-neutral-500, #6b7280); white-space: nowrap; }
    .qty-error { margin: .75rem 0 0; padding: .5rem .75rem; background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; color: #991b1b; font-size: .85rem; }
    .po-bulk-assign { display: flex; align-items: center; gap: .4rem; padding: .5rem .85rem; background: #fffaf0; border-bottom: 1px dashed #fcd34d; color: #92400e; }
    .assign-select, .po-bulk-select { flex: 1 1 auto; min-width: 0; padding: .35rem .5rem; border: 1px solid #fcd34d; border-radius: 6px; font: inherit; background: white; }
    .po-bulk-select { border-color: #f59e0b; font-weight: 500; }
    .assign-select:focus, .po-bulk-select:focus { outline: 2px solid var(--color-primary-400, #60a5fa); outline-offset: 1px; }
    .assign-state { font-size: .8rem; color: #92400e; font-style: italic; }
    .warning { margin-top: 1rem; padding: .75rem 1rem; background: #fef3c7; border: 1px solid #fde68a; border-radius: 6px; color: #92400e; display: flex; gap: .5rem; align-items: flex-start; font-size: .85rem; }
    .state.empty { color: var(--color-neutral-500, #9ca3af); font-style: italic; }
    .modal-footer { display: flex; justify-content: flex-end; gap: .5rem; padding: .75rem 1.25rem 1rem; border-top: 1px solid var(--color-neutral-200, #e5e7eb); }
    .btn { padding: .5rem 1rem; border-radius: 6px; border: 1px solid transparent; cursor: pointer; font-size: .9rem; font-weight: 500; display: inline-flex; align-items: center; gap: .4rem; }
    .btn:disabled { opacity: .55; cursor: not-allowed; }
    .btn-secondary { background: white; border-color: var(--color-neutral-300, #d1d5db); color: var(--color-neutral-800, #1f2937); }
    .btn-secondary:hover:not(:disabled) { background: var(--color-neutral-50, #f9fafb); }
    .btn-primary { background: var(--color-primary-600, #2563eb); color: white; }
    .btn-primary:hover:not(:disabled) { background: var(--color-primary-700, #1e40af); }
  `]
})
export class PreparePoConfirmModalComponent implements OnInit {
  readonly loc_ui_tern_fournisseur_pour_ac3489 = $localize`:@@ui.tern.fournisseur.pour.ac3489:Fournisseur pour `;
  readonly loc_ui_tern_prix_unitaire_ht_pour_083196 = $localize`:@@ui.tern.prix.unitaire.ht.pour.083196:Prix unitaire HT pour `;
  readonly loc_ui_tern_quantite_a_commander_pour_8e4c05 = $localize`:@@ui.tern.quantite.a.commander.pour.8e4c05:Quantité à commander pour `;
  /** Selected recommendations sent in for grouping & confirmation. */
  @Input() set selection(value: ReplenishmentRecommendation[]) {
    const list = value ?? [];
    this._recs.set(list);
    const draft = new Map<string, number>();
    const initial = new Map<string, number>();
    for (const r of list) {
      const raw = r.manualQtyOverride ?? r.recommendedQty;
      const q = QuantityFormatPipe.toEditableQuantity(raw, r.productUnit);
      draft.set(r.id, q);
      initial.set(r.id, q);
    }
    this.qtyDraft.set(draft);
    this.initialQtyById.set(initial);
    const initialSuppliers = new Map<string, string | null>();
    for (const r of list) {
      initialSuppliers.set(r.id, r.manualSupplierOverride ?? r.preferredSupplierId ?? null);
    }
    this.initialSupplierById.set(initialSuppliers);
    this.assignments.set(new Map());
    const priceDraft = new Map<string, number | null>();
    for (const r of list) {
      const suggested = r.suggestedPurchaseUnitPrice;
      priceDraft.set(
        r.id,
        suggested != null && Number.isFinite(suggested) && suggested > 0 ? suggested : null
      );
    }
    this.priceDraft.set(priceDraft);
  }
  get recommendations(): ReplenishmentRecommendation[] { return this._recs(); }

  /** Emits line overrides to persist before create-purchase-orders. */
  @Output() confirm = new EventEmitter<{ lineUpdates: PreparePoLineUpdate[]; linePrices: PreparePoLinePrice[] }>();
  @Output() cancel = new EventEmitter<void>();

  private readonly supplierService = inject(SupplierService);

  private readonly _recs = signal<ReplenishmentRecommendation[]>([]);

  /** Editable order qty per recommendation (initialized from effective qty at open). */
  readonly qtyDraft = signal<Map<string, number>>(new Map());
  /** Editable unit purchase price HT per recommendation. */
  readonly priceDraft = signal<Map<string, number | null>>(new Map());
  /** Snapshot at open — used to detect qty edits without persisting unchanged lines. */
  private readonly initialQtyById = signal<Map<string, number>>(new Map());
  /** Effective supplier at open (manual override > preferred) — used to detect supplier edits. */
  private readonly initialSupplierById = signal<Map<string, string | null>>(new Map());

  /** In-modal supplier choices (recId → supplierId); only user edits are stored here. */
  readonly assignments = signal<Map<string, string>>(new Map());
  readonly suppliers = signal<SupplierListItem[]>([]);
  readonly loadingSuppliers = signal<boolean>(false);

  /** One-shot control state for the "assign one supplier to all unassigned lines" picker. */
  readonly bulkSupplierId = signal<string | null>(null);

  /** Recommendations grouped by effective supplier (in-modal assignment > manual override > preferred). */
  readonly groups = computed<SupplierGroup[]>(() => {
    const assigns = this.assignments();
    const draft = this.qtyDraft();
    const nameById = new Map(this.suppliers().map(s => [s.id, s.name]));
    const grouped = new Map<string | null, SupplierGroup>();
    for (const r of this._recs()) {
      const supplierId = this.effectiveSupplierId(r);
      const supplierName = supplierId === null
        ? $localize`:@@ui.tern.sans.fournisseur.b2a178:Sans fournisseur`
        : (nameById.get(supplierId) ?? r.preferredSupplierName ?? $localize`:@@ui.tern.fournisseur.97d91d:Fournisseur`);
      const existing = grouped.get(supplierId);
      const qty = draft.get(r.id) ?? QuantityFormatPipe.toEditableQuantity(
        r.manualQtyOverride ?? r.recommendedQty,
        r.productUnit
      );
      if (existing) {
        existing.recommendations.push(r);
        existing.totalQty += qty;
      } else {
        grouped.set(supplierId, {
          supplierId,
          trackKey: supplierId ?? 'unassigned',
          supplierName,
          recommendations: [r],
          totalQty: qty
        });
      }
    }
    // Sort: linkable groups first, "no supplier" last.
    return [...grouped.values()].sort((a, b) => {
      if ((a.supplierId === null) === (b.supplierId === null)) {
        return erpCollatorCompare(a.supplierName, b.supplierName);
      }
      return a.supplierId === null ? 1 : -1;
    });
  });

  readonly skippedCount = computed(() =>
    this.groups()
      .filter(g => g.supplierId === null)
      .reduce((sum, g) => sum + g.recommendations.length, 0));

  readonly linkableCount = computed(() => this.groups().filter(g => g.supplierId !== null).length);

  readonly anyQtyInvalid = computed(() =>
    this._recs().some(r => this.qtyInvalidForId(r.id)));

  readonly anyPriceMissing = computed(() =>
    this._recs().some(r => this.effectiveSupplierId(r) !== null && this.priceInvalidForLinkable(r)));

  /** A PO can only be created if at least one line resolves to a supplier and all qtys are valid. */
  readonly canConfirm = computed(() => {
    if (this.linkableCount() <= 0) return false;
    return !this.anyQtyInvalid() && !this.anyPriceMissing();
  });

  ngOnInit(): void {
    void this.loadSuppliers();
  }

  private async loadSuppliers(): Promise<void> {
    this.loadingSuppliers.set(true);
    try {
      // Only active suppliers: the backend silently skips inactive ones (no PO created).
      const res = await firstValueFrom(this.supplierService.getSuppliers({ pageSize: 200, isActive: true }));
      this.suppliers.set(res.data?.items ?? []);
    } catch {
      this.suppliers.set([]);
    } finally {
      this.loadingSuppliers.set(false);
    }
  }

  /** System-resolved supplier at open (manual override > preferred). */
  resolvedSupplierId(r: ReplenishmentRecommendation): string | null {
    return r.manualSupplierOverride ?? r.preferredSupplierId ?? null;
  }

  /** Effective supplier for grouping / PO prep (in-modal choice > resolved). */
  effectiveSupplierId(r: ReplenishmentRecommendation): string | null {
    const assigned = this.assignments().get(r.id);
    if (assigned !== undefined) return assigned;
    return this.resolvedSupplierId(r);
  }

  /** Bound value for the per-line supplier select (avoids ?? in the template). */
  displaySupplierId(r: ReplenishmentRecommendation): string | null {
    return this.effectiveSupplierId(r);
  }

  /** Records (or clears) the in-modal supplier choice for a recommendation. */
  assign(recommendationId: string, supplierId: string | null): void {
    const next = new Map(this.assignments());
    if (supplierId) next.set(recommendationId, supplierId);
    else next.delete(recommendationId);
    this.assignments.set(next);
  }

  /**
   * Bulk action: assign one supplier to every line that still has NO resolvable supplier
   * (no in-modal choice, no manual override, no preferred). Lines already resolved are left
   * untouched. Reuses the same assignments map the per-line picker writes to.
   */
  onBulkAssign(supplierId: string | null): void {
    if (supplierId) {
      const next = new Map(this.assignments());
      for (const r of this._recs()) {
        const current = next.get(r.id) ?? r.manualSupplierOverride ?? r.preferredSupplierId ?? null;
        if (current === null) next.set(r.id, supplierId);
      }
      this.assignments.set(next);
    }
    // One-shot action — reset the picker back to its placeholder.
    this.bulkSupplierId.set(null);
  }

  effectiveQty(r: ReplenishmentRecommendation): number {
    const raw = r.manualQtyOverride ?? r.recommendedQty;
    return QuantityFormatPipe.toEditableQuantity(raw, r.productUnit);
  }

  isDiscreteUnit(r: ReplenishmentRecommendation): boolean {
    return QuantityFormatPipe.isDiscreteUnit(r.productUnit);
  }

  /** Unit passed to qtyFmt for a supplier group total (null when units differ). */
  groupFormatUnit(g: SupplierGroup): string | null {
    const units = g.recommendations.map(r => r.productUnit ?? '');
    const first = units[0];
    return units.every(u => u === first) ? (first || null) : null;
  }

  draftQtyValue(recommendationId: string): number {
    const r = this._recs().find(x => x.id === recommendationId);
    return this.qtyDraft().get(recommendationId) ?? (r ? this.effectiveQty(r) : 0);
  }

  draftPriceValue(recommendationId: string): number | null {
    const v = this.priceDraft().get(recommendationId);
    return v === undefined ? null : v;
  }

  setDraftPrice(recommendationId: string, value: number | string | null): void {
    const parsed = value === null || value === '' ? null : Number(value);
    const normalized = parsed !== null && Number.isFinite(parsed) ? parsed : null;
    const next = new Map(this.priceDraft());
    next.set(recommendationId, normalized);
    this.priceDraft.set(next);
  }

  priceInvalidForLinkable(r: ReplenishmentRecommendation): boolean {
    if (this.effectiveSupplierId(r) === null) return false;
    const v = this.priceDraft().get(r.id);
    return v === undefined || v === null || !Number.isFinite(v) || v <= 0;
  }

  buildLinePrices(): PreparePoLinePrice[] {
    const prices: PreparePoLinePrice[] = [];
    for (const r of this._recs()) {
      if (this.effectiveSupplierId(r) === null) continue;
      const v = this.priceDraft().get(r.id);
      if (v != null && Number.isFinite(v) && v > 0) {
        prices.push({ recommendationId: r.id, unitPrice: v });
      }
    }
    return prices;
  }

  setDraftQty(recommendationId: string, value: number | string | null): void {
    const r = this._recs().find(x => x.id === recommendationId);
    const parsed = value === null || value === '' ? NaN : Number(value);
    const normalized = r && Number.isFinite(parsed)
      ? QuantityFormatPipe.toEditableQuantity(parsed, r.productUnit)
      : parsed;
    const next = new Map(this.qtyDraft());
    next.set(recommendationId, normalized);
    this.qtyDraft.set(next);
  }

  qtyInvalidFor(recommendationId: string): boolean {
    return this.qtyInvalidForId(recommendationId);
  }

  private qtyInvalidForId(recommendationId: string): boolean {
    const v = this.qtyDraft().get(recommendationId);
    return v === undefined || !Number.isFinite(v) || v <= 0;
  }

  /** Builds override payloads for lines with in-modal supplier and/or qty changes. */
  buildLineUpdates(): PreparePoLineUpdate[] {
    const assigns = this.assignments();
    const draft = this.qtyDraft();
    const initialQty = this.initialQtyById();
    const initialSuppliers = this.initialSupplierById();
    const updates: PreparePoLineUpdate[] = [];

    for (const r of this._recs()) {
      const supplierDirty = assigns.has(r.id);
      const rawEffective = r.manualQtyOverride ?? r.recommendedQty;
      const displayEffective = QuantityFormatPipe.toEditableQuantity(rawEffective, r.productUnit);
      const finalQty = draft.get(r.id) ?? displayEffective;
      const initialQtyVal = initialQty.get(r.id) ?? displayEffective;
      const qtyDirty = finalQty !== initialQtyVal;
      const needsRoundingPersist = displayEffective !== rawEffective && finalQty === displayEffective;
      if (!supplierDirty && !qtyDirty && !needsRoundingPersist) continue;

      let manualQty: number | null;
      if (qtyDirty || needsRoundingPersist) {
        manualQty = finalQty === r.recommendedQty && !needsRoundingPersist ? null : finalQty;
      } else {
        manualQty = r.manualQtyOverride ?? null;
      }

      let manualSupplierId: string | null;
      if (supplierDirty) {
        const chosen = assigns.get(r.id) ?? null;
        const preferred = r.preferredSupplierId ?? null;
        manualSupplierId = chosen === preferred || chosen === null ? null : chosen;
      } else {
        manualSupplierId = r.manualSupplierOverride ?? null;
      }

      updates.push({ recommendationId: r.id, manualQty, manualSupplierId });
    }
    return updates;
  }

  onConfirm(): void {
    if (!this.canConfirm()) return;
    this.confirm.emit({
      lineUpdates: this.buildLineUpdates(),
      linePrices: this.buildLinePrices()
    });
  }

  onCancel(): void { this.cancel.emit(); }

  @HostListener('document:keydown.escape')
  onEscape(): void { this.onCancel(); }
}
