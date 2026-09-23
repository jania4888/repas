using FactuTrust.Application.Common;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;

namespace FactuTrust.Application.Features.WithholdingTax.Services;

public sealed class SupplierInvoiceTejDeclarationBuilder : ISupplierInvoiceTejDeclarationBuilder
{
    private readonly ISupplierInvoiceRepository _invoices;
    private readonly IWithholdingTaxRepository _whRepo;
    private readonly IWithholdingTaxService _withholdingCalc;
    private readonly IWithholdingFiscalYearParameterRepository _fiscalYearParameters;

    public SupplierInvoiceTejDeclarationBuilder(
        ISupplierInvoiceRepository invoices,
        IWithholdingTaxRepository whRepo,
        IWithholdingTaxService withholdingCalc,
        IWithholdingFiscalYearParameterRepository fiscalYearParameters)
    {
        _invoices = invoices;
        _whRepo = whRepo;
        _withholdingCalc = withholdingCalc;
        _fiscalYearParameters = fiscalYearParameters;
    }

    public async Task<Result<IReadOnlyList<TejRsCertificatPayload>>> BuildForPeriodAsync(
        int year,
        int month,
        CancellationToken cancellationToken = default)
    {
        var list = await _invoices.GetPaidWithholdingInvoicesForTejPeriodAsync(year, month, cancellationToken);
        if (list.Count == 0)
            return Result.Success<IReadOnlyList<TejRsCertificatPayload>>(Array.Empty<TejRsCertificatPayload>());

        var payloads = new List<TejRsCertificatPayload>();
        var errors = new List<string>();

        foreach (var inv in list)
        {
            var mapped = await MapInvoiceAsync(inv, cancellationToken);
            if (mapped.IsFailure)
                errors.Add($"{inv.InvoiceNumber}: {mapped.Error.Description}");
            else
                payloads.Add(mapped.Value);
        }

        if (errors.Count > 0)
        {
            return Result.Failure<IReadOnlyList<TejRsCertificatPayload>>(
                Error.Validation("TejDeclaration", string.Join(" ", errors)));
        }

        return Result.Success<IReadOnlyList<TejRsCertificatPayload>>(payloads);
    }

    private async Task<Result<TejRsCertificatPayload>> MapInvoiceAsync(
        SupplierInvoice inv,
        CancellationToken cancellationToken)
    {
        var supplier = inv.Supplier;
        var wt = await SupplierInvoiceWithholdingComputation.ResolveTypeAsync(inv, supplier, _whRepo, cancellationToken);

        if (wt is null)
        {
            return Result.Failure<TejRsCertificatPayload>(
                Error.Validation("WithholdingTaxType", "Aucun type de retenue RS7 actif. Complétez la fiche fournisseur ou les paramètres RS."));
        }

        if (!inv.PaidAt.HasValue)
        {
            return Result.Failure<TejRsCertificatPayload>(
                Error.Validation("PaidAt", "Date de solde de facture manquante."));
        }

        var paymentDate = inv.PaidAt.Value.Date;
        var rs7Th = await _fiscalYearParameters.GetRs7TtcThresholdAsync(paymentDate.Year, cancellationToken);

        var calc = SupplierInvoiceWithholdingComputation.Calculate(
            inv, supplier, wt, _withholdingCalc, hasCNPC: false, hasPriseEnCharge: false, rs7Th);
        var totalRs = SupplierInvoiceWithholdingComputation.TotalWithheldAmount(calc);
        var vatRate = inv.SubTotal.Amount > 0
            ? Math.Round(inv.TotalVat.Amount / inv.SubTotal.Amount * 100m, 4)
            : 0m;
        var category = supplier.Type == SupplierType.Business
            ? BeneficiaryCategory.PersonneMorale
            : BeneficiaryCategory.PersonnePhysique;

        var idType = supplier.TejIdentificationType
            ?? (supplier.Type == SupplierType.Business ? IdentificationType.MatriculeFiscal : IdentificationType.CIN);

        var idNumber = supplier.NIF?.Value ?? string.Empty;
        if (supplier.Type == SupplierType.Business && string.IsNullOrWhiteSpace(idNumber))
        {
            return Result.Failure<TejRsCertificatPayload>(
                Error.Validation("NIF", "Le matricule fiscal du fournisseur est obligatoire."));
        }

        if ((idType is IdentificationType.CIN or IdentificationType.Passeport or IdentificationType.CarteSejour)
            && !supplier.DateOfBirth.HasValue)
        {
            return Result.Failure<TejRsCertificatPayload>(
                Error.Validation("DateOfBirth", "La date de naissance du fournisseur est obligatoire pour ce type d'identification TEJ."));
        }

        if (string.IsNullOrWhiteSpace(idNumber) && supplier.Type == SupplierType.Individual)
        {
            return Result.Failure<TejRsCertificatPayload>(
                Error.Validation("Identification", "Renseignez le NIF ou l'identifiant TEJ du fournisseur (fiche fournisseur)."));
        }

        var address = FormatAddress(supplier.Address);
        var email = supplier.Email?.Value ?? string.Empty;
        var phone = supplier.Phone?.Value ?? "00000000";

        var line = new TejRsCertificatLinePayload(
            wt.Code,
            calc.GrossAmountHT,
            vatRate,
            calc.VatAmount,
            calc.AmountTTC,
            calc.WithholdingRate,
            totalRs,
            calc.NetAmountPaid,
            null,
            null,
            null,
            null,
            null);

        var refDecl = $"FF-{inv.InvoiceNumber.Trim()}";

        var payload = new TejRsCertificatPayload(
            refDecl,
            paymentDate,
            paymentDate.Year,
            HasCNPC: false,
            HasPriseEnCharge: false,
            category,
            idType,
            string.IsNullOrWhiteSpace(idNumber) ? "—" : idNumber.Trim(),
            supplier.IsResident,
            supplier.CountryCode,
            supplier.DateOfBirth,
            supplier.Name,
            address,
            email,
            phone,
            supplier.Activity,
            new List<TejRsCertificatLinePayload> { line },
            calc.GrossAmountHT,
            calc.VatAmount,
            calc.AmountTTC,
            totalRs,
            calc.NetAmountPaid);

        return Result.Success(payload);
    }

    private static string FormatAddress(Address a)
    {
        var parts = new[] { a.Street, a.StreetLine2, a.PostalCode, a.City, a.Governorate, a.Country }
            .Where(p => !string.IsNullOrWhiteSpace(p))
            .Select(p => p!.Trim());
        return string.Join(", ", parts);
    }
}
