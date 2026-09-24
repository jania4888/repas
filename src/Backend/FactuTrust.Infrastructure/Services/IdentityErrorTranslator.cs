using Microsoft.AspNetCore.Identity;

namespace FactuTrust.Infrastructure.Services;

/// <summary>
/// Translates ASP.NET Core Identity error messages to French.
/// </summary>
public static class IdentityErrorTranslator
{
    /// <summary>
    /// Translates an Identity error to French.
    /// </summary>
    public static string TranslateToFrench(IdentityError error)
    {
        // Translate based on error code (more reliable than description matching)
        return error.Code switch
        {
            "DuplicateUserName" => $"Le nom d'utilisateur '{ExtractValueFromDescription(error.Description, "username")}' est déjà utilisé.",
            "DuplicateEmail" => $"L'adresse email '{ExtractValueFromDescription(error.Description, "email")}' est déjà utilisée.",
            "InvalidUserName" => "Le nom d'utilisateur n'est pas valide.",
            "InvalidEmail" => "L'adresse email n'est pas valide.",
            "InvalidToken" => "Le token n'est pas valide.",
            "InvalidRoleName" => "Le nom du rôle n'est pas valide.",
            "LoginAlreadyAssociated" => "Cette connexion est déjà associée à un compte.",
            "PasswordTooShort" => FormatWithRequiredCount(
                error.Description,
                "Le mot de passe doit contenir au moins {0} caractères.",
                "Le mot de passe est trop court."),
            "PasswordRequiresUniqueChars" => FormatWithRequiredCount(
                error.Description,
                "Le mot de passe doit contenir au moins {0} caractères différents.",
                "Le mot de passe doit contenir davantage de caractères différents."),
            "PasswordRequiresNonAlphanumeric" => "Le mot de passe doit contenir au moins un caractère non alphanumérique.",
            "PasswordRequiresDigit" => "Le mot de passe doit contenir au moins un chiffre.",
            "PasswordRequiresLower" => "Le mot de passe doit contenir au moins une lettre minuscule.",
            "PasswordRequiresUpper" => "Le mot de passe doit contenir au moins une lettre majuscule.",
            "UserAlreadyHasPassword" => "L'utilisateur a déjà un mot de passe défini.",
            "UserAlreadyInRole" => "L'utilisateur a déjà ce rôle.",
            "UserNotInRole" => "L'utilisateur n'a pas ce rôle.",
            "UserLockedOut" => "Le compte est verrouillé.",
            "RecoveryCodeRedemptionFailed" => "Le code de récupération est invalide.",
            "ConcurrencyFailure" => "Une erreur de concurrence s'est produite. L'objet a été modifié.",
            "DefaultIdentityError" => "Une erreur d'identité s'est produite.",
            _ => TranslateByDescription(error)
        };
    }

    /// <summary>
    /// Translates multiple Identity errors to French.
    /// </summary>
    public static string TranslateToFrench(IEnumerable<IdentityError> errors)
    {
        var errorList = errors.ToList();
        
        if (!errorList.Any())
            return string.Empty;
        
        // Special handling for duplicate username and email (common case)
        var duplicateUserName = errorList.FirstOrDefault(e => e.Code == "DuplicateUserName");
        var duplicateEmail = errorList.FirstOrDefault(e => e.Code == "DuplicateEmail");
        
        if (duplicateUserName != null && duplicateEmail != null)
        {
            var userName = ExtractValueFromDescription(duplicateUserName.Description, "username");
            var email = ExtractValueFromDescription(duplicateEmail.Description, "email");
            
            // If same value, combine message
            if (userName == email)
            {
                return $"Le nom d'utilisateur et l'adresse email '{userName}' sont déjà utilisés.";
            }
            
            return $"Le nom d'utilisateur '{userName}' et l'adresse email '{email}' sont déjà utilisés.";
        }
        
        // Translate each error and join with proper French punctuation. Each translation already ends
        // with a period: strip it before joining, or every sentence would end with "..".
        var translatedErrors = errorList
            .Select(TranslateToFrench)
            .Select(e => e.TrimEnd().TrimEnd('.'))
            .Where(e => !string.IsNullOrWhiteSpace(e))
            .ToList();
        return translatedErrors.Count == 0 ? string.Empty : string.Join(". ", translatedErrors) + ".";
    }

    private static string TranslateByDescription(IdentityError error)
    {
        var description = error.Description.ToLowerInvariant();

        // Fallback: translate by description content
        if (description.Contains("already taken"))
        {
            // Extract the field name and value
            if (description.Contains("username"))
            {
                var value = ExtractValueFromDescription(error.Description, "username");
                return $"Le nom d'utilisateur '{value}' est déjà utilisé.";
            }
            if (description.Contains("email"))
            {
                var value = ExtractValueFromDescription(error.Description, "email");
                return $"L'adresse email '{value}' est déjà utilisée.";
            }
        }

        if (description.Contains("password"))
        {
            if (description.Contains("too short"))
                return "Le mot de passe est trop court.";
            if (description.Contains("requires"))
                {
                    if (description.Contains("non alphanumeric"))
                        return "Le mot de passe doit contenir au moins un caractère non alphanumérique.";
                    if (description.Contains("digit"))
                        return "Le mot de passe doit contenir au moins un chiffre.";
                    if (description.Contains("lower"))
                        return "Le mot de passe doit contenir au moins une lettre minuscule.";
                    if (description.Contains("upper"))
                        return "Le mot de passe doit contenir au moins une lettre majuscule.";
                }
        }

        // Default: return original description if no translation found
        return error.Description;
    }

    /// <summary>
    /// Carries over the threshold from the Identity description ("Passwords must be at least 12
    /// characters."): the error code alone does not hold it, and translating without it left a raw
    /// "{0}" in front of the user.
    /// </summary>
    private static string FormatWithRequiredCount(string description, string template, string fallback)
    {
        var match = System.Text.RegularExpressions.Regex.Match(description ?? string.Empty, @"\d+");
        return match.Success ? string.Format(template, match.Value) : fallback;
    }

    private static string ExtractValueFromDescription(string description, string fieldName)
    {
        // Try to extract value from patterns like:
        // - "Username 'value' is already taken"
        // - "Email 'value' is already taken"
        // - "User name 'value' is already taken."
        // - "Username 'value' is already taken., Email 'value' is already taken."
        
        // First, try to find the field name in the description
        var fieldIndex = description.IndexOf(fieldName, StringComparison.OrdinalIgnoreCase);
        if (fieldIndex < 0)
        {
            // Try alternative: "User name" instead of "Username"
            fieldIndex = description.IndexOf("user name", StringComparison.OrdinalIgnoreCase);
        }
        
        if (fieldIndex >= 0)
        {
            // Find the quote after the field name
            var startIndex = description.IndexOf('\'', fieldIndex);
            if (startIndex >= 0)
            {
                var endIndex = description.IndexOf('\'', startIndex + 1);
                if (endIndex > startIndex)
                {
                    return description.Substring(startIndex + 1, endIndex - startIndex - 1);
                }
            }
        }
        
        // Fallback: try to find any quoted value (works for patterns like "Username 'value' is already taken., Email 'value' is already taken.")
        // This will get the first quoted value, which should be the username/email
        var fallbackStart = description.IndexOf('\'');
        if (fallbackStart >= 0)
        {
            var fallbackEnd = description.IndexOf('\'', fallbackStart + 1);
            if (fallbackEnd > fallbackStart)
            {
                return description.Substring(fallbackStart + 1, fallbackEnd - fallbackStart - 1);
            }
        }
        
        // Last resort: try to extract from patterns without quotes
        // Pattern: "Username value is already taken"
        var patternMatch = System.Text.RegularExpressions.Regex.Match(
            description, 
            $@"{fieldName}\s+['""]?([^'""\s,]+)['""]?\s+is\s+already",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        
        if (patternMatch.Success && patternMatch.Groups.Count > 1)
        {
            return patternMatch.Groups[1].Value;
        }
        
        return "?";
    }
}
