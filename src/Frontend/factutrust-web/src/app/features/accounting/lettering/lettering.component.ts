/// <reference types="@angular/localize" />
import { Component, OnInit, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { DocumentActionsMenuComponent } from '@shared/components/document-actions-menu/document-actions-menu.component';
import { MenuItem } from '@shared/models/menu-item.model';
import { ConfirmationService } from '@core/services/confirmation.service';
import { AccountingToolbarActionsComponent } from '../shared/accounting-toolbar-actions.component';
import { AccountingCorrectionBannerComponent } from '../shared/accounting-correction-banner.component';
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

  @ViewChild(LetteringSelectionSummaryComponent) private readonly summaryComponent?: LetteringSelectionSummaryComponent;

  accountHint = '';
  settleOpen = false;
  groupDrawerOpen = false;

  readonly sideCounts = computed(() => sideCounts(this.store.selectedLines()));

  /** Type du compte saisi, remonté par les filtres (plan comptable). `null` : inconnu. */
  readonly accountType = signal<number | null>(null);
  /** Libellé du type de compte affiché dans la synthèse à côté du numéro (plan §7.3). */
  readonly accountTypeLabel = computed<string | null>(() => {
    switch (this.accountType()) {
      case 0:
        return $localize`:@@accounting.lettering.ts.type.compte.general:Compte général`;
      case 1:
        return $localize`:@@accounting.lettering.ts.type.compte.client:Compte client`;
      case 2:
        return $localize`:@@accounting.lettering.ts.type.compte.fournisseur:Compte fournisseur`;
      case 3:
        return $localize`:@@accounting.lettering.ts.type.compte.autre.tiers:Autre compte de tiers`;
      default:
        return null;
    }
  });

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
      // Export Excel du grand livre de ce compte sur la période (plan §7.6). Réservé à un compte
      // exact : l'export existant ne couvre pas les sous-comptes (« Inclure les sous-comptes »).
      label: $localize`:@@accounting.lettering.ts.menu.exporter.le.grand.livre:Exporter le grand livre (Excel)`,
      icon: 'pi pi-file-excel',
      command: () => this.store.exportLedger(),
      disabled:
        !this.store.filters().account.trim() ||
        this.store.filters().accountMatch === 'prefix' ||
        this.store.exporting()
    },
    {
      // Lecture seule suffisante (plan §7.6) : l'action ouvre seulement le tiroir du groupe ; le
      // bouton « Délettrer » du tiroir reste soumis au droit `accounting:unletter`.
      label: $localize`:@@accounting.lettering.ts.menu.ouvrir.un.groupe.par.code:Ouvrir un groupe par code…`,
      icon: 'pi pi-search',
      command: () => this.promptOpenGroupByCode()
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
      this.load();
    }
  }

  /** Déclenché par le bouton « Charger les écritures » des filtres (M3) : contrairement à l'ancien
   *  `effect()` réactif, l'URL n'est réécrite qu'après un chargement effectivement réussi, jamais
   *  en réaction à un changement de signal quelconque. */
  load(): void {
    this.store.load(() => this.syncUrl());
  }

  private syncUrl(): void {
    const queryParams = serializeLetteringFilters(this.store.filters(), {
      accountHint: this.accountHint,
      autoLoad: true
    });
    this.router.navigate([], { relativeTo: this.route, queryParams, replaceUrl: true });
  }

  openGroup(code: string): void {
    this.groupDrawerOpen = true;
    this.store.openGroup(code);
  }

  /** B2 : « Compléter ce lettrage » depuis le tiroir ne complète pas directement — il ferme le
   *  tiroir et garde le groupe et TOUS ses membres dans le store (`startCompletion`), même s'ils ne
   *  sont pas chargés (filtre « non lettrées ») ; l'utilisateur ajoute ensuite les lignes à lettrer
   *  et valide depuis la synthèse (B1, `completionTarget`). */
  onDrawerComplete(code: string): void {
    const group = this.store.group();
    if (!group || group.code !== code) return;
    this.groupDrawerOpen = false;
    this.store.startCompletion(group);
    this.store.closeGroup();
  }

  /** Décide, selon la sélection courante, s'il faut compléter un groupe partiel (B1) ou lettrer
   *  normalement. Appelé par le bouton « Valider » de la synthèse de sélection. */
  onValidate(): void {
    const code = this.store.completionTarget();
    if (code) {
      this.store.complete(code);
    } else {
      this.store.letter();
    }
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

  /** Reçoit l'écho `visibleChange` de la modale : ne rend le focus au bouton déclencheur que
   *  lorsqu'elle se ferme (croix, Échap, clic hors modale) — le succès de `onSettle` fait de même. */
  onSettleVisibleChange(visible: boolean): void {
    this.settleOpen = visible;
    if (!visible) {
      this.summaryComponent?.focusSettleTrigger();
    }
  }

  /** Ne ferme la modale (et ne rend le focus) qu'au succès réel de l'équilibrage : en cas
   *  d'erreur, l'utilisateur la voit affichée dans la modale et peut corriger sans tout refaire. */
  onSettle(account: string): void {
    this.store.settle(account, () => {
      this.settleOpen = false;
      this.summaryComponent?.focusSettleTrigger();
    });
  }

  private openLedger(): void {
    const f = this.store.filters();
    const queryParams: Record<string, string> = {};
    if (f.account) queryParams['account'] = f.account;
    if (f.from) queryParams['from'] = f.from;
    if (f.to) queryParams['to'] = f.to;
    this.router.navigate(['/accounting/ledger'], { queryParams });
  }

  /** Format d'un code de groupe de lettrage : `L` (complet) ou `P` (partiel) suivi d'au moins 5 chiffres. */
  private static readonly GROUP_CODE_PATTERN = /^[LP]\d{5,}$/;

  private async promptOpenGroupByCode(): Promise<void> {
    const raw = await this.confirmation.prompt({
      header: $localize`:@@accounting.lettering.ts.ouvrir.un.groupe:Ouvrir un groupe de lettrage`,
      message: $localize`:@@accounting.lettering.ts.saisissez.le.code.du.groupe.a.ouvrir:Saisissez le code du groupe à ouvrir (ex. L00001 ou P00003) :`,
      placeholder: 'L00001',
      acceptLabel: $localize`:@@accounting.lettering.ts.ouvrir:Ouvrir`,
      required: true,
      maxLength: 16
    });
    if (!raw) return;
    const code = raw.trim().toUpperCase();
    if (!LetteringComponent.GROUP_CODE_PATTERN.test(code)) {
      this.store.error.set(
        $localize`:@@accounting.lettering.ts.code.de.groupe.invalide:Code de groupe invalide : attendu un « L » ou un « P » suivi de chiffres (ex. L00001).`
      );
      return;
    }
    // Ouvre le tiroir : il affiche le détail du groupe ; « Délettrer » y garde sa propre
    // confirmation et son contrôle de droit (cohérent avec le flux B2).
    this.openGroup(code);
  }
}
