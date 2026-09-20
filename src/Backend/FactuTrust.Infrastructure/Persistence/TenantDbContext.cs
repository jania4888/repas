using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Entities.AI;
using FactuTrust.Domain.Entities.Channels;
using FactuTrust.Domain.Entities.Forecasting;
using FactuTrust.Domain.Entities.Honoraires;
using FactuTrust.Domain.Entities.Pricing;
using FactuTrust.Domain.Entities.RecurringContracts;
using FactuTrust.Domain.Entities.Storefront;
using FactuTrust.Domain.Entities.Studio;
using FactuTrust.Domain.Entities.Treasury;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.Events;
using FactuTrust.Domain.Services;
using FactuTrust.Domain.ValueObjects;
using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace FactuTrust.Infrastructure.Persistence;

/// <summary>
/// Tenant-specific database context for business data.
/// Each tenant has their own isolated database with this schema.
/// </summary>
public partial class TenantDbContext : DbContext
{
    private IMediator? _mediator;
    private ILogger? _logger;

    public TenantDbContext(DbContextOptions<TenantDbContext> options) : base(options)
    {
    }

    internal void SetMediator(IMediator mediator)
    {
        _mediator = mediator;
    }

    internal void SetLogger(ILogger logger)
    {
        _logger = logger;
    }

    public override async Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        var domainEvents = ChangeTracker.Entries<Entity>()
            .Where(e => e.Entity.DomainEvents.Count > 0)
            .SelectMany(e => e.Entity.DomainEvents)
            .ToList();

        foreach (var entry in ChangeTracker.Entries<Entity>())
            entry.Entity.ClearDomainEvents();

        var result = await base.SaveChangesAsync(cancellationToken);

        if (_mediator is not null)
        {
            foreach (var domainEvent in domainEvents)
            {
                try
                {
                    await _mediator.Publish(domainEvent, cancellationToken);
                }
                catch (Exception ex)
                {
                    // Domain event side-effects must never abort a successful persistence operation.
                    // The data has already been committed — only a background side-effect failed.
                    _logger?.LogError(ex,
                        "Unhandled exception dispatching domain event {EventType}. " +
                        "Database changes were committed successfully.",
                        domainEvent.GetType().Name);
                }
            }
        }

        return result;
    }

    public DbSet<Client> Clients => Set<Client>();
    public DbSet<ClientPortalContact> ClientPortalContacts => Set<ClientPortalContact>();
    public DbSet<Company> Companies => Set<Company>();
    public DbSet<Tax> Taxes => Set<Tax>();
    public DbSet<ProductCategory> ProductCategories => Set<ProductCategory>();
    public DbSet<Product> Products => Set<Product>();
    public DbSet<Invoice> Invoices => Set<Invoice>();
    public DbSet<InvoiceLine> InvoiceLines => Set<InvoiceLine>();
    public DbSet<Quote> Quotes => Set<Quote>();
    public DbSet<QuoteLine> QuoteLines => Set<QuoteLine>();
    public DbSet<SalesOrder> SalesOrders => Set<SalesOrder>();
    public DbSet<SalesOrderLine> SalesOrderLines => Set<SalesOrderLine>();
    public DbSet<PriceList> PriceLists => Set<PriceList>();
    public DbSet<PriceListItem> PriceListItems => Set<PriceListItem>();
    public DbSet<PriceListItemTier> PriceListItemTiers => Set<PriceListItemTier>();
    public DbSet<Promotion> Promotions => Set<Promotion>();
    public DbSet<PaymentTermTemplate> PaymentTermTemplates => Set<PaymentTermTemplate>();
    public DbSet<ClientProductPrice> ClientProductPrices => Set<ClientProductPrice>();
    public DbSet<Payment> Payments => Set<Payment>();
    public DbSet<CashOperation> CashOperations => Set<CashOperation>();
    public DbSet<CashRegister> CashRegisters => Set<CashRegister>();
    public DbSet<CashRegisterSession> CashRegisterSessions => Set<CashRegisterSession>();
    public DbSet<ZReport> ZReports => Set<ZReport>();
    public DbSet<PosCartDraft> PosCartDrafts => Set<PosCartDraft>();
    public DbSet<PosHeldTicket> PosHeldTickets => Set<PosHeldTicket>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
    public DbSet<InvoiceDraft> InvoiceDrafts => Set<InvoiceDraft>();
    public DbSet<InvoiceNumberSequence> InvoiceNumberSequences => Set<InvoiceNumberSequence>();
    public DbSet<QuoteNumberSequence> QuoteNumberSequences => Set<QuoteNumberSequence>();
    public DbSet<DocumentNumberingScheme> DocumentNumberingSchemes => Set<DocumentNumberingScheme>();
    public DbSet<DocumentTemplatePreference> DocumentTemplatePreferences => Set<DocumentTemplatePreference>();
    public DbSet<UserDashboardLayout> UserDashboardLayouts => Set<UserDashboardLayout>();
    public DbSet<CashOperationNumberSequence> CashOperationNumberSequences => Set<CashOperationNumberSequence>();
    public DbSet<BankDeposit> BankDeposits => Set<BankDeposit>();
    public DbSet<BankDepositNumberSequence> BankDepositNumberSequences => Set<BankDepositNumberSequence>();
    public DbSet<BankAccount> BankAccounts => Set<BankAccount>();

    // Stock Management
    public DbSet<Warehouse> Warehouses => Set<Warehouse>();
    public DbSet<StockItem> StockItems => Set<StockItem>();
    public DbSet<StockMovement> StockMovements => Set<StockMovement>();
    public DbSet<ProductLot> ProductLots => Set<ProductLot>();
    public DbSet<StockLotBalance> StockLotBalances => Set<StockLotBalance>();
    public DbSet<ProductSerial> ProductSerials => Set<ProductSerial>();
    public DbSet<StockValuationLayer> StockValuationLayers => Set<StockValuationLayer>();
    public DbSet<StockDocumentAllocation> StockDocumentAllocations => Set<StockDocumentAllocation>();
    public DbSet<ProductAttributeDefinition> ProductAttributeDefinitions => Set<ProductAttributeDefinition>();
    public DbSet<ProductAttributeValue> ProductAttributeValues => Set<ProductAttributeValue>();
    public DbSet<ProductVariantAxis> ProductVariantAxes => Set<ProductVariantAxis>();
    public DbSet<ProductVariantAttributeValue> ProductVariantAttributeValues => Set<ProductVariantAttributeValue>();

    // Physical Inventory
    public DbSet<PhysicalInventory> PhysicalInventories => Set<PhysicalInventory>();
    public DbSet<InventoryNumberSequence> InventoryNumberSequences => Set<InventoryNumberSequence>();

    // Delivery Notes
    public DbSet<DeliveryNote> DeliveryNotes => Set<DeliveryNote>();
    public DbSet<DeliveryNoteLine> DeliveryNoteLines => Set<DeliveryNoteLine>();

    // Sales return notes (bons de retour client, pré-facture)
    public DbSet<SalesReturnNote> SalesReturnNotes => Set<SalesReturnNote>();
    public DbSet<SalesReturnNoteLine> SalesReturnNoteLines => Set<SalesReturnNoteLine>();

    // Purchasing
    public DbSet<Supplier> Suppliers => Set<Supplier>();
    public DbSet<PurchaseOrder> PurchaseOrders => Set<PurchaseOrder>();
    public DbSet<PurchaseOrderLine> PurchaseOrderLines => Set<PurchaseOrderLine>();
    public DbSet<PurchaseReceipt> PurchaseReceipts => Set<PurchaseReceipt>();
    public DbSet<PurchaseReceiptLine> PurchaseReceiptLines => Set<PurchaseReceiptLine>();
    public DbSet<PurchaseReceiptAttachment> PurchaseReceiptAttachments => Set<PurchaseReceiptAttachment>();
    public DbSet<InventoryCountLine> InventoryCountLines => Set<InventoryCountLine>();

    // Supplier Invoices
    public DbSet<SupplierInvoice> SupplierInvoices => Set<SupplierInvoice>();
    public DbSet<SupplierInvoiceLine> SupplierInvoiceLines => Set<SupplierInvoiceLine>();
    public DbSet<SupplierPayment> SupplierPayments => Set<SupplierPayment>();

    // Stock Transfers
    public DbSet<StockTransfer> StockTransfers => Set<StockTransfer>();
    public DbSet<StockTransferLine> StockTransferLines => Set<StockTransferLine>();

    public DbSet<StockVoucher> StockVouchers => Set<StockVoucher>();
    public DbSet<StockVoucherLine> StockVoucherLines => Set<StockVoucherLine>();

    // Accounting (SCE Tunisia)
    public DbSet<ChartOfAccount> ChartOfAccounts => Set<ChartOfAccount>();
    public DbSet<AccountingPeriod> AccountingPeriods => Set<AccountingPeriod>();
    public DbSet<AccountingYearLock> AccountingYearLocks => Set<AccountingYearLock>();
    public DbSet<JournalEntrySequence> JournalEntrySequences => Set<JournalEntrySequence>();
    public DbSet<JournalEntry> JournalEntries => Set<JournalEntry>();
    public DbSet<JournalEntryLine> JournalEntryLines => Set<JournalEntryLine>();
    public DbSet<JournalEntryAttachment> JournalEntryAttachments => Set<JournalEntryAttachment>();
    public DbSet<Journal> Journals => Set<Journal>();
    public DbSet<JournalFamily> JournalFamilies => Set<JournalFamily>();
    public DbSet<LetteringGroup> LetteringGroups => Set<LetteringGroup>();
    public DbSet<LetteringGroupMember> LetteringGroupMembers => Set<LetteringGroupMember>();
    public DbSet<VatDeclaration> VatDeclarations => Set<VatDeclaration>();
    public DbSet<FiscalScheduleEntry> FiscalScheduleEntries => Set<FiscalScheduleEntry>();
    public DbSet<FiscalScheduleHistoryEntry> FiscalScheduleHistoryEntries => Set<FiscalScheduleHistoryEntry>();
    public DbSet<FiscalScheduleAttachment> FiscalScheduleAttachments => Set<FiscalScheduleAttachment>();
    public DbSet<BudgetPost> BudgetPosts => Set<BudgetPost>();
    public DbSet<BudgetYear> BudgetYears => Set<BudgetYear>();
    public DbSet<BudgetLine> BudgetLines => Set<BudgetLine>();

    // Déclaration mensuelle paramétrable (« Configuration DM »).
    public DbSet<VatDeclarationLine> VatDeclarationLines => Set<VatDeclarationLine>();
    public DbSet<MonthlyDeclarationSettings> MonthlyDeclarationSettings => Set<MonthlyDeclarationSettings>();
    public DbSet<MonthlyDeclarationFamilySetting> MonthlyDeclarationFamilySettings => Set<MonthlyDeclarationFamilySetting>();
    public DbSet<MonthlyDeclarationRubric> MonthlyDeclarationRubrics => Set<MonthlyDeclarationRubric>();
    public DbSet<MonthlyDeclarationRubricAccount> MonthlyDeclarationRubricAccounts => Set<MonthlyDeclarationRubricAccount>();
    public DbSet<MonthlyDeclarationRubricSeedLog> MonthlyDeclarationRubricSeedLogs => Set<MonthlyDeclarationRubricSeedLog>();
    public DbSet<ThirdPartyAccountingProfile> ThirdPartyAccountingProfiles => Set<ThirdPartyAccountingProfile>();
    public DbSet<Currency> Currencies => Set<Currency>();
    public DbSet<CurrencyExchangeRate> CurrencyExchangeRates => Set<CurrencyExchangeRate>();

    // Bank reconciliation (rapprochement bancaire)
    public DbSet<BankStatement> BankStatements => Set<BankStatement>();
    public DbSet<BankStatementLine> BankStatementLines => Set<BankStatementLine>();

    // Withholding Tax (TEJ)
    public DbSet<WithholdingTaxType> WithholdingTaxTypes => Set<WithholdingTaxType>();
    public DbSet<TejXmlExportLog> TejXmlExportLogs => Set<TejXmlExportLog>();
    public DbSet<WithholdingFiscalYearParameter> WithholdingFiscalYearParameters => Set<WithholdingFiscalYearParameter>();

    // Liasse fiscale (détermination du résultat fiscal + paramètres IS/IRPP par exercice)
    public DbSet<Domain.Entities.Fiscal.IncomeTaxYearParameter> IncomeTaxYearParameters => Set<Domain.Entities.Fiscal.IncomeTaxYearParameter>();
    public DbSet<Domain.Entities.Fiscal.FiscalResultDeclaration> FiscalResultDeclarations => Set<Domain.Entities.Fiscal.FiscalResultDeclaration>();
    public DbSet<Domain.Entities.Fiscal.FiscalAdjustmentLine> FiscalAdjustmentLines => Set<Domain.Entities.Fiscal.FiscalAdjustmentLine>();
    public DbSet<Domain.Entities.Fiscal.FiscalCarryForwardItem> FiscalCarryForwardItems => Set<Domain.Entities.Fiscal.FiscalCarryForwardItem>();

    // CRM
    public DbSet<Opportunity> Opportunities => Set<Opportunity>();
    public DbSet<SalesActivity> SalesActivities => Set<SalesActivity>();
    public DbSet<SalesTarget> SalesTargets => Set<SalesTarget>();
    public DbSet<QuoteTemplate> QuoteTemplates => Set<QuoteTemplate>();
    public DbSet<QuoteTemplateLine> QuoteTemplateLines => Set<QuoteTemplateLine>();
    public DbSet<JournalEntryTemplate> JournalEntryTemplates => Set<JournalEntryTemplate>();
    public DbSet<JournalEntryTemplateLine> JournalEntryTemplateLines => Set<JournalEntryTemplateLine>();

    // Fixed assets (immobilisations)
    public DbSet<DepreciationRateCategory> DepreciationRateCategories => Set<DepreciationRateCategory>();
    public DbSet<FixedAsset> FixedAssets => Set<FixedAsset>();
    public DbSet<DepreciationScheduleLine> DepreciationScheduleLines => Set<DepreciationScheduleLine>();
    public DbSet<Loan> Loans => Set<Loan>();
    public DbSet<LoanScheduleLine> LoanScheduleLines => Set<LoanScheduleLine>();
    public DbSet<NctNoteOverride> NctNoteOverrides => Set<NctNoteOverride>();
    public DbSet<FixedAssetEvent> FixedAssetEvents => Set<FixedAssetEvent>();
    public DbSet<FixedAssetSettings> FixedAssetSettings => Set<FixedAssetSettings>();
    public DbSet<PayrollAccountingSettings> PayrollAccountingSettings => Set<PayrollAccountingSettings>();

    // Sector data templates — applied-tracking (plan §WP-B6)
    public DbSet<AppliedSectorTemplate> AppliedSectorTemplates => Set<AppliedSectorTemplate>();

    // AI Assistant
    public DbSet<Conversation> Conversations => Set<Conversation>();
    public DbSet<ConversationMessage> ConversationMessages => Set<ConversationMessage>();
    public DbSet<TenantAiProvider> TenantAiProviders => Set<TenantAiProvider>();
    public DbSet<AiExportAudit> AiExportAudits => Set<AiExportAudit>();
    public DbSet<ChannelIdentityLink> ChannelIdentityLinks => Set<ChannelIdentityLink>();
    public DbSet<ChannelLinkCode> ChannelLinkCodes => Set<ChannelLinkCode>();
    public DbSet<ChannelInboundMessageLog> ChannelInboundMessageLogs => Set<ChannelInboundMessageLog>();

    // Public Virtual Street outbox (tenant-side event sourcing for projection sync)
    public DbSet<StorefrontOutboxMessage> StorefrontOutboxMessages => Set<StorefrontOutboxMessage>();

    // Demo dataset audit markers
    public DbSet<DemoDataset> DemoDatasets => Set<DemoDataset>();

    // AI Forecasting Module (gated by Features:Forecasting:Enabled — tables created by migration AddForecastingModule_Tenant).
    public DbSet<SalesForecast> SalesForecasts => Set<SalesForecast>();
    public DbSet<ReplenishmentRecommendation> ReplenishmentRecommendations => Set<ReplenishmentRecommendation>();
    public DbSet<PromotionRecommendation> PromotionRecommendations => Set<PromotionRecommendation>();
    public DbSet<ProductAbcXyzClassification> ProductAbcXyzClassifications => Set<ProductAbcXyzClassification>();
    public DbSet<ForecastRecomputeAudit> ForecastRecomputeAudits => Set<ForecastRecomputeAudit>();
    // Replenishment V2 audit trail (gated by Features:Forecasting:ReplenishmentV2:Enabled, table created by migration AddReplenishmentV2_Tenant).
    public DbSet<ReplenishmentDecisionAudit> ReplenishmentDecisionAudits => Set<ReplenishmentDecisionAudit>();

    // Trésorerie prévisionnelle par IA (gated by TreasuryForecast:Enabled — tables created by migration AddTreasuryCashForecast_Tenant).
    public DbSet<CashFlowForecastRun> CashFlowForecastRuns => Set<CashFlowForecastRun>();
    public DbSet<CashFlowForecastLine> CashFlowForecastLines => Set<CashFlowForecastLine>();
    public DbSet<CashFlowForecastBucket> CashFlowForecastBuckets => Set<CashFlowForecastBucket>();
    public DbSet<CashFlowScenario> CashFlowScenarios => Set<CashFlowScenario>();
    public DbSet<CashFlowForecastInsight> CashFlowForecastInsights => Set<CashFlowForecastInsight>();
    public DbSet<RecurringCashCommitment> RecurringCashCommitments => Set<RecurringCashCommitment>();
    public DbSet<CashFlowForecastSettings> CashFlowForecastSettings => Set<CashFlowForecastSettings>();

    // Honoraires Module (cabinet billing) — gated by AppModule.Honoraires.
    public DbSet<HonorairesInvoice> HonorairesInvoices => Set<HonorairesInvoice>();
    public DbSet<HonorairesInvoiceLine> HonorairesInvoiceLines => Set<HonorairesInvoiceLine>();
    public DbSet<HonorairesQuote> HonorairesQuotes => Set<HonorairesQuote>();
    public DbSet<HonorairesQuoteLine> HonorairesQuoteLines => Set<HonorairesQuoteLine>();
    public DbSet<HonorairesPayment> HonorairesPayments => Set<HonorairesPayment>();
    public DbSet<HonorairesAttachment> HonorairesAttachments => Set<HonorairesAttachment>();

    // Projects / PSA — gated by AppModule.Projects + Features:Projects:Enabled.
    public DbSet<Domain.Entities.Projects.Project> Projects => Set<Domain.Entities.Projects.Project>();
    public DbSet<Domain.Entities.Projects.ProjectPhase> ProjectPhases => Set<Domain.Entities.Projects.ProjectPhase>();
    public DbSet<Domain.Entities.Projects.ProjectTask> ProjectTasks => Set<Domain.Entities.Projects.ProjectTask>();
    public DbSet<Domain.Entities.Projects.ProjectTaskDependency> ProjectTaskDependencies => Set<Domain.Entities.Projects.ProjectTaskDependency>();
    public DbSet<Domain.Entities.Projects.ProjectComment> ProjectComments => Set<Domain.Entities.Projects.ProjectComment>();
    public DbSet<Domain.Entities.Projects.ProjectAttachment> ProjectAttachments => Set<Domain.Entities.Projects.ProjectAttachment>();
    public DbSet<Domain.Entities.Projects.ProjectMember> ProjectMembers => Set<Domain.Entities.Projects.ProjectMember>();
    public DbSet<Domain.Entities.Projects.ProjectTimeEntry> ProjectTimeEntries => Set<Domain.Entities.Projects.ProjectTimeEntry>();
    public DbSet<Domain.Entities.Projects.ProjectCostLine> ProjectCostLines => Set<Domain.Entities.Projects.ProjectCostLine>();
    public DbSet<Domain.Entities.Projects.ProjectActivity> ProjectActivities => Set<Domain.Entities.Projects.ProjectActivity>();
    public DbSet<Domain.Entities.Projects.ProjectMilestone> ProjectMilestones => Set<Domain.Entities.Projects.ProjectMilestone>();
    public DbSet<Domain.Entities.Projects.ProjectSituation> ProjectSituations => Set<Domain.Entities.Projects.ProjectSituation>();
    public DbSet<Domain.Entities.Projects.ProjectSubcontractor> ProjectSubcontractors => Set<Domain.Entities.Projects.ProjectSubcontractor>();
    public DbSet<Domain.Entities.Projects.ProjectBilling> ProjectBillings => Set<Domain.Entities.Projects.ProjectBilling>();
    public DbSet<Domain.Entities.Projects.TenantTimesheetSettings> TenantTimesheetSettings => Set<Domain.Entities.Projects.TenantTimesheetSettings>();
    public DbSet<Domain.Entities.Projects.EmployeeBillingTimeTarget> EmployeeBillingTimeTargets => Set<Domain.Entities.Projects.EmployeeBillingTimeTarget>();
    public DbSet<Domain.Entities.Projects.TimesheetTip> TimesheetTips => Set<Domain.Entities.Projects.TimesheetTip>();
    public DbSet<Domain.Entities.Projects.ProjectUpdate> ProjectUpdates => Set<Domain.Entities.Projects.ProjectUpdate>();
    public DbSet<Domain.Entities.Projects.TimeOffRequest> TimeOffRequests => Set<Domain.Entities.Projects.TimeOffRequest>();

    // Recurring contracts / B2B subscriptions — gated by AppModule.RecurringContracts.
    public DbSet<RecurringContract> RecurringContracts => Set<RecurringContract>();
    public DbSet<RecurringContractLine> RecurringContractLines => Set<RecurringContractLine>();
    public DbSet<UsageMetric> UsageMetrics => Set<UsageMetric>();
    public DbSet<UsageRecord> UsageRecords => Set<UsageRecord>();
    public DbSet<RecurringContractBillingRun> RecurringContractBillingRuns => Set<RecurringContractBillingRun>();
    public DbSet<RecurringContractAmendment> RecurringContractAmendments => Set<RecurringContractAmendment>();

    // Payroll Module (RH & Paie) — gated by AppModule.Payroll, tables created by migration AddPayrollModule_Tenant.
    public DbSet<Domain.Entities.Payroll.Employee> Employees => Set<Domain.Entities.Payroll.Employee>();
    public DbSet<Domain.Entities.Payroll.EmploymentContract> EmploymentContracts => Set<Domain.Entities.Payroll.EmploymentContract>();
    public DbSet<Domain.Entities.Payroll.ContractAllowance> ContractAllowances => Set<Domain.Entities.Payroll.ContractAllowance>();
    public DbSet<Domain.Entities.Payroll.PayrollRun> PayrollRuns => Set<Domain.Entities.Payroll.PayrollRun>();
    public DbSet<Domain.Entities.Payroll.Payslip> Payslips => Set<Domain.Entities.Payroll.Payslip>();
    public DbSet<Domain.Entities.Payroll.PayslipLine> PayslipLines => Set<Domain.Entities.Payroll.PayslipLine>();
    public DbSet<Domain.Entities.Payroll.PayrollYearParameters> PayrollYearParameters => Set<Domain.Entities.Payroll.PayrollYearParameters>();
    public DbSet<Domain.Entities.Payroll.PayrollIrppBracket> PayrollIrppBrackets => Set<Domain.Entities.Payroll.PayrollIrppBracket>();
    public DbSet<Domain.Entities.Payroll.LeaveRequest> LeaveRequests => Set<Domain.Entities.Payroll.LeaveRequest>();
    public DbSet<Domain.Entities.Payroll.EmployeePayrollSuspension> EmployeePayrollSuspensions => Set<Domain.Entities.Payroll.EmployeePayrollSuspension>();
    public DbSet<Domain.Entities.Payroll.EmployeeAdvance> EmployeeAdvances => Set<Domain.Entities.Payroll.EmployeeAdvance>();
    public DbSet<Domain.Entities.Payroll.PayrollOvertimeLine> PayrollOvertimeLines => Set<Domain.Entities.Payroll.PayrollOvertimeLine>();
    public DbSet<Domain.Entities.Payroll.PayrollVariableAllowanceLine> PayrollVariableAllowanceLines => Set<Domain.Entities.Payroll.PayrollVariableAllowanceLine>();
    public DbSet<Domain.Entities.Payroll.PayrollIrppRegularization> PayrollIrppRegularizations => Set<Domain.Entities.Payroll.PayrollIrppRegularization>();
    public DbSet<Domain.Entities.Payroll.LeaveBalanceAccrual> LeaveBalanceAccruals => Set<Domain.Entities.Payroll.LeaveBalanceAccrual>();
    public DbSet<Domain.Entities.Payroll.PayrollPayment> PayrollPayments => Set<Domain.Entities.Payroll.PayrollPayment>();
    public DbSet<Domain.Entities.Payroll.PayrollPaymentLine> PayrollPaymentLines => Set<Domain.Entities.Payroll.PayrollPaymentLine>();
    public DbSet<Domain.Entities.Payroll.CnssContributionPayment> CnssContributionPayments => Set<Domain.Entities.Payroll.CnssContributionPayment>();
    public DbSet<Domain.Entities.Payroll.SocialFundScheme> SocialFundSchemes => Set<Domain.Entities.Payroll.SocialFundScheme>();
    public DbSet<Domain.Entities.Payroll.EmployeeSocialFundEnrollment> EmployeeSocialFundEnrollments => Set<Domain.Entities.Payroll.EmployeeSocialFundEnrollment>();
    public DbSet<Domain.Entities.Payroll.PayrollMealVoucherLine> PayrollMealVoucherLines => Set<Domain.Entities.Payroll.PayrollMealVoucherLine>();
    public DbSet<Domain.Entities.Payroll.EmployeeInKindBenefit> EmployeeInKindBenefits => Set<Domain.Entities.Payroll.EmployeeInKindBenefit>();
    public DbSet<Domain.Entities.Payroll.EmployeeLoan> EmployeeLoans => Set<Domain.Entities.Payroll.EmployeeLoan>();
    public DbSet<Domain.Entities.Payroll.EmployeeLoanInstallment> EmployeeLoanInstallments => Set<Domain.Entities.Payroll.EmployeeLoanInstallment>();
    public DbSet<Domain.Entities.Payroll.EmployeeGarnishment> EmployeeGarnishments => Set<Domain.Entities.Payroll.EmployeeGarnishment>();
    public DbSet<Domain.Entities.Payroll.EmployeeGarnishmentInstallment> EmployeeGarnishmentInstallments => Set<Domain.Entities.Payroll.EmployeeGarnishmentInstallment>();
    public DbSet<Domain.Entities.Payroll.EmployeeDependentParent> EmployeeDependentParents => Set<Domain.Entities.Payroll.EmployeeDependentParent>();
    public DbSet<Domain.Entities.Payroll.PayrollGarnishmentBracket> PayrollGarnishmentBrackets => Set<Domain.Entities.Payroll.PayrollGarnishmentBracket>();
    public DbSet<Domain.Entities.Payroll.PayrollPublicHoliday> PayrollPublicHolidays => Set<Domain.Entities.Payroll.PayrollPublicHoliday>();
    public DbSet<Domain.Entities.Payroll.TerminationSettlement> TerminationSettlements => Set<Domain.Entities.Payroll.TerminationSettlement>();
    public DbSet<Domain.Entities.Payroll.AnnualBonusRule> AnnualBonusRules => Set<Domain.Entities.Payroll.AnnualBonusRule>();
    public DbSet<Domain.Entities.Payroll.EmployeeAnnualBonusRule> EmployeeAnnualBonusRules => Set<Domain.Entities.Payroll.EmployeeAnnualBonusRule>();
    public DbSet<Domain.Entities.Payroll.CnssIjClaim> CnssIjClaims => Set<Domain.Entities.Payroll.CnssIjClaim>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        // Ignore domain events - they are not database entities
        builder.Ignore<Domain.Common.DomainEvent>();
        builder.Ignore<InvoiceCreatedEvent>();
        builder.Ignore<InvoiceValidatedEvent>();
        builder.Ignore<InvoiceSignedEvent>();
        builder.Ignore<InvoicePaidEvent>();
        builder.Ignore<InvoiceCancelledEvent>();
        builder.Ignore<InvoiceArchivedEvent>();
        builder.Ignore<QuoteCreatedEvent>();
        builder.Ignore<QuoteSentEvent>();
        builder.Ignore<QuoteAcceptedEvent>();
        builder.Ignore<QuoteRejectedEvent>();
        builder.Ignore<QuoteCancelledEvent>();
        builder.Ignore<QuoteExpiredEvent>();
        builder.Ignore<QuoteConvertedToInvoiceEvent>();
        builder.Ignore<StockMovementRecordedEvent>();
        builder.Ignore<StockLowAlertEvent>();
        builder.Ignore<StockOutOfStockEvent>();
        builder.Ignore<InventoryStartedEvent>();
        builder.Ignore<InventoryValidatedEvent>();
        builder.Ignore<InventoryCancelledEvent>();
        builder.Ignore<InventoryAdjustmentItem>();
        builder.Ignore<DeliveryNoteCreatedEvent>();
        builder.Ignore<DeliveryNoteConfirmedEvent>();
        builder.Ignore<DeliveryNoteInTransitEvent>();
        builder.Ignore<DeliveryNoteDeliveredEvent>();
        builder.Ignore<DeliveryNoteFailedEvent>();
        builder.Ignore<DeliveryNoteCancelledEvent>();
        builder.Ignore<DeliveryNoteInvoicedEvent>();
        builder.Ignore<SalesReturnNoteCreatedEvent>();
        builder.Ignore<SalesReturnNoteConfirmedEvent>();
        builder.Ignore<InventorySummary>();
        builder.Ignore<InventorySummaryItem>();
        builder.Ignore<StockTransferCreatedEvent>();
        builder.Ignore<StockTransferConfirmedEvent>();
        builder.Ignore<StockTransferCompletedEvent>();
        builder.Ignore<StockTransferCancelledEvent>();
        builder.Ignore<PayrollRunValidatedEvent>();
        builder.Ignore<PayrollRunClosedEvent>();

        ConfigureClient(builder);
        ConfigureClientPortalContact(builder);
        ConfigureCompany(builder);
        ConfigureTax(builder);
        ConfigureProductCategory(builder);
        ConfigureProduct(builder);
        ConfigureInvoice(builder);
        ConfigureInvoiceLine(builder);
        ConfigureQuote(builder);
        ConfigureQuoteLine(builder);
        ConfigureSalesOrder(builder);
        ConfigureSalesOrderLine(builder);
        ConfigurePriceList(builder);
        ConfigurePriceListItem(builder);
        ConfigurePriceListItemTier(builder);
        ConfigurePromotion(builder);
        ConfigurePaymentTermTemplate(builder);
        ConfigureClientProductPrice(builder);
        ConfigurePayment(builder);
        ConfigureAuditLog(builder);
        ConfigureInvoiceDraft(builder);
        ConfigureInvoiceNumberSequence(builder);
        ConfigureQuoteNumberSequence(builder);
        ConfigureDocumentNumberingScheme(builder);
        ConfigureDocumentTemplatePreference(builder);
        ConfigureUserDashboardLayout(builder);
        ConfigureStudio(builder);
        ConfigureCashOperationNumberSequence(builder);
        ConfigureCashOperation(builder);
        ConfigureCashRegister(builder);
        ConfigureCashRegisterSession(builder);
        ConfigureZReport(builder);
        ConfigurePosCartDraft(builder);
        ConfigurePosHeldTicket(builder);
        ConfigureBankDepositNumberSequence(builder);
        ConfigureBankDeposit(builder);
        ConfigureBankAccount(builder);

        // Stock Management
        ConfigureWarehouse(builder);
        ConfigureStockItem(builder);
        ConfigureStockMovement(builder);
        ConfigureStockTraceability(builder);

        // Physical Inventory
        ConfigurePhysicalInventory(builder);
        ConfigureInventoryCountLine(builder);
        ConfigureInventoryNumberSequence(builder);

        // Delivery Notes
        ConfigureDeliveryNote(builder);
        ConfigureDeliveryNoteLine(builder);
        ConfigureSalesReturnNote(builder);
        ConfigureSalesReturnNoteLine(builder);

        // Purchasing
        ConfigureSupplier(builder);
        ConfigurePurchaseOrder(builder);
        ConfigurePurchaseOrderLine(builder);
        ConfigurePurchaseReceipt(builder);
        ConfigurePurchaseReceiptLine(builder);
        ConfigurePurchaseReceiptAttachment(builder);

        // Supplier Invoices
        ConfigureSupplierInvoice(builder);
        ConfigureSupplierInvoiceLine(builder);
        ConfigureSupplierPayment(builder);

        // Stock Transfers
        ConfigureStockTransfer(builder);
        ConfigureStockTransferLine(builder);
        ConfigureStockVoucher(builder);
        ConfigureStockVoucherLine(builder);

        ConfigureChartOfAccount(builder);
        ConfigureAccountingPeriod(builder);
        ConfigureAccountingYearLock(builder);
        ConfigureJournalEntrySequence(builder);
        ConfigureJournalEntry(builder);
        ConfigureJournalEntryLine(builder);
        ConfigureJournalCatalog(builder);
        ConfigureJournalEntryAttachment(builder);
        ConfigureLetteringGroup(builder);
        ConfigureLetteringGroupMember(builder);
        ConfigureVatDeclaration(builder);
        ConfigureFiscalSchedule(builder);
        ConfigureBudgeting(builder);
        ConfigureVatDeclarationLine(builder);
        ConfigureMonthlyDeclarationConfig(builder);
        ConfigureThirdPartyAccountingProfile(builder);
        ConfigureCurrency(builder);
        ConfigureCurrencyExchangeRate(builder);
        ConfigureBankStatement(builder);
        ConfigureBankStatementLine(builder);

        // Withholding Tax (TEJ)
        ConfigureWithholdingTaxType(builder);
        ConfigureWithholdingFiscalYearParameter(builder);
        ConfigureTejXmlExportLog(builder);

        // Liasse fiscale
        ConfigureIncomeTaxYearParameter(builder);
        ConfigureFiscalResultDeclaration(builder);

        ConfigureOpportunity(builder);
        ConfigureSalesActivity(builder);
        ConfigureSalesTarget(builder);
        ConfigureQuoteTemplate(builder);
        ConfigureQuoteTemplateLine(builder);
        ConfigureJournalEntryTemplate(builder);
        ConfigureJournalEntryTemplateLine(builder);

        ConfigureDepreciationRateCategory(builder);
        ConfigureFixedAsset(builder);
        ConfigureDepreciationScheduleLine(builder);
        ConfigureFixedAssetEvent(builder);
        ConfigureFixedAssetSettings(builder);
        ConfigurePayrollAccountingSettings(builder);
        ConfigureAppliedSectorTemplate(builder);
        ConfigureLoan(builder);
        ConfigureLoanScheduleLine(builder);
        ConfigureNctNoteOverride(builder);

        ConfigureConversation(builder);
        ConfigureConversationMessage(builder);
        ConfigureTenantAiProvider(builder);
        ConfigureAiExportAudit(builder);
        ConfigureChannelIdentityLink(builder);
        ConfigureChannelLinkCode(builder);
        ConfigureChannelInboundMessageLog(builder);

        // Public Virtual Street (tenant-side outbox for projection sync)
        ConfigureStorefrontOutboxMessage(builder);

        ConfigureDemoDataset(builder);

        // AI Forecasting Module — defined in TenantDbContext.Forecasting.cs (partial class).
        ConfigureForecasting(builder);

        // Trésorerie prévisionnelle par IA — defined in TenantDbContext.Treasury.cs (partial class).
        ConfigureTreasuryForecast(builder);

        // Honoraires Module — defined in TenantDbContext.Honoraires.cs (partial class).
        ConfigureHonoraires(builder);

        // Projects / PSA — defined in TenantDbContext.Projects.cs (partial class).
        ConfigureProjects(builder);

        // Recurring contracts — defined in TenantDbContext.RecurringContracts.cs (partial class).
        ConfigureRecurringContracts(builder);

        // Accounting audit module — defined in TenantDbContext.AccountingAudit.cs (partial class).
        ConfigureAccountingAudit(builder);

        // Payroll Module (RH & Paie) — defined in TenantDbContext.Payroll.cs (partial class).
        ConfigurePayroll(builder);

        // DOIT rester la dernière étape : normalise toutes les clés Guid.Id des entités du domaine
        // en ValueGenerated.Never (le constructeur d'Entity a déjà positionné l'Id). Voir
        // PersistenceConventions.ApplyClientGeneratedGuidKeys pour le détail.
        PersistenceConventions.ApplyClientGeneratedGuidKeys(builder);
    }

    private static void ConfigureDemoDataset(ModelBuilder builder)
    {
        builder.Entity<DemoDataset>(entity =>
        {
            entity.ToTable("DemoDatasets");
            entity.HasKey(d => d.Id);
            entity.Property(d => d.Version).HasMaxLength(32).IsRequired();
            entity.Property(d => d.AppliedAtUtc).IsRequired();
        });
    }

    private static void ConfigureStorefrontOutboxMessage(ModelBuilder builder)
    {
        builder.Entity<StorefrontOutboxMessage>(entity =>
        {
            entity.ToTable("StorefrontOutboxMessages");
            entity.HasKey(o => o.Id);

            entity.Property(o => o.EventType)
                .HasMaxLength(200)
                .IsRequired();

            entity.Property(o => o.AggregateType)
                .HasMaxLength(100)
                .IsRequired();

            entity.Property(o => o.PayloadJson)
                .IsRequired();

            entity.Property(o => o.OccurredAt).IsRequired();
            entity.Property(o => o.AttemptCount).HasDefaultValue(0);
            entity.Property(o => o.LastError).HasMaxLength(500);

            entity.HasIndex(o => new { o.ProcessedAt, o.OccurredAt })
                .HasDatabaseName("IX_StorefrontOutbox_Pending");

            entity.HasIndex(o => o.AggregateId)
                .HasDatabaseName("IX_StorefrontOutbox_AggregateId");
        });
    }

    private static void ConfigureClient(ModelBuilder builder)
    {
        builder.Entity<Client>(entity =>
        {
            entity.ToTable("Clients");
            entity.HasKey(c => c.Id);

            entity.Property(c => c.Name)
                .HasMaxLength(200)
                .IsRequired();

            entity.Property(c => c.ContactPerson)
                .HasMaxLength(200);

            entity.Property(c => c.Notes)
                .HasMaxLength(1000);

            entity.OwnsOne(c => c.NIF, nif =>
            {
                nif.Property(n => n.Value)
                    .HasColumnName("NIF")
                    .HasMaxLength(20);
            });

            entity.OwnsOne(c => c.Address, addr =>
            {
                addr.Property(a => a.Street).HasColumnName("Street").HasMaxLength(200).IsRequired();
                addr.Property(a => a.StreetLine2).HasColumnName("StreetLine2").HasMaxLength(200);
                addr.Property(a => a.City).HasColumnName("City").HasMaxLength(100).IsRequired();
                addr.Property(a => a.PostalCode).HasColumnName("PostalCode").HasMaxLength(20);
                addr.Property(a => a.Governorate).HasColumnName("Governorate").HasMaxLength(100).IsRequired();
                addr.Property(a => a.Country).HasColumnName("Country").HasMaxLength(100).IsRequired();
            });

            entity.OwnsOne(c => c.Email, email =>
            {
                email.Property(e => e.Value)
                    .HasColumnName("Email")
                    .HasMaxLength(256)
                    .IsRequired();
            });

            entity.OwnsOne(c => c.Phone, phone =>
            {
                phone.Property(p => p.Value)
                    .HasColumnName("Phone")
                    .HasMaxLength(20);
                phone.Ignore(p => p.CountryCode);
                phone.Ignore(p => p.LocalNumber);
            });

            entity.HasIndex(c => c.Name);
            entity.HasIndex(c => c.IsActive);

            entity.Property(c => c.AssignedUserId).IsRequired(false);
            entity.Property(c => c.AssignedUserName).HasMaxLength(200).IsRequired(false);
            entity.HasIndex(c => c.AssignedUserId);

            // TEJ fields
            entity.Property(c => c.TejIdentificationType).HasConversion<int?>().IsRequired(false);
            entity.Property(c => c.DateOfBirth).IsRequired(false);
            entity.Property(c => c.CountryCode).HasMaxLength(3).IsRequired(false);
            entity.Property(c => c.IsResident).HasDefaultValue(true);
            entity.Property(c => c.Activity).HasMaxLength(200).IsRequired(false);

            // Régime de TVA du client. Normal par défaut : les clients existants conservent
            // exactement leur comportement de facturation.
            entity.Property(c => c.VatRegime)
                .HasConversion<int>()
                .HasDefaultValue(ClientVatRegime.Normal)
                .IsRequired();

            // Index filtré : retrouver les clients à régime particulier — et parmi eux ceux
            // dont l'attestation expire — est une requête de pilotage courante. Le filtre
            // écarte les assujettis ordinaires, qui sont l'immense majorité.
            entity.HasIndex(c => c.VatRegime)
                .HasFilter("[VatRegime] <> 0");

            // Attestation de suspension (art. 11). Type possédé nullable : les trois colonnes
            // n'existent que pour les clients en suspension.
            entity.OwnsOne(c => c.VatExemptionCertificate, cert =>
            {
                cert.Property(x => x.Number)
                    .HasColumnName("VatExemptionCertificateNumber")
                    .HasMaxLength(50);

                cert.Property(x => x.ValidFrom)
                    .HasColumnName("VatExemptionValidFrom");

                cert.Property(x => x.ValidUntil)
                    .HasColumnName("VatExemptionValidUntil");
            });

            // Grille tarifaire affectée (lot 5). Nullable : la plupart des clients restent
            // au tarif catalogue. Pas de contrainte de clé étrangère — l'affectation survit à
            // la désactivation d'une grille, le résolveur ignorant simplement une grille absente.
            entity.Property(c => c.PriceListId).IsRequired(false);

            // Encours client (lot 6). Le plafond AVERTIT, il ne bloque pas : aucune contrainte
            // ne le fait respecter, c'est un repere pour le commercial.
            entity.Property(c => c.CreditLimit).HasPrecision(18, 3).IsRequired(false);
            entity.Property(c => c.DefaultPaymentTermDays).IsRequired(false);
            entity.HasIndex(c => c.PriceListId)
                .HasFilter("[PriceListId] IS NOT NULL");
        });
    }

    private static void ConfigurePriceList(ModelBuilder builder)
    {
        builder.Entity<PriceList>(entity =>
        {
            entity.ToTable("PriceLists");
            entity.HasKey(p => p.Id);

            entity.Property(p => p.Name).HasMaxLength(100).IsRequired();
            entity.Property(p => p.Currency).HasMaxLength(3).IsRequired();
            entity.Property(p => p.IsActive).IsRequired();
            entity.Property(p => p.ValidFrom).IsRequired(false);
            entity.Property(p => p.ValidUntil).IsRequired(false);

            entity.HasMany(p => p.Items)
                .WithOne()
                .HasForeignKey(i => i.PriceListId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(p => p.IsActive);
        });
    }

    private static void ConfigurePriceListItem(ModelBuilder builder)
    {
        builder.Entity<PriceListItem>(entity =>
        {
            entity.ToTable("PriceListItems");
            entity.HasKey(i => i.Id);

            entity.Property(i => i.PriceListId).IsRequired();
            entity.Property(i => i.ProductId).IsRequired();

            ConfigureOwnedMoney(entity, i => i.UnitPriceHT, "UnitPriceHT");

            entity.HasMany(i => i.Tiers)
                .WithOne()
                .HasForeignKey(t => t.PriceListItemId)
                .OnDelete(DeleteBehavior.Cascade);

            // Un seul prix par produit dans une grille : l'upsert du domaine s'y appuie.
            entity.HasIndex(i => new { i.PriceListId, i.ProductId }).IsUnique();
        });
    }

    private static void ConfigurePriceListItemTier(ModelBuilder builder)
    {
        builder.Entity<PriceListItemTier>(entity =>
        {
            entity.ToTable("PriceListItemTiers");
            entity.HasKey(t => t.Id);

            entity.Property(t => t.PriceListItemId).IsRequired();
            entity.Property(t => t.MinQuantity).HasPrecision(18, 4).IsRequired();

            ConfigureOwnedMoney(entity, t => t.UnitPriceHT, "UnitPriceHT");

            // Un seul palier par seuil : l'upsert du domaine s'y appuie.
            entity.HasIndex(t => new { t.PriceListItemId, t.MinQuantity }).IsUnique();
        });
    }

    private static void ConfigurePromotion(ModelBuilder builder)
    {
        builder.Entity<Promotion>(entity =>
        {
            entity.ToTable("Promotions");
            entity.HasKey(p => p.Id);

            entity.Property(p => p.Name).HasMaxLength(100).IsRequired();
            entity.Property(p => p.DiscountType).HasConversion<int>().IsRequired();
            entity.Property(p => p.DiscountPercent).HasPrecision(5, 2).IsRequired(false);
            entity.Property(p => p.MinQuantity).HasPrecision(18, 4).IsRequired();
            entity.Property(p => p.StartsOn).IsRequired();
            entity.Property(p => p.EndsOn).IsRequired();
            entity.Property(p => p.IsActive).IsRequired();
            entity.Property(p => p.Priority).IsRequired();

            // Remise en valeur : optionnelle, seule la forme « montant » la renseigne.
            entity.OwnsOne(p => p.DiscountAmount, money =>
            {
                money.Property(m => m.Amount)
                    .HasColumnName("DiscountAmount").HasPrecision(18, 3);
                money.Property(m => m.Currency)
                    .HasColumnName("DiscountAmountCurrency").HasMaxLength(3);
            });

            // Le résolveur cherche les promotions qui COURENT à une date : c'est le filtre
            // qui porte la requête, pas les cibles.
            entity.HasIndex(p => new { p.IsActive, p.StartsOn, p.EndsOn });
            entity.HasIndex(p => p.ProductId).HasFilter("[ProductId] IS NOT NULL");
            entity.HasIndex(p => p.ClientId).HasFilter("[ClientId] IS NOT NULL");
        });
    }

    private static void ConfigurePaymentTermTemplate(ModelBuilder builder)
    {
        builder.Entity<PaymentTermTemplate>(entity =>
        {
            entity.ToTable("PaymentTermTemplates");
            entity.HasKey(t => t.Id);

            entity.Property(t => t.Name).HasMaxLength(100).IsRequired();
            entity.Property(t => t.DelayDays).IsRequired();
            entity.Property(t => t.DueMode).HasConversion<int>().IsRequired();
            entity.Property(t => t.DueDayOfMonth).IsRequired(false);
            entity.Property(t => t.EarlyPaymentDiscountPercent).HasPrecision(5, 2).IsRequired(false);
            entity.Property(t => t.EarlyPaymentDays).IsRequired(false);
            entity.Property(t => t.IsActive).IsRequired();
            entity.Property(t => t.IsDefault).IsRequired();

            // Une seule condition par défaut : l'index filtré le garantit en base plutôt que
            // de compter sur la discipline applicative.
            entity.HasIndex(t => t.IsDefault).IsUnique().HasFilter("[IsDefault] = 1");
        });
    }

    private static void ConfigureClientProductPrice(ModelBuilder builder)
    {
        builder.Entity<ClientProductPrice>(entity =>
        {
            entity.ToTable("ClientProductPrices");
            entity.HasKey(p => p.Id);

            entity.Property(p => p.ClientId).IsRequired();
            entity.Property(p => p.ProductId).IsRequired();
            entity.Property(p => p.IsActive).IsRequired();
            entity.Property(p => p.ValidFrom).IsRequired(false);
            entity.Property(p => p.ValidUntil).IsRequired(false);

            ConfigureOwnedMoney(entity, p => p.UnitPriceHT, "UnitPriceHT");

            // Un prix négocié par couple client / produit : le résolveur en attend au plus un.
            entity.HasIndex(p => new { p.ClientId, p.ProductId }).IsUnique();
        });
    }

    private static void ConfigureCompany(ModelBuilder builder)
    {
        builder.Entity<Company>(entity =>
        {
            entity.ToTable("Companies");
            entity.HasKey(c => c.Id);

            entity.Property(c => c.Name)
                .HasMaxLength(200)
                .IsRequired();

            entity.Property(c => c.TradeName)
                .HasMaxLength(200);

            entity.Property(c => c.CommerceRegistry)
                .HasMaxLength(50);

            entity.Property(c => c.VatCode)
                .HasMaxLength(50);

            entity.Property(c => c.LogoUrl)
                .HasMaxLength(500);

            entity.Property(c => c.BankName)
                .HasMaxLength(100);

            entity.Property(c => c.Iban)
                .HasMaxLength(34);

            entity.Property(c => c.Rib)
                .HasMaxLength(24);

            // TEJ fields
            entity.Property(c => c.EstablishmentCode).HasMaxLength(20).IsRequired(false);
            entity.Property(c => c.TejAdherentSince).IsRequired(false);
            entity.Property(c => c.TejCategory).HasConversion<int?>().IsRequired(false);
            entity.Property(c => c.CnssEmployerNumber).HasMaxLength(20).IsRequired(false);

            entity.OwnsOne(c => c.Nif, nif =>
            {
                nif.Property(n => n.Value)
                    .HasColumnName("NIF")
                    .HasMaxLength(20)
                    .IsRequired();
            });

            entity.OwnsOne(c => c.Address, addr =>
            {
                addr.Property(a => a.Street).HasColumnName("Street").HasMaxLength(200).IsRequired();
                addr.Property(a => a.StreetLine2).HasColumnName("StreetLine2").HasMaxLength(200);
                addr.Property(a => a.City).HasColumnName("City").HasMaxLength(100).IsRequired();
                addr.Property(a => a.PostalCode).HasColumnName("PostalCode").HasMaxLength(20);
                addr.Property(a => a.Governorate).HasColumnName("Governorate").HasMaxLength(100).IsRequired();
                addr.Property(a => a.Country).HasColumnName("Country").HasMaxLength(100).IsRequired();
            });

            entity.OwnsOne(c => c.Email, email =>
            {
                email.Property(e => e.Value)
                    .HasColumnName("Email")
                    .HasMaxLength(256)
                    .IsRequired();
            });

            entity.OwnsOne(c => c.Phone, phone =>
            {
                phone.Property(p => p.Value)
                    .HasColumnName("Phone")
                    .HasMaxLength(20);
                phone.Ignore(p => p.CountryCode);
                phone.Ignore(p => p.LocalNumber);
            });

            entity.HasIndex(c => c.Name);
            entity.HasIndex(c => c.IsDefault);
            entity.HasIndex(c => c.IsActive);
            entity.Property(c => c.ClientPortalEnabled).HasDefaultValue(true);
        });
    }

    private static void ConfigureClientPortalContact(ModelBuilder builder)
    {
        builder.Entity<ClientPortalContact>(entity =>
        {
            entity.ToTable("ClientPortalContacts");
            entity.HasKey(c => c.Id);
            entity.Property(c => c.Email).HasMaxLength(256).IsRequired();
            entity.Property(c => c.DisplayName).HasMaxLength(200).IsRequired();
            entity.Property(c => c.Status).HasConversion<int>();
            entity.HasIndex(c => c.ClientId);
            entity.HasIndex(c => c.UserId);
            entity.HasIndex(c => new { c.ClientId, c.Email });
        });
    }

    private static void ConfigureTax(ModelBuilder builder)
    {
        builder.Entity<Tax>(entity =>
        {
            entity.ToTable("Taxes");
            entity.HasKey(t => t.Id);

            entity.Property(t => t.Name)
                .HasMaxLength(100)
                .IsRequired();

            entity.Property(t => t.Type)
                .HasColumnName("TaxType")
                .HasConversion<int>();

            entity.Property(t => t.ValueType)
                .HasConversion<int>();

            entity.Property(t => t.Context)
                .HasColumnName("ApplicableContext")
                .HasConversion<int>();

            entity.Property(t => t.Value)
                .HasPrecision(18, 3);

            entity.HasIndex(t => t.Type);
            entity.HasIndex(t => t.IsActive);
            entity.HasIndex(t => t.DisplayOrder);
        });
    }

    private static void ConfigureProductCategory(ModelBuilder builder)
    {
        builder.Entity<ProductCategory>(entity =>
        {
            entity.ToTable("ProductCategories");
            entity.HasKey(c => c.Id);

            entity.Property(c => c.Code)
                .HasMaxLength(50)
                .IsRequired();

            entity.Property(c => c.Name)
                .HasMaxLength(100)
                .IsRequired();

            entity.HasIndex(c => c.Code).IsUnique();
            entity.HasIndex(c => c.IsActive);
        });
    }

    private static void ConfigureProduct(ModelBuilder builder)
    {
        builder.Entity<Product>(entity =>
        {
            entity.ToTable("Products");
            entity.HasKey(p => p.Id);

            entity.Property(p => p.Code)
                .HasMaxLength(50)
                .IsRequired();

            entity.Property(p => p.Name)
                .HasMaxLength(200)
                .IsRequired();

            entity.Property(p => p.Description)
                .HasMaxLength(1000);

            entity.Property(p => p.Unit)
                .HasMaxLength(50);

            entity.Property(p => p.ImageUrl)
                .HasMaxLength(500);

            entity.HasOne(p => p.Category)
                .WithMany()
                .HasForeignKey(p => p.CategoryId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(p => p.CategoryId);

            entity.OwnsOne(p => p.UnitPrice, price =>
            {
                price.Property(m => m.Amount)
                    .HasColumnName("UnitPrice")
                    .HasPrecision(18, 3)
                    .IsRequired();

                price.Property(m => m.Currency)
                    .HasColumnName("Currency")
                    .HasMaxLength(3)
                    .IsRequired();
            });

            entity.OwnsOne(p => p.PurchasePrice, price =>
            {
                price.Property(m => m.Amount)
                    .HasColumnName("PurchasePrice")
                    .HasPrecision(18, 3);

                price.Property(m => m.Currency)
                    .HasColumnName("PurchasePriceCurrency")
                    .HasMaxLength(3);
            });

            entity.OwnsOne(p => p.LastPurchasePrice, price =>
            {
                price.Property(m => m.Amount)
                    .HasColumnName("LastPurchasePrice")
                    .HasPrecision(18, 3);

                price.Property(m => m.Currency)
                    .HasColumnName("LastPurchasePriceCurrency")
                    .HasMaxLength(3);
            });

            entity.Property(p => p.ProfitMarginPercent)
                .HasPrecision(7, 3);

            entity.Property(p => p.IsDiscountEnabled)
                .HasDefaultValue(false);

            entity.Property(p => p.MaxDiscountPercent)
                .HasPrecision(5, 2);

            entity.HasIndex(p => p.Code).IsUnique();
            entity.HasIndex(p => p.Name);
            entity.HasIndex(p => p.IsActive);

            entity.Property(p => p.IsPubliclyListed).HasDefaultValue(false);
            // Code-barres. Type possédé : une colonne nullable, contrainte de format portée
            // par le value object. La symbologie n'est PAS stockée : elle se dérive de la
            // valeur. Ajouter une colonne non-nullable à un type possédé optionnel rendrait
            // illisibles les articles déjà en base (EF utilise Value comme sentinelle de
            // présence) — voir docs/architecture/adr-barcode-symbologies.md.
            //
            // 48 caractères : EAN-8/13, UPC-A, GTIN-14 et Code128 alphanumérique. La clé
            // d'index reste à 96 octets, très en-deçà de la limite de 1700.
            //
            // L'index est NON unique à ce stade — l'unicité par tenant ne sera livrée
            // qu'après balayage des doublons sur tout le parc, comme pour l'unicité des
            // numéros de facture (docs/runbooks/invoice-number-uniqueness.md).
            entity.OwnsOne(p => p.Barcode, bc =>
            {
                bc.Property(x => x.Value)
                    .HasColumnName("Barcode")
                    .HasMaxLength(48);

                bc.HasIndex(x => x.Value)
                    .HasDatabaseName("IX_Products_Barcode")
                    .HasFilter("[Barcode] IS NOT NULL");
            });

            entity.Property(p => p.IsFodecApplicable).HasDefaultValue(false);
            entity.HasIndex(p => p.IsPubliclyListed);

            entity.Property(p => p.IsVariantTemplate).HasDefaultValue(false);
            entity.Property(p => p.HasExpiryTracking).HasDefaultValue(false);
            entity.Property(p => p.TrackingMode).HasConversion<int>().HasDefaultValue(TrackingMode.None);
            entity.Property(p => p.PickingPolicy).HasConversion<int>().HasDefaultValue(PickingPolicy.None);
            entity.Property(p => p.CostingMethod).HasConversion<int>().HasDefaultValue(CostingMethod.Average);
            entity.HasIndex(p => p.ParentProductId);
            entity.HasIndex(p => p.IsVariantTemplate);
            entity.HasOne<Product>()
                .WithMany()
                .HasForeignKey(p => p.ParentProductId)
                .OnDelete(DeleteBehavior.Restrict)
                .IsRequired(false);
        });
    }

    private static void ConfigureInvoice(ModelBuilder builder)
    {
        builder.Entity<Invoice>(entity =>
        {
            entity.ToTable("Invoices");
            entity.HasKey(i => i.Id);

            entity.Property(i => i.Type)
                .HasConversion<int>()
                .HasColumnName("Type")
                .IsRequired()
                .HasDefaultValue(InvoiceType.Standard);

            entity.Property(i => i.Reference)
                .HasMaxLength(100);

            entity.Property(i => i.Notes)
                .HasMaxLength(2000);

            entity.Property(i => i.PaymentTerms)
                .HasMaxLength(500);

            entity.Property(i => i.SignatureHash)
                .HasMaxLength(500);

            entity.Property(i => i.SignedBy)
                .HasMaxLength(256);

            entity.Property(i => i.CancellationReason)
                .HasMaxLength(500);

            entity.Property(i => i.SourceQuoteId);

            // Lien BL → facture. Index filtré : seules les factures issues d'un BL sont indexées.
            entity.Property(i => i.SourceDeliveryNoteId);
            entity.HasIndex(i => i.SourceDeliveryNoteId)
                .HasFilter("[SourceDeliveryNoteId] IS NOT NULL");

            // Lien avoir → facture rectifiée. Index filtré : seuls les avoirs sont indexés.
            entity.Property(i => i.LinkedInvoiceId);
            entity.HasIndex(i => i.LinkedInvoiceId)
                .HasFilter("[LinkedInvoiceId] IS NOT NULL");

            // Lien commande → facture (facturation directe ou remontée depuis un BL).
            entity.Property(i => i.SourceSalesOrderId);
            entity.HasIndex(i => i.SourceSalesOrderId)
                .HasFilter("[SourceSalesOrderId] IS NOT NULL");

            entity.Property(i => i.SourceProjectId);
            entity.HasIndex(i => i.SourceProjectId)
                .HasFilter("[SourceProjectId] IS NOT NULL");

            entity.Property(i => i.SourceProjectBillingId);
            entity.HasIndex(i => i.SourceProjectBillingId)
                .HasFilter("[SourceProjectBillingId] IS NOT NULL");

            entity.Property(i => i.SourceRecurringContractId);
            entity.HasIndex(i => i.SourceRecurringContractId)
                .HasFilter("[SourceRecurringContractId] IS NOT NULL");

            entity.Property(i => i.SourceRecurringContractBillingRunId);
            entity.HasIndex(i => i.SourceRecurringContractBillingRunId)
                .HasFilter("[SourceRecurringContractBillingRunId] IS NOT NULL");

            entity.Property(i => i.IssuerCompanyId);

            entity.Property(i => i.ElectronicInvoiceTtn)
                .HasMaxLength(200);

            entity.Property(i => i.ElectronicInvoiceSentAt);

            entity.OwnsOne(i => i.Number, num =>
            {
                num.Property(n => n.Value)
                    .HasColumnName("Number")
                    .HasMaxLength(50)
                    .IsRequired();

                num.Property(n => n.Prefix)
                    .HasColumnName("NumberPrefix")
                    .HasMaxLength(10)
                    .IsRequired();

                num.Property(n => n.Year)
                    .HasColumnName("NumberYear")
                    .IsRequired();

                num.Property(n => n.Sequence)
                    .HasColumnName("NumberSequence")
                    .IsRequired();

                // Recherche par numéro (SearchAsync) + contrôles de séquence.
                // Non unique à ce stade : l'unicité (exigence fiscale) sera ajoutée par une
                // migration dédiée APRÈS le balayage des doublons sur tous les tenants
                // (une migration unique qui échoue bloquerait le tenant via TenantMigrationGuard).
                // Balayage 2026-07-18 : doublons détectés → migration différée.
                // Procédure : docs/runbooks/invoice-number-uniqueness.md ;
                // balayage : GET /api/platform/migrations/tenants/invoice-number-integrity.
                num.HasIndex(n => n.Value)
                    .HasDatabaseName("IX_Invoices_Number");

                num.HasIndex(n => new { n.Year, n.Prefix, n.Sequence })
                    .HasDatabaseName("IX_Invoices_NumberYear_NumberPrefix_NumberSequence");
            });

            entity.OwnsOne(i => i.SubTotal, price =>
            {
                price.Property(m => m.Amount)
                    .HasColumnName("SubTotal")
                    .HasPrecision(18, 3)
                    .IsRequired();

                price.Property(m => m.Currency)
                    .HasColumnName("SubTotalCurrency")
                    .HasMaxLength(3)
                    .IsRequired();
            });

            entity.OwnsOne(i => i.FodecAmount, price =>
            {
                price.Property(m => m.Amount)
                    .HasColumnName("FodecAmount")
                    .HasPrecision(18, 3)
                    .IsRequired();

                price.Property(m => m.Currency)
                    .HasColumnName("FodecAmountCurrency")
                    .HasMaxLength(3)
                    .IsRequired();
            });

            entity.OwnsOne(i => i.TotalVat, price =>
            {
                price.Property(m => m.Amount)
                    .HasColumnName("TotalVat")
                    .HasPrecision(18, 3)
                    .IsRequired();

                price.Property(m => m.Currency)
                    .HasColumnName("TotalVatCurrency")
                    .HasMaxLength(3)
                    .IsRequired();
            });

            entity.OwnsOne(i => i.TotalAmount, price =>
            {
                price.Property(m => m.Amount)
                    .HasColumnName("TotalAmount")
                    .HasPrecision(18, 3)
                    .IsRequired();

                price.Property(m => m.Currency)
                    .HasColumnName("TotalAmountCurrency")
                    .HasMaxLength(3)
                    .IsRequired();
            });

            entity.OwnsOne(i => i.FiscalStampAmount, price =>
            {
                price.Property(m => m.Amount)
                    .HasColumnName("FiscalStampAmount")
                    .HasPrecision(18, 3)
                    .IsRequired();

                price.Property(m => m.Currency)
                    .HasColumnName("FiscalStampCurrency")
                    .HasMaxLength(3)
                    .IsRequired();
            });

            entity.HasOne(i => i.Client)
                .WithMany(c => c.Invoices)
                .HasForeignKey(i => i.ClientId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasMany(i => i.Lines)
                .WithOne(l => l.Invoice)
                .HasForeignKey(l => l.InvoiceId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(i => i.Warehouse)
                .WithMany()
                .HasForeignKey(i => i.WarehouseId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(i => i.Status);
            entity.HasIndex(i => i.IssueDate);
            entity.HasIndex(i => i.DueDate);
            entity.HasIndex(i => i.ClientId);
            entity.HasIndex(i => i.SourceQuoteId);
            entity.HasIndex(i => i.WarehouseId);
            entity.HasIndex(i => i.IssuerCompanyId);
            entity.HasIndex(i => i.CashRegisterSessionId)
                .HasFilter("[CashRegisterSessionId] IS NOT NULL");

            // Remise de pied de document (tranche 5B). Le montant est persisté : il fait foi au
            // rechargement, quand le pourcentage n'est pas renseigné.
            entity.Property(x => x.GlobalDiscountPercent).HasPrecision(5, 2).IsRequired(false);
            ConfigureOwnedMoney(entity, x => x.GlobalDiscountAmount, "GlobalDiscountAmount");

            // Dérivé de SubTotal + GlobalDiscountAmount : calculé, jamais stocké.
            entity.Ignore(x => x.SubTotalBeforeGlobalDiscount);

        });
    }

    private static void ConfigureInvoiceLine(ModelBuilder builder)
    {
        builder.Entity<InvoiceLine>(entity =>
        {
            entity.ToTable("InvoiceLines");
            entity.HasKey(l => l.Id);

            entity.Property(l => l.ProductCode)
                .HasMaxLength(50)
                .IsRequired();

            entity.Property(l => l.ProductName)
                .HasMaxLength(200)
                .IsRequired();

            entity.Property(l => l.ProductDescription)
                .HasMaxLength(1000);

            entity.Property(l => l.Unit)
                .HasMaxLength(50);

            entity.Property(l => l.Quantity)
                .HasPrecision(18, 4);

            entity.Property(l => l.DiscountPercent)
                .HasPrecision(5, 2);

            entity.Property(l => l.AppliedPromotionName)
                .HasMaxLength(100);

            entity.Property(l => l.IsFodecApplicable)
                .HasDefaultValue(false);

            entity.OwnsOne(l => l.UnitPrice, price =>
            {
                price.Property(m => m.Amount)
                    .HasColumnName("UnitPrice")
                    .HasPrecision(18, 3)
                    .IsRequired();

                price.Property(m => m.Currency)
                    .HasColumnName("UnitPriceCurrency")
                    .HasMaxLength(3)
                    .IsRequired();
            });

            entity.OwnsOne(l => l.DiscountAmount, price =>
            {
                price.Property(m => m.Amount)
                    .HasColumnName("DiscountAmount")
                    .HasPrecision(18, 3)
                    .IsRequired();

                price.Property(m => m.Currency)
                    .HasColumnName("DiscountAmountCurrency")
                    .HasMaxLength(3)
                    .IsRequired();
            });

            entity.OwnsOne(l => l.SubTotal, price =>
            {
                price.Property(m => m.Amount)
                    .HasColumnName("SubTotal")
                    .HasPrecision(18, 3)
                    .IsRequired();

                price.Property(m => m.Currency)
                    .HasColumnName("SubTotalCurrency")
                    .HasMaxLength(3)
                    .IsRequired();
            });

            entity.OwnsOne(l => l.FodecAmount, price =>
            {
                price.Property(m => m.Amount)
                    .HasColumnName("FodecAmount")
                    .HasPrecision(18, 3)
                    .IsRequired();

                price.Property(m => m.Currency)
                    .HasColumnName("FodecAmountCurrency")
                    .HasMaxLength(3)
                    .IsRequired();
            });

            entity.OwnsOne(l => l.VatAmount, price =>
            {
                price.Property(m => m.Amount)
                    .HasColumnName("VatAmount")
                    .HasPrecision(18, 3)
                    .IsRequired();

                price.Property(m => m.Currency)
                    .HasColumnName("VatAmountCurrency")
                    .HasMaxLength(3)
                    .IsRequired();
            });

            entity.OwnsOne(l => l.Total, price =>
            {
                price.Property(m => m.Amount)
                    .HasColumnName("Total")
                    .HasPrecision(18, 3)
                    .IsRequired();

                price.Property(m => m.Currency)
                    .HasColumnName("TotalCurrency")
                    .HasMaxLength(3)
                    .IsRequired();
            });

            entity.HasOne(l => l.Product)
                .WithMany()
                .HasForeignKey(l => l.ProductId)
                .IsRequired(false)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(l => l.InvoiceId);

            // Part de la remise de pied imputée à la ligne (tranche 5B). Zéro sur tout
            // l'existant : la ligne se calcule alors comme avant.
            ConfigureOwnedMoney(entity, x => x.AllocatedGlobalDiscount, "AllocatedGlobalDiscount");
            entity.Ignore(x => x.SubTotalBeforeGlobalDiscount);

        });
    }

    private static void ConfigurePayment(ModelBuilder builder)
    {
        builder.Entity<Payment>(entity =>
        {
            entity.ToTable("Payments");
            entity.HasKey(p => p.Id);

            entity.Property(p => p.Reference)
                .HasMaxLength(100);

            entity.Property(p => p.Notes)
                .HasMaxLength(500);

            entity.Property(p => p.RefundReason)
                .HasMaxLength(500);

            entity.Property(p => p.ClientWithholdingAmount)
                .HasPrecision(18, 3);

            entity.OwnsOne(p => p.Amount, price =>
            {
                price.Property(m => m.Amount)
                    .HasColumnName("Amount")
                    .HasPrecision(18, 3)
                    .IsRequired();

                price.Property(m => m.Currency)
                    .HasColumnName("Currency")
                    .HasMaxLength(3)
                    .IsRequired();
            });

            entity.HasOne(p => p.Invoice)
                .WithMany()
                .HasForeignKey(p => p.InvoiceId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(p => p.InvoiceId);
            entity.HasIndex(p => p.PaymentDate);
            entity.HasIndex(p => p.CashRegisterSessionId)
                .HasFilter("[CashRegisterSessionId] IS NOT NULL");
        });
    }

    private static void ConfigureCashOperation(ModelBuilder builder)
    {
        builder.Entity<CashOperation>(entity =>
        {
            entity.ToTable("CashExpenses");
            entity.HasKey(e => e.Id);

            entity.Property(e => e.OperationType)
                .IsRequired()
                .HasDefaultValue(CashOperationType.Debit);

            entity.Property(e => e.OperationDate)
                .HasColumnName("ExpenseDate")
                .IsRequired();

            entity.Property(e => e.Method)
                .IsRequired();

            entity.Property(e => e.Label)
                .HasMaxLength(500)
                .IsRequired();

            entity.Property(e => e.Category);

            entity.Property(e => e.RevenueCategory);

            entity.Property(e => e.VatRate);

            entity.Property(e => e.Reference)
                .HasMaxLength(100);

            entity.Property(e => e.Notes)
                .HasMaxLength(500);

            entity.Property(e => e.Status)
                .IsRequired();

            entity.Property(e => e.Origin)
                .IsRequired()
                .HasDefaultValue(CashOperationOrigin.Manual);

            entity.Property(e => e.SourceType)
                .HasMaxLength(50);

            entity.Property(e => e.SourceId);

            entity.Property(e => e.CancelledAt);

            entity.Property(e => e.CancellationReason)
                .HasMaxLength(500);

            entity.OwnsOne(e => e.Amount, price =>
            {
                price.Property(m => m.Amount)
                    .HasColumnName("Amount")
                    .HasPrecision(18, 3)
                    .IsRequired();

                price.Property(m => m.Currency)
                    .HasColumnName("AmountCurrency")
                    .HasMaxLength(3)
                    .IsRequired();
            });

            entity.OwnsOne(e => e.Number, num =>
            {
                num.Property(n => n.Value)
                    .HasColumnName("ExpenseNumber")
                    .HasMaxLength(50)
                    .IsRequired();

                num.Property(n => n.Year)
                    .HasColumnName("ExpenseNumberYear")
                    .IsRequired();

                num.Property(n => n.Sequence)
                    .HasColumnName("ExpenseNumberSequence")
                    .IsRequired();

                num.Property(n => n.PrefixValue)
                    .HasColumnName("ExpenseNumberPrefix")
                    .HasMaxLength(10)
                    .IsRequired();

                num.HasIndex(n => n.Value)
                    .IsUnique();
            });

            entity.HasIndex(e => e.OperationDate);
            entity.HasIndex(e => e.Status);
            entity.HasIndex(e => e.Method);
            entity.HasIndex(e => e.OperationType);
            entity.HasIndex(e => new { e.SourceType, e.SourceId });
            entity.HasIndex(e => new { e.Origin, e.SourceType, e.SourceId })
                .IsUnique()
                .HasFilter("[SourceId] IS NOT NULL");
            entity.HasIndex(e => e.CashRegisterSessionId)
                .HasFilter("[CashRegisterSessionId] IS NOT NULL");
        });
    }

    private static void ConfigureCashRegister(ModelBuilder builder)
    {
        builder.Entity<CashRegister>(entity =>
        {
            entity.ToTable("CashRegisters");
            entity.HasKey(e => e.Id);

            entity.Property(e => e.Version).IsConcurrencyToken();

            entity.Property(e => e.Code)
                .HasMaxLength(20)
                .IsRequired();

            entity.Property(e => e.Name)
                .HasMaxLength(100)
                .IsRequired();

            entity.Property(e => e.IsActive)
                .IsRequired();

            entity.Property(e => e.IsDefault)
                .IsRequired();

            entity.HasOne(e => e.Warehouse)
                .WithMany()
                .HasForeignKey(e => e.WarehouseId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(e => e.Code).IsUnique();
            entity.HasIndex(e => e.WarehouseId);
            entity.HasIndex(e => e.IsActive);
            // Unique filtered default is created in tenant SQL migration
            // (InMemory tests cannot honor HASFILTER unique indexes).
        });
    }

    private static void ConfigureCashRegisterSession(ModelBuilder builder)
    {
        builder.Entity<CashRegisterSession>(entity =>
        {
            entity.ToTable("CashRegisterSessions");
            entity.HasKey(e => e.Id);

            entity.Property(e => e.Status).IsRequired();
            entity.Property(e => e.OpenedAt).IsRequired();
            entity.Property(e => e.OpenedByUserId).IsRequired();

            entity.OwnsOne(e => e.OpeningFloat, money =>
            {
                money.Property(m => m.Amount)
                    .HasColumnName("OpeningFloat")
                    .HasPrecision(18, 3)
                    .IsRequired();
                money.Property(m => m.Currency)
                    .HasColumnName("OpeningFloatCurrency")
                    .HasMaxLength(3)
                    .IsRequired();
            });
            entity.Navigation(e => e.OpeningFloat).IsRequired();

            ConfigureOwnedMoney(entity, e => e.ClosingCountedCash, "ClosingCountedCash");
            ConfigureOwnedMoney(entity, e => e.ClosingExpectedCash, "ClosingExpectedCash");
            ConfigureOwnedMoney(entity, e => e.CashVariance, "CashVariance");

            entity.HasOne(e => e.CashRegister)
                .WithMany()
                .HasForeignKey(e => e.CashRegisterId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(e => e.CashRegisterId)
                .IsUnique()
                .HasFilter("[Status] = 0")
                .HasDatabaseName("IX_CashRegisterSessions_OpenPerRegister");

            entity.HasIndex(e => new { e.CashRegisterId, e.OpenedAt });
            entity.HasIndex(e => e.ZReportId)
                .IsUnique()
                .HasFilter("[ZReportId] IS NOT NULL");
        });
    }

    private static void ConfigureZReport(ModelBuilder builder)
    {
        builder.Entity<ZReport>(entity =>
        {
            entity.ToTable("ZReports");
            entity.HasKey(e => e.Id);

            entity.Property(e => e.Version).IsConcurrencyToken();
            entity.Property(e => e.SnapshotJson).IsRequired();
            entity.Property(e => e.GeneratedAt).IsRequired();

            entity.OwnsOne(e => e.Number, num =>
            {
                num.Property(x => x.Value)
                    .HasColumnName("Number")
                    .HasMaxLength(50)
                    .IsRequired();

                num.Property(x => x.Year)
                    .HasColumnName("NumberYear")
                    .IsRequired();

                num.Property(x => x.Sequence)
                    .HasColumnName("NumberSequence")
                    .IsRequired();

                num.HasIndex(x => x.Value).IsUnique();
            });

            entity.HasIndex(e => e.CashRegisterSessionId).IsUnique();
            entity.HasIndex(e => e.GeneratedAt);
        });
    }

    private static void ConfigurePosCartDraft(ModelBuilder builder)
    {
        builder.Entity<PosCartDraft>(entity =>
        {
            entity.ToTable("PosCartDrafts");
            entity.HasKey(e => e.Id);

            // POS cart is an ephemeral autosave snapshot (last-write-wins), not a collaborative aggregate.
            entity.Property(e => e.Version);
            entity.Property(e => e.StateJson).IsRequired();
            entity.Property(e => e.UserId).IsRequired();
            entity.Property(e => e.CashRegisterId).IsRequired();

            entity.HasIndex(e => new { e.UserId, e.CashRegisterId }).IsUnique();
            entity.HasIndex(e => e.CashRegisterId);
        });
    }

    private static void ConfigurePosHeldTicket(ModelBuilder builder)
    {
        builder.Entity<PosHeldTicket>(entity =>
        {
            entity.ToTable("PosHeldTickets");
            entity.HasKey(e => e.Id);

            entity.Property(e => e.Version).IsConcurrencyToken();

            entity.Property(e => e.Label)
                .HasMaxLength(200)
                .IsRequired();

            entity.Property(e => e.TotalTtc)
                .HasPrecision(18, 3)
                .IsRequired();

            entity.Property(e => e.StateJson).IsRequired();
            entity.Property(e => e.HeldAt).IsRequired();

            entity.HasIndex(e => e.CashRegisterId);
            entity.HasIndex(e => e.CashRegisterSessionId)
                .HasFilter("[CashRegisterSessionId] IS NOT NULL");
            entity.HasIndex(e => e.HeldByUserId);
            entity.HasIndex(e => e.HeldAt);
        });
    }

    private static void ConfigureBankAccount(ModelBuilder builder)
    {
        builder.Entity<BankAccount>(entity =>
        {
            entity.ToTable("BankAccounts");
            entity.HasKey(e => e.Id);

            entity.Property(e => e.BankCode)
                .HasMaxLength(32)
                .IsRequired();

            entity.Property(e => e.BankName)
                .HasMaxLength(100)
                .IsRequired();

            entity.Property(e => e.Designation)
                .HasMaxLength(200);

            entity.Property(e => e.AgencyName)
                .HasMaxLength(200);

            entity.Property(e => e.Rib)
                .HasMaxLength(20)
                .IsRequired();

            entity.Property(e => e.Iban)
                .HasMaxLength(34)
                .IsRequired();

            entity.Property(e => e.SwiftBic)
                .HasMaxLength(11);

            entity.Property(e => e.IsDefault)
                .IsRequired();

            entity.Property(e => e.IsActive)
                .IsRequired();

            entity.Property(e => e.ChartOfAccountNumber)
                .HasMaxLength(20);

            entity.Property(e => e.Currency)
                .HasMaxLength(3)
                .IsRequired()
                .HasDefaultValue("TND");

            entity.HasOne<Company>()
                .WithMany()
                .HasForeignKey(e => e.CompanyId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(e => e.CompanyId);
            entity.HasIndex(e => new { e.CompanyId, e.Iban }).IsUnique();
            entity.HasIndex(e => e.IsDefault);
        });
    }

    private static void ConfigureBankDeposit(ModelBuilder builder)
    {
        builder.Entity<BankDeposit>(entity =>
        {
            entity.ToTable("BankDeposits");
            entity.HasKey(e => e.Id);

            entity.Property(e => e.DepositType).IsRequired();
            entity.Property(e => e.DepositDate).IsRequired();
            entity.Property(e => e.BankAccountId).IsRequired();
            entity.Property(e => e.Quantity).IsRequired();
            entity.Property(e => e.CashOperationId).IsRequired();

            entity.Property(e => e.DepositSlipReference).HasMaxLength(100);
            entity.Property(e => e.Notes).HasMaxLength(500);
            entity.Property(e => e.Status).IsRequired();

            entity.Property(e => e.CancelledAt);
            entity.Property(e => e.CancellationReason).HasMaxLength(500);

            entity.OwnsOne(e => e.Amount, price =>
            {
                price.Property(m => m.Amount)
                    .HasColumnName("Amount")
                    .HasPrecision(18, 3)
                    .IsRequired();

                price.Property(m => m.Currency)
                    .HasColumnName("AmountCurrency")
                    .HasMaxLength(3)
                    .IsRequired();
            });

            entity.OwnsOne(e => e.Number, num =>
            {
                num.Property(n => n.Value)
                    .HasColumnName("DepositNumber")
                    .HasMaxLength(50)
                    .IsRequired();

                num.Property(n => n.Year)
                    .HasColumnName("DepositNumberYear")
                    .IsRequired();

                num.Property(n => n.Sequence)
                    .HasColumnName("DepositNumberSequence")
                    .IsRequired();

                num.HasIndex(n => n.Value)
                    .IsUnique();
            });

            entity.HasOne<BankAccount>()
                .WithMany()
                .HasForeignKey(e => e.BankAccountId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne<CashOperation>()
                .WithMany()
                .HasForeignKey(e => e.CashOperationId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(e => e.DepositDate);
            entity.HasIndex(e => new { e.DepositDate, e.Status });
        });
    }

    private static void ConfigureBankDepositNumberSequence(ModelBuilder builder)
    {
        builder.Entity<BankDepositNumberSequence>(entity =>
        {
            entity.ToTable("BankDepositNumberSequences");
            entity.HasKey(s => s.Id);

            entity.Property(s => s.TenantId).IsRequired();
            entity.Property(s => s.FiscalYear).IsRequired();
            entity.Property(s => s.CurrentSequence).IsRequired();
            entity.Property(s => s.LastUpdated).IsRequired();

            entity.Property(s => s.RowVersion)
                .IsRowVersion();

            entity.HasIndex(s => new { s.TenantId, s.FiscalYear })
                .IsUnique();
        });
    }

    private static void ConfigureCashOperationNumberSequence(ModelBuilder builder)
    {
        builder.Entity<CashOperationNumberSequence>(entity =>
        {
            entity.ToTable("CashExpenseNumberSequences");
            entity.HasKey(s => s.Id);

            entity.Property(s => s.TenantId)
                .IsRequired();

            entity.Property(s => s.FiscalYear)
                .IsRequired();

            entity.Property(s => s.Prefix)
                .HasMaxLength(10)
                .IsRequired()
                .HasDefaultValue("DEP");

            entity.Property(s => s.CurrentSequence)
                .IsRequired();

            entity.Property(s => s.LastUpdated)
                .IsRequired();

            entity.Property(s => s.RowVersion)
                .IsRowVersion();

            entity.HasIndex(s => new { s.TenantId, s.FiscalYear, s.Prefix })
                .IsUnique();
        });
    }

    private static void ConfigureAuditLog(ModelBuilder builder)
    {
        builder.Entity<AuditLog>(entity =>
        {
            entity.ToTable("AuditLogs");
            entity.HasKey(a => a.Id);

            entity.Property(a => a.UserEmail)
                .HasMaxLength(256)
                .IsRequired();

            entity.Property(a => a.Action)
                .HasMaxLength(100)
                .IsRequired();

            entity.Property(a => a.EntityType)
                .HasMaxLength(100)
                .IsRequired();

            entity.Property(a => a.OldValues)
                .HasColumnType("nvarchar(max)");

            entity.Property(a => a.NewValues)
                .HasColumnType("nvarchar(max)");

            entity.Property(a => a.IpAddress)
                .HasMaxLength(50)
                .IsRequired();

            entity.Property(a => a.UserAgent)
                .HasMaxLength(500);

            entity.Property(a => a.PreviousHash)
                .HasMaxLength(100)
                .IsRequired();

            entity.Property(a => a.Hash)
                .HasMaxLength(100)
                .IsRequired();

            // Couvre l'ordre canonique de la chaîne d'audit (CreatedAt, Id) utilisé par
            // GetLastHash/VerifyChain, et sert aussi les requêtes par CreatedAt seul.
            entity.HasIndex(a => new { a.CreatedAt, a.Id });
            entity.HasIndex(a => a.Action);
            entity.HasIndex(a => a.EntityType);
            entity.HasIndex(a => a.UserId);
            // Couvre la lecture paginée de l'historique d'un enregistrement (Studio 4.7 « v1.1 », D5) :
            // WHERE EntityType = … AND EntityId = … ORDER BY CreatedAt DESC. Nom figé : jumeau SQL
            // docs/runbooks/sql/AddAuditLogsEntityHistoryIndex_Tenant.idempotent.sql.
            entity.HasIndex(a => new { a.EntityType, a.EntityId, a.CreatedAt })
                .HasDatabaseName("IX_AuditLogs_EntityHistory");
        });
    }

    private static void ConfigureInvoiceDraft(ModelBuilder builder)
    {
        builder.Entity<InvoiceDraft>(entity =>
        {
            entity.ToTable("InvoiceDrafts");
            entity.HasKey(d => d.Id);

            entity.Property(d => d.CurrentStep)
                .IsRequired();

            entity.Property(d => d.MetadataJson)
                .HasColumnType("nvarchar(max)");

            entity.Property(d => d.NewClientJson)
                .HasColumnType("nvarchar(max)");

            entity.Property(d => d.LinesJson)
                .HasColumnType("nvarchar(max)");

            entity.Property(d => d.PaymentLegalJson)
                .HasColumnType("nvarchar(max)");

            entity.Property(d => d.IdempotencyKey)
                .HasMaxLength(100);

            entity.HasIndex(d => d.SellerId);
            entity.HasIndex(d => d.ClientId);
            entity.HasIndex(d => d.ExpiresAt);
            entity.HasIndex(d => d.IdempotencyKey);
            entity.HasIndex(d => d.IsConverted);
        });
    }

    private static void ConfigureInvoiceNumberSequence(ModelBuilder builder)
    {
        builder.Entity<InvoiceNumberSequence>(entity =>
        {
            entity.ToTable("InvoiceNumberSequences");
            entity.HasKey(s => s.Id);

            entity.Property(s => s.Prefix)
                .HasMaxLength(10)
                .IsRequired();

            entity.Property(s => s.RowVersion)
                .IsRowVersion();

            entity.HasIndex(s => new { s.TenantId, s.Prefix, s.FiscalYear })
                .IsUnique();
        });
    }

    private static void ConfigureDocumentNumberingScheme(ModelBuilder builder)
    {
        builder.Entity<DocumentNumberingScheme>(entity =>
        {
            entity.ToTable("DocumentNumberingSchemes");
            entity.HasKey(s => s.Id);

            entity.Property(s => s.FormatBlocksJson)
                .HasColumnType("nvarchar(max)")
                .IsRequired();

            entity.Property(s => s.RowVersion)
                .IsRowVersion();

            entity.HasIndex(s => new { s.TenantId, s.DocumentType, s.FiscalYear })
                .IsUnique();
        });
    }

    private static void ConfigureDocumentTemplatePreference(ModelBuilder builder)
    {
        builder.Entity<DocumentTemplatePreference>(entity =>
        {
            entity.ToTable("DocumentTemplatePreferences");
            entity.HasKey(p => p.Id);

            entity.Property(p => p.TemplateKey)
                .HasMaxLength(100)
                .IsRequired();

            entity.Property(p => p.RowVersion)
                .IsRowVersion();

            entity.HasIndex(p => new { p.TenantId, p.DocumentType })
                .IsUnique();
        });
    }

    private static void ConfigureUserDashboardLayout(ModelBuilder builder)
    {
        builder.Entity<UserDashboardLayout>(entity =>
        {
            entity.ToTable("UserDashboardLayouts");
            entity.HasKey(p => p.Id);

            entity.Property(p => p.LayoutJson)
                .HasColumnType("nvarchar(max)")
                .IsRequired();

            entity.Property(p => p.RowVersion)
                .IsRowVersion();

            entity.HasIndex(p => new { p.TenantId, p.UserId })
                .IsUnique();
        });
    }

    private static void ConfigureQuote(ModelBuilder builder)
    {
        builder.Entity<Quote>(entity =>
        {
            entity.ToTable("Quotes");
            entity.HasKey(q => q.Id);

            entity.Property(q => q.Reference)
                .HasMaxLength(100);

            entity.Property(q => q.Notes)
                .HasMaxLength(2000);

            entity.Property(q => q.TermsAndConditions)
                .HasMaxLength(2000);

            entity.Property(q => q.RejectionReason)
                .HasMaxLength(500);

            entity.Property(q => q.CancellationReason)
                .HasMaxLength(500);

            entity.OwnsOne(q => q.Number, num =>
            {
                num.Property(n => n.Value)
                    .HasColumnName("Number")
                    .HasMaxLength(50)
                    .IsRequired();

                num.Property(n => n.Prefix)
                    .HasColumnName("NumberPrefix")
                    .HasMaxLength(10)
                    .IsRequired();

                num.Property(n => n.Year)
                    .HasColumnName("NumberYear")
                    .IsRequired();

                num.Property(n => n.Sequence)
                    .HasColumnName("NumberSequence")
                    .IsRequired();
            });

            entity.OwnsOne(q => q.SubTotal, price =>
            {
                price.Property(m => m.Amount)
                    .HasColumnName("SubTotal")
                    .HasPrecision(18, 3)
                    .IsRequired();

                price.Property(m => m.Currency)
                    .HasColumnName("SubTotalCurrency")
                    .HasMaxLength(3)
                    .IsRequired();
            });

            entity.OwnsOne(q => q.FodecAmount, price =>
            {
                price.Property(m => m.Amount)
                    .HasColumnName("FodecAmount")
                    .HasPrecision(18, 3)
                    .IsRequired();

                price.Property(m => m.Currency)
                    .HasColumnName("FodecAmountCurrency")
                    .HasMaxLength(3)
                    .IsRequired();
            });

            entity.OwnsOne(q => q.FiscalStampAmount, price =>
            {
                price.Property(m => m.Amount)
                    .HasColumnName("FiscalStampAmount")
                    .HasPrecision(18, 3)
                    .IsRequired();

                price.Property(m => m.Currency)
                    .HasColumnName("FiscalStampAmountCurrency")
                    .HasMaxLength(3)
                    .IsRequired();
            });

            entity.OwnsOne(q => q.TotalVat, price =>
            {
                price.Property(m => m.Amount)
                    .HasColumnName("TotalVat")
                    .HasPrecision(18, 3)
                    .IsRequired();

                price.Property(m => m.Currency)
                    .HasColumnName("TotalVatCurrency")
                    .HasMaxLength(3)
                    .IsRequired();
            });

            entity.OwnsOne(q => q.TotalAmount, price =>
            {
                price.Property(m => m.Amount)
                    .HasColumnName("TotalAmount")
                    .HasPrecision(18, 3)
                    .IsRequired();

                price.Property(m => m.Currency)
                    .HasColumnName("TotalAmountCurrency")
                    .HasMaxLength(3)
                    .IsRequired();
            });

            entity.HasOne(q => q.Client)
                .WithMany()
                .HasForeignKey(q => q.ClientId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasMany(q => q.Lines)
                .WithOne(l => l.Quote)
                .HasForeignKey(l => l.QuoteId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(q => q.Status);
            entity.HasIndex(q => q.IssueDate);
            entity.HasIndex(q => q.ExpiryDate);
            entity.HasIndex(q => q.ClientId);
            entity.HasIndex(q => q.ConvertedInvoiceId)
                .IsUnique()
                .HasFilter("[ConvertedInvoiceId] IS NOT NULL");

            // Miroir de ConvertedInvoiceId : un devis ne peut être transformé qu'en UNE
            // seule commande client. L'index unique filtré est le dernier rempart contre
            // une double conversion concurrente.
            entity.HasIndex(q => q.ConvertedSalesOrderId)
                .IsUnique()
                .HasFilter("[ConvertedSalesOrderId] IS NOT NULL");

            entity.Property(q => q.OriginStorefrontOrderId);
            entity.HasIndex(q => q.OriginStorefrontOrderId)
                .HasFilter("[OriginStorefrontOrderId] IS NOT NULL");

            // Remise de pied de document (tranche 5B). Le montant est persisté : il fait foi au
            // rechargement, quand le pourcentage n'est pas renseigné.
            entity.Property(x => x.GlobalDiscountPercent).HasPrecision(5, 2).IsRequired(false);
            ConfigureOwnedMoney(entity, x => x.GlobalDiscountAmount, "GlobalDiscountAmount");

            // Dérivé de SubTotal + GlobalDiscountAmount : calculé, jamais stocké.
            entity.Ignore(x => x.SubTotalBeforeGlobalDiscount);

        });
    }

    /// <summary>
    /// Commande client. Calquée sur <see cref="ConfigureQuote"/> : mêmes types possédés Money,
    /// même numéro possédé, mêmes conventions d'index. Les index portent sur ce qui pilote le
    /// carnet de commandes — statut, date, client — et sur les liens de traçabilité amont.
    /// </summary>
    private static void ConfigureSalesOrder(ModelBuilder builder)
    {
        builder.Entity<SalesOrder>(entity =>
        {
            entity.ToTable("SalesOrders");
            entity.HasKey(o => o.Id);

            entity.Property(o => o.Reference).HasMaxLength(100);
            entity.Property(o => o.Notes).HasMaxLength(2000);
            entity.Property(o => o.PaymentTerms).HasMaxLength(500);
            entity.Property(o => o.CancellationReason).HasMaxLength(500);
            entity.Property(o => o.ClosureReason).HasMaxLength(500);
            entity.Property(o => o.IsStockReserved).IsRequired();

            entity.OwnsOne(o => o.Number, num =>
            {
                num.Property(n => n.Value)
                    .HasColumnName("Number").HasMaxLength(50).IsRequired();
                num.Property(n => n.Prefix)
                    .HasColumnName("NumberPrefix").HasMaxLength(10).IsRequired();
                num.Property(n => n.Year)
                    .HasColumnName("NumberYear").IsRequired();
                num.Property(n => n.Sequence)
                    .HasColumnName("NumberSequence").IsRequired();

                num.HasIndex(n => n.Value).HasDatabaseName("IX_SalesOrders_Number");
            });

            ConfigureOwnedMoney(entity, o => o.SubTotal, "SubTotal");
            ConfigureOwnedMoney(entity, o => o.FodecAmount, "FodecAmount");
            ConfigureOwnedMoney(entity, o => o.TotalVat, "TotalVat");
            ConfigureOwnedMoney(entity, o => o.FiscalStampAmount, "FiscalStampAmount");
            ConfigureOwnedMoney(entity, o => o.TotalAmount, "TotalAmount");

            entity.HasOne(o => o.Client)
                .WithMany()
                .HasForeignKey(o => o.ClientId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(o => o.Warehouse)
                .WithMany()
                .HasForeignKey(o => o.WarehouseId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasMany(o => o.Lines)
                .WithOne(l => l.SalesOrder)
                .HasForeignKey(l => l.SalesOrderId)
                .OnDelete(DeleteBehavior.Cascade);

            // Le carnet de commandes se filtre sur statut + date ; la fiche client sur ClientId.
            entity.HasIndex(o => o.Status);
            entity.HasIndex(o => o.OrderDate);
            entity.HasIndex(o => o.ClientId);
            entity.HasIndex(o => o.ExpectedDeliveryDate);

            entity.HasIndex(o => o.SourceQuoteId)
                .HasFilter("[SourceQuoteId] IS NOT NULL");

            // Remise de pied de document (tranche 5B). Le montant est persisté : il fait foi au
            // rechargement, quand le pourcentage n'est pas renseigné.
            entity.Property(x => x.GlobalDiscountPercent).HasPrecision(5, 2).IsRequired(false);
            ConfigureOwnedMoney(entity, x => x.GlobalDiscountAmount, "GlobalDiscountAmount");

            // Dérivé de SubTotal + GlobalDiscountAmount : calculé, jamais stocké.
            entity.Ignore(x => x.SubTotalBeforeGlobalDiscount);

        });
    }

    /// <summary>
    /// Ligne de commande client. Calquée sur <see cref="ConfigureQuoteLine"/>, avec les trois
    /// quantités (commandée, livrée, facturée) qui portent les reliquats.
    /// </summary>
    private static void ConfigureSalesOrderLine(ModelBuilder builder)
    {
        builder.Entity<SalesOrderLine>(entity =>
        {
            entity.ToTable("SalesOrderLines");
            entity.HasKey(l => l.Id);

            entity.Property(l => l.ProductCode).HasMaxLength(50).IsRequired();
            entity.Property(l => l.ProductName).HasMaxLength(200).IsRequired();
            entity.Property(l => l.ProductDescription).HasMaxLength(1000);
            entity.Property(l => l.Unit).HasMaxLength(50);
            entity.Property(l => l.Notes).HasMaxLength(500);

            entity.Property(l => l.Quantity).HasPrecision(18, 4).IsRequired();
            entity.Property(l => l.DeliveredQuantity).HasPrecision(18, 4).IsRequired();
            entity.Property(l => l.InvoicedQuantity).HasPrecision(18, 4).IsRequired();
            entity.Property(l => l.ReturnedQuantity).HasPrecision(18, 4).IsRequired();

            entity.Property(l => l.DiscountPercent).HasPrecision(5, 2);
            entity.Property(l => l.AppliedPromotionName).HasMaxLength(100);
            entity.Property(l => l.IsFodecApplicable).IsRequired();
            entity.Property(l => l.FodecRatePercent).HasPrecision(5, 2).IsRequired();

            ConfigureOwnedMoney(entity, l => l.UnitPrice, "UnitPrice");
            ConfigureOwnedMoney(entity, l => l.DiscountAmount, "DiscountAmount");
            ConfigureOwnedMoney(entity, l => l.FodecAmount, "FodecAmount");
            ConfigureOwnedMoney(entity, l => l.SubTotal, "SubTotal");
            ConfigureOwnedMoney(entity, l => l.VatAmount, "VatAmount");
            ConfigureOwnedMoney(entity, l => l.Total, "Total");

            entity.HasOne(l => l.Product)
                .WithMany()
                .HasForeignKey(l => l.ProductId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(l => l.SalesOrderId);
            entity.HasIndex(l => l.ProductId);

            // Part de la remise de pied imputée à la ligne (tranche 5B). Zéro sur tout
            // l'existant : la ligne se calcule alors comme avant.
            ConfigureOwnedMoney(entity, x => x.AllocatedGlobalDiscount, "AllocatedGlobalDiscount");
            entity.Ignore(x => x.SubTotalBeforeGlobalDiscount);

        });
    }

    /// <summary>
    /// Déclare un <c>Money</c> possédé sous la convention du contexte : montant en
    /// decimal(18,3) dans <paramref name="columnName"/> et devise dans
    /// <c>{columnName}Currency</c>. Évite de répéter onze blocs identiques.
    /// </summary>
    private static void ConfigureOwnedMoney<TEntity>(
        Microsoft.EntityFrameworkCore.Metadata.Builders.EntityTypeBuilder<TEntity> entity,
        System.Linq.Expressions.Expression<Func<TEntity, Domain.ValueObjects.Money?>> navigation,
        string columnName)
        where TEntity : class
    {
        entity.OwnsOne(navigation, money =>
        {
            money.Property(m => m.Amount)
                .HasColumnName(columnName)
                .HasPrecision(18, 3)
                .IsRequired();

            money.Property(m => m.Currency)
                .HasColumnName($"{columnName}Currency")
                .HasMaxLength(3)
                .IsRequired();
        });
    }

    private static void ConfigureQuoteLine(ModelBuilder builder)
    {
        builder.Entity<QuoteLine>(entity =>
        {
            entity.ToTable("QuoteLines");
            entity.HasKey(l => l.Id);

            entity.Property(l => l.ProductCode)
                .HasMaxLength(50)
                .IsRequired();

            entity.Property(l => l.ProductName)
                .HasMaxLength(200)
                .IsRequired();

            entity.Property(l => l.ProductDescription)
                .HasMaxLength(1000);

            entity.Property(l => l.Unit)
                .HasMaxLength(50);

            entity.Property(l => l.Quantity)
                .HasPrecision(18, 4);

            entity.Property(l => l.DiscountPercent)
                .HasPrecision(5, 2);

            entity.Property(l => l.AppliedPromotionName)
                .HasMaxLength(100);

            entity.Property(l => l.IsFodecApplicable)
                .IsRequired();

            entity.Property(l => l.FodecRatePercent)
                .HasPrecision(5, 2)
                .IsRequired();

            entity.OwnsOne(l => l.FodecAmount, price =>
            {
                price.Property(m => m.Amount)
                    .HasColumnName("FodecAmount")
                    .HasPrecision(18, 3)
                    .IsRequired();

                price.Property(m => m.Currency)
                    .HasColumnName("FodecAmountCurrency")
                    .HasMaxLength(3)
                    .IsRequired();
            });

            entity.OwnsOne(l => l.UnitPrice, price =>
            {
                price.Property(m => m.Amount)
                    .HasColumnName("UnitPrice")
                    .HasPrecision(18, 3)
                    .IsRequired();

                price.Property(m => m.Currency)
                    .HasColumnName("UnitPriceCurrency")
                    .HasMaxLength(3)
                    .IsRequired();
            });

            entity.OwnsOne(l => l.DiscountAmount, price =>
            {
                price.Property(m => m.Amount)
                    .HasColumnName("DiscountAmount")
                    .HasPrecision(18, 3)
                    .IsRequired();

                price.Property(m => m.Currency)
                    .HasColumnName("DiscountAmountCurrency")
                    .HasMaxLength(3)
                    .IsRequired();
            });

            entity.OwnsOne(l => l.SubTotal, price =>
            {
                price.Property(m => m.Amount)
                    .HasColumnName("SubTotal")
                    .HasPrecision(18, 3)
                    .IsRequired();

                price.Property(m => m.Currency)
                    .HasColumnName("SubTotalCurrency")
                    .HasMaxLength(3)
                    .IsRequired();
            });

            entity.OwnsOne(l => l.VatAmount, price =>
            {
                price.Property(m => m.Amount)
                    .HasColumnName("VatAmount")
                    .HasPrecision(18, 3)
                    .IsRequired();

                price.Property(m => m.Currency)
                    .HasColumnName("VatAmountCurrency")
                    .HasMaxLength(3)
                    .IsRequired();
            });

            entity.OwnsOne(l => l.Total, price =>
            {
                price.Property(m => m.Amount)
                    .HasColumnName("Total")
                    .HasPrecision(18, 3)
                    .IsRequired();

                price.Property(m => m.Currency)
                    .HasColumnName("TotalCurrency")
                    .HasMaxLength(3)
                    .IsRequired();
            });

            entity.HasOne(l => l.Product)
                .WithMany()
                .HasForeignKey(l => l.ProductId)
                .IsRequired(false)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(l => l.QuoteId);

            // Part de la remise de pied imputée à la ligne (tranche 5B). Zéro sur tout
            // l'existant : la ligne se calcule alors comme avant.
            ConfigureOwnedMoney(entity, x => x.AllocatedGlobalDiscount, "AllocatedGlobalDiscount");
            entity.Ignore(x => x.SubTotalBeforeGlobalDiscount);

        });
    }

    private static void ConfigureQuoteNumberSequence(ModelBuilder builder)
    {
        builder.Entity<QuoteNumberSequence>(entity =>
        {
            entity.ToTable("QuoteNumberSequences");
            entity.HasKey(s => s.Id);

            entity.Property(s => s.Prefix)
                .HasMaxLength(10)
                .IsRequired();

            entity.Property(s => s.RowVersion)
                .IsRowVersion();

            entity.HasIndex(s => new { s.TenantId, s.Prefix, s.FiscalYear })
                .IsUnique();
        });
    }

    private static void ConfigureWarehouse(ModelBuilder builder)
    {
        builder.Entity<Warehouse>(entity =>
        {
            entity.ToTable("Warehouses");
            entity.HasKey(w => w.Id);

            entity.Property(w => w.Code)
                .HasMaxLength(20)
                .IsRequired();

            entity.Property(w => w.Name)
                .HasMaxLength(100)
                .IsRequired();

            entity.Property(w => w.Address)
                .HasMaxLength(500);

            entity.HasIndex(w => w.Code).IsUnique();
            entity.HasIndex(w => w.IsDefault);
            entity.HasIndex(w => w.IsActive);
        });
    }

    private static void ConfigureStockItem(ModelBuilder builder)
    {
        builder.Entity<StockItem>(entity =>
        {
            entity.ToTable("StockItems");
            entity.HasKey(s => s.Id);

            entity.Property(s => s.QuantityOnHand)
                .HasPrecision(18, 4)
                .IsRequired();

            entity.Property(s => s.QuantityReserved)
                .HasPrecision(18, 4)
                .IsRequired();

            entity.Property(s => s.MinimumStock)
                .HasPrecision(18, 4)
                .IsRequired();

            entity.Property(s => s.MaximumStock)
                .HasPrecision(18, 4);

            entity.Property(s => s.AverageCost)
                .HasPrecision(18, 4)
                .IsRequired();

            // Navigation to movements (owned collection)
            entity.HasMany(s => s.Movements)
                .WithOne()
                .HasForeignKey(m => m.StockItemId)
                .OnDelete(DeleteBehavior.Cascade);

            // Indexes for performance
            entity.HasIndex(s => s.ProductId);
            entity.HasIndex(s => s.WarehouseId);
            entity.HasIndex(s => new { s.ProductId, s.WarehouseId }).IsUnique();
            entity.HasIndex(s => s.IsActive);
            

        });
    }

    private static void ConfigureStockMovement(ModelBuilder builder)
    {
        builder.Entity<StockMovement>(entity =>
        {
            entity.ToTable("StockMovements");
            entity.HasKey(m => m.Id);

            entity.Property(m => m.Type)
                .IsRequired();

            entity.Property(m => m.Reason)
                .IsRequired();

            entity.Property(m => m.Quantity)
                .HasPrecision(18, 4)
                .IsRequired();

            entity.Property(m => m.UnitCost)
                .HasPrecision(18, 4)
                .IsRequired();

            entity.Property(m => m.BalanceAfter)
                .HasPrecision(18, 4)
                .IsRequired();

            // Écart vendu/sorti sur rupture partielle. Null en fonctionnement normal.
            entity.Property(m => m.ShortfallQuantity)
                .HasPrecision(18, 4);

            entity.Property(m => m.Reference)
                .HasMaxLength(100);

            entity.Property(m => m.Notes)
                .HasMaxLength(500);

            entity.Property(m => m.OccurredAt)
                .IsRequired();

            entity.HasIndex(m => m.ProductLotId);
            entity.HasIndex(m => m.SerialId);
            entity.HasIndex(m => m.ValuationLayerId);

            // Indexes for queries
            entity.HasIndex(m => m.StockItemId);
            entity.HasIndex(m => m.OccurredAt);
            entity.HasIndex(m => new { m.StockItemId, m.OccurredAt });
            entity.HasIndex(m => m.Reference);
            entity.HasIndex(m => m.Type);
            entity.HasIndex(m => m.Reason);
        });
    }

    private static void ConfigurePhysicalInventory(ModelBuilder builder)
    {
        builder.Entity<PhysicalInventory>(entity =>
        {
            entity.ToTable("PhysicalInventories");
            entity.HasKey(i => i.Id);

            entity.Property(i => i.Reference)
                .HasMaxLength(50)
                .IsRequired();

            entity.Property(i => i.Type)
                .IsRequired();

            entity.Property(i => i.Status)
                .IsRequired();

            entity.Property(i => i.StartedAt)
                .IsRequired();

            entity.Property(i => i.Notes)
                .HasMaxLength(500);

            entity.HasOne(i => i.Warehouse)
                .WithMany()
                .HasForeignKey(i => i.WarehouseId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasMany(i => i.CountLines)
                .WithOne()
                .HasForeignKey(l => l.InventoryId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(i => i.Reference).IsUnique();
            entity.HasIndex(i => i.WarehouseId);
            entity.HasIndex(i => i.Status);
            entity.HasIndex(i => new { i.WarehouseId, i.Status });
            entity.HasIndex(i => i.StartedAt);
        });
    }

    private static void ConfigureInventoryNumberSequence(ModelBuilder builder)
    {
        builder.Entity<InventoryNumberSequence>(entity =>
        {
            entity.ToTable("InventoryNumberSequences");
            entity.HasKey(s => s.Year);

            entity.Property(s => s.LastSequence)
                .IsRequired();
        });
    }

    private static void ConfigureInventoryCountLine(ModelBuilder builder)
    {
        builder.Entity<InventoryCountLine>(entity =>
        {
            entity.ToTable("InventoryCountLines");
            entity.HasKey(l => l.Id);

            entity.Property(l => l.ProductName)
                .HasMaxLength(200)
                .IsRequired();

            entity.Property(l => l.ProductCode)
                .HasMaxLength(50);

            entity.Property(l => l.TheoreticalQuantity)
                .HasPrecision(18, 4)
                .IsRequired();

            entity.Property(l => l.CountedQuantity)
                .HasPrecision(18, 4);

            entity.Property(l => l.LotNumber)
                .HasMaxLength(50);

            entity.HasIndex(l => l.InventoryId);
            entity.HasIndex(l => l.ProductId);
            entity.HasIndex(l => l.ProductLotId);
        });
    }

    private static void ConfigureDeliveryNote(ModelBuilder builder)
    {
        builder.Entity<DeliveryNote>(entity =>
        {
            entity.ToTable("DeliveryNotes");
            entity.HasKey(d => d.Id);

            entity.Property(d => d.Version).IsConcurrencyToken();

            entity.Property(d => d.Reference)
                .HasMaxLength(100);

            entity.Property(d => d.Notes)
                .HasMaxLength(2000);

            entity.Property(d => d.DeliveryAddress)
                .HasMaxLength(500)
                .IsRequired();

            entity.Property(d => d.DeliveryCity)
                .HasMaxLength(100);

            entity.Property(d => d.DeliveryPostalCode)
                .HasMaxLength(20);

            entity.Property(d => d.RecipientName)
                .HasMaxLength(200);

            entity.Property(d => d.RecipientSignature)
                .HasColumnType("nvarchar(max)");

            entity.Property(d => d.FailureReason)
                .HasMaxLength(500);

            entity.Property(d => d.CancellationReason)
                .HasMaxLength(500);

            // Lien commande → BL : c'est lui qui rattache la livraison à l'engagement,
            // et donc qui fait vivre le reliquat.
            entity.Property(d => d.SourceSalesOrderId);
            entity.HasIndex(d => d.SourceSalesOrderId)
                .HasFilter("[SourceSalesOrderId] IS NOT NULL");

            entity.OwnsOne(d => d.Number, num =>
            {
                num.Property(n => n.Value)
                    .HasColumnName("Number")
                    .HasMaxLength(50)
                    .IsRequired();

                num.Property(n => n.Year)
                    .HasColumnName("NumberYear")
                    .IsRequired();

                num.Property(n => n.Sequence)
                    .HasColumnName("NumberSequence")
                    .IsRequired();
            });

            entity.HasOne(d => d.Client)
                .WithMany()
                .HasForeignKey(d => d.ClientId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(d => d.Invoice)
                .WithMany()
                .HasForeignKey(d => d.InvoiceId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasMany(d => d.Lines)
                .WithOne(l => l.DeliveryNote)
                .HasForeignKey(l => l.DeliveryNoteId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(d => d.Warehouse)
                .WithMany()
                .HasForeignKey(d => d.WarehouseId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(d => d.Status);
            entity.HasIndex(d => d.IssueDate);
            entity.HasIndex(d => d.DeliveryDate);
            entity.HasIndex(d => d.ClientId);
            entity.HasIndex(d => d.InvoiceId);
            entity.HasIndex(d => d.WarehouseId);
        });
    }

    private static void ConfigureDeliveryNoteLine(ModelBuilder builder)
    {
        builder.Entity<DeliveryNoteLine>(entity =>
        {
            entity.ToTable("DeliveryNoteLines");
            entity.HasKey(l => l.Id);

            entity.Property(l => l.Designation)
                .HasMaxLength(200)
                .IsRequired();

            entity.Property(l => l.ProductCode)
                .HasMaxLength(50)
                .IsRequired();

            entity.Property(l => l.Description)
                .HasMaxLength(1000);

            entity.Property(l => l.Unit)
                .HasMaxLength(50)
                .IsRequired();

            entity.Property(l => l.UnitPriceHT)
                .HasPrecision(18, 3)
                .IsRequired();

            entity.Property(l => l.VatRatePercent)
                .IsRequired();

            // Remise et FODEC : seuls les paramètres sont persistés, les montants restent
            // calculés (DiscountAmount, FodecAmount, TotalHT… sont des propriétés dérivées).
            entity.Property(l => l.DiscountPercent)
                .HasPrecision(5, 2);

            entity.Property(l => l.AppliedPromotionName)
                .HasMaxLength(100);

            entity.Property(l => l.IsFodecApplicable)
                .IsRequired();

            entity.Property(l => l.FodecRatePercent)
                .HasPrecision(5, 2)
                .IsRequired();

            entity.Property(l => l.OrderedQuantity)
                .HasPrecision(18, 4)
                .IsRequired();

            entity.Property(l => l.DeliveredQuantity)
                .HasPrecision(18, 4)
                .IsRequired();

            entity.Property(l => l.RejectedQuantity)
                .HasPrecision(18, 4)
                .IsRequired();

            entity.Property(l => l.ReturnedQuantity)
                .HasPrecision(18, 4)
                .IsRequired();

            entity.Property(l => l.RejectionReason)
                .HasMaxLength(500);

            entity.Property(l => l.Notes)
                .HasMaxLength(500);

            entity.HasOne(l => l.Product)
                .WithMany()
                .HasForeignKey(l => l.ProductId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(l => l.DeliveryNoteId);
            entity.HasIndex(l => l.ProductId);
        });
    }

    private static void ConfigureSalesReturnNote(ModelBuilder builder)
    {
        builder.Entity<SalesReturnNote>(entity =>
        {
            entity.ToTable("SalesReturnNotes");
            entity.HasKey(n => n.Id);

            entity.Property(n => n.Version).IsConcurrencyToken();

            entity.Property(n => n.Reason)
                .HasMaxLength(500)
                .IsRequired();

            entity.Property(n => n.Notes)
                .HasMaxLength(2000);

            entity.OwnsOne(n => n.Number, num =>
            {
                num.Property(x => x.Value)
                    .HasColumnName("Number")
                    .HasMaxLength(50)
                    .IsRequired();

                num.Property(x => x.Year)
                    .HasColumnName("NumberYear")
                    .IsRequired();

                num.Property(x => x.Sequence)
                    .HasColumnName("NumberSequence")
                    .IsRequired();

                num.HasIndex(x => x.Value).IsUnique();
            });

            entity.HasOne(n => n.Client)
                .WithMany()
                .HasForeignKey(n => n.ClientId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(n => n.DeliveryNote)
                .WithMany()
                .HasForeignKey(n => n.DeliveryNoteId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(n => n.Warehouse)
                .WithMany()
                .HasForeignKey(n => n.WarehouseId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasMany(n => n.Lines)
                .WithOne(l => l.SalesReturnNote)
                .HasForeignKey(l => l.SalesReturnNoteId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(n => n.DeliveryNoteId);
            entity.HasIndex(n => n.ClientId);
            entity.HasIndex(n => n.Status);
            entity.HasIndex(n => n.ReturnDate);
        });
    }

    private static void ConfigureSalesReturnNoteLine(ModelBuilder builder)
    {
        builder.Entity<SalesReturnNoteLine>(entity =>
        {
            entity.ToTable("SalesReturnNoteLines");
            entity.HasKey(l => l.Id);

            entity.Property(l => l.ProductCode)
                .HasMaxLength(50)
                .IsRequired();

            entity.Property(l => l.Designation)
                .HasMaxLength(200)
                .IsRequired();

            entity.Property(l => l.Description)
                .HasMaxLength(1000);

            entity.Property(l => l.Unit)
                .HasMaxLength(50)
                .IsRequired();

            entity.Property(l => l.UnitPriceHT)
                .HasPrecision(18, 3)
                .IsRequired();

            entity.Property(l => l.DiscountPercent)
                .HasPrecision(5, 2);

            entity.Property(l => l.FodecRatePercent)
                .HasPrecision(5, 2)
                .IsRequired();

            entity.Property(l => l.ReturnedQuantity)
                .HasPrecision(18, 4)
                .IsRequired();

            entity.Property(l => l.Notes)
                .HasMaxLength(500);

            entity.HasOne(l => l.Product)
                .WithMany()
                .HasForeignKey(l => l.ProductId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne<DeliveryNoteLine>()
                .WithMany()
                .HasForeignKey(l => l.DeliveryNoteLineId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(l => l.SalesReturnNoteId);
            entity.HasIndex(l => l.DeliveryNoteLineId);
            entity.HasIndex(l => l.ProductId);
        });
    }

    private static void ConfigureSupplier(ModelBuilder builder)
    {
        builder.Entity<Supplier>(entity =>
        {
            entity.ToTable("Suppliers");
            entity.HasKey(s => s.Id);

            entity.Property(s => s.Name)
                .HasMaxLength(200)
                .IsRequired();

            entity.Property(s => s.ContactPerson)
                .HasMaxLength(200);

            entity.Property(s => s.PaymentTermDays)
                .IsRequired();

            entity.Property(s => s.Notes)
                .HasMaxLength(1000);

            entity.OwnsOne(s => s.NIF, nif =>
            {
                nif.Property(n => n.Value)
                    .HasColumnName("NIF")
                    .HasMaxLength(20);
            });

            entity.OwnsOne(s => s.Address, addr =>
            {
                addr.Property(a => a.Street).HasColumnName("Street").HasMaxLength(200).IsRequired();
                addr.Property(a => a.StreetLine2).HasColumnName("StreetLine2").HasMaxLength(200);
                addr.Property(a => a.City).HasColumnName("City").HasMaxLength(100).IsRequired();
                addr.Property(a => a.PostalCode).HasColumnName("PostalCode").HasMaxLength(20);
                addr.Property(a => a.Governorate).HasColumnName("Governorate").HasMaxLength(100).IsRequired();
                addr.Property(a => a.Country).HasColumnName("Country").HasMaxLength(100).IsRequired();
            });

            entity.OwnsOne(s => s.Email, email =>
            {
                email.Property(e => e.Value)
                    .HasColumnName("Email")
                    .HasMaxLength(256)
                    .IsRequired();
            });

            entity.OwnsOne(s => s.Phone, phone =>
            {
                phone.Property(p => p.Value)
                    .HasColumnName("Phone")
                    .HasMaxLength(20);
                phone.Ignore(p => p.CountryCode);
                phone.Ignore(p => p.LocalNumber);
            });

            entity.HasIndex(s => s.Name);
            entity.HasIndex(s => s.IsActive);

            // TEJ fields
            entity.Property(s => s.TejIdentificationType).HasConversion<int?>().IsRequired(false);
            entity.Property(s => s.DateOfBirth).IsRequired(false);
            entity.Property(s => s.CountryCode).HasMaxLength(3).IsRequired(false);
            entity.Property(s => s.IsResident).HasDefaultValue(true);
            entity.Property(s => s.Activity).HasMaxLength(200).IsRequired(false);
            entity.Property(s => s.DefaultWithholdingTaxTypeId).IsRequired(false);
            entity.Property(s => s.DefaultWithholdingRate).HasPrecision(5, 2).IsRequired(false);
            entity.Property(s => s.IsSubjectToWithholding).HasDefaultValue(false);
        });
    }

    private static void ConfigurePurchaseOrder(ModelBuilder builder)
    {
        builder.Entity<PurchaseOrder>(entity =>
        {
            entity.ToTable("PurchaseOrders");
            entity.HasKey(po => po.Id);

            entity.Property(po => po.Reference)
                .HasMaxLength(100);

            entity.Property(po => po.Notes)
                .HasMaxLength(2000);

            entity.Property(po => po.CancellationReason)
                .HasMaxLength(500);

            entity.OwnsOne(po => po.Number, num =>
            {
                num.Property(n => n.Value)
                    .HasColumnName("Number")
                    .HasMaxLength(50)
                    .IsRequired();

                num.Property(n => n.Prefix)
                    .HasColumnName("NumberPrefix")
                    .HasMaxLength(10)
                    .IsRequired();

                num.Property(n => n.Year)
                    .HasColumnName("NumberYear")
                    .IsRequired();

                num.Property(n => n.Sequence)
                    .HasColumnName("NumberSequence")
                    .IsRequired();
            });

            entity.OwnsOne(po => po.SubTotal, price =>
            {
                price.Property(m => m.Amount)
                    .HasColumnName("SubTotal")
                    .HasPrecision(18, 3)
                    .IsRequired();

                price.Property(m => m.Currency)
                    .HasColumnName("SubTotalCurrency")
                    .HasMaxLength(3)
                    .IsRequired();
            });

            entity.OwnsOne(po => po.TotalVat, price =>
            {
                price.Property(m => m.Amount)
                    .HasColumnName("TotalVat")
                    .HasPrecision(18, 3)
                    .IsRequired();

                price.Property(m => m.Currency)
                    .HasColumnName("TotalVatCurrency")
                    .HasMaxLength(3)
                    .IsRequired();
            });

            entity.OwnsOne(po => po.TotalAmount, price =>
            {
                price.Property(m => m.Amount)
                    .HasColumnName("TotalAmount")
                    .HasPrecision(18, 3)
                    .IsRequired();

                price.Property(m => m.Currency)
                    .HasColumnName("TotalAmountCurrency")
                    .HasMaxLength(3)
                    .IsRequired();
            });

            entity.HasOne(po => po.Supplier)
                .WithMany(s => s.PurchaseOrders)
                .HasForeignKey(po => po.SupplierId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasMany(po => po.Lines)
                .WithOne(l => l.PurchaseOrder)
                .HasForeignKey(l => l.PurchaseOrderId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(po => po.Warehouse)
                .WithMany()
                .HasForeignKey(po => po.WarehouseId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(po => po.Status);
            entity.HasIndex(po => po.OrderDate);
            entity.HasIndex(po => po.SupplierId);
            entity.HasIndex(po => po.WarehouseId);

            entity.Property(po => po.ProjectId);
            entity.HasIndex(po => po.ProjectId)
                .HasFilter("[ProjectId] IS NOT NULL");
        });
    }

    private static void ConfigurePurchaseOrderLine(ModelBuilder builder)
    {
        builder.Entity<PurchaseOrderLine>(entity =>
        {
            entity.ToTable("PurchaseOrderLines");
            entity.HasKey(l => l.Id);

            entity.Property(l => l.ProductCode)
                .HasMaxLength(50)
                .IsRequired();

            entity.Property(l => l.ProductName)
                .HasMaxLength(200)
                .IsRequired();

            entity.Property(l => l.ProductDescription)
                .HasMaxLength(1000);

            entity.Property(l => l.Unit)
                .HasMaxLength(50);

            entity.Property(l => l.Quantity)
                .HasPrecision(18, 4);

            entity.Property(l => l.ReceivedQuantity)
                .HasPrecision(18, 4);

            entity.Property(l => l.InvoicedQuantity)
                .HasPrecision(18, 4);

            entity.OwnsOne(l => l.UnitPrice, price =>
            {
                price.Property(m => m.Amount)
                    .HasColumnName("UnitPrice")
                    .HasPrecision(18, 3)
                    .IsRequired();

                price.Property(m => m.Currency)
                    .HasColumnName("UnitPriceCurrency")
                    .HasMaxLength(3)
                    .IsRequired();
            });

            entity.OwnsOne(l => l.SubTotal, price =>
            {
                price.Property(m => m.Amount)
                    .HasColumnName("SubTotal")
                    .HasPrecision(18, 3)
                    .IsRequired();

                price.Property(m => m.Currency)
                    .HasColumnName("SubTotalCurrency")
                    .HasMaxLength(3)
                    .IsRequired();
            });

            entity.OwnsOne(l => l.VatAmount, price =>
            {
                price.Property(m => m.Amount)
                    .HasColumnName("VatAmount")
                    .HasPrecision(18, 3)
                    .IsRequired();

                price.Property(m => m.Currency)
                    .HasColumnName("VatAmountCurrency")
                    .HasMaxLength(3)
                    .IsRequired();
            });

            entity.OwnsOne(l => l.Total, price =>
            {
                price.Property(m => m.Amount)
                    .HasColumnName("Total")
                    .HasPrecision(18, 3)
                    .IsRequired();

                price.Property(m => m.Currency)
                    .HasColumnName("TotalCurrency")
                    .HasMaxLength(3)
                    .IsRequired();
            });

            entity.HasOne(l => l.Product)
                .WithMany()
                .HasForeignKey(l => l.ProductId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(l => l.PurchaseOrderId);
        });
    }

    private static void ConfigurePurchaseReceipt(ModelBuilder builder)
    {
        builder.Entity<PurchaseReceipt>(entity =>
        {
            entity.ToTable("PurchaseReceipts");
            entity.HasKey(r => r.Id);

            entity.Property(r => r.Version).IsConcurrencyToken();
            entity.Property(r => r.SupplierReference).HasMaxLength(100);
            entity.Property(r => r.TransporterName).HasMaxLength(200);
            entity.Property(r => r.DeliveryNoteNumber).HasMaxLength(100);
            entity.Property(r => r.Notes).HasMaxLength(2000);
            entity.Property(r => r.CancellationReason).HasMaxLength(500);

            entity.OwnsOne(r => r.Number, num =>
            {
                num.Property(n => n.Value).HasColumnName("Number").HasMaxLength(50).IsRequired();
                num.Property(n => n.Prefix).HasColumnName("NumberPrefix").HasMaxLength(10).IsRequired();
                num.Property(n => n.Year).HasColumnName("NumberYear").IsRequired();
                num.Property(n => n.Sequence).HasColumnName("NumberSequence").IsRequired();
                num.HasIndex(n => n.Value).IsUnique();
            });

            entity.OwnsOne(r => r.SubTotal, price =>
            {
                price.Property(m => m.Amount).HasColumnName("SubTotal").HasPrecision(18, 3).IsRequired();
                price.Property(m => m.Currency).HasColumnName("SubTotalCurrency").HasMaxLength(3).IsRequired();
            });

            entity.OwnsOne(r => r.TotalVat, price =>
            {
                price.Property(m => m.Amount).HasColumnName("TotalVat").HasPrecision(18, 3).IsRequired();
                price.Property(m => m.Currency).HasColumnName("TotalVatCurrency").HasMaxLength(3).IsRequired();
            });

            entity.OwnsOne(r => r.TotalAmount, price =>
            {
                price.Property(m => m.Amount).HasColumnName("TotalAmount").HasPrecision(18, 3).IsRequired();
                price.Property(m => m.Currency).HasColumnName("TotalAmountCurrency").HasMaxLength(3).IsRequired();
            });

            entity.HasOne(r => r.Supplier)
                .WithMany()
                .HasForeignKey(r => r.SupplierId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(r => r.PurchaseOrder)
                .WithMany()
                .HasForeignKey(r => r.PurchaseOrderId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(r => r.Warehouse)
                .WithMany()
                .HasForeignKey(r => r.WarehouseId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasMany(r => r.Lines)
                .WithOne(l => l.PurchaseReceipt)
                .HasForeignKey(l => l.PurchaseReceiptId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasMany(r => r.Attachments)
                .WithOne(a => a.PurchaseReceipt)
                .HasForeignKey(a => a.PurchaseReceiptId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(r => r.Status);
            entity.HasIndex(r => r.ReceiptDate);
            entity.HasIndex(r => r.SupplierId);
            entity.HasIndex(r => r.PurchaseOrderId);
            entity.HasIndex(r => r.WarehouseId);
        });
    }

    private static void ConfigurePurchaseReceiptLine(ModelBuilder builder)
    {
        builder.Entity<PurchaseReceiptLine>(entity =>
        {
            entity.ToTable("PurchaseReceiptLines");
            entity.HasKey(l => l.Id);

            entity.Property(l => l.ProductCode).HasMaxLength(50).IsRequired();
            entity.Property(l => l.ProductName).HasMaxLength(200).IsRequired();
            entity.Property(l => l.ProductDescription).HasMaxLength(1000);
            entity.Property(l => l.Unit).HasMaxLength(50);
            entity.Property(l => l.OrderedQuantity).HasPrecision(18, 4);
            entity.Property(l => l.ReceivedQuantity).HasPrecision(18, 4);
            entity.Property(l => l.InvoicedQuantity).HasPrecision(18, 4);
            entity.Property(l => l.DiscountPercent).HasPrecision(5, 2);

            entity.OwnsOne(l => l.UnitPrice, price =>
            {
                price.Property(m => m.Amount).HasColumnName("UnitPrice").HasPrecision(18, 3).IsRequired();
                price.Property(m => m.Currency).HasColumnName("UnitPriceCurrency").HasMaxLength(3).IsRequired();
            });

            entity.OwnsOne(l => l.SubTotal, price =>
            {
                price.Property(m => m.Amount).HasColumnName("SubTotal").HasPrecision(18, 3).IsRequired();
                price.Property(m => m.Currency).HasColumnName("SubTotalCurrency").HasMaxLength(3).IsRequired();
            });

            entity.OwnsOne(l => l.VatAmount, price =>
            {
                price.Property(m => m.Amount).HasColumnName("VatAmount").HasPrecision(18, 3).IsRequired();
                price.Property(m => m.Currency).HasColumnName("VatAmountCurrency").HasMaxLength(3).IsRequired();
            });

            entity.OwnsOne(l => l.Total, price =>
            {
                price.Property(m => m.Amount).HasColumnName("Total").HasPrecision(18, 3).IsRequired();
                price.Property(m => m.Currency).HasColumnName("TotalCurrency").HasMaxLength(3).IsRequired();
            });

            entity.HasOne(l => l.Product)
                .WithMany()
                .HasForeignKey(l => l.ProductId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(l => l.PurchaseReceiptId);
            entity.HasIndex(l => l.PurchaseOrderLineId);
        });
    }

    private static void ConfigurePurchaseReceiptAttachment(ModelBuilder builder)
    {
        builder.Entity<PurchaseReceiptAttachment>(entity =>
        {
            entity.ToTable("PurchaseReceiptAttachments");
            entity.HasKey(a => a.Id);

            entity.Property(a => a.FileName).HasMaxLength(260).IsRequired();
            entity.Property(a => a.ContentType).HasMaxLength(100).IsRequired();
            entity.Property(a => a.StorageRelativePath).HasMaxLength(500).IsRequired();
            entity.Property(a => a.UploadedBy).HasMaxLength(200);

            entity.HasIndex(a => a.PurchaseReceiptId);
        });
    }

    private static void ConfigureSupplierInvoice(ModelBuilder builder)
    {
        builder.Entity<SupplierInvoice>(entity =>
        {
            entity.ToTable("SupplierInvoices");
            entity.HasKey(si => si.Id);

            entity.Property(si => si.InvoiceNumber)
                .HasMaxLength(100)
                .IsRequired();

            entity.Property(si => si.ExternalReference)
                .HasMaxLength(200);

            entity.Property(si => si.Notes)
                .HasMaxLength(2000);

            entity.Property(si => si.PaymentReference)
                .HasMaxLength(200);

            entity.Property(si => si.CancellationReason)
                .HasMaxLength(500);

            entity.OwnsOne(si => si.SubTotal, price =>
            {
                price.Property(m => m.Amount)
                    .HasColumnName("SubTotal")
                    .HasPrecision(18, 3)
                    .IsRequired();

                price.Property(m => m.Currency)
                    .HasColumnName("SubTotalCurrency")
                    .HasMaxLength(3)
                    .IsRequired();
            });

            entity.OwnsOne(si => si.TotalVat, price =>
            {
                price.Property(m => m.Amount)
                    .HasColumnName("TotalVat")
                    .HasPrecision(18, 3)
                    .IsRequired();

                price.Property(m => m.Currency)
                    .HasColumnName("TotalVatCurrency")
                    .HasMaxLength(3)
                    .IsRequired();
            });

            entity.OwnsOne(si => si.TotalAmount, price =>
            {
                price.Property(m => m.Amount)
                    .HasColumnName("TotalAmount")
                    .HasPrecision(18, 3)
                    .IsRequired();

                price.Property(m => m.Currency)
                    .HasColumnName("TotalAmountCurrency")
                    .HasMaxLength(3)
                    .IsRequired();
            });

            entity.OwnsOne(si => si.FiscalStampAmount, price =>
            {
                price.Property(m => m.Amount)
                    .HasColumnName("FiscalStampAmount")
                    .HasPrecision(18, 3)
                    .IsRequired();

                price.Property(m => m.Currency)
                    .HasColumnName("FiscalStampCurrency")
                    .HasMaxLength(3)
                    .IsRequired();
            });

            entity.HasOne(si => si.Supplier)
                .WithMany()
                .HasForeignKey(si => si.SupplierId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(si => si.PurchaseOrder)
                .WithMany()
                .HasForeignKey(si => si.PurchaseOrderId)
                .IsRequired(false)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(si => si.SourcePurchaseReceipt)
                .WithMany()
                .HasForeignKey(si => si.SourcePurchaseReceiptId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasMany(si => si.Lines)
                .WithOne(l => l.SupplierInvoice)
                .HasForeignKey(l => l.SupplierInvoiceId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(si => si.Warehouse)
                .WithMany()
                .HasForeignKey(si => si.WarehouseId)
                .OnDelete(DeleteBehavior.Restrict);

            // Withholding tax
            entity.Property(si => si.IsSubjectToWithholding).HasDefaultValue(false);
            entity.Property(si => si.WithholdingRate).HasPrecision(5, 2).IsRequired(false);
            entity.Property(si => si.WithholdingAmount).HasPrecision(18, 3).IsRequired(false);
            entity.Property(si => si.WithholdingTaxTypeId).IsRequired(false);
            entity.Property(si => si.NetAmountAfterWithholding).HasPrecision(18, 3).IsRequired(false);

            entity.HasIndex(si => si.InvoiceNumber).IsUnique();
            entity.HasIndex(si => si.Status);
            entity.HasIndex(si => si.InvoiceDate);
            entity.HasIndex(si => si.DueDate);
            entity.HasIndex(si => si.SupplierId);
            entity.HasIndex(si => si.PurchaseOrderId);
            entity.HasIndex(si => si.SourcePurchaseReceiptId);
            entity.HasIndex(si => si.WarehouseId);
        });
    }

    private static void ConfigureSupplierInvoiceLine(ModelBuilder builder)
    {
        builder.Entity<SupplierInvoiceLine>(entity =>
        {
            entity.ToTable("SupplierInvoiceLines");
            entity.HasKey(l => l.Id);

            entity.Property(l => l.ProductCode)
                .HasMaxLength(50)
                .IsRequired();

            entity.Property(l => l.ProductName)
                .HasMaxLength(200)
                .IsRequired();

            entity.Property(l => l.ProductDescription)
                .HasMaxLength(1000);

            entity.Property(l => l.Unit)
                .HasMaxLength(50);

            entity.Property(l => l.Quantity)
                .HasPrecision(18, 4);

            entity.HasIndex(l => l.PurchaseOrderLineId);
            entity.HasIndex(l => l.PurchaseReceiptLineId);

            entity.OwnsOne(l => l.UnitPrice, price =>
            {
                price.Property(m => m.Amount)
                    .HasColumnName("UnitPrice")
                    .HasPrecision(18, 3)
                    .IsRequired();

                price.Property(m => m.Currency)
                    .HasColumnName("UnitPriceCurrency")
                    .HasMaxLength(3)
                    .IsRequired();
            });

            entity.OwnsOne(l => l.SubTotal, price =>
            {
                price.Property(m => m.Amount)
                    .HasColumnName("SubTotal")
                    .HasPrecision(18, 3)
                    .IsRequired();

                price.Property(m => m.Currency)
                    .HasColumnName("SubTotalCurrency")
                    .HasMaxLength(3)
                    .IsRequired();
            });

            entity.OwnsOne(l => l.VatAmount, price =>
            {
                price.Property(m => m.Amount)
                    .HasColumnName("VatAmount")
                    .HasPrecision(18, 3)
                    .IsRequired();

                price.Property(m => m.Currency)
                    .HasColumnName("VatAmountCurrency")
                    .HasMaxLength(3)
                    .IsRequired();
            });

            entity.OwnsOne(l => l.Total, price =>
            {
                price.Property(m => m.Amount)
                    .HasColumnName("Total")
                    .HasPrecision(18, 3)
                    .IsRequired();

                price.Property(m => m.Currency)
                    .HasColumnName("TotalCurrency")
                    .HasMaxLength(3)
                    .IsRequired();
            });

            entity.Property(l => l.AssetAccountNumber).HasMaxLength(20);
            entity.HasIndex(l => l.SupplierInvoiceId);
            entity.HasIndex(l => l.IsFixedAsset);
        });
    }

    private static void ConfigureSupplierPayment(ModelBuilder builder)
    {
        builder.Entity<SupplierPayment>(entity =>
        {
            entity.ToTable("SupplierPayments");
            entity.HasKey(p => p.Id);

            entity.Property(p => p.Reference)
                .HasMaxLength(100);

            entity.Property(p => p.Notes)
                .HasMaxLength(500);

            entity.OwnsOne(p => p.Amount, price =>
            {
                price.Property(m => m.Amount)
                    .HasColumnName("Amount")
                    .HasPrecision(18, 3)
                    .IsRequired();

                price.Property(m => m.Currency)
                    .HasColumnName("AmountCurrency")
                    .HasMaxLength(3)
                    .IsRequired();
            });

            entity.HasOne(p => p.SupplierInvoice)
                .WithMany(si => si.Payments)
                .HasForeignKey(p => p.SupplierInvoiceId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(p => p.SupplierInvoiceId);
            entity.HasIndex(p => p.PaymentDate);
        });
    }

    private static void ConfigureStockTransfer(ModelBuilder builder)
    {
        builder.Entity<StockTransfer>(entity =>
        {
            entity.ToTable("StockTransfers");
            entity.HasKey(t => t.Id);

            entity.Property(t => t.Reference)
                .HasMaxLength(100);

            entity.Property(t => t.Notes)
                .HasMaxLength(2000);

            entity.Property(t => t.CancellationReason)
                .HasMaxLength(500);

            entity.OwnsOne(t => t.Number, num =>
            {
                num.Property(n => n.Value)
                    .HasColumnName("Number")
                    .HasMaxLength(50)
                    .IsRequired();

                num.Property(n => n.Prefix)
                    .HasColumnName("NumberPrefix")
                    .HasMaxLength(10)
                    .IsRequired();

                num.Property(n => n.Year)
                    .HasColumnName("NumberYear")
                    .IsRequired();

                num.Property(n => n.Sequence)
                    .HasColumnName("NumberSequence")
                    .IsRequired();
            });

            entity.HasOne(t => t.SourceWarehouse)
                .WithMany()
                .HasForeignKey(t => t.SourceWarehouseId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(t => t.DestinationWarehouse)
                .WithMany()
                .HasForeignKey(t => t.DestinationWarehouseId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasMany(t => t.Lines)
                .WithOne(l => l.StockTransfer)
                .HasForeignKey(l => l.StockTransferId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(t => t.Status);
            entity.HasIndex(t => t.TransferDate);
            entity.HasIndex(t => t.SourceWarehouseId);
            entity.HasIndex(t => t.DestinationWarehouseId);
        });
    }

    private static void ConfigureStockTransferLine(ModelBuilder builder)
    {
        builder.Entity<StockTransferLine>(entity =>
        {
            entity.ToTable("StockTransferLines");
            entity.HasKey(l => l.Id);

            entity.Property(l => l.ProductCode)
                .HasMaxLength(50)
                .IsRequired();

            entity.Property(l => l.ProductName)
                .HasMaxLength(200)
                .IsRequired();

            entity.Property(l => l.RequestedQuantity)
                .HasPrecision(18, 3);

            entity.Property(l => l.TransferredQuantity)
                .HasPrecision(18, 3);

            entity.Property(l => l.Notes)
                .HasMaxLength(500);

            entity.HasIndex(l => l.StockTransferId);
            entity.HasIndex(l => l.ProductId);
        });
    }

    private static void ConfigureStockVoucher(ModelBuilder builder)
    {
        builder.Entity<StockVoucher>(entity =>
        {
            entity.ToTable("StockVouchers");
            entity.HasKey(v => v.Id);

            entity.Property(v => v.Version).IsConcurrencyToken();
            entity.Property(v => v.ExternalReference).HasMaxLength(100);
            entity.Property(v => v.Notes).HasMaxLength(2000);
            entity.Property(v => v.CancellationReason).HasMaxLength(500);

            entity.OwnsOne(v => v.Number, num =>
            {
                num.Property(n => n.Value).HasColumnName("Number").HasMaxLength(50).IsRequired();
                num.Property(n => n.Prefix).HasColumnName("NumberPrefix").HasMaxLength(10).IsRequired();
                num.Property(n => n.Year).HasColumnName("NumberYear").IsRequired();
                num.Property(n => n.Sequence).HasColumnName("NumberSequence").IsRequired();
                num.HasIndex(n => n.Value).IsUnique();
            });

            entity.HasOne(v => v.Warehouse)
                .WithMany()
                .HasForeignKey(v => v.WarehouseId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasMany(v => v.Lines)
                .WithOne(l => l.StockVoucher)
                .HasForeignKey(l => l.StockVoucherId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(v => v.Status);
            entity.HasIndex(v => v.Kind);
            entity.HasIndex(v => v.VoucherDate);
            entity.HasIndex(v => v.WarehouseId);
            entity.HasIndex(v => new { v.Kind, v.Status });

            entity.Ignore(v => v.TotalQuantity);
            entity.Ignore(v => v.TotalValue);
            entity.Ignore(v => v.StockMovementReference);
            entity.Ignore(v => v.StockReversalReference);
        });
    }

    private static void ConfigureStockVoucherLine(ModelBuilder builder)
    {
        builder.Entity<StockVoucherLine>(entity =>
        {
            entity.ToTable("StockVoucherLines");
            entity.HasKey(l => l.Id);

            entity.Property(l => l.ProductCode).HasMaxLength(50).IsRequired();
            entity.Property(l => l.ProductName).HasMaxLength(200).IsRequired();
            entity.Property(l => l.Unit).HasMaxLength(50);
            entity.Property(l => l.Quantity).HasPrecision(18, 4);
            entity.Property(l => l.UnitCost).HasPrecision(18, 4);
            entity.Property(l => l.Notes).HasMaxLength(500);
            entity.Ignore(l => l.LineValue);

            entity.HasIndex(l => l.StockVoucherId);
            entity.HasIndex(l => l.ProductId);
            entity.HasIndex(l => new { l.StockVoucherId, l.ProductId }).IsUnique();
        });
    }

    private static void ConfigureChartOfAccount(ModelBuilder builder)
    {
        builder.Entity<ChartOfAccount>(entity =>
        {
            entity.ToTable("ChartOfAccounts");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.AccountNumber).HasMaxLength(32).IsRequired();
            entity.HasIndex(e => e.AccountNumber).IsUnique();
            entity.Property(e => e.Label).HasMaxLength(300).IsRequired();
            entity.Property(e => e.ParentAccountNumber).HasMaxLength(32);
            entity.Property(e => e.NatureType).HasConversion<int>();
            // Attributs « façon Axeane » (additifs, défauts rétro-compatibles).
            entity.Property(e => e.AccountType).HasConversion<int>().HasDefaultValue(AccountType.General);
            entity.Property(e => e.IsAuxiliary).HasDefaultValue(false);
            entity.Property(e => e.AffectationAccountNumber).HasMaxLength(32);
        });
    }

    private static void ConfigureAccountingPeriod(ModelBuilder builder)
    {
        builder.Entity<AccountingPeriod>(entity =>
        {
            entity.ToTable("AccountingPeriods");
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => new { e.FiscalYear, e.Month }).IsUnique();
        });
    }

    private static void ConfigureAccountingYearLock(ModelBuilder builder)
    {
        builder.Entity<AccountingYearLock>(entity =>
        {
            entity.ToTable("AccountingYearLocks");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.LockedBy).HasMaxLength(256).IsRequired();
            entity.HasIndex(e => e.FiscalYear).IsUnique();
        });
    }

    private static void ConfigureJournalEntrySequence(ModelBuilder builder)
    {
        builder.Entity<JournalEntrySequence>(entity =>
        {
            entity.ToTable("JournalEntrySequences");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.JournalCode).HasMaxLength(10).IsRequired();
            entity.HasIndex(e => new { e.JournalCode, e.FiscalYear }).IsUnique();
        });
    }

    private static void ConfigureJournalEntry(ModelBuilder builder)
    {
        builder.Entity<JournalEntry>(entity =>
        {
            entity.ToTable("JournalEntries");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.JournalCode).HasMaxLength(10).IsRequired();
            entity.Property(e => e.Label).HasMaxLength(500).IsRequired();
            entity.Property(e => e.SourceEntityType).HasMaxLength(80);
            // Statut brouillard/validation. Défaut BDD = Validee (1) : les écritures existantes migrées
            // restent définitives et les états sont strictement inchangés (cf. JournalEntryStatus).
            // Sentinel = Validee : EF n'omet la colonne (⇒ défaut BDD) QUE lorsque la valeur est Validee ;
            // un Brouillon (0) est donc TOUJOURS écrit explicitement (indispensable au workflow brouillard).
            entity.Property(e => e.Status)
                .HasConversion<int>()
                .HasDefaultValue(JournalEntryStatus.Validee)
                .HasSentinel(JournalEntryStatus.Validee);
            entity.Property(e => e.ValidatedBy).HasMaxLength(256);
            // Pièce externe (référence + date), facultative — cf. JournalEntry.PieceRef/PieceDate.
            entity.Property(e => e.PieceRef).HasMaxLength(50);
            entity.Property(e => e.CurrencyCode).IsRequired().HasMaxLength(3).HasDefaultValue("TND");
            entity.Property(e => e.ExchangeRate).HasPrecision(18, 6).HasDefaultValue(1m);
            entity.Property(e => e.ExchangeRateOverridden).HasDefaultValue(false);
            entity.HasIndex(e => e.PieceRef);
            entity.HasIndex(e => e.Status);
            entity.HasIndex(e => new { e.JournalCode, e.EntryNumber, e.EntryDate });
            // R-16/M2 : une seule écriture sourcing ACTIVE par entité source, pour les types de
            // « comptabilisation aller » de la paie (PayrollRun, PayrollPayment,
            // CnssContributionPayment). Index unique FILTRÉ : exclut les écritures extournées
            // (IsReversed = 1), les écritures manuelles non sourcées (SourceEntityType/SourceEntityId
            // NULL) ET les écritures d'annulation (*Cancelled), qui peuvent s'accumuler sur un même
            // cycle rouvert plusieurs fois (chaque réouverture ajoute une extourne
            // PayrollRunCancelled IsReversed = 0 pour le même runId). Limiter l'IN aux types « aller »
            // préserve le cycle reopen→revalidation. Évite le doublon d'OD sur un recalcul/revalidation
            // concurrent ; une violation lève DbUpdateException (→ HTTP 409 via le middleware).
            entity.HasIndex(e => new { e.SourceEntityType, e.SourceEntityId })
                  .IsUnique()
                  .HasFilter("[IsReversed] = 0 AND [SourceEntityType] IN (N'PayrollRun', N'PayrollPayment', N'CnssContributionPayment', N'PayrollReclassification')");
            entity.HasOne(e => e.AccountingPeriod)
                .WithMany()
                .HasForeignKey(e => e.AccountingPeriodId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasMany(e => e.Lines)
                .WithOne(l => l.JournalEntry)
                .HasForeignKey(l => l.JournalEntryId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }

    private static void ConfigureJournalCatalog(ModelBuilder builder)
    {
        builder.Entity<JournalFamily>(entity =>
        {
            entity.ToTable("JournalFamilies");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Code).HasMaxLength(20).IsRequired();
            entity.Property(e => e.Label).HasMaxLength(200).IsRequired();
            entity.HasIndex(e => e.Code).IsUnique();
        });

        builder.Entity<Journal>(entity =>
        {
            entity.ToTable("Journals");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Code).HasMaxLength(10).IsRequired();
            entity.Property(e => e.Label).HasMaxLength(200).IsRequired();
            entity.HasIndex(e => e.Code).IsUnique();
        });
    }

    private static void ConfigureBudgeting(ModelBuilder builder)
    {
        builder.Entity<BudgetPost>(entity =>
        {
            entity.ToTable("BudgetPosts");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Code).HasMaxLength(20).IsRequired();
            entity.Property(e => e.Label).HasMaxLength(200).IsRequired();
            entity.Property(e => e.Kind).HasConversion<int>();
            entity.Property(e => e.AccountPrefixes).HasMaxLength(200).IsRequired();
            entity.HasIndex(e => e.Code).IsUnique();
        });

        builder.Entity<BudgetYear>(entity =>
        {
            entity.ToTable("BudgetYears");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Status).HasConversion<int>();
            entity.Property(e => e.ValidatedBy).HasMaxLength(256);
            entity.HasIndex(e => e.FiscalYear).IsUnique();
        });

        builder.Entity<BudgetLine>(entity =>
        {
            entity.ToTable("BudgetLines");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Version).HasConversion<int>();
            entity.Property(e => e.Amount).HasPrecision(18, 3);
            entity.HasOne(e => e.BudgetPost)
                .WithMany()
                .HasForeignKey(e => e.BudgetPostId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasIndex(e => new { e.BudgetPostId, e.FiscalYear, e.Version, e.Month }).IsUnique();
            entity.HasIndex(e => new { e.FiscalYear, e.Version });
        });
    }

    /// <summary>
    /// Configuration paramétrable de la déclaration mensuelle : régime du dossier, inclusion des
    /// familles, rubriques et comptes sélectionnés.
    /// </summary>
    /// <summary>
    /// Détail par rubrique d'une déclaration déposée. Code, libellé, famille et code rapport sont
    /// dénormalisés : le dépôt fait foi, y compris sur les intitulés.
    /// </summary>
    private static void ConfigureVatDeclarationLine(ModelBuilder builder)
    {
        builder.Entity<VatDeclarationLine>(entity =>
        {
            entity.ToTable("VatDeclarationLines");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.RubricCode)
                .HasMaxLength(VatDeclarationLine.MaxCodeLength).IsRequired();
            entity.Property(e => e.Label).HasMaxLength(VatDeclarationLine.MaxLabelLength);
            entity.Property(e => e.ReportCode).HasMaxLength(VatDeclarationLine.MaxReportCodeLength);
            entity.Property(e => e.Family).HasConversion<int>();
            entity.Property(e => e.Origin).HasConversion<int>();
            entity.Property(e => e.GrossAmount).HasPrecision(18, 3);
            entity.Property(e => e.WithheldAmount).HasPrecision(18, 3);
            entity.Property(e => e.ComputedGrossAmount).HasPrecision(18, 3);
            entity.Property(e => e.ComputedWithheldAmount).HasPrecision(18, 3);
            entity.Property(e => e.RatePercentApplied).HasPrecision(9, 4);
            entity.HasIndex(e => new { e.VatDeclarationId, e.RubricCode }).IsUnique();
            // Aucune contrainte vers MonthlyDeclarationRubrics : supprimer une rubrique ne doit ni
            // emporter ni bloquer les déclarations qu'elle a servi à produire.
            entity.Property(e => e.RubricId);
        });
    }

    private static void ConfigureMonthlyDeclarationConfig(ModelBuilder builder)
    {
        builder.Entity<MonthlyDeclarationSettings>(entity =>
        {
            entity.ToTable("MonthlyDeclarationSettings");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Mode).HasConversion<int>();
            entity.Property(e => e.ParityOverrideBy).HasMaxLength(256);
            entity.Property(e => e.ParityOverrideReason)
                .HasMaxLength(Domain.Entities.MonthlyDeclarationSettings.MaxOverrideReasonLength);
        });

        builder.Entity<MonthlyDeclarationFamilySetting>(entity =>
        {
            entity.ToTable("MonthlyDeclarationFamilySettings");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Family).HasConversion<int>();
            entity.HasIndex(e => e.Family).IsUnique();
        });

        builder.Entity<MonthlyDeclarationRubric>(entity =>
        {
            entity.ToTable("MonthlyDeclarationRubrics");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Family).HasConversion<int>();
            entity.Property(e => e.Code)
                .HasMaxLength(MonthlyDeclarationRubric.MaxCodeLength).IsRequired();
            entity.Property(e => e.Label)
                .HasMaxLength(MonthlyDeclarationRubric.MaxLabelLength).IsRequired();
            entity.Property(e => e.ReportCode)
                .HasMaxLength(MonthlyDeclarationRubric.MaxReportCodeLength).IsRequired();
            entity.Property(e => e.GrossKind).HasConversion<int>();
            entity.Property(e => e.WithheldKind).HasConversion<int>();
            entity.Property(e => e.GrossSide).HasConversion<int>();
            entity.Property(e => e.WithheldSide).HasConversion<int>();
            entity.Property(e => e.PayrollComponent).HasConversion<int>();
            entity.Property(e => e.WithheldPayrollComponent).HasConversion<int>();
            entity.Property(e => e.RatePercent).HasPrecision(9, 4);
            entity.Property(e => e.FixedGrossAmount).HasPrecision(18, 3);
            entity.Property(e => e.FixedWithheldAmount).HasPrecision(18, 3);
            entity.HasIndex(e => e.Code).IsUnique();
            entity.HasIndex(e => new { e.Family, e.DisplayOrder });

            entity.HasMany(e => e.Accounts)
                .WithOne()
                .HasForeignKey(a => a.RubricId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.Metadata
                .FindNavigation(nameof(MonthlyDeclarationRubric.Accounts))!
                .SetPropertyAccessMode(PropertyAccessMode.Field);
        });

        builder.Entity<MonthlyDeclarationRubricSeedLog>(entity =>
        {
            entity.ToTable("MonthlyDeclarationRubricSeedLogs");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.CatalogVersion)
                .HasMaxLength(MonthlyDeclarationRubricSeedLog.MaxVersionLength).IsRequired();
            entity.HasIndex(e => e.CatalogVersion).IsUnique();
        });

        builder.Entity<MonthlyDeclarationRubricAccount>(entity =>
        {
            entity.ToTable("MonthlyDeclarationRubricAccounts");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Role).HasConversion<int>();
            entity.Property(e => e.MatchMode).HasConversion<int>();
            entity.Property(e => e.AccountNumber)
                .HasMaxLength(MonthlyDeclarationRubricAccount.MaxAccountNumberLength).IsRequired();
            entity.HasIndex(e => new { e.RubricId, e.Role, e.AccountNumber }).IsUnique();
            // Index de service : la renumérotation du plan comptable balaie cette colonne.
            entity.HasIndex(e => e.AccountNumber);
        });
    }

    private static void ConfigureThirdPartyAccountingProfile(ModelBuilder builder)
    {
        builder.Entity<ThirdPartyAccountingProfile>(entity =>
        {
            entity.ToTable("ThirdPartyAccountingProfiles");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Kind).HasConversion<int>();
            entity.Property(e => e.AuxiliaryCode).HasMaxLength(20).IsRequired();
            entity.Property(e => e.CollectiveAccountNumber).HasMaxLength(20).IsRequired();
            entity.Property(e => e.AccountingNotes).HasMaxLength(500);
            entity.HasIndex(e => new { e.Kind, e.ThirdPartyId }).IsUnique();
            entity.HasIndex(e => e.AuxiliaryCode).IsUnique();
        });
    }

    private static void ConfigureJournalEntryLine(ModelBuilder builder)
    {
        builder.Entity<JournalEntryLine>(entity =>
        {
            entity.ToTable("JournalEntryLines");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.AccountNumber).HasMaxLength(32).IsRequired();
            entity.Property(e => e.Label).HasMaxLength(500).IsRequired();
            entity.Property(e => e.LetteringCode).HasMaxLength(16);
            entity.Property(e => e.ThirdPartyKind).HasConversion<int>();
            // Montants dans la devise de transaction. NE PAS confondre avec les colonnes
            // DebitCurrency / CreditCurrency ci-dessous, qui portent la devise du Money et valent
            // TOUJOURS la devise de tenue : c'est ce qui permet à tous les agrégats de restitution
            // de sommer .Amount sans convertir.
            entity.Property(e => e.DebitAmountInCurrency).HasPrecision(18, 3).HasDefaultValue(0m);
            entity.Property(e => e.CreditAmountInCurrency).HasPrecision(18, 3).HasDefaultValue(0m);

            entity.OwnsOne(e => e.DebitAmount, m =>
            {
                m.Property(x => x.Amount).HasColumnName("DebitAmount").HasPrecision(18, 3);
                m.Property(x => x.Currency).HasColumnName("DebitCurrency").HasMaxLength(3);
            });
            entity.OwnsOne(e => e.CreditAmount, m =>
            {
                m.Property(x => x.Amount).HasColumnName("CreditAmount").HasPrecision(18, 3);
                m.Property(x => x.Currency).HasColumnName("CreditCurrency").HasMaxLength(3);
            });
            entity.HasIndex(e => e.AccountNumber);
        });
    }

    private static void ConfigureLetteringGroup(ModelBuilder builder)
    {
        builder.Entity<LetteringGroup>(entity =>
        {
            entity.ToTable("LetteringGroups");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Code).HasMaxLength(16).IsRequired();
            entity.Property(e => e.AccountNumber).HasMaxLength(32).IsRequired();
            entity.OwnsOne(e => e.Amount, m =>
            {
                m.Property(x => x.Amount).HasColumnName("Amount").HasPrecision(18, 3);
                m.Property(x => x.Currency).HasColumnName("Currency").HasMaxLength(3);
            });
            entity.HasMany(e => e.Members)
                .WithOne(m => m.LetteringGroup)
                .HasForeignKey(m => m.LetteringGroupId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }

    private static void ConfigureLetteringGroupMember(ModelBuilder builder)
    {
        builder.Entity<LetteringGroupMember>(entity =>
        {
            entity.ToTable("LetteringGroupMembers");
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.JournalEntryLineId);
        });
    }

    private static void ConfigureCurrency(ModelBuilder builder)
    {
        builder.Entity<Currency>(entity =>
        {
            entity.ToTable("Currencies");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Code).IsRequired().HasMaxLength(Currency.CodeLength);
            entity.Property(e => e.Label).IsRequired().HasMaxLength(Currency.MaxLabelLength);
            entity.Property(e => e.RatePeriodicity).HasConversion<int>();
            entity.HasIndex(e => e.Code).IsUnique();

            // Une seule devise de tenue des comptes : index unique filtré sur IsFunctional.
            entity.HasIndex(e => e.IsFunctional)
                  .IsUnique()
                  .HasFilter("[IsFunctional] = 1");
        });
    }

    private static void ConfigureCurrencyExchangeRate(ModelBuilder builder)
    {
        builder.Entity<CurrencyExchangeRate>(entity =>
        {
            entity.ToTable("CurrencyExchangeRates");
            entity.HasKey(e => e.Id);

            // Unités de devise fonctionnelle pour UNE unité de devise étrangère (1 EUR = 3,31420 TND).
            // 18,6 reprend la précision de l'ancienne colonne WithholdingTaxCertificateLines.ExchangeRate.
            entity.Property(e => e.Rate).HasPrecision(18, 6);

            // Month vaut NULL pour un taux fixe couvrant tout l'exercice. SQL Server considère les
            // NULL comme distincts dans un index unique : l'unicité du taux fixe est donc portée par
            // un second index filtré.
            entity.HasIndex(e => new { e.CurrencyId, e.FiscalYear, e.Month })
                  .IsUnique()
                  .HasFilter("[Month] IS NOT NULL");

            entity.HasIndex(e => new { e.CurrencyId, e.FiscalYear })
                  .IsUnique()
                  .HasFilter("[Month] IS NULL");

            entity.HasOne(e => e.Currency)
                  .WithMany()
                  .HasForeignKey(e => e.CurrencyId)
                  .OnDelete(DeleteBehavior.Cascade);
        });
    }

    private static void ConfigureJournalEntryAttachment(ModelBuilder builder)
    {
        builder.Entity<JournalEntryAttachment>(entity =>
        {
            entity.ToTable("JournalEntryAttachments");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.FileName).HasMaxLength(260).IsRequired();
            entity.Property(e => e.StoragePath).HasMaxLength(500).IsRequired();
            entity.Property(e => e.ContentType).HasMaxLength(120).IsRequired();
            entity.HasOne(e => e.JournalEntry)
                .WithMany()
                .HasForeignKey(e => e.JournalEntryId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasIndex(e => e.JournalEntryId);
        });
    }

    private static void ConfigureBankStatement(ModelBuilder builder)
    {
        builder.Entity<BankStatement>(entity =>
        {
            entity.ToTable("BankStatements");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.BankName).HasMaxLength(200).IsRequired();
            entity.Property(e => e.AccountNumber).HasMaxLength(64).IsRequired();
            entity.Property(e => e.ChartOfAccountNumber).HasMaxLength(20);
            entity.Property(e => e.SourceFileName).HasMaxLength(260);
            entity.Property(e => e.SourceFileHash).HasMaxLength(64);
            entity.Property(e => e.ImportMethod).HasConversion<int>();
            entity.HasOne<BankAccount>()
                .WithMany()
                .HasForeignKey(e => e.BankAccountId)
                .OnDelete(DeleteBehavior.SetNull);
            entity.OwnsOne(e => e.OpeningBalance, m =>
            {
                m.Property(x => x.Amount).HasColumnName("OpeningBalance").HasPrecision(18, 3);
                m.Property(x => x.Currency).HasColumnName("OpeningCurrency").HasMaxLength(3);
            });
            entity.OwnsOne(e => e.ClosingBalance, m =>
            {
                m.Property(x => x.Amount).HasColumnName("ClosingBalance").HasPrecision(18, 3);
                m.Property(x => x.Currency).HasColumnName("ClosingCurrency").HasMaxLength(3);
            });
            entity.HasMany(e => e.Lines)
                .WithOne(l => l.BankStatement)
                .HasForeignKey(l => l.BankStatementId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasIndex(e => new { e.AccountNumber, e.StatementDate });
            entity.HasIndex(e => e.BankAccountId);
        });
    }

    private static void ConfigureBankStatementLine(ModelBuilder builder)
    {
        builder.Entity<BankStatementLine>(entity =>
        {
            entity.ToTable("BankStatementLines");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.ValueDate);
            entity.Property(e => e.Reference).HasMaxLength(100).IsRequired();
            entity.Property(e => e.Description).HasMaxLength(500).IsRequired();
            entity.Property(e => e.Fingerprint).HasMaxLength(64);
            entity.OwnsOne(e => e.Amount, m =>
            {
                m.Property(x => x.Amount).HasColumnName("Amount").HasPrecision(18, 3);
                m.Property(x => x.Currency).HasColumnName("Currency").HasMaxLength(3);
            });
            entity.HasIndex(e => e.BankStatementId);
            entity.HasIndex(e => e.ReconciledJournalEntryLineId);
            entity.HasIndex(e => e.Fingerprint);
        });
    }

    private static void ConfigureVatDeclaration(ModelBuilder builder)
    {
        builder.Entity<VatDeclaration>(entity =>
        {
            entity.ToTable("VatDeclarations");
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => new { e.Year, e.Month }).IsUnique();
            entity.Property(e => e.Status).HasConversion<int>();
            entity.OwnsOne(e => e.CollectedVat19, m =>
            {
                m.Property(x => x.Amount).HasColumnName("CollectedVat19").HasPrecision(18, 3);
                m.Property(x => x.Currency).HasColumnName("CollectedVat19Currency").HasMaxLength(3);
            });
            entity.OwnsOne(e => e.CollectedVat13, m =>
            {
                m.Property(x => x.Amount).HasColumnName("CollectedVat13").HasPrecision(18, 3);
                m.Property(x => x.Currency).HasColumnName("CollectedVat13Currency").HasMaxLength(3);
            });
            entity.OwnsOne(e => e.CollectedVat7, m =>
            {
                m.Property(x => x.Amount).HasColumnName("CollectedVat7").HasPrecision(18, 3);
                m.Property(x => x.Currency).HasColumnName("CollectedVat7Currency").HasMaxLength(3);
            });
            entity.OwnsOne(e => e.DeductibleVatGoods, m =>
            {
                m.Property(x => x.Amount).HasColumnName("DeductibleVatGoods").HasPrecision(18, 3);
                m.Property(x => x.Currency).HasColumnName("DeductibleVatGoodsCurrency").HasMaxLength(3);
            });
            entity.OwnsOne(e => e.DeductibleVatAssets, m =>
            {
                m.Property(x => x.Amount).HasColumnName("DeductibleVatAssets").HasPrecision(18, 3);
                m.Property(x => x.Currency).HasColumnName("DeductibleVatAssetsCurrency").HasMaxLength(3);
            });
            entity.OwnsOne(e => e.PreviousCredit, m =>
            {
                m.Property(x => x.Amount).HasColumnName("PreviousCredit").HasPrecision(18, 3);
                m.Property(x => x.Currency).HasColumnName("PreviousCreditCurrency").HasMaxLength(3);
            });
            entity.OwnsOne(e => e.VatDue, m =>
            {
                m.Property(x => x.Amount).HasColumnName("VatDue").HasPrecision(18, 3);
                m.Property(x => x.Currency).HasColumnName("VatDueCurrency").HasMaxLength(3);
            });
            entity.OwnsOne(e => e.CreditToCarry, m =>
            {
                m.Property(x => x.Amount).HasColumnName("CreditToCarry").HasPrecision(18, 3);
                m.Property(x => x.Currency).HasColumnName("CreditToCarryCurrency").HasMaxLength(3);
            });
            // Déclaration mensuelle unique (V2) : autres taxes + versionnement. Additif, défaut 0/1/false.
            entity.Property(e => e.Fodec).HasPrecision(18, 3).HasDefaultValue(0m);
            entity.Property(e => e.DroitTimbre).HasPrecision(18, 3).HasDefaultValue(0m);
            entity.Property(e => e.Tcl).HasPrecision(18, 3).HasDefaultValue(0m);
            entity.Property(e => e.Tfp).HasPrecision(18, 3).HasDefaultValue(0m);
            entity.Property(e => e.Foprolos).HasPrecision(18, 3).HasDefaultValue(0m);
            entity.Property(e => e.WithholdingTax).HasPrecision(18, 3).HasDefaultValue(0m);
            entity.Property(e => e.Acomptes).HasPrecision(18, 3).HasDefaultValue(0m);
            // Familles produites uniquement par le moteur paramétré : 0 pour tout dossier resté en
            // calcul historique, donc sans effet sur le total à payer.
            entity.Property(e => e.ConsumptionDuty).HasPrecision(18, 3).HasDefaultValue(0m);
            entity.Property(e => e.HotelTax).HasPrecision(18, 3).HasDefaultValue(0m);
            entity.Property(e => e.LicenceFee).HasPrecision(18, 3).HasDefaultValue(0m);

            entity.HasMany(e => e.Lines)
                .WithOne()
                .HasForeignKey(l => l.VatDeclarationId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.Metadata
                .FindNavigation(nameof(VatDeclaration.Lines))!
                .SetPropertyAccessMode(PropertyAccessMode.Field);
            entity.Property(e => e.RevisionNumber).HasDefaultValue(1);
            entity.Property(e => e.IsRectificative).HasDefaultValue(false);
        });
    }

    private static void ConfigureFiscalSchedule(ModelBuilder builder)
    {
        builder.Entity<FiscalScheduleEntry>(entity =>
        {
            entity.ToTable("FiscalScheduleEntries");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.ObligationType).HasConversion<int>();
            entity.Property(e => e.ObligationLabel).HasMaxLength(200).IsRequired();
            entity.Property(e => e.Currency).HasMaxLength(3).IsRequired();
            entity.Property(e => e.EstimatedAmount).HasPrecision(18, 3);
            entity.Property(e => e.SourceType).HasConversion<int>();
            entity.Property(e => e.ResponsibleName).HasMaxLength(200);
            entity.Property(e => e.Observations).HasMaxLength(1000);
            entity.Property(e => e.LastReminderChannel).HasConversion<int>();
            entity.Property(e => e.ValidatedBy).HasMaxLength(200);
            entity.Property(e => e.RowVersion).IsRowVersion();
            entity.HasIndex(e => e.FiscalYear);
            entity.HasIndex(e => e.DueDate);
            entity.HasIndex(e => e.ObligationType);
            entity.HasIndex(e => e.ResponsibleUserId);
            entity.HasIndex(e => new { e.ObligationType, e.FiscalYear, e.PeriodMonth, e.PeriodQuarter, e.SourceType, e.IsCancelled });
            entity.HasIndex(e => new { e.SourceType, e.SourceId });
            entity.HasMany(e => e.History)
                .WithOne(h => h.FiscalScheduleEntry)
                .HasForeignKey(h => h.FiscalScheduleEntryId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasMany(e => e.Attachments)
                .WithOne(a => a.FiscalScheduleEntry)
                .HasForeignKey(a => a.FiscalScheduleEntryId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<FiscalScheduleHistoryEntry>(entity =>
        {
            entity.ToTable("FiscalScheduleHistoryEntries");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Action).HasMaxLength(100).IsRequired();
            entity.Property(e => e.Summary).HasMaxLength(1000).IsRequired();
            entity.Property(e => e.OldValuesJson);
            entity.Property(e => e.NewValuesJson);
            entity.HasIndex(e => e.FiscalScheduleEntryId);
            entity.HasIndex(e => e.CreatedAt);
        });

        builder.Entity<FiscalScheduleAttachment>(entity =>
        {
            entity.ToTable("FiscalScheduleAttachments");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.FileName).HasMaxLength(260).IsRequired();
            entity.Property(e => e.ContentType).HasMaxLength(120).IsRequired();
            entity.Property(e => e.StoragePath).HasMaxLength(500).IsRequired();
            entity.HasIndex(e => e.FiscalScheduleEntryId);
        });
    }

    private static void ConfigureOpportunity(ModelBuilder builder)
    {
        builder.Entity<Opportunity>(entity =>
        {
            entity.ToTable("Opportunities");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Title).HasMaxLength(500).IsRequired();
            entity.Property(e => e.AssignedUserName).HasMaxLength(200).IsRequired();
            entity.Property(e => e.LostReason).HasMaxLength(1000);
            entity.Property(e => e.Notes).HasMaxLength(2000);
            entity.Property(e => e.Source).HasMaxLength(200);
            entity.Property(e => e.Stage).HasConversion<int>();
            entity.OwnsOne(e => e.ExpectedAmount, m =>
            {
                m.Property(p => p.Amount).HasColumnName("ExpectedAmount").HasPrecision(18, 3);
                m.Property(p => p.Currency).HasColumnName("ExpectedAmountCurrency").HasMaxLength(3);
            });
            entity.HasIndex(e => e.ClientId);
            entity.HasIndex(e => e.AssignedUserId);
            entity.HasIndex(e => e.Stage);
            entity.Ignore(e => e.WeightedAmount);
        });
    }

    private static void ConfigureSalesActivity(ModelBuilder builder)
    {
        builder.Entity<SalesActivity>(entity =>
        {
            entity.ToTable("SalesActivities");
            entity.HasKey(e => e.Id);

            entity.Property(e => e.Type).HasConversion<int>();
            entity.Property(e => e.Subject).HasMaxLength(500).IsRequired();
            entity.Property(e => e.Description).HasMaxLength(2000);
            entity.Property(e => e.AssignedUserName).HasMaxLength(200).IsRequired();
            entity.Property(e => e.Priority).HasConversion<int>();
            entity.Property(e => e.LinkedEntityType).HasMaxLength(100);

            entity.HasIndex(e => e.ClientId);
            entity.HasIndex(e => e.AssignedUserId);
            entity.HasIndex(e => e.OpportunityId);
            entity.HasIndex(e => e.DueDate);
            entity.Ignore(e => e.IsCompleted);
        });
    }

    private static void ConfigureSalesTarget(ModelBuilder builder)
    {
        builder.Entity<SalesTarget>(entity =>
        {
            entity.ToTable("SalesTargets");
            entity.HasKey(e => e.Id);

            entity.Property(e => e.UserName).HasMaxLength(200).IsRequired();
            entity.OwnsOne(e => e.TargetAmount, m =>
            {
                m.Property(p => p.Amount).HasColumnName("TargetAmount").HasPrecision(18, 3);
                m.Property(p => p.Currency).HasColumnName("TargetAmountCurrency").HasMaxLength(3);
            });
            entity.HasIndex(e => new { e.UserId, e.Year, e.Month }).IsUnique();
        });
    }

    private static void ConfigureQuoteTemplate(ModelBuilder builder)
    {
        builder.Entity<QuoteTemplate>(entity =>
        {
            entity.ToTable("QuoteTemplates");
            entity.HasKey(e => e.Id);

            entity.Property(e => e.Name).HasMaxLength(300).IsRequired();
            entity.Property(e => e.Description).HasMaxLength(1000);
            entity.Property(e => e.DefaultNotes).HasMaxLength(2000);
            entity.Property(e => e.DefaultTermsAndConditions).HasMaxLength(4000);

            entity.HasMany(q => q.Lines)
                .WithOne(l => l.QuoteTemplate)
                .HasForeignKey(l => l.QuoteTemplateId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }

    private static void ConfigureQuoteTemplateLine(ModelBuilder builder)
    {
        builder.Entity<QuoteTemplateLine>(entity =>
        {
            entity.ToTable("QuoteTemplateLines");
            entity.HasKey(e => e.Id);

            entity.Property(e => e.Quantity).HasPrecision(18, 4);
            entity.Property(e => e.DiscountPercent).HasPrecision(5, 2);

            entity.OwnsOne(l => l.CustomUnitPrice, price =>
            {
                price.Property(m => m.Amount).HasColumnName("CustomUnitPrice").HasPrecision(18, 3);
                price.Property(m => m.Currency).HasColumnName("CustomUnitPriceCurrency").HasMaxLength(3);
            });

            entity.HasIndex(l => l.QuoteTemplateId);
            entity.HasIndex(l => l.ProductId);
        });
    }

    private static void ConfigureJournalEntryTemplate(ModelBuilder builder)
    {
        builder.Entity<JournalEntryTemplate>(entity =>
        {
            entity.ToTable("JournalEntryTemplates");
            entity.HasKey(e => e.Id);

            entity.Property(e => e.Name).HasMaxLength(200).IsRequired();
            entity.Property(e => e.Description).HasMaxLength(1000);
            entity.Property(e => e.JournalCode).HasMaxLength(10).IsRequired();
            entity.Property(e => e.LabelTemplate).HasMaxLength(500);

            entity.HasMany(t => t.Lines)
                .WithOne(l => l.JournalEntryTemplate)
                .HasForeignKey(l => l.JournalEntryTemplateId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(e => e.Name);
            entity.HasIndex(e => e.IsActive);
        });
    }

    private static void ConfigureJournalEntryTemplateLine(ModelBuilder builder)
    {
        builder.Entity<JournalEntryTemplateLine>(entity =>
        {
            entity.ToTable("JournalEntryTemplateLines");
            entity.HasKey(e => e.Id);

            entity.Property(e => e.AccountNumber).HasMaxLength(20).IsRequired();
            entity.Property(e => e.LineLabelTemplate).HasMaxLength(500);
            entity.Property(e => e.FixedDebit).HasPrecision(18, 3);
            entity.Property(e => e.FixedCredit).HasPrecision(18, 3);

            entity.HasIndex(l => l.JournalEntryTemplateId);
        });
    }

    private static void ConfigureDepreciationRateCategory(ModelBuilder builder)
    {
        builder.Entity<DepreciationRateCategory>(entity =>
        {
            entity.ToTable("DepreciationRateCategories");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Code).HasMaxLength(32).IsRequired();
            entity.HasIndex(e => e.Code).IsUnique();
            entity.Property(e => e.Label).HasMaxLength(300).IsRequired();
            entity.Property(e => e.LegalRatePercent).HasPrecision(8, 4);
            entity.Property(e => e.DefaultAssetAccount).HasMaxLength(20).IsRequired();
            entity.Property(e => e.DefaultDepreciationAccount).HasMaxLength(20).IsRequired();
            entity.Property(e => e.DefaultExpenseAccount).HasMaxLength(20).IsRequired();
            entity.HasIndex(e => e.SortOrder);
        });
    }

    private static void ConfigureFixedAsset(ModelBuilder builder)
    {
        builder.Entity<FixedAsset>(entity =>
        {
            entity.ToTable("FixedAssets");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.InventoryNumber).HasMaxLength(32).IsRequired();
            entity.HasIndex(e => e.InventoryNumber).IsUnique();
            entity.Property(e => e.Label).HasMaxLength(300).IsRequired();
            entity.Property(e => e.Description).HasMaxLength(2000);
            entity.Property(e => e.AssetAccountNumber).HasMaxLength(20).IsRequired();
            entity.Property(e => e.DepreciationAccountNumber).HasMaxLength(20).IsRequired();
            entity.Property(e => e.ExpenseAccountNumber).HasMaxLength(20).IsRequired();
            entity.Property(e => e.AcquisitionCost).HasPrecision(18, 3);
            entity.Property(e => e.CapitalizedFees).HasPrecision(18, 3);
            entity.Property(e => e.ResidualValue).HasPrecision(18, 3);
            entity.Property(e => e.VatAmount).HasPrecision(18, 3);
            entity.Property(e => e.VatCapitalized).HasDefaultValue(false);
            entity.Property(e => e.DepreciationRatePercent).HasPrecision(8, 4);
            entity.Property(e => e.UsefulLifeYears).HasPrecision(8, 2);
            entity.Property(e => e.AccelerationCoefficient).HasPrecision(8, 4).HasDefaultValue(1m);
            entity.Property(e => e.AccumulatedDepreciation).HasPrecision(18, 3);
            entity.Property(e => e.NetBookValue).HasPrecision(18, 3);
            entity.Property(e => e.Location).HasMaxLength(200);
            entity.Property(e => e.CreditAccountNumber).HasMaxLength(20);
            entity.Property(e => e.DisposalProceeds).HasPrecision(18, 3);
            entity.Property(e => e.DisposalTreasuryAccount).HasMaxLength(20);
            entity.Property(e => e.DisposalReceivableAccount).HasMaxLength(20);
            entity.Property(e => e.Status).HasConversion<int>();
            entity.Property(e => e.DepreciationMethod).HasConversion<int>();
            entity.HasIndex(e => e.Status);
            entity.HasIndex(e => e.DepreciationRateCategoryId);
            entity.HasIndex(e => e.SupplierInvoiceId);
            entity.HasIndex(e => e.SupplierInvoiceLineId);
            entity.Property(e => e.Version).IsConcurrencyToken();
            entity.HasOne(e => e.DepreciationRateCategory)
                .WithMany()
                .HasForeignKey(e => e.DepreciationRateCategoryId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.Navigation(e => e.Events).UsePropertyAccessMode(PropertyAccessMode.Field);
            entity.Navigation(e => e.ScheduleLines).UsePropertyAccessMode(PropertyAccessMode.Field);
        });
    }

    private static void ConfigureDepreciationScheduleLine(ModelBuilder builder)
    {
        builder.Entity<DepreciationScheduleLine>(entity =>
        {
            entity.ToTable("DepreciationScheduleLines");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.OpeningNbv).HasPrecision(18, 3);
            entity.Property(e => e.NormalAnnualAmount).HasPrecision(18, 3);
            entity.Property(e => e.PriorAccumulatedDepreciation).HasPrecision(18, 3);
            entity.Property(e => e.DepreciationAmount).HasPrecision(18, 3);
            entity.Property(e => e.AccumulatedDepreciation).HasPrecision(18, 3);
            entity.Property(e => e.ClosingNbv).HasPrecision(18, 3);
            entity.HasIndex(e => new { e.FixedAssetId, e.FiscalYear, e.PeriodMonth })
                .IsUnique()
                .HasFilter("[PeriodMonth] IS NOT NULL");
            entity.HasIndex(e => new { e.FixedAssetId, e.FiscalYear })
                .IsUnique()
                .HasFilter("[PeriodMonth] IS NULL");
            entity.HasIndex(e => e.IsPosted);
            entity.HasOne(e => e.FixedAsset)
                .WithMany(a => a.ScheduleLines)
                .HasForeignKey(e => e.FixedAssetId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }

    private static void ConfigureFixedAssetEvent(ModelBuilder builder)
    {
        builder.Entity<FixedAssetEvent>(entity =>
        {
            entity.ToTable("FixedAssetEvents");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.EventType).HasConversion<int>();
            entity.Property(e => e.Amount).HasPrecision(18, 3);
            entity.Property(e => e.Notes).HasMaxLength(2000);
            entity.Property(e => e.MetadataJson).HasMaxLength(4000);
            entity.HasIndex(e => e.FixedAssetId);
            entity.HasIndex(e => e.EventDate);
            entity.HasOne(e => e.FixedAsset)
                .WithMany(a => a.Events)
                .HasForeignKey(e => e.FixedAssetId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }

    /// <summary>
    /// Paramètres du module Immobilisations du tenant (singleton) — support des exercices
    /// décalés (plan « Exercices décalés », P1). Une seule ligne par base tenant.
    /// </summary>
    private static void ConfigureFixedAssetSettings(ModelBuilder builder)
    {
        builder.Entity<FixedAssetSettings>(entity =>
        {
            entity.ToTable("FixedAssetSettings");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.FiscalYearStartMonth).HasDefaultValue(FactuTrust.Domain.Entities.FixedAssetSettings.DefaultFiscalYearStartMonth);
            entity.Property(e => e.FiscalYearLabelFormat).HasMaxLength(10).IsRequired().HasDefaultValue(FactuTrust.Domain.Entities.FixedAssetSettings.LabelFormatNn1);
        });
    }

    /// <summary>
    /// Profil d'imputation comptable de la paie du dossier. Une seule ligne par base tenant ;
    /// l'absence de ligne vaut repli sur la configuration globale (<c>AccountingSettings</c>).
    /// </summary>
    private static void ConfigurePayrollAccountingSettings(ModelBuilder builder)
    {
        builder.Entity<PayrollAccountingSettings>(entity =>
        {
            entity.ToTable("PayrollAccountingSettings");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.AccountProfile).HasConversion<int>().HasDefaultValue(PayrollAccountProfile.Legacy);
            entity.Property(e => e.InKindOffsetAccount)
                .HasMaxLength(FactuTrust.Domain.Entities.PayrollAccountingSettings.MaxAccountNumberLength);
            entity.Property(e => e.DisbursementEntriesEnabled).HasDefaultValue(false);
            entity.Property(e => e.DetailedSalarySplitEnabled).HasDefaultValue(false);
            entity.Property(e => e.EmployeeAuxiliaryEnabled).HasDefaultValue(true);
        });
    }

    /// <summary>
    /// Suivi des modèles de données sectoriels déjà appliqués à ce tenant (plan §WP-B6) —
    /// <see cref="Services.SectorRules.SectorDataTemplateApplier"/> consulte cette table pour ne
    /// jamais réappliquer le même (code, version). Table purement additive, jamais purgée.
    /// </summary>
    private static void ConfigureAppliedSectorTemplate(ModelBuilder builder)
    {
        builder.Entity<AppliedSectorTemplate>(entity =>
        {
            entity.ToTable("AppliedSectorTemplates");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.TemplateCode).HasMaxLength(50).IsRequired();
            entity.HasIndex(e => new { e.TemplateCode, e.Version }).IsUnique();
        });
    }

    private static void ConfigureLoan(ModelBuilder builder)
    {
        builder.Entity<Loan>(entity =>
        {
            entity.ToTable("Loans");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.LoanNumber).HasMaxLength(32).IsRequired();
            entity.HasIndex(e => e.LoanNumber).IsUnique();
            entity.Property(e => e.Label).HasMaxLength(300).IsRequired();
            entity.Property(e => e.LenderName).HasMaxLength(200).IsRequired();
            entity.Property(e => e.Principal).HasPrecision(18, 3);
            entity.Property(e => e.AnnualRatePercent).HasPrecision(8, 4);
            entity.Property(e => e.LoanAccountNumber).HasMaxLength(20).IsRequired();
            entity.Property(e => e.InterestAccountNumber).HasMaxLength(20).IsRequired();
            entity.Property(e => e.BankAccountNumber).HasMaxLength(20).IsRequired();
            entity.Property(e => e.Notes).HasMaxLength(2000);
            entity.Property(e => e.Periodicity).HasConversion<int>();
            entity.Property(e => e.Method).HasConversion<int>();
            entity.Property(e => e.Status).HasConversion<int>();
            entity.HasIndex(e => e.Status);
            entity.HasIndex(e => e.StartDate);
            entity.Property(e => e.Version).IsConcurrencyToken();
            entity.Ignore(e => e.DomainEvents);
        });
    }

    private static void ConfigureLoanScheduleLine(ModelBuilder builder)
    {
        builder.Entity<LoanScheduleLine>(entity =>
        {
            entity.ToTable("LoanScheduleLines");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.OpeningBalance).HasPrecision(18, 3);
            entity.Property(e => e.InterestAmount).HasPrecision(18, 3);
            entity.Property(e => e.PrincipalAmount).HasPrecision(18, 3);
            entity.Property(e => e.InstallmentAmount).HasPrecision(18, 3);
            entity.Property(e => e.ClosingBalance).HasPrecision(18, 3);
            entity.HasIndex(e => new { e.LoanId, e.InstallmentNumber }).IsUnique();
            entity.HasIndex(e => e.DueDate);
            entity.HasOne(e => e.Loan)
                .WithMany(l => l.ScheduleLines)
                .HasForeignKey(e => e.LoanId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.Ignore(e => e.DomainEvents);
        });
    }

    private static void ConfigureNctNoteOverride(ModelBuilder builder)
    {
        builder.Entity<NctNoteOverride>(entity =>
        {
            entity.ToTable("NctNoteOverrides");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.CustomTitle).HasMaxLength(300);
            entity.Property(e => e.CustomDescription).HasMaxLength(2000);
            // Clé métier : une seule personnalisation par note et par exercice.
            entity.HasIndex(e => new { e.FiscalYear, e.NoteNumber }).IsUnique();
            entity.Ignore(e => e.DomainEvents);
        });
    }

    private static void ConfigureWithholdingTaxType(ModelBuilder builder)
    {
        builder.Entity<WithholdingTaxType>(entity =>
        {
            entity.ToTable("WithholdingTaxTypes");
            entity.HasKey(e => e.Id);

            entity.Property(e => e.Code).HasMaxLength(20).IsRequired();
            entity.Property(e => e.Category).HasConversion<int>();
            entity.Property(e => e.Label).HasMaxLength(300).IsRequired();
            entity.Property(e => e.LabelAr).HasMaxLength(300);
            entity.Property(e => e.DefaultRate).HasPrecision(5, 2).IsRequired();
            entity.Property(e => e.ArticleReference).HasMaxLength(100);
            entity.Property(e => e.MinimumThreshold).HasPrecision(18, 3);

            entity.HasIndex(e => e.Code).IsUnique();
            entity.HasIndex(e => e.Category);
            entity.HasIndex(e => e.IsActive);
            entity.HasIndex(e => e.DisplayOrder);
        });
    }

    private static void ConfigureWithholdingFiscalYearParameter(ModelBuilder builder)
    {
        builder.Entity<WithholdingFiscalYearParameter>(entity =>
        {
            entity.ToTable("WithholdingFiscalYearParameters");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.FiscalYear).IsRequired();
            entity.Property(e => e.Rs7TtcThresholdTnd).HasPrecision(18, 3).IsRequired();
            entity.HasIndex(e => e.FiscalYear).IsUnique();
        });
    }

    private static void ConfigureIncomeTaxYearParameter(ModelBuilder builder)
    {
        builder.Entity<Domain.Entities.Fiscal.IncomeTaxYearParameter>(entity =>
        {
            entity.ToTable("IncomeTaxYearParameters");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.FiscalYear).IsRequired();
            entity.Property(e => e.IsStandardRate).HasPrecision(9, 5);
            entity.Property(e => e.IsReducedRate).HasPrecision(9, 5);
            entity.Property(e => e.IsSectorRate).HasPrecision(9, 5);
            entity.Property(e => e.MinTaxRate).HasPrecision(9, 5);
            entity.Property(e => e.MinTaxReducedRate).HasPrecision(9, 5);
            entity.Property(e => e.MinTaxFloorTnd).HasPrecision(18, 3);
            entity.Property(e => e.MinTaxFloorReducedTnd).HasPrecision(18, 3);
            entity.Property(e => e.CssRate).HasPrecision(9, 5);
            entity.Property(e => e.CssFloorTnd).HasPrecision(18, 3);
            entity.Property(e => e.AcompteRate).HasPrecision(9, 5);
            entity.Property(e => e.IrppBracketsJson).IsRequired();
            entity.HasIndex(e => e.FiscalYear).IsUnique();
        });
    }

    private static void ConfigureFiscalResultDeclaration(ModelBuilder builder)
    {
        builder.Entity<Domain.Entities.Fiscal.FiscalResultDeclaration>(entity =>
        {
            entity.ToTable("FiscalResultDeclarations");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.FiscalYear).IsRequired();
            entity.Property(e => e.TaxpayerKind).HasConversion<int>();
            entity.Property(e => e.MinimumTaxRegime).HasConversion<int>();
            entity.Property(e => e.Status).HasConversion<int>();
            entity.Property(e => e.AccountingResult).HasPrecision(18, 3);
            entity.Property(e => e.AppliedIsRate).HasPrecision(9, 5);
            entity.Property(e => e.LocalTurnoverTtc).HasPrecision(18, 3);
            entity.Property(e => e.AcomptesPaid).HasPrecision(18, 3);
            entity.Property(e => e.WithholdingSuffered).HasPrecision(18, 3);
            entity.Property(e => e.PriorTaxCredit).HasPrecision(18, 3);
            entity.Property(e => e.FinalizedBy).HasMaxLength(320);
            entity.HasIndex(e => e.FiscalYear).IsUnique();

            entity.HasMany(e => e.Adjustments)
                .WithOne()
                .HasForeignKey(l => l.FiscalResultDeclarationId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasMany(e => e.CarryForwards)
                .WithOne()
                .HasForeignKey(i => i.FiscalResultDeclarationId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.Metadata.FindNavigation(nameof(Domain.Entities.Fiscal.FiscalResultDeclaration.Adjustments))!
                .SetPropertyAccessMode(PropertyAccessMode.Field);
            entity.Metadata.FindNavigation(nameof(Domain.Entities.Fiscal.FiscalResultDeclaration.CarryForwards))!
                .SetPropertyAccessMode(PropertyAccessMode.Field);
        });

        builder.Entity<Domain.Entities.Fiscal.FiscalAdjustmentLine>(entity =>
        {
            entity.ToTable("FiscalAdjustmentLines");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Kind).HasConversion<int>();
            entity.Property(e => e.CatalogCode).HasMaxLength(40);
            entity.Property(e => e.Label).HasMaxLength(300).IsRequired();
            entity.Property(e => e.Amount).HasPrecision(18, 3);
            entity.HasIndex(e => e.FiscalResultDeclarationId);
        });

        builder.Entity<Domain.Entities.Fiscal.FiscalCarryForwardItem>(entity =>
        {
            entity.ToTable("FiscalCarryForwardItems");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Kind).HasConversion<int>();
            entity.Property(e => e.InitialAmount).HasPrecision(18, 3);
            entity.Property(e => e.ImputedThisYear).HasPrecision(18, 3);
            entity.HasIndex(e => e.FiscalResultDeclarationId);
        });
    }

    private static void ConfigureTejXmlExportLog(ModelBuilder builder)
    {
        builder.Entity<TejXmlExportLog>(entity =>
        {
            entity.ToTable("TejXmlExportLogs");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.FileName).HasMaxLength(260).IsRequired();
            entity.Property(e => e.Sha256Hex).HasMaxLength(64).IsRequired();
            entity.Property(e => e.ValidationErrorSummary).HasMaxLength(4000);
            entity.Property(e => e.ExportedByEmail).HasMaxLength(320);
            entity.HasIndex(e => e.CreatedAt);
            entity.HasIndex(e => new { e.Year, e.Month });
        });
    }

    private static void ConfigureConversation(ModelBuilder builder)
    {
        builder.Entity<Conversation>(entity =>
        {
            entity.ToTable("Conversations");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Title).HasMaxLength(200).IsRequired();
            entity.Property(e => e.SelectedModel).HasMaxLength(500);
            entity.Property(e => e.AgentScope).HasDefaultValue(0);
            entity.Property(e => e.CreatedBy).HasMaxLength(450);
            entity.Property(e => e.UpdatedBy).HasMaxLength(450);
            entity.HasIndex(e => e.UserId);
            entity.HasIndex(e => e.LastMessageAt);

            entity.HasMany(e => e.Messages)
                .WithOne()
                .HasForeignKey(e => e.ConversationId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }

    private static void ConfigureConversationMessage(ModelBuilder builder)
    {
        builder.Entity<ConversationMessage>(entity =>
        {
            entity.ToTable("ConversationMessages");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Content).IsRequired();
            entity.Property(e => e.Role).HasConversion<int>();
            entity.Property(e => e.ToolName).HasMaxLength(100);
            entity.Property(e => e.ToolCallId).HasMaxLength(128);
            entity.Property(e => e.ToolCallsJson).HasColumnType("nvarchar(max)");
            entity.Property(e => e.CreatedBy).HasMaxLength(450);
            entity.Property(e => e.UpdatedBy).HasMaxLength(450);
            entity.HasIndex(e => new { e.ConversationId, e.SortOrder });
        });
    }

    private static void ConfigureTenantAiProvider(ModelBuilder builder)
    {
        builder.Entity<TenantAiProvider>(entity =>
        {
            entity.ToTable("TenantAiProviders");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.ProviderKey).HasMaxLength(64).IsRequired();
            entity.Property(e => e.DisplayName).HasMaxLength(200);
            entity.Property(e => e.BaseUrl).HasMaxLength(500);
            entity.Property(e => e.EncryptedApiKey).HasMaxLength(4000).IsRequired();
            entity.Property(e => e.CreatedBy).HasMaxLength(450);
            entity.Property(e => e.UpdatedBy).HasMaxLength(450);
            entity.HasIndex(e => e.ProviderKey).IsUnique();
        });
    }

    private static void ConfigureAiExportAudit(ModelBuilder builder)
    {
        builder.Entity<AiExportAudit>(entity =>
        {
            entity.ToTable("AiExportAudits");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Format).HasMaxLength(20).IsRequired();
            entity.Property(e => e.Template).HasMaxLength(50).IsRequired();
            entity.Property(e => e.Title).HasMaxLength(200);
            entity.Property(e => e.StoragePath).HasMaxLength(500);
            entity.Property(e => e.FailureReason).HasMaxLength(500);
            entity.Property(e => e.ConversationIdsJson).HasColumnType("nvarchar(max)").IsRequired();
            entity.Property(e => e.MessageIdsJson).HasColumnType("nvarchar(max)").IsRequired();
            entity.Property(e => e.CreatedBy).HasMaxLength(450);
            entity.Property(e => e.UpdatedBy).HasMaxLength(450);

            entity.HasIndex(e => e.UserId);
            entity.HasIndex(e => e.GeneratedAt);
            entity.HasIndex(e => new { e.UserId, e.GeneratedAt });
        });
    }

    private static void ConfigureChannelIdentityLink(ModelBuilder builder)
    {
        builder.Entity<ChannelIdentityLink>(entity =>
        {
            entity.ToTable("ChannelIdentityLinks");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.ChannelType).HasConversion<int>();
            entity.Property(e => e.ExternalUserId).HasMaxLength(128).IsRequired();
            entity.Property(e => e.ExternalChatId).HasMaxLength(128).IsRequired();
            entity.Property(e => e.IsActive).IsRequired();
            entity.HasIndex(e => new { e.ChannelType, e.ExternalUserId }).IsUnique();
            entity.HasIndex(e => new { e.UserId, e.ChannelType }).IsUnique();
            entity.HasIndex(e => e.IsActive);
        });
    }

    private static void ConfigureChannelLinkCode(ModelBuilder builder)
    {
        builder.Entity<ChannelLinkCode>(entity =>
        {
            entity.ToTable("ChannelLinkCodes");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.ChannelType).HasConversion<int>();
            entity.Property(e => e.CodeHash).HasMaxLength(128).IsRequired();
            entity.Property(e => e.ExpiresAt).IsRequired();
            entity.Property(e => e.AttemptCount).HasDefaultValue(0);
            entity.HasIndex(e => new { e.ChannelType, e.CodeHash });
            entity.HasIndex(e => new { e.UserId, e.ChannelType });
            entity.HasIndex(e => e.ExpiresAt);
        });
    }

    private static void ConfigureChannelInboundMessageLog(ModelBuilder builder)
    {
        builder.Entity<ChannelInboundMessageLog>(entity =>
        {
            entity.ToTable("ChannelInboundMessageLogs");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.ChannelType).HasConversion<int>();
            entity.Property(e => e.ExternalMessageId).HasMaxLength(150).IsRequired();
            entity.Property(e => e.ExternalUserId).HasMaxLength(128).IsRequired();
            entity.Property(e => e.TraceId).HasMaxLength(120).IsRequired();
            entity.HasIndex(e => new { e.ChannelType, e.ExternalMessageId }).IsUnique();
            entity.HasIndex(e => e.UserId);
        });
    }
}
