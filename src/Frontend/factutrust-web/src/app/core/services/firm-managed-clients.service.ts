import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@environments/environment';
import { ApiResponse } from './auth.service';

/**
 * Payload du wizard « Nouveau dossier client » (type Sage) : création par le cabinet
 * d'une société cliente gérée, sans compte utilisateur sur la plateforme.
 */
export interface CreateFirmManagedClient {
  // Étape 1 — Informations générales
  companyName: string;
  nif: string;
  legalForm?: number | null;
  rneIdentifier?: string | null;
  incorporationDate?: string | null;
  shareCapital?: number | null;
  street: string;
  streetLine2?: string | null;
  city: string;
  governorate: string;
  postalCode?: string | null;
  email?: string | null;
  phone: string;
  website?: string | null;
  // Étape 2 — Options comptables
  fiscalYearStartMonth: number;
  fiscalYearEndMonth: number;
  firstFiscalYear?: number | null;
  // Étape 3 — Options fiscales et sociales
  taxRegime: number;
  taxOffice?: string | null;
  isStandardRate?: number | null;
  cnssEmployeeRate?: number | null;
  cnssEmployerRate?: number | null;
  // Étape 4 — Paramètres du dossier cabinet
  annualFeeAmount?: number | null;
  billingFrequency?: number | null;
  billingNotes?: string | null;
  assignedAccountantUserId?: string | null;
  notes?: string | null;
}

export interface FirmManagedClientCreated {
  companyTenantId: string;
  assignmentId: string;
  companyName: string;
}

@Injectable({ providedIn: 'root' })
export class FirmManagedClientsService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/firm/managed-clients`;

  create(body: CreateFirmManagedClient): Observable<ApiResponse<FirmManagedClientCreated>> {
    return this.http.post<ApiResponse<FirmManagedClientCreated>>(this.base, body);
  }
}
