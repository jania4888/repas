import { HttpErrorResponse } from '@angular/common/http';
import { Observable, from, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

/**
 * When HttpClient uses responseType: 'blob', error bodies are a Blob even if the server
 * sent JSON. Parse to an object so ErrorHandlerService and toasts show the real message.
 */
export function normalizeHttpErrorResponse(error: HttpErrorResponse): Observable<HttpErrorResponse> {
  if (error.error instanceof Blob) {
    return from(error.error.text()).pipe(
      map(text => buildHttpErrorResponse(error, parseErrorPayloadFromText(text))),
      catchError(() =>
        of(
          new HttpErrorResponse({
            error: {
              success: false,
              message: $localize`:@@core.http-error-normalize.ts.erreur.lors.de.la.lecture.de.la.reponse.8884787e:Erreur lors de la lecture de la réponse du serveur.`
            },
            status: error.status,
            statusText: error.statusText,
            url: error.url || undefined,
            headers: error.headers
          })
        )
      )
    );
  }

  if (error.error && typeof error.error === 'string') {
    return of(parseStringBodyToHttpError(error));
  }

  return of(error);
}

function parseErrorPayloadFromText(text: string): unknown {
  const trimmed = text?.trim() ?? '';
  if (!trimmed.length) {
    return { success: false, message: '', errors: [] as string[] };
  }
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return { success: false, message: trimmed, errors: [trimmed] };
    }
  }
  return { success: false, message: trimmed, errors: [trimmed] };
}

function parseStringBodyToHttpError(error: HttpErrorResponse): HttpErrorResponse {
  const raw = error.error as string;
  let parsedError: unknown;
  try {
    if (raw.trim().startsWith('{')) {
      parsedError = JSON.parse(raw);
    } else {
      parsedError = { success: false, message: raw, errors: [raw] };
    }
  } catch {
    parsedError = { success: false, message: raw, errors: [raw] };
  }
  return buildHttpErrorResponse(error, parsedError);
}

function buildHttpErrorResponse(original: HttpErrorResponse, errorBody: unknown): HttpErrorResponse {
  return new HttpErrorResponse({
    error: errorBody,
    status: original.status,
    statusText: original.statusText,
    url: original.url || undefined,
    headers: original.headers
  });
}
