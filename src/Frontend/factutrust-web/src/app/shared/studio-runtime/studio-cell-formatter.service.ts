import { Injectable } from '@angular/core';

export type StudioCellFormat =
  | 'text' | 'date' | 'datetime' | 'number' | 'money' | 'boolean' | 'uuid' | 'status' | 'fk';

export interface StudioFormatOptions {
  statusMap?: Record<string, string>;
  lookupTable?: string | null;
  lookupDisplayColumn?: string | null;
  dateFormat?: string | null;
}

export interface StudioColumnMeta {
  key: string;
  label: string;
  kind?: 'dimension' | 'measure';
  format?: StudioCellFormat | null;
  formatOptions?: StudioFormatOptions | null;
  displayValue?: string | null;
}

@Injectable({ providedIn: 'root' })
export class StudioCellFormatterService {
  private readonly dateFmt = new Intl.DateTimeFormat('fr-FR');
  private readonly dateTimeFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  private readonly numberFmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 4 });
  private readonly moneyFmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'TND' });

  formatCell(value: unknown, meta?: StudioColumnMeta | null): string {
    if (meta?.displayValue != null && meta.displayValue !== '') return meta.displayValue;
    if (value === null || value === undefined || value === '') return '-';
    const format = meta?.format ?? this.inferFormat(value, meta?.key);
    switch (format) {
      case 'boolean': return value === true || value === 'true' || value === 1 || value === '1' ? $localize`:@@shared.studio-cell-formatter.ts.oui.eaa02f3f:Oui` : $localize`:@@shared.studio-cell-formatter.ts.non.a7219939:Non`;
      case 'date': return this.formatDate(value, false);
      case 'datetime': return this.formatDate(value, true);
      case 'number': return this.formatNumber(value);
      case 'money': return this.formatMoney(value);
      case 'uuid': return this.truncateUuid(String(value));
      case 'status': return this.formatStatus(value, meta?.formatOptions?.statusMap);
      case 'fk': return meta?.displayValue ?? this.truncateUuid(String(value));
      default: return String(value);
    }
  }

  statusSeverity(value: unknown): 'success' | 'warn' | 'danger' | 'info' | 'neutral' {
    const key = String(value ?? '').toLowerCase();
    if (['4', 'cancelled', 'annul'].some(x => key.includes(x))) return 'danger';
    if (['3', 'completed', 'valid', 'done', 'active'].some(x => key.includes(x))) return 'success';
    if (['2', 'pending', 'draft', 'brouillon'].some(x => key.includes(x))) return 'warn';
    return 'info';
  }

  isUuid(value: unknown): boolean {
    return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  }

  private inferFormat(value: unknown, key?: string): StudioCellFormat {
    const k = (key ?? '').toLowerCase();
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'number') return 'number';
    if (this.isUuid(value)) return k.endsWith('id') && k !== 'id' ? 'fk' : 'uuid';
    if (typeof value === 'string') {
      if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return 'datetime';
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'date';
      if (k.includes('status') || k.includes('state')) return 'status';
    }
    return 'text';
  }

  private formatDate(value: unknown, withTime: boolean): string {
    const d = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
    return withTime ? this.dateTimeFmt.format(d) : this.dateFmt.format(d);
  }

  private formatNumber(value: unknown): string {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? this.numberFmt.format(n) : String(value);
  }

  private formatMoney(value: unknown): string {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? this.moneyFmt.format(n) : String(value);
  }

  private truncateUuid(value: string): string {
    return this.isUuid(value) ? value.slice(0, 8) + '…' : value;
  }

  private formatStatus(value: unknown, statusMap?: Record<string, string>): string {
    const key = String(value);
    return statusMap?.[key] ?? key;
  }
}