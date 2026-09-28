using System.Globalization;
using Xunit;
using FactuTrust.API.Controllers;
using FactuTrust.API.Filters;
using FactuTrust.Application.DTOs;
using FactuTrust.Application.Localization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;

namespace FactuTrust.API.Tests.Filters;

public sealed class LocalizeApiResponseFilterTests
{
    [Fact]
    public async Task FrenchCulture_LeavesControllerApiResponseUnchanged()
    {
        var filter = new LocalizeApiResponseFilter(new CultureAwareStubLocalizer());
        var response = FactuTrust.API.Controllers.ApiResponse<object>.Fail("Email ou mot de passe incorrect");
        var context = CreateContext(response);
        var previous = CultureInfo.CurrentUICulture;
        try
        {
            CultureInfo.CurrentUICulture = new CultureInfo("fr-FR");
            await filter.OnResultExecutionAsync(context, () => Task.FromResult<ResultExecutedContext>(null!));
        }
        finally
        {
            CultureInfo.CurrentUICulture = previous;
        }

        var result = Assert.IsType<ObjectResult>(context.Result);
        var body = Assert.IsType<FactuTrust.API.Controllers.ApiResponse<object>>(result.Value);
        Assert.Equal("Email ou mot de passe incorrect", body.Error);
        Assert.Equal("Email ou mot de passe incorrect", body.Message);
    }

    [Fact]
    public async Task ArabicCulture_LocalizesValidationErrorResponse()
    {
        var filter = new LocalizeApiResponseFilter(new CultureAwareStubLocalizer());
        var response = ValidationErrorResponse.FromGlobalErrors("Requête invalide.");
        var previous = CultureInfo.CurrentUICulture;
        CultureInfo.CurrentUICulture = new CultureInfo("ar-TN");
        var context = CreateContext(response);
        try
        {
            await filter.OnResultExecutionAsync(context, () => Task.FromResult<ResultExecutedContext>(null!));
        }
        finally
        {
            CultureInfo.CurrentUICulture = previous;
        }

        var result = Assert.IsType<ObjectResult>(context.Result);
        var body = Assert.IsType<ValidationErrorResponse>(result.Value);
        Assert.Equal("AR:Requête invalide.", body.Message);
        Assert.Equal("AR:Requête invalide.", body.GlobalErrors[0]);
    }

    private static ResultExecutingContext CreateContext(object value)
    {
        var actionContext = new ActionContext(new DefaultHttpContext(), new RouteData(), new ActionDescriptor());
        return new ResultExecutingContext(
            actionContext,
            [],
            new ObjectResult(value),
            controller: null!);
    }

    private sealed class CultureAwareStubLocalizer : IMessageLocalizer
    {
        public string Localize(string? message)
        {
            if (message is null)
            {
                return string.Empty;
            }

            return CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "ar"
                ? $"AR:{message}"
                : message;
        }
    }
}
