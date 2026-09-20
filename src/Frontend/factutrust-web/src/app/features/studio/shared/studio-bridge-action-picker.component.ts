import { ChangeDetectionStrategy, Component, computed, effect, input, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SelectModule } from 'primeng/select';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { AutomationAction, BridgeParamMapping, CustomField } from '../studio.models';

/** État local d'une ligne de correspondance (les lignes sans valeur ne sont pas émises). */
interface BridgeRowState { source: BridgeParamMapping['source']; value: string; }

/** Sources proposées par défaut (copie de l'ancien `sourceOptions` d'Automations). */
const BASE_SOURCES: ReadonlyArray<{ label: string; value: BridgeParamMapping['source'] }> = [
  { label: 'Champ', value: 'field' },
  { label: 'Constante', value: 'const' }
];

/**
 * Sélecteur « Action ERP + correspondance des paramètres » extrait de `StudioAutomationsComponent`
 * (tranche 4.4b) pour être réutilisé par l'étape `erp_action` des workflows. Surface de configuration
 * uniquement : aucune action n'est exécutée ici. `allowTemplate` ajoute la source « Modèle de texte »
 * (workflows) ; Automations le laisse à `false` et n'émet donc que `field | const`.
 */
@Component({
  selector: 'app-studio-bridge-action-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, SelectModule, InputTextModule, TextareaModule],
  template: `
    <div class="bap">
      <label class="bap__lbl">Action ERP *</label>
      <p-select [options]="actions()" [ngModel]="action()" (ngModelChange)="onActionChange($event)" optionLabel="name" optionValue="name"
        [filter]="true" appendTo="body" panelStyleClass="studio-theme" styleClass="bap__w-full" placeholder="Choisir une action"
        [disabled]="disabled()" [attr.aria-label]="'Action ERP'" />
      @if (selectedAction(); as act) {
        <small class="bap__hint">{{ act.description }}</small>
        <label class="bap__section">Correspondance des paramètres</label>
        @for (p of act.parameters; track p.name) {
          <div class="ft-map" [attr.data-testid]="'bap-row-' + p.name">
            <div class="ft-map-name">{{ p.name }} @if (p.required) { <span class="ft-req">*</span> }</div>
            <p-select [options]="sourceOptions()" [ngModel]="rowSource(p.name)" (ngModelChange)="setSource(p.name, $event)" optionLabel="label" optionValue="value"
              appendTo="body" panelStyleClass="studio-theme" styleClass="ft-map-src" [disabled]="disabled()" />
            @switch (rowSource(p.name)) {
              @case ('field') { <p-select [options]="fieldOptions()" [ngModel]="rowValue(p.name)" (ngModelChange)="setValue(p.name, $event)" optionLabel="label" optionValue="value"
                [showClear]="true" [filter]="true" appendTo="body" panelStyleClass="studio-theme" styleClass="ft-map-val" placeholder="Champ…" [disabled]="disabled()" /> }
              @case ('template') { <textarea pTextarea rows="2" class="ft-map-val" [ngModel]="rowValue(p.name)" (ngModelChange)="setValue(p.name, $event)"
                placeholder="{{ '{{record.champ}}' }}" [disabled]="disabled()"></textarea> }
              @default { <input pInputText class="ft-map-val" [ngModel]="rowValue(p.name)" (ngModelChange)="setValue(p.name, $event)"
                [placeholder]="p.allowedValues?.length ? p.allowedValues!.join(' | ') : 'Valeur fixe'" [disabled]="disabled()" /> }
            }
            <small class="ft-map-desc">{{ p.description }}</small>
          </div>
        }
      }
    </div>`,
  styles: [`/* déplacé 1:1 depuis studio-automations.component.ts (styles .ft-map*) */
    .ft-map { display: grid; grid-template-columns: 9rem 8rem 1fr; gap: .5rem; align-items: center; padding: .35rem 0; border-bottom: 1px solid var(--surface-100); }
    .ft-map-name { font-family: monospace; font-size: .82rem; } .ft-req { color: var(--red-500); }
    .ft-map-desc { grid-column: 1 / -1; color: var(--text-color-secondary); font-size: .75rem; }
    .bap__hint { color: var(--text-color-secondary); } .bap__section, .bap__lbl { font-weight: 600; font-size: .85rem; margin-top: .5rem; display: block; }
    :host ::ng-deep .bap__w-full, :host ::ng-deep .ft-map-src, :host ::ng-deep .ft-map-val { width: 100%; }`]
})
export class StudioBridgeActionPickerComponent {
  readonly actions = input.required<AutomationAction[]>();
  readonly fields = input.required<CustomField[]>();
  readonly action = model<string | null>(null);
  readonly mapping = model<BridgeParamMapping[]>([]);
  readonly allowTemplate = input(false);
  readonly disabled = input(false);

  protected readonly selectedAction = computed(() => this.actions().find(a => a.name === this.action()) ?? null);
  protected readonly sourceOptions = computed(() =>
    this.allowTemplate() ? [...BASE_SOURCES, { label: 'Modèle de texte', value: 'template' as const }] : [...BASE_SOURCES]);
  protected readonly fieldOptions = computed(() =>
    this.fields().filter(f => f.isActive).map(f => ({ label: `${f.label} (${f.key})`, value: f.key })));

  /** État des lignes, dérivé de mapping() : les lignes sans valeur restent locales et ne sont pas émises. */
  private readonly rows = signal<Record<string, BridgeRowState>>({});

  constructor() {
    // Reconstruit `rows` quand le parent pousse un mappage (motif openEdit), sans jamais écraser une
    // saisie en cours : si `rows` émettrait déjà la même chose que `mapping()`, on ne touche à rien
    // (sinon boucle mapping.set → effect → rows.set).
    effect(() => {
      const mapping = this.mapping();
      if (this.canonical(this.emitted(this.rows())) === this.canonical(mapping)) return;
      const next: Record<string, BridgeRowState> = {};
      for (const m of mapping) next[m.param] = { source: m.source, value: m.value ?? '' };
      this.rows.set(next);
    });
  }

  protected rowSource(param: string): BridgeParamMapping['source'] { return this.rows()[param]?.source ?? 'field'; }
  protected rowValue(param: string): string { return this.rows()[param]?.value ?? ''; }

  /** Changement d'action ⇒ lignes réinitialisées (comportement de l'ancien `onActionChange` d'Automations). */
  onActionChange(name: string | null): void {
    this.action.set(name);
    this.rows.set({});
    this.mapping.set([]);
  }

  protected setSource(param: string, source: BridgeParamMapping['source']): void { this.patch(param, { source, value: '' }); }
  protected setValue(param: string, value: string | null): void { this.patch(param, { value: value ?? '' }); }

  private patch(param: string, changes: Partial<BridgeRowState>): void {
    const next = { ...this.rows(), [param]: { ...(this.rows()[param] ?? { source: 'field' as const, value: '' }), ...changes } };
    this.rows.set(next);
    this.mapping.set(this.emitted(next));
  }

  /** Mappage émis : uniquement les lignes avec une valeur non vide (motif de l'ancien `save()`). */
  private emitted(rows: Record<string, BridgeRowState>): BridgeParamMapping[] {
    return Object.entries(rows)
      .filter(([, s]) => s.value !== '')
      .map(([param, s]) => ({ param, source: s.source, value: s.value }));
  }

  /** Forme canonique (ordre des clés fixe, `null` → `''`) pour comparer sans risque de boucle. */
  private canonical(mappings: BridgeParamMapping[]): string {
    return JSON.stringify(mappings.map(m => ({ param: m.param, source: m.source, value: m.value ?? '' })));
  }
}
