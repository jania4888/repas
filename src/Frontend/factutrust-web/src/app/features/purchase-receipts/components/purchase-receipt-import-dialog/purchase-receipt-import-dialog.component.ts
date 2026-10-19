import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  ViewChild,
  computed,
  inject,
  signal,
  OnDestroy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogModule } from 'primeng/dialog';
import { ProgressBarModule } from 'primeng/progressbar';
import { Subscription } from 'rxjs';
import { ButtonComponent } from '@shared/components/button/button.component';
import { PurchaseReceiptImportService } from '../../services/purchase-receipt-import.service';
import { PurchaseReceiptImportPayload } from '../../services/purchase-receipt-import-prefill.store';
import { InvoiceImportService } from '@features/invoices/invoice-wizard/services/invoice-import.service';

type ImportDialogPhase = 'idle' | 'uploading' | 'analysing' | 'error';

const ACCEPTED_EXTENSIONS = /\.(pdf|jpe?g|png)$/i;
const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Modale d'import d'un bon de réception depuis un document (PDF / image).
 *
 * Parcours : dépôt/choix du fichier -> envoi (barre de progression) ->
 * analyse (spinner) -> émission de la proposition au composant hôte, qui
 * décide de la navigation. Aucun nom de fournisseur IA/OCR n'est jamais
 * affiché : seuls des libellés génériques ("Service d'extraction
 * documentaire", "Modèle d'import IA").
 */
@Component({
  selector: 'app-purchase-receipt-import-dialog',
  standalone: true,
  imports: [CommonModule, DialogModule, ProgressBarModule, ButtonComponent],
  template: `
    <p-dialog
      header="Importer un bon de réception" i18n-header="@@features.purchase-receipts.components.purchase-receipt-import-dialog.ts.importer.un.bon.de.reception.1a2b3c01"
      [(visible)]="visible"
      [modal]="true"
      [style]="{ width: '540px', maxWidth: '95vw' }"
      [draggable]="false"
      [resizable]="false"
      [closable]="true"
      (onHide)="onHide()"
      ariaLabel="Importer un bon de réception depuis un document" i18n-ariaLabel="@@features.purchase-receipts.components.purchase-receipt-import-dialog.ts.importer.un.bon.de.reception.depuis.un.document.1a2b3c02">

      <input
        #fileInput
        type="file"
        class="pid-file-input"
        tabindex="-1"
        accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
        (change)="onFileSelected($event)"
        aria-hidden="true" />

      <div class="pid-content">
        @switch (phase()) {
          @case ('uploading') {
            <div class="pid-state" role="status" aria-live="polite">
              <i class="pi pi-upload pid-icon pid-icon-idle" aria-hidden="true"></i>
              <p class="pid-title" i18n="@@features.purchase-receipts.components.purchase-receipt-import-dialog.ts.envoi.du.document.1a2b3c03">Envoi du document…</p>
              @if (selectedFileName()) {
                <span class="pid-filename">{{ selectedFileName() }}</span>
              }
              <p-progressBar [value]="uploadPercent()" [showValue]="true" styleClass="pid-progress"></p-progressBar>
              <app-button
                variant="secondary"
                icon="pi-times"
                iconPos="left"
                (click)="cancelImport()"
                ariaLabel="Annuler l'import" i18n-ariaLabel="@@features.purchase-receipts.components.purchase-receipt-import-dialog.ts.annuler.l.import.1a2b3c06" i18n="@@features.purchase-receipts.components.purchase-receipt-import-dialog.ts.annuler.1a2b3c07"> Annuler </app-button>
            </div>
          }
          @case ('analysing') {
            <div class="pid-state" role="status" aria-live="polite">
              <i class="pi pi-spin pi-spinner pid-spinner" aria-hidden="true"></i>
              <p class="pid-title">{{ progressLabel() }} ({{ elapsedSeconds() }} s)</p>
              <p class="pid-text">
                @if (selectedFileName()) {
                  <span class="pid-filename">{{ selectedFileName() }}</span>
                }
                @if (engineLabel()) {
                  <ng-container>{{ engineLabel() }}</ng-container>
                } @else if (elapsedSeconds() < 30) {
                  <ng-container i18n="@@features.purchase-receipts.components.purchase-receipt-import-dialog.ts.lecture.et.preparation.du.document.1a2b3c04">Lecture et préparation du document…</ng-container>
                } @else {
                  <ng-container i18n="@@features.purchase-receipts.components.purchase-receipt-import-dialog.ts.l.analyse.peut.prendre.jusqu.a.3.minutes.1a2b3c05">L'analyse peut prendre jusqu'à 3 minutes la première fois.</ng-container>
                }
              </p>
              <app-button
                variant="secondary"
                icon="pi-times"
                iconPos="left"
                (click)="cancelImport()"
                ariaLabel="Annuler l'import" i18n-ariaLabel="@@features.purchase-receipts.components.purchase-receipt-import-dialog.ts.annuler.l.import.1a2b3c06" i18n="@@features.purchase-receipts.components.purchase-receipt-import-dialog.ts.annuler.1a2b3c07"> Annuler </app-button>
            </div>
          }
          @case ('error') {
            <div class="pid-state" role="alert">
              <i class="pi pi-exclamation-triangle pid-icon pid-icon-error" aria-hidden="true"></i>
              <p class="pid-title" i18n="@@features.purchase-receipts.components.purchase-receipt-import-dialog.ts.l.import.a.echoue.1a2b3c08">L'import a échoué</p>
              <p class="pid-text">{{ errorMessage() }}</p>
              <div class="pid-actions">
                <app-button
                  variant="primary"
                  icon="pi-refresh"
                  iconPos="left"
                  (click)="chooseFile()"
                  i18n="@@features.purchase-receipts.components.purchase-receipt-import-dialog.ts.reessayer.1a2b3c09"> Réessayer </app-button>
                <app-button
                  variant="outline"
                  icon="pi-pencil"
                  iconPos="left"
                  (click)="manualEntryClicked()"
                  i18n="@@features.purchase-receipts.components.purchase-receipt-import-dialog.ts.saisir.manuellement.1a2b3c0a"> Saisir manuellement </app-button>
              </div>
            </div>
          }
          @default {
            <div
              class="pid-drop"
              [class.pid-drop--active]="isDragging()"
              (dragenter)="onDragEnter($event)"
              (dragover)="onDragOver($event)"
              (dragleave)="onDragLeave($event)"
              (drop)="onDrop($event)">
              <i class="pi pi-file-import pid-icon pid-icon-idle" aria-hidden="true"></i>
              <p class="pid-title" i18n="@@features.purchase-receipts.components.purchase-receipt-import-dialog.ts.importez.un.bon.de.reception.existant.1a2b3c0b">Importez un bon de réception existant</p>
              <p class="pid-text" i18n="@@features.purchase-receipts.components.purchase-receipt-import-dialog.ts.bon.de.livraison.ou.facture.fournisseur.pdf.r.1a2b3c0c">
                Bon de livraison ou facture fournisseur (PDF recommandé ; photos acceptées).
                Les données extraites seront à vérifier avant d'enregistrer le bon de réception.
              </p>
              <app-button
                variant="primary"
                icon="pi-upload"
                iconPos="left"
                (click)="chooseFile()"
                ariaLabel="Choisir un fichier à importer" i18n-ariaLabel="@@features.purchase-receipts.components.purchase-receipt-import-dialog.ts.choisir.un.fichier.a.importer.1a2b3c0d" i18n="@@features.purchase-receipts.components.purchase-receipt-import-dialog.ts.choisir.un.fichier.1a2b3c0e"> Choisir un fichier </app-button>
              <p class="pid-hint">{{ dropHint() }}</p>
              @if (externalProcessing()) {
                <p class="pid-hint pid-hint-privacy">
                  <i class="pi pi-info-circle" aria-hidden="true"></i>
                  <ng-container i18n="@@features.purchase-receipts.components.purchase-receipt-import-dialog.ts.ce.document.sera.transmis.a.un.service.d.extra.1a2b3c10">Ce document sera transmis à un service d'extraction externe pour analyse.</ng-container>
                </p>
              }
              @if (modelReady() === false && warmUpMessage()) {
                <p class="pid-hint pid-hint-warn" role="status">{{ warmUpMessage() }}</p>
              }
            </div>
          }
        }
      </div>
    </p-dialog>
  `,
  styles: [`
    .pid-file-input {
      position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
    }
    .pid-content { padding: var(--spacing-2) 0; }
    .pid-state, .pid-drop {
      display: flex; flex-direction: column; align-items: center; text-align: center;
      gap: var(--spacing-3); padding: var(--spacing-4) var(--spacing-2);
    }
    .pid-drop {
      border: 2px dashed var(--color-border-subtle);
      border-radius: var(--radius-lg);
      transition: border-color 150ms ease, background-color 150ms ease;
    }
    .pid-drop--active {
      border-color: var(--color-primary-500);
      background: var(--color-primary-50, rgba(59, 130, 246, 0.05));
    }
    .pid-icon { font-size: 2.5rem; }
    .pid-icon-idle { color: var(--color-primary-500); }
    .pid-icon-error { color: var(--color-error-600); }
    .pid-spinner { font-size: 2.25rem; color: var(--color-primary-500); }
    .pid-title { margin: 0; font-size: var(--font-size-base); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); }
    .pid-text { margin: 0; font-size: var(--font-size-sm); color: var(--color-text-secondary); max-width: 400px; line-height: 1.5; }
    .pid-filename { display: block; font-weight: var(--font-weight-semibold); color: var(--color-text-primary); margin-bottom: var(--spacing-1); word-break: break-all; }
    .pid-hint { margin: 0; font-size: var(--font-size-xs); color: var(--color-text-tertiary); display: flex; align-items: center; gap: var(--spacing-1); }
    .pid-hint-privacy { color: var(--color-text-tertiary); max-width: 400px; }
    .pid-hint-warn { color: var(--color-warning-700); max-width: 400px; }
    .pid-progress { width: 100%; margin-top: var(--spacing-2); }
    .pid-actions { display: flex; gap: var(--spacing-3); }
  `]
})
export class PurchaseReceiptImportDialogComponent implements OnDestroy {
  @ViewChild('fileInput') fileInput?: ElementRef<HTMLInputElement>;

  @Input() set visible(value: boolean) {
    this._visible = value;
    if (value) {
      this.phase.set('idle');
      this.errorMessage.set(null);
      this.selectedFileName.set(null);
      this.elapsedSeconds.set(0);
      this.uploadPercent.set(0);
      this.modelReady.set(null);
      this.warmUpMessage.set(null);
      this.externalProcessing.set(false);
      this.engineLabel.set(null);
      this.maxFileBytes.set(DEFAULT_MAX_BYTES);
      this.progressLabel.set($localize`:@@features.purchase-receipts.components.purchase-receipt-import-dialog.ts.lecture.du.document.1a2b3c11:Lecture du document…`);

      this.capabilitiesSub?.unsubscribe();
      this.capabilitiesSub = this.importService.capabilities().subscribe((caps) => {
        this.externalProcessing.set(!!caps?.externalProcessing);
        // Plafond déclaré par le backend ; repli sur la valeur par défaut si absent ou invalide.
        this.maxFileBytes.set(caps?.maxFileBytes && caps.maxFileBytes > 0 ? caps.maxFileBytes : DEFAULT_MAX_BYTES);
        if (caps?.extractionProvider === 'docstrange') {
          this.engineLabel.set($localize`:@@features.purchase-receipts.components.purchase-receipt-import-dialog.ts.analyse.par.le.service.d.extraction.document.1a2b3c12:Analyse par le service d'extraction documentaire…`);
        } else if (caps?.extractionProvider === 'llm') {
          this.engineLabel.set($localize`:@@features.purchase-receipts.components.purchase-receipt-import-dialog.ts.analyse.par.le.modele.d.import.ia.1a2b3c13:Analyse par le modèle d'import IA…`);
          this.warmUp();
        }
      });
    }
  }
  get visible(): boolean {
    return this._visible;
  }
  private _visible = false;

  @Output() visibleChange = new EventEmitter<boolean>();
  /** Résultat d'import prêt à être déposé dans le store de pré-remplissage ; le composant hôte décide de la navigation. */
  @Output() imported = new EventEmitter<PurchaseReceiptImportPayload>();
  /** L'utilisateur renonce à l'import et préfère saisir le bon de réception manuellement. */
  @Output() manualEntry = new EventEmitter<void>();

  private readonly importService = inject(PurchaseReceiptImportService);
  private readonly invoiceImportService = inject(InvoiceImportService);

  readonly phase = signal<ImportDialogPhase>('idle');
  readonly errorMessage = signal<string | null>(null);
  readonly selectedFileName = signal<string | null>(null);
  readonly elapsedSeconds = signal(0);
  readonly uploadPercent = signal(0);
  readonly progressLabel = signal($localize`:@@features.purchase-receipts.components.purchase-receipt-import-dialog.ts.lecture.du.document.1a2b3c11:Lecture du document…`);
  readonly modelReady = signal<boolean | null>(null);
  readonly warmUpMessage = signal<string | null>(null);
  readonly externalProcessing = signal(false);
  readonly engineLabel = signal<string | null>(null);
  readonly isDragging = signal(false);
  /** Plafond de taille réellement appliqué ; aligné sur capabilities.maxFileBytes quand disponible. */
  readonly maxFileBytes = signal(DEFAULT_MAX_BYTES);
  readonly maxFileMo = computed(() => Math.max(1, Math.round(this.maxFileBytes() / (1024 * 1024))));
  readonly dropHint = computed(
    () =>
      $localize`:@@features.purchase-receipts.components.purchase-receipt-import-dialog.ts.ou.deposez.le.fichier.ici.pdf.jpg.png.taille.1a2b3c0f:Ou déposez le fichier ici — PDF, JPG, PNG (max ${this.maxFileMo()}:maxMo: Mo)`
  );

  private importSub: Subscription | null = null;
  private warmUpSub: Subscription | null = null;
  private capabilitiesSub: Subscription | null = null;
  private elapsedTimer: ReturnType<typeof setInterval> | null = null;
  private dragDepth = 0;

  ngOnDestroy(): void {
    this.importSub?.unsubscribe();
    this.warmUpSub?.unsubscribe();
    this.capabilitiesSub?.unsubscribe();
    this.stopElapsedTimer();
  }

  chooseFile(): void {
    this.fileInput?.nativeElement.click();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (file) {
      this.startImport(file);
    }
  }

  onDragEnter(event: DragEvent): void {
    event.preventDefault();
    this.dragDepth++;
    this.isDragging.set(true);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (this.dragDepth === 0) this.isDragging.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragDepth = 0;
    this.isDragging.set(false);
    const file = event.dataTransfer?.files?.[0] ?? null;
    if (file) {
      this.startImport(file);
    }
  }

  private startImport(file: File): void {
    if (!ACCEPTED_TYPES.includes(file.type) && !ACCEPTED_EXTENSIONS.test(file.name)) {
      this.phase.set('error');
      this.errorMessage.set($localize`:@@features.purchase-receipts.components.purchase-receipt-import-dialog.ts.format.non.supporte.utilisez.un.pdf.ou.une.im.1a2b3c14:Format non supporté. Utilisez un PDF ou une image (JPG, PNG).`);
      return;
    }
    if (file.size > this.maxFileBytes()) {
      this.phase.set('error');
      this.errorMessage.set($localize`:@@features.purchase-receipts.components.purchase-receipt-import-dialog.ts.fichier.trop.volumineux.maximum.mo.1a2b3c18:Fichier trop volumineux (maximum ${this.maxFileMo()}:maxMo: Mo).`);
      return;
    }

    this.selectedFileName.set(file.name);
    this.errorMessage.set(null);
    this.uploadPercent.set(0);
    this.phase.set('uploading');

    this.importSub?.unsubscribe();
    this.importSub = this.importService.importDocument(file).subscribe({
      next: (event) => {
        if (event.kind === 'upload') {
          this.uploadPercent.set(event.percent);
          return;
        }
        if (event.kind === 'analysing') {
          this.phase.set('analysing');
          this.startElapsedTimer();
          return;
        }
        this.stopElapsedTimer();
        this.imported.emit({ proposal: event.proposal, file });
      },
      error: (err) => {
        this.stopElapsedTimer();
        this.phase.set('error');
        this.errorMessage.set(err instanceof Error ? err.message : String(err));
      }
    });
  }

  private startElapsedTimer(): void {
    this.stopElapsedTimer();
    this.elapsedSeconds.set(0);
    this.elapsedTimer = setInterval(() => {
      const next = this.elapsedSeconds() + 1;
      this.elapsedSeconds.set(next);
      this.progressLabel.set(next < 8
        ? $localize`:@@features.purchase-receipts.components.purchase-receipt-import-dialog.ts.lecture.du.document.1a2b3c16:Lecture du document…`
        : $localize`:@@features.purchase-receipts.components.purchase-receipt-import-dialog.ts.analyse.en.cours.1a2b3c17:Analyse en cours…`);
    }, 1000);
  }

  private stopElapsedTimer(): void {
    if (this.elapsedTimer !== null) {
      clearInterval(this.elapsedTimer);
      this.elapsedTimer = null;
    }
  }

  private warmUp(): void {
    this.warmUpSub?.unsubscribe();
    this.warmUpSub = this.invoiceImportService.warmUpModel().subscribe({
      next: (res) => {
        this.modelReady.set(res.ready);
        this.warmUpMessage.set(res.ready ? null : (res.error ?? null));
      },
      error: () => {
        this.modelReady.set(false);
      }
    });
  }

  cancelImport(): void {
    this.abortInFlight();
    this.phase.set('idle');
    this.selectedFileName.set(null);
    this.uploadPercent.set(0);
  }

  manualEntryClicked(): void {
    this.manualEntry.emit();
    this.close();
  }

  /** Déclenché par la fermeture native de p-dialog (croix, Échap, clic backdrop). */
  onHide(): void {
    this.abortInFlight();
    this.visibleChange.emit(false);
  }

  /** Fermeture programmatique (après un import réussi). */
  close(): void {
    this.abortInFlight();
    this._visible = false;
    this.visibleChange.emit(false);
  }

  /** Interrompt un envoi/analyse en cours et arrête le minuteur (sans toucher à la phase ni au compteur). */
  private abortInFlight(): void {
    this.importSub?.unsubscribe();
    this.importSub = null;
    this.stopElapsedTimer();
  }
}
