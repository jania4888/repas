import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TabsModule } from 'primeng/tabs';

const ALLOWED_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
];
const MAX_BYTES = 10 * 1024 * 1024;

@Component({
  selector: 'app-entry-bottom-tabs',
  standalone: true,
  imports: [CommonModule, FormsModule, TabsModule],
  template: `
    <p-tabs class="ft-tabs entry-bottom-tabs" [lazy]="true">
      <p-tablist>
        <p-tab [value]="0" i18n="@@accounting.manual-entry.pieces.jointes.894a3774">Pièces jointes ({{ pendingFiles.length }})</p-tab>
        <p-tab [value]="1" i18n="@@accounting.manual-entry.notes.70440046">Notes</p-tab>
        <p-tab [value]="2" i18n="@@accounting.manual-entry.historique.34f3a06a">Historique</p-tab>
      </p-tablist>
      <p-tabpanels>
      <p-tabpanel [value]="0">
        <p class="bottom-tab-hint" i18n="@@accounting.manual-entry.les.fichiers.seront.televerses.apres.l.enregistr.1bb91483"> Les fichiers seront téléversés après l'enregistrement de l'écriture (max 10 Mo, PDF/images/Office). </p>
        <div class="attach-zone" (dragover)="$event.preventDefault()" (drop)="onDrop($event)">
          <input type="file" #fileInput multiple hidden (change)="onFilesSelected($event)" />
          <button type="button" class="btn btn-outline-secondary btn-sm" (click)="fileInput.click()" i18n="@@accounting.manual-entry.ajouter.un.fichier.2651b7a1"> Ajouter un fichier </button>
        </div>
        @if (pendingFiles.length > 0) {
          <ul class="attach-list">
            @for (f of pendingFiles; track f.name; let i = $index) {
              <li>
                <span>{{ f.name }} ({{ formatSize(f.size) }})</span>
                <button type="button" class="btn btn-sm btn-outline-danger" (click)="removeFile(i)" i18n="@@accounting.manual-entry.text.0951b9a0">✕</button>
              </li>
            }
          </ul>
        }
        @if (attachError) {
          <p class="attach-error" role="alert">{{ attachError }}</p>
        }
      </p-tabpanel>

      <p-tabpanel [value]="1">
        <label class="field-label" for="work-notes" i18n="@@accounting.manual-entry.note.de.travail.non.comptabilisee.b9b1000f">Note de travail (non comptabilisée)</label>
        <textarea id="work-notes" class="notes-area" rows="4"
                  [ngModel]="notes" (ngModelChange)="notesChange.emit($event)"
                  placeholder="Notes internes pour cette saisie…" i18n-placeholder="@@accounting.manual-entry.notes.internes.pour.cette.saisie.57ce68d7"></textarea>
      </p-tabpanel>

      <p-tabpanel [value]="2">
        <div class="locked-panel">
          <p i18n="@@accounting.manual-entry.l.historique.des.modifications.sera.disponible.a.48142acd">L'historique des modifications sera disponible après l'enregistrement de l'écriture.</p>
        </div>
      </p-tabpanel>
      </p-tabpanels>
    </p-tabs>
  `,
  styles: `
    .entry-bottom-tabs { margin-top:var(--spacing-4); }
    .bottom-tab-hint { font-size:var(--font-size-sm); color:var(--color-text-secondary); margin-bottom:var(--spacing-3); }
    .attach-zone { border:2px dashed var(--color-border-default); border-radius:var(--radius-lg); padding:var(--spacing-5); text-align:center; margin-bottom:var(--spacing-3); min-height:6rem; display:flex; align-items:center; justify-content:center; }
    .attach-list { list-style:none; padding:0; margin:0; }
    .attach-list li { display:flex; justify-content:space-between; align-items:center; padding:var(--spacing-2); border-bottom:1px solid var(--color-border-subtle); font-size:var(--font-size-sm); }
    .attach-error { color:var(--color-error-600); font-size:var(--font-size-sm); }
    .notes-area { width:100%; padding:var(--spacing-3); border:1px solid var(--color-border-default); border-radius:var(--radius-md); font-size:var(--font-size-sm); resize:vertical; }
    .locked-panel { padding:var(--spacing-4); background:var(--color-background-subtle); border-radius:var(--radius-md); color:var(--color-text-secondary); font-size:var(--font-size-sm); }
    .locked-panel__sub { font-size:var(--font-size-xs); margin-top:var(--spacing-2); }
    .field-label { display:block; margin-bottom:var(--spacing-2); font-size:var(--font-size-sm); font-weight:var(--font-weight-semibold); }
  `
})
export class EntryBottomTabsComponent {
  @Input() pendingFiles: File[] = [];
  @Input() notes = '';
  @Output() pendingFilesChange = new EventEmitter<File[]>();
  @Output() notesChange = new EventEmitter<string>();

  attachError: string | null = null;

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files) return;
    this.addFiles(Array.from(input.files));
    input.value = '';
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer?.files) {
      this.addFiles(Array.from(event.dataTransfer.files));
    }
  }

  addFiles(files: File[]): void {
    this.attachError = null;
    const valid: File[] = [];
    for (const f of files) {
      if (f.size > MAX_BYTES) {
        this.attachError = $localize`:@@accounting.entry-bottom-tabs.ts.name.depasse.10.mo.8052874c:${f.name}:name: dépasse 10 Mo.`;
        continue;
      }
      if (!ALLOWED_TYPES.includes(f.type) && !f.name.match(/\.(pdf|jpe?g|png|webp|xlsx|docx)$/i)) {
        this.attachError = $localize`:@@accounting.entry-bottom-tabs.ts.type.non.autorise.name.8ababe02:Type non autorisé : ${f.name}:name:`;
        continue;
      }
      valid.push(f);
    }
    this.pendingFilesChange.emit([...this.pendingFiles, ...valid]);
  }

  removeFile(index: number): void {
    const next = [...this.pendingFiles];
    next.splice(index, 1);
    this.pendingFilesChange.emit(next);
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} o`;
    return `${Math.round(bytes / 1024)} Ko`;
  }
}
