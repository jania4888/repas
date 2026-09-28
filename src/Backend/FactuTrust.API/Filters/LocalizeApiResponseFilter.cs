using FactuTrust.Application.DTOs;
using FactuTrust.Application.Localization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace FactuTrust.API.Filters;

/// <summary>Localise les messages utilisateur des enveloppes API en sortie.</summary>
public sealed class LocalizeApiResponseFilter : IAsyncResultFilter
{
    private static readonly Type ControllersApiResponseOpen = typeof(Controllers.ApiResponse<>);
    private static readonly Type ApplicationApiResponseOpen = typeof(ApiResponse<>);

    private readonly IMessageLocalizer _localizer;

    public LocalizeApiResponseFilter(IMessageLocalizer localizer) => _localizer = localizer;

    public async Task OnResultExecutionAsync(ResultExecutingContext context, ResultExecutionDelegate next)
    {
        if (context.Result is ObjectResult { Value: not null } objectResult)
        {
            objectResult.Value = LocalizeValue(objectResult.Value);
        }

        await next();
    }

    private object LocalizeValue(object value)
    {
        return value switch
        {
            ValidationErrorResponse ver => LocalizeValidation(ver),
            ProblemDetails problem => LocalizeProblem(problem),
            _ => LocalizeIfApiResponse(value)
        };
    }

    private ValidationErrorResponse LocalizeValidation(ValidationErrorResponse response)
    {
        var fieldErrors = response.FieldErrors.ToDictionary(
            kv => kv.Key,
            kv => kv.Value
                .Select(fe => fe with { Message = _localizer.Localize(fe.Message) })
                .ToArray());

        return response with
        {
            Message = _localizer.Localize(response.Message),
            GlobalErrors = response.GlobalErrors.Select(_localizer.Localize).ToArray(),
            FieldErrors = fieldErrors
        };
    }

    private ProblemDetails LocalizeProblem(ProblemDetails problem)
    {
        if (!string.IsNullOrEmpty(problem.Title))
        {
            problem.Title = _localizer.Localize(problem.Title);
        }

        if (!string.IsNullOrEmpty(problem.Detail))
        {
            problem.Detail = _localizer.Localize(problem.Detail);
        }

        return problem;
    }

    private object LocalizeIfApiResponse(object value)
    {
        var type = value.GetType();
        if (!type.IsGenericType)
        {
            return value;
        }

        var genericDef = type.GetGenericTypeDefinition();
        if (genericDef != ApplicationApiResponseOpen && genericDef != ControllersApiResponseOpen)
        {
            return value;
        }

        var arg = type.GetGenericArguments()[0];
        if (genericDef == ApplicationApiResponseOpen)
        {
            var method = typeof(LocalizeApiResponseFilter)
                .GetMethod(nameof(LocalizeApplicationTyped), System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)!
                .MakeGenericMethod(arg);
            return method.Invoke(this, new object[] { value })!;
        }

        var controllerMethod = typeof(LocalizeApiResponseFilter)
            .GetMethod(nameof(LocalizeControllerTyped), System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)!
            .MakeGenericMethod(arg);
        return controllerMethod.Invoke(this, new object[] { value })!;
    }

    private ApiResponse<T> LocalizeApplicationTyped<T>(ApiResponse<T> response)
    {
        var message = string.IsNullOrEmpty(response.Message) ? response.Message : _localizer.Localize(response.Message);
        var errors = response.Errors.Count == 0
            ? response.Errors
            : response.Errors.Select(_localizer.Localize).ToArray();
        return response with { Message = message, Errors = errors };
    }

    private Controllers.ApiResponse<T> LocalizeControllerTyped<T>(Controllers.ApiResponse<T> response)
    {
        var message = string.IsNullOrEmpty(response.Message) ? response.Message : _localizer.Localize(response.Message);
        var error = string.IsNullOrEmpty(response.Error) ? response.Error : _localizer.Localize(response.Error);
        return response with { Message = message, Error = error };
    }
}
