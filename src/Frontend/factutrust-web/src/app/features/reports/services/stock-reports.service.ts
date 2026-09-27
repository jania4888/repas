import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import {
  StockService,
  StockItem,
  StockAlert,
  StockAlertsResult,
  StockItemsResult,
  Warehouse
} from '@core/services/stock.service';

export interface WarehouseValue {
  warehouseId: string;
  warehouseName: string;
  warehouseCode: string;
  itemCount: number;
  totalValue: number;
}

export interface StockReportsData {
  totalStockValue: string;
  productCount: number;
  alertCount: number;
  lowStockCount: number;
  outOfStockCount: number;
  lowStockItems: StockAlert[];
  outOfStockItems: StockAlert[];
  warehouseValues: WarehouseValue[];
  summaryText: string;
  currency: string;
}

@Injectable({ providedIn: 'root' })
export class StockReportsService {
  private stockService = inject(StockService);

  loadReportsData(): Observable<StockReportsData> {
    return forkJoin({
      items: this.stockService.getStockItems(undefined, false, false, 1, 1000).pipe(
        catchError(() => of({ success: false, data: { items: [], totalCount: 0 } } as any))
      ),
      alerts: this.stockService.getStockAlerts().pipe(
        catchError(() => of({ success: false, data: { lowStockItems: [], outOfStockItems: [], totalAlerts: 0 } } as any))
      ),
      warehouses: this.stockService.getWarehouses(true).pipe(
        catchError(() => of({ success: false, data: [] } as any))
      )
    }).pipe(
      map(({ items, alerts, warehouses }) => {
        const stockItems: StockItem[] = items.success ? items.data.items : [];
        const alertsData: StockAlertsResult = alerts.success ? alerts.data : { lowStockItems: [], outOfStockItems: [], totalAlerts: 0 };
        const warehouseList: Warehouse[] = warehouses.success ? warehouses.data : [];

        return this.computeReportsData(stockItems, alertsData, warehouseList);
      })
    );
  }

  private computeReportsData(
    items: StockItem[],
    alerts: StockAlertsResult,
    warehouses: Warehouse[]
  ): StockReportsData {
    const currency = 'TND';

    const totalStockValue = items.reduce((sum, item) => sum + item.stockValue, 0);
    const totalStockValueFormatted = new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3
    }).format(totalStockValue) + ' ' + currency;

    const warehouseValues: WarehouseValue[] = warehouses.map(wh => {
      const whItems = items.filter(i => i.warehouseId === wh.id);
      const value = whItems.reduce((sum, i) => sum + i.stockValue, 0);
      return {
        warehouseId: wh.id,
        warehouseName: wh.name,
        warehouseCode: wh.code,
        itemCount: whItems.length,
        totalValue: value
      };
    }).filter(wv => wv.itemCount > 0);

    const lowStockItems = alerts.lowStockItems || [];
    const outOfStockItems = alerts.outOfStockItems || [];
    const alertCount = alerts.totalAlerts ?? (lowStockItems.length + outOfStockItems.length);

    const summaryText = this.buildSummaryText(alertCount, outOfStockItems.length, lowStockItems.length);

    return {
      totalStockValue: totalStockValueFormatted,
      productCount: items.length,
      alertCount,
      lowStockCount: lowStockItems.length,
      outOfStockCount: outOfStockItems.length,
      lowStockItems,
      outOfStockItems,
      warehouseValues,
      summaryText,
      currency
    };
  }

  private buildSummaryText(alertCount: number, outOfStockCount: number, lowStockCount: number): string {
    if (alertCount === 0) {
      return $localize`:@@reports.stock-reports.ts.votre.stock.est.a.jour.aucune.alerte.de.0467df81:Votre stock est à jour. Aucune alerte de rupture.`;
    }
    const parts: string[] = [];
    if (outOfStockCount > 0) {
      parts.push(`${outOfStockCount} produit${outOfStockCount > 1 ? 's' : ''} en rupture de stock.`);
    }
    if (lowStockCount > 0) {
      parts.push(`${lowStockCount} produit${lowStockCount > 1 ? 's' : ''} en stock faible.`);
    }
    return parts.join(' ');
  }
}
