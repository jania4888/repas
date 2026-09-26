import {
  Component, ElementRef, Input, OnChanges, OnDestroy, SimpleChanges, ViewChild, inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { environment } from '@environments/environment';
import JsBarcode from 'jsbarcode';
import { CustomFieldType } from './studio-runtime.models';

/**
 * Renders a QR-code or 1D barcode for a Studio field value.
 *  - QrCode  → PNG fetched from the authenticated backend endpoint (api/studio/qr) via HttpClient
 *    (so the bearer token interceptor applies; an <img src> would not carry it), shown as an object URL.
 *  - Barcode → rendered client-side with jsbarcode into an inline <svg> (no backend round-trip).
 * Read-only / display-only; invalid values render nothing rather than throwing.
 */
@Component({
  selector: 'app-studio-code-image',
  standalone: true,
  imports: [CommonModule],
  template: `
    <ng-container [ngSwitch]="kind">
      <ng-container *ngSwitchCase="'qr'">
        <img *ngIf="qrUrl" class="ft-code-qr" [attr.src]="qrUrl" [attr.alt]="text" />
        <span *ngIf="!qrUrl" class="ft-code-empty" i18n="@@shared.studio-runtime.studio-code-image.text.1b93795b">—</span>
      </ng-container>
      <svg *ngSwitchCase="'barcode'" #bc class="ft-code-barcode"></svg>
      <span *ngSwitchDefault class="ft-code-empty" i18n="@@shared.studio-runtime.studio-code-image.text.1b93795b">—</span>
    </ng-container>
  `,
  styles: [`
    .ft-code-qr { display: block; width: var(--ft-code-size, 88px); height: var(--ft-code-size, 88px); image-rendering: pixelated; }
    .ft-code-barcode { display: block; max-width: 100%; height: auto; }
    .ft-code-empty { color: var(--text-color-secondary); }
  `]
})
export class StudioCodeImageComponent implements OnChanges, OnDestroy {
  private readonly http = inject(HttpClient);

  @Input() value: unknown;
  @Input() fieldType: CustomFieldType = CustomFieldType.QrCode;
  @Input() config: Record<string, any> | null | undefined;

  qrUrl: string | null = null;
  private objUrl: string | null = null;
  private bcEl: SVGElement | null = null;
  private qrTimer: ReturnType<typeof setTimeout> | null = null;

  @ViewChild('bc') set barcodeRef(ref: ElementRef<SVGElement> | undefined) {
    this.bcEl = ref?.nativeElement ?? null;
    this.renderBarcode();
  }

  get kind(): 'qr' | 'barcode' | null {
    if (this.fieldType === CustomFieldType.QrCode) return 'qr';
    if (this.fieldType === CustomFieldType.Barcode) return 'barcode';
    return null;
  }

  get text(): string {
    return this.value == null ? '' : String(this.value);
  }

  ngOnChanges(_: SimpleChanges): void {
    if (this.kind === 'qr') this.scheduleQr();
    else this.renderBarcode();
  }

  ngOnDestroy(): void {
    if (this.qrTimer) clearTimeout(this.qrTimer);
    this.revoke();
  }

  // ---- QR (backend) ----
  private scheduleQr(): void {
    if (this.qrTimer) clearTimeout(this.qrTimer);
    this.qrTimer = setTimeout(() => this.fetchQr(), 350);
  }

  private fetchQr(): void {
    const text = this.text;
    if (!text) { this.revoke(); this.qrUrl = null; return; }
    this.http
      .get(`${environment.apiUrl}/studio/qr`, { params: { text }, responseType: 'blob' })
      .subscribe({
        next: blob => {
          this.revoke();
          this.objUrl = URL.createObjectURL(blob);
          this.qrUrl = this.objUrl;
        },
        error: () => { this.revoke(); this.qrUrl = null; }
      });
  }

  private revoke(): void {
    if (this.objUrl) { URL.revokeObjectURL(this.objUrl); this.objUrl = null; }
  }

  // ---- Barcode (client-side) ----
  private renderBarcode(): void {
    const el = this.bcEl;
    if (!el || this.kind !== 'barcode') return;
    this.clearSvg(el);
    const text = this.text;
    if (!text) return;
    try {
      JsBarcode(el, text, {
        format: this.barcodeFormat(),
        displayValue: true,
        height: 40,
        width: 1.6,
        margin: 4,
        fontSize: 12
      });
    } catch {
      this.clearSvg(el); // invalid value for the chosen symbology → render nothing
    }
  }

  private clearSvg(el: SVGElement): void {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  private barcodeFormat(): string {
    const f = String(this.config?.['render']?.['format'] ?? '').toLowerCase();
    return f === 'ean13' ? 'EAN13' : 'CODE128';
  }
}
