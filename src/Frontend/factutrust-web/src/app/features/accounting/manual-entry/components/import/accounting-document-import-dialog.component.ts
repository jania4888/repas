/// <reference types="@angular/localize" />
import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
  computed,
  inject,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogModule } from 'primeng/dialog';
import { Subscription } from 'rxjs';
import { ButtonComponent } from '@shared/components/button/button.component';
import { ConfirmationService } from '@core/services/confirmation.service';
import { AccountingDocumentImportService } from '../../services/accounting-document-import.service';
import {
  DocumentDirection,
  JournalEntryProposal,
  ProposalDiagnostic,
  extractionMethodLabel
} from '../../models/accounting-document-import.models';
import { ThirdPartyQuickCreateComponent } from './third-party-quick-create.component';
import { ImportProposalEditorComponent } from './import-proposal-editor.component';

type ImportPhase = 'idle' | 'extracting' | 'review' | 'error';

/**
 * Import d'une facture (vente ou achat) depuis la saisie manuelle d'écritures.
 *
 * Parcours : choix du fichier → détection des zones → écran de RELECTURE (sens, tiers, totaux
 * détectés, lignes proposées, diagnostics) → application au formulaire de saisie.
 * Rien n'est enregistré ici : l'écriture part par le chemin habituel « Enregistrer ».
 */
@Component({
  selector: 'app-accounting-document-import-dialog',
  standalone: true,
  imports: [CommonModule, DialogModule, ButtonComponent, ThirdPartyQuickCreateComponent, ImportProposalEditorComponent],
  providers: [AccountingDocumentImportService],
  template: `
    <p-dialog
      header="Importer une facture" i18n-header="@@accounting.manual-entry.importer.une.facture.66ed8807"
      [(visible)]="visible"
      [modal]="true"
      [style]="{ width: phase() === 'review' ? '1100px' : '560px', maxWidth: '98vw' }"
      [draggable]="false"
      [resizable]="false"
      [closable]="true"
      (onHide)="onHide()"
      ariaLabel="Importer une facture de vente ou d'achat" i18n-ariaLabel="@@accounting.manual-entry.importer.une.facture.de.vente.ou.d.achat.14bcf5ca">

      <input
        #fileInput
        type="file"
        class="adi-file-input"
        tabindex="-1"
        accept=".pdf,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff,.docx,.xlsx,.xlsm,application/pdf,image/png,image/jpeg,image/webp,image/bmp,image/tiff"
        (change)="onFileSelected($event)"
        aria-hidden="true" />

      @switch (phase()) {
        @case ('extracting') {
          <div class="adi-state" role="status" aria-live="polite">
            <i class="pi pi-spin pi-spinner adi-spinner" aria-hidden="true"></i>
            <p class="adi-title" i18n="@@accounting.manual-entry.analyse.de.la.piece.s.b321b13b">Analyse de la pièce… ({{ elapsedSeconds() }} s)</p>
            <p class="adi-text">
              @if (selectedFileName()) {
                <span class="adi-filename">{{ selectedFileName() }}</span>
              }
              @if (elapsedSeconds() < 20) {<ng-container i18n="@@accounting.manual-entry.lecture.du.document.et.detection.des.zon.71726a65">
                Lecture du document et détection des zones…
              </ng-container>} @else {<ng-container i18n="@@accounting.manual-entry.le.document.n.est.pas.au.format.instafac.1a09b4ea">
                Le document n'est pas au format InstaFact : l'analyse IA peut prendre
                jusqu'à 3 minutes la première fois.
              </ng-container>}
            </p>
            <app-button variant="secondary" icon="pi-times" iconPos="left"
                        (click)="cancelImport()" ariaLabel="Annuler l'analyse" i18n-ariaLabel="@@accounting.manual-entry.annuler.l.analyse.f487f0e5" i18n="@@accounting.manual-entry.annuler.49ba3292"> Annuler </app-button>
          </div>
        }

        @case ('error') {
          <div class="adi-state" role="alert">
            <i class="pi pi-exclamation-triangle adi-icon adi-icon-error" aria-hidden="true"></i>
            <p class="adi-title" i18n="@@accounting.manual-entry.l.analyse.a.echoue.14b05060">L'analyse a échoué</p>
            <p class="adi-text">{{ errorMessage() }}</p>
            <app-button variant="primary" icon="pi-refresh" iconPos="left"
                        (click)="chooseFile()" ariaLabel="Choisir un autre fichier" i18n-ariaLabel="@@accounting.manual-entry.choisir.un.autre.fichier.c0cbec19" i18n="@@accounting.manual-entry.reessayer.895d416b"> Réessayer </app-button>
          </div>
        }

        @case ('review') {
          @if (proposal(); as p) {
            <div class="adi-review">
              <!-- Sens de la pièce -->
              <section class="adi-card">
                <header class="adi-card__header">
                  <h3 class="adi-card__title" i18n="@@accounting.manual-entry.sens.de.la.piece.cbc2df59">Sens de la pièce</h3>
                  @if (p.directionReason) {
                    <span class="adi-card__hint">{{ p.directionReason }}</span>
                  }
                </header>
                <div class="adi-direction" role="radiogroup" aria-label="Sens de la pièce" i18n-aria-label="@@accounting.manual-entry.sens.de.la.piece.cbc2df59">
                  <label class="adi-direction__option" [class.is-active]="p.direction === 'SALE'">
                    <input type="radio" name="adi-direction" value="SALE"
                           [checked]="p.direction === 'SALE'"
                           [disabled]="reanalyzing()"
                           (change)="changeDirection('SALE')" />
                    <span>
                      <strong i18n="@@accounting.manual-entry.vente.9e7753e0">Vente</strong>
                      <small i18n="@@accounting.manual-entry.journal.jv.client.au.debit.c896c4b0">Journal JV — client au débit</small>
                    </span>
                  </label>
                  <label class="adi-direction__option" [class.is-active]="p.direction === 'PURCHASE'">
                    <input type="radio" name="adi-direction" value="PURCHASE"
                           [checked]="p.direction === 'PURCHASE'"
                           [disabled]="reanalyzing()"
                           (change)="changeDirection('PURCHASE')" />
                    <span>
                      <strong i18n="@@accounting.manual-entry.achat.2faf08bf">Achat</strong>
                      <small i18n="@@accounting.manual-entry.journal.ja.fournisseur.au.credit.481d88ab">Journal JA — fournisseur au crédit</small>
                    </span>
                  </label>
                  @if (reanalyzing()) {
                    <span class="adi-reanalyzing" role="status" i18n="@@accounting.manual-entry.recalcul.e2a0a91b">
                      <i class="pi pi-spin pi-spinner" aria-hidden="true"></i> Recalcul…
                    </span>
                  }
                </div>
                <p class="adi-method">
                  <i class="pi pi-info-circle" aria-hidden="true"></i>
                  {{ methodLabel() }}
                </p>
              </section>

              <div class="adi-columns">
                <!-- Tiers -->
                <section class="adi-card">
                  <h3 class="adi-card__title">
                    {{ p.direction === 'SALE' ? loc_ui_tern_client_1bdd79 : loc_ui_tern_fournisseur_97d91d }}
                  </h3>
                  @if (p.thirdParty; as tp) {
                    <dl class="adi-facts">
                      <div><dt i18n="@@accounting.manual-entry.nom.7ff20370">Nom</dt><dd>{{ tp.matchedName || tp.name || '—' }}</dd></div>
                      <div><dt i18n="@@accounting.manual-entry.matricule.fiscal.304096c4">Matricule fiscal</dt><dd>{{ tp.nif || '—' }}</dd></div>
                      <div><dt i18n="@@accounting.manual-entry.compte.collectif.f1c7e97c">Compte collectif</dt><dd><code>{{ tp.collectiveAccountNumber }}</code></dd></div>
                    </dl>
                    @if (tp.matchedId) {
                      <p class="adi-badge adi-badge--ok" i18n="@@accounting.manual-entry.tiers.rapproche.9818df8a">
                        <i class="pi pi-check-circle" aria-hidden="true"></i>
                        Tiers rapproché{{ tp.matchedBy === 'nif' ? loc_ui_tern_par_matricule_fiscal_ef1940 : loc_ui_tern_par_nom_4c4de0 }}
                      </p>
                    } @else {
                      <p class="adi-badge adi-badge--warn" i18n="@@accounting.manual-entry.tiers.non.rapproche.l.ecriture.restera.s.30dc87a4">
                        <i class="pi pi-exclamation-circle" aria-hidden="true"></i>
                        Tiers non rapproché — l'écriture restera sans auxiliaire
                      </p>
                      <app-accounting-third-party-quick-create
                        [thirdParty]="tp"
                        (created)="onThirdPartyCreated($event)" />
                    }
                  }
                </section>

                <!-- Zones détectées -->
                <section class="adi-card">
                  <h3 class="adi-card__title" i18n="@@accounting.manual-entry.zones.detectees.b69dd9e4">Zones détectées</h3>
                  <dl class="adi-facts">
                    <div><dt i18n="@@accounting.manual-entry.n.de.piece.a63c611f">N° de pièce</dt><dd>{{ p.extraction.documentNumber || '—' }}</dd></div>
                    <div><dt i18n="@@accounting.manual-entry.date.eb9a4bc1">Date</dt><dd>{{ p.entryDate || '—' }}</dd></div>
                    <div><dt i18n="@@accounting.manual-entry.total.ht.2ca17ae6">Total HT</dt><dd>{{ amount(p.extraction.totalHt) }}</dd></div>
                    @for (b of p.extraction.vatBreakdown; track b.ratePercent) {
                      <div>
                        <dt>TVA {{ b.ratePercent }}%</dt>
                        <dd i18n="@@accounting.manual-entry.base.3756d9fc">{{ amount(b.vatAmount) }} <small>(base {{ amount(b.baseAmount) }})</small></dd>
                      </div>
                    }
                    @if (p.extraction.fodecAmount) {
                      <div><dt i18n="@@accounting.manual-entry.fodec.9a029080">FODEC</dt><dd>{{ amount(p.extraction.fodecAmount) }}</dd></div>
                    }
                    @if (p.extraction.fiscalStampAmount) {
                      <div><dt i18n="@@accounting.manual-entry.timbre.fiscal.1f8f7dd1">Timbre fiscal</dt><dd>{{ amount(p.extraction.fiscalStampAmount) }}</dd></div>
                    }
                    <div class="adi-facts__total">
                      <dt i18n="@@accounting.manual-entry.total.ttc.9e80ff7c">Total TTC</dt><dd>{{ amount(p.extraction.totalTtc) }}</dd>
                    </div>
                  </dl>
                </section>
              </div>

              <!-- Écriture proposée (éditable) -->
              <section class="adi-card adi-card--editor">
                <app-import-proposal-editor
                  #proposalEditor
                  [proposal]="p"
                  (stateChange)="onEditorStateChange()" />
              </section>

              <!-- Diagnostics -->
              @if (displayDiagnostics().length > 0) {
                <section class="adi-card">
                  <h3 class="adi-card__title" i18n="@@accounting.manual-entry.controles.3d337f2f">Contrôles</h3>
                  <ul class="adi-diagnostics">
                    @for (d of displayDiagnostics(); track $index) {
                      <li class="adi-diagnostic" [class]="'adi-diagnostic--' + d.severity">
                        <i class="pi" [class.pi-times-circle]="d.severity === 'blocking'"
                           [class.pi-exclamation-triangle]="d.severity === 'warning'"
                           [class.pi-info-circle]="d.severity === 'info'" aria-hidden="true"></i>
                        <span>{{ d.message }}</span>
                      </li>
                    }
                  </ul>
                  @if (!canApplyNow() && !reanalyzing()) {
                    <p class="adi-apply-hint" role="status" i18n="@@accounting.manual-entry.corrigez.les.controles.bloquants.ou.equilibrez.l.df86b9f6"> Corrigez les contrôles bloquants ou équilibrez l'écriture avant d'appliquer. </p>
                  }
                </section>
              }
            </div>
          }
        }

        @default {
          <div class="adi-state">
            <i class="pi pi-file-import adi-icon adi-icon-idle" aria-hidden="true"></i>
            <p class="adi-title" i18n="@@accounting.manual-entry.importez.une.facture.a.comptabiliser.d03c8692">Importez une facture à comptabiliser</p>
            <p class="adi-text" i18n="@@accounting.manual-entry.facture.de.vente.ou.d.achat.pdf.recommande.photo.6ef07041"> Facture de vente ou d'achat (PDF recommandé ; photos et scans acceptés).
              Le système détecte les zones de la pièce et propose l'écriture selon le plan
              comptable tunisien. Vous relisez avant d'appliquer. </p>
            <app-button variant="primary" icon="pi-upload" iconPos="left"
                        (click)="chooseFile()" ariaLabel="Choisir un fichier à importer" i18n-ariaLabel="@@accounting.manual-entry.choisir.un.fichier.a.importer.6d6c3a02" i18n="@@accounting.manual-entry.choisir.un.fichier.75c27e25"> Choisir un fichier </app-button>
            <p class="adi-hint" i18n="@@accounting.manual-entry.taille.maximale.10.mo.8166532b">Taille maximale : 10 Mo</p>
            @if (capabilityHint(); as hint) {
              <p class="adi-hint adi-hint-warn" role="status">{{ hint }}</p>
            }
          </div>
        }
      }

      <ng-template pTemplate="footer">
        @if (phase() === 'review') {
          <div class="adi-footer">
            <app-button variant="secondary" (click)="chooseFile()" ariaLabel="Analyser une autre pièce" i18n-ariaLabel="@@accounting.manual-entry.analyser.une.autre.piece.09bd4d3a" i18n="@@accounting.manual-entry.autre.piece.de18e3bf"> Autre pièce </app-button>
            <app-button variant="primary" icon="pi-check" iconPos="left"
                        [disabled]="!canApplyNow()"
                        (click)="apply()"
                        ariaLabel="Appliquer la proposition à la saisie" i18n-ariaLabel="@@accounting.manual-entry.appliquer.la.proposition.a.la.saisie.be30f406" i18n="@@accounting.manual-entry.appliquer.a.la.saisie.1da9e067"> Appliquer à la saisie </app-button>
          </div>
        }
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .adi-file-input { position:absolute; width:1px; height:1px; opacity:0; pointer-events:none; }
    .adi-state { display:flex; flex-direction:column; align-items:center; text-align:center; gap:var(--spacing-3); padding:var(--spacing-5) var(--spacing-3); }
    .adi-icon, .adi-spinner { font-size:2.5rem; }
    .adi-icon-idle { color:var(--color-primary); }
    .adi-icon-error { color:var(--color-danger); }
    .adi-spinner { color:var(--color-primary); }
    .adi-title { margin:0; font-weight:600; }
    .adi-text { margin:0; color:var(--color-text-secondary); font-size:var(--font-size-sm); max-width:44ch; }
    .adi-filename { display:block; font-weight:600; color:var(--color-text-primary); margin-bottom:var(--spacing-1); }
    .adi-hint { margin:0; font-size:var(--font-size-xs); color:var(--color-text-tertiary); }
    .adi-hint-warn { color:var(--color-warning); }

    .adi-review { display:flex; flex-direction:column; gap:var(--spacing-3); }
    .adi-columns { display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:var(--spacing-3); }
    .adi-card { border:1px solid var(--color-border-default); border-radius:var(--radius-md); padding:var(--spacing-3); background:var(--color-background-elevated); }
    .adi-card__header { display:flex; flex-wrap:wrap; align-items:baseline; justify-content:space-between; gap:var(--spacing-2); }
    .adi-card__title { margin:0 0 var(--spacing-2); font-size:var(--font-size-sm); font-weight:600; text-transform:uppercase; letter-spacing:.02em; color:var(--color-text-secondary); }
    .adi-card__hint { font-size:var(--font-size-xs); color:var(--color-text-tertiary); }

    .adi-direction { display:flex; flex-wrap:wrap; gap:var(--spacing-2); align-items:center; }
    .adi-direction__option { display:flex; align-items:center; gap:var(--spacing-2); border:1px solid var(--color-border-default); border-radius:var(--radius-md); padding:var(--spacing-2) var(--spacing-3); cursor:pointer; }
    .adi-direction__option.is-active { border-color:var(--color-primary); background:var(--color-primary-subtle, transparent); }
    .adi-direction__option small { display:block; font-size:var(--font-size-xs); color:var(--color-text-tertiary); }
    .adi-reanalyzing { font-size:var(--font-size-xs); color:var(--color-text-secondary); }
    .adi-method { margin:var(--spacing-2) 0 0; font-size:var(--font-size-xs); color:var(--color-text-tertiary); }

    .adi-facts { margin:0; display:flex; flex-direction:column; gap:var(--spacing-1); }
    .adi-facts > div { display:flex; justify-content:space-between; gap:var(--spacing-3); font-size:var(--font-size-sm); }
    .adi-facts dt { color:var(--color-text-secondary); margin:0; }
    .adi-facts dd { margin:0; font-variant-numeric:tabular-nums; text-align:right; }
    .adi-facts__total { border-top:1px solid var(--color-border-subtle); margin-top:var(--spacing-1); padding-top:var(--spacing-1); font-weight:600; }

    .adi-badge { display:flex; align-items:center; gap:var(--spacing-2); margin:var(--spacing-2) 0 0; font-size:var(--font-size-xs); }
    .adi-badge--ok { color:var(--color-success); }
    .adi-badge--warn { color:var(--color-warning); }

    .adi-card--editor { padding:0; overflow:hidden; }

    .adi-apply-hint { margin:var(--spacing-2) 0 0; font-size:var(--font-size-xs); color:var(--color-text-secondary); }

    .adi-table { width:100%; border-collapse:collapse; font-size:var(--font-size-sm); }
    .adi-table th, .adi-table td { padding:var(--spacing-2); border-bottom:1px solid var(--color-border-subtle); text-align:left; vertical-align:top; }
    .adi-table tfoot th, .adi-table tfoot td { border-bottom:none; border-top:2px solid var(--color-border-default); font-weight:600; }
    .adi-num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
    .adi-account-label { display:block; color:var(--color-text-tertiary); font-size:var(--font-size-xs); }
    .adi-chip { display:inline-block; margin-left:var(--spacing-1); padding:0 var(--spacing-1); border-radius:var(--radius-sm); font-size:var(--font-size-xs); }
    .adi-chip--danger { background:var(--color-danger); color:#fff; }
    .adi-chip--warn { background:var(--color-warning); color:#000; }
    .adi-balanced { margin:var(--spacing-2) 0 0; font-size:var(--font-size-xs); color:var(--color-success); display:flex; align-items:center; gap:var(--spacing-2); }

    .adi-diagnostics { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:var(--spacing-2); }
    .adi-diagnostic { display:flex; gap:var(--spacing-2); font-size:var(--font-size-sm); }
    .adi-diagnostic--blocking { color:var(--color-danger); }
    .adi-diagnostic--warning { color:var(--color-warning); }
    .adi-diagnostic--info { color:var(--color-text-secondary); }

    .adi-footer { display:flex; justify-content:flex-end; gap:var(--spacing-2); }
  `
})
export class AccountingDocumentImportDialogComponent implements OnChanges, OnDestroy {
  readonly loc_ui_tern_client_1bdd79 = $localize`:@@ui.tern.client.1bdd79:Client`;
  readonly loc_ui_tern_fournisseur_97d91d = $localize`:@@ui.tern.fournisseur.97d91d:Fournisseur`;
  readonly loc_ui_tern_par_matricule_fiscal_ef1940 = $localize`:@@ui.tern.par.matricule.fiscal.ef1940: par matricule fiscal`;
  readonly loc_ui_tern_par_nom_4c4de0 = $localize`:@@ui.tern.par.nom.4c4de0: par nom`;
  private readonly importService = inject(AccountingDocumentImportService);
  private readonly confirmationService = inject(ConfirmationService);

  @Input() visible = false;
  @Output() visibleChange = new EventEmitter<boolean>();

  /** Émis quand l'utilisateur applique la proposition : le parent la pousse dans le formulaire. */
  @Output() applied = new EventEmitter<{ proposal: JournalEntryProposal; file: File }>();

  @ViewChild('fileInput') fileInput?: ElementRef<HTMLInputElement>;
  @ViewChild('proposalEditor') proposalEditor?: ImportProposalEditorComponent;

  readonly phase = signal<ImportPhase>('idle');
  readonly errorMessage = signal('');
  readonly selectedFileName = signal('');
  readonly elapsedSeconds = signal(0);
  readonly proposal = signal<JournalEntryProposal | null>(null);
  readonly reanalyzing = signal(false);
  readonly capabilityHint = signal<string | null>(null);
  readonly displayDiagnostics = signal<ProposalDiagnostic[]>([]);

  readonly methodLabel = computed(() => {
    const p = this.proposal();
    return p ? extractionMethodLabel(p.extraction.extractionMethod) : '';
  });

  private currentFile: File | null = null;
  private subscription?: Subscription;
  private timer?: ReturnType<typeof setInterval>;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible']?.currentValue === true) {
      this.loadCapabilities();
    }
  }

  ngOnDestroy(): void {
    this.stopTimer();
    this.subscription?.unsubscribe();
  }

  /** Appelé par le parent à l'ouverture : signale une éventuelle indisponibilité de l'IA. */
  loadCapabilities(): void {
    this.importService.capabilities().subscribe({
      next: (caps) => {
        if (!caps.aiFallbackAvailable) {
          this.capabilityHint.set(
            $localize`:@@accounting.accounting-document-import-dialog.ts.analyse.ia.indisponible.pour.votre.compt.2a1357aa:Analyse IA indisponible pour votre compte : seules les factures émises par `
            + $localize`:@@ui.tern.instafact.pourront.etre.lues.dc81c8:InstaFact pourront être lues.`);
          return;
        }
        if (caps.visionModel && caps.visionModelReady === false) {
          this.capabilityHint.set(
            $localize`:@@accounting.accounting-document-import-dialog.ts.le.modele.vision.d.import.visionmodel.n.408356a2:Le modèle vision d'import (${caps.visionModel}:visionModel:) n'est pas prêt sur le serveur. `
            + $localize`:@@accounting.accounting-document-import-dialog.ts.les.photos.de.factures.pourraient.echoue.45785b89:Les photos de factures pourraient échouer — contactez l'administrateur InstaFact.`);
          return;
        }
        this.capabilityHint.set(null);
      },
      error: () => this.capabilityHint.set(null)
    });
  }

  chooseFile(): void {
    this.phase.set('idle');
    this.fileInput?.nativeElement.click();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    this.currentFile = file;
    this.selectedFileName.set(file.name);
    this.runAnalysis();
  }

  changeDirection(direction: DocumentDirection): void {
    const current = this.proposal();
    if (!current || current.direction === direction || !this.currentFile) {
      return;
    }
    if (this.proposalEditor?.hasManualEdits()) {
      this.confirmDiscardEdits(() => this.reanalyzeWithDirection(direction));
      return;
    }
    this.reanalyzeWithDirection(direction);
  }

  /** Le tiers vient d'être créé : on relance la proposition pour rattacher l'auxiliaire. */
  onThirdPartyCreated(_: string): void {
    const current = this.proposal();
    if (!current || !this.currentFile) {
      return;
    }
    if (this.proposalEditor?.hasManualEdits()) {
      this.confirmDiscardEdits(() => this.reanalyzeAfterThirdPartyCreated(current.direction));
      return;
    }
    this.reanalyzeAfterThirdPartyCreated(current.direction);
  }

  private reanalyzeWithDirection(direction: DocumentDirection): void {
    if (!this.currentFile) return;
    this.reanalyzing.set(true);
    this.subscription?.unsubscribe();
    this.subscription = this.importService.propose(this.currentFile, direction).subscribe({
      next: (p) => {
        this.proposal.set(p);
        this.displayDiagnostics.set(p.diagnostics);
        this.reanalyzing.set(false);
      },
      error: (err: Error) => {
        this.reanalyzing.set(false);
        this.errorMessage.set(err.message);
        this.phase.set('error');
      }
    });
  }

  private reanalyzeAfterThirdPartyCreated(direction: DocumentDirection): void {
    if (!this.currentFile) return;
    this.reanalyzing.set(true);
    this.subscription?.unsubscribe();
    this.subscription = this.importService.propose(this.currentFile, direction).subscribe({
      next: (p) => {
        this.proposal.set(p);
        this.displayDiagnostics.set(p.diagnostics);
        this.reanalyzing.set(false);
      },
      error: () => this.reanalyzing.set(false)
    });
  }

  apply(): void {
    const merged = this.proposalEditor?.getMergedProposal();
    if (!merged || !this.canApplyNow() || !this.currentFile) {
      return;
    }
    this.applied.emit({ proposal: merged, file: this.currentFile });
    this.close();
  }

  canApplyNow(): boolean {
    if (this.reanalyzing()) {
      return false;
    }
    const editor = this.proposalEditor;
    if (!editor) {
      const p = this.proposal();
      return !!p && !p.hasBlockingDiagnostic;
    }
    const merged = editor.getMergedProposal();
    return !merged.hasBlockingDiagnostic && editor.isBalanced();
  }

  onEditorStateChange(): void {
    const editor = this.proposalEditor;
    if (!editor) {
      const p = this.proposal();
      this.displayDiagnostics.set(p?.diagnostics ?? []);
      return;
    }
    this.displayDiagnostics.set(editor.getMergedProposal().diagnostics);
  }

  private confirmDiscardEdits(onConfirm: () => void): void {
    this.confirmationService.confirm({
      message: $localize`:@@accounting.accounting-document-import-dialog.ts.vos.modifications.sur.l.ecriture.propose.61542b1a:Vos modifications sur l'écriture proposée seront perdues. Continuer ?`,
      header: $localize`:@@accounting.accounting-document-import-dialog.ts.confirmation.3424edc2:Confirmation`,
      acceptLabel: $localize`:@@accounting-document-import-dialog.component.acceptLabel.Continuer:Continuer`,
      rejectLabel: $localize`:@@accounting-document-import-dialog.component.rejectLabel.Annuler:Annuler`,
      accept: onConfirm
    });
  }

  cancelImport(): void {
    this.subscription?.unsubscribe();
    this.stopTimer();
    this.phase.set('idle');
  }

  onHide(): void {
    this.subscription?.unsubscribe();
    this.stopTimer();
    this.reset();
    this.visibleChange.emit(false);
  }

  amount(value: number | null | undefined): string {
    if (value === null || value === undefined) {
      return '—';
    }
    return value.toLocaleString('fr-TN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  }

  private runAnalysis(): void {
    if (!this.currentFile) {
      return;
    }
    this.phase.set('extracting');
    this.errorMessage.set('');
    this.proposal.set(null);
    this.startTimer();

    this.subscription?.unsubscribe();
    this.subscription = this.importService.propose(this.currentFile).subscribe({
      next: (p) => {
        this.stopTimer();
        this.proposal.set(p);
        this.displayDiagnostics.set(p.diagnostics);
        this.phase.set('review');
      },
      error: (err: Error) => {
        this.stopTimer();
        this.errorMessage.set(err.message || $localize`:@@accounting.accounting-document-import-dialog.ts.l.analyse.de.la.piece.a.echoue.b308ea32:L'analyse de la pièce a échoué.`);
        this.phase.set('error');
      }
    });
  }

  private startTimer(): void {
    this.elapsedSeconds.set(0);
    this.stopTimer();
    this.timer = setInterval(() => this.elapsedSeconds.update((s) => s + 1), 1000);
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private close(): void {
    this.visible = false;
    this.visibleChange.emit(false);
    this.reset();
  }

  private reset(): void {
    this.phase.set('idle');
    this.proposal.set(null);
    this.displayDiagnostics.set([]);
    this.errorMessage.set('');
    this.selectedFileName.set('');
    this.reanalyzing.set(false);
    this.currentFile = null;
  }
}
