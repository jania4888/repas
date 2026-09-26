using System.Text.Json;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

var repoRoot = args.Length > 0 ? args[0] : FindRepoRoot();
var backendRoot = Path.Combine(repoRoot, "src", "Backend");
var outPath = Path.Combine(repoRoot, "src", "Backend", "FactuTrust.API", "Localization", "messages.catalog.json");

var messages = new SortedSet<string>(StringComparer.Ordinal);
if (Directory.Exists(backendRoot))
{
    foreach (var file in Directory.EnumerateFiles(backendRoot, "*.cs", SearchOption.AllDirectories))
    {
        if (file.Contains("obj", StringComparison.Ordinal) || file.Contains("bin", StringComparison.Ordinal))
        {
            continue;
        }

        var tree = CSharpSyntaxTree.ParseText(File.ReadAllText(file));
        var root = tree.GetRoot();
        foreach (var literal in root.DescendantNodes().OfType<LiteralExpressionSyntax>())
        {
            if (literal.IsKind(SyntaxKind.StringLiteralExpression)
                && literal.Parent is ArgumentSyntax { Parent: ArgumentListSyntax argList }
                && argList.Parent is InvocationExpressionSyntax invocation)
            {
                var name = invocation.Expression.ToString();
                if (name.EndsWith(".Fail", StringComparison.Ordinal)
                    || name.EndsWith(".WithMessage", StringComparison.Ordinal))
                {
                    var text = literal.Token.ValueText;
                    if (!string.IsNullOrWhiteSpace(text))
                    {
                        messages.Add(text);
                    }
                }
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
await File.WriteAllTextAsync(outPath, JsonSerializer.Serialize(catalog, new JsonSerializerOptions { WriteIndented = true }));
Console.WriteLine($"Wrote {messages.Count} message(s) to {outPath}");

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
