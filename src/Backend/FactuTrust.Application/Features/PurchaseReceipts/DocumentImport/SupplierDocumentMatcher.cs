using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Validation;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.AI;
using FactuTrust.Application.Features.Accounting.DocumentImport;
using FactuTrust.Application.Features.Suppliers.Queries;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.ValueObjects;
using MediatR;
using Microsoft.Extensions.Logging;

namespace FactuTrust.Application.Features.PurchaseReceipts.DocumentImport;

/// <summary>Résultat du rapprochement d'une partie extraite d'un document avec un fournisseur existant.</summary>
public enum SupplierMatchOutcome
{
    MatchedByNif,
    MatchedByName,
    Ambiguous,
    NameConflictsWithNif,
    MatchedInactive,
    NotFound,
    /// <summary>Aucune partie fournisseur exploitable n'a été soumise au rapprochement.</summary>
    Missing
}

/// <summary>Issue de <see cref="SupplierDocumentMatcher.MatchAsync"/>, construite pour alimenter <see cref="PurchaseReceiptImportSupplierDto"/>.</summary>
public sealed record SupplierMatchResult(
    SupplierMatchOutcome Outcome,
    Guid? SupplierId,
    string? SupplierName,
    IReadOnlyList<SupplierCandidateDto> Candidates,
    SupplierPrefillDto? Prefill,
    bool NifInvalid);

/// <summary>
/// Rapproche la partie fournisseur extraite d'un document avec les fournisseurs existants du
/// tenant. Partage la recette de <c>AccountingEntryProposalService.MatchFicheByNifAsync</c> /
/// <c>MatchFicheByNameAsync</c> côté fournisseur uniquement — voir le plan, section 4.
/// </summary>
public sealed class SupplierDocumentMatcher
{
    private const int CandidateQueryPageSize = 10;
    private const int MaxCandidates = 5;

    private readonly ISupplierRepository _suppliers;
    private readonly IMediator _mediator;
    private readonly ILogger<SupplierDocumentMatcher> _logger;

    public SupplierDocumentMatcher(
        ISupplierRepository suppliers, IMediator mediator, ILogger<SupplierDocumentMatcher> logger)
    {
        _suppliers = suppliers;
        _mediator = mediator;
        _logger = logger;
    }

    public async Task<SupplierMatchResult> MatchAsync(ExtractedPartyDto? party, CancellationToken cancellationToken)
    {
        if (party is null || string.IsNullOrWhiteSpace(party.Name))
            return new SupplierMatchResult(SupplierMatchOutcome.Missing, null, null, Array.Empty<SupplierCandidateDto>(), null, false);

        try
        {
            var nifRaw = party.Nif?.Trim();

            if (!string.IsNullOrEmpty(nifRaw))
            {
                var byNif = await _suppliers.GetByNifAsync(nifRaw, cancellationToken);
                if (byNif is not null)
                    return Resolve(SupplierMatchOutcome.MatchedByNif, byNif);

                if (!NIF.TryCanonicalize(nifRaw, out _))
                {
                    // Matricule bruité (OCR) : recette tolérante, comme AccountingEntryProposalService.
                    var byNifSearch = await _mediator.Send(
                        new GetSuppliersQuery(Search: nifRaw, PageSize: CandidateQueryPageSize), cancellationToken);
                    var hitSupplier = byNifSearch.Items.FirstOrDefault(
                        s => ThirdPartyMatricule.SameMatricule(s.Nif, nifRaw));
                    if (hitSupplier is not null)
                    {
                        var full = await _suppliers.GetByIdAsync(hitSupplier.Id, cancellationToken);
                        if (full is not null)
                            return Resolve(SupplierMatchOutcome.MatchedByNif, full);
                    }
                }
            }

            var nifNormalized = InvoiceImportParsing.NormalizeNif(nifRaw);
            var byName = await _mediator.Send(
                new GetSuppliersQuery(Search: party.Name, PageSize: CandidateQueryPageSize), cancellationToken);

            var nameMatch = ThirdPartyNameMatcher.Match(
                party.Name,
                nifNormalized.Length > 0 ? nifNormalized : null,
                byName.Items,
                s => s.Name,
                s => InvoiceImportParsing.NormalizeNif(s.Nif));

            switch (nameMatch.Outcome)
            {
                case NameMatchOutcome.Unique:
                    var matched = await _suppliers.GetByIdAsync(nameMatch.Match!.Id, cancellationToken);
                    if (matched is not null)
                        return Resolve(SupplierMatchOutcome.MatchedByName, matched);
                    break;

                case NameMatchOutcome.Ambiguous:
                    return new SupplierMatchResult(
                        SupplierMatchOutcome.Ambiguous, null, null,
                        ToCandidates(nameMatch.Candidates), BuildPrefill(party), false);

                case NameMatchOutcome.RejectedByFiscalId:
                    return new SupplierMatchResult(
                        SupplierMatchOutcome.NameConflictsWithNif, null, null,
                        ToCandidates(nameMatch.Candidates), BuildPrefill(party), false);
            }

            return new SupplierMatchResult(
                SupplierMatchOutcome.NotFound, null, null,
                Array.Empty<SupplierCandidateDto>(), BuildPrefill(party), IsNifInvalid(party));
        }
        catch (Exception ex)
        {
            // Jamais de nom ni de matricule dans les journaux (voir plan, section 9 — confidentialité).
            _logger.LogWarning(ex, "Rapprochement du fournisseur du document : échec de la requête.");
            return new SupplierMatchResult(
                SupplierMatchOutcome.NotFound, null, null,
                Array.Empty<SupplierCandidateDto>(), BuildPrefill(party), IsNifInvalid(party));
        }
    }

    private static SupplierMatchResult Resolve(SupplierMatchOutcome outcome, Supplier supplier)
    {
        if (!supplier.IsActive)
        {
            return new SupplierMatchResult(
                SupplierMatchOutcome.MatchedInactive, null, supplier.Name,
                Array.Empty<SupplierCandidateDto>(), null, false);
        }

        return new SupplierMatchResult(
            outcome, supplier.Id, supplier.Name, Array.Empty<SupplierCandidateDto>(), null, false);
    }

    private static IReadOnlyList<SupplierCandidateDto> ToCandidates(IReadOnlyList<SupplierListDto> items) =>
        items
            .Take(MaxCandidates)
            .Select(s => new SupplierCandidateDto(s.Id, s.Name, s.Nif, s.City, s.IsActive))
            .ToList();

    private static bool IsNifInvalid(ExtractedPartyDto party) =>
        !string.IsNullOrWhiteSpace(party.Nif) && !NIF.TryCanonicalize(party.Nif, out _);

    private static SupplierPrefillDto BuildPrefill(ExtractedPartyDto party)
    {
        var name = Truncate(InvoiceImportParsing.CleanOrNull(party.Name), TunisianValidationRules.MaxLengths.ClientName);

        var nifCanonical = NIF.TryCanonicalize(party.Nif, out var canonical) ? canonical : null;
        var type = nifCanonical is not null ? SupplierType.Business : SupplierType.Individual;

        var city = InvoiceImportParsing.CleanOrNull(party.City);
        var governorate = ResolveGovernorate(party.Governorate) ?? ResolveGovernorate(city);

        string? phone = null;
        if (!string.IsNullOrWhiteSpace(party.Phone))
        {
            var created = PhoneNumber.Create(party.Phone);
            if (created.IsSuccess)
                phone = created.Value.Value;
        }

        var street = Truncate(InvoiceImportParsing.CleanOrNull(party.Street), TunisianValidationRules.MaxLengths.Street);
        var postalCode = InvoiceImportParsing.CleanOrNull(party.PostalCode);
        var email = InvoiceImportParsing.CleanOrNull(party.Email);

        var missing = new List<string>();
        if (string.IsNullOrWhiteSpace(street)) missing.Add("Street");
        if (string.IsNullOrWhiteSpace(city)) missing.Add("City");
        if (string.IsNullOrWhiteSpace(governorate)) missing.Add("Governorate");
        if (type == SupplierType.Business && nifCanonical is null) missing.Add("Nif");

        return new SupplierPrefillDto(
            name, type, nifCanonical,
            street, city, postalCode, governorate,
            email, phone,
            missing);
    }

    private static string? ResolveGovernorate(string? candidate)
    {
        if (string.IsNullOrWhiteSpace(candidate))
            return null;

        var trimmed = RemoveDiacritics(candidate.Trim());
        return TunisianValidationRules.TunisianGovernorates.FirstOrDefault(
            g => string.Equals(RemoveDiacritics(g), trimmed, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// Compare un gouvernorat « sans accents ni casse » (plan §4) : un document imprime parfois
    /// « Beja » ou « Gabes » sans diacritiques.
    /// </summary>
    private static string RemoveDiacritics(string value)
    {
        var normalized = value.Normalize(System.Text.NormalizationForm.FormD);
        var builder = new System.Text.StringBuilder(normalized.Length);
        foreach (var c in normalized)
        {
            var category = System.Globalization.CharUnicodeInfo.GetUnicodeCategory(c);
            if (category != System.Globalization.UnicodeCategory.NonSpacingMark)
                builder.Append(c);
        }
        return builder.ToString().Normalize(System.Text.NormalizationForm.FormC);
    }

    private static string? Truncate(string? value, int maxLength) =>
        value is null ? null : value.Length > maxLength ? value[..maxLength] : value;
}
