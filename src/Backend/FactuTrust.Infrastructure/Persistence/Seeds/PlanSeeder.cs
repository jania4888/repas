using FactuTrust.Domain.Billing;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.SectorConfiguration;
using Microsoft.EntityFrameworkCore;

namespace FactuTrust.Infrastructure.Persistence.Seeds;

/// <summary>
/// Lot C1 — Seed des 3 plans initiaux mappant l'enum <see cref="SubscriptionPlan"/>.
///
/// Idempotent : si les plans existent déjà (par code), aucun écrasement.
/// Garantit que <see cref="DbPlanResolver"/> dispose toujours des entrées BD
/// correspondant à l'enum (sinon le fallback hardcodé reste actif et tout fonctionne).
/// </summary>
public static class PlanSeeder
{
    public static async Task SeedAsync(MasterDbContext db, CancellationToken cancellationToken = default)
    {
        var existing = await db.Plans.AsNoTracking()
            .Select(p => p.Code)
            .ToListAsync(cancellationToken);
        var existingSet = new HashSet<string>(existing);

        if (!existingSet.Contains(nameof(SubscriptionPlan.Free)))
        {
            db.Plans.Add(BuildFreePlan());
        }
        if (!existingSet.Contains(nameof(SubscriptionPlan.Monthly)))
        {
            db.Plans.Add(BuildMonthlyPlan());
        }
        if (!existingSet.Contains(nameof(SubscriptionPlan.Annual)))
        {
            db.Plans.Add(BuildAnnualPlan());
        }

        if (db.ChangeTracker.HasChanges())
        {
            await db.SaveChangesAsync(cancellationToken);
        }

        // Lot C1 — Backfill : aligne les Subscriptions existantes (PlanId NULL) sur le seed.
        await BackfillSubscriptionPlanIdAsync(db, cancellationToken);

        // Backfill des LIMITES : le seed ci-dessus est insert-only et ne met jamais à jour les limites
        // d'un plan existant. On réaligne les valeurs sur les constantes (ex. Free MaxCustomEntities 10→50).
        // Exécuté AVANT le backfill des modules (plus fragile) et avec son propre SaveChanges → persiste
        // même si le backfill des modules échoue ensuite.
        await BackfillPlanLimitsAsync(db, cancellationToken);

        // Lot C1 — Backfill défensif : si un nouveau membre d'AppModule a été ajouté
        // après la création d'un plan, on l'ajoute en IsIncluded=true pour préserver
        // l'accès des tenants existants. Les plans "plats" (Modules.Count == 0) restent
        // intacts (rétro-compat permissive gérée par DbPlanResolver).
        await BackfillPlanModulesAsync(db, cancellationToken);

        // Plan §1.1, décision D1 (RÉSOLU — Free = cœur + standard) : aligne le plan Free sur les
        // invariants du seed — (1) réactive tout module offert par le wizard qu'un opérateur aurait
        // désactivé (contrairement au backfill ci-dessus qui n'ajoute que les modules MANQUANTS), et
        // (2) force OFF les modules premium (AI/Forecasting/Studio/Payroll). S'exécute APRÈS
        // BackfillPlanModulesAsync (qui peut ajouter les modules manquants comme inclus).
        await AlignFreePlanWizardModulesAsync(db, cancellationToken);

        // Hygiène de données : les modules cœur sont réputés inclus dans TOUS les plans.
        // `DbPlanResolver.IsModuleAllowedAsync` les autorise désormais sans lire la ligne, donc cette
        // passe ne change plus le comportement applicatif — elle évite que le back-office affiche
        // « Clients : décoché » sur un plan alors que l'application accorde le module malgré tout.
        await AlignCoreModulesOnAllPlansAsync(db, cancellationToken);
    }

    /// <summary>
    /// Force <c>IsIncluded=true</c> sur les modules cœur de chaque plan doté d'une configuration de
    /// modules. Les plans « plats » (zéro ligne) restent intacts : ils sont déjà permissifs côté
    /// <c>DbPlanResolver</c>, et leur ajouter des lignes basculerait tout le plan en mode « la BD
    /// fait foi », ce qui refuserait alors tous les modules non listés.
    /// </summary>
    private static async Task AlignCoreModulesOnAllPlansAsync(MasterDbContext db, CancellationToken cancellationToken)
    {
        var coreModules = SectorConfigurationCatalog.CoreModules.Select(m => (int)m).ToHashSet();
        var plans = await db.Plans
            .Include(p => p.Modules)
            .ToListAsync(cancellationToken);

        var changed = false;
        foreach (var plan in plans)
        {
            if (plan.Modules.Count == 0) continue; // plan plat : déjà permissif, ne pas le basculer

            foreach (var planModule in plan.Modules)
            {
                if (!coreModules.Contains(planModule.Module) || planModule.IsIncluded)
                    continue;

                // Mise à jour EN PLACE (même idiome qu'AlignFreePlanWizardModulesAsync) — surtout pas
                // ReplaceModules, qui ferait clear+re-add et risquerait un DbUpdateConcurrencyException.
                db.Entry(planModule).Property(nameof(PlanModule.IsIncluded)).CurrentValue = true;
                changed = true;
            }
        }

        if (!changed) return;
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Best-effort, comme BackfillPlanModulesAsync : un conflit ne doit pas avorter le démarrage.
            db.ChangeTracker.Clear();
        }
    }

    private static async Task BackfillSubscriptionPlanIdAsync(MasterDbContext db, CancellationToken cancellationToken)
    {
        var seededPlans = await db.Plans.AsNoTracking()
            .Where(p => p.Code == nameof(SubscriptionPlan.Free)
                || p.Code == nameof(SubscriptionPlan.Monthly)
                || p.Code == nameof(SubscriptionPlan.Annual))
            .Select(p => new { p.Id, p.Code })
            .ToListAsync(cancellationToken);
        if (seededPlans.Count == 0) return;

        var byCode = seededPlans.ToDictionary(p => p.Code, p => p.Id, StringComparer.OrdinalIgnoreCase);

        var subscriptions = await db.Subscriptions
            .Where(s => s.PlanId == null)
            .ToListAsync(cancellationToken);
        if (subscriptions.Count == 0) return;

        var changed = false;
        foreach (var s in subscriptions)
        {
            var code = s.Plan.ToString();
            if (byCode.TryGetValue(code, out var planId))
            {
                s.AttachToPlan(planId, s.Plan);
                changed = true;
            }
        }
        if (changed) await db.SaveChangesAsync(cancellationToken);
    }

    private static Plan BuildFreePlan()
    {
        var plan = Plan.Create(
            code: nameof(SubscriptionPlan.Free),
            name: "Gratuit",
            description: "Plan de démarrage pour tester FactuTrust.",
            billingPeriod: BillingPeriod.Free,
            basePriceTND: 0m,
            isPublic: true,
            trialDays: 0,
            sortOrder: 0,
            currency: "TND");

        plan.ReplaceLimits(new[]
        {
            ("MaxInvoicesPerMonth", SubscriptionLimits.Free.MaxInvoicesPerMonth.ToString()),
            ("MaxQuotesPerMonth", SubscriptionLimits.Free.MaxQuotesPerMonth.ToString()),
            ("MaxClients", SubscriptionLimits.Free.MaxClients.ToString()),
            ("MaxProducts", SubscriptionLimits.Free.MaxProducts.ToString()),
            ("MaxStorageBytes", SubscriptionLimits.Free.MaxStorageBytes.ToString()),
            ("MaxUsers", SubscriptionLimits.Free.MaxUsers.ToString()),
            ("MaxCustomEntities", SubscriptionLimits.Free.MaxCustomEntities.ToString()),
            ("MaxCustomFieldsPerEntity", SubscriptionLimits.Free.MaxCustomFieldsPerEntity.ToString()),
            ("MaxCustomRecordsPerEntity", SubscriptionLimits.Free.MaxCustomRecordsPerEntity.ToString()),
            ("MaxCustomRecordViewsPerEntity", SubscriptionLimits.Free.MaxCustomRecordViewsPerEntity.ToString()),
            ("MaxWorkflowsPerEntity", SubscriptionLimits.Free.MaxWorkflowsPerEntity.ToString()),
            ("MaxWorkflowSteps", SubscriptionLimits.Free.MaxWorkflowSteps.ToString()),
            ("MaxWorkflowInstancesPerRecord", SubscriptionLimits.Free.MaxWorkflowInstancesPerRecord.ToString())
        });

        plan.ReplaceFeatures(new[]
        {
            ("ElectronicSignature", SubscriptionLimits.Free.ElectronicSignature),
            ("XmlExport", SubscriptionLimits.Free.XmlExport),
            ("PaymentTracking", SubscriptionLimits.Free.PaymentTracking),
            ("PrioritySupport", SubscriptionLimits.Free.PrioritySupport)
        });

        // Plan §1.1, décision D1 : le plan Free inclut les modules cœur + standard mais PAS les
        // modules premium réservés aux plans payants (AI/Forecasting/Studio/Payroll). Honoraires
        // reste inclus (natif cabinet — hors périmètre du plafond Free, inchangé).
        plan.ReplaceModules(FreePlanModules());
        return plan;
    }

    private static Plan BuildMonthlyPlan()
    {
        var plan = Plan.Create(
            code: nameof(SubscriptionPlan.Monthly),
            name: "Mensuel",
            description: "Toutes les fonctionnalités, facturation mensuelle.",
            billingPeriod: BillingPeriod.Monthly,
            basePriceTND: 49m,
            isPublic: true,
            trialDays: 14,
            sortOrder: 1,
            currency: "TND");

        plan.ReplaceLimits(new[]
        {
            ("MaxInvoicesPerMonth", "∞"),
            ("MaxQuotesPerMonth", "∞"),
            ("MaxClients", "∞"),
            ("MaxProducts", "∞"),
            ("MaxStorageBytes", SubscriptionLimits.Monthly.MaxStorageBytes.ToString()),
            ("MaxUsers", "∞"),
            ("MaxCustomEntities", "∞"),
            ("MaxCustomFieldsPerEntity", "∞"),
            ("MaxCustomRecordsPerEntity", "∞"),
            ("MaxCustomRecordViewsPerEntity", "∞"),
            ("MaxWorkflowsPerEntity", "∞"),
            ("MaxWorkflowSteps", "∞"),
            ("MaxWorkflowInstancesPerRecord", "∞")
        });

        plan.ReplaceFeatures(new[]
        {
            ("ElectronicSignature", SubscriptionLimits.Monthly.ElectronicSignature),
            ("XmlExport", SubscriptionLimits.Monthly.XmlExport),
            ("PaymentTracking", SubscriptionLimits.Monthly.PaymentTracking),
            ("PrioritySupport", SubscriptionLimits.Monthly.PrioritySupport)
        });

        plan.ReplaceModules(AllModulesIncluded());
        return plan;
    }

    private static Plan BuildAnnualPlan()
    {
        var plan = Plan.Create(
            code: nameof(SubscriptionPlan.Annual),
            name: "Annuel",
            description: "Toutes les fonctionnalités + support prioritaire, facturation annuelle (≈ 39 TND/mois).",
            billingPeriod: BillingPeriod.Annual,
            basePriceTND: 468m,
            isPublic: true,
            trialDays: 14,
            sortOrder: 2,
            currency: "TND");

        plan.ReplaceLimits(new[]
        {
            ("MaxInvoicesPerMonth", "∞"),
            ("MaxQuotesPerMonth", "∞"),
            ("MaxClients", "∞"),
            ("MaxProducts", "∞"),
            ("MaxStorageBytes", SubscriptionLimits.Annual.MaxStorageBytes.ToString()),
            ("MaxUsers", "∞"),
            ("MaxCustomEntities", "∞"),
            ("MaxCustomFieldsPerEntity", "∞"),
            ("MaxCustomRecordsPerEntity", "∞"),
            ("MaxCustomRecordViewsPerEntity", "∞"),
            ("MaxWorkflowsPerEntity", "∞"),
            ("MaxWorkflowSteps", "∞"),
            ("MaxWorkflowInstancesPerRecord", "∞")
        });

        plan.ReplaceFeatures(new[]
        {
            ("ElectronicSignature", SubscriptionLimits.Annual.ElectronicSignature),
            ("XmlExport", SubscriptionLimits.Annual.XmlExport),
            ("PaymentTracking", SubscriptionLimits.Annual.PaymentTracking),
            ("PrioritySupport", SubscriptionLimits.Annual.PrioritySupport)
        });

        plan.ReplaceModules(AllModulesIncluded());
        return plan;
    }

    private static IEnumerable<(int Module, bool IsIncluded)> AllModulesIncluded()
    {
        return Enum.GetValues<AppModule>()
            .Select(m => ((int)m, true));
    }

    /// <summary>
    /// Modules du plan Free (décision D1) : tous inclus SAUF les modules premium
    /// (<see cref="AppModuleExtensions.PaidPlanModuleIds"/> = AI/Forecasting/Studio/Payroll) qui sont
    /// semés <c>IsIncluded=false</c>. <see cref="AppModule.Honoraires"/> reste inclus comme aujourd'hui
    /// (natif cabinet, hors périmètre du plafond Free).
    /// </summary>
    private static IEnumerable<(int Module, bool IsIncluded)> FreePlanModules()
    {
        var premium = AppModuleExtensions.PaidPlanModuleIds.Select(m => (int)m).ToHashSet();
        return Enum.GetValues<AppModule>()
            .Select(m => ((int)m, IsIncluded: !premium.Contains((int)m)));
    }

    /// <summary>
    /// Réaligne les limites des plans seedés (Free/Monthly/Annual) sur les constantes
    /// <see cref="SubscriptionLimits"/>. Idempotent : ne réécrit (et ne SaveChanges) que si une valeur
    /// diffère. Source de vérité unique = les mêmes <c>Build*Plan()</c> que le seed initial.
    /// </summary>
    private static async Task BackfillPlanLimitsAsync(MasterDbContext db, CancellationToken cancellationToken)
    {
        var desiredByCode = new Dictionary<string, Dictionary<string, string>>(StringComparer.OrdinalIgnoreCase)
        {
            [nameof(SubscriptionPlan.Free)] = LimitsOf(BuildFreePlan()),
            [nameof(SubscriptionPlan.Monthly)] = LimitsOf(BuildMonthlyPlan()),
            [nameof(SubscriptionPlan.Annual)] = LimitsOf(BuildAnnualPlan())
        };

        var plans = await db.Plans
            .Include(p => p.Limits)
            .ToListAsync(cancellationToken);
        if (plans.Count == 0) return;

        var changed = false;
        foreach (var plan in plans)
        {
            if (!desiredByCode.TryGetValue(plan.Code, out var desired)) continue;

            // Mise à jour EN PLACE (UPDATE) des valeurs divergentes — surtout PAS ReplaceLimits, qui
            // ferait clear+re-add des enfants et déclenche un DbUpdateConcurrencyException (cf. modules).
            foreach (var limit in plan.Limits)
            {
                if (desired.TryGetValue(limit.Key, out var want) && want != limit.Value)
                {
                    db.Entry(limit).Property(nameof(PlanLimit.Value)).CurrentValue = want;
                    changed = true;
                }
            }

            // Ajoute (INSERT) les clés de quota introduites après la création du plan.
            var present = plan.Limits.Select(l => l.Key).ToHashSet(StringComparer.Ordinal);
            foreach (var (key, value) in desired)
            {
                if (present.Contains(key)) continue;
                db.Add(PlanLimit.Create(plan.Id, key, value));
                changed = true;
            }
        }
        if (changed) await db.SaveChangesAsync(cancellationToken);
    }

    private static Dictionary<string, string> LimitsOf(Plan plan) =>
        plan.Limits.ToDictionary(l => l.Key, l => l.Value, StringComparer.Ordinal);

    /// <summary>
    /// Pour chaque plan ayant déjà au moins une ligne <c>PlanModule</c>, ajoute en
    /// <c>IsIncluded = true</c> les modules d'<see cref="AppModule"/> absents.
    /// Préserve l'accès lorsque l'enum est étendu entre deux releases.
    /// </summary>
    private static async Task BackfillPlanModulesAsync(MasterDbContext db, CancellationToken cancellationToken)
    {
        var allModules = Enum.GetValues<AppModule>().Select(m => (int)m).ToArray();
        var plans = await db.Plans
            .Include(p => p.Modules)
            .ToListAsync(cancellationToken);
        if (plans.Count == 0) return;

        var changed = false;
        foreach (var plan in plans)
        {
            if (plan.Modules.Count == 0) continue; // rétro-compat plans plats

            var presentModules = plan.Modules.Select(m => m.Module).ToHashSet();
            var missing = allModules.Where(m => !presentModules.Contains(m)).ToList();
            if (missing.Count == 0) continue;

            // `ToList()` OBLIGATOIRE : `Plan.Modules` est une vue vivante sur le champ `_modules`
            // (`_modules.AsReadOnly()`) et `ReplaceModules` commence par le vider. Sans
            // matérialisation, la moitié gauche de ce Concat était énumérée APRÈS le Clear() et ne
            // renvoyait donc plus rien : le backfill demandait à EF de supprimer toutes les lignes
            // existantes pour n'en réinsérer que les manquantes. L'opération échouait, le
            // `catch (DbUpdateConcurrencyException)` ci-dessous l'avalait, et aucun module n'était
            // jamais ajouté — d'où des modules absents du plan, donc refusés par
            // `DbPlanResolver` (`entry?.IsIncluded ?? false`) et affichés « Plan supérieur requis »
            // alors qu'ils sont inclus dans l'offre.
            var merged = plan.Modules
                .Select(m => (m.Module, m.IsIncluded))
                .Concat(missing.Select(m => (m, true)))
                .ToList();
            plan.ReplaceModules(merged);
            changed = true;
        }

        if (!changed) return;
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Backfill défensif et best-effort : un conflit de concurrence (ligne touchée en parallèle)
            // ne doit PAS avorter tout le seeding (sinon le backfill des LIMITES ci-dessus serait perdu et
            // le démarrage loggue un FATAL récurrent). On ignore : la prochaine exécution réessaiera.
            db.ChangeTracker.Clear();
        }
    }

    /// <summary>
    /// Tout <see cref="AppModule"/> que l'assistant d'inscription (frontend
    /// <c>registration-catalog.ts</c> — <c>CORE_MODULE_IDS</c> ∪ <c>optionalModulesFor()</c>) peut
    /// proposer/envoyer dans <c>RegisterDto.EnabledModules</c>. <see cref="AppModule.Honoraires"/>
    /// est le seul module jamais offert par le wizard (natif cabinet — facturé côté
    /// <c>HonorairesBillingService</c>, hors périmètre d'un tenant auto-inscrit) ; il est donc
    /// volontairement exclu ici. Les modules premium (<see cref="AppModuleExtensions.PaidPlanModuleIds"/>
    /// = AI/Forecasting/Studio/Payroll) sont également exclus (décision D1) : le wizard ne propose
    /// plus ces modules au plan Free — ils sont exposés comme verrouillés « plan supérieur requis »
    /// via le flag <c>AvailableOnFreePlan</c> du catalogue sectoriel. Résultat = les 13 modules
    /// cœur + standard.
    /// </summary>
    internal static IReadOnlyCollection<int> WizardOfferedModuleIds { get; } = Enum.GetValues<AppModule>()
        .Where(m => m != AppModule.Honoraires && !AppModuleExtensions.PaidPlanModuleIds.Contains(m))
        .Select(m => (int)m)
        .ToArray();

    /// <summary>
    /// Plan §1.1, décision D1 (RÉSOLU — Free = cœur + standard, pas de modules premium) : aligne le
    /// plan Free en base sur les invariants du seed, en deux passes idempotentes :
    ///
    /// 1. <b>Wizard → true</b> : le plan Free ne doit jamais opposer un plafond silencieux à un module
    ///    proposé par le wizard d'inscription. <see cref="BackfillPlanModulesAsync"/> ci-dessus ne fait
    ///    qu'AJOUTER les modules absents (IsIncluded=true) ; il ne retouche jamais une ligne déjà
    ///    présente mais explicitement mise à <c>IsIncluded=false</c> (ex. un opérateur a restreint le
    ///    plan Free via le backoffice après le seed initial). Cette passe corrige spécifiquement ce cas,
    ///    UNIQUEMENT pour le plan Free (Monthly/Annual ne sont pas touchés — une vraie restriction sur
    ///    ces plans reste possible et intentionnelle) et UNIQUEMENT pour les modules du wizard
    ///    (<see cref="WizardOfferedModuleIds"/> = les 13 cœur + standard).
    ///
    /// 2. <b>Premium → false</b> (symétrique) : les modules premium
    ///    (<see cref="AppModuleExtensions.PaidPlanModuleIds"/> = AI/Forecasting/Studio/Payroll) sont
    ///    forcés à <c>IsIncluded=false</c> sur le plan Free. Une base legacy (où le seed précédent
    ///    semait <c>AllModulesIncluded</c>) ou une manipulation opérateur ne peut ainsi jamais laisser
    ///    un module premium « gratuit » sur le plan Free global. Cette passe DOIT s'exécuter APRÈS
    ///    <see cref="BackfillPlanModulesAsync"/> (qui peut ajouter les modules manquants comme inclus) ;
    ///    l'ordre d'appel dans <see cref="SeedAsync"/> le garantit.
    ///
    /// Idempotent : ne fait rien (pas de SaveChanges) si toutes les lignes concernées sont déjà dans
    /// l'état attendu — c'est déjà le cas pour une instance fraîchement seedée puisque
    /// <see cref="BuildFreePlan"/> appelle <see cref="FreePlanModules"/>.
    /// </summary>
    private static async Task AlignFreePlanWizardModulesAsync(MasterDbContext db, CancellationToken cancellationToken)
    {
        var freePlan = await db.Plans
            .Include(p => p.Modules)
            .FirstOrDefaultAsync(p => p.Code == nameof(SubscriptionPlan.Free), cancellationToken);
        if (freePlan is null) return;

        var wizardModules = WizardOfferedModuleIds;
        var premiumModules = AppModuleExtensions.PaidPlanModuleIds.Select(m => (int)m).ToHashSet();
        var changed = false;
        foreach (var planModule in freePlan.Modules)
        {
            // Passe 2 (premium → false) : prioritaire car disjointe du set wizard. Force OFF les
            // modules premium sur le plan Free (décision D1).
            if (premiumModules.Contains(planModule.Module))
            {
                if (planModule.IsIncluded)
                {
                    db.Entry(planModule).Property(nameof(PlanModule.IsIncluded)).CurrentValue = false;
                    changed = true;
                }
                continue;
            }

            // Passe 1 (wizard false → true) : ne retouche que les modules offerts par le wizard.
            if (!planModule.IsIncluded && wizardModules.Contains(planModule.Module))
            {
                // Mise à jour EN PLACE (comme BackfillPlanLimitsAsync) — surtout PAS ReplaceModules,
                // qui ferait clear+re-add et risquerait un DbUpdateConcurrencyException inutile ici.
                db.Entry(planModule).Property(nameof(PlanModule.IsIncluded)).CurrentValue = true;
                changed = true;
            }
        }

        if (changed)
            await db.SaveChangesAsync(cancellationToken);
    }
}
