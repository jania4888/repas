using System.Globalization;
using System.Numerics;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace FactuTrust.Infrastructure.Tests.Services.BankStatementImport;

/// <summary>
/// Relevés bancaires SYNTHÉTIQUES (noms et RIB fictifs) reproduisant les mises en page réelles
/// observées : ils couvrent en CI ce que la recette privée vérifie sur de vrais relevés, qui ne
/// peuvent pas être commités. Les soldes sont calculés à partir des lignes : un relevé généré
/// est toujours juste, sauf altération volontaire (<see cref="Spec.ClosingOverride"/>).
/// </summary>
internal static class SyntheticBankStatementPdf
{
    public sealed record Op(string Date, string ValueDate, string[] Label, decimal? Debit, decimal? Credit);

    public sealed record Spec(string BankCode, decimal Opening, IReadOnlyList<Op> Ops)
    {
        public decimal? ClosingOverride { get; init; }
        public decimal TotalDebits => Ops.Sum(o => o.Debit ?? 0);
        public decimal TotalCredits => Ops.Sum(o => o.Credit ?? 0);
        public decimal Closing => ClosingOverride ?? Opening + TotalCredits - TotalDebits;
        public string Rib => RibFor(BankCode);
    }

    static SyntheticBankStatementPdf()
    {
        QuestPDF.Settings.License = LicenseType.Community;
    }

    private static readonly object GenerationGate = new();

    /// <summary>
    /// Génération sérialisée : des générations QuestPDF simultanées (tests exécutés en parallèle)
    /// produisent de temps à autre un PDF sans texte lisible, ce qui rendait des tests instables.
    /// </summary>
    private static byte[] GenerateSerialized(this IDocument document)
    {
        lock (GenerationGate)
            return document.GeneratePdf();
    }

    /// <summary>RIB fictif à clé valide pour un code banque donné.</summary>
    public static string RibFor(string bankCode)
    {
        var body = bankCode + "999" + "0000123456789";
        var key = 97 - (int)(BigInteger.Parse(body) * 100 % 97);
        return body + key.ToString("D2", CultureInfo.InvariantCulture);
    }

    /// <summary>Façon STB : grille à filets, point décimal, SOLDE INITIAL / TOTAL / SOLDE COMPTABLE + leurres.</summary>
    public static byte[] StbLike(Spec spec) => Document.Create(container =>
    {
        container.Page(page =>
        {
            page.Size(PageSizes.A4);
            page.Margin(20);
            page.DefaultTextStyle(t => t.FontSize(7));
            page.Content().Column(col =>
            {
                col.Item().AlignCenter().Text("SOCIETE FICTIVE DE BANQUE").FontSize(11).Bold();
                col.Item().AlignCenter().Text("HISTORIQUE DES MOUVEMENTS");
                col.Item().AlignCenter().Text("DU : 01/01/2026 au 31/01/2026");
                col.Item().Text("Devise compte : TND");
                col.Item().Text($"IBAN (R.I.B.) : {spec.Rib}");
                col.Item().PaddingTop(8).Table(table =>
                {
                    table.ColumnsDefinition(c =>
                    {
                        c.ConstantColumn(60);
                        c.RelativeColumn();
                        c.ConstantColumn(60);
                        c.ConstantColumn(70);
                        c.ConstantColumn(70);
                    });
                    foreach (var h in new[] { "Date", "Libellé de l'opération", "Date valeur", "Débit", "Crédit" })
                        Cell(table).AlignCenter().Text(h);

                    // Comme sur le vrai relevé STB : libellés de solde et de total en cellule fusionnée.
                    Cell(table, span: 3).Text("SOLDE INITIAL").Bold();
                    Cell(table).Text(string.Empty);
                    Cell(table).AlignRight().Text(Dot(spec.Opening));

                    foreach (var op in spec.Ops)
                    {
                        Cell(table).Text(op.Date);
                        Cell(table).Text(string.Join('\n', op.Label));
                        Cell(table).Text(op.ValueDate);
                        Cell(table).AlignRight().Text(op.Debit is { } d ? Dot(d) : string.Empty);
                        Cell(table).AlignRight().Text(op.Credit is { } c ? Dot(c) : string.Empty);
                    }

                    Cell(table, span: 3).Text("TOTAL").Bold();
                    Cell(table).AlignRight().Text(Dot(spec.TotalDebits));
                    Cell(table).AlignRight().Text(Dot(spec.TotalCredits));

                    Cell(table, span: 3).Text("SOLDE COMPTABLE:").Bold();
                    Cell(table).Text(string.Empty);
                    Cell(table).AlignRight().Text(Dot(spec.Closing));
                });
                // Leurres imprimés par la STB, qui ne sont PAS le solde comptable.
                col.Item().PaddingTop(6).Text($"Montant de blocage: {Dot(28.636m)}");
                col.Item().Text($"Solde du compte au: 31/01/2026 {Dot(spec.Closing - 28.636m)}");
            });
        });
    }).GenerateSerialized();

    /// <summary>Façon BH : AUCUN en-tête texte, dates sans année, dates valeur ISO, totaux sans libellé.</summary>
    public static byte[] BhLike(Spec spec) => Document.Create(container =>
    {
        container.Page(page =>
        {
            page.Size(PageSizes.A4);
            page.Margin(20);
            page.DefaultTextStyle(t => t.FontSize(8));
            page.Content().Column(col =>
            {
                col.Item().Text(spec.Rib);
                col.Item().Text("31-01-26    TND    1 / 1");
                col.Item().PaddingTop(10).Element(e => Row(e, "SOLDE AU 31-12-25", string.Empty, null, spec.Opening));
                foreach (var op in spec.Ops)
                    col.Item().Element(e => Row(e, $"{op.Date}   {string.Join(' ', op.Label)}", op.ValueDate, op.Debit, op.Credit));
                col.Item().PaddingTop(20).Element(e => Row(e, string.Empty, string.Empty, spec.TotalDebits, spec.TotalCredits));
                col.Item().PaddingTop(6).Element(e => Row(e, "31-01-26 CREDITEUR", string.Empty, null, spec.Closing));
            });
        });
    }).GenerateSerialized();

    /// <summary>Façon Zitouna : en-têtes texte, débits imprimés NÉGATIFS, « Solde au » sur la ligne au-dessus du montant.</summary>
    public static byte[] ZitounaLike(Spec spec) => Document.Create(container =>
    {
        container.Page(page =>
        {
            page.Size(PageSizes.A4);
            page.Margin(20);
            page.DefaultTextStyle(t => t.FontSize(8));
            page.Content().Column(col =>
            {
                col.Item().Text($"RIB {spec.Rib}   Date du 01/01/2026 au 31/01/2026");
                col.Item().Text("Devise TND");
                col.Item().PaddingTop(8).Element(e => SignedRow(e, "Date", "Libellé Opération", "Date valeur", "Débit", "Crédit"));
                col.Item().Element(e => SignedRow(e, string.Empty, "SOLDE DEBUT", string.Empty, string.Empty, Comma(spec.Opening, groups: false)));
                foreach (var op in spec.Ops)
                {
                    col.Item().Element(e => SignedRow(e, op.Date, string.Join(' ', op.Label), op.ValueDate,
                        op.Debit is { } d ? "-" + Comma(d, groups: false) : string.Empty,
                        op.Credit is { } c ? Comma(c, groups: false) : string.Empty));
                }

                col.Item().PaddingTop(20).Element(e => SignedRow(e, string.Empty, string.Empty, "Totaux",
                    "-" + Comma(spec.TotalDebits, groups: false), Comma(spec.TotalCredits, groups: false)));
                // Comme sur le vrai relevé : « Solde au » puis, une ligne plus bas, la date d'arrêté
                // (sous la colonne Débit) et le montant (colonne Crédit).
                col.Item().PaddingTop(10).Element(e => SignedRow(e, string.Empty, string.Empty, string.Empty, "Solde au", string.Empty));
                col.Item().PaddingTop(6).Element(e => SignedRow(e, string.Empty, string.Empty, string.Empty, "31/01/2026 :", Comma(spec.Closing, groups: false)));
            });
        });
    }).GenerateSerialized();

    /// <summary>Un relevé mensuel BIAT : période, données et (optionnellement) solde d'ouverture imposé.</summary>
    public sealed record Monthly(DateOnly From, DateOnly To, Spec Spec);

    /// <summary>
    /// Façon BIAT « relevé de compte mensuel » : UNE page par relevé, dans l'ordre donné (un fichier
    /// peut assembler plusieurs mois, même dans le désordre). En-têtes texte, dates jj/mm/aaaa,
    /// période « Du : » / « Au : » sur deux lignes, montants des soldes et totaux imprimés ~4 pt
    /// AU-DESSUS de leur libellé, total crédit incluant le solde d'ouverture, solde final « Solde ».
    /// </summary>
    public static byte[] BiatMonthlyLike(params Monthly[] statements) => Document.Create(container =>
    {
        foreach (var statement in statements)
        {
            var spec = statement.Spec;
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(20);
                page.DefaultTextStyle(t => t.FontSize(7));
                page.Content().Column(col =>
                {
                    col.Item().AlignCenter().Text("RELEVÉ  DE  COMPTE  MENSUEL").FontSize(10).Bold();
                    col.Item().PaddingTop(6).Row(row =>
                    {
                        row.ConstantItem(230).Text("Agence :   AGENCE FICTIVE (99)");
                        row.ConstantItem(100).Text($"Du: {statement.From:dd/MM/yyyy}");
                        row.RelativeItem().Text("STE EXEMPLE SARL");
                    });
                    col.Item().Row(row =>
                    {
                        row.ConstantItem(230).Text("COMPTE COURANT EN TND");
                        row.ConstantItem(100).Text($"Au: {statement.To:dd/MM/yyyy}");
                        row.RelativeItem().Text("1000 TUNIS");
                    });
                    col.Item().Text("Devise :   TND");
                    col.Item().Text($"RIB :   {spec.Rib}");
                    col.Item().PaddingTop(10).Element(e => MonthlyRow(e, "Date", "Libellé de l'opération", "Référence", "Date de valeur", "Débit", "Crédit"));

                    // Solde d'ouverture : montant (et date) légèrement AU-DESSUS du libellé, colonne crédit si créditeur.
                    col.Item().PaddingTop(4).Element(e => MonthlySummary(e, "Solde au", statement.From.AddDays(-1).ToString("dd/MM/yyyy", CultureInfo.InvariantCulture),
                        spec.Opening < 0 ? Comma(-spec.Opening, groups: true) : string.Empty,
                        spec.Opening >= 0 ? Comma(spec.Opening, groups: true) : string.Empty));

                    foreach (var op in spec.Ops)
                    {
                        col.Item().Element(e => MonthlyRow(e, op.Date, string.Join(' ', op.Label), "FT2600000000" + op.Date.Replace("/", string.Empty)[..4], op.ValueDate,
                            op.Debit is { } d ? Comma(d, groups: true) : string.Empty,
                            op.Credit is { } c ? Comma(c, groups: true) : string.Empty));
                    }

                    // Totaux : le total crédit inclut le solde d'ouverture (comme le vrai relevé).
                    col.Item().PaddingTop(18).Element(e => MonthlySummary(e, "Totaux", string.Empty,
                        Comma(spec.TotalDebits, groups: true),
                        Comma(spec.TotalCredits + (spec.Opening >= 0 ? spec.Opening : 0), groups: true)));
                    col.Item().PaddingTop(10).Element(e => MonthlySummary(e, "Solde", string.Empty,
                        spec.Closing < 0 ? Comma(-spec.Closing, groups: true) : string.Empty,
                        spec.Closing >= 0 ? Comma(spec.Closing, groups: true) : string.Empty));
                    col.Item().PaddingTop(10).Text("Les dépôts sont garantis par le fonds de Garantie des Dépôts bancaires (loi 2016-48 du 11-07-2016).");
                });
            });
        }
    }).GenerateSerialized();

    private static void MonthlyRow(IContainer container, string date, string label, string reference, string valueDate, string debit, string credit) =>
        container.Row(row =>
        {
            row.ConstantItem(55).Text(date);
            row.ConstantItem(200).Text(label);
            row.ConstantItem(110).Text(reference);
            row.ConstantItem(70).Text(valueDate);
            row.ConstantItem(55).AlignRight().Text(debit);
            row.ConstantItem(65).AlignRight().Text(credit);
        });

    /// <summary>Libellé de solde/total ; date et montants remontés de 4 pt (décalage observé sur le vrai relevé).</summary>
    private static void MonthlySummary(IContainer container, string label, string date, string debit, string credit) =>
        container.Row(row =>
        {
            row.ConstantItem(255).AlignRight().PaddingRight(20).Text(label).Bold();
            row.ConstantItem(110).TranslateY(-4).Text(date);
            row.ConstantItem(70).Text(string.Empty);
            row.ConstantItem(55).TranslateY(-4).AlignRight().Text(debit);
            row.ConstantItem(65).TranslateY(-4).AlignRight().Text(credit);
        });

    /// <summary>PDF sans couche texte (page « scannée ») : un simple aplat.</summary>
    public static byte[] ImageOnly() => Document.Create(container =>
    {
        container.Page(page =>
        {
            page.Size(PageSizes.A4);
            page.Content().Height(200).Background(Colors.Grey.Lighten2);
        });
    }).GenerateSerialized();

    /// <summary>Page texte SANS date d'opération reconnaissable (banque inconnue) : lignes libres.</summary>
    public static byte[] UnknownLayout(int rows) => Document.Create(container =>
    {
        container.Page(page =>
        {
            page.Size(PageSizes.A4);
            page.Margin(20);
            page.DefaultTextStyle(t => t.FontSize(8));
            page.Content().Column(col =>
            {
                col.Item().Text("ETABLISSEMENT FICTIF - EXTRAIT DE COMPTE");
                for (var i = 1; i <= rows; i++)
                    col.Item().Text($"MOUVEMENT NUMERO {i:D2} REFERENCE INTERNE        {i},500");
            });
        });
    }).GenerateSerialized();

    public static byte[] ManyPages(int count) => Document.Create(container =>
    {
        for (var i = 0; i < count; i++)
            container.Page(page => page.Content().Text($"Page {i + 1}"));
    }).GenerateSerialized();

    private static IContainer Cell(TableDescriptor table, uint span = 1) =>
        table.Cell().ColumnSpan(span).Border(0.5f).Padding(3).AlignMiddle();

    private static void Row(IContainer container, string left, string valueDate, decimal? debit, decimal? credit) =>
        container.Row(row =>
        {
            row.ConstantItem(300).Text(left);
            row.ConstantItem(70).Text(valueDate);
            row.ConstantItem(90).AlignRight().Text(debit is { } d ? Comma(d, groups: true) : string.Empty);
            row.ConstantItem(90).AlignRight().Text(credit is { } c ? Comma(c, groups: true) : string.Empty);
        });

    private static void SignedRow(IContainer container, string date, string label, string valueDate, string debit, string credit) =>
        container.Row(row =>
        {
            row.ConstantItem(60).Text(date);
            row.ConstantItem(250).Text(label);
            row.ConstantItem(70).Text(valueDate);
            row.ConstantItem(80).AlignRight().Text(debit);
            row.ConstantItem(80).AlignRight().Text(credit);
        });

    /// <summary>« 1 234.567 » (STB).</summary>
    private static string Dot(decimal value) =>
        value.ToString("#,##0.000", CultureInfo.InvariantCulture).Replace(',', ' ');

    /// <summary>« 1 234,567 » ou « 1234,567 ».</summary>
    private static string Comma(decimal value, bool groups) =>
        value.ToString(groups ? "#,##0.000" : "0.000", CultureInfo.InvariantCulture).Replace(',', ' ').Replace('.', ',');
}
