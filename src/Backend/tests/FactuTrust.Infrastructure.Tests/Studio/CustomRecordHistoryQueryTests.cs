using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.Records;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities.Studio;
using FactuTrust.Domain.Enums;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

/// <summary>
/// 4.7 « v1.1 » hi-b2 (D5) : <see cref="ListCustomRecordHistoryQueryHandler"/> — gardes (contexte,
/// permission <c>custom_records:read</c>, entité 400, enregistrement 404), mapping des lignes
/// d'audit (nom d'auteur résolu, diff des clés, troncature 200) et pagination.
/// </summary>
public sealed class CustomRecordHistoryQueryTests
{
    private static readonly Guid Tid = Guid.NewGuid();
    private static readonly Guid EntityId = Guid.NewGuid();
    private static readonly Guid UserId = Guid.NewGuid();

    private readonly Mock<ICustomEntityRepository> _entities = new(MockBehavior.Strict);
    private readonly Mock<ICustomRecordRepository> _records = new(MockBehavior.Strict);
    private readonly Mock<IAuditLogQueryService> _auditQuery = new(MockBehavior.Strict);
    private readonly Mock<IStudioUserNameResolver> _userNames = new(MockBehavior.Strict);
    private readonly Mock<ICurrentUser> _currentUser = new();

    private readonly CustomRecord _record;

    public CustomRecordHistoryQueryTests()
    {
        _currentUser.Setup(u => u.TenantId).Returns(Tid);
        _currentUser.Setup(u => u.UserId).Returns(UserId);
        SetupReadPermission();

        var entity = CustomEntityDefinition.Create(Tid, "chantiers", "Chantier", "Chantiers", null, null, UserId);
        typeof(CustomEntityDefinition).GetProperty(nameof(CustomEntityDefinition.Id))!.SetValue(entity, EntityId);
        _entities.Setup(e => e.GetByKeyAsync(Tid, "chantiers", It.IsAny<CancellationToken>())).ReturnsAsync(entity);

        _record = CustomRecord.Create(Tid, EntityId, """{"nom":"Alpha"}""", UserId);
        _records.Setup(r => r.GetAsync(Tid, EntityId, _record.Id, It.IsAny<CancellationToken>())).ReturnsAsync(_record);
    }

    private void SetupReadPermission(bool granted = true) =>
        _currentUser.Setup(c => c.HasPermission(Permissions.CustomData.RecordsRead)).Returns(granted);

    private ListCustomRecordHistoryQueryHandler Handler() =>
        new(_entities.Object, _records.Object, _auditQuery.Object, _userNames.Object, _currentUser.Object);

    private void SetupHistory(params AuditEntityHistoryRowDto[] rows)
    {
        _auditQuery.Setup(a => a.GetEntityHistoryAsync("CustomRecord", _record.Id, It.IsAny<int>(), It.IsAny<int>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(PagedResult<AuditEntityHistoryRowDto>.Create(rows, 1, 20, rows.Length)));
    }

    private static AuditEntityHistoryRowDto Row(string action, string? oldValues, string? newValues, Guid? userId = null) =>
        new()
        {
            Id = Guid.NewGuid(),
            Action = action,
            CreatedAt = new DateTime(2026, 9, 18, 12, 0, 0, DateTimeKind.Utc),
            UserId = userId,
            OldValues = oldValues,
            NewValues = newValues
        };

    [Fact]
    public async Task Handle_without_read_permission_returns_unauthorized_and_calls_nothing()
    {
        SetupReadPermission(granted: false);

        var result = await Handler().Handle(new ListCustomRecordHistoryQuery("chantiers", _record.Id), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Unauthorized", result.Error.Code);
        _entities.VerifyNoOtherCalls();
        _records.VerifyNoOtherCalls();
        _auditQuery.VerifyNoOtherCalls();
        _userNames.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Handle_unknown_entity_returns_a_validation_error()
    {
        _entities.Setup(e => e.GetByKeyAsync(Tid, "inconnue", It.IsAny<CancellationToken>()))
            .ReturnsAsync((CustomEntityDefinition?)null);

        var result = await Handler().Handle(new ListCustomRecordHistoryQuery("inconnue", _record.Id), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.entityKey", result.Error.Code);
    }

    [Fact]
    public async Task Handle_unknown_record_returns_not_found()
    {
        _records.Setup(r => r.GetAsync(Tid, EntityId, It.Is<Guid>(id => id != _record.Id), It.IsAny<CancellationToken>()))
            .ReturnsAsync((CustomRecord?)null);

        var result = await Handler().Handle(new ListCustomRecordHistoryQuery("chantiers", Guid.NewGuid()), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("CustomRecord.NotFound", result.Error.Code);
    }

    [Fact]
    public async Task Handle_maps_rows_with_resolved_names_and_key_diffs()
    {
        var author = Guid.NewGuid();
        SetupHistory(
            Row("Studio.Record.Updated", """{"nom":"Alpha","statut":"encours","retire":"x"}""", """{"nom":"Bêta","statut":"encours"}""", author),
            Row("Studio.Record.Created", null, """{"nom":"Alpha"}""", Guid.NewGuid()));
        _userNames.Setup(u => u.GetDisplayNamesAsync(Tid, It.IsAny<IReadOnlyCollection<Guid>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<Guid, string> { [author] = "Alice Martin" });

        var result = await Handler().Handle(new ListCustomRecordHistoryQuery("chantiers", _record.Id, 2, 5), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(2, result.Value.Items.Count);

        var updated = result.Value.Items[0];
        Assert.Equal("Studio.Record.Updated", updated.Action);
        Assert.Equal("Alice Martin", updated.UserName);
        Assert.Equal(3, updated.Changes.Count);
        Assert.Equal(new RecordHistoryChangeDto("nom", "Alpha", "Bêta"), updated.Changes[0]);
        Assert.Equal(new RecordHistoryChangeDto("retire", "x", null), updated.Changes[1]);
        Assert.Equal(new RecordHistoryChangeDto("statut", "encours", "encours"), updated.Changes[2]);

        var created = result.Value.Items[1];
        Assert.Null(created.UserName); // auteur inconnu du résolveur : jamais d'identifiant exposé
        var change = Assert.Single(created.Changes);
        Assert.Equal(new RecordHistoryChangeDto("nom", null, "Alpha"), change);
    }

    [Fact]
    public async Task Handle_truncates_change_values_to_200_characters()
    {
        var longValue = new string('x', 250);
        SetupHistory(Row("Studio.Record.Updated", null, $"{{\"note\":\"{longValue}\"}}", UserId));
        _userNames.Setup(u => u.GetDisplayNamesAsync(Tid, It.IsAny<IReadOnlyCollection<Guid>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<Guid, string>());

        var result = await Handler().Handle(new ListCustomRecordHistoryQuery("chantiers", _record.Id), CancellationToken.None);

        var change = Assert.Single(result.Value.Items[0].Changes);
        Assert.Equal(200, change.NewValue!.Length);
    }

    [Fact]
    public async Task Handle_with_unreadable_json_lists_the_entry_with_empty_changes()
    {
        SetupHistory(Row("Studio.Record.Updated", "{pas du json", null, UserId));
        _userNames.Setup(u => u.GetDisplayNamesAsync(Tid, It.IsAny<IReadOnlyCollection<Guid>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<Guid, string>());

        var result = await Handler().Handle(new ListCustomRecordHistoryQuery("chantiers", _record.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        var entry = Assert.Single(result.Value.Items);
        Assert.Empty(entry.Changes);
    }
}
