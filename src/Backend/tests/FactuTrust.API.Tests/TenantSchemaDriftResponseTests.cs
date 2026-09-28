using System.Reflection;
using System.Text.Json;
using FactuTrust.API.Middleware;
using FactuTrust.Application.Localization;
using FactuTrust.Application.DTOs;
using Microsoft.AspNetCore.Http;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace FactuTrust.API.Tests;

internal sealed class PassthroughMessageLocalizer : IMessageLocalizer
{
    public string Localize(string? message) => message ?? string.Empty;
}

/// <summary>
/// Une table ou une colonne du modèle EF absente de la base tenant ressortait en 500
/// <c>INTERNAL_ERROR</c> dès que l'erreur survenait sur un chemin de LECTURE : seul
/// <c>HandleDbUpdateException</c> (écritures) traduisait les codes SQL 207/208. C'est exactement ce
/// qu'a produit la dérive de <c>PayrollAccountingSettings.EmployeeAuxiliaryEnabled</c> à la
/// validation d'un cycle de paie — un message inexploitable pour l'utilisateur, et rien pour
/// distinguer la panne d'un bug applicatif en supervision.
///
/// <para>
/// Ces tests figent le nouveau contrat (503 + <c>TENANT_MIGRATION_FAILED</c>, le code que le client
/// sait déjà interpréter) ET la non-régression des chemins voisins : les écritures continuent de
/// passer par le mapping <c>DbUpdateException</c>, et les erreurs SQL non liées au schéma restent
/// des 500.
/// </para>
/// </summary>
public sealed class TenantSchemaDriftResponseTests
{
    private const string MissingColumnMessage = "Invalid column name 'EmployeeAuxiliaryEnabled'.";

    [Theory]
    [InlineData(207, "Invalid column name 'EmployeeAuxiliaryEnabled'.")]
    [InlineData(208, "Invalid object name 'PayrollAccountingSettings'.")]
    public async Task SchemaDriftOnReadPath_Returns503_WithTenantMigrationCode(int number, string message)
    {
        var (status, body) = await InvokeAsync(SqlExceptionTestFactory.Create(number, message), Environments.Production);

        Assert.Equal(StatusCodes.Status503ServiceUnavailable, status);
        Assert.Equal(ValidationErrorCodes.TenantMigrationFailed, body.Code);
        Assert.Contains("schéma de base de données", body.Message, StringComparison.OrdinalIgnoreCase);
        Assert.False(body.CanProceed);
    }

    [Fact]
    public async Task SchemaDriftInProduction_DoesNotLeakSqlDetail()
    {
        var (_, body) = await InvokeAsync(
            SqlExceptionTestFactory.Create(207, MissingColumnMessage), Environments.Production);

        Assert.DoesNotContain("EmployeeAuxiliaryEnabled", body.Message, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Invalid column name", body.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task SchemaDriftInDevelopment_AppendsSqlDetail()
    {
        var (_, body) = await InvokeAsync(
            SqlExceptionTestFactory.Create(207, MissingColumnMessage), Environments.Development);

        Assert.Contains("EmployeeAuxiliaryEnabled", body.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task SchemaDriftWrappedInInnerException_IsStillDetected()
    {
        // Le repli sur la configuration globale traverse plusieurs couches : la SqlException peut
        // remonter encapsulée sans jamais devenir une DbUpdateException.
        var wrapped = new Exception(
            "Échec de résolution du profil d'imputation",
            SqlExceptionTestFactory.Create(207, MissingColumnMessage));

        var (status, body) = await InvokeAsync(wrapped, Environments.Production);

        Assert.Equal(StatusCodes.Status503ServiceUnavailable, status);
        Assert.Equal(ValidationErrorCodes.TenantMigrationFailed, body.Code);
    }

    // ── Non-régression des chemins voisins ──────────────────────────────────────────────────

    [Fact]
    public async Task NonSchemaSqlError_StillReturns500()
    {
        // 2627 = violation d'unicité en lecture : rien à voir avec une migration en retard.
        var (status, body) = await InvokeAsync(
            SqlExceptionTestFactory.Create(2627, "Violation of UNIQUE KEY constraint."), Environments.Production);

        Assert.Equal(StatusCodes.Status500InternalServerError, status);
        Assert.Equal("INTERNAL_ERROR", body.Code);
    }

    [Fact]
    public async Task SchemaDriftOnWritePath_KeepsExistingDbUpdateMapping()
    {
        // Les écritures restent traitées par HandleDbUpdateException, évalué plus haut dans le
        // switch : 400 et message « schéma pas à jour », comportement inchangé.
        var dbUpdate = new DbUpdateException(
            "save failed",
            SqlExceptionTestFactory.Create(207, MissingColumnMessage));

        var (status, body) = await InvokeAsync(dbUpdate, Environments.Production);

        Assert.Equal(StatusCodes.Status400BadRequest, status);
        Assert.Equal(ValidationErrorCodes.InvalidState, body.Code);
    }

    private static async Task<(int Status, ValidationErrorResponse Body)> InvokeAsync(
        Exception thrown,
        string environmentName)
    {
        var middleware = new ExceptionHandlingMiddleware(
            _ => throw thrown,
            NullLogger<ExceptionHandlingMiddleware>.Instance,
            new StubHostEnvironment(environmentName),
            new PassthroughMessageLocalizer());

        var context = new DefaultHttpContext();
        context.Response.Body = new MemoryStream();

        await middleware.InvokeAsync(context);

        context.Response.Body.Seek(0, SeekOrigin.Begin);
        var json = await new StreamReader(context.Response.Body).ReadToEndAsync();
        var body = JsonSerializer.Deserialize<ValidationErrorResponse>(
            json,
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;

        return (context.Response.StatusCode, body);
    }

    private sealed class StubHostEnvironment : IHostEnvironment
    {
        public StubHostEnvironment(string environmentName) => EnvironmentName = environmentName;

        public string EnvironmentName { get; set; }
        public string ApplicationName { get; set; } = "FactuTrust.API.Tests";
        public string ContentRootPath { get; set; } = AppContext.BaseDirectory;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}

/// <summary>
/// <see cref="SqlException"/> n'expose aucun constructeur public. Jumeau de la fabrique de
/// <c>FactuTrust.Infrastructure.Tests.Common.SqlExceptionHelperTests</c> — les deux assemblages de
/// test ne partagent pas de projet d'utilitaires.
/// </summary>
internal static class SqlExceptionTestFactory
{
    public static SqlException Create(int number, string message)
    {
        var errorCollection = (SqlErrorCollection)Activator.CreateInstance(
            typeof(SqlErrorCollection),
            nonPublic: true)!;

        var error = (SqlError)Activator.CreateInstance(
            typeof(SqlError),
            BindingFlags.Instance | BindingFlags.NonPublic,
            binder: null,
            args: [number, (byte)2, (byte)0, string.Empty, message, string.Empty, 0, (uint)0, null],
            culture: null)!;

        typeof(SqlErrorCollection)
            .GetMethod("Add", BindingFlags.NonPublic | BindingFlags.Instance)!
            .Invoke(errorCollection, [error]);

        return (SqlException)Activator.CreateInstance(
            typeof(SqlException),
            BindingFlags.NonPublic | BindingFlags.Instance,
            binder: null,
            args: [message, errorCollection, null, Guid.NewGuid()],
            culture: null)!;
    }
}
