using System.Text;
using FactuTrust.API.Authorization;
using FactuTrust.Application.Common.Enums;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.Budgeting;
using FactuTrust.Application.Features.Accounting.CurrencyCatalog;
using FactuTrust.Application.Features.Accounting.ThirdPartyDirectory;
using FactuTrust.Application.Features.Accounting.Commands;
using FactuTrust.Application.Features.BankAccounts.Queries;
using FactuTrust.Application.Features.Accounting.Fiscal;
using FactuTrust.Application.Features.Accounting.JournalCatalog;
using FactuTrust.Application.Features.Accounting.Lettering;
using FactuTrust.Application.Features.Accounting.Loans;
using FactuTrust.Application.Features.Accounting.MonthlyDeclaration;
using FactuTrust.Application.Features.Accounting.Queries;
using FactuTrust.Domain.Enums;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FactuTrust.API.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public sealed class AccountingController : ControllerBase
{
    private readonly IMediator _mediator;
    private readonly ICurrentUser _currentUser;

    public AccountingController(IMediator mediator, ICurrentUser currentUser)
    {
        _mediator = mediator;
        _currentUser = currentUser;
    }

    /// <summary>Construit la réponse fichier (content-type + extension) selon le format d'export demandé.</summary>
    private FileContentResult FileFor(byte[] bytes, AccountingExportFormat format, string baseName) => format switch
    {
        AccountingExportFormat.Excel => File(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", $"{baseName}.xlsx"),
        AccountingExportFormat.Pdf => File(bytes, "application/pdf", $"{baseName}.pdf"),
        _ => File(bytes, "text/csv", $"{baseName}.csv")
    };

    [HttpGet("chart-of-accounts")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetChartOfAccounts(CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new GetChartOfAccountsQuery(), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<IReadOnlyList<ChartOfAccountDto>>.Ok(r.Value));
    }

    [HttpPost("chart-of-accounts")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    public async Task<IActionResult> CreateSubAccount([FromBody] CreateSubAccountRequest request, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new CreateSubAccountCommand(request), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<Guid>.Ok(r.Value));
    }

    /// <summary>Backfill idempotent des feuilles 5321/5324 vers la trésorerie (ouverture de l'import).</summary>
    [HttpPost("bank-gl-projections/ensure")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    public async Task<IActionResult> EnsureBankGlProjections(CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new EnsureBankGlProjectionsCommand(), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<BankGlProjectionEnsureResult>.Ok(r.Value));
    }

    /// <summary>Comptes 532 actifs importables. Pas de RIB/IBAN en clair (permission accounting:read).</summary>
    [HttpGet("importable-bank-accounts")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetImportableBankAccounts(CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new GetImportableBankAccountsQuery(), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<IReadOnlyList<ImportableBankAccountDto>>.Ok(r.Value));
    }

    /// <summary>Catalogue banques tunisiennes, sans donnée personnelle, pour le plan comptable.</summary>
    [HttpGet("tunisian-banks")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetTunisianBanks(CancellationToken cancellationToken)
    {
        var list = await _mediator.Send(new GetTunisianBanksQuery(), cancellationToken);
        return Ok(ApiResponse<IReadOnlyList<TunisianBankReferenceDto>>.Ok(list));
    }

    [HttpPut("chart-of-accounts/{id:guid}")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    public async Task<IActionResult> UpdateAccountLabel(Guid id, [FromBody] UpdateAccountLabelRequest request, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new UpdateAccountLabelCommand(id, request.Label), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true));
    }

    [HttpPatch("chart-of-accounts/{id:guid}/toggle-active")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    public async Task<IActionResult> ToggleAccountActive(Guid id, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new ToggleAccountActiveCommand(id), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true));
    }

    [HttpGet("journal")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetJournal(
        [FromQuery] string? journalCode,
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        CancellationToken cancellationToken)
    {
        if (!from.HasValue || !to.HasValue)
            return BadRequest(ApiResponse<object>.Fail("Les paramètres from et to sont requis."));
        var r = await _mediator.Send(new GetJournalEntriesQuery(journalCode, from.Value, to.Value), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<IReadOnlyList<JournalEntryDto>>.Ok(r.Value));
    }

    [HttpGet("journal/{id:guid}")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetJournalEntry(Guid id, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new GetJournalEntryByIdQuery(id), cancellationToken);
        if (r.IsFailure)
        {
            if (r.Error.Code.EndsWith(".NotFound", StringComparison.Ordinal))
                return NotFound(ApiResponse<object>.Fail(r.Error.Description));
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        }
        return Ok(ApiResponse<JournalEntryDto>.Ok(r.Value));
    }

    /// <summary>
    /// Récapitulatifs de journaux : centralisateur (journaux × mois), récapitulation
    /// (journaux × comptes) ou totaux journaux, selon <paramref name="grouping"/>.
    /// </summary>
    [HttpGet("journal-summary")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetJournalSummary(
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] JournalSummaryGrouping grouping = JournalSummaryGrouping.Month,
        [FromQuery] string? journalCode = null,
        CancellationToken cancellationToken = default)
    {
        if (!from.HasValue || !to.HasValue)
            return BadRequest(ApiResponse<object>.Fail("Les paramètres from et to sont requis."));
        var r = await _mediator.Send(
            new GetJournalSummaryQuery(from.Value, to.Value, grouping, journalCode), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<JournalSummaryDto>.Ok(r.Value));
    }

    [HttpGet("journal-summary/export")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> ExportJournalSummary(
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] JournalSummaryGrouping grouping = JournalSummaryGrouping.Month,
        [FromQuery] string? journalCode = null,
        [FromQuery] AccountingExportFormat format = AccountingExportFormat.Csv,
        CancellationToken cancellationToken = default)
    {
        if (!from.HasValue || !to.HasValue)
            return BadRequest(ApiResponse<object>.Fail("Les paramètres from et to sont requis."));

        var r = await _mediator.Send(
            new ExportJournalSummaryQuery(from.Value, to.Value, grouping, journalCode, format), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));

        var baseName = grouping switch
        {
            JournalSummaryGrouping.Month => "journal_centralisateur",
            JournalSummaryGrouping.Account => "recapitulation_journaux",
            _ => "totaux_journaux"
        };
        return FileFor(r.Value, format, $"{baseName}_{from.Value:yyyyMMdd}_{to.Value:yyyyMMdd}");
    }

    [HttpPost("journal")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    public async Task<IActionResult> CreateManualEntry([FromBody] CreateManualJournalEntryRequest request, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new CreateManualJournalEntryCommand(request), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<Guid>.Ok(r.Value));
    }

    [HttpPost("journal/{id:guid}/validate")]
    [Authorize(Policy = PermissionPolicies.AccountingValidate)]
    [Authorize(Policy = PermissionPolicies.FirmDelegatedContext)]
    public async Task<IActionResult> ValidateEntry(Guid id, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new ValidateJournalEntryCommand(id), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true));
    }

    [HttpPost("journal/validate-batch")]
    [Authorize(Policy = PermissionPolicies.AccountingValidate)]
    [Authorize(Policy = PermissionPolicies.FirmDelegatedContext)]
    public async Task<IActionResult> ValidateEntriesBatch([FromBody] ValidateJournalEntriesBatchRequest request, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new ValidateJournalEntriesBatchCommand(request), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<int>.Ok(r.Value, $"{r.Value} écriture(s) validée(s)."));
    }

    [HttpPut("journal/{id:guid}")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    public async Task<IActionResult> UpdateDraftEntry(Guid id, [FromBody] UpdateDraftJournalEntryRequest request, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new UpdateDraftJournalEntryCommand(id, request), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true));
    }

    [HttpDelete("journal/{id:guid}")]
    [Authorize(Policy = PermissionPolicies.AccountingDelete)]
    [Authorize(Policy = PermissionPolicies.FirmDelegatedContext)]
    public async Task<IActionResult> DeleteDraftEntry(Guid id, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new DeleteDraftJournalEntryCommand(id), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true));
    }

    [HttpPost("journal/{id:guid}/reverse")]
    [Authorize(Policy = PermissionPolicies.AccountingReverse)]
    public async Task<IActionResult> ReverseEntry(Guid id, [FromBody] ReverseJournalEntryRequest request, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new ReverseJournalEntryCommand(id, request.Reason), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<Guid>.Ok(r.Value, "Écriture extournée."));
    }

    /// <summary>
    /// Correction de masse d'écritures VALIDÉES par extourne : chaque écriture est contre-passée,
    /// jamais modifiée — la piste d'audit est préservée. Brouillons et écritures déjà extournées
    /// sont ignorés et comptés à part.
    /// </summary>
    [HttpPost("journal/mass-reverse")]
    [Authorize(Policy = PermissionPolicies.AccountingReverse)]
    public async Task<IActionResult> MassReverseEntries(
        [FromBody] MassReverseEntriesRequest request, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new MassReverseEntriesCommand(request.Ids, request.Reason), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<MassReversalResultDto>.Ok(r.Value,
            $"{r.Value.Reversed} écriture(s) extournée(s), {r.Value.Skipped} ignorée(s)."));
    }

    /// <summary>Édition de masse d'écritures EN BROUILLON (journal / date / libellé). Ignore le validé.</summary>
    [HttpPost("journal/mass-update-drafts")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    public async Task<IActionResult> MassUpdateDrafts([FromBody] MassUpdateDraftEntriesRequest request, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(
            new MassUpdateDraftEntriesCommand(request.Ids, request.NewJournalCode, request.NewDate, request.NewLabel), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<MassDraftUpdateResultDto>.Ok(r.Value,
            $"{r.Value.Updated} brouillon(s) modifié(s), {r.Value.Skipped} ignoré(s)."));
    }

    [HttpPost("journal/mass-delete-drafts")]
    [Authorize(Policy = PermissionPolicies.AccountingDelete)]
    [Authorize(Policy = PermissionPolicies.FirmDelegatedContext)]
    public async Task<IActionResult> MassDeleteDrafts([FromBody] MassDeleteDraftEntriesRequest request, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new MassDeleteDraftEntriesCommand(request.Ids), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<MassDraftDeleteResultDto>.Ok(r.Value,
            $"{r.Value.Deleted} brouillon(s) supprimé(s), {r.Value.Skipped} ignoré(s)."));
    }

    [HttpPost("import/preview")]
    [Authorize(Policy = PermissionPolicies.AccountingImport)]
    [RequestSizeLimit(25_000_000)]
    public async Task<IActionResult> PreviewImport(
        [FromForm] JournalImportFormRequest request,
        CancellationToken cancellationToken)
    {
        var file = request.File;
        if (file is null || file.Length == 0)
            return BadRequest(ApiResponse<object>.Fail("Fichier requis."));

        var content = await ReadFileAsync(file, cancellationToken);
        var mapping = await ReadOptionalFileAsync(TryGetOptionalFormFile("accountMapping"), cancellationToken);
        var r = await _mediator.Send(new PreviewJournalImportCommand(content, request.Format, mapping), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<JournalImportPreviewDto>.Ok(r.Value));
    }

    [HttpPost("import/commit")]
    [Authorize(Policy = PermissionPolicies.AccountingImport)]
    [RequestSizeLimit(25_000_000)]
    public async Task<IActionResult> CommitImport(
        [FromForm] JournalImportFormRequest request,
        CancellationToken cancellationToken)
    {
        var file = request.File;
        if (file is null || file.Length == 0)
            return BadRequest(ApiResponse<object>.Fail("Fichier requis."));

        var content = await ReadFileAsync(file, cancellationToken);
        var mapping = await ReadOptionalFileAsync(TryGetOptionalFormFile("accountMapping"), cancellationToken);
        var r = await _mediator.Send(new CommitJournalImportCommand(content, request.Format, mapping), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<JournalImportCommitResultDto>.Ok(r.Value, $"{r.Value.ImportedEntries} écriture(s) importée(s) en brouillard."));
    }

    /// <summary>Aperçu (dry-run) d'un import de référentiel : plan comptable, plan tiers ou balance d'ouverture.</summary>
    [HttpPost("reference-import/preview")]
    [Authorize(Policy = PermissionPolicies.AccountingImport)]
    [RequestSizeLimit(25_000_000)]
    public async Task<IActionResult> PreviewReferenceImport(
        [FromForm] ReferenceImportFormRequest request,
        CancellationToken cancellationToken)
    {
        var file = request.File;
        if (file is null || file.Length == 0)
            return BadRequest(ApiResponse<object>.Fail("Fichier requis."));

        var content = await ReadFileAsync(file, cancellationToken);
        var mapping = await ReadOptionalFileAsync(TryGetOptionalFormFile("accountMapping"), cancellationToken);
        var r = await _mediator.Send(new PreviewReferenceImportCommand(
            content,
            request.Target,
            request.Format,
            request.FiscalYear,
            mapping), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<ReferenceImportPreviewDto>.Ok(r.Value));
    }

    [HttpPost("reference-import/commit")]
    [Authorize(Policy = PermissionPolicies.AccountingImport)]
    [RequestSizeLimit(25_000_000)]
    public async Task<IActionResult> CommitReferenceImport(
        [FromForm] ReferenceImportFormRequest request,
        CancellationToken cancellationToken)
    {
        var file = request.File;
        if (file is null || file.Length == 0)
            return BadRequest(ApiResponse<object>.Fail("Fichier requis."));

        var content = await ReadFileAsync(file, cancellationToken);
        var mapping = await ReadOptionalFileAsync(TryGetOptionalFormFile("accountMapping"), cancellationToken);
        var r = await _mediator.Send(new CommitReferenceImportCommand(
            content,
            request.Target,
            request.Format,
            request.FiscalYear,
            mapping), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<ReferenceImportCommitResultDto>.Ok(r.Value,
            $"{r.Value.CreatedCount} élément(s) créé(s), {r.Value.SkippedCount} ignoré(s)."));
    }

    /// <summary>Payload multipart commun aux imports comptables (journal + mapping facultatif).</summary>
    public class JournalImportFormRequest
    {
        public IFormFile File { get; init; } = null!;
        public JournalImportFormat Format { get; init; }
    }

    /// <summary>Payload multipart des imports de référentiel (plan, tiers, balance d'ouverture).</summary>
    public sealed class ReferenceImportFormRequest
    {
        public IFormFile File { get; init; } = null!;
        public JournalImportFormat Format { get; init; }
        public ReferenceImportTarget Target { get; init; }
        public int? FiscalYear { get; init; }
    }

    private static async Task<byte[]> ReadFileAsync(IFormFile file, CancellationToken cancellationToken)
    {
        using var ms = new MemoryStream();
        await file.CopyToAsync(ms, cancellationToken);
        return ms.ToArray();
    }

    private IFormFile? TryGetOptionalFormFile(string name) =>
        Request?.Form?.Files?.FirstOrDefault(f =>
            string.Equals(f.Name, name, StringComparison.OrdinalIgnoreCase));

    /// <summary>Lit un fichier facultatif (table de correspondance) — null si absent ou vide.</summary>
    private static async Task<byte[]?> ReadOptionalFileAsync(IFormFile? file, CancellationToken cancellationToken)
        => file is null || file.Length == 0 ? null : await ReadFileAsync(file, cancellationToken);

    private static string BuildFiscalScheduleCsv(IReadOnlyList<FiscalScheduleEntryDto> rows)
    {
        var sb = new StringBuilder();
        sb.AppendLine("Date d'echeance;Type d'obligation;Periode/Exercice;Montant estime;Devise;Statut;Date depot;Date paiement;Responsable;Observations");
        foreach (var row in rows)
        {
            sb.AppendLine(string.Join(';',
                row.DueDate.ToString("dd/MM/yyyy"),
                EscapeCsv(row.ObligationTypeDisplay),
                EscapeCsv(row.PeriodDisplay),
                row.EstimatedAmount.ToString("0.000", System.Globalization.CultureInfo.InvariantCulture),
                EscapeCsv(row.Currency),
                EscapeCsv(row.StatusDisplay),
                row.DepositDate?.ToString("dd/MM/yyyy") ?? string.Empty,
                row.PaymentDate?.ToString("dd/MM/yyyy") ?? string.Empty,
                EscapeCsv(row.ResponsibleName ?? string.Empty),
                EscapeCsv(row.Observations ?? string.Empty)));
        }

        return sb.ToString();
    }

    private static string EscapeCsv(string value)
    {
        if (value.Contains(';') || value.Contains('"') || value.Contains('\n') || value.Contains('\r'))
            return "\"" + value.Replace("\"", "\"\"") + "\"";
        return value;
    }

    [HttpGet("ledger")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetLedger(
        [FromQuery] string accountNumber,
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(accountNumber) || !from.HasValue || !to.HasValue)
            return BadRequest(ApiResponse<object>.Fail("accountNumber, from et to sont requis."));
        var r = await _mediator.Send(new GetLedgerQuery(accountNumber, from.Value, to.Value), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<IReadOnlyList<LedgerRowDto>>.Ok(r.Value));
    }

    /// <summary>
    /// Grand livre général : les comptes d'une plage en séquence (report à nouveau, mouvements,
    /// sous-total). Complète — sans le modifier — le grand livre mono-compte de <c>GET ledger</c>.
    /// </summary>
    [HttpGet("general-ledger")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetGeneralLedger(
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] string? accountFrom = null,
        [FromQuery] string? accountTo = null,
        [FromQuery] bool includeUnmoved = false,
        CancellationToken cancellationToken = default)
    {
        if (!from.HasValue || !to.HasValue)
            return BadRequest(ApiResponse<object>.Fail("Les paramètres from et to sont requis."));
        var r = await _mediator.Send(
            new GetGeneralLedgerQuery(accountFrom, accountTo, from.Value, to.Value, includeUnmoved), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<GeneralLedgerDto>.Ok(r.Value));
    }

    [HttpGet("general-ledger/export")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> ExportGeneralLedger(
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] string? accountFrom = null,
        [FromQuery] string? accountTo = null,
        [FromQuery] bool includeUnmoved = false,
        [FromQuery] AccountingExportFormat format = AccountingExportFormat.Csv,
        CancellationToken cancellationToken = default)
    {
        if (!from.HasValue || !to.HasValue)
            return BadRequest(ApiResponse<object>.Fail("Les paramètres from et to sont requis."));

        var r = await _mediator.Send(
            new ExportGeneralLedgerQuery(accountFrom, accountTo, from.Value, to.Value, includeUnmoved, format),
            cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));

        return FileFor(r.Value, format, $"grand_livre_general_{from.Value:yyyyMMdd}_{to.Value:yyyyMMdd}");
    }

    /// <summary>Récapitulatif du grand livre : soldes agrégés par racine de compte à N chiffres.</summary>
    [HttpGet("ledger-recap")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetLedgerRecap(
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] int level = 2,
        CancellationToken cancellationToken = default)
    {
        if (!from.HasValue || !to.HasValue)
            return BadRequest(ApiResponse<object>.Fail("Les paramètres from et to sont requis."));
        var r = await _mediator.Send(new GetLedgerRecapQuery(level, from.Value, to.Value), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<IReadOnlyList<BalanceRowDto>>.Ok(r.Value));
    }

    [HttpGet("ledger-recap/export")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> ExportLedgerRecap(
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] int level = 2,
        [FromQuery] AccountingExportFormat format = AccountingExportFormat.Csv,
        CancellationToken cancellationToken = default)
    {
        if (!from.HasValue || !to.HasValue)
            return BadRequest(ApiResponse<object>.Fail("Les paramètres from et to sont requis."));

        var r = await _mediator.Send(new ExportLedgerRecapQuery(level, from.Value, to.Value, format), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));

        return FileFor(r.Value, format, $"recap_grand_livre_n{level}_{from.Value:yyyyMMdd}_{to.Value:yyyyMMdd}");
    }

    [HttpGet("balance")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetBalance([FromQuery] DateTime? from, [FromQuery] DateTime? to, CancellationToken cancellationToken)
    {
        if (!from.HasValue || !to.HasValue)
            return BadRequest(ApiResponse<object>.Fail("from et to sont requis."));
        var r = await _mediator.Send(new GetBalanceQuery(from.Value, to.Value), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<IReadOnlyList<BalanceRowDto>>.Ok(r.Value));
    }

    /// <summary>Balance détaillée : la balance générale, chaque compte suivi de ses mouvements.</summary>
    [HttpGet("balance-detailed")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetDetailedBalance(
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] string? accountFrom = null,
        [FromQuery] string? accountTo = null,
        CancellationToken cancellationToken = default)
    {
        if (!from.HasValue || !to.HasValue)
            return BadRequest(ApiResponse<object>.Fail("Les paramètres from et to sont requis."));
        var r = await _mediator.Send(
            new GetDetailedBalanceQuery(accountFrom, accountTo, from.Value, to.Value), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<DetailedBalanceDto>.Ok(r.Value));
    }

    [HttpGet("balance-detailed/export")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> ExportDetailedBalance(
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] string? accountFrom = null,
        [FromQuery] string? accountTo = null,
        [FromQuery] AccountingExportFormat format = AccountingExportFormat.Csv,
        CancellationToken cancellationToken = default)
    {
        if (!from.HasValue || !to.HasValue)
            return BadRequest(ApiResponse<object>.Fail("Les paramètres from et to sont requis."));

        var r = await _mediator.Send(
            new ExportDetailedBalanceQuery(accountFrom, accountTo, from.Value, to.Value, format), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));

        return FileFor(r.Value, format, $"balance_detaillee_{from.Value:yyyyMMdd}_{to.Value:yyyyMMdd}");
    }

    /// <summary>Balance par période : un exercice ventilé en 12 colonnes mensuelles.</summary>
    [HttpGet("balance-periodic/{fiscalYear:int}")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetPeriodicBalance(int fiscalYear, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new GetPeriodicBalanceQuery(fiscalYear), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<PeriodicBalanceDto>.Ok(r.Value));
    }

    [HttpGet("balance-periodic/{fiscalYear:int}/export")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> ExportPeriodicBalance(
        int fiscalYear,
        [FromQuery] AccountingExportFormat format = AccountingExportFormat.Csv,
        CancellationToken cancellationToken = default)
    {
        var r = await _mediator.Send(new ExportPeriodicBalanceQuery(fiscalYear, format), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));

        return FileFor(r.Value, format, $"balance_par_periode_{fiscalYear}");
    }

    [HttpGet("auxiliary-balance")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetAuxiliaryBalance(
        [FromQuery] int kind, [FromQuery] DateTime? from, [FromQuery] DateTime? to, CancellationToken cancellationToken)
    {
        if (!from.HasValue || !to.HasValue)
            return BadRequest(ApiResponse<object>.Fail("from et to sont requis."));
        if (kind is not ((int)Domain.Enums.ThirdPartyKind.Client or (int)Domain.Enums.ThirdPartyKind.Supplier))
            return BadRequest(ApiResponse<object>.Fail("kind doit être 1 (client) ou 2 (fournisseur)."));

        var r = await _mediator.Send(new GetAuxiliaryBalanceQuery((Domain.Enums.ThirdPartyKind)kind, from.Value, to.Value), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<IReadOnlyList<AuxiliaryBalanceRowDto>>.Ok(r.Value));
    }

    [HttpGet("auxiliary-balance/export")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> ExportAuxiliaryBalance(
        [FromQuery] int kind, [FromQuery] DateTime? from, [FromQuery] DateTime? to,
        [FromQuery] AccountingExportFormat format = AccountingExportFormat.Csv, CancellationToken cancellationToken = default)
    {
        if (!from.HasValue || !to.HasValue)
            return BadRequest(ApiResponse<object>.Fail("from et to sont requis."));
        if (kind is not ((int)Domain.Enums.ThirdPartyKind.Client or (int)Domain.Enums.ThirdPartyKind.Supplier))
            return BadRequest(ApiResponse<object>.Fail("kind doit être 1 (client) ou 2 (fournisseur)."));

        var r = await _mediator.Send(new ExportAuxiliaryBalanceCsvQuery((Domain.Enums.ThirdPartyKind)kind, from.Value, to.Value, format), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        var kindName = kind == (int)Domain.Enums.ThirdPartyKind.Client ? "clients" : "fournisseurs";
        return FileFor(r.Value, format, $"balance_auxiliaire_{kindName}_{from.Value:yyyyMMdd}_{to.Value:yyyyMMdd}");
    }

    [HttpGet("third-party-ledger")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetThirdPartyLedger(
        [FromQuery] Guid thirdPartyId, [FromQuery] int kind,
        [FromQuery] DateTime? from, [FromQuery] DateTime? to, CancellationToken cancellationToken)
    {
        if (thirdPartyId == Guid.Empty || !from.HasValue || !to.HasValue)
            return BadRequest(ApiResponse<object>.Fail("thirdPartyId, from et to sont requis."));
        if (kind is not ((int)Domain.Enums.ThirdPartyKind.Client or (int)Domain.Enums.ThirdPartyKind.Supplier))
            return BadRequest(ApiResponse<object>.Fail("kind doit être 1 (client) ou 2 (fournisseur)."));

        var r = await _mediator.Send(new GetThirdPartyLedgerQuery(thirdPartyId, (Domain.Enums.ThirdPartyKind)kind, from.Value, to.Value), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<ThirdPartyLedgerDto>.Ok(r.Value));
    }

    [HttpGet("third-party-ledger/export")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> ExportThirdPartyLedger(
        [FromQuery] Guid thirdPartyId, [FromQuery] int kind,
        [FromQuery] DateTime? from, [FromQuery] DateTime? to,
        [FromQuery] AccountingExportFormat format = AccountingExportFormat.Csv, CancellationToken cancellationToken = default)
    {
        if (thirdPartyId == Guid.Empty || !from.HasValue || !to.HasValue)
            return BadRequest(ApiResponse<object>.Fail("thirdPartyId, from et to sont requis."));
        if (kind is not ((int)Domain.Enums.ThirdPartyKind.Client or (int)Domain.Enums.ThirdPartyKind.Supplier))
            return BadRequest(ApiResponse<object>.Fail("kind doit être 1 (client) ou 2 (fournisseur)."));

        var r = await _mediator.Send(new ExportThirdPartyLedgerCsvQuery(thirdPartyId, (Domain.Enums.ThirdPartyKind)kind, from.Value, to.Value, format), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return FileFor(r.Value, format, $"grand_livre_tiers_{from.Value:yyyyMMdd}_{to.Value:yyyyMMdd}");
    }

    [HttpGet("aging/clients")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetClientAging(CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new GetClientAgingReportQuery(), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<IReadOnlyList<AgingReportRowDto>>.Ok(r.Value));
    }

    [HttpGet("aging/suppliers")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetSupplierAging(CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new GetSupplierAgingReportQuery(), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<IReadOnlyList<AgingReportRowDto>>.Ok(r.Value));
    }

    [HttpGet("aging/clients/export")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> ExportClientAging(
        [FromQuery] AccountingExportFormat format = AccountingExportFormat.Csv, CancellationToken cancellationToken = default)
    {
        var r = await _mediator.Send(new ExportAgingQuery(Domain.Enums.ThirdPartyKind.Client, format), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return FileFor(r.Value, format, $"balance_agee_clients_{DateTime.UtcNow:yyyyMMdd}");
    }

    [HttpGet("aging/suppliers/export")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> ExportSupplierAging(
        [FromQuery] AccountingExportFormat format = AccountingExportFormat.Csv, CancellationToken cancellationToken = default)
    {
        var r = await _mediator.Send(new ExportAgingQuery(Domain.Enums.ThirdPartyKind.Supplier, format), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return FileFor(r.Value, format, $"balance_agee_fournisseurs_{DateTime.UtcNow:yyyyMMdd}");
    }

    [HttpGet("vat-declaration")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetVatDeclaration([FromQuery] int year, [FromQuery] int month, CancellationToken cancellationToken)
    {
        var enforceCompanySubmittedOnly = !_currentUser.IsAccountingFirmDelegatedContext;
        var r = await _mediator.Send(new GetVatDeclarationQuery(year, month, enforceCompanySubmittedOnly), cancellationToken);
        if (r.IsFailure)
            // Code stable (VatDeclaration.NotSubmitted…) : le front le teste, le message est traduit.
            return BadRequest(ApiResponse<object>.FailWithCode(r.Error.Description, r.Error.Code));
        return Ok(ApiResponse<VatDeclarationDto>.Ok(r.Value));
    }

    [HttpPost("vat-declaration")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    public async Task<IActionResult> SaveVatDeclaration([FromBody] SaveVatDeclarationRequest request, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new SaveVatDeclarationCommand(request), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<Guid>.Ok(r.Value));
    }

    [HttpGet("fiscal-schedule")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetFiscalSchedule([FromQuery] FiscalScheduleFiltersDto filters, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new GetFiscalScheduleQuery(filters), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<FiscalScheduleListDto>.Ok(r.Value));
    }

    /// <summary>
    /// Responsables proposés pour les échéances fiscales : utilisateurs actifs du tenant
    /// d'APPARTENANCE de l'appelant (claim tenant_id). En mode délégué, ce sont les collaborateurs
    /// du cabinet (le middleware tenant bascule le contexte vers le dossier client, mais le claim
    /// tenant_id reste le cabinet) ; en mode natif, les utilisateurs de la société.
    /// </summary>
    [HttpGet("fiscal-schedule/assignable-users")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetFiscalAssignableUsers(CancellationToken cancellationToken)
    {
        var claim = User.FindFirst("tenant_id")?.Value;
        if (!Guid.TryParse(claim, out var homeTenantId))
            return BadRequest(ApiResponse<object>.Fail("Tenant d'appartenance introuvable."));

        var r = await _mediator.Send(new GetFiscalAssignableUsersQuery(homeTenantId), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<IReadOnlyList<CrmAssignableUserDto>>.Ok(r.Value));
    }

    [HttpGet("fiscal-schedule/export")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> ExportFiscalSchedule([FromQuery] FiscalScheduleFiltersDto filters, CancellationToken cancellationToken)
    {
        var exportFilters = filters with { Page = 1, PageSize = 200 };
        var r = await _mediator.Send(new GetFiscalScheduleQuery(exportFilters), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));

        var csv = BuildFiscalScheduleCsv(r.Value.Items);
        return File(Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(csv)).ToArray(), "text/csv", $"echeancier_fiscal_{DateTime.UtcNow:yyyyMMdd}.csv");
    }

    [HttpPost("fiscal-schedule/ensure/{fiscalYear:int}")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    public async Task<IActionResult> EnsureFiscalSchedule(int fiscalYear, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new EnsureFiscalScheduleCommand(fiscalYear), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<int>.Ok(r.Value, $"{r.Value} echeance(s) generee(s)."));
    }

    [HttpPost("fiscal-schedule")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    public async Task<IActionResult> CreateFiscalScheduleEntry([FromBody] CreateFiscalScheduleEntryRequest request, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new CreateFiscalScheduleEntryCommand(request), cancellationToken);
        if (r.IsFailure)
        {
            if (string.Equals(r.Error.Code, "Conflict", StringComparison.Ordinal))
                return Conflict(ApiResponse<object>.Fail(r.Error.Description, r.Error.Code));
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        }
        return Ok(ApiResponse<FiscalScheduleEntryDto>.Ok(r.Value, "Echeance fiscale creee."));
    }

    [HttpPut("fiscal-schedule/{id:guid}")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    public async Task<IActionResult> UpdateFiscalScheduleEntry(Guid id, [FromBody] UpdateFiscalScheduleEntryRequest request, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new UpdateFiscalScheduleEntryCommand(id, request), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<FiscalScheduleEntryDto>.Ok(r.Value, "Echeance fiscale mise a jour."));
    }

    [HttpDelete("fiscal-schedule/{id:guid}")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    public async Task<IActionResult> DeleteFiscalScheduleEntry(Guid id, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new DeleteFiscalScheduleEntryCommand(id), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true, "Echeance fiscale annulee."));
    }

    [HttpPost("fiscal-schedule/{id:guid}/deposit")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    public async Task<IActionResult> MarkFiscalScheduleDeposited(Guid id, [FromBody] MarkFiscalScheduleDepositedRequest request, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new MarkFiscalScheduleDepositedCommand(id, request), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<FiscalScheduleEntryDto>.Ok(r.Value, "Echeance marquee comme deposee."));
    }

    [HttpPost("fiscal-schedule/{id:guid}/payment")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    public async Task<IActionResult> CaptureFiscalSchedulePayment(Guid id, [FromBody] CaptureFiscalSchedulePaymentRequest request, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new CaptureFiscalSchedulePaymentCommand(id, request), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<FiscalScheduleEntryDto>.Ok(r.Value, "Paiement saisi."));
    }

    [HttpPost("fiscal-schedule/{id:guid}/reminder")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    public async Task<IActionResult> ScheduleFiscalReminder(Guid id, [FromBody] ScheduleFiscalReminderRequest request, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new ScheduleFiscalReminderCommand(id, request), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<FiscalScheduleEntryDto>.Ok(r.Value, "Rappel fiscal planifie."));
    }

    [HttpPost("fiscal-schedule/{id:guid}/validate")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    public async Task<IActionResult> MarkFiscalScheduleValidated(Guid id, [FromBody] MarkFiscalScheduleValidatedRequest request, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new MarkFiscalScheduleValidatedCommand(id, request), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<FiscalScheduleEntryDto>.Ok(r.Value, "Echeance marquee comme validee."));
    }

    [HttpGet("fiscal-schedule/{id:guid}/history")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetFiscalScheduleHistory(Guid id, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new GetFiscalScheduleHistoryQuery(id), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<IReadOnlyList<FiscalScheduleHistoryDto>>.Ok(r.Value));
    }

    [HttpGet("periods")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetPeriods(CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new GetAccountingPeriodsQuery(), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<IReadOnlyList<AccountingPeriodDto>>.Ok(r.Value));
    }

    [HttpPost("periods/{id:guid}/close")]
    [Authorize(Policy = PermissionPolicies.AccountingClose)]
    public async Task<IActionResult> ClosePeriod(Guid id, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new ClosePeriodCommand(id), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true));
    }

    [HttpPost("periods/{id:guid}/reopen")]
    [Authorize(Policy = PermissionPolicies.AccountingClose)]
    public async Task<IActionResult> ReopenPeriod(Guid id, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new ReopenPeriodCommand(id), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true));
    }

    [HttpPost("periods/close-year/{fiscalYear:int}")]
    [Authorize(Policy = PermissionPolicies.AccountingClose)]
    public async Task<IActionResult> CloseAnnualPeriod(int fiscalYear, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new CloseAnnualPeriodCommand(fiscalYear), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true));
    }

    [HttpPost("periods/opening-entries/{fiscalYear:int}")]
    [Authorize(Policy = PermissionPolicies.AccountingClose)]
    public async Task<IActionResult> GenerateOpeningEntries(int fiscalYear, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new GenerateOpeningEntriesCommand(fiscalYear), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<Guid>.Ok(r.Value));
    }

    /// <summary>
    /// Diagnostic des écritures d'à-nouveaux (« JAN ») actives : écarts ligne à ligne entre les
    /// soldes de clôture ancrés attendus et les lignes effectivement portées par l'à-nouveau.
    /// Lecture seule, aucune mutation.
    /// </summary>
    [HttpGet("periods/opening-entries/diagnose")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> DiagnoseOpeningEntries(CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new DiagnoseOpeningEntriesQuery(), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<IReadOnlyList<OpeningEntryDiagnosticDto>>.Ok(r.Value));
    }

    /// <summary>
    /// Répare l'à-nouveau contaminé de l'exercice clôturé <paramref name="fiscalYear"/> (extourne
    /// interne + régénération). Idempotente : aucun écart détecté → succès sans effet.
    /// </summary>
    [HttpPost("periods/opening-entries/{fiscalYear:int}/repair")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    public async Task<IActionResult> RepairOpeningEntries(int fiscalYear, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new RepairOpeningEntriesCommand(fiscalYear), cancellationToken);
        if (r.IsFailure)
        {
            // T27 — exercice verrouillé → Error.Conflict → 409, cohérent avec finalisation/upsert.
            if (string.Equals(r.Error.Code, "Conflict", StringComparison.OrdinalIgnoreCase))
                return Conflict(ApiResponse<object>.Fail(r.Error.Description, r.Error.Code));
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description, r.Error.Code));
        }
        return Ok(ApiResponse<bool>.Ok(true));
    }

    [HttpGet("pre-closing-checklist")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetPreClosingChecklist([FromQuery] int fiscalYear, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new GetPreClosingChecklistQuery(fiscalYear), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<PreClosingChecklistDto>.Ok(r.Value));
    }

    /// <summary>
    /// Centre de contrôle d'intégrité comptable (lecture seule). <paramref name="fiscalYear"/> absent
    /// = diagnostic global. N'effectue aucune mutation.
    /// </summary>
    [HttpGet("health")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetAccountingHealth([FromQuery] int? fiscalYear, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new GetAccountingHealthQuery(fiscalYear), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<AccountingHealthReportDto>.Ok(r.Value));
    }

    [HttpGet("inventory-entries/kinds")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetInventoryEntryKinds(CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new GetInventoryEntryKindsQuery(), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<IReadOnlyList<InventoryEntryKindDto>>.Ok(r.Value));
    }

    [HttpPost("inventory-entries")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    public async Task<IActionResult> CreateInventoryEntry([FromBody] CreateInventoryEntryRequest request, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new CreateAssistedInventoryEntryCommand(request), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<InventoryEntryResultDto>.Ok(r.Value, "Écriture d'inventaire enregistrée."));
    }

    [HttpGet("fiscal-year-locks")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetFiscalYearLocks(CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new GetFiscalYearLocksQuery(), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<IReadOnlyList<FiscalYearLockDto>>.Ok(r.Value));
    }

    [HttpPost("fiscal-year-lock/{fiscalYear:int}")]
    [Authorize(Policy = PermissionPolicies.AccountingClose)]
    public async Task<IActionResult> LockFiscalYear(int fiscalYear, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new LockFiscalYearCommand(fiscalYear), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true, "Exercice verrouillé définitivement."));
    }

    [HttpGet("balance-sheet")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetBalanceSheet([FromQuery] int fiscalYear, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new GetBalanceSheetQuery(fiscalYear), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<BalanceSheetDto>.Ok(r.Value));
    }

    [HttpGet("income-statement")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetIncomeStatement([FromQuery] int fiscalYear, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new GetIncomeStatementQuery(fiscalYear), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<IncomeStatementDto>.Ok(r.Value));
    }

    [HttpGet("balance-sheet/export")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> ExportBalanceSheet(
        [FromQuery] int fiscalYear,
        [FromQuery] AccountingExportFormat format = AccountingExportFormat.Csv,
        CancellationToken cancellationToken = default)
    {
        var r = await _mediator.Send(new ExportBalanceSheetQuery(fiscalYear, format), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return FileFor(r.Value, format, $"bilan_{fiscalYear}");
    }

    [HttpGet("income-statement/export")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> ExportIncomeStatement(
        [FromQuery] int fiscalYear,
        [FromQuery] AccountingExportFormat format = AccountingExportFormat.Csv,
        CancellationToken cancellationToken = default)
    {
        var r = await _mediator.Send(new ExportIncomeStatementQuery(fiscalYear, format), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return FileFor(r.Value, format, $"compte_resultat_{fiscalYear}");
    }

    [HttpGet("nct-statements")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetNctStatements([FromQuery] int fiscalYear, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new GetNctStatementsQuery(fiscalYear), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<NctFinancialStatementsDto>.Ok(r.Value));
    }

    // ── Liasse fiscale : détermination du résultat fiscal ────────────────────────────────

    [HttpGet("fiscal-result/catalog")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetFiscalAdjustmentCatalog(CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new GetFiscalAdjustmentCatalogQuery(), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<IReadOnlyList<FiscalAdjustmentCatalogEntryDto>>.Ok(r.Value));
    }

    [HttpGet("fiscal-result/{fiscalYear:int}")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetFiscalResult(int fiscalYear, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new GetFiscalResultDeclarationQuery(fiscalYear), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<FiscalResultDeclarationDto>.Ok(r.Value));
    }

    [HttpPost("fiscal-result/{fiscalYear:int}")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    public async Task<IActionResult> UpsertFiscalResult(int fiscalYear, [FromBody] UpsertFiscalResultRequest request, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new UpsertFiscalResultDeclarationCommand(fiscalYear, request), cancellationToken);
        if (r.IsFailure)
        {
            // T27 — sémantique 409 sur feuille finalisée (Error.Conflict, levée par UpsertAsync) ;
            // 400 sur les autres validations de contenu (TaxpayerKind, reports…). Mapping local par
            // code "Conflict" (patron FinalizeFiscalResult ci-dessous / StorefrontTenantController).
            if (string.Equals(r.Error.Code, "Conflict", StringComparison.OrdinalIgnoreCase))
                return Conflict(ApiResponse<object>.Fail(r.Error.Description, r.Error.Code));
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description, r.Error.Code));
        }
        return Ok(ApiResponse<FiscalResultDeclarationDto>.Ok(r.Value));
    }

    [HttpPost("fiscal-result/{fiscalYear:int}/finalize")]
    [Authorize(Policy = PermissionPolicies.FirmDelegatedContext)]
    public async Task<IActionResult> FinalizeFiscalResult(int fiscalYear, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new FinalizeFiscalResultDeclarationCommand(fiscalYear), cancellationToken);
        if (r.IsFailure)
        {
            // T10 — sémantique 409 sur les états finalisés/verrouillés/réconciliation (Error.Conflict),
            // 400 sur les autres validations (absence de feuille, ordre d'imputation…).
            if (string.Equals(r.Error.Code, "Conflict", StringComparison.OrdinalIgnoreCase))
                return Conflict(ApiResponse<object>.Fail(r.Error.Description, r.Error.Code));
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description, r.Error.Code));
        }
        return Ok(ApiResponse<object>.Ok(null!));
    }

    [HttpGet("fiscal-result/{fiscalYear:int}/export")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> ExportFiscalResult(
        int fiscalYear,
        [FromQuery] AccountingExportFormat format = AccountingExportFormat.Csv,
        CancellationToken cancellationToken = default)
    {
        var r = await _mediator.Send(new ExportFiscalResultQuery(fiscalYear, format), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return FileFor(r.Value, format, $"determination_fiscale_{fiscalYear}");
    }

    [HttpGet("liasse/{fiscalYear:int}/export")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> ExportConsolidatedLiasse(
        int fiscalYear,
        [FromQuery] AccountingExportFormat format = AccountingExportFormat.Pdf,
        CancellationToken cancellationToken = default)
    {
        var r = await _mediator.Send(new ExportConsolidatedLiasseQuery(fiscalYear, format), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return FileFor(r.Value, format, $"liasse_fiscale_{fiscalYear}");
    }

    // ── Personnalisation des notes annexes NCT ───────────────────────────────

    /// <summary>
    /// Catalogue des notes annexes (numéro, libellé par défaut, famille). Lecture pure, sans base —
    /// permet à l'écran de personnalisation de lister TOUTES les notes, y compris celles masquées
    /// (absentes de la liasse par construction).
    /// </summary>
    [HttpGet("nct-note-catalog")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetNctNoteCatalog(CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new GetNctNoteCatalogQuery(), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<IReadOnlyList<NctNoteCatalogEntryDto>>.Ok(r.Value));
    }

    [HttpGet("nct-note-overrides")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetNctNoteOverrides([FromQuery] int fiscalYear, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new GetNctNoteOverridesQuery(fiscalYear), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<IReadOnlyList<NctNoteOverrideDto>>.Ok(r.Value));
    }

    [HttpPut("nct-note-overrides")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    public async Task<IActionResult> UpsertNctNoteOverride(
        [FromBody] UpsertNctNoteOverrideRequest request, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new UpsertNctNoteOverrideCommand(request), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<NctNoteOverrideDto>.Ok(r.Value, "Personnalisation enregistrée."));
    }

    /// <summary>« Rétablir » : la note reprend le libellé du catalogue.</summary>
    [HttpDelete("nct-note-overrides/{fiscalYear:int}/{noteNumber:int}")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    public async Task<IActionResult> DeleteNctNoteOverride(int fiscalYear, int noteNumber, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new DeleteNctNoteOverrideCommand(fiscalYear, noteNumber), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true, "Personnalisation rétablie."));
    }

    /// <summary>Livre d'inventaire d'un exercice (édition légale figée) : états NCT + provisions détaillées + balance de clôture.</summary>
    [HttpGet("inventory-book/{fiscalYear:int}")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetInventoryBook(int fiscalYear, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new GetInventoryBookQuery(fiscalYear), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<InventoryBookDto>.Ok(r.Value));
    }

    [HttpGet("inventory-book/{fiscalYear:int}/export")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> ExportInventoryBook(
        int fiscalYear,
        [FromQuery] AccountingExportFormat format = AccountingExportFormat.Pdf,
        CancellationToken cancellationToken = default)
    {
        var r = await _mediator.Send(new ExportInventoryBookQuery(fiscalYear, format), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return FileFor(r.Value, format, $"livre_inventaire_{fiscalYear}");
    }

    // ── Emprunts et tableau d'amortissement (édition — aucune comptabilisation) ──────────

    [HttpGet("loans")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetLoans(
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 25,
        [FromQuery] string? search = null,
        [FromQuery] int? status = null,
        CancellationToken cancellationToken = default)
    {
        var r = await _mediator.Send(new GetLoansQuery(page, pageSize, search, status), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<LoanListDto>.Ok(r.Value));
    }

    [HttpPost("loans")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    public async Task<IActionResult> CreateLoan([FromBody] CreateLoanRequest request, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new CreateLoanCommand(request), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<Guid>.Ok(r.Value, "Emprunt créé et échéancier généré."));
    }

    /// <summary>Tableau d'amortissement d'un emprunt (échéancier + totaux + contrôle de solde).</summary>
    [HttpGet("loans/{id:guid}/schedule")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetLoanSchedule(Guid id, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new GetLoanScheduleQuery(id), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<LoanScheduleDto>.Ok(r.Value));
    }

    [HttpGet("loans/{id:guid}/schedule/export")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> ExportLoanSchedule(
        Guid id,
        [FromQuery] AccountingExportFormat format = AccountingExportFormat.Pdf,
        CancellationToken cancellationToken = default)
    {
        var r = await _mediator.Send(new ExportLoanScheduleQuery(id, format), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return FileFor(r.Value, format, $"echeancier_emprunt_{id:N}");
    }

    /// <summary>Archive ZIP du dossier (lecture seule) : plan comptable, journal, balance, tiers, FEC, manifeste.</summary>
    [HttpGet("dossier-export/{fiscalYear:int}")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> ExportDossierArchive(int fiscalYear, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new ExportDossierArchiveQuery(fiscalYear), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return File(r.Value, "application/zip", $"dossier_{fiscalYear}.zip");
    }

    // ── Paramètres fiscaux par exercice (taux IS, minimum d'impôt, CSS, barème IRPP) ─────

    [HttpGet("income-tax-parameters/{fiscalYear:int}")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetIncomeTaxParameters(int fiscalYear, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new GetIncomeTaxParametersQuery(fiscalYear), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<IncomeTaxYearParameterDto>.Ok(r.Value));
    }

    [HttpPut("income-tax-parameters/{fiscalYear:int}")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    public async Task<IActionResult> UpdateIncomeTaxParameters(
        int fiscalYear, [FromBody] IncomeTaxYearParameterDto parameters, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new UpdateIncomeTaxParametersCommand(fiscalYear, parameters), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<IncomeTaxYearParameterDto>.Ok(r.Value));
    }

    [HttpGet("account-replacement/preview")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    public async Task<IActionResult> PreviewAccountReplacement([FromQuery] string account, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new PreviewAccountReplacementQuery(account), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<int>.Ok(r.Value));
    }

    [HttpPost("account-replacement")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    public async Task<IActionResult> ReplaceAccount([FromBody] ReplaceAccountRequest request, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new ReplaceAccountCommand(request.OldAccount, request.NewAccount), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<int>.Ok(r.Value, $"{r.Value} ligne(s) modifiée(s)."));
    }

    // ── Devises et taux de change ──────────────────────────────────────────
    //
    // Lecture ouverte à accounting:read : la saisie d'écritures a besoin du catalogue et du taux
    // du mois. L'écriture exige accounting:currencies_manage, nettement plus restreinte — le taux
    // détermine le montant en dinar porté en comptabilité.

    [HttpGet("currencies")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetCurrencies([FromQuery] int fiscalYear, [FromQuery] bool includeInactive, CancellationToken cancellationToken)
    {
        var year = fiscalYear > 0 ? fiscalYear : DateTime.UtcNow.Year;
        var r = await _mediator.Send(new GetCurrenciesQuery(year, includeInactive), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<IReadOnlyList<CurrencyDto>>.Ok(r.Value));
    }

    [HttpGet("currencies/{id:guid}")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetCurrencyDetail(Guid id, [FromQuery] int fiscalYear, CancellationToken cancellationToken)
    {
        var year = fiscalYear > 0 ? fiscalYear : DateTime.UtcNow.Year;
        var r = await _mediator.Send(new GetCurrencyDetailQuery(id, year), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<CurrencyDetailDto>.Ok(r.Value));
    }

    [HttpPost("closing-revaluation")]
    [Authorize(Policy = PermissionPolicies.AccountingClose)]
    public async Task<IActionResult> RunClosingRevaluation([FromBody] RunClosingRevaluationRequest request, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new RunClosingRevaluationCommand(request), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<ClosingRevaluationResultDto>.Ok(r.Value));
    }

    [HttpGet("currencies/resolve-rate")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> ResolveExchangeRate([FromQuery] string currencyCode, [FromQuery] DateTime entryDate, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new ResolveExchangeRateQuery(currencyCode, entryDate), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<ResolvedExchangeRateDto>.Ok(r.Value));
    }

    [HttpPost("currencies")]
    [Authorize(Policy = PermissionPolicies.AccountingCurrenciesManage)]
    public async Task<IActionResult> CreateCurrency([FromBody] CreateCurrencyRequest request, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new CreateCurrencyCommand(request), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<Guid>.Ok(r.Value));
    }

    [HttpPut("currencies/{id:guid}")]
    [Authorize(Policy = PermissionPolicies.AccountingCurrenciesManage)]
    public async Task<IActionResult> UpdateCurrency(Guid id, [FromBody] UpdateCurrencyRequest request, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new UpdateCurrencyCommand(id, request), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true));
    }

    [HttpPatch("currencies/{id:guid}/toggle")]
    [Authorize(Policy = PermissionPolicies.AccountingCurrenciesManage)]
    public async Task<IActionResult> ToggleCurrency(Guid id, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new ToggleCurrencyCommand(id), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true));
    }

    [HttpPut("currencies/{id:guid}/rates")]
    [Authorize(Policy = PermissionPolicies.AccountingCurrenciesManage)]
    public async Task<IActionResult> SaveCurrencyRates(Guid id, [FromBody] SaveCurrencyRatesRequest request, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new SaveCurrencyRatesCommand(id, request), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true));
    }

    [HttpGet("journals")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetJournals([FromQuery] bool includeInactive, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new GetJournalsQuery(includeInactive), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<IReadOnlyList<JournalDto>>.Ok(r.Value));
    }

    [HttpGet("journal-families")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetJournalFamilies(CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new GetJournalFamiliesQuery(), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<IReadOnlyList<JournalFamilyDto>>.Ok(r.Value));
    }

    [HttpPost("journals")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    public async Task<IActionResult> CreateJournal([FromBody] CreateJournalRequest request, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new CreateJournalCommand(request), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<Guid>.Ok(r.Value));
    }

    [HttpPut("journals/{id:guid}")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    public async Task<IActionResult> UpdateJournal(Guid id, [FromBody] UpdateJournalRequest request, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new UpdateJournalCommand(id, request), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true));
    }

    [HttpPatch("journals/{id:guid}/toggle")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    public async Task<IActionResult> ToggleJournal(Guid id, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new ToggleJournalActiveCommand(id), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true));
    }

    [HttpPost("journal-families")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    public async Task<IActionResult> CreateJournalFamily([FromBody] CreateJournalFamilyRequest request, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new CreateJournalFamilyCommand(request), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<Guid>.Ok(r.Value));
    }

    // ── Déclaration mensuelle paramétrable ──────────────────────────────────

    /// <summary>
    /// Configuration de la déclaration mensuelle du dossier : régime de calcul, inclusion
    /// des onze familles et rubriques avec leurs comptes.
    /// </summary>
    /// <remarks>
    /// Lisible même drapeau éteint : la réponse porte <c>Settings.ConfigurableLinesEnabled</c>, que
    /// l'écran utilise pour expliquer l'inactivité plutôt que d'afficher une erreur.
    /// </remarks>
    [HttpGet("monthly-declaration/configuration")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetMonthlyDeclarationConfiguration(
        [FromQuery] bool includeInactive = true, CancellationToken cancellationToken = default)
    {
        var r = await _mediator.Send(
            new GetMonthlyDeclarationConfigurationQuery(includeInactive), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<MonthlyDeclarationConfigurationDto>.Ok(r.Value));
    }

    [HttpPost("monthly-declaration/rubrics")]
    [Authorize(Policy = PermissionPolicies.AccountingDeclare)]
    public async Task<IActionResult> CreateMonthlyDeclarationRubric(
        [FromBody] CreateMonthlyDeclarationRubricRequest request, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new CreateMonthlyDeclarationRubricCommand(request), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<Guid>.Ok(r.Value));
    }

    [HttpPut("monthly-declaration/rubrics/{id:guid}")]
    [Authorize(Policy = PermissionPolicies.AccountingDeclare)]
    public async Task<IActionResult> UpdateMonthlyDeclarationRubric(
        Guid id, [FromBody] UpdateMonthlyDeclarationRubricRequest request, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new UpdateMonthlyDeclarationRubricCommand(id, request), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true));
    }

    [HttpPatch("monthly-declaration/rubrics/{id:guid}/toggle")]
    [Authorize(Policy = PermissionPolicies.AccountingDeclare)]
    public async Task<IActionResult> ToggleMonthlyDeclarationRubric(Guid id, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new ToggleMonthlyDeclarationRubricCommand(id), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true));
    }

    [HttpDelete("monthly-declaration/rubrics/{id:guid}")]
    [Authorize(Policy = PermissionPolicies.AccountingDeclare)]
    public async Task<IActionResult> DeleteMonthlyDeclarationRubric(Guid id, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new DeleteMonthlyDeclarationRubricCommand(id), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true));
    }

    [HttpPut("monthly-declaration/families")]
    [Authorize(Policy = PermissionPolicies.AccountingDeclare)]
    public async Task<IActionResult> SetMonthlyDeclarationFamily(
        [FromBody] SetMonthlyDeclarationFamilyRequest request, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new SetMonthlyDeclarationFamilyCommand(request), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true));
    }

    /// <summary>
    /// « Calcul DM » : évalue la configuration du dossier sur une période et rend le détail obtenu,
    /// sans rien déposer. En contrôle de parité, consigne l'écart avec le calcul historique.
    /// </summary>
    [HttpPost("monthly-declaration/compute")]
    [Authorize(Policy = PermissionPolicies.AccountingDeclare)]
    public async Task<IActionResult> ComputeMonthlyDeclaration(
        [FromQuery] int year, [FromQuery] int month, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new ComputeMonthlyDeclarationCommand(year, month), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<VatDeclarationDto>.Ok(r.Value));
    }

    /// <summary>
    /// Rapport de parité : pour chaque mois de la plage, le calcul historique face au calcul
    /// paramétré tel qu'il sera après le retrait de l'historique — montants par famille et cases du
    /// formulaire officiel. Lecture pure : ni le régime ni la rampe ne sont touchés.
    /// </summary>
    /// <remarks>
    /// Sous <c>accounting:declare</c> et réservé au cabinet délégué (vérifié par le handler) : le
    /// rapport expose des montants de brouillon, que la société ne voit pas. Route temporaire,
    /// retirée avec le calcul historique.
    /// </remarks>
    [HttpGet("monthly-declaration/parity-report")]
    [Authorize(Policy = PermissionPolicies.AccountingDeclare)]
    public async Task<IActionResult> GetMonthlyDeclarationParityReport(
        [FromQuery] int year, [FromQuery] int fromMonth, [FromQuery] int toMonth, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(
            new GetMonthlyDeclarationParityReportQuery(year, fromMonth, toMonth), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<MonthlyDeclarationParityReportDto>.Ok(r.Value));
    }

    /// <summary>
    /// Reprend la configuration DM d'un autre dossier du cabinet. Le dossier source est vérifié
    /// côté serveur contre le portefeuille du cabinet appelant.
    /// </summary>
    [HttpPost("monthly-declaration/duplicate")]
    [Authorize(Policy = PermissionPolicies.AccountingDeclare)]
    public async Task<IActionResult> DuplicateMonthlyDeclarationConfig(
        [FromBody] DuplicateMonthlyDeclarationConfigRequest request, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new DuplicateMonthlyDeclarationConfigCommand(request), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<MonthlyDeclarationDuplicationResultDto>.Ok(r.Value));
    }

    /// <summary>
    /// « Suivi DM » : les douze mois d'un exercice — ce qui est déposé, ce qui ne l'est pas, sous
    /// quel régime, et où en est la rampe du dossier.
    /// </summary>
    /// <remarks>
    /// Lecture seule, ouverte à la société comme au cabinet : le suivi ne dit rien qu'un dossier ne
    /// puisse savoir de ses propres dépôts. Disponible drapeau éteint.
    /// </remarks>
    [HttpGet("monthly-declaration/tracking")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetMonthlyDeclarationTracking(
        [FromQuery] int year, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new GetMonthlyDeclarationTrackingQuery(year), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<MonthlyDeclarationTrackingDto>.Ok(r.Value));
    }

    /// <summary>
    /// « Modèle Intégration DM » — export : rend la configuration du dossier au format d'échange.
    /// </summary>
    /// <remarks>
    /// Sous <c>accounting:read</c> et disponible drapeau éteint : le fichier ne fait que refléter
    /// des données déjà lisibles à l'écran.
    /// </remarks>
    [HttpGet("monthly-declaration/model")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> ExportMonthlyDeclarationModel(CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new ExportMonthlyDeclarationModelQuery(), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<MonthlyDeclarationModelFileDto>.Ok(r.Value));
    }

    /// <summary>
    /// « Modèle Intégration DM » — import : applique un fichier de modèle au dossier courant.
    /// </summary>
    /// <remarks>
    /// Tout ou rien à l'analyse : une seule entrée fautive fait échouer le fichier entier, et le
    /// refus nomme les entrées en cause. L'écriture, elle, n'insère et ne remplace que des codes
    /// présents dans le fichier — rien n'est supprimé en masse.
    /// </remarks>
    [HttpPost("monthly-declaration/model")]
    [Authorize(Policy = PermissionPolicies.AccountingDeclare)]
    public async Task<IActionResult> ImportMonthlyDeclarationModel(
        [FromBody] ImportMonthlyDeclarationModelRequest request, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new ImportMonthlyDeclarationModelCommand(request), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<MonthlyDeclarationModelImportResultDto>.Ok(r.Value));
    }

    /// <summary>
    /// Change le régime de calcul du dossier (historique / contrôle de parité / configuré).
    /// Le passage en configuré exige une série de contrôles sans écart, ou une dérogation motivée.
    /// </summary>
    [HttpPut("monthly-declaration/mode")]
    [Authorize(Policy = PermissionPolicies.AccountingDeclare)]
    public async Task<IActionResult> SetMonthlyDeclarationMode(
        [FromBody] SetMonthlyDeclarationModeRequest request, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new SetMonthlyDeclarationModeCommand(request), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true));
    }

    // ── Comptabilité budgétaire ─────────────────────────────────────────────

    [HttpGet("budget-posts")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetBudgetPosts([FromQuery] bool includeInactive, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new GetBudgetPostsQuery(includeInactive), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<IReadOnlyList<BudgetPostDto>>.Ok(r.Value));
    }

    [HttpPost("budget-posts")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    public async Task<IActionResult> CreateBudgetPost([FromBody] CreateBudgetPostRequest request, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new CreateBudgetPostCommand(request), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<Guid>.Ok(r.Value));
    }

    [HttpPut("budget-posts/{id:guid}")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    public async Task<IActionResult> UpdateBudgetPost(Guid id, [FromBody] UpdateBudgetPostRequest request, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new UpdateBudgetPostCommand(id, request), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true));
    }

    [HttpPatch("budget-posts/{id:guid}/toggle")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    public async Task<IActionResult> ToggleBudgetPost(Guid id, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new ToggleBudgetPostCommand(id), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true));
    }

    /// <summary>Grille budgétaire d'un exercice : postes × 12 mois, versions Initial et Révisé + statut.</summary>
    [HttpGet("budgets/{fiscalYear:int}")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetBudgetYear(int fiscalYear, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new GetBudgetYearQuery(fiscalYear), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<BudgetYearGridDto>.Ok(r.Value));
    }

    /// <summary>Enregistre la version modifiable (Initial en brouillon, Révisé après validation).</summary>
    [HttpPut("budgets/{fiscalYear:int}")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    public async Task<IActionResult> SaveBudgetYear(int fiscalYear, [FromBody] SaveBudgetYearRequest request, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new SaveBudgetYearCommand(fiscalYear, request), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true, "Budget enregistré."));
    }

    /// <summary>Valide (fige) le budget initial : copie Initial → Révisé, seule version modifiable ensuite.</summary>
    [HttpPost("budgets/{fiscalYear:int}/validate-initial")]
    [Authorize(Policy = PermissionPolicies.AccountingValidate)]
    [Authorize(Policy = PermissionPolicies.FirmDelegatedContext)]
    public async Task<IActionResult> ValidateInitialBudget(int fiscalYear, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new ValidateInitialBudgetCommand(fiscalYear), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true, "Budget initial validé."));
    }

    /// <summary>État budgétaire : budget (Initial/Révisé) vs réalisé par poste, écart et % consommation.</summary>
    [HttpGet("budget-report")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetBudgetReport(
        [FromQuery] int fiscalYear, [FromQuery] int? throughMonth, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new GetBudgetReportQuery(fiscalYear, throughMonth), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<BudgetReportDto>.Ok(r.Value));
    }

    [HttpGet("budget-report/export")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> ExportBudgetReport(
        [FromQuery] int fiscalYear, [FromQuery] int? throughMonth, [FromQuery] string format,
        CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new ExportBudgetReportQuery(fiscalYear, throughMonth, format ?? "csv"), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));

        var isExcel = string.Equals(format, "excel", StringComparison.OrdinalIgnoreCase);
        return File(r.Value,
            isExcel ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv",
            $"etat_budgetaire_{fiscalYear}.{(isExcel ? "xlsx" : "csv")}");
    }

    // ── Plan tiers unifié ───────────────────────────────────────────────────

    /// <summary>Répertoire unifié des tiers (clients + fournisseurs) : codes auxiliaires, collectifs, soldes.</summary>
    [HttpGet("third-parties")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetThirdPartyDirectory(
        [FromQuery] int? kind, [FromQuery] string? search, [FromQuery] bool includeInactive,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 25, CancellationToken cancellationToken = default)
    {
        var r = await _mediator.Send(new GetThirdPartyDirectoryQuery(kind, search, includeInactive, page, pageSize), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<ThirdPartyDirectoryResultDto>.Ok(r.Value));
    }

    [HttpGet("third-parties/{kind:int}/{id:guid}/profile")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetThirdPartyProfile(int kind, Guid id, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new GetThirdPartyProfileQuery(kind, id), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<ThirdPartyProfileDto>.Ok(r.Value));
    }

    [HttpPut("third-parties/{kind:int}/{id:guid}/profile")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    public async Task<IActionResult> UpsertThirdPartyProfile(
        int kind, Guid id, [FromBody] UpsertThirdPartyProfileRequest request, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new UpsertThirdPartyProfileCommand(kind, id, request), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true, "Fiche tiers enregistrée."));
    }

    /// <summary>Génère les codes auxiliaires manquants (C0001…/F0001…) pour les tiers actifs.</summary>
    [HttpPost("third-parties/ensure-codes")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    public async Task<IActionResult> EnsureThirdPartyCodes(CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new EnsureAuxiliaryCodesCommand(), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<int>.Ok(r.Value, $"{r.Value} code(s) auxiliaire(s) généré(s)."));
    }

    [HttpGet("search")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> SearchEntries(
        [FromQuery] string? account, [FromQuery] string? journalCode,
        [FromQuery] DateTime? from, [FromQuery] DateTime? to,
        [FromQuery] decimal? minAmount, [FromQuery] decimal? maxAmount,
        [FromQuery] string? label, [FromQuery] string? lettering,
        [FromQuery] int? status, [FromQuery] int take,
        [FromQuery] string? pieceRef,
        [FromQuery] int? entryNumber,
        CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new SearchJournalEntriesQuery(
            account, journalCode, from, to, minAmount, maxAmount, label, lettering, status, take, pieceRef, entryNumber), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<IReadOnlyList<JournalSearchRowDto>>.Ok(r.Value));
    }

    [HttpGet("dashboard")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetDashboard(CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new GetAccountingDashboardQuery(), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<AccountingDashboardDto>.Ok(r.Value));
    }

    [HttpPost("letter")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    public async Task<IActionResult> Letter([FromBody] LetterEntriesRequest request, CancellationToken cancellationToken)
    {
        var origin = ParseOrigin(request.Origin);
        var r = await _mediator.Send(
            new LetterAccountEntriesCommand(request.JournalEntryLineIds, request.AllowPartial, origin, request.SuggestionKey),
            cancellationToken);
        return r.IsFailure ? LetteringFailure(r.Error) : Ok(ApiResponse<LetteringResultDto>.Ok(r.Value));
    }

    /// <summary>« Compléter un lettrage partiel » (plan §4.4, D7) : termine un groupe « P » sans délettrage.</summary>
    [HttpPost("lettering/groups/{code}/complete")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    public async Task<IActionResult> CompletePartialLettering(
        string code, [FromBody] CompletePartialLetteringRequest request, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(
            new CompletePartialLetteringCommand(code, request.JournalEntryLineIds, request.AllowPartial), cancellationToken);
        return r.IsFailure ? LetteringFailure(r.Error) : Ok(ApiResponse<LetteringResultDto>.Ok(r.Value));
    }

    /// <summary>Lignes de l'écran de lettrage, filtrées et paginées côté serveur (plan §4.1).</summary>
    [HttpGet("lettering/lines")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetLetteringLines(
        [FromQuery] string account,
        [FromQuery] LetteringAccountMatch accountMatch = LetteringAccountMatch.Exact,
        [FromQuery] DateTime from = default,
        [FromQuery] DateTime to = default,
        [FromQuery] LetteringStateFilter state = LetteringStateFilter.All,
        [FromQuery] string? journalCode = null,
        [FromQuery] IReadOnlyList<string>? sourceCategories = null,
        [FromQuery] Guid? thirdPartyId = null,
        [FromQuery] ThirdPartyKind? thirdPartyKind = null,
        [FromQuery] LetteringSideFilter side = LetteringSideFilter.All,
        [FromQuery] decimal? minAmount = null,
        [FromQuery] decimal? maxAmount = null,
        [FromQuery] string? search = null,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 500,
        CancellationToken cancellationToken = default)
    {
        var query = new GetLetteringLinesQuery(
            account, accountMatch, from, to, state, journalCode, sourceCategories,
            thirdPartyId, thirdPartyKind, side, minAmount, maxAmount, search, page, pageSize);
        var r = await _mediator.Send(query, cancellationToken);
        return r.IsFailure ? LetteringFailure(r.Error) : Ok(ApiResponse<LetteringLinesPageDto>.Ok(r.Value));
    }

    /// <summary>Détail d'un groupe de lettrage, avant délettrage ou complétion (plan §4.2).</summary>
    [HttpGet("lettering/groups/{code}")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetLetteringGroup(string code, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new GetLetteringGroupQuery(code), cancellationToken);
        return r.IsFailure ? LetteringFailure(r.Error) : Ok(ApiResponse<LetteringGroupDto>.Ok(r.Value));
    }

    private static LetteringOrigin ParseOrigin(string? origin) =>
        Enum.TryParse<LetteringOrigin>(origin, ignoreCase: true, out var parsed) ? parsed : LetteringOrigin.Manual;

    /// <summary>Mappe les codes d'erreur stables du lettrage (plan §4.6) vers le statut HTTP attendu.</summary>
    private IActionResult LetteringFailure(FactuTrust.Domain.Common.Error error)
    {
        var body = ApiResponse<object>.FailWithCode(error.Description, error.Code);
        return error.Code switch
        {
            LetteringErrorCodes.AlreadyLettered or LetteringErrorCodes.PeriodLocked => Conflict(body),
            LetteringErrorCodes.GroupNotFound => NotFound(body),
            _ => BadRequest(body)
        };
    }

    [HttpPost("lettering/settle-exchange-difference")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    public async Task<IActionResult> SettleExchangeDifference([FromBody] SettleExchangeDifferenceRequest request, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(
            new SettleExchangeDifferenceCommand(request.JournalEntryLineIds, request.AccountNumber), cancellationToken);
        if (r.IsFailure)
            return LetteringFailure(r.Error);
        return Ok(ApiResponse<Guid>.Ok(r.Value));
    }

    [HttpPost("unletter")]
    [Authorize(Policy = PermissionPolicies.AccountingUnletter)]
    public async Task<IActionResult> Unletter([FromBody] UnletterEntriesRequest request, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new UnletterAccountEntriesCommand(request.Code), cancellationToken);
        return r.IsFailure ? LetteringFailure(r.Error) : Ok(ApiResponse<bool>.Ok(true));
    }

    [HttpGet("journal/export")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> ExportJournal(
        [FromQuery] string? journalCode,
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] AccountingExportFormat format = AccountingExportFormat.Csv,
        CancellationToken cancellationToken = default)
    {
        if (!from.HasValue || !to.HasValue)
            return BadRequest(ApiResponse<object>.Fail("Les paramètres from et to sont requis."));

        var r = await _mediator.Send(new ExportJournalCsvQuery(journalCode, from.Value, to.Value, format), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));

        return FileFor(r.Value, format, $"journal_{from.Value:yyyyMMdd}_{to.Value:yyyyMMdd}");
    }

    [HttpGet("ledger/export")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> ExportLedger(
        [FromQuery] string accountNumber,
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] AccountingExportFormat format = AccountingExportFormat.Csv,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(accountNumber) || !from.HasValue || !to.HasValue)
            return BadRequest(ApiResponse<object>.Fail("accountNumber, from et to sont requis."));

        var r = await _mediator.Send(new ExportLedgerCsvQuery(accountNumber, from.Value, to.Value, format), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));

        return FileFor(r.Value, format, $"grand_livre_{accountNumber}_{from.Value:yyyyMMdd}_{to.Value:yyyyMMdd}");
    }

    [HttpGet("balance/export")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> ExportBalance(
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] AccountingExportFormat format = AccountingExportFormat.Csv,
        CancellationToken cancellationToken = default)
    {
        if (!from.HasValue || !to.HasValue)
            return BadRequest(ApiResponse<object>.Fail("from et to sont requis."));

        var r = await _mediator.Send(new ExportBalanceCsvQuery(from.Value, to.Value, format), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));

        return FileFor(r.Value, format, $"balance_{from.Value:yyyyMMdd}_{to.Value:yyyyMMdd}");
    }

    [HttpGet("fec/export/{fiscalYear:int}")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> ExportFec(int fiscalYear, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new ExportFecQuery(fiscalYear), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return File(r.Value, "text/tab-separated-values", $"FEC_{fiscalYear}.txt");
    }

    [HttpGet("vat-declaration/pdf")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> ExportVatDeclarationPdf([FromQuery] int year, [FromQuery] int month, CancellationToken cancellationToken)
    {
        var enforceCompanySubmittedOnly = !_currentUser.IsAccountingFirmDelegatedContext;
        var r = await _mediator.Send(new ExportVatDeclarationPdfQuery(year, month, enforceCompanySubmittedOnly), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return File(r.Value, "application/pdf", $"declaration_{year}_{month:D2}.pdf");
    }

    /// <summary>
    /// Édite la déclaration mensuelle sur le formulaire officiel de la DGI
    /// (« التصريح الشهري بالأداءات »), prêt à être déposé à la recette des finances.
    /// Soumis au drapeau <c>Accounting:MonthlyDeclarationOfficialFormEnabled</c>.
    /// </summary>
    [HttpGet("vat-declaration/official-pdf")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> ExportMonthlyDeclarationOfficialForm([FromQuery] int year, [FromQuery] int month, CancellationToken cancellationToken)
    {
        var enforceCompanySubmittedOnly = !_currentUser.IsAccountingFirmDelegatedContext;
        var r = await _mediator.Send(new ExportMonthlyDeclarationOfficialFormQuery(year, month, enforceCompanySubmittedOnly), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return File(r.Value, "application/pdf", $"declaration_officielle_{year}_{month:D2}.pdf");
    }

    /// <summary>
    /// Export PDF NCT. Sans paramètres de filtre → PDF legacy intégral (notes agrégées).
    /// Avec <paramref name="filtered"/>=true (ou tout paramètre de sélection) → PDF dialogue filtré.
    /// </summary>
    [HttpGet("nct-statements/pdf")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> ExportNctStatementsPdf(
        [FromQuery] int fiscalYear,
        [FromQuery] bool? filtered = null,
        [FromQuery] DateOnly? asOfDate = null,
        [FromQuery] NctPreviousYearLabelMode? previousYearLabelMode = null,
        [FromQuery] bool? includeAssets = null,
        [FromQuery] bool? includeLiabilities = null,
        [FromQuery] bool? includeIncomeStatement = null,
        [FromQuery] bool? includeCashFlow = null,
        [FromQuery] bool? includeAnnexAssets = null,
        [FromQuery] bool? includeAnnexLiabilities = null,
        [FromQuery] bool? includeAnnexIncomeStatement = null,
        [FromQuery] bool? includeAnnexCashFlow = null,
        [FromQuery] string? notes = null,
        CancellationToken cancellationToken = default)
    {
        NctLiasseExportOptions? options = null;
        var useFiltered = filtered == true
            || asOfDate.HasValue
            || previousYearLabelMode.HasValue
            || includeAssets.HasValue
            || includeLiabilities.HasValue
            || includeIncomeStatement.HasValue
            || includeCashFlow.HasValue
            || includeAnnexAssets.HasValue
            || includeAnnexLiabilities.HasValue
            || includeAnnexIncomeStatement.HasValue
            || includeAnnexCashFlow.HasValue
            || !string.IsNullOrWhiteSpace(notes);

        if (useFiltered)
        {
            var noteNumbers = ParseNoteNumbers(notes);
            options = new NctLiasseExportOptions
            {
                FiscalYear = fiscalYear,
                AsOfDate = asOfDate ?? new DateOnly(fiscalYear, 12, 31),
                PreviousYearLabelMode = previousYearLabelMode ?? NctPreviousYearLabelMode.YearEnd31Dec,
                IncludeAssets = includeAssets ?? false,
                IncludeLiabilities = includeLiabilities ?? false,
                IncludeIncomeStatement = includeIncomeStatement ?? false,
                IncludeCashFlow = includeCashFlow ?? false,
                IncludeAnnexAssets = includeAnnexAssets ?? false,
                IncludeAnnexLiabilities = includeAnnexLiabilities ?? false,
                IncludeAnnexIncomeStatement = includeAnnexIncomeStatement ?? false,
                IncludeAnnexCashFlow = includeAnnexCashFlow ?? false,
                SelectedNoteNumbers = noteNumbers
            };
        }

        var r = await _mediator.Send(new ExportNctStatementsPdfQuery(fiscalYear, options), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return File(r.Value, "application/pdf", $"liasse_nct_{fiscalYear}.pdf");
    }

    private static IReadOnlyList<int> ParseNoteNumbers(string? notes)
    {
        if (string.IsNullOrWhiteSpace(notes))
            return Array.Empty<int>();

        return notes
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(s => int.TryParse(s, out var n) ? n : (int?)null)
            .Where(n => n.HasValue)
            .Select(n => n!.Value)
            .Distinct()
            .ToList();
    }

    /// <summary>
    /// Regenerates missing accounting journal entries for validated invoices.
    /// This is a remediation endpoint for invoices that failed accounting entry
    /// generation due to missing chart of accounts entries (e.g., account 4371).
    /// The operation is idempotent — invoices with existing entries are skipped.
    /// </summary>
    [HttpPost("regenerate-invoice-entries")]
    [Authorize(Policy = PermissionPolicies.AccountingClose)]
    public async Task<IActionResult> RegenerateInvoiceEntries(CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new RegenerateInvoiceAccountingEntriesCommand(), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<RegenerateInvoiceAccountingEntriesResult>.Ok(r.Value));
    }

    // -----------------------------------------------------------------------
    // Journal entry templates (reusable presets for manual entry)
    // -----------------------------------------------------------------------

    [HttpGet("journal-templates")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetJournalTemplates(
        [FromQuery] bool? activeOnly,
        [FromQuery] string? search,
        CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new GetJournalEntryTemplatesQuery(activeOnly ?? true, search), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<IReadOnlyList<JournalEntryTemplateDto>>.Ok(r.Value));
    }

    [HttpGet("journal-templates/{id:guid}")]
    [Authorize(Policy = PermissionPolicies.AccountingRead)]
    public async Task<IActionResult> GetJournalTemplate(Guid id, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new GetJournalEntryTemplateByIdQuery(id), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<JournalEntryTemplateDto>.Ok(r.Value));
    }

    [HttpPost("journal-templates")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    public async Task<IActionResult> CreateJournalTemplate(
        [FromBody] CreateJournalEntryTemplateRequest request,
        CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new CreateJournalEntryTemplateCommand(request), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<Guid>.Ok(r.Value));
    }

    [HttpPut("journal-templates/{id:guid}")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    public async Task<IActionResult> UpdateJournalTemplate(
        Guid id,
        [FromBody] UpdateJournalEntryTemplateRequest request,
        CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new UpdateJournalEntryTemplateCommand(id, request), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true));
    }

    /// <summary>
    /// Génère immédiatement l'occurrence courante d'un modèle récurrent (« Générer maintenant »).
    /// L'échéance suivante est avancée comme pour une exécution planifiée.
    /// </summary>
    [HttpPost("journal-templates/{id:guid}/run-recurrence")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    public async Task<IActionResult> RunTemplateRecurrence(Guid id, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new RunTemplateRecurrenceCommand(id), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<Guid>.Ok(r.Value, "Écriture récurrente générée."));
    }

    [HttpDelete("journal-templates/{id:guid}")]
    [Authorize(Policy = PermissionPolicies.AccountingCreate)]
    public async Task<IActionResult> DeleteJournalTemplate(Guid id, CancellationToken cancellationToken)
    {
        var r = await _mediator.Send(new DeleteJournalEntryTemplateCommand(id), cancellationToken);
        if (r.IsFailure)
            return BadRequest(ApiResponse<object>.Fail(r.Error.Description));
        return Ok(ApiResponse<bool>.Ok(true));
    }
}
