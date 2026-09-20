using System.Text.Json.Nodes;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.Records;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities.Studio;
using FactuTrust.Domain.Enums;
using MediatR;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

/// <summary>
/// 4.7 « v1.1 » hi-b1 (D-47-62/63) : audit des mutations d'enregistrements. Diff pur
/// (ajout/retrait/modification/identique), une ligne <c>Studio.Record.*</c> par handler avec
/// contenu borné aux clés modifiées, absence de ligne quand PUT/PATCH ne change rien, échec
/// d'audit avalé (la mutation réussit). Fixture construite sur le motif de
/// <c>PatchCustomRecordCommandTests</c>.
/// </summary>
public sealed class CustomRecordAuditTests
{
    private static readonly Guid Tid = Guid.NewGuid();
    private static readonly Guid EntityId = Guid.NewGuid();
    private static readonly Guid UserId = Guid.NewGuid();

    private readonly Mock<ICustomEntityRepository> _entities = new();
    private readonly Mock<ICustomFieldRepository> _fields = new();
    private readonly Mock<ICustomRecordRepository> _records = new();
    private readonly Mock<IStudioQuotaService> _quota = new();
    private readonly Mock<IStudioComputedFieldWriter> _computedWriter = new();
    private readonly Mock<IPublisher> _publisher = new();
    private readonly Mock<ICurrentUser> _currentUser = new();
    private readonly Mock<IAuditService> _audit = new();

    private readonly byte[] _rowVersion = { 0, 0, 0, 0, 0, 0, 0, 9 };
    private readonly CustomRecord _record;

    public CustomRecordAuditTests()
    {
        _currentUser.Setup(u => u.TenantId).Returns(Tid);
        _currentUser.Setup(u => u.UserId).Returns(UserId);

        var entity = CustomEntityDefinition.Create(Tid, "chantiers", "Chantier", "Chantiers", null, null, UserId);
        typeof(CustomEntityDefinition).GetProperty(nameof(CustomEntityDefinition.Id))!.SetValue(entity, EntityId);
        _entities.Setup(e => e.GetByKeyAsync(Tid, "chantiers", It.IsAny<CancellationToken>())).ReturnsAsync(entity);

        _fields.Setup(f => f.ListByEntityAsync(Tid, EntityId, false, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Fields());

        _record = CustomRecord.Create(Tid, EntityId, """{"nom":"Alpha","statut":"encours","reference":"CH-0001"}""", UserId);
        typeof(CustomRecord).GetProperty(nameof(CustomRecord.RowVersion))!.SetValue(_record, _rowVersion);
        _records.Setup(r => r.GetAsync(Tid, EntityId, _record.Id, It.IsAny<CancellationToken>())).ReturnsAsync(_record);
        _records.Setup(r => r.AddAsync(It.IsAny<CustomRecord>(), It.IsAny<CancellationToken>())).Returns(Task.CompletedTask);
        _records.Setup(r => r.UpdateAsync(It.IsAny<CustomRecord>(), It.IsAny<CancellationToken>())).Returns(Task.CompletedTask);
        _records.Setup(r => r.UpdateWithConcurrencyAsync(It.IsAny<CustomRecord>(), It.IsAny<byte[]?>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);
        _records.Setup(r => r.CountAsync(Tid, EntityId, It.IsAny<CancellationToken>())).ReturnsAsync(0);
        _quota.Setup(q => q.EnsureUnderLimitAsync(It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<int>(), It.IsAny<int>(),
                It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success());

        // Le writer réel préserve l'AutoNumber existant : le mock réinjecte la « reference » du JSON existant.
        _computedWriter.Setup(w => w.ApplyOnUpdateAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<IReadOnlyList<CustomFieldDefinition>>(),
                It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Returns<Guid, Guid, IReadOnlyList<CustomFieldDefinition>, string, string, CancellationToken>(
                (_, _, _, canonical, existing, _) =>
                {
                    var doc = (JsonObject)JsonNode.Parse(canonical)!;
                    var existingRef = (JsonNode.Parse(existing) as JsonObject)?["reference"];
                    if (existingRef is not null) doc["reference"] = existingRef.DeepClone();
                    return Task.FromResult(doc.ToJsonString());
                });
        _computedWriter.Setup(w => w.ApplyOnCreateAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<IReadOnlyList<CustomFieldDefinition>>(),
                It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Returns<Guid, Guid, IReadOnlyList<CustomFieldDefinition>, string, CancellationToken>(
                (_, _, _, canonical, _) => Task.FromResult(canonical));

        _audit.Setup(a => a.LogAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<Guid?>(),
                It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);
    }

    private CreateCustomRecordCommandHandler CreateHandler() =>
        new(_entities.Object, _fields.Object, _records.Object, _quota.Object, _computedWriter.Object,
            _publisher.Object, _currentUser.Object, _audit.Object);

    private UpdateCustomRecordCommandHandler UpdateHandler() =>
        new(_entities.Object, _fields.Object, _records.Object, _computedWriter.Object,
            _publisher.Object, _currentUser.Object, _audit.Object);

    private DeleteCustomRecordCommandHandler DeleteHandler() =>
        new(_entities.Object, _records.Object, _currentUser.Object, _audit.Object);

    private PatchCustomRecordCommandHandler PatchHandler() =>
        new(_entities.Object, _fields.Object, _records.Object, _computedWriter.Object,
            _publisher.Object, _currentUser.Object, _audit.Object);

    private string Rv() => Convert.ToBase64String(_rowVersion);

    private static CustomFieldDefinition[] Fields() => new[]
    {
        CustomFieldDefinition.Create(Tid, EntityId, "nom", "Nom", CustomFieldType.Text, true, false, 0, null, null, null, null),
        CustomFieldDefinition.Create(Tid, EntityId, "statut", "Statut", CustomFieldType.Select, false, false, 1, null,
            """{"options":[{"value":"encours","label":"En cours"},{"value":"termine","label":"Terminé"}]}""", null, null),
        CustomFieldDefinition.Create(Tid, EntityId, "reference", "Réf", CustomFieldType.AutoNumber, false, false, 2, null, null, null, null)
    };

    private static SaveCustomRecordRequest SaveRequest(string nom, string statut) =>
        new(new Dictionary<string, JsonNode?>
        {
            ["nom"] = JsonValue.Create(nom), ["statut"] = JsonValue.Create(statut), ["reference"] = null
        }, null);

    /// <summary>Prédicat hors arbre d'expression (CS8122) : dictionnaire exact aux paires attendues.</summary>
    private static bool HasValues(object? values, params string?[] keyValuePairs)
    {
        if (values is not Dictionary<string, object?> map || map.Count != keyValuePairs.Length / 2)
            return false;
        for (var i = 0; i + 1 < keyValuePairs.Length; i += 2)
        {
            if (!map.TryGetValue(keyValuePairs[i]!, out var v) || (string?)v != keyValuePairs[i + 1])
                return false;
        }
        return true;
    }

    // ---- Diff pur ----

    [Fact]
    public void Diff_reports_added_removed_and_changed_top_level_keys_only()
    {
        var diff = StudioRecordAudit.Diff(
            """{"a":1,"b":"x","c":true,"gone":"old"}""",
            """{"a":1,"b":"y","c":true,"new":42}""");

        Assert.NotNull(diff);
        Assert.Equal(new[] { "b", "gone", "new" }, diff!.Value.OldValues.Keys.OrderBy(k => k).ToArray());
        Assert.Equal("x", diff.Value.OldValues["b"]);
        Assert.Equal("y", diff.Value.NewValues["b"]);
        Assert.Equal("old", diff.Value.OldValues["gone"]);
        Assert.Null(diff.Value.NewValues["gone"]);
        Assert.Null(diff.Value.OldValues["new"]);
        Assert.Equal(42L, Assert.IsType<long>(diff.Value.NewValues["new"]));
    }

    [Fact]
    public void Diff_returns_null_when_documents_are_identical()
        => Assert.Null(StudioRecordAudit.Diff("""{"a":1,"b":"x"}""", """{"b":"x","a":1}"""));

    [Fact]
    public void Diff_falls_back_to_raw_documents_when_json_is_unreadable()
    {
        var diff = StudioRecordAudit.Diff("{casse", """{"a":1}""");
        Assert.NotNull(diff);
        Assert.Equal("{casse", diff!.Value.OldValues["_raw"]);
        Assert.Equal("""{"a":1}""", diff.Value.NewValues["_raw"]);
    }

    // ---- Handlers ----

    [Fact]
    public async Task Create_logs_Created_with_the_full_canonical_document()
    {
        var result = await CreateHandler().Handle(
            new CreateCustomRecordCommand("chantiers", SaveRequest("Alpha", "encours")), CancellationToken.None);

        Assert.True(result.IsSuccess);
        _audit.Verify(a => a.LogAsync(StudioRecordAudit.ActionCreated, StudioRecordAudit.EntityType, It.IsAny<Guid>(),
            null,
            It.Is<object?>(v => HasValues(v, "nom", "Alpha", "statut", "encours")),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Update_logs_Updated_with_only_the_changed_keys()
    {
        object? oldValues = null, newValues = null;
        _audit.Setup(a => a.LogAsync(StudioRecordAudit.ActionUpdated, StudioRecordAudit.EntityType, _record.Id,
                It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()))
            .Callback<string, string, Guid?, object?, object?, CancellationToken>(
                (_, _, _, o, n, _) => { oldValues = o; newValues = n; })
            .Returns(Task.CompletedTask);

        var result = await UpdateHandler().Handle(
            new UpdateCustomRecordCommand("chantiers", _record.Id, SaveRequest("Beta", "encours")), CancellationToken.None);

        Assert.True(result.IsSuccess);
        var oldMap = Assert.IsType<Dictionary<string, object?>>(oldValues);
        var newMap = Assert.IsType<Dictionary<string, object?>>(newValues);
        Assert.Equal(new[] { "nom" }, oldMap.Keys.ToArray());           // « statut » inchangé, « reference » réinjectée
        Assert.Equal("Alpha", oldMap["nom"]);
        Assert.Equal("Beta", newMap["nom"]);
    }

    [Fact]
    public async Task Update_without_effective_change_writes_no_audit_line()
    {
        var result = await UpdateHandler().Handle(
            new UpdateCustomRecordCommand("chantiers", _record.Id, SaveRequest("Alpha", "encours")), CancellationToken.None);

        Assert.True(result.IsSuccess);
        _audit.Verify(a => a.LogAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<Guid?>(),
            It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Patch_logs_Updated_with_only_the_patched_key()
    {
        var result = await PatchHandler().Handle(
            new PatchCustomRecordCommand("chantiers", _record.Id,
                new PatchCustomRecordRequest(new Dictionary<string, JsonNode?> { ["statut"] = JsonValue.Create("termine") }, Rv())),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        _audit.Verify(a => a.LogAsync(StudioRecordAudit.ActionUpdated, StudioRecordAudit.EntityType, _record.Id,
            It.Is<object?>(v => HasValues(v, "statut", "encours")),
            It.Is<object?>(v => HasValues(v, "statut", "termine")),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Delete_logs_Deleted_without_values()
    {
        var result = await DeleteHandler().Handle(new DeleteCustomRecordCommand("chantiers", _record.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        _audit.Verify(a => a.LogAsync(StudioRecordAudit.ActionDeleted, StudioRecordAudit.EntityType, _record.Id,
            null, null, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Audit_failure_is_swallowed_and_the_mutation_succeeds()
    {
        _audit.Setup(a => a.LogAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<Guid?>(),
                It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("chaîne d'audit en panne"));

        var result = await DeleteHandler().Handle(new DeleteCustomRecordCommand("chantiers", _record.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        _records.Verify(r => r.UpdateAsync(_record, It.IsAny<CancellationToken>()), Times.Once);
    }
}
