import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { Observable, catchError, from, map, switchMap, throwError } from 'rxjs';
import { environment } from '@environments/environment';
import { resolveApiAssetUrl } from '@core/utils/api-asset-url';
import {
  PowerPointExportAudit,
  PowerPointExportRequest,
  PowerPointExportResponse,
  PowerPointResponsePreview,
  PowerPointTemplateInfo,
  powerPointTemplateToApi,
  slideContentBlockToApi,
  slideOrientationToApi,
  toPowerPointTemplate
} from '../models/ai-chat.models';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
  errors?: string[];
  code?: string;
}

interface PagedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages?: number;
  hasPreviousPage?: boolean;
  hasNextPage?: boolean;
}

/** Wire format for POST /api/ai/exports/powerpoint (PascalCase string enums). */
interface PowerPointExportRequestWire {
  title: string;
  subtitle?: string;
  authorName?: string;
  template: string;
  orientation: string;
  includeCoverSlide: boolean;
  includeAgenda: boolean;
  includeTableOfContents: boolean;
  includeSpeakerNotes: boolean;
  includeSources: boolean;
  includeAppendix: boolean;
  locale?: string;
  responses: Array<{
    conversationId: string;
    messageId: string;
    customTitle?: string;
    includeOnly?: string;
  }>;
}

/**
 * Result of a generation call. When the deck fits the inline threshold the backend streams the
 * .pptx directly and we expose a `Blob`; otherwise the backend returns 202 with a signed download
 * URL.
 */
export type PowerPointExportResult =
  | { kind: 'inline'; blob: Blob; fileName: string; exportId: string; slideCount: number; downloadUrl: string; expiresAt: string }
  | { kind: 'deferred'; envelope: PowerPointExportResponse };

export interface PowerPointExportError {
  status: number;
  code?: string;
  message: string;
  details?: string[];
}

/**
 * HTTP client for the AI Assistant PowerPoint export module. All requests go through the
 * `/api/ai/exports/powerpoint` family of endpoints and inherit the regular auth/CSRF pipeline.
 */
@Injectable({ providedIn: 'root' })
export class PowerPointExportService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/ai/exports/powerpoint`;

  /**
   * Generates a new presentation from the provided selections. Returns either an inline Blob
   * (small decks) or a deferred envelope with a signed download link.
   */
  generate(request: PowerPointExportRequest): Observable<PowerPointExportResult> {
    const body = this.serializeExportRequest(request);
    return this.http
      .post(this.baseUrl, body, {
        observe: 'response',
        responseType: 'blob',
        headers: {
          Accept: 'application/vnd.openxmlformats-officedocument.presentationml.presentation, application/json'
        }
      })
      .pipe(
        switchMap(response => this.toResult(response)),
        catchError(err => from(this.parseError(err)).pipe(switchMap(parsed => throwError(() => parsed))))
      );
  }

  /** Returns the catalogue used to render template preview cards. */
  listTemplates(): Observable<PowerPointTemplateInfo[]> {
    return this.http
      .get<ApiResponse<PowerPointTemplateInfo[]>>(`${this.baseUrl}/templates`)
      .pipe(
        map(res =>
          (res.data ?? []).map(t => ({
            ...t,
            id: toPowerPointTemplate(t.id as unknown as string | number),
            previewThumbnailUrl: resolveApiAssetUrl(t.previewThumbnailUrl) ?? undefined,
            previewThumbnailUrl4x3: resolveApiAssetUrl(t.previewThumbnailUrl4x3) ?? undefined
          }))
        )
      );
  }

  /** Lightweight structural preview for the export wizard review step. */
  previewResponse(
    conversationId: string,
    messageId: string,
    customTitle?: string
  ): Observable<PowerPointResponsePreview> {
    const params: Record<string, string> = {
      conversationId,
      messageId
    };
    if (customTitle) params['customTitle'] = customTitle;
    return this.http
      .get<ApiResponse<PowerPointResponsePreview>>(`${this.baseUrl}/preview`, { params })
      .pipe(map(res => res.data!));
  }

  /** Paginated export history for the current user. */
  getHistory(page: number = 1, pageSize: number = 20): Observable<PagedResult<PowerPointExportAudit>> {
    const params: Record<string, string> = {
      page: String(page),
      pageSize: String(pageSize)
    };
    return this.http
      .get<ApiResponse<PagedResult<PowerPointExportAudit>>>(`${this.baseUrl}/history`, { params })
      .pipe(
        map(
          res =>
            res.data ?? {
              items: [],
              page: 1,
              pageSize,
              totalCount: 0
            }
        )
      );
  }

  /**
   * Resolves a signed download URL (returned by the backend) into a Blob for client-side
   * download. The download URL is host-relative; this helper expands it to the API origin.
   */
  download(downloadUrl: string): Observable<Blob> {
    const fullUrl = this.expandDownloadUrl(downloadUrl);
    return this.http.get(fullUrl, { responseType: 'blob' }).pipe(
      catchError(err => from(this.parseError(err)).pipe(switchMap(parsed => throwError(() => parsed))))
    );
  }

  /**
   * Triggers a browser download for a Blob by creating a temporary anchor. Centralised here so
   * the dialog component doesn't have to deal with DOM plumbing.
   */
  saveBlobToDisk(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 0);
  }

  /** Maps UI request to API wire format (PascalCase string enums). */
  serializeExportRequest(request: PowerPointExportRequest): PowerPointExportRequestWire {
    return {
      title: request.title,
      subtitle: request.subtitle,
      authorName: request.authorName,
      template: powerPointTemplateToApi(request.template),
      orientation: slideOrientationToApi(request.orientation),
      includeCoverSlide: request.includeCoverSlide,
      includeAgenda: request.includeAgenda,
      includeTableOfContents: request.includeTableOfContents,
      includeSpeakerNotes: request.includeSpeakerNotes,
      includeSources: request.includeSources,
      includeAppendix: request.includeAppendix,
      locale: request.locale,
      responses: request.responses.map(r => ({
        conversationId: r.conversationId,
        messageId: r.messageId,
        customTitle: r.customTitle,
        includeOnly: slideContentBlockToApi(r.includeOnly)
      }))
    };
  }

  private toResult(response: HttpResponse<Blob>): Observable<PowerPointExportResult> {
    const status = response.status;
    const body = response.body;

    if (status === 202 || this.isJsonBody(response, body)) {
      if (!body) {
        return throwError(() => ({ status, message: $localize`:@@ai-assistant.powerpoint-export.ts.reponse.de.generation.vide.3ef9eede:Réponse de génération vide.` } satisfies PowerPointExportError));
      }
      return from(body.text()).pipe(map(text => this.parseDeferred(text)));
    }

    const headers = response.headers;
    return new Observable<PowerPointExportResult>(observer => {
      observer.next({
        kind: 'inline',
        blob: body!,
        fileName: this.extractFileName(response),
        exportId: headers.get('X-Export-Id') ?? '',
        slideCount: Number(headers.get('X-Export-Slides') ?? 0),
        downloadUrl: headers.get('X-Export-Download-Url') ?? '',
        expiresAt: headers.get('X-Export-Expires') ?? ''
      });
      observer.complete();
    });
  }

  private isJsonBody(response: HttpResponse<Blob>, body: Blob | null): boolean {
    if (!body) return false;
    const contentType = response.headers.get('Content-Type') ?? body.type ?? '';
    return contentType.includes('application/json');
  }

  private parseDeferred(text: string): PowerPointExportResult {
    let json: ApiResponse<PowerPointExportResponse> | null = null;
    try {
      json = JSON.parse(text) as ApiResponse<PowerPointExportResponse>;
    } catch {
      json = null;
    }
    if (!json || !json.success || !json.data) {
      throw new Error(json?.message ?? 'Réponse de génération invalide.');
    }
    return { kind: 'deferred', envelope: json.data };
  }

  private extractFileName(response: HttpResponse<Blob>): string {
    const cd = response.headers.get('Content-Disposition');
    if (!cd) return 'presentation.pptx';
    const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
    return m?.[1] ? decodeURIComponent(m[1]) : 'presentation.pptx';
  }

  private expandDownloadUrl(url: string): string {
    if (!url) return url;
    if (/^https?:/i.test(url)) return url;
    const apiBase = environment.apiUrl.replace(/\/api\/?$/, '');
    return url.startsWith('/api') ? `${apiBase}${url}` : `${environment.apiUrl}${url.startsWith('/') ? '' : '/'}${url}`;
  }

  private async parseError(error: unknown): Promise<PowerPointExportError> {
    if (error instanceof HttpErrorResponse) {
      const status = error.status;
      let message = this.friendlyHttpMessage(error);
      let details: string[] | undefined;
      let code: string | undefined;

      const payload = error.error;
      if (payload instanceof Blob) {
        const api = await this.readApiResponseFromBlob(payload);
        if (api?.message) message = api.message;
        if (api?.errors?.length) details = api.errors;
        if (api?.code) code = api.code;
      } else if (payload && typeof payload === 'object') {
        const api = payload as ApiResponse<unknown>;
        if (api?.message) message = api.message;
        if (api?.errors?.length) details = api.errors;
        if (api?.code) code = api.code;
      } else if (typeof payload === 'string' && payload.trim()) {
        message = payload;
      }

      if (details?.length && code === 'Validation') {
        message = details[0];
      }

      return this.localizeKnownExportError({ status, code, message, details });
    }
    return { status: 0, message: $localize`:@@ai-assistant.powerpoint-export.ts.erreur.reseau.inattendue.540e83b7:Erreur réseau inattendue.` };
  }

  private friendlyHttpMessage(error: HttpErrorResponse): string {
    if (error.status === 0) return 'Impossible de joindre le serveur. Vérifiez votre connexion.';
    if (error.status === 400 && error.message === 'Http failure response for unknown url: 400 Unknown Error') {
      return 'La requête d\'export a été rejetée par le serveur.';
    }
    if (error.message?.includes('Unknown Error')) {
      return 'Erreur serveur lors de l\'export PowerPoint.';
    }
    return error.message || 'Erreur inattendue.';
  }

  private async readApiResponseFromBlob(blob: Blob): Promise<ApiResponse<unknown> | null> {
    try {
      const text = await blob.text();
      if (!text.trim()) {
        return null;
      }
      return JSON.parse(text) as ApiResponse<unknown>;
    } catch {
      return null;
    }
  }

  private localizeKnownExportError(error: PowerPointExportError): PowerPointExportError {
    switch (error.code) {
      case 'Validation':
        return {
          ...error,
          message: error.details?.[0] ?? error.message ?? $localize`:@@ai-assistant.powerpoint-export.ts.donnees.d.export.invalides.d3bbbcac:Données d'export invalides.`
        };
      case 'PowerPoint.GenerationFailed':
        return {
          ...error,
          message:
            error.message ||
            $localize`:@@ai-assistant.powerpoint-export.ts.impossible.de.generer.la.presentation.re.48d20bf9:Impossible de générer la présentation. Réessayez avec un autre thème ou désactivez certaines options.`
        };
      case 'PowerPoint.MessageNotFound':
        return {
          ...error,
          message:
            $localize`:@@ai-assistant.powerpoint-export.ts.cette.reponse.n.est.pas.encore.synchroni.2644e801:Cette réponse n'est pas encore synchronisée avec le serveur. Réessayez dans quelques secondes.`
        };
      case 'PowerPoint.ConversationNotFound':
        return {
          ...error,
          message: error.message || $localize`:@@ai-assistant.powerpoint-export.ts.la.conversation.selectionnee.est.introuv.bf62cb67:La conversation sélectionnée est introuvable.`
        };
      case 'Forbidden':
        return {
          ...error,
          message: error.message || $localize`:@@ai-assistant.powerpoint-export.ts.vous.n.etes.pas.autorise.a.exporter.cett.4b377da5:Vous n'êtes pas autorisé à exporter cette conversation.`
        };
      case 'Export.NotFound':
        return {
          ...error,
          message: error.message || $localize`:@@ai-assistant.powerpoint-export.ts.le.lien.de.telechargement.est.invalide.o.c3cd05f1:Le lien de téléchargement est invalide ou expiré.`
        };
      default:
        return error;
    }
  }
}
