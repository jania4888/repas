/// <reference types="@angular/localize" />
import { Routes } from '@angular/router';
import { fixedAssetsFeatureGuard } from './shared/fixed-assets-feature.guard';
import { permissionGuard } from '@core/guards/permission.guard';
import { PERMISSIONS } from '@core/config/permission-keys';
import { pendingChangesGuard } from './fixed-assets/pending-changes.guard';

export const ACCOUNTING_ROUTES: Routes = [
  {
    path: 'financial-statements',
    loadComponent: () =>
      import('./accounting-financial-statements/accounting-financial-statements.component').then(
        m => m.AccountingFinancialStatementsComponent
      ),
    title: $localize`:@@accounting.routes.title._tats_comptables_Insta:États comptables - InstaFact`
  },
  {
    path: 'home',
    loadComponent: () =>
      import('./accounting-home/accounting-home.component').then(m => m.AccountingHomeComponent),
    title: $localize`:@@accounting.routes.title.Comptabilit_InstaFact:Comptabilité - InstaFact`
  },
  {
    path: 'chart',
    loadComponent: () =>
      import('./chart-of-accounts/chart-of-accounts.component').then(m => m.ChartOfAccountsComponent),
    title: $localize`:@@accounting.routes.title.Plan_comptable_InstaFa:Plan comptable - InstaFact`
  },
  {
    path: 'entry-templates',
    loadComponent: () =>
      import('./entry-templates/entry-templates.component').then(m => m.EntryTemplatesComponent),
    title: $localize`:@@accounting.accounting.routes.ts.modeles.d.ecriture.instafact.47339b68:Modèles d'écriture - InstaFact`
  },
  {
    path: 'journals',
    loadComponent: () =>
      import('./journals/journals.component').then(m => m.JournalsComponent),
    title: $localize`:@@accounting.routes.title.Journaux_familles_In:Journaux & familles - InstaFact`
  },
  {
    path: 'manual-entry',
    loadComponent: () =>
      import('./manual-entry/manual-entry.component').then(m => m.ManualEntryComponent),
    title: $localize`:@@accounting.routes.title.Saisie_manuelle_InstaF:Saisie manuelle - InstaFact`
  },
  {
    path: 'journal',
    loadComponent: () => import('./journal/journal.component').then(m => m.JournalComponent),
    title: $localize`:@@accounting.routes.title.Journal_InstaFact:Journal - InstaFact`
  },
  {
    path: 'ledger',
    loadComponent: () => import('./ledger/ledger.component').then(m => m.LedgerComponent),
    title: $localize`:@@accounting.routes.title.Grand_livre_InstaFact:Grand livre - InstaFact`
  },
  {
    path: 'sub-journals',
    loadComponent: () =>
      import('./sub-journals/sub-journals.component').then(m => m.SubJournalsComponent),
    title: $localize`:@@accounting.routes.title.Journaux_auxiliaires_I:Journaux auxiliaires - InstaFact`
  },
  {
    path: 'journal-summary',
    loadComponent: () =>
      import('./journal-summary/journal-summary.component').then(m => m.JournalSummaryComponent),
    title: $localize`:@@accounting.routes.title.R_capitulatifs_de_journa:Récapitulatifs de journaux - InstaFact`
  },
  {
    path: 'balance',
    loadComponent: () => import('./balance/balance.component').then(m => m.BalanceComponent),
    title: $localize`:@@accounting.routes.title.Balance_InstaFact:Balance - InstaFact`
  },
  {
    path: 'aging',
    loadComponent: () => import('./aging/aging.component').then(m => m.AgingComponent),
    title: $localize`:@@accounting.routes.title.Balance_g_e_InstaFact:Balance âgée - InstaFact`
  },
  {
    path: 'auxiliary-balance',
    loadComponent: () =>
      import('./auxiliary-balance/auxiliary-balance.component').then(m => m.AuxiliaryBalanceComponent),
    title: $localize`:@@accounting.routes.title.Balance_auxiliaire_Ins:Balance auxiliaire - InstaFact`
  },
  {
    path: 'third-party-ledger',
    loadComponent: () =>
      import('./third-party-ledger/third-party-ledger.component').then(m => m.ThirdPartyLedgerComponent),
    title: $localize`:@@accounting.routes.title.Grand_livre_tiers_Inst:Grand livre tiers - InstaFact`
  },
  {
    path: 'third-parties',
    loadComponent: () =>
      import('./third-parties/third-parties.component').then(m => m.ThirdPartiesComponent),
    title: $localize`:@@accounting.routes.title.Plan_tiers_InstaFact:Plan tiers - InstaFact`
  },
  {
    path: 'budget-posts',
    loadComponent: () =>
      import('./budget-posts/budget-posts.component').then(m => m.BudgetPostsComponent),
    title: $localize`:@@accounting.routes.title.Postes_budg_taires_Ins:Postes budgétaires - InstaFact`
  },
  {
    path: 'budgets',
    loadComponent: () =>
      import('./budget-entry/budget-entry.component').then(m => m.BudgetEntryComponent),
    title: $localize`:@@accounting.routes.title.Saisie_des_budgets_Ins:Saisie des budgets - InstaFact`
  },
  {
    path: 'budget-report',
    loadComponent: () =>
      import('./budget-report/budget-report.component').then(m => m.BudgetReportComponent),
    title: $localize`:@@accounting.routes.title._tat_budg_taire_InstaF:État budgétaire - InstaFact`
  },
  {
    path: 'vat-declaration',
    loadComponent: () =>
      import('./vat-declaration/vat-declaration.component').then(m => m.VatDeclarationComponent),
    title: $localize`:@@accounting.routes.title.D_claration_TVA_InstaF:Déclaration TVA - InstaFact`
  },
  {
    // Paramétrage du calcul de la déclaration mensuelle, rubrique par rubrique. Lecture sous
    // `accounting:read` ; chaque écriture est gardée côté serveur par `accounting:declare` ET par
    // le contexte cabinet délégué. Exiger `declare` ici fermerait l'écran à la simple consultation.
    path: 'dm/configuration',
    loadComponent: () =>
      import('./monthly-declaration/monthly-declaration-config.component').then(
        m => m.MonthlyDeclarationConfigComponent
      ),
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.accounting.read] },
    title: $localize`:@@accounting.routes.title.Configuration_DM_Insta:Configuration DM - InstaFact`
  },
  {
    // « Calcul DM ». Même garde que la configuration : `accounting:read` à l'entrée, le serveur
    // exigeant `accounting:declare` ET le contexte cabinet délégué sur le calcul lui-même.
    path: 'dm/calcul',
    loadComponent: () =>
      import('./monthly-declaration/monthly-declaration-compute.component').then(
        m => m.MonthlyDeclarationComputeComponent
      ),
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.accounting.read] },
    title: $localize`:@@accounting.routes.title.Calcul_DM_InstaFact:Calcul DM - InstaFact`
  },
  {
    // « Modèle Intégration DM ». `accounting:read` à l'entrée : l'export est ouvert à la
    // consultation, seul l'import exige `accounting:declare` et le contexte cabinet délégué.
    path: 'dm/modele',
    loadComponent: () =>
      import('./monthly-declaration/monthly-declaration-model.component').then(
        m => m.MonthlyDeclarationModelComponent
      ),
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.accounting.read] },
    title: $localize`:@@accounting.routes.title.Mod_le_Int_gration_DM_:Modèle Intégration DM - InstaFact`
  },
  {
    // « Suivi DM ». Lecture seule : le suivi ne dit rien qu'un dossier ne puisse savoir de ses
    // propres dépôts. Reste néanmoins hors de la liste autorisée aux sociétés, comme tout
    // `/accounting/dm/*` — l'ouvrir serait une décision de navigation à prendre pour elle-même.
    path: 'dm/suivi',
    loadComponent: () =>
      import('./monthly-declaration/monthly-declaration-tracking.component').then(
        m => m.MonthlyDeclarationTrackingComponent
      ),
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.accounting.read] },
    title: $localize`:@@accounting.routes.title.Suivi_DM_InstaFact:Suivi DM - InstaFact`
  },
  {
    path: 'fiscal-schedule',
    loadComponent: () =>
      import('./fiscal-schedule/fiscal-schedule.component').then(m => m.FiscalScheduleComponent),
    data: { fiscalScheduleScope: 'tenant' },
    title: $localize`:@@accounting.routes.title.Echeancier_fiscal_Inst:Echeancier fiscal - InstaFact`
  },
  {
    path: 'pre-closing',
    loadComponent: () =>
      import('./pre-closing/pre-closing.component').then(m => m.PreClosingComponent),
    title: $localize`:@@accounting.routes.title.Contr_les_de_pr_cl_ture:Contrôles de pré-clôture - InstaFact`
  },
  {
    path: 'health',
    loadComponent: () =>
      import('./audit-control/audit-control-page.component').then(m => m.AuditControlPageComponent),
    title: $localize`:@@accounting.accounting.routes.ts.controle.d.integrite.instafact.03b2cb78:Contrôle d'intégrité - InstaFact`
  },
  {
    path: 'draft-batch',
    loadComponent: () =>
      import('./draft-batch/draft-batch.component').then(m => m.DraftBatchComponent),
    title: $localize`:@@accounting.routes.title._dition_en_lot_des_broui:Édition en lot des brouillons - InstaFact`
  },
  {
    path: 'mass-reversal',
    loadComponent: () =>
      import('./mass-reversal/mass-reversal.component').then(m => m.MassReversalComponent),
    title: $localize`:@@accounting.routes.title.Correction_en_lot_par_ex:Correction en lot par extourne - InstaFact`
  },
  {
    path: 'inventory-assistant',
    loadComponent: () =>
      import('./inventory-assistant/inventory-assistant.component').then(m => m.InventoryAssistantComponent),
    title: $localize`:@@accounting.accounting.routes.ts.assistant.d.inventaire.instafact.11159708:Assistant d'inventaire - InstaFact`
  },
  {
    path: 'closing',
    loadComponent: () => import('./closing/closing.component').then(m => m.ClosingComponent),
    title: $localize`:@@accounting.routes.title.Cl_ture_InstaFact:Clôture - InstaFact`
  },
  {
    path: 'import',
    loadComponent: () => import('./import/import-hub.component').then(m => m.ImportHubComponent),
    title: $localize`:@@accounting.routes.title.Reprise_de_dossier_Ins:Reprise de dossier - InstaFact`
  },
  {
    path: 'balance-sheet',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.accounting.read] },
    loadComponent: () =>
      import('./balance-sheet/balance-sheet.component').then(m => m.BalanceSheetComponent),
    title: $localize`:@@accounting.routes.title.Bilan_InstaFact:Bilan - InstaFact`
  },
  {
    path: 'income-statement',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.accounting.read] },
    loadComponent: () =>
      import('./income-statement/income-statement.component').then(m => m.IncomeStatementComponent),
    title: $localize`:@@accounting.routes.title.Compte_de_r_sultat_Ins:Compte de résultat - InstaFact`
  },
  {
    path: 'nct-statements',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.accounting.read] },
    loadComponent: () =>
      import('./nct-statements/nct-statements.component').then(m => m.NctStatementsComponent),
    title: $localize`:@@accounting.routes.title._tats_financiers_NCT_I:États financiers NCT - InstaFact`
  },
  {
    path: 'inventory-book',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.accounting.read] },
    loadComponent: () =>
      import('./inventory-book/inventory-book.component').then(m => m.InventoryBookComponent),
    title: $localize`:@@accounting.accounting.routes.ts.livre.d.inventaire.instafact.2840c0a0:Livre d'inventaire - InstaFact`
  },
  {
    path: 'fiscal-result',
    canActivate: [permissionGuard],
    // Confirme la perte de modifications non enregistrées à la navigation (T23). Écrite en garde
    // en ligne (plutôt qu'un import statique du composant) pour ne pas casser le lazy-loading.
    canDeactivate: [(component: { canDeactivate: () => boolean }) => component.canDeactivate()],
    data: { permissions: [PERMISSIONS.accounting.read] },
    loadComponent: () =>
      import('./fiscal-result/fiscal-result.component').then(m => m.FiscalResultComponent),
    title: $localize`:@@accounting.routes.title.D_termination_du_r_sulta:Détermination du résultat fiscal - InstaFact`
  },
  {
    path: 'fiscal-parameters',
    canActivate: [permissionGuard],
    canDeactivate: [(component: { canDeactivate: () => boolean }) => component.canDeactivate()],
    data: { permissions: [PERMISSIONS.accounting.read] },
    loadComponent: () =>
      import('./fiscal-parameters/fiscal-parameters.component').then(m => m.FiscalParametersComponent),
    title: $localize`:@@accounting.routes.title.Param_tres_fiscaux_Ins:Paramètres fiscaux - InstaFact`
  },
  {
    path: 'currencies',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.accounting.read] },
    loadComponent: () =>
      import('./currencies/currencies.component').then(m => m.CurrenciesComponent),
    title: $localize`:@@accounting.routes.title.Gestion_des_devises_In:Gestion des devises - InstaFact`
  },
  {
    path: 'closing-revaluation',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.accounting.close] },
    loadComponent: () =>
      import('./currencies/closing-revaluation.component').then(m => m.ClosingRevaluationComponent),
    title: $localize`:@@accounting.routes.title.Reevaluation_de_cloture_:Reevaluation de cloture - InstaFact`
  },
  {
    // Segment parametre declare APRES la liste : l'ordre est significatif.
    path: 'currencies/:id',
    // Ecran d'ecriture pure (edition des taux) : il exige le droit correspondant.
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.accounting.currenciesManage] },
    // Confirme la perte des taux non enregistres a la navigation. Garde ecrite en ligne pour ne
    // pas casser le lazy-loading, comme pour fiscal-parameters.
    canDeactivate: [(component: { canDeactivate: () => boolean }) => component.canDeactivate()],
    loadComponent: () =>
      import('./currencies/currency-edit.component').then(m => m.CurrencyEditComponent),
    title: $localize`:@@accounting.routes.title.Edition_de_devise_Inst:Edition de devise - InstaFact`
  },
  {
    path: 'lettering',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.accounting.read] },
    loadComponent: () =>
      import('./lettering/lettering.component').then(m => m.LetteringComponent),
    title: $localize`:@@accounting.routes.title.Lettrage_InstaFact:Lettrage - InstaFact`
  },
  {
    path: 'entry-search',
    loadComponent: () =>
      import('./entry-search/entry-search.component').then(m => m.EntrySearchComponent),
    title: $localize`:@@accounting.accounting.routes.ts.recherche.d.ecriture.instafact.37a36a84:Recherche d'écriture - InstaFact`
  },
  {
    path: 'account-replacement',
    loadComponent: () =>
      import('./account-replacement/account-replacement.component').then(m => m.AccountReplacementComponent),
    title: $localize`:@@accounting.routes.title.Remplacement_de_compte_:Remplacement de compte - InstaFact`
  },
  {
    path: 'bank-reconciliation',
    loadComponent: () =>
      import('./bank-reconciliation/bank-reconciliation.component').then(m => m.BankReconciliationComponent),
    title: $localize`:@@accounting.routes.title.Rapprochement_bancaire_:Rapprochement bancaire - InstaFact`
  },
  {
    // Import IA de relevé bancaire : relecture de l'analyse (session) puis comptabilisation (relevé).
    // Le drapeau serveur fait foi : désactivé, l'API répond 404 et l'écran l'affiche.
    path: 'bank-statement-import/session/:sessionId',
    loadComponent: () =>
      import('./bank-statement-import/bank-statement-review.component').then(m => m.BankStatementReviewComponent),
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.accounting.create] },
    title: $localize`:@@accounting.routes.title.Releve_bancaire_comptab:Relevé bancaire - InstaFact`
  },
  {
    path: 'bank-statement-import/statement/:statementId',
    loadComponent: () =>
      import('./bank-statement-import/bank-statement-review.component').then(m => m.BankStatementReviewComponent),
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.accounting.create] },
    title: $localize`:@@accounting.routes.title.Releve_bancaire_comptab:Relevé bancaire - InstaFact`
  },
  {
    path: 'fixed-assets',
    loadComponent: () =>
      import('./fixed-assets/fixed-assets-list.component').then(m => m.FixedAssetsListComponent),
    canActivate: [fixedAssetsFeatureGuard],
    title: $localize`:@@accounting.routes.title.Immobilisations_InstaF:Immobilisations - InstaFact`
  },
  {
    path: 'fixed-assets/new',
    loadComponent: () =>
      import('./fixed-assets/fixed-asset-detail.component').then(m => m.FixedAssetDetailComponent),
    canActivate: [fixedAssetsFeatureGuard],
    canDeactivate: [pendingChangesGuard],
    data: { mode: 'new' },
    title: $localize`:@@accounting.routes.title.Nouvelle_immobilisation_:Nouvelle immobilisation - InstaFact`
  },
  {
    path: 'fixed-assets/depreciation-run',
    loadComponent: () =>
      import('./fixed-assets/depreciation-run.component').then(m => m.DepreciationRunComponent),
    canActivate: [fixedAssetsFeatureGuard],
    title: $localize`:@@accounting.routes.title.Dotations_immobilisation:Dotations immobilisations - InstaFact`
  },
  {
    path: 'fixed-assets/amortization-table',
    loadComponent: () =>
      import('./fixed-assets/fixed-assets-amortization-table.component').then(m => m.FixedAssetsAmortizationTableComponent),
    canActivate: [fixedAssetsFeatureGuard],
    title: $localize`:@@accounting.routes.title.Tableau_des_amortissemen:Tableau des amortissements - InstaFact`
  },
  {
    path: 'fixed-assets/settings',
    loadComponent: () =>
      import('./fixed-assets/fixed-asset-settings.component').then(m => m.FixedAssetSettingsComponent),
    canActivate: [fixedAssetsFeatureGuard],
    title: $localize`:@@accounting.routes.title.Exercice_comptable_Ins:Exercice comptable - InstaFact`
  },
  {
    path: 'loans',
    loadComponent: () =>
      import('./loans/loans-list.component').then(m => m.LoansListComponent),
    title: $localize`:@@accounting.routes.title.Emprunts_InstaFact:Emprunts - InstaFact`
  },
  {
    path: 'loans/:id',
    loadComponent: () =>
      import('./loans/loan-schedule.component').then(m => m.LoanScheduleComponent),
    title: $localize`:@@accounting.accounting.routes.ts.tableau.d.amortissement.d.emprunt.instaf.d0b0a6a5:Tableau d'amortissement d'emprunt - InstaFact`
  },
  {
    path: 'fixed-assets/:id',
    loadComponent: () =>
      import('./fixed-assets/fixed-asset-detail.component').then(m => m.FixedAssetDetailComponent),
    canActivate: [fixedAssetsFeatureGuard],
    canDeactivate: [pendingChangesGuard],
    title: $localize`:@@accounting.routes.title.Immobilisation_InstaFa:Immobilisation - InstaFact`
  },
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./accounting-root-redirect/accounting-root-redirect.component').then(
        m => m.AccountingRootRedirectComponent
      )
  }
];
