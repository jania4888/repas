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

// Constantes chaîne (`const string X = "…"`) : un message passé par son nom (Error.Forbidden(
// Access.DeniedMessage), new Error(code, NotSubmittedMessage)…) est résolu vers sa valeur. Seules
// les constantes qui atteignent un point d'émission sont retenues — jamais un prompt d'IA.
var roots = new List<(string File, SyntaxNode Root)>();
var constsByFile = new Dictionary<string, Dictionary<string, string>>(StringComparer.Ordinal);
var constsByQualifiedName = new Dictionary<string, string>(StringComparer.Ordinal);

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

        var relative = normalized[(normalized.IndexOf("/src/Backend/", StringComparison.Ordinal) + 13)..];
        var parsed = CSharpSyntaxTree.ParseText(File.ReadAllText(file)).GetRoot();
        roots.Add((relative, parsed));
        CollectConstants(relative, parsed);
    }

    foreach (var (relative, root) in roots)
    {
        currentFile = relative;

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

        // `new(code, message)` typé par la cible : `static Error NotSubmitted() => new(Code, Message);`.
        foreach (var creation in root.DescendantNodes().OfType<ImplicitObjectCreationExpressionSyntax>())
        {
            var arguments = creation.ArgumentList.Arguments;
            if (arguments.Count >= 2 && TargetTypeName(creation) == "Error")
            {
                Add(arguments[1].Expression);
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

void CollectConstants(string file, SyntaxNode root)
{
    foreach (var field in root.DescendantNodes().OfType<FieldDeclarationSyntax>())
    {
        if (!field.Modifiers.Any(SyntaxKind.ConstKeyword)
            || field.Declaration.Type is not PredefinedTypeSyntax { Keyword.ValueText: "string" })
        {
            continue;
        }

        var owner = (field.Parent as TypeDeclarationSyntax)?.Identifier.ValueText;
        foreach (var variable in field.Declaration.Variables)
        {
            var value = variable.Initializer is null ? null : ConstantText(variable.Initializer.Value);
            if (value is null)
            {
                continue;
            }

            if (!constsByFile.TryGetValue(file, out var local))
            {
                constsByFile[file] = local = new Dictionary<string, string>(StringComparer.Ordinal);
            }
            local[variable.Identifier.ValueText] = value;
            if (owner is not null)
            {
                constsByQualifiedName[$"{owner}.{variable.Identifier.ValueText}"] = value;
            }
        }
    }
}

// Type visé par un `new(...)` implicite : retour de méthode/propriété, `return`, déclaration typée.
static string? TargetTypeName(ImplicitObjectCreationExpressionSyntax creation)
{
    static string? Name(TypeSyntax? type) => type switch
    {
        IdentifierNameSyntax i => i.Identifier.ValueText,
        QualifiedNameSyntax q => q.Right.Identifier.ValueText,
        _ => null
    };

    return creation.Parent switch
    {
        ArrowExpressionClauseSyntax { Parent: MethodDeclarationSyntax m } => Name(m.ReturnType),
        ArrowExpressionClauseSyntax { Parent: PropertyDeclarationSyntax p } => Name(p.Type),
        ReturnStatementSyntax r => Name(r.FirstAncestorOrSelf<MethodDeclarationSyntax>()?.ReturnType),
        EqualsValueClauseSyntax { Parent: VariableDeclaratorSyntax { Parent: VariableDeclarationSyntax d } } => Name(d.Type),
        _ => null
    };
}

// Littéral ou concaténation de littéraux (`"a" + "b"`) ; null sinon.
static string? ConstantText(ExpressionSyntax expression) => expression switch
{
    LiteralExpressionSyntax literal when literal.IsKind(SyntaxKind.StringLiteralExpression) => literal.Token.ValueText,
    BinaryExpressionSyntax binary when binary.IsKind(SyntaxKind.AddExpression)
        => ConstantText(binary.Left) is { } left && ConstantText(binary.Right) is { } right ? left + right : null,
    ParenthesizedExpressionSyntax parenthesized => ConstantText(parenthesized.Expression),
    _ => null
};

string? ResolveConstant(ExpressionSyntax expression) => expression switch
{
    IdentifierNameSyntax identifier
        => constsByFile.TryGetValue(currentFile, out var local) && local.TryGetValue(identifier.Identifier.ValueText, out var value) ? value : null,
    MemberAccessExpressionSyntax { Expression: IdentifierNameSyntax owner } member
        => constsByQualifiedName.TryGetValue($"{owner.Identifier.ValueText}.{member.Name.Identifier.ValueText}", out var qualified) ? qualified : null,
    _ => null
};

void Add(ExpressionSyntax expression)
{
    var text = expression switch
    {
        LiteralExpressionSyntax literal when literal.IsKind(SyntaxKind.StringLiteralExpression) => literal.Token.ValueText,
        InterpolatedStringExpressionSyntax interpolated => ToTemplate(interpolated),
        IdentifierNameSyntax or MemberAccessExpressionSyntax => ResolveConstant(expression),
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
