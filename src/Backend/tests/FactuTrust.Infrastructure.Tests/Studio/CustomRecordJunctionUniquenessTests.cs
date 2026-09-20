using System.Text.Json.Nodes;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Features.Studio.Automations;
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
/// Studio IA — PR 2.1 : sur une table de jonction, la paire (source, cible) est unique à l'écriture —
/// Create et Update renvoient <c>record.duplicate_link</c> (mappé 409 par l'API) quand un autre
/// enregistrement actif porte déjà le couple ; Update exclut l'enregistrement modifié ; une table
/// Standard ne déclenche jamais le contrôle de paire (aucun appel <c>ExistsWithFieldPairAsync</c>).
/// </summary>
public sealed class CustomRecordJunctionUniquenessTests
{
    private static readonly Guid Tid = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid Uid = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly string EmployeId = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000001").ToString();
    private static readonly string ProjetId = Guid.Parse("bbbbbbbb-0000-0000-0000-000000000002").ToString();

    private readonly Mock<ICustomEntityRepository> _entities = new();
    private readonly Mock<ICustomFieldRepository> _fields = new();
    private readonly Mock<ICustomRecordRepository> _records = new();
    private readonly Mock<IStudioQuotaService> _quota = new();
    private readonly Mock<IStudioComputedFieldWriter> _computed = new();
    private readonly Mock<IPublisher> _publisher = new();
    private readonly Mock<ICurrentUser> _currentUser = new();

    private readonly CustomEntityDefinition _junction;
    private readonly CustomEntityDefinition _standard;

    public CustomRecordJunctionUniquenessTests()
    {
        _currentUser.SetupGet(u => u.TenantId).Returns(Tid);
        _currentUser.SetupGet(u => u.UserId).Returns(Uid);

        _junction = CustomEntityDefinition.Create(Tid, "employes_projets", "Employé – Projet", "Employé – Projet", "link", null, Uid, null, CustomEntityKind.Junction);
        _standard = CustomEntityDefinition.Create(Tid, "affectations", "Affectation", "Affectations", null, null, Uid);

        foreach (var e in new[] { _junction, _standard })
        {
            _entities.Setup(r => r.GetByKeyAsync(Tid, e.Key, It.IsAny<CancellationToken>())).ReturnsAsync(e);
            _fields.Setup(r => r.ListByEntityAsync(Tid, e.Id, false, It.IsAny<CancellationToken>()))
                .ReturnsAsync(new List<CustomFieldDefinition>
                {
                    Relation(e.Id, "employes", "employes", 0),
                    Relation(e.Id, "projets", "projets", 1),
                    CustomFieldDefinition.Create(Tid, e.Id, "role", "Rôle", CustomFieldType.Text, false, false, 2, null, null, null, Uid)
                });
        }

        _records.Setup(r => r.CountAsync(Tid, It.IsAny<Guid>(), It.IsAny<CancellationToken>())).ReturnsAsync(0);
        _records.Setup(r => r.AddAsync(It.IsAny<CustomRecord>(), It.IsAny<CancellationToken>())).Returns(Task.CompletedTask);
        _records.Setup(r => r.UpdateWithConcurrencyAsync(It.IsAny<CustomRecord>(), It.IsAny<byte[]?>(), It.IsAny<CancellationToken>())).Returns(Task.CompletedTask);
        _quota.Setup(q => q.EnsureUnderLimitAsync(Tid, StudioQuotas.MaxRecordsKey, It.IsAny<int>(), It.IsAny<int>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success());
        _computed.Setup(c => c.ApplyOnCreateAsync(Tid, It.IsAny<Guid>(), It.IsAny<IReadOnlyList<CustomFieldDefinition>>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Returns((Guid _, Guid _, IReadOnlyList<CustomFieldDefinition> _, string json, CancellationToken _) => Task.FromResult(json));
        _computed.Setup(c => c.ApplyOnUpdateAsync(Tid, It.IsAny<Guid>(), It.IsAny<IReadOnlyList<CustomFieldDefinition>>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Returns((Guid _, Guid _, IReadOnlyList<CustomFieldDefinition> _, string json, string _, CancellationToken _) => Task.FromResult(json));
    }

    [Fact]
    public async Task Create_on_junction_with_existing_pair_fails_with_duplicate_link()
    {
        _records.Setup(r => r.ExistsWithFieldPairAsync(Tid, _junction.Id, "employes", EmployeId, "projets", ProjetId, null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);

        var result = await CreateHandler().Handle(new CreateCustomRecordCommand(_junction.Key, Payload()), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(StudioErrorCodes.RecordDuplicateLink, result.Error.Code);
        Assert.Equal("record.duplicate_link", result.Error.Code);
        _records.Verify(r => r.AddAsync(It.IsAny<CustomRecord>(), It.IsAny<CancellationToken>()), Times.Never);
        _publisher.Verify(p => p.Publish(It.IsAny<CustomRecordLifecycleNotification>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Create_on_junction_with_new_pair_persists_the_record()
    {
        _records.Setup(r => r.ExistsWithFieldPairAsync(Tid, _junction.Id, "employes", EmployeId, "projets", ProjetId, null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(false);

        var result = await CreateHandler().Handle(new CreateCustomRecordCommand(_junction.Key, Payload()), CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error.Description);
        _records.Verify(r => r.ExistsWithFieldPairAsync(Tid, _junction.Id, "employes", EmployeId, "projets", ProjetId, null, It.IsAny<CancellationToken>()), Times.Once);
        _records.Verify(r => r.AddAsync(It.Is<CustomRecord>(x => x.EntityDefinitionId == _junction.Id), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Update_on_junction_excludes_the_record_being_updated()
    {
        var existing = CustomRecord.Create(Tid, _junction.Id, """{"employes":"x","projets":"y"}""", Uid);
        _records.Setup(r => r.GetAsync(Tid, _junction.Id, existing.Id, It.IsAny<CancellationToken>())).ReturnsAsync(existing);
        _records.Setup(r => r.ExistsWithFieldPairAsync(Tid, _junction.Id, "employes", EmployeId, "projets", ProjetId, existing.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(false);

        var result = await UpdateHandler().Handle(new UpdateCustomRecordCommand(_junction.Key, existing.Id, Payload()), CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error.Description);
        _records.Verify(r => r.ExistsWithFieldPairAsync(Tid, _junction.Id, "employes", EmployeId, "projets", ProjetId, existing.Id, It.IsAny<CancellationToken>()), Times.Once);
        _records.Verify(r => r.UpdateWithConcurrencyAsync(existing, null, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Update_on_junction_towards_an_existing_pair_fails_with_duplicate_link()
    {
        var existing = CustomRecord.Create(Tid, _junction.Id, """{"employes":"x","projets":"y"}""", Uid);
        _records.Setup(r => r.GetAsync(Tid, _junction.Id, existing.Id, It.IsAny<CancellationToken>())).ReturnsAsync(existing);
        _records.Setup(r => r.ExistsWithFieldPairAsync(Tid, _junction.Id, "employes", EmployeId, "projets", ProjetId, existing.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);

        var result = await UpdateHandler().Handle(new UpdateCustomRecordCommand(_junction.Key, existing.Id, Payload()), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(StudioErrorCodes.RecordDuplicateLink, result.Error.Code);
        _records.Verify(r => r.UpdateWithConcurrencyAsync(It.IsAny<CustomRecord>(), It.IsAny<byte[]?>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Standard_entity_never_runs_the_pair_check()
    {
        var create = await CreateHandler().Handle(new CreateCustomRecordCommand(_standard.Key, Payload()), CancellationToken.None);
        Assert.True(create.IsSuccess, create.Error.Description);

        var existing = CustomRecord.Create(Tid, _standard.Id, """{"employes":"x","projets":"y"}""", Uid);
        _records.Setup(r => r.GetAsync(Tid, _standard.Id, existing.Id, It.IsAny<CancellationToken>())).ReturnsAsync(existing);
        var update = await UpdateHandler().Handle(new UpdateCustomRecordCommand(_standard.Key, existing.Id, Payload()), CancellationToken.None);
        Assert.True(update.IsSuccess, update.Error.Description);

        _records.Verify(r => r.ExistsWithFieldPairAsync(
                It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<Guid?>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task Junction_pair_check_is_skipped_when_a_link_value_is_missing()
    {
        // Optional link fields (or a half-filled pair) are not a duplicate-link case — the « required »
        // validation owns that. Here both fields are optional and only one is provided.
        var data = new Dictionary<string, JsonNode?> { ["employes"] = JsonValue.Create(EmployeId) };

        var result = await CreateHandler().Handle(new CreateCustomRecordCommand(_junction.Key, new SaveCustomRecordRequest(data)), CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error.Description);
        _records.Verify(r => r.ExistsWithFieldPairAsync(
                It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<Guid?>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public void Pair_fields_are_the_first_two_active_relation_fields_in_display_order()
    {
        var entityId = Guid.NewGuid();
        var text = CustomFieldDefinition.Create(Tid, entityId, "role", "Rôle", CustomFieldType.Text, false, false, 0, null, null, null, Uid);
        var second = Relation(entityId, "projets", "projets", 5);
        var first = Relation(entityId, "employes", "employes", 1);
        var inactive = Relation(entityId, "ancien", "employes", 0);
        inactive.Update(inactive.Label, false, false, null, inactive.OptionsJson, null, isActive: false, Uid);

        var pair = JunctionPairChecker.ResolvePairFields(new[] { text, second, first, inactive });

        Assert.NotNull(pair);
        Assert.Equal("employes", pair!.Value.Source.Key);
        Assert.Equal("projets", pair.Value.Target.Key);

        Assert.Null(JunctionPairChecker.ResolvePairFields(new[] { text, first }));
    }

    [Fact]
    public async Task Pair_check_still_applies_when_the_junction_has_an_attribute_field()
    {
        // v1.1 / D-47-40 : l'attribut de liaison (Number, SortOrder après les deux liaisons) ne déplace
        // pas la paire — le contrôle lit toujours les deux premiers RelationCustom actifs par SortOrder.
        var quantite = CustomFieldDefinition.Create(Tid, _junction.Id, "quantite", "Quantité", CustomFieldType.Number, false, false, 2, null, null, null, Uid);
        _fields.Setup(r => r.ListByEntityAsync(Tid, _junction.Id, false, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<CustomFieldDefinition>
            {
                Relation(_junction.Id, "employes", "employes", 0),
                Relation(_junction.Id, "projets", "projets", 1),
                quantite
            });
        _records.Setup(r => r.ExistsWithFieldPairAsync(Tid, _junction.Id, "employes", EmployeId, "projets", ProjetId, null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);

        var payload = new SaveCustomRecordRequest(new Dictionary<string, JsonNode?>
        {
            ["employes"] = JsonValue.Create(EmployeId),
            ["projets"] = JsonValue.Create(ProjetId),
            ["quantite"] = JsonValue.Create(3)
        });
        var result = await CreateHandler().Handle(new CreateCustomRecordCommand(_junction.Key, payload), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(StudioErrorCodes.RecordDuplicateLink, result.Error.Code);
        _records.Verify(r => r.ExistsWithFieldPairAsync(Tid, _junction.Id, "employes", EmployeId, "projets", ProjetId, null, It.IsAny<CancellationToken>()), Times.Once);
        _records.Verify(r => r.AddAsync(It.IsAny<CustomRecord>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    // ---- helpers ----

    private CreateCustomRecordCommandHandler CreateHandler() => new(
        _entities.Object, _fields.Object, _records.Object, _quota.Object, _computed.Object, _publisher.Object, _currentUser.Object);

    private UpdateCustomRecordCommandHandler UpdateHandler() => new(
        _entities.Object, _fields.Object, _records.Object, _computed.Object, _publisher.Object, _currentUser.Object);

    private static SaveCustomRecordRequest Payload() => new(new Dictionary<string, JsonNode?>
    {
        ["employes"] = JsonValue.Create(EmployeId),
        ["projets"] = JsonValue.Create(ProjetId),
        ["role"] = JsonValue.Create("Chef de projet")
    });

    private static CustomFieldDefinition Relation(Guid entityId, string key, string targetKey, int sortOrder) =>
        CustomFieldDefinition.Create(Tid, entityId, key, key, CustomFieldType.RelationCustom, false, false, sortOrder,
            null, StudioFieldJson.SerializeRelation(new RelationRefDto("custom", targetKey)), null, Uid);
}
