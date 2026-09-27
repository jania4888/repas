import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { environment } from '@environments/environment';

export interface PosReceiptLine {
  designation: string;
  quantity: number;
  unitPriceTTC: number;
  lineTotalTTC: number;
}

export interface PosReceiptVatDetail {
  rateDisplay: string;
  vatAmount: number;
}

export interface PosReceiptModel {
  companyName: string;
  companyAddressLine: string;
  companyEmail: string;
  logoUrl: string | null;
  documentBanner: string;
  clientName: string;
  clientIdDisplay: string;
  invoiceNumber: string;
  issuedAt: Date;
  lines: PosReceiptLine[];
  subTotalHT: number;
  remise: number;
  baseTVA: number;
  totalTVA: number;
  vatDetails: PosReceiptVatDetail[];
  timbreFiscal: number;
  totalTTC: number;
  grandTotal: number;
  paymentLabel: string;
  footerLegal: string;
  poweredByLabel: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

@Component({
  selector: 'app-pos-receipt',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (receipt) {
      <div class="pos-receipt" #receiptEl>
        <div class="pos-receipt__content">
          @if (receipt.logoUrl) {
            <div class="pos-receipt__logo-wrap">
              <img class="pos-receipt__logo" [src]="receipt.logoUrl" alt="" />
            </div>
          }
          <div class="pos-receipt__header">
            <h2 class="pos-receipt__title">{{ receipt.companyName }}</h2>
            @if (receipt.companyAddressLine) {
              <p class="pos-receipt__muted">{{ receipt.companyAddressLine }}</p>
            }
            @if (receipt.companyEmail) {
              <p class="pos-receipt__muted">Email: {{ receipt.companyEmail }}</p>
            }
          </div>
          <div class="pos-receipt__banner">{{ receipt.documentBanner }}</div>
          <div class="pos-receipt__meta">
            <div class="pos-receipt__meta-col">
              <p class="pos-receipt__label" i18n="@@pos.components.nom.91e87d17">Nom:</p>
              <p class="pos-receipt__value">{{ receipt.clientName }}</p>
              <p class="pos-receipt__label" i18n="@@pos.components.client.id.09b4aaeb">Client Id:</p>
              <p class="pos-receipt__value">{{ receipt.clientIdDisplay }}</p>
            </div>
            <div class="pos-receipt__meta-col pos-receipt__meta-col--right">
              <p class="pos-receipt__label" i18n="@@pos.components.facture.n.6f7ea1be">Facture N°:</p>
              <p class="pos-receipt__value">{{ receipt.invoiceNumber || '—' }}</p>
              <p class="pos-receipt__label" i18n="@@pos.components.date.81b7d2ea">Date:</p>
              <p class="pos-receipt__value">{{ formatDate(receipt.issuedAt) }}</p>
            </div>
          </div>
          <div class="pos-receipt__rule"></div>
          <table class="pos-receipt__table">
            <thead>
              <tr>
                <th class="pos-receipt__th-qty" i18n="@@pos.components.qte.a4772129">Qté</th>
                <th class="pos-receipt__th-art" i18n="@@pos.components.article.4360c2dc">Article</th>
                <th class="pos-receipt__th-num" i18n="@@pos.components.prix.2d5eddef">Prix</th>
                <th class="pos-receipt__th-num" i18n="@@pos.components.total.b25928c6">Total</th>
              </tr>
            </thead>
            <tbody>
              @for (line of receipt.lines; track line.designation + line.quantity) {
                <tr>
                  <td class="pos-receipt__td-qty">{{ line.quantity }}</td>
                  <td class="pos-receipt__td-art">{{ line.designation }}</td>
                  <td class="pos-receipt__td-num" i18n="@@pos.components.dt.21cd369f">{{ formatAmount(line.unitPriceTTC) }} DT</td>
                  <td class="pos-receipt__td-num" i18n="@@pos.components.dt.645d6176">{{ formatAmount(line.lineTotalTTC) }} DT</td>
                </tr>
              }
            </tbody>
          </table>
          <div class="pos-receipt__rule"></div>
          <div class="pos-receipt__totals">
            <div class="pos-receipt__total-row" i18n="@@pos.components.sous.total.dt.d0754699">
              <span>Sous-Total:</span>
              <span>{{ formatAmount(receipt.subTotalHT) }} DT</span>
            </div>
            <div class="pos-receipt__total-row">
              <span i18n="@@pos.components.remise.8b875876">Remise:</span>
              <span>{{ formatAmount(receipt.remise) }}</span>
            </div>
            <div class="pos-receipt__rule pos-receipt__rule--short"></div>
            <div class="pos-receipt__total-row" i18n="@@pos.components.base.tva.dt.4bde2f1e">
              <span>BASE TVA:</span>
              <span>{{ formatAmount(receipt.baseTVA) }} DT</span>
            </div>
            <div class="pos-receipt__total-row" i18n="@@pos.components.total.tva.dt.9a313b86">
              <span>TOTAL TVA:</span>
              <span>{{ formatAmount(receipt.totalTVA) }} DT</span>
            </div>
            @if (receipt.vatDetails.length > 1) {
              @for (d of receipt.vatDetails; track d.rateDisplay) {
                <div class="pos-receipt__total-row pos-receipt__total-row--sub" i18n="@@pos.components.dont.tva.dt.f0cd4361">
                  <span> dont TVA {{ d.rateDisplay }}</span>
                  <span>{{ formatAmount(d.vatAmount) }} DT</span>
                </div>
              }
            }
            <div class="pos-receipt__total-row" i18n="@@pos.components.timbre.fiscal.dt.1cb8d8d4">
              <span>Timbre fiscal:</span>
              <span>{{ formatAmount(receipt.timbreFiscal) }} DT</span>
            </div>
            <div class="pos-receipt__rule pos-receipt__rule--short"></div>
            <div class="pos-receipt__total-row" i18n="@@pos.components.facture.totale.dt.d4ad2517">
              <span>Facture totale:</span>
              <span>{{ formatAmount(receipt.grandTotal) }} DT</span>
            </div>
            <div class="pos-receipt__total-row" i18n="@@pos.components.payable.dt.5c80cdad">
              <span>Payable :</span>
              <span>{{ formatAmount(receipt.grandTotal) }} DT</span>
            </div>
            <div class="pos-receipt__total-row pos-receipt__total-row--strong" i18n="@@pos.components.total.a.payer.dt.2158b743">
              <span>Total à payer:</span>
              <span>{{ formatAmount(receipt.grandTotal) }} DT</span>
            </div>
          </div>
          <p class="pos-receipt__payment">{{ receipt.paymentLabel }}</p>
          <div class="pos-receipt__rule"></div>
          @if (receipt.footerLegal) {
            <div class="pos-receipt__footer-legal">{{ receipt.footerLegal }}</div>
          }
          <div class="pos-receipt__rule"></div>
          <p class="pos-receipt__powered">{{ receipt.poweredByLabel }}</p>
        </div>
      </div>
    }
  `,
  styles: [`
    @media screen {
      .pos-receipt {
        position: absolute;
        left: -9999px;
        top: 0;
        width: 58mm;
      }
    }

    .pos-receipt__content {
      width: 58mm;
      max-width: 58mm;
      padding: 6px;
      font-family: 'Courier New', Courier, monospace;
      font-size: 10px;
      line-height: 1.35;
      color: #000;
      box-sizing: border-box;
    }

    .pos-receipt__logo-wrap {
      text-align: center;
      margin-bottom: 6px;
    }

    .pos-receipt__logo {
      max-height: 48px;
      max-width: 48px;
      object-fit: contain;
    }

    .pos-receipt__header {
      text-align: center;
      margin-bottom: 6px;
    }

    .pos-receipt__title {
      font-size: 13px;
      font-weight: bold;
      margin: 0 0 4px 0;
    }

    .pos-receipt__muted {
      margin: 2px 0;
      font-size: 9px;
      word-break: break-word;
    }

    .pos-receipt__banner {
      text-align: center;
      font-weight: bold;
      font-size: 9px;
      margin: 6px 0;
      padding: 2px 0;
      border-top: 1px dashed #000;
      border-bottom: 1px dashed #000;
    }

    .pos-receipt__meta {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 6px;
    }

    .pos-receipt__meta-col {
      flex: 1;
      min-width: 0;
    }

    .pos-receipt__meta-col--right {
      text-align: right;
    }

    .pos-receipt__label {
      font-weight: bold;
      margin: 0;
      font-size: 9px;
    }

    .pos-receipt__value {
      margin: 0 0 4px 0;
      font-size: 9px;
      word-break: break-word;
    }

    .pos-receipt__rule {
      border: none;
      border-top: 1px dashed #000;
      margin: 6px 0;
    }

    .pos-receipt__rule--short {
      margin: 4px 0;
      max-width: 70%;
      margin-left: auto;
    }

    .pos-receipt__table {
      width: 100%;
      border-collapse: collapse;
      font-size: 9px;
      table-layout: fixed;
    }

    .pos-receipt__table th {
      text-align: left;
      font-weight: bold;
      padding: 2px 0;
      border-bottom: 1px dashed #000;
    }

    .pos-receipt__th-qty { width: 14%; }
    .pos-receipt__th-art { width: 38%; }
    .pos-receipt__th-num { width: 24%; text-align: right; }

    .pos-receipt__td-qty {
      vertical-align: top;
      padding: 3px 2px 3px 0;
    }

    .pos-receipt__td-art {
      word-break: break-word;
      vertical-align: top;
      padding: 3px 2px;
    }

    .pos-receipt__td-num {
      text-align: right;
      white-space: nowrap;
      vertical-align: top;
      padding: 3px 0;
    }

    .pos-receipt__totals {
      text-align: right;
      font-size: 9px;
    }

    .pos-receipt__total-row {
      display: flex;
      justify-content: flex-end;
      gap: 6px;
      margin-bottom: 2px;
    }

    .pos-receipt__total-row span:first-child {
      font-weight: bold;
    }

    .pos-receipt__total-row--sub span:first-child {
      font-weight: normal;
      font-size: 8px;
    }

    .pos-receipt__total-row--strong {
      font-weight: bold;
      margin-top: 4px;
    }

    .pos-receipt__payment {
      text-align: center;
      font-size: 8px;
      margin: 6px 0 0;
      color: #333;
    }

    .pos-receipt__footer-legal {
      text-align: center;
      font-weight: bold;
      font-size: 8px;
      margin: 6px 0;
      word-break: break-word;
    }

    .pos-receipt__powered {
      text-align: center;
      font-size: 8px;
      margin: 6px 0 0;
      color: #444;
    }

    @media print {
      body * { visibility: hidden; }
      .pos-receipt, .pos-receipt * { visibility: visible; }
      .pos-receipt {
        position: absolute;
        left: 0;
        top: 0;
        width: 58mm;
      }
    }
  `]
})
export class PosReceiptComponent {
  @Input() receipt: PosReceiptModel | null = null;

  static emptyModel(): PosReceiptModel {
    return {
      companyName: '',
      companyAddressLine: '',
      companyEmail: '',
      logoUrl: null,
      documentBanner: '---------- REÇU DE DÉTAIL ----------',
      clientName: '',
      clientIdDisplay: '',
      invoiceNumber: '',
      issuedAt: new Date(),
      lines: [],
      subTotalHT: 0,
      remise: 0,
      baseTVA: 0,
      totalTVA: 0,
      vatDetails: [],
      timbreFiscal: 0,
      totalTTC: 0,
      grandTotal: 0,
      paymentLabel: '',
      footerLegal: '',
      poweredByLabel: `Powered by ${environment.appName}`
    };
  }

  private static readonly EMPTY_RECEIPT = PosReceiptComponent.emptyModel();

  get safeReceipt(): PosReceiptModel {
    return this.receipt ?? PosReceiptComponent.EMPTY_RECEIPT;
  }

  formatDate(d: Date): string {
    return d.toLocaleString('fr-TN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  }

  formatAmount(amount: number): string {
    return amount.toLocaleString('fr-TN', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3
    });
  }

  print(): void {
    const r = this.receipt;
    if (!r || !r.lines.length) return;

    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const logoBlock = r.logoUrl
      ? `<div style="text-align:center;margin-bottom:6px"><img src="${escapeHtml(r.logoUrl)}" alt="" style="max-height:48px;max-width:48px;object-fit:contain" /></div>`
      : '';

    const vatSubRows =
      r.vatDetails.length > 1
        ? r.vatDetails
            .map(
              d => `
          <div style="display:flex;justify-content:flex-end;gap:6px;margin-bottom:2px;font-size:8px">
            <span> dont TVA ${escapeHtml(d.rateDisplay)}</span>
            <span>${this.formatAmount(d.vatAmount)} DT</span>
          </div>`
            )
            .join('')
        : '';

    const footerLegalBlock = r.footerLegal
      ? `<div style="text-align:center;font-weight:bold;font-size:8px;margin:6px 0;word-break:break-word">${escapeHtml(r.footerLegal)}</div>`
      : '';

    const rowsHtml = r.lines
      .map(
        line => `
        <tr>
          <td style="vertical-align:top;padding:3px 2px 3px 0;width:14%">${line.quantity}</td>
          <td style="vertical-align:top;padding:3px 2px;word-break:break-word">${escapeHtml(line.designation)}</td>
          <td style="vertical-align:top;text-align:right;white-space:nowrap;padding:3px 0">${this.formatAmount(line.unitPriceTTC)} DT</td>
          <td style="vertical-align:top;text-align:right;white-space:nowrap;padding:3px 0">${this.formatAmount(line.lineTotalTTC)} DT</td>
        </tr>`
      )
      .join('');

    const styles = `
      body { font-family: 'Courier New', Courier, monospace; font-size: 10px; width: 58mm; margin: 0; padding: 6px; color: #000; box-sizing: border-box; line-height: 1.35; }
      .h { text-align: center; margin-bottom: 6px; }
      .t { font-size: 13px; font-weight: bold; margin: 0 0 4px 0; }
      .m { margin: 2px 0; font-size: 9px; word-break: break-word; }
      .banner { text-align: center; font-weight: bold; font-size: 9px; margin: 6px 0; padding: 2px 0; border-top: 1px dashed #000; border-bottom: 1px dashed #000; }
      .meta { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
      .col { flex: 1; min-width: 0; }
      .col-r { text-align: right; }
      .lb { font-weight: bold; margin: 0; font-size: 9px; }
      .vl { margin: 0 0 4px 0; font-size: 9px; word-break: break-word; }
      .rule { border: none; border-top: 1px dashed #000; margin: 6px 0; }
      .rule-s { border: none; border-top: 1px dashed #000; margin: 4px 0; max-width: 70%; margin-left: auto; }
      table.items { width: 100%; border-collapse: collapse; font-size: 9px; table-layout: fixed; }
      table.items th { text-align: left; font-weight: bold; padding: 2px 0; border-bottom: 1px dashed #000; }
      th.nq { width: 14%; } th.na { width: 38%; } th.nn { width: 24%; text-align: right; }
      .tot { text-align: right; font-size: 9px; }
      .tr { display: flex; justify-content: flex-end; gap: 6px; margin-bottom: 2px; }
      .tr span:first-child { font-weight: bold; }
      .tr-strong { font-weight: bold; margin-top: 4px; }
      .pay { text-align: center; font-size: 8px; margin: 6px 0 0; color: #333; }
      .pow { text-align: center; font-size: 8px; margin: 6px 0 0; color: #444; }
    `;

    printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Ticket</title>
  <style>${styles}</style>
</head>
<body>
  ${logoBlock}
  <div class="h">
    <p class="t">${escapeHtml(r.companyName)}</p>
    ${r.companyAddressLine ? `<p class="m">${escapeHtml(r.companyAddressLine)}</p>` : ''}
    ${r.companyEmail ? `<p class="m">Email: ${escapeHtml(r.companyEmail)}</p>` : ''}
  </div>
  <div class="banner">${escapeHtml(r.documentBanner)}</div>
  <div class="meta">
    <div class="col">
      <p class="lb">Nom:</p>
      <p class="vl">${escapeHtml(r.clientName)}</p>
      <p class="lb">Client Id:</p>
      <p class="vl">${escapeHtml(r.clientIdDisplay)}</p>
    </div>
    <div class="col col-r">
      <p class="lb">Facture N°:</p>
      <p class="vl">${escapeHtml(r.invoiceNumber || '—')}</p>
      <p class="lb">Date:</p>
      <p class="vl">${escapeHtml(this.formatDate(r.issuedAt))}</p>
    </div>
  </div>
  <div class="rule"></div>
  <table class="items">
    <thead>
      <tr>
        <th class="nq">Qté</th>
        <th class="na">Article</th>
        <th class="nn">Prix</th>
        <th class="nn">Total</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <div class="rule"></div>
  <div class="tot">
    <div class="tr"><span>Sous-Total:</span><span>${this.formatAmount(r.subTotalHT)} DT</span></div>
    <div class="tr"><span>Remise:</span><span>${this.formatAmount(r.remise)}</span></div>
    <div class="rule-s"></div>
    <div class="tr"><span>BASE TVA:</span><span>${this.formatAmount(r.baseTVA)} DT</span></div>
    <div class="tr"><span>TOTAL TVA:</span><span>${this.formatAmount(r.totalTVA)} DT</span></div>
    ${vatSubRows}
    <div class="tr"><span>Timbre fiscal:</span><span>${this.formatAmount(r.timbreFiscal)} DT</span></div>
    <div class="rule-s"></div>
    <div class="tr"><span>Facture totale:</span><span>${this.formatAmount(r.grandTotal)} DT</span></div>
    <div class="tr"><span>Payable :</span><span>${this.formatAmount(r.grandTotal)} DT</span></div>
    <div class="tr tr-strong"><span>Total à payer:</span><span>${this.formatAmount(r.grandTotal)} DT</span></div>
  </div>
  <p class="pay">${escapeHtml(r.paymentLabel)}</p>
  <div class="rule"></div>
  ${footerLegalBlock}
  <div class="rule"></div>
  <p class="pow">${escapeHtml(r.poweredByLabel)}</p>
</body>
</html>`);
    printWindow.document.close();
    printWindow.focus();
    const onAfterPrint = (): void => {
      printWindow.removeEventListener('afterprint', onAfterPrint);
      printWindow.close();
    };
    printWindow.addEventListener('afterprint', onAfterPrint);
    setTimeout(() => printWindow.print(), 250);
  }
}
