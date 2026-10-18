using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;

namespace FactuTrust.API.Tests;

// CI Windows / LocalDB : la suite d'intégration échouait par intermittence avec
// « TaskCanceledException ← HttpRequestException : Error while copying content to a stream
// ← The client aborted the request » (ResponseBodyReaderStream.CheckAborted). Cause : le
// délai par défaut de HttpClient (100 s) annule des requêtes lentes mais saines — le
// provisionnement d'une base tenant (création + migrations + seed) dépasse régulièrement
// 100 s sur le runner. Le serveur TestHost finissait son travail : seul le client renonçait.

/// <summary>
/// Factory de base des tests d'intégration : force les flags <c>Channels</c> à OFF, quel que soit
/// le contenu d'<c>appsettings.json</c> (qui peut être activé en dev). Garantit qu'aucun processus
/// Node (pont WhatsApp) n'est jamais lancé pendant <c>dotnet test</c>. La configuration in-memory
/// posée ici est ajoutée en dernier, donc prioritaire sur les fichiers appsettings.
/// </summary>
public class ChannelsDisabledWebApplicationFactory : WebApplicationFactory<Program>
{
    /// <summary>
    /// Clé de signature JWT réservée aux tests (les appsettings ne contiennent plus de clé).
    /// Doit être utilisée par les tests qui forgent des tokens (voir PlatformApiIntegrationTests).
    /// </summary>
    public const string TestJwtSecretKey = "FactuTrust-Tests-Only-Signing-Key-Not-A-Production-Secret-0123456789";

    /// <summary>
    /// Clé de signature électronique (HMAC) réservée aux tests (les appsettings ne contiennent
    /// plus de clé). Voir <see cref="Infrastructure.Services.SignatureService"/>.
    /// </summary>
    public const string TestSignatureSecretKey = "FactuTrust-Tests-Only-Signature-Key-Not-A-Production-Secret-0123456789";

    /// <summary>
    /// Délai d'expiration appliqué à tous les clients de test. Dix minutes : assez large pour
    /// le pire provisionnement LocalDB observé (~2 min), assez fini pour qu'un serveur
    /// réellement bloqué échoue au lieu de pendre indéfiniment la suite.
    /// </summary>
    public static readonly TimeSpan ClientTimeout = TimeSpan.FromMinutes(10);

    /// <summary>
    /// Applique <see cref="ClientTimeout"/> à un client créé par n'importe quelle factory
    /// (utile pour les factories dérivées via <c>WithWebHostBuilder</c>, typées en
    /// <see cref="WebApplicationFactory{TEntryPoint}"/> de base, qui ne passent pas par les
    /// surcharges <c>CreateClient</c> ci-dessous).
    /// </summary>
    public static HttpClient WithClientTimeout(HttpClient client)
    {
        client.Timeout = ClientTimeout;
        return client;
    }

    // Les overloads de base ne sont pas virtuels : on les masque (les points d'appel sont
    // tous typés en ChannelsDisabledWebApplicationFactory, le masquage suffit). Attention :
    // une factory obtenue par WithWebHostBuilder est typée WebApplicationFactory<Program> —
    // ses clients doivent passer par WithClientTimeout manuellement (voir les call sites
    // RegisterSectorConfigurationTests / RegisterSectorTemplateSqlTests).
    public new HttpClient CreateClient() => WithClientTimeout(base.CreateClient());

    public new HttpClient CreateClient(WebApplicationFactoryClientOptions options) =>
        WithClientTimeout(base.CreateClient(options));

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        // UseSetting est injecté dans la configuration initiale du WebApplicationBuilder :
        // indispensable pour les valeurs lues par Program.cs pendant la construction de l'hôte
        // (la clé JWT est capturée dans TokenValidationParameters à ce moment-là).
        builder.UseSetting("JwtSettings:SecretKey", TestJwtSecretKey);
        builder.UseSetting("SignatureSettings:SecretKey", TestSignatureSecretKey);

        builder.ConfigureAppConfiguration((_, config) =>
        {
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Channels:Enabled"] = "false",
                ["Channels:WhatsAppEnabled"] = "false",
                ["Channels:AutoStart"] = "false",
                ["JwtSettings:SecretKey"] = TestJwtSecretKey,
                ["SignatureSettings:SecretKey"] = TestSignatureSecretKey
            });
        });
    }
}
