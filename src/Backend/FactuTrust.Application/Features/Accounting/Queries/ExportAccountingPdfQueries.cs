using FactuTrust.Application.Accounting;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.OfficialForm;
using FactuTrust.Application.Features.WithholdingTax.Queries;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Enums;
using MediatR;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace FactuTrust.Application.Features.Accounting.Queries;

// ── Export PDF de la déclaration mensuelle ─────────────────────────────────────

public sealed record ExportVatDeclarationPdfQuery(
    int Year,
    int Month,
    bool EnforceCompanySubmittedOnly = false) : IRequest<Result<byte[]>>;

public sealed class ExportVatDeclarationPdfQueryHandler : IRequestHandler<ExportVatDeclarationPdfQuery, Result<byte[]>>
{
    private readonly IMediator _mediator;
    private readonly IPdfService _pdf;
    private readonly ICompanyRepository _companies;

    public ExportVatDeclarationPdfQueryHandler(IMediator mediator, IPdfService pdf, ICompanyRepository companies)
    {
        _mediator = mediator;
        _pdf = pdf;
        _companies = companies;
    }

    public async Task<Result<byte[]>> Handle(ExportVatDeclarationPdfQuery request, CancellationToken cancellationToken)
    {
        var declaration = await _mediator.Send(
            new GetVatDeclarationQuery(request.Year, request.Month, request.EnforceCompanySubmittedOnly),
            cancellationToken);
        if (declaration.IsFailure)
            return Result.Failure<byte[]>(declaration.Error);

        var company = await _companies.GetDefaultAsync(cancellationToken);
        var bytes = await _pdf.GenerateVatDeclarationPdfAsync(declaration.Value, company?.Name ?? "Société", cancellationToken);
        return Result.Success(bytes);
    }
}

// ── Export de la déclaration mensuelle sur le formulaire officiel DGI ──────────

/// <summary>
/// Produit la déclaration mensuelle sur le gabarit officiel préimprimé de la DGI. Distinct de
/// <see cref="ExportVatDeclarationPdfQuery"/>, qui continue de servir la synthèse interne.
/// </summary>
public sealed record ExportMonthlyDeclarationOfficialFormQuery(
    int Year,
    int Month,
    bool EnforceCompanySubmittedOnly = false) : IRequest<Result<byte[]>>;

public sealed class ExportMonthlyDeclarationOfficialFormQueryHandler
    : IRequestHandler<ExportMonthlyDeclarationOfficialFormQuery, Result<byte[]>>
{
    private readonly IMediator _mediator;
    private readonly IPdfService _pdf;
    private readonly AccountingSettings _settings;
    private readonly ILogger<ExportMonthlyDeclarationOfficialFormQueryHandler> _logger;

    public ExportMonthlyDeclarationOfficialFormQueryHandler(
        IMediator mediator,
        IPdfService pdf,
        IOptions<AccountingSettings> settings,
        ILogger<ExportMonthlyDeclarationOfficialFormQueryHandler> logger)
    {
        _mediator = mediator;
        _pdf = pdf;
        _settings = settings.Value;
        _logger = logger;
    }

    public async Task<Result<byte[]>> Handle(
        ExportMonthlyDeclarationOfficialFormQuery request,
        CancellationToken cancellationToken)
    {
        if (!_settings.MonthlyDeclarationOfficialFormEnabled)
            return Result.Failure<byte[]>(Error.Forbidden(
                "L'export au format du formulaire officiel n'est pas activé pour ce dossier."));

        var declaration = await _mediator.Send(
            new GetVatDeclarationQuery(request.Year, request.Month, request.EnforceCompanySubmittedOnly),
            cancellationToken);
        if (declaration.IsFailure)
            return Result.Failure<byte[]>(declaration.Error);

        var dto = declaration.Value;

        // Détail issu des rubriques paramétrées, projeté sur les cases du millésime en cours. Quand
        // il ventile déjà la retenue à la source, la ventilation historique est SAUTÉE : les deux
        // chemins sont exclusifs (voir MonthlyDeclarationOfficialFormInputs).
        var configuredBoxes = MonthlyDeclarationOfficialFormInputs.ConfiguredBoxes(dto);

        if (MonthlyDeclarationOfficialFormInputs.IsWithholdingConfigured(configuredBoxes))
        {
            var configuredBytes = await _pdf.GenerateMonthlyDeclarationOfficialFormPdfAsync(
                dto, WithholdingFormLineMapper.Empty, configuredBoxes, cancellationToken);
            return Result.Success(configuredBytes);
        }

        // Ventilation de la retenue à la source sur les lignes réglementaires. Best-effort : une
        // indisponibilité du rapport RS ne doit jamais empêcher l'édition de la déclaration, le
        // montant total restant porté par la page 4 et le récapitulatif.
        IReadOnlyList<WithholdingReportByCategoryDto>? invoiceWithholding = null;
        try
        {
            var report = await _mediator.Send(
                new GetWithholdingMonthlyReportQuery(request.Year, request.Month), cancellationToken);

            invoiceWithholding = report.ByCategory;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex,
                "Formulaire officiel {Year}-{Month:D2} : ventilation de la retenue à la source factures indisponible, " +
                "la RS salariale sera tout de même reportée.", request.Year, request.Month);
        }

        var withholdingLines = MonthlyDeclarationOfficialFormInputs.HistoricWithholdingLines(dto, invoiceWithholding);

        var bytes = await _pdf.GenerateMonthlyDeclarationOfficialFormPdfAsync(
            dto, withholdingLines, configuredBoxes, cancellationToken);

        return Result.Success(bytes);
    }
}

// ── Export PDF de la liasse NCT ────────────────────────────────────────────────

/// <param name="Options">Null = chemin legacy (PDF intégral, notes agrégées). Non-null = dialogue filtré.</param>
public sealed record ExportNctStatementsPdfQuery(int FiscalYear, NctLiasseExportOptions? Options = null) : IRequest<Result<byte[]>>;

public sealed class ExportNctStatementsPdfQueryHandler : IRequestHandler<ExportNctStatementsPdfQuery, Result<byte[]>>
{
    private readonly IMediator _mediator;
    private readonly IPdfService _pdf;
    private readonly ICompanyRepository _companies;

    public ExportNctStatementsPdfQueryHandler(IMediator mediator, IPdfService pdf, ICompanyRepository companies)
    {
        _mediator = mediator;
        _pdf = pdf;
        _companies = companies;
    }

    public async Task<Result<byte[]>> Handle(ExportNctStatementsPdfQuery request, CancellationToken cancellationToken)
    {
        var statements = await _mediator.Send(new GetNctStatementsQuery(request.FiscalYear), cancellationToken);
        if (statements.IsFailure)
            return Result.Failure<byte[]>(statements.Error);

        var company = await _companies.GetDefaultAsync(cancellationToken);
        var companyName = company?.Name ?? "Société";

        if (request.Options is null)
        {
            var legacyBytes = await _pdf.GenerateNctLiassePdfAsync(statements.Value, companyName, cancellationToken);
            return Result.Success(legacyBytes);
        }

        var options = request.Options;
        // Si aucune note explicite mais familles annexes cochées → toutes les notes non vides de ces familles.
        if (options.SelectedNoteNumbers.Count == 0 && options.HasAnyAnnexFamily)
        {
            var autoNotes = statements.Value.DetailedNotes
                .Where(n =>
                    (n.Family == NctAnnexFamily.Actif && options.IncludeAnnexAssets) ||
                    (n.Family == NctAnnexFamily.Passif && options.IncludeAnnexLiabilities) ||
                    (n.Family == NctAnnexFamily.IncomeStatement && options.IncludeAnnexIncomeStatement) ||
                    (n.Family == NctAnnexFamily.CashFlow && options.IncludeAnnexCashFlow))
                .Select(n => n.Number)
                .ToList();
            options = options with { SelectedNoteNumbers = autoNotes };
        }

        var filtered = NctLiasseExportFilter.Apply(statements.Value, options);
        if (filtered.IsFailure)
            return Result.Failure<byte[]>(filtered.Error);

        var bytes = await _pdf.GenerateNctLiassePdfAsync(filtered.Value, companyName, cancellationToken);
        return Result.Success(bytes);
    }
}
