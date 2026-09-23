import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { createHttpContextSkipGlobalErrorUi } from '@core/http-context';
import { environment } from '@environments/environment';
import { ApiResponse, PagedResult } from './client.service';

/** Aligné sur le backend : tranche IS pour RS7 (achats ≥ seuil TTC). */
export enum SupplierRs7IsBracket {
    Unspecified = 0,
    Normal25 = 1,
    Reduced15 = 2,
    Reduced10 = 3
}

export interface Supplier {
    id: string;
    name: string;
    type: SupplierType;
    typeDisplay: string;
    nif: string | null;
    email: string | null;
    phone: string | null;
    contactPerson: string | null;
    paymentTermDays: number;
    notes: string | null;
    isActive: boolean;
    address: SupplierAddress;
    createdAt: string;
    updatedAt: string | null;
    tejIdentificationType?: number | null;
    dateOfBirth?: string | null;
    countryCode?: string | null;
    isResident?: boolean;
    activity?: string | null;
    isSubjectToWithholding?: boolean;
    defaultWithholdingTaxTypeId?: string | null;
    defaultWithholdingRate?: number | null;
    /** API: chaîne PascalCase ("Reduced15") ou entier legacy. */
    rs7IsBracket?: SupplierRs7IsBracket | string | null;
    defaultWithholdingTaxTypeCode?: string | null;
    defaultWithholdingTaxTypeLabel?: string | null;
}

export interface SupplierAddress {
    street: string;
    streetLine2: string | null;
    city: string;
    postalCode: string | null;
    governorate: string;
    country: string;
    fullAddress: string;
}

export enum SupplierType {
    Individual = 0,
    Business = 1
}

export interface SupplierListItem {
    id: string;
    name: string;
    type: string;
    typeDisplay: string;
    nif: string | null;
    email: string | null;
    phone: string | null;
    city: string;
    governorate: string;
    contactPerson: string | null;
    paymentTermDays: number;
    isActive: boolean;
    totalOrders: number;
}

export interface SupplierSearchParams {
    search?: string;
    type?: SupplierType;
    isActive?: boolean;
    page?: number;
    pageSize?: number;
    /** Skip global 403/error modals (auxiliary dropdown loads). */
    skipGlobalErrorUi?: boolean;
}

/** Totaux agrégés (backend) de la liste des fournisseurs, sur l'ensemble filtré complet. */
export interface SupplierListSummary {
    count: number;
    activeCount: number;
    inactiveCount: number;
}

export interface CreateSupplierRequest {
    name: string;
    type: SupplierType;
    nif?: string;
    street: string;
    streetLine2?: string;
    city: string;
    postalCode?: string;
    governorate: string;
    email: string | null;
    phone?: string;
    contactPerson?: string;
    paymentTermDays: number;
    notes?: string;
    tejIdentificationType?: number | null;
    dateOfBirth?: string | null;
    countryCode?: string | null;
    isResident?: boolean;
    activity?: string | null;
    isSubjectToWithholding?: boolean;
    defaultWithholdingTaxTypeId?: string | null;
    defaultWithholdingRate?: number | null;
    rs7IsBracket?: SupplierRs7IsBracket | string | null;
}

export interface UpdateSupplierRequest {
    name: string;
    street: string;
    streetLine2?: string;
    city: string;
    postalCode?: string;
    governorate: string;
    email: string | null;
    phone?: string;
    contactPerson?: string;
    paymentTermDays: number;
    notes?: string;
    tejIdentificationType?: number | null;
    dateOfBirth?: string | null;
    countryCode?: string | null;
    isResident?: boolean;
    activity?: string | null;
    isSubjectToWithholding?: boolean;
    defaultWithholdingTaxTypeId?: string | null;
    defaultWithholdingRate?: number | null;
    rs7IsBracket?: SupplierRs7IsBracket | string | null;
}

const EMPTY_GUID = '00000000-0000-0000-0000-000000000000';

export type SupplierConflictField = 'email' | 'nif';

export interface SupplierCreateConflict {
    field: SupplierConflictField;
    existingSupplierId: string | null;
}

/** Mappe le corps 409 de POST /api/suppliers (metadata existingSupplierId + field). */
export function parseSupplierCreateConflict(
    err: { error?: { data?: unknown } } | null | undefined,
    message: string
): SupplierCreateConflict {
    const data = err?.error?.data;
    const record = data && typeof data === 'object' && !Array.isArray(data)
        ? data as Record<string, unknown>
        : null;

    const rawField = typeof record?.['field'] === 'string'
        ? String(record['field']).toLowerCase()
        : '';
    let field: SupplierConflictField = 'email';
    if (rawField === 'nif' || rawField === 'email') {
        field = rawField;
    } else {
        const lower = (message || '').toLowerCase();
        if (lower.includes('matricule') || lower.includes('nif')) {
            field = 'nif';
        }
    }

    let existingSupplierId: string | null = null;
    if (typeof data === 'string' && isRealGuid(data)) {
        existingSupplierId = data;
    } else if (record) {
        const rawId = record['existingSupplierId'] ?? record['ExistingSupplierId'];
        if (typeof rawId === 'string' && isRealGuid(rawId)) {
            existingSupplierId = rawId;
        }
    }

    return { field, existingSupplierId };
}

function isRealGuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
        && value !== EMPTY_GUID;
}

@Injectable({
    providedIn: 'root'
})
export class SupplierService {
    private readonly API_URL = `${environment.apiUrl}/suppliers`;
    private http = inject(HttpClient);

    getSuppliers(params: SupplierSearchParams = {}): Observable<ApiResponse<PagedResult<SupplierListItem>>> {
        const skipGlobalErrorUi = params.skipGlobalErrorUi === true;
        let httpParams = new HttpParams();

        if (params.search) httpParams = httpParams.set('search', params.search);
        if (params.type !== undefined) httpParams = httpParams.set('type', params.type.toString());
        if (params.isActive !== undefined) httpParams = httpParams.set('isActive', params.isActive.toString());
        if (params.page) httpParams = httpParams.set('page', params.page.toString());
        if (params.pageSize) httpParams = httpParams.set('pageSize', params.pageSize.toString());

        const opts: { params: HttpParams; context?: ReturnType<typeof createHttpContextSkipGlobalErrorUi> } = {
            params: httpParams
        };
        if (skipGlobalErrorUi) {
            opts.context = createHttpContextSkipGlobalErrorUi();
        }
        return this.http.get<ApiResponse<PagedResult<SupplierListItem>>>(this.API_URL, opts);
    }

    /** Totaux agrégés respectant les mêmes filtres que {@link getSuppliers} (calcul backend). */
    getSuppliersSummary(params: SupplierSearchParams = {}): Observable<ApiResponse<SupplierListSummary>> {
        let httpParams = new HttpParams();
        if (params.search) httpParams = httpParams.set('search', params.search);
        if (params.type !== undefined) httpParams = httpParams.set('type', params.type.toString());
        if (params.isActive !== undefined) httpParams = httpParams.set('isActive', params.isActive.toString());
        return this.http.get<ApiResponse<SupplierListSummary>>(`${this.API_URL}/summary`, { params: httpParams });
    }

    getSupplier(id: string): Observable<ApiResponse<Supplier>> {
        return this.http.get<ApiResponse<Supplier>>(`${this.API_URL}/${id}`);
    }

    createSupplier(request: CreateSupplierRequest): Observable<ApiResponse<string>> {
        // Le formulaire (et la création rapide) affichent le 409 en inline :
        // pas de toast global pour éviter le doublon.
        return this.http.post<ApiResponse<string>>(this.API_URL, request, {
            context: createHttpContextSkipGlobalErrorUi()
        });
    }

    updateSupplier(id: string, request: UpdateSupplierRequest): Observable<ApiResponse<Supplier>> {
        return this.http.put<ApiResponse<Supplier>>(`${this.API_URL}/${id}`, request);
    }

    toggleActive(id: string): Observable<ApiResponse<Supplier>> {
        return this.http.patch<ApiResponse<Supplier>>(`${this.API_URL}/${id}/toggle-active`, {});
    }

    getActiveSuppliers(): Observable<ApiResponse<PagedResult<SupplierListItem>>> {
        const params = new HttpParams().set('isActive', 'true').set('pageSize', '200');
        return this.http.get<ApiResponse<PagedResult<SupplierListItem>>>(this.API_URL, { params });
    }

    deleteSupplier(id: string): Observable<ApiResponse<object>> {
        return this.http.delete<ApiResponse<object>>(`${this.API_URL}/${id}`);
    }
}
