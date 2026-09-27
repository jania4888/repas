import { Component, ElementRef, EventEmitter, Input, Output, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { environment } from '@environments/environment';
import { StudioFileService } from './studio-file.service';

interface UploadResponse { success: boolean; data: string | null; message?: string; errors?: string[]; }

/**
 * Editor for Studio Attachment / Signature fields. Uploads to the authenticated endpoint
 * (api/studio/records/{entityKey}/files) and emits the stored file's relative URL. Signature mode
 * captures a hand-drawn PNG on a canvas (no external dependency). Read contexts show the file via
 * an authenticated blob fetch (StudioFileService) — these files are not statically served.
 */
@Component({
  selector: 'app-studio-file-field',
  standalone: true,
  imports: [CommonModule, ButtonModule],
  template: `
    <div class="ft-file" [ngSwitch]="mode">
      <!-- Attachment -->
      <div *ngSwitchCase="'attachment'" class="ft-file-row">
        <a *ngIf="value" role="button" tabindex="0" class="ft-file-link"
          (click)="openFile()" (keyup.enter)="openFile()">
          <img *ngIf="isImage" [attr.src]="fileSrc$ | async" class="ft-file-thumb" alt="" />
          <span *ngIf="!isImage"><i class="fa-solid fa-file"></i> Voir le fichier</span>
        </a>
        <input #fileInput type="file" (change)="onFile($event)" hidden />
        <button pButton type="button" class="p-button-outlined p-button-sm" icon="fa-solid fa-upload"
          [label]="value ? loc_ui_tern_remplacer_db2c67 : loc_ui_tern_televerser_e9e72d" [disabled]="uploading" (click)="fileInput.click()"></button>
        <button *ngIf="value" pButton type="button" icon="fa-solid fa-xmark"
          class="p-button-text p-button-sm p-button-danger" (click)="clear()"></button>
      </div>

      <!-- Signature -->
      <div *ngSwitchCase="'signature'" class="ft-file-col">
        <ng-container *ngIf="value && !editing">
          <img [attr.src]="fileSrc$ | async" class="ft-sign-img" alt="signature" i18n-alt="signature" />
          <div class="ft-sign-actions">
            <button pButton type="button" label="Refaire" i18n-label="Refaire" class="p-button-text p-button-sm" (click)="editing = true"></button>
            <button pButton type="button" icon="fa-solid fa-xmark" class="p-button-text p-button-sm p-button-danger" (click)="clear()"></button>
          </div>
        </ng-container>
        <ng-container *ngIf="!value || editing">
          <canvas #canvas width="320" height="120" class="ft-sign-pad"
            (pointerdown)="start($event)" (pointermove)="move($event)" (pointerup)="end()" (pointerleave)="end()"></canvas>
          <div class="ft-sign-actions">
            <button pButton type="button" label="Effacer" i18n-label="Effacer" class="p-button-text p-button-sm" (click)="clearPad()"></button>
            <button pButton type="button" label="Enregistrer" i18n-label="Enregistrer" class="p-button-sm" [disabled]="uploading" (click)="savePad()"></button>
          </div>
        </ng-container>
      </div>

      <small class="ft-file-up" *ngIf="uploading" i18n="@@shared.studio-runtime.studio-file-field.televersement.15038033">Téléversement…</small>
      <small class="ft-file-err" *ngIf="error">{{ error }}</small>
    </div>
  `,
  styles: [`
    .ft-file { display: flex; flex-direction: column; gap: .4rem; }
    .ft-file-row { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
    .ft-file-col { display: flex; flex-direction: column; gap: .4rem; align-items: flex-start; }
    .ft-file-link { display: inline-flex; align-items: center; gap: .35rem; color: var(--primary-color); cursor: pointer; }
    .ft-file-thumb { max-height: 48px; border-radius: 6px; border: 1px solid var(--surface-300); }
    .ft-sign-pad { border: 1px dashed var(--surface-400); border-radius: 8px; touch-action: none; background: var(--surface-0); cursor: crosshair; }
    .ft-sign-img { max-height: 90px; border: 1px solid var(--surface-300); border-radius: 8px; background: #fff; }
    .ft-sign-actions { display: flex; gap: .5rem; }
    .ft-file-err { color: var(--red-500); }
    .ft-file-up { color: var(--text-color-secondary); }
  `]
})
export class StudioFileFieldComponent {
  readonly loc_ui_tern_remplacer_db2c67 = $localize`:@@ui.tern.remplacer.db2c67:Remplacer`;
  readonly loc_ui_tern_televerser_e9e72d = $localize`:@@ui.tern.televerser.e9e72d:Téléverser`;
  private readonly http = inject(HttpClient);
  private readonly studioFiles = inject(StudioFileService);

  @Input() mode: 'attachment' | 'signature' = 'attachment';
  @Input() entityKey = '';
  @Input() value: string | null = null;
  @Output() valueChange = new EventEmitter<string | null>();

  @ViewChild('canvas') canvasRef?: ElementRef<HTMLCanvasElement>;

  uploading = false;
  error: string | null = null;
  editing = false;
  private drawing = false;
  private hasInk = false;

  /** Blob object URL du fichier (cache service : instance stable par valeur, sûre pour le template). */
  get fileSrc$(): Observable<string | null> | null {
    return this.value ? this.studioFiles.objectUrl(this.value) : null;
  }

  openFile(): void {
    if (this.value) this.studioFiles.open(this.value);
  }

  get isImage(): boolean {
    return !!this.value && /\.(png|jpe?g|webp|gif)$/i.test(this.value);
  }

  // ---- Attachment ----
  onFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.upload(file);
    input.value = '';
  }

  clear(): void {
    this.value = null;
    this.editing = false;
    this.valueChange.emit(null);
  }

  // ---- Signature ----
  start(e: PointerEvent): void {
    const ctx = this.ctx();
    if (!ctx) return;
    this.drawing = true;
    ctx.beginPath();
    ctx.moveTo(e.offsetX, e.offsetY);
  }

  move(e: PointerEvent): void {
    if (!this.drawing) return;
    const ctx = this.ctx();
    if (!ctx) return;
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineTo(e.offsetX, e.offsetY);
    ctx.stroke();
    this.hasInk = true;
  }

  end(): void { this.drawing = false; }

  clearPad(): void {
    const c = this.canvasRef?.nativeElement;
    const ctx = this.ctx();
    if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
    this.hasInk = false;
  }

  savePad(): void {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas || !this.hasInk) { this.error = 'Veuillez signer avant d\'enregistrer.'; return; }
    canvas.toBlob(blob => {
      if (!blob) return;
      this.upload(new File([blob], 'signature.png', { type: 'image/png' }));
    }, 'image/png');
  }

  private ctx(): CanvasRenderingContext2D | null {
    return this.canvasRef?.nativeElement.getContext('2d') ?? null;
  }

  // ---- Upload ----
  private upload(file: File): void {
    if (!this.entityKey) { this.error = 'Table inconnue.'; return; }
    this.uploading = true;
    this.error = null;
    const form = new FormData();
    form.append('file', file);
    this.http.post<UploadResponse>(`${environment.apiUrl}/studio/records/${this.entityKey}/files`, form).subscribe({
      next: res => {
        this.uploading = false;
        if (res.success && res.data) {
          this.value = res.data;
          this.editing = false;
          this.valueChange.emit(res.data);
        } else {
          this.error = res.errors?.[0] ?? res.message ?? $localize`:@@ui.tern.echec.du.televersement.bf7802:Échec du téléversement.`;
        }
      },
      error: err => {
        this.uploading = false;
        this.error = err?.error?.message ?? $localize`:@@ui.tern.echec.du.televersement.bf7802:Échec du téléversement.`;
      }
    });
  }
}
