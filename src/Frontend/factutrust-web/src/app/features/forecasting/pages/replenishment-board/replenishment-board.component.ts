/// <reference types="@angular/localize" />
import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ToastService } from '@core/services/toast.service';
import { AuthService } from '@core/services/auth.service';
import { ForecastingService } from '../../services/forecasting.service';
import {
  CreatePurchaseOrdersResult,
  ReplenishmentKpi,
  ReplenishmentRecommendation,
  ReplenishmentUrgency,
  ReplenishmentFilters
} from '../../models/forecasting.models';
import { AnalyzeWithAiButtonComponent } from '@features/ai-assistant/components/analyze-with-ai-button/analyze-with-ai-button.component';
import { wrapLegacyAnalyzePayload } from '@features/ai-assistant/utils/ai-screen-payload.factory';
import { ProductDemandModalComponent } from '../../components/product-demand-modal/product-demand-modal.component';
import { DismissReasonModalComponent } from '../../components/dismiss-reason-modal/dismiss-reason-modal.component';
import { PreparePoConfirmModalComponent, PreparePoLineUpdate } from '../../components/prepare-po-confirm-modal/prepare-po-confirm-modal.component';
import { OverrideQuantityModalComponent } from '../../components/override-quantity-modal/override-quantity-modal.component';
import { DecisionHistoryModalComponent } from '../../components/decision-history-modal/decision-history-modal.component';
import { ReplenishmentKpiBarComponent } from './replenishment-kpi-bar/replenishment-kpi-bar.component';
import { ReplenishmentFiltersComponent } from './replenishment-filters/replenishment-filters.component';
import { ReasonCodePipe } from '../../pipes/reason-code.pipe';
import { QuantityFormatPipe } from '../../pipes/quantity-format.pipe';
import { ReplenishmentExportService } from '../../services/replenishment-export.service';

/**
 * V2 Replenishment Board (gated by Features:Forecasting:ReplenishmentV2:Enabled).
 *
 * Highlights versus V1:
 *   • Filters: warehouse + supplier + status + urgency + search + date range.
 *   • Pagination (server-side, paged total exposed).
 *   • Column sort (rop / qty / days of stock / generatedAt).
 *   • Bulk approve / dismiss / create-PO with confirmation modal regrouping by supplier.
 *   • Dismiss now demands a structured reason (modal — fix F-M7).
 *   • Override quantity & supplier per row (modal).
 *   • Decision history timeline (modal — fix F-M18).
 *   • Days-of-stock + urgency badge per row.
 *   • Linked PO clickable when status = Ordered (fix F-C1 visible feedback).
 *   • CSV export (fix F-M13).
 *   • KPI bar with service-level / stock-out / value-to-order (E-13).
 *   • OnPush change detection + signals.
 *
 * The component never modifies the underlying calculation — it consumes the deterministic
 * V2 endpoints. All ROP / qty / safety stock values come from the server.
 */
@Component({
  selector: 'app-replenishment-board',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    AnalyzeWithAiButtonComponent,
    ProductDemandModalComponent,
    DismissReasonModalComponent,
    PreparePoConfirmModalComponent,
    OverrideQuantityModalComponent,
    DecisionHistoryModalComponent,
    ReplenishmentKpiBarComponent,
    ReplenishmentFiltersComponent,
    ReasonCodePipe,
    QuantityFormatPipe
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './replenishment-board.component.html',
  styleUrls: ['./replenishment-board.component.scss']
})
export class ReplenishmentBoardComponent implements OnInit {
  private readonly forecastingService = inject(ForecastingService);
  private readonly exportService = inject(ReplenishmentExportService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  readonly filters = signal<ReplenishmentFilters>({});
  readonly rows = signal<ReplenishmentRecommendation[]>([]);
  readonly totalCount = signal(0);
  readonly page = signal(1);
  readonly pageSize = signal(50);
  readonly loading = signal(false);
  readonly generating = signal(false);
  readonly exporting = signal(false);
  /** Phase 5 review P5-m1: disables bulk action buttons while their HTTP requests are in flight. */
  readonly bulkActionInFlight = signal(false);
  readonly selectedIds = signal<Set<string>>(new Set());
  readonly sortBy = signal<'generatedAt' | 'rop' | 'qty' | 'days'>('generatedAt');
  readonly sortDesc = signal(true);

  /** KPI snapshot — refreshed alongside the list (best-effort, never blocking). */
  readonly kpi = signal<ReplenishmentKpi | null>(null);

  /** Modal slots: only one of each is non-null at a time. */
  readonly demandModal = signal<{ productId: string; productName: string } | null>(null);
  readonly dismissModal = signal<{ rec: ReplenishmentRecommendation } | null>(null);
  readonly preparePoModal = signal<{ selection: ReplenishmentRecommendation[] } | null>(null);
  readonly overrideModal = signal<{ rec: ReplenishmentRecommendation } | null>(null);
  readonly historyModal = signal<{ rec: ReplenishmentRecommendation } | null>(null);

  readonly canManage = computed(() => this.auth.hasAllPermissions(['forecasting:manage']));

  readonly selectionCount = computed(() => this.selectedIds().size);

  /** Subset of <c>rows()</c> currently checked in the UI. */
  readonly selectedRows = computed(() => {
    const ids = this.selectedIds();
    return this.rows().filter(r => ids.has(r.id));
  });

  readonly allRowsSelected = computed(() => {
    const total = this.rows().length;
    return total > 0 && this.selectedIds().size === total;
  });

  readonly someRowsSelected = computed(() => {
    const sel = this.selectedIds().size;
    return sel > 0 && sel < this.rows().length;
  });

  readonly pageCount = computed(() => Math.max(1, Math.ceil(this.totalCount() / this.pageSize())));

  /** Payload sent to the AI Analyze button — sample of first 20 rows for context. */
  readonly buildAiPayload = (): unknown =>
    wrapLegacyAnalyzePayload(
      'forecasting-replenishment',
      {
        screen: 'forecasting-replenishment',
        filters: this.filters(),
        totalRows: this.totalCount(),
        rows: this.rows().slice(0, 20).map(r => ({
          product: r.productName,
          code: r.productCode,
          warehouse: r.warehouseName,
          supplier: r.preferredSupplierName,
          stock: r.currentStockOnHand,
          onOrder: r.quantityOnOrder,
          effective: r.effectiveQty,
          rop: r.rop,
          recommendedQty: r.recommendedQty,
          daysOfStockRemaining: r.daysOfStockRemaining,
          leadTimeDays: r.leadTimeDays,
          reasonCodes: r.reasonCodes,
          urgencyLevel: r.urgencyLevel,
          status: r.status
        }))
      } as Record<string, unknown>,
      { maxRows: 200 }
    );

  ngOnInit(): void {
    // The filters component emits its initial state in ngOnInit which triggers our first load.
    this.forecastingService.recomputeCompleted$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        void this.load();
        void this.refreshKpi();
      });
  }

  // ─────────────────────────────── Loading ────────────────────────────────

  onFiltersChange(filters: ReplenishmentFilters): void {
    this.filters.set(filters);
    this.page.set(1);
    this.selectedIds.set(new Set());
    void this.load();
    void this.refreshKpi();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const paged = await firstValueFrom(this.forecastingService.getReplenishment({
        ...this.filters(),
        page: this.page(),
        pageSize: this.pageSize(),
        orderBy: this.sortBy(),
        orderDesc: this.sortDesc()
      }));
      this.rows.set(paged.items);
      this.totalCount.set(paged.totalCount);
    } catch (err: any) {
      this.toast.add({
        severity: 'error',
        summary: $localize`:@@replenishment-board.component.summary.Erreur:Erreur`,
        detail: err?.error?.message ?? $localize`:@@ui.tern.chargement.des.recommandations.echoue.ba9b44:Chargement des recommandations échoué.`
      });
    } finally {
      this.loading.set(false);
    }
  }

  async refreshKpi(): Promise<void> {
    try {
      const kpi = await firstValueFrom(
        this.forecastingService.getReplenishmentKpi(this.filters().warehouseId ?? null)
      );
      this.kpi.set(kpi);
    } catch {
      this.kpi.set(null);
    }
  }

  // ───────────────────────────── Selection ────────────────────────────────

  isSelected(id: string): boolean {
    return this.selectedIds().has(id);
  }

  toggleSelected(id: string): void {
    const next = new Set(this.selectedIds());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.selectedIds.set(next);
  }

  toggleSelectAll(): void {
    const allIds = this.rows().map(r => r.id);
    const next = this.allRowsSelected() ? new Set<string>() : new Set(allIds);
    this.selectedIds.set(next);
  }

  // ──────────────────────────── Sort & paging ─────────────────────────────

  toggleSort(column: 'generatedAt' | 'rop' | 'qty' | 'days'): void {
    if (this.sortBy() === column) {
      this.sortDesc.update(v => !v);
    } else {
      this.sortBy.set(column);
      this.sortDesc.set(true);
    }
    void this.load();
  }

  goToPage(p: number): void {
    if (p < 1 || p > this.pageCount() || p === this.page()) return;
    this.page.set(p);
    this.selectedIds.set(new Set());
    void this.load();
  }

  // ───────────────────────── Single-row actions ───────────────────────────

  openProductDemand(r: ReplenishmentRecommendation): void {
    this.demandModal.set({ productId: r.productId, productName: r.productName });
  }

  /**
   * Phase 6 review P6-m1: refresh the board after a product-scoped regeneration so the user
   * immediately sees the new recommendation(s) without a manual reload.
   */
  onProductRegenerated(): void {
    void this.load();
    void this.refreshKpi();
  }

  openDismissModal(r: ReplenishmentRecommendation): void {
    this.dismissModal.set({ rec: r });
  }

  async onDismissConfirmed(reason: string): Promise<void> {
    const rec = this.dismissModal()?.rec;
    if (!rec) return;
    this.dismissModal.set(null);
    try {
      await firstValueFrom(this.forecastingService.dismissReplenishment(rec.id, reason));
      this.toast.add({ severity: 'info', summary: $localize`:@@replenishment-board.component.summary.Écartée:Écartée`, detail: `${rec.productName} écartée.` });
      this.rows.update(rows => rows.filter(x => x.id !== rec.id));
      this.unselect(rec.id);
      void this.refreshKpi();
    } catch (err: any) {
      this.toast.add({
        severity: 'error',
        summary: $localize`:@@replenishment-board.component.summary.Échec:Échec`,
        detail: err?.error?.message ?? $localize`:@@ui.tern.le.rejet.a.echoue.c3d6a3:Le rejet a échoué.`
      });
    }
  }

  async approve(r: ReplenishmentRecommendation): Promise<void> {
    try {
      await firstValueFrom(this.forecastingService.approveReplenishment(r.id));
      // Phase 5 review P5-M3: drop the row from the selection so the bulk-action counter stays in sync.
      this.unselect(r.id);
      this.toast.add({
        severity: 'success',
        summary: $localize`:@@replenishment-board.component.summary.Approuvée:Approuvée`,
        detail: `${r.productName} approuvée.`
      });
      // If the current filter is "pending", the row exits the view immediately.
      if (this.filters().status === 'pending') {
        this.rows.update(rows => rows.filter(x => x.id !== r.id));
        this.unselect(r.id);
      } else {
        // Otherwise refresh the row.
        this.rows.update(rows => rows.map(x => x.id === r.id ? { ...x, status: 'approved' } : x));
      }
      void this.refreshKpi();
    } catch (err: any) {
      this.toast.add({
        severity: 'error',
        summary: $localize`:@@replenishment-board.component.summary.Échec:Échec`,
        detail: err?.error?.message ?? $localize`:@@ui.tern.approbation.echouee.b12630:Approbation échouée.`
      });
    }
  }

  openOverrideModal(r: ReplenishmentRecommendation): void {
    this.overrideModal.set({ rec: r });
  }

  async onOverrideConfirmed(payload: { manualQty: number | null; manualSupplierId: string | null }): Promise<void> {
    const rec = this.overrideModal()?.rec;
    if (!rec) return;
    this.overrideModal.set(null);
    try {
      const updated = await firstValueFrom(this.forecastingService.overrideReplenishment(rec.id, payload));
      this.toast.add({
        severity: 'success',
        summary: $localize`:@@replenishment-board.component.summary.Modifié:Modifié`,
        detail: `${rec.productName} mis à jour.`
      });
      this.rows.update(rows => rows.map(x => x.id === updated.id ? updated : x));
    } catch (err: any) {
      this.toast.add({
        severity: 'error',
        summary: $localize`:@@replenishment-board.component.summary.Échec:Échec`,
        detail: err?.error?.message ?? $localize`:@@ui.tern.la.modification.a.echoue.5f6a29:La modification a échoué.`
      });
    }
  }

  async undo(r: ReplenishmentRecommendation): Promise<void> {
    try {
      const updated = await firstValueFrom(this.forecastingService.undoReplenishment(r.id));
      this.toast.add({
        severity: 'success',
        summary: $localize`:@@replenishment-board.component.summary.Annul_e:Annulée`,
        detail: `Décision sur ${r.productName} annulée.`
      });
      this.rows.update(rows => rows.map(x => x.id === updated.id ? updated : x));
      void this.refreshKpi();
    } catch (err: any) {
      this.toast.add({
        severity: 'error',
        summary: $localize`:@@replenishment-board.component.summary.Annulation_impos:Annulation impossible`,
        detail: err?.error?.message ?? $localize`:@@ui.tern.l.annulation.a.echoue.47819e:L'annulation a échoué.`
      });
    }
  }

  openHistoryModal(r: ReplenishmentRecommendation): void {
    this.historyModal.set({ rec: r });
  }

  // ───────────────────────── Bulk actions ─────────────────────────────────

  async bulkApprove(): Promise<void> {
    const all = this.selectedRows();
    const targets = all.filter(r => r.status === 'pending');
    const ignored = all.length - targets.length;

    // Phase 5 review P5-M1: surface the count of rows ignored so the user knows the action is partial.
    if (ignored > 0) {
      this.toast.add({
        severity: 'info',
        summary: $localize`:@@replenishment-board.component.summary.S_lection_partie:Sélection partielle`,
        detail: `${ignored} recommandation(s) déjà traitée(s) (non-Pending) seront ignorée(s).`
      });
    }
    if (targets.length === 0) return;

    this.bulkActionInFlight.set(true);
    try {
      // Phase 5 review P5-M2: Promise.allSettled — never abort the whole batch on the first 4xx
      // and report exact success / failure counts back to the user.
      const results = await Promise.allSettled(targets.map(r =>
        firstValueFrom(this.forecastingService.approveReplenishment(r.id))
      ));
      const ok = results.filter(r => r.status === 'fulfilled').length;
      const ko = results.length - ok;

      if (ok > 0 && ko === 0) {
        this.toast.add({
          severity: 'success',
          summary: $localize`:@@replenishment-board.component.summary.Approbations:Approbations`,
          detail: `${ok} recommandation(s) approuvée(s).`
        });
      } else if (ok > 0 && ko > 0) {
        this.toast.add({
          severity: 'warn',
          summary: $localize`:@@replenishment-board.component.summary.Approbations_par:Approbations partielles`,
          detail: `${ok} approuvée(s), ${ko} en échec.`,
          life: 6000
        });
      } else {
        this.toast.add({
          severity: 'error',
          summary: $localize`:@@replenishment-board.component.summary.Échec:Échec`,
          detail: `Aucune approbation n'a réussi (${ko} échec(s)).`
        });
      }
    } finally {
      this.bulkActionInFlight.set(false);
      await this.load();
      void this.refreshKpi();
    }
  }

  openPreparePoModal(): void {
    const targets = this.selectedRows().filter(r => r.status === 'pending' || r.status === 'approved');
    if (targets.length === 0) {
      this.toast.add({
        severity: 'warn',
        summary: $localize`:@@replenishment-board.component.summary.S_lection_vide:Sélection vide`,
        detail: $localize`:@@replenishment-board.component.detail.Aucune_recommand:Aucune recommandation éligible (statut Pending ou Approved) dans la sélection.`
      });
      return;
    }
    this.preparePoModal.set({ selection: targets });
  }

  async onPreparePoConfirmed(payload: { lineUpdates: PreparePoLineUpdate[]; linePrices: { recommendationId: string; unitPrice: number }[] }): Promise<void> {
    const targets = this.preparePoModal()?.selection ?? [];
    this.preparePoModal.set(null);
    if (targets.length === 0) return;

    const lineUpdates = payload?.lineUpdates ?? [];
    this.bulkActionInFlight.set(true);
    try {
      // ── Step 1: persist in-modal qty / supplier overrides (PO lines use effective qty). ──
      if (lineUpdates.length > 0) {
        const overrideResults = await Promise.allSettled(lineUpdates.map(u =>
          firstValueFrom(this.forecastingService.overrideReplenishment(u.recommendationId, {
            manualQty: u.manualQty,
            manualSupplierId: u.manualSupplierId
          }))
        ));
        const failed = overrideResults.filter(r => r.status === 'rejected').length;
        if (failed > 0) {
          this.toast.add({
            severity: 'warn',
            summary: $localize`:@@replenishment-board.component.summary.Enregistrement_p:Enregistrement partiel`,
            detail: `${failed} ligne(s) : quantité ou fournisseur non enregistré(s) — vérifiez avant de renvoyer.`,
            life: 6000
          });
        }
      }

      // ── Step 2: create the draft POs (backend builds them for resolved suppliers and
      //            reports which recommendations it could not link). ──
      const result: CreatePurchaseOrdersResult = await firstValueFrom(
        this.forecastingService.createPurchaseOrdersFromReplenishment(
          targets.map(r => r.id),
          payload.linePrices ?? []
        )
      );

      const unlinkedCount = result.unlinkedRecommendationIds?.length ?? 0;
      const detail = result.createdPurchaseOrdersCount === 0
        ? (unlinkedCount > 0
            ? $localize`:@@ui.tern.aucun.bc.cree.ph.recommandation.s.sans.fou.7efa06:Aucun BC créé : ${unlinkedCount}:p0: recommandation(s) sans fournisseur. Assignez un fournisseur puis réessayez.`
            : $localize`:@@ui.tern.aucun.bc.cree.verifiez.les.avertissements.9603df:Aucun BC créé. Vérifiez les avertissements.`)
        : $localize`:@@ui.tern.ph.bc.cree.s.ph.recommandation.s.liee.s.9328d1:${result.createdPurchaseOrdersCount}:p0: BC créé(s), ${result.linkedRecommendationsCount}:p1: recommandation(s) liée(s).`;
      this.toast.add({
        severity: result.createdPurchaseOrdersCount === 0 ? 'warn' : 'success',
        summary: $localize`:@@replenishment-board.component.summary.Bons_de_commande:Bons de commande`,
        detail,
        life: 8000
      });
      // Surface backend warnings (recos without supplier, etc.)
      for (const w of result.warnings ?? []) {
        this.toast.add({ severity: 'warn', summary: $localize`:@@replenishment-board.component.summary.Avertissement:Avertissement`, detail: w, life: 6000 });
      }
      this.selectedIds.set(new Set());
      await this.load();
      void this.refreshKpi();
    } catch (err: any) {
      this.toast.add({
        severity: 'error',
        summary: $localize`:@@replenishment-board.component.summary.Échec:Échec`,
        detail: err?.error?.message ?? $localize`:@@ui.tern.la.creation.des.bons.de.commande.a.echoue.b14709:La création des bons de commande a échoué.`
      });
    } finally {
      this.bulkActionInFlight.set(false);
    }
  }

  // ───────────────────────── Generation & export ─────────────────────────

  async generateNow(): Promise<void> {
    this.generating.set(true);
    try {
      const count = await firstValueFrom(
        this.forecastingService.generateReplenishment(this.filters().warehouseId ?? null, null)
      );
      this.toast.add({
        severity: 'success',
        summary: $localize`:@@replenishment-board.component.summary.R_g_n_ration_ter:Régénération terminée`,
        detail: `${count} recommandation(s).`
      });
      await this.load();
      void this.refreshKpi();
    } catch (err: any) {
      this.toast.add({
        severity: 'error',
        summary: $localize`:@@replenishment-board.component.summary.Échec:Échec`,
        detail: err?.error?.message ?? $localize`:@@ui.tern.la.regeneration.a.echoue.2e1fcb:La régénération a échoué.`
      });
    } finally {
      this.generating.set(false);
    }
  }

  async exportCsv(): Promise<void> {
    this.exporting.set(true);
    try {
      const fileName = await this.exportService.downloadCsv(this.filters());
      this.toast.add({
        severity: 'success',
        summary: $localize`:@@replenishment-board.component.summary.Export:Export`,
        detail: `Fichier ${fileName} téléchargé.`
      });
    } catch (err: any) {
      this.toast.add({
        severity: 'error',
        summary: $localize`:@@replenishment-board.component.summary.Export échou:Export échoué`,
        detail: err?.error?.message ?? $localize`:@@ui.tern.le.telechargement.csv.a.echoue.1e13c1:Le téléchargement CSV a échoué.`
      });
    } finally {
      this.exporting.set(false);
    }
  }

  // ────────────────────────── UI helpers (template) ───────────────────────

  statusLabel(s: ReplenishmentRecommendation['status']): string {
    return ({
      pending: 'En attente',
      approved: 'Approuvée',
      dismissed: 'Écartée',
      ordered: 'Commandée',
      superseded: 'Remplacée'
    } as Record<string, string>)[s] ?? s;
  }

  urgencyClass(level: ReplenishmentUrgency): string {
    return `urg-${level.toLowerCase()}`;
  }

  urgencyLabel(level: ReplenishmentUrgency): string {
    switch (level) {
      case 'OutOfStock': return 'Rupture';
      case 'Urgent':     return 'Urgent';
      case 'Warning':    return 'Attention';
      case 'Normal':     return 'Normal';
    }
  }

  trackById(_: number, r: ReplenishmentRecommendation): string { return r.id; }

  /**
   * Skip-link handler — moves keyboard focus to the table heading.
   * Implements WCAG 2.4.1 "Bypass Blocks".
   */
  jumpToTable(): void {
    const table = document.getElementById('repl-table');
    if (!table) return;
    if (!table.hasAttribute('tabindex')) table.setAttribute('tabindex', '-1');
    (table as HTMLElement).focus({ preventScroll: false });
  }

  private unselect(id: string): void {
    const next = new Set(this.selectedIds());
    next.delete(id);
    this.selectedIds.set(next);
  }
}
