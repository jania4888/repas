namespace FactuTrust.Application.Features.Accounting.MonthlyDeclaration;

/// <summary>
/// Activité au titre de laquelle la TFP est due : le formulaire officiel porte deux lignes
/// exclusives, 1 % pour les industries manufacturières et 2 % pour les autres activités.
/// </summary>
/// <remarks>
/// Règle unique, partagée par le formulaire officiel (choix de la ligne) et par le moteur paramétré
/// (composants de paie ventilés par activité) : deux règles finiraient par placer la même TFP sur
/// deux lignes différentes.
/// </remarks>
public static class TfpActivity
{
    /// <summary>
    /// Vrai si la TFP relève de la ligne « industries manufacturières ». On retient le taux
    /// réellement appliqué par le cycle de paie ; à défaut, on le reconstitue depuis l'assiette ; en
    /// dernier recours « autres activités », cas le plus fréquent et le plus prudent (taux le plus
    /// élevé).
    /// </summary>
    public static bool IsManufacturing(decimal tfpRatePercent, decimal tfp, decimal basis)
    {
        var ratePercent = tfpRatePercent > 0m
            ? tfpRatePercent
            : basis > 0m ? tfp / basis * 100m : 0m;

        return ratePercent > 0m && Math.Abs(ratePercent - 1m) < 0.05m;
    }
}
