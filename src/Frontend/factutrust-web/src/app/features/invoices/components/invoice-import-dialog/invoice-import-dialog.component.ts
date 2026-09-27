import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  ViewChild,
  inject,
  signal,
  OnDestroy
} from '@angular/core';
import { Router } from '@angular/router';
import { DialogModule } from 'primeng/dialog';
import { Subscription } from 'rxjs';
import { ButtonComponent } from '@shared/components/button/button.component';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { InvoiceImportService } from '@features/invoices/invoice-wizard/services/invoice-import.service';
import { InvoiceImportPrefillStore } from '@features/invoices/invoice-wizard/services/invoice-import-prefill.store';
import { HttpErrorResponse } from '@angular/common/http';

type ImportPhase = 'idle' | 'extracting' | 'error';

/**
 * Modale d'import d'une facture depuis un fichier (PDF / image / Word / Excel).
 *
 * Parcours : choix du fichier -> analyse IA (spinner) -> dépôt du résultat dans
 * InvoiceImportPrefillStore -> navigation vers le wizard pré-rempli /invoices/new.
 * Le chat de l'assistant IA n'est jamais ouvert.
 */
@Component({
  selector: 'app-invoice-import-dialog',
  standalone: true,
  imports: [DialogModule, ButtonComponent],
  template: `
    <p-dialog
      header="Importer une facture" i18n-header="@@invoices.components.importer.une.facture.66ed8807"
      [(visible)]="visible"
      [modal]="true"
      [style]="{ width: '520px', maxWidth: '95vw' }"
      [draggable]="false"
      [resizable]="false"
      [closable]="true"
      (onHide)="onHide()"
      ariaLabel="Importer une facture depuis un fichier">

      <input
        #fileInput
        type="file"
        class="iid-file-input"
        tabindex="-1"
        accept=".pdf,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff,.docx,.xlsx,.xlsm,application/pdf,image/png,image/jpeg,image/webp,image/bmp,image/tiff,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        (change)="onFileSelected($event)"
        aria-hidden="true" />

      <div class="iid-content">
        @switch (phase()) {
          @case ('extracting') {
            <div class="iid-state" role="status" aria-live="polite">
              <i class="pi pi-spin pi-spinner iid-spinner" aria-hidden="true"></i>
              <p class="iid-title">{{ progressLabel() }} ({{ elapsedSeconds() }} s)</p>
              <p class="iid-text">
                @if (selectedFileName()) {
                  <span class="iid-filename">{{ selectedFileName() }}</span>
                }
                @if (elapsedSeconds() < 30) {
                  Lecture et préparation du document…
                } @else {
                  L'analyse peut prendre jusqu'à 3 minutes la première fois.
                }
              </p>
              <app-button
                variant="secondary"
                icon="pi-times"
                iconPos="left"
                (click)="cancelImport()"
                ariaLabel="Annuler l'import" i18n="@@invoices.components.annuler.49ba3292"> Annuler </app-button>
            </div>
          }
          @case ('error') {
            <div class="iid-state" role="alert">
              <i class="pi pi-exclamation-triangle iid-icon iid-icon-error" aria-hidden="true"></i>
              <p class="iid-title" i18n="@@invoices.components.l.import.a.echoue.613ae19d">L'import a échoué</p>
              <p class="iid-text">{{ errorMessage() }}</p>
              <app-button
                variant="primary"
                icon="pi-refresh"
                iconPos="left"
                (click)="chooseFile()"
                ariaLabel="Choisir un autre fichier" i18n="@@invoices.components.reessayer.895d416b"> Réessayer </app-button>
            </div>
          }
          @default {
            <div class="iid-state">
              <i class="pi pi-file-import iid-icon iid-icon-idle" aria-hidden="true"></i>
              <p class="iid-title" i18n="@@invoices.components.importez.une.facture.existante.92f95412">Importez une facture existante</p>
              <p class="iid-text" i18n="@@invoices.components.facture.bon.de.livraison.ou.devis.pdf.recommande.0a63dc73"> Facture, bon de livraison ou devis (PDF recommandé ; photos acceptées).
                L'IA en extraira les données ; vous pourrez tout vérifier avant de valider. </p>
              <app-button
                variant="primary"
                icon="pi-upload"
                iconPos="left"
                (click)="chooseFile()"
                ariaLabel="Choisir un fichier à importer" i18n="@@invoices.components.choisir.un.fichier.75c27e25"> Choisir un fichier </app-button>
              <p class="iid-hint" i18n="@@invoices.components.taille.maximale.10.mo.8166532b">Taille maximale : 10 Mo</p>
              @if (modelReady() === true) {
                <p class="iid-hint iid-hint-ready">
                  <i class="pi pi-check-circle" aria-hidden="true"></i> Modèle IA prêt
                </p>
              } @else if (modelReady() === false && warmUpMessage()) {
                <p class="iid-hint iid-hint-warn" role="status">{{ warmUpMessage() }}</p>
              }
            </div>
          }
        }
      </div>
    </p-dialog>
  `,
  styles: [`
    .iid-file-input {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    .iid-content {
      padding: var(--spacing-2) 0;
    }

    .iid-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: var(--spacing-3);
      padding: var(--spacing-4) var(--spacing-2);
    }

    .iid-icon {
      font-size: 2.5rem;
    }

    .iid-icon-idle {
      color: var(--color-primary-500);
    }

    .iid-icon-error {
      color: var(--color-error-600);
    }

    .iid-spinner {
      font-size: 2.25rem;
      color: var(--color-primary-500);
    }

    .iid-title {
      margin: 0;
      font-size: var(--font-size-base);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
    }

    .iid-text {
      margin: 0;
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
      max-width: 380px;
      line-height: 1.5;
    }

    .iid-filename {
      display: block;
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
      margin-bottom: var(--spacing-1);
      word-break: break-all;
    }

    .iid-hint {
      margin: 0;
      font-size: var(--font-size-xs);
      color: var(--color-text-tertiary);
    }

    .iid-hint-ready {
      color: var(--color-success-600);
    }

    .iid-hint-warn {
      color: var(--color-warning-700);
      max-width: 380px;
    }
  `]
})
export class InvoiceImportDialogComponent implements OnDestroy {
  @ViewChild('fileInput') fileInput?: ElementRef<HTMLInputElement>;

  @Input() set visible(value: boolean) {
    this._visible = value;
    if (value) {
      // Réinitialise la modale à chaque ouverture.
      this.phase.set('idle');
      this.errorMessage.set(null);
      this.selectedFileName.set(null);
      this.elapsedSeconds.set(0);
      this.modelReady.set(null);
      this.warmUpMessage.set(null);
      this.progressLabel.set('Lecture du document…');
      this.warmUpSub?.unsubscribe();
      this.warmUpSub = this.importService.warmUpModel().subscribe({
        next: (res) => {
          this.modelReady.set(res.ready);
          if (res.ready) {
            this.warmUpMessage.set(null);
          } else if (res.error) {
            this.warmUpMessage.set(res.error);
          } else {
            this.warmUpMessage.set(
              'Le préchauffage du modèle IA a échoué. L\'import peut être plus long.');
          }
        },
        error: (err) => {
          this.modelReady.set(false);
          this.warmUpMessage.set(this.resolveWarmUpErrorMessage(err));
        }
      });
    }
  }
  get visible(): boolean {
    return this._visible;
  }
  private _visible = false;

  @Output() visibleChange = new EventEmitter<boolean>();

  private readonly importService = inject(InvoiceImportService);
  private readonly prefillStore = inject(InvoiceImportPrefillStore);
  private readonly router = inject(Router);
  private readonly errorHandler = inject(ErrorHandlerService);

  readonly phase = signal<ImportPhase>('idle');
  readonly errorMessage = signal<string | null>(null);
  readonly selectedFileName = signal<string | null>(null);
  readonly elapsedSeconds = signal(0);
  readonly progressLabel = signal('Lecture du document…');
  readonly modelReady = signal<boolean | null>(null);
  readonly warmUpMessage = signal<string | null>(null);

  private importSub: Subscription | null = null;
  private warmUpSub: Subscription | null = null;
  private elapsedTimer: ReturnType<typeof setInterval> | null = null;

  /** Limite alignée sur le backend (AiInvoiceImportController.ImportMaxBytes). */
  private static readonly MaxBytes = 10 * 1024 * 1024;

  ngOnDestroy(): void {
    this.importSub?.unsubscribe();
    this.warmUpSub?.unsubscribe();
    this.stopElapsedTimer();
  }

  chooseFile(): void {
    this.fileInput?.nativeElement.click();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    // Permet de re-sélectionner le même fichier après une erreur.
    input.value = '';
    if (file) {
      this.startImport(file);
    }
  }

  private startImport(file: File): void {
    if (file.size > InvoiceImportDialogComponent.MaxBytes) {
      this.phase.set('error');
      this.errorMessage.set('Fichier trop volumineux (maximum 10 Mo).');
      return;
    }

    this.selectedFileName.set(file.name);
    this.errorMessage.set(null);
    this.phase.set('extracting');
    this.startElapsedTimer();

    this.importSub?.unsubscribe();
    this.importSub = this.importService.importInvoice(file).subscribe({
      next: (result) => {
        // Dépose le résultat puis ouvre le wizard pré-rempli.
        this.stopElapsedTimer();
        this.prefillStore.set(result);
        this.close();
        this.router.navigate(['/invoices/new']);
      },
      error: (err) => {
        this.stopElapsedTimer();
        this.phase.set('error');
        this.errorMessage.set(this.resolveErrorMessage(err));
      }
    });
  }

  private startElapsedTimer(): void {
    this.stopElapsedTimer();
    this.elapsedSeconds.set(0);
    this.elapsedTimer = setInterval(() => {
      const next = this.elapsedSeconds() + 1;
      this.elapsedSeconds.set(next);
      this.progressLabel.set(next < 8 ? $localize`:@@ui.tern.lecture.du.document.f74989:Lecture du document…` : $localize`:@@ui.tern.analyse.ia.258a68:Analyse IA…`);
    }, 1000);
  }

  cancelImport(): void {
    this.importSub?.unsubscribe();
    this.importSub = null;
    this.stopElapsedTimer();
    this.phase.set('idle');
    this.selectedFileName.set(null);
    this.progressLabel.set('Lecture du document…');
  }

  private stopElapsedTimer(): void {
    if (this.elapsedTimer !== null) {
      clearInterval(this.elapsedTimer);
      this.elapsedTimer = null;
    }
  }

  private resolveWarmUpErrorMessage(err: unknown): string {
    const e = err as { error?: { message?: string; title?: string }; message?: string; status?: number };
    const apiMessage = e?.error?.message?.trim();
    if (apiMessage) {
      return apiMessage;
    }
    if (e?.status === 0 || e?.message?.includes('Http failure')) {
      return 'Impossible de joindre le serveur pour précharger le modèle IA. Vérifiez que l\'API est démarrée.';
    }
    return e?.message?.trim()
      || 'Le préchauffage du modèle IA a échoué. L\'import reste possible mais peut être plus long.';
  }

  private resolveErrorMessage(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      const apiMessage = this.errorHandler.extractErrorMessage(err).trim();
      if (apiMessage && !apiMessage.includes('Http failure')) {
        return apiMessage;
      }
      if (err.status === 0) {
        return 'Impossible de joindre le serveur. Vérifiez que l\'API est démarrée.';
      }
    }

    if (err instanceof Error) {
      const msg = err.message?.trim();
      if (msg && !msg.includes('Http failure')) {
        return msg;
      }
    }

    const message = this.errorHandler.extractErrorMessage(err).trim();
    if (message && !message.includes('Http failure')) {
      return message;
    }

    if (err instanceof HttpErrorResponse && err.status === 0) {
      return 'Impossible de joindre le serveur. Vérifiez que l\'API est démarrée.';
    }

    return "Impossible d'extraire la facture de ce fichier. "
      + $localize`:@@ui.tern.verifiez.le.document.ou.saisissez.la.factu.92c3f1:Vérifiez le document ou saisissez la facture manuellement.`;
  }

  /** Déclenché par la fermeture native de p-dialog (croix, Échap, clic backdrop). */
  onHide(): void {
    this.importSub?.unsubscribe();
    this.importSub = null;
    this.stopElapsedTimer();
    this.visibleChange.emit(false);
  }

  /** Fermeture programmatique (après un import réussi). */
  close(): void {
    this.importSub?.unsubscribe();
    this.importSub = null;
    this.stopElapsedTimer();
    this._visible = false;
    this.visibleChange.emit(false);
  }
}
