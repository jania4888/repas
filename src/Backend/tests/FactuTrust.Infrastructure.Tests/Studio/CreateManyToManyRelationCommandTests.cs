using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Repositories;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Features.Studio.Common;
using FactuTrust.Application.Features.Studio.Entities;
using FactuTrust.Application.Features.Studio.Fields;
using FactuTrust.Application.Features.Studio.Relations;
using FactuTrust.Domain.Common;
using FactuTrust.Domain.Entities.Studio;
using FactuTrust.Domain.Enums;
using MediatR;
using Moq;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Studio;

/// <summary>
/// Studio IA — PR 2.1 : la commande N‑N crée UNE table de jonction (<c>Kind = Junction</c>) et DEUX champs
/// <c>RelationCustom</c> requis, exclusivement via les commandes existantes (chemin unique IA / manuel),
/// refuse les cibles invalides (source == cible, jonction, autre tenant), compense la jonction si un champ
/// échoue et journalise <c>Studio.Relation.ManyToManyCreated</c>.
/// </summary>
public sealed class CreateManyToManyRelationCommandTests
{
    private static readonly Guid Tid = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid Uid = Guid.Parse("22222222-2222-2222-2222-222222222222");

    private readonly Mock<ICustomEntityRepository> _entities = new();
    private readonly Mock<IAuditService> _audit = new();
    private readonly Mock<ICurrentUser> _currentUser = new();
    private readonly Mock<IMediator> _mediator = new();
    private readonly Mock<IJsonIndexManager> _jsonIndex = new();
    private readonly Mock<IStudioQuotaService> _quota = new();

    private readonly List<object> _sent = new();
    private readonly List<CustomEntityDefinition> _capturedEntities = new();
    private readonly CustomEntityDefinition _employes;
    private readonly CustomEntityDefinition _projets;

    public CreateManyToManyRelationCommandTests()
    {
        _currentUser.SetupGet(u => u.TenantId).Returns(Tid);
        _currentUser.SetupGet(u => u.UserId).Returns(Uid);

        _employes = CustomEntityDefinition.Create(Tid, "employes", "Employé", "Employés", "users", null, Uid);
        _projets = CustomEntityDefinition.Create(Tid, "projets", "Projet", "Projets", "briefcase", null, Uid);
        RegisterEntity(_employes);
        RegisterEntity(_projets);

        // Junction keys are resolved against soft-deleted definitions too (the unique index is not
        // filtered): the handler must always pass includeDeleted: true.
        _entities.Setup(r => r.KeyExistsAsync(Tid, It.IsAny<string>(), It.IsAny<bool>(), It.IsAny<CancellationToken>())).ReturnsAsync(false);
        _jsonIndex.Setup(j => j.EnsureFieldIndexAsync(Tid, It.IsAny<string>(), It.IsAny<CancellationToken>())).Returns(Task.CompletedTask);
        _audit.Setup(a => a.LogAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<Guid?>(), It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        // Default happy-path mediator: every sub-command succeeds and echoes its request.
        _mediator.Setup(m => m.Send(It.IsAny<CreateCustomEntityCommand>(), It.IsAny<CancellationToken>()))
            .Returns((CreateCustomEntityCommand c, CancellationToken _) =>
            {
                _sent.Add(c);
                return Task.FromResult(Result.Success(EntityDto(c.Request)));
            });

        _mediator.Setup(m => m.Send(It.IsAny<CreateCustomFieldCommand>(), It.IsAny<CancellationToken>()))
            .Returns((CreateCustomFieldCommand c, CancellationToken _) =>
            {
                _sent.Add(c);
                return Task.FromResult(Result.Success(FieldDto(c.Request, _sent.Count)));
            });
        _mediator.Setup(m => m.Send(It.IsAny<DeleteCustomEntityCommand>(), It.IsAny<CancellationToken>()))
            .Returns((DeleteCustomEntityCommand c, CancellationToken _) =>
            {
                _sent.Add(c);
                return Task.FromResult(Result.Success());
            });

        // Real handler for CreateCustomEntityCommand (the N-N command goes through it via the mediator):
        // success under the internal AllowJunction seal, Validation.kind without it. Added entities are
        // captured so compensation tests can match the junction id (Guid.NewGuid inside the handler).
        var entityHandler = new CreateCustomEntityCommandHandler(_entities.Object, _quota.Object, _audit.Object, _currentUser.Object);
        _entities.Setup(r => r.AddAsync(It.IsAny<CustomEntityDefinition>(), It.IsAny<CancellationToken>()))
            .Callback((CustomEntityDefinition e, CancellationToken _) => _capturedEntities.Add(e))
            .Returns(Task.CompletedTask);
        _quota.Setup(q => q.EnsureUnderLimitAsync(It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<int>(), It.IsAny<int>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success());
        _mediator.Setup(m => m.Send(It.IsAny<CreateCustomEntityCommand>(), It.IsAny<CancellationToken>()))
            .Returns((CreateCustomEntityCommand c, CancellationToken ct) =>
            {
                _sent.Add(c);
                return entityHandler.Handle(c, ct);
            });
    }

    [Fact]
    public async Task Nominal_creates_one_junction_entity_and_two_required_relation_fields()
    {
        var result = await Handler().Handle(
            new CreateManyToManyRelationCommand(_employes.Id, new CreateManyToManyRelationRequest(_projets.Id, null, null, null)),
            CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error.Description);

        var entityCommands = _sent.OfType<CreateCustomEntityCommand>().ToList();
        var fieldCommands = _sent.OfType<CreateCustomFieldCommand>().ToList();
        Assert.Single(entityCommands);
        Assert.Equal(2, fieldCommands.Count);
        Assert.Empty(_sent.OfType<DeleteCustomEntityCommand>());

        var junctionRequest = entityCommands[0].Request;
        Assert.Equal(CustomEntityKind.Junction, junctionRequest.Kind);
        Assert.Equal("employes_projets", junctionRequest.Key);
        Assert.Equal(_employes.SystemId, junctionRequest.SystemId);
        Assert.Equal("Employé – Projet", junctionRequest.DisplayName);

        Assert.All(fieldCommands, c =>
        {
            Assert.True(c.Request.IsRequired);
            Assert.False(c.Request.IsUnique);
            Assert.Equal(CustomFieldType.RelationCustom, c.Request.FieldType);
            Assert.Equal("custom", c.Request.Relation?.Kind);
        });
        Assert.Equal("employes", fieldCommands[0].Request.Key);
        Assert.Equal("employes", fieldCommands[0].Request.Relation!.Ref);
        Assert.Equal("projets", fieldCommands[1].Request.Key);
        Assert.Equal("projets", fieldCommands[1].Request.Relation!.Ref);
        // Both fields hang off the freshly created junction (never off the source/target).
        Assert.All(fieldCommands, c => Assert.Equal(result.Value.Junction.Id, c.EntityId));

        // Sequencing: entity first, then source field, then target field.
        Assert.Collection(_sent,
            c => Assert.IsType<CreateCustomEntityCommand>(c),
            c => Assert.IsType<CreateCustomFieldCommand>(c),
            c => Assert.IsType<CreateCustomFieldCommand>(c));

        // Result DTO: junction with FieldCount = 2 + both fields, in (source, target) order.
        Assert.Equal(2, result.Value.Junction.FieldCount);
        Assert.Equal(CustomEntityKind.Junction, result.Value.Junction.Kind);
        Assert.Equal("employes", result.Value.SourceField.Key);
        Assert.Equal("projets", result.Value.TargetField.Key);

        // R10: one non-unique jx_ index per link field (best effort).
        _jsonIndex.Verify(j => j.EnsureFieldIndexAsync(Tid, "employes", It.IsAny<CancellationToken>()), Times.Once);
        _jsonIndex.Verify(j => j.EnsureFieldIndexAsync(Tid, "projets", It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Nominal_writes_the_many_to_many_audit_entry()
    {
        var result = await Handler().Handle(
            new CreateManyToManyRelationCommand(_employes.Id, new CreateManyToManyRelationRequest(_projets.Id, "Affectations", null, null)),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("Studio.Relation.ManyToManyCreated", CreateManyToManyRelationCommandHandler.AuditAction);
        _audit.Verify(a => a.LogAsync(
                CreateManyToManyRelationCommandHandler.AuditAction,
                "CustomEntity",
                result.Value.Junction.Id,
                null,
                It.IsAny<object?>(),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task Explicit_junction_key_and_display_name_are_honoured()
    {
        var result = await Handler().Handle(
            new CreateManyToManyRelationCommand(_employes.Id,
                new CreateManyToManyRelationRequest(_projets.Id, null, "Affectations", "Affectation")),
            CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error.Description);
        var junctionRequest = _sent.OfType<CreateCustomEntityCommand>().Single().Request;
        Assert.Equal("affectations", junctionRequest.Key); // lower-cased, validated shape
        Assert.Equal("Affectation", junctionRequest.DisplayName);
    }

    [Fact]
    public async Task Default_key_falls_back_to_a_numeric_suffix_when_taken_and_explicit_key_conflicts()
    {
        _entities.Setup(r => r.KeyExistsAsync(Tid, "employes_projets", It.IsAny<bool>(), It.IsAny<CancellationToken>())).ReturnsAsync(true);

        var fallback = await Handler().Handle(
            new CreateManyToManyRelationCommand(_employes.Id, new CreateManyToManyRelationRequest(_projets.Id, null, null, null)),
            CancellationToken.None);
        Assert.True(fallback.IsSuccess, fallback.Error.Description);
        Assert.Equal("employes_projets_2", _sent.OfType<CreateCustomEntityCommand>().Single().Request.Key);

        _sent.Clear();
        var explicitConflict = await Handler().Handle(
            new CreateManyToManyRelationCommand(_employes.Id, new CreateManyToManyRelationRequest(_projets.Id, null, "employes_projets", null)),
            CancellationToken.None);
        Assert.True(explicitConflict.IsFailure);
        Assert.Equal("Conflict", explicitConflict.Error.Code);
        Assert.Empty(_sent); // nothing written
    }

    [Fact]
    public async Task Source_equal_to_target_is_rejected_before_any_write()
    {
        var result = await Handler().Handle(
            new CreateManyToManyRelationCommand(_employes.Id, new CreateManyToManyRelationRequest(_employes.Id, null, null, null)),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.target", result.Error.Code);
        Assert.Empty(_sent);
    }

    [Fact]
    public async Task Junction_target_is_rejected()
    {
        var junction = CustomEntityDefinition.Create(Tid, "employes_projets", "Employé – Projet", "Employé – Projet", "link", null, Uid, null, CustomEntityKind.Junction);
        RegisterEntity(junction);

        var result = await Handler().Handle(
            new CreateManyToManyRelationCommand(_employes.Id, new CreateManyToManyRelationRequest(junction.Id, null, null, null)),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.target", result.Error.Code);
        Assert.Empty(_sent);
    }

    [Fact]
    public async Task Junction_source_is_rejected()
    {
        var junction = CustomEntityDefinition.Create(Tid, "employes_projets", "Employé – Projet", "Employé – Projet", "link", null, Uid, null, CustomEntityKind.Junction);
        RegisterEntity(junction);

        var result = await Handler().Handle(
            new CreateManyToManyRelationCommand(junction.Id, new CreateManyToManyRelationRequest(_projets.Id, null, null, null)),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.source", result.Error.Code);
        Assert.Empty(_sent);
    }

    [Fact]
    public async Task Unknown_or_other_tenant_source_is_not_found()
    {
        // The repository is tenant-scoped: an entity of another tenant is simply not returned.
        var foreign = Guid.NewGuid();

        var result = await Handler().Handle(
            new CreateManyToManyRelationCommand(foreign, new CreateManyToManyRelationRequest(_projets.Id, null, null, null)),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("CustomEntity.NotFound", result.Error.Code);
        Assert.Empty(_sent);
    }

    [Fact]
    public async Task Unknown_target_is_a_validation_error()
    {
        var result = await Handler().Handle(
            new CreateManyToManyRelationCommand(_employes.Id, new CreateManyToManyRelationRequest(Guid.NewGuid(), null, null, null)),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.target", result.Error.Code);
        Assert.Empty(_sent);
    }

    [Fact]
    public async Task Second_field_failure_compensates_by_deleting_the_junction_and_returns_the_original_error()
    {
        var fieldError = Error.Validation("key", "Un champ avec la clé « projets » existe déjà.");
        var calls = 0;
        _mediator.Setup(m => m.Send(It.IsAny<CreateCustomFieldCommand>(), It.IsAny<CancellationToken>()))
            .Returns((CreateCustomFieldCommand c, CancellationToken _) =>
            {
                _sent.Add(c);
                calls++;
                return Task.FromResult(calls == 1
                    ? Result.Success(FieldDto(c.Request, 1))
                    : Result.Failure<CustomFieldDto>(fieldError));
            });

        var result = await Handler().Handle(
            new CreateManyToManyRelationCommand(_employes.Id, new CreateManyToManyRelationRequest(_projets.Id, null, null, null)),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(fieldError, result.Error);

        var delete = Assert.Single(_sent.OfType<DeleteCustomEntityCommand>());
        // The deleted junction is the row captured by the real CreateCustomEntityCommand handler.
        var captured = _capturedEntities.Single(e => e.Key == "employes_projets");
        Assert.Equal(captured.Id, delete.Id);

        // No M2M audit for a relation that does not exist (the junction's own Studio.Entity.Created
        // entry is written by the real entity handler — that is expected); no index for a rolled-back junction.
        _audit.Verify(a => a.LogAsync(CreateManyToManyRelationCommandHandler.AuditAction, It.IsAny<string>(), It.IsAny<Guid?>(), It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()), Times.Never);
        _jsonIndex.Verify(j => j.EnsureFieldIndexAsync(It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    /// <summary>
    /// Le quota de tables est celui de <c>CreateCustomEntityCommand</c> (une jonction EST une table) :
    /// son échec remonte tel quel, aucun champ n'est créé et rien n'est à compenser.
    /// </summary>
    [Fact]
    public async Task Quota_failure_of_the_junction_creation_is_returned_as_is_without_any_field()
    {
        var quotaError = Error.Validation("quota", "Quota de tables atteint.");
        _mediator.Setup(m => m.Send(It.IsAny<CreateCustomEntityCommand>(), It.IsAny<CancellationToken>()))
            .Returns((CreateCustomEntityCommand c, CancellationToken _) =>
            {
                _sent.Add(c);
                return Task.FromResult(Result.Failure<CustomEntityDto>(quotaError));
            });

        var result = await Handler().Handle(
            new CreateManyToManyRelationCommand(_employes.Id, new CreateManyToManyRelationRequest(_projets.Id, null, null, null)),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(quotaError, result.Error);
        Assert.Single(_sent.OfType<CreateCustomEntityCommand>());
        Assert.Empty(_sent.OfType<CreateCustomFieldCommand>());
        Assert.Empty(_sent.OfType<DeleteCustomEntityCommand>());
    }

    /// <summary>
    /// L'index unique <c>(TenantId, Key)</c> n'est pas filtré sur <c>IsDeleted</c> : une jonction
    /// supprimée (par un designer, ou par la compensation d'une tentative précédente) verrouille
    /// quand même sa clé. Sans <c>includeDeleted</c>, la relance ré-insérerait <c>employes_projets</c>
    /// et violerait l'index (erreur générique) au lieu de produire <c>employes_projets_2</c>.
    /// </summary>
    [Fact]
    public async Task Soft_deleted_junction_key_is_seen_as_taken_and_the_fallback_suffix_is_used()
    {
        // Only the includeDeleted probe sees the key (i.e. the key belongs to a soft-deleted row).
        _entities.Setup(r => r.KeyExistsAsync(Tid, "employes_projets", true, It.IsAny<CancellationToken>())).ReturnsAsync(true);
        _entities.Setup(r => r.KeyExistsAsync(Tid, "employes_projets", false, It.IsAny<CancellationToken>())).ReturnsAsync(false);

        var result = await Handler().Handle(
            new CreateManyToManyRelationCommand(_employes.Id, new CreateManyToManyRelationRequest(_projets.Id, null, null, null)),
            CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error.Description);
        Assert.Equal("employes_projets_2", _sent.OfType<CreateCustomEntityCommand>().Single().Request.Key);
        // The junction-key probe always includes soft-deleted rows (only the entity handler's own
        // duplicate check, which happens later for the already-resolved free key, uses includeDeleted=false).
        _entities.Verify(r => r.KeyExistsAsync(Tid, "employes_projets", false, It.IsAny<CancellationToken>()), Times.Never);
        _entities.Verify(r => r.KeyExistsAsync(Tid, "employes_projets", true, It.IsAny<CancellationToken>()), Times.Once);
    }

    /// <summary>Même garde pour une clé explicite : 409 même si la ligne existante est soft-deleted.</summary>
    [Fact]
    public async Task Explicit_junction_key_conflicts_with_a_soft_deleted_row()
    {
        _entities.Setup(r => r.KeyExistsAsync(Tid, "affectations", true, It.IsAny<CancellationToken>())).ReturnsAsync(true);
        _entities.Setup(r => r.KeyExistsAsync(Tid, "affectations", false, It.IsAny<CancellationToken>())).ReturnsAsync(false);

        var result = await Handler().Handle(
            new CreateManyToManyRelationCommand(_employes.Id, new CreateManyToManyRelationRequest(_projets.Id, null, "affectations", null)),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Conflict", result.Error.Code);
        Assert.Empty(_sent);
    }

    /// <summary>
    /// Une exception levée par la création d'un champ (timeout SQL, <c>DbUpdateException</c>, annulation)
    /// laissait la jonction active avec 0 ou 1 champ : le soft delete compensatoire doit aussi jouer sur
    /// exception (avec <c>CancellationToken.None</c>), puis l'exception est relancée.
    /// </summary>
    [Fact]
    public async Task Field_creation_exception_still_compensates_the_junction_then_rethrows()
    {
        _mediator.Setup(m => m.Send(It.IsAny<CreateCustomFieldCommand>(), It.IsAny<CancellationToken>()))
            .Returns((CreateCustomFieldCommand c, CancellationToken _) =>
            {
                _sent.Add(c);
                return _sent.OfType<CreateCustomFieldCommand>().Count() == 1
                    ? Task.FromResult(Result.Success(FieldDto(c.Request, 1)))
                    : throw new InvalidOperationException("timeout SQL simulé");
            });

        await Assert.ThrowsAsync<InvalidOperationException>(() => Handler().Handle(
            new CreateManyToManyRelationCommand(_employes.Id, new CreateManyToManyRelationRequest(_projets.Id, null, null, null)),
            CancellationToken.None));

        Assert.Single(_sent.OfType<DeleteCustomEntityCommand>());
        _audit.Verify(a => a.LogAsync(CreateManyToManyRelationCommandHandler.AuditAction, It.IsAny<string>(), It.IsAny<Guid?>(), It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    /// <summary>La compensation survit à l'annulation de la requête d'origine (jeton neutre).</summary>
    [Fact]
    public async Task Cancellation_during_field_creation_compensates_with_a_neutral_token_then_rethrows()
    {
        _mediator.Setup(m => m.Send(It.IsAny<CreateCustomFieldCommand>(), It.IsAny<CancellationToken>()))
            .Returns((CreateCustomFieldCommand c, CancellationToken _) =>
            {
                _sent.Add(c);
                return _sent.OfType<CreateCustomFieldCommand>().Count() == 1
                    ? Task.FromResult(Result.Success(FieldDto(c.Request, 1)))
                    : throw new OperationCanceledException();
            });

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => Handler().Handle(
            new CreateManyToManyRelationCommand(_employes.Id, new CreateManyToManyRelationRequest(_projets.Id, null, null, null)),
            CancellationToken.None));

        Assert.Single(_sent.OfType<DeleteCustomEntityCommand>());
    }

    /// <summary>La jonction est créée via la commande standard avec le sceau interne <c>AllowJunction</c>.</summary>
    [Fact]
    public async Task Junction_entity_command_carries_the_internal_allow_junction_seal()
    {
        var result = await Handler().Handle(
            new CreateManyToManyRelationCommand(_employes.Id, new CreateManyToManyRelationRequest(_projets.Id, null, null, null)),
            CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error.Description);
        Assert.True(_sent.OfType<CreateCustomEntityCommand>().Single().AllowJunction);
    }

    /// <summary>
    /// Sans le sceau interne, la commande d'entité refuse une jonction (revue PR 2.1) : la requête
    /// n'aboutit pas, la compensation s'applique aussi à un refus d'écriture de la jonction elle-même.
    /// </summary>
    [Fact]
    public async Task Junction_entity_without_the_seal_is_rejected_as_validation_kind()
    {
        var entityHandler = new CreateCustomEntityCommandHandler(_entities.Object, _quota.Object, _audit.Object, _currentUser.Object);
        _quota.Setup(q => q.EnsureUnderLimitAsync(It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<int>(), It.IsAny<int>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success());
        _entities.Setup(r => r.AddAsync(It.IsAny<CustomEntityDefinition>(), It.IsAny<CancellationToken>())).Returns(Task.CompletedTask);

        var result = await entityHandler.Handle(
            new CreateCustomEntityCommand(new CreateCustomEntityRequest("liens", "Liens", null, "link", null, null, CustomEntityKind.Junction)),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.kind", result.Error.Code);
        _entities.Verify(r => r.AddAsync(It.IsAny<CustomEntityDefinition>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Missing_tenant_is_unauthorized()
    {
        _currentUser.SetupGet(u => u.TenantId).Returns((Guid?)null);

        var result = await Handler().Handle(
            new CreateManyToManyRelationCommand(_employes.Id, new CreateManyToManyRelationRequest(_projets.Id, null, null, null)),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Unauthorized", result.Error.Code);
        Assert.Empty(_sent);
    }

    [Theory]
    [InlineData("employes", "projets", "employes", "projets")]
    [InlineData("id", "projets", "id_ref", "projets")]          // reserved field key → _ref
    [InlineData("contacts", "contacts", "contacts_a", "contacts_b")] // self-join → _a/_b
    public void Field_keys_avoid_reserved_names_and_self_join_collisions(string source, string target, string expectedSource, string expectedTarget)
    {
        var (s, t) = CreateManyToManyRelationCommandHandler.ResolveFieldKeys(source, target);
        Assert.Equal(expectedSource, s);
        Assert.Equal(expectedTarget, t);
        Assert.True(StudioKey.IsValidShape(s));
        Assert.True(StudioKey.IsValidShape(t));
        Assert.False(StudioKey.IsReservedFieldKey(s));
        Assert.False(StudioKey.IsReservedFieldKey(t));
    }

    // ---- helpers ----

    // ---- v1.1 / D-47-40 (R4) : attribut de liaison optionnel — 3ᵉ champ Number sur la jonction ----

    [Fact]
    public async Task Nominal_with_attribute_creates_a_third_number_field_after_the_two_relation_fields()
    {
        var result = await Handler().Handle(
            new CreateManyToManyRelationCommand(_employes.Id,
                new CreateManyToManyRelationRequest(_projets.Id, null, null, null, "Quantité")),
            CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error.Description);

        var fieldCommands = _sent.OfType<CreateCustomFieldCommand>().ToList();
        Assert.Equal(3, fieldCommands.Count);
        // Sequencing: entity, source link, target link, THEN the attribute (SortOrder = max + 1 ⇒ the
        // pair check on the first two RelationCustom is never displaced).
        Assert.Collection(_sent,
            c => Assert.IsType<CreateCustomEntityCommand>(c),
            c => Assert.IsType<CreateCustomFieldCommand>(c),
            c => Assert.IsType<CreateCustomFieldCommand>(c),
            c => Assert.IsType<CreateCustomFieldCommand>(c));

        var attribute = fieldCommands[2].Request;
        Assert.Equal(result.Value.Junction.Id, fieldCommands[2].EntityId);
        Assert.Equal(CustomFieldType.Number, attribute.FieldType);
        Assert.False(attribute.IsRequired);
        Assert.False(attribute.IsUnique);
        Assert.Null(attribute.Relation);
        Assert.Null(attribute.Options);
        Assert.Equal("Quantité", attribute.Label);

        Assert.Equal(3, result.Value.Junction.FieldCount);
        Assert.NotNull(result.Value.AttributeField);
        Assert.Equal(attribute.Key, result.Value.AttributeField!.Key);

        // Audit payload carries the attribute key.
        _audit.Verify(a => a.LogAsync(
                CreateManyToManyRelationCommandHandler.AuditAction, "CustomEntity", result.Value.Junction.Id, null,
                It.Is<object?>(o => o != null && o.ToString()!.Contains(attribute.Key)),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task Attribute_label_is_slugified_and_trimmed()
    {
        var result = await Handler().Handle(
            new CreateManyToManyRelationCommand(_employes.Id,
                new CreateManyToManyRelationRequest(_projets.Id, null, null, null, "  Quantité  ")),
            CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error.Description);
        var attribute = _sent.OfType<CreateCustomFieldCommand>().Last().Request;
        Assert.Equal("quantit", attribute.Key); // StudioKey.Slugify : accents → _, 8 car. conservés
        Assert.Equal("Quantité", attribute.Label);
    }

    [Theory]
    [InlineData("employes")]   // collision avec le champ de liaison source
    [InlineData("PROJETS")]    // collision avec le champ cible, casse ignorée par prudence
    [InlineData("!!!")]        // clé vide après slugification
    [InlineData("id")]         // clé réservée
    public async Task Invalid_attribute_key_is_rejected_before_any_write(string label)
    {
        var result = await Handler().Handle(
            new CreateManyToManyRelationCommand(_employes.Id,
                new CreateManyToManyRelationRequest(_projets.Id, null, null, null, label)),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("Validation.junctionAttributeLabel", result.Error.Code);
        Assert.Empty(_sent); // aucune écriture : pas de compensation pour une simple validation
        _audit.Verify(a => a.LogAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<Guid?>(), It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Attribute_field_failure_compensates_the_junction_and_returns_the_original_error()
    {
        var quotaError = Error.Validation("quota", "Limite du plan atteinte : nombre de champs.");
        var calls = 0;
        _mediator.Setup(m => m.Send(It.IsAny<CreateCustomFieldCommand>(), It.IsAny<CancellationToken>()))
            .Returns((CreateCustomFieldCommand c, CancellationToken _) =>
            {
                _sent.Add(c);
                calls++;
                return Task.FromResult(calls <= 2
                    ? Result.Success(FieldDto(c.Request, calls))
                    : Result.Failure<CustomFieldDto>(quotaError));
            });

        var result = await Handler().Handle(
            new CreateManyToManyRelationCommand(_employes.Id,
                new CreateManyToManyRelationRequest(_projets.Id, null, null, null, "Quantité")),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal(quotaError, result.Error);
        var delete = Assert.Single(_sent.OfType<DeleteCustomEntityCommand>());
        var captured = _capturedEntities.Single(e => e.Key == "employes_projets");
        Assert.Equal(captured.Id, delete.Id);
        _audit.Verify(a => a.LogAsync(CreateManyToManyRelationCommandHandler.AuditAction, It.IsAny<string>(), It.IsAny<Guid?>(), It.IsAny<object?>(), It.IsAny<object?>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Without_attribute_the_contract_is_unchanged()
    {
        foreach (var label in new string?[] { null, "", "   " })
        {
            _sent.Clear();
            var result = await Handler().Handle(
                new CreateManyToManyRelationCommand(_employes.Id,
                    new CreateManyToManyRelationRequest(_projets.Id, null, null, null, label)),
                CancellationToken.None);

            Assert.True(result.IsSuccess, result.Error.Description);
            Assert.Null(result.Value.AttributeField);
            Assert.Equal(2, result.Value.Junction.FieldCount);
            Assert.Equal(2, _sent.OfType<CreateCustomFieldCommand>().Count());
        }
    }

    private CreateManyToManyRelationCommandHandler Handler() => new(
        _entities.Object, _audit.Object, _currentUser.Object, _mediator.Object, _jsonIndex.Object);

    private void RegisterEntity(CustomEntityDefinition entity) =>
        _entities.Setup(r => r.GetByIdAsync(Tid, entity.Id, It.IsAny<CancellationToken>())).ReturnsAsync(entity);

    /// <summary>Deterministic junction id derived from the key so the compensation test can match it.</summary>
    private static CustomEntityDto EntityDto(CreateCustomEntityRequest req)
    {
        var bytes = System.Security.Cryptography.MD5.HashData(System.Text.Encoding.UTF8.GetBytes(req.Key));
        var id = new Guid(bytes);
        return new CustomEntityDto(id, req.Key, req.DisplayName, req.DisplayNamePlural ?? req.DisplayName, req.Icon, req.Description,
            true, 0, req.SystemId, DateTime.UtcNow, DateTime.UtcNow, req.Kind);
    }

    private static CustomFieldDto FieldDto(CreateCustomFieldRequest req, int sortOrder) =>
        new(Guid.NewGuid(), req.Key, req.Label, req.FieldType, req.IsRequired, req.IsUnique, sortOrder, req.Rules, req.Options, req.Relation, true);
}
