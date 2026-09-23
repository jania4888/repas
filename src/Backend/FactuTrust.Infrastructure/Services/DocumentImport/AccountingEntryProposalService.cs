using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.AI;
using FactuTrust.Application.Features.Accounting;
using FactuTrust.Application.Features.Accounting.DocumentImport;
using FactuTrust.Application.Features.Clients.Queries;
using FactuTrust.Application.Features.Products.Queries;
using FactuTrust.Application.Features.Suppliers.Queries;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.MultiTenancy;
using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace FactuTrust.Infrastructure.Services.DocumentImport;

/// <inheritdoc cref="IAccountingEntryProposalService"/>
public sealed class AccountingEntryProposalService : IAccountingEntryProposalService
{
    /// <summary>Seuil de similarité du rapprochement par nom, aligné sur l'import de facture existant.</summary>
    private const double NameMatchThreshold = 0.9;

    private const int MaxLinesToMatch = 50;

    private readonly IChartOfAccountRepository _chartOfAccounts;
    private readonly IAccountingPeriodRepository _periods;
    private readonly ICompanyRepository _companies;
    private readonly IThirdPartyDirectoryService _thirdPartyDirectory;
    private readonly ITenantDbContextFactory _contextFactory;
    private readonly IMediator _mediator;
    private readonly ILogger<AccountingEntryProposalService> _logger;

    public AccountingEntryProposalService(
        IChartOfAccountRepository chartOfAccounts,
        IAccountingPeriodRepository periods,
        ICompanyRepository companies,
        IThirdPartyDirectoryService thirdPartyDirectory,
        ITenantDbContextFactory contextFactory,
        IMediator mediator,
        ILogger<AccountingEntryProposalService> logger)
    {
        _chartOfAccounts = chartOfAccounts;
        _periods = periods;
        _companies = companies;
        _thirdPartyDirectory = thirdPartyDirectory;
        _contextFactory = contextFactory;
        _mediator = mediator;
        _logger = logger;
    }

    public async Task<Result<JournalEntryProposalDto>> ProposeAsync(
        AccountingDocumentExtractionDto document,
        string? directionOverride,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(document);

        var diagnostics = new List<ProposalDiagnosticDto>();

        foreach (var warning in document.Warnings)
        {
            diagnostics.Add(new ProposalDiagnosticDto(
                ProposalSeverities.Warning, ProposalDiagnosticCodes.ExtractionWarning, warning));
        }

        // 1. Sens de la pièce.
        var (direction, directionReason) = await ResolveDirectionAsync(
            document, directionOverride, diagnostics, cancellationToken);

        var isSale = direction == DocumentDirections.Sale;
        var journalCode = isSale
            ? TunisianPostingAccounts.SalesJournalCode
            : TunisianPostingAccounts.PurchaseJournalCode;

        // 2. Tiers : rapprochement par matricule fiscal puis par nom.
        var party = isSale ? document.Buyer : document.Seller;
        var thirdParty = await MatchThirdPartyAsync(party, isSale, diagnostics, cancellationToken);

        // 3. Comptes.
        var accounts = await ResolveAccountPlanAsync(document, isSale, thirdParty, cancellationToken);

        // 4. Lignes — équilibrées par construction.
        var rawLines = AccountingEntryLineMapper.Build(document, direction, accounts, thirdParty);
        var lines = await AnnotateAccountsAsync(rawLines, diagnostics, cancellationToken);

        var totalDebit = lines.Sum(l => l.Debit);
        var totalCredit = lines.Sum(l => l.Credit);

        // 5. Contrôles.
        AddTotalsDiagnostics(document, totalCredit, totalDebit, isSale, diagnostics);
        AddDocumentTypeDiagnostics(document, diagnostics);
        await AddDateDiagnosticsAsync(document, diagnostics, cancellationToken);
        await AddDuplicateDiagnosticsAsync(document, journalCode, diagnostics, cancellationToken);

        var label = BuildEntryLabel(isSale, document);

        _logger.LogInformation(
            "[AccountingDocumentImport] Proposition {Direction} {Journal} pour {Number} : "
            + "{LineCount} lignes, débit={Debit} crédit={Credit}, {DiagnosticCount} diagnostic(s)",
            direction, journalCode, document.DocumentNumber, lines.Count, totalDebit, totalCredit,
            diagnostics.Count);

        return Result.Success(new JournalEntryProposalDto
        {
            Direction = direction,
            DirectionReason = directionReason,
            JournalCode = journalCode,
            EntryDate = document.IssueDate,
            Label = label,
            PieceRef = TruncatePieceRef(document.DocumentNumber),
            PieceDate = document.IssueDate,
            ThirdParty = thirdParty,
            Lines = lines,
            TotalDebit = totalDebit,
            TotalCredit = totalCredit,
            DocumentTotalTtc = document.TotalTtc,
            Extraction = document,
            Diagnostics = diagnostics
        });
    }

    // ========================================================================
    // 1. Sens de la pièce
    // ========================================================================

    private async Task<(string Direction, string? Reason)> ResolveDirectionAsync(
        AccountingDocumentExtractionDto document,
        string? directionOverride,
        List<ProposalDiagnosticDto> diagnostics,
        CancellationToken cancellationToken)
    {
        if (directionOverride is DocumentDirections.Sale or DocumentDirections.Purchase)
            return (directionOverride, "Sens choisi manuellement.");

        var company = (await _companies.GetAllAsync(cancellationToken)).FirstOrDefault();
        if (company is null)
        {
            diagnostics.Add(new ProposalDiagnosticDto(
                ProposalSeverities.Warning,
                ProposalDiagnosticCodes.DirectionAmbiguous,
                "Les informations de votre société ne sont pas renseignées : le sens de la pièce "
                + "(achat ou vente) n'a pas pu être déterminé. Vérifiez-le avant d'appliquer."));
            return (DocumentDirections.Purchase, null);
        }

        if (SameMatricule(company.Nif?.Value, document.Seller?.Nif))
            return (DocumentDirections.Sale, "Émetteur = votre société (matricule fiscal identique).");

        if (SameMatricule(company.Nif?.Value, document.Buyer?.Nif))
            return (DocumentDirections.Purchase, "Destinataire = votre société (matricule fiscal identique).");

        var sellerScore = InvoiceImportParsing.Similarity(company.Name, document.Seller?.Name);
        var buyerScore = InvoiceImportParsing.Similarity(company.Name, document.Buyer?.Name);

        if (sellerScore >= NameMatchThreshold && sellerScore >= buyerScore)
            return (DocumentDirections.Sale, "Émetteur = votre société (nom correspondant).");

        if (buyerScore >= NameMatchThreshold)
            return (DocumentDirections.Purchase, "Destinataire = votre société (nom correspondant).");

        diagnostics.Add(new ProposalDiagnosticDto(
            ProposalSeverities.Warning,
            ProposalDiagnosticCodes.DirectionAmbiguous,
            "Ni l'émetteur ni le destinataire de la pièce ne correspondent à votre société : "
            + "le sens a été supposé « achat ». Corrigez-le si nécessaire."));

        return (DocumentDirections.Purchase, null);
    }

    // ========================================================================
    // 2. Rapprochement du tiers
    // ========================================================================

    private async Task<ProposedThirdPartyDto> MatchThirdPartyAsync(
        ExtractedPartyDto? party,
        bool isSale,
        List<ProposalDiagnosticDto> diagnostics,
        CancellationToken cancellationToken)
    {
        var kind = isSale ? (int)ThirdPartyKind.Client : (int)ThirdPartyKind.Supplier;
        var defaultAccount = isSale
            ? TunisianPostingAccounts.Client
            : TunisianPostingAccounts.Supplier;

        var baseDto = new ProposedThirdPartyDto
        {
            Kind = kind,
            CollectiveAccountNumber = defaultAccount,
            Name = party?.Name,
            Nif = party?.Nif,
            Email = party?.Email,
            Phone = party?.Phone,
            Street = party?.Street,
            City = party?.City,
            PostalCode = party?.PostalCode,
            Governorate = party?.Governorate
        };

        var name = (party?.Name ?? string.Empty).Trim();
        var nif = (party?.Nif ?? string.Empty).Trim();
        if (name.Length == 0 && nif.Length == 0)
        {
            diagnostics.Add(new ProposalDiagnosticDto(
                ProposalSeverities.Warning,
                ProposalDiagnosticCodes.ThirdPartyNotMatched,
                isSale
                    ? "Aucun client n'a pu être identifié sur la pièce. Rattachez-en un dans la grille."
                    : "Aucun fournisseur n'a pu être identifié sur la pièce. Rattachez-en un dans la grille."));
            return baseDto;
        }

        var match = isSale
            ? await MatchClientAsync(name, nif, cancellationToken)
            : await MatchSupplierAsync(name, nif, cancellationToken);

        if (match is null)
        {
            diagnostics.Add(new ProposalDiagnosticDto(
                ProposalSeverities.Warning,
                ProposalDiagnosticCodes.ThirdPartyNotMatched,
                isSale
                    ? $"Le client « {name} » n'existe pas dans le dossier. Le compte collectif {defaultAccount} "
                      + "est proposé sans auxiliaire : rattachez ou créez le tiers."
                    : $"Le fournisseur « {name} » n'existe pas dans le dossier. Le compte collectif {defaultAccount} "
                      + "est proposé sans auxiliaire : rattachez ou créez le tiers."));
            return baseDto;
        }

        var collective = await ResolveCollectiveAccountAsync(
            isSale ? ThirdPartyKind.Client : ThirdPartyKind.Supplier,
            match.Value.Id,
            defaultAccount,
            cancellationToken);

        return baseDto with
        {
            MatchedId = match.Value.Id,
            MatchedName = match.Value.Name,
            MatchedBy = match.Value.MatchedBy,
            CollectiveAccountNumber = collective
        };
    }

    private readonly record struct ThirdPartyMatch(Guid Id, string Name, string MatchedBy);

    /// <summary>
    /// Même matricule si les deux côtés se canonisent vers la forme carte, sinon repli sur la
    /// comparaison alphanumérique (saisie incomplète déjà tolérée à l'import).
    /// </summary>
    private static bool SameMatricule(string? left, string? right)
    {
        if (NIF.TryCanonicalize(left, out var canonicalLeft) && NIF.TryCanonicalize(right, out var canonicalRight))
            return string.Equals(canonicalLeft, canonicalRight, StringComparison.Ordinal);

        var normalizedLeft = InvoiceImportParsing.NormalizeNif(left);
        var normalizedRight = InvoiceImportParsing.NormalizeNif(right);
        return normalizedLeft.Length > 0 && normalizedLeft == normalizedRight;
    }

    private async Task<ThirdPartyMatch?> MatchClientAsync(
        string name, string nif, CancellationToken cancellationToken)
    {
        try
        {
            if (nif.Length > 0)
            {
                var byNif = await _mediator.Send(new GetClientsQuery(Search: nif, PageSize: 10), cancellationToken);
                var hit = byNif.Items.FirstOrDefault(c => SameMatricule(c.Nif, nif));
                if (hit is not null)
                    return new ThirdPartyMatch(hit.Id, hit.Name, "nif");
            }

            if (name.Length == 0)
                return null;

            var byName = await _mediator.Send(new GetClientsQuery(Search: name, PageSize: 10), cancellationToken);
            var best = byName.Items
                .Select(c => (Client: c, Score: InvoiceImportParsing.Similarity(name, c.Name)))
                .Where(x => x.Score >= NameMatchThreshold)
                .OrderByDescending(x => x.Score)
                .FirstOrDefault();

            return best.Client is null ? null : new ThirdPartyMatch(best.Client.Id, best.Client.Name, "name");
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[AccountingDocumentImport] Rapprochement client impossible.");
            return null;
        }
    }

    private async Task<ThirdPartyMatch?> MatchSupplierAsync(
        string name, string nif, CancellationToken cancellationToken)
    {
        try
        {
            if (nif.Length > 0)
            {
                var byNif = await _mediator.Send(new GetSuppliersQuery(Search: nif, PageSize: 10), cancellationToken);
                var hit = byNif.Items.FirstOrDefault(s => SameMatricule(s.Nif, nif));
                if (hit is not null)
                    return new ThirdPartyMatch(hit.Id, hit.Name, "nif");
            }

            if (name.Length == 0)
                return null;

            var byName = await _mediator.Send(new GetSuppliersQuery(Search: name, PageSize: 10), cancellationToken);
            var best = byName.Items
                .Select(s => (Supplier: s, Score: InvoiceImportParsing.Similarity(name, s.Name)))
                .Where(x => x.Score >= NameMatchThreshold)
                .OrderByDescending(x => x.Score)
                .FirstOrDefault();

            return best.Supplier is null ? null : new ThirdPartyMatch(best.Supplier.Id, best.Supplier.Name, "name");
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[AccountingDocumentImport] Rapprochement fournisseur impossible.");
            return null;
        }
    }

    /// <summary>
    /// Compte collectif du tiers : celui de son profil comptable lorsque l'annuaire des tiers est
    /// actif et qu'un profil existe, sinon le compte par défaut (4111 / 4011).
    /// </summary>
    private async Task<string> ResolveCollectiveAccountAsync(
        ThirdPartyKind kind, Guid thirdPartyId, string defaultAccount, CancellationToken cancellationToken)
    {
        try
        {
            var profile = await _thirdPartyDirectory.GetProfileAsync(kind, thirdPartyId, cancellationToken);
            if (profile.IsSuccess && !string.IsNullOrWhiteSpace(profile.Value?.CollectiveAccountNumber))
                return profile.Value.CollectiveAccountNumber.Trim();
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex,
                "[AccountingDocumentImport] Profil comptable du tiers {ThirdPartyId} indisponible.", thirdPartyId);
        }

        return defaultAccount;
    }

    // ========================================================================
    // 3. Comptes
    // ========================================================================

    private async Task<ProposalAccountPlan> ResolveAccountPlanAsync(
        AccountingDocumentExtractionDto document,
        bool isSale,
        ProposedThirdPartyDto thirdParty,
        CancellationToken cancellationToken)
    {
        var defaultResultAccount = isSale
            ? TunisianPostingAccounts.SalesOfGoods
            : TunisianPostingAccounts.PurchasesOfGoods;

        var htByAccount = isSale
            ? await SplitSalesHtByProductAccountAsync(document, cancellationToken)
            : new Dictionary<string, decimal>(StringComparer.Ordinal);

        return new ProposalAccountPlan
        {
            ThirdPartyAccount = thirdParty.CollectiveAccountNumber,
            DefaultResultAccount = defaultResultAccount,
            HtByAccount = htByAccount,
            VatAccount = isSale
                ? TunisianPostingAccounts.VatCollected
                : TunisianPostingAccounts.VatDeductibleGoods,
            FodecAccount = TunisianPostingAccounts.Fodec,
            StampAccount = isSale
                ? TunisianPostingAccounts.FiscalStampOnSale
                : TunisianPostingAccounts.FiscalStampOnPurchase
        };
    }

    /// <summary>
    /// Ventile le HT entre 707 (biens) et 705 (services) en rapprochant chaque ligne d'un produit
    /// du catalogue — même règle que <c>AccountingService.RevenueAccountForLine</c>.
    ///
    /// La ventilation n'est retenue que si elle totalise EXACTEMENT le HT du document : les lignes
    /// sont lues au mieux, alors que les totaux font foi. Sinon on retombe sur une ligne unique.
    /// </summary>
    private async Task<Dictionary<string, decimal>> SplitSalesHtByProductAccountAsync(
        AccountingDocumentExtractionDto document,
        CancellationToken cancellationToken)
    {
        var empty = new Dictionary<string, decimal>(StringComparer.Ordinal);
        if (document.Lines.Count == 0 || document.TotalHt is null)
            return empty;

        var sumOfLines = MillimeRounding.Round(document.Lines.Sum(l => l.LineTotalHt ?? 0m));
        if (sumOfLines != MillimeRounding.Round(document.TotalHt.Value))
            return empty;

        var byAccount = new Dictionary<string, decimal>(StringComparer.Ordinal);
        foreach (var line in document.Lines.Take(MaxLinesToMatch))
        {
            var account = await ResolveRevenueAccountAsync(line, cancellationToken);
            byAccount.TryGetValue(account, out var current);
            byAccount[account] = current + (line.LineTotalHt ?? 0m);
        }

        // Une seule catégorie : la ventilation n'apporte rien, autant garder une ligne unique.
        return byAccount.Count > 1 ? byAccount : empty;
    }

    private async Task<string> ResolveRevenueAccountAsync(
        ExtractedLineDto line, CancellationToken cancellationToken)
    {
        var search = line.Reference ?? line.Designation;
        if (string.IsNullOrWhiteSpace(search))
            return TunisianPostingAccounts.SalesOfGoods;

        try
        {
            var products = await _mediator.Send(
                new GetProductsQuery(Search: search, IsActive: true, PageSize: 10), cancellationToken);

            if (products.IsFailure || products.Value is null)
                return TunisianPostingAccounts.SalesOfGoods;

            var items = products.Value.Items;
            var hit = items.FirstOrDefault(p =>
                    string.Equals(p.Code, line.Reference, StringComparison.OrdinalIgnoreCase))
                ?? items.FirstOrDefault(p =>
                    InvoiceImportParsing.Similarity(line.Designation, p.Name) >= NameMatchThreshold);

            if (hit is null)
                return TunisianPostingAccounts.SalesOfGoods;

            return string.Equals(hit.Type, nameof(ProductType.Service), StringComparison.OrdinalIgnoreCase)
                ? TunisianPostingAccounts.SalesOfServices
                : TunisianPostingAccounts.SalesOfGoods;
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "[AccountingDocumentImport] Rapprochement produit impossible pour « {Search} ».", search);
            return TunisianPostingAccounts.SalesOfGoods;
        }
    }

    /// <summary>
    /// Complète chaque ligne du statut de son compte dans le plan du dossier.
    /// N'appelle JAMAIS de création automatique de sous-compte : une proposition n'écrit rien.
    /// </summary>
    private async Task<List<ProposedLineDto>> AnnotateAccountsAsync(
        IReadOnlyList<ProposedLineDto> lines,
        List<ProposalDiagnosticDto> diagnostics,
        CancellationToken cancellationToken)
    {
        var cache = new Dictionary<string, ChartOfAccount?>(StringComparer.Ordinal);
        var annotated = new List<ProposedLineDto>(lines.Count);

        for (var i = 0; i < lines.Count; i++)
        {
            var line = lines[i];
            var accountNumber = line.AccountNumber.Trim();

            if (!cache.TryGetValue(accountNumber, out var account))
            {
                account = await _chartOfAccounts.GetByAccountNumberAsync(accountNumber, cancellationToken);
                cache[accountNumber] = account;
            }

            string status;
            if (account is null)
            {
                status = ProposedAccountStatuses.Missing;
                diagnostics.Add(new ProposalDiagnosticDto(
                    ProposalSeverities.Warning,
                    ProposalDiagnosticCodes.AccountMissing,
                    $"Le compte {accountNumber} n'existe pas dans le plan comptable du dossier. "
                    + "Créez-le ou remplacez-le avant d'enregistrer.",
                    i));
            }
            else if (!account.IsActive)
            {
                status = ProposedAccountStatuses.Inactive;
                diagnostics.Add(new ProposalDiagnosticDto(
                    ProposalSeverities.Warning,
                    ProposalDiagnosticCodes.AccountInactive,
                    $"Le compte {accountNumber} est désactivé dans le plan comptable du dossier.",
                    i));
            }
            else
            {
                status = ProposedAccountStatuses.Found;
            }

            annotated.Add(line with { AccountLabel = account?.Label, AccountStatus = status });
        }

        return annotated;
    }

    // ========================================================================
    // 5. Contrôles
    // ========================================================================

    private static void AddTotalsDiagnostics(
        AccountingDocumentExtractionDto document,
        decimal totalCredit,
        decimal totalDebit,
        bool isSale,
        List<ProposalDiagnosticDto> diagnostics)
    {
        if (document.VatBreakdownRecomputed)
        {
            diagnostics.Add(new ProposalDiagnosticDto(
                ProposalSeverities.Warning,
                ProposalDiagnosticCodes.VatBreakdownRecomputed,
                "La ventilation de la TVA n'était pas imprimée sur la pièce : elle a été reconstituée "
                + "depuis les lignes. Contrôlez les bases imposables avant d'enregistrer."));
        }

        if (document.TotalTtc is not { } ttc)
            return;

        // La contrepartie est calculée : c'est elle qui porte le total de l'écriture.
        var computed = isSale ? totalDebit : totalCredit;
        var delta = MillimeRounding.Round(Math.Abs(ttc) - computed);
        if (delta == 0m)
            return;

        diagnostics.Add(new ProposalDiagnosticDto(
            ProposalSeverities.Warning,
            ProposalDiagnosticCodes.TotalsMismatch,
            $"Écart de {delta:+0.000;-0.000} TND entre le total TTC imprimé sur la pièce "
            + $"({Math.Abs(ttc):0.000}) et le total de l'écriture proposée ({computed:0.000}). "
            + "L'écriture reste équilibrée : vérifiez les montants extraits."));
    }

    private static void AddDocumentTypeDiagnostics(
        AccountingDocumentExtractionDto document,
        List<ProposalDiagnosticDto> diagnostics)
    {
        if (document.DocumentType is DocumentTypes.Proforma or DocumentTypes.DeliveryNote)
        {
            var label = document.DocumentType == DocumentTypes.Proforma ? "un devis / une proforma" : "un bon de livraison";
            diagnostics.Add(new ProposalDiagnosticDto(
                ProposalSeverities.Warning,
                ProposalDiagnosticCodes.DocumentNotInvoice,
                $"La pièce semble être {label}, et non une facture. Vérifiez qu'elle doit être comptabilisée."));
        }

        if (document.WithholdingAmount is { } rs && rs != 0m)
        {
            diagnostics.Add(new ProposalDiagnosticDto(
                ProposalSeverities.Info,
                ProposalDiagnosticCodes.WithholdingIgnored,
                $"Retenue à la source de {Math.Abs(rs):0.000} TND détectée. Elle n'est pas intégrée à cette "
                + "écriture : elle se comptabilise séparément au moment du règlement."));
        }
    }

    private async Task AddDateDiagnosticsAsync(
        AccountingDocumentExtractionDto document,
        List<ProposalDiagnosticDto> diagnostics,
        CancellationToken cancellationToken)
    {
        if (document.IssueDate is not { } issueDate)
        {
            diagnostics.Add(new ProposalDiagnosticDto(
                ProposalSeverities.Blocking,
                ProposalDiagnosticCodes.MissingIssueDate,
                "La date de la pièce n'a pas pu être lue. Renseignez-la avant d'enregistrer l'écriture."));
            return;
        }

        // Même règle que CreateManualJournalEntryCommandValidator : pas de date au-delà de J+1.
        if (issueDate.ToDateTime(TimeOnly.MinValue) > DateTime.UtcNow.Date.AddDays(1))
        {
            diagnostics.Add(new ProposalDiagnosticDto(
                ProposalSeverities.Blocking,
                ProposalDiagnosticCodes.FutureDate,
                $"La date de la pièce ({issueDate:dd/MM/yyyy}) est dans le futur. "
                + "L'enregistrement d'une écriture postdatée est refusé."));
            return;
        }

        var period = await _periods.GetByYearMonthAsync(issueDate.Year, issueDate.Month, cancellationToken);
        if (period is { IsClosed: true })
        {
            diagnostics.Add(new ProposalDiagnosticDto(
                ProposalSeverities.Blocking,
                ProposalDiagnosticCodes.PeriodClosed,
                $"La période comptable {issueDate:MM/yyyy} est clôturée : aucune écriture ne peut y être "
                + "enregistrée. Rouvrez la période ou changez la date."));
        }
    }

    /// <summary>
    /// Deux gardes anti-doublon, toutes deux en lecture seule :
    /// une facture du dossier déjà comptabilisée automatiquement (bloquant), et une écriture
    /// manuelle portant déjà la même référence de pièce sur le même journal (avertissement).
    /// </summary>
    private async Task AddDuplicateDiagnosticsAsync(
        AccountingDocumentExtractionDto document,
        string journalCode,
        List<ProposalDiagnosticDto> diagnostics,
        CancellationToken cancellationToken)
    {
        var number = document.DocumentNumber?.Trim();
        if (string.IsNullOrWhiteSpace(number))
            return;

        try
        {
            await using var ctx = _contextFactory.CreateIsolatedContext();

            var invoice = await ctx.Invoices
                .AsNoTracking()
                .Where(i => i.Number.Value == number)
                .Select(i => new { i.Id })
                .FirstOrDefaultAsync(cancellationToken);

            if (invoice is not null)
            {
                var alreadyPosted = await ctx.JournalEntries
                    .AsNoTracking()
                    .AnyAsync(
                        e => e.SourceEntityId == invoice.Id
                            && (e.SourceEntityType == "Invoice" || e.SourceEntityType == "InvoiceCreditNote")
                            && !e.IsReversed,
                        cancellationToken);

                if (alreadyPosted)
                {
                    diagnostics.Add(new ProposalDiagnosticDto(
                        ProposalSeverities.Blocking,
                        ProposalDiagnosticCodes.AlreadyPosted,
                        $"La facture {number} est une pièce de ce dossier et elle est DÉJÀ comptabilisée "
                        + "automatiquement. L'importer créerait un doublon."));
                    return;
                }
            }

            var pieceRef = TruncatePieceRef(number);
            var duplicate = await ctx.JournalEntries
                .AsNoTracking()
                .AnyAsync(
                    e => e.PieceRef == pieceRef && e.JournalCode == journalCode && !e.IsReversed,
                    cancellationToken);

            if (duplicate)
            {
                diagnostics.Add(new ProposalDiagnosticDto(
                    ProposalSeverities.Warning,
                    ProposalDiagnosticCodes.DuplicatePieceRef,
                    $"Une écriture portant la référence de pièce « {pieceRef} » existe déjà au journal "
                    + $"{journalCode}. Vérifiez qu'il ne s'agit pas d'un doublon."));
            }
        }
        catch (Exception ex)
        {
            // Un contrôle anti-doublon indisponible ne doit jamais empêcher la proposition.
            _logger.LogWarning(ex, "[AccountingDocumentImport] Contrôle anti-doublon impossible pour {Number}.", number);
        }
    }

    // ========================================================================
    // Utilitaires
    // ========================================================================

    private static string BuildEntryLabel(bool isSale, AccountingDocumentExtractionDto document)
    {
        var reference = document.DocumentNumber ?? "sans numéro";
        var isCreditNote = document.DocumentType == DocumentTypes.CreditNote;

        return (isSale, isCreditNote) switch
        {
            (true, false) => $"Facture vente {reference}",
            (true, true) => $"Avoir vente {reference}",
            (false, false) => $"Facture fournisseur {reference}",
            (false, true) => $"Avoir fournisseur {reference}"
        };
    }

    /// <summary>La référence de pièce est bornée à 50 caractères par le domaine.</summary>
    private static string? TruncatePieceRef(string? value)
    {
        var trimmed = value?.Trim();
        if (string.IsNullOrEmpty(trimmed))
            return null;
        return trimmed.Length <= 50 ? trimmed : trimmed[..50];
    }
}
