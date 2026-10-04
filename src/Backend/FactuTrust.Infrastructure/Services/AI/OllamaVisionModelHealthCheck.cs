using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Configuration;
using FactuTrust.Application.Features.AI;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Options;

namespace FactuTrust.Infrastructure.Services.AI;

/// <summary>
/// Contrôle de santé du modèle vision de l'import de relevés bancaires (GLM-OCR sur Ollama).
///
/// <para>Enregistré sous le nom <see cref="Name"/> avec le seul tag <c>ai</c> : il est donc
/// <b>absent</b> de <c>/health/ready</c> (le healthcheck Docker de l'API ne dépend pas d'Ollama et
/// un moteur IA arrêté ne doit jamais faire redémarrer l'API) et <b>visible</b> dans
/// <c>GET /api/platform/ops/health</c>, réservé aux administrateurs plateforme.</para>
///
/// <para>Sémantique :
/// <list type="bullet">
/// <item><see cref="HealthStatus.Unhealthy"/> — moteur IA injoignable, ou ni le modèle vision ni le
/// modèle texte de repli ne sont prêts : l'import de relevés annoncera l'IA indisponible.</item>
/// <item><see cref="HealthStatus.Degraded"/> — le vérificateur refuse le modèle vision des relevés
/// (non installé, mémoire insuffisante, modèle hors Ollama ou lecture vision désactivée) mais le
/// modèle texte de repli est prêt : lecture page par page par le modèle texte, signalée.</item>
/// <item><see cref="HealthStatus.Healthy"/> — modèle vision prêt.</item>
/// </list>
/// La description ne porte que des noms de modèles et le message du vérificateur, jamais une donnée
/// de relevé. Délai borné à <see cref="Timeout"/> ; s'appuie sur les caches du client Ollama
/// (<c>AvailabilityCacheSeconds</c>, <c>ModelListCacheSeconds</c>).</para>
/// </summary>
public sealed class OllamaVisionModelHealthCheck : IHealthCheck
{
    /// <summary>Nom d'enregistrement du contrôle (<c>Program.cs</c>, <c>smoke-test.sh</c>).</summary>
    public const string Name = "ollama-bank-statement-vision";

    /// <summary>Tag unique du contrôle : jamais <c>ready</c>.</summary>
    public const string Tag = "ai";

    /// <summary>Délai maximal d'une évaluation.</summary>
    public static readonly TimeSpan Timeout = TimeSpan.FromSeconds(5);

    private readonly IOllamaClient _ollamaClient;
    private readonly IOllamaModelReadinessChecker _readiness;
    private readonly IOptions<OllamaSettings> _ollamaSettings;
    private readonly IOptions<AccountingSettings> _accountingSettings;

    public OllamaVisionModelHealthCheck(
        IOllamaClient ollamaClient,
        IOllamaModelReadinessChecker readiness,
        IOptions<OllamaSettings> ollamaSettings,
        IOptions<AccountingSettings> accountingSettings)
    {
        _ollamaClient = ollamaClient;
        _readiness = readiness;
        _ollamaSettings = ollamaSettings;
        _accountingSettings = accountingSettings;
    }

    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutCts.CancelAfter(Timeout);

        try
        {
            var status = await EvaluateAsync(
                _ollamaClient,
                _readiness,
                _ollamaSettings.Value,
                _accountingSettings.Value.BankStatementImport,
                timeoutCts.Token);

            return new HealthCheckResult(status.Status, status.Description);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return new HealthCheckResult(
                context.Registration.FailureStatus,
                $"Le moteur IA n'a pas répondu en {Timeout.TotalSeconds:0} s : l'import de relevés annoncera l'IA indisponible.");
        }
        catch (Exception ex)
        {
            return new HealthCheckResult(
                context.Registration.FailureStatus,
                "Contrôle du modèle vision des relevés en erreur.",
                ex);
        }
    }

    /// <summary>
    /// Évaluation partagée avec <see cref="OllamaVisionModelStartupCheckHostedService"/> : une seule
    /// règle pour le démarrage et pour la santé. Ne lance pas d'exception métier (le vérificateur
    /// n'en lance pas) ; une annulation remonte telle quelle.
    /// </summary>
    public static async Task<OllamaVisionModelStatus> EvaluateAsync(
        IOllamaClient ollamaClient,
        IOllamaModelReadinessChecker readiness,
        OllamaSettings ollama,
        BankStatementImportLimits limits,
        CancellationToken cancellationToken)
    {
        var textModel = ImportAiModelResolver.ResolveServerImportModel(ollama).ProviderModelId;
        var visionId = ImportAiModelResolver.ResolveBankStatementVisionModelId(ollama);
        var visionRef = ModelRef.Parse(visionId);
        var visionModel = string.IsNullOrWhiteSpace(visionRef.ProviderModelId) ? null : visionRef.ProviderModelId;

        if (!await ollamaClient.IsAvailableAsync(cancellationToken))
        {
            return new OllamaVisionModelStatus(
                HealthStatus.Unhealthy,
                "Moteur IA InstaFact injoignable : l'import de relevés annoncera l'IA indisponible.",
                visionModel,
                textModel,
                EngineAvailable: false,
                VisionReady: false,
                TextFallbackReady: false);
        }

        var textReadiness = await readiness.CheckAsync(textModel, cancellationToken);
        var textNote = textReadiness.IsReady
            ? $"repli texte « {textModel} » prêt"
            : $"repli texte « {textModel} » non prêt ({Trim(textReadiness.UserMessage)})";

        if (!limits.VisionReadingEnabled)
        {
            return Fallback(
                $"Lecture vision désactivée (Accounting:BankStatementImport:VisionReadingEnabled=false) : moteur texte seulement ; {textNote}.",
                visionModel, textModel, textReadiness.IsReady);
        }

        if (visionModel is null)
        {
            return Fallback(
                $"Aucun modèle vision configuré pour les relevés (Ollama:BankStatementImportVisionModel, sinon InvoiceImportVisionModel) ; {textNote}.",
                visionModel, textModel, textReadiness.IsReady);
        }

        if (visionRef.Kind != LlmProviderKind.Ollama)
        {
            return Fallback(
                $"Modèle vision des relevés « {visionModel} » hors Ollama : la lecture vision n'est possible qu'avec le moteur local ; {textNote}.",
                visionModel, textModel, textReadiness.IsReady);
        }

        var visionReadiness = await readiness.CheckAsync(visionModel, cancellationToken);
        if (visionReadiness.IsReady)
        {
            return new OllamaVisionModelStatus(
                HealthStatus.Healthy,
                $"Modèle vision des relevés « {visionModel} » prêt ; {textNote}.",
                visionModel,
                textModel,
                EngineAvailable: true,
                VisionReady: true,
                TextFallbackReady: textReadiness.IsReady);
        }

        return Fallback(
            $"Modèle vision des relevés « {visionModel} » non prêt : {Trim(visionReadiness.UserMessage)} ; {textNote}.",
            visionModel, textModel, textReadiness.IsReady);
    }

    private static OllamaVisionModelStatus Fallback(string description, string? visionModel, string textModel, bool textReady) =>
        new(
            textReady ? HealthStatus.Degraded : HealthStatus.Unhealthy,
            textReady
                ? description + " Lecture page par page par le modèle texte, signalée."
                : description + " L'import de relevés annoncera l'IA indisponible.",
            visionModel,
            textModel,
            EngineAvailable: true,
            VisionReady: false,
            TextFallbackReady: textReady);

    private static string Trim(string? message)
    {
        var m = (message ?? "motif inconnu").Trim();
        return m.EndsWith('.') ? m[..^1] : m;
    }
}

/// <summary>Résultat de l'évaluation du modèle vision des relevés (démarrage et santé).</summary>
/// <param name="Status">Verdict de santé.</param>
/// <param name="Description">Texte pour l'opérateur : noms de modèles et message du vérificateur, jamais une donnée de relevé.</param>
/// <param name="VisionModel">Identifiant Ollama du modèle vision résolu (null si aucun).</param>
/// <param name="TextModel">Identifiant Ollama du modèle texte de repli (<c>InvoiceImportModel</c>).</param>
/// <param name="EngineAvailable">Le moteur Ollama répond.</param>
/// <param name="VisionReady">Le modèle vision est installé et chargeable.</param>
/// <param name="TextFallbackReady">Le modèle texte de repli est installé et chargeable.</param>
public sealed record OllamaVisionModelStatus(
    HealthStatus Status,
    string Description,
    string? VisionModel,
    string TextModel,
    bool EngineAvailable,
    bool VisionReady,
    bool TextFallbackReady);
