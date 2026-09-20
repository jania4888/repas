using System.Net;
using System.Text;
using FactuTrust.Application.Configuration;
using FactuTrust.Infrastructure.Services.Storefront;
using Microsoft.Extensions.Options;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Storefront;

public sealed class StorefrontCaptchaValidatorTests
{
    private const string ValidResponse = "{\"success\":true,\"hostname\":\"shop.example.com\"}";

    [Fact]
    public async Task Valid_token_posts_encoded_form_to_fixed_https_endpoint()
    {
        const string token = "test+token/&= value";
        var options = ValidOptions();
        options.TurnstileSecretKey = "test+secret/&= value";
        HttpContent? sentContent = null;
        using var http = new FakeHandler(async (request, cancellationToken) =>
        {
            sentContent = request.Content;
            Assert.Equal(HttpMethod.Post, request.Method);
            Assert.Equal("https://challenges.cloudflare.com/turnstile/v0/siteverify", request.RequestUri!.AbsoluteUri);
            Assert.Empty(request.RequestUri.Query);
            Assert.Null(request.Headers.Authorization);
            Assert.False(request.Headers.Contains("X-Turnstile-Token"));
            Assert.Equal("application/json", Assert.Single(request.Headers.Accept).MediaType);
            Assert.Equal("application/x-www-form-urlencoded", request.Content!.Headers.ContentType!.MediaType);
            using var expected = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["secret"] = options.TurnstileSecretKey,
                ["response"] = token
            });
            Assert.Equal(await expected.ReadAsStringAsync(cancellationToken), await request.Content.ReadAsStringAsync(cancellationToken));
            Assert.True(cancellationToken.CanBeCanceled);
            return Json(ValidResponse);
        });
        using var client = new HttpClient(http);

        Assert.True(await Create(client, options).IsValidAsync(token));
        Assert.Equal(1, http.Calls);
        Assert.NotNull(sentContent);
        await Assert.ThrowsAsync<ObjectDisposedException>(() => sentContent.ReadAsStringAsync());
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" \t\n")]
    public async Task Missing_token_is_rejected_without_http(string? token)
    {
        using var http = new FakeHandler();
        using var client = new HttpClient(http);
        Assert.False(await Create(client).IsValidAsync(token));
        Assert.Equal(0, http.Calls);
    }

    [Theory]
    [InlineData(2048, true, 1)]
    [InlineData(2049, false, 0)]
    public async Task Token_length_is_bounded_without_parsing_token(int length, bool expected, int calls)
    {
        using var http = new FakeHandler();
        using var client = new HttpClient(http);
        Assert.Equal(expected, await Create(client).IsValidAsync(new string('x', length)));
        Assert.Equal(calls, http.Calls);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" ")]
    public async Task Missing_secret_is_rejected_without_http(string? secret)
    {
        var options = ValidOptions();
        options.TurnstileSecretKey = secret!;
        using var http = new FakeHandler();
        using var client = new HttpClient(http);
        Assert.False(await Create(client, options).IsValidAsync("token"));
        Assert.Equal(0, http.Calls);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" ")]
    [InlineData("https://shop.example.com")]
    [InlineData("shop.example.com/path")]
    [InlineData("shop.example.com:443")]
    [InlineData("*.example.com")]
    [InlineData("shop.example.com.")]
    [InlineData("shop..example.com")]
    [InlineData("shop_example.com")]
    [InlineData("-shop.example.com")]
    [InlineData("shop-.example.com")]
    [InlineData("127.0.0.1")]
    [InlineData("[::1]")]
    [InlineData("shöp.example.com")]
    public async Task Any_invalid_allowlist_entry_rejects_without_http(string? hostname)
    {
        var options = ValidOptions();
        options.TurnstileAllowedHostnames = new[] { "shop.example.com", hostname! };
        using var http = new FakeHandler();
        using var client = new HttpClient(http);
        Assert.False(await Create(client, options).IsValidAsync("token"));
        Assert.Equal(0, http.Calls);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Missing_allowlist_rejects_without_http(bool isNull)
    {
        var options = ValidOptions();
        options.TurnstileAllowedHostnames = isNull ? null! : Array.Empty<string>();
        using var http = new FakeHandler();
        using var client = new HttpClient(http);
        Assert.False(await Create(client, options).IsValidAsync("token"));
        Assert.Equal(0, http.Calls);
    }

    [Theory]
    [InlineData(64, 1)]
    [InlineData(63, 4)]
    public async Task Oversized_dns_labels_or_names_reject_without_http(int labelLength, int labels)
    {
        var options = ValidOptions();
        options.TurnstileAllowedHostnames = new[] { string.Join('.', Enumerable.Repeat(new string('a', labelLength), labels)) };
        using var http = new FakeHandler();
        using var client = new HttpClient(http);
        Assert.False(await Create(client, options).IsValidAsync("token"));
        Assert.Equal(0, http.Calls);
    }

    [Theory]
    [InlineData("shop.example.com", true)]
    [InlineData("SHOP.Example.COM", true)]
    [InlineData("second.example.com", true)]
    [InlineData("shop.example.com.evil.test", false)]
    [InlineData("evilshop.example.com", false)]
    [InlineData("evil.shop.example.com", false)]
    [InlineData("example.com", false)]
    [InlineData(" shop.example.com", false)]
    [InlineData("shop.example.com.", false)]
    public async Task Hostname_matches_whole_allowlisted_dns_name_ignoring_case(string hostname, bool expected)
    {
        var options = ValidOptions();
        options.TurnstileAllowedHostnames = new[] { "Shop.Example.com", "second.example.com" };
        using var http = new FakeHandler((_, _) => Task.FromResult(Json($"{{\"success\":true,\"hostname\":\"{hostname}\"}}")));
        using var client = new HttpClient(http);
        Assert.Equal(expected, await Create(client, options).IsValidAsync("token"));
    }

    [Theory]
    [InlineData("")]
    [InlineData("not JSON")]
    [InlineData("null")]
    [InlineData("[]")]
    [InlineData("true")]
    [InlineData("{}")]
    [InlineData("{\"success\":false,\"hostname\":\"shop.example.com\"}")]
    [InlineData("{\"success\":\"true\",\"hostname\":\"shop.example.com\"}")]
    [InlineData("{\"success\":1,\"hostname\":\"shop.example.com\"}")]
    [InlineData("{\"success\":null,\"hostname\":\"shop.example.com\"}")]
    [InlineData("{\"Success\":true,\"hostname\":\"shop.example.com\"}")]
    [InlineData("{\"success\":true}")]
    [InlineData("{\"success\":true,\"hostname\":null}")]
    [InlineData("{\"success\":true,\"hostname\":123}")]
    [InlineData("{\"success\":true,\"hostname\":[]}")]
    [InlineData("{\"success\":true,\"hostname\":\"\"}")]
    [InlineData("{\"success\":false,\"success\":true,\"hostname\":\"shop.example.com\"}")]
    [InlineData("{\"success\":true,\"hostname\":\"evil.test\",\"hostname\":\"shop.example.com\"}")]
    [InlineData("{\"success\":true,\"hostname\":\"shop.example.com\",}")]
    public async Task Unsuccessful_or_malformed_response_is_rejected(string body)
    {
        using var http = new FakeHandler((_, _) => Task.FromResult(Json(body)));
        using var client = new HttpClient(http);
        Assert.False(await Create(client).IsValidAsync("token"));
        Assert.Equal(1, http.Calls);
    }

    [Theory]
    [InlineData("order", "\"order\"", true)]
    [InlineData("order", "\"ORDER\"", false)]
    [InlineData("order", "\"login\"", false)]
    [InlineData("order", "null", false)]
    [InlineData("order", "123", false)]
    [InlineData("", "\"other\"", true)]
    [InlineData(null, "\"other\"", true)]
    public async Task Action_is_exactly_checked_only_when_configured(string? expectedAction, string action, bool expected)
    {
        var options = ValidOptions();
        options.TurnstileExpectedAction = expectedAction;
        using var http = new FakeHandler((_, _) => Task.FromResult(Json($"{{\"success\":true,\"hostname\":\"shop.example.com\",\"action\":{action}}}")));
        using var client = new HttpClient(http);
        Assert.Equal(expected, await Create(client, options).IsValidAsync("token"));
    }

    [Theory]
    [InlineData(ValidResponse)]
    [InlineData("{\"success\":true,\"hostname\":\"shop.example.com\",\"action\":\"order\",\"action\":\"order\"}")]
    public async Task Required_action_cannot_be_missing_or_ambiguous(string body)
    {
        var options = ValidOptions();
        options.TurnstileExpectedAction = "order";
        using var http = new FakeHandler((_, _) => Task.FromResult(Json(body)));
        using var client = new HttpClient(http);
        Assert.False(await Create(client, options).IsValidAsync("token"));
    }

    [Theory]
    [InlineData(" ")]
    [InlineData("a/b")]
    [InlineData("action_name_longer_than_thirty_two_characters")]
    public async Task Invalid_configured_action_rejects_without_http(string action)
    {
        var options = ValidOptions();
        options.TurnstileExpectedAction = action;
        using var http = new FakeHandler();
        using var client = new HttpClient(http);
        Assert.False(await Create(client, options).IsValidAsync("token"));
        Assert.Equal(0, http.Calls);
    }

    [Theory]
    [InlineData(301)]
    [InlineData(302)]
    [InlineData(307)]
    [InlineData(400)]
    [InlineData(401)]
    [InlineData(429)]
    [InlineData(500)]
    public async Task Non_success_status_is_rejected_without_retry(int status)
    {
        using var http = new FakeHandler((_, _) => Task.FromResult(new HttpResponseMessage((HttpStatusCode)status)
        {
            Content = new StringContent(ValidResponse),
            Headers = { Location = new Uri("https://other.example.com") }
        }));
        using var client = new HttpClient(http);
        Assert.False(await Create(client).IsValidAsync("token"));
        Assert.Equal(1, http.Calls);
    }

    [Fact]
    public async Task Bypass_is_explicit_and_does_not_require_configuration_or_http()
    {
        using var http = new FakeHandler();
        using var client = new HttpClient(http);
        var validator = Create(client, new StorefrontOptions { OrderSubmissionRequiresCaptcha = false });
        Assert.True(await validator.IsValidAsync(null));
        Assert.True(await validator.IsValidAsync(new string('x', 2049)));
        Assert.Equal(0, http.Calls);
    }

    [Fact]
    public async Task Replayed_token_is_reverified_and_provider_denial_is_not_cached_or_retried()
    {
        var responses = new Queue<string>(new[] { ValidResponse, "{\"success\":false,\"error-codes\":[\"timeout-or-duplicate\"]}" });
        using var http = new FakeHandler((_, _) => Task.FromResult(Json(responses.Dequeue())));
        using var client = new HttpClient(http);
        var validator = Create(client);
        Assert.True(await validator.IsValidAsync("same-token"));
        Assert.False(await validator.IsValidAsync("same-token"));
        Assert.Equal(2, http.Calls);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Network_and_io_exceptions_fail_closed(bool io)
    {
        using var http = new FakeHandler((_, _) => throw (io ? (Exception)new IOException("do not log") : new HttpRequestException("do not log")));
        using var client = new HttpClient(http);
        Assert.False(await Create(client).IsValidAsync("token"));
        Assert.Equal(1, http.Calls);
    }

    [Fact]
    public async Task Http_client_timeout_fails_closed()
    {
        using var http = new FakeHandler(async (_, cancellationToken) =>
        {
            await Task.Delay(Timeout.Infinite, cancellationToken);
            return Json(ValidResponse);
        });
        using var client = new HttpClient(http) { Timeout = TimeSpan.FromMilliseconds(30) };
        Assert.False(await Create(client).IsValidAsync("token"));
        Assert.Equal(1, http.Calls);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Caller_cancellation_is_propagated(bool preCancelled)
    {
        using var cancellation = new CancellationTokenSource();
        using var http = new FakeHandler(async (_, cancellationToken) =>
        {
            cancellation.Cancel();
            await Task.Delay(Timeout.Infinite, cancellationToken);
            return Json(ValidResponse);
        });
        using var client = new HttpClient(http);
        if (preCancelled) cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => Create(client).IsValidAsync("token", cancellation.Token));
        Assert.Equal(preCancelled ? 0 : 1, http.Calls);
    }

    [Fact]
    public async Task Invalid_utf8_is_rejected()
    {
        var bytes = Encoding.UTF8.GetBytes(ValidResponse.Replace("shop", "shXp"));
        bytes[Array.IndexOf(bytes, (byte)'X')] = 0xff;
        using var http = new FakeHandler((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(bytes) }));
        using var client = new HttpClient(http);
        Assert.False(await Create(client).IsValidAsync("token"));
    }

    [Theory]
    [InlineData("{\"success\":true,\"hostname\":\"\\uD800\"}", null)]
    [InlineData("{\"success\":true,\"hostname\":\"\\uDC00\"}", null)]
    [InlineData("{\"success\":true,\"hostname\":\"shop.example.com\",\"action\":\"\\uD800\"}", "order")]
    [InlineData("{\"success\":true,\"hostname\":\"shop.example.com\",\"action\":\"\\uDC00\"}", "order")]
    [InlineData("{\"\\uD800\":null,\"success\":true,\"hostname\":\"shop.example.com\"}", null)]
    [InlineData("{\"\\uDC00\":null,\"success\":true,\"hostname\":\"shop.example.com\"}", null)]
    [InlineData("{\"succe\\uD800\":null,\"success\":true,\"hostname\":\"shop.example.com\"}", null)]
    [InlineData("{\"succe\\uDC00\":null,\"success\":true,\"hostname\":\"shop.example.com\"}", null)]
    public async Task Isolated_escaped_surrogates_fail_closed_in_values_and_property_names(string body, string? expectedAction)
    {
        var options = ValidOptions();
        options.TurnstileExpectedAction = expectedAction;
        using var http = new FakeHandler((_, _) => Task.FromResult(Json(body)));
        using var client = new HttpClient(http);
        Assert.False(await Create(client, options).IsValidAsync("token"));
        Assert.Equal(1, http.Calls);
    }

    [Fact]
    public async Task Valid_escaped_property_names_remain_supported()
    {
        using var http = new FakeHandler((_, _) => Task.FromResult(Json("{\"succe\\u0073s\":true,\"host\\u006Eame\":\"shop.example.com\"}")));
        using var client = new HttpClient(http);
        Assert.True(await Create(client).IsValidAsync("token"));
    }

    [Fact]
    public async Task Invalid_operation_outside_response_parsing_is_not_swallowed()
    {
        using var http = new FakeHandler((_, _) => throw new InvalidOperationException("synthetic handler failure"));
        using var client = new HttpClient(http);
        await Assert.ThrowsAsync<InvalidOperationException>(() => Create(client).IsValidAsync("token"));
    }

    [Fact]
    public async Task Excessively_nested_json_is_rejected()
    {
        var body = ValidResponse[..^1] + ",\"extra\":" + new string('[', 17) + "0" + new string(']', 17) + "}";
        using var http = new FakeHandler((_, _) => Task.FromResult(Json(body)));
        using var client = new HttpClient(http);
        Assert.False(await Create(client).IsValidAsync("token"));
    }

    [Theory]
    [InlineData(16384, true, true)]
    [InlineData(16385, true, false)]
    [InlineData(16384, false, true)]
    [InlineData(16385, false, false)]
    public async Task Response_size_is_bounded_even_without_content_length(int size, bool knownLength, bool expected)
    {
        var bytes = Encoding.UTF8.GetBytes(ValidResponse.PadRight(size));
        using var stream = new NonSeekableStream(bytes);
        using var content = knownLength ? (HttpContent)new ByteArrayContent(bytes) : new StreamContent(stream);
        using var http = new FakeHandler((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = content }));
        using var client = new HttpClient(http);
        Assert.Equal(expected, await Create(client).IsValidAsync("token"));
        await Assert.ThrowsAsync<ObjectDisposedException>(() => content.ReadAsStringAsync());
        if (!knownLength) Assert.True(stream.WasDisposed);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Body_read_is_bounded_by_deadline_and_propagates_caller_cancellation(bool callerCancels)
    {
        using var cancellation = new CancellationTokenSource();
        using var stream = new BlockingStream(callerCancels ? cancellation.Cancel : null);
        using var http = new FakeHandler((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StreamContent(stream) }));
        using var client = new HttpClient(http) { Timeout = Timeout.InfiniteTimeSpan };
        var validator = Create(client);
        if (callerCancels)
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => validator.IsValidAsync("token", cancellation.Token));
        else
        {
            // Match ASP.NET Core's lack of a synchronization context: unrelated parallel tests
            // must not hold the body-read continuation behind xUnit's bounded worker queue.
            Assert.False(await Task.Run(() => validator.IsValidAsync("token", cancellation.Token))
                .WaitAsync(TimeSpan.FromSeconds(10)));
        }
        Assert.True(stream.WasDisposed);
    }

    private static StorefrontOptions ValidOptions() => new()
    {
        OrderSubmissionRequiresCaptcha = true,
        TurnstileSecretKey = "synthetic-test-secret",
        TurnstileAllowedHostnames = new[] { "shop.example.com" }
    };

    private static StorefrontCaptchaValidator Create(HttpClient client, StorefrontOptions? options = null)
        => new(client, Options.Create(options ?? ValidOptions()));

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

    private class NonSeekableStream : MemoryStream
    {
        public bool WasDisposed { get; private set; }
        public override bool CanSeek => false;
        public NonSeekableStream(byte[] bytes) : base(bytes) { }
        protected override void Dispose(bool disposing)
        {
            WasDisposed = true;
            base.Dispose(disposing);
        }
    }

    private sealed class BlockingStream : NonSeekableStream
    {
        private readonly Action? _onRead;
        public BlockingStream(Action? onRead) : base(Array.Empty<byte>()) => _onRead = onRead;
        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        {
            _onRead?.Invoke();
            await Task.Delay(Timeout.Infinite, cancellationToken);
            return 0;
        }
    }
}
