using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.Products.Commands;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Application;

/// <summary>
/// Génération d'un code-barres interne pour un article sans code fournisseur.
///
/// <para>
/// Le préfixe <c>2</c> n'est pas décoratif : GS1 le réserve à la circulation restreinte, ce qui
/// garantit par construction qu'un code engendré ici ne peut jamais entrer en collision avec le
/// GTIN d'un fabricant. Le perdre transformerait une commodité en risque d'ambiguïté au scan.
/// </para>
/// </summary>
public sealed class GenerateProductBarcodeCommandTests
{
    private readonly Mock<IProductRepository> _products = new();

    private GenerateProductBarcodeCommandHandler Handler(string prefix = "00") =>
        new(_products.Object, Options.Create(new BarcodeOptions { InternalPrefix = prefix }));

    private void BarcodeIsTaken(bool taken) =>
        _products.Setup(x => x.BarcodeExistsAsync(
                It.IsAny<string>(), It.IsAny<Guid?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(taken);

    [Fact]
    public async Task GeneratesAValidEan13InTheRestrictedCirculationRange()
    {
        BarcodeIsTaken(false);

        var result = await Handler().Handle(new GenerateProductBarcodeCommand(), CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error?.Description);

        var value = result.Value.Barcode;
        Assert.Equal(13, value.Length);
        Assert.StartsWith("2", value);
        Assert.True(Barcode.IsValid(value), $"code engendré invalide : {value}");
        Assert.Equal(nameof(BarcodeSymbology.Ean13), result.Value.Symbology);
    }

    [Fact]
    public async Task HonoursTheConfiguredInternalPrefix()
    {
        BarcodeIsTaken(false);

        var result = await Handler("42").Handle(new GenerateProductBarcodeCommand(), CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error?.Description);
        Assert.StartsWith("242", result.Value.Barcode);
    }

    [Theory]
    [InlineData("")]
    [InlineData("abc")]
    [InlineData("123456")]
    [InlineData(null)]
    public async Task SurvivesAnAbsurdConfiguredPrefix(string? prefix)
    {
        // Ce n'est pas une donnée utilisateur : une configuration incohérente doit être
        // corrigée, pas faire échouer la génération au nez de l'utilisateur.
        BarcodeIsTaken(false);

        var result = await Handler(prefix!).Handle(new GenerateProductBarcodeCommand(), CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error?.Description);
        Assert.StartsWith("2", result.Value.Barcode);
        Assert.True(Barcode.IsValid(result.Value.Barcode));
    }

    [Fact]
    public async Task RetriesOnCollisionThenGivesUpWithAConflict()
    {
        // Toujours pris : le handler doit renoncer proprement plutôt que boucler.
        BarcodeIsTaken(true);

        var result = await Handler().Handle(new GenerateProductBarcodeCommand(), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Conflict", result.Error.Code);
        _products.Verify(x => x.BarcodeExistsAsync(
            It.IsAny<string>(), It.IsAny<Guid?>(), It.IsAny<CancellationToken>()), Times.Exactly(5));
    }

    [Fact]
    public async Task ReturnsTheFirstFreeCandidate()
    {
        var calls = 0;
        _products.Setup(x => x.BarcodeExistsAsync(
                It.IsAny<string>(), It.IsAny<Guid?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(() => ++calls < 3);

        var result = await Handler().Handle(new GenerateProductBarcodeCommand(), CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error?.Description);
        Assert.Equal(3, calls);
    }

    [Fact]
    public async Task ForwardsTheExcludedProductToTheUniquenessCheck()
    {
        // Régénérer un code sur une fiche existante ne doit pas se heurter à son propre code.
        BarcodeIsTaken(false);
        var productId = Guid.NewGuid();

        var result = await Handler().Handle(
            new GenerateProductBarcodeCommand(productId), CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error?.Description);
        _products.Verify(x => x.BarcodeExistsAsync(
            It.IsAny<string>(), productId, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task GeneratesDistinctCodesAcrossCalls()
    {
        BarcodeIsTaken(false);
        var handler = Handler();

        var seen = new HashSet<string>();
        for (var i = 0; i < 50; i++)
        {
            var result = await handler.Handle(new GenerateProductBarcodeCommand(), CancellationToken.None);
            Assert.True(result.IsSuccess, result.Error?.Description);
            seen.Add(result.Value.Barcode);
        }

        // 9 chiffres aléatoires : 50 tirages identiques signaleraient un générateur figé.
        Assert.True(seen.Count > 45, $"seulement {seen.Count} codes distincts sur 50");
    }

    [Fact]
    public void ValidatorRejectsAnEmptyExcludedId()
    {
        var validator = new GenerateProductBarcodeCommandValidator();

        Assert.False(validator.Validate(new GenerateProductBarcodeCommand(Guid.Empty)).IsValid);
        Assert.True(validator.Validate(new GenerateProductBarcodeCommand()).IsValid);
        Assert.True(validator.Validate(new GenerateProductBarcodeCommand(Guid.NewGuid())).IsValid);
    }
}
