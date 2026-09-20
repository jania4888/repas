import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, firstValueFrom } from 'rxjs';
import { environment } from '@environments/environment';
import { createHttpContextSkipGlobalErrorUi } from '@core/http-context';
import { AuthService } from '@core/services/auth.service';
import { ApiResponse } from '@core/services/client.service';
import { ChatStreamEvent } from '@features/ai-assistant/models/ai-chat.models';
import { ReportResult } from '@shared/studio-runtime/studio-runtime.models';
import {
  ImportCustomSystemRequest,
  StudioAiCapabilitiesDto,
  StudioAiPlanCreationResponse,
  StudioAiPlanListItemDto,
  StudioAiPlanListQuery,
  StudioAiPlanPreviewDto,
  StudioAiPlanSpecDto,
  StudioAiSpecValidationDto,
  StudioDuplicateHint,
  StudioPagedResult,
  StudioSummaryRelation,
  StudioSystemExportDto,
  StudioTemplateDetailDto,
  StudioTemplateListItemDto,
  UpdateStudioAiPlanSpecResponse
} from './ai/studio-ai.models';

/** Étape de l'aperçu (checklist) d'un plan Studio IA. */
export interface StudioPlanStep {
  key: string;
  label: string;
  detail: string;
}

export interface StudioPlanEntity {
  displayName: string;
  fieldCount: number;
  relationCount: number;
  /** Clé de la table existante réutilisée (omise par le serveur si null). */
  existingKey?: string | null;
  /** Vues enregistrées proposées (PR 2.5) ; omis par les résumés antérieurs. */
  viewCount?: number;
}

export interface StudioSummaryWorkflowStep { key: string; type: string; label: string; }
export interface StudioSummaryWorkflow {
  key: string; name: string; trigger: string; stepCount: number; steps: StudioSummaryWorkflowStep[]; isActive: boolean;
  /** Additifs (D-43-03, Q-1) : table cible du workflow ; `summary.entities[0]` reste le repli. */
  entityKey?: string; entityDisplayName?: string;
}

/** Contenu de `summaryJson` — miroir de `StudioAiPlanSummary.PlanSummary` côté backend. */
export interface StudioPlanSummary {
  kind: string;
  title: string;
  steps: StudioPlanStep[];
  entities: StudioPlanEntity[];
  warnings: string[];
  /** Présent pour un plan d'ÉTAT : quelques lignes réelles, pour valider sur des chiffres. */
  sample?: ReportResult | null;
  /** Doublons probables avec des tables existantes (PR 1.3) ; toujours émis, vide par défaut. */
  duplicates?: StudioDuplicateHint[];
  /** Relations N-N déclarées (PR 2.2) ; `null`/omis avant. */
  relations?: StudioSummaryRelation[] | null;
  /** Workflows proposés (PR 4.3c, plan `Workflow`) ; `[]` sinon. Contrat figé A-43/A-44b. */
  workflows?: StudioSummaryWorkflow[] | null;
}

/** Payload de l'événement SSE `studio_report_result` (retour de l'outil studio_run_report). */
export interface StudioReportResultEvent {
  success: boolean;
  title: string;
  source: string;
  sourceLabel: string;
  preset?: string | null;
  result: ReportResult;
  warnings: string[];
  message: string;
}

/** Une reformulation proposée après un échec d'état. */
export interface StudioReportSuggestion {
  preset: string;
  label: string;
  prompt: string;
}

/**
 * Payload de l'événement SSE `studio_report_error` — miroir de `StudioReportFailurePayload`.
 * Les champs `code` / `stage` / `retryable` / `traceId` sont optionnels et purement additifs : le
 * backend peut les émettre pour une classification exacte ; leur absence n'affecte pas les clients
 * historiques, qui se rabattent sur l'heuristique de `studio-ai-failure.util.ts`.
 */
export interface StudioReportFailureEvent {
  message: string;
  preset?: string | null;
  title?: string | null;
  periodLabel?: string | null;
  suggestions: StudioReportSuggestion[];
  code?: string | null;
  stage?: string | null;
  retryable?: boolean | null;
  traceId?: string | null;
}

/** Payload de l'événement SSE `studio_plan` (retour de l'outil studio_plan_*). */
export interface StudioPlanEvent {
  success: boolean;
  requiresConfirmation: boolean;
  planId: string;
  kind: string;
  status: string;
  expiresAt: string;
  summary: StudioPlanSummary;
  message: string;
}

/** Miroir de `StudioAiPlanDto`. */
export interface StudioAiPlanDto {
  id: string;
  kind: string;
  status: string;
  summaryJson: string;
  resultJson?: string;
  errorMessage?: string;
  createdAt: string;
  expiresAt: string;
  executedAt?: string;
}

/**
 * Cycle de vie des plans Studio IA. La confirmation est un POST SSE : l'exécution est
 * déterministe côté serveur (aucun LLM) et la progression arrive étape par étape.
 */
@Injectable({ providedIn: 'root' })
export class StudioAiBuildService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly baseUrl = `${environment.apiUrl}/studio/ai/plans`;
  private readonly templatesUrl = `${environment.apiUrl}/studio/templates`;
  private readonly capabilitiesUrl = `${environment.apiUrl}/ai/studio/capabilities`;
  private readonly systemsUrl = `${environment.apiUrl}/studio/systems`;

  getPlan(planId: string): Observable<ApiResponse<StudioAiPlanDto>> {
    return this.http.get<ApiResponse<StudioAiPlanDto>>(`${this.baseUrl}/${encodeURIComponent(planId)}`);
  }

  // ---- Workbench (P0) : tous ces appels renvoient 404 quand `EnableStudioAiWorkbench` est faux. -------
  // Les erreurs sont gérées inline par l'atelier (bannières / messages) : on coupe le toast global.

  /** `GET api/ai/studio/capabilities` — pilote l'aiguillage legacy / atelier et l'état des cartes. */
  getCapabilities(): Observable<ApiResponse<StudioAiCapabilitiesDto>> {
    return this.http.get<ApiResponse<StudioAiCapabilitiesDto>>(this.capabilitiesUrl, { context: createHttpContextSkipGlobalErrorUi() });
  }

  /** Historique paginé des plans du propriétaire (`pageSize` ≤ 50 côté serveur). */
  listPlans(query: StudioAiPlanListQuery = {}): Observable<ApiResponse<StudioPagedResult<StudioAiPlanListItemDto>>> {
    let params = new HttpParams()
      .set('page', String(query.page ?? 1))
      .set('pageSize', String(Math.min(query.pageSize ?? 20, 50)));
    if (query.status) params = params.set('status', query.status);
    if (query.kind) params = params.set('kind', query.kind);
    return this.http.get<ApiResponse<StudioPagedResult<StudioAiPlanListItemDto>>>(this.baseUrl, {
      params,
      context: createHttpContextSkipGlobalErrorUi()
    });
  }

  /** Spec canonique + `rowVersion` d'un plan (nécessaire à l'aperçu détaillé et à l'édition). */
  getPlanSpec(planId: string): Observable<ApiResponse<StudioAiPlanSpecDto>> {
    return this.http.get<ApiResponse<StudioAiPlanSpecDto>>(`${this.baseUrl}/${encodeURIComponent(planId)}/spec`, {
      context: createHttpContextSkipGlobalErrorUi()
    });
  }

  /** Édition d'un plan en attente ; le serveur re-parse, recalcule le résumé et vérifie `rowVersion` (409 sinon). */
  updatePlanSpec(planId: string, specJson: string, rowVersion: string): Observable<ApiResponse<UpdateStudioAiPlanSpecResponse>> {
    return this.http.put<ApiResponse<UpdateStudioAiPlanSpecResponse>>(
      `${this.baseUrl}/${encodeURIComponent(planId)}/spec`,
      { specJson, rowVersion },
      { context: createHttpContextSkipGlobalErrorUi() }
    );
  }

  /** Validation serveur sans création : une spec invalide répond 400 (jamais `valid=false`). */
  validate(kind: string, specJson: string): Observable<ApiResponse<StudioAiSpecValidationDto>> {
    return this.http.post<ApiResponse<StudioAiSpecValidationDto>>(
      `${this.baseUrl}/validate`,
      { kind, specJson },
      { context: createHttpContextSkipGlobalErrorUi() }
    );
  }

  /** Modèle du catalogue → plan `Pending` (aucun appel au LLM). */
  createFromTemplate(templateKey: string, displayNameOverride?: string | null): Observable<ApiResponse<StudioAiPlanCreationResponse>> {
    return this.http.post<ApiResponse<StudioAiPlanCreationResponse>>(
      `${this.baseUrl}/from-template`,
      { templateKey, displayNameOverride: displayNameOverride || null },
      { context: createHttpContextSkipGlobalErrorUi() }
    );
  }

  /** Spec fournie → plan `Pending` (import P3 ; utilisé par les tests en P1). */
  createFromSpec(kind: string, specJson: string): Observable<ApiResponse<StudioAiPlanCreationResponse>> {
    return this.http.post<ApiResponse<StudioAiPlanCreationResponse>>(
      `${this.baseUrl}/from-spec`,
      { kind, specJson },
      { context: createHttpContextSkipGlobalErrorUi() }
    );
  }

  /** « Réinitialiser la conversation » : annule (n'efface jamais) les plans en attente ; renvoie leur nombre. */
  cancelPending(): Observable<ApiResponse<number>> {
    return this.http.post<ApiResponse<number>>(`${this.baseUrl}/cancel-pending`, {}, { context: createHttpContextSkipGlobalErrorUi() });
  }

  listTemplates(): Observable<ApiResponse<StudioTemplateListItemDto[]>> {
    return this.http.get<ApiResponse<StudioTemplateListItemDto[]>>(this.templatesUrl, { context: createHttpContextSkipGlobalErrorUi() });
  }

  getTemplate(key: string): Observable<ApiResponse<StudioTemplateDetailDto>> {
    return this.http.get<ApiResponse<StudioTemplateDetailDto>>(`${this.templatesUrl}/${encodeURIComponent(key)}`, {
      context: createHttpContextSkipGlobalErrorUi()
    });
  }

  cancel(planId: string): Observable<ApiResponse<StudioAiPlanDto>> {
    return this.http.post<ApiResponse<StudioAiPlanDto>>(`${this.baseUrl}/${encodeURIComponent(planId)}/cancel`, {});
  }

  /**
   * Confirme le plan et streame l'exécution : `studio_progress` (étapes live),
   * puis `studio_result` ou `error`, et enfin `done`.
   */
  confirm(planId: string): Observable<ChatStreamEvent> {
    return new Observable(subscriber => {
      const abort = new AbortController();
      const url = `${this.baseUrl}/${encodeURIComponent(planId)}/confirm`;

      const run = async (): Promise<void> => {
        // Hors pipeline d'intercepteurs Angular (fetch streaming) : on reproduit le
        // 401 → refresh → retry unique, comme AiStreamService.
        let response = await this.post(url, abort.signal);
        if (response.status === 401 && (await this.tryRefreshToken())) {
          response = await this.post(url, abort.signal);
        }
        if (!response.ok) {
          subscriber.error(new Error(this.httpMessage(response.status, response.statusText)));
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          subscriber.error(new Error('Réponse sans contenu.'));
          return;
        }

        const decoder = new TextDecoder();
        let buffer = '';

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
              if (event.type === 'done') {
                subscriber.complete();
                return;
              }
            } catch {
              // Ligne SSE malformée : ignorée (le flux continue).
            }
          }
        }
        subscriber.complete();
      };

      run().catch((err: unknown) => {
        if ((err as Error | undefined)?.name !== 'AbortError') subscriber.error(err);
      });

      return () => abort.abort();
    });
  }

  // ---- Aperçu enrichi (PR 3.4) : preview / replay de plan, export / duplication / import de système. ----

  /** `GET {id}/preview` — 404 tant que `EnableStudioAiPlanPreview` est coupé (géré localement). */
  getPlanPreview(planId: string): Observable<ApiResponse<StudioAiPlanPreviewDto>> {
    return this.http.get<ApiResponse<StudioAiPlanPreviewDto>>(`${this.baseUrl}/${encodeURIComponent(planId)}/preview`, {
      context: createHttpContextSkipGlobalErrorUi()
    });
  }

  /** `POST {id}/replay` ⇒ 201, même enveloppe que `from-template` ; 409 si le plan n'est pas rejouable. */
  replayPlan(planId: string): Observable<ApiResponse<StudioAiPlanCreationResponse>> {
    return this.http.post<ApiResponse<StudioAiPlanCreationResponse>>(
      `${this.baseUrl}/${encodeURIComponent(planId)}/replay`,
      {},
      { context: createHttpContextSkipGlobalErrorUi() }
    );
  }

  /** `GET systems/{key}/export?includeSeed=` — 404 tant que `EnableStudioSystemExport` est coupé. */
  exportSystem(key: string, includeSeed = false): Observable<ApiResponse<StudioSystemExportDto>> {
    const params = new HttpParams().set('includeSeed', includeSeed);
    return this.http.get<ApiResponse<StudioSystemExportDto>>(`${this.systemsUrl}/${encodeURIComponent(key)}/export`, {
      params,
      context: createHttpContextSkipGlobalErrorUi()
    });
  }

  /** `POST systems/{key}/duplicate` ⇒ 201 `StudioAiPlanCreationResponse` (plan « (copie) » en attente). */
  duplicateSystem(key: string, displayName?: string | null): Observable<ApiResponse<StudioAiPlanCreationResponse>> {
    return this.http.post<ApiResponse<StudioAiPlanCreationResponse>>(
      `${this.systemsUrl}/${encodeURIComponent(key)}/duplicate`,
      { displayName: displayName ?? null },
      { context: createHttpContextSkipGlobalErrorUi() }
    );
  }

  /** `POST systems/import` ⇒ 201 ; 400 `Validation.spec`, 413 au-delà de 512 Ko. */
  importSystem(req: ImportCustomSystemRequest): Observable<ApiResponse<StudioAiPlanCreationResponse>> {
    return this.http.post<ApiResponse<StudioAiPlanCreationResponse>>(
      `${this.systemsUrl}/import`,
      req,
      { context: createHttpContextSkipGlobalErrorUi() }
    );
  }

  private post(url: string, signal: AbortSignal): Promise<Response> {
    const token = this.auth.getAccessToken();
    return fetch(url, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal
    });
  }

  private async tryRefreshToken(): Promise<boolean> {
    try {
      const res = await firstValueFrom(this.auth.refreshToken());
      return !!(res?.success && res?.data);
    } catch {
      return false;
    }
  }

  private httpMessage(status: number, statusText: string): string {
    if (status === 401) return 'Session expirée. Reconnectez-vous, puis relancez la validation.';
    if (status === 403) return "Vous n'avez pas la permission de créer des tables Studio.";
    if (status === 404) return 'Ce plan est introuvable ou a expiré.';
    if (status === 409) return 'Ce plan a déjà été traité.';
    return `HTTP ${status} : ${statusText}`;
  }
}
