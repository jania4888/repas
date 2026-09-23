namespace FactuTrust.Infrastructure.Migrations;

/// <summary>
/// Expression SQL déterministe, jumelle de <c>NIF.TryCanonicalize</c> :
/// forme historique <c>NNNNNNN/L/A/M/NNN</c> (17 caractères) → forme carte
/// <c>NNNNNNNL/A/M/NNN</c>. Toute autre valeur est laissée telle quelle (majuscules).
/// Les contrôles sont des comparaisons UNICODE (ASCII), pas un LIKE dépendant de la collation.
/// </summary>
internal static class NifCanonicalSql
{
    public static string CanonExpression(string column) =>
        $"""
        CASE
          WHEN {LegacyPredicate(column)}
          THEN LEFT(UPPER({column}), 7) + SUBSTRING(UPPER({column}), 9, 1) + SUBSTRING(UPPER({column}), 10, 8)
          ELSE UPPER({column})
        END
        """;

    public static string LegacyPredicate(string column) =>
        $"""
        LEN({column}) = 17
          AND {Digit(column, 1)} AND {Digit(column, 2)} AND {Digit(column, 3)} AND {Digit(column, 4)}
          AND {Digit(column, 5)} AND {Digit(column, 6)} AND {Digit(column, 7)}
          AND {Slash(column, 8)}
          AND {Letter(column, 9)}
          AND {Slash(column, 10)}
          AND {Letter(column, 11)}
          AND {Slash(column, 12)}
          AND {Letter(column, 13)}
          AND {Slash(column, 14)}
          AND {Digit(column, 15)} AND {Digit(column, 16)} AND {Digit(column, 17)}
        """;

    public static string OfficialPredicate(string column) =>
        $"""
        LEN({column}) = 16
          AND {Digit(column, 1)} AND {Digit(column, 2)} AND {Digit(column, 3)} AND {Digit(column, 4)}
          AND {Digit(column, 5)} AND {Digit(column, 6)} AND {Digit(column, 7)}
          AND {Letter(column, 8)}
          AND {Slash(column, 9)}
          AND {Letter(column, 10)}
          AND {Slash(column, 11)}
          AND {Letter(column, 12)}
          AND {Slash(column, 13)}
          AND {Digit(column, 14)} AND {Digit(column, 15)} AND {Digit(column, 16)}
        """;

    public static string RewriteLegacyAssignment(string column) =>
        $"LEFT(UPPER({column}), 7) + SUBSTRING(UPPER({column}), 9, 1) + SUBSTRING(UPPER({column}), 10, 8)";

    public static string RewriteOfficialToLegacyAssignment(string column) =>
        $"LEFT(UPPER({column}), 7) + '/' + SUBSTRING(UPPER({column}), 8, 1) + SUBSTRING(UPPER({column}), 9, 8)";

    /// <summary>
    /// Lève si deux valeurs brutes distinctes se rabattent sur la même forme canonique.
    /// Les doublons déjà identiques (même chaîne) ne comptent pas : aucune fusion n'est tentée.
    /// </summary>
    public static string ThrowOnDistinctSpellingCollision(string table, string column, string? extraPredicate, string message) =>
        $"""
        IF EXISTS (
            SELECT 1
            FROM (
                SELECT {column} AS RawNif, {CanonExpression(column)} AS Canon
                FROM {table}
                WHERE {column} IS NOT NULL{(extraPredicate is null ? "" : " AND " + extraPredicate)}
            ) AS spellings
            GROUP BY Canon
            HAVING COUNT(DISTINCT RawNif) > 1
        )
            THROW 50001, N'{message.Replace("'", "''")}', 1;
        """;

    private static string Slash(string column, int position) =>
        $"UNICODE(SUBSTRING(UPPER({column}), {position}, 1)) = 47";

    private static string Letter(string column, int position) =>
        $"UNICODE(SUBSTRING(UPPER({column}), {position}, 1)) BETWEEN 65 AND 90";

    private static string Digit(string column, int position) =>
        $"UNICODE(SUBSTRING(UPPER({column}), {position}, 1)) BETWEEN 48 AND 57";
}
