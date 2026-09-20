using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using FactuTrust.Application.Common;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Forecasting;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Common.Interfaces.Treasury;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.AI;
using FactuTrust.Application.Features.AI.DTOs;
using FactuTrust.Application.Features.AI.Tools;
using FactuTrust.Application.Features.Accounting.Queries;
using FactuTrust.Application.Features.Clients.Commands;
using FactuTrust.Application.Features.Clients.Queries;
using FactuTrust.Application.Features.CRM;
using FactuTrust.Application.Features.DeliveryNotes.Queries;
using FactuTrust.Application.Features.Invoices.Commands;
using FactuTrust.Application.Features.Invoices.Queries;
using FactuTrust.Application.Features.ProductCategories.Commands;
using FactuTrust.Application.Features.ProductCategories.Queries;
using FactuTrust.Application.Features.Products.Commands;
using FactuTrust.Application.Features.Products.Queries;
using FactuTrust.Application.Features.PurchaseOrders.Commands;
using FactuTrust.Application.Features.PurchaseOrders.Queries;
using FactuTrust.Application.Features.Quotes.Commands;
using FactuTrust.Application.Features.Quotes.Queries;
using FactuTrust.Application.Features.Reports.Queries;
using FactuTrust.Application.Features.Stock.Commands;
using FactuTrust.Application.Features.Stock.Queries;
using FactuTrust.Application.Features.Suppliers.Commands;
using FactuTrust.Application.Features.Suppliers.Queries;
using FactuTrust.Application.Features.SupplierInvoices.Commands;
using FactuTrust.Application.Features.SupplierInvoices.Queries;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using MediatR;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FactuTrust.Infrastructure.Services.AI;

public sealed partial class AiToolExecutor : IAiToolExecutor
{
    public const string MutationToolsDisabledMessage =
        "Les actions d'écriture via l'assistant sont désactivées pour cet espace.";

    public const string PermissionDeniedMessage = "Action non autorisée pour votre profil.";

    private readonly IMediator _mediator;
    private readonly ILogger<AiToolExecutor> _logger;
    private readonly TimeProvider _timeProvider;
    private readonly ICurrentUser _currentUser;
    private readonly OllamaSettings _ollamaSettings;
    private readonly IAiDeterministicToolCache? _deterministicCache;
    private readonly IAiReadOnlyToolCache? _readOnlyCache;
    // Studio plan-quota service — used by studio_generate_system for a pre-flight table-quota check.
    // Optional (default null) so existing test constructions remain valid; production resolves it via DI.
    private readonly IStudioQuotaService? _studioQuota;
    // Introspection SQL en lecture seule (fenêtres Studio) — même fournisseur gardé que le designer humain.
    private readonly Application.Features.Studio.Common.ISqlSchemaProvider? _sqlSchema;
    // Moteur d'états sur les tables réelles — même moteur que le concepteur d'états humain.
    private readonly Application.Features.Studio.Common.SqlReport.ISqlReportEngine? _sqlReports;
    // Forecasting module — optional. Resolved as singleton if registered (Features:Forecasting:Enabled=true), else null.
    private readonly IForecastingService? _forecasting;
    private readonly IReplenishmentService? _replenishment;
    private readonly IPromotionRecommendationService? _promotions;
    private readonly IAbcXyzClassifier? _abcXyz;
    private readonly ITunisianCalendarService? _calendar;
    private readonly ForecastingOptions _forecastingOptions;
    // Trésorerie prévisionnelle — optionnels, même contrat que le module Prévisions IA.
    private readonly ICashFlowForecastService? _cashFlowForecast;
    private readonly ICashFlowForecastRepository? _cashFlowRepository;
    private readonly TreasuryForecastOptions _treasuryForecastOptions;
    // Outils au périmètre cabinet (agent Chef de mission) — seuls outils multi-dossiers du catalogue.
    // Optionnel (défaut null) pour préserver les constructions existantes des tests.
    private readonly IFirmAgentToolExecutor? _firmAgent;
    // Dépôt des tables Studio — sert UNIQUEMENT à détecter les doublons dans les aperçus de plan
    // (lecture seule). Optionnel (défaut null), même motif que les autres dépendances facultatives.
    private readonly ICustomEntityRepository? _customEntities;

    private static readonly JsonSerializerOptions SerializeOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false
    };

    public AiToolExecutor(
        IMediator mediator,
        ILogger<AiToolExecutor> logger,
        TimeProvider timeProvider,
        ICurrentUser currentUser,
        IOptions<OllamaSettings> ollamaSettings,
        // Forecasting parameters are all optional for backward compatibility with existing tests
        // and with deployments where Features:Forecasting:Enabled = false (services not registered).
        IOptions<ForecastingOptions>? forecastingOptions = null,
        IForecastingService? forecasting = null,
        IReplenishmentService? replenishment = null,
        IPromotionRecommendationService? promotions = null,
        IAbcXyzClassifier? abcXyz = null,
        ITunisianCalendarService? calendar = null,
        IAiDeterministicToolCache? deterministicCache = null,
        IAiReadOnlyToolCache? readOnlyCache = null,
        IStudioQuotaService? studioQuota = null,
        // Introspection SQL en lecture seule — nécessaire aux outils de FENÊTRE (studio_plan_view).
        // Optionnelle (défaut null) pour ne pas casser les constructions existantes des tests.
        Application.Features.Studio.Common.ISqlSchemaProvider? sqlSchema = null,
        // Agent Chef de mission — optionnel : absent, ses outils renvoient une erreur explicite.
        IFirmAgentToolExecutor? firmAgent = null,
        // Trésorerie prévisionnelle — optionnels comme ceux du module Prévisions IA : absents quand
        // TreasuryForecast:Enabled est faux, les outils renvoient alors une erreur explicite.
        IOptions<TreasuryForecastOptions>? treasuryForecastOptions = null,
        ICashFlowForecastService? cashFlowForecast = null,
        ICashFlowForecastRepository? cashFlowRepository = null,
        // Moteur d'états — optionnel comme les autres, pour ne pas casser les constructions de test.
        Application.Features.Studio.Common.SqlReport.ISqlReportEngine? sqlReports = null,
        // Détection de doublons dans les aperçus — optionnelle, même motif.
        ICustomEntityRepository? customEntities = null)
    {
        _customEntities = customEntities;
        _sqlReports = sqlReports;
        _treasuryForecastOptions = treasuryForecastOptions?.Value ?? new TreasuryForecastOptions();
        _cashFlowForecast = cashFlowForecast;
        _cashFlowRepository = cashFlowRepository;
        _firmAgent = firmAgent;
        _sqlSchema = sqlSchema;
        _mediator = mediator;
        _logger = logger;
        _timeProvider = timeProvider;
        _currentUser = currentUser;
        _ollamaSettings = ollamaSettings.Value;
        _forecastingOptions = forecastingOptions?.Value ?? new ForecastingOptions();
        _forecasting = forecasting;
        _replenishment = replenishment;
        _promotions = promotions;
        _abcXyz = abcXyz;
        _calendar = calendar;
        _deterministicCache = deterministicCache;
        _readOnlyCache = readOnlyCache;
        _studioQuota = studioQuota;
    }

    public IReadOnlyList<AiToolDefinition> GetAvailableTools() => AiToolRegistry.All;

    public async Task<AiToolResult> ExecuteAsync(
        string toolName,
        Dictionary<string, object?> arguments,
        AiToolExecutionContext context,
        CancellationToken cancellationToken = default)
    {
        var def = AiToolRegistry.GetToolDefinition(toolName);
        var authError = AuthorizeTool(def);
        if (authError is not null)
            return authError;

        if (def?.IsMutating == true)
            LogMutationStart(toolName, context, arguments);

        // Cache déterministe (whitelist stricte : resolve_reporting_period, get_tunisian_commercial_calendar).
        // Aucun impact pour les autres outils — IsCacheable renvoie false.
        if (_deterministicCache is not null && _deterministicCache.TryGet(toolName, arguments, out var cachedResult))
        {
            _logger.LogDebug("AI tool cache HIT {ToolName}", toolName);
            return cachedResult;
        }

        var tenantCacheKey = _currentUser.TenantId?.ToString() ?? "-";
        if (_readOnlyCache is not null && _readOnlyCache.TryGet(tenantCacheKey, toolName, arguments, out var readOnlyCached))
        {
            _logger.LogDebug("AI read-only tool cache HIT {ToolName}", toolName);
            return readOnlyCached;
        }

        // Outils cabinet : dispatch séparé AVANT le catalogue tenant. Ils ne partagent aucune
        // dépendance avec les autres outils et ne passent jamais par ITenantContext.
        if (FirmAgentTools.Contains(toolName))
        {
            if (_firmAgent is null)
            {
                _logger.LogWarning("Outil cabinet {ToolName} appelé sans exécuteur enregistré", toolName);
                return AiToolResult.Error("L'agent Chef de mission n'est pas disponible dans cet espace.");
            }

            // Lot 3.3 — cache inter-requêtes des outils firm (réservé FirmManager, clé user-scopée
            // TenantId:UserId:Role). TryGet AVANT le dispatch ; Set APRÈS succès. L'ancien early-return
            // (return direct) sautait le Set — corrigé ici. FirmAccountant : IsCacheable renvoie false
            // (scope filtré) ⇒ TryGet sans hit et Set no-op (jamais de cache inter-requêtes, par décision 3.3).
            // send_fiscal_deadline_reminder n'est pas un outil firm read-only ⇒ jamais caché.
            if (_readOnlyCache is not null && _currentUser.TryGetAccessScope(out var firmScope))
            {
                if (_readOnlyCache.TryGet(tenantCacheKey, toolName, arguments, out var firmCached, firmScope))
                {
                    _logger.LogDebug("AI read-only tool cache HIT {ToolName}", toolName);
                    return firmCached;
                }

                var firmResult = await _firmAgent.ExecuteAsync(toolName, arguments, context, cancellationToken);
                if (firmResult.Success)
                    _readOnlyCache.Set(tenantCacheKey, toolName, arguments, firmResult, firmScope);
                return firmResult;
            }

            return await _firmAgent.ExecuteAsync(toolName, arguments, context, cancellationToken);
        }

        try
        {
            var result = toolName switch
            {
                "resolve_reporting_period" => HandleReportingPeriod(arguments),
                "get_sales_revenue" => await HandleSalesRevenue(arguments, cancellationToken),
                "get_client_payments" => await HandleClientPayments(arguments, cancellationToken),
                "get_client_balances" => await HandleClientBalances(arguments, cancellationToken),
                "get_commercial_profit" => await HandleCommercialProfit(arguments, cancellationToken),
                "get_stock_snapshot" => await HandleStockSnapshot(arguments, cancellationToken),
                "get_product_performance" => await HandleProductPerformance(arguments, cancellationToken),
                "get_basket_metrics" => await HandleBasketMetrics(arguments, cancellationToken),
                "get_accounting_dashboard" => await HandleAccountingDashboard(cancellationToken),
                "get_client_aging" => await HandleClientAging(cancellationToken),
                "get_product_sales_trend" => await HandleProductSalesTrend(arguments, cancellationToken),
                "get_supplier_balances" => await HandleSupplierBalances(cancellationToken),
                "get_products_never_sold" => await HandleProductsNeverSold(arguments, cancellationToken),
                "get_stock_movements" => await HandleStockMovements(arguments, cancellationToken),
                "generate_dashboard_config" => HandleDashboardConfig(arguments),
                "propose_follow_up_prompts" => HandleProposeFollowUpPrompts(arguments),
                "propose_client_actions" => HandleProposeClientActions(arguments),
                "compliance_check_invoice" => await HandleComplianceCheckInvoice(arguments, cancellationToken),
                "get_product_by_id" => await HandleGetProductById(arguments, cancellationToken),
                "create_product" => await HandleCreateProduct(arguments, cancellationToken),
                "update_product" => await HandleUpdateProduct(arguments, cancellationToken),
                "delete_product" => await HandleDeleteProduct(arguments, cancellationToken),
                "accept_quote" => await HandleAcceptQuote(arguments, cancellationToken),
                "reject_quote" => await HandleRejectQuote(arguments, cancellationToken),
                "send_quote" => await HandleSendQuote(arguments, cancellationToken),
                "record_invoice_payment" => await HandleRecordInvoicePayment(arguments, cancellationToken),
                // ── Catégories ──
                "get_product_categories" => await HandleGetProductCategories(cancellationToken),
                "create_product_category" => await HandleCreateProductCategory(arguments, cancellationToken),
                "update_product_category" => await HandleUpdateProductCategory(arguments, cancellationToken),
                // ── Clients ──
                "search_clients" => await HandleSearchClients(arguments, cancellationToken),
                "get_client_by_id" => await HandleGetClientById(arguments, cancellationToken),
                "create_client" => await HandleCreateClient(arguments, cancellationToken),
                "update_client" => await HandleUpdateClient(arguments, cancellationToken),
                "delete_client" => await HandleDeleteClient(arguments, cancellationToken),
                // ── Fournisseurs ──
                "search_suppliers" => await HandleSearchSuppliers(arguments, cancellationToken),
                "get_supplier_by_id" => await HandleGetSupplierById(arguments, cancellationToken),
                "create_supplier" => await HandleCreateSupplier(arguments, cancellationToken),
                "update_supplier" => await HandleUpdateSupplier(arguments, cancellationToken),
                "delete_supplier" => await HandleDeleteSupplier(arguments, cancellationToken),
                // ── Factures de vente ──
                "search_invoices" => await HandleSearchInvoices(arguments, cancellationToken),
                "get_invoice_by_id" => await HandleGetInvoiceById(arguments, cancellationToken),
                "validate_invoice" => await HandleValidateInvoice(arguments, cancellationToken),
                "sign_invoice" => await HandleSignInvoice(arguments, cancellationToken),
                "send_invoice_email" => await HandleSendInvoiceEmail(arguments, cancellationToken),
                // ── Devis ──
                "search_quotes" => await HandleSearchQuotes(arguments, cancellationToken),
                "get_quote_by_id" => await HandleGetQuoteById(arguments, cancellationToken),
                // ── Bons de livraison ──
                "search_delivery_notes" => await HandleSearchDeliveryNotes(arguments, cancellationToken),
                "get_delivery_note_by_id" => await HandleGetDeliveryNoteById(arguments, cancellationToken),
                // ── Commandes fournisseurs ──
                "search_purchase_orders" => await HandleSearchPurchaseOrders(arguments, cancellationToken),
                "get_purchase_order_by_id" => await HandleGetPurchaseOrderById(arguments, cancellationToken),
                "confirm_purchase_order" => await HandleConfirmPurchaseOrder(arguments, cancellationToken),
                "cancel_purchase_order" => await HandleCancelPurchaseOrder(arguments, cancellationToken),
                // ── Factures fournisseurs ──
                "search_supplier_invoices" => await HandleSearchSupplierInvoices(arguments, cancellationToken),
                "get_supplier_invoice_by_id" => await HandleGetSupplierInvoiceById(arguments, cancellationToken),
                "record_supplier_payment" => await HandleRecordSupplierPayment(arguments, cancellationToken),
                "cancel_supplier_invoice" => await HandleCancelSupplierInvoice(arguments, cancellationToken),
                // ── Stock & Entrepôts ──
                "get_warehouses" => await HandleGetWarehouses(cancellationToken),
                "create_warehouse" => await HandleCreateWarehouse(arguments, cancellationToken),
                "record_stock_entry" => await HandleRecordStockEntry(arguments, cancellationToken),
                "record_stock_exit" => await HandleRecordStockExit(arguments, cancellationToken),
                "adjust_stock" => await HandleAdjustStock(arguments, cancellationToken),
                // ── CRM ──
                "search_crm_activities" => await HandleSearchCrmActivities(arguments, cancellationToken),
                "search_crm_opportunities" => await HandleSearchCrmOpportunities(arguments, cancellationToken),
                "create_crm_activity" => await HandleCreateCrmActivity(arguments, cancellationToken),
                "create_crm_opportunity" => await HandleCreateCrmOpportunity(arguments, cancellationToken),
                // ── AI Forecasting ──
                "forecast_revenue" => await HandleForecastRevenue(arguments, cancellationToken),
                "get_cash_flow_forecast" => await HandleGetCashFlowForecast(arguments, cancellationToken),
                "get_cash_flow_lines" => await HandleGetCashFlowLines(arguments, cancellationToken),
                "forecast_product_demand" => await HandleForecastProductDemand(arguments, cancellationToken),
                "get_replenishment_recommendations" => await HandleGetReplenishment(arguments, cancellationToken),
                "get_promotion_recommendations" => await HandleGetPromotions(arguments, cancellationToken),
                "get_abc_xyz_classification" => await HandleGetAbcXyz(arguments, cancellationToken),
                "get_tunisian_commercial_calendar" => HandleGetTunisianCalendar(arguments),
                "analyze_seasonal_impact" => await HandleAnalyzeSeasonalImpact(arguments, cancellationToken),
                "simulate_promotion_impact" => await HandleSimulatePromotionImpact(arguments, cancellationToken),
                "prepare_purchase_order_from_replenishment" => await HandlePreparePurchaseOrderFromReplenishment(arguments, cancellationToken),
                "prepare_promotion_application" => await HandlePreparePromotionApplication(arguments, cancellationToken),
                // ── Studio IA-native ──
                "studio_generate_app" => await HandleStudioGenerateApp(arguments, cancellationToken),
                "studio_generate_system" => await HandleStudioGenerateSystem(arguments, cancellationToken),
                // ── Studio plan → aperçu → confirmation ──
                "studio_plan_app" => await HandleStudioPlanApp(arguments, cancellationToken),
                "studio_plan_system" => await HandleStudioPlanSystem(arguments, cancellationToken),
                "studio_plan_changes" => await HandleStudioPlanChanges(arguments, cancellationToken),
                "studio_get_table_schema" => await HandleStudioGetTableSchema(arguments, cancellationToken),
                "studio_plan_view" => await HandleStudioPlanView(arguments, cancellationToken),
                "studio_plan_record_view" => await HandleStudioPlanRecordView(arguments, cancellationToken),
                "studio_plan_workflow" => await HandleStudioPlanWorkflow(arguments, cancellationToken),
                "studio_list_sql_tables" => await HandleStudioListSqlTables(arguments, cancellationToken),
                // ── Studio : états sur les tables réelles ──
                "studio_list_report_sources" => await HandleStudioListReportSources(arguments, cancellationToken),
                "studio_describe_report_source" => await HandleStudioDescribeReportSource(arguments, cancellationToken),
                "studio_run_report" => await HandleStudioRunReport(arguments, cancellationToken),
                "studio_plan_report" => await HandleStudioPlanReport(arguments, cancellationToken),
                // ── Studio ERP bridge actions ──
                "generate_invoice" => await HandleGenerateInvoice(arguments, cancellationToken),
                "create_cash_expense" => await HandleCreateCashExpense(arguments, cancellationToken),
                _ => AiToolResult.Error($"Outil inconnu : {toolName}")
            };

            // Met en cache uniquement les résultats positifs des outils déterministes / read-only.
            _deterministicCache?.Set(toolName, arguments, result);
            if (result.Success)
                _readOnlyCache?.Set(tenantCacheKey, toolName, arguments, result);
            return result;
        }
        catch (Exception ex)
        {
            // Le message d'une exception technique (SQL Server en tête) expose le schéma et parfois
            // la requête, et finit affiché tel quel dans la conversation. Le détail reste au
            // journal ; l'utilisateur reçoit une phrase qui ne prétend pas être une explication.
            // Les erreurs MÉTIER, elles, ne passent pas par ici : les gestionnaires renvoient leurs
            // propres AiToolResult.Error, qui atteignent l'utilisateur mot pour mot.
            _logger.LogError(ex, "Tool execution error for {ToolName}", toolName);
            return AiToolResult.Error("L'outil n'a pas pu aboutir. Reformulez votre demande, ou signalez l'incident si elle se reproduit.");
        }
    }

    private AiToolResult? AuthorizeTool(AiToolDefinition? def)
    {
        if (def is not null && def.Name.StartsWith("studio_", StringComparison.Ordinal) && !_ollamaSettings.EnableStudioAiTools)
            return AiToolResult.Error("Les outils Studio IA sont désactivés pour cet espace.");

        if (def?.IsMutating == true && !_ollamaSettings.EnableMutationTools)
            return AiToolResult.Error(MutationToolsDisabledMessage);

        if (!string.IsNullOrEmpty(def?.RequiredPermission) && !_currentUser.HasPermission(def.RequiredPermission))
            return AiToolResult.Error(PermissionDeniedMessage);

        return null;
    }

    private void LogMutationStart(string toolName, AiToolExecutionContext context, Dictionary<string, object?> arguments)
    {
        _logger.LogInformation(
            "AI mutation tool {ToolName} user={UserId} tenant={TenantId} correlation={CorrelationId} conversation={ConversationId} argsKeys={ArgsKeys}",
            toolName,
            _currentUser.UserId,
            _currentUser.TenantId,
            context.CorrelationId ?? "-",
            context.ConversationId,
            string.Join(',', arguments.Keys.Order(StringComparer.Ordinal)));
    }

    private AiToolResult HandleReportingPeriod(Dictionary<string, object?> args)
    {
        var preset = GetStringArg(args, "preset");
        try
        {
            var r = ReportingPeriodResolver.Resolve(preset, _timeProvider);
            var payload = new
            {
                fromDate = r.FromDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                toDate = r.ToDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                label = r.Label
            };
            return AiToolResult.Ok(Serialize(payload));
        }
        catch (ArgumentException ex)
        {
            return AiToolResult.Error(ex.Message);
        }
    }

    private async Task<AiToolResult> HandleSalesRevenue(Dictionary<string, object?> args, CancellationToken ct)
    {
        var (from, to) = ResolveFromToDatesOrDefault(args);
        var groupBy = ParseEnumStrict(args, "group_by", SalesRevenueGroupBy.Product, out var gbErr);
        if (gbErr is not null)
            return AiToolResult.Error(gbErr);

        var result = await _mediator.Send(new GetSalesRevenueByProductReportQuery(from, to, groupBy), ct);
        if (!result.IsSuccess)
            return AiToolResult.Error(result.Error.Description);

        // Enveloppe avec total DÉTERMINISTE : le petit modèle ne sait pas additionner de façon fiable
        // (il prend souvent la 1re ligne — la plus grosse — pour le total). On lui fournit le CA total déjà
        // calculé. IMPORTANT : la somme porte sur le jeu COMPLET (result.Value), pas sur les lignes bornées
        // par top_n, sinon le total ne refléterait que les lignes affichées.
        var allRows = result.Value;
        var totalRevenue = allRows.Sum(r => r.Revenue);
        var currency = allRows.Select(r => r.Currency).FirstOrDefault(c => !string.IsNullOrWhiteSpace(c)) ?? "TND";
        var rows = ApplyRankingLimit(allRows, args, r => r.Revenue);
        return AiToolResult.Ok(Serialize(new
        {
            totalRevenue,
            rowCount = allRows.Count,
            currency,
            groupBy = groupBy.ToString(),
            // Période réellement interrogée : permet au modèle (et au repli déterministe) de CITER la
            // période — indispensable pour un résultat vide (« Aucune vente du X au Y »).
            period = new
            {
                from = from.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                to = to.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
            },
            rows
        }));
    }

    private async Task<AiToolResult> HandleClientPayments(Dictionary<string, object?> args, CancellationToken ct)
    {
        var (from, to) = ResolveFromToDatesOrDefault(args);

        var result = await _mediator.Send(new GetClientPaymentsReportQuery(from, to), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(result.Value))
            : AiToolResult.Error(result.Error.Description);
    }

    private async Task<AiToolResult> HandleClientBalances(Dictionary<string, object?> args, CancellationToken ct)
    {
        var result = await _mediator.Send(new GetClientBalancesReportQuery(), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(ApplyRankingLimit(result.Value, args, r => r.Balance)))
            : AiToolResult.Error(result.Error.Description);
    }

    private async Task<AiToolResult> HandleCommercialProfit(Dictionary<string, object?> args, CancellationToken ct)
    {
        var (from, to) = ResolveFromToDatesOrDefault(args);
        var groupBy = ParseEnumStrict(args, "group_by", CommercialProfitGroupBy.Product, out var gbErr);
        if (gbErr is not null)
            return AiToolResult.Error(gbErr);

        var result = await _mediator.Send(new GetCommercialProfitReportQuery(from, to, groupBy), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(result.Value))
            : AiToolResult.Error(result.Error.Description);
    }

    private async Task<AiToolResult> HandleStockSnapshot(Dictionary<string, object?> args, CancellationToken ct)
    {
        // Tolérant : date absente / invalide → aujourd'hui ; date future → aujourd'hui. Évite l'échec de l'outil
        // (et la fuite d'erreur/nom d'outil) quand le modèle omet ou hallucine la date.
        var asOf = AiSnapshotDateResolver.Resolve(
            GetStringArg(args, "as_of_date"),
            ReportingPeriodResolver.GetTodayInTunisia(_timeProvider));
        var warehouseId = ParseGuidOrNull(args, "warehouse_id");

        var result = await _mediator.Send(new GetStockSnapshotAtDateQuery(asOf, warehouseId), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(result.Value))
            : AiToolResult.Error(result.Error.Description);
    }

    private async Task<AiToolResult> HandleProductPerformance(Dictionary<string, object?> args, CancellationToken ct)
    {
        var (from, to) = ResolveFromToDatesOrDefault(args);

        var result = await _mediator.Send(new GetProductPerformanceReportQuery(from, to), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(ApplyRankingLimit(result.Value, args, r => r.Revenue)))
            : AiToolResult.Error(result.Error.Description);
    }

    private async Task<AiToolResult> HandleBasketMetrics(Dictionary<string, object?> args, CancellationToken ct)
    {
        var (from, to) = ResolveFromToDatesOrDefault(args);

        var result = await _mediator.Send(new GetBasketMetricsReportQuery(from, to), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(result.Value))
            : AiToolResult.Error(result.Error.Description);
    }

    private async Task<AiToolResult> HandleAccountingDashboard(CancellationToken ct)
    {
        var result = await _mediator.Send(new GetAccountingDashboardQuery(), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(result.Value))
            : AiToolResult.Error(result.Error.Description);
    }

    private async Task<AiToolResult> HandleClientAging(CancellationToken ct)
    {
        var result = await _mediator.Send(new GetClientAgingReportQuery(), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(result.Value))
            : AiToolResult.Error(result.Error.Description);
    }

    private async Task<AiToolResult> HandleProductSalesTrend(Dictionary<string, object?> args, CancellationToken ct)
    {
        var (from, to) = ResolveFromToDatesOrDefault(args);

        var result = await _mediator.Send(new GetProductSalesTrendReportQuery(from, to), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(result.Value))
            : AiToolResult.Error(result.Error.Description);
    }

    private async Task<AiToolResult> HandleSupplierBalances(CancellationToken ct)
    {
        var result = await _mediator.Send(new GetSupplierBalancesReportQuery(), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(result.Value))
            : AiToolResult.Error(result.Error.Description);
    }

    private async Task<AiToolResult> HandleProductsNeverSold(Dictionary<string, object?> args, CancellationToken ct)
    {
        var (from, to) = ResolveFromToDatesOrDefault(args);

        var result = await _mediator.Send(new GetProductsNeverSoldReportQuery(from, to), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(result.Value))
            : AiToolResult.Error(result.Error.Description);
    }

    private async Task<AiToolResult> HandleStockMovements(Dictionary<string, object?> args, CancellationToken ct)
    {
        var warehouseId = ParseGuidOrNull(args, "warehouse_id");
        DateTime? from = args.ContainsKey("from_date") ? ParseDate(args, "from_date") : null;
        DateTime? to = args.ContainsKey("to_date") ? ParseDate(args, "to_date") : null;

        var (items, totalCount) = await _mediator.Send(
            new GetStockMovementsReportQuery(warehouseId, from, to, 1, 50), ct);

        return AiToolResult.Ok(Serialize(new { items, totalCount }));
    }

    private AiToolResult HandleDashboardConfig(Dictionary<string, object?> args)
    {
        var title = GetStringArg(args, "title");
        var sectionsJson = GetStringArg(args, "sections_json");
        if (string.IsNullOrWhiteSpace(title))
            return AiToolResult.Error("title requis.");

        JsonNode? sectionsNode;
        try
        {
            sectionsNode = JsonNode.Parse(sectionsJson);
        }
        catch (JsonException ex)
        {
            return AiToolResult.Error($"sections_json invalide : {ex.Message}");
        }

        try
        {
            var clean = DashboardConfigSanitizer.SanitizeSections(title, sectionsNode!, _logger);
            return AiToolResult.Ok(JsonSerializer.Serialize(clean, SerializeOptions));
        }
        catch (ArgumentException ex)
        {
            return AiToolResult.Error(ex.Message);
        }
    }

    private static AiToolResult HandleProposeFollowUpPrompts(Dictionary<string, object?> args)
    {
        var json = GetStringArg(args, "prompts_json");
        return FollowUpPromptSanitizer.SanitizePromptsJson(json);
    }

    private static AiToolResult HandleProposeClientActions(Dictionary<string, object?> args)
    {
        var json = GetStringArg(args, "actions_json");
        return ClientActionSanitizer.SanitizeActionsJson(json);
    }

    /// <summary>Pattern d'un numéro de facture (ex. FAC-2026-000123) pour la résolution sans identifiant.</summary>
    private static readonly Regex InvoiceNumberPattern = new(
        @"\b[A-Za-z]{2,5}-\d{4}-\d{3,}\b",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private async Task<AiToolResult> HandleComplianceCheckInvoice(Dictionary<string, object?> args, CancellationToken ct)
    {
        // Résolution en cascade : identifiant exact → numéro (invoice_number, ou invoice_id non-GUID
        // qui ressemble à un numéro) → facture la plus récente (SearchAsync trie par CreatedAt DESC).
        // Le petit modèle ne connaît jamais d'identifiant interne : « ma dernière facture » doit marcher.
        var idStr = OptionalString(args, "invoice_id");
        var numberStr = OptionalString(args, "invoice_number");
        Guid invoiceId;
        string resolvedBy;
        if (idStr is not null && Guid.TryParse(idStr, out invoiceId))
        {
            resolvedBy = "id";
        }
        else
        {
            var candidate = numberStr ?? (idStr is not null && InvoiceNumberPattern.IsMatch(idStr)
                ? InvoiceNumberPattern.Match(idStr).Value
                : null);
            candidate = candidate?.Trim().ToUpperInvariant();
            var page = await _mediator.Send(
                new GetInvoicesQuery(SearchTerm: candidate, PageSize: 1), ct);
            if (page.Items.Count == 0)
            {
                return AiToolResult.Error(candidate is null
                    ? "Aucune facture trouvée pour cette entreprise."
                    : $"Aucune facture trouvée pour le numéro « {candidate} ».");
            }
            invoiceId = page.Items[0].Id;
            resolvedBy = candidate is null ? "latest" : "number";
        }

        var result = await _mediator.Send(new GetInvoiceByIdQuery(invoiceId), ct);
        if (!result.IsSuccess)
            return AiToolResult.Error(result.Error.Description);

        var inv = result.Value;
        var findings = new List<object>();
        var overall = "ok";

        void Add(string code, string sev, string message)
        {
            findings.Add(new { code, severity = sev, message });
            if (sev == "blocking")
                overall = "blocking";
            else if (sev == "warning" && overall != "blocking")
                overall = "warning";
        }

        if (string.IsNullOrWhiteSpace(inv.Client.Nif))
            Add("client_nif_missing", "warning", "NIF client absent — vérifier les exigences de facturation.");

        if (inv.Lines.Count == 0)
            Add("no_lines", "blocking", "Aucune ligne article sur la facture.");

        var sumLinesHt = inv.Lines.Sum(l => l.SubTotal);
        if (inv.Lines.Count > 0 && Math.Abs(sumLinesHt - inv.SubTotal) > 0.02m)
            Add("subtotal_mismatch", "warning", "Écart entre la somme des lignes HT et le sous-total d'en-tête.");

        if (inv.Status == InvoiceStatus.Draft)
            Add("draft_status", "ok", "Facture en brouillon — non envoyée au client.");

        if (string.IsNullOrEmpty(inv.SignatureHash) && inv.Status != InvoiceStatus.Draft)
            Add("unsigned", "warning", "Facture sans empreinte de signature enregistrée.");

        var payload = new
        {
            invoiceId = inv.Id,
            inv.Number,
            // "id" | "number" | "latest" — permet au modèle de dire « votre facture la plus récente (FAC-…) ».
            resolvedBy,
            status = inv.Status.ToString(),
            statusDisplay = inv.StatusDisplay,
            overallSeverity = overall,
            findings,
            totals = new
            {
                inv.SubTotal,
                inv.TotalVat,
                inv.TotalAmount,
                lineCount = inv.Lines.Count
            }
        };

        return AiToolResult.Ok(Serialize(payload));
    }

    private async Task<AiToolResult> HandleGetProductById(Dictionary<string, object?> args, CancellationToken ct)
    {
        var idStr = GetStringArg(args, "product_id");
        if (!Guid.TryParse(idStr, out var id))
            return AiToolResult.Error("product_id doit être un GUID valide.");

        var result = await _mediator.Send(new GetProductByIdQuery(id), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(result.Value))
            : AiToolResult.Error(result.Error.Description);
    }

    private async Task<AiToolResult> HandleCreateProduct(Dictionary<string, object?> args, CancellationToken ct)
    {
        VatRate vatEnum;
        try
        {
            vatEnum = VatRateExtensions.FromPercent(ParseIntArg(args, "vat_rate_percent"));
        }
        catch (ArgumentException ex)
        {
            return AiToolResult.Error(ex.Message);
        }

        var dto = new CreateProductDto
        {
            Code = GetStringArg(args, "code"),
            Name = GetStringArg(args, "name"),
            Type = ParseProductType(args),
            UnitPrice = ParseDecimalArg(args, "unit_price"),
            PurchasePrice = TryParseDecimalArg(args, "purchase_price"),
            VatRate = vatEnum,
            Description = OptionalString(args, "description"),
            Unit = OptionalString(args, "unit"),
            IsStockManaged = TryParseBoolArg(args, "is_stock_managed"),
            CategoryId = ParseGuidOrNull(args, "category_id")
        };

        var result = await _mediator.Send(new CreateProductCommand(dto), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(new { productId = result.Value, message = "Produit créé." }))
            : AiToolResult.Error(result.Error.Description);
    }

    private async Task<AiToolResult> HandleUpdateProduct(Dictionary<string, object?> args, CancellationToken ct)
    {
        var idStr = GetStringArg(args, "product_id");
        if (!Guid.TryParse(idStr, out var id))
            return AiToolResult.Error("product_id doit être un GUID valide.");

        var existing = await _mediator.Send(new GetProductByIdQuery(id), ct);
        if (!existing.IsSuccess)
            return AiToolResult.Error(existing.Error.Description);

        var cur = existing.Value;

        VatRate vatEnum;
        try
        {
            vatEnum = VatRateExtensions.FromPercent(ParseIntArg(args, "vat_rate_percent"));
        }
        catch (ArgumentException ex)
        {
            return AiToolResult.Error(ex.Message);
        }

        var dto = new UpdateProductDto
        {
            Name = GetStringArg(args, "name"),
            UnitPrice = ParseDecimalArg(args, "unit_price"),
            VatRate = vatEnum,
            Description = ArgProvided(args, "description") ? OptionalString(args, "description") : cur.Description,
            PurchasePrice = ArgProvided(args, "purchase_price")
                ? TryParseDecimalArg(args, "purchase_price")
                : cur.PurchasePrice,
            Unit = ArgProvided(args, "unit") ? OptionalString(args, "unit") : cur.Unit,
            IsStockManaged = ArgProvided(args, "is_stock_managed")
                ? TryParseBoolArg(args, "is_stock_managed")
                : cur.IsStockManaged,
            CategoryId = ArgProvided(args, "category_id") ? ParseGuidOrNull(args, "category_id") : cur.CategoryId
        };

        var result = await _mediator.Send(new UpdateProductCommand(id, dto), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(result.Value))
            : AiToolResult.Error(result.Error.Description);
    }

    private async Task<AiToolResult> HandleDeleteProduct(Dictionary<string, object?> args, CancellationToken ct)
    {
        var idStr = GetStringArg(args, "product_id");
        if (!Guid.TryParse(idStr, out var id))
            return AiToolResult.Error("product_id doit être un GUID valide.");

        var result = await _mediator.Send(new DeleteProductCommand(id), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(new { ok = true, message = "Produit supprimé." }))
            : AiToolResult.Error(result.Error.Description);
    }

    private async Task<AiToolResult> HandleAcceptQuote(Dictionary<string, object?> args, CancellationToken ct)
    {
        if (!Guid.TryParse(GetStringArg(args, "quote_id"), out var id))
            return AiToolResult.Error("quote_id doit être un GUID valide.");

        var result = await _mediator.Send(new AcceptQuoteCommand(id), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(new { ok = true, message = "Devis accepté." }))
            : AiToolResult.Error(result.Error.Description);
    }

    private async Task<AiToolResult> HandleRejectQuote(Dictionary<string, object?> args, CancellationToken ct)
    {
        if (!Guid.TryParse(GetStringArg(args, "quote_id"), out var id))
            return AiToolResult.Error("quote_id doit être un GUID valide.");

        var reason = OptionalString(args, "reason");
        var result = await _mediator.Send(new RejectQuoteCommand(id, reason), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(new { ok = true, message = "Devis rejeté." }))
            : AiToolResult.Error(result.Error.Description);
    }

    private async Task<AiToolResult> HandleSendQuote(Dictionary<string, object?> args, CancellationToken ct)
    {
        if (!Guid.TryParse(GetStringArg(args, "quote_id"), out var id))
            return AiToolResult.Error("quote_id doit être un GUID valide.");

        var result = await _mediator.Send(new SendQuoteCommand(id), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(new { ok = true, message = "Devis envoyé." }))
            : AiToolResult.Error(result.Error.Description);
    }

    private async Task<AiToolResult> HandleRecordInvoicePayment(Dictionary<string, object?> args, CancellationToken ct)
    {
        if (!Guid.TryParse(GetStringArg(args, "invoice_id"), out var invoiceId))
            return AiToolResult.Error("invoice_id doit être un GUID valide.");

        DateTime paymentDate;
        try
        {
            paymentDate = ParseDate(args, "payment_date");
        }
        catch
        {
            return AiToolResult.Error("payment_date invalide (yyyy-MM-dd).");
        }

        PaymentMethod? method = null;
        if (ArgProvided(args, "method"))
        {
            var m = GetStringArg(args, "method");
            if (!Enum.TryParse<PaymentMethod>(m, ignoreCase: true, out var parsed))
                return AiToolResult.Error("method invalide (Cash, BankTransfer, Check, Card, MobilePayment, Other).");
            method = parsed;
        }

        var request = new RecordInvoicePaymentRequest
        {
            PaymentDate = paymentDate,
            Amount = TryParseDecimalArg(args, "amount"),
            Method = method,
            Reference = OptionalString(args, "reference"),
            Notes = OptionalString(args, "notes"),
            ClientWithholdingAmount = TryParseDecimalArg(args, "client_withholding_amount")
        };

        var result = await _mediator.Send(new RecordInvoicePaymentCommand(invoiceId, request), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(new { ok = true, message = "Paiement enregistré." }))
            : AiToolResult.Error(result.Error.Description);
    }

    // ════════════════════════════════════════════════════════════════════
    // ────────── Catégories de produits ──────────
    // ════════════════════════════════════════════════════════════════════

    private async Task<AiToolResult> HandleGetProductCategories(CancellationToken ct)
    {
        var result = await _mediator.Send(new GetProductCategoriesListQuery(), ct);
        return AiToolResult.Ok(Serialize(result));
    }

    private async Task<AiToolResult> HandleCreateProductCategory(Dictionary<string, object?> args, CancellationToken ct)
    {
        var dto = new CreateProductCategoryDto
        {
            Code = GetStringArg(args, "code"),
            Name = GetStringArg(args, "name"),
            DisplayOrder = ArgProvided(args, "display_order") ? ParseIntArg(args, "display_order") : 0
        };
        var result = await _mediator.Send(new CreateProductCategoryCommand(dto), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(new { categoryId = result.Value, message = "Catégorie créée." }))
            : AiToolResult.Error(result.Error.Description);
    }

    private async Task<AiToolResult> HandleUpdateProductCategory(Dictionary<string, object?> args, CancellationToken ct)
    {
        if (!Guid.TryParse(GetStringArg(args, "category_id"), out var id))
            return AiToolResult.Error("category_id doit être un GUID valide.");

        var dto = new UpdateProductCategoryDto
        {
            Name = GetStringArg(args, "name"),
            DisplayOrder = ArgProvided(args, "display_order") ? ParseIntArg(args, "display_order") : 0,
            IsActive = TryParseBoolArg(args, "is_active") ?? true
        };
        var result = await _mediator.Send(new UpdateProductCategoryCommand(id, dto), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(new { ok = true, message = "Catégorie mise à jour." }))
            : AiToolResult.Error(result.Error.Description);
    }

    // ════════════════════════════════════════════════════════════════════
    // ────────── Clients ──────────
    // ════════════════════════════════════════════════════════════════════

    private async Task<AiToolResult> HandleSearchClients(Dictionary<string, object?> args, CancellationToken ct)
    {
        var page = ArgProvided(args, "page") ? ParseIntArg(args, "page") : 1;
        var pageSize = Math.Min(ArgProvided(args, "page_size") ? ParseIntArg(args, "page_size") : 20, 50);
        var isActive = TryParseBoolArg(args, "is_active");

        var result = await _mediator.Send(new GetClientsQuery(
            Search: OptionalString(args, "search"),
            IsActive: isActive,
            Page: page,
            PageSize: pageSize), ct);
        return AiToolResult.Ok(Serialize(result));
    }

    private async Task<AiToolResult> HandleGetClientById(Dictionary<string, object?> args, CancellationToken ct)
    {
        if (!Guid.TryParse(GetStringArg(args, "client_id"), out var id))
            return AiToolResult.Error("client_id doit être un GUID valide.");

        var result = await _mediator.Send(new GetClientByIdQuery(id), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(result.Value))
            : AiToolResult.Error(result.Error.Description);
    }

    private async Task<AiToolResult> HandleCreateClient(Dictionary<string, object?> args, CancellationToken ct)
    {
        var typeStr = OptionalString(args, "type");
        var clientType = Enum.TryParse<ClientType>(typeStr, ignoreCase: true, out var t) ? t : ClientType.Individual;

        var dto = new CreateClientDto
        {
            Name = GetStringArg(args, "name"),
            Type = clientType,
            Nif = OptionalString(args, "nif"),
            Email = GetStringArg(args, "email"),
            Street = GetStringArg(args, "street"),
            City = GetStringArg(args, "city"),
            Governorate = GetStringArg(args, "governorate"),
            Phone = OptionalString(args, "phone"),
            ContactPerson = OptionalString(args, "contact_person"),
            Notes = OptionalString(args, "notes")
        };

        var result = await _mediator.Send(new CreateClientCommand(dto), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(new { clientId = result.Value, message = "Client créé." }))
            : AiToolResult.Error(result.Error.Description);
    }

    private async Task<AiToolResult> HandleUpdateClient(Dictionary<string, object?> args, CancellationToken ct)
    {
        if (!Guid.TryParse(GetStringArg(args, "client_id"), out var id))
            return AiToolResult.Error("client_id doit être un GUID valide.");

        var dto = new UpdateClientDto
        {
            Name = GetStringArg(args, "name"),
            Email = GetStringArg(args, "email"),
            Street = GetStringArg(args, "street"),
            City = GetStringArg(args, "city"),
            Governorate = GetStringArg(args, "governorate"),
            Phone = OptionalString(args, "phone"),
            ContactPerson = OptionalString(args, "contact_person"),
            Notes = OptionalString(args, "notes"),
            IsActive = TryParseBoolArg(args, "is_active") ?? true
        };

        var result = await _mediator.Send(new UpdateClientCommand(id, dto), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(new { ok = true, message = "Client mis à jour." }))
            : AiToolResult.Error(result.Error.Description);
    }

    private async Task<AiToolResult> HandleDeleteClient(Dictionary<string, object?> args, CancellationToken ct)
    {
        if (!Guid.TryParse(GetStringArg(args, "client_id"), out var id))
            return AiToolResult.Error("client_id doit être un GUID valide.");

        var result = await _mediator.Send(new DeleteClientCommand(id), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(new { ok = true, message = "Client supprimé." }))
            : AiToolResult.Error(result.Error.Description);
    }

    // ════════════════════════════════════════════════════════════════════
    // ────────── Fournisseurs ──────────
    // ════════════════════════════════════════════════════════════════════

    private async Task<AiToolResult> HandleSearchSuppliers(Dictionary<string, object?> args, CancellationToken ct)
    {
        var page = ArgProvided(args, "page") ? ParseIntArg(args, "page") : 1;
        var pageSize = Math.Min(ArgProvided(args, "page_size") ? ParseIntArg(args, "page_size") : 20, 50);

        var result = await _mediator.Send(new GetSuppliersQuery(
            Search: OptionalString(args, "search"),
            IsActive: TryParseBoolArg(args, "is_active"),
            Page: page,
            PageSize: pageSize), ct);
        return AiToolResult.Ok(Serialize(result));
    }

    private async Task<AiToolResult> HandleGetSupplierById(Dictionary<string, object?> args, CancellationToken ct)
    {
        if (!Guid.TryParse(GetStringArg(args, "supplier_id"), out var id))
            return AiToolResult.Error("supplier_id doit être un GUID valide.");

        var result = await _mediator.Send(new GetSupplierByIdQuery(id), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(result.Value))
            : AiToolResult.Error(result.Error.Description);
    }

    private async Task<AiToolResult> HandleCreateSupplier(Dictionary<string, object?> args, CancellationToken ct)
    {
        var dto = new CreateSupplierDto
        {
            Name = GetStringArg(args, "name"),
            Email = GetStringArg(args, "email"),
            Street = GetStringArg(args, "street"),
            City = GetStringArg(args, "city"),
            Governorate = GetStringArg(args, "governorate"),
            Nif = OptionalString(args, "nif"),
            Phone = OptionalString(args, "phone"),
            ContactPerson = OptionalString(args, "contact_person"),
            PaymentTermDays = ArgProvided(args, "payment_term_days") ? ParseIntArg(args, "payment_term_days") : 30,
            Notes = OptionalString(args, "notes")
        };

        var result = await _mediator.Send(new CreateSupplierCommand(dto), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(new { supplierId = result.Value, message = "Fournisseur créé." }))
            : AiToolResult.Error(result.Error.Description);
    }

    private async Task<AiToolResult> HandleUpdateSupplier(Dictionary<string, object?> args, CancellationToken ct)
    {
        if (!Guid.TryParse(GetStringArg(args, "supplier_id"), out var id))
            return AiToolResult.Error("supplier_id doit être un GUID valide.");

        var dto = new UpdateSupplierDto
        {
            Name = GetStringArg(args, "name"),
            Email = GetStringArg(args, "email"),
            Street = GetStringArg(args, "street"),
            City = GetStringArg(args, "city"),
            Governorate = GetStringArg(args, "governorate"),
            Phone = OptionalString(args, "phone"),
            ContactPerson = OptionalString(args, "contact_person"),
            PaymentTermDays = ArgProvided(args, "payment_term_days") ? ParseIntArg(args, "payment_term_days") : 30,
            Notes = OptionalString(args, "notes")
        };

        var result = await _mediator.Send(new UpdateSupplierCommand(id, dto), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(new { ok = true, message = "Fournisseur mis à jour." }))
            : AiToolResult.Error(result.Error.Description);
    }

    private async Task<AiToolResult> HandleDeleteSupplier(Dictionary<string, object?> args, CancellationToken ct)
    {
        if (!Guid.TryParse(GetStringArg(args, "supplier_id"), out var id))
            return AiToolResult.Error("supplier_id doit être un GUID valide.");

        var result = await _mediator.Send(new DeleteSupplierCommand(id), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(new { ok = true, message = "Fournisseur supprimé." }))
            : AiToolResult.Error(result.Error.Description);
    }

    // ════════════════════════════════════════════════════════════════════
    // ────────── Factures de vente ──────────
    // ════════════════════════════════════════════════════════════════════

    private async Task<AiToolResult> HandleSearchInvoices(Dictionary<string, object?> args, CancellationToken ct)
    {
        var page = ArgProvided(args, "page") ? ParseIntArg(args, "page") : 1;
        var pageSize = Math.Min(ArgProvided(args, "page_size") ? ParseIntArg(args, "page_size") : 20, 50);
        InvoiceStatus? status = null;
        if (ArgProvided(args, "status") && Enum.TryParse<InvoiceStatus>(GetStringArg(args, "status"), true, out var s))
            status = s;
        DateTime? from = ArgProvided(args, "from_date") ? ParseDate(args, "from_date") : null;
        DateTime? to = ArgProvided(args, "to_date") ? ParseDate(args, "to_date") : null;

        var result = await _mediator.Send(new GetInvoicesQuery(
            SearchTerm: OptionalString(args, "search"),
            Status: status,
            FromDate: from,
            ToDate: to,
            ClientId: ParseGuidOrNull(args, "client_id"),
            Page: page,
            PageSize: pageSize,
            UnpaidOnly: TryParseBoolArg(args, "unpaid_only") ?? false), ct);
        return AiToolResult.Ok(Serialize(result));
    }

    private async Task<AiToolResult> HandleGetInvoiceById(Dictionary<string, object?> args, CancellationToken ct)
    {
        if (!Guid.TryParse(GetStringArg(args, "invoice_id"), out var id))
            return AiToolResult.Error("invoice_id doit être un GUID valide.");

        var result = await _mediator.Send(new GetInvoiceByIdQuery(id), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(result.Value))
            : AiToolResult.Error(result.Error.Description);
    }

    private async Task<AiToolResult> HandleValidateInvoice(Dictionary<string, object?> args, CancellationToken ct)
    {
        if (!Guid.TryParse(GetStringArg(args, "invoice_id"), out var id))
            return AiToolResult.Error("invoice_id doit être un GUID valide.");

        var result = await _mediator.Send(new ValidateInvoiceCommand(id), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(new { ok = true, message = "Facture validée." }))
            : AiToolResult.Error(result.Error.Description);
    }

    private async Task<AiToolResult> HandleSignInvoice(Dictionary<string, object?> args, CancellationToken ct)
    {
        if (!Guid.TryParse(GetStringArg(args, "invoice_id"), out var id))
            return AiToolResult.Error("invoice_id doit être un GUID valide.");

        var result = await _mediator.Send(new SignInvoiceCommand(id), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(new { ok = true, signatureHash = result.Value, message = "Facture signée." }))
            : AiToolResult.Error(result.Error.Description);
    }

    private async Task<AiToolResult> HandleSendInvoiceEmail(Dictionary<string, object?> args, CancellationToken ct)
    {
        if (!Guid.TryParse(GetStringArg(args, "invoice_id"), out var id))
            return AiToolResult.Error("invoice_id doit être un GUID valide.");

        var result = await _mediator.Send(new SendInvoiceEmailCommand(id), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(new { ok = true, message = "Facture envoyée par email." }))
            : AiToolResult.Error(result.Error.Description);
    }

    // ════════════════════════════════════════════════════════════════════
    // ────────── Devis ──────────
    // ════════════════════════════════════════════════════════════════════

    private async Task<AiToolResult> HandleSearchQuotes(Dictionary<string, object?> args, CancellationToken ct)
    {
        var page = ArgProvided(args, "page") ? ParseIntArg(args, "page") : 1;
        var pageSize = Math.Min(ArgProvided(args, "page_size") ? ParseIntArg(args, "page_size") : 20, 50);
        QuoteStatus? status = null;
        if (ArgProvided(args, "status") && Enum.TryParse<QuoteStatus>(GetStringArg(args, "status"), true, out var s))
            status = s;
        DateTime? from = ArgProvided(args, "from_date") ? ParseDate(args, "from_date") : null;
        DateTime? to = ArgProvided(args, "to_date") ? ParseDate(args, "to_date") : null;

        var result = await _mediator.Send(new GetQuotesQuery(
            SearchTerm: OptionalString(args, "search"),
            Status: status,
            FromDate: from,
            ToDate: to,
            ClientId: ParseGuidOrNull(args, "client_id"),
            Page: page,
            PageSize: pageSize), ct);
        return AiToolResult.Ok(Serialize(result));
    }

    private async Task<AiToolResult> HandleGetQuoteById(Dictionary<string, object?> args, CancellationToken ct)
    {
        if (!Guid.TryParse(GetStringArg(args, "quote_id"), out var id))
            return AiToolResult.Error("quote_id doit être un GUID valide.");

        var result = await _mediator.Send(new GetQuoteByIdQuery(id), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(result.Value))
            : AiToolResult.Error(result.Error.Description);
    }

    // ════════════════════════════════════════════════════════════════════
    // ────────── Bons de livraison ──────────
    // ════════════════════════════════════════════════════════════════════

    private async Task<AiToolResult> HandleSearchDeliveryNotes(Dictionary<string, object?> args, CancellationToken ct)
    {
        var page = ArgProvided(args, "page") ? ParseIntArg(args, "page") : 1;
        var pageSize = Math.Min(ArgProvided(args, "page_size") ? ParseIntArg(args, "page_size") : 20, 50);
        DateTime? from = ArgProvided(args, "from_date") ? ParseDate(args, "from_date") : null;
        DateTime? to = ArgProvided(args, "to_date") ? ParseDate(args, "to_date") : null;

        var result = await _mediator.Send(new GetDeliveryNotesListQuery(
            Page: page,
            PageSize: pageSize,
            ClientId: ParseGuidOrNull(args, "client_id"),
            FromDate: from,
            ToDate: to,
            Search: OptionalString(args, "search")), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(result.Value))
            : AiToolResult.Error(result.Error.Description);
    }

    private async Task<AiToolResult> HandleGetDeliveryNoteById(Dictionary<string, object?> args, CancellationToken ct)
    {
        if (!Guid.TryParse(GetStringArg(args, "delivery_note_id"), out var id))
            return AiToolResult.Error("delivery_note_id doit être un GUID valide.");

        var result = await _mediator.Send(new GetDeliveryNoteByIdQuery(id), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(result.Value))
            : AiToolResult.Error(result.Error.Description);
    }

    // ════════════════════════════════════════════════════════════════════
    // ────────── Commandes fournisseurs ──────────
    // ════════════════════════════════════════════════════════════════════

    private async Task<AiToolResult> HandleSearchPurchaseOrders(Dictionary<string, object?> args, CancellationToken ct)
    {
        var page = ArgProvided(args, "page") ? ParseIntArg(args, "page") : 1;
        var pageSize = Math.Min(ArgProvided(args, "page_size") ? ParseIntArg(args, "page_size") : 20, 50);
        DateTime? from = ArgProvided(args, "from_date") ? ParseDate(args, "from_date") : null;
        DateTime? to = ArgProvided(args, "to_date") ? ParseDate(args, "to_date") : null;

        var result = await _mediator.Send(new GetPurchaseOrdersQuery(
            Search: OptionalString(args, "search"),
            SupplierId: ParseGuidOrNull(args, "supplier_id"),
            FromDate: from,
            ToDate: to,
            Page: page,
            PageSize: pageSize), ct);
        return AiToolResult.Ok(Serialize(result));
    }

    private async Task<AiToolResult> HandleGetPurchaseOrderById(Dictionary<string, object?> args, CancellationToken ct)
    {
        if (!Guid.TryParse(GetStringArg(args, "purchase_order_id"), out var id))
            return AiToolResult.Error("purchase_order_id doit être un GUID valide.");

        var result = await _mediator.Send(new GetPurchaseOrderByIdQuery(id), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(result.Value))
            : AiToolResult.Error(result.Error.Description);
    }

    private async Task<AiToolResult> HandleConfirmPurchaseOrder(Dictionary<string, object?> args, CancellationToken ct)
    {
        if (!Guid.TryParse(GetStringArg(args, "purchase_order_id"), out var id))
            return AiToolResult.Error("purchase_order_id doit être un GUID valide.");

        var result = await _mediator.Send(new ConfirmPurchaseOrderCommand(id), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(new { ok = true, message = "Commande confirmée." }))
            : AiToolResult.Error(result.Error.Description);
    }

    private async Task<AiToolResult> HandleCancelPurchaseOrder(Dictionary<string, object?> args, CancellationToken ct)
    {
        if (!Guid.TryParse(GetStringArg(args, "purchase_order_id"), out var id))
            return AiToolResult.Error("purchase_order_id doit être un GUID valide.");

        var reason = OptionalString(args, "reason") ?? "Annulation via assistant IA";
        var result = await _mediator.Send(new CancelPurchaseOrderCommand(id, reason), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(new { ok = true, message = "Commande annulée." }))
            : AiToolResult.Error(result.Error.Description);
    }

    // ════════════════════════════════════════════════════════════════════
    // ────────── Factures fournisseurs ──────────
    // ════════════════════════════════════════════════════════════════════

    private async Task<AiToolResult> HandleSearchSupplierInvoices(Dictionary<string, object?> args, CancellationToken ct)
    {
        var page = ArgProvided(args, "page") ? ParseIntArg(args, "page") : 1;
        var pageSize = Math.Min(ArgProvided(args, "page_size") ? ParseIntArg(args, "page_size") : 20, 50);
        DateTime? from = ArgProvided(args, "from_date") ? ParseDate(args, "from_date") : null;
        DateTime? to = ArgProvided(args, "to_date") ? ParseDate(args, "to_date") : null;

        var result = await _mediator.Send(new GetSupplierInvoicesQuery(
            Search: OptionalString(args, "search"),
            SupplierId: ParseGuidOrNull(args, "supplier_id"),
            FromDate: from,
            ToDate: to,
            Page: page,
            PageSize: pageSize), ct);
        return AiToolResult.Ok(Serialize(result));
    }

    private async Task<AiToolResult> HandleGetSupplierInvoiceById(Dictionary<string, object?> args, CancellationToken ct)
    {
        if (!Guid.TryParse(GetStringArg(args, "supplier_invoice_id"), out var id))
            return AiToolResult.Error("supplier_invoice_id doit être un GUID valide.");

        var result = await _mediator.Send(new GetSupplierInvoiceByIdQuery(id), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(result.Value))
            : AiToolResult.Error(result.Error.Description);
    }

    private async Task<AiToolResult> HandleRecordSupplierPayment(Dictionary<string, object?> args, CancellationToken ct)
    {
        if (!Guid.TryParse(GetStringArg(args, "supplier_invoice_id"), out var invoiceId))
            return AiToolResult.Error("supplier_invoice_id doit être un GUID valide.");

        DateTime paymentDate;
        try { paymentDate = ParseDate(args, "payment_date"); }
        catch { return AiToolResult.Error("payment_date invalide (yyyy-MM-dd)."); }

        PaymentMethod? method = null;
        if (ArgProvided(args, "method"))
        {
            if (!Enum.TryParse<PaymentMethod>(GetStringArg(args, "method"), ignoreCase: true, out var parsed))
                return AiToolResult.Error("method invalide.");
            method = parsed;
        }

        var request = new RecordSupplierPaymentRequest
        {
            PaymentDate = paymentDate,
            Amount = TryParseDecimalArg(args, "amount"),
            Method = method,
            Reference = OptionalString(args, "reference"),
            Notes = OptionalString(args, "notes")
        };

        var result = await _mediator.Send(new RecordSupplierPaymentCommand(invoiceId, request), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(new { ok = true, message = "Paiement fournisseur enregistré." }))
            : AiToolResult.Error(result.Error.Description);
    }

    private async Task<AiToolResult> HandleCancelSupplierInvoice(Dictionary<string, object?> args, CancellationToken ct)
    {
        if (!Guid.TryParse(GetStringArg(args, "supplier_invoice_id"), out var id))
            return AiToolResult.Error("supplier_invoice_id doit être un GUID valide.");

        var reason = GetStringArg(args, "reason");
        if (string.IsNullOrWhiteSpace(reason))
            return AiToolResult.Error("reason est obligatoire pour l'annulation.");

        var result = await _mediator.Send(new CancelSupplierInvoiceCommand(id, reason), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(new { ok = true, message = "Facture fournisseur annulée." }))
            : AiToolResult.Error(result.Error.Description);
    }

    // ════════════════════════════════════════════════════════════════════
    // ────────── Stock & Entrepôts ──────────
    // ════════════════════════════════════════════════════════════════════

    private async Task<AiToolResult> HandleGetWarehouses(CancellationToken ct)
    {
        var result = await _mediator.Send(new GetWarehousesQuery(), ct);
        return AiToolResult.Ok(Serialize(result));
    }

    private async Task<AiToolResult> HandleCreateWarehouse(Dictionary<string, object?> args, CancellationToken ct)
    {
        var result = await _mediator.Send(new CreateWarehouseCommand(
            Code: GetStringArg(args, "code"),
            Name: GetStringArg(args, "name"),
            Address: OptionalString(args, "address"),
            IsDefault: TryParseBoolArg(args, "is_default") ?? false), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(new { warehouseId = result.Value, message = "Entrepôt créé." }))
            : AiToolResult.Error(result.Error.Description);
    }

    private async Task<AiToolResult> HandleRecordStockEntry(Dictionary<string, object?> args, CancellationToken ct)
    {
        if (!Guid.TryParse(GetStringArg(args, "product_id"), out var productId))
            return AiToolResult.Error("product_id doit être un GUID valide.");

        var reason = ParseEnum(args, "reason", MovementReason.Purchase);
        var result = await _mediator.Send(new RecordStockEntryCommand(
            ProductId: productId,
            WarehouseId: ParseGuidOrNull(args, "warehouse_id"),
            Quantity: ParseDecimalArg(args, "quantity"),
            UnitCost: ParseDecimalArg(args, "unit_cost"),
            Reason: reason,
            Reference: OptionalString(args, "reference"),
            Notes: OptionalString(args, "notes")), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(new { stockItemId = result.Value, message = "Entrée de stock enregistrée." }))
            : AiToolResult.Error(result.Error.Description);
    }

    private async Task<AiToolResult> HandleRecordStockExit(Dictionary<string, object?> args, CancellationToken ct)
    {
        if (!Guid.TryParse(GetStringArg(args, "product_id"), out var productId))
            return AiToolResult.Error("product_id doit être un GUID valide.");

        var reason = ParseEnum(args, "reason", MovementReason.Damage);
        var result = await _mediator.Send(new RecordStockExitCommand(
            ProductId: productId,
            WarehouseId: ParseGuidOrNull(args, "warehouse_id"),
            Quantity: ParseDecimalArg(args, "quantity"),
            Reason: reason,
            Reference: OptionalString(args, "reference"),
            Notes: OptionalString(args, "notes")), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(new { ok = true, message = "Sortie de stock enregistrée." }))
            : AiToolResult.Error(result.Error.Description);
    }

    private async Task<AiToolResult> HandleAdjustStock(Dictionary<string, object?> args, CancellationToken ct)
    {
        if (!Guid.TryParse(GetStringArg(args, "product_id"), out var productId))
            return AiToolResult.Error("product_id doit être un GUID valide.");

        var result = await _mediator.Send(new AdjustStockCommand(
            ProductId: productId,
            WarehouseId: ParseGuidOrNull(args, "warehouse_id"),
            NewQuantity: ParseDecimalArg(args, "new_quantity"),
            Notes: OptionalString(args, "notes")), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(new { ok = true, message = "Stock ajusté." }))
            : AiToolResult.Error(result.Error.Description);
    }

    // ════════════════════════════════════════════════════════════════════
    // ────────── CRM ──────────
    // ════════════════════════════════════════════════════════════════════

    private async Task<AiToolResult> HandleSearchCrmActivities(Dictionary<string, object?> args, CancellationToken ct)
    {
        var page = ArgProvided(args, "page") ? ParseIntArg(args, "page") : 1;
        var pageSize = Math.Min(ArgProvided(args, "page_size") ? ParseIntArg(args, "page_size") : 20, 50);

        var result = await _mediator.Send(new GetActivitiesQuery(
            ClientId: ParseGuidOrNull(args, "client_id"),
            AssignedUserId: null,
            OpportunityId: null,
            Completed: TryParseBoolArg(args, "completed"),
            DueFrom: null,
            DueTo: null,
            ActivityType: null,
            SearchSubject: OptionalString(args, "search_subject"),
            Page: page,
            PageSize: pageSize), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(result.Value))
            : AiToolResult.Error(result.Error.Description);
    }

    private async Task<AiToolResult> HandleSearchCrmOpportunities(Dictionary<string, object?> args, CancellationToken ct)
    {
        OpportunityStage? stage = null;
        if (ArgProvided(args, "stage") && Enum.TryParse<OpportunityStage>(GetStringArg(args, "stage"), true, out var s))
            stage = s;

        var result = await _mediator.Send(new GetOpportunitiesQuery(
            Stage: stage,
            AssignedUserId: null,
            ClientId: ParseGuidOrNull(args, "client_id")), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(result.Value))
            : AiToolResult.Error(result.Error.Description);
    }

    private async Task<AiToolResult> HandleCreateCrmActivity(Dictionary<string, object?> args, CancellationToken ct)
    {
        if (!Guid.TryParse(GetStringArg(args, "client_id"), out var clientId))
            return AiToolResult.Error("client_id doit être un GUID valide.");

        DateTime? dueDate = ArgProvided(args, "due_date") ? ParseDate(args, "due_date") : null;

        var request = new CreateActivityRequest
        {
            Type = ArgProvided(args, "type") ? ParseIntArg(args, "type") : 3, // default Tâche
            Subject = GetStringArg(args, "subject"),
            Description = OptionalString(args, "description"),
            ClientId = clientId,
            OpportunityId = ParseGuidOrNull(args, "opportunity_id"),
            Priority = ArgProvided(args, "priority") ? ParseIntArg(args, "priority") : 1, // default Normale
            DueDate = dueDate
        };

        var userId = _currentUser.UserId ?? Guid.Empty;
        var result = await _mediator.Send(new CreateActivityCommand(request, userId, _currentUser.Email ?? "Assistant IA"), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(new { activityId = result.Value, message = "Activité CRM créée." }))
            : AiToolResult.Error(result.Error.Description);
    }

    private async Task<AiToolResult> HandleCreateCrmOpportunity(Dictionary<string, object?> args, CancellationToken ct)
    {
        if (!Guid.TryParse(GetStringArg(args, "client_id"), out var clientId))
            return AiToolResult.Error("client_id doit être un GUID valide.");

        DateTime? closeDate = ArgProvided(args, "expected_close_date") ? ParseDate(args, "expected_close_date") : null;

        var request = new CreateOpportunityRequest
        {
            Title = GetStringArg(args, "title"),
            ClientId = clientId,
            ExpectedAmount = ParseDecimalArg(args, "expected_amount"),
            Probability = ArgProvided(args, "probability") ? ParseIntArg(args, "probability") : 50,
            ExpectedCloseDate = closeDate ?? DateTime.UtcNow.AddMonths(3),
            Source = OptionalString(args, "source"),
            Notes = OptionalString(args, "notes")
        };

        var userId = _currentUser.UserId ?? Guid.Empty;
        var result = await _mediator.Send(new CreateOpportunityCommand(request, userId, _currentUser.Email ?? "Assistant IA"), ct);
        return result.IsSuccess
            ? AiToolResult.Ok(Serialize(new { opportunityId = result.Value, message = "Opportunité CRM créée." }))
            : AiToolResult.Error(result.Error.Description);
    }

    #region Argument Parsing Helpers

    private static bool ArgProvided(Dictionary<string, object?> args, string key)
    {
        if (!args.TryGetValue(key, out var raw) || raw is null)
            return false;
        if (raw is JsonElement je && je.ValueKind == JsonValueKind.Null)
            return false;
        return true;
    }

    private static string? OptionalString(Dictionary<string, object?> args, string key)
    {
        var s = GetStringArg(args, key);
        return string.IsNullOrWhiteSpace(s) ? null : s.Trim();
    }

    private static int ParseIntArg(Dictionary<string, object?> args, string key)
    {
        if (!args.TryGetValue(key, out var raw) || raw is null)
            throw new ArgumentException($"{key} requis.");

        if (raw is JsonElement je)
        {
            if (je.ValueKind == JsonValueKind.Number && je.TryGetInt32(out var n))
                return n;
            if (je.ValueKind == JsonValueKind.String && int.TryParse(je.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var ns))
                return ns;
        }

        if (int.TryParse(raw.ToString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var i))
            return i;

        throw new ArgumentException($"{key} doit être un entier.");
    }

    private static decimal ParseDecimalArg(Dictionary<string, object?> args, string key)
    {
        var d = TryParseDecimalArg(args, key);
        if (d is null)
            throw new ArgumentException($"{key} requis (nombre).");
        return d.Value;
    }

    private static decimal? TryParseDecimalArg(Dictionary<string, object?> args, string key)
    {
        if (!args.TryGetValue(key, out var raw) || raw is null)
            return null;

        if (raw is JsonElement je)
        {
            if (je.ValueKind == JsonValueKind.Null)
                return null;
            if (je.ValueKind == JsonValueKind.Number && je.TryGetDecimal(out var dec))
                return dec;
            if (je.ValueKind == JsonValueKind.String &&
                decimal.TryParse(je.GetString(), NumberStyles.Number, CultureInfo.InvariantCulture, out var ds))
                return ds;
            return null;
        }

        return decimal.TryParse(raw.ToString(), NumberStyles.Number, CultureInfo.InvariantCulture, out var v) ? v : null;
    }

    private static bool? TryParseBoolArg(Dictionary<string, object?> args, string key)
    {
        if (!args.TryGetValue(key, out var raw) || raw is null)
            return null;

        if (raw is JsonElement je)
        {
            if (je.ValueKind == JsonValueKind.Null)
                return null;
            if (je.ValueKind == JsonValueKind.True)
                return true;
            if (je.ValueKind == JsonValueKind.False)
                return false;
        }

        if (bool.TryParse(raw.ToString(), out var b))
            return b;
        return null;
    }

    private static ProductType ParseProductType(Dictionary<string, object?> args)
    {
        if (!ArgProvided(args, "type"))
            return ProductType.Product;

        var s = GetStringArg(args, "type");
        return Enum.TryParse<ProductType>(s, ignoreCase: true, out var t) ? t : ProductType.Product;
    }

    /// <summary>
    /// When from_date/to_date are omitted, resolves the current month in Tunisia (same default as resolve_reporting_period).
    /// Allows the model to call data tools directly without a separate period-resolution step.
    /// </summary>
    private (DateTime From, DateTime To) ResolveFromToDatesOrDefault(Dictionary<string, object?> args)
    {
        if (ArgProvided(args, "from_date") && ArgProvided(args, "to_date"))
            return (ParseDate(args, "from_date"), ParseDate(args, "to_date"));

        var preset = GetStringArg(args, "preset");
        if (string.IsNullOrWhiteSpace(preset))
            preset = ReportingPeriodResolver.PresetCurrentMonth;

        var resolved = ReportingPeriodResolver.Resolve(preset, _timeProvider);
        return (
            resolved.FromDate.ToDateTime(TimeOnly.MinValue),
            resolved.ToDate.ToDateTime(TimeOnly.MinValue));
    }

    private static DateTime ParseDate(Dictionary<string, object?> args, string key)
    {
        var value = GetStringArg(args, key);
        return DateTime.ParseExact(value, new[] { "yyyy-MM-dd", "yyyy-MM-ddTHH:mm:ss", "dd/MM/yyyy" },
            CultureInfo.InvariantCulture, DateTimeStyles.None);
    }

    private static TEnum ParseEnum<TEnum>(Dictionary<string, object?> args, string key, TEnum defaultValue)
        where TEnum : struct, Enum
    {
        if (!args.TryGetValue(key, out var raw) || raw is null)
            return defaultValue;

        var str = raw.ToString() ?? string.Empty;
        return Enum.TryParse<TEnum>(str, ignoreCase: true, out var result)
            ? result
            : defaultValue;
    }

    /// <summary>
    /// Variante stricte de <see cref="ParseEnum{TEnum}"/> : un argument OMIS (ou vide) conserve la valeur
    /// par défaut sans erreur, mais une valeur EXPLICITEMENT invalide renvoie un message d'erreur exploitable
    /// par le modèle (qui peut se corriger) au lieu d'un repli silencieux trompeur.
    /// </summary>
    private static TEnum ParseEnumStrict<TEnum>(
        Dictionary<string, object?> args, string key, TEnum defaultValue, out string? error)
        where TEnum : struct, Enum
    {
        error = null;
        if (!args.TryGetValue(key, out var raw) || raw is null)
            return defaultValue;

        var str = GetStringArg(args, key).Trim();
        if (str.Length == 0)
            return defaultValue;

        if (Enum.TryParse<TEnum>(str, ignoreCase: true, out var result) && Enum.IsDefined(typeof(TEnum), result))
            return result;

        error = $"Valeur invalide pour « {key} » : « {str} ». Valeurs acceptées : {string.Join(", ", Enum.GetNames(typeof(TEnum)))}.";
        return defaultValue;
    }

    private static Guid? ParseGuidOrNull(Dictionary<string, object?> args, string key)
    {
        if (!args.TryGetValue(key, out var raw) || raw is null)
            return null;

        var str = raw.ToString() ?? string.Empty;
        return Guid.TryParse(str, out var guid) ? guid : null;
    }

    private static string GetStringArg(Dictionary<string, object?> args, string key)
    {
        if (!args.TryGetValue(key, out var raw) || raw is null)
            return string.Empty;

        if (raw is JsonElement jsonElement)
            return jsonElement.GetString() ?? jsonElement.ToString();

        return raw.ToString() ?? string.Empty;
    }

    private static string Serialize<T>(T value)
    {
        return JsonSerializer.Serialize(value, SerializeOptions);
    }

    /// <summary>
    /// Lit le paramètre <c>top_n</c> (résilient) et délègue le bornage déterministe à <see cref="AiRankingLimiter"/>.
    /// Un <c>top_n</c> mal formé est ignoré (retombe sur le plafond par défaut) plutôt que de faire échouer l'outil.
    /// </summary>
    private IReadOnlyList<T> ApplyRankingLimit<T>(
        IReadOnlyList<T> rows,
        Dictionary<string, object?> args,
        Func<T, decimal> rankKey)
    {
        var explicitTopN = ArgProvided(args, "top_n");
        var requested = 0;
        if (explicitTopN)
        {
            try { requested = ParseIntArg(args, "top_n"); }
            catch (ArgumentException) { explicitTopN = false; }
        }

        return AiRankingLimiter.Apply(rows, explicitTopN, requested, _ollamaSettings.DefaultRankingRows, rankKey);
    }

    #endregion
}
