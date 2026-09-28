import { Component, DestroyRef, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormGroup, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { trigger, transition, style, animate } from '@angular/animations';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { SelectModule } from 'primeng/select';
import { InputMaskModule } from 'primeng/inputmask';
import { NifMaskPasteDirective } from '@shared/validation/nif-mask-paste.directive';
import { InputSwitchModule } from 'primeng/inputswitch';
import { ErrorMessageService } from '@core/services/error-message.service';
import {
  passwordCriteria as computePasswordCriteria,
  passwordMatches as checkPasswordMatches,
  passwordMismatch as checkPasswordMismatch,
  passwordStrengthLabel as getPasswordStrengthLabel,
  passwordStrengthLevel as computePasswordStrengthLevel,
  passwordStrengthMetCount
} from '../../../shared/auth-password.helpers';
import { evaluateNifSegmentSuggestion, NifSegmentSuggestion } from '../../../shared/auth-nif-category.helpers';
import { RegistrationCatalogService, RemoteSuggestedTaxRegimeDto } from '../../registration-catalog';
import { TaxRegime } from '../../tax-regime.types';

@Component({
  selector: 'app-step-informations',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    InputTextModule,
    PasswordModule,
    SelectModule,
    InputMaskModule,
    NifMaskPasteDirective,
    InputSwitchModule
  ],
  animations: [
    trigger('fadeInOut', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(10px)' }),
        animate('300ms ease-out', style({ opacity: 1, transform: 'translateY(0)' }))
      ]),
      transition(':leave', [
        animate('200ms ease-in', style({ opacity: 0, transform: 'translateY(-10px)' }))
      ])
    ])
  ],
  templateUrl: './step-informations.component.html',
  styleUrl: './step-informations.component.scss'
})
export class StepInformationsComponent implements OnInit {
  protected readonly loc_force_du_mot_de_passe_de0bbe = $localize`:@@auth.step-informations.tpl.force.du.mot.de.passe.de0bbe05:Force du mot de passe`;

  @Input({ required: true }) form!: FormGroup;
  @Input() taxRegimes: TaxRegime[] = [];
  /** Sector-suggested tax regime (plan §3.1) — `null` when the catalog has none for this segment. */
  @Input() suggestedTaxRegime: RemoteSuggestedTaxRegimeDto | null = null;
  /** Emitted so the container can apply the shared NIF cleanup helper. */
  @Output() nifBlur = new EventEmitter<void>();

  errorMessageService = inject(ErrorMessageService);
  private readonly catalog = inject(RegistrationCatalogService);
  private readonly destroyRef = inject(DestroyRef);

  readonly strengthSegments: readonly number[] = [1, 2, 3, 4, 5];

  /** Category letter the user last dismissed the mismatch hint for (plan §3.2) — hint stays hidden until it changes. */
  private readonly dismissedForCategory = signal<string | null>(null);

  private nifValue = signal<string>('');
  private segmentValue = signal<string>('');

  /** Live (as-you-type) NIF ⇄ segment coherence suggestion (plan §3.2). */
  nifSegmentSuggestion = computed<NifSegmentSuggestion | null>(() =>
    evaluateNifSegmentSuggestion(this.nifValue(), this.segmentValue(), code => this.catalog.segmentLabel(code) || undefined)
  );

  /** True while the mismatch hint is present and not yet dismissed for this category. */
  showNifMismatchHint = computed(() => {
    const suggestion = this.nifSegmentSuggestion();
    return !!suggestion?.hintMessage && this.dismissedForCategory() !== suggestion.category.category;
  });

  ngOnInit(): void {
    const nifControl = this.form.get('nif');
    const segmentControl = this.form.get('companySegment');
    this.nifValue.set(nifControl?.value ?? '');
    this.segmentValue.set(segmentControl?.value ?? '');
    nifControl?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(v => this.nifValue.set(v ?? ''));
    segmentControl?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(v => {
        this.segmentValue.set(v ?? '');
        this.dismissedForCategory.set(null);
      });
  }

  isInvalid(field: string): boolean {
    const control = this.form.get(field);
    return !!(control?.invalid && control?.touched);
  }

  passwordMismatch(): boolean {
    return checkPasswordMismatch(this.form.get('password')?.value, this.form.get('confirmPassword')?.value);
  }

  passwordMatches(): boolean {
    return checkPasswordMatches(this.form.get('password')?.value, this.form.get('confirmPassword')?.value);
  }

  passwordCriteria() {
    return computePasswordCriteria(this.form.get('password')?.value);
  }

  passwordStrengthMetCount(): number {
    return passwordStrengthMetCount(this.passwordCriteria());
  }

  passwordStrengthLevel() {
    return computePasswordStrengthLevel(this.form.get('password')?.value, this.passwordCriteria());
  }

  passwordStrengthLabel(): string {
    return getPasswordStrengthLabel(this.passwordStrengthLevel());
  }

  passwordFieldAriaDescribedBy(): string {
    const ids: string[] = ['wiz-password-strength-hint'];
    if (this.isInvalid('password')) {
      ids.unshift('wiz-password-error');
    }
    return ids.join(' ');
  }

  confirmPasswordAriaDescribedBy(): string | null {
    if (this.isInvalid('confirmPassword') || this.passwordMismatch()) {
      return 'wiz-confirmPassword-error';
    }
    if (this.passwordMatches() && this.form.get('confirmPassword')?.value) {
      return 'wiz-confirmPassword-success';
    }
    return null;
  }

  onNifBlur(): void {
    this.nifBlur.emit();
  }

  /** Label of the segment suggested by the NIF's taxpayer category (plan §3.2), for display in the hint. */
  suggestedSegmentLabelFromNif(): string {
    const code = this.nifSegmentSuggestion()?.category.suggestedSegmentCode;
    return code ? this.catalog.segmentLabel(code) || code : '';
  }

  /** "Changer pour X" action — applies the NIF-suggested segment to the shared wizard form. */
  applySuggestedSegmentFromNif(): void {
    const code = this.nifSegmentSuggestion()?.category.suggestedSegmentCode;
    if (code) {
      this.form.get('companySegment')?.setValue(code);
    }
  }

  /** "Confirmer mon segment" action — dismisses the mismatch hint until the NIF category changes. */
  dismissNifSegmentHint(): void {
    const category = this.nifSegmentSuggestion()?.category.category;
    if (category) {
      this.dismissedForCategory.set(category);
    }
  }

  /** True when the currently-selected tax regime still matches the sector suggestion (plan §3.1). */
  isSuggestedTaxRegimeActive(): boolean {
    return this.suggestedTaxRegime != null && this.form.get('taxRegime')?.value === this.suggestedTaxRegime.regime;
  }
}
