using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FluentValidation;
using MediatR;

namespace FactuTrust.Application.Features.DataExports;

public sealed record ExportBusinessDatasetQuery(
    BusinessDataset Dataset,
    BusinessExportCriteria Criteria) : IRequest<Result<BusinessExportFile>>;

public sealed class ExportBusinessDatasetQueryValidator : AbstractValidator<ExportBusinessDatasetQuery>
{
    public ExportBusinessDatasetQueryValidator()
    {
        RuleFor(x => x.Criteria.Search).MaximumLength(200);
        RuleFor(x => x.Criteria.Governorate).MaximumLength(100);
        RuleFor(x => x.Criteria)
            .Must(c => c.FromDate is null || c.ToDate is null || c.FromDate.Value.Date <= c.ToDate.Value.Date)
            .WithMessage("La date de début doit précéder la date de fin.");
    }
}

public sealed class BusinessExportFinalizer
{
    private readonly IBusinessExcelWorkbookBuilder _workbook;
    private readonly IAuditService _audit;
    private readonly ITenantContext _tenantContext;

    public BusinessExportFinalizer(
        IBusinessExcelWorkbookBuilder workbook,
        IAuditService audit,
        ITenantContext tenantContext)
    {
        _workbook = workbook;
        _audit = audit;
        _tenantContext = tenantContext;
    }

    public async Task<Result<BusinessExportFile>> FinishAsync(
        BusinessWorkbookModel model,
        string dataset,
        BusinessExportCriteria criteria,
        CancellationToken cancellationToken)
    {
        var bytes = _workbook.Build(model);
        await _audit.LogAsync(
            AuditActions.Export.Data,
            "BusinessData",
            null,
            newValues: new
            {
                dataset,
                contextTenantId = _tenantContext.TenantId,
                from = criteria.FromDate,
                to = criteria.ToDate,
                sheets = model.Sheets.Select(sheet => new { sheet.Name, Count = sheet.Rows.Count })
            },
            cancellationToken: cancellationToken);

        return Result.Success(new BusinessExportFile(bytes, model.FileName));
    }
}

public sealed class ExportBusinessDatasetQueryHandler
    : IRequestHandler<ExportBusinessDatasetQuery, Result<BusinessExportFile>>
{
    private readonly BusinessDataExportCoordinator _coordinator;
    private readonly BusinessExportFinalizer _finalizer;

    public ExportBusinessDatasetQueryHandler(
        BusinessDataExportCoordinator coordinator,
        BusinessExportFinalizer finalizer)
    {
        _coordinator = coordinator;
        _finalizer = finalizer;
    }

    public async Task<Result<BusinessExportFile>> Handle(
        ExportBusinessDatasetQuery request,
        CancellationToken cancellationToken)
    {
        var model = await _coordinator.BuildDatasetAsync(request.Dataset, request.Criteria, cancellationToken);
        if (model.IsFailure)
            return Result.Failure<BusinessExportFile>(model.Error);

        return await _finalizer.FinishAsync(model.Value, request.Dataset.ToString(), request.Criteria, cancellationToken);
    }
}

public sealed record ExportBusinessDataBundleQuery(
    IReadOnlyList<BusinessDataset> Datasets,
    BusinessExportCriteria Criteria) : IRequest<Result<BusinessExportFile>>;

public sealed class ExportBusinessDataBundleQueryValidator : AbstractValidator<ExportBusinessDataBundleQuery>
{
    public ExportBusinessDataBundleQueryValidator()
    {
        RuleFor(x => x.Criteria)
            .Must(c => c.FromDate is null || c.ToDate is null || c.FromDate.Value.Date <= c.ToDate.Value.Date)
            .WithMessage("La date de début doit précéder la date de fin.");
    }
}

public sealed class ExportBusinessDataBundleQueryHandler
    : IRequestHandler<ExportBusinessDataBundleQuery, Result<BusinessExportFile>>
{
    private readonly BusinessDataExportCoordinator _coordinator;
    private readonly BusinessExportFinalizer _finalizer;

    public ExportBusinessDataBundleQueryHandler(
        BusinessDataExportCoordinator coordinator,
        BusinessExportFinalizer finalizer)
    {
        _coordinator = coordinator;
        _finalizer = finalizer;
    }

    public async Task<Result<BusinessExportFile>> Handle(
        ExportBusinessDataBundleQuery request,
        CancellationToken cancellationToken)
    {
        var model = await _coordinator.BuildBundleAsync(request.Datasets, request.Criteria, cancellationToken);
        if (model.IsFailure)
            return Result.Failure<BusinessExportFile>(model.Error);

        var names = request.Datasets.Count == 0
            ? "bundle"
            : string.Join(",", request.Datasets);
        return await _finalizer.FinishAsync(model.Value, names, request.Criteria, cancellationToken);
    }
}
