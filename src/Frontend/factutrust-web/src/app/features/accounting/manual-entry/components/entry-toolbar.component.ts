import { Component, EventEmitter, Input, Output, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { EntryFormStore } from '../services/entry-form.store';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';

@Component({
  selector: 'app-entry-toolbar',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="entry-toolbar" role="toolbar" aria-label="Actions d'écriture" i18n-aria-label="Actions d'écriture">
      <div class="entry-toolbar__left">
        <div class="dropdown">
          <button type="button" class="btn btn-outline-secondary btn-sm dropdown-toggle"
                  (click)="toggleOptions($event)" [attr.aria-expanded]="optionsOpen" i18n="@@accounting.manual-entry.options.d.ecriture.cc09b93c">Options d'écriture</button>
          @if (optionsOpen) {
            <div class="dropdown-menu show" (click)="$event.stopPropagation()">
              <label class="dropdown-item-check">
                <input type="checkbox" [checked]="store.columnVisibility().piece"
                       (change)="toggleColumn('piece', $event)" />
                Colonne Pièce (aide à la saisie)
              </label>
              <label class="dropdown-item-check">
                <input type="checkbox" [checked]="store.columnVisibility().dueDate"
                       (change)="toggleColumn('dueDate', $event)" />
                Colonne Échéance (aide à la saisie)
              </label>
              <label class="dropdown-item-check">
                <input type="checkbox" [checked]="store.columnVisibility().lettering"
                       (change)="toggleColumn('lettering', $event)" />
                Colonne Lettrage (après enregistrement)
              </label>
              <label class="dropdown-item-check">
                <input type="checkbox" [checked]="store.columnVisibility().vat"
                       (change)="toggleColumn('vat', $event)" />
                Colonne TVA (aide à la saisie)
              </label>
              <div class="dropdown-divider"></div>
              <label class="dropdown-item-check">
                <input type="checkbox" [checked]="store.propagateLabelToLines()"
                       (change)="store.propagateLabelToLines.set($any($event.target).checked)" />
                Reporter le libellé sur les lignes vides
              </label>
              <button type="button" class="dropdown-item" (click)="reset.emit()">
                {{ store.editingLocked() ? 'Recharger depuis le serveur' : 'Réinitialiser le formulaire' }}
              </button>
            </div>
          }
        </div>

        <div class="dropdown">
          <button type="button" class="btn btn-outline-secondary btn-sm dropdown-toggle"
                  (click)="toggleTemplate($event)" [attr.aria-expanded]="templateOpen"
                  [disabled]="store.editingLocked()" i18n="@@accounting.manual-entry.modele.9853170f">Modèle</button>
          @if (templateOpen) {
            <div class="dropdown-menu show">
              <button type="button" class="dropdown-item" (click)="loadTemplate.emit(); templateOpen = false" i18n="@@accounting.manual-entry.charger.un.modele.09cd1181">Charger un modèle</button>
              <button type="button" class="dropdown-item" (click)="saveTemplate.emit(); templateOpen = false"
                      [disabled]="!store.canSaveAsTemplate()" i18n="@@accounting.manual-entry.sauvegarder.comme.modele.80b765f8">Sauvegarder comme modèle</button>
            </div>
          }
        </div>

        @if (!store.editingLocked()) {
        <div class="dropdown">
          <button type="button" class="btn btn-outline-secondary btn-sm dropdown-toggle"
                  (click)="toggleImport($event)" [attr.aria-expanded]="importOpen"
                  title="Importer une pièce ou des écritures" i18n-title="Importer une pièce ou des écritures" i18n="@@accounting.manual-entry.import.d6fbc9d2">Import</button>
          @if (importOpen) {
            <div class="dropdown-menu show">
              <button type="button" class="dropdown-item"
                      (click)="importDocument.emit(); importOpen = false" i18n="@@accounting.manual-entry.importer.une.facture.pdf.image.dc57ae71">Importer une facture (PDF / image)</button>
              <div class="dropdown-divider"></div>
              <a routerLink="/accounting/import" class="dropdown-item" i18n="@@accounting.manual-entry.import.de.fichier.csv.excel.77102ff0">Import de fichier (CSV / Excel)</a>
              <a routerLink="/accounting/draft-batch" class="dropdown-item" i18n="@@accounting.manual-entry.ecritures.en.brouillard.4d98b8f8">Écritures en brouillard</a>
            </div>
          }
        </div>
        }
      </div>

      <div class="entry-toolbar__right">
        @if (store.editingLocked()) {
          <button type="button" class="btn btn-outline-secondary"
                  (click)="cancelEdit.emit()" i18n="@@accounting.manual-entry.annuler.49ba3292">Annuler</button>
          <button type="button" class="btn btn-primary"
                  (click)="save.emit('navigate')"
                  [disabled]="!canSave()">
            {{ store.loading() ? 'Enregistrement…' : 'Enregistrer les modifications' }}
          </button>
        } @else {
        <div class="btn-group">
          <button type="button" class="btn btn-primary"
                  (click)="save.emit('navigate')"
                  [disabled]="!canSave()">
            {{ store.loading() ? 'Enregistrement…' : 'Enregistrer' }}
          </button>
          <button type="button" class="btn btn-primary dropdown-toggle dropdown-toggle-split"
                  (click)="toggleSaveMenu($event)" [attr.aria-expanded]="saveMenuOpen"
                  [disabled]="!canSave()"></button>
          @if (saveMenuOpen) {
            <div class="dropdown-menu dropdown-menu-end show">
              <button type="button" class="dropdown-item" (click)="save.emit('navigate'); saveMenuOpen = false" i18n="@@accounting.manual-entry.enregistrer.f7c8bcd8">Enregistrer</button>
              <button type="button" class="dropdown-item" (click)="save.emit('reset'); saveMenuOpen = false" i18n="@@accounting.manual-entry.enregistrer.nouveau.dd728e67">Enregistrer & nouveau</button>
              <button type="button" class="dropdown-item" (click)="save.emit('duplicate'); saveMenuOpen = false" i18n="@@accounting.manual-entry.enregistrer.dupliquer.d84f2fad">Enregistrer & dupliquer</button>
            </div>
          }
        </div>
        }
      </div>
    </div>
  `,
  styles: `
    .entry-toolbar { display:flex; flex-wrap:wrap; justify-content:space-between; gap:var(--spacing-3); margin-bottom:var(--spacing-4); }
    .entry-toolbar__left, .entry-toolbar__right { display:flex; flex-wrap:wrap; gap:var(--spacing-2); align-items:center; }
    .dropdown { position:relative; }
    .dropdown-menu { position:absolute; top:100%; left:0; z-index:1050; min-width:14rem; background:var(--color-background-elevated); border:1px solid var(--color-border-default); border-radius:var(--radius-md); box-shadow:var(--shadow-md); padding:var(--spacing-2); }
    .dropdown-menu-end { right:0; left:auto; }
    .dropdown-item { display:block; width:100%; text-align:left; padding:var(--spacing-2) var(--spacing-3); border:none; background:transparent; cursor:pointer; font-size:var(--font-size-sm); border-radius:var(--radius-sm); }
    .dropdown-item:hover { background:var(--color-background-hover); }
    .dropdown-item-check { display:flex; align-items:center; gap:var(--spacing-2); padding:var(--spacing-2) var(--spacing-3); font-size:var(--font-size-sm); cursor:pointer; }
    .dropdown-divider { height:1px; background:var(--color-border-subtle); margin:var(--spacing-1) 0; }
    .btn-group { display:flex; position:relative; }
    .dropdown-toggle-split { padding-left:var(--spacing-2); padding-right:var(--spacing-2); }
  `,
  host: {
    '(document:click)': 'closeMenus()'
  }
})
export class EntryToolbarComponent {
  readonly store = inject(EntryFormStore);
  private readonly auth = inject(AuthService);

  @Output() save = new EventEmitter<'navigate' | 'reset' | 'duplicate'>();
  @Output() loadTemplate = new EventEmitter<void>();
  @Output() saveTemplate = new EventEmitter<void>();
  @Output() reset = new EventEmitter<void>();
  /** Ouvre la modale d'import d'une facture à comptabiliser. */
  @Output() importDocument = new EventEmitter<void>();
  /** Quitte le mode édition sans enregistrer (retour journal). */
  @Output() cancelEdit = new EventEmitter<void>();

  optionsOpen = false;
  templateOpen = false;
  saveMenuOpen = false;
  importOpen = false;

  readonly canSave = computed(() =>
    this.store.canSubmit() && this.auth.hasPermission(PERMISSIONS.accounting.create)
  );

  // Chaque bouton d'ouverture DOIT arrêter la propagation : sans cela le clic remonte jusqu'à
  // `document`, où `closeMenus()` referme le menu dans la même propagation — avant même le
  // premier cycle de rendu. Le menu ne s'afficherait jamais.
  toggleOptions(ev: MouseEvent): void {
    ev.stopPropagation();
    this.optionsOpen = !this.optionsOpen;
    this.templateOpen = false; this.saveMenuOpen = false; this.importOpen = false;
  }

  toggleTemplate(ev: MouseEvent): void {
    ev.stopPropagation();
    this.templateOpen = !this.templateOpen;
    this.optionsOpen = false; this.saveMenuOpen = false; this.importOpen = false;
  }

  toggleSaveMenu(ev: MouseEvent): void {
    ev.stopPropagation();
    this.saveMenuOpen = !this.saveMenuOpen;
    this.optionsOpen = false; this.templateOpen = false; this.importOpen = false;
  }

  toggleImport(ev: MouseEvent): void {
    ev.stopPropagation();
    this.importOpen = !this.importOpen;
    this.optionsOpen = false; this.templateOpen = false; this.saveMenuOpen = false;
  }

  /** Branché sur `document:click` : referme au clic extérieur, sans cycle inutile si tout est déjà fermé. */
  closeMenus(): void {
    if (!this.optionsOpen && !this.templateOpen && !this.saveMenuOpen && !this.importOpen) return;
    this.optionsOpen = false;
    this.templateOpen = false;
    this.saveMenuOpen = false;
    this.importOpen = false;
  }

  toggleColumn(key: 'piece' | 'dueDate' | 'lettering' | 'vat', event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.store.columnVisibility.update(v => ({ ...v, [key]: checked }));
  }
}
