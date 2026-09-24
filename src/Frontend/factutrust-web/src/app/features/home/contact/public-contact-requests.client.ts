import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, timeout } from 'rxjs';
import { environment } from '@environments/environment';
import { createHttpContextPublicAnonymous } from '@core/http-context';
import type { ContactRequestAccepted, CreateContactRequestDto, PublicApiEnvelope } from './contact-request.models';

export const CONTACT_REQUEST_TIMEOUT_MS = 15_000;

/**
 * `POST /api/public/contact-requests` (anonyme, sans jeton, sans toast global : le formulaire
 * gère ses propres messages via `mapContactSubmitError`). Réponse nominale 202 `{ data: { reference } }`.
 */
@Injectable({ providedIn: 'root' })
export class PublicContactRequestsClient {
  private readonly http = inject(HttpClient);
  readonly baseUrl = `${environment.apiUrl}/public/contact-requests`;

  submit(dto: CreateContactRequestDto): Observable<ContactRequestAccepted> {
    return this.http
      .post<PublicApiEnvelope<ContactRequestAccepted>>(this.baseUrl, dto, { context: createHttpContextPublicAnonymous() })
      .pipe(
        timeout(CONTACT_REQUEST_TIMEOUT_MS),
        map(res => ({ reference: res?.data?.reference ?? '' }))
      );
  }
}
