using System.Net.Http;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.Infrastructure.Services;
using Moq;
using UglyToad.PdfPig;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services;

public sealed class TreasuryJournalPdfTests
{
    [Fact]
    public async Task FrenchPdf_ContainsTitleAndThreeDecimalAmount()
    {
        var bytes = await Generate(FrenchDocument());
        var text = Extract(bytes);
        Assert.Contains("Journal de trésorerie", text);
        Assert.Contains("1.500", text);
        Assert.DoesNotContain("note secrète", text);
    }

    [Fact]
    public async Task ArabicPdf_UsesArabicFontAndKeepsTheAmount()
    {
        var bytes = await Generate(ArabicDocument());
        using var stream = new MemoryStream(bytes);
        using var pdf = PdfDocument.Open(stream);
        var letters = pdf.GetPages().SelectMany(page => page.Letters).ToList();
        var text = string.Concat(letters.Select(letter => letter.Value));

        Assert.Contains(letters, letter =>
            letter.FontName.Contains("Naskh", StringComparison.OrdinalIgnoreCase));
        // PdfPig restitue l'arabe dans l'ordre visuel (formes de présentation), pas la chaîne logique.
        // Le titre logique est verrouillé par Export_PassesLocalizedTitle ; ici on vérifie que les glyphes sont peints.
        Assert.Contains("1.500", text);
        Assert.True(text.Count(c => c is >= '\u0600' and <= '\u06FF' or >= '\uFE70' and <= '\uFEFF') >= 8, text);
    }

    private static async Task<byte[]> Generate(TreasuryJournalPdfDocument document)
    {
        var pdf = new PdfService(Mock.Of<IHttpClientFactory>(), Mock.Of<IDocumentTemplateRegistry>());
        return await pdf.GenerateTreasuryJournalPdfAsync(document);
    }

    private static string Extract(byte[] bytes)
    {
        using var stream = new MemoryStream(bytes);
        using var pdf = PdfDocument.Open(stream);
        return string.Join("\n", pdf.GetPages().Select(page => page.Text));
    }

    private static TreasuryJournalPdfDocument FrenchDocument() => new()
    {
        RightToLeft = false,
        CompanyName = "Société Test",
        MatriculeFiscal = "1234567A",
        Title = "Journal de trésorerie",
        PeriodLabel = "Du 01/09/2026 au 30/09/2026",
        MatriculeLabel = "Matricule fiscal",
        CurrencyCaption = "exprimé en Dinars",
        PrintedOnLabel = "Édité le",
        PageLabel = "Page",
        SubtotalLabel = "Sous-total",
        EmptyLabel = "Aucune opération sur cette période.",
        Columns = new[] { "Date", "Type", "Moyen", "Catégorie", "Libellé", "Document", "Débit", "Crédit" },
        Sections = new[]
        {
            new TreasuryJournalPdfSection("Encaissements", new[]
            {
                new TreasuryJournalPdfGroup(
                    "Encaissement ventes au comptant",
                    1.5m,
                    1,
                    new[]
                    {
                        new TreasuryJournalPdfLine(
                            new DateTime(2026, 9, 2),
                            "Crédit",
                            "Espèces",
                            "Encaissement ventes au comptant",
                            "Vente",
                            "ENC-2026-000001",
                            null,
                            1.5m)
                    })
            })
        },
        TotalCreditsLabel = "Total encaissements",
        TotalDebitsLabel = "Total décaissements",
        BalanceLabel = "Solde",
        CountLabel = "Nombre d'opérations",
        TotalCredits = 1.5m,
        TotalDebits = 0m,
        Balance = 1.5m,
        OperationCount = 1,
        Currency = "TND"
    };

    private static TreasuryJournalPdfDocument ArabicDocument()
    {
        var document = FrenchDocument();
        return document with
        {
            RightToLeft = true,
            Title = "يومية الخزينة",
            CurrencyCaption = "بالدينار التونسي",
            PeriodLabel = "من 01/09/2026 إلى 30/09/2026",
            Columns = new[] { "التاريخ", "النوع", "الوسيلة", "الصنف", "البيان", "الوثيقة", "مدين", "دائن" },
            Sections = new[]
            {
                new TreasuryJournalPdfSection("المقبوضات", new[]
                {
                    new TreasuryJournalPdfGroup(
                        "قبض مبيعات نقدية",
                        1.5m,
                        1,
                        new[]
                        {
                            new TreasuryJournalPdfLine(
                                new DateTime(2026, 9, 2),
                                "دائن",
                                "نقداً",
                                "قبض مبيعات نقدية",
                                "بيع",
                                "ENC-2026-000001",
                                null,
                                1.5m)
                        })
                })
            }
        };
    }
}
