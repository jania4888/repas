import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { InputSwitchModule } from 'primeng/inputswitch';
import { FormsModule } from '@angular/forms';
import { TooltipModule } from 'primeng/tooltip';
import { AppModule } from '@core/models/app-module';
import { HEADCOUNT_BANDS, HeadcountBand, ModuleCatalogEntry, RegistrationCatalogService } from '../../registration-catalog';

@Component({
  selector: 'app-step-configuration',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, InputSwitchModule, TooltipModule],
  templateUrl: './step-configuration.component.html',
  styleUrl: './step-configuration.component.scss'
})
export class StepConfigurationComponent {
  @Input({ required: true }) form!: FormGroup;
  @Input() segment: string | null = '';
  @Input() domain: string | null = '';
  /** Modules just auto-enabled as a hard dependency of the last toggle (plan WP-F3, wizard's `lastAutoEnabled`). */
  @Input() autoEnabledIds: AppModule[] = [];

  @Output() moduleToggled = new EventEmitter<AppModule>();
  @Output() resetToRecommendations = new EventEmitter<void>();
  /** Une réponse de profilage a changé (lot 3) — le parent recalcule la pré-sélection. */
  @Output() profileAnswerChanged = new EventEmitter<void>();

  readonly catalog = inject(RegistrationCatalogService);

  get coreModules(): ModuleCatalogEntry[] {
    return this.catalog.modules.filter(m => this.catalog.isCoreModule(m.id));
  }

  get recommendedModules(): ModuleCatalogEntry[] {
    const recommended = new Set(this.catalog.recommendedModules(this.segment, this.domain));
    return this.catalog.modules.filter(m => !this.catalog.isCoreModule(m.id) && recommended.has(m.id));
  }

  get optionalModules(): ModuleCatalogEntry[] {
    const optional = new Set(this.catalog.optionalModules(this.segment, this.domain));
    return this.catalog.modules.filter(m => optional.has(m.id));
  }

  /** Premium modules locked on the Free plan — rendered as a non-toggleable "Plan supérieur" group. */
  get premiumModules(): ModuleCatalogEntry[] {
    const premium = new Set(this.catalog.premiumModules());
    return this.catalog.modules.filter(m => premium.has(m.id));
  }

  get profileLabel(): string {
    const segmentLabel = this.catalog.segmentLabel(this.segment);
    const domainLabel = this.catalog.domainLabel(this.domain);
    return [segmentLabel, domainLabel].filter(Boolean).join(' · ');
  }

  /** Discreet indicator (plan 2.1): the remote catalog was unreachable after retries. */
  get usedStaticFallback(): boolean {
    return this.catalog.usedStaticFallback();
  }

  enabledModuleIds(): AppModule[] {
    return this.form.get('enabledModules')?.value ?? [];
  }

  isModuleEnabled(id: AppModule): boolean {
    return this.enabledModuleIds().includes(id);
  }

  /** A module required (transitively) by another currently-enabled module cannot be turned off (plan WP-F3). */
  isLockedByDependency(id: AppModule): boolean {
    return this.catalog.dependentsOf(id, this.enabledModuleIds()).length > 0;
  }

  dependencyLockLabel(id: AppModule): string {
    const dependents = this.catalog.dependentsOf(id, this.enabledModuleIds());
    const labels = dependents.map(d => this.catalog.moduleLabel(d)).join(', ');
    return `Requis par ${labels}`;
  }

  wasAutoEnabled(id: AppModule): boolean {
    return this.autoEnabledIds.includes(id);
  }

  autoEnabledHintLabel(id: AppModule): string {
    const dependents = this.catalog.dependentsOf(id, this.enabledModuleIds());
    const labels = dependents.map(d => this.catalog.moduleLabel(d)).join(', ');
    return labels ? $localize`:@@ui.tern.active.automatiquement.requis.par.ph.fa9167:Activé automatiquement (requis par ${labels}:p0:)` : $localize`:@@ui.tern.active.automatiquement.2ee714:Activé automatiquement`;
  }

  // --- Profilage (lot 3) ---------------------------------------------------
  // Les réponses vivent dans le FormGroup du parent, lues/écrites ici comme l'est déjà
  // `enabledModules`. Pas de `formControlName` : ce composant n'a pas de directive `formGroup`.

  readonly headcountBands = HEADCOUNT_BANDS;

  readonly headcountLabels: Readonly<Record<HeadcountBand, string>> = {
    '1': $localize`:@@ui.tern.seul.e.489bcf:Seul(e)`,
    '2-9': '2 à 9',
    '10-49': '10 à 49',
    '50+': $localize`:@@ui.tern.50.et.plus.05cb8a:50 et plus`
  };

  booleanAnswer(key: string): boolean | null {
    return this.form.get(key)?.value ?? null;
  }

  /** Un second clic sur la réponse déjà choisie la retire (retour à « sans réponse »). */
  setBooleanAnswer(key: string, value: boolean): void {
    const control = this.form.get(key);
    if (!control) {
      return;
    }
    control.setValue(control.value === value ? null : value);
    this.profileAnswerChanged.emit();
  }

  headcountAnswer(): HeadcountBand | null {
    return this.form.get('headcountBand')?.value ?? null;
  }

  setHeadcount(band: HeadcountBand): void {
    const control = this.form.get('headcountBand');
    if (!control) {
      return;
    }
    control.setValue(control.value === band ? null : band);
    this.profileAnswerChanged.emit();
  }

  toggleModule(id: AppModule): void {
    this.moduleToggled.emit(id);
  }

  onReset(): void {
    this.resetToRecommendations.emit();
  }
}

