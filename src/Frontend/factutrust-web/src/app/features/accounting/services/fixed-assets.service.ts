import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '@environments/environment';
import {
  DepreciationMethod,
  FixedAssetStatus,
  parseDepreciationMethod,
  parseFixedAssetStatus
} from './fixed-asset-enums';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
}

export { DepreciationMethod, FixedAssetStatus } from './fixed-asset-enums';

/** Coefficients d'amortissement accéléré autorisés (matériel industriel multi-équipes). */
export const ACCELERATION_COEFFICIENTS: ReadonlyArray<number> = [1.5, 2];

/** Plafond (DT) en-dessous duquel un bien immobilisé est éligible à l'amortissement intégral. */
export const LOW_VALUE_ASSET_CEILING_TND = 200;

export interface DepreciationRateCategoryDto {
  id: string;
  code: string;
  label: string;
  legalRatePercent: number;
  usefulLifeYears: number;
  defaultAssetAccount: string;
  defaultDepreciationAccount: string;
  defaultExpenseAccount: string;
  isNonDepreciable: boolean;
}

export interface FixedAssetDto {
  id: string;
  inventoryNumber: string;
  label: string;
  description?: string | null;
  status: FixedAssetStatus;
  assetAccountNumber: string;
  depreciationAccountNumber: string;
  expenseAccountNumber: string;
  acquisitionCost: number;
  capitalizedFees: number;
  residualValue: number;
  totalCapitalizedCost: number;
  vatAmount: number;
  acquisitionDate: string;
  inServiceDate?: string | null;
  disposalDate?: string | null;
  depreciationRateCategoryId: string;
  depreciationRateCategoryLabel: string;
  depreciationRatePercent: number;
  usefulLifeYears: number;
  depreciationMethod: DepreciationMethod;
  accelerationCoefficient: number;
  accumulatedDepreciation: number;
  netBookValue: number;
  location?: string | null;
  creditAccountNumber?: string | null;
  supplierId?: string | null;
  supplierInvoiceId?: string | null;
  supplierInvoiceLineId?: string | null;
}

export interface DepreciationScheduleLineDto {
  id: string;
  fiscalYear: number;
  periodMonth?: number | null;
  openingNbv: number;
  normalAnnualAmount: number;
  priorAccumulatedDepreciation: number;
  depreciationAmount: number;
  accumulatedDepreciation: number;
  closingNbv: number;
  isPosted: boolean;
  /** Vrai si l'écriture de dotation rattachée est extournée (T13 backend) — une ligne extournée
   *  ne bloque plus la régénération du tableau même si `isPosted` reste true (dé-postage différé). */
  isReversed: boolean;
}

export interface FixedAssetScheduleDto {
  fixedAssetId: string;
  inventoryNumber: string;
  label: string;
  acquisitionDate: string;
  inServiceDate?: string | null;
  totalCapitalizedCost: number;
  depreciationRatePercent: number;
  usefulLifeYears: number;
  depreciableBase: number;
  lines: DepreciationScheduleLineDto[];
  depreciationMethod: DepreciationMethod;
  accelerationCoefficient: number;
}

export interface FixedAssetListResponse {
  items: FixedAssetDto[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export type CurrentYearPostingStatus = 'None' | 'Partial' | 'FullyPosted';

export interface FixedAssetAmortizationTableRowDto {
  assetId: string;
  inventoryNumber: string;
  label: string;
  status: FixedAssetStatus;
  depreciationRateCategoryId: string;
  depreciationRateCategoryLabel: string;
  depreciationMethod: DepreciationMethod;
  acquisitionDate: string;
  inServiceDate?: string | null;
  originValue: number;
  accumulatedDepreciation: number;
  netBookValue: number;
  fiscalYear: number;
  dotationCalculeeExercice: number;
  dotationComptabiliseeExercice: number;
  postingStatus: CurrentYearPostingStatus;
}

export interface FixedAssetAmortizationTableResponse {
  items: FixedAssetAmortizationTableRowDto[];
  totalCount: number;
  page: number;
  pageSize: number;
  fiscalYear: number;
}

export type AmortizationReportGroupingMode = 'AssetAccount' | 'FiscalCategory';

export interface AmortizationReportHeaderDto {
  companyName: string;
  fiscalYear: number;
  periodStart: string;
  periodEnd: string;
  generatedAtUtc: string;
}

export interface AmortizationReportAssetRowDto {
  assetId: string;
  assetAccountNumber: string;
  inventoryNumber: string;
  label: string;
  acquisitionDate: string;
  originValue: number;
  usefulLifeYears: number;
  depreciationMethod: DepreciationMethod;
  priorAccumulatedDepreciation: number;
  dotationCalculeeExercice: number;
  dotationComptabiliseeExercice: number;
  endOfYearAccumulatedDepreciation: number;
  endOfYearNetBookValue: number;
  postingStatus: CurrentYearPostingStatus;
}

export interface AmortizationReportTotalsDto {
  originValue: number;
  priorAccumulatedDepreciation: number;
  dotationCalculeeExercice: number;
  dotationComptabiliseeExercice: number;
  endOfYearAccumulatedDepreciation: number;
  endOfYearNetBookValue: number;
}

export interface AmortizationReportGroupDto {
  groupCode: string;
  groupLabel: string;
  rows: AmortizationReportAssetRowDto[];
  subtotal: AmortizationReportTotalsDto;
}

export interface AmortizationReportSummaryRowDto {
  natureLabel: string;
  originValue: number;
  priorAccumulatedDepreciation: number;
  dotationCalculeeExercice: number;
  endOfYearNetBookValue: number;
}

export interface AmortizationReportInfoBoxDto {
  currencyCode: string;
  generatedAtUtc: string;
  productName: string;
}

export interface AmortizationReportResponse {
  header: AmortizationReportHeaderDto;
  groupingMode: AmortizationReportGroupingMode;
  groups: AmortizationReportGroupDto[];
  grandTotal: AmortizationReportTotalsDto;
  summaryByNature: AmortizationReportSummaryRowDto[];
  infoBox: AmortizationReportInfoBoxDto;
}

export interface CreateFixedAssetRequest {
  label: string;
  depreciationRateCategoryId: string;
  acquisitionCost: number;
  capitalizedFees: number;
  residualValue: number;
  acquisitionDate: string;
  description?: string;
  vatAmount?: number;
  location?: string;
  supplierId?: string;
  assetAccountNumber?: string;
  depreciationAccountNumber?: string;
  expenseAccountNumber?: string;
  depreciationMethod?: DepreciationMethod;
  accelerationCoefficient?: number | null;
  depreciationRatePercent?: number | null;
  usefulLifeYears?: number | null;
}

export interface UpdateFixedAssetRequest {
  label: string;
  acquisitionCost: number;
  capitalizedFees: number;
  residualValue: number;
  acquisitionDate: string;
  description?: string;
  location?: string;
  assetAccountNumber?: string;
  depreciationAccountNumber?: string;
  expenseAccountNumber?: string;
  depreciationRateCategoryId?: string | null;
  depreciationMethod?: DepreciationMethod | null;
  accelerationCoefficient?: number | null;
  depreciationRatePercent?: number | null;
  usefulLifeYears?: number | null;
  vatAmount?: number | null;
}

export interface PutFixedAssetInServiceRequest {
  inServiceDate: string;
  creditAccountNumber: string;
}

export interface DisposeFixedAssetRequest {
  disposalDate: string;
  disposalProceeds: number;
  /** Compte de trésorerie (5321, 5411…) — mode « Comptant ». Optionnel depuis T4 : un produit nul
   *  (mise au rebut) n'exige aucun compte de règlement. */
  treasuryAccountNumber?: string;
  /** Créance sur cession (préfixe 452) — mode « À terme » (cession à crédit, T4). */
  receivableAccountNumber?: string;
}

export interface DepreciationRunResultDto {
  fiscalYear: number;
  postedCount: number;
  skippedCount: number;
  totalDepreciationAmount: number;
  errors: string[];
  /** Dotations déjà comptabilisées pour cet exercice (re-run idempotent — ajouté en T7 backend). */
  alreadyPostedCount?: number;
  /**
   * Libellé d'exercice renvoyé par le backend (plan « Exercices décalés », P3) : « 2026/2027 » pour
   * un exercice décalé au format N/N+1, « 2026 » pour un exercice civil. Repli sur `fiscalYear`
   * côté UI si le champ est vide (back-compat avec un backend antérieur à P3).
   */
  fiscalYearLabel?: string;
}

/**
 * Paramètres du module Immobilisations du dossier (tenant) — support des exercices comptables
 * décalés (plan « Exercices décalés », P1). Contrat miroir du backend `FixedAssetSettingsDto`.
 */
export interface FixedAssetSettingsDto {
  /** Mois de début d'exercice (1..12) ; 1 = exercice civil (comportement historique). */
  fiscalYearStartMonth: number;
  /** Format de libellé d'exercice : `"N/N+1"` (défaut) ou `"N"`. */
  fiscalYearLabelFormat: string;
  /** Libellé d'exemple pour l'exercice courant (aide à prévisualiser le format côté UI). */
  fiscalYearLabelSample: string;
}

/** Requête de mise à jour des paramètres Immobilisations du dossier (permission Accounting). */
export interface UpdateFixedAssetSettingsRequest {
  fiscalYearStartMonth: number;
  fiscalYearLabelFormat: string;
}

/** DTO brut renvoyé par l'API avant normalisation des enums. */
type FixedAssetApiDto = Omit<FixedAssetDto, 'status' | 'depreciationMethod'> & {
  status: unknown;
  depreciationMethod: unknown;
};

type FixedAssetScheduleApiDto = Omit<FixedAssetScheduleDto, 'depreciationMethod'> & {
  depreciationMethod: unknown;
};

type FixedAssetAmortizationTableApiRowDto = Omit<FixedAssetAmortizationTableRowDto, 'status' | 'depreciationMethod'> & {
  status: unknown;
  depreciationMethod: unknown;
};

type AmortizationReportAssetRowApiDto = Omit<AmortizationReportAssetRowDto, 'depreciationMethod' | 'postingStatus'> & {
  depreciationMethod: unknown;
  postingStatus: unknown;
};

type AmortizationReportApiResponse = Omit<AmortizationReportResponse, 'groups'> & {
  groups: Array<Omit<AmortizationReportGroupDto, 'rows'> & { rows: AmortizationReportAssetRowApiDto[] }>;
};

export function mapFixedAssetFromApi(dto: FixedAssetApiDto): FixedAssetDto | null {
  const status = parseFixedAssetStatus(dto.status);
  if (!status) return null;
  return {
    ...dto,
    status,
    depreciationMethod: parseDepreciationMethod(dto.depreciationMethod)
  };
}

export function mapScheduleFromApi(dto: FixedAssetScheduleApiDto): FixedAssetScheduleDto {
  return {
    ...dto,
    depreciationMethod: parseDepreciationMethod(dto.depreciationMethod)
  };
}

function mapListResponse(res: ApiResponse<FixedAssetListResponse & { items: FixedAssetApiDto[] }>): ApiResponse<FixedAssetListResponse> {
  if (!res.data) return res as ApiResponse<FixedAssetListResponse>;
  return {
    ...res,
    data: {
      ...res.data,
      items: res.data.items
        .map(mapFixedAssetFromApi)
        .filter((item): item is FixedAssetDto => item !== null)
    }
  };
}

function mapAmortizationTableRowFromApi(dto: FixedAssetAmortizationTableApiRowDto): FixedAssetAmortizationTableRowDto | null {
  const status = parseFixedAssetStatus(dto.status);
  if (!status) return null;

  const postingStatus: CurrentYearPostingStatus =
    dto.postingStatus === 'Partial' || dto.postingStatus === 'FullyPosted' ? dto.postingStatus : 'None';

  return {
    ...dto,
    status,
    depreciationMethod: parseDepreciationMethod(dto.depreciationMethod),
    postingStatus
  };
}

function mapAmortizationTableResponse(
  res: ApiResponse<FixedAssetAmortizationTableResponse & { items: FixedAssetAmortizationTableApiRowDto[] }>
): ApiResponse<FixedAssetAmortizationTableResponse> {
  if (!res.data) return res as ApiResponse<FixedAssetAmortizationTableResponse>;
  return {
    ...res,
    data: {
      ...res.data,
      items: res.data.items
        .map(mapAmortizationTableRowFromApi)
        .filter((item): item is FixedAssetAmortizationTableRowDto => item !== null)
    }
  };
}

function mapAmortizationReportAssetRowFromApi(dto: AmortizationReportAssetRowApiDto): AmortizationReportAssetRowDto {
  const postingStatus: CurrentYearPostingStatus =
    dto.postingStatus === 'Partial' || dto.postingStatus === 'FullyPosted' ? dto.postingStatus : 'None';
  return {
    ...dto,
    depreciationMethod: parseDepreciationMethod(dto.depreciationMethod),
    postingStatus
  };
}

function mapAmortizationReportFromApi(res: ApiResponse<AmortizationReportApiResponse>): ApiResponse<AmortizationReportResponse> {
  if (!res.data) return res as ApiResponse<AmortizationReportResponse>;
  return {
    ...res,
    data: {
      ...res.data,
      groupingMode: res.data.groupingMode === 'FiscalCategory' ? 'FiscalCategory' : 'AssetAccount',
      groups: res.data.groups.map(g => ({
        ...g,
        rows: g.rows.map(mapAmortizationReportAssetRowFromApi)
      }))
    }
  };
}

@Injectable({ providedIn: 'root' })
export class FixedAssetsService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/accounting/fixed-assets`;

  getRateCategories(): Observable<ApiResponse<DepreciationRateCategoryDto[]>> {
    return this.http.get<ApiResponse<DepreciationRateCategoryDto[]>>(`${this.base}/rate-categories`);
  }

  /** Lecture des paramètres Immobilisations du dossier (exercice décalé) — permission Accounting. */
  getSettings(): Observable<ApiResponse<FixedAssetSettingsDto>> {
    return this.http.get<ApiResponse<FixedAssetSettingsDto>>(`${this.base}/settings`);
  }

  /** Écriture des paramètres Immobilisations du dossier (exercice décalé) — permission Accounting. */
  updateSettings(req: UpdateFixedAssetSettingsRequest): Observable<ApiResponse<FixedAssetSettingsDto>> {
    return this.http.put<ApiResponse<FixedAssetSettingsDto>>(`${this.base}/settings`, req);
  }

  list(params: {
    page?: number;
    pageSize?: number;
    status?: FixedAssetStatus;
    categoryId?: string;
    fiscalYear?: number;
    search?: string;
  }): Observable<ApiResponse<FixedAssetListResponse>> {
    let p = new HttpParams();
    if (params.page) p = p.set('page', params.page);
    if (params.pageSize) p = p.set('pageSize', params.pageSize);
    if (params.status !== undefined) p = p.set('status', params.status);
    if (params.categoryId) p = p.set('categoryId', params.categoryId);
    if (params.fiscalYear) p = p.set('fiscalYear', params.fiscalYear);
    if (params.search) p = p.set('search', params.search);
    return this.http
      .get<ApiResponse<FixedAssetListResponse & { items: FixedAssetApiDto[] }>>(this.base, { params: p })
      .pipe(map(mapListResponse));
  }

  getById(id: string): Observable<ApiResponse<FixedAssetDto>> {
    return this.http.get<ApiResponse<FixedAssetApiDto>>(`${this.base}/${id}`).pipe(
      map(res => ({
        ...res,
        data: res.data ? mapFixedAssetFromApi(res.data) ?? undefined : undefined
      }))
    );
  }

  getSchedule(id: string): Observable<ApiResponse<FixedAssetScheduleDto>> {
    return this.http.get<ApiResponse<FixedAssetScheduleApiDto>>(`${this.base}/${id}/schedule`).pipe(
      map(res => ({
        ...res,
        data: res.data ? mapScheduleFromApi(res.data) : undefined
      }))
    );
  }

  create(req: CreateFixedAssetRequest): Observable<ApiResponse<string>> {
    return this.http.post<ApiResponse<string>>(this.base, req);
  }

  update(id: string, req: UpdateFixedAssetRequest): Observable<ApiResponse<string>> {
    return this.http.put<ApiResponse<string>>(`${this.base}/${id}`, req);
  }

  previewSchedule(id: string, inServiceDate?: string | null): Observable<ApiResponse<FixedAssetScheduleDto>> {
    return this.http
      .post<ApiResponse<FixedAssetScheduleApiDto>>(`${this.base}/${id}/schedule/preview`, {
        inServiceDate: inServiceDate || null
      })
      .pipe(
        map(res => ({
          ...res,
          data: res.data ? mapScheduleFromApi(res.data) : undefined
        }))
      );
  }

  putInService(id: string, req: PutFixedAssetInServiceRequest): Observable<ApiResponse<string>> {
    return this.http.post<ApiResponse<string>>(`${this.base}/${id}/put-in-service`, req);
  }

  generateSchedule(id: string): Observable<ApiResponse<FixedAssetScheduleDto>> {
    return this.http
      .post<ApiResponse<FixedAssetScheduleApiDto>>(`${this.base}/${id}/generate-schedule`, {})
      .pipe(
        map(res => ({
          ...res,
          data: res.data ? mapScheduleFromApi(res.data) : undefined
        }))
      );
  }

  postDepreciationRun(fiscalYear: number): Observable<ApiResponse<DepreciationRunResultDto>> {
    return this.http.post<ApiResponse<DepreciationRunResultDto>>(`${this.base}/depreciation-runs`, { fiscalYear });
  }

  dispose(id: string, req: DisposeFixedAssetRequest): Observable<ApiResponse<string>> {
    return this.http.post<ApiResponse<string>>(`${this.base}/${id}/dispose`, req);
  }

  exportScheduleExcel(id: string): Observable<Blob> {
    return this.http.get(`${this.base}/${id}/schedule/export.xlsx`, { responseType: 'blob' });
  }

  exportDepreciationReportExcel(fiscalYear: number): Observable<Blob> {
    return this.http.get(`${this.base}/depreciation-report/export.xlsx`, {
      params: new HttpParams().set('fiscalYear', fiscalYear),
      responseType: 'blob'
    });
  }

  getCurrentYearAmortizationTable(params: {
    page?: number;
    pageSize?: number;
    fiscalYear?: number;
    status?: FixedAssetStatus;
    categoryId?: string;
    search?: string;
  }): Observable<ApiResponse<FixedAssetAmortizationTableResponse>> {
    let p = new HttpParams();
    if (params.page) p = p.set('page', params.page);
    if (params.pageSize) p = p.set('pageSize', params.pageSize);
    if (params.fiscalYear) p = p.set('fiscalYear', params.fiscalYear);
    if (params.status !== undefined) p = p.set('status', params.status);
    if (params.categoryId) p = p.set('categoryId', params.categoryId);
    if (params.search) p = p.set('search', params.search);
    return this.http
      .get<ApiResponse<FixedAssetAmortizationTableResponse & { items: FixedAssetAmortizationTableApiRowDto[] }>>(
        `${this.base}/amortization-table`,
        { params: p }
      )
      .pipe(map(mapAmortizationTableResponse));
  }

  getAmortizationReport(params: {
    fiscalYear?: number;
    groupingMode?: AmortizationReportGroupingMode;
    status?: FixedAssetStatus;
    categoryId?: string;
    search?: string;
    companyName?: string;
  }): Observable<ApiResponse<AmortizationReportResponse>> {
    let p = new HttpParams();
    if (params.fiscalYear) p = p.set('fiscalYear', params.fiscalYear);
    if (params.groupingMode) p = p.set('groupingMode', params.groupingMode);
    if (params.status !== undefined) p = p.set('status', params.status);
    if (params.categoryId) p = p.set('categoryId', params.categoryId);
    if (params.search) p = p.set('search', params.search);
    if (params.companyName) p = p.set('companyName', params.companyName);
    return this.http
      .get<ApiResponse<AmortizationReportApiResponse>>(`${this.base}/amortization-report`, { params: p })
      .pipe(map(mapAmortizationReportFromApi));
  }

  exportAmortizationReportExcel(params: {
    fiscalYear?: number;
    groupingMode?: AmortizationReportGroupingMode;
    status?: FixedAssetStatus;
    categoryId?: string;
    search?: string;
    companyName?: string;
  }): Observable<Blob> {
    let p = new HttpParams();
    if (params.fiscalYear) p = p.set('fiscalYear', params.fiscalYear);
    if (params.groupingMode) p = p.set('groupingMode', params.groupingMode);
    if (params.status !== undefined) p = p.set('status', params.status);
    if (params.categoryId) p = p.set('categoryId', params.categoryId);
    if (params.search) p = p.set('search', params.search);
    if (params.companyName) p = p.set('companyName', params.companyName);
    return this.http.get(`${this.base}/amortization-report/export.xlsx`, { params: p, responseType: 'blob' });
  }
}

export const FIXED_ASSET_STATUS_LABELS: Record<FixedAssetStatus, string> = {
  [FixedAssetStatus.Draft]: $localize`:@@accounting.fixed-assets.ts.brouillon.57d2d7a7:Brouillon`,
  [FixedAssetStatus.InService]: $localize`:@@accounting.fixed-assets.ts.en.service.0b067773:En service`,
  [FixedAssetStatus.FullyDepreciated]: $localize`:@@accounting.fixed-assets.ts.totalement.amorti.ede655ed:Totalement amorti`,
  [FixedAssetStatus.Disposed]: $localize`:@@accounting.fixed-assets.ts.cede.51eca68c:Cédé`
};

export const DEPRECIATION_METHOD_LABELS: Record<DepreciationMethod, string> = {
  [DepreciationMethod.Linear]: $localize`:@@accounting.fixed-assets.ts.lineaire.a5db4cfe:Linéaire`,
  [DepreciationMethod.Accelerated]: $localize`:@@accounting.fixed-assets.ts.accelere.064a76be:Accéléré`,
  [DepreciationMethod.Integral]: $localize`:@@accounting.fixed-assets.ts.integral.02387577:Intégral`
};

export const CURRENT_YEAR_POSTING_STATUS_LABELS: Record<CurrentYearPostingStatus, string> = {
  None: $localize`:@@accounting.fixed-assets.ts.non.comptabilisee.5e1470cc:Non comptabilisée`,
  Partial: $localize`:@@accounting.fixed-assets.ts.partiellement.comptabilisee.abe82719:Partiellement comptabilisée`,
  FullyPosted: $localize`:@@accounting.fixed-assets.ts.totalement.comptabilisee.3b53ccd8:Totalement comptabilisée`
};
