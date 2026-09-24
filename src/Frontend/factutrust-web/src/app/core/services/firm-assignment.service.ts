import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '@environments/environment';
import { ApiResponse } from './auth.service';

export interface AccountingFirmDirectoryItem {
  firmTenantId: string;
  displayName: string;
  city: string;
  governorate: string;
  description?: string;
  professionalRegistrationNumber?: string;
  practiceAreas?: string[];
  clientSegments?: string[];
  languages?: string[];
  teamSizeBand?: string | null;
  acceptsRemote?: boolean | null;
  yearsOfExperience?: number | null;
  publicWebsite?: string | null;
  sameGovernorate?: boolean;
}

export interface AccountingFirmDirectoryQuery {
  search?: string;
  governorate?: string;
  practiceArea?: string;
  language?: string;
  clientSegment?: string;
  remote?: boolean;
  page?: number;
  pageSize?: number;
}

export interface AccountingFirmDirectoryPage {
  success: boolean;
  message?: string | null;
  items: AccountingFirmDirectoryItem[];
  totalCount: number;
  page: number;
  companyGovernorate?: string | null;
}

export interface AccountingFirmProfile {
  tenantId: string;
  displayName: string;
  description?: string | null;
  city: string;
  governorate: string;
  isPublicInDirectory: boolean;
  professionalRegistrationNumber?: string | null;
  contactEmail: string;
  contactPhone: string;
  practiceAreas: string[];
  clientSegments: string[];
  languages: string[];
  teamSizeBand?: string | null;
  acceptsRemote?: boolean | null;
  yearsOfExperience?: number | null;
  publicWebsite?: string | null;
  completeness: number;
  missing: string[];
}

export interface CompanyProfileSnapshot {
  schemaVersion: number;
  capturedAtUtc: string;
  companyName: string;
  tradeName?: string;
  nif: string;
  taxRegime: number;
  rneIdentifier?: string;
  street: string;
  streetLine2?: string;
  city: string;
  governorate: string;
  postalCode?: string;
  email: string;
  phone?: string;
}

export interface FirmClientAssignment {
  id: string;
  companyTenantId: string;
  companyName: string;
  firmTenantId: string;
  firmDisplayName: string;
  status: number | string;
  statusDisplay: string;
  requestedAt: string;
  respondedAt?: string;
  revokedAt?: string;
  notes?: string;
  rejectionReason?: string;
  companyProfile?: CompanyProfileSnapshot;
  firmCity?: string | null;
  firmGovernorate?: string | null;
  firmPracticeAreas?: string[];
  firmContactEmail?: string | null;
  firmContactPhone?: string | null;
  /** True si le dossier a été créé et est géré par le cabinet (client sans compte plateforme). */
  isFirmManaged?: boolean;
}

export interface FirmClientDossier {
  assignmentId: string;
  companyTenantId: string;
  companyName: string;
  activeSince: string;
  hasPermanentFile?: boolean;
  permanentFileStatus?: number | null;
  permanentFileStatusDisplay?: string | null;
  assignedAccountantUserId?: string | null;
  assignedAccountantName?: string | null;
  isAwaitingAccountantAssignment?: boolean;
  /** True si le dossier a été créé et est géré par le cabinet (client sans compte plateforme). */
  isFirmManaged?: boolean;
}

@Injectable({ providedIn: 'root' })
export class FirmAssignmentService {
  private readonly http = inject(HttpClient);
  private readonly firmsUrl = `${environment.apiUrl}/accounting-firms`;
  private readonly assignmentsUrl = `${environment.apiUrl}/firm-assignments`;

  searchDirectory(query: AccountingFirmDirectoryQuery = {}): Observable<AccountingFirmDirectoryPage> {
    let params = new HttpParams();
    const set = (key: string, value: string | number | boolean | undefined | null) => {
      if (value === undefined || value === null || value === '') return;
      params = params.set(key, String(value));
    };
    set('search', query.search);
    set('governorate', query.governorate);
    set('practiceArea', query.practiceArea);
    set('language', query.language);
    set('clientSegment', query.clientSegment);
    if (query.remote === true) set('remote', true);
    set('page', query.page);
    set('pageSize', query.pageSize);

    return this.http
      .get<ApiResponse<AccountingFirmDirectoryItem[]>>(`${this.firmsUrl}/directory`, { params, observe: 'response' })
      .pipe(
        map(res => {
          const body = res.body;
          const items = body?.success && body.data ? body.data : [];
          const encoded = res.headers.get('X-Company-Governorate');
          let companyGovernorate: string | null = null;
          if (encoded) {
            try {
              companyGovernorate = decodeURIComponent(encoded);
            } catch {
              companyGovernorate = encoded;
            }
          }
          return {
            success: body?.success ?? false,
            message: body?.message,
            items,
            totalCount: Number(res.headers.get('X-Total-Count') ?? items.length),
            page: Number(res.headers.get('X-Page') ?? query.page ?? 1),
            companyGovernorate
          };
        })
      );
  }

  getMyProfile(): Observable<ApiResponse<AccountingFirmProfile>> {
    return this.http.get<ApiResponse<AccountingFirmProfile>>(`${this.firmsUrl}/me/profile`);
  }

  updateMyProfile(profile: Partial<AccountingFirmProfile>): Observable<ApiResponse<unknown>> {
    return this.http.put<ApiResponse<unknown>>(`${this.firmsUrl}/me/profile`, profile);
  }

  getCompanyCurrent(): Observable<ApiResponse<FirmClientAssignment | null>> {
    return this.http.get<ApiResponse<FirmClientAssignment | null>>(`${this.assignmentsUrl}/company/current`);
  }

  getCompanyHistory(): Observable<ApiResponse<FirmClientAssignment[]>> {
    return this.http.get<ApiResponse<FirmClientAssignment[]>>(`${this.assignmentsUrl}/company/history`);
  }

  requestAssignment(firmTenantId: string, notes?: string): Observable<ApiResponse<FirmClientAssignment>> {
    return this.http.post<ApiResponse<FirmClientAssignment>>(this.assignmentsUrl, { firmTenantId, notes });
  }

  revokeByCompany(): Observable<ApiResponse<unknown>> {
    return this.http.delete<ApiResponse<unknown>>(`${this.assignmentsUrl}/company/current`);
  }

  cancelPendingRequest(): Observable<ApiResponse<unknown>> {
    return this.http.delete<ApiResponse<unknown>>(`${this.assignmentsUrl}/company/pending`);
  }

  getIncomingInvitations(context?: HttpContext): Observable<ApiResponse<FirmClientAssignment[]>> {
    return this.http.get<ApiResponse<FirmClientAssignment[]>>(`${this.assignmentsUrl}/firm/incoming`, {
      context
    });
  }

  getActiveClients(): Observable<ApiResponse<FirmClientDossier[]>> {
    return this.http.get<ApiResponse<FirmClientDossier[]>>(`${this.assignmentsUrl}/firm/clients`);
  }

  acceptInvitation(assignmentId: string): Observable<ApiResponse<unknown>> {
    return this.http.post<ApiResponse<unknown>>(`${this.assignmentsUrl}/firm/${assignmentId}/accept`, {});
  }

  rejectInvitation(assignmentId: string, reason?: string): Observable<ApiResponse<unknown>> {
    return this.http.post<ApiResponse<unknown>>(`${this.assignmentsUrl}/firm/${assignmentId}/reject`, { reason });
  }

  revokeClient(assignmentId: string): Observable<ApiResponse<unknown>> {
    return this.http.delete<ApiResponse<unknown>>(`${this.assignmentsUrl}/firm/${assignmentId}`);
  }
}
