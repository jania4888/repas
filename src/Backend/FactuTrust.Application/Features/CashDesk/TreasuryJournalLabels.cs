using System.Globalization;
using FactuTrust.Domain.Enums;

namespace FactuTrust.Application.Features.CashDesk;

/// <summary>
/// Libellés FR/AR du journal de trésorerie uniquement. N'utilise pas <c>ToDisplayString</c>
/// pour ne pas changer les écritures ni la caisse. Le français reprend toutefois les mêmes textes.
/// </summary>
public static class TreasuryJournalLabels
{
    public static bool IsArabic =>
        string.Equals(CultureInfo.CurrentUICulture.TwoLetterISOLanguageName, "ar", StringComparison.OrdinalIgnoreCase);

    public static string Title() => IsArabic ? "يومية الخزينة" : "Journal de trésorerie";

    public static string Encaissements() => IsArabic ? "المقبوضات" : "Encaissements";

    public static string Decaissements() => IsArabic ? "المدفوعات" : "Décaissements";

    public static string Unclassified() => IsArabic ? "غير مصنف" : "Non classé";

    public static string Subtotal() => IsArabic ? "المجموع الجزئي" : "Sous-total";

    public static string TotalCredits() => IsArabic ? "مجموع المقبوضات" : "Total encaissements";

    public static string TotalDebits() => IsArabic ? "مجموع المدفوعات" : "Total décaissements";

    public static string Balance() => IsArabic ? "الرصيد" : "Solde";

    public static string OperationCount() => IsArabic ? "عدد العمليات" : "Nombre d'opérations";

    public static string CurrencyCaption() => IsArabic ? "بالدينار التونسي" : "exprimé en Dinars";

    public static string Matricule() => IsArabic ? "المعرف الجبائي" : "Matricule fiscal";

    public static string PrintedOn() => IsArabic ? "حُرّر في" : "Édité le";

    public static string Page() => IsArabic ? "صفحة" : "Page";

    public static string Empty() => IsArabic ? "لا توجد عملية في هذه الفترة." : "Aucune opération sur cette période.";

    public static string PartialPage() =>
        IsArabic ? "بقية الأسطر في صفحة أخرى." : "Le détail de cette catégorie continue sur une autre page.";

    public static string Period(DateTime from, DateTime to)
    {
        var start = from.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture);
        var end = to.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture);
        return IsArabic ? $"من {start} إلى {end}" : $"Du {start} au {end}";
    }

    public static string Debit() => IsArabic ? "مدين" : "Débit";

    public static string Credit() => IsArabic ? "دائن" : "Crédit";

    public static string OperationType(CashOperationType type) =>
        type == CashOperationType.Credit ? Credit() : Debit();

    public static IReadOnlyList<string> Columns() => IsArabic
        ? new[] { "التاريخ", "النوع", "الوسيلة", "الصنف", "البيان", "الوثيقة", "مدين", "دائن" }
        : new[] { "Date", "Type", "Moyen", "Catégorie", "Libellé", "Document", "Débit", "Crédit" };

    public static string Expense(CashExpenseCategory category) => category switch
    {
        CashExpenseCategory.RentPayment => IsArabic ? "دفع معينات الكراء" : "Paiement des loyers",
        CashExpenseCategory.SuppliesAndConsumables => IsArabic
            ? "تسديد فواتير شراء اللوازم والمواد الاستهلاكية"
            : "Règlement des factures d'achats de fournitures et consommables",
        CashExpenseCategory.MaintenanceAndRepair => IsArabic
            ? "دفع فواتير الصيانة والإصلاح"
            : "Paiement des factures d'entretien et réparation",
        CashExpenseCategory.NetSalaries => IsArabic ? "دفع الأجور الصافية" : "Paiement des salaires nets",
        CashExpenseCategory.TransportCosts => IsArabic ? "دفع مصاريف النقل" : "Paiement des frais de transport",
        CashExpenseCategory.TravelAndTrips => IsArabic ? "سفر وتنقل" : "Voyages et déplacements",
        CashExpenseCategory.VehicleRepairMaintenance => IsArabic
            ? "عربة (إصلاح، صيانة)"
            : "Véhicule (réparation, entretien)",
        CashExpenseCategory.VehicleRentalAndTransport => IsArabic
            ? "كراء عربات ونقل"
            : "Location véhicules et transport",
        CashExpenseCategory.UtilitiesAndEnergy => IsArabic
            ? "أعباء الكراء والطاقة (ماء، كهرباء، غاز)"
            : "Charges locatives et énergie (eau, électricité, gaz)",
        CashExpenseCategory.ProfessionalFees => IsArabic
            ? "أتعاب وخدمات خارجية"
            : "Honoraires et prestations externes",
        CashExpenseCategory.Insurance => IsArabic ? "تأمينات" : "Assurances",
        CashExpenseCategory.TaxesAndDuties => IsArabic ? "أداءات ومعاليم وإتاوات" : "Impôts, taxes et redevances",
        CashExpenseCategory.MarketingAdvertising => IsArabic ? "تسويق وإشهار" : "Marketing et publicité",
        CashExpenseCategory.ITAndSoftware => IsArabic ? "إعلامية وبرمجيات" : "Informatique et logiciels",
        CashExpenseCategory.BankDeposit => IsArabic ? "إيداع في البنك" : "Remise en banque",
        CashExpenseCategory.SupplierInvoicePayment => IsArabic ? "تسديد فاتورة مزوّد" : "Règlement facture fournisseur",
        CashExpenseCategory.Other => IsArabic ? "أخرى" : "Autre",
        _ => IsArabic ? "أخرى" : "Autre"
    };

    public static string Revenue(CashRevenueCategory category) => category switch
    {
        CashRevenueCategory.CashSalesReceipt => IsArabic ? "قبض مبيعات نقدية" : "Encaissement ventes au comptant",
        CashRevenueCategory.ClientReceivablesReceipt => IsArabic ? "قبض ديون الحرفاء" : "Encaissement créances clients",
        CashRevenueCategory.PartnerContributionsReceipt => IsArabic ? "مقبوضات من الشركاء" : "Encaissements reçus des associés",
        CashRevenueCategory.BankCreditReceipt => IsArabic ? "قبض قرض بنكي" : "Encaissement crédit bancaire",
        CashRevenueCategory.Other => IsArabic ? "مقبوضات أخرى" : "Autres encaissements",
        _ => IsArabic ? "مقبوضات أخرى" : "Autres encaissements"
    };

    public static string Method(PaymentMethod method) => method switch
    {
        PaymentMethod.Cash => IsArabic ? "نقداً" : "Espèces",
        PaymentMethod.BankTransfer => IsArabic ? "تحويل بنكي" : "Virement bancaire",
        PaymentMethod.Check => IsArabic ? "صك" : "Chèque",
        PaymentMethod.Card => IsArabic ? "بطاقة بنكية" : "Carte bancaire",
        PaymentMethod.MobilePayment => IsArabic ? "دفع عبر الهاتف" : "Paiement mobile",
        PaymentMethod.Traite => IsArabic ? "كمبيالة" : "Traite (effet de commerce)",
        PaymentMethod.Other => IsArabic ? "أخرى" : "Autre",
        _ => IsArabic ? "أخرى" : "Autre"
    };

    public static string Category(CashOperationType type, int? categoryCode)
    {
        if (categoryCode is null)
            return Unclassified();

        if (type == CashOperationType.Credit && Enum.IsDefined(typeof(CashRevenueCategory), categoryCode.Value))
            return Revenue((CashRevenueCategory)categoryCode.Value);

        if (type == CashOperationType.Debit && Enum.IsDefined(typeof(CashExpenseCategory), categoryCode.Value))
            return Expense((CashExpenseCategory)categoryCode.Value);

        return Unclassified();
    }

    public static readonly CashRevenueCategory[] RevenueOrder =
    {
        CashRevenueCategory.CashSalesReceipt,
        CashRevenueCategory.ClientReceivablesReceipt,
        CashRevenueCategory.PartnerContributionsReceipt,
        CashRevenueCategory.BankCreditReceipt,
        CashRevenueCategory.Other
    };

    public static readonly CashExpenseCategory[] ExpenseOrder =
    {
        CashExpenseCategory.RentPayment,
        CashExpenseCategory.UtilitiesAndEnergy,
        CashExpenseCategory.SuppliesAndConsumables,
        CashExpenseCategory.SupplierInvoicePayment,
        CashExpenseCategory.MaintenanceAndRepair,
        CashExpenseCategory.NetSalaries,
        CashExpenseCategory.TransportCosts,
        CashExpenseCategory.TravelAndTrips,
        CashExpenseCategory.VehicleRepairMaintenance,
        CashExpenseCategory.VehicleRentalAndTransport,
        CashExpenseCategory.ProfessionalFees,
        CashExpenseCategory.Insurance,
        CashExpenseCategory.TaxesAndDuties,
        CashExpenseCategory.MarketingAdvertising,
        CashExpenseCategory.ITAndSoftware,
        CashExpenseCategory.BankDeposit,
        CashExpenseCategory.Other
    };
}
