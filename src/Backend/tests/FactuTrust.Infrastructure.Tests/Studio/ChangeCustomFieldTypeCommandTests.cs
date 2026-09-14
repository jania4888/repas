using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.Fields;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities.Studio;
using FactuTrust.Domain.Enums;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

/// <summary>
/// PR 3.1 — <see cref="ChangeCustomFieldTypeCommand"/> et <see cref="CheckCustomFieldTypeChangeQuery"/> :
/// <see cref="FieldTypeConversionPolicy"/> comme unique point de vérité, comptage des enregistrements
/// seulement si nécessaire (<c>RequiresEmptyTable</c>), <c>IsUnique</c> remis à faux si le nouveau type
/// n'est plus « unique-able », index JSON toujours redéposé, audit best-effort, et le <c>Check</c>
/// ne modifie jamais rien.
/// </summary>
public sealed class ChangeCustomFieldTypeCommandTests
{
    private static readonly Guid Tid = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid Uid = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid EntityId = Guid.Parse("33333333-3333-3333-3333-333333333333");
    private static readonly Guid OtherEntityId = Guid.Parse("44444444-4444-4444-4444-444444444444");

    private readonly Mock<ICustomFieldRepository> _fields = new();
    private readonly Mock<ICustomRecordRepository> _records = new();
    private readonly Mock<IJsonIndexManager> _jsonIndex = new();
    private readonly Mock<IAuditService> _audit = new();
    private readonly Mock<ICurrentUser> _currentUser = new();

    public ChangeCustomFieldTypeCommandTests()
    {
        _currentUser.SetupGet(u => u.TenantId).Returns(Tid);
        _currentUser.SetupGet(u => u.UserId).Returns(Uid);
        _jsonIndex.Setup(j => j.DropFieldIndexAsync(Tid, It.IsAny<string>(), It.IsAny<CancellationToken>())).Returns(Task.CompletedTask);
        _jsonIndex.Setup(j => j.EnsureUniqueFieldIndexAsync(Tid, It.IsAny<string>(), It.IsAny<CancellationToken>())).Returns(Task.CompletedTask);
        _audit.Setup(a => a.LogAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<Guid?>(), It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);
    }

    private static CustomFieldDefinition MakeField(CustomFieldType type, bool isUnique = false, Guid? entityId = null) =>
        CustomFieldDefinition.Create(Tid, entityId ?? EntityId, "champ", "Champ", type, isRequired: false, isUnique, sortOrder: 0, null, null, null, Uid);

    private ChangeCustomFieldTypeCommandHandler Handler() => new(_fields.Object, _records.Object, _jsonIndex.Object, _audit.Object, _currentUser.Object);
    private CheckCustomFieldTypeChangeQueryHandler CheckHandler() => new(_fields.Object, _records.Object, _currentUser.Object);

    private void SetupField(CustomFieldDefinition field) =>
        _fields.Setup(f => f.GetByIdAsync(Tid, field.Id, It.IsAny<CancellationToken>())).ReturnsAsync(field);

    [Fact]
    public async Task Lossless_on_non_empty_table_succeeds_keeps_index_and_audits()
    {
        var field = MakeField(CustomFieldType.Number);
        SetupField(field);
        _records.Setup(r => r.CountAsync(Tid, EntityId, It.IsAny<CancellationToken>())).ReturnsAsync(42);

        var result = await Handler().Handle(new ChangeCustomFieldTypeCommand(EntityId, field.Id, new ChangeCustomFieldTypeRequest(CustomFieldType.Decimal)), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(CustomFieldType.Decimal, result.Value.FieldType);
        _fields.Verify(f => f.UpdateAsync(It.IsAny<CustomFieldDefinition>(), It.IsAny<CancellationToken>()), Times.Once);
        _jsonIndex.Verify(j => j.DropFieldIndexAsync(It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
        _audit.Verify(a => a.LogAsync("Studio.Field.TypeChanged", "CustomField", field.Id, It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()), Times.Once);
        // CountAsync ne doit jamais être appelé pour une conversion sans perte.
        _records.Verify(r => r.CountAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task RequiresEmptyTable_with_records_is_refused_without_update()
    {
        var field = MakeField(CustomFieldType.Text);
        SetupField(field);
        _records.Setup(r => r.CountAsync(Tid, EntityId, It.IsAny<CancellationToken>())).ReturnsAsync(3);

        var result = await Handler().Handle(new ChangeCustomFieldTypeCommand(EntityId, field.Id, new ChangeCustomFieldTypeRequest(CustomFieldType.Number)), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.fieldType", result.Error.Code);
        _fields.Verify(f => f.UpdateAsync(It.IsAny<CustomFieldDefinition>(), It.IsAny<CancellationToken>()), Times.Never);
        _jsonIndex.Verify(j => j.DropFieldIndexAsync(It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task RequiresEmptyTable_with_zero_records_succeeds()
    {
        var field = MakeField(CustomFieldType.Text);
        SetupField(field);
        _records.Setup(r => r.CountAsync(Tid, EntityId, It.IsAny<CancellationToken>())).ReturnsAsync(0);

        var result = await Handler().Handle(new ChangeCustomFieldTypeCommand(EntityId, field.Id, new ChangeCustomFieldTypeRequest(CustomFieldType.Number)), CancellationToken.None);

        Assert.True(result.IsSuccess);
        _fields.Verify(f => f.UpdateAsync(It.IsAny<CustomFieldDefinition>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Forbidden_is_refused_without_calling_CountAsync()
    {
        var field = MakeField(CustomFieldType.Attachment);
        SetupField(field);

        var result = await Handler().Handle(new ChangeCustomFieldTypeCommand(EntityId, field.Id, new ChangeCustomFieldTypeRequest(CustomFieldType.Text)), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.fieldType", result.Error.Code);
        _records.Verify(r => r.CountAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);
        _fields.Verify(f => f.UpdateAsync(It.IsAny<CustomFieldDefinition>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Field_belonging_to_another_entity_is_NotFound()
    {
        var field = MakeField(CustomFieldType.Number, entityId: OtherEntityId);
        SetupField(field);

        var result = await Handler().Handle(new ChangeCustomFieldTypeCommand(EntityId, field.Id, new ChangeCustomFieldTypeRequest(CustomFieldType.Decimal)), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("CustomField.NotFound", result.Error.Code);
    }

    [Fact]
    public async Task Unique_field_becoming_non_unique_capable_type_resets_IsUnique_and_skips_EnsureUnique()
    {
        var field = MakeField(CustomFieldType.Text, isUnique: true);
        SetupField(field);
        _records.Setup(r => r.CountAsync(Tid, EntityId, It.IsAny<CancellationToken>())).ReturnsAsync(0);

        // Text -> MultilineText est sans perte (rule TextLike<->TextLike) et MultilineText n'est pas
        // « unique-able » : IsUnique doit retomber à false.
        var result = await Handler().Handle(new ChangeCustomFieldTypeCommand(EntityId, field.Id, new ChangeCustomFieldTypeRequest(CustomFieldType.MultilineText)), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.False(result.Value.IsUnique);
        _jsonIndex.Verify(j => j.EnsureUniqueFieldIndexAsync(It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
        _jsonIndex.Verify(j => j.DropFieldIndexAsync(It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Unique_field_staying_unique_capable_reensures_unique_index()
    {
        var field = MakeField(CustomFieldType.Text, isUnique: true);
        SetupField(field);

        // Text -> Barcode reste dans TextLike, donc sans perte ; Barcode est unique-able.
        var result = await Handler().Handle(new ChangeCustomFieldTypeCommand(EntityId, field.Id, new ChangeCustomFieldTypeRequest(CustomFieldType.Barcode)), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(result.Value.IsUnique);
        _jsonIndex.Verify(j => j.DropFieldIndexAsync(It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
        _jsonIndex.Verify(j => j.EnsureUniqueFieldIndexAsync(Tid, "champ", It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task RequiresEmptyTable_records_appearing_after_first_count_revert_the_change()
    {
        var field = MakeField(CustomFieldType.Text);
        SetupField(field);
        // Premier comptage : table vide ; second comptage (après persistance) : 3 enregistrements
        // insérés entre-temps => le changement doit être annulé.
        _records.SetupSequence(r => r.CountAsync(Tid, EntityId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(0)
            .ReturnsAsync(3);

        var result = await Handler().Handle(new ChangeCustomFieldTypeCommand(EntityId, field.Id, new ChangeCustomFieldTypeRequest(CustomFieldType.Number)), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.fieldType", result.Error.Code);
        Assert.Contains("3", result.Error.Description);
        Assert.Equal(CustomFieldType.Text, field.FieldType);
        // Une écriture pour appliquer, une seconde pour revenir en arrière.
        _fields.Verify(f => f.UpdateAsync(It.IsAny<CustomFieldDefinition>(), It.IsAny<CancellationToken>()), Times.Exactly(2));
        _audit.Verify(a => a.LogAsync("Studio.Field.TypeChanged", It.IsAny<string>(), It.IsAny<Guid?>(), It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Invalid_select_options_yield_Validation_options()
    {
        var field = MakeField(CustomFieldType.Text);
        SetupField(field);

        var result = await Handler().Handle(new ChangeCustomFieldTypeCommand(EntityId, field.Id, new ChangeCustomFieldTypeRequest(CustomFieldType.Select, Options: null)), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.options", result.Error.Code);
        _fields.Verify(f => f.UpdateAsync(It.IsAny<CustomFieldDefinition>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Check_query_never_updates_and_reports_recordCount_and_allowed()
    {
        var field = MakeField(CustomFieldType.Text);
        SetupField(field);
        _records.Setup(r => r.CountAsync(Tid, EntityId, It.IsAny<CancellationToken>())).ReturnsAsync(12);

        var result = await CheckHandler().Handle(new CheckCustomFieldTypeChangeQuery(EntityId, field.Id, CustomFieldType.Number), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("Text", result.Value.From);
        Assert.Equal("Number", result.Value.To);
        Assert.Equal("requires_empty_table", result.Value.Policy);
        Assert.Equal(12, result.Value.RecordCount);
        Assert.False(result.Value.Allowed);
        _fields.Verify(f => f.UpdateAsync(It.IsAny<CustomFieldDefinition>(), It.IsAny<CancellationToken>()), Times.Never);
        _jsonIndex.Verify(j => j.DropFieldIndexAsync(It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Check_query_reports_allowed_true_when_lossless()
    {
        var field = MakeField(CustomFieldType.Number);
        SetupField(field);

        var result = await CheckHandler().Handle(new CheckCustomFieldTypeChangeQuery(EntityId, field.Id, CustomFieldType.Decimal), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("lossless", result.Value.Policy);
        Assert.True(result.Value.Allowed);
        Assert.Equal(0, result.Value.RecordCount);
        _records.Verify(r => r.CountAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);
    }
}
