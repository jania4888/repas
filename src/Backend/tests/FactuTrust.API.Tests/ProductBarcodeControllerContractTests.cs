using System.Reflection;
using FactuTrust.API.Authorization;
using FactuTrust.API.Controllers;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.AspNetCore.RateLimiting;
using Xunit;

namespace FactuTrust.API.Tests;

/// <summary>
/// Contrat des endpoints codes-barres de <see cref="ProductsController"/>.
/// </summary>
/// <remarks>
/// <para>
/// Ces actions ont été ajoutées à un contrôleur qui en comptait déjà une trentaine : une
/// politique oubliée s'y noierait sans que rien ne le signale. Or elles exposent le catalogue —
/// résolution d'un article par son code-barres, et impression d'étiquettes portant nom, code et
/// éventuellement prix.
/// </para>
/// <para>
/// L'impression est le point le plus sensible : c'est un rendu PDF de plusieurs centaines de
/// symboles vectoriels. Sans limite de débit, un clic répété sur « Imprimer » suffirait à
/// mobiliser le serveur.
/// </para>
/// </remarks>
public sealed class ProductBarcodeControllerContractTests
{
    private static readonly Type Controller = typeof(ProductsController);

    private static MethodInfo Action(string name)
    {
        var method = Controller.GetMethod(name, BindingFlags.Public | BindingFlags.Instance);
        Assert.True(method is not null, $"Action introuvable : {name}");
        return method!;
    }

    private static string? PolicyOf(string actionName) =>
        Action(actionName).GetCustomAttributes<AuthorizeAttribute>().FirstOrDefault()?.Policy;

    [Fact]
    public void Controller_RequiresAuthentication()
    {
        Assert.NotNull(Controller.GetCustomAttribute<AuthorizeAttribute>());
    }

    [Theory]
    [InlineData(nameof(ProductsController.GetProductByBarcode))]
    [InlineData(nameof(ProductsController.ExportLabels))]
    [InlineData(nameof(ProductsController.GetLabelLayouts))]
    public void ReadEndpoints_CarryTheProductsReadPolicy(string action)
    {
        // products:read et pas davantage : l'étiquette n'expose rien que la fiche article ne
        // montre déjà. Créer une permission dédiée imposerait une reconnexion à tous les
        // utilisateurs pour un gain de sécurité nul — voir l'ADR.
        Assert.Equal(PermissionPolicies.ProductsRead, PolicyOf(action));
    }

    [Fact]
    public void GeneratingAnInternalBarcode_RequiresTheCreatePolicy()
    {
        // Engendrer un code interne prépare une écriture au catalogue : la lecture ne suffit pas.
        Assert.Equal(PermissionPolicies.ProductsCreate, PolicyOf(nameof(ProductsController.GenerateBarcode)));
    }

    [Fact]
    public void TheCapabilitiesEndpoint_IsAuthenticatedButCarriesNoFinePolicy()
    {
        // GetBarcodeFeatures ne renvoie que des drapeaux de déploiement (IOptions), aucune
        // donnée du dossier. Même traitement que GET /api/stock/features : l'[Authorize] de
        // classe suffit. Exiger products:read empêcherait le front de savoir quoi afficher à
        // un utilisateur qui n'a pas accès au catalogue.
        var authorize = Action(nameof(ProductsController.GetBarcodeFeatures))
            .GetCustomAttributes<AuthorizeAttribute>()
            .ToList();

        Assert.Empty(authorize);
    }

    [Fact]
    public void LabelPrinting_IsRateLimited()
    {
        var limiter = Action(nameof(ProductsController.ExportLabels))
            .GetCustomAttribute<EnableRateLimitingAttribute>();

        Assert.NotNull(limiter);
        Assert.Equal("labels", limiter!.PolicyName);
    }

    [Fact]
    public void LabelPrinting_IsAPostSoTheSelectionStaysOutOfTheUrl()
    {
        // La sélection peut porter deux cents identifiants : un GET les exposerait dans les
        // journaux d'accès et buterait sur la longueur maximale d'une URL.
        var action = Action(nameof(ProductsController.ExportLabels));

        Assert.NotNull(action.GetCustomAttribute<HttpPostAttribute>());
        Assert.Null(action.GetCustomAttribute<HttpGetAttribute>());
    }

    [Fact]
    public void ScanningByBarcode_IsAGetOnAPathSegment()
    {
        var route = Action(nameof(ProductsController.GetProductByBarcode))
            .GetCustomAttribute<HttpGetAttribute>();

        Assert.NotNull(route);
        Assert.Equal("by-barcode/{barcode}", route!.Template);
    }

    [Fact]
    public void ScanningByBarcode_DocumentsBothTheRefusalAndTheAbsence()
    {
        // 400 et 404 disent deux choses différentes à l'utilisateur : « corrigez votre saisie »
        // contre « cet article n'existe pas ». Les écrans s'appuient sur cette distinction.
        var statuses = Action(nameof(ProductsController.GetProductByBarcode))
            .GetCustomAttributes<ProducesResponseTypeAttribute>()
            .Select(a => a.StatusCode)
            .ToList();

        Assert.Contains(200, statuses);
        Assert.Contains(400, statuses);
        Assert.Contains(404, statuses);
    }

    [Fact]
    public void LabelPrinting_DocumentsTheDisabledFeatureAsNotFound()
    {
        // Drapeau éteint ⇒ 404, jamais 503 : la fonctionnalité n'est pas déployée, ce n'est pas
        // un incident, et un 503 déclencherait à tort la bannière de maintenance côté client.
        var statuses = Action(nameof(ProductsController.ExportLabels))
            .GetCustomAttributes<ProducesResponseTypeAttribute>()
            .Select(a => a.StatusCode)
            .ToList();

        Assert.Contains(404, statuses);
        Assert.DoesNotContain(503, statuses);
    }
}
