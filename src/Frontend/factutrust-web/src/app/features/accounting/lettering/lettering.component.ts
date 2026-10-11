/// <reference types="@angular/localize" />
import { Component, OnInit, computed, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { DocumentActionsMenuComponent } from '@shared/components/document-actions-menu/document-actions-menu.component';
import { MenuItem } from '@shared/models/menu-item.model';
import { ConfirmationService } from '@core/services/confirmation.service';
import { AccountingToolbarActionsComponent } from '../shared/accounting-toolbar-actions.component';
import { AccountingCorrectionBannerComponent } from '../shared/accounting-correction-banner.component';
import { AccountingFeatureFlagsService } from '../shared/accounting-feature-flags.service';
import { LetteringStore } from './store/lettering.store';
import { LetteringFiltersComponent } from './components/lettering-filters/lettering-filters.component';
import { LetteringLedgerPaneComponent } from './components/lettering-ledger-pane/lettering-ledger-pane.component';
import { LetteringSelectionSummaryComponent } from './components/lettering-selection-summary/lettering-selection-summary.component';
import { LetteringSettleExchangeDialogComponent } from './components/lettering-settle-exchange-dialog/lettering-settle-exchange-dialog.component';
import { LetteringGroupDrawerComponent } from './components/lettering-group-drawer/lettering-group-drawer.component';
import { LETTERING_FUNCTIONAL_CURRENCY } from './models/lettering.models';
import { parseLetteringQueryParams, serializeLetteringFilters } from './utils/lettering-query-params';
import { sideCounts } from './utils/lettering-selection';
import { buildLetteringAnalyzePayload } from './utils/lettering-ai-payload';

/**
 * Écran de lettrage (Phase 2). Pur conteneur : fournit le `LetteringStore` (`providers`,
 * pas `providedIn: 'root'`, suivant le patron `EntryFormStore`) et relie les composants « bêtes »
 * (filtres, deux volets, synthèse, modale d'équilibrage, tiroir de groupe) à ses signaux.
 */
@Component({
  selector: 'app-lettering',
  standalone: true,
  imports: [
    CommonModule,
    PageHeaderComponent,
    EmptyStateComponent,
    DocumentActionsMenuComponent,
    AccountingToolbarActionsComponent,
    AccountingCorrectionBannerComponent,
    LetteringFiltersComponent,
    LetteringLedgerPaneComponent,
    LetteringSelectionSummaryComponent,
    LetteringSettleExchangeDialogComponent,
    LetteringGroupDrawerComponent
  ],
  providers: [LetteringStore],
  templateUrl: './lettering.component.html',
  styleUrl: './lettering.component.scss'
})
export class LetteringComponent implements OnInit {
  protected readonly store = inject(LetteringStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly confirmation = inject(ConfirmationService);
  protected readonly flags = inject(AccountingFeatureFlagsService);

  accountHint = '';
  settleOpen = false;
  groupDrawerOpen = false;

  readonly sideCounts = computed(() => sideCounts(this.store.selectedLines()));

  /** La colonne Devise n'apparaît que si le compte porte au moins une opération en devise. */
  readonly hasForeignLines = computed(() =>
    this.store.lines().some(l => l.currency !== LETTERING_FUNCTIONAL_CURRENCY)
  );

  readonly debitSelectedIds = computed(
    () => new Set(this.store.debitLines().filter(l => this.store.isSelected(l.lineId)).map(l => l.lineId))
  );
  readonly creditSelectedIds = computed(
    () => new Set(this.store.creditLines().filter(l => this.store.isSelected(l.lineId)).map(l => l.lineId))
  );

  readonly actionsMenuItems = computed<MenuItem[]>(() => [
    {
      label: $localize`:@@accounting.lettering.ts.menu.consulter.le.grand.livre:Consulter le grand livre de ce compte`,
      icon: 'pi pi-book',
      command: () => this.openLedger()
    },
    {
      label: $localize`:@@accounting.lettering.ts.menu.delettrer.un.groupe.par.code:Délettrer un groupe par code…`,
      icon: 'pi pi-times-circle',
      command: () => this.promptUnletterByCode()
    }
  ]);

  readonly buildAnalyzePayload = (): unknown =>
    buildLetteringAnalyzePayload({
      account: this.store.filters().account,
      from: this.store.filters().from,
      to: this.store.filters().to,
      lines: this.store.lines(),
      selectedCount: this.store.selectedLines().length,
      selectionBalanced: this.store.summary().balanced
    });

  constructor() {
    // Synchronise l'URL (deep-link) après chaque chargement réussi, sans empiler d'historique.
    effect(() => {
      if (!this.store.loadedOnce()) return;
      const queryParams = serializeLetteringFilters(this.store.filters());
      this.router.navigate([], { relativeTo: this.route, queryParams, replaceUrl: true });
    });

    // Ferme le tiroir après un délettrage/complétion réussis : le store vide `group` (et `groupError`)
    // sans savoir si le tiroir est ouvert (composant « bête »). Ne touche pas aux états chargement/erreur.
    effect(() => {
      const noGroup = this.store.group() === null;
      const idle = !this.store.groupLoading();
      const noError = this.store.groupError() === null;
      if (this.groupDrawerOpen && noGroup && idle && noError) {
        this.groupDrawerOpen = false;
      }
    });
  }

  ngOnInit(): void {
    const qp = this.route.snapshot.queryParams;
    const { filters, accountHint, autoLoad } = parseLetteringQueryParams(qp);
    this.accountHint = accountHint;
    this.store.updateFilters(filters);
    if (autoLoad && filters.account) {
      this.store.load();
    }
  }

  openGroup(code: string): void {
    this.groupDrawerOpen = true;
    this.store.openGroup(code);
  }

  /** Reçoit l'écho `visibleChange` du tiroir (ouverture ET fermeture, bouton croix, Échap, clic sur le masque) : ne ferme réellement que si la valeur reçue est `false`. */
  onGroupDrawerVisibleChange(visible: boolean): void {
    this.groupDrawerOpen = visible;
    if (!visible) {
      this.store.closeGroup();
    }
  }

  openSettle(): void {
    if (!this.store.canSettleExchangeDifference()) return;
    this.settleOpen = true;
  }

  onSettleVisibleChange(visible: boolean): void {
    this.settleOpen = visible;
  }

  onSettle(account: string): void {
    this.store.settle(account);
    this.settleOpen = false;
  }

  private openLedger(): void {
    const account = this.store.filters().account;
    this.router.navigate(['/accounting/ledger'], { queryParams: account ? { account } : {} });
  }

  private async promptUnletterByCode(): Promise<void> {
    const code = await this.confirmation.prompt({
      header: $localize`:@@accounting.lettering.ts.delettrer.un.groupe:Délettrer un groupe`,
      message: $localize`:@@accounting.lettering.ts.saisissez.le.code.du.groupe.a.delettre:Saisissez le code du groupe à délettrer (ex. L00001 ou P00003) :`,
      placeholder: 'L00001',
      acceptLabel: $localize`:@@accounting.lettering.ts.delettrer:Délettrer`,
      acceptButtonStyleClass: 'btn-danger',
      required: true
    });
    if (code) this.store.unletter(code.trim());
  }
}
