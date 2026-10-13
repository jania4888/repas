using System.Reflection;
using FluentValidation;
using FactuTrust.Application.Features.Accounting.FiscalSchedule;
using FactuTrust.Application.Features.Accounting.Services;
using FactuTrust.Application.Features.Payroll.AnnualBonuses;
using FactuTrust.Application.Features.Payroll.Declarations.CnssRemittance;
using FactuTrust.Application.Features.Payroll.HrDocuments;
using FactuTrust.Application.Features.Payroll.Services;
using FactuTrust.Application.Features.Search;
using FactuTrust.Application.Features.Search.Providers;
using FactuTrust.Application.Features.Stock.Services;
using FactuTrust.Application.Features.SupplierInvoices.Services;
using FactuTrust.Application.Common.Interfaces.Services;
using MediatR;
using Microsoft.Extensions.DependencyInjection;

namespace FactuTrust.Application;

public static class DependencyInjection
{
    public static IServiceCollection AddApplication(this IServiceCollection services)
    {
        var assembly = Assembly.GetExecutingAssembly();

        // MediatR
        services.AddMediatR(cfg => cfg.RegisterServicesFromAssembly(assembly));

        // Global search providers
        services.AddScoped<IGlobalSearchProvider, InvoiceGlobalSearchProvider>();
        services.AddScoped<IGlobalSearchProvider, QuoteGlobalSearchProvider>();
        services.AddScoped<IGlobalSearchProvider, DeliveryNoteGlobalSearchProvider>();
        services.AddScoped<IGlobalSearchProvider, ClientGlobalSearchProvider>();
        services.AddScoped<IGlobalSearchProvider, ProductGlobalSearchProvider>();
        services.AddScoped<IGlobalSearchProvider, SupplierGlobalSearchProvider>();
        services.AddScoped<IGlobalSearchProvider, SalesReturnNoteGlobalSearchProvider>();

        // Synchronisation déclaration mensuelle → échéancier fiscal (best-effort, flag-gated)
        services.AddScoped<DeclarationScheduleSynchronizer>();

        // Apport du module paie à la déclaration mensuelle (TFP, FOPROLOS, RS sur salaires)
        services.AddScoped<PayrollDeclarationContributionProvider>();
        // Composition des lignes paramétrées de la déclaration mensuelle. Enregistré
        // inconditionnellement : les handlers MediatR sont validés au démarrage
        // (ValidateOnBuild), un enregistrement conditionnel ferait échouer la construction du
        // conteneur dès que le drapeau est éteint.
        services.AddScoped<Features.Accounting.MonthlyDeclaration.MonthlyDeclarationLineComposer>();

        services.AddScoped<ISupplierInvoiceNumberService, SupplierInvoiceNumberService>();
        services.AddScoped<ITrackedDocumentStockService, TrackedDocumentStockService>();
        services.AddScoped<IStockAllocationValidator, StockAllocationValidator>();
        services.AddScoped<PayrollInputBuilder>();
        services.AddScoped<StatutoryIjClaimSyncService>();
        services.AddScoped<AnnualBonusSyncService>();
        services.AddScoped<CnssRemittanceDataLoader>();
        services.AddScoped<PayrollHrDocumentDataLoader>();

        // FluentValidation
        services.AddValidatorsFromAssembly(assembly);

        // Validation pipeline behavior
        services.AddTransient(typeof(IPipelineBehavior<,>), typeof(ValidationBehavior<,>));
        services.AddTransient(typeof(IPipelineBehavior<,>), typeof(Authorization.PayrollFirmOperationBehavior<,>));

        return services;
    }
}

/// <summary>
/// MediatR pipeline behavior for automatic validation.
/// </summary>
public sealed class ValidationBehavior<TRequest, TResponse> : IPipelineBehavior<TRequest, TResponse>
    where TRequest : IRequest<TResponse>
{
    private readonly IEnumerable<IValidator<TRequest>> _validators;

    public ValidationBehavior(IEnumerable<IValidator<TRequest>> validators)
    {
        _validators = validators;
    }

    public async Task<TResponse> Handle(
        TRequest request,
        RequestHandlerDelegate<TResponse> next,
        CancellationToken cancellationToken)
    {
        if (!_validators.Any())
            return await next();

        var context = new ValidationContext<TRequest>(request);

        var validationResults = await Task.WhenAll(
            _validators.Select(v => v.ValidateAsync(context, cancellationToken)));

        var failures = validationResults
            .SelectMany(r => r.Errors)
            .Where(f => f is not null)
            .ToList();

        if (failures.Count != 0)
            throw new ValidationException(failures);

        return await next();
    }
}
