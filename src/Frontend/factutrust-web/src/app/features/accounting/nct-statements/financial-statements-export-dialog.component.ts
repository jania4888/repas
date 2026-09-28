/// <reference types="@angular/localize" />
import { Component, EventEmitter, Input, OnChanges, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { CheckboxModule } from 'primeng/checkbox';
import { DatePickerModule } from 'primeng/datepicker';
import { ButtonComponent } from '@shared/components/button/button.component';
import {
  AccountingService,
  NctAnnexFamily,
  NctDetailedNoteDto,
  NctFinancialStatementsDto,
  NctLiasseExportOptions
} from '../services/accounting.service';
import { PrintPreviewService } from '@core/services/print-preview.service';
import { ToastService } from '@core/services/toast.service';

const FAMILY_ACTIF: NctAnnexFamily = 'Actif';
const FAMILY_PASSIF: NctAnnexFamily = 'Passif';
const FAMILY_CDR: NctAnnexFamily = 'IncomeStatement';
const FAMILY_FLUX: NctAnnexFamily = 'CashFlow';

@Component({
  selector: 'app-financial-statements-export-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, DialogModule, CheckboxModule, DatePickerModule, ButtonComponent],
  template: `
    <p-dialog
      header="États financiers" i18n-header="@@accounting.nct-statements.etats.financiers.688bd4ed"
      [visible]="visible"
      (visibleChange)="onVisibleChange($event)"
      [modal]="true"
      [style]="{ width: '36rem' }"
      [draggable]="false"
      [closable]="!busy()"
      styleClass="fs-export-dialog">
      <div class="fs-params">
        <div class="fs-field">
          <label for="fs-asof" i18n="@@accounting.nct-statements.arretee.au.c829a7a3">Arrêtée au</label>
          <p-datepicker
            inputId="fs-asof"
            [(ngModel)]="asOfDate"
            dateFormat="dd/mm/yy"
            [showIcon]="true"
            appendTo="body"
            [disabled]="busy()" />
        </div>
        <div class="fs-radios" role="radiogroup" aria-label="Comparatif N-1" i18n-aria-label="@@accounting.nct-statements.comparatif.n.1.cd3417a4">
          <label class="fs-radio">
            <input type="radio" name="n1Mode" [ngModel]="previousYearLabelMode" (ngModelChange)="setPreviousYearMode($event)" [value]="0" [disabled]="busy()" /><ng-container i18n="@@accounting.nct-statements.n.1.arretee.au.31.12.a32b6d42">
            N-1 arrêtée au 31/12
          </ng-container></label>
          <label class="fs-radio">
            <input type="radio" name="n1Mode" [ngModel]="previousYearLabelMode" (ngModelChange)="setPreviousYearMode($event)" [value]="1" [disabled]="busy()" /><ng-container i18n="@@accounting.nct-statements.n.1.arretee.a.la.periode.selectionnee.d13642a3">
            N-1 arrêtée à la période sélectionnée
          </ng-container></label>
        </div>
      </div>

      <div class="fs-grid">
        <div class="fs-col">
          <label class="fs-check"><p-checkbox [(ngModel)]="includeAssets" [binary]="true" inputId="fs-actif" [disabled]="busy()" /><ng-container i18n="@@accounting.nct-statements.actif.2eb75f84"> Actif</ng-container></label>
          <label class="fs-check"><p-checkbox [(ngModel)]="includeLiabilities" [binary]="true" inputId="fs-passif" [disabled]="busy()" /><ng-container i18n="@@accounting.nct-statements.passif.1eede0cb"> Passif</ng-container></label>
          <label class="fs-check"><p-checkbox [(ngModel)]="includeIncomeStatement" [binary]="true" inputId="fs-cdr" [disabled]="busy()" /><ng-container i18n="@@accounting.nct-statements.comptes.de.resultat.039822fa"> Comptes de résultat</ng-container></label>
          <label class="fs-check"><p-checkbox [(ngModel)]="includeCashFlow" [binary]="true" inputId="fs-flux" [disabled]="busy()" /><ng-container i18n="@@accounting.nct-statements.flux.de.tresorerie.b60dc8b6"> Flux de trésorerie</ng-container></label>
        </div>
        <div class="fs-col">
          <label class="fs-check">
            <p-checkbox
              [(ngModel)]="includeAnnexAssets"
              [binary]="true"
              inputId="fs-ann-actif"
              [disabled]="busy()"
              (ngModelChange)="onAnnexToggle(FAMILY_ACTIF, $event)" /><ng-container i18n="@@accounting.nct-statements.annexes.actif.c4dff284">
            Annexes actif
          </ng-container></label>
          @if (includeAnnexAssets) {
            <div class="fs-notes">
              @for (n of notesFor(FAMILY_ACTIF); track n.number) {
                <label class="fs-note">
                  <p-checkbox
                    [ngModel]="isNoteSelected(n.number)"
                    (ngModelChange)="setNoteSelected(n.number, $event)"
                    [binary]="true"
                    [inputId]="'fs-note-' + n.number"
                    [disabled]="busy()" /><ng-container i18n="@@accounting.nct-statements.note.5e087158">
                  Note {{ n.number }} — {{ n.title }}
                </ng-container></label>
              }
            </div>
          }

          <label class="fs-check">
            <p-checkbox
              [(ngModel)]="includeAnnexLiabilities"
              [binary]="true"
              inputId="fs-ann-passif"
              [disabled]="busy()"
              (ngModelChange)="onAnnexToggle(FAMILY_PASSIF, $event)" /><ng-container i18n="@@accounting.nct-statements.annexes.passif.235c78b0">
            Annexes passif
          </ng-container></label>
          @if (includeAnnexLiabilities) {
            <div class="fs-notes">
              @for (n of notesFor(FAMILY_PASSIF); track n.number) {
                <label class="fs-note">
                  <p-checkbox
                    [ngModel]="isNoteSelected(n.number)"
                    (ngModelChange)="setNoteSelected(n.number, $event)"
                    [binary]="true"
                    [inputId]="'fs-note-' + n.number"
                    [disabled]="busy()" /><ng-container i18n="@@accounting.nct-statements.note.5e087158">
                  Note {{ n.number }} — {{ n.title }}
                </ng-container></label>
              }
            </div>
          }

          <label class="fs-check">
            <p-checkbox
              [(ngModel)]="includeAnnexIncomeStatement"
              [binary]="true"
              inputId="fs-ann-cdr"
              [disabled]="busy()"
              (ngModelChange)="onAnnexToggle(FAMILY_CDR, $event)" /><ng-container i18n="@@accounting.nct-statements.annexes.comptes.de.resultat.2bad8cb6">
            Annexes comptes de résultat
          </ng-container></label>
          @if (includeAnnexIncomeStatement) {
            <div class="fs-notes">
              @for (n of notesFor(FAMILY_CDR); track n.number) {
                <label class="fs-note">
                  <p-checkbox
                    [ngModel]="isNoteSelected(n.number)"
                    (ngModelChange)="setNoteSelected(n.number, $event)"
                    [binary]="true"
                    [inputId]="'fs-note-' + n.number"
                    [disabled]="busy()" /><ng-container i18n="@@accounting.nct-statements.note.5e087158">
                  Note {{ n.number }} — {{ n.title }}
                </ng-container></label>
              }
            </div>
          }

          <label class="fs-check">
            <p-checkbox
              [(ngModel)]="includeAnnexCashFlow"
              [binary]="true"
              inputId="fs-ann-flux"
              [disabled]="busy()"
              (ngModelChange)="onAnnexToggle(FAMILY_FLUX, $event)" /><ng-container i18n="@@accounting.nct-statements.annexes.flux.de.tresorerie.2712c7d4">
            Annexes flux de trésorerie
          </ng-container></label>
          @if (includeAnnexCashFlow) {
            <div class="fs-notes">
              @for (n of notesFor(FAMILY_FLUX); track n.number) {
                <label class="fs-note">
                  <p-checkbox
                    [ngModel]="isNoteSelected(n.number)"
                    (ngModelChange)="setNoteSelected(n.number, $event)"
                    [binary]="true"
                    [inputId]="'fs-note-' + n.number"
                    [disabled]="busy()" /><ng-container i18n="@@accounting.nct-statements.note.5e087158">
                  Note {{ n.number }} — {{ n.title }}
                </ng-container></label>
              }
            </div>
          }
        </div>
      </div>

      @if (localError()) {
        <p class="fs-error" role="alert">{{ localError() }}</p>
      }

      <ng-template pTemplate="footer">
        <div class="fs-footer">
          <i class="pi pi-print fs-footer-icon" aria-hidden="true"></i>
          <div class="fs-footer-actions">
            <app-button variant="secondary" icon="pi pi-eye" type="button" (click)="preview()" [disabled]="busy() || !hasSelection()" i18n="@@accounting.nct-statements.apercu.f0f53004"> Aperçu </app-button>
            <app-button variant="primary" icon="pi pi-print" type="button" (click)="print()" [disabled]="busy() || !hasSelection()" i18n="@@accounting.nct-statements.imprimer.5382c09d"> Imprimer </app-button>
            <app-button variant="secondary" type="button" (click)="close()" [disabled]="busy()" i18n="@@accounting.nct-statements.fermer.5ab4ec64">Fermer</app-button>
          </div>
        </div>
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .fs-params { display:flex; flex-direction:column; gap:var(--spacing-3); margin-bottom:var(--spacing-4); }
    .fs-field { display:flex; flex-direction:column; gap:0.35rem; font-size:var(--font-size-sm); font-weight:var(--font-weight-medium); }
    .fs-radios { display:flex; flex-direction:column; gap:0.4rem; }
    .fs-radio { display:flex; align-items:center; gap:0.5rem; font-size:var(--font-size-sm); font-weight:var(--font-weight-normal); cursor:pointer; }
    .fs-grid { display:grid; grid-template-columns:1fr 1fr; gap:var(--spacing-4); }
    .fs-col { display:flex; flex-direction:column; gap:0.55rem; }
    .fs-check { display:flex; align-items:center; gap:0.5rem; font-size:var(--font-size-sm); cursor:pointer; }
    .fs-notes { display:flex; flex-direction:column; gap:0.35rem; margin-block:0 0.35rem; margin-inline:1.35rem 0; }
    .fs-note { display:flex; align-items:flex-start; gap:0.45rem; font-size:var(--font-size-xs); color:var(--color-text-secondary); cursor:pointer; }
    .fs-error { margin:var(--spacing-3) 0 0; color:var(--color-danger-700,#b91c1c); font-size:var(--font-size-sm); }
    .fs-footer { display:flex; align-items:center; justify-content:space-between; gap:var(--spacing-3); width:100%; }
    .fs-footer-icon { color:var(--color-text-tertiary); }
    .fs-footer-actions { display:flex; flex-wrap:wrap; gap:var(--spacing-2); justify-content:flex-end; }
    @media (max-width: 640px) {
      .fs-grid { grid-template-columns:1fr; }
    }
  `
})
export class FinancialStatementsExportDialogComponent implements OnChanges {
  readonly FAMILY_ACTIF = FAMILY_ACTIF;
  readonly FAMILY_PASSIF = FAMILY_PASSIF;
  readonly FAMILY_CDR = FAMILY_CDR;
  readonly FAMILY_FLUX = FAMILY_FLUX;

  private readonly api = inject(AccountingService);
  private readonly printPreview = inject(PrintPreviewService);
  private readonly toast = inject(ToastService);

  @Input() visible = false;
  @Input() fiscalYear = new Date().getFullYear();
  @Input() statements: NctFinancialStatementsDto | null = null;
  @Output() visibleChange = new EventEmitter<boolean>();

  asOfDate: Date = new Date();
  previousYearLabelMode: 0 | 1 = 0;
  includeAssets = true;
  includeLiabilities = true;
  includeIncomeStatement = true;
  includeCashFlow = true;
  includeAnnexAssets = true;
  includeAnnexLiabilities = true;
  includeAnnexIncomeStatement = true;
  includeAnnexCashFlow = true;
  private selectedNotes = new Set<number>();

  readonly busy = signal(false);
  readonly localError = signal<string | null>(null);

  readonly detailedNotes = computed(() => this.statements?.detailedNotes ?? []);

  ngOnChanges(): void {
    if (this.visible) {
      this.resetDefaults();
    }
  }

  notesFor(family: NctAnnexFamily): NctDetailedNoteDto[] {
    return this.detailedNotes().filter(n => n.family === family);
  }

  isNoteSelected(num: number): boolean {
    return this.selectedNotes.has(num);
  }

  setNoteSelected(num: number, selected: boolean): void {
    if (selected) this.selectedNotes.add(num);
    else this.selectedNotes.delete(num);
    this.localError.set(null);
  }

  setPreviousYearMode(value: string | number): void {
    this.previousYearLabelMode = Number(value) === 1 ? 1 : 0;
  }

  onAnnexToggle(family: NctAnnexFamily, checked: boolean): void {
    const nums = this.notesFor(family).map(n => n.number);
    for (const n of nums) {
      if (checked) this.selectedNotes.add(n);
      else this.selectedNotes.delete(n);
    }
    this.localError.set(null);
  }

  hasSelection(): boolean {
    const docs =
      this.includeAssets ||
      this.includeLiabilities ||
      this.includeIncomeStatement ||
      this.includeCashFlow;
    const annex =
      (this.includeAnnexAssets ||
        this.includeAnnexLiabilities ||
        this.includeAnnexIncomeStatement ||
        this.includeAnnexCashFlow) &&
      this.selectedNotes.size > 0;
    return docs || annex;
  }

  onVisibleChange(v: boolean): void {
    this.visibleChange.emit(v);
  }

  close(): void {
    this.visibleChange.emit(false);
  }

  preview(): void {
    this.runExport(blob => this.printPreview.openPdfForPrintPreview(blob, `liasse_nct_${this.fiscalYear}.pdf`));
  }

  print(): void {
    this.runExport(blob => this.printPreview.openPdfForPrintPreview(blob, `liasse_nct_${this.fiscalYear}.pdf`));
  }

  private runExport(onBlob: (blob: Blob) => void): void {
    if (!this.hasSelection()) {
      this.localError.set($localize`:@@accounting.financial-statements-export-dialog.ts.selectionnez.au.moins.un.etat.ou.une.not.1b840170:Sélectionnez au moins un état ou une note annexe.`);
      return;
    }
    this.localError.set(null);
    const options = this.buildOptions();
    this.busy.set(true);
    this.api.exportNctStatementsPdfWithOptions(options).subscribe({
      next: blob => {
        this.busy.set(false);
        onBlob(blob);
      },
      error: () => {
        this.busy.set(false);
        this.localError.set($localize`:@@accounting.financial-statements-export-dialog.ts.la.generation.du.pdf.a.echoue.d36dc216:La génération du PDF a échoué.`);
        this.toast.add({
          severity: 'error',
          summary: $localize`:@@financial-statements-export-dialog.component.summary._tats_financiers:États financiers`,
          detail: $localize`:@@financial-statements-export-dialog.component.detail.LagénérationduPDFaé:La génération du PDF a échoué.`,
          life: 5000
        });
      }
    });
  }

  private buildOptions(): NctLiasseExportOptions {
    const fallback = new Date(this.fiscalYear, 11, 31);
    const isValidAsOfDate =
      this.asOfDate instanceof Date &&
      !isNaN(this.asOfDate.getTime()) &&
      this.asOfDate.getFullYear() >= 2000 &&
      this.asOfDate.getFullYear() <= 2100;
    if (!isValidAsOfDate) {
      this.localError.set(
        $localize`:@@accounting.financial-statements-export-dialog.ts.date.d.arret.invalide.repli.sur.le.31.12.723ef309:Date d'arrêt invalide : repli sur le 31/12/${this.fiscalYear}:fiscalYear:.`
      );
    }
    const d = isValidAsOfDate ? this.asOfDate : fallback;
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return {
      fiscalYear: this.fiscalYear,
      asOfDate: `${yyyy}-${mm}-${dd}`,
      previousYearLabelMode: this.previousYearLabelMode,
      includeAssets: this.includeAssets,
      includeLiabilities: this.includeLiabilities,
      includeIncomeStatement: this.includeIncomeStatement,
      includeCashFlow: this.includeCashFlow,
      includeAnnexAssets: this.includeAnnexAssets,
      includeAnnexLiabilities: this.includeAnnexLiabilities,
      includeAnnexIncomeStatement: this.includeAnnexIncomeStatement,
      includeAnnexCashFlow: this.includeAnnexCashFlow,
      selectedNoteNumbers: Array.from(this.selectedNotes).sort((a, b) => a - b)
    };
  }

  private resetDefaults(): void {
    this.asOfDate = new Date(this.fiscalYear, 11, 31);
    this.previousYearLabelMode = 0;
    this.includeAssets = true;
    this.includeLiabilities = true;
    this.includeIncomeStatement = true;
    this.includeCashFlow = true;
    this.includeAnnexAssets = true;
    this.includeAnnexLiabilities = true;
    this.includeAnnexIncomeStatement = true;
    this.includeAnnexCashFlow = true;
    this.selectedNotes = new Set(this.detailedNotes().map(n => n.number));
    this.localError.set(null);
    this.busy.set(false);
  }
}
