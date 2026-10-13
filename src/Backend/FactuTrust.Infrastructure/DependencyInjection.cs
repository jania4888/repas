using FactuTrust.Application.Configuration;
using FactuTrust.Application.Localization;
using FactuTrust.Infrastructure.Localization;
using FactuTrust.Infrastructure.Services.Barcodes;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Forecasting;
using FactuTrust.Application.Common.Interfaces.Treasury;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Features.Stock.Queries;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.Workflows.Engine;
using FactuTrust.Application.Features.AI;
using FactuTrust.Application.Features.AI.DocumentExtraction;
using FactuTrust.Application.Features.AI.Commands;
using FactuTrust.Application.Features.AI.DTOs;
using FactuTrust.Application.Features.AI.Tools;
using FactuTrust.Application.Features.WithholdingTax.Services;
using FactuTrust.Domain.Services;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Repositories;
using FactuTrust.Infrastructure.Services;
using FactuTrust.Infrastructure.Services.Lettering;
using FactuTrust.Infrastructure.Services.AI;
using FactuTrust.Infrastructure.Services.Forecasting;
using FactuTrust.Infrastructure.Services.Forecasting.Background;
using FactuTrust.Infrastructure.Services.Forecasting.Calendar;
using FactuTrust.Infrastructure.Services.PublicContact;
using FactuTrust.Infrastructure.Services.Storefront;
using FactuTrust.Infrastructure.Services.Treasury;
using FactuTrust.Infrastructure.Services.Treasury.Collectors;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using System.Reflection;

namespace FactuTrust.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddMemoryCache();
        services.AddSingleton(TimeProvider.System);
        services.AddSingleton<IMessageLocalizer, MessageLocalizer>();

        // Interceptor de diagnostic (Dev uniquement) — trace toute commande sur
        // MasterDbContext avec threadId/activityId et détecte les accès concurrents
        // AVANT qu'EF Core ne throw. Silencieux si non résolu (Prod).
        services.AddSingleton<MasterDbConcurrencyDiagnosticsInterceptor>();

        // Master Database — DOUBLE enregistrement volontaire :
        //   1) AddDbContext<T> (Scoped) → requis par ASP.NET Core Identity, DataProtection,
        //      et tous les services scoped historiques qui prennent MasterDbContext en ctor.
        //   2) AddDbContextFactory<T> (Scoped) → permet aux chemins de lecture (Bootstrap,
        //      chemins concurrents identifiés) d'obtenir un DbContext dédié via CreateDbContext(),
        //      sans partager l'instance scoped DataProtection. Lifetime Scoped (pas Singleton)
        //      car ConfigureMasterDbContext résout des services via le SP (options scoped).
        //
        // La configuration est extraite dans ConfigureMasterDbContext pour être 100% identique
        // entre les deux enregistrements — divergence = source de bugs subtils (interceptors,
        // migrations, options manquantes).
        services.AddDbContext<MasterDbContext>((sp, options) =>
            ConfigureMasterDbContext(options, sp, configuration));

        services.AddDbContextFactory<MasterDbContext>(
            (sp, options) => ConfigureMasterDbContext(options, sp, configuration),
            ServiceLifetime.Scoped);

        // Tenant Database Factory
        // Only register if not in design-time mode (EF Core tools)
        if (!IsDesignTime())
        {
            // Register TenantDbContextFactory as both concrete type and interface
            services.AddScoped<TenantDbContextFactory>();
            services.AddScoped<ITenantDbContextFactory, TenantDbContextFactory>(sp => sp.GetRequiredService<TenantDbContextFactory>());

            // Register a custom factory adapter that resolves tenant connection string at runtime
            // This allows IDbContextFactory<TenantDbContext> to work correctly with multi-tenancy.
            // NOTE : l'adapter ne s'enrôle JAMAIS dans la transaction ambiante — les allocateurs
            // de séquences (DocumentNumberService, InvoiceNumberGenerator, CustomSequenceAllocator)
            // qui l'utilisent gardent leurs propres transactions Serializable.
            services.AddScoped<IDbContextFactory<TenantDbContext>, TenantDbContextFactoryAdapter>();

            // Unité de travail tenant : transaction ambiante partagée par les repositories.
            services.AddScoped<TenantAmbientTransaction>();
            // Même instance que TenantAmbientTransaction (sonde en lecture seule pour l'Application).
            services.AddScoped<IAmbientTransactionState>(sp => sp.GetRequiredService<TenantAmbientTransaction>());
            services.AddScoped<ITenantUnitOfWork, TenantUnitOfWork>();
        }

        // Data Protection for encrypting connection strings.
        // Le trousseau est persisté dans la base master : il DOIT être chiffré au repos
        // (il protège les chaînes de connexion tenant, les secrets TOTP et les clés IA).
        // Les clés existantes non chiffrées restent lisibles (le keyring gère le mixte).
        var dataProtectionBuilder = services.AddDataProtection()
            .SetApplicationName("FactuTrust")
            .PersistKeysToDbContext<MasterDbContext>();

        var certificatePath = configuration["DataProtection:CertificatePath"];
        if (!string.IsNullOrWhiteSpace(certificatePath))
        {
            var certificatePassword = configuration["DataProtection:CertificatePassword"];
            dataProtectionBuilder.ProtectKeysWithCertificate(
                new System.Security.Cryptography.X509Certificates.X509Certificate2(certificatePath, certificatePassword));
        }
        else if (System.Runtime.InteropServices.RuntimeInformation.IsOSPlatform(System.Runtime.InteropServices.OSPlatform.Windows))
        {
            dataProtectionBuilder.ProtectKeysWithDpapi(protectToLocalMachine: true);
        }
        else
        {
            Console.Error.WriteLine(
                "[FactuTrust] AVERTISSEMENT : le trousseau DataProtection n'est PAS chiffré au repos. " +
                "Fournissez DataProtection:CertificatePath (+ CertificatePassword) sur cette plateforme.");
        }

        // Multi-tenancy
        // Only register if not in design-time mode (EF Core tools)
        if (!IsDesignTime())
        {
            services.AddScoped<ITenantContext, TenantContext>();
            services.AddScoped<TenantDatabaseProvisioner>();
            services.AddScoped<ITenantRuntimeCatalogSeeder, TenantRuntimeCatalogSeeder>();
            services.AddScoped<ITenantService, TenantService>();
            services.AddScoped<ITenantAuthTokenService, TenantAuthTokenService>();
            services.AddScoped<IFirmDelegatedAccessProjector, FirmDelegatedAccessProjector>();
            // Nettoyage des artefacts orphelins de la mini-saga d'inscription (bases sans Tenant,
            // Tenant Pending/Failed sans base) — voir OrphanTenantDatabaseCleanupJob.
            services.AddScoped<Services.Background.OrphanTenantDatabaseCleanupJob>();
            // Révocation immédiate des tokens (plan §6 Phase 2.5) — vérifié par le OnTokenValidated
            // de Program.cs sur chaque requête authentifiée, quel que soit l'émetteur du token.
            services.AddScoped<ISecurityStampTokenValidator, SecurityStampTokenValidator>();
            services.AddScoped<IAccountingFirmRegistrationService, AccountingFirmRegistrationService>();
            services.AddScoped<ICompanyRegistrationService, CompanyRegistrationService>();
            services.AddScoped<ITenantProvisioningRetryService, TenantProvisioningRetryService>();
            services.AddScoped<IPlatformActionAuditWriter, PlatformActionAuditWriter>();
            services.AddScoped<ICompanyProfileSnapshotProvider, CompanyProfileSnapshotProvider>();
            // Enregistrement en 2 temps : la classe concrète est scopée (une instance par
            // requête) ET l'interface pointe sur la MÊME instance via la lambda ci-dessous.
            // Objectif : ExchangeService (dans la même assembly) peut prendre la classe
            // concrète en dépendance pour accéder aux surcharges internes qui acceptent
            // un MasterDbContext explicite (chemin bootstrap isolé), tout en préservant
            // l'abstraction IFirmAssignmentService pour l'ensemble des autres appelants.
            services.AddScoped<FirmAssignmentService>();
            services.AddScoped<IFirmAssignmentService>(sp => sp.GetRequiredService<FirmAssignmentService>());
            services.AddScoped<IHonorairesBillingService, FactuTrust.Infrastructure.Services.Honoraires.HonorairesBillingService>();
            services.AddScoped<IProjectService, FactuTrust.Infrastructure.Services.Projects.ProjectService>();
            services.AddScoped<ITimesheetService, FactuTrust.Infrastructure.Services.Projects.TimesheetService>();
            services.AddScoped<IRecurringContractService, FactuTrust.Infrastructure.Services.RecurringContracts.RecurringContractService>();
            services.AddScoped<FactuTrust.Infrastructure.Services.RecurringContracts.RecurringContractBillingService>();
            services.AddScoped<FirmDossierAccessService>();
            services.AddScoped<IFirmDossierAccessService>(sp => sp.GetRequiredService<FirmDossierAccessService>());
            services.AddScoped<IFirmDashboardService, FirmDashboardService>();
            services.AddScoped<IFirmDecisionTablesService, FirmDecisionTablesService>();
            services.AddScoped<IFirmFiscalOpsAggregator, FirmFiscalOpsAggregator>();
            services.AddScoped<IFirmGovernanceService, FirmGovernanceService>();
            services.AddScoped<IFirmLeaveAbsenceReader, FirmLeaveAbsenceReader>();
            services.AddScoped<IFirmLeavePayrollMirrorService, FirmLeavePayrollMirrorService>();
            services.AddScoped<IFirmLeaveService, FirmLeaveService>();
            services.AddScoped<IFirmTimeProfitabilityService, FirmTimeProfitabilityService>();
            services.AddScoped<IFirmCollaboratorRentabilityService, FirmCollaboratorRentabilityService>();
            // Passage unique de la frontière Master → base de paie du cabinet.
            services.AddScoped<FirmTenantPayrollAccessor>();
            services.AddScoped<IFirmPayrollCostProvider, FirmPayrollCostProvider>();
            services.AddScoped<IFirmCollaboratorCostService, FirmCollaboratorCostService>();
            services.AddScoped<IFirmCollaboratorCostSyncService, FirmCollaboratorCostSyncService>();
            services.AddScoped<IFirmInternalPayrollProvisioningService, FirmInternalPayrollProvisioningService>();
            services.AddScoped<IFirmFiscalScheduleService, FirmFiscalScheduleService>();
            services.AddScoped<IFirmFiscalScheduleWriteService, FirmFiscalScheduleWriteService>();
            // Lecture consolidée du portefeuille (agent Chef de mission). Périmètre d'accès passé
            // explicitement : utilisable aussi bien en requête HTTP qu'en job Hangfire.
            services.AddScoped<IFirmPortfolioReadService, FirmPortfolioReadService>();
            services.AddScoped<Services.Background.FirmMissionBriefingJob>();
            services.AddScoped<IFirmContextService, FirmContextService>();
            services.AddScoped<IFirmManagedClientService, FirmManagedClientService>();
            services.AddScoped<IFirmCollaboratorService, FirmCollaboratorService>();
            services.AddScoped<IPayrollFirmOperationGuard, PayrollFirmOperationGuard>();
            services.Configure<FirmCollaboratorStorageOptions>(
                configuration.GetSection(FirmCollaboratorStorageOptions.SectionName));
            services.AddScoped<INotificationService, NotificationService>();
            services.Configure<ExchangeAttachmentsOptions>(
                configuration.GetSection(ExchangeAttachmentsOptions.SectionName));
            services.AddScoped<IExchangeOppositePartyNotifier, ExchangeOppositePartyNotifier>();
            services.AddScoped<IExchangeService, ExchangeService>();
            services.Configure<CompanySupportAttachmentsOptions>(
                configuration.GetSection(CompanySupportAttachmentsOptions.SectionName));
            services.AddScoped<ICompanySupportService, CompanySupportService>();
            services.AddSingleton<IAccountingFirmsFeature, AccountingFirmsFeature>();
            services.AddSingleton<IPublicRegistrationFeature, PublicRegistrationFeature>();
            services.AddSingleton<IFirmGovernanceFeature, FirmGovernanceFeature>();
            services.AddSingleton<IFirmFiscalOpsFeature, FirmFiscalOpsFeature>();
            services.AddScoped<ITunisianFiscalDeadlineService, TunisianFiscalDeadlineService>();
            services.AddScoped<ITenantMigrationGuard, TenantMigrationGuard>();
            services.AddHostedService<FactuTrust.Infrastructure.Services.Background.TenantTemplateWarmupHostedService>();
            // TenantDbContextFactory is already registered above
        }

        // Repositories
        services.AddScoped<IInvoiceRepository, InvoiceRepository>();
        services.AddScoped<IPaymentRepository, PaymentRepository>();
        services.AddScoped<IQuoteRepository, QuoteRepository>();
        services.AddScoped<IClientRepository, ClientRepository>();
        services.AddScoped<ICompanyRepository, CompanyRepository>();
        services.AddScoped<ITaxRepository, TaxRepository>();
        services.AddScoped<IProductRepository, ProductRepository>();
        services.AddScoped<IProductCategoryRepository, ProductCategoryRepository>();
        services.AddScoped<IInvoiceDraftRepository, InvoiceDraftRepository>();

        // Stock Management Repositories
        services.AddScoped<IWarehouseRepository, WarehouseRepository>();
        services.AddScoped<IStockItemRepository, StockItemRepository>();
        services.AddScoped<IStockMovementRepository, StockMovementRepository>();
        services.AddScoped<IPhysicalInventoryRepository, PhysicalInventoryRepository>();
        services.AddScoped<IStockTransferRepository, StockTransferRepository>();
        services.AddScoped<IStockVoucherRepository, StockVoucherRepository>();

        // Delivery Notes Repository
        services.AddScoped<IDeliveryNoteRepository, DeliveryNoteRepository>();
        services.AddScoped<ISalesReturnNoteRepository, SalesReturnNoteRepository>();

        // Purchasing Repositories
        services.AddScoped<ISupplierRepository, SupplierRepository>();
        services.AddScoped<IPurchaseOrderRepository, PurchaseOrderRepository>();
        services.AddScoped<IPurchaseReceiptRepository, PurchaseReceiptRepository>();
        services.AddScoped<IPurchaseGoodsReceptionService, PurchaseGoodsReceptionService>();
        services.AddScoped<IStockMutationService, StockMutationService>();
        services.AddScoped<IProductAttributeRepository, ProductAttributeRepository>();
        services.AddScoped<IStockTraceabilityQuery, EfStockTraceabilityQuery>();
        services.AddScoped<ISalesOrderRepository, SalesOrderRepository>();
        services.AddScoped<Application.Features.SalesOrders.Services.ISalesOrderStockReservationService,
            Application.Features.SalesOrders.Services.SalesOrderStockReservationService>();

        // Tarification (lot 5) — grilles, prix négociés, et point de résolution unique.
        services.AddScoped<IPriceListRepository, PriceListRepository>();
        services.AddScoped<IClientProductPriceRepository, ClientProductPriceRepository>();
        services.AddScoped<Application.Common.Interfaces.Pricing.IPriceResolver,
            Services.Pricing.PriceResolver>();
        services.AddScoped<IPromotionRepository, PromotionRepository>();
        services.AddScoped<IPaymentTermTemplateRepository, PaymentTermTemplateRepository>();

        // Encours client (lot 6) — alerte seule, aucun blocage.
        services.AddScoped<IClientOutstandingService, ClientOutstandingService>();
        services.AddScoped<IClientPortalService, ClientPortalService>();
        services.AddScoped<Application.Common.Interfaces.Pricing.IPromotionResolver,
            Services.Pricing.PromotionResolver>();
        services.AddScoped<Application.Common.Interfaces.Pricing.ILinePricingOrchestrator,
            Services.Pricing.LinePricingOrchestrator>();
        services.AddScoped<ISupplierInvoiceRepository, SupplierInvoiceRepository>();
        services.AddScoped<ISupplierPaymentRepository, SupplierPaymentRepository>();
        services.AddScoped<ICashOperationRepository, CashOperationRepository>();
        services.AddScoped<ICashRegisterRepository, CashRegisterRepository>();
        services.AddScoped<ICashRegisterSessionRepository, CashRegisterSessionRepository>();
        services.AddScoped<IPosCartDraftRepository, PosCartDraftRepository>();
        services.AddScoped<IPosHeldTicketRepository, PosHeldTicketRepository>();
        services.AddScoped<IZReportRepository, ZReportRepository>();
        services.AddScoped<IBankDepositRepository, BankDepositRepository>();
        services.AddScoped<IBankAccountRepository, BankAccountRepository>();

        services.AddScoped<IChartOfAccountRepository, ChartOfAccountRepository>();
        services.AddScoped<IAccountingPeriodRepository, AccountingPeriodRepository>();
        services.AddScoped<IJournalEntryRepository, JournalEntryRepository>();
        services.AddScoped<IJournalRepository, JournalRepository>();
        services.AddScoped<ICurrencyRepository, CurrencyRepository>();
        services.AddScoped<IExchangeRateResolver, ExchangeRateResolver>();
        services.AddScoped<IBudgetRepository, BudgetRepository>();
        services.AddScoped<IMonthlyDeclarationConfigRepository, MonthlyDeclarationConfigRepository>();
        services.AddScoped<IMonthlyDeclarationConfigDuplicator, MonthlyDeclarationConfigDuplicator>();
        services.AddScoped<IMonthlyDeclarationModelImporter, MonthlyDeclarationModelImporter>();
        services.AddScoped<IJournalEntryTemplateRepository, JournalEntryTemplateRepository>();
        services.AddScoped<IVatDeclarationRepository, VatDeclarationRepository>();
        services.AddScoped<IFiscalScheduleRepository, FiscalScheduleRepository>();
        services.AddScoped<IFixedAssetRepository, FixedAssetRepository>();
        services.AddScoped<IFixedAssetSettingsRepository, FixedAssetSettingsRepository>();
        services.AddScoped<IPayrollAccountingSettingsRepository, PayrollAccountingSettingsRepository>();
        services.AddScoped<ILoanRepository, LoanRepository>();
        services.AddScoped<IDepreciationRateCategoryRepository, DepreciationRateCategoryRepository>();

        // Withholding Tax (TEJ)
        services.AddScoped<IWithholdingTaxRepository, WithholdingTaxRepository>();
        services.AddScoped<IWithholdingFiscalYearParameterRepository, WithholdingFiscalYearParameterRepository>();
        services.AddScoped<IIncomeTaxYearParameterRepository, IncomeTaxYearParameterRepository>();
        services.AddScoped<INctNoteOverrideRepository, NctNoteOverrideRepository>();
        services.AddScoped<IFiscalResultDeclarationRepository, FiscalResultDeclarationRepository>();
        services.AddScoped<ITejXmlExportLogRepository, TejXmlExportLogRepository>();

        // Payroll (RH & Paie)
        services.AddScoped<IEmployeeRepository, EmployeeRepository>();
        services.AddScoped<IPayrollRunRepository, PayrollRunRepository>();
        services.AddScoped<IPayrollPaymentRepository, PayrollPaymentRepository>();
        services.AddScoped<ICnssContributionPaymentRepository, CnssContributionPaymentRepository>();
        services.AddScoped<IPayrollParametersRepository, PayrollParametersRepository>();
        services.AddScoped<ILeaveRequestRepository, LeaveRequestRepository>();
        services.AddScoped<ICnssIjClaimRepository, CnssIjClaimRepository>();
        services.AddScoped<ICnssIjClaimRepository, CnssIjClaimRepository>();
        services.AddScoped<IEmployeePayrollSuspensionRepository, EmployeePayrollSuspensionRepository>();
        services.AddScoped<IPayrollPublicHolidayRepository, PayrollPublicHolidayRepository>();
        services.AddScoped<IEmployeeAdvanceRepository, EmployeeAdvanceRepository>();
        services.AddScoped<IPayrollOvertimeRepository, PayrollOvertimeRepository>();
        services.AddScoped<IPayrollVariableAllowanceRepository, PayrollVariableAllowanceRepository>();
        services.AddScoped<IPayrollIrppRegularizationRepository, PayrollIrppRegularizationRepository>();
        services.AddScoped<ITerminationSettlementRepository, TerminationSettlementRepository>();
        services.AddScoped<IAnnualBonusRuleRepository, AnnualBonusRuleRepository>();
        services.AddScoped<IEmployeeAnnualBonusRuleRepository, EmployeeAnnualBonusRuleRepository>();
        services.AddScoped<ILeaveBalanceAccrualRepository, LeaveBalanceAccrualRepository>();
        services.AddScoped<ISocialFundSchemeRepository, SocialFundSchemeRepository>();
        services.AddScoped<IEmployeeSocialFundEnrollmentRepository, EmployeeSocialFundEnrollmentRepository>();
        services.AddScoped<IPayrollMealVoucherLineRepository, PayrollMealVoucherLineRepository>();
        services.AddScoped<IEmployeeInKindBenefitRepository, EmployeeInKindBenefitRepository>();
        services.AddScoped<IEmployeeLoanRepository, EmployeeLoanRepository>();
        services.AddScoped<IEmployeeGarnishmentRepository, EmployeeGarnishmentRepository>();
        services.AddScoped<IEmployeeDependentParentRepository, EmployeeDependentParentRepository>();

        services.AddScoped<IOpportunityRepository, OpportunityRepository>();
        services.AddScoped<ISalesActivityRepository, SalesActivityRepository>();
        services.AddScoped<ISalesTargetRepository, SalesTargetRepository>();
        services.AddScoped<IQuoteTemplateRepository, QuoteTemplateRepository>();
        services.AddScoped<ITenantMemberDirectory, TenantMemberDirectory>();
        services.AddScoped<IAssignableTenantUsersSource, AssignableTenantUsersSource>();

        services.AddScoped<IStorefrontProfileRepository, StorefrontProfileRepository>();
        services.AddScoped<IStorefrontPublishingConsentRepository, StorefrontPublishingConsentRepository>();
        services.AddScoped<IStorefrontSlugService, StorefrontSlugService>();
        services.AddScoped<IIpAddressHasher, IpAddressHasher>();
        services.AddSingleton<IStorefrontOutboxPayloadBuilder, StorefrontOutboxPayloadBuilder>();
        services.AddScoped<IStorefrontTenantWriter, StorefrontTenantWriter>();
        services.AddScoped<IPublicStorefrontReadRepository, PublicStorefrontReadRepository>();
        services.AddScoped<IStorefrontOrderRepository, StorefrontOrderRepository>();
        AddHardenedTurnstileHttpClient<IStorefrontCaptchaValidator, StorefrontCaptchaValidator>(services);

        // Lot C — formulaire de contact public (landing). Enregistrement inconditionnel, garde à l'exécution.
        services.AddScoped<IPublicContactRequestRepository, PublicContactRequestRepository>();
        AddHardenedTurnstileHttpClient<IPublicContactCaptchaValidator, PublicContactCaptchaValidator>(services);
        services.AddScoped<FactuTrust.Infrastructure.Services.Background.PublicContactRequestsPurgeJob>();

        services.AddScoped<IAccountingPeriodService, AccountingPeriodService>();
        // Enregistrement inconditionnel : les handlers MediatR le prennent en dépendance et
        // ValidateOnBuild échouerait au démarrage s'il était conditionné à un drapeau.
        services.AddScoped<IPayrollAccountingProfileResolver, PayrollAccountingProfileResolver>();
        services.AddScoped<IPayrollEmployeeChartProvisioningService, PayrollEmployeeChartProvisioningService>();
        services.AddScoped<IAccountingService, AccountingService>();
        services.AddScoped<IFiscalStampResolver, FiscalStampResolver>();
        services.AddScoped<IAccountingReportingService, AccountingReportingService>();
        services.AddScoped<IThirdPartyDirectoryService, ThirdPartyDirectoryService>();
        services.AddScoped<ITenantCompanySummaryProvider, TenantCompanySummaryProvider>();
        services.AddScoped<IAccountingExportService, AccountingExportService>();
        services.AddScoped<IPayrollReportExportService, PayrollReportExportService>();
        services.AddScoped<IDepreciationEngine, DepreciationEngine>();
        services.AddScoped<IFiscalYearResolver, FiscalYearResolver>();
        services.AddScoped<IFixedAssetExportService, FixedAssetExportService>();
        services.AddScoped<ILetteringService, LetteringService>();
        services.AddScoped<ILetteringQueryService, LetteringQueryService>();
        services.AddScoped<ILetteringSuggestionService, LetteringSuggestionService>();
        services.AddScoped<IAuditLogQueryService, AuditLogQueryService>();
        services.AddScoped<IFecExportService, FecExportService>();
        services.AddScoped<IJournalImportService, JournalImportService>();
        services.AddScoped<IReferenceDataImportService, ReferenceDataImportService>();
        // Migration assistée par IA (N1) : suggestions uniquement — l'import reste dans les services ci-dessus.
        services.AddScoped<IMigrationAssistantService, Services.Migration.MigrationAssistantService>();
        services.AddScoped<IJournalEntryAttachmentService, JournalEntryAttachmentService>();
        services.AddScoped<IFiscalScheduleGenerator, FiscalScheduleGenerator>();
        services.AddScoped<IFiscalScheduleAttachmentService, FiscalScheduleAttachmentService>();
        services.AddScoped<IBankReconciliationService, BankReconciliationService>();
        services.AddScoped<IBankAccountChartProvisioningService, BankAccountChartProvisioningService>();
        services.AddScoped<IBankGlTreasuryProjectionService, BankGlTreasuryProjectionService>();
        services.AddScoped<BankAccountMatcher>();
        services.AddScoped<ImportBankStatementFromFileHandler>();
        services.AddScoped<IBankStatementPdfImportService, BankStatementPdfImportService>();

        // Import IA de relevés bancaires → brouillons du journal de banque. Enregistrement
        // inconditionnel (ValidateOnBuild) ; le drapeau Accounting:BankStatementAiPostingEnabled
        // est vérifié à l'exécution.
        services.AddSingleton(Services.BankStatementImport.BankStatementProfileRegistry.Default);
        services.AddSingleton<Services.BankStatementImport.BankStatementLayoutExtractor>();
        services.AddSingleton<Services.BankStatementImport.BankStatementFileStore>();
        services.AddScoped<Application.Features.Accounting.BankStatementImport.IBankStatementAiExtraction,
            Services.BankStatementImport.BankStatementAiExtraction>();
        services.AddScoped<Services.BankStatementImport.BankStatementAiExtractionJob>();
        services.AddScoped<Application.Features.Accounting.BankStatementImport.IBankStatementImportService,
            Services.BankStatementImport.BankStatementImportService>();
        services.AddScoped<Application.Features.Accounting.BankStatementImport.IBankStatementPostingService,
            Services.BankStatementImport.BankStatementPostingService>();

        // Services
        services.AddScoped<IEnsureDefaultCompanyService, EnsureDefaultCompanyService>();
        services.AddHttpClient("InvoicePdfLogo", client =>
        {
            client.Timeout = TimeSpan.FromSeconds(8);
        });
        services.AddScoped<IInvoicePdfContextLoader, InvoicePdfContextLoader>();
        services.AddScoped<IPdfService, PdfService>();

        // Tamponnage des formulaires officiels préimprimés (déclaration mensuelle DGI).
        // Singleton : sans état, et les gabarits/cartes embarqués sont mis en cache au 1er appel.
        services.AddSingleton<Services.OfficialForms.OfficialFormStamper>();

        // Modèles visuels d'impression (configuration par type de document + surcharge à l'impression).
        services.AddSingleton<IDocumentTemplate, Services.Templates.StandardDocumentTemplate>();
        services.AddSingleton<IDocumentTemplate, Services.Templates.ClassicTvaSyntheseTemplate>();
        services.AddSingleton<IDocumentTemplate, Services.Templates.OrangeTableTemplate>();
        services.AddSingleton<IDocumentTemplate, Services.Templates.OrangeTableCompactTemplate>();
        services.AddSingleton<IDocumentTemplate, Services.Templates.ModernBoxedTemplate>();
        services.AddSingleton<IDocumentTemplate, Services.Templates.ModernBoxedPaymentsTemplate>();
        services.AddSingleton<IDocumentTemplateRegistry, Services.Templates.DocumentTemplateRegistry>();
        services.AddScoped<IDocumentTemplatePreferenceRepository, DocumentTemplatePreferenceRepository>();
        services.AddScoped<IUserDashboardLayoutRepository, UserDashboardLayoutRepository>();
        services.AddScoped<IProductOnboardingService, ProductOnboardingService>();
        // Studio (low-code) repositories.
        services.AddScoped<ICustomEntityRepository, Repositories.Studio.CustomEntityRepository>();
        services.AddScoped<ICustomSystemRepository, Repositories.Studio.CustomSystemRepository>();
        services.AddScoped<ICustomFieldRepository, Repositories.Studio.CustomFieldRepository>();
        services.AddScoped<ICustomRecordRepository, Repositories.Studio.CustomRecordRepository>();
        services.AddScoped<ICustomRecordViewRepository, Repositories.Studio.CustomRecordViewRepository>();
        services.AddScoped<ICustomFormRepository, Repositories.Studio.CustomFormRepository>();
        services.AddScoped<ICustomReportRepository, Repositories.Studio.CustomReportRepository>();
        services.AddScoped<ICustomViewRepository, Repositories.Studio.CustomViewRepository>();
        services.AddScoped<FactuTrust.Application.Features.Studio.Common.IExistingDataSourceProvider, Services.Studio.ExistingDataSourceProvider>();
        services.AddScoped<FactuTrust.Application.Features.Studio.Common.ISqlSchemaProvider, Services.Studio.SqlSchemaProvider>();
        // Enregistré inconditionnellement (les handlers MediatR + ValidateOnBuild l'exigent) ; le
        // coupe-circuit est le drapeau EnableStudioSqlReportEngine, vérifié dans le moteur lui-même.
        services.AddScoped<FactuTrust.Application.Features.Studio.Common.SqlReport.ISqlReportEngine, Services.Studio.SqlReportEngine>();
        services.AddScoped<ISqlColumnValueFormatter, Services.Studio.SqlColumnValueFormatter>();
        services.AddScoped<ISqlViewResultEnricher, Services.Studio.SqlViewResultEnricher>();
        services.AddScoped<IJsonIndexManager, Services.Studio.JsonIndexManager>();
        services.AddSingleton<IStudioQrGenerator, Services.Studio.StudioQrGenerator>();
        services.AddScoped<ICustomSequenceAllocator, Services.Studio.CustomSequenceAllocator>();
        services.AddScoped<IStudioComputedFieldWriter, Services.Studio.StudioComputedFieldWriter>();
        services.AddScoped<IStudioComputedFieldReader, Services.Studio.StudioComputedFieldReader>();
        services.AddSingleton<IStudioFileStorageService, Services.Studio.StudioFileStorageService>();
        // ERP bridge (Studio automations).
        services.AddScoped<ICustomAutomationRepository, Repositories.Studio.CustomAutomationRepository>();
        services.AddScoped<IStudioBridgeExecutor, Services.Studio.StudioBridgeExecutor>();
        // Studio IA — plans « aperçu → confirmation » (flux EnableStudioAiPlanPreview).
        services.AddScoped<IStudioAiBuildPlanRepository, Repositories.Studio.StudioAiBuildPlanRepository>();
        services.AddScoped<FactuTrust.Application.Features.Studio.Ai.IStudioAiPlanExecutor, Services.Studio.StudioAiPlanExecutor>();
        // Workflows Studio (PR 4.1) — dépôt SQL multi-tenant.
        services.AddScoped<IStudioWorkflowRepository, Repositories.Studio.StudioWorkflowRepository>();
        // 4.5a1 — noms d'utilisateurs en lot (StartedByName des DTO workflow) ; requis par ListMyApprovalsQueryHandler (ValidateOnBuild).
        services.AddScoped<IStudioUserNameResolver, Services.Studio.StudioUserNameResolver>();
        services.AddScoped<IStudioWorkflowEngine, Services.Studio.Workflows.StudioWorkflowEngine>();
        // Runner runtime (PR 4.2c2) : bail + impersonation autour du moteur.
        services.AddScoped<IStudioWorkflowRunner, Services.Studio.Workflows.StudioWorkflowRunner>();
        // 4.7b2 / D-47-B03 — ordonnancement Hangfire des déclencheurs planifiés (best-effort aux écritures).
        services.AddScoped<IStudioWorkflowScheduleService, Services.Studio.Workflows.StudioWorkflowScheduleService>();
        services.AddScoped<IStudioWorkflowStepHandler, Services.Studio.Workflows.Steps.ConditionStepHandler>();
        services.AddScoped<IStudioWorkflowStepHandler, Services.Studio.Workflows.Steps.UpdateFieldStepHandler>();
        services.AddScoped<IStudioWorkflowStepHandler, Services.Studio.Workflows.Steps.ErpActionStepHandler>();
        services.AddScoped<IStudioWorkflowStepHandler, Services.Studio.Workflows.Steps.NotifyStepHandler>();
        services.AddScoped<IStudioWorkflowStepHandler, Services.Studio.Workflows.Steps.ApprovalStepHandler>();
        services.AddScoped<IStudioWorkflowStepHandler, Services.Studio.Workflows.Steps.WaitStepHandler>();
        services.AddScoped<IStudioWorkflowStepHandler, Services.Studio.Workflows.Steps.CreateRecordStepHandler>();
        // Digest de contexte Studio (schéma du tenant + dernier plan) injecté dans le prompt StudioBuilder.
        services.AddScoped<IStudioContextDigestService, Services.Studio.StudioContextDigestService>();
        services.AddScoped<IDocumentTemplateResolver, DocumentTemplateResolver>();
        services.AddScoped<ISignatureService, SignatureService>();
        services.AddScoped<IAuditService, AuditService>();
        services.AddScoped<IAuditChainRepairService, AuditChainRepairService>();
        services.AddScoped<ISubscriptionResolver, SubscriptionResolver>();
        services.AddScoped<IInvoiceComplianceValidator, InvoiceComplianceValidator>();
        // Enregistré inconditionnellement : requis par SubmitInvoiceCommandHandler (MediatR + ValidateOnBuild).
        services.AddScoped<IRecurringContractInvoiceLinker, FactuTrust.Infrastructure.Services.RecurringContracts.RecurringContractInvoiceLinker>();
        // Ce handler de notification vit dans Infrastructure, que le balayage MediatR ne
        // couvre pas (seule l'assembly Application est scannée) : sans cet enregistrement
        // explicite, InvoiceValidatedEvent n'atteint jamais le handler et le billing run
        // lié n'est jamais marqué Invoiced.
        services.AddTransient<MediatR.INotificationHandler<FactuTrust.Domain.Events.InvoiceValidatedEvent>, FactuTrust.Infrastructure.Services.RecurringContracts.LinkRecurringContractBillingRunOnInvoiceValidatedHandler>();
        services.AddScoped<IInvoiceNumberGenerator, InvoiceNumberGenerator>();
        services.AddScoped<IQuoteNumberGenerator, QuoteNumberGenerator>();
        services.AddScoped<ICashOperationNumberGenerator, CashOperationNumberGenerator>();
        services.AddScoped<IBankDepositNumberGenerator, BankDepositNumberGenerator>();
        services.AddScoped<IDocumentNumberService, DocumentNumberService>();
        services.AddScoped<INumberingSchemeRepository, NumberingSchemeRepository>();
        services.AddScoped<IQuoteToInvoiceConversionService, QuoteToInvoiceConversionService>();
        services.AddScoped<IStockTransferCompletionService, StockTransferCompletionService>();
        services.AddScoped<IStockVoucherMovementService, StockVoucherMovementService>();
        services.AddScoped<IEmailService, EmailService>();
        // Lot C2 — Email options + log query service + Hangfire SendEmailJob
        services.Configure<FactuTrust.Infrastructure.Services.Email.SmtpOptions>(
            configuration.GetSection(FactuTrust.Infrastructure.Services.Email.SmtpOptions.SectionName));
        services.AddScoped<IEmailMessageQueryService, EmailMessageQueryService>();
        services.AddScoped<SendEmailJob>();
        services.AddScoped<IEffectivePermissionService, EffectivePermissionService>();
        // Studio IA 4.2a — identité impersonnée fail-closed des reprises de workflows (sans HTTP ni canal).
        services.AddScoped<FactuTrust.Application.Common.Identity.IImpersonationSnapshotResolver, FactuTrust.Infrastructure.Services.Identity.ImpersonationSnapshotResolver>();
        // Phase 2 — moteur de règles sectorielles en base (plan §WP-B2). Static provider is a
        // process-lifetime singleton (zero-alloc snapshot); DB provider is scoped (uses the
        // per-request MasterDbContext); the composite (registered as ISectorCatalogProvider) picks
        // between them per the UseDbRules flag and never throws.
        services.AddSingleton<FactuTrust.Infrastructure.Services.SectorCatalog.StaticSectorCatalogProvider>();
        services.AddScoped<FactuTrust.Infrastructure.Services.SectorCatalog.DbSectorCatalogProvider>();
        services.AddScoped<ISectorCatalogProvider, FactuTrust.Infrastructure.Services.SectorCatalog.CompositeSectorCatalogProvider>();
        services.AddScoped<IRegistrationSectorService, RegistrationSectorService>();
        // Phase 2 — backoffice admin CRUD over the sector-rule tables (plan §WP-B5).
        services.AddScoped<ISectorRuleAdminService, FactuTrust.Infrastructure.Services.SectorRules.SectorRuleAdminService>();
        // Plan §3.2 (v2 stub): no-op today. Swap for a real RNE-backed implementation later —
        // callers only depend on the interface.
        services.AddScoped<INifRegistryLookupService, NoOpNifRegistryLookupService>();
        services.AddScoped<IModuleUsageRecommendationService, FactuTrust.Infrastructure.Services.ModuleUsageRecommendationService>();
        // Phase 2 — application additive des modèles de données sectoriels aux bases tenant (plan §WP-B6).
        services.AddScoped<ISectorDataTemplateApplier, FactuTrust.Infrastructure.Services.SectorRules.SectorDataTemplateApplier>();
        // Phase 2 — re-configuration sectorielle d'un tenant existant depuis le backoffice (plan §WP-B7).
        services.AddScoped<ITenantSectorReconfigurationService, FactuTrust.Infrastructure.Services.SectorRules.TenantSectorReconfigurationService>();
        services.AddScoped<IPlatformTenantQueryService, PlatformTenantQueryService>();
        services.AddScoped<ISubscriptionAdminService, SubscriptionAdminService>();
        services.AddScoped<IPlatformMfaService, TotpPlatformMfaService>();
        services.AddScoped<IUserSessionService, UserSessionService>();
        services.AddScoped<IFailedLoginAttemptService, FailedLoginAttemptService>();

        // Lot C1 — Plans configurables + module overrides + jobs Hangfire
        services.AddScoped<IPlanResolver, DbPlanResolver>();
        services.AddScoped<IPlanAdminService, PlanAdminService>();
        services.AddScoped<IPlanQuotaService, PlanQuotaService>();
        services.AddScoped<IStudioQuotaService, StudioQuotaService>();
        services.AddScoped<ITenantModuleOverrideService, TenantModuleOverrideService>();
        services.AddScoped<FactuTrust.Infrastructure.Services.Background.ExpireModuleOverridesJob>();

        // Lot C3 — Coupons + crédits tenant
        services.AddScoped<ICouponAdminService, CouponAdminService>();
        services.AddScoped<ITenantCreditAdminService, TenantCreditAdminService>();

        // Lot C4 — Facturation plateforme (PDF QuestPDF + numérotation séquentielle DGI + reçus)
        services.AddScoped<IPlatformDocumentNumberService, FactuTrust.Infrastructure.Services.Billing.PlatformDocumentNumberService>();
        services.AddScoped<IPlatformFiscalSettingsService, FactuTrust.Infrastructure.Services.Billing.PlatformFiscalSettingsService>();
        services.AddSingleton<IPlatformInvoicePdfRenderer, FactuTrust.Infrastructure.Services.Billing.PlatformInvoicePdfRenderer>();
        services.AddScoped<IPlatformInvoiceAdminService, FactuTrust.Infrastructure.Services.Billing.PlatformInvoiceAdminService>();
        services.AddScoped<IPlatformReceiptAdminService, FactuTrust.Infrastructure.Services.Billing.PlatformReceiptAdminService>();

        // Lot C6 — Renouvellement auto + Dunning (campagnes + cycles + jobs Hangfire)
        services.AddScoped<IDunningCampaignService, FactuTrust.Infrastructure.Services.Billing.DunningCampaignService>();
        services.AddScoped<IDunningStateQueryService, FactuTrust.Infrastructure.Services.Billing.DunningStateQueryService>();
        services.AddScoped<ISubscriptionRenewalService, FactuTrust.Infrastructure.Services.Billing.SubscriptionRenewalService>();
        services.AddScoped<FactuTrust.Infrastructure.Services.Background.RenewalScanJob>();
        services.AddScoped<FactuTrust.Infrastructure.Services.Background.DunningExecutorJob>();
        services.AddScoped<RecurringEntryGenerator>();
        services.AddScoped<IRecurringEntryService, RecurringEntryService>();
        services.AddScoped<IPreClosingControlService, PreClosingControlService>();
        services.AddScoped<IAccountingHealthService, AccountingHealthService>();
        RegisterAccountingAuditServices(services);
        services.AddScoped<IAssistedInventoryEntryService, AssistedInventoryEntryService>();
        services.AddScoped<IFiscalYearLockService, FiscalYearLockService>();
        services.AddScoped<FactuTrust.Infrastructure.Services.Background.RecurringEntriesJob>();
        services.AddScoped<FiscalReminderService>();
        services.AddScoped<FactuTrust.Infrastructure.Services.Background.FiscalReminderJob>();
        // Enregistré inconditionnellement : le job porte lui-même la garde du flag, comme les
        // autres jobs Hangfire du produit.
        services.AddScoped<FactuTrust.Infrastructure.Services.Background.CashFlowRecomputationJob>();
        // Job récurrent des workflows Studio (PR 4.2d) : même garde de flag (EnableStudioWorkflows).
        services.AddScoped<Services.Studio.Workflows.StudioWorkflowResumeJob>();
        // 4.7★3 (D-47-79, S16) : job des déclencheurs planifiés (4.7b2) — enregistré explicitement comme
        // les autres jobs Hangfire, au lieu de dépendre de la construction implicite de l'activateur.
        services.AddScoped<Services.Studio.Workflows.StudioWorkflowScheduledJob>();

        // Lot C5 — Providers paiement (Konnect / Paymee / Virement) + webhooks signés HMAC
        services.AddScoped<FactuTrust.Infrastructure.Services.Billing.PaymentProviderConfigService>();
        services.AddScoped<IPaymentProviderConfigService>(sp => sp.GetRequiredService<FactuTrust.Infrastructure.Services.Billing.PaymentProviderConfigService>());
        services.AddScoped<IWebhookSignatureValidator, FactuTrust.Infrastructure.Services.Billing.WebhookSignatureValidator>();
        services.AddHttpClient(nameof(FactuTrust.Infrastructure.Services.Billing.KonnectPaymentClient), client =>
        {
            client.Timeout = TimeSpan.FromSeconds(20);
        });
        services.AddHttpClient(nameof(FactuTrust.Infrastructure.Services.Billing.PaymeePaymentClient), client =>
        {
            client.Timeout = TimeSpan.FromSeconds(20);
        });
        services.AddScoped<IPaymentProviderClient, FactuTrust.Infrastructure.Services.Billing.KonnectPaymentClient>();
        services.AddScoped<IPaymentProviderClient, FactuTrust.Infrastructure.Services.Billing.PaymeePaymentClient>();
        services.AddScoped<IPaymentCheckoutService, FactuTrust.Infrastructure.Services.Billing.PaymentCheckoutService>();
        services.AddScoped<IPaymentWebhookHandler, FactuTrust.Infrastructure.Services.Billing.PaymentWebhookHandler>();
        services.AddScoped<IPaymentIntentQueryService, FactuTrust.Infrastructure.Services.Billing.PaymentIntentQueryService>();

        // Withholding Tax (TEJ) Services
        services.AddScoped<IWithholdingTaxService, WithholdingTaxCalculationService>();
        services.AddScoped<ITejXmlGeneratorService, TejXmlGeneratorService>();
        services.AddScoped<ITejXmlValidatorService, TejXmlValidatorService>();
        services.AddScoped<ISupplierInvoiceTejDeclarationBuilder, SupplierInvoiceTejDeclarationBuilder>();
        services.AddScoped<IWithholdingComplianceService, WithholdingComplianceService>();

        services.Configure<FactuTrust.Infrastructure.Services.ProductImageSearchOptions>(
            configuration.GetSection(FactuTrust.Infrastructure.Services.ProductImageSearchOptions.SectionName));
        services.AddHttpClient("ProductImageSearch", client =>
        {
            client.Timeout = TimeSpan.FromSeconds(10);
            client.DefaultRequestHeaders.Add("Accept", "application/json");
        });
        services.AddScoped<IProductImageSearchService, ProductImageSearchService>();
        services.AddScoped<IProductImageStorageService, ProductImageStorageService>();

        // Unit of Work
        services.AddScoped<IUnitOfWork, UnitOfWork>();

        // AI Assistant (Ollama + OpenAI-compatible providers)
        services.Configure<OllamaSettings>(configuration.GetSection(OllamaSettings.SectionName));
        services.Configure<ScreenAnalysisOptions>(configuration.GetSection(ScreenAnalysisOptions.SectionName));
        services.Configure<OpenRouterSettings>(configuration.GetSection(OpenRouterSettings.SectionName));
        services.Configure<ModalSettings>(configuration.GetSection(ModalSettings.SectionName));
        services.Configure<DocStrangeSettings>(configuration.GetSection(DocStrangeSettings.SectionName));
        services.Configure<CursorSdkSettings>(configuration.GetSection(CursorSdkSettings.SectionName));
        services.Configure<CashDeskFeaturesOptions>(configuration.GetSection(CashDeskFeaturesOptions.SectionName));
        services.Configure<FixedAssetsOptions>(configuration.GetSection(FixedAssetsOptions.SectionName));
        services.Configure<AccountingAttachmentsOptions>(configuration.GetSection(AccountingAttachmentsOptions.SectionName));
        services.Configure<AccountingFirmsOptions>(configuration.GetSection(AccountingFirmsOptions.SectionName));
        services.Configure<PublicRegistrationOptions>(configuration.GetSection(PublicRegistrationOptions.SectionName));
        services.Configure<RegistrationSectorOptions>(configuration.GetSection(RegistrationSectorOptions.SectionName));
        services.Configure<EmailVerificationOptions>(configuration.GetSection(EmailVerificationOptions.SectionName));
        services.Configure<PayrollOptions>(configuration.GetSection(PayrollOptions.SectionName));
        services.Configure<TenantProvisioningOptions>(configuration.GetSection(TenantProvisioningOptions.SectionName));
        services.Configure<FirmGovernanceOptions>(configuration.GetSection(FirmGovernanceOptions.SectionName));
        services.Configure<FirmFiscalOpsOptions>(configuration.GetSection(FirmFiscalOpsOptions.SectionName));
        services.Configure<AccountingSettings>(configuration.GetSection(AccountingSettings.SectionName));

        // Les comptes SCE venus d'appsettings sont signalés, jamais bloquants : faire échouer le
        // démarrage de l'API sur une clé de configuration serait une régression plus grave que le
        // défaut qu'on cherche à prévenir. La saisie par dossier, elle, est refusée à l'écriture.
        services.AddOptions<AccountingSettings>().PostConfigure<Microsoft.Extensions.Logging.ILogger<AccountingSettings>>(
            static (settings, logger) =>
            {
                foreach (var (key, value) in settings.ConfiguredAccountNumbers())
                {
                    if (FactuTrust.Domain.Services.Accounting.AccountNumberRules.IsWellFormed(value))
                        continue;

                    Microsoft.Extensions.Logging.LoggerExtensions.LogWarning(
                        logger,
                        "Configuration comptable : {Key} = « {Value} » n'est pas un numéro de compte "
                        + "valide (au plus {MaxDigits} chiffres, classe 1 à 7). Les écritures qui "
                        + "l'utilisent seront refusées à la création du compte.",
                        key, value, FactuTrust.Domain.Services.Accounting.AccountNumberRules.MaxDigits);
                }

                // Phase 3 du lettrage : une borne dépassée est ramenée dans ses limites par
                // LetteringSuggestionSettings.Clamped() ; on le signale sans bloquer le démarrage.
                foreach (var (key, value, min, max) in settings.LetteringSuggestions.OutOfRangeKeys())
                {
                    Microsoft.Extensions.Logging.LoggerExtensions.LogWarning(
                        logger,
                        "Configuration comptable : LetteringSuggestions:{Key} = {Value} est hors bornes "
                        + "[{Min} ; {Max}]. La valeur bornée sera utilisée.",
                        key, value, min, max);
                }
            });

        services.Configure<ProductOnboardingSettings>(configuration.GetSection(ProductOnboardingSettings.SectionName));
        services.Configure<NifRegistryLookupOptions>(configuration.GetSection(NifRegistryLookupOptions.SectionName));
        services.Configure<ModuleRecommendationsOptions>(configuration.GetSection(ModuleRecommendationsOptions.SectionName));
        services.Configure<MigrationAiSettings>(configuration.GetSection(MigrationAiSettings.SectionName));
        services.Configure<StorefrontOptions>(configuration.GetSection(StorefrontOptions.SectionName));
        // Lot C — échec au démarrage (comme JwtSettings) plutôt qu'un formulaire qui « marche » sans prévenir personne.
        services.AddOptions<PublicContactOptions>()
            .Bind(configuration.GetSection(PublicContactOptions.SectionName))
            .Validate(
                o => o.RecipientEmails is not null && o.RecipientEmails.All(e => System.Net.Mail.MailAddress.TryCreate(e, out _)),
                "Features:PublicContact:RecipientEmails contient une adresse e-mail invalide.")
            .Validate(
                o => o.MinElapsedMs >= 0 && o.MaxMessageLength > 0 && o.RetentionDays > 0 && o.SpamRetentionDays > 0
                     && o.DuplicateWindowMinutes >= 0 && o.MaxAcceptedPerHour > 0 && !string.IsNullOrWhiteSpace(o.ConsentTextVersion)
                     && o.ConsentTextVersion.Length <= FactuTrust.Domain.Entities.PublicContact.PublicContactRequest.ConsentTextVersionMaxLength,
                "Bornes Features:PublicContact invalides (MinElapsedMs >= 0, MaxMessageLength/RetentionDays/SpamRetentionDays/MaxAcceptedPerHour > 0, DuplicateWindowMinutes >= 0, ConsentTextVersion 1-32 caractères).")
            .ValidateOnStart();
        services.Configure<SalesOrderOptions>(configuration.GetSection(SalesOrderOptions.SectionName));
        services.Configure<StockTraceabilityOptions>(configuration.GetSection(StockTraceabilityOptions.SectionName));

        // Enregistrement inconditionnel : les handlers MediatR sont validés au démarrage
        // (ValidateOnBuild), un enregistrement conditionnel ferait échouer la construction
        // du conteneur dès que le drapeau est éteint. La garde est à l'exécution.
        services.Configure<BarcodeOptions>(configuration.GetSection(BarcodeOptions.SectionName));

        // Sans état (tables de motifs constantes, encodage pur) : un singleton suffit.
        // Enregistrement inconditionnel, comme tout le reste — la garde est à l'exécution.
        services.AddSingleton<IBarcodeEncoder, BarcodeEncoder>();
        services.AddSingleton<IProductLabelPdfRenderer, ProductLabelPdfRenderer>();
        services.Configure<ChannelsSettings>(configuration.GetSection(ChannelsSettings.SectionName));
        // Canaux externes (WhatsApp) : liaison d'identité en base tenant/master. Le pont Node et
        // l'envoi sortant (IChannelOutboundSender) sont hébergés côté API (processus enfant piloté).
        services.AddScoped<IChannelLinkService, FactuTrust.Infrastructure.Services.Channels.ChannelLinkService>();
        services.AddSingleton<IQrCodeGenerator, FactuTrust.Infrastructure.Services.QrCodeGenerator>();
        // Porte de concurrence des générations Ollama (singleton partagé par tout le processus) :
        // limite le nombre de générations LLM simultanées pour protéger un moteur mono-instance / CPU.
        services.AddSingleton<FactuTrust.Infrastructure.Services.AI.OllamaGenerationGate>();
        services.AddSingleton<IOllamaGenerationGate>(sp =>
            sp.GetRequiredService<FactuTrust.Infrastructure.Services.AI.OllamaGenerationGate>());
        services.AddHttpClient<IOllamaClient, OllamaHttpClient>((sp, client) =>
        {
            var settings = configuration.GetSection(OllamaSettings.SectionName).Get<OllamaSettings>() ?? new OllamaSettings();
            client.BaseAddress = new Uri(settings.BaseUrl);
            client.Timeout = TimeSpan.FromSeconds(settings.TimeoutSeconds);
        });
        services.AddHttpClient("OllamaKeepAlive", (sp, client) =>
        {
            var settings = configuration.GetSection(OllamaSettings.SectionName).Get<OllamaSettings>() ?? new OllamaSettings();
            client.BaseAddress = new Uri(settings.BaseUrl);
            client.Timeout = TimeSpan.FromSeconds(Math.Clamp(settings.TimeoutSeconds, 5, 120));
        });
        services.AddHttpClient("OpenAiCompatible", (sp, client) =>
        {
            var settings = configuration.GetSection(OpenRouterSettings.SectionName).Get<OpenRouterSettings>() ?? new OpenRouterSettings();
            client.Timeout = TimeSpan.FromSeconds(Math.Clamp(settings.TimeoutSeconds, 10, 600));
        });
        services.AddHttpClient(OpenAiCompatibleCallOptions.ModalClientName, (sp, client) =>
        {
            var settings = configuration.GetSection(ModalSettings.SectionName).Get<ModalSettings>() ?? new ModalSettings();
            client.Timeout = TimeSpan.FromSeconds(Math.Clamp(settings.TimeoutSeconds, 30, 600));
        });
        services.AddHttpClient(DocStrangeHttpClient.HttpClientName, (sp, client) =>
        {
            var settings = configuration.GetSection(DocStrangeSettings.SectionName).Get<DocStrangeSettings>() ?? new DocStrangeSettings();
            client.Timeout = TimeSpan.FromSeconds(Math.Clamp(settings.TimeoutSeconds, 30, 600));
        });
        services.AddScoped<IDocStrangeClient, DocStrangeHttpClient>();
        services.AddScoped<IDocumentExtractionProvider, DocStrangeDocumentExtractionProvider>();
        services.AddScoped<IOpenAiChatCompletionsClient, OpenAiChatCompletionsClient>();
        services.AddSingleton<ICursorToolRunRegistry, CursorToolRunRegistry>();
        services.AddSingleton<CursorSdkBridgeHost>();
        services.AddSingleton<ICursorAgentClient>(sp => sp.GetRequiredService<CursorSdkBridgeHost>());
        services.AddSingleton<CursorToolCallbackService>();
        services.AddHostedService<CursorSdkBridgeHostedService>();
        services.AddSingleton<IAiDeterministicToolCache, AiDeterministicToolCache>();
        services.AddSingleton<IAiReadOnlyToolCache, AiReadOnlyToolCache>();
        services.AddScoped<IAiToolExecutor, AiToolExecutor>();
        // Outils au périmètre cabinet (agent Chef de mission) : injecté comme paramètre optionnel
        // d'AiToolExecutor. Son absence dégrade en erreur explicite, jamais en exception.
        services.AddScoped<IFirmAgentToolExecutor, FirmAgentToolExecutor>();
        // Actions de relance en attente de confirmation : singleton en mémoire (pas de persistance,
        // TTL de 5 min) — partagé par toutes les requêtes du processus, y compris l'endpoint de
        // confirmation qui vit dans une requête HTTP distincte de la PREVIEW.
        services.AddSingleton<IFirmReminderPendingActionStore, FirmReminderPendingActionStore>();
        services.AddSingleton<IAiToolExecutorScopeFactory, AiToolExecutorScopeFactory>();
        services.AddSingleton<IAiPdfRenderer, PdfToImagePdfRenderer>();
        services.AddSingleton<IAiOcrService, TesseractOcrService>();
        services.AddSingleton<IImagePreprocessingService, ImagePreprocessingService>();
        services.AddScoped<IAiDocumentTextExtractor, AiDocumentTextExtractor>();
        services.AddScoped<IAiContextBuilder, AiContextBuilder>();
        services.AddScoped<AiVolatileContextFormatter>();
        services.AddScoped<AiScreenAnalysisEnricher>();
        services.AddScoped<IConversationRepository, ConversationRepository>();
        services.AddScoped<ITenantAiProviderRepository, TenantAiProviderRepository>();
        services.AddScoped<SendChatMessageHandler>();
        // Mécanique d'extraction documentaire pilotée par LLM, partagée entre l'import de facture
        // du wizard de facturation et l'import de pièce comptable (saisie manuelle d'écritures).
        services.AddScoped<FactuTrust.Application.Features.AI.IAiStructuredExtractionPipeline,
            FactuTrust.Application.Features.AI.AiStructuredExtractionPipeline>();
        services.AddScoped<ImportInvoiceFromFileHandler>();
        // Enregistrement INCONDITIONNEL : les handlers MediatR sont validés au démarrage
        // (ValidateOnBuild), une dépendance conditionnelle ferait échouer le boot.
        services.AddScoped<IAiEngineMemoryProbe, AiEngineMemoryProbe>();
        services.AddScoped<IOllamaModelReadinessChecker, OllamaModelReadinessChecker>();
        services.AddScoped<IAiModelVisionProbe, FactuTrust.Infrastructure.Services.AI.OllamaModelVisionProbe>();
        services.AddScoped<IAiModelRecommender, OllamaModelRecommender>();
        services.AddScoped<IPlatformAiSettingsService, FactuTrust.Infrastructure.Services.AI.PlatformAiSettingsService>();
        services.AddScoped<IImportAiModelResolutionService, FactuTrust.Application.Features.AI.ImportAiModelResolutionService>();
        services.AddScoped<ITenantModalSettingsService, FactuTrust.Infrastructure.Services.AI.TenantModalSettingsService>();
        services.AddScoped<IModalCredentialsResolver, FactuTrust.Infrastructure.Services.AI.ModalCredentialsResolver>();
        services.AddScoped<IOllamaInferenceProfileResolver, OllamaInferenceProfileResolver>();

        // Import de pièce comptable depuis la saisie manuelle d'écritures : parseur déterministe
        // du gabarit InstaFact, puis repli IA, puis proposition d'écriture. Chemin en lecture seule.
        services.AddSingleton<FactuTrust.Infrastructure.Services.DocumentImport.InstaFactInvoicePdfParser>();
        services.AddScoped<FactuTrust.Application.Features.Accounting.DocumentImport.IAccountingDocumentExtractor,
            FactuTrust.Infrastructure.Services.DocumentImport.AccountingDocumentExtractor>();
        services.AddScoped<FactuTrust.Application.Features.Accounting.DocumentImport.IAccountingEntryProposalService,
            FactuTrust.Infrastructure.Services.DocumentImport.AccountingEntryProposalService>();

        // AI Export — PowerPoint generation (Clean Architecture: contracts in Application, implementations here).
        services.Configure<FactuTrust.Infrastructure.Services.AI.Export.Storage.ExportStorageOptions>(
            configuration.GetSection("AiExport:Storage"));
        services.Configure<FactuTrust.Infrastructure.Services.AI.Export.PowerPoint.Rendering.PowerPointValidationOptions>(
            configuration.GetSection("AiExport:Validation"));
        services.Configure<FactuTrust.Infrastructure.Services.AI.Export.PowerPoint.Rendering.PowerPointRenderingOptions>(
            configuration.GetSection(FactuTrust.Infrastructure.Services.AI.Export.PowerPoint.Rendering.PowerPointRenderingOptions.SectionName));
        services.AddScoped<FactuTrust.Application.Common.Interfaces.Repositories.IAiExportAuditRepository,
            FactuTrust.Infrastructure.Repositories.AiExportAuditRepository>();
        services.AddSingleton<FactuTrust.Infrastructure.Services.AI.Export.PowerPoint.Themes.IBrandAssetProvider,
            FactuTrust.Infrastructure.Services.AI.Export.PowerPoint.Themes.FilesystemBrandAssetProvider>();
        services.AddSingleton<FactuTrust.Infrastructure.Services.AI.Export.PowerPoint.Themes.IPowerPointThemeResolver,
            FactuTrust.Infrastructure.Services.AI.Export.PowerPoint.Themes.PowerPointThemeResolver>();
        services.AddSingleton<FactuTrust.Application.Features.AI.Export.PowerPoint.Services.IPowerPointTemplateCatalog,
            FactuTrust.Infrastructure.Services.AI.Export.PowerPoint.PowerPointTemplateCatalog>();
        services.AddSingleton<FactuTrust.Infrastructure.Services.AI.Export.PowerPoint.Templates.IPowerPointBaseTemplateRepository,
            FactuTrust.Infrastructure.Services.AI.Export.PowerPoint.Templates.PowerPointBaseTemplateRepository>();
        services.AddHostedService<FactuTrust.Infrastructure.Services.AI.Export.PowerPoint.Templates.PowerPointThemePreviewBootstrapper>();
        services.AddScoped<FactuTrust.Infrastructure.Services.AI.Export.PowerPoint.HybridTemplateGenerator>();
        services.AddScoped<FactuTrust.Infrastructure.Services.AI.Export.PowerPoint.PowerPointGenerator>();
        services.AddScoped<FactuTrust.Application.Features.AI.Export.PowerPoint.Services.IPowerPointGenerator,
            FactuTrust.Infrastructure.Services.AI.Export.PowerPoint.PowerPointGenerationEngineRouter>();
        services.AddScoped<FactuTrust.Application.Features.AI.Export.PowerPoint.Services.IPowerPointExportPreviewService,
            FactuTrust.Infrastructure.Services.AI.Export.PowerPoint.PowerPointExportPreviewService>();
        services.AddScoped<FactuTrust.Application.Features.AI.Export.PowerPoint.Services.IExportStorageService,
            FactuTrust.Infrastructure.Services.AI.Export.Storage.FilesystemExportStorageService>();
        services.AddScoped<FactuTrust.Infrastructure.Services.Background.AiExportCleanupJob>();
        if (!IsDesignTime())
        {
            services.AddHostedService<OcrStartupCheckHostedService>();
            // Modèle vision des relevés bancaires (GLM-OCR) : contrôle journalisé ~15 s après le
            // démarrage, jamais bloquant. Le contrôle de santé « ollama-bank-statement-vision »
            // (OllamaVisionModelHealthCheck) est enregistré dans Program.cs (AddHealthChecks).
            services.AddHostedService<OllamaVisionModelStartupCheckHostedService>();
            services.AddHostedService<OllamaKeepAliveService>();
            services.AddHostedService<StorefrontProjectionSyncService>();
        }

        // ────────────────────────────────────────────────────────────────────
        //  AI Forecasting module
        //  Always bind options (the executor / context-builder consult them
        //  to decide whether to expose forecasting hints/tools), but only
        //  register the scoped services and hosted background workers when
        //  the feature flag is enabled. This guarantees zero impact when the
        //  module is off.
        // ────────────────────────────────────────────────────────────────────
        services.Configure<ForecastingOptions>(configuration.GetSection(ForecastingOptions.SectionName));
        services.Configure<ProjectsOptions>(configuration.GetSection(ProjectsOptions.SectionName));
        services.Configure<RecurringContractsOptions>(configuration.GetSection(RecurringContractsOptions.SectionName));
        var forecastingOptions = configuration.GetSection(ForecastingOptions.SectionName).Get<ForecastingOptions>() ?? new ForecastingOptions();
        if (forecastingOptions.Enabled)
        {
            services.AddScoped<ITunisianCalendarService, TunisianCalendarService>();
            services.AddScoped<IForecastingService, ForecastingService>();
            services.AddScoped<IPromotionRecommendationService, PromotionRecommendationService>();
            services.AddScoped<IAbcXyzClassifier, AbcXyzClassifier>();
            services.AddScoped<IForecastRecomputeOrchestrator, ForecastRecomputeOrchestrator>();

            // Replenishment — single registration since the V1 cutover (2026-05-13).
            services.AddScoped<IReplenishmentService, Services.Forecasting.ReplenishmentService>();
            services.AddScoped<IPurchaseOrderDraftFactory, Services.PurchaseOrders.PurchaseOrderDraftFactory>();

            if (!IsDesignTime() && forecastingOptions.BackgroundRecomputeEnabled)
                services.AddHostedService<ForecastRecomputationService>();
            if (!IsDesignTime() && forecastingOptions.PromotionDetectorEnabled)
                services.AddHostedService<PromotionWindowDetectorService>();
        }

        // ────────────────────────────────────────────────────────────────────
        //  Trésorerie prévisionnelle par IA
        //
        //  Enregistrement INCONDITIONNEL, contrairement au module Prévisions IA.
        //  Ce module expose des handlers MediatR, que MediatR découvre et
        //  enregistre par balayage d'assembly quel que soit l'état du flag ;
        //  laisser leurs dépendances non enregistrées ferait échouer la
        //  validation du conteneur au démarrage (ValidateOnBuild), garde-fou
        //  qu'il ne serait pas sain de désactiver.
        //
        //  L'impact reste nul quand le flag est éteint : chaque route répond
        //  503, les outils de l'assistant refusent explicitement, et le job
        //  nocturne sort immédiatement. Rien ne s'exécute sans être appelé.
        // ────────────────────────────────────────────────────────────────────
        services.Configure<TreasuryForecastOptions>(configuration.GetSection(TreasuryForecastOptions.SectionName));
        var treasuryForecastOptions = configuration.GetSection(TreasuryForecastOptions.SectionName)
            .Get<TreasuryForecastOptions>() ?? new TreasuryForecastOptions();

        services.AddScoped<ICashFlowForecastRepository, CashFlowForecastRepository>();
        services.AddScoped<IRecurringCashCommitmentRepository, RecurringCashCommitmentRepository>();
        services.AddScoped<ICashFlowForecastSettingsRepository, CashFlowForecastSettingsRepository>();
        services.AddScoped<ITreasuryPositionService, TreasuryPositionService>();

        // Collecteurs : l'ordre d'enregistrement est l'ordre d'exécution. Les sources certaines
        // d'abord, ce qui rend les journaux plus lisibles en cas d'incident.
        services.AddScoped<ICashFlowSourceCollector, ClientReceivablesCollector>();
        services.AddScoped<ICashFlowSourceCollector, ClientEffetCollector>();
        services.AddScoped<ICashFlowSourceCollector, SupplierPayablesCollector>();
        services.AddScoped<ICashFlowSourceCollector, SupplierEffetCollector>();
        services.AddScoped<ICashFlowSourceCollector, PayrollCollector>();
        services.AddScoped<ICashFlowSourceCollector, FiscalObligationsCollector>();
        services.AddScoped<ICashFlowSourceCollector, LoanScheduleCollector>();
        services.AddScoped<ICashFlowSourceCollector, RecurringCommitmentCollector>();

        services.AddScoped<ICashFlowForecastService, CashFlowForecastService>();

        // Seule la couche IA reste conditionnelle : l'orchestrateur la reçoit en paramètre
        // optionnel et demeure purement déterministe en son absence.
        if (treasuryForecastOptions.Ai.Enabled)
            services.AddScoped<ICashFlowAiAdvisor, CashFlowAiAdvisor>();

        return services;
    }

    /// <summary>
    /// Typed HttpClient for Cloudflare Turnstile siteverify (storefront and public contact form):
    /// 5 s timeout, no redirects, no cookies, bounded response headers, no HTTP logging (the form
    /// body carries the secret key).
    /// </summary>
    private static void AddHardenedTurnstileHttpClient<TInterface, TImplementation>(IServiceCollection services)
        where TInterface : class
        where TImplementation : class, TInterface
    {
        services.AddHttpClient<TInterface, TImplementation>(client =>
        {
            client.Timeout = TimeSpan.FromSeconds(5);
        }).ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler
        {
            AllowAutoRedirect = false,
            UseCookies = false,
            MaxResponseHeadersLength = 16
        }).RemoveAllLoggers();
    }

    private static bool IsDesignTime()
    {
        // EF Core tools set this environment variable
        if (!string.IsNullOrEmpty(Environment.GetEnvironmentVariable("EF_DOTNET_DESIGN_TIME")))
        {
            return true;
        }

        // In design-time, there's no entry assembly (e.g., when running EF Core tools)
        // This is the most reliable way to detect design-time mode
        return Assembly.GetEntryAssembly() == null;
    }

    /// <summary>
    /// Configure MasterDbContext identiquement pour le scoped `AddDbContext` ET la factory
    /// `AddDbContextFactory`. Toute divergence entre les deux appels créerait des instances de
    /// contexte avec des comportements subtilement différents (interceptors, warnings, migrations).
    /// </summary>
    private static void ConfigureMasterDbContext(
        DbContextOptionsBuilder options,
        IServiceProvider sp,
        IConfiguration configuration)
    {
        options.UseSqlServer(
            configuration.GetConnectionString("MasterConnection"),
            b => b.MigrationsAssembly(typeof(MasterDbContext).Assembly.FullName));

        var env = sp.GetService<IHostEnvironment>();
        if (env is not null && env.IsDevelopment())
        {
            options.AddInterceptors(sp.GetRequiredService<MasterDbConcurrencyDiagnosticsInterceptor>());
        }
    }

    private static void RegisterAccountingAuditServices(IServiceCollection services)
    {
        services.AddScoped<FactuTrust.Infrastructure.Services.AccountingAudit.Rules.DraftEntriesAuditRule>();
        services.AddScoped<FactuTrust.Infrastructure.Services.AccountingAudit.Rules.UnbalancedEntriesAuditRule>();
        services.AddScoped<FactuTrust.Infrastructure.Services.AccountingAudit.Rules.SuspenseAccountsAuditRule>();
        services.AddScoped<FactuTrust.Infrastructure.Services.AccountingAudit.Rules.UnletteredLinesAuditRule>();
        services.AddScoped<FactuTrust.Infrastructure.Services.AccountingAudit.Rules.DepreciationAuditRule>();
        services.AddScoped<FactuTrust.Infrastructure.Services.AccountingAudit.Rules.VatMissingDeclarationAuditRule>();
        services.AddScoped<FactuTrust.Infrastructure.Services.AccountingAudit.Rules.OpenPeriodsAuditRule>();
        services.AddScoped<FactuTrust.Infrastructure.Services.AccountingAudit.Rules.SequenceGapsAuditRule>();
        services.AddScoped<FactuTrust.Infrastructure.Services.AccountingAudit.Rules.OrphanAccountsAuditRule>();
        services.AddScoped<FactuTrust.Infrastructure.Services.AccountingAudit.Rules.PayrollAuxiliaryAccountShapeAuditRule>();
        services.AddScoped<FactuTrust.Infrastructure.Services.AccountingAudit.Rules.AccountNumberLengthAuditRule>();
        services.AddScoped<FactuTrust.Infrastructure.Services.AccountingAudit.Rules.OutOfPeriodAuditRule>();
        services.AddScoped<FactuTrust.Infrastructure.Services.AccountingAudit.Rules.PieceDuplicatesAuditRule>();
        services.AddScoped<FactuTrust.Infrastructure.Services.AccountingAudit.Rules.ThirdPartyMislinkAuditRule>();
        services.AddScoped<FactuTrust.Infrastructure.Services.AccountingAudit.Rules.MissingAttachmentsAuditRule>();
        services.AddScoped<FactuTrust.Infrastructure.Services.AccountingAudit.Rules.VatDeductibleNoProofAuditRule>();
        services.AddScoped<FactuTrust.Infrastructure.Services.AccountingAudit.Rules.BankReconciliationIncompleteAuditRule>();

        // Réviseur — famille « Comptable ».
        services.AddScoped<FactuTrust.Infrastructure.Services.AccountingAudit.Rules.VatVersusDocumentAuditRule>();
        services.AddScoped<FactuTrust.Infrastructure.Services.AccountingAudit.Rules.ThirdPartyAccountMismatchAuditRule>();
        services.AddScoped<FactuTrust.Infrastructure.Services.AccountingAudit.Rules.LetteringOrphanAuditRule>();
        services.AddScoped<FactuTrust.Infrastructure.Services.AccountingAudit.Rules.ReversalMissingAuditRule>();

        // Réviseur — famille « Documentaire ».
        services.AddScoped<FactuTrust.Infrastructure.Services.AccountingAudit.Rules.SupplierInvoiceWithoutProofAuditRule>();
        services.AddScoped<FactuTrust.Infrastructure.Services.AccountingAudit.Rules.SupplierInvoiceDuplicateAuditRule>();
        services.AddScoped<FactuTrust.Infrastructure.Services.AccountingAudit.Rules.PurchasePriceDriftAuditRule>();

        // Réviseur — famille « Trésorerie ».
        services.AddScoped<FactuTrust.Infrastructure.Services.AccountingAudit.Rules.CashNegativeBalanceAuditRule>();
        services.AddScoped<FactuTrust.Infrastructure.Services.AccountingAudit.Rules.CashInWithoutDocumentAuditRule>();

        // Réviseur — famille « Fiscale ».
        services.AddScoped<FactuTrust.Infrastructure.Services.AccountingAudit.Rules.WithholdingMissingOnFeesAuditRule>();
        services.AddScoped<FactuTrust.Infrastructure.Services.AccountingAudit.Rules.FodecMissingAuditRule>();
        services.AddScoped<FactuTrust.Infrastructure.Services.AccountingAudit.Rules.VatPeriodNotClosedAuditRule>();

        // Réviseur — famille « Paie ».
        services.AddScoped<FactuTrust.Infrastructure.Services.AccountingAudit.Rules.PayrollCnssRegimeMismatchAuditRule>();
        services.AddScoped<FactuTrust.Infrastructure.Services.AccountingAudit.Rules.PayrollDependentWithoutProofAuditRule>();
        services.AddScoped<FactuTrust.Infrastructure.Services.AccountingAudit.Rules.PayrollOvertimeOutOfRegimeAuditRule>();
        services.AddScoped<FactuTrust.Infrastructure.Services.AccountingAudit.Rules.PayrollBelowSmigAuditRule>();

        // Réviseur — famille « Fraude douce ».
        services.AddScoped<FactuTrust.Infrastructure.Services.AccountingAudit.Rules.ThresholdStructuringAuditRule>();
        services.AddScoped<FactuTrust.Infrastructure.Services.AccountingAudit.Rules.SupplierCreatedThenPaidAuditRule>();
        services.AddScoped<FactuTrust.Infrastructure.Services.AccountingAudit.Rules.SelfValidatedEntryAuditRule>();
        services.AddScoped<FactuTrust.Infrastructure.Services.AccountingAudit.Rules.OffHoursEntryAuditRule>();
        services.AddScoped<FactuTrust.Infrastructure.Services.AccountingAudit.Rules.BackdatedEntryAuditRule>();

        services.AddScoped<FactuTrust.Infrastructure.Services.AccountingAudit.AccountingAuditRuleRegistry>(sp =>
        {
            var rules = sp.GetServices<IAccountingAuditRule>().ToList();
            return new FactuTrust.Infrastructure.Services.AccountingAudit.AccountingAuditRuleRegistry(rules);
        });
        services.AddScoped<IAccountingAuditRule, FactuTrust.Infrastructure.Services.AccountingAudit.Rules.DraftEntriesAuditRule>();
        services.AddScoped<IAccountingAuditRule, FactuTrust.Infrastructure.Services.AccountingAudit.Rules.UnbalancedEntriesAuditRule>();
        services.AddScoped<IAccountingAuditRule, FactuTrust.Infrastructure.Services.AccountingAudit.Rules.SuspenseAccountsAuditRule>();
        services.AddScoped<IAccountingAuditRule, FactuTrust.Infrastructure.Services.AccountingAudit.Rules.UnletteredLinesAuditRule>();
        services.AddScoped<IAccountingAuditRule, FactuTrust.Infrastructure.Services.AccountingAudit.Rules.DepreciationAuditRule>();
        services.AddScoped<IAccountingAuditRule, FactuTrust.Infrastructure.Services.AccountingAudit.Rules.VatMissingDeclarationAuditRule>();
        services.AddScoped<IAccountingAuditRule, FactuTrust.Infrastructure.Services.AccountingAudit.Rules.OpenPeriodsAuditRule>();
        services.AddScoped<IAccountingAuditRule, FactuTrust.Infrastructure.Services.AccountingAudit.Rules.SequenceGapsAuditRule>();
        services.AddScoped<IAccountingAuditRule, FactuTrust.Infrastructure.Services.AccountingAudit.Rules.OrphanAccountsAuditRule>();
        services.AddScoped<IAccountingAuditRule, FactuTrust.Infrastructure.Services.AccountingAudit.Rules.PayrollAuxiliaryAccountShapeAuditRule>();
        services.AddScoped<IAccountingAuditRule, FactuTrust.Infrastructure.Services.AccountingAudit.Rules.AccountNumberLengthAuditRule>();
        services.AddScoped<IAccountingAuditRule, FactuTrust.Infrastructure.Services.AccountingAudit.Rules.OutOfPeriodAuditRule>();
        services.AddScoped<IAccountingAuditRule, FactuTrust.Infrastructure.Services.AccountingAudit.Rules.PieceDuplicatesAuditRule>();
        services.AddScoped<IAccountingAuditRule, FactuTrust.Infrastructure.Services.AccountingAudit.Rules.ThirdPartyMislinkAuditRule>();
        services.AddScoped<IAccountingAuditRule, FactuTrust.Infrastructure.Services.AccountingAudit.Rules.MissingAttachmentsAuditRule>();
        services.AddScoped<IAccountingAuditRule, FactuTrust.Infrastructure.Services.AccountingAudit.Rules.VatDeductibleNoProofAuditRule>();
        services.AddScoped<IAccountingAuditRule, FactuTrust.Infrastructure.Services.AccountingAudit.Rules.BankReconciliationIncompleteAuditRule>();

        // Réviseur — famille « Comptable ».
        services.AddScoped<IAccountingAuditRule, FactuTrust.Infrastructure.Services.AccountingAudit.Rules.VatVersusDocumentAuditRule>();
        services.AddScoped<IAccountingAuditRule, FactuTrust.Infrastructure.Services.AccountingAudit.Rules.ThirdPartyAccountMismatchAuditRule>();
        services.AddScoped<IAccountingAuditRule, FactuTrust.Infrastructure.Services.AccountingAudit.Rules.LetteringOrphanAuditRule>();
        services.AddScoped<IAccountingAuditRule, FactuTrust.Infrastructure.Services.AccountingAudit.Rules.ReversalMissingAuditRule>();

        // Réviseur — famille « Documentaire ».
        services.AddScoped<IAccountingAuditRule, FactuTrust.Infrastructure.Services.AccountingAudit.Rules.SupplierInvoiceWithoutProofAuditRule>();
        services.AddScoped<IAccountingAuditRule, FactuTrust.Infrastructure.Services.AccountingAudit.Rules.SupplierInvoiceDuplicateAuditRule>();
        services.AddScoped<IAccountingAuditRule, FactuTrust.Infrastructure.Services.AccountingAudit.Rules.PurchasePriceDriftAuditRule>();

        // Réviseur — famille « Trésorerie ».
        services.AddScoped<IAccountingAuditRule, FactuTrust.Infrastructure.Services.AccountingAudit.Rules.CashNegativeBalanceAuditRule>();
        services.AddScoped<IAccountingAuditRule, FactuTrust.Infrastructure.Services.AccountingAudit.Rules.CashInWithoutDocumentAuditRule>();

        // Réviseur — famille « Fiscale ».
        services.AddScoped<IAccountingAuditRule, FactuTrust.Infrastructure.Services.AccountingAudit.Rules.WithholdingMissingOnFeesAuditRule>();
        services.AddScoped<IAccountingAuditRule, FactuTrust.Infrastructure.Services.AccountingAudit.Rules.FodecMissingAuditRule>();
        services.AddScoped<IAccountingAuditRule, FactuTrust.Infrastructure.Services.AccountingAudit.Rules.VatPeriodNotClosedAuditRule>();

        // Réviseur — famille « Paie ».
        services.AddScoped<IAccountingAuditRule, FactuTrust.Infrastructure.Services.AccountingAudit.Rules.PayrollCnssRegimeMismatchAuditRule>();
        services.AddScoped<IAccountingAuditRule, FactuTrust.Infrastructure.Services.AccountingAudit.Rules.PayrollDependentWithoutProofAuditRule>();
        services.AddScoped<IAccountingAuditRule, FactuTrust.Infrastructure.Services.AccountingAudit.Rules.PayrollOvertimeOutOfRegimeAuditRule>();
        services.AddScoped<IAccountingAuditRule, FactuTrust.Infrastructure.Services.AccountingAudit.Rules.PayrollBelowSmigAuditRule>();

        // Réviseur — famille « Fraude douce ».
        services.AddScoped<IAccountingAuditRule, FactuTrust.Infrastructure.Services.AccountingAudit.Rules.ThresholdStructuringAuditRule>();
        services.AddScoped<IAccountingAuditRule, FactuTrust.Infrastructure.Services.AccountingAudit.Rules.SupplierCreatedThenPaidAuditRule>();
        services.AddScoped<IAccountingAuditRule, FactuTrust.Infrastructure.Services.AccountingAudit.Rules.SelfValidatedEntryAuditRule>();
        services.AddScoped<IAccountingAuditRule, FactuTrust.Infrastructure.Services.AccountingAudit.Rules.OffHoursEntryAuditRule>();
        services.AddScoped<IAccountingAuditRule, FactuTrust.Infrastructure.Services.AccountingAudit.Rules.BackdatedEntryAuditRule>();

        services.AddScoped<IAccountingAuditEngine, FactuTrust.Infrastructure.Services.AccountingAudit.AccountingAuditEngine>();
        services.AddScoped<IAccountingAuditQueryService, FactuTrust.Infrastructure.Services.AccountingAudit.AccountingAuditQueryService>();
        services.AddScoped<IAccountingAuditWorkflowService, FactuTrust.Infrastructure.Services.AccountingAudit.AccountingAuditWorkflowService>();
        services.AddScoped<IAccountingAuditExportService, FactuTrust.Infrastructure.Services.AccountingAudit.AccountingAuditExportService>();
        services.AddScoped<IAccountingAuditScheduleService, FactuTrust.Infrastructure.Services.AccountingAudit.AccountingAuditScheduleService>();
        services.AddScoped<IAccountingAuditRuleSettingsService, FactuTrust.Infrastructure.Services.AccountingAudit.AccountingAuditRuleSettingsService>();
        services.AddScoped<FactuTrust.Infrastructure.Services.Background.AccountingAuditScheduledJob>();

        // Réviseur de portefeuille cabinet. Enregistré INCONDITIONNELLEMENT : le contrôleur porte
        // le drapeau et répond 503 quand il est éteint. Un enregistrement conditionnel ferait
        // échouer la validation du conteneur au démarrage dès qu'un consommateur le référence.
        services.AddScoped<IFirmRevisionService,
            FactuTrust.Infrastructure.Services.FirmRevision.FirmRevisionService>();
        services.AddScoped<FactuTrust.Infrastructure.Services.FirmRevision.IRevisionNoteGenerator,
            FactuTrust.Infrastructure.Services.FirmRevision.RevisionNoteGenerator>();
        services.AddScoped<FactuTrust.Application.Features.AI.IAiNarrativeCompletionService,
            FactuTrust.Application.Features.AI.AiNarrativeCompletionService>();
        services.AddScoped<FactuTrust.Infrastructure.Services.Background.FirmRevisionSweepJob>();
    }
}

/// <summary>
/// Unit of Work implementation.
/// </summary>
/// <remarks>
/// <see cref="BeginTransactionAsync"/> calls <c>Database.BeginTransactionAsync</c> directly. With tenant SQL Server retry enabled,
/// callers must not use these methods unless the work is also wrapped in <c>CreateExecutionStrategy().ExecuteAsync</c>.
/// </remarks>
public sealed class UnitOfWork : IUnitOfWork, IDisposable, IAsyncDisposable
{
    private readonly TenantDbContextFactory _contextFactory;
    private TenantDbContext? _context;
    private bool _disposed;

    public UnitOfWork(TenantDbContextFactory contextFactory)
    {
        _contextFactory = contextFactory;
    }

    // Isolé : ce UnitOfWork legacy ouvre ses propres transactions — il ne doit jamais
    // s'enrôler dans la transaction ambiante de TenantUnitOfWork.
    private TenantDbContext Context => _context ??= _contextFactory.CreateIsolatedContext();

    public async Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        return await Context.SaveChangesAsync(cancellationToken);
    }

    public async Task BeginTransactionAsync(CancellationToken cancellationToken = default)
    {
        await Context.Database.BeginTransactionAsync(cancellationToken);
    }

    public async Task CommitTransactionAsync(CancellationToken cancellationToken = default)
    {
        await Context.Database.CommitTransactionAsync(cancellationToken);
    }

    public async Task RollbackTransactionAsync(CancellationToken cancellationToken = default)
    {
        await Context.Database.RollbackTransactionAsync(cancellationToken);
    }

    public void Dispose()
    {
        if (_disposed) return;

        _context?.Dispose();
        _context = null;
        _disposed = true;
        GC.SuppressFinalize(this);
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;

        if (_context is not null)
        {
            await _context.DisposeAsync();
            _context = null;
        }

        _disposed = true;
        GC.SuppressFinalize(this);
    }
}
