using System.Text;
using System.Xml.Linq;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.Services;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services;

/// <summary>
/// Golden checks: XML structure, millimes, and validator acceptance for a minimal déclaration RS.
/// </summary>
public sealed class TejXmlGeneratorGoldenTests
{
    [Fact]
    public async Task GenerateAsync_RS7_line_emits_montant_rs_as_millimes_and_passes_validator()
    {
        var address = Address.Create("1 rue Test", "Tunis", "Tunis", null, null);
        Assert.True(address.IsSuccess);
        var nif = NIF.Create("1234567/A/B/C/000");
        Assert.True(nif.IsSuccess);
        var email = Email.Create("declarant@test.tn");
        Assert.True(email.IsSuccess);

        var companyResult = Company.Create("Société Déclarante", address.Value, nif.Value, email.Value);
        Assert.True(companyResult.IsSuccess);
        var company = companyResult.Value;

        const decimal totalRs = 337.841m;
        const decimal ht = 20_000m;
        const decimal vatRate = 19m;
        const decimal vat = 3800m;
        const decimal ttc = 23_800m;
        const decimal net = ttc - totalRs;

        var line = new TejRsCertificatLinePayload(
            "RS7_000001",
            ht,
            vatRate,
            vat,
            ttc,
            1.5m,
            totalRs,
            net,
            null,
            null,
            null,
            null,
            null);

        var payload = new TejRsCertificatPayload(
            RefCertifChezDeclarant: "CERT-GOLD-01",
            PaymentDate: new DateTime(2026, 1, 20),
            BillingYear: 2026,
            HasCNPC: false,
            HasPriseEnCharge: false,
            BeneficiaryCategory: BeneficiaryCategory.PersonneMorale,
            IdentificationType: IdentificationType.MatriculeFiscal,
            IdentificationNumber: "8988998A",
            IsResident: true,
            CountryCode: "TN",
            DateOfBirth: null,
            BeneficiaryName: "TECHNO TEST",
            BeneficiaryAddress: "Adresse",
            BeneficiaryEmail: "f@test.tn",
            BeneficiaryPhone: "71123456",
            BeneficiaryActivity: "Commerce",
            Lines: new List<TejRsCertificatLinePayload> { line },
            TotalAmountHT: ht,
            TotalAmountTVA: vat,
            TotalAmountTTC: ttc,
            TotalAmountWithheld: totalRs,
            TotalNetPaid: net);

        var sut = new TejXmlGeneratorService(new TejXmlValidatorService());
        var export = await sut.GenerateAsync(company, new List<TejRsCertificatPayload> { payload }, 2026, 1, TejSubmissionType.Initial);

        Assert.True(export.CertificateCount == 1);
        var text = Encoding.UTF8.GetString(export.XmlContent);
        var doc = XDocument.Parse(text);
        var montantRs = doc.Descendants("MontantRS").FirstOrDefault();
        Assert.NotNull(montantRs);
        Assert.Equal("337841", montantRs!.Value.Trim());

        var validator = new TejXmlValidatorService();
        var errors = validator.Validate(export.XmlContent);
        Assert.Empty(errors);
    }

    [Fact]
    public async Task GenerateAsync_MissingBeneficiaryEmail_WritesEmptyAdresseMail()
    {
        var address = Address.Create("1 rue Test", "Tunis", "Tunis", null, null);
        Assert.True(address.IsSuccess);
        var nif = NIF.Create("1234567/A/B/C/000");
        Assert.True(nif.IsSuccess);
        var email = Email.Create("declarant@test.tn");
        Assert.True(email.IsSuccess);
        var company = Company.Create("Société Déclarante", address.Value, nif.Value, email.Value).Value;

        var line = new TejRsCertificatLinePayload(
            "RS7_000001", 100m, 19m, 19m, 119m, 1.5m, 1.5m, 117.5m,
            null, null, null, null, null);

        var payload = new TejRsCertificatPayload(
            "CERT-NO-MAIL",
            new DateTime(2026, 1, 20),
            2026,
            false,
            false,
            BeneficiaryCategory.PersonneMorale,
            IdentificationType.MatriculeFiscal,
            "8988998A",
            true,
            "TN",
            null,
            "TECHNO TEST",
            "Adresse",
            BeneficiaryEmail: null,
            BeneficiaryPhone: "71123456",
            BeneficiaryActivity: "Commerce",
            Lines: new List<TejRsCertificatLinePayload> { line },
            TotalAmountHT: 100m,
            TotalAmountTVA: 19m,
            TotalAmountTTC: 119m,
            TotalAmountWithheld: 1.5m,
            TotalNetPaid: 117.5m);

        var sut = new TejXmlGeneratorService(new TejXmlValidatorService());
        var export = await sut.GenerateAsync(company, new List<TejRsCertificatPayload> { payload }, 2026, 1, TejSubmissionType.Initial);
        var doc = XDocument.Parse(Encoding.UTF8.GetString(export.XmlContent));
        var mail = doc.Descendants("AdresseMail").Single();
        Assert.Equal(string.Empty, mail.Value);
    }
}
