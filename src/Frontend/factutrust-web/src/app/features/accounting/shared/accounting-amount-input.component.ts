import {
  Component,
  EventEmitter,
  Input,
  Output,
  forwardRef,
  inject,
  ElementRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, FormsModule, NG_VALUE_ACCESSOR } from '@angular/forms';
import { InputNumberModule } from 'primeng/inputnumber';
import {
  ACCOUNTING_AMOUNT_FRACTION_DIGITS,
  ACCOUNTING_AMOUNT_LOCALE,
  normalizeAccountingAmount
} from './accounting-amount.utils';

export type AccountingAmountSide = 'debit' | 'credit';

@Component({
  selector: 'app-accounting-amount-input',
  standalone: true,
  imports: [CommonModule, FormsModule, InputNumberModule],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => AccountingAmountInputComponent),
      multi: true
    }
  ],
  template: `
    <p-inputNumber
      [inputId]="inputId"
      [ngModel]="value"
      (ngModelChange)="onModelChange($event)"
      (onFocus)="onFocus()"
      (onBlur)="onBlur()"
      (onKeyDown)="onKeyDown($event)"
      mode="decimal"
      [locale]="locale"
      [min]="0"
      [minFractionDigits]="minFractionDigits"
      [maxFractionDigits]="maxFractionDigits"
      [showButtons]="false"
      [useGrouping]="useGrouping"
      [disabled]="disabled"
      [attr.aria-label]="ariaLabel"
      [styleClass]="styleClass"
      [inputStyleClass]="inputStyleClass"
      [attr.data-row]="rowIndex"
      [attr.data-field]="side"
    />
  `,
  styles: `
    :host { display: block; width: 100%; min-width: 0; }
    :host ::ng-deep .accounting-amount-input--grid {
      width: 100%;
    }
    :host ::ng-deep .accounting-amount-input--grid .p-inputnumber-input {
      width: 100%;
      min-width: 0;
      padding: var(--spacing-1) var(--spacing-2);
      font-size: var(--font-size-sm);
      font-variant-numeric: tabular-nums;
      text-align: end;
      box-sizing: border-box;
    }
    :host ::ng-deep .accounting-amount-input--debit .p-inputnumber-input {
      background: var(--color-primary-50, #eff6ff);
    }
    :host ::ng-deep .accounting-amount-input--credit .p-inputnumber-input {
      background: var(--color-success-50, #f0fdf4);
    }
    :host ::ng-deep .accounting-amount-input--grid .p-inputnumber-input:focus {
      outline: 2px solid var(--color-primary-500, #3b82f6);
      outline-offset: -1px;
    }
    :host ::ng-deep .accounting-amount-input--grid .p-inputnumber-input:disabled {
      opacity: 0.7;
      cursor: not-allowed;
    }
  `
})
export class AccountingAmountInputComponent implements ControlValueAccessor {
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly locale = ACCOUNTING_AMOUNT_LOCALE;

  /**
   * Décimales de la devise saisie. Par défaut le millime, si bien que les écrans en devise de
   * tenue sont inchangés ; seule la saisie manuelle en devise étrangère le surcharge (2 pour
   * l'euro), sans quoi la colonne « Débit (EUR) » affiche « 1000,000 » et accepte un centime
   * au millime.
   */
  @Input() fractionDigits = ACCOUNTING_AMOUNT_FRACTION_DIGITS;

  @Input() inputId = '';
  @Input() ariaLabel = $localize`:@@accounting.accounting-amount-input.ts.montant.4adcd9fc:Montant`;
  @Input() disabled = false;
  @Input() side: AccountingAmountSide = 'debit';
  @Input() compact = false;
  @Input() rowIndex: number | null = null;
  @Input() navigateOnTab = false;

  /** Live value changes while typing (may be unnormalized). */
  @Output() amountChange = new EventEmitter<number | null>();
  /** Normalized value committed on blur / Enter / Tab navigation. */
  @Output() amountCommitted = new EventEmitter<number | null>();
  @Output() enterPressed = new EventEmitter<void>();
  @Output() tabFromAmount = new EventEmitter<{ shiftKey: boolean }>();

  value: number | null = null;
  isFocused = false;

  private onChange: (value: number | null) => void = () => {};
  private onTouched: () => void = () => {};
  private committed = true;

  get maxFractionDigits(): number {
    return this.fractionDigits;
  }

  get minFractionDigits(): number {
    return this.isFocused ? 0 : this.fractionDigits;
  }

  get useGrouping(): boolean {
    return !this.compact;
  }

  get styleClass(): string {
    const classes = ['accounting-amount-input'];
    if (this.compact) {
      classes.push('accounting-amount-input--grid');
    }
    classes.push(`accounting-amount-input--${this.side}`);
    return classes.join(' ');
  }

  get inputStyleClass(): string {
    return 'text-right';
  }

  writeValue(value: number | null): void {
    this.value = value === null || value === undefined ? null : normalizeAccountingAmount(value);
    this.committed = true;
  }

  registerOnChange(fn: (value: number | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
  }

  onFocus(): void {
    this.isFocused = true;
  }

  onModelChange(raw: number | null): void {
    if (this.isFocused) {
      const next = raw === null || raw === undefined || !Number.isFinite(raw) ? null : raw;
      this.value = next;
      this.committed = false;
      this.onChange(next);
      this.amountChange.emit(next);
      return;
    }

    this.applyNormalized(raw, false);
  }

  onBlur(): void {
    this.isFocused = false;
    this.onTouched();
    this.commitIfNeeded();
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.onTouched();
      this.isFocused = false;
      this.commitIfNeeded();
      this.enterPressed.emit();
      return;
    }

    if (event.key === 'Tab') {
      if (this.navigateOnTab) {
        event.preventDefault();
      }
      this.isFocused = false;
      this.commitIfNeeded();
      this.tabFromAmount.emit({ shiftKey: event.shiftKey });
    }
  }

  focus(): void {
    const input = this.host.nativeElement.querySelector('input');
    input?.focus();
  }

  private commitIfNeeded(): void {
    if (this.committed) {
      return;
    }
    this.applyNormalized(this.value, true);
  }

  private applyNormalized(raw: number | null, emitCommitted: boolean): void {
    const normalized = normalizeAccountingAmount(raw);
    const changed = normalized !== this.value;
    this.value = normalized;
    this.committed = true;
    if (changed) {
      this.onChange(normalized);
      this.amountChange.emit(normalized);
    }
    if (emitCommitted) {
      this.amountCommitted.emit(normalized);
    }
  }
}
