import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, from, of, throwError } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { environment } from '@environments/environment';
import { ApiResponse } from './auth.service';

export interface ClientPaymentReportRow {
  paymentId: string;
  paymentDate: string;
  clientName: string;
  invoiceId: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  methodDisplay: string;
  reference: string | null;
}

export interface SupplierPaymentReportRow {
  paymentId: string;
  paymentDate: string;
  supplierName: string;
  supplierInvoiceId: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  methodDisplay: string;
  reference: string | null;
}

export interface ClientTransactionReportRow {
  date: string;
  transactionType: string;
  clientName: string;
  reference: string;
  amount: number;
  currency: string;
  invoiceId: string | null;
  paymentId: string | null;
}

export interface SupplierTransactionReportRow {
  date: string;
  transactionType: string;
  supplierName: string;
  reference: string;
  amount: number;
  currency: string;
  supplierInvoiceId: string | null;
  paymentId: string | null;
}

@Injectable({ providedIn: 'root' })
export class ReportsApiService {
  private readonly API_URL = `${environment.apiUrl}/reports`;

  constructor(private http: HttpClient) {}

  getClientPayments(fromDate: string, toDate: string): Observable<ApiResponse<ClientPaymentReportRow[]>> {
    const params = new HttpParams().set('from', fromDate).set('to', toDate);
    return this.http.get<ApiResponse<ClientPaymentReportRow[]>>(`${this.API_URL}/client-payments`, { params });
  }

  getSupplierPayments(fromDate: string, toDate: string): Observable<ApiResponse<SupplierPaymentReportRow[]>> {
    const params = new HttpParams().set('from', fromDate).set('to', toDate);
    return this.http.get<ApiResponse<SupplierPaymentReportRow[]>>(`${this.API_URL}/supplier-payments`, { params });
  }

  getClientTransactions(fromDate: string, toDate: string): Observable<ApiResponse<ClientTransactionReportRow[]>> {
    const params = new HttpParams().set('from', fromDate).set('to', toDate);
    return this.http.get<ApiResponse<ClientTransactionReportRow[]>>(`${this.API_URL}/client-transactions`, { params });
  }

  getSupplierTransactions(fromDate: string, toDate: string): Observable<ApiResponse<SupplierTransactionReportRow[]>> {
    const params = new HttpParams().set('from', fromDate).set('to', toDate);
    return this.http.get<ApiResponse<SupplierTransactionReportRow[]>>(`${this.API_URL}/supplier-transactions`, { params });
  }

  getSalesByLine(fromDate: string, toDate: string): Observable<ApiResponse<SalesByLineReportRow[]>> {
    const params = new HttpParams().set('from', fromDate).set('to', toDate);
    return this.http.get<ApiResponse<SalesByLineReportRow[]>>(`${this.API_URL}/sales-by-line`, { params });
  }

  getSalesVat(fromDate: string, toDate: string): Observable<ApiResponse<SalesVatReportRow[]>> {
    const params = new HttpParams().set('from', fromDate).set('to', toDate);
    return this.http.get<ApiResponse<SalesVatReportRow[]>>(`${this.API_URL}/sales-vat`, { params });
  }

  getSalesRevenueByProduct(fromDate: string, toDate: string, groupBy: 'Product' | 'Category' | 'ProductAndClient'): Observable<ApiResponse<SalesRevenueReportRow[]>> {
    let params = new HttpParams().set('from', fromDate).set('to', toDate);
    if (groupBy) params = params.set('groupBy', groupBy);
    return this.http.get<ApiResponse<SalesRevenueReportRow[]>>(`${this.API_URL}/sales-revenue-by-product`, { params });
  }

  getPurchasesByLine(fromDate: string, toDate: string): Observable<ApiResponse<PurchasesByLineReportRow[]>> {
    const params = new HttpParams().set('from', fromDate).set('to', toDate);
    return this.http.get<ApiResponse<PurchasesByLineReportRow[]>>(`${this.API_URL}/purchases-by-line`, { params });
  }

  getPurchasesVat(fromDate: string, toDate: string): Observable<ApiResponse<PurchasesVatReportRow[]>> {
    const params = new HttpParams().set('from', fromDate).set('to', toDate);
    return this.http.get<ApiResponse<PurchasesVatReportRow[]>>(`${this.API_URL}/purchases-vat`, { params });
  }

  getClientBalances(): Observable<ApiResponse<ClientBalanceReportRow[]>> {
    return this.http.get<ApiResponse<ClientBalanceReportRow[]>>(`${this.API_URL}/client-balances`);
  }

  getSupplierBalances(): Observable<ApiResponse<SupplierBalanceReportRow[]>> {
    return this.http.get<ApiResponse<SupplierBalanceReportRow[]>>(`${this.API_URL}/supplier-balances`);
  }

  getClientWithholdings(fromDate: string, toDate: string): Observable<ApiResponse<ClientWithholdingReportRow[]>> {
    const params = new HttpParams().set('from', fromDate).set('to', toDate);
    return this.http.get<ApiResponse<ClientWithholdingReportRow[]>>(`${this.API_URL}/client-withholdings`, { params });
  }

  getSupplierWithholdings(fromDate: string, toDate: string): Observable<ApiResponse<SupplierWithholdingReportRow[]>> {
    const params = new HttpParams().set('from', fromDate).set('to', toDate);
    return this.http.get<ApiResponse<SupplierWithholdingReportRow[]>>(`${this.API_URL}/supplier-withholdings`, { params });
  }

  getStockMovements(params: {
    warehouseId?: string;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
  }): Observable<ApiResponse<StockMovementsReportResult>> {
    let httpParams = new HttpParams();
    if (params.warehouseId) httpParams = httpParams.set('warehouseId', params.warehouseId);
    if (params.from) httpParams = httpParams.set('from', params.from);
    if (params.to) httpParams = httpParams.set('to', params.to);
    if (params.page != null) httpParams = httpParams.set('page', params.page.toString());
    if (params.pageSize != null) httpParams = httpParams.set('pageSize', params.pageSize.toString());
    return this.http.get<ApiResponse<StockMovementsReportResult>>(`${this.API_URL}/stock-movements`, { params: httpParams });
  }

  getStockSnapshot(params: { asOf: string; warehouseId?: string }): Observable<ApiResponse<StockSnapshotRow[]>> {
    let httpParams = new HttpParams().set('asOf', params.asOf);
    if (params.warehouseId) httpParams = httpParams.set('warehouseId', params.warehouseId);
    return this.http.get<ApiResponse<StockSnapshotRow[]>>(`${this.API_URL}/stock-snapshot`, { params: httpParams });
  }

  getStockStatus(params: {
    warehouseId?: string | null;
    categoryId?: string | null;
    search?: string | null;
    includeZeroStock?: boolean;
    groupingMode?: StockStatusGroupingMode;
    page?: number;
    pageSize?: number;
  }): Observable<ApiResponse<StockStatusReportResult>> {
    let httpParams = new HttpParams();
    if (params.warehouseId) httpParams = httpParams.set('warehouseId', params.warehouseId);
    if (params.categoryId) httpParams = httpParams.set('categoryId', params.categoryId);
    if (params.search?.trim()) httpParams = httpParams.set('search', params.search.trim());
    if (params.includeZeroStock) httpParams = httpParams.set('includeZeroStock', 'true');
    if (params.groupingMode) httpParams = httpParams.set('groupingMode', params.groupingMode);
    if (params.page != null) httpParams = httpParams.set('page', params.page.toString());
    if (params.pageSize != null) httpParams = httpParams.set('pageSize', params.pageSize.toString());
    return this.http.get<ApiResponse<StockStatusReportResult>>(`${this.API_URL}/stock-status`, { params: httpParams });
  }

  downloadStockStatusPdf(params: {
    warehouseId?: string | null;
    categoryId?: string | null;
    search?: string | null;
    includeZeroStock?: boolean;
    groupingMode?: StockStatusGroupingMode;
  }): Observable<Blob> {
    let httpParams = new HttpParams();
    if (params.warehouseId) httpParams = httpParams.set('warehouseId', params.warehouseId);
    if (params.categoryId) httpParams = httpParams.set('categoryId', params.categoryId);
    if (params.search?.trim()) httpParams = httpParams.set('search', params.search.trim());
    if (params.includeZeroStock) httpParams = httpParams.set('includeZeroStock', 'true');
    if (params.groupingMode) httpParams = httpParams.set('groupingMode', params.groupingMode);
    return this.http.get(`${this.API_URL}/stock-status/pdf`, {
      params: httpParams,
      responseType: 'blob',
      observe: 'response'
    }).pipe(
      switchMap(response => {
        const contentType = response.headers.get('content-type') || '';
        const body = response.body;
        if (contentType.includes('application/json') && body) {
          return from(body.text()).pipe(
            switchMap(text => {
              try {
                const parsed = JSON.parse(text) as { message?: string; errors?: string[] };
                const msg = parsed.errors?.[0] ?? parsed.message ?? 'Impossible de générer le PDF';
                return throwError(() => new Error(msg));
              } catch {
                return throwError(() => new Error('Impossible de générer le PDF'));
              }
            })
          );
        }
        if (!body || body.size === 0) {
          return throwError(() => new Error('Impossible de générer le PDF'));
        }
        return of(body);
      })
    );
  }

  getCommercialProfit(fromDate: string, toDate: string, groupBy: 'Line' | 'Product' | 'Month' | 'Piece'): Observable<ApiResponse<CommercialProfitReportRow[]>> {
    let params = new HttpParams().set('from', fromDate).set('to', toDate);
    if (groupBy) params = params.set('groupBy', groupBy);
    return this.http.get<ApiResponse<CommercialProfitReportRow[]>>(`${this.API_URL}/commercial-profit`, { params });
  }

  getProductPerformance(fromDate: string, toDate: string): Observable<ApiResponse<ProductPerformanceReportRow[]>> {
    const params = new HttpParams().set('from', fromDate).set('to', toDate);
    return this.http.get<ApiResponse<ProductPerformanceReportRow[]>>(`${this.API_URL}/product-performance`, { params });
  }

  getProductSalesTrend(fromDate: string, toDate: string): Observable<ApiResponse<ProductSalesTrendReportRow[]>> {
    const params = new HttpParams().set('from', fromDate).set('to', toDate);
    return this.http.get<ApiResponse<ProductSalesTrendReportRow[]>>(`${this.API_URL}/product-sales-trend`, { params });
  }

  getBasketMetrics(fromDate: string, toDate: string): Observable<ApiResponse<BasketMetricsReportDto>> {
    const params = new HttpParams().set('from', fromDate).set('to', toDate);
    return this.http.get<ApiResponse<BasketMetricsReportDto>>(`${this.API_URL}/basket-metrics`, { params });
  }

  getProductsNeverSold(fromDate: string, toDate: string): Observable<ApiResponse<ProductNeverSoldReportRow[]>> {
    const params = new HttpParams().set('from', fromDate).set('to', toDate);
    return this.http.get<ApiResponse<ProductNeverSoldReportRow[]>>(`${this.API_URL}/products-never-sold`, { params });
  }

  getSalesJournal(params: {
    from: string;
    to: string;
    viewMode: SalesJournalViewMode;
    clientId?: string | null;
    page?: number;
    pageSize?: number;
  }): Observable<ApiResponse<SalesJournalReportResult>> {
    let httpParams = new HttpParams()
      .set('from', params.from)
      .set('to', params.to)
      .set('viewMode', params.viewMode);
    if (params.clientId) httpParams = httpParams.set('clientId', params.clientId);
    if (params.page != null) httpParams = httpParams.set('page', params.page.toString());
    if (params.pageSize != null) httpParams = httpParams.set('pageSize', params.pageSize.toString());
    return this.http.get<ApiResponse<SalesJournalReportResult>>(`${this.API_URL}/sales-journal`, { params: httpParams });
  }

  downloadSalesJournalPdf(params: {
    from: string;
    to: string;
    viewMode: SalesJournalViewMode;
    clientId?: string | null;
  }): Observable<Blob> {
    let httpParams = new HttpParams()
      .set('from', params.from)
      .set('to', params.to)
      .set('viewMode', params.viewMode);
    if (params.clientId) httpParams = httpParams.set('clientId', params.clientId);
    return this.http.get(`${this.API_URL}/sales-journal/pdf`, {
      params: httpParams,
      responseType: 'blob',
      observe: 'response'
    }).pipe(
      switchMap(response => {
        const contentType = response.headers.get('content-type') || '';
        const body = response.body;
        if (contentType.includes('application/json') && body) {
          return from(body.text()).pipe(
            switchMap(text => {
              try {
                const parsed = JSON.parse(text) as { message?: string; errors?: string[] };
                const msg = parsed.errors?.[0] ?? parsed.message ?? 'Impossible de générer le PDF';
                return throwError(() => new Error(msg));
              } catch {
                return throwError(() => new Error('Impossible de générer le PDF'));
              }
            })
          );
        }
        if (!body || body.size === 0) {
          return throwError(() => new Error('Impossible de générer le PDF'));
        }
        return of(body);
      })
    );
  }

  getPurchasesJournal(params: {
    from: string;
    to: string;
    viewMode: SalesJournalViewMode;
    source: PurchasesJournalSource;
    supplierId?: string | null;
    page?: number;
    pageSize?: number;
  }): Observable<ApiResponse<PurchasesJournalReportResult>> {
    let httpParams = new HttpParams()
      .set('from', params.from)
      .set('to', params.to)
      .set('viewMode', params.viewMode)
      .set('source', params.source);
    if (params.supplierId) httpParams = httpParams.set('supplierId', params.supplierId);
    if (params.page != null) httpParams = httpParams.set('page', params.page.toString());
    if (params.pageSize != null) httpParams = httpParams.set('pageSize', params.pageSize.toString());
    return this.http.get<ApiResponse<PurchasesJournalReportResult>>(`${this.API_URL}/purchases-journal`, { params: httpParams });
  }

  downloadPurchasesJournalPdf(params: {
    from: string;
    to: string;
    viewMode: SalesJournalViewMode;
    source: PurchasesJournalSource;
    supplierId?: string | null;
  }): Observable<Blob> {
    let httpParams = new HttpParams()
      .set('from', params.from)
      .set('to', params.to)
      .set('viewMode', params.viewMode)
      .set('source', params.source);
    if (params.supplierId) httpParams = httpParams.set('supplierId', params.supplierId);
    return this.http.get(`${this.API_URL}/purchases-journal/pdf`, {
      params: httpParams,
      responseType: 'blob',
      observe: 'response'
    }).pipe(
      switchMap(response => {
        const contentType = response.headers.get('content-type') || '';
        const body = response.body;
        if (contentType.includes('application/json') && body) {
          return from(body.text()).pipe(
            switchMap(text => {
              try {
                const parsed = JSON.parse(text) as { message?: string; errors?: string[] };
                const msg = parsed.errors?.[0] ?? parsed.message ?? 'Impossible de générer le PDF';
                return throwError(() => new Error(msg));
              } catch {
                return throwError(() => new Error('Impossible de générer le PDF'));
              }
            })
          );
        }
        if (!body || body.size === 0) {
          return throwError(() => new Error('Impossible de générer le PDF'));
        }
        return of(body);
      })
    );
  }
}

export interface StockMovementReportRow {
  id: string;
  productName: string;
  productCode: string;
  warehouseName: string;
  typeDisplay: string;
  reasonDisplay: string;
  quantity: number;
  unitCost: number;
  reference: string | null;
  occurredAt: string;
}

export interface StockMovementsReportResult {
  items: StockMovementReportRow[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export interface StockSnapshotRow {
  productName: string;
  productCode: string;
  warehouseName: string;
  quantity: number;
  unitCost: number;
  totalValue: number;
}

export type StockStatusGroupingMode = 'warehouse_then_category' | 'category_then_warehouse';

export interface StockStatusReportRow {
  productId: string;
  productCode: string;
  productName: string;
  categoryId?: string | null;
  categoryName: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  quantityOnHand: number;
  unitCost: number;
  stockValue: number;
}

export interface StockStatusReportResult {
  groupingMode: string;
  totalRows: number;
  page: number;
  pageSize: number;
  grandTotalQuantity: number;
  grandTotalValue: number;
  currency: string;
  generatedAtUtc: string;
  filtersSummary?: string | null;
  rows: StockStatusReportRow[];
}

export interface CommercialProfitReportRow {
  productId?: string;
  productName?: string;
  productCode?: string;
  invoiceNumber?: string;
  issueDate?: string;
  period?: string;
  quantity: number;
  revenue: number;
  cost: number;
  profit: number;
  currency: string;
}

export interface SalesByLineReportRow {
  productId: string;
  productName: string;
  productCode: string;
  categoryName: string | null;
  quantity: number;
  revenue: number;
  vatAmount: number;
  currency: string;
}

export interface SalesVatReportRow {
  vatRatePercent: number;
  vatRateDisplay: string;
  totalVatAmount: number;
  totalTaxableAmount: number;
  currency: string;
}

export interface SalesRevenueReportRow {
  groupKey: string;
  groupKey2: string | null;
  revenue: number;
  quantity: number;
  currency: string;
}

export interface PurchasesByLineReportRow {
  productId: string;
  productName: string;
  productCode: string;
  supplierName: string;
  quantity: number;
  amountTTC: number;
  vatAmount: number;
  currency: string;
}

export interface PurchasesVatReportRow {
  vatRatePercent: number;
  vatRateDisplay: string;
  totalVatAmount: number;
  totalTaxableAmount: number;
  currency: string;
}

export interface ClientBalanceReportRow {
  clientId: string;
  clientName: string;
  totalInvoiced: number;
  totalPaid: number;
  balance: number;
  currency: string;

  /**
   * Balance agee commerciale (lot 6). Ventilation du solde par anciennete de DueDate.
   * OPTIONNELLES : un backend anterieur au lot 6 ne les renverrait pas. Sans echeance,
   * la ligne compte dans notDue : sans date, on ne peut pas la declarer exigible. Quand
   * elles sont presentes, la somme des cinq tranches egale `balance` au millime pres.
   */
  notDue?: number;
  bucket0To30?: number;
  bucket31To60?: number;
  bucket61To90?: number;
  bucketOver90?: number;
}

export interface SupplierBalanceReportRow {
  supplierId: string;
  supplierName: string;
  totalInvoiced: number;
  totalPaid: number;
  balance: number;
  currency: string;
}

export interface ClientWithholdingReportRow {
  clientId: string;
  clientName: string;
  paymentCount: number;
  totalWithholding: number;
  currency: string;
}

export interface SupplierWithholdingReportRow {
  supplierId: string;
  supplierName: string;
  invoiceCount: number;
  totalHT: number;
  totalWithholding: number;
  totalNetPaid: number;
  currency: string;
}

export interface ProductPerformanceReportRow {
  productId: string;
  productName: string;
  productCode: string;
  categoryName: string | null;
  quantitySold: number;
  revenue: number;
  unitCost: number;
  totalCost: number;
  profit: number;
  marginPercent: number | null;
  revenueSharePercent: number;
  currency: string;
}

export interface ProductSalesTrendReportRow {
  productId: string;
  productName: string;
  productCode: string;
  categoryName: string | null;
  period: string;
  quantity: number;
  revenue: number;
  currency: string;
}

export interface ProductNeverSoldReportRow {
  productId: string;
  productName: string;
  productCode: string;
  categoryName: string | null;
  unitPrice: number;
  currency: string;
}

export interface BasketMetricsReportDto {
  totalInvoices: number;
  totalRevenue: number;
  totalLines: number;
  averageBasket: number;
  averageLinesPerInvoice: number;
  currency: string;
}

export type SalesJournalViewMode = 'Detail' | 'Day' | 'Month' | 'Year';

export interface SalesJournalDetailRow {
  issueDate: string;
  invoiceId: string;
  invoiceNumber: string;
  documentType: string;
  clientId: string;
  clientName: string;
  productId?: string | null;
  productCode: string;
  productName: string;
  categoryName?: string | null;
  quantity: number;
  unitPrice: number;
  lineSubTotal: number;
  lineTotal: number;
  vatAmount: number;
  currency: string;
}

export interface SalesJournalAggregatedRow {
  periodKey: string;
  clientId: string;
  clientName: string;
  productId?: string | null;
  productCode: string;
  productName: string;
  quantity: number;
  lineSubTotal: number;
  lineTotal: number;
  vatAmount: number;
  currency: string;
}

export interface SalesJournalTotals {
  quantity: number;
  lineSubTotal: number;
  lineTotal: number;
  vatAmount: number;
  currency: string;
}

export interface SalesJournalReportResult {
  viewMode: string;
  from: string;
  to: string;
  clientId?: string | null;
  totalRows: number;
  page: number;
  pageSize: number;
  totals: SalesJournalTotals;
  detailRows: SalesJournalDetailRow[];
  aggregatedRows: SalesJournalAggregatedRow[];
}

export type PurchasesJournalSource = 'Invoice' | 'Receipt';

export interface PurchasesJournalDetailRow {
  entryDate: string;
  documentId: string;
  documentNumber: string;
  documentKind: string;
  supplierId: string;
  supplierName: string;
  productId: string;
  productCode: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineSubTotal: number;
  lineTotal: number;
  vatAmount: number;
  currency: string;
}

export interface PurchasesJournalAggregatedRow {
  periodKey: string;
  supplierId: string;
  supplierName: string;
  productId: string;
  productCode: string;
  productName: string;
  quantity: number;
  lineSubTotal: number;
  lineTotal: number;
  vatAmount: number;
  currency: string;
}

export interface PurchasesJournalTotals {
  quantity: number;
  lineSubTotal: number;
  lineTotal: number;
  vatAmount: number;
  currency: string;
}

export interface PurchasesJournalReportResult {
  source: string;
  viewMode: string;
  from: string;
  to: string;
  supplierId?: string | null;
  totalRows: number;
  page: number;
  pageSize: number;
  totals: PurchasesJournalTotals;
  detailRows: PurchasesJournalDetailRow[];
  aggregatedRows: PurchasesJournalAggregatedRow[];
}
