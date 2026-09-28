namespace FactuTrust.Application.Localization;

/// <summary>Traduit les messages utilisateur selon <see cref="System.Globalization.CultureInfo.CurrentUICulture"/>.</summary>
public interface IMessageLocalizer
{
    string Localize(string? message);
}
