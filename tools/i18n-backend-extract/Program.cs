using System.Text;
using System.Text.Json;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

// Extrait les messages destinés à l'utilisateur (erreurs métier, exceptions exposées par
// ExceptionHandlingMiddleware, messages de succès) vers messages.catalog.json.
// Les chaînes interpolées deviennent des gabarits « {0} » pour les TemplateRule de MessageLocalizer.

var repoRoot = args.Length > 0 ? args[0] : FindRepoRoot();
var backendRoot = Path.Combine(repoRoot, "src", "Backend");
var outPath = Path.Combine(repoRoot, "src", "Backend", "FactuTrust.API", "Localization", "messages.catalog.json");

// Méthode → index de l'argument message (-1 : tous les arguments chaîne).
var messageArgByMethod = new Dictionary<string, int>(StringComparer.Ordinal)
{
    ["Fail"] = 0,
    ["FailWithCode"] = 0,
    ["WithMessage"] = 0,
    ["Conflict"] = 0,
    ["Forbidden"] = 0,
    ["Unauthorized"] = 0,
    ["Validation"] = 1,
    ["Ok"] = 1,
    ["FromGlobalErrors"] = -1,
};

// Exceptions dont le message atteint le client (ExceptionHandlingMiddleware).
var exposedExceptions = new HashSet<string>(StringComparer.Ordinal)
{
    "InvalidOperationException", "KeyNotFoundException", "ConflictException", "ComplianceException",
    "SecurityException", "UnauthorizedAccessException", "DomainException", "BusinessRuleException",
    "NotFoundException", "ValidationException", "ForbiddenException"
};

var messages = new SortedSet<string>(StringComparer.Ordinal);
// Fichiers d'origine de chaque message (option --sources <fichier.json>, pour le tri).
var sources = new Dictionary<string, SortedSet<string>>(StringComparer.Ordinal);
var sourcesOut = args.SkipWhile(a => a != "--sources").Skip(1).FirstOrDefault();
var currentFile = "";

if (Directory.Exists(backendRoot))
{
    foreach (var file in Directory.EnumerateFiles(backendRoot, "*.cs", SearchOption.AllDirectories))
    {
        var normalized = file.Replace('\\', '/');
        if (normalized.Contains("/obj/", StringComparison.Ordinal)
            || normalized.Contains("/bin/", StringComparison.Ordinal)
            || normalized.Contains("/tests/", StringComparison.Ordinal)
            || normalized.Contains("/Migrations/", StringComparison.Ordinal))
        {
            continue;
        }

        currentFile = normalized[(normalized.IndexOf("/src/Backend/", StringComparison.Ordinal) + 13)..];
        var root = CSharpSyntaxTree.ParseText(File.ReadAllText(file)).GetRoot();

        foreach (var invocation in root.DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            var name = invocation.Expression switch
            {
                MemberAccessExpressionSyntax m => m.Name.Identifier.ValueText,
                IdentifierNameSyntax i => i.Identifier.ValueText,
                GenericNameSyntax g => g.Identifier.ValueText,
                _ => null
            };
            if (name is null)
            {
                continue;
            }

            var arguments = invocation.ArgumentList.Arguments;
            if (name == "NotFound" && arguments.Count == 1)
            {
                Add(arguments[0].Expression);
            }
            else if (messageArgByMethod.TryGetValue(name, out var index))
            {
                if (index < 0)
                {
                    foreach (var a in arguments) Add(a.Expression);
                }
                else if (index < arguments.Count)
                {
                    Add(arguments[index].Expression);
                }
            }
        }

        foreach (var creation in root.DescendantNodes().OfType<ObjectCreationExpressionSyntax>())
        {
            var typeName = creation.Type switch
            {
                IdentifierNameSyntax i => i.Identifier.ValueText,
                QualifiedNameSyntax q => q.Right.Identifier.ValueText,
                GenericNameSyntax g => g.Identifier.ValueText,
                _ => null
            };
            var arguments = creation.ArgumentList?.Arguments;
            if (typeName is null || arguments is null || arguments.Value.Count == 0)
            {
                continue;
            }

            if (typeName == "Error" && arguments.Value.Count >= 2)
            {
                Add(arguments.Value[1].Expression);
            }
            else if (exposedExceptions.Contains(typeName))
            {
                Add(arguments.Value[0].Expression);
            }
        }
    }
}

var catalog = new
{
    generatedAt = DateTime.UtcNow.ToString("O"),
    source = "tools/i18n-backend-extract",
    messages = messages.ToArray()
};

Directory.CreateDirectory(Path.GetDirectoryName(outPath)!);
await File.WriteAllTextAsync(outPath, JsonSerializer.Serialize(catalog, new JsonSerializerOptions
{
    WriteIndented = true,
    Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping
}));
Console.WriteLine($"Wrote {messages.Count} message(s) to {outPath}");
if (sourcesOut is not null)
{
    await File.WriteAllTextAsync(sourcesOut, JsonSerializer.Serialize(sources, new JsonSerializerOptions
    {
        WriteIndented = true,
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    }));
}

void Add(ExpressionSyntax expression)
{
    var text = expression switch
    {
        LiteralExpressionSyntax literal when literal.IsKind(SyntaxKind.StringLiteralExpression) => literal.Token.ValueText,
        InterpolatedStringExpressionSyntax interpolated => ToTemplate(interpolated),
        _ => null
    };
    if (IsUserMessage(text))
    {
        messages.Add(text!);
        if (!sources.TryGetValue(text!, out var set)) sources[text!] = set = new SortedSet<string>(StringComparer.Ordinal);
        set.Add(currentFile);
    }
}

static string ToTemplate(InterpolatedStringExpressionSyntax interpolated)
{
    var sb = new StringBuilder();
    var index = 0;
    foreach (var content in interpolated.Contents)
    {
        if (content is InterpolatedStringTextSyntax text)
        {
            sb.Append(text.TextToken.ValueText);
        }
        else
        {
            sb.Append('{').Append(index++).Append('}');
        }
    }
    return sb.ToString();
}

// Un message : au moins un mot de deux lettres et une espace (écarte codes et identifiants).
static bool IsUserMessage(string? text) =>
    !string.IsNullOrWhiteSpace(text)
    && text.Contains(' ', StringComparison.Ordinal)
    && System.Text.RegularExpressions.Regex.IsMatch(text, @"\p{L}{2,}");

static string FindRepoRoot()
{
    var dir = new DirectoryInfo(AppContext.BaseDirectory);
    while (dir is not null)
    {
        if (File.Exists(Path.Combine(dir.FullName, "FactuTrust.sln"))
            || Directory.Exists(Path.Combine(dir.FullName, "src", "Backend")))
        {
            return dir.FullName;
        }

        dir = dir.Parent;
    }

    return Directory.GetCurrentDirectory();
}
