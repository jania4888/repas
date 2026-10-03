using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Invoices.Queries;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using MediatR;

namespace FactuTrust.Application.Features.CashDesk.Queries;

public sealed record ExportTreasuryJournalPdfQuery(
    DateTime From,
    DateTime To,
    PaymentMethod? Method) : IRequest<Result<InvoicePdfResult>>;

public sealed class ExportTreasuryJournalPdfQueryHandler
    : IRequestHandler<ExportTreasuryJournalPdfQuery, Result<InvoicePdfResult>>
{
    private readonly ICashOperationRepository _cashOperationRepository;
    private readonly ICompanyRepository _companyRepository;
    private readonly IPdfService _pdfService;
    private readonly IAuditService _auditService;

    public ExportTreasuryJournalPdfQueryHandler(
        ICashOperationRepository cashOperationRepository,
        ICompanyRepository companyRepository,
        IPdfService pdfService,
        IAuditService auditService)
    {
        _cashOperationRepository = cashOperationRepository;
        _companyRepository = companyRepository;
        _pdfService = pdfService;
        _auditService = auditService;
    }

    public async Task<Result<InvoicePdfResult>> Handle(
        ExportTreasuryJournalPdfQuery request,
        CancellationToken cancellationToken)
    {
        var from = request.From.Date;
        var to = request.To.Date;
        var period = TreasuryJournalAssembler.Validate(from, to, request.Method);
        if (period.IsFailure)
            return Result.Failure<InvoicePdfResult>(period.Error);

        var totals = await _cashOperationRepository.GetNonCancelledJournalCategoryTotalsAsync(
            from, to, request.Method, cancellationToken);
        var (items, totalCount) = await _cashOperationRepository.GetNonCancelledJournalLinesAsync(
            from, to, request.Method, page: 1, pageSize: TreasuryJournalConstants.MaxLinesForPdf, cancellationToken);

        if (totalCount > TreasuryJournalConstants.MaxLinesForPdf)
            return Result.Failure<InvoicePdfResult>(new Error("TooManyLines", TreasuryJournalConstants.TooManyLinesForPdfMessage));

        var (credits, debits, count) = TreasuryJournalAssembler.Summarize(totals);
        var company = await _companyRepository.GetDefaultAsync(cancellationToken);
        var document = BuildDocument(from, to, totals, items, credits, debits, count, company);
        var pdfBytes = await _pdfService.GenerateTreasuryJournalPdfAsync(document, cancellationToken);

        var fileName = $"journal-tresorerie_{from:yyyyMMdd}_{to:yyyyMMdd}.pdf";
        await _auditService.LogAsync(
            AuditActions.Export.Pdf,
            "TreasuryJournal",
            null,
            newValues: new { from, to, method = request.Method?.ToString(), lines = totalCount },
            cancellationToken: cancellationToken);

        return Result.Success(new InvoicePdfResult(pdfBytes, fileName, "application/pdf"));
    }

    private static TreasuryJournalPdfDocument BuildDocument(
        DateTime from,
        DateTime to,
        IReadOnlyList<CashJournalCategoryTotal> totals,
        IReadOnlyList<CashOperation> items,
        decimal credits,
        decimal debits,
        int count,
        Company? company)
    {
        var groups = TreasuryJournalAssembler.BuildGroups(totals);
        var linesByKey = items.GroupBy(op => ((int)op.OperationType, CategoryCode(op)))
            .ToDictionary(g => g.Key, g => (IReadOnlyList<CashOperation>)g.ToList());

        var creditGroups = new List<TreasuryJournalPdfGroup>();
        var debitGroups = new List<TreasuryJournalPdfGroup>();
        foreach (var group in groups)
        {
            linesByKey.TryGetValue((group.OperationType, group.Category), out var rows);
            var pdfGroup = new TreasuryJournalPdfGroup(
                TreasuryJournalLabels.Category((CashOperationType)group.OperationType, group.Category),
                group.Total,
                group.Count,
                (rows ?? Array.Empty<CashOperation>()).Select(ToLine).ToList());

            if (group.OperationType == (int)CashOperationType.Credit)
                creditGroups.Add(pdfGroup);
            else
                debitGroups.Add(pdfGroup);
        }

        var sections = new List<TreasuryJournalPdfSection>();
        if (creditGroups.Count > 0)
            sections.Add(new TreasuryJournalPdfSection(TreasuryJournalLabels.Encaissements(), creditGroups));
        if (debitGroups.Count > 0)
            sections.Add(new TreasuryJournalPdfSection(TreasuryJournalLabels.Decaissements(), debitGroups));

        var companyName = string.IsNullOrWhiteSpace(company?.Name)
            ? (TreasuryJournalLabels.IsArabic ? "الشركة" : "Société")
            : company!.Name;

        return new TreasuryJournalPdfDocument
        {
            RightToLeft = TreasuryJournalLabels.IsArabic,
            CompanyName = companyName,
            MatriculeFiscal = company is null ? null : company.Nif.Value,
            Title = TreasuryJournalLabels.Title(),
            PeriodLabel = TreasuryJournalLabels.Period(from, to),
            MatriculeLabel = TreasuryJournalLabels.Matricule(),
            CurrencyCaption = TreasuryJournalLabels.CurrencyCaption(),
            PrintedOnLabel = TreasuryJournalLabels.PrintedOn(),
            PageLabel = TreasuryJournalLabels.Page(),
            SubtotalLabel = TreasuryJournalLabels.Subtotal(),
            EmptyLabel = TreasuryJournalLabels.Empty(),
            Columns = TreasuryJournalLabels.Columns(),
            Sections = sections,
            TotalCreditsLabel = TreasuryJournalLabels.TotalCredits(),
            TotalDebitsLabel = TreasuryJournalLabels.TotalDebits(),
            BalanceLabel = TreasuryJournalLabels.Balance(),
            CountLabel = TreasuryJournalLabels.OperationCount(),
            TotalCredits = credits,
            TotalDebits = debits,
            Balance = credits - debits,
            OperationCount = count,
            Currency = "TND"
        };
    }

    private static int? CategoryCode(CashOperation op) =>
        op.OperationType == CashOperationType.Credit ? (int?)op.RevenueCategory : (int?)op.Category;

    private static TreasuryJournalPdfLine ToLine(CashOperation op)
    {
        var credit = op.OperationType == CashOperationType.Credit;
        return new TreasuryJournalPdfLine(
            op.OperationDate,
            TreasuryJournalLabels.OperationType(op.OperationType),
            TreasuryJournalLabels.Method(op.Method),
            TreasuryJournalLabels.Category(op.OperationType, CategoryCode(op)),
            op.Label,
            op.Number.Value,
            credit ? null : op.Amount.Amount,
            credit ? op.Amount.Amount : null);
    }
}
