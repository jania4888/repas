using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.DTOs;

/// <summary>
/// DTO for product list.
/// </summary>
public sealed record ProductListDto
{
    public Guid Id { get; init; }
    public string Code { get; init; } = null!;
    public string Name { get; init; } = null!;
    public string Type { get; init; } = null!;
    public decimal UnitPrice { get; init; }
    public decimal? PurchasePrice { get; init; }
    public decimal? LastPurchasePrice { get; init; }
    public decimal? WeightedAverageCost { get; init; }
    public decimal? ProfitMarginPercent { get; init; }
    public decimal SalePriceTtc { get; init; }
    public string Currency { get; init; } = null!;
    public int VatRatePercent { get; init; }
    public string VatRateDisplay { get; init; } = null!;
    public string? Unit { get; init; }
    /// <summary>Code-barres de l'article. Distinct du code produit interne.</summary>
    public string? Barcode { get; init; }

    /// <summary>
    /// Symbologie deduite du code-barres : Ean8, UpcA, Ean13, Gtin14 ou Code128. Chaine et non
    /// entier : c'est un libelle d'affichage, pas un contrat numerique a maintenir cote front.
    /// Null lorsque l'article n'a pas de code-barres.
    /// </summary>
    public string? BarcodeSymbology { get; init; }
    public bool IsActive { get; init; }
    public bool IsStockManaged { get; init; }
    public bool IsFodecApplicable { get; init; }
    public bool IsDiscountEnabled { get; init; }
    public decimal? MaxDiscountPercent { get; init; }
    public Guid CategoryId { get; init; }
    public string CategoryName { get; init; } = "general";
    public string? ImageUrl { get; init; }
    public bool IsVariantTemplate { get; init; }
    public Guid? ParentProductId { get; init; }
    public TrackingMode TrackingMode { get; init; }
    public CostingMethod CostingMethod { get; init; }

    /// <summary>
    /// Quantité disponible (on hand − réservé) à l'entrepôt par défaut ; null si gestion de stock désactivée ou entrepôt indisponible.
    /// </summary>
    public decimal? QuantityAvailable { get; init; }
}

/// <summary>
/// DTO for product details.
/// </summary>
public sealed record ProductDetailDto
{
    public Guid Id { get; init; }
    public string Code { get; init; } = null!;
    public string Name { get; init; } = null!;
    public string? Description { get; init; }
    public ProductType Type { get; init; }
    public string TypeDisplay { get; init; } = null!;
    public decimal UnitPrice { get; init; }
    public decimal? PurchasePrice { get; init; }
    public decimal? LastPurchasePrice { get; init; }

    /// <summary>
    /// Le coût unitaire AFFICHÉ, pour l'entrepôt par défaut. Malgré son nom historique, il vaut
    /// le coût de la prochaine sortie quand l'article est valorisé FIFO/LIFO — voir
    /// <see cref="DisplayedUnitCostIsNextExit"/>. Nom conservé : il est consommé par le front.
    /// </summary>
    public decimal? WeightedAverageCost { get; init; }

    /// <summary>Vrai ⇒ le coût affiché est celui de la prochaine sortie, pas un coût moyen.</summary>
    public bool DisplayedUnitCostIsNextExit { get; init; }

    public decimal? ProfitMarginPercent { get; init; }
    public decimal SalePriceTtc { get; init; }
    public string Currency { get; init; } = null!;
    public VatRate VatRate { get; init; }
    public int VatRatePercent { get; init; }
    public string VatRateDisplay { get; init; } = null!;
    public string? Unit { get; init; }
    /// <summary>Code-barres de l'article. Distinct du code produit interne.</summary>
    public string? Barcode { get; init; }

    /// <summary>
    /// Symbologie deduite du code-barres : Ean8, UpcA, Ean13, Gtin14 ou Code128. Chaine et non
    /// entier : c'est un libelle d'affichage, pas un contrat numerique a maintenir cote front.
    /// Null lorsque l'article n'a pas de code-barres.
    /// </summary>
    public string? BarcodeSymbology { get; init; }
    public bool IsActive { get; init; }
    public bool IsStockManaged { get; init; }
    public bool IsFodecApplicable { get; init; }
    public bool IsDiscountEnabled { get; init; }
    public decimal? MaxDiscountPercent { get; init; }
    public Guid CategoryId { get; init; }
    public string CategoryName { get; init; } = "general";
    public string? ImageUrl { get; init; }

    /// <summary>
    /// Fournisseur préféré (réapprovisionnement). Null = aucun ; l'acheteur doit choisir manuellement.
    /// Utilisé par le module Prévisions IA pour pré-rattacher les recommandations à un fournisseur.
    /// </summary>
    public Guid? PreferredSupplierId { get; init; }

    /// <summary>
    /// Stock minimum configuré sur l'entrepôt par défaut (optionnel). Null si non renseigné ou 0.
    /// </summary>
    public decimal? MinimumStock { get; init; }

    public DateTime CreatedAt { get; init; }
    public DateTime? UpdatedAt { get; init; }
    public Guid? ParentProductId { get; init; }
    public bool IsVariantTemplate { get; init; }
    public TrackingMode TrackingMode { get; init; }
    public bool HasExpiryTracking { get; init; }
    public PickingPolicy PickingPolicy { get; init; }
    public CostingMethod CostingMethod { get; init; }
    public int? ExpiryAlertDays { get; init; }
}

/// <summary>
/// DTO for product selection (dropdown).
/// </summary>
public sealed record ProductSelectDto
{
    public Guid Id { get; init; }
    public string Code { get; init; } = null!;
    public string Name { get; init; } = null!;
    public decimal UnitPrice { get; init; }
    public decimal? PurchasePrice { get; init; }
    public int VatRatePercent { get; init; }
    public string? Unit { get; init; }
    public bool IsFodecApplicable { get; init; }
    public bool IsDiscountEnabled { get; init; }
    public decimal? MaxDiscountPercent { get; init; }
    public string? AttributeSummary { get; init; }
    public bool IsVariantTemplate { get; init; }
    public Guid? ParentProductId { get; init; }

    /// <summary>
    /// Code-barres de l'article. Exposé ici pour que l'autocomplétion d'une ligne de document
    /// puisse resoudre un code scanné sans aller-retour supplémentaire.
    /// </summary>
    public string? Barcode { get; init; }
}

/// <summary>
/// DTO for creating a product.
/// </summary>
public sealed record CreateProductDto
{
    public string Code { get; init; } = null!;
    public string Name { get; init; } = null!;
    public string? Description { get; init; }
    public ProductType Type { get; init; }
    public decimal UnitPrice { get; init; }
    public decimal? PurchasePrice { get; init; }
    public decimal? ProfitMarginPercent { get; init; }
    public VatRate VatRate { get; init; }
    public string? Unit { get; init; }

    /// <summary>
    /// Code-barres EAN-8 / EAN-13. Chaîne vide ou null = aucun. La clé de contrôle est
    /// vérifiée à l'enregistrement : un code mal recopié est refusé à la saisie.
    /// </summary>
    public string? Barcode { get; init; }

    public bool? IsStockManaged { get; init; }
    public Guid? CategoryId { get; init; }

    /// <summary>Fournisseur préféré (optionnel) ; null = aucun.</summary>
    public Guid? PreferredSupplierId { get; init; }

    /// <summary>Stock minimum sur l'entrepôt par défaut (optionnel).</summary>
    public decimal? MinimumStock { get; init; }

    /// <summary>FODEC applicable (1% sur le HT) sur les ventes.</summary>
    public bool IsFodecApplicable { get; init; }

    /// <summary>Active un plafond de remise sur les lignes de vente.</summary>
    public bool IsDiscountEnabled { get; init; }

    /// <summary>Remise maximale (%) autorisée sur les lignes de vente.</summary>
    public decimal? MaxDiscountPercent { get; init; }

    public bool IsVariantTemplate { get; init; }
    public TrackingMode TrackingMode { get; init; }
    public bool HasExpiryTracking { get; init; }
    public PickingPolicy PickingPolicy { get; init; }
    public CostingMethod CostingMethod { get; init; }
    public int? ExpiryAlertDays { get; init; }
}

/// <summary>
/// DTO for updating a product.
/// </summary>
public sealed record UpdateProductDto
{
    public string Name { get; init; } = null!;
    public string? Description { get; init; }
    public decimal UnitPrice { get; init; }
    public decimal? PurchasePrice { get; init; }
    public decimal? ProfitMarginPercent { get; init; }
    public VatRate VatRate { get; init; }
    public string? Unit { get; init; }

    /// <summary>
    /// Code-barres EAN-8 / EAN-13. Chaîne vide ou null = aucun. La clé de contrôle est
    /// vérifiée à l'enregistrement : un code mal recopié est refusé à la saisie.
    /// </summary>
    public string? Barcode { get; init; }

    public bool? IsStockManaged { get; init; }
    public Guid? CategoryId { get; init; }

    /// <summary>Fournisseur préféré (optionnel) ; null = aucun (efface la préférence).</summary>
    public Guid? PreferredSupplierId { get; init; }

    /// <summary>Stock minimum sur l'entrepôt par défaut (optionnel ; null = ne pas modifier).</summary>
    public decimal? MinimumStock { get; init; }

    /// <summary>FODEC applicable (1% sur le HT) sur les ventes.</summary>
    public bool IsFodecApplicable { get; init; }

    /// <summary>Active un plafond de remise sur les lignes de vente.</summary>
    public bool IsDiscountEnabled { get; init; }

    /// <summary>Remise maximale (%) autorisée sur les lignes de vente.</summary>
    public decimal? MaxDiscountPercent { get; init; }

    public bool? IsVariantTemplate { get; init; }
    public TrackingMode? TrackingMode { get; init; }
    public bool? HasExpiryTracking { get; init; }
    public PickingPolicy? PickingPolicy { get; init; }
    public CostingMethod? CostingMethod { get; init; }
    public int? ExpiryAlertDays { get; init; }
}

/// <summary>Attribute/value pair for a variant child SKU.</summary>
public sealed record ProductVariantAttributePairDto
{
    public Guid DefinitionId { get; init; }
    public string DefinitionCode { get; init; } = null!;
    public string DefinitionName { get; init; } = null!;
    public Guid ValueId { get; init; }
    public string ValueCode { get; init; } = null!;
    public string ValueName { get; init; } = null!;
    public int SortOrder { get; init; }
}

/// <summary>Child SKU row for variant matrix display.</summary>
public sealed record ProductVariantChildDto
{
    public Guid Id { get; init; }
    public string Code { get; init; } = null!;
    public string Name { get; init; } = null!;
    public decimal UnitPrice { get; init; }
    public decimal? PurchasePrice { get; init; }
    public decimal SalePriceTtc { get; init; }
    public string? Barcode { get; init; }
    public bool IsActive { get; init; }
    public decimal? QuantityAvailable { get; init; }
    public IReadOnlyList<ProductVariantAttributePairDto> Attributes { get; init; } = Array.Empty<ProductVariantAttributePairDto>();
}

/// <summary>Configured variant axis on a template product.</summary>
public sealed record ProductVariantAxisDto
{
    public Guid DefinitionId { get; init; }
    public string Code { get; init; } = null!;
    public string Name { get; init; } = null!;
    public int SortOrder { get; init; }
    public IReadOnlyList<Guid> SelectedValueIds { get; init; } = Array.Empty<Guid>();
}

/// <summary>Variant profile for a child SKU (parent + attribute values).</summary>
public sealed record ProductVariantProfileDto
{
    public Guid ProductId { get; init; }
    public Guid ParentProductId { get; init; }
    public string ParentCode { get; init; } = null!;
    public string ParentName { get; init; } = null!;
    public IReadOnlyList<ProductVariantAttributePairDto> Attributes { get; init; } = Array.Empty<ProductVariantAttributePairDto>();
}

/// <summary>Bulk price update for variant children.</summary>
public sealed record BulkUpdateVariantPricesRequest
{
    public string Mode { get; init; } = "absolute";
    public IReadOnlyList<BulkUpdateVariantPriceItem>? Items { get; init; }
}

public sealed record BulkUpdateVariantPriceItem
{
    public Guid ChildId { get; init; }
    public decimal? UnitPrice { get; init; }
    public decimal? PurchasePrice { get; init; }
    public string? Barcode { get; init; }
}

/// <summary>
/// Drapeaux de déploiement des codes-barres, exposés au front pour qu'il n'offre pas une
/// saisie que le serveur refuserait. Ce ne sont pas des données du dossier.
/// </summary>
public sealed record BarcodeFeaturesDto
{
    /// <summary>UPC-A, GTIN-14 et Code 128 acceptés à l'enregistrement.</summary>
    public bool ExtendedSymbologiesEnabled { get; init; }

    /// <summary>Impression d'étiquettes ouverte.</summary>
    public bool LabelPrintingEnabled { get; init; }
}
