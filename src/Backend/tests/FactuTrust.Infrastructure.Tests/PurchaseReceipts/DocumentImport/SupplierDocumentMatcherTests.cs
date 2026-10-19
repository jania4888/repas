using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.DocumentImport;
using FactuTrust.Application.Features.PurchaseReceipts.DocumentImport;
using FactuTrust.Application.Features.Suppliers.Queries;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.ValueObjects;
using MediatR;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.PurchaseReceipts.DocumentImport;

public sealed class SupplierDocumentMatcherTests
{
    private const string CanonicalNif = "1772793W/A/M/000";
    private const string LegacyNif = "1772793/W/A/M/000";

    private static Supplier NewSupplier(
        string name, string nif = CanonicalNif, bool active = true, string city = "Tunis")
    {
        var address = FactuTrust.Domain.ValueObjects.Address.Create("Rue de Marseille", city, "Tunis").Value;
        var supplier = Supplier.Create(
            name, SupplierType.Business, address, Email.Create("fournisseur@example.com").Value,
            NIF.Create(nif).Value).Value;
        if (!active)
            supplier.Deactivate();
        return supplier;
    }

    private static SupplierListDto ToListDto(Supplier s) => new()
    {
        Id = s.Id,
        Name = s.Name,
        Type = s.Type.ToString(),
        TypeDisplay = s.Type.ToString(),
        Nif = s.NIF?.Value,
        Email = s.Email?.Value,
        Phone = s.Phone?.Value,
        City = s.Address.City,
        Governorate = s.Address.Governorate,
        ContactPerson = null,
        PaymentTermDays = 30,
        IsActive = s.IsActive,
        TotalOrders = 0
    };

    private static (SupplierDocumentMatcher Matcher, Mock<ISupplierRepository> Suppliers, Mock<IMediator> Mediator) BuildSut(
        Supplier? byNif = null,
        IReadOnlyList<SupplierListDto>? searchResults = null,
        Func<Guid, Supplier?>? byId = null,
        bool throwOnSearch = false)
    {
        var suppliers = new Mock<ISupplierRepository>();
        suppliers.Setup(x => x.GetByNifAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(byNif);
        suppliers.Setup(x => x.GetByIdAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((Guid id, CancellationToken _) => byId is not null ? byId(id) : null);

        var mediator = new Mock<IMediator>();
        if (throwOnSearch)
        {
            mediator.Setup(x => x.Send(It.IsAny<GetSuppliersQuery>(), It.IsAny<CancellationToken>()))
                .ThrowsAsync(new InvalidOperationException("boom"));
        }
        else
        {
            mediator.Setup(x => x.Send(It.IsAny<GetSuppliersQuery>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(new PagedResult<SupplierListDto>
                {
                    Items = searchResults ?? Array.Empty<SupplierListDto>(),
                    TotalCount = searchResults?.Count ?? 0,
                    Page = 1,
                    PageSize = 10
                });
        }

        var matcher = new SupplierDocumentMatcher(suppliers.Object, mediator.Object, NullLogger<SupplierDocumentMatcher>.Instance);
        return (matcher, suppliers, mediator);
    }

    [Fact]
    public async Task Canonical_nif_match_found_directly_by_repository()
    {
        var supplier = NewSupplier("Fournisseur Alpha");
        var (matcher, _, _) = BuildSut(byNif: supplier);

        var result = await matcher.MatchAsync(
            new ExtractedPartyDto { Name = "Fournisseur Alpha", Nif = CanonicalNif }, CancellationToken.None);

        Assert.Equal(SupplierMatchOutcome.MatchedByNif, result.Outcome);
        Assert.Equal(supplier.Id, result.SupplierId);
    }

    [Fact]
    public async Task Legacy_spelled_nif_matches_the_same_way_through_the_repository()
    {
        var supplier = NewSupplier("Fournisseur Alpha");
        var (matcher, suppliers, _) = BuildSut(byNif: supplier);

        var result = await matcher.MatchAsync(
            new ExtractedPartyDto { Name = "Fournisseur Alpha", Nif = LegacyNif }, CancellationToken.None);

        Assert.Equal(SupplierMatchOutcome.MatchedByNif, result.Outcome);
        suppliers.Verify(x => x.GetByNifAsync(LegacyNif, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Noisy_ocr_nif_is_found_through_the_tolerant_search_recipe()
    {
        var supplier = NewSupplier("Fournisseur Beta");
        var candidate = ToListDto(supplier);
        // Matricule bruité par l'OCR : non canonisable directement.
        var (matcher, _, _) = BuildSut(byNif: null, searchResults: new[] { candidate }, byId: id => id == supplier.Id ? supplier : null);

        var result = await matcher.MatchAsync(
            new ExtractedPartyDto { Name = "Fournisseur Beta", Nif = "177 2793 W A M 000 !!" }, CancellationToken.None);

        Assert.Equal(SupplierMatchOutcome.MatchedByNif, result.Outcome);
        Assert.Equal(supplier.Id, result.SupplierId);
    }

    [Fact]
    public async Task Unique_name_above_threshold_matches_by_name()
    {
        var supplier = NewSupplier("Grossiste Mediterraneen SARL");
        var candidate = ToListDto(supplier);
        var (matcher, _, _) = BuildSut(byNif: null, searchResults: new[] { candidate }, byId: id => id == supplier.Id ? supplier : null);

        var result = await matcher.MatchAsync(
            new ExtractedPartyDto { Name = "Grossiste Mediterraneen SARL" }, CancellationToken.None);

        Assert.Equal(SupplierMatchOutcome.MatchedByName, result.Outcome);
        Assert.Equal(supplier.Id, result.SupplierId);
    }

    [Fact]
    public async Task Two_close_names_are_ambiguous_with_candidates()
    {
        var a = NewSupplier("Societe Generale Distribution");
        var b = NewSupplier("Societe Generale Distributions", nif: "1772794X/A/M/000");
        var (matcher, _, _) = BuildSut(
            byNif: null, searchResults: new[] { ToListDto(a), ToListDto(b) });

        var result = await matcher.MatchAsync(
            new ExtractedPartyDto { Name = "Societe Generale Distribution" }, CancellationToken.None);

        Assert.Equal(SupplierMatchOutcome.Ambiguous, result.Outcome);
        Assert.Null(result.SupplierId);
        Assert.NotEmpty(result.Candidates);
    }

    [Fact]
    public async Task Close_name_but_different_nif_conflicts()
    {
        var existing = NewSupplier("Societe Generale Distribution", nif: "1772794X/A/M/000");
        var (matcher, _, _) = BuildSut(byNif: null, searchResults: new[] { ToListDto(existing) });

        var result = await matcher.MatchAsync(
            new ExtractedPartyDto { Name = "Societe Generale Distribution", Nif = CanonicalNif },
            CancellationToken.None);

        Assert.Equal(SupplierMatchOutcome.NameConflictsWithNif, result.Outcome);
        Assert.NotNull(result.Prefill);
    }

    [Fact]
    public async Task Inactive_supplier_match_is_reported_without_a_selectable_id()
    {
        var supplier = NewSupplier("Fournisseur Inactif", active: false);
        var (matcher, _, _) = BuildSut(byNif: supplier);

        var result = await matcher.MatchAsync(
            new ExtractedPartyDto { Name = "Fournisseur Inactif", Nif = CanonicalNif }, CancellationToken.None);

        Assert.Equal(SupplierMatchOutcome.MatchedInactive, result.Outcome);
        Assert.Null(result.SupplierId);
    }

    [Fact]
    public async Task Repository_exception_resolves_to_not_found_without_throwing()
    {
        var (matcher, _, _) = BuildSut(throwOnSearch: true);

        var result = await matcher.MatchAsync(new ExtractedPartyDto { Name = "Fournisseur Quelconque" }, CancellationToken.None);

        Assert.Equal(SupplierMatchOutcome.NotFound, result.Outcome);
    }

    [Fact]
    public async Task Missing_party_resolves_to_missing_without_any_lookup()
    {
        var (matcher, suppliers, mediator) = BuildSut();

        var result = await matcher.MatchAsync(null, CancellationToken.None);

        Assert.Equal(SupplierMatchOutcome.Missing, result.Outcome);
        suppliers.Verify(x => x.GetByNifAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
        mediator.Verify(x => x.Send(It.IsAny<GetSuppliersQuery>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Prefill_valid_nif_produces_business_type()
    {
        var (matcher, _, _) = BuildSut();

        var result = await matcher.MatchAsync(
            new ExtractedPartyDto { Name = "Nouveau Fournisseur", Nif = CanonicalNif, City = "Sfax" }, CancellationToken.None);

        Assert.Equal(SupplierMatchOutcome.NotFound, result.Outcome);
        Assert.NotNull(result.Prefill);
        Assert.Equal(SupplierType.Business, result.Prefill!.Type);
        Assert.Equal(CanonicalNif, result.Prefill.Nif);
        Assert.False(result.NifInvalid);
    }

    [Fact]
    public async Task Prefill_invalid_nif_produces_individual_type_and_nif_invalid_flag()
    {
        var (matcher, _, _) = BuildSut();

        var result = await matcher.MatchAsync(
            new ExtractedPartyDto { Name = "Nouveau Fournisseur", Nif = "NOT-A-NIF" }, CancellationToken.None);

        Assert.Equal(SupplierType.Individual, result.Prefill!.Type);
        Assert.Null(result.Prefill.Nif);
        Assert.True(result.NifInvalid);
    }

    [Fact]
    public async Task Prefill_missing_required_fields_are_reported()
    {
        var (matcher, _, _) = BuildSut();

        var result = await matcher.MatchAsync(new ExtractedPartyDto { Name = "Fournisseur Sans Adresse" }, CancellationToken.None);

        Assert.Contains("Street", result.Prefill!.MissingRequiredFields);
        Assert.Contains("City", result.Prefill.MissingRequiredFields);
        Assert.Contains("Governorate", result.Prefill.MissingRequiredFields);
    }

    [Fact]
    public async Task Governorate_is_inferred_from_the_city_when_not_printed_explicitly()
    {
        var (matcher, _, _) = BuildSut();

        var result = await matcher.MatchAsync(
            new ExtractedPartyDto { Name = "Fournisseur Sfaxien", City = "Sfax" }, CancellationToken.None);

        Assert.Equal("Sfax", result.Prefill!.Governorate);
    }

    [Fact]
    public async Task Governorate_tolerates_missing_diacritics()
    {
        var (matcher, _, _) = BuildSut();

        var result = await matcher.MatchAsync(
            new ExtractedPartyDto { Name = "Fournisseur Bejaois", Governorate = "Beja" }, CancellationToken.None);

        Assert.Equal("Béja", result.Prefill!.Governorate);
    }

    [Fact]
    public async Task Invalid_phone_is_dropped_from_the_prefill()
    {
        var (matcher, _, _) = BuildSut();

        var result = await matcher.MatchAsync(
            new ExtractedPartyDto { Name = "Fournisseur Telephone Invalide", Phone = "12" }, CancellationToken.None);

        Assert.Null(result.Prefill!.Phone);
    }

    [Fact]
    public async Task Long_name_is_truncated_to_two_hundred_characters()
    {
        var longName = new string('A', 250);
        var (matcher, _, _) = BuildSut();

        var result = await matcher.MatchAsync(new ExtractedPartyDto { Name = longName }, CancellationToken.None);

        Assert.Equal(200, result.Prefill!.Name!.Length);
    }
}
