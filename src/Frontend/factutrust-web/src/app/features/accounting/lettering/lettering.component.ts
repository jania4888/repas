/// <reference types="@angular/localize" />
import { Component, ElementRef, OnInit, ViewChild, computed, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { DocumentActionsMenuComponent } from '@shared/components/document-actions-menu/document-actions-menu.component';
import { MenuItem } from '@shared/models/menu-item.model';
import { ConfirmationService } from '@core/services/confirmation.service';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AccountingFeatureFlagsService } from '../shared/accounting-feature-flags.service';
import { AccountingToolbarActionsComponent } from '../shared/accounting-toolbar-actions.component';
import { AccountingCorrectionBannerComponent } from '../shared/accounting-correction-banner.component';
import { LetteringStore } from './store/lettering.store';
import { LetteringSuggestionsStore } from './store/lettering-suggestions.store';
import { LetteringFiltersComponent } from './components/lettering-filters/lettering-filters.component';
import { LetteringLedgerPaneComponent } from './components/lettering-ledger-pane/lettering-ledger-pane.component';
import { LetteringSelectionSummaryComponent } from './components/lettering-selection-summary/lettering-selection-summary.component';
import { LetteringSettleExchangeDialogComponent } from './components/lettering-settle-exchange-dialog/lettering-settle-exchange-dialog.component';
import { LetteringGroupDrawerComponent } from './components/lettering-group-drawer/lettering-group-drawer.component';
import {
  LetteringProposalsNotice,
  LetteringProposalsStripComponent
} from './components/lettering-proposals-strip/lettering-proposals-strip.component';
import { LETTERING_FUNCTIONAL_CURRENCY, LetteringSide } from './models/lettering.models';
import { LetteringSuggestion } from './models/lettering-suggestions.models';
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
    LetteringGroupDrawerComponent,
    LetteringProposalsStripComponent,
    ButtonComponent
  ],
  providers: [LetteringStore, LetteringSuggestionsStore],
  templateUrl: './lettering.component.html',
  styleUrl: './lettering.component.scss'
})
export class LetteringComponent implements OnInit {
  protected readonly store = inject(LetteringStore);
  /** Propositions (Phase 3) : le store se recalcule seul après chaque chargement réussi. */
  protected readonly suggestions = inject(LetteringSuggestionsStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly confirmation = inject(ConfirmationService);
  protected readonly flags = inject(AccountingFeatureFlagsService);

  @ViewChild(LetteringSelectionSummaryComponent) private readonly summaryComponent?: LetteringSelectionSummaryComponent;
  @ViewChild(LetteringProposalsStripComponent, { read: ElementRef })
  private readonly proposalsStrip?: ElementRef<HTMLElement>;

  accountHint = '';
  settleOpen = false;
  groupDrawerOpen = false;

  /** Message du bandeau après un clic sur une carte (« Sélection remplacée », lignes masquées…). */
  readonly proposalsNotice = signal<LetteringProposalsNotice>(null);

  /** Bandeau des propositions : drapeau front actif, écran chargé, fonction non coupée côté serveur. */
  readonly showProposals = computed(
    () => this.flags.isEnabled('letteringProposals') && this.store.loadedOnce() && !this.suggestions.hidden()
  );

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
      command: () => this.promptUnletterByCode(),
      visible: this.store.canUnletter()
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

    // Un rechargement réussi rend le message du bandeau obsolète (lignes et propositions changent).
    effect(() => {
      if (this.store.reloadSeq() > 0) untracked(() => this.proposalsNotice.set(null));
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

  /** Sélection manuelle dans un volet : l'instantané de « Sélectionner » n'a plus de sens. */
  onPaneSelection(side: LetteringSide, ids: readonly string[]): void {
    this.store.setPaneSelection(side, ids);
    this.suggestions.forgetSelectSnapshot();
    this.proposalsNotice.set(null);
  }

  onResetSelection(): void {
    this.store.reset();
    this.suggestions.forgetSelectSnapshot();
    this.proposalsNotice.set(null);
  }

  onSelectSuggestion(suggestion: LetteringSuggestion): void {
    // Lecture seule : les volets ne sont pas sélectionnables, une carte ne doit pas les remplir.
    if (!this.store.canCreate()) return;
    const result = this.suggestions.select(suggestion);
    // `busy` pendant une complétion : attendre ne sert à rien, il faut la terminer ou l'annuler.
    this.proposalsNotice.set(result === 'busy' && this.store.completionGroup() !== null ? 'completion' : result);
  }

  onValidateSuggestion(suggestion: LetteringSuggestion): void {
    this.proposalsNotice.set(null);
    this.suggestions.validate(suggestion);
  }

  onUndoSuggestion(): void {
    this.suggestions.undoSelect();
    this.proposalsNotice.set(null);
  }

  /** Bouton d'en-tête « Propositions automatiques » : relance le calcul et amène le bandeau à l'écran. */
  showProposalsStrip(): void {
    this.suggestions.refresh();
    const el = this.proposalsStrip?.nativeElement;
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
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

  private async promptUnletterByCode(): Promise<void> {
    const raw = await this.confirmation.prompt({
      header: $localize`:@@accounting.lettering.ts.delettrer.un.groupe:Délettrer un groupe`,
      message: $localize`:@@accounting.lettering.ts.saisissez.le.code.du.groupe.a.delettre:Saisissez le code du groupe à délettrer (ex. L00001 ou P00003) :`,
      placeholder: 'L00001',
      acceptLabel: $localize`:@@accounting.lettering.ts.delettrer:Délettrer`,
      acceptButtonStyleClass: 'btn-danger',
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
    // Ouvre le tiroir (plutôt que délettrer directement) : l'utilisateur confirme/choisit depuis
    // le tiroir, qui porte déjà sa propre confirmation de délettrage (cohérent avec le flux B2).
    this.openGroup(code);
  }
}
