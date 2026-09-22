using System.Diagnostics;
using System.Globalization;
using System.Text.RegularExpressions;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Application.Features.AI;
using FactuTrust.Application.Features.AI.DTOs;
using FactuTrust.Domain.Enums;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;

namespace FactuTrust.Infrastructure.Services.AI;

public sealed class OllamaModelRecommender : IAiModelRecommender
{
    private const string RecommendationCacheKey = "factutrust:ai:recommendation";
    private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(5);

    private static readonly HashSet<string> ToolCallingFamilies = new(StringComparer.OrdinalIgnoreCase)
    {
        "qwen2", "qwen2.5", "qwen3",
        "llama3", "llama3.1", "llama3.2", "llama3.3",
        "mistral", "mixtral",
        "command-r", "command-r-plus",
        "phi3", "phi-3",
        "gemma2", "gemma3",
        "deepseek-v2", "deepseek-v3"
    };

    private readonly IOllamaClient _ollamaClient;
    private readonly IPlatformAiSettingsService _platformAiSettings;
    private readonly IAiEngineMemoryProbe _memoryProbe;
    private readonly IMemoryCache _cache;
    private readonly ILogger<OllamaModelRecommender> _logger;

    public OllamaModelRecommender(
        IOllamaClient ollamaClient,
        IPlatformAiSettingsService platformAiSettings,
        IAiEngineMemoryProbe memoryProbe,
        IMemoryCache cache,
        ILogger<OllamaModelRecommender> logger)
    {
        _ollamaClient = ollamaClient;
        _platformAiSettings = platformAiSettings;
        _memoryProbe = memoryProbe;
        _cache = cache;
        _logger = logger;
    }

    public void InvalidateCache() => _cache.Remove(RecommendationCacheKey);

    public async Task<AiModelRecommendationDto?> RecommendBestLocalModelAsync(
        CancellationToken cancellationToken = default)
    {
        if (_cache.TryGetValue(RecommendationCacheKey, out AiModelRecommendationDto? cached))
            return cached;

        var result = await ComputeRecommendationAsync(cancellationToken);

        _cache.Set(RecommendationCacheKey, result,
            new MemoryCacheEntryOptions { AbsoluteExpirationRelativeToNow = CacheTtl });

        return result;
    }

    private async Task<AiModelRecommendationDto?> ComputeRecommendationAsync(CancellationToken ct)
    {
        var sw = Stopwatch.StartNew();

        if (!await _ollamaClient.IsAvailableAsync(ct))
        {
            _logger.LogDebug("AI recommendation: Ollama not available");
            return null;
        }

        var installedModels = await _ollamaClient.ListModelsAsync(ct);
        if (installedModels.Count == 0)
        {
            _logger.LogDebug("AI recommendation: no models installed");
            return null;
        }

        var hardwareProfile = BuildHardwareProfile(
            await _memoryProbe.ReadAsync(ct),
            await _ollamaClient.ListRunningModelsAsync(ct));
        var inferenceDevice = await _platformAiSettings.GetInferenceDeviceAsync(ct);

        var candidates = new List<ScoredModel>();

        foreach (var model in installedModels)
        {
            if (!IsEligible(model, hardwareProfile))
                continue;

            var details = await _ollamaClient.ShowModelAsync(model.Name, ct);
            var score = ComputeScore(model, details, hardwareProfile, inferenceDevice);
            candidates.Add(new ScoredModel(model, details, score));
        }

        if (candidates.Count == 0)
        {
            _logger.LogInformation(
                "AI recommendation: no eligible model among {Count} installed (RAM={RamGb:F1}GB)",
                installedModels.Count,
                hardwareProfile.TotalRamBytes / (1024.0 * 1024 * 1024));
            return null;
        }

        candidates.Sort((a, b) => b.Score.Total.CompareTo(a.Score.Total));
        var best = candidates[0];

        var modelRef = $"{ModelRef.OllamaPrefix}{best.Model.Name}";
        var reason = BuildReason(best, hardwareProfile, inferenceDevice);

        _logger.LogInformation(
            "AI recommendation: selected {ModelRef} (score={Score}) in {ElapsedMs}ms from {CandidateCount}/{TotalCount} candidates",
            modelRef, best.Score.Total, sw.ElapsedMilliseconds, candidates.Count, installedModels.Count);

        return new AiModelRecommendationDto(
            modelRef,
            best.Model.Name,
            reason,
            new AiHardwareProfileDto(
                hardwareProfile.TotalRamBytes,
                hardwareProfile.AvailableRamBytes,
                hardwareProfile.CpuCores,
                hardwareProfile.Gpu));
    }

    private static AiHardwareSnapshot BuildHardwareProfile(
        AiEngineMemorySnapshot memory,
        OllamaProcessListResponse? runningModels)
    {
        // Mémoire du MOTEUR, et non celle de ce processus : voir IAiEngineMemoryProbe.
        var totalRam = memory.TotalBytes;
        var availableRam = memory.AvailableBytes;
        var cpuCores = Environment.ProcessorCount;

        AiGpuInfoDto? gpuInfo = null;
        long maxVram = 0;

        if (runningModels?.Models is { Count: > 0 })
        {
            foreach (var rm in runningModels.Models)
            {
                if (rm.SizeVram > maxVram)
                    maxVram = rm.SizeVram;
            }

            if (maxVram > 0)
            {
                gpuInfo = new AiGpuInfoDto(
                    Name: null,
                    VramBytes: maxVram,
                    IsAccelerated: true);
            }
        }

        return new AiHardwareSnapshot(
            totalRam, availableRam, cpuCores, gpuInfo, maxVram, memory.IsMeaningful);
    }

    private static bool IsEligible(OllamaModelInfo model, AiHardwareSnapshot hw)
    {
        if (model.Size <= 0)
            return true;

        // Sans mesure portant sur le moteur, écarter un modèle reviendrait à le juger sur la
        // mémoire d'un autre processus : on laisse passer, Ollama reste le juge du chargement.
        if (!hw.RamIsMeaningful)
            return true;

        var ramThreshold = (long)(hw.AvailableRamBytes * 0.7);
        var modelWithOverhead = (long)(model.Size * 1.3);

        return modelWithOverhead < ramThreshold;
    }

    private static ModelScore ComputeScore(
        OllamaModelInfo model,
        OllamaModelShowResponse? details,
        AiHardwareSnapshot hw,
        OllamaInferenceDevice inferenceDevice)
    {
        double paramScore = ComputeParameterScore(model, details, inferenceDevice);
        double toolScore = ComputeToolCallingScore(details);
        double quantScore = ComputeQuantizationScore(details);
        double recencyScore = ComputeRecencyScore(model);
        double gpuFitScore = inferenceDevice == OllamaInferenceDevice.CpuOnly
            ? 0
            : ComputeGpuFitScore(model, hw);

        var total = paramScore + toolScore + quantScore + recencyScore + gpuFitScore;

        return new ModelScore(total, paramScore, toolScore, quantScore, recencyScore, gpuFitScore);
    }

    /// <summary>
    /// Larger parameter counts get higher scores (up to 40 pts).
    /// Parses strings like "7B", "13B", "70B", "1.5B".
    /// </summary>
    private static double ComputeParameterScore(
        OllamaModelInfo model,
        OllamaModelShowResponse? details,
        OllamaInferenceDevice inferenceDevice)
    {
        var paramSize = details?.Details?.ParameterSize;
        var billions = ParseBillionCount(paramSize);

        if (billions <= 0)
        {
            var sizeGb = model.Size / (1024.0 * 1024 * 1024);
            billions = sizeGb switch
            {
                < 2 => 1,
                < 5 => 3,
                < 10 => 7,
                < 20 => 13,
                < 40 => 30,
                _ => 70
            };
        }

        if (inferenceDevice == OllamaInferenceDevice.CpuOnly)
        {
            return billions switch
            {
                <= 1 => 20,
                <= 3 => 35,
                <= 4 => 30,
                <= 7 => 12,
                <= 13 => 4,
                _ => 0
            };
        }

        return billions switch
        {
            <= 1 => 5,
            <= 3 => 12,
            <= 7 => 20,
            <= 8 => 24,
            <= 13 => 30,
            <= 34 => 35,
            _ => 40
        };
    }

    /// <summary>
    /// Models from families known to support tool calling get 30 bonus points.
    /// </summary>
    private static double ComputeToolCallingScore(OllamaModelShowResponse? details)
    {
        if (details?.Details is null)
            return 0;

        if (details.Details.Families is { Count: > 0 })
        {
            foreach (var family in details.Details.Families)
            {
                if (ToolCallingFamilies.Contains(family))
                    return 30;
            }
        }

        if (!string.IsNullOrEmpty(details.Details.Family) &&
            ToolCallingFamilies.Contains(details.Details.Family))
            return 30;

        return 0;
    }

    /// <summary>
    /// Higher quantization quality gets more points (up to 15).
    /// </summary>
    private static double ComputeQuantizationScore(OllamaModelShowResponse? details)
    {
        var quant = details?.Details?.QuantizationLevel;
        if (string.IsNullOrWhiteSpace(quant))
            return 5;

        var upper = quant.ToUpperInvariant();
        if (upper.Contains("F16") || upper.Contains("FP16"))
            return 15;
        if (upper.Contains("Q8"))
            return 14;
        if (upper.Contains("Q6"))
            return 12;
        if (upper.Contains("Q5"))
            return 10;
        if (upper.Contains("Q4_K_M"))
            return 9;
        if (upper.Contains("Q4_K_S"))
            return 8;
        if (upper.Contains("Q4"))
            return 7;
        if (upper.Contains("Q3"))
            return 5;
        if (upper.Contains("Q2"))
            return 3;

        return 5;
    }

    /// <summary>
    /// More recently modified models get a small bonus (up to 10 pts).
    /// </summary>
    private static double ComputeRecencyScore(OllamaModelInfo model)
    {
        var daysSinceModified = (DateTime.UtcNow - model.ModifiedAt).TotalDays;
        return daysSinceModified switch
        {
            < 7 => 10,
            < 30 => 8,
            < 90 => 6,
            < 180 => 4,
            _ => 2
        };
    }

    /// <summary>
    /// Models that fit entirely in detected VRAM get a 5-pt bonus.
    /// </summary>
    private static double ComputeGpuFitScore(OllamaModelInfo model, AiHardwareSnapshot hw)
    {
        if (hw.MaxVramBytes <= 0 || model.Size <= 0)
            return 0;

        return model.Size < (long)(hw.MaxVramBytes * 0.85) ? 5 : 0;
    }

    private static double ParseBillionCount(string? paramSize)
    {
        if (string.IsNullOrWhiteSpace(paramSize))
            return 0;

        var match = Regex.Match(paramSize, @"([\d.]+)\s*[Bb]", RegexOptions.None, TimeSpan.FromMilliseconds(100));
        if (!match.Success)
            return 0;

        if (double.TryParse(match.Groups[1].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var val))
            return val;

        return 0;
    }

    private static string BuildReason(
        ScoredModel best,
        AiHardwareSnapshot hw,
        OllamaInferenceDevice inferenceDevice)
    {
        var parts = new List<string>();

        if (inferenceDevice == OllamaInferenceDevice.CpuOnly)
            parts.Add("optimisé CPU");

        var paramSize = best.Details?.Details?.ParameterSize;
        if (!string.IsNullOrEmpty(paramSize))
            parts.Add($"{paramSize} paramètres");

        if (best.Score.ToolCallingScore > 0)
            parts.Add("support tool-calling");

        var quant = best.Details?.Details?.QuantizationLevel;
        if (!string.IsNullOrEmpty(quant))
            parts.Add(quant);

        if (best.Score.GpuFitScore > 0)
            parts.Add("compatible GPU");

        var ramGb = hw.TotalRamBytes / (1024.0 * 1024 * 1024);
        parts.Add($"RAM {ramGb:F0} Go");

        return $"Meilleur modèle local détecté : {string.Join(", ", parts)}";
    }

    private sealed record AiHardwareSnapshot(
        long TotalRamBytes,
        long AvailableRamBytes,
        int CpuCores,
        AiGpuInfoDto? Gpu,
        long MaxVramBytes,
        bool RamIsMeaningful);

    private sealed record ModelScore(
        double Total,
        double ParameterScore,
        double ToolCallingScore,
        double QuantizationScore,
        double RecencyScore,
        double GpuFitScore);

    private sealed record ScoredModel(
        OllamaModelInfo Model,
        OllamaModelShowResponse? Details,
        ModelScore Score);
}
