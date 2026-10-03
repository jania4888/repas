using System.Text;
using FactuTrust.API.Authorization;
using FactuTrust.API.Middleware;
using FactuTrust.API.Services.Background;
using FactuTrust.API.Services.Channels;
using FactuTrust.Application;
using FactuTrust.Application.Common.Interfaces;
using FactuTrust.Application.Common.Interfaces.Services;
using FactuTrust.Domain.Constants;
using FactuTrust.Infrastructure;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Scripts;
using FactuTrust.Infrastructure.Services.Background;
using Hangfire;
using Hangfire.SqlServer;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Hosting;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using Serilog;
using System.Text.Json;
using System.Threading.RateLimiting;

var builder = WebApplication.CreateBuilder(args);

// Serilog configuration (Lot B5 — enrichers + Console + File via appsettings.json,
// Seq optionnel piloté par section "Seq:Enabled" pour observabilité prod).
var serilogConfig = new LoggerConfiguration()
    .ReadFrom.Configuration(builder.Configuration);

if (builder.Configuration.GetValue<bool>("Seq:Enabled"))
{
    var seqUrl = builder.Configuration["Seq:ServerUrl"] ?? "http://localhost:5341";
    var seqApiKey = builder.Configuration["Seq:ApiKey"];
    serilogConfig.WriteTo.Seq(seqUrl, apiKey: string.IsNullOrEmpty(seqApiKey) ? null : seqApiKey);
}

Log.Logger = serilogConfig.CreateLogger();
builder.Host.UseSerilog();

// Add services to the container
builder.Services.AddApplication();
builder.Services.AddInfrastructure(builder.Configuration);

// Product image storage: save under wwwroot so static files serve them
builder.Services.Configure<FactuTrust.Infrastructure.Services.ProductImageStorageOptions>(opts =>
{
    opts.BasePath = Path.Combine(builder.Environment.ContentRootPath ?? ".", "wwwroot");
});

// Studio attachment/signature storage: also under wwwroot (served by UseStaticFiles)
builder.Services.Configure<FactuTrust.Infrastructure.Services.Studio.StudioFileStorageOptions>(opts =>
{
    opts.BasePath = Path.Combine(builder.Environment.ContentRootPath ?? ".", "wwwroot");
});

// Identity configuration
builder.Services.AddIdentity<ApplicationUser, ApplicationRole>(options =>
{
    // Password policy
    options.Password.RequireDigit = true;
    options.Password.RequireLowercase = true;
    options.Password.RequireUppercase = true;
    options.Password.RequireNonAlphanumeric = true;
    options.Password.RequiredLength = 12;
    options.Password.RequiredUniqueChars = 4;

    // Lockout policy
    options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
    options.Lockout.MaxFailedAccessAttempts = 5;
    options.Lockout.AllowedForNewUsers = true;

    // User settings
    options.User.RequireUniqueEmail = true;
    options.SignIn.RequireConfirmedEmail = false; // Set to true in production
})
.AddEntityFrameworkStores<MasterDbContext>()
.AddDefaultTokenProviders();

// JWT Authentication
var jwtSettings = builder.Configuration.GetSection("JwtSettings");
var secretKey = jwtSettings["SecretKey"];
// Empreintes SHA-256 des anciennes clés versionnées dans le dépôt (appsettings.Development.json,
// à différentes dates) : considérées compromises, refusées dans tous les environnements
// (comparaison par hash pour ne pas réintroduire leur valeur ici).
var compromisedLegacyJwtKeySha256Values = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
{
    "11372469839bb660ecbdd20f1afa9106fcf54fc79cfb8706b77acf48f475a13b",
    "4babc7b4720f1122c95768126fce4f3dcd413f3f99684fe13d6bfe32ec1269a5",
};
if (string.IsNullOrWhiteSpace(secretKey))
    throw new InvalidOperationException(
        "La clé secrète JWT n'est pas configurée. Renseignez JwtSettings:SecretKey " +
        "(dotnet user-secrets en développement, variable d'environnement JwtSettings__SecretKey en production).");
var secretKeySha256 = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(secretKey)));
if (compromisedLegacyJwtKeySha256Values.Contains(secretKeySha256))
    throw new InvalidOperationException(
        "La clé JWT historique (exposée dans le dépôt) est refusée. Générez une nouvelle clé aléatoire d'au moins 32 octets.");
if (Encoding.UTF8.GetByteCount(secretKey) < 32)
    throw new InvalidOperationException("JwtSettings:SecretKey doit faire au moins 32 octets (256 bits).");

// Electronic signature key (SignatureService, CWE-327 remediation): validated here — eagerly,
// at startup — rather than relying solely on the SignatureService constructor check, because
// SignatureService is registered as Scoped and its constructor would otherwise only run (and
// only fail) lazily, the first time something in a request scope resolves it (i.e. the first
// invoice signature). Mirrors the JwtSettings fail-fast pattern above so a missing/too-short
// signature key is caught before the app starts serving traffic, not at first use.
var signatureSecretKey = builder.Configuration["SignatureSettings:SecretKey"];
if (string.IsNullOrWhiteSpace(signatureSecretKey))
    throw new InvalidOperationException(
        "La clé secrète de signature n'est pas configurée. Renseignez SignatureSettings:SecretKey " +
        "(dotnet user-secrets en développement, variable d'environnement SignatureSettings__SecretKey en production).");
if (Encoding.UTF8.GetByteCount(signatureSecretKey) < 32)
    throw new InvalidOperationException("SignatureSettings:SecretKey doit faire au moins 32 octets (256 bits).");

builder.Services.AddAuthentication(options =>
{
    options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
    options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
})
.AddJwtBearer(options =>
{
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuer = true,
        ValidateAudience = true,
        ValidateLifetime = true,
        ValidateIssuerSigningKey = true,
        ValidIssuer = jwtSettings["Issuer"],
        ValidAudience = jwtSettings["Audience"],
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secretKey)),
        ClockSkew = TimeSpan.Zero
    };

    // Révocation immédiate (plan §6 Phase 2.5) : signature/durée de vie/issuer/audience ne suffisent pas —
    // un rôle rétrogradé ou une désactivation doivent invalider l'access token courant sans attendre son
    // expiration naturelle (15 min). Vérifié à CHAQUE requête via ISecurityStampTokenValidator (lookup
    // base master adouci par un cache mémoire TTL <= 5 s, plan §6 Phase 2.5) ; ne s'applique qu'au scheme
    // JWT principal — le ticket 2FA (PlatformAuthController.GenerateTwoFactorTicket) porte une audience
    // différente et n'est jamais validé par ce handler.
    var requireSecurityStampClaim = builder.Configuration.GetValue<bool>("JwtSettings:RequireSecurityStampClaim");
    options.Events = new JwtBearerEvents
    {
        OnTokenValidated = async context =>
        {
            try
            {
                var userIdClaim = context.Principal?.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
                if (!Guid.TryParse(userIdClaim, out var userId))
                {
                    context.Fail("Utilisateur introuvable dans le token.");
                    return;
                }

                var securityStampClaim = context.Principal?.FindFirst(FactuTrust.Domain.Auth.AuthClaimTypes.SecurityStamp)?.Value;
                var validator = context.HttpContext.RequestServices.GetRequiredService<ISecurityStampTokenValidator>();
                var isValid = await validator.IsValidAsync(
                    userId, securityStampClaim, requireSecurityStampClaim, context.HttpContext.RequestAborted);

                if (!isValid)
                    context.Fail("Accès révoqué : rôle ou statut du compte modifié. Reconnectez-vous.");
            }
            catch (Exception ex)
            {
                Log.Error(ex, "JWT bearer token validation failed. TraceId: {TraceId}", context.HttpContext.TraceIdentifier);
                // Fail-closed explicite (plan §6 Phase 2.5) : base master injoignable, timeout, erreur
                // cache -> on rejette toujours, jamais de "laisser passer" sur erreur.
                context.Fail("Impossible de vérifier la session (service indisponible).");
            }
        }
    };
});

builder.Services.AddAuthorization(options =>
{
    // Lot B1 — porte d'entrée plateforme : accepte n'importe lequel des 5 rôles plateforme.
    // Rétro-compat : les contrôleurs existants annotés [Authorize(Policy = PlatformAdmin)]
    // continuent à fonctionner pour les utilisateurs PlatformAdmin / BillingAdmin / SupportAgent /
    // MigrationOperator / ReadOnlyAuditor.
    options.AddPolicy(PlatformPolicies.PlatformAdmin, policy =>
        policy.RequireRole(FactuTrust.Domain.Auth.PlatformRoles.All.ToArray()));

    // Policies par rôle exact — pour actions critiques nécessitant un rôle spécifique
    // (ex: gestion des admins → SuperAdmin uniquement).
    options.AddPolicy(PlatformPolicies.SuperAdminOnly, policy =>
        policy.RequireRole(FactuTrust.Domain.Auth.PlatformRoles.PlatformAdmin));
    options.AddPolicy(PlatformPolicies.BillingAdminOnly, policy =>
        policy.RequireRole(FactuTrust.Domain.Auth.PlatformRoles.BillingAdmin));
    options.AddPolicy(PlatformPolicies.SupportAgentOnly, policy =>
        policy.RequireRole(FactuTrust.Domain.Auth.PlatformRoles.SupportAgent));
    options.AddPolicy(PlatformPolicies.MigrationOperatorOnly, policy =>
        policy.RequireRole(FactuTrust.Domain.Auth.PlatformRoles.MigrationOperator));
    options.AddPolicy(PlatformPolicies.ReadOnlyAuditorOnly, policy =>
        policy.RequireRole(FactuTrust.Domain.Auth.PlatformRoles.ReadOnlyAuditor));

    options.AddPolicy(PermissionPolicies.FirmDelegatedContext, policy =>
        policy.RequireAuthenticatedUser()
            .AddRequirements(new FirmDelegatedContextRequirement()));

    options.AddPolicy(PermissionPolicies.PayrollFirmOperation, policy =>
        policy.RequireAuthenticatedUser()
            .AddRequirements(new PayrollFirmOperationRequirement()));
});
builder.Services.AddSingleton<IAuthorizationPolicyProvider, PermissionPolicyProvider>();
builder.Services.AddScoped<IAuthorizationHandler, PermissionAuthorizationHandler>();
builder.Services.AddScoped<IAuthorizationHandler, FirmDelegatedContextAuthorizationHandler>();
builder.Services.AddScoped<IAuthorizationHandler, PayrollFirmOperationAuthorizationHandler>();

var isDevelopment = builder.Environment.IsDevelopment();

// Rate Limiting (seuils plus souples en développement pour éviter 429 lors des tests UI)
builder.Services.AddRateLimiter(options =>
{
    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context =>
        RateLimitPartition.GetFixedWindowLimiter(
            context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = isDevelopment ? 2000 : 200,
                Window = TimeSpan.FromMinutes(1)
            }));

    options.AddPolicy("login", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = isDevelopment ? 50 : 5,
                Window = TimeSpan.FromMinutes(1)
            }));

    options.AddPolicy("user-preferences", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            context.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value
            ?? context.Connection.RemoteIpAddress?.ToString()
            ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = isDevelopment ? 100 : 20,
                Window = TimeSpan.FromMinutes(1)
            }));

    // L'inscription anonyme provisionne une base SQL complète : limite stricte par IP.
    options.AddPolicy("register", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = isDevelopment ? 100 : 3,
                Window = TimeSpan.FromHours(1)
            }));

    options.AddPolicy("platform-tenant-create", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            context.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value
            ?? context.Connection.RemoteIpAddress?.ToString()
            ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = isDevelopment ? 100 : 10,
                Window = TimeSpan.FromMinutes(1)
            }));

    // Reprise de provisionnement : operation lourde (DROP + CREATE + migrations) et rare.
    // Plafond volontairement bas, partitionne par operateur.
    options.AddPolicy("platform-tenant-retry", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            context.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value
            ?? context.Connection.RemoteIpAddress?.ToString()
            ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = isDevelopment ? 50 : 3,
                Window = TimeSpan.FromMinutes(1)
            }));

    options.AddPolicy("password-reset", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = isDevelopment ? 30 : 3,
                Window = TimeSpan.FromMinutes(15)
            }));

    options.AddPolicy("email-verification", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = isDevelopment ? 30 : 3,
                Window = TimeSpan.FromMinutes(15)
            }));

    options.AddPolicy("ai", context =>
    {
        // Quota par utilisateur authentifié (repli sur l'IP pour l'anonyme) : évite que plusieurs
        // comptes derrière une même IP partagent — et saturent — le même quota « ai ».
        var userId = context.User?.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        var partitionKey = string.IsNullOrEmpty(userId)
            ? $"ip:{context.Connection.RemoteIpAddress?.ToString() ?? "unknown"}"
            : $"user:{userId}";
        return RateLimitPartition.GetFixedWindowLimiter(
            partitionKey,
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = isDevelopment ? 100 : 20,
                Window = TimeSpan.FromMinutes(1)
            });
    });

    options.AddPolicy("public-street-read", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = isDevelopment ? 2000 : 60,
                Window = TimeSpan.FromMinutes(1)
            }));

    options.AddPolicy("public-street-write", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = isDevelopment ? 200 : 5,
                Window = TimeSpan.FromMinutes(1)
            }));

    // Catalogue sectoriel public (wizard d'inscription) — donnée statique, lisible seule.
    options.AddPolicy("public-catalog", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = isDevelopment ? 2000 : 60,
                Window = TimeSpan.FromMinutes(1)
            }));

    // Lot C — demande de contact anonyme : 5 envois / heure / IP en production (un humain n'en
    // fait pas plus), QueueLimit = 0 → rejet immédiat en 429 avec Retry-After. Le GlobalLimiter
    // (par IP, par minute) reste actif en amont ; le plafond global est la garde D7 du handler.
    options.AddPolicy("public-contact", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = isDevelopment ? 100 : 5,
                Window = TimeSpan.FromHours(1),
                QueueLimit = 0
            }));

    options.AddPolicy("company-support-write", context =>
    {
        var userId = context.User?.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        var partitionKey = string.IsNullOrEmpty(userId)
            ? $"ip:{context.Connection.RemoteIpAddress?.ToString() ?? "unknown"}"
            : $"user:{userId}";
        return RateLimitPartition.GetFixedWindowLimiter(
            partitionKey,
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = isDevelopment ? 200 : 30,
                Window = TimeSpan.FromHours(1),
                QueueLimit = 0
            });
    });

    options.AddPolicy("labels", context =>
    {
        // Partition par utilisateur authentifié, comme « ai » : une planche d'étiquettes est
        // un rendu PDF de plusieurs centaines de symboles vectoriels, donc coûteux. Le quota
        // vise le clic répété sur « Imprimer », pas un abus.
        var userId = context.User?.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        var partitionKey = string.IsNullOrEmpty(userId)
            ? $"ip:{context.Connection.RemoteIpAddress?.ToString() ?? "unknown"}"
            : $"user:{userId}";
        return RateLimitPartition.GetFixedWindowLimiter(
            partitionKey,
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = isDevelopment ? 60 : 10,
                Window = TimeSpan.FromMinutes(1)
            });
    });

    options.OnRejected = async (context, _) =>
    {
        context.HttpContext.Response.StatusCode = StatusCodes.Status429TooManyRequests;
        context.HttpContext.Response.ContentType = "application/json";
        // Comportement HTTP standard, toutes politiques : temps restant avant la prochaine fenêtre
        // (FixedWindowRateLimiter fournit la métadonnée sur un bail refusé ; sinon pas d'en-tête).
        if (context.Lease.TryGetMetadata(System.Threading.RateLimiting.MetadataName.RetryAfter, out var retryAfter))
        {
            context.HttpContext.Response.Headers.RetryAfter =
                Math.Max(1, (int)Math.Ceiling(retryAfter.TotalSeconds)).ToString(System.Globalization.CultureInfo.InvariantCulture);
        }

        // Réponse écrite hors MVC : ni LocalizeApiResponseFilter ni ExceptionHandlingMiddleware ne la voient.
        // UiLanguageMiddleware s'exécute avant le limiteur : le localiseur connaît déjà la langue de l'interface.
        var localizer = context.HttpContext.RequestServices
            .GetService<FactuTrust.Application.Localization.IMessageLocalizer>();
        string Localize(string text) => localizer?.Localize(text) ?? text;
        var response = System.Text.Json.JsonSerializer.Serialize(new
        {
            success = false,
            code = FactuTrust.Application.DTOs.ValidationErrorCodes.RateLimitExceeded,
            message = Localize("Trop de requêtes. Veuillez réessayer plus tard."),
            errors = new[] { Localize("Trop de requêtes. Veuillez patienter avant de réessayer.") }
        });
        
        await context.HttpContext.Response.WriteAsync(response);
    };
});

// HSTS (consommé par app.UseHsts() hors développement)
builder.Services.AddHsts(options =>
{
    options.MaxAge = TimeSpan.FromDays(180);
    options.IncludeSubDomains = true;
});

// CORS
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAngular", policy =>
    {
        policy.WithOrigins(
                builder.Configuration["AllowedOrigins"]?.Split(',') ?? new[] { "http://localhost:4200" })
            .AllowAnyMethod()
            .AllowAnyHeader()
            .WithExposedHeaders(
                "X-Trace-Id",
                "X-Export-Id",
                "X-Export-Slides",
                "X-Export-Expires",
                "X-Export-Download-Url",
                "Content-Disposition")
            .AllowCredentials();
    });
});

// Controllers with JSON options
builder.Services.AddControllers(options =>
{
    options.Filters.Add<FactuTrust.API.Filters.LocalizeApiResponseFilter>();
})
    .AddJsonOptions(options =>
    {
        // Property names follow camelCase for TypeScript ergonomics (e.g. "totalAmount", "issueDate").
        options.JsonSerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
        options.JsonSerializerOptions.WriteIndented = false;
        // Enum VALUES are serialised verbatim (PascalCase) so they match their C# names.
        // This is what every Angular template / TypeScript switch already compares against
        // (e.g. status === 'Draft', DeliveryNoteStatus.Draft = 'Draft').
        // Forcing CamelCase here breaks every status-conditional UI and was the silent root cause
        // of the missing Validate / Confirm buttons.
        options.JsonSerializerOptions.Converters.Add(
            new System.Text.Json.Serialization.JsonStringEnumConverter());
    });

// Swagger
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new OpenApiInfo
    {
        Title = $"{BrandConstants.Name} API",
        Version = "v1",
        Description = "API de facturation électronique tunisienne"
    });

    c.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Description = "JWT Authorization header using the Bearer scheme. Enter 'Bearer' [space] and then your token.",
        Name = "Authorization",
        In = ParameterLocation.Header,
        Type = SecuritySchemeType.ApiKey,
        Scheme = "Bearer"
    });

    c.AddSecurityRequirement(new OpenApiSecurityRequirement
    {
        {
            new OpenApiSecurityScheme
            {
                Reference = new OpenApiReference
                {
                    Type = ReferenceType.SecurityScheme,
                    Id = "Bearer"
                }
            },
            Array.Empty<string>()
        }
    });
});

// Health Checks (Lot B5 — enriched with named tags for filtering).
// AddSqlServer fait le job complet : test de connexion + ping. Ajouter
// AddDbContextCheck<MasterDbContext> serait redondant et exigerait le NuGet
// Microsoft.Extensions.Diagnostics.HealthChecks.EntityFrameworkCore.
builder.Services.AddHealthChecks()
    .AddSqlServer(
        builder.Configuration.GetConnectionString("MasterConnection")!,
        name: "master-db",
        tags: new[] { "ready", "db" });

// Lot B5 — Hangfire (recurring + queued background jobs).
// Storage : table dans la base master, schéma "hangfire" pour isolation visuelle.
builder.Services.AddHangfire(config =>
{
    config
        .SetDataCompatibilityLevel(CompatibilityLevel.Version_180)
        .UseSimpleAssemblyNameTypeSerializer()
        .UseRecommendedSerializerSettings()
        .UseSqlServerStorage(
            builder.Configuration.GetConnectionString("MasterConnection")!,
            new SqlServerStorageOptions
            {
                CommandBatchMaxTimeout = TimeSpan.FromMinutes(5),
                SlidingInvisibilityTimeout = TimeSpan.FromMinutes(5),
                QueuePollInterval = TimeSpan.Zero,
                UseRecommendedIsolationLevel = true,
                DisableGlobalLocks = true,
                SchemaName = "hangfire"
            });
});

builder.Services.AddHangfireServer(options =>
{
    options.WorkerCount = Math.Max(2, Environment.ProcessorCount);
    options.Queues = new[] { "default", "critical", "low" };
    options.ServerName = $"factutrust-{Environment.MachineName}";
});

// Enregistrement résilient des jobs récurrents : déplacé hors du pipeline de démarrage
// synchrone pour qu'une indisponibilité momentanée de Hangfire / SQL Server / LocalDB
// ne crashe plus l'API au boot. Voir HangfireRecurringJobsRegistrationService.
builder.Services.AddHostedService<HangfireRecurringJobsRegistrationService>();

// Lot B5 — Demo job for Hangfire (cleanup old FailedLoginAttempts > 90 days).
builder.Services.AddScoped<CleanupOldFailedLoginAttemptsJob>();

// HttpContext accessor for current user
builder.Services.AddHttpContextAccessor();
// ICurrentUser = décorateur canal : identité HTTP historique, sauf pendant un traitement de canal
// (WhatsApp) où l'instantané ChannelUserContext (AsyncLocal) est servi. Chemin web inchangé.
builder.Services.AddScoped<FactuTrust.API.Services.CurrentUser>();
builder.Services.AddScoped<FactuTrust.Application.Common.Interfaces.ICurrentUser, FactuTrust.API.Services.ChannelAwareCurrentUser>();
builder.Services.AddScoped<ChannelInboundOrchestrator>();

// Pont WhatsApp (processus Node enfant piloté par l'API). Singleton = session unique.
// Le hosted service ne démarre le pont que si les flags sont ON + AutoStart (inerte en tests).
builder.Services.AddSingleton<FactuTrust.API.Services.Channels.WhatsAppBridgeHost>();
builder.Services.AddSingleton<FactuTrust.Application.Common.Interfaces.Services.IWhatsAppBridge>(
    sp => sp.GetRequiredService<FactuTrust.API.Services.Channels.WhatsAppBridgeHost>());
builder.Services.AddHostedService<FactuTrust.API.Services.Channels.WhatsAppBridgeHostedService>();
builder.Services.AddScoped<FactuTrust.Application.Common.Interfaces.Services.IChannelOutboundSender,
    FactuTrust.API.Services.Channels.WhatsAppBridgeOutboundSender>();

var forwardedHeadersEnabled = builder.Configuration.GetValue<bool>("ASPNETCORE_FORWARDEDHEADERS_ENABLED");
if (forwardedHeadersEnabled)
{
    builder.Services.Configure<ForwardedHeadersOptions>(options =>
    {
        options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
        options.KnownNetworks.Clear();
        options.KnownProxies.Clear();
    });
}

var app = builder.Build();

// Configure the HTTP request pipeline

app.UseMiddleware<UiLanguageMiddleware>();
app.UseMiddleware<ExceptionHandlingMiddleware>();

// Swagger (development only) - before security headers to avoid CSP blocking
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI(c =>
    {
        c.SwaggerEndpoint("/swagger/v1/swagger.json", $"{BrandConstants.Name} API v1");
        c.RoutePrefix = "swagger";
    });
}

// Security Headers (skip for Swagger in development)
app.Use(async (context, next) =>
{
    // Skip CSP for Swagger UI in development
    var path = context.Request.Path.Value?.ToLower() ?? "";
    var isSwaggerPath = path.StartsWith("/swagger");
    
    context.Response.Headers.Append("X-Content-Type-Options", "nosniff");
    context.Response.Headers.Append("X-Frame-Options", "DENY");
    context.Response.Headers.Append("X-XSS-Protection", "1; mode=block");
    context.Response.Headers.Append("Referrer-Policy", "strict-origin-when-cross-origin");
    
    if (!isSwaggerPath || !app.Environment.IsDevelopment())
    {
        context.Response.Headers.Append("Content-Security-Policy", 
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;");
    }
    
    await next();
});

// HSTS (hors développement) : protège la redirection HTTPS du stripping au premier contact.
if (!app.Environment.IsDevelopment())
{
    app.UseHsts();
}

// Derrière Nginx (TLS terminé en amont) : respecter X-Forwarded-Proto et ne pas forcer
// une redirection HTTPS interne sur Kestrel HTTP.
if (forwardedHeadersEnabled)
{
    app.UseForwardedHeaders();
}
else
{
    app.UseHttpsRedirection();
}

// Static files (e.g. product images under wwwroot/uploads).
// EXCEPTION : les fichiers Studio (pièces jointes / signatures) ne sont jamais servis statiquement —
// ils contiennent des données tenant et exigent le téléchargement authentifié
// (GET api/studio/records/{entityKey}/files/{fileName}, contrôle du tenant via le contexte).
// 404 (et non 401) pour ne pas révéler l'existence du fichier.
app.Use(async (context, next) =>
{
    var path = context.Request.Path;
    if (path.StartsWithSegments("/uploads/tenants", StringComparison.OrdinalIgnoreCase)
        && (path.Value?.Contains("/studio/", StringComparison.OrdinalIgnoreCase) ?? false))
    {
        context.Response.StatusCode = StatusCodes.Status404NotFound;
        return;
    }
    await next();
});
app.UseStaticFiles();

// CORS
app.UseCors("AllowAngular");

// Authentication & Authorization
app.UseAuthentication();
app.UseAuthorization();

// Rate limiting — placé APRÈS l'authentification pour que la politique « ai » puisse partitionner
// le quota par utilisateur authentifié (et non par IP partagée, ce qui pénalisait plusieurs comptes
// derrière une même IP). Les endpoints anonymes (login, vitrine publique) retombent sur l'IP.
// Le routage (implicite) a déjà résolu l'endpoint : les métadonnées [EnableRateLimiting] restent dispo.
app.UseRateLimiter();

// Tenant resolution middleware
app.UseMiddleware<TenantMiddleware>();
app.UseMiddleware<DenyStaffApiForPortalUsersMiddleware>();
app.UseMiddleware<DelegatedAccessMiddleware>();

// Health checks (Lot B5 — séparation live/ready)
//   /health        → simple liveness (la process répond, sans toucher BD ni Hangfire).
//   /health/ready  → vérifie les dépendances (BD master, EF context) — utilisé par K8s readiness.
app.MapHealthChecks("/health", new HealthCheckOptions
{
    Predicate = _ => false, // aucun check, juste 200 si l'app répond
    AllowCachingResponses = false
});

app.MapHealthChecks("/health/ready", new HealthCheckOptions
{
    Predicate = check => check.Tags.Contains("ready"),
    AllowCachingResponses = false,
    ResponseWriter = WriteHealthCheckResponse
});

// Lot B5 — Hangfire dashboard (path /hangfire, protégé par filter custom).
app.UseHangfireDashboard("/hangfire", new DashboardOptions
{
    Authorization = new[] { new HangfireDashboardAuthFilter(app.Environment) },
    DashboardTitle = $"{BrandConstants.Name} — Background Jobs",
    DisplayStorageConnectionString = false,
    StatsPollingInterval = 5000
});

// Controllers
app.MapControllers();

// Drapeaux d'ouverture consignes au demarrage : ce qui est ouvert au public doit etre lisible
// dans les logs de boot, sans avoir a interroger l'API ni deviner quel appsettings a gagne.
{
    var featureLogger = app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("Startup.Features");
    var publicRegistration = app.Services.GetRequiredService<IPublicRegistrationFeature>();
    var accountingFirms = app.Services.GetRequiredService<IAccountingFirmsFeature>();

    featureLogger.LogInformation(
        "Effective feature flags: PublicRegistration.Company={CompanyEnabled} PublicRegistration.Firm={FirmEnabled} AccountingFirms={AccountingFirmsEnabled} Environment={Environment}",
        publicRegistration.IsCompanyEnabled,
        publicRegistration.IsFirmEnabled,
        accountingFirms.IsEnabled,
        app.Environment.EnvironmentName);

    // Lot C — formulaire de contact public (aucun secret journalisé, seulement des booléens/compteurs).
    var publicContact = app.Services.GetRequiredService<Microsoft.Extensions.Options.IOptions<FactuTrust.Application.Configuration.PublicContactOptions>>().Value;
    featureLogger.LogInformation(
        "Effective feature flags: PublicContact.Enabled={PublicContactEnabled} PublicContact.RequireCaptcha={PublicContactRequireCaptcha} PublicContact.Recipients={PublicContactRecipients}",
        publicContact.Enabled,
        publicContact.RequireCaptcha,
        publicContact.RecipientEmails.Length);
    if (publicContact.Enabled && publicContact.RecipientEmails.Length == 0)
    {
        featureLogger.LogWarning(
            "Features:PublicContact:Enabled=true sans RecipientEmails : les demandes sont enregistrées en base mais personne n'est notifié.");
    }
    if (publicContact.RequireCaptcha
        && (string.IsNullOrWhiteSpace(publicContact.TurnstileSecretKey) || publicContact.TurnstileAllowedHostnames.Length == 0))
    {
        featureLogger.LogWarning(
            "Features:PublicContact:RequireCaptcha=true sans TurnstileSecretKey/TurnstileAllowedHostnames : toutes les soumissions seront refusées (fail-closed).");
    }

    // Import IA de relevés bancaires : drapeaux OFF par défaut. La génération exige le brouillard
    // (fail-closed) : drapeau ON sans brouillard = analyse possible, génération toujours refusée.
    var accountingSettings = app.Services.GetRequiredService<Microsoft.Extensions.Options.IOptions<FactuTrust.Application.Configuration.AccountingSettings>>().Value;
    featureLogger.LogInformation(
        "Effective feature flags: Accounting.BankStatementAiPosting={BankStatementAiPostingEnabled} Accounting.BankStatementAiForAllDocuments={BankStatementAiForAllDocumentsEnabled} Accounting.BankReconciliationMatchingV2={BankReconciliationMatchingV2Enabled} Accounting.Brouillard={BrouillardEnabled} Accounting.BankStatementLayoutParser={BankStatementLayoutParserEnabled} Accounting.BankStatementPreviewTimeoutSeconds={BankStatementPreviewTimeoutSeconds}",
        accountingSettings.BankStatementAiPostingEnabled,
        accountingSettings.BankStatementAiForAllDocumentsEnabled,
        accountingSettings.BankReconciliationMatchingV2Enabled,
        accountingSettings.BrouillardEnabled,
        accountingSettings.BankStatementLayoutParserEnabled,
        accountingSettings.BankStatementPreviewTimeoutSeconds);
    if (accountingSettings.BankStatementAiForAllDocumentsEnabled && !accountingSettings.BankStatementAiPostingEnabled)
    {
        featureLogger.LogWarning(
            "Accounting:BankStatementAiForAllDocumentsEnabled=true sans BankStatementAiPostingEnabled : sans effet, l'assistant de rapprochement garde son aperçu PDF historique.");
    }
    if (accountingSettings.BankStatementAiPostingEnabled && !accountingSettings.BrouillardEnabled)
    {
        featureLogger.LogWarning(
            "Accounting:BankStatementAiPostingEnabled=true sans BrouillardEnabled : les relevés peuvent être analysés mais aucune écriture ne sera générée (brouillard obligatoire).");
    }
}

// Note : l'enregistrement des jobs récurrents Hangfire (anciennement ici, en inline) est
// désormais effectué de manière résiliente par HangfireRecurringJobsRegistrationService
// (hosted service avec back-off). Voir builder.Services.AddHostedService<>() plus haut.

// Ensure database is created and migrated
using (var scope = app.Services.CreateScope())
{
    var context = scope.ServiceProvider.GetRequiredService<MasterDbContext>();
    var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();
    
    try
    {
        logger.LogInformation("Checking database connection and applying migrations...");
        
        // Ensure database exists
        var canConnect = await context.Database.CanConnectAsync();
        if (!canConnect)
        {
            logger.LogWarning("Database does not exist. It will be created on first migration.");
        }
        
        // Get pending migrations
        var pendingMigrations = await context.Database.GetPendingMigrationsAsync();
        if (pendingMigrations.Any())
        {
            logger.LogInformation("Applying {Count} pending migration(s)...", pendingMigrations.Count());
            foreach (var migration in pendingMigrations)
            {
                logger.LogInformation("  - {Migration}", migration);
            }
        }
        else
        {
            logger.LogInformation("Database is up to date. No pending migrations.");
        }
        
        // Apply migrations (creates database if it doesn't exist)
        await context.Database.MigrateAsync();
        logger.LogInformation("Database migration completed successfully.");

        // Seed initial data (roles, etc.)
        try
        {
            logger.LogInformation("Seeding initial data...");
            await DatabaseSeeder.SeedRolesAsync(scope.ServiceProvider);
            var configuration = scope.ServiceProvider.GetRequiredService<IConfiguration>();
            // Bootstrap:PlatformAdmin (user-secrets or env) creates the first /api/platform/auth/login operator.
            await DatabaseSeeder.SeedPlatformAdminAsync(scope.ServiceProvider, configuration);

            // Lot C1 — Seed des 3 plans initiaux (Free / Monthly / Annual) idempotent.
            await FactuTrust.Infrastructure.Persistence.Seeds.PlanSeeder.SeedAsync(context);

            await DatabaseSeeder.SeedFiscalCalendarRulesAsync(context);

            // Phase 2 — moteur de règles sectorielles en base (plan §WP-B3). Review R2: this now
            // reconciles on EVERY boot, not just the very first one against an empty master DB —
            // an existing deployment whose catalog drifted (new segment/dependency/template, or a
            // template payload refresh) since its last seed run converges automatically instead of
            // silently running with a stale rule set until an admin hits the force-seed endpoint.
            // No-ops (besides a cheap hash comparison) once the catalog hash already matches the
            // stamp recorded by the last seed/reconcile run.
            await FactuTrust.Infrastructure.Persistence.Seeds.SectorRuleSeeder.ReconcileOnStartupAsync(context, logger);

            logger.LogInformation("Database seeding completed successfully.");
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "FATAL: Database seeding failed (Roles/PlatformAdmin/Plans). Some features may not work correctly.");
            if (app.Environment.IsDevelopment())
            {
                // En dev : on stoppe pour qu'un développeur corrige immédiatement (sinon la table Plans
                // peut rester vide et le front affichera « Aucun plan correspondant »).
                throw;
            }
            // En prod : on continue pour éviter un downtime, mais le monitoring doit alerter sur ce log.
        }

        var hostEnvironment = scope.ServiceProvider.GetRequiredService<IHostEnvironment>();
        await DatabaseSeeder.WarnIfNoPlatformOperatorInDevelopmentAsync(scope.ServiceProvider, hostEnvironment, logger);

        // Apply migrations to existing tenant databases (if configured)
        var applyTenantMigrations = builder.Configuration.GetValue<bool>("TenantMigrations:ApplyOnStartup", false);
        var applyOnlyToMissing = builder.Configuration.GetValue<bool>("TenantMigrations:ApplyOnlyToMissingMigrations", true);

        if (applyTenantMigrations)
        {
            try
            {
                logger.LogInformation("Applying migrations to existing tenant databases...");
                
                if (applyOnlyToMissing)
                {
                    // Apply to tenants with pending migrations (HasMigrationsAppliedAsync == false)
                    var tenantService = scope.ServiceProvider.GetRequiredService<ITenantService>();
                    var masterContext = scope.ServiceProvider.GetRequiredService<MasterDbContext>();
                    
                    var tenants = await masterContext.Tenants
                        .Where(t => t.IsActive)
                        .ToListAsync();

                    int appliedCount = 0;
                    int skippedCount = 0;
                    int failureCount = 0;

                    foreach (var tenant in tenants)
                    {
                        var hasMigrations = await TenantMigrationHelper.HasMigrationsAppliedAsync(
                            scope.ServiceProvider,
                            tenant.Id);

                        if (!hasMigrations)
                        {
                            logger.LogInformation("Applying migrations for tenant {TenantId} ({CompanyName})...", 
                                tenant.Id, tenant.CompanyName);
                            
                            try
                            {
                                await tenantService.ApplyMigrationsAsync(tenant.Id);
                                logger.LogInformation("✓ Migrations applied for tenant {TenantId}", tenant.Id);
                                appliedCount++;
                            }
                            catch (Exception ex)
                            {
                                failureCount++;
                                logger.LogError(ex, "✗ Failed to apply migrations for tenant {TenantId}", tenant.Id);
                            }
                        }
                        else
                        {
                            logger.LogDebug("Tenant {TenantId} already has migrations applied, skipping", tenant.Id);
                            skippedCount++;
                        }

                        var tenantConnectionString = await tenantService.GetConnectionStringAsync(tenant.Id);
                        if (!string.IsNullOrEmpty(tenantConnectionString))
                        {
                            var schemaCheck = await TenantCoreSchemaValidator.EnsureCoreDocumentAuditColumnsAsync(
                                tenantConnectionString);
                            if (schemaCheck.IsFailure)
                            {
                                logger.LogWarning(
                                    "Tenant {TenantId} ({DatabaseName}) core document audit schema check failed: {Error}",
                                    tenant.Id,
                                    tenant.DatabaseName,
                                    schemaCheck.Error.Description);
                            }
                            else
                            {
                                logger.LogDebug(
                                    "Tenant {TenantId} ({DatabaseName}) core document audit schema check passed",
                                    tenant.Id,
                                    tenant.DatabaseName);
                            }
                        }
                    }

                    logger.LogInformation(
                        "Tenant migrations completed. Applied: {AppliedCount}, Skipped: {SkippedCount}, Failures: {FailureCount}, Total: {TotalCount}",
                        appliedCount, skippedCount, failureCount, tenants.Count);

                    if (hostEnvironment.IsDevelopment() && failureCount > 0)
                    {
                        throw new InvalidOperationException(
                            $"Tenant migration startup failed for {failureCount} tenant(s). Fix migration errors before continuing in Development.");
                    }
                }
                else
                {
                    // Apply to all tenants
                    var successCount = await TenantMigrationHelper.ApplyMigrationsToAllTenantsAsync(
                        scope.ServiceProvider);
                    
                    logger.LogInformation("Tenant migrations completed. Success: {SuccessCount}", successCount);
                }
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Error applying tenant migrations. The application will continue but tenant operations may fail.");
                // Don't throw - allow the app to start so we can see the error in logs
            }
        }
        else
        {
            logger.LogInformation("Automatic tenant migrations are disabled. Use POST /api/platform/migrations/tenants/apply-migrations to apply manually.");
        }
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "FATAL: Error during database migration. The application will continue but database operations may fail.");
        if (app.Environment.IsDevelopment())
        {
            // En dev : on stoppe pour qu'un développeur corrige immédiatement — sinon un schéma
            // en retard (colonne manquante, migration bloquée par une contrainte, etc.) se
            // manifeste plus tard en 500 opaque sur /api/auth/login. Miroir du bloc de seeding
            // ci-dessus. En prod, on continue pour éviter un downtime mais le monitoring doit
            // alerter sur ce log.
            throw;
        }
    }
}

Log.Information("{Brand} API starting...", BrandConstants.Name);
app.Run();

/// <summary>
/// Lot B5 — Sérialise une réponse JSON détaillée pour <c>/health/ready</c>.
/// Format consommable par <c>PlatformOpsController</c> et le frontend.
/// </summary>
static Task WriteHealthCheckResponse(HttpContext context, HealthReport report)
{
    context.Response.ContentType = "application/json";
    var payload = new
    {
        status = report.Status.ToString(),
        totalDurationMs = (int)report.TotalDuration.TotalMilliseconds,
        checks = report.Entries.Select(e => new
        {
            name = e.Key,
            status = e.Value.Status.ToString(),
            durationMs = (int)e.Value.Duration.TotalMilliseconds,
            description = e.Value.Description,
            tags = e.Value.Tags
        })
    };
    var json = JsonSerializer.Serialize(payload, new JsonSerializerOptions
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    });
    return context.Response.WriteAsync(json);
}

public partial class Program { }
