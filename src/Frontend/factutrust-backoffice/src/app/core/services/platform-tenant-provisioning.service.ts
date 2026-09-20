import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { catchError, map, Observable, of } from 'rxjs';
import { environment } from '@environments/environment';
import type { ApiResponse } from '@core/models/api-response.model';
import { extractApiError } from '@core/http/api-error';
import type {
  CompanyRegistrationSubmitRequest,
  CompanyRegistrationSubmitResult,
  FirmRegistrationSubmitRequest,
  FirmRegistrationSubmitResult,
  RegistrationWarning,
  TenantProvisioningStatusValue
} from '@core/registration/registration-wizard-mode';

export interface PlatformProvisionTenantResultDto {
  tenantId: string;
  /** Enum serialise en chaine par l'API : `Company` | `AccountingFirm`. */
  tenantKind: string;
  displayName: string;
  /** Enum serialise en chaine par l'API : `Ready` | `Pending` | `Failed`. */
  provisioningStatus: TenantProvisioningStatusValue;
  managerUserId: string;
  managerEmail: string;
  registrationWarnings?: RegistrationWarning[];
  correlationId: string;
}

const COMPANY_FALLBACK = "La création de l'entreprise a échoué.";
const FIRM_FALLBACK = 'La création du cabinet a échoué.';
const RETRY_FALLBACK = 'La reprise du provisionnement a échoué.';

export interface TenantProvisioningRetryResult {
  success: boolean;
  message?: string;
  reference?: string;
  httpStatus?: number;
}

interface TenantProvisioningRetryResultDto {
  tenantId: string;
  displayName: string;
  correlationId: string;
}

@Injectable({ providedIn: 'root' })
export class PlatformTenantProvisioningService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/platform/tenants`;

  createCompany(request: CompanyRegistrationSubmitRequest): Observable<CompanyRegistrationSubmitResult> {
    return this.http
      .post<ApiResponse<PlatformProvisionTenantResultDto>>(`${this.base}/companies`, request)
      .pipe(
        map(res => this.mapCompanyResponse(res)),
        // 400 / 409 / 429 / 500 sont des statuts d'erreur HTTP : le `map` ci-dessus n'est jamais
        // exécuté dans ces cas. Sans ce `catchError`, le motif métier renvoyé par le serveur
        // (NIF en double, mot de passe trop faible, domaine invalide…) n'atteint jamais l'écran.
        catchError((err: HttpErrorResponse) => of(this.mapHttpError(err, COMPANY_FALLBACK)))
      );
  }

  createAccountingFirm(request: FirmRegistrationSubmitRequest): Observable<FirmRegistrationSubmitResult> {
    return this.http
      .post<ApiResponse<PlatformProvisionTenantResultDto>>(`${this.base}/accounting-firms`, request)
      .pipe(
        map(res => this.mapFirmResponse(res)),
        catchError((err: HttpErrorResponse) => of(this.mapHttpError(err, FIRM_FALLBACK)))
      );
  }

  /**
   * Rejoue la phase 2 du provisionnement d'un dossier reste en `Pending` ou `Failed`.
   * Le serveur refuse (409) si le dossier est deja `Ready`.
   */
  retryProvisioning(tenantId: string): Observable<TenantProvisioningRetryResult> {
    return this.http
      .post<ApiResponse<TenantProvisioningRetryResultDto>>(`${this.base}/${tenantId}/provisioning/retry`, {})
      .pipe(
        map(res => ({
          success: res.success,
          message: res.message ?? undefined,
          reference: res.data?.correlationId
        })),
        catchError((err: HttpErrorResponse) => {
          const info = extractApiError(err, RETRY_FALLBACK);
          return of({
            success: false,
            message: info.message,
            reference: info.reference,
            httpStatus: info.httpStatus
          });
        })
      );
  }

  private mapCompanyResponse(res: ApiResponse<PlatformProvisionTenantResultDto>): CompanyRegistrationSubmitResult {
    if (res.success && res.data) {
      return {
        success: true,
        tenantId: res.data.tenantId,
        message: res.message ?? undefined,
        registrationWarnings: res.data.registrationWarnings,
        provisioningStatus: res.data.provisioningStatus,
        managerEmail: res.data.managerEmail,
        reference: res.data.correlationId
      };
    }
    // Défensif : aucun contrôleur ne renvoie aujourd'hui `success:false` sur un HTTP 200.
    return this.mapBodyFailure(res, COMPANY_FALLBACK);
  }

  private mapFirmResponse(res: ApiResponse<PlatformProvisionTenantResultDto>): FirmRegistrationSubmitResult {
    if (res.success && res.data) {
      return {
        success: true,
        tenantId: res.data.tenantId,
        message: res.message ?? undefined,
        provisioningStatus: res.data.provisioningStatus,
        managerEmail: res.data.managerEmail,
        reference: res.data.correlationId
      };
    }
    return this.mapBodyFailure(res, FIRM_FALLBACK);
  }

  private mapBodyFailure(
    res: ApiResponse<PlatformProvisionTenantResultDto>,
    fallback: string
  ): CompanyRegistrationSubmitResult & FirmRegistrationSubmitResult {
    const errors = res.errors?.length ? [...res.errors] : undefined;
    return {
      success: false,
      message: errors?.join(' ') ?? res.message ?? res.error ?? fallback,
      errors,
      reference: res.code ?? undefined
    };
  }

  private mapHttpError(
    err: HttpErrorResponse,
    fallback: string
  ): CompanyRegistrationSubmitResult & FirmRegistrationSubmitResult {
    const info = extractApiError(err, fallback);
    return {
      success: false,
      message: info.message,
      reference: info.reference,
      httpStatus: info.httpStatus
    };
  }
}
