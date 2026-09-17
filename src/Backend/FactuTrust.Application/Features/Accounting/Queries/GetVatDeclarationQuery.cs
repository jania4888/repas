using FactuTrust.Application.Common;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting;
using FactuTrust.Application.Features.Accounting.MonthlyDeclaration;
using FactuTrust.Application.Features.Accounting.OfficialForm;
using FactuTrust.Application.Features.Accounting.Services;
using FactuTrust.Application.Features.Reports.Queries;
using FactuTrust.Application.Features.WithholdingTax.Queries;
using FactuTrust.Domain.Authorization;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using MediatR;
using Microsoft.Extensions.Options;

namespace FactuTrust.Application.Features.Accounting.Queries;

/// <summary>
/// Quels montants la déclaration doit porter.
/// </summary>
public enum VatDeclarationValuation
{
    /// <summary>
    /// Ce qui a été déposé : si une déclaration existe en base, ses montants font foi et rien ne
    /// bouge derrière le dos de l'utilisateur. Mode de l'écran de saisie et des deux PDF, pour
    /// qu'un document édité ne diverge jamais du dépôt qu'il représente.
    /// </summary>
    Declared = 0,

    /// <summary>
    /// Ce que les modules produisent aujourd'hui, en ignorant la déclaration enregistrée.
    /// Réservé aux appelants qui ont besoin du recalcul : la sauvegarde (qui rafraîchit la TVA
    /// depuis les écritures) et l'estimation du tableau de bord.
    /// </summary>
    Live = 1
}

/// <param name="EnforceCompanySubmittedOnly">
/// Quand true (GET/PDF HTTP société), n'expose que les déclarations Soumise/Verrouillée.
/// Laisser false pour les appels internes (save, reporting) afin de ne pas casser le recalcul.
/// </param>
/// <param name="Valuation">Voir <see cref="VatDeclarationValuation"/>. Par défaut : les montants déposés.</param>
public sealed record GetVatDeclarationQuery(
    int Year,
    int Month,
    bool EnforceCompanySubmittedOnly = false,
    VatDeclarationValuation Valuation = VatDeclarationValuation.Declared) : IRequest<Result<VatDeclarationDto>>;

public sealed class GetVatDeclarationQueryHandler : IRequestHandler<GetVatDeclarationQuery, Result<VatDeclarationDto>>
{
    private static readonly int[] TunisiaVatRates = [19, 13, 7];

    private readonly IMediator _mediator;
    private readonly IVatDeclarationRepository _vatDeclarationRepository;
    private readonly IJournalEntryRepository _journalEntries;
    private readonly IInvoiceRepository _invoices;
    private readonly ISupplierInvoiceRepository _supplierInvoices;
    private readonly ITenantCompanySummaryProvider _tenantCompanySummary;
    private readonly PayrollDeclarationContributionProvider _payroll;
    private readonly MonthlyDeclarationLineComposer _composer;
    private readonly AccountingSettings _settings;

    public GetVatDeclarationQueryHandler(
        IMediator mediator,
        IVatDeclarationRepository vatDeclarationRepository,
        IJournalEntryRepository journalEntries,
        IInvoiceRepository invoices,
        ISupplierInvoiceRepository supplierInvoices,
        ITenantCompanySummaryProvider tenantCompanySummary,
        PayrollDeclarationContributionProvider payroll,
        MonthlyDeclarationLineComposer composer,
        IOptions<AccountingSettings> settings)
    {
        _mediator = mediator;
        _vatDeclarationRepository = vatDeclarationRepository;
        _journalEntries = journalEntries;
        _invoices = invoices;
        _supplierInvoices = supplierInvoices;
        _tenantCompanySummary = tenantCompanySummary;
        _payroll = payroll;
        _composer = composer;
        _settings = settings.Value;
    }

    public async Task<Result<VatDeclarationDto>> Handle(GetVatDeclarationQuery request, CancellationToken cancellationToken)
    {
        // Filtre société : early-return avant tout recalcul pour ne pas fuiter les montants d'un brouillon.
        if (request.EnforceCompanySubmittedOnly)
        {
            var companyVisible = await _vatDeclarationRepository.GetByYearMonthAsync(
                request.Year, request.Month, cancellationToken);
            if (companyVisible is null || !VatDeclarationAccess.IsVisibleToCompany(companyVisible.Status))
                return Result.Failure<VatDeclarationDto>(VatDeclarationAccess.NotSubmitted());
        }

        var v2 = _settings.MonthlyDeclarationV2Enabled;

        var context = await BuildPeriodContextAsync(request, cancellationToken);
        if (context.Error is not null)
            return Result.Failure<VatDeclarationDto>(context.Error);

        var saved = await _vatDeclarationRepository.GetByYearMonthAsync(request.Year, request.Month, cancellationToken);

        // Ce que les modules produisent aujourd'hui. Calculé dans tous les cas : même quand la
        // déclaration est déposée et fait foi, l'écart doit rester visible.
        // Composition paramétrée, faite UNE fois : elle alimente à la fois la remontée vers les
        // scalaires et le détail par ligne exposé à l'écran. Inerte — et sans requête — quand le
        // drapeau est éteint ou le dossier en calcul historique.
        var composed = v2
            ? await _composer.ComposeAsync(request.Year, request.Month, context.Payroll, cancellationToken)
            : ComposedDeclarationLines.Inactive;

        var live = await ComputeLiveAsync(request, context, v2, composed, cancellationToken);

        // Ce que la déclaration porte réellement. Une déclaration enregistrée fait foi, y compris
        // pour la TVA : un document déposé ne se réécrit pas tout seul entre deux affichages.
        var declared = saved is not null && request.Valuation == VatDeclarationValuation.Declared
            ? TaxAmounts.FromEntity(saved)
            : live;

        var declaredLines = saved is { Lines.Count: > 0 } && request.Valuation == VatDeclarationValuation.Declared
            ? MonthlyDeclarationLineSnapshot.Read(saved.Lines)
            : null;

        var tenantSummary = await _tenantCompanySummary.GetCurrentTenantSummaryAsync(cancellationToken);

        var dto = new VatDeclarationDto
        {
            Year = request.Year,
            Month = request.Month,
            CollectedVat19 = declared.CollectedVat19,
            CollectedVat13 = declared.CollectedVat13,
            CollectedVat7 = declared.CollectedVat7,
            DeductibleVatGoods = declared.DeductibleVatGoods,
            DeductibleVatAssets = declared.DeductibleVatAssets,
            PreviousCredit = declared.PreviousCredit,
            VatDue = declared.VatDue,
            CreditToCarry = declared.CreditToCarry,
            Currency = context.Currency,
            Status = saved != null ? (int)saved.Status : (int)VatDeclarationStatus.Draft,
            Fodec = declared.Fodec,
            DroitTimbre = declared.DroitTimbre,
            Tcl = declared.Tcl,
            Tfp = declared.Tfp,
            Foprolos = declared.Foprolos,
            WithholdingTax = declared.WithholdingTax,
            Acomptes = declared.Acomptes,
            ConsumptionDuty = declared.ConsumptionDuty,
            HotelTax = declared.HotelTax,
            LicenceFee = declared.LicenceFee,
            MonthlyDeclarationMode = (int)composed.Mode,
            // Le dépôt fait foi jusque dans le détail : tant qu'une déclaration enregistrée porte
            // des lignes, ce sont elles qui s'affichent, même si la configuration a changé depuis.
            // Le recalcul reste visible dans la section « suggéré ».
            Lines = declaredLines ?? MapLines(composed),
            MonthlyDeclarationDiagnostics = MapDiagnostics(composed.Diagnostics),
            ParityMaxGapMillimes = MaxGapMillimes(live, composed),
            TotalToPay = TotalToPay(declared, v2),
            Version = saved?.RevisionNumber ?? 1,
            IsRectificative = saved?.IsRectificative ?? false,
            MonthlyDeclarationV2Enabled = v2,
            CreatedAt = saved?.CreatedAt,
            UpdatedAt = saved?.UpdatedAt,
            SubmittedAt = saved?.SubmittedAt,
            CreatedBy = saved?.CreatedBy,
            UpdatedBy = saved?.UpdatedBy,
            FilingDeadline = VatFilingDeadline.ForPeriod(request.Year, request.Month),
            DeclarationTypeDisplay = v2 ? "Déclaration mensuelle unique" : "Déclaration TVA",
            CollectedVatBreakdown = context.CollectedVatBreakdown,
            DeductiblePurchasesTaxableBase = context.DeductiblePurchasesTaxableBase,
            SalesTaxableBase = context.SalesTaxableBase,
            SalesGrossBase = context.SalesGrossBase,
            FodecTaxableBase = context.FodecTaxableBase,
            FodecRatePercent = _settings.FodecRatePercent,
            TclRatePercent = _settings.TclRatePercent,
            // Assiette et taux des taxes sur salaires : contexte, pas montant déclaré. Ils
            // décrivent la paie du mois et valent donc pour les deux valorisations.
            PayrollTaxBase = context.Payroll.TaxBase,
            TfpRatePercent = context.Payroll.TfpRatePercent,
            FoprolosRatePercent = context.Payroll.FoprolosRatePercent,
            PayrollSalariesGrossBase = context.Payroll.SalariesGrossBase,
            PayrollSalariesNetTaxableBase = context.Payroll.SalariesNetTaxableBase,
            PayrollWithholdingIrpp = context.Payroll.WithholdingIrpp,
            PayrollWithholdingCss = context.Payroll.WithholdingCss,
            RentWithholdingBase = context.RentWithholdingBase,
            RentWithholdingAmount = context.RentWithholdingAmount,
            CompanyName = tenantSummary?.CompanyName ?? string.Empty,
            Nif = tenantSummary?.Nif ?? string.Empty,
            TaxRegimeDisplay = tenantSummary?.TaxRegimeDisplay ?? string.Empty,
            TradeName = tenantSummary?.TradeName,
            // Déjà chargée par le provider mais jusqu'ici non remontée : l'en-tête du formulaire
            // officiel en a besoin.
            AddressLine = tenantSummary?.AddressLine,
            OfficialFormEnabled = _settings.MonthlyDeclarationOfficialFormEnabled,
            Suggested = v2 ? MapComputed(live, context, v2) : null
        };

        return Result.Success(dto);
    }

    // ── Contexte de période : sources communes aux deux valorisations ──────────

    /// <summary>
    /// Assiettes et ventilations de la période. Toujours vivantes : ce sont des éléments de
    /// contexte (base × taux affichés en regard d'un montant), jamais des montants déclarés.
    /// </summary>
    private sealed record PeriodContext
    {
        public Error? Error { get; init; }
        public string Currency { get; init; } = Money.DefaultCurrency;
        public decimal CollectedVat19 { get; init; }
        public decimal CollectedVat13 { get; init; }
        public decimal CollectedVat7 { get; init; }
        public decimal DeductibleVatGoods { get; init; }
        public decimal DeductibleVatAssets { get; init; }
        public decimal PreviousCredit { get; init; }
        public decimal SalesTaxableBase { get; init; }
        public decimal SalesGrossBase { get; init; }
        public decimal DeductiblePurchasesTaxableBase { get; init; }
        public decimal FodecTaxableBase { get; init; }
        public PayrollMonthlyContribution Payroll { get; init; } = PayrollMonthlyContribution.None;
        public decimal RentWithholdingBase { get; init; }
        public decimal RentWithholdingAmount { get; init; }
        public IReadOnlyList<VatRateBreakdownDto> CollectedVatBreakdown { get; init; } = Array.Empty<VatRateBreakdownDto>();
    }

    private async Task<PeriodContext> BuildPeriodContextAsync(
        GetVatDeclarationQuery request, CancellationToken cancellationToken)
    {
        var start = new DateTime(request.Year, request.Month, 1);
        var end = start.AddMonths(1).AddDays(-1);

        // Assiette légale : seules les factures éligibles (hors brouillon/annulée) alimentent la
        // déclaration, contrairement aux états de consultation qui affichent tout.
        var sales = await _mediator.Send(new GetSalesVatReportQuery(start, end, RealizedOnly: true), cancellationToken);
        if (sales.IsFailure)
            return new PeriodContext { Error = sales.Error };

        var purchases = await _mediator.Send(new GetPurchasesVatReportQuery(start, end, RealizedOnly: true), cancellationToken);
        if (purchases.IsFailure)
            return new PeriodContext { Error = purchases.Error };

        var salesByRate = sales.Value.ToDictionary(r => r.VatRatePercent);
        decimal c19 = salesByRate.TryGetValue(19, out var r19) ? r19.TotalVatAmount : 0;
        decimal c13 = salesByRate.TryGetValue(13, out var r13) ? r13.TotalVatAmount : 0;
        decimal c7 = salesByRate.TryGetValue(7, out var r7) ? r7.TotalVatAmount : 0;

        // TVA collectée assise sur le JOURNAL (plan §6.7) : jamais gardée par le flag
        // CashDeskVatEnabled — seule la CRÉATION des écritures TVA caisse l'est. Garde défensive
        // `?? []` : les mocks Moq « loose » des tests existants rendent null pour cette méthode.
        //
        // Modification des brouillons caisse par le cabinet (plan v3 §1.3/§6.7, D2) : les brouillons
        // caisse sont désormais éditables par le cabinet en contexte délégué
        // (UpdateDraftJournalEntryCommandHandler). Cette méthode fait un RECALCUL LIVE : les
        // montants suivent donc immédiatement les lignes éditées (comme n'importe quelle autre
        // modification de brouillon), et la ventilation par taux reste résolue depuis
        // CashOperation.VatRate de l'opération source — pas depuis les lignes (D2, cf. doc XML de
        // GetPostedCashSaleVatByRateAsync). Cet appel n'affecte QUE ce recalcul en direct :
        // - en mode `Declared` (écran de saisie, PDF), une déclaration déjà ENREGISTRÉE fait foi et
        //   n'est jamais réécrite par une édition de brouillon caisse ultérieure ;
        // - une déclaration en BROUILLON déjà enregistrée n'est rafraîchie qu'au PROCHAIN
        //   enregistrement (SaveVatDeclarationCommand, mise à jour en place — pas une rectificative) ;
        // - une déclaration SOUMISE ne change que par rectificative.
        // Si l'édition supprime la ligne 436711 du brouillon, l'écriture sort simplement des
        // candidats de GetPostedCashSaleVatByRateAsync — assumé, cohérent avec la suppression déjà
        // permise du même brouillon.
        var cashVat = await _journalEntries.GetPostedCashSaleVatByRateAsync(start, end, cancellationToken) ?? [];
        var cashVatByRate = cashVat
            .GroupBy(p => p.RatePercent)
            .ToDictionary(g => g.Key, g => (HtBase: g.Sum(p => p.HtBase), VatAmount: g.Sum(p => p.VatAmount)));

        decimal CashVatFor(int rate) => cashVatByRate.TryGetValue(rate, out var v) ? v.VatAmount : 0m;
        decimal CashHtFor(int rate) => cashVatByRate.TryGetValue(rate, out var v) ? v.HtBase : 0m;

        // Contribution caisse potentiellement NÉGATIVE (période d'extourne, mouvements signés) :
        // aucun écrêtage à zéro — elle se compense avec la TVA collectée facturière de la période.
        c19 += CashVatFor(19);
        c13 += CashVatFor(13);
        c7 += CashVatFor(7);

        var totalPurchaseVat = purchases.Value.Sum(p => p.TotalVatAmount);
        // TVA immobilisations : dérivée de la MÊME source que la TVA achats (lignes de facture
        // fournisseur marquées immobilisation), ce qui garantit qu'elle est un sous-ensemble du total
        // et évite la source croisée avec le journal. Repli sur le compte 43662 uniquement si aucune
        // ligne immobilisation n'est saisie sur la période (dossiers historiques non régressés).
        var assetVatFromInvoices = await _supplierInvoices.SumFixedAssetDeductibleVatAsync(start, end, realizedOnly: true, cancellationToken);
        var dedAssets = assetVatFromInvoices > 0
            ? assetVatFromInvoices
            : await _journalEntries.SumDebitsByAccountAsync("43662", start, end, cancellationToken);
        var dedGoods = Math.Max(0, totalPurchaseVat - dedAssets);

        var prevMonth = start.AddMonths(-1);
        var prev = await _vatDeclarationRepository.GetByYearMonthAsync(prevMonth.Year, prevMonth.Month, cancellationToken);

        var v2 = _settings.MonthlyDeclarationV2Enabled;

        var rentBase = v2
            ? await _journalEntries.SumDebitsByAccountPrefixAsync(
                CashDeskPostingAccounts.Rent, start, end, cancellationToken)
            : 0m;

        return new PeriodContext
        {
            Currency = sales.Value.FirstOrDefault()?.Currency ?? Money.DefaultCurrency,
            CollectedVat19 = c19,
            CollectedVat13 = c13,
            CollectedVat7 = c7,
            DeductibleVatGoods = dedGoods,
            DeductibleVatAssets = dedAssets,
            PreviousCredit = prev?.CreditToCarry.Amount ?? 0,
            // SalesTaxableBase/SalesGrossBase restent STRICTEMENT facturières (plan §6.7) : la
            // caisse n'alimente que la TVA collectée et sa ventilation (CollectedVatBreakdown
            // ci-dessous), jamais les bases CA. Conséquence assumée : Σ breakdown.TaxableBase peut
            // dépasser SalesTaxableBase. La TCL (calculée sur SalesGrossBase, cf. ComputeLiveAsync)
            // et le repli FODEC du binder (MonthlyDeclarationFormBinder) restent donc inchangés.
            SalesTaxableBase = sales.Value.Sum(r => r.TotalTaxableAmount),
            SalesGrossBase = sales.Value.Sum(r => r.TotalTaxableAmount + r.TotalVatAmount),
            DeductiblePurchasesTaxableBase = purchases.Value.Sum(p => p.TotalTaxableAmount),
            FodecTaxableBase = v2 ? await _invoices.SumFodecTaxableBaseAsync(start, end, cancellationToken) : 0m,
            Payroll = v2 ? await _payroll.GetAsync(request.Year, request.Month, cancellationToken) : PayrollMonthlyContribution.None,
            RentWithholdingBase = rentBase,
            RentWithholdingAmount = RentWithholdingFormLines.ComputeAmount(rentBase),
            // Base + TVA par taux, caisse incluse : requis par MonthlyDeclarationFormBinder
            // (case Vat.Rate{r}.Base lue depuis breakdown.TaxableBase, Vat.Rate{r}.Due depuis
            // CollectedVat{r}) — ne pas alimenter la base ferait diverger Base × taux de Due.
            CollectedVatBreakdown = TunisiaVatRates
                .Select(rate =>
                {
                    salesByRate.TryGetValue(rate, out var row);
                    return new VatRateBreakdownDto
                    {
                        RatePercent = rate,
                        TaxableBase = (row?.TotalTaxableAmount ?? 0) + CashHtFor(rate),
                        VatAmount = (row?.TotalVatAmount ?? 0) + CashVatFor(rate)
                    };
                })
                .ToList()
        };
    }

    // ── Recalcul temps réel ────────────────────────────────────────────────────

    private async Task<TaxAmounts> ComputeLiveAsync(
        GetVatDeclarationQuery request,
        PeriodContext context,
        bool v2,
        ComposedDeclarationLines composed,
        CancellationToken cancellationToken)
    {
        var start = new DateTime(request.Year, request.Month, 1);
        var end = start.AddMonths(1).AddDays(-1);

        var draft = VatDeclaration.CreateDraft(
            request.Year,
            request.Month,
            // Mouvements signés (plan §6.7 / v2.1) : la contribution caisse peut être négative
            // (extourne d'une période antérieure) sans TVA facturière suffisante pour compenser.
            // Money.Create rejetterait ce cas ; FromSignedAmount préserve le montant tel que
            // recalculé — seul le NET (ComputeNet dans VatDeclaration) doit rester non négatif.
            Money.FromSignedAmount(context.CollectedVat19, context.Currency),
            Money.FromSignedAmount(context.CollectedVat13, context.Currency),
            Money.FromSignedAmount(context.CollectedVat7, context.Currency),
            Money.Create(context.DeductibleVatGoods, context.Currency),
            Money.Create(context.DeductibleVatAssets, context.Currency),
            Money.Create(context.PreviousCredit, context.Currency),
            context.Currency);

        var vat = new TaxAmounts
        {
            CollectedVat19 = draft.CollectedVat19.Amount,
            CollectedVat13 = draft.CollectedVat13.Amount,
            CollectedVat7 = draft.CollectedVat7.Amount,
            DeductibleVatGoods = draft.DeductibleVatGoods.Amount,
            DeductibleVatAssets = draft.DeductibleVatAssets.Amount,
            PreviousCredit = draft.PreviousCredit.Amount,
            VatDue = draft.VatDue.Amount,
            CreditToCarry = draft.CreditToCarry.Amount
        };

        if (!v2)
            return vat;

        // Retenue à la source : factures fournisseurs, traitements et salaires (IRPP + CSS),
        // et loyers journal 613 (article 4 personnes physiques 10 %).
        var rs = await _mediator.Send(new GetWithholdingMonthlyReportQuery(request.Year, request.Month), cancellationToken);
        var withholdingFromInvoices = rs.GrandTotalWithheld;
        var withholdingFromSalaries = context.Payroll.WithholdingTotal;
        var withholdingFromRentJournal = context.RentWithholdingAmount;

        var legacy = vat with
        {
            Fodec = await _invoices.SumFodecAsync(start, end, cancellationToken),
            DroitTimbre = await _invoices.SumFiscalStampAsync(start, end, cancellationToken),
            Tcl = Math.Round(_settings.TclRatePercent / 100m * context.SalesGrossBase, 3),
            Tfp = context.Payroll.Tfp,
            Foprolos = context.Payroll.Foprolos,
            WithholdingFromInvoices = withholdingFromInvoices,
            WithholdingFromSalaries = withholdingFromSalaries,
            WithholdingFromRentJournal = withholdingFromRentJournal,
            WithholdingTax = withholdingFromInvoices + withholdingFromSalaries + withholdingFromRentJournal
            // Acomptes provisionnels : aucune source automatique, saisie manuelle uniquement.
        };

        // Déclaration paramétrable. Hors mode configuré — drapeau éteint, dossier en calcul
        // historique, ou contrôle de parité — `legacy` est rendu tel quel : c'est la garantie de
        // non-régression, vérifiable à l'octet près.
        return composed.Mode switch
        {
            // Contrôle de parité : les deux calculs tournent, mais ce sont les montants
            // historiques qui font foi. Seul l'écart est exposé, pour que la bascule se constate
            // avant de se subir.
            MonthlyDeclarationMode.Configured => ApplyRollUp(legacy, composed),
            _ => legacy
        };
    }

    /// <summary>
    /// Remplace, famille par famille, les scalaires historiques par le total des rubriques.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Fonction pure et cloisonnée par famille : une famille sans rubrique applicable conserve sa
    /// valeur historique, de sorte qu'un paramétrage partiel ne fabrique jamais un montant hybride.
    /// </para>
    /// <para>
    /// La T.V.A est délibérément exclue. Ses montants ne viennent pas du journal mais des documents
    /// de facture, l'enregistrement les redérive systématiquement, et <c>VatDue</c> /
    /// <c>CreditToCarry</c> sont le produit d'une arithmétique de solde chaînée d'un mois sur
    /// l'autre — pas d'une ligne paramétrable. La famille reste donc calculée par le chemin
    /// historique tant qu'un lot dédié n'aura pas traité le chaînage du crédit.
    /// </para>
    /// </remarks>
    internal static TaxAmounts ApplyRollUp(TaxAmounts legacy, ComposedDeclarationLines composed)
    {
        decimal Resolve(MonthlyDeclarationFamily family, decimal fallback) =>
            composed.ActiveFamilies.Contains(family) ? composed.WithheldFor(family) : fallback;

        var withholding = Resolve(MonthlyDeclarationFamily.Withholding, legacy.WithholdingTax);
        var withholdingIsConfigured = composed.ActiveFamilies.Contains(MonthlyDeclarationFamily.Withholding);

        return legacy with
        {
            Fodec = Resolve(MonthlyDeclarationFamily.OtherTurnoverTaxes, legacy.Fodec),
            DroitTimbre = Resolve(MonthlyDeclarationFamily.StampDuty, legacy.DroitTimbre),
            Tcl = Resolve(MonthlyDeclarationFamily.Tcl, legacy.Tcl),
            Tfp = Resolve(MonthlyDeclarationFamily.Tfp, legacy.Tfp),
            Foprolos = Resolve(MonthlyDeclarationFamily.Foprolos, legacy.Foprolos),
            ConsumptionDuty = Resolve(MonthlyDeclarationFamily.ConsumptionDuty, legacy.ConsumptionDuty),
            HotelTax = Resolve(MonthlyDeclarationFamily.HotelTax, legacy.HotelTax),
            LicenceFee = Resolve(MonthlyDeclarationFamily.LicenceFee, legacy.LicenceFee),
            WithholdingTax = withholding,
            // La ventilation historique de la retenue (factures / salaires / loyers) n'a plus de
            // sens dès que les rubriques la produisent : la laisser renseignée ferait apparaître à
            // l'écran une décomposition qui ne totalise pas le montant affiché.
            WithholdingFromInvoices = withholdingIsConfigured ? 0m : legacy.WithholdingFromInvoices,
            WithholdingFromSalaries = withholdingIsConfigured ? 0m : legacy.WithholdingFromSalaries,
            WithholdingFromRentJournal = withholdingIsConfigured ? 0m : legacy.WithholdingFromRentJournal,
            WithholdingFromRubrics = withholdingIsConfigured ? withholding : 0m
        };
    }

    /// <summary>
    /// Écart, en millimes, entre le calcul historique et le calcul paramétré pour chaque famille
    /// prise en charge. Sert de preuve chiffrée avant la bascule d'un dossier.
    /// </summary>
    /// <remarks>
    /// N'a de sens qu'en <b>contrôle de parité</b>, seul régime où les deux calculs coexistent. Une
    /// fois le dossier basculé, le montant paramétré <i>est</i> le montant : il n'y a plus rien à
    /// comparer, et l'écart vaut zéro par construction.
    /// </remarks>
    internal static long MaxGapMillimes(TaxAmounts legacy, ComposedDeclarationLines composed)
    {
        if (composed.Mode != MonthlyDeclarationMode.Parity || composed.ActiveFamilies.Count == 0)
            return 0;

        var configured = ApplyRollUp(legacy, composed);
        var gaps = new[]
        {
            configured.Fodec - legacy.Fodec,
            configured.DroitTimbre - legacy.DroitTimbre,
            configured.Tcl - legacy.Tcl,
            configured.Tfp - legacy.Tfp,
            configured.Foprolos - legacy.Foprolos,
            configured.WithholdingTax - legacy.WithholdingTax,
            configured.ConsumptionDuty - legacy.ConsumptionDuty,
            configured.HotelTax - legacy.HotelTax,
            configured.LicenceFee - legacy.LicenceFee
        };

        return gaps.Select(g => (long)Math.Round(Math.Abs(g) * 1000m, MidpointRounding.AwayFromZero)).Max();
    }

    /// <summary>
    /// Total net à payer. Les trois familles ajoutées par la déclaration paramétrable valent 0 pour
    /// tout dossier resté en calcul historique : l'expression est donc, en valeur, identique à
    /// celle d'avant le chantier — propriété vérifiée par
    /// <c>GetVatDeclarationV2Tests</c>.
    /// </summary>
    internal static decimal TotalToPay(TaxAmounts a, bool v2) => v2
        ? Math.Max(0m, a.VatDue + a.Fodec + a.DroitTimbre + a.Tcl + a.Tfp + a.Foprolos + a.WithholdingTax
                       + a.ConsumptionDuty + a.HotelTax + a.LicenceFee - a.Acomptes)
        : a.VatDue;

    private static IReadOnlyList<MonthlyDeclarationLineDto> MapLines(ComposedDeclarationLines composed) =>
        composed.Lines
            .Select(l => new MonthlyDeclarationLineDto
            {
                Code = l.Code,
                Label = l.Label,
                Family = (int)l.Family,
                ReportCode = l.ReportCode,
                Gross = l.Gross,
                Withheld = l.Withheld,
                RatePercentApplied = l.RatePercentApplied,
                RequiresManualInput = l.RequiresManualInput,
                Diagnostics = MapDiagnostics(l.Diagnostics)
            })
            .ToList();

    private static IReadOnlyList<MonthlyDeclarationDiagnosticDto> MapDiagnostics(
        IReadOnlyList<RubricDiagnostic> diagnostics) =>
        diagnostics
            .Select(d => new MonthlyDeclarationDiagnosticDto { Kind = (int)d.Kind, Detail = d.Detail })
            .ToList();

    private static VatDeclarationComputedDto MapComputed(TaxAmounts live, PeriodContext context, bool v2) => new()
    {
        CollectedVat19 = live.CollectedVat19,
        CollectedVat13 = live.CollectedVat13,
        CollectedVat7 = live.CollectedVat7,
        DeductibleVatGoods = live.DeductibleVatGoods,
        DeductibleVatAssets = live.DeductibleVatAssets,
        PreviousCredit = live.PreviousCredit,
        VatDue = live.VatDue,
        CreditToCarry = live.CreditToCarry,
        Fodec = live.Fodec,
        DroitTimbre = live.DroitTimbre,
        Tcl = live.Tcl,
        Tfp = live.Tfp,
        Foprolos = live.Foprolos,
        WithholdingTax = live.WithholdingTax,
        WithholdingFromInvoices = live.WithholdingFromInvoices,
        WithholdingFromSalaries = live.WithholdingFromSalaries,
        WithholdingFromRentJournal = live.WithholdingFromRentJournal,
        WithholdingFromRubrics = live.WithholdingFromRubrics,
        ConsumptionDuty = live.ConsumptionDuty,
        HotelTax = live.HotelTax,
        LicenceFee = live.LicenceFee,
        TotalToPay = TotalToPay(live, v2),
        PayrollRunExists = context.Payroll.RunExists,
        PayrollRunStatus = context.Payroll.Status is { } s ? (int)s : null,
        PayrollRunStatusDisplay = context.Payroll.Status?.ToDisplayString(),
        PayrollRunUsable = context.Payroll.IsUsable
    };

    /// <summary>
    /// Jeu de montants d'une déclaration, qu'il vienne du recalcul ou du dépôt enregistré. Deux
    /// instances de même forme rendent l'écart calculable ligne à ligne.
    /// </summary>
    internal sealed record TaxAmounts
    {
        public decimal CollectedVat19 { get; init; }
        public decimal CollectedVat13 { get; init; }
        public decimal CollectedVat7 { get; init; }
        public decimal DeductibleVatGoods { get; init; }
        public decimal DeductibleVatAssets { get; init; }
        public decimal PreviousCredit { get; init; }
        public decimal VatDue { get; init; }
        public decimal CreditToCarry { get; init; }
        public decimal Fodec { get; init; }
        public decimal DroitTimbre { get; init; }
        public decimal Tcl { get; init; }
        public decimal Tfp { get; init; }
        public decimal Foprolos { get; init; }
        public decimal WithholdingTax { get; init; }
        public decimal WithholdingFromInvoices { get; init; }
        public decimal WithholdingFromSalaries { get; init; }
        public decimal WithholdingFromRentJournal { get; init; }

        /// <summary>Part de la RS produite par les rubriques paramétrées (0 hors mode configuré).</summary>
        public decimal WithholdingFromRubrics { get; init; }

        /// <summary>Droit de consommation — famille produite uniquement par le moteur paramétré.</summary>
        public decimal ConsumptionDuty { get; init; }

        /// <summary>Taxe hôtelière — famille produite uniquement par le moteur paramétré.</summary>
        public decimal HotelTax { get; init; }

        /// <summary>Droit de licence — famille produite uniquement par le moteur paramétré.</summary>
        public decimal LicenceFee { get; init; }

        public decimal Acomptes { get; init; }

        public static TaxAmounts FromEntity(VatDeclaration d) => new()
        {
            CollectedVat19 = d.CollectedVat19.Amount,
            CollectedVat13 = d.CollectedVat13.Amount,
            CollectedVat7 = d.CollectedVat7.Amount,
            DeductibleVatGoods = d.DeductibleVatGoods.Amount,
            DeductibleVatAssets = d.DeductibleVatAssets.Amount,
            PreviousCredit = d.PreviousCredit.Amount,
            VatDue = d.VatDue.Amount,
            CreditToCarry = d.CreditToCarry.Amount,
            Fodec = d.Fodec,
            DroitTimbre = d.DroitTimbre,
            Tcl = d.Tcl,
            Tfp = d.Tfp,
            Foprolos = d.Foprolos,
            WithholdingTax = d.WithholdingTax,
            ConsumptionDuty = d.ConsumptionDuty,
            HotelTax = d.HotelTax,
            LicenceFee = d.LicenceFee,
            // La déclaration ne mémorise pas la répartition de la RS : seul le total est déposé.
            Acomptes = d.Acomptes
        };
    }
}
