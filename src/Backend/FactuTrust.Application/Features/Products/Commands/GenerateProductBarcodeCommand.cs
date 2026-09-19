using System.Security.Cryptography;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Configuration;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.ValueObjects;
using FluentValidation;
using MediatR;
using Microsoft.Extensions.Options;

namespace FactuTrust.Application.Features.Products.Commands;

/// <summary>
/// Engendre un code-barres interne pour un article qui n'a pas de code fournisseur.
///
/// <para>
/// Le code n'est pas enregistré : il est seulement proposé. C'est l'enregistrement de la fiche
/// article qui le persiste, en repassant par la même chaîne de contrôles que toute autre
/// saisie. Une génération abandonnée ne laisse donc aucune trace.
/// </para>
/// </summary>
public sealed record GenerateProductBarcodeCommand(Guid? ExcludeProductId = null)
    : IRequest<Result<GeneratedBarcodeDto>>;

/// <summary>Code-barres proposé, avec sa symbologie pour l'affichage.</summary>
public sealed record GeneratedBarcodeDto
{
    public string Barcode { get; init; } = null!;
    public string Symbology { get; init; } = null!;
}

public sealed class GenerateProductBarcodeCommandValidator
    : AbstractValidator<GenerateProductBarcodeCommand>
{
    public GenerateProductBarcodeCommandValidator()
    {
        RuleFor(x => x.ExcludeProductId)
            .NotEqual(Guid.Empty)
            .When(x => x.ExcludeProductId.HasValue)
            .WithMessage("Identifiant produit invalide.");
    }
}

public sealed class GenerateProductBarcodeCommandHandler
    : IRequestHandler<GenerateProductBarcodeCommand, Result<GeneratedBarcodeDto>>
{
    /// <summary>
    /// GS1 réserve le préfixe <c>2</c> à la circulation restreinte : un code interne ainsi
    /// préfixé ne peut par construction jamais entrer en collision avec le GTIN d'un fabricant.
    /// </summary>
    private const char RestrictedCirculationPrefix = '2';

    /// <summary>
    /// Assez de tentatives pour absorber une collision fortuite, assez peu pour ne pas
    /// transformer un catalogue saturé en attente silencieuse. Avec 9 chiffres aléatoires, une
    /// collision suppose déjà des centaines de milliers de codes internes.
    /// </summary>
    private const int MaxAttempts = 5;

    private const int BodyLength = 12; // 12 chiffres + clé = EAN-13

    private readonly IProductRepository _products;
    private readonly BarcodeOptions _options;

    public GenerateProductBarcodeCommandHandler(
        IProductRepository products,
        IOptions<BarcodeOptions> options)
    {
        _products = products;
        _options = options.Value;
    }

    public async Task<Result<GeneratedBarcodeDto>> Handle(
        GenerateProductBarcodeCommand request,
        CancellationToken cancellationToken)
    {
        var prefix = NormalizePrefix(_options.InternalPrefix);

        for (var attempt = 0; attempt < MaxAttempts; attempt++)
        {
            var body = prefix + RandomDigits(BodyLength - prefix.Length);

            var candidate = Barcode.FromBody(body);
            if (candidate.IsFailure)
                return Result.Failure<GeneratedBarcodeDto>(candidate.Error);

            var taken = await _products.BarcodeExistsAsync(
                candidate.Value.Value, request.ExcludeProductId, cancellationToken);

            if (!taken)
            {
                return Result.Success(new GeneratedBarcodeDto
                {
                    Barcode = candidate.Value.Value,
                    Symbology = candidate.Value.Symbology.ToString()
                });
            }
        }

        return Result.Failure<GeneratedBarcodeDto>(Error.Conflict(
            "Impossible d'engendrer un code-barres interne libre. Réessayez, ou saisissez un code manuellement."));
    }

    /// <summary>
    /// Préfixe effectif : le <c>2</c> de circulation restreinte, suivi du sous-préfixe
    /// configuré, ramené à deux chiffres. Une valeur de configuration absurde est corrigée
    /// plutôt que de faire échouer la génération — ce n'est pas une donnée utilisateur.
    /// </summary>
    private static string NormalizePrefix(string? configured)
    {
        var digits = new string((configured ?? string.Empty).Where(char.IsAsciiDigit).Take(2).ToArray());
        return RestrictedCirculationPrefix + digits.PadLeft(2, '0');
    }

    /// <summary>
    /// Chiffres tirés du générateur cryptographique, sans biais de modulo : on rejette les
    /// tirages qui tomberaient dans la tranche incomplète de l'octet.
    /// </summary>
    private static string RandomDigits(int count)
    {
        const int Limit = 250; // 25 x 10 : plus grand multiple de 10 tenant dans un octet
        var digits = new char[count];
        Span<byte> buffer = stackalloc byte[1];

        for (var i = 0; i < count; i++)
        {
            do
            {
                RandomNumberGenerator.Fill(buffer);
            }
            while (buffer[0] >= Limit);

            digits[i] = (char)('0' + buffer[0] % 10);
        }

        return new string(digits);
    }
}
