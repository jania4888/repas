import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { TabsModule } from 'primeng/tabs';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { DtsDeclarationTabComponent } from './dts-declaration-tab.component';
import { WithholdingCertificatesTabComponent } from './withholding-certificates-tab.component';
import { CnssRemittanceTabComponent } from './cnss-remittance-tab.component';

@Component({
  selector: 'app-payroll-declarations',
  standalone: true,
  imports: [
    CommonModule,
    TabsModule,
    PageHeaderComponent,
    DtsDeclarationTabComponent,
    WithholdingCertificatesTabComponent,
    CnssRemittanceTabComponent
  ],
  template: `
    <app-page-header
      title="Déclarations paie" i18n-title="Déclarations paie"
      subtitle="DTS CNSS trimestrielle, bordereau mensuel CNSS et certificats de retenue à la source (IRPP/CSS). Seuls les cycles validés ou clôturés sont inclus." />

    <p-tabs class="ft-tabs" [(value)]="activeTabIndex" [lazy]="true">
      <p-tablist>
        <p-tab [value]="0">
          <i class="pi pi-building-columns mr-2"></i>
          <span i18n="@@payroll.declarations.dts.cnss.3686f2d1">DTS CNSS</span>
        </p-tab>
        <p-tab [value]="1">
          <i class="pi pi-wallet mr-2"></i>
          <span i18n="@@payroll.declarations.bordereau.cnss.ab61ae28">Bordereau CNSS</span>
        </p-tab>
        <p-tab [value]="2">
          <i class="pi pi-file-export mr-2"></i>
          <span i18n="@@payroll.declarations.certificats.rs.2de5cc57">Certificats RS</span>
        </p-tab>
      </p-tablist>
      <p-tabpanels>
        <p-tabpanel [value]="0">
          <app-dts-declaration-tab
            [initialYear]="initialYear()"
            [initialQuarter]="initialQuarter()" />
        </p-tabpanel>
        <p-tabpanel [value]="1">
          <app-cnss-remittance-tab
            [initialYear]="initialYear()"
            [initialMonth]="initialMonth()" />
        </p-tabpanel>
        <p-tabpanel [value]="2">
          <app-withholding-certificates-tab [initialYear]="initialYear()" />
        </p-tabpanel>
      </p-tabpanels>
    </p-tabs>
  `
})
export class PayrollDeclarationsComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);

  activeTabIndex = 0;
  readonly initialYear = signal<number | null>(null);
  readonly initialQuarter = signal<number | null>(null);
  readonly initialMonth = signal<number | null>(null);

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    const year = Number(params.get('year'));
    const quarter = Number(params.get('quarter'));
    const month = Number(params.get('month'));
    const tab = params.get('tab');

    if (Number.isInteger(year) && year >= 2000 && year <= 2100) {
      this.initialYear.set(year);
    }
    if (Number.isInteger(quarter) && quarter >= 1 && quarter <= 4) {
      this.initialQuarter.set(quarter);
    }
    if (Number.isInteger(month) && month >= 1 && month <= 12) {
      this.initialMonth.set(month);
    }
    if (tab === 'certificates') {
      this.activeTabIndex = 2;
    } else if (tab === 'cnss-remittance') {
      this.activeTabIndex = 1;
    }
  }
}
