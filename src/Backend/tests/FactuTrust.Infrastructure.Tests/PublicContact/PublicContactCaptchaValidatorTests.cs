using System.Net;
using System.Text;
using FactuTrust.Application.Configuration;
using FactuTrust.Infrastructure.Services.PublicContact;
using Microsoft.Extensions.Options;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.PublicContact;

public sealed class PublicContactCaptchaValidatorTests
{
    private const string ValidResponse = "{\"success\":true,\"hostname\":\"instafact.example\",\"action\":\"contact\"}";

    [Fact]
    public async Task Captcha_not_required_accepts_without_http_even_without_token()
    {
        var options = ValidOptions();
        options.RequireCaptcha = false;
        options.TurnstileSecretKey = "";
        using var http = new FakeHandler();
        using var client = new HttpClient(http);

        Assert.True(await Create(client, options).IsValidAsync(null, "203.0.113.7"));
        Assert.Equal(0, http.Calls);
    }

    [Fact]
    public async Task Valid_token_posts_secret_response_and_remoteip_to_siteverify()
    {
        const string token = "test+token/&= value";
        var options = ValidOptions();
        using var http = new FakeHandler(async (request, cancellationToken) =>
        {
            Assert.Equal(HttpMethod.Post, request.Method);
            Assert.Equal("https://challenges.cloudflare.com/turnstile/v0/siteverify", request.RequestUri!.AbsoluteUri);
            using var expected = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["secret"] = options.TurnstileSecretKey,
                ["response"] = token,
                ["remoteip"] = "203.0.113.7"
            });
            Assert.Equal(await expected.ReadAsStringAsync(cancellationToken), await request.Content!.ReadAsStringAsync(cancellationToken));
            return Json(ValidResponse);
        });
        using var client = new HttpClient(http);

        Assert.True(await Create(client, options).IsValidAsync(token, "203.0.113.7"));
        Assert.Equal(1, http.Calls);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not-an-ip")]
    [InlineData("203.0.113.7; evil=1")]
    public async Task Remoteip_is_omitted_when_ip_is_missing_or_not_parseable(string? remoteIp)
    {
        var options = ValidOptions();
        string? body = null;
        using var http = new FakeHandler(async (request, cancellationToken) =>
        {
            body = await request.Content!.ReadAsStringAsync(cancellationToken);
            return Json(ValidResponse);
        });
        using var client = new HttpClient(http);

        Assert.True(await Create(client, options).IsValidAsync("token", remoteIp));
        Assert.NotNull(body);
        Assert.DoesNotContain("remoteip", body);
        Assert.DoesNotContain("evil", body);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" ")]
    public async Task Missing_token_is_rejected_without_http(string? token)
    {
        using var http = new FakeHandler();
        using var client = new HttpClient(http);
        Assert.False(await Create(client, ValidOptions()).IsValidAsync(token, null));
        Assert.Equal(0, http.Calls);
    }

    [Fact]
    public async Task Missing_secret_fails_closed_without_http()
    {
        var options = ValidOptions();
        options.TurnstileSecretKey = "";
        using var http = new FakeHandler();
        using var client = new HttpClient(http);
        Assert.False(await Create(client, options).IsValidAsync("token", null));
        Assert.Equal(0, http.Calls);
    }

    [Fact]
    public async Task Missing_allowed_hostnames_fails_closed_without_http()
    {
        var options = ValidOptions();
        options.TurnstileAllowedHostnames = Array.Empty<string>();
        using var http = new FakeHandler();
        using var client = new HttpClient(http);
        Assert.False(await Create(client, options).IsValidAsync("token", null));
        Assert.Equal(0, http.Calls);
    }

    [Theory]
    [InlineData("{\"success\":true,\"hostname\":\"instafact.example\",\"action\":\"order\"}")]
    [InlineData("{\"success\":true,\"hostname\":\"instafact.example\"}")]
    [InlineData("{\"success\":true,\"hostname\":\"evil.example\",\"action\":\"contact\"}")]
    [InlineData("{\"success\":false,\"hostname\":\"instafact.example\",\"action\":\"contact\"}")]
    [InlineData("not json")]
    public async Task Wrong_action_hostname_or_failure_is_rejected(string body)
    {
        using var http = new FakeHandler((_, _) => Task.FromResult(Json(body)));
        using var client = new HttpClient(http);
        Assert.False(await Create(client, ValidOptions()).IsValidAsync("token", null));
        Assert.Equal(1, http.Calls);
    }

    [Fact]
    public async Task Hostname_comparison_is_case_insensitive_and_action_is_exact()
    {
        using var http = new FakeHandler((_, _) => Task.FromResult(Json("{\"success\":true,\"hostname\":\"INSTAFACT.example\",\"action\":\"contact\"}")));
        using var client = new HttpClient(http);
        Assert.True(await Create(client, ValidOptions()).IsValidAsync("token", null));
    }

    [Fact]
    public async Task Transport_failure_and_non_2xx_are_rejected_without_throwing()
    {
        using var failing = new FakeHandler((_, _) => throw new HttpRequestException("do not log"));
        using var failingClient = new HttpClient(failing);
        Assert.False(await Create(failingClient, ValidOptions()).IsValidAsync("token", null));

        using var http = new FakeHandler((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.InternalServerError)));
        using var client = new HttpClient(http);
        Assert.False(await Create(client, ValidOptions()).IsValidAsync("token", null));
    }

    private static PublicContactCaptchaValidator Create(HttpClient client, PublicContactOptions options)
        => new(client, Options.Create(options));

    private static PublicContactOptions ValidOptions() => new()
    {
        Enabled = true,
        RequireCaptcha = true,
        TurnstileSecretKey = "synthetic-secret",
        TurnstileAllowedHostnames = new[] { "instafact.example" },
        TurnstileExpectedAction = "contact"
    };

    private static HttpResponseMessage Json(string body) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(body, Encoding.UTF8, "application/json")
    };

    private sealed class FakeHandler : HttpMessageHandler
    {
        private readonly Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> _send;
        public int Calls { get; private set; }

        public FakeHandler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>>? send = null)
            => _send = send ?? ((_, _) => Task.FromResult(Json(ValidResponse)));

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls++;
            return _send(request, cancellationToken);
        }
    }
}
