using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Domain.Entities.Studio;
using FactuTrust.Domain.Enums;
using FactuTrust.Infrastructure.Services.Studio;
using Microsoft.Extensions.Caching.Memory;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

/// <summary>
/// PR 1.2 — <see cref="StudioContextDigestService"/> : une ligne par table ACTIVE avec ses vraies clés,
/// champs inactifs exclus, cache 30 s par tenant, budget de caractères respecté avec « … (+N tables) »,
/// dernier plan = plus récent en attente + dernier terminé de moins de 24 h, isolation tenant.
/// Métadonnées uniquement : aucune valeur d'enregistrement n'est lue.
/// </summary>
public sealed class StudioContextDigestServiceTests
{
    private static readonly Guid TenantId = Guid.NewGuid();
    private static readonly Guid OtherTenantId = Guid.NewGuid();
    private static readonly Guid UserId = Guid.NewGuid();

    private sealed class Harness
    {
        public Mock<ICustomEntityRepository> Entities { get; } = new(MockBehavior.Strict);
        public Mock<ICustomFieldRepository> Fields { get; } = new(MockBehavior.Strict);
        public Mock<ICustomSystemRepository> Systems { get; } = new(MockBehavior.Strict);
        public Mock<IStudioAiBuildPlanRepository> Plans { get; } = new(MockBehavior.Strict);
        public MemoryCache Cache { get; } = new(new MemoryCacheOptions());
        public FixedTimeProvider Clock { get; } = new(new DateTimeOffset(2026, 9, 11, 10, 0, 0, TimeSpan.Zero));
        public List<CustomEntityDefinition> EntityList { get; } = new();
        public Dictionary<Guid, List<CustomFieldDefinition>> FieldsByEntity { get; } = new();
        public List<CustomSystemDefinition> SystemList { get; } = new();
        public int EntityListCalls;

        public Harness()
        {
            Entities.Setup(r => r.ListAsync(TenantId, false, It.IsAny<CancellationToken>()))
                .ReturnsAsync(() =>
                {
                    EntityListCalls++;
                    return EntityList.Where(e => e.IsActive && !e.IsDeleted).ToList();
                });
            Fields.Setup(r => r.ListByEntityAsync(TenantId, It.IsAny<Guid>(), false, It.IsAny<CancellationToken>()))
                .ReturnsAsync((Guid _, Guid entityId, bool _, CancellationToken _) =>
                    FieldsByEntity.TryGetValue(entityId, out var list) ? list.Where(f => f.IsActive).ToList() : new List<CustomFieldDefinition>());
            Systems.Setup(r => r.ListAsync(TenantId, true, It.IsAny<CancellationToken>()))
                .ReturnsAsync(() => SystemList.ToList());
        }

        public CustomEntityDefinition AddEntity(string key, string displayName, Guid? systemId = null, params (string Key, CustomFieldType Type)[] fields)
        {
            var entity = CustomEntityDefinition.Create(TenantId, key, displayName, displayName, null, null, UserId, systemId);
            EntityList.Add(entity);
            FieldsByEntity[entity.Id] = fields.Select((f, i) =>
                CustomFieldDefinition.Create(TenantId, entity.Id, f.Key, f.Key, f.Type, false, false, i, null, null, null, UserId)).ToList();
            return entity;
        }

        public StudioContextDigestService Build() =>
            new(Entities.Object, Fields.Object, Systems.Object, Plans.Object, Cache, Clock);
    }

    // ───────────────────────────── schéma ─────────────────────────────

    [Fact]
    public async Task One_line_per_active_table_with_real_keys_and_field_types()
    {
        var h = new Harness();
        var system = CustomSystemDefinition.Create(TenantId, "gestion_conges", "Gestion des congés", null, null, null, UserId);
        h.SystemList.Add(system);
        h.AddEntity("employes", "Employés", null, ("nom", CustomFieldType.Text), ("poste", CustomFieldType.Select), ("salaire", CustomFieldType.Money));
        h.AddEntity("conges", "Congés", system.Id, ("employe", CustomFieldType.RelationCustom), ("debut", CustomFieldType.Date), ("statut", CustomFieldType.Select));
        var inactive = h.AddEntity("archives", "Archives", null, ("titre", CustomFieldType.Text));
        inactive.Update("Archives", "Archives", null, null, isActive: false, UserId);

        var digest = await h.Build().BuildSchemaDigestAsync(TenantId, 4000, CancellationToken.None);

        var lines = digest.Split('\n');
        Assert.Equal(2, lines.Length);
        Assert.Equal("- conges « Congés » (systeme:gestion_conges) : employe:relation, debut:date, statut:select", lines[0]);
        Assert.Equal("- employes « Employés » : nom:text, poste:select, salaire:money", lines[1]);
        Assert.DoesNotContain("archives", digest);
    }

    [Fact]
    public async Task Inactive_fields_are_excluded_and_field_order_follows_sort_order()
    {
        var h = new Harness();
        var entity = h.AddEntity("projets", "Projets", null, ("nom", CustomFieldType.Text), ("budget", CustomFieldType.Money), ("ancien", CustomFieldType.Text));
        var old = h.FieldsByEntity[entity.Id][2];
        old.Update(old.Label, false, false, null, null, null, isActive: false, UserId);
        h.FieldsByEntity[entity.Id][0].SetSortOrder(5, UserId); // « nom » passe après « budget »

        var digest = await h.Build().BuildSchemaDigestAsync(TenantId, 4000, CancellationToken.None);

        Assert.Equal("- projets « Projets » : budget:money, nom:text", digest);
    }

    [Fact]
    public async Task No_table_gives_an_empty_digest_and_never_reads_systems_or_fields()
    {
        var h = new Harness();

        var digest = await h.Build().BuildSchemaDigestAsync(TenantId, 1200, CancellationToken.None);

        Assert.Equal(string.Empty, digest);
        h.Systems.Verify(r => r.ListAsync(It.IsAny<Guid>(), It.IsAny<bool>(), It.IsAny<CancellationToken>()), Times.Never);
        h.Fields.Verify(r => r.ListByEntityAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<bool>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Budget_is_respected_and_omitted_tables_are_counted()
    {
        var h = new Harness();
        for (var i = 0; i < 12; i++)
            h.AddEntity($"table_{i:00}", $"Table {i:00}", null, ("champ_un", CustomFieldType.Text), ("champ_deux", CustomFieldType.Number));

        var full = await h.Build().BuildSchemaDigestAsync(TenantId, 4000, CancellationToken.None);
        var tight = await h.Build().BuildSchemaDigestAsync(TenantId, 200, CancellationToken.None);

        Assert.Equal(12, full.Split('\n').Length);
        Assert.True(tight.Length <= 200, $"{tight.Length} > 200");
        var tightLines = tight.Split('\n');
        var shown = tightLines.Length - 1;
        Assert.True(shown is >= 1 and < 12, tight);
        Assert.Equal($"… (+{12 - shown} tables)", tightLines[^1]);
        // Les lignes conservées sont des lignes ENTIÈRES (jamais une clé coupée en deux).
        Assert.All(tightLines[..^1], l => Assert.EndsWith("champ_un:text, champ_deux:number", l));
    }

    [Fact]
    public async Task A_very_wide_table_is_cut_per_line_so_other_tables_keep_their_keys()
    {
        // 60 champs ⇒ la ligne brute dépasserait 1000 caractères et mangerait tout le budget CPU (1200).
        // Coupée à MaxLineChars avec « , … (+N champs) », elle laisse la place aux autres tables.
        var h = new Harness();
        var wide = Enumerable.Range(1, 60).Select(i => ($"colonne_numero_{i:00}", CustomFieldType.Text)).ToArray();
        h.AddEntity("grande_table", "Grande table", null, wide);
        h.AddEntity("petite", "Petite", null, ("nom", CustomFieldType.Text));

        var digest = await h.Build().BuildSchemaDigestAsync(TenantId, 1200, CancellationToken.None);
        var lines = digest.Split('\n');

        Assert.Equal(2, lines.Length);
        Assert.StartsWith("- grande_table « Grande table » : colonne_numero_01:text, colonne_numero_02:text, ", lines[0]);
        Assert.Matches(@", … \(\+\d+ champs\)$", lines[0]);
        Assert.True(lines[0].Length <= StudioContextDigestService.MaxLineChars, $"ligne de {lines[0].Length} caractères");
        var shown = lines[0].Split(", ").Count(t => t.Contains(":text"));
        var omitted = int.Parse(System.Text.RegularExpressions.Regex.Match(lines[0], @"\+(\d+) champs").Groups[1].Value);
        Assert.Equal(60, shown + omitted);
        Assert.Equal("- petite « Petite » : nom:text", lines[1]);
    }

    [Fact]
    public async Task A_table_that_fits_in_a_line_is_never_cut()
    {
        var h = new Harness();
        var fields = Enumerable.Range(1, 12).Select(i => ($"champ_{i:00}", CustomFieldType.Number)).ToArray();
        h.AddEntity("moyenne", "Moyenne", null, fields);

        var digest = await h.Build().BuildSchemaDigestAsync(TenantId, 4000, CancellationToken.None);

        Assert.DoesNotContain("champs)", digest);
        Assert.EndsWith("champ_12:number", digest);
        Assert.Equal(12, digest.Split(", ").Length);
    }

    [Fact]
    public async Task Budget_too_small_for_a_single_line_still_announces_the_table_count()
    {
        var h = new Harness();
        h.AddEntity("une_table_avec_une_cle_longue", "Table", null, ("champ", CustomFieldType.Text));

        var digest = await h.Build().BuildSchemaDigestAsync(TenantId, 15, CancellationToken.None);

        Assert.Equal("… (+1 table)", digest);
        Assert.Equal(string.Empty, await h.Build().BuildSchemaDigestAsync(TenantId, 0, CancellationToken.None));
    }

    [Fact]
    public async Task More_than_fifty_tables_are_capped_and_the_rest_counted()
    {
        var h = new Harness();
        for (var i = 0; i < 53; i++)
            h.AddEntity($"t{i:00}", $"T{i:00}", null, ("a", CustomFieldType.Text));

        var digest = await h.Build().BuildSchemaDigestAsync(TenantId, 100_000, CancellationToken.None);

        var lines = digest.Split('\n');
        Assert.Equal(StudioContextDigestService.MaxEntities + 1, lines.Length);
        Assert.Equal("… (+3 tables)", lines[^1]);
        h.Fields.Verify(r => r.ListByEntityAsync(TenantId, It.IsAny<Guid>(), false, It.IsAny<CancellationToken>()),
            Times.Exactly(StudioContextDigestService.MaxEntities));
    }

    [Fact]
    public async Task Schema_is_cached_thirty_seconds_per_tenant_regardless_of_budget()
    {
        var h = new Harness();
        h.AddEntity("clients_vip", "Clients VIP", null, ("nom", CustomFieldType.Text));
        var service = h.Build();

        var first = await service.BuildSchemaDigestAsync(TenantId, 1200, CancellationToken.None);
        var second = await service.BuildSchemaDigestAsync(TenantId, 4000, CancellationToken.None);

        Assert.Equal(first, second);
        Assert.Equal(1, h.EntityListCalls);
        Assert.True(h.Cache.TryGetValue(StudioContextDigestService.SchemaCacheKey(TenantId), out _));
        Assert.Equal(TimeSpan.FromSeconds(30), StudioContextDigestService.CacheTtl);

        // Une fois l'entrée invalidée (expiration), la table créée entre-temps apparaît.
        h.Cache.Remove(StudioContextDigestService.SchemaCacheKey(TenantId));
        h.AddEntity("fournisseurs", "Fournisseurs", null, ("raison_sociale", CustomFieldType.Text));
        var third = await service.BuildSchemaDigestAsync(TenantId, 4000, CancellationToken.None);
        Assert.Contains("fournisseurs", third);
        Assert.Equal(2, h.EntityListCalls);
    }

    [Fact]
    public async Task Schema_reads_are_sequential_entities_then_systems_then_fields()
    {
        var h = new Harness();
        var order = new List<string>();
        var system = CustomSystemDefinition.Create(TenantId, "sys", "Sys", null, null, null, UserId);
        h.SystemList.Add(system);
        h.AddEntity("a", "A", system.Id, ("x", CustomFieldType.Text));
        h.AddEntity("b", "B", null, ("y", CustomFieldType.Text));
        var inFlight = 0;
        var overlap = false;

        async Task<T> Guarded<T>(string name, Func<T> value)
        {
            if (Interlocked.Increment(ref inFlight) > 1) overlap = true;
            order.Add(name);
            await Task.Delay(5);
            Interlocked.Decrement(ref inFlight);
            return value();
        }

        h.Entities.Setup(r => r.ListAsync(TenantId, false, It.IsAny<CancellationToken>()))
            .Returns(() => Guarded("entities", () => (IReadOnlyList<CustomEntityDefinition>)h.EntityList.ToList()));
        h.Systems.Setup(r => r.ListAsync(TenantId, true, It.IsAny<CancellationToken>()))
            .Returns(() => Guarded("systems", () => (IReadOnlyList<CustomSystemDefinition>)h.SystemList.ToList()));
        h.Fields.Setup(r => r.ListByEntityAsync(TenantId, It.IsAny<Guid>(), false, It.IsAny<CancellationToken>()))
            .Returns((Guid _, Guid id, bool _, CancellationToken _) => Guarded("fields", () => (IReadOnlyList<CustomFieldDefinition>)h.FieldsByEntity[id]));

        await h.Build().BuildSchemaDigestAsync(TenantId, 4000, CancellationToken.None);

        Assert.False(overlap, "Deux lectures du DbContext tenant se sont chevauchées.");
        Assert.Equal(["entities", "systems", "fields", "fields"], order);
    }

    [Fact]
    public async Task Tenant_isolation_a_tenant_never_sees_another_tenants_tables()
    {
        var h = new Harness();
        h.AddEntity("employes", "Employés", null, ("nom", CustomFieldType.Text));
        h.Entities.Setup(r => r.ListAsync(OtherTenantId, false, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<CustomEntityDefinition>());
        var service = h.Build();

        var mine = await service.BuildSchemaDigestAsync(TenantId, 4000, CancellationToken.None);
        var theirs = await service.BuildSchemaDigestAsync(OtherTenantId, 4000, CancellationToken.None);

        Assert.Contains("employes", mine);
        Assert.Equal(string.Empty, theirs);
        // Deux entrées de cache distinctes : la clé porte le tenant.
        Assert.NotEqual(StudioContextDigestService.SchemaCacheKey(TenantId), StudioContextDigestService.SchemaCacheKey(OtherTenantId));
        h.Entities.Verify(r => r.ListAsync(TenantId, false, It.IsAny<CancellationToken>()), Times.Once);
        h.Entities.Verify(r => r.ListAsync(OtherTenantId, false, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Digest_never_contains_record_values_only_schema_metadata()
    {
        // Le service ne dépend d'aucun dépôt d'enregistrements : seuls entités, champs, systèmes et plans
        // sont lus. On vérifie qu'aucune autre méthode des dépôts de définitions n'est appelée.
        var h = new Harness();
        h.AddEntity("factures_internes", "Factures internes", null, ("montant", CustomFieldType.Money));

        var digest = await h.Build().BuildSchemaDigestAsync(TenantId, 4000, CancellationToken.None);

        Assert.Equal("- factures_internes « Factures internes » : montant:money", digest);
        h.Entities.VerifyAll();
        h.Fields.VerifyAll();
        h.Entities.VerifyNoOtherCalls();
        h.Fields.VerifyNoOtherCalls();
        h.Plans.VerifyNoOtherCalls();
    }

    // ───────────────────────────── dernier plan ─────────────────────────────

    private static StudioAiBuildPlan PendingPlan(string title, params string[] displayNames) =>
        StudioAiBuildPlan.Create(
            TenantId,
            StudioAiPlanKind.CreateSystem,
            "{}",
            System.Text.Json.JsonSerializer.Serialize(new
            {
                kind = "system",
                title,
                entities = displayNames.Select(n => new { displayName = n, fieldCount = 3, relationCount = 0 }).ToArray()
            }),
            UserId,
            TimeSpan.FromMinutes(30));

    private static StudioAiBuildPlan CompletedPlan(string title, string resultJson)
    {
        var plan = PendingPlan(title, "Aperçu");
        plan.MarkExecuting();
        plan.MarkCompleted(resultJson);
        return plan;
    }

    private static void SetupPlans(Harness h, IReadOnlyList<StudioAiBuildPlan> pending, IReadOnlyList<StudioAiBuildPlan> completed)
    {
        var userId = UserId.ToString();
        h.Plans.Setup(p => p.ListPendingByOwnerAsync(TenantId, userId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(pending);
        h.Plans.Setup(p => p.ListByOwnerAsync(TenantId, userId, StudioAiPlanStatus.Completed, null, 1, 1, It.IsAny<CancellationToken>()))
            .ReturnsAsync((completed, completed.Count));
    }

    [Fact]
    public async Task Last_plan_lists_the_newest_pending_plan_with_its_preview_names()
    {
        var h = new Harness();
        SetupPlans(h, [PendingPlan("Gestion des congés", "Employés", "Congés")], []);

        var digest = await h.Build().BuildLastPlanDigestAsync(TenantId, UserId.ToString(), 600, CancellationToken.None);

        Assert.NotNull(digest);
        Assert.StartsWith("- [En attente ", digest);
        Assert.Contains("Système « Gestion des congés » : 2 tables (Employés, Congés)", digest);
    }

    [Fact]
    public async Task Last_plan_uses_real_keys_from_the_result_of_a_completed_plan()
    {
        var h = new Harness();
        var completed = CompletedPlan("Suivi des projets", """
            {"success":true,"systemKey":"suivi_projets","displayName":"Suivi des projets","entityCount":2,
             "entities":[{"refKey":"projets","entityKey":"projets","displayName":"Projets","openUrl":"/studio/d/projets"},
                         {"refKey":"taches","entityKey":"taches_projet","displayName":"Tâches","openUrl":"/studio/d/taches_projet"}]}
            """);
        SetupPlans(h, [], [completed]);

        var digest = await h.Build().BuildLastPlanDigestAsync(TenantId, UserId.ToString(), 600, CancellationToken.None);

        Assert.NotNull(digest);
        Assert.StartsWith("- [Terminé ", digest);
        Assert.Contains("Système « Suivi des projets » : 2 tables (projets, taches_projet)", digest);
        Assert.DoesNotContain("Aperçu", digest);
    }

    [Fact]
    public async Task Completed_plan_older_than_24_hours_is_ignored_and_null_when_nothing_remains()
    {
        var h = new Harness();
        var completed = CompletedPlan("Vieux plan", """{"success":true,"entityKey":"vieux"}""");
        SetupPlans(h, [], [completed]);
        // ExecutedAt = maintenant réel ; l'horloge du service est déplacée 25 h plus tard.
        h.Clock.Advance(TimeSpan.FromHours(25) + (DateTimeOffset.UtcNow - h.Clock.GetUtcNow()));

        var digest = await h.Build().BuildLastPlanDigestAsync(TenantId, UserId.ToString(), 600, CancellationToken.None);

        Assert.Null(digest);
    }

    [Fact]
    public async Task Completed_plan_within_24_hours_is_listed_after_the_pending_one()
    {
        var h = new Harness();
        h.Clock.Advance(DateTimeOffset.UtcNow - h.Clock.GetUtcNow()); // horloge ≈ maintenant réel
        SetupPlans(h,
            [PendingPlan("Nouveau plan", "Fournisseurs")],
            [CompletedPlan("Plan terminé", """{"success":true,"entityKey":"clients_vip","displayName":"Clients VIP"}""")]);

        var digest = await h.Build().BuildLastPlanDigestAsync(TenantId, UserId.ToString(), 600, CancellationToken.None);

        Assert.NotNull(digest);
        var lines = digest!.Split('\n');
        Assert.Equal(2, lines.Length);
        Assert.Contains("[En attente", lines[0]);
        Assert.Contains("« Nouveau plan » : 1 table (Fournisseurs)", lines[0]);
        Assert.Contains("[Terminé", lines[1]);
        Assert.Contains("« Plan terminé » : 1 table (clients_vip)", lines[1]);
    }

    [Fact]
    public async Task Last_plan_is_truncated_to_the_budget()
    {
        var h = new Harness();
        SetupPlans(h, [PendingPlan("Un plan au titre particulièrement bavard", "Alpha", "Bêta", "Gamma", "Delta")], []);

        var digest = await h.Build().BuildLastPlanDigestAsync(TenantId, UserId.ToString(), 40, CancellationToken.None);

        Assert.NotNull(digest);
        Assert.True(digest!.Length <= 40, digest);
        Assert.EndsWith("…", digest);
    }

    [Fact]
    public async Task Unreadable_plan_json_degrades_gracefully()
    {
        var h = new Harness();
        var broken = StudioAiBuildPlan.Create(TenantId, StudioAiPlanKind.CreateApp, "{}", "pas du json", UserId, TimeSpan.FromMinutes(30));
        SetupPlans(h, [broken], []);

        var digest = await h.Build().BuildLastPlanDigestAsync(TenantId, UserId.ToString(), 600, CancellationToken.None);

        Assert.NotNull(digest);
        Assert.Contains("Table « (sans titre) »", digest);
    }

    [Fact]
    public async Task Last_plan_ignores_other_tenants_plans_and_empty_user()
    {
        var h = new Harness();
        var foreign = StudioAiBuildPlan.Create(OtherTenantId, StudioAiPlanKind.CreateSystem, "{}", """{"title":"Ailleurs"}""", UserId, TimeSpan.FromMinutes(30));
        SetupPlans(h, [foreign], []);

        var digest = await h.Build().BuildLastPlanDigestAsync(TenantId, UserId.ToString(), 600, CancellationToken.None);
        var noUser = await h.Build().BuildLastPlanDigestAsync(TenantId, "", 600, CancellationToken.None);

        Assert.Null(digest);
        Assert.Null(noUser);
        h.Plans.Verify(p => p.ListPendingByOwnerAsync(TenantId, UserId.ToString(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Theory]
    [InlineData(CustomFieldType.Text, "text")]
    [InlineData(CustomFieldType.Money, "money")]
    [InlineData(CustomFieldType.RelationCustom, "relation")]
    [InlineData(CustomFieldType.RelationExisting, "relation_erp")]
    [InlineData(CustomFieldType.MultiSelect, "multiselect")]
    [InlineData(CustomFieldType.AutoNumber, "autonumber")]
    public void Field_type_tokens_match_spec_vocabulary(CustomFieldType type, string expected) =>
        Assert.Equal(expected, StudioContextDigestService.FieldTypeToken(type));

    /// <summary>PR 4.3 : un plan de workflows est libellé « Workflow » dans la ligne « dernier plan » du digest.</summary>
    [Fact]
    public void Workflow_plan_kind_is_labelled_Workflow() =>
        Assert.Equal("Workflow", StudioContextDigestService.KindLabel(StudioAiPlanKind.Workflow));

    public sealed class FixedTimeProvider : TimeProvider
    {
        private DateTimeOffset _utcNow;
        public FixedTimeProvider(DateTimeOffset utcNow) => _utcNow = utcNow;
        public override DateTimeOffset GetUtcNow() => _utcNow;
        public void Advance(TimeSpan by) => _utcNow += by;
    }
}
