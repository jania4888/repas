using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Common.Validation;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.AI;
using FactuTrust.Application.Features.AI.DocumentExtraction;
using FactuTrust.Application.Features.Accounting.DocumentImport;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using Microsoft.Extensions.Logging;

namespace FactuTrust.Application.Features.PurchaseReceipts.DocumentImport;

/// <summary>Fichier à analyser pour proposer un pré-remplissage de bon de réception. Lecture seule.</summary>
public sealed record ImportPurchaseReceiptFromDocumentCommand(Stream FileStream, string FileName, string ContentType);

/// <summary>
/// Analyse un document fournisseur (PDF ou image) et propose un pré-remplissage de bon de
/// réception : fournisseur, lignes, totaux et avertissements. N'écrit jamais rien en base — voir
/// le plan, section 2. Classe injectée directement (pas de requête MediatR), comme
/// <c>ImportInvoiceFromFileHandler</c>, car elle est consommée par un seul contrôleur et un appel
/// IA long ne doit pas passer par le pipeline MediatR.
/// </summary>
public sealed class ImportPurchaseReceiptFromDocumentHandler
{
    /// <summary>Même borne que <c>ImportInvoiceFromFileHandler</c> : au-delà, les lignes restent affichées mais non rapprochées.</summary>
    public const int MaxLinesToMatch = 50;

    private static readonly string[] UnexpectedDocumentTypes =
    {
        DocumentTypes.CreditNote,
        DocumentTypes.Unknown
    };

    private readonly IAccountingDocumentExtractor _extractor;
    private readonly ICompanyRepository _companies;
    private readonly IPurchaseReceiptRepository _purchaseReceipts;
    private readonly IWarehouseRepository _warehouses;
    private readonly SupplierDocumentMatcher _supplierMatcher;
    private readonly ProductLineMatcher _productMatcher;
    private readonly ICurrentUser _currentUser;
    private readonly IAuditService _auditService;
    private readonly ILogger<ImportPurchaseReceiptFromDocumentHandler> _logger;
    private readonly IDocumentExtractionProvider? _externalExtraction;

    public ImportPurchaseReceiptFromDocumentHandler(
        IAccountingDocumentExtractor extractor,
        ICompanyRepository companies,
        IPurchaseReceiptRepository purchaseReceipts,
        IWarehouseRepository warehouses,
        SupplierDocumentMatcher supplierMatcher,
        ProductLineMatcher productMatcher,
        ICurrentUser currentUser,
        IAuditService auditService,
        ILogger<ImportPurchaseReceiptFromDocumentHandler> logger,
        IDocumentExtractionProvider? externalExtraction = null)
    {
        _extractor = extractor;
        _companies = companies;
        _purchaseReceipts = purchaseReceipts;
        _warehouses = warehouses;
        _supplierMatcher = supplierMatcher;
        _productMatcher = productMatcher;
        _currentUser = currentUser;
        _auditService = auditService;
        _logger = logger;
        _externalExtraction = externalExtraction;
    }

    public async Task<Result<PurchaseReceiptImportProposalDto>> HandleAsync(
        ImportPurchaseReceiptFromDocumentCommand command, CancellationToken cancellationToken)
    {
        if (_currentUser.TenantId is null)
            return Result.Failure<PurchaseReceiptImportProposalDto>(
                Error.Unauthorized("Aucun contexte d'entreprise disponible."));

        var fileSize = command.FileStream.CanSeek ? command.FileStream.Length : (long?)null;
        var allowAiFallback = _currentUser.HasPermission(Permissions.AI.Chat);

        var extraction = await _extractor.ExtractAsync(
            new AccountingDocumentExtractionRequest
            {
                FileStream = command.FileStream,
                FileName = command.FileName,
                ContentType = command.ContentType,
                ModelOverride = null,
                AllowAiFallback = allowAiFallback
            },
            cancellationToken);

        if (extraction.IsFailure)
            return Result.Failure<PurchaseReceiptImportProposalDto>(extraction.Error);

        var doc = extraction.Value;
        var extractionProvider = ResolveExtractionProvider(doc.ExtractionMethod);

        var warnings = new List<PurchaseReceiptImportWarningDto>();
        foreach (var raw in doc.Warnings)
        {
            warnings.Add(new PurchaseReceiptImportWarningDto(
                PurchaseReceiptImportWarningCodes.Extraction, PurchaseReceiptImportWarningSeverities.Info, raw, null));
        }

        var company = (await _companies.GetAllAsync(cancellationToken)).FirstOrDefault();
        var (supplierParty, sellerWasCompany) = ResolveSupplierParty(doc, company);

        if (sellerWasCompany)
        {
            warnings.Add(new PurchaseReceiptImportWarningDto(
                PurchaseReceiptImportWarningCodes.PartiesSwapped,
                PurchaseReceiptImportWarningSeverities.Warning,
                "L'émetteur du document est votre société. Vérifiez qu'il s'agit bien d'un document fournisseur.",
                null));
        }

        if (supplierParty is null)
        {
            warnings.Add(new PurchaseReceiptImportWarningDto(
                PurchaseReceiptImportWarningCodes.SupplierNotFoundInDocument,
                PurchaseReceiptImportWarningSeverities.Warning,
                "Aucun fournisseur exploitable n'a été identifié sur le document. Choisissez-le manuellement.",
                null));
        }

        if (UnexpectedDocumentTypes.Contains(doc.DocumentType))
        {
            warnings.Add(new PurchaseReceiptImportWarningDto(
                PurchaseReceiptImportWarningCodes.UnexpectedDocumentType,
                PurchaseReceiptImportWarningSeverities.Info,
                "Le document ne ressemble pas à un bon de livraison ou une facture d'achat.",
                null));
        }

        var supplierMatch = await _supplierMatcher.MatchAsync(supplierParty, cancellationToken);
        AddSupplierWarnings(supplierMatch, warnings);

        var header = BuildHeader(doc, warnings);
        var defaultWarehouse = await _warehouses.GetDefaultAsync(cancellationToken);
        var suggestedWarehouseId = defaultWarehouse is { IsActive: true } ? defaultWarehouse.Id : (Guid?)null;
        header = header with { SuggestedWarehouseId = suggestedWarehouseId };

        var (lineDtos, computedSubTotal, computedVat) = await BuildLinesAsync(
            doc, supplierMatch.SupplierId, warnings, cancellationToken);

        var documentTotals = BuildDocumentTotals(doc);
        AddTotalsWarnings(doc, computedSubTotal, warnings);

        var expectedTotals = new PurchaseReceiptImportExpectedTotalsDto(
            TunisianValidationRules.RoundToMillimes(computedSubTotal),
            TunisianValidationRules.RoundToMillimes(computedVat),
            TunisianValidationRules.RoundToMillimes(computedSubTotal + computedVat));

        if (supplierMatch.SupplierId is { } supplierId && !string.IsNullOrWhiteSpace(header.DeliveryNoteNumber))
        {
            var duplicate = await _purchaseReceipts.ExistsActiveForSupplierDeliveryNoteAsync(
                supplierId, header.DeliveryNoteNumber!, cancellationToken);
            if (duplicate)
            {
                warnings.Add(new PurchaseReceiptImportWarningDto(
                    PurchaseReceiptImportWarningCodes.PossibleDuplicate,
                    PurchaseReceiptImportWarningSeverities.Warning,
                    "Un bon de réception non annulé existe déjà pour ce fournisseur avec le même numéro de bon de livraison.",
                    null));
            }
        }

        var supplierDto = new PurchaseReceiptImportSupplierDto(
            supplierMatch.Outcome.ToString(),
            supplierMatch.SupplierId,
            supplierMatch.SupplierName,
            supplierParty?.Name,
            supplierParty?.Nif,
            supplierMatch.Candidates,
            supplierMatch.Prefill);

        var proposal = new PurchaseReceiptImportProposalDto(
            extractionProvider,
            doc.OcrApplied,
            doc.DocumentType,
            doc.DocumentNumber,
            header,
            supplierDto,
            lineDtos,
            documentTotals,
            expectedTotals,
            InvoiceImportParsing.NormalizeConfidence(doc.Confidence),
            warnings,
            _currentUser.HasPermission(Permissions.Suppliers.Create),
            _currentUser.HasPermission(Permissions.Products.Create),
            _currentUser.HasPermission(Permissions.PurchaseReceipts.Update));

        await LogAuditAsync(command, fileSize, extractionProvider, doc.Lines.Count, lineDtos, supplierMatch, warnings, cancellationToken);

        _logger.LogInformation(
            "Import de document de bon de réception : fournisseur={Provider}, lignes={LineCount}, " +
            "rapprochées={MatchedCount}, fournisseur={Outcome}.",
            extractionProvider, doc.Lines.Count,
            lineDtos.Count(l => l.ProductId is not null), supplierMatch.Outcome);

        return Result.Success(proposal);
    }

    /// <summary>
    /// Étiquette affichée pour le fournisseur ayant produit l'extraction. L'extraction a déjà
    /// réussi via <c>_externalExtraction</c> quand <paramref name="extractionMethod"/> vaut
    /// <see cref="AccountingDocumentExtractionMethods.ExternalExtraction"/> — il n'y a donc rien à
    /// re-vérifier ici (un second appel à <c>IsAvailableAsync</c> ne reflète que l'état présent,
    /// pas celui au moment de l'extraction, et pouvait faire retomber l'étiquette sur le code
    /// technique <c>"external-extraction"</c> au lieu du nom lisible du service).
    /// </summary>
    private string ResolveExtractionProvider(string extractionMethod) =>
        extractionMethod == AccountingDocumentExtractionMethods.ExternalExtraction
            ? _externalExtraction?.Name ?? "docstrange"
            : extractionMethod;

    private static (ExtractedPartyDto? Party, bool SellerWasCompany) ResolveSupplierParty(
        AccountingDocumentExtractionDto doc, Company? company)
    {
        var seller = doc.Seller;
        var buyer = doc.Buyer;

        if (company is null)
            return (seller, false);

        if (!IsCompanyParty(company, seller))
            return (seller, false);

        var buyerIsCompany = IsCompanyParty(company, buyer);
        var party = !buyerIsCompany && buyer is not null && !string.IsNullOrWhiteSpace(buyer.Name) ? buyer : null;
        return (party, true);
    }

    private static bool IsCompanyParty(Company company, ExtractedPartyDto? party)
    {
        if (party is null) return false;

        if (ThirdPartyMatricule.SameMatricule(company.Nif.Value, party.Nif))
            return true;

        // Un matricule qui se canonise clairement vers une AUTRE carte contredit un rapprochement
        // par nom : pas d'ambiguïté possible, c'est une autre entité fiscale.
        // En revanche, un matricule illisible/mal reconnu par l'OCR (qui ne se canonise pas) ne
        // doit JAMAIS, à lui seul, écarter un nom fortement similaire — sinon un OCR bruité ferait
        // passer la propre société du client pour un fournisseur externe (régression de sécurité :
        // la société deviendrait "son propre fournisseur" au lieu d'être reconnue et échangée).
        if (NIF.TryCanonicalize(company.Nif.Value, out _) && NIF.TryCanonicalize(party.Nif, out _))
            return false;

        return !string.IsNullOrWhiteSpace(party.Name)
            && InvoiceImportParsing.Similarity(company.Name, party.Name) >= InvoiceImportParsing.NameMatchThreshold;
    }

    private static void AddSupplierWarnings(SupplierMatchResult match, List<PurchaseReceiptImportWarningDto> warnings)
    {
        switch (match.Outcome)
        {
            case SupplierMatchOutcome.MatchedInactive:
                warnings.Add(new PurchaseReceiptImportWarningDto(
                    PurchaseReceiptImportWarningCodes.SupplierInactive,
                    PurchaseReceiptImportWarningSeverities.Warning,
                    "Le fournisseur rapproché est désactivé. Réactivez-le ou choisissez-en un autre.",
                    null));
                break;
            case SupplierMatchOutcome.NameConflictsWithNif:
                warnings.Add(new PurchaseReceiptImportWarningDto(
                    PurchaseReceiptImportWarningCodes.SupplierNameConflictsWithNif,
                    PurchaseReceiptImportWarningSeverities.Warning,
                    "Un fournisseur de nom proche existe déjà, mais avec un autre matricule fiscal.",
                    null));
                break;
        }

        if (match.NifInvalid)
        {
            warnings.Add(new PurchaseReceiptImportWarningDto(
                PurchaseReceiptImportWarningCodes.SupplierNifInvalid,
                PurchaseReceiptImportWarningSeverities.Warning,
                "Le matricule fiscal lu sur le document n'est pas valide. Corrigez-le avant de créer le fournisseur.",
                null));
        }
    }

    private static PurchaseReceiptImportHeaderDto BuildHeader(
        AccountingDocumentExtractionDto doc, List<PurchaseReceiptImportWarningDto> warnings)
    {
        string? deliveryNoteNumber = null;
        string? supplierReference = null;
        var documentNumber = Truncate(InvoiceImportParsing.CleanOrNull(doc.DocumentNumber), 100);

        if (doc.DocumentType == DocumentTypes.DeliveryNote)
            deliveryNoteNumber = documentNumber;
        else
            supplierReference = documentNumber;

        DateTime? receiptDate = null;
        if (doc.IssueDate is { } issueDate)
        {
            var asDateTime = issueDate.ToDateTime(TimeOnly.MinValue);
            if (asDateTime <= DateTime.UtcNow.Date.AddDays(1))
            {
                receiptDate = asDateTime;
            }
            else
            {
                warnings.Add(new PurchaseReceiptImportWarningDto(
                    PurchaseReceiptImportWarningCodes.Extraction,
                    PurchaseReceiptImportWarningSeverities.Info,
                    "La date du document est dans le futur. Choisissez la date de réception manuellement.",
                    null));
            }
        }

        var currency = InvoiceImportParsing.NormalizeCurrency(doc.Currency);
        if (currency != "TND")
        {
            warnings.Add(new PurchaseReceiptImportWarningDto(
                PurchaseReceiptImportWarningCodes.CurrencyNotTnd,
                PurchaseReceiptImportWarningSeverities.Warning,
                "Le document est libellé dans une autre devise que le TND. Les montants du bon seront saisis en TND.",
                null));
        }

        var noteParts = new List<string>();
        if (doc.FiscalStampAmount is > 0m)
        {
            noteParts.Add($"Timbre fiscal : {TunisianValidationRules.RoundToMillimes(doc.FiscalStampAmount.Value):0.000} TND");
            warnings.Add(new PurchaseReceiptImportWarningDto(
                PurchaseReceiptImportWarningCodes.FiscalStampNotApplied,
                PurchaseReceiptImportWarningSeverities.Info,
                "Le bon de réception n'a pas de champ timbre fiscal : le TTC du bon sera inférieur à celui du document.",
                null));
        }

        if (!string.IsNullOrWhiteSpace(documentNumber))
            noteParts.Add($"Document d'origine : {documentNumber}");

        var suggestedNotes = noteParts.Count > 0 ? Truncate(string.Join(" — ", noteParts), 2000) : null;

        return new PurchaseReceiptImportHeaderDto(
            receiptDate, deliveryNoteNumber, supplierReference, currency, suggestedNotes, null);
    }

    private async Task<(IReadOnlyList<PurchaseReceiptImportLineDto> Lines, decimal SubTotal, decimal Vat)> BuildLinesAsync(
        AccountingDocumentExtractionDto doc,
        Guid? preferredSupplierId,
        List<PurchaseReceiptImportWarningDto> warnings,
        CancellationToken cancellationToken)
    {
        var lines = doc.Lines;
        var result = new List<PurchaseReceiptImportLineDto>(lines.Count);
        decimal subTotal = 0m;
        decimal vat = 0m;

        if (lines.Count > MaxLinesToMatch)
        {
            warnings.Add(new PurchaseReceiptImportWarningDto(
                PurchaseReceiptImportWarningCodes.TooManyLines,
                PurchaseReceiptImportWarningSeverities.Warning,
                $"Le rapprochement automatique des articles s'est limité aux {MaxLinesToMatch} premières lignes.",
                null));
        }

        for (var i = 0; i < lines.Count; i++)
        {
            var line = lines[i];

            if (i >= MaxLinesToMatch)
            {
                // Lignes au-delà de la borne de rapprochement : non rapprochées à un produit, mais
                // toujours comptées dans les totaux attendus — sinon la comparaison avec le total
                // HT du document (AddTotalsWarnings) déclenche un TotalHtMismatch artificiel dès
                // qu'un document dépasse MaxLinesToMatch lignes.
                var skippedDiscount = line.DiscountPercent is >= 0m and <= 100m ? line.DiscountPercent.Value : 0m;
                var skippedQuantity = line.Quantity > 0m ? line.Quantity : 0m;
                var skippedLineHt = TunisianValidationRules.RoundToMillimes(
                    line.UnitPriceHt * skippedQuantity * (1m - skippedDiscount / 100m));
                var skippedVatRate = InvoiceImportParsing.ClampVatRate(line.VatRatePercent);
                var skippedLineVat = TunisianValidationRules.RoundToMillimes(skippedLineHt * skippedVatRate / 100m);
                subTotal += skippedLineHt;
                vat += skippedLineVat;

                result.Add(new PurchaseReceiptImportLineDto(
                    i, line.Reference, line.Designation, line.Unit, line.Quantity, line.UnitPriceHt,
                    line.DiscountPercent, line.VatRatePercent, line.LineTotalHt,
                    "skipped", null, null, null, null, false, Array.Empty<ProductCandidateDto>(), null));
                continue;
            }

            var match = await _productMatcher.MatchAsync(line, preferredSupplierId, cancellationToken);

            if (match.InactiveOrTemplate)
            {
                warnings.Add(new PurchaseReceiptImportWarningDto(
                    PurchaseReceiptImportWarningCodes.ProductInactiveOrTemplate,
                    PurchaseReceiptImportWarningSeverities.Warning,
                    "Le produit trouvé pour cette ligne est désactivé ou est un modèle de variantes.",
                    i));
            }

            decimal? discountPercent = line.DiscountPercent;
            if (discountPercent is < 0m or > 100m)
            {
                warnings.Add(new PurchaseReceiptImportWarningDto(
                    PurchaseReceiptImportWarningCodes.DiscountOutOfRange,
                    PurchaseReceiptImportWarningSeverities.Warning,
                    "La remise extraite est hors de la plage autorisée (0 à 100 %) et a été ignorée.",
                    i));
                discountPercent = null;
            }

            if (line.Quantity <= 0m)
            {
                warnings.Add(new PurchaseReceiptImportWarningDto(
                    PurchaseReceiptImportWarningCodes.QuantityInvalid,
                    PurchaseReceiptImportWarningSeverities.Warning,
                    "La quantité extraite pour cette ligne est nulle ou négative.",
                    i));
            }

            var vatMismatch = match.ProductVatRatePercent is { } productVat && productVat != line.VatRatePercent;
            if (vatMismatch)
            {
                warnings.Add(new PurchaseReceiptImportWarningDto(
                    PurchaseReceiptImportWarningCodes.ProductVatMismatch,
                    PurchaseReceiptImportWarningSeverities.Warning,
                    "Le taux de TVA extrait diffère de celui de la fiche produit. La TVA de la fiche produit sera appliquée.",
                    i));
            }

            if (!TunisianValidationRules.IsValidVatRate(line.VatRatePercent))
            {
                // NB : on ne peut pas distinguer ici un taux « vraiment absent sur le document » d'un
                // taux lu à 19 % — les deux prennent la même valeur par défaut en amont de l'extraction
                // (ExtractedLineDto.VatRatePercent n'est pas nullable). Mais ce cas précis (19 %) passe
                // IsValidVatRate et ne déclenche jamais cet avertissement : on sait donc qu'une valeur
                // concrète — juste non tunisienne — a bien été lue (ex. 20 %), pas qu'elle est absente.
                var nearestValidRate = InvoiceImportParsing.ClampVatRate(line.VatRatePercent);
                warnings.Add(new PurchaseReceiptImportWarningDto(
                    PurchaseReceiptImportWarningCodes.VatRateDefaulted,
                    PurchaseReceiptImportWarningSeverities.Info,
                    $"Le taux de TVA lu pour cette ligne ({line.VatRatePercent} %) n'est pas un taux tunisien valide ; " +
                    $"le taux valide le plus proche ({nearestValidRate} %) a été retenu.",
                    i));
            }

            var effectiveQuantity = line.Quantity > 0m ? line.Quantity : 0m;
            var effectiveDiscount = discountPercent ?? 0m;
            var computedLineHt = TunisianValidationRules.RoundToMillimes(
                line.UnitPriceHt * effectiveQuantity * (1m - effectiveDiscount / 100m));

            if (line.LineTotalHt is { } extractedLineHt)
            {
                var diffAbs = Math.Abs(computedLineHt - extractedLineHt);
                var diffPct = extractedLineHt == 0m ? 0m : diffAbs / Math.Abs(extractedLineHt);
                // Écart volontaire par rapport au plan (§ tableau des avertissements), qui décrit un
                // OR (« plus de 1 % OU plus de 0,010 ») : un AND est utilisé ici pour éviter un flot de
                // faux positifs sur les petites lignes (où un écart de quelques millimes dépasse
                // facilement 1 % en relatif) tout en gardant le garde-fou absolu de 0,010 TND pour les
                // lignes dont l'écart relatif est sous 1 % mais dont le montant est important.
                if (diffAbs > 0.010m && diffPct > 0.01m)
                {
                    warnings.Add(new PurchaseReceiptImportWarningDto(
                        PurchaseReceiptImportWarningCodes.LineTotalMismatch,
                        PurchaseReceiptImportWarningSeverities.Info,
                        "Le montant HT de la ligne calculé diffère de celui imprimé sur le document.",
                        i));
                }
            }

            var vatRateForLine = match.ProductVatRatePercent ?? InvoiceImportParsing.ClampVatRate(line.VatRatePercent);
            var lineVat = TunisianValidationRules.RoundToMillimes(computedLineHt * vatRateForLine / 100m);
            subTotal += computedLineHt;
            vat += lineVat;

            result.Add(new PurchaseReceiptImportLineDto(
                i, line.Reference, line.Designation, line.Unit, line.Quantity, line.UnitPriceHt,
                discountPercent, line.VatRatePercent, line.LineTotalHt,
                match.MatchMethod, match.ProductId, match.ProductCode, match.ProductName,
                match.ProductVatRatePercent, vatMismatch, match.Candidates, match.Prefill));
        }

        return (result, subTotal, vat);
    }

    private static PurchaseReceiptImportTotalsDto BuildDocumentTotals(AccountingDocumentExtractionDto doc) =>
        new(
            doc.TotalHt, doc.TotalVat, doc.FodecAmount, doc.FiscalStampAmount, doc.WithholdingAmount, doc.TotalTtc,
            doc.VatBreakdown
                .Select(v => new PurchaseReceiptImportVatBreakdownDto(v.RatePercent, v.BaseAmount, v.VatAmount))
                .ToList());

    private static void AddTotalsWarnings(
        AccountingDocumentExtractionDto doc, decimal computedSubTotal, List<PurchaseReceiptImportWarningDto> warnings)
    {
        if (doc.TotalHt is { } totalHt)
        {
            var diffAbs = Math.Abs(computedSubTotal - totalHt);
            var diffPct = totalHt == 0m ? 0m : diffAbs / Math.Abs(totalHt);
            if (diffPct > 0.01m)
            {
                warnings.Add(new PurchaseReceiptImportWarningDto(
                    PurchaseReceiptImportWarningCodes.TotalHtMismatch,
                    PurchaseReceiptImportWarningSeverities.Warning,
                    "La somme des montants HT des lignes diffère de plus de 1 % du total HT du document.",
                    null));
            }
        }

        if (doc.TotalHt is { } ht && doc.TotalVat is { } docVat && doc.TotalTtc is { } totalTtc)
        {
            var computedTtc = ht + docVat + (doc.FiscalStampAmount ?? 0m) + (doc.FodecAmount ?? 0m);
            if (Math.Abs(computedTtc - totalTtc) > 0.010m)
            {
                warnings.Add(new PurchaseReceiptImportWarningDto(
                    PurchaseReceiptImportWarningCodes.TotalTtcMismatch,
                    PurchaseReceiptImportWarningSeverities.Warning,
                    "Le total TTC du document ne correspond pas à la somme de ses composantes.",
                    null));
            }
        }
    }

    private async Task LogAuditAsync(
        ImportPurchaseReceiptFromDocumentCommand command,
        long? fileSize,
        string extractionProvider,
        int lineCount,
        IReadOnlyList<PurchaseReceiptImportLineDto> lineDtos,
        SupplierMatchResult supplierMatch,
        List<PurchaseReceiptImportWarningDto> warnings,
        CancellationToken cancellationToken)
    {
        try
        {
            await _auditService.LogAsync(
                AuditActions.PurchaseReceipt.DocumentAnalyzed,
                "PurchaseReceipt",
                entityId: null,
                newValues: new
                {
                    FileName = Path.GetFileName(command.FileName),
                    FileSize = fileSize,
                    ContentType = command.ContentType,
                    ExtractionProvider = extractionProvider,
                    LineCount = lineCount,
                    MatchedLineCount = lineDtos.Count(l => l.ProductId is not null),
                    SupplierMatchOutcome = supplierMatch.Outcome.ToString(),
                    WarningCodes = warnings.Select(w => w.Code).Distinct().ToList()
                },
                cancellationToken: cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Audit de l'analyse de document de bon de réception : échec (best effort).");
        }
    }

    private static string? Truncate(string? value, int maxLength) =>
        value is null ? null : value.Length > maxLength ? value[..maxLength] : value;
}
