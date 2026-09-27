import { Component, computed, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export interface SaveTemplatePayload {
  name: string;
  description: string;
  journalCode: string;
  labelTemplate: string;
  keepAmounts: boolean;
}

@Component({
  selector: 'app-save-template-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    @if (visible()) {
      <div class="stm-backdrop" (click)="onBackdropClick($event)" role="presentation">
        <div class="stm-modal" role="dialog" aria-modal="true" aria-labelledby="stm-title" (click)="$event.stopPropagation()">
          <header class="stm-header">
            <h2 id="stm-title" class="stm-title" i18n="@@accounting.manual-entry.sauvegarder.comme.modele.80b765f8">Sauvegarder comme modèle</h2>
            <button type="button" class="stm-close" (click)="onClose()" aria-label="Fermer" i18n-aria-label="@@accounting.manual-entry.fermer.5ab4ec64" i18n="@@accounting.manual-entry.text.0951b9a0">✕</button>
          </header>

          <div class="stm-body">
            <p class="stm-intro">
              Sauvegardez les comptes et libellés de cette écriture pour les réutiliser rapidement.
              L'écriture en cours sera enregistrée comme modèle <strong>{{ defaultName() || '(sans nom)' }}</strong>.
            </p>

            <div class="form-field">
              <label class="field-label" for="stm-name"><ng-container i18n="@@accounting.manual-entry.nom.du.modele.68d49f67">Nom du modèle </ng-container> <span class="stm-req" i18n="@@accounting.manual-entry.text.df58248c">*</span></label>
              <input id="stm-name" type="text" class="stm-input"
                     [ngModel]="name()" (ngModelChange)="name.set($event)"
                     placeholder="Ex: Paiement client par virement" i18n-placeholder="@@accounting.manual-entry.ex.paiement.client.par.virement.3b98d267"
                     maxlength="200" required />
              @if (showValidation() && !nameTrimmed()) {
                <p class="stm-error" i18n="@@accounting.manual-entry.le.nom.est.obligatoire.c4331d4d">Le nom est obligatoire.</p>
              }
            </div>

            <div class="form-field">
              <label class="field-label" for="stm-desc" i18n="@@accounting.manual-entry.description.optionnelle.27856f3e">Description (optionnelle)</label>
              <textarea id="stm-desc" class="stm-input stm-textarea"
                        [ngModel]="description()" (ngModelChange)="description.set($event)"
                        rows="2"
                        maxlength="1000"
                        placeholder="À quoi sert ce modèle ?"></textarea>
            </div>

            <div class="form-field stm-row">
              <div style="flex:0 0 8rem">
                <label class="field-label" for="stm-journal" i18n="@@accounting.manual-entry.journal.57d7f743">Journal</label>
                <input id="stm-journal" type="text" class="stm-input stm-input-readonly" readonly
                       [value]="journalCode()" />
              </div>
              <div style="flex:1 1 200px">
                <label class="field-label" for="stm-label" i18n="@@accounting.manual-entry.libelle.par.defaut.optionnel.5cf9a2e5">Libellé par défaut (optionnel)</label>
                <input id="stm-label" type="text" class="stm-input"
                       [ngModel]="labelTemplate()" (ngModelChange)="labelTemplate.set($event)"
                       maxlength="500"
                       placeholder="Pré-remplit le libellé à l'application" i18n-placeholder="@@accounting.manual-entry.pre.remplit.le.libelle.a.l.application.b5af33c3" />
              </div>
            </div>

            <div class="form-field">
              <label class="stm-checkbox">
                <input type="checkbox"
                       [ngModel]="keepAmounts()" (ngModelChange)="keepAmounts.set($event)" />
                Conserver les montants actuels comme valeurs par défaut du modèle
              </label>
              <p class="stm-hint" i18n="@@accounting.manual-entry.decoche.seuls.les.comptes.et.libelles.sont.sauve.3d8cd4e8"> Décoché : seuls les comptes et libellés sont sauvegardés (montants vides à l'application).
                Coché : les montants actuels seront pré-remplis. </p>
            </div>
          </div>

          <footer class="stm-footer">
            <button type="button" class="btn btn-outline-secondary" (click)="onClose()" i18n="@@accounting.manual-entry.annuler.49ba3292">Annuler</button>
            <button type="button" class="btn btn-primary"
                    (click)="onSave()"
                    [disabled]="saving() || !nameTrimmed()">
              {{ saving() ? loc_ui_tern_sauvegarde_853081 : loc_ui_tern_sauvegarder_le_modele_c6623f }}
            </button>
          </footer>
        </div>
      </div>
    }
  `,
  styles: `
    .stm-backdrop { position:fixed; inset:0; background:rgba(15,23,42,0.55); display:flex; align-items:center; justify-content:center; z-index:1000; padding:var(--spacing-4); }
    .stm-modal { background:var(--color-background-elevated,#fff); border-radius:var(--radius-lg); box-shadow:var(--shadow-xl,0 20px 25px -5px rgba(0,0,0,0.1)); width:100%; max-width:36rem; max-height:90vh; display:flex; flex-direction:column; overflow:hidden; }
    .stm-header { display:flex; align-items:center; justify-content:space-between; padding:var(--spacing-4); border-bottom:1px solid var(--color-border-subtle); }
    .stm-title { font-size:var(--font-size-lg,1.125rem); font-weight:var(--font-weight-semibold); margin:0; }
    .stm-close { background:none; border:none; font-size:1.25rem; cursor:pointer; padding:var(--spacing-1) var(--spacing-2); border-radius:var(--radius-sm); color:var(--color-text-secondary); }
    .stm-close:hover { background:var(--color-background-subtle); }
    .stm-body { padding:var(--spacing-4); overflow-y:auto; display:flex; flex-direction:column; gap:var(--spacing-4); }
    .stm-intro { font-size:var(--font-size-sm); color:var(--color-text-secondary); margin:0; }
    .form-field { display:flex; flex-direction:column; gap:var(--spacing-2); }
    .field-label { font-size:var(--font-size-sm); font-weight:var(--font-weight-semibold); }
    .stm-req { color:var(--color-error-600,#dc2626); }
    .stm-row { flex-direction:row; flex-wrap:wrap; gap:var(--spacing-3); }
    .stm-input { width:100%; padding:var(--spacing-2) var(--spacing-3); border:1px solid var(--color-border-default); border-radius:var(--radius-md); font-size:var(--font-size-sm); }
    .stm-input:focus { outline:none; border-color:var(--color-primary-500); box-shadow:0 0 0 3px var(--color-primary-200,#bfdbfe); }
    .stm-input-readonly { background:var(--color-background-subtle,#f1f5f9); color:var(--color-text-secondary); font-family:monospace; }
    .stm-textarea { resize:vertical; min-height:3rem; font-family:inherit; }
    .stm-checkbox { display:flex; align-items:center; gap:var(--spacing-2); font-size:var(--font-size-sm); cursor:pointer; }
    .stm-checkbox input { cursor:pointer; }
    .stm-hint { font-size:var(--font-size-xs); color:var(--color-text-tertiary); margin:0; padding-left:1.5rem; }
    .stm-error { color:var(--color-error-700,#b91c1c); font-size:var(--font-size-xs); margin:0; }
    .stm-footer { display:flex; justify-content:flex-end; gap:var(--spacing-2); padding:var(--spacing-4); border-top:1px solid var(--color-border-subtle); }
  `
})
export class SaveTemplateModalComponent {
  readonly loc_ui_tern_sauvegarde_853081 = $localize`:@@ui.tern.sauvegarde.853081:Sauvegarde…`;
  readonly loc_ui_tern_sauvegarder_le_modele_c6623f = $localize`:@@ui.tern.sauvegarder.le.modele.c6623f:Sauvegarder le modèle`;
  readonly visible = input<boolean>(false);
  readonly defaultName = input<string>('');
  readonly journalCode = input<string>('JOD');
  readonly saving = input<boolean>(false);

  readonly close = output<void>();
  readonly save = output<SaveTemplatePayload>();

  readonly name = signal('');
  readonly description = signal('');
  readonly labelTemplate = signal('');
  readonly keepAmounts = signal(false);
  readonly showValidation = signal(false);

  readonly nameTrimmed = computed(() => this.name().trim().length > 0);

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.onClose();
    }
  }

  onClose(): void {
    this.resetState();
    this.close.emit();
  }

  onSave(): void {
    this.showValidation.set(true);
    if (!this.nameTrimmed()) return;
    this.save.emit({
      name: this.name().trim(),
      description: this.description().trim(),
      journalCode: this.journalCode(),
      labelTemplate: this.labelTemplate().trim(),
      keepAmounts: this.keepAmounts()
    });
  }

  private resetState(): void {
    this.name.set('');
    this.description.set('');
    this.labelTemplate.set('');
    this.keepAmounts.set(false);
    this.showValidation.set(false);
  }
}
