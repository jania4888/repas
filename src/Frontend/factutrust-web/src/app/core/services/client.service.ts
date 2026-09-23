import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams, HttpContext } from '@angular/common/http';
import { SKIP_ERROR_TOAST, createHttpContextSkipGlobalErrorUi } from '@core/http-context';
import { Observable } from 'rxjs';
import { environment } from '@environments/environment';

export interface Client {
  id: string;
  code: string;
  name: string;
  email: string | null;
  phone: string;
  nif: string;
  type: ClientType;
  typeDisplay: string;
  address: ClientAddress;
  fullAddress?: string;
  isActive: boolean;
  notes: string | null;
  contactPerson: string | null;
  /** Plafond d'encours en TND. null = pas de plafond. */
  creditLimit?: number | null;
  /** Délai de règlement habituel en jours. null = non renseigné. */
  defaultPaymentTermDays?: number | null;
  totalInvoices?: number;
  totalRevenue?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ClientAddress {
  street: string;
  streetLine2: string | null;
  city: string;
  postalCode: string | null;
  governorate: string;
  country: string;
}

export enum ClientType {
  Individual = 'Individual',
  Business = 'Business',
  Government = 'Government',
  Association = 'Association'
}

export interface ClientListItem {
  id: string;
  code: string;
  name: string;
  email: string | null;
  phone: string;
  nif: string;
  type: ClientType;
  typeDisplay: string;
  city: string;
  governorate: string;
  isActive: boolean;
  totalInvoices: number;
  totalRevenue: number;
  creditLimit?: number | null;
  defaultPaymentTermDays?: number | null;
}

export interface ClientSearchParams {
  search?: string;
  type?: ClientType;
  isActive?: boolean;
  governorate?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  /** When true, global 403 modal / toast is suppressed (e.g. dashboard aggregate). */
  skipGlobalErrorUi?: boolean;
}

/** Totaux agrégés (backend) de la liste des clients, sur l'ensemble filtré complet. */
export interface ClientListSummary {
  count: number;
  activeCount: number;
  inactiveCount: number;
}

export interface CreateClientRequest {
  name: string;
  email: string | null;
  phone?: string;
  nif?: string;
  type: ClientType;
  street: string;
  streetLine2?: string;
  city: string;
  postalCode?: string;
  governorate: string;
  country?: string;
  contactPerson?: string;
  notes?: string;
  /** Plafond d'encours en TND. null = pas de plafond. */
  creditLimit?: number | null;
  /** Délai de règlement habituel en jours. null = non renseigné. */
  defaultPaymentTermDays?: number | null;
}

export interface UpdateClientRequest extends CreateClientRequest {
  isActive: boolean;
}

export interface PagedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}


/**
 * Encours d'un client : ce qu'il doit, et ce qu'il s'apprete a devoir.
 *
 * ⚠️ `isOverLimit` est purement informatif. Aucun ecran ne doit refuser une operation sur
 * cette base — decision produit : on avertit, le commercial decide.
 */
export interface ClientOutstanding {
  clientId: string;
  clientName: string;
  /** Factures emises et non soldees : TTC restant apres encaissements. */
  unpaidInvoicesAmount: number;
  /** Commandes confirmees pas encore facturees : un engagement, pas encore une creance. */
  confirmedOrdersAmount: number;
  totalOutstanding: number;
  creditLimit: number | null;
  /** Negatif en depassement, null si le client n'a pas de plafond. */
  availableCredit: number | null;
  isOverLimit: boolean;
  unpaidInvoiceCount: number;
  /** Echu depuis plus de 30 jours — le signal qui appelle une relance. */
  overdueAmount: number;
  currency: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message: string | null;
  errors: string[];
}

@Injectable({
  providedIn: 'root'
})
export class ClientService {
  private readonly API_URL = `${environment.apiUrl}/clients`;
  private http = inject(HttpClient);

  getClients(params: ClientSearchParams = {}): Observable<ApiResponse<PagedResult<ClientListItem>>> {
    const skipGlobalErrorUi = params.skipGlobalErrorUi === true;
    let httpParams = new HttpParams();
    
    if (params.search) httpParams = httpParams.set('search', params.search);
    if (params.type !== undefined) httpParams = httpParams.set('type', params.type.toString());
    if (params.isActive !== undefined) httpParams = httpParams.set('isActive', params.isActive.toString());
    if (params.governorate) httpParams = httpParams.set('governorate', params.governorate);
    if (params.page) httpParams = httpParams.set('page', params.page.toString());
    if (params.pageSize) httpParams = httpParams.set('pageSize', params.pageSize.toString());
    if (params.sortBy) httpParams = httpParams.set('sortBy', params.sortBy);
    if (params.sortOrder) httpParams = httpParams.set('sortOrder', params.sortOrder);

    const opts: { params: HttpParams; context?: ReturnType<typeof createHttpContextSkipGlobalErrorUi> } = {
      params: httpParams
    };
    if (skipGlobalErrorUi) {
      opts.context = createHttpContextSkipGlobalErrorUi();
    }
    return this.http.get<ApiResponse<PagedResult<ClientListItem>>>(this.API_URL, opts);
  }

  /** Totaux agrégés respectant les mêmes filtres que {@link getClients} (calcul backend). */
  getClientsSummary(params: ClientSearchParams = {}): Observable<ApiResponse<ClientListSummary>> {
    let httpParams = new HttpParams();
    if (params.search) httpParams = httpParams.set('search', params.search);
    if (params.type !== undefined) httpParams = httpParams.set('type', params.type.toString());
    if (params.isActive !== undefined) httpParams = httpParams.set('isActive', params.isActive.toString());
    if (params.governorate) httpParams = httpParams.set('governorate', params.governorate);
    const opts: { params: HttpParams; context?: ReturnType<typeof createHttpContextSkipGlobalErrorUi> } = {
      params: httpParams
    };
    if (params.skipGlobalErrorUi === true) {
      opts.context = createHttpContextSkipGlobalErrorUi();
    }
    return this.http.get<ApiResponse<ClientListSummary>>(`${this.API_URL}/summary`, opts);
  }

  getClient(id: string, options?: { skipGlobalErrorUi?: boolean }): Observable<ApiResponse<Client>> {
    const skipGlobalErrorUi = options?.skipGlobalErrorUi === true;
    const httpOpts: { context?: ReturnType<typeof createHttpContextSkipGlobalErrorUi> } = {};
    if (skipGlobalErrorUi) {
      httpOpts.context = createHttpContextSkipGlobalErrorUi();
    }
    return this.http.get<ApiResponse<Client>>(`${this.API_URL}/${id}`, httpOpts);
  }

  /**
   * Encours du client. Appele a l'affichage de la fiche et avant la confirmation d'une
   * commande : c'est le moment ou l'information a une valeur.
   */
  getClientOutstanding(id: string): Observable<ApiResponse<ClientOutstanding>> {
    return this.http.get<ApiResponse<ClientOutstanding>>(`${this.API_URL}/${id}/outstanding`, {
      context: createHttpContextSkipGlobalErrorUi()
    });
  }

  createClient(request: CreateClientRequest): Observable<ApiResponse<string>> {
    return this.http.post<ApiResponse<string>>(this.API_URL, request);
  }

  updateClient(id: string, request: UpdateClientRequest): Observable<ApiResponse<Client>> {
    return this.http.put<ApiResponse<Client>>(`${this.API_URL}/${id}`, request);
  }

  deleteClient(id: string): Observable<ApiResponse<object | null>> {
    const context = new HttpContext().set(SKIP_ERROR_TOAST, true);
    return this.http.delete<ApiResponse<object | null>>(`${this.API_URL}/${id}`, { context });
  }

  toggleActive(id: string): Observable<ApiResponse<Client>> {
    return this.http.patch<ApiResponse<Client>>(`${this.API_URL}/${id}/toggle-active`, {});
  }

  exportClients(params: ClientSearchParams = {}): Observable<Blob> {
    let httpParams = new HttpParams();
    
    if (params.search) httpParams = httpParams.set('search', params.search);
    if (params.type !== undefined) httpParams = httpParams.set('type', params.type.toString());
    if (params.isActive !== undefined) httpParams = httpParams.set('isActive', params.isActive.toString());
    if (params.governorate) httpParams = httpParams.set('governorate', params.governorate);

    return this.http.get(`${this.API_URL}/export`, { 
      params: httpParams,
      responseType: 'blob' 
    });
  }

  getClientStats(id: string, options?: { skipGlobalErrorUi?: boolean }): Observable<ApiResponse<ClientStats>> {
    const skipGlobalErrorUi = options?.skipGlobalErrorUi === true;
    const httpOpts: { context?: ReturnType<typeof createHttpContextSkipGlobalErrorUi> } = {};
    if (skipGlobalErrorUi) {
      httpOpts.context = createHttpContextSkipGlobalErrorUi();
    }
    return this.http.get<ApiResponse<ClientStats>>(`${this.API_URL}/${id}/stats`, httpOpts);
  }
}

export interface ClientStats {
  totalInvoices: number;
  paidInvoices: number;
  pendingInvoices: number;
  overdueInvoices: number;
  totalRevenue: number;
  averageInvoiceAmount: number;
  lastInvoiceDate: string | null;
}
