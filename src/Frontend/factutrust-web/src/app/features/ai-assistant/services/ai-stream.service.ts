import { Injectable, inject } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import { environment } from '@environments/environment';
import { AuthService } from '@core/services/auth.service';
import { ChatRequest, ChatStreamEvent } from '../models/ai-chat.models';

/** Erreur enrichie du statut HTTP, pour que l'appelant affiche un message exact (401 / 429 / autre). */
interface AiStreamHttpError extends Error {
  httpStatus?: number;
}

@Injectable({ providedIn: 'root' })
export class AiStreamService {
  private readonly authService = inject(AuthService);

  /**
   * @param apiBasePath Segment d'API à utiliser. Défaut `/ai` = surface tenant historique, inchangée.
   *   L'agent cabinet passe `/firm/ai` : surface distincte, permissionnée séparément, dont le scope
   *   est imposé côté serveur.
   */
  streamChat(
    request: ChatRequest,
    onResponseMeta?: (meta: { traceId: string | null }) => void,
    apiBasePath: string = '/ai'
  ): Observable<ChatStreamEvent> {
    return new Observable(subscriber => {
      const abortController = new AbortController();
      const url = `${environment.apiUrl}${apiBasePath}/chat`;

      const run = async (): Promise<void> => {
        // Le flux IA utilise fetch (hors pipeline d'intercepteurs Angular) : on reproduit ici le
        // comportement 401 → refresh → retry (une seule fois) afin qu'un jeton expiré ne se traduise
        // pas par une « Génération interrompue » alors qu'un simple rafraîchissement suffirait.
        let response = await this.fetchChat(url, request, abortController.signal);
        if (response.status === 401) {
          const refreshed = await this.tryRefreshToken();
          if (refreshed) {
            response = await this.fetchChat(url, request, abortController.signal);
          }
        }

        if (!response.ok) {
          const message = await this.resolveHttpErrorMessage(response);
          subscriber.error(this.buildHttpError(response.status, message));
          return;
        }

        const traceId = response.headers.get('X-Trace-Id');
        onResponseMeta?.({ traceId });

        const reader = response.body?.getReader();
        if (!reader) {
          subscriber.error(new Error('No response body'));
          return;
        }

        const decoder = new TextDecoder();
        let buffer = '';
        let malformedSseLines = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;

            const jsonStr = trimmed.slice(6);
            if (!jsonStr) continue;

            try {
              const event: ChatStreamEvent = JSON.parse(jsonStr);
              subscriber.next(event);

              if (event.type === 'done' || event.type === 'error') {
                subscriber.complete();
                return;
              }
            } catch {
              malformedSseLines += 1;
              if (!environment.production && malformedSseLines <= 3) {
                console.warn('[AiStreamService] Malformed SSE JSON line skipped', jsonStr.slice(0, 120));
              }
            }
          }
        }

        if (malformedSseLines > 0 && !environment.production) {
          console.warn(`[AiStreamService] ${malformedSseLines} malformed SSE line(s) skipped`);
        }

        subscriber.complete();
      };

      run().catch((err: unknown) => {
        if ((err as Error | undefined)?.name !== 'AbortError') {
          subscriber.error(err);
        }
      });

      return () => abortController.abort();
    });
  }

  /** Émet une requête POST /ai/chat avec le jeton courant (relu à chaque appel, donc après refresh). */
  private fetchChat(url: string, request: ChatRequest, signal: AbortSignal): Promise<Response> {
    const token = this.authService.getAccessToken();
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(request),
      signal
    });
  }

  /** Tente un refresh unique du jeton. Renvoie true si un nouveau jeton est disponible. */
  private async tryRefreshToken(): Promise<boolean> {
    try {
      const res = await firstValueFrom(this.authService.refreshToken());
      return !!(res?.success && res?.data);
    } catch {
      return false;
    }
  }

  private async resolveHttpErrorMessage(response: Response): Promise<string> {
    if (response.status === 401) {
      return $localize`:@@ai-assistant.ai-stream.ts.session.expiree.veuillez.vous.reconnecte.be32677a:Session expirée. Veuillez vous reconnecter, puis renvoyer votre message.`;
    }
    if (response.status === 429) {
      return $localize`:@@ai-assistant.ai-stream.ts.trop.de.requetes.vers.l.assistant.ia.pat.ebb869db:Trop de requêtes vers l’assistant IA. Patientez un instant avant de réessayer.`;
    }

    try {
      const body = (await response.json()) as {
        message?: string;
        errors?: string[];
      };
      if (body.message?.trim()) {
        return body.message.trim();
      }
      if (body.errors?.length) {
        return body.errors.join(' ');
      }
    } catch {
      // ignore non-JSON bodies
    }

    return `HTTP ${response.status}: ${response.statusText}`;
  }

  private buildHttpError(status: number, message: string): AiStreamHttpError {
    const err = new Error(message) as AiStreamHttpError;
    err.httpStatus = status;
    return err;
  }
}
