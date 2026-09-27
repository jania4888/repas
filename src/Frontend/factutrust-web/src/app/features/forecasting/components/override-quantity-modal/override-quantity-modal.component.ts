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
import { firstValueFrom } from 'rxjs';
import { ReplenishmentRecommendation } from '../../models/forecasting.models';
import { QuantityFormatPipe } from '../../pipes/quantity-format.pipe';
import { FocusTrapDirective } from '../../directives/focus-trap.directive';
import { SupplierService, SupplierListItem } from '@core/services/supplier.service';

/**
 * Modal allowing the user to override the recommended quantity and/or supplier of a single
 * recommendation before approval. Inputs default to existing values (manual override or
 * algorithmic ones). Submitting an empty form clears overrides (same semantics as the API).
 *
 * The modal loads the supplier list lazily (one fetch on open) so the V1 V1 board is not
 * impacted when this feature is unused.
 */
@Component({
  selector: 'app-override-quantity-modal',
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
        aria-labelledby="override-modal-title">
        <header class="modal-header">
          <div>
            <h3 id="override-modal-title" i18n="@@forecasting.components.modifier.la.recommandation.c7fec7a3">Modifier la recommandation</h3>
            <span class="modal-subtitle" *ngIf="recommendation">
              {{ recommendation.productCode }} — {{ recommendation.productName }}
            </span>
          </div>
          <button class="close-btn" type="button" (click)="onCancel()" aria-label="Fermer" i18n-aria-label="@@forecasting.components.fermer.5ab4ec64">
            <i class="pi pi-times" aria-hidden="true"></i>
          </button>
        </header>

        <div class="modal-body">
          @if (recommendation; as r) {
            <div class="summary">
              <div class="kpi">
                <span class="label" i18n="@@forecasting.components.quantite.recommandee.3a361a88">Quantité recommandée</span>
                <span class="value">{{ r.recommendedQty | qtyFmt: r.productUnit }} u.</span>
              </div>
              <div class="kpi">
                <span class="label" i18n="@@forecasting.components.stock.actuel.294a897a">Stock actuel</span>
                <span class="value">{{ r.currentStockOnHand | qtyFmt: r.productUnit }} u.</span>
              </div>
              <div class="kpi">
                <span class="label" i18n="@@forecasting.components.en.commande.38fc4924">En commande</span>
                <span class="value">{{ r.quantityOnOrder | qtyFmt: r.productUnit }} u.</span>
              </div>
            </div>

            <label class="field">
              <span class="field-label" i18n="@@forecasting.components.quantite.manuelle.a4f7596b">Quantité manuelle</span>
              <input
                type="number"
                min="0"
                step="any"
                [(ngModel)]="qtyInput"
                (ngModelChange)="qtyInput.set($event)"
                placeholder="Laisser vide pour conserver la quantité recommandée" i18n-placeholder="@@forecasting.components.laisser.vide.pour.conserver.la.quantite.recomman.04dec656" />
              <small class="hint" i18n="@@forecasting.components.doit.etre.0.vide.utiliser.u.f739ed25">Doit être &gt; 0. Vide = utiliser {{ r.recommendedQty | qtyFmt: r.productUnit }} u.</small>
            </label>

            <label class="field">
              <span class="field-label" i18n="@@forecasting.components.fournisseur.97d91d89">Fournisseur</span>
              @if (loadingSuppliers()) {
                <span class="state" i18n="@@forecasting.components.chargement.des.fournisseurs.fc55800e">Chargement des fournisseurs…</span>
              } @else {
                <select [(ngModel)]="supplierIdInput" (ngModelChange)="supplierIdInput.set($event)">
                  <option [ngValue]="null" i18n="@@forecasting.components.prefere.ou.aucun.7577867f">— Préféré (ou aucun) —</option>
                  @for (s of suppliers(); track s.id) {
                    <option [ngValue]="s.id">{{ s.name }}</option>
                  }
                </select>
              }
              @if (r.preferredSupplierName) {
                <small class="hint" i18n="@@forecasting.components.prefere.36977a03">Préféré : {{ r.preferredSupplierName }}</small>
              }
            </label>

            @if (qtyInvalid()) {
              <p class="error" role="alert" i18n="@@forecasting.components.la.quantite.manuelle.doit.etre.un.nombre.gt.0.67c6c68b">La quantité manuelle doit être un nombre &gt; 0.</p>
            }
          }
        </div>

        <footer class="modal-footer">
          <button class="btn btn-secondary" type="button" (click)="onCancel()" i18n="@@forecasting.components.annuler.49ba3292">Annuler</button>
          <button
            class="btn btn-primary"
            type="button"
            (click)="onConfirm()"
            [disabled]="qtyInvalid()" i18n="@@forecasting.components.enregistrer.6c57ce9b">
            <i class="pi pi-check" aria-hidden="true"></i>
            Enregistrer
          </button>
        </footer>
      </div>
    </div>
  `,
  styles: [`
    .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 1rem; }
    .modal-panel { background: white; border-radius: 10px; width: 100%; max-width: 480px; box-shadow: 0 20px 60px rgba(0,0,0,.18); display: flex; flex-direction: column; max-height: 90vh; }
    .modal-header { display: flex; justify-content: space-between; align-items: flex-start; padding: 1.25rem 1.25rem .75rem; border-bottom: 1px solid var(--color-neutral-200, #e5e7eb); }
    .modal-header h3 { margin: 0 0 .15rem; font-size: 1.1rem; font-weight: 600; color: var(--color-neutral-900, #111827); }
    .modal-subtitle { font-size: .8rem; color: var(--color-neutral-500, #9ca3af); }
    .close-btn { background: none; border: none; cursor: pointer; padding: .25rem .5rem; color: var(--color-neutral-400, #9ca3af); font-size: 1.1rem; }
    .modal-body { padding: 1rem 1.25rem; overflow-y: auto; }
    .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: .5rem; margin-bottom: 1rem; }
    .kpi { background: var(--color-neutral-50, #f9fafb); border: 1px solid var(--color-neutral-200, #e5e7eb); border-radius: 6px; padding: .5rem .65rem; text-align: center; }
    .kpi .label { display: block; font-size: .7rem; text-transform: uppercase; color: var(--color-neutral-500, #9ca3af); margin-bottom: .15rem; letter-spacing: .04em; }
    .kpi .value { display: block; font-size: 1rem; font-weight: 600; color: var(--color-neutral-900, #111827); font-variant-numeric: tabular-nums; }
    .field { display: flex; flex-direction: column; gap: .35rem; margin-bottom: 1rem; font-size: .9rem; }
    .field-label { color: var(--color-neutral-700, #374151); font-weight: 500; }
    .field input, .field select { padding: .5rem .65rem; border: 1px solid var(--color-neutral-300, #d1d5db); border-radius: 6px; font: inherit; }
    .field input:focus, .field select:focus { outline: 2px solid var(--color-primary-400, #60a5fa); outline-offset: 1px; }
    .hint { color: var(--color-neutral-500, #9ca3af); font-size: .75rem; }
    .state { color: var(--color-neutral-500, #9ca3af); font-style: italic; }
    .error { margin: 0; padding: .5rem .75rem; background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; color: #991b1b; font-size: .85rem; }
    .modal-footer { display: flex; justify-content: flex-end; gap: .5rem; padding: .75rem 1.25rem 1rem; border-top: 1px solid var(--color-neutral-200, #e5e7eb); }
    .btn { padding: .5rem 1rem; border-radius: 6px; border: 1px solid transparent; cursor: pointer; font-size: .9rem; font-weight: 500; display: inline-flex; align-items: center; gap: .4rem; }
    .btn:disabled { opacity: .55; cursor: not-allowed; }
    .btn-secondary { background: white; border-color: var(--color-neutral-300, #d1d5db); color: var(--color-neutral-800, #1f2937); }
    .btn-secondary:hover:not(:disabled) { background: var(--color-neutral-50, #f9fafb); }
    .btn-primary { background: var(--color-primary-600, #2563eb); color: white; }
    .btn-primary:hover:not(:disabled) { background: var(--color-primary-700, #1e40af); }
  `]
})
export class OverrideQuantityModalComponent implements OnInit {
  @Input({ required: true }) recommendation!: ReplenishmentRecommendation;

  @Output() confirm = new EventEmitter<{ manualQty: number | null; manualSupplierId: string | null }>();
  @Output() cancel = new EventEmitter<void>();

  private readonly supplierService = inject(SupplierService);

  readonly qtyInput = signal<number | null>(null);
  readonly supplierIdInput = signal<string | null>(null);
  readonly suppliers = signal<SupplierListItem[]>([]);
  readonly loadingSuppliers = signal<boolean>(false);

  readonly qtyInvalid = computed(() => {
    const v = this.qtyInput();
    if (v === null || v === undefined) return false; // empty → keep recommended qty
    return !isFinite(v) || v <= 0;
  });

  ngOnInit(): void {
    if (this.recommendation) {
      this.qtyInput.set(this.recommendation.manualQtyOverride ?? null);
      this.supplierIdInput.set(this.recommendation.manualSupplierOverride ?? null);
    }
    void this.loadSuppliers();
  }

  private async loadSuppliers(): Promise<void> {
    this.loadingSuppliers.set(true);
    try {
      const res = await firstValueFrom(this.supplierService.getSuppliers({ pageSize: 200 }));
      this.suppliers.set(res.data?.items ?? []);
    } catch {
      this.suppliers.set([]);
    } finally {
      this.loadingSuppliers.set(false);
    }
  }

  onConfirm(): void {
    if (this.qtyInvalid()) return;
    this.confirm.emit({
      manualQty: this.qtyInput(),
      manualSupplierId: this.supplierIdInput()
    });
  }

  onCancel(): void { this.cancel.emit(); }

  @HostListener('document:keydown.escape')
  onEscape(): void { this.onCancel(); }
}
