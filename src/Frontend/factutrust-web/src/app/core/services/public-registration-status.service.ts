import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, map, of, shareReplay, timeout } from 'rxjs';
import { environment } from '@environments/environment';
import { createHttpContextPublicAnonymous } from '@core/http-context';

/** Réponse de `GET /api/public/registration-status` (`PublicRegistrationStatusController.cs`). */
export interface PublicRegistrationStatus {
  companyEnabled: boolean;
  firmEnabled: boolean;
}

/** Enveloppe camelCase émise par `FactuTrust.API/Controllers/ApiResponse.cs`. */
interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  message?: string | null;
  error?: string | null;
}

const CLOSED: PublicRegistrationStatus = { companyEnabled: false, firmEnabled: false };

/**
 * État d'ouverture des inscriptions publiques, partagé entre tous les CTA de la landing.
 * Un seul appel réseau par chargement de page ; toute erreur ou dépassement de délai ⇒ « fermé »
 * (le CTA bascule alors vers le formulaire de contact — plan § 4.2).
 *
 * L'état effectif combine la réponse API et les flags de build : `publicRegistrationGuard`
 * lit `environment.publicRegistration.*` et `login.component.ts` conditionne l'inscription cabinet
 * à `environment.accountingFirmsEnabled` ; ne jamais afficher un lien que la route refuserait.
 */
@Injectable({ providedIn: 'root' })
export class PublicRegistrationStatusService {
  private readonly http = inject(HttpClient);
  private readonly remote = signal<PublicRegistrationStatus>(CLOSED);
  private readonly loadedSig = signal(false);
  private request$?: Observable<PublicRegistrationStatus>;

  /** Vrai dès que la réponse (ou l'erreur / le délai) est connue. */
  readonly loaded = this.loadedSig.asReadonly();

  readonly companyOpen = computed(
    () => this.loadedSig() && this.remote().companyEnabled && environment.publicRegistration.companyEnabled
  );

  readonly firmOpen = computed(
    () =>
      this.loadedSig() &&
      this.remote().firmEnabled &&
      environment.publicRegistration.firmEnabled &&
      environment.accountingFirmsEnabled
  );

  /** Idempotent : ne déclenche l'appel qu'une fois. */
  ensureLoaded(): void {
    if (this.request$) {
      return;
    }
    this.request$ = this.http
      .get<ApiEnvelope<PublicRegistrationStatus>>(`${environment.apiUrl}/public/registration-status`, {
        context: createHttpContextPublicAnonymous()
      })
      .pipe(
        timeout(environment.landing.registrationStatusTimeoutMs),
        map(res =>
          res?.success && res.data
            ? { companyEnabled: res.data.companyEnabled === true, firmEnabled: res.data.firmEnabled === true }
            : CLOSED
        ),
        catchError(() => of(CLOSED)),
        shareReplay(1)
      );
    this.request$.subscribe(status => {
      this.remote.set(status);
      this.loadedSig.set(true);
    });
  }

  /** Dernière valeur connue (tests, rechargement après changement de langue — pas de nouvel appel). */
  snapshot(): PublicRegistrationStatus {
    return this.remote();
  }
}
