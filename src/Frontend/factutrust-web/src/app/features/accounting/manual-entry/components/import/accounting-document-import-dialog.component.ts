/// <reference types="@angular/localize" />
import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  LOCALE_ID,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
  computed,
  inject,
  signal,
  viewChild
} from '@angular/core';
import { CommonModule, DOCUMENT, formatNumber } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
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
import { submittableRowNumbers, withRowNumberPrefix } from './import-proposal.utils';
import { AccountingDocumentPreviewComponent } from './accounting-document-preview.component';
import {
  AcceptedDocumentPreview,
  PreviewKind,
  PreviewRejectionReason,
  classifyDocumentFile
} from './accounting-document-preview.util';

type ImportPhase = 'idle' | 'preview' | 'extracting' | 'review' | 'error';

/** Bandeau d'état de la section « Lignes d'écriture proposées » (un seul à la fois). */
export interface LinesBanner {
  kind: 'reanalyzing' | 'loading' | 'accountsLoadFailed' | 'empty' | 'blocking' | 'singleLine' | 'unbalanced';
  severity: 'error' | 'warning' | 'info';
  message: string;
}

/**
 * Import d'une facture (vente ou achat) depuis la saisie manuelle d'écritures.
 *
 * Parcours : choix du fichier → aperçu local → analyse → écran de RELECTURE (sens, tiers, totaux
 * détectés, lignes proposées, diagnostics) → application au formulaire de saisie.
 * Rien n'est enregistré ici : l'écriture part par le chemin habituel « Enregistrer ».
 * L'aperçu reste dans le navigateur : le fichier n'est envoyé qu'au clic « Analyser ».
 */
@Component({
  selector: 'app-accounting-document-import-dialog',
  standalone: true,
  imports: [CommonModule, DialogModule, ButtonComponent, ThirdPartyQuickCreateComponent, ImportProposalEditorComponent, AccountingDocumentPreviewComponent],
  providers: [AccountingDocumentImportService],
  template: `
    <p-dialog
      header="Importer une facture" i18n-header="@@accounting.manual-entry.importer.une.facture.66ed8807"
      [visible]="visible"
      (visibleChange)="onDialogVisibleChange($event)"
      [modal]="true"
      [style]="{ width: dialogWidth(), maxWidth: '98vw' }"
      [contentStyle]="{ overflow: 'auto', maxHeight: 'calc(100vh - 9rem)' }"
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
          <div class="adi-with-preview">
            <div class="adi-extract-bar" role="status" aria-live="polite">
              <i class="pi pi-spin pi-spinner adi-spinner" aria-hidden="true"></i>
              <div class="adi-extract-copy">
                <p class="adi-title" i18n="@@accounting.manual-entry.analyse.de.la.piece.s.b321b13b">Analyse de la pièce… ({{ elapsedSeconds() }} s)</p>
                <p class="adi-text">
                  @if (selectedFileName()) {
                    <span class="adi-filename">{{ selectedFileName() }}</span>
                  }
                  @if (externalProvider()) {<ng-container i18n="@@accounting.manual-entry.analyse.par.l.ia.1e399c12">Analyse par l'IA</ng-container>}
                  @else if (elapsedSeconds() < 20) {<ng-container i18n="@@accounting.manual-entry.lecture.du.document.et.detection.des.zon.71726a65">
                    Lecture du document et détection des zones…
                  </ng-container>} @else {<ng-container i18n="@@accounting.manual-entry.le.document.n.est.pas.au.format.instafac.1a09b4ea">
                    Le document n'est pas au format InstaFact : l'analyse IA peut prendre
                    jusqu'à 3 minutes la première fois.
                  </ng-container>}
                </p>
              </div>
              <app-button variant="secondary" icon="pi-times" iconPos="left"
                          (click)="cancelImport()" ariaLabel="Annuler l'analyse" i18n-ariaLabel="@@accounting.manual-entry.annuler.l.analyse.f487f0e5" i18n="@@accounting.manual-entry.annuler.49ba3292"> Annuler </app-button>
            </div>
            <ng-container [ngTemplateOutlet]="documentPreview" [ngTemplateOutletContext]="{ layout: 'full' }" />
          </div>
        }

        @case ('error') {
          <div [class.adi-with-preview]="!!previewKind()" [class.adi-state]="!previewKind()" role="alert">
            <div [class.adi-extract-bar]="!!previewKind()">
              @if (!previewKind()) {
                <i class="pi pi-exclamation-triangle adi-icon adi-icon-error" aria-hidden="true"></i>
              }
              <div class="adi-extract-copy">
                @if (rejection()) {
                  <p class="adi-title" i18n="@@accounting.manual-entry.fichier.refuse.27013a1f">Fichier refusé</p>
                } @else {
                  <p class="adi-title" i18n="@@accounting.manual-entry.l.analyse.a.echoue.14b05060">L'analyse a échoué</p>
                }
                <ng-container [ngTemplateOutlet]="errorCopy" />
              </div>
              <ng-container [ngTemplateOutlet]="errorActions" />
            </div>
            @if (previewKind()) {
              <ng-container [ngTemplateOutlet]="documentPreview" [ngTemplateOutletContext]="{ layout: 'full' }" />
            }
          </div>
        }

        @case ('preview') {
          <div class="adi-preview-stage">
            @if (externalProvider()) {
              <p class="adi-banner" role="status" i18n="@@accounting.manual-entry.analyse.par.l.ia.1e399c12">Analyse par l'IA</p>
            }
            @if (capabilityHint(); as hint) {
              <p class="adi-hint adi-hint-warn" role="status">{{ hint }}</p>
            }
            <ng-container [ngTemplateOutlet]="documentPreview" [ngTemplateOutletContext]="{ layout: 'full' }" />
          </div>
        }

        @case ('review') {
          @if (proposal(); as p) {
            <div class="adi-review-layout">
              @if (previewKind()) {
                <div class="adi-preview-pane">
                  <ng-container [ngTemplateOutlet]="documentPreview" [ngTemplateOutletContext]="{ layout: 'pane' }" />
                </div>
              }
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

              <!-- Diagnostics -->
              @if (diagnosticsView().length > 0) {
                <section class="adi-card adi-diagnostics-card" #diagnosticsCard tabindex="-1"
                         aria-labelledby="adi-diagnostics-title">
                  <h3 id="adi-diagnostics-title" class="adi-card__title" i18n="@@accounting.manual-entry.controles.3d337f2f">Contrôles</h3>
                  <ul class="adi-diagnostics">
                    @for (d of diagnosticsView(); track $index) {
                      <li class="adi-diagnostic" [class]="'adi-diagnostic--' + d.severity">
                        <i class="pi" [class.pi-times-circle]="d.severity === 'blocking'"
                           [class.pi-exclamation-triangle]="d.severity === 'warning'"
                           [class.pi-info-circle]="d.severity === 'info'" aria-hidden="true"></i>
                        <span>{{ d.message }}</span>
                      </li>
                    }
                  </ul>
                </section>
              }
            </div>

              <!-- Lignes d'écriture proposées (éditables), pleine largeur sous la relecture -->
              <section class="adi-card adi-lines" role="region" aria-labelledby="adi-lines-title"
                       [class.is-busy]="reanalyzing()"
                       [attr.aria-busy]="reanalyzing() ? 'true' : null">
                <header class="adi-card__header adi-lines__header">
                  <h3 id="adi-lines-title" class="adi-card__title" i18n="@@accounting.manual-entry.lignes.d.ecriture.proposees.0c7e6928">Lignes d'écriture proposées</h3>
                  <p class="adi-lines__summary" aria-live="polite">{{ linesSummary() }}</p>
                </header>
                @if (linesBanner(); as b) {
                  <div class="adi-lines-banner" [class]="'adi-lines-banner adi-lines-banner--' + b.severity"
                       [attr.role]="b.severity === 'error' ? 'alert' : 'status'" [attr.data-banner]="b.kind">
                    <span>{{ b.message }}</span>
                    @if (b.kind === 'blocking') {
                      <button type="button" class="adi-link" (click)="focusDiagnostics()" i18n="@@accounting.manual-entry.voir.les.controles.f35eaa1e">Voir les contrôles</button>
                    }
                  </div>
                }
                <div class="adi-lines__editor" [attr.inert]="reanalyzing() ? '' : null">
                  <app-import-proposal-editor #proposalEditor [proposal]="p" />
                </div>
              </section>
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

      <ng-template #documentPreview let-layout="layout">
        @if (previewKind(); as kind) {
          <app-accounting-document-preview
            [kind]="kind"
            [imageUrl]="imageUrl()"
            [pdfUrl]="pdfUrl()"
            [fileName]="selectedFileName()"
            [fileSize]="previewFileSize()"
            [attachmentMayBeRejected]="attachmentMayBeRejected()"
            [layout]="layout" />
        }
      </ng-template>

      <ng-template #errorCopy>
        @switch (rejection()) {
          @case ('empty') {
            <p class="adi-text" i18n="@@accounting.manual-entry.fichier.vide.2ff144e8">Fichier vide.</p>
          }
          @case ('too-large') {
            <p class="adi-text" i18n="@@accounting.manual-entry.fichier.trop.volumineux.maximum.10.mo.717ddc82">Fichier trop volumineux (maximum 10 Mo).</p>
          }
          @case ('extension') {
            <p class="adi-text" i18n="@@accounting.manual-entry.ce.fichier.n.est.pas.un.format.accepte.9119584c">Ce fichier n'est pas un format accepté.</p>
          }
          @case ('signature') {
            <p class="adi-text" i18n="@@accounting.manual-entry.le.contenu.du.fichier.ne.correspond.pas.a.son.ex.e6448e8b">Le contenu du fichier ne correspond pas à son extension.</p>
          }
          @default {
            <p class="adi-text">{{ errorMessage() }}</p>
          }
        }
      </ng-template>

      <ng-template #errorActions>
        <div class="adi-inline-actions">
          @if (previewKind()) {
            <app-button variant="primary" icon="pi-refresh" iconPos="left"
                        (click)="analyze()" ariaLabel="Relancer l'analyse" i18n-ariaLabel="@@accounting.manual-entry.relancer.l.analyse.904749cc" i18n="@@accounting.manual-entry.relancer.l.analyse.904749cc">Relancer l'analyse</app-button>
            <app-button variant="secondary" (click)="chooseFile()" ariaLabel="Choisir un autre fichier" i18n-ariaLabel="@@accounting.manual-entry.choisir.un.autre.fichier.c0cbec19" i18n="@@accounting.manual-entry.choisir.un.autre.fichier.c0cbec19">Choisir un autre fichier</app-button>
          } @else {
            <app-button variant="primary" icon="pi-upload" iconPos="left"
                        (click)="chooseFile()" ariaLabel="Choisir un autre fichier" i18n-ariaLabel="@@accounting.manual-entry.choisir.un.autre.fichier.c0cbec19" i18n="@@accounting.manual-entry.choisir.un.autre.fichier.c0cbec19">Choisir un autre fichier</app-button>
          }
        </div>
      </ng-template>

      <ng-template pTemplate="footer">
        @if (phase() === 'preview') {
          <div class="adi-footer">
            <app-button variant="secondary" (click)="chooseFile()" ariaLabel="Choisir un autre fichier" i18n-ariaLabel="@@accounting.manual-entry.choisir.un.autre.fichier.c0cbec19" i18n="@@accounting.manual-entry.choisir.un.autre.fichier.c0cbec19">Choisir un autre fichier</app-button>
            <span data-adi-analyze="true">
              <app-button variant="primary" icon="pi-search" iconPos="left"
                          (click)="analyze()" ariaLabel="Analyser la facture" i18n-ariaLabel="@@accounting.manual-entry.analyser.la.facture.09be38e9" i18n="@@accounting.manual-entry.analyser.la.facture.09be38e9">Analyser la facture</app-button>
            </span>
          </div>
        } @else if (phase() === 'review') {
          <div class="adi-footer">
            <app-button variant="secondary" (click)="chooseAnotherFile()" ariaLabel="Analyser une autre pièce" i18n-ariaLabel="@@accounting.manual-entry.analyser.une.autre.piece.09bd4d3a" i18n="@@accounting.manual-entry.autre.piece.de18e3bf"> Autre pièce </app-button>
            <app-button variant="primary" icon="pi-check" iconPos="left"
                        [disabled]="!canApply()"
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
    /* Aucune carte ne se laisse écraser par la hauteur maximale de la colonne qui défile. */
    .adi-review > * { flex:none; }
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
    .adi-facts dd { margin:0; font-variant-numeric:tabular-nums; text-align:end; }
    .adi-facts__total { border-top:1px solid var(--color-border-subtle); margin-top:var(--spacing-1); padding-top:var(--spacing-1); font-weight:600; }

    .adi-badge { display:flex; align-items:center; gap:var(--spacing-2); margin:var(--spacing-2) 0 0; font-size:var(--font-size-xs); }
    .adi-badge--ok { color:var(--color-success); }
    .adi-badge--warn { color:var(--color-warning); }

    /* Section des lignes : pleine largeur, sous l'aperçu et la colonne de relecture. */
    .adi-lines { grid-column:1 / -1; padding:0; min-inline-size:0; }
    .adi-lines.is-busy .adi-lines__editor { opacity:.55; }
    .adi-lines__header { padding-inline:var(--spacing-3); padding-block-start:var(--spacing-3); }
    .adi-lines__header .adi-card__title { margin:0; }
    .adi-lines__summary { margin:0; font-size:var(--font-size-sm); color:var(--color-text-secondary); font-variant-numeric:tabular-nums; }
    .adi-lines-banner {
      display:flex; flex-wrap:wrap; align-items:center; gap:var(--spacing-2);
      margin-block:var(--spacing-2) 0; margin-inline:var(--spacing-3);
      padding:var(--spacing-2) var(--spacing-3);
      border-radius:var(--radius-md); border:1px solid var(--color-border-default);
      font-size:var(--font-size-sm);
    }
    .adi-lines-banner--error { color:var(--color-danger); border-color:var(--color-danger); background:var(--color-danger-subtle, transparent); }
    .adi-lines-banner--warning { color:var(--color-warning); border-color:var(--color-warning); background:var(--color-warning-subtle, transparent); }
    .adi-lines-banner--info { color:var(--color-text-secondary); background:var(--color-background-subtle, transparent); }
    .adi-link {
      border:0; background:none; padding:0; font:inherit; color:inherit;
      text-decoration:underline; cursor:pointer;
    }
    .adi-link:focus-visible { outline:2px solid var(--color-primary); outline-offset:2px; }
    .adi-diagnostics-card:focus { outline:2px solid var(--color-primary); outline-offset:2px; }

    .adi-diagnostics { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:var(--spacing-2); }
    .adi-diagnostic { display:flex; gap:var(--spacing-2); font-size:var(--font-size-sm); }
    .adi-diagnostic--blocking { color:var(--color-danger); }
    .adi-diagnostic--warning { color:var(--color-warning); }
    .adi-diagnostic--info { color:var(--color-text-secondary); }

    .adi-footer { display:flex; justify-content:flex-end; gap:var(--spacing-2); }

    .adi-preview-stage, .adi-with-preview { display:flex; flex-direction:column; gap:var(--spacing-3); }
    .adi-banner {
      margin:0;
      padding:var(--spacing-2) var(--spacing-3);
      border-radius:var(--radius-md);
      background:var(--color-warning-subtle, transparent);
      color:var(--color-warning);
      font-size:var(--font-size-sm);
    }
    .adi-extract-bar {
      display:flex;
      flex-wrap:wrap;
      align-items:center;
      gap:var(--spacing-2);
      padding:var(--spacing-2) var(--spacing-3);
      border:1px solid var(--color-border-default);
      border-radius:var(--radius-md);
      background:var(--color-background-elevated);
    }
    .adi-extract-copy { flex:1 1 16rem; min-inline-size:0; }
    .adi-extract-bar .adi-title { margin:0; }
    .adi-extract-bar .adi-text { text-align:start; max-inline-size:none; }
    .adi-inline-actions { display:flex; flex-wrap:wrap; gap:var(--spacing-2); margin-inline-start:auto; }
    .adi-review-layout {
      display:grid;
      grid-template-columns:minmax(280px, 42%) minmax(0, 1fr);
      gap:var(--spacing-3);
      align-items:stretch;
    }
    .adi-review-layout:not(:has(.adi-preview-pane)) { grid-template-columns:minmax(0, 1fr); }
    .adi-preview-pane {
      min-inline-size:0;
      min-block-size:0;
      block-size:min(58vh, 640px);
      max-block-size:min(58vh, 640px);
    }
    .adi-review-layout > .adi-review {
      overflow:auto;
      min-inline-size:0;
      min-block-size:0;
      max-block-size:min(58vh, 640px);
    }
    @media (max-width: 960px) {
      .adi-review-layout { grid-template-columns:minmax(0, 1fr); }
      .adi-preview-pane { block-size:40vh; max-block-size:40vh; }
      .adi-review-layout > .adi-review { max-block-size:none; overflow:visible; }
    }
  `
})
export class AccountingDocumentImportDialogComponent implements OnChanges, OnDestroy {
  readonly loc_ui_tern_client_1bdd79 = $localize`:@@ui.tern.client.1bdd79:Client`;
  readonly loc_ui_tern_fournisseur_97d91d = $localize`:@@ui.tern.fournisseur.97d91d:Fournisseur`;
  readonly loc_ui_tern_par_matricule_fiscal_ef1940 = $localize`:@@ui.tern.par.matricule.fiscal.ef1940: par matricule fiscal`;
  readonly loc_ui_tern_par_nom_4c4de0 = $localize`:@@ui.tern.par.nom.4c4de0: par nom`;
  private readonly importService = inject(AccountingDocumentImportService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly locale = inject(LOCALE_ID);
  private readonly document = inject(DOCUMENT);

  @Input() visible = false;
  @Output() visibleChange = new EventEmitter<boolean>();

  /** Émis quand l'utilisateur applique la proposition : le parent la pousse dans le formulaire. */
  @Output() applied = new EventEmitter<{ proposal: JournalEntryProposal; file: File }>();

  @ViewChild('fileInput') fileInput?: ElementRef<HTMLInputElement>;
  @ViewChild('diagnosticsCard') diagnosticsCard?: ElementRef<HTMLElement>;
  readonly proposalEditor = viewChild<ImportProposalEditorComponent>('proposalEditor');

  readonly phase = signal<ImportPhase>('idle');
  readonly errorMessage = signal('');
  readonly selectedFileName = signal('');
  readonly elapsedSeconds = signal(0);
  readonly proposal = signal<JournalEntryProposal | null>(null);
  readonly reanalyzing = signal(false);
  readonly capabilityHint = signal<string | null>(null);
  /** Nom du service d'extraction externe quand il est actif ; pilote le message d'attente. */
  readonly externalProvider = signal<string | null>(null);
  readonly previewKind = signal<PreviewKind | null>(null);
  readonly imageUrl = signal<string | null>(null);
  readonly pdfUrl = signal<SafeResourceUrl | null>(null);
  readonly previewFileSize = signal(0);
  readonly attachmentMayBeRejected = signal(false);
  readonly rejection = signal<PreviewRejectionReason | null>(null);

  readonly methodLabel = computed(() => {
    const p = this.proposal();
    return p ? extractionMethodLabel(p.extraction.extractionMethod) : '';
  });

  /** Proposition éditée (contrôles recalculés) ; à défaut, celle de l'analyse. */
  readonly merged = computed<JournalEntryProposal | null>(
    () => this.proposalEditor()?.mergedProposal() ?? this.proposal()
  );
  readonly displayDiagnostics = computed<ProposalDiagnostic[]>(() => this.merged()?.diagnostics ?? []);
  readonly hasBlocking = computed(() => !!this.merged()?.hasBlockingDiagnostic);
  readonly blockingCount = computed(() => this.displayDiagnostics().filter(d => d.severity === 'blocking').length);
  /** Référentiels de l'éditeur chargés (plan comptable, périodes, journaux). */
  readonly refsReady = computed(() => {
    const editor = this.proposalEditor();
    return !!editor && !editor.refsLoading();
  });
  readonly submittableCount = computed(() => this.proposalEditor()?.submittableCount() ?? 0);
  readonly isBalanced = computed(() => this.proposalEditor()?.balanced() ?? false);

  /**
   * Appliquer : pas de réanalyse en cours, référentiels chargés, aucun contrôle bloquant et au
   * moins une ligne exploitable. Le déséquilibre et la ligne unique n'empêchent pas d'appliquer
   * (confirmation demandée) : l'enregistrement reste bloqué par la saisie et par le serveur.
   */
  readonly canApply = computed(() =>
    !this.reanalyzing() && this.refsReady() && !this.hasBlocking() && this.submittableCount() >= 1
  );
  readonly needsApplyConfirmation = computed(() => !this.isBalanced() || this.submittableCount() < 2);

  /** Écart débit − crédit formaté avec la devise de l'écriture. */
  private readonly formattedGap = computed(() => {
    const editor = this.proposalEditor();
    if (!editor) return { gap: '', currency: '' };
    return {
      gap: formatNumber(Math.abs(editor.balanceGap()), this.locale, editor.amountFormat()),
      currency: editor.currencyCode()
    };
  });

  readonly linesSummary = computed(() => {
    const editor = this.proposalEditor();
    if (!editor) return '';
    const balance = formatNumber(editor.balanceGap(), this.locale, editor.amountFormat());
    const currency = editor.currencyCode();
    const count = this.submittableCount();
    const blocking = this.blockingCount();
    return $localize`:@@accounting.accounting-document-import-dialog.ts.solde.lignes.controles.bloquants.8ac4653c:Solde : ${balance}:balance: ${currency}:currency: · Lignes : ${count}:count: · Contrôles bloquants : ${blocking}:blocking:`;
  });

  readonly linesBanner = computed<LinesBanner | null>(() => {
    const editor = this.proposalEditor();
    if (this.reanalyzing()) {
      return { kind: 'reanalyzing', severity: 'info', message: $localize`:@@accounting.accounting-document-import-dialog.ts.nouvelle.analyse.de.la.piece.en.cours.1bcc66e2:Nouvelle analyse de la pièce en cours…` };
    }
    if (!editor) return null;
    if (editor.refsLoading()) {
      return { kind: 'loading', severity: 'info', message: $localize`:@@accounting.accounting-document-import-dialog.ts.chargement.du.plan.comptable.dab5c7be:Chargement du plan comptable…` };
    }
    if (editor.accountsLoadFailed()) {
      return { kind: 'accountsLoadFailed', severity: 'warning', message: $localize`:@@accounting.accounting-document-import-dialog.ts.le.plan.comptable.n.a.pas.pu.etre.charge.les.con.9b6aa699:Le plan comptable n'a pas pu être chargé : les contrôles de compte affichés sont ceux de l'analyse.` };
    }
    const count = this.submittableCount();
    if (count === 0) {
      return { kind: 'empty', severity: 'error', message: $localize`:@@accounting.accounting-document-import-dialog.ts.aucune.ligne.exploitable.saisissez.au.moins.une.59fd93cb:Aucune ligne exploitable : saisissez au moins une ligne avec un compte et un montant.` };
    }
    if (this.hasBlocking()) {
      const blocking = this.blockingCount();
      return { kind: 'blocking', severity: 'error', message: $localize`:@@accounting.accounting-document-import-dialog.ts.controles.bloquants.a.corriger.f95a78fa:Contrôles bloquants à corriger : ${blocking}:count:.` };
    }
    if (count === 1) {
      return { kind: 'singleLine', severity: 'warning', message: $localize`:@@accounting.accounting-document-import-dialog.ts.une.ecriture.doit.comporter.au.moins.deux.lignes.8b6547b1:Une écriture doit comporter au moins deux lignes pour être enregistrée.` };
    }
    if (!this.isBalanced()) {
      const { gap, currency } = this.formattedGap();
      return { kind: 'unbalanced', severity: 'warning', message: $localize`:@@accounting.accounting-document-import-dialog.ts.ecriture.non.equilibree.ecart.vous.pourrez.l.app.dc7ff4d1:Écriture non équilibrée (écart ${gap}:gap: ${currency}:currency:). Vous pourrez l'appliquer, mais elle ne pourra pas être enregistrée tant qu'elle n'est pas équilibrée.` };
    }
    return null;
  });

  /**
   * Contrôles affichés. Ceux recalculés côté client reçoivent le préfixe « Ligne N » (rangée de la
   * grille). Ceux conservés tels quels de l'analyse gardent leur message : leur index désigne une
   * ligne de la proposition d'origine, qui peut ne plus correspondre à la grille éditée.
   */
  readonly diagnosticsView = computed<ProposalDiagnostic[]>(() => {
    const diagnostics = this.displayDiagnostics();
    const editor = this.proposalEditor();
    if (!editor) return diagnostics;
    const serverDiagnostics = new Set(this.proposal()?.diagnostics ?? []);
    const rowNumbers = submittableRowNumbers(editor.lines());
    return diagnostics.map(d => (serverDiagnostics.has(d) ? d : withRowNumberPrefix(d, rowNumbers)));
  });

  readonly dialogWidth = computed(() => {
    const phase = this.phase();
    if (phase === 'review') {
      return 'min(1200px, 98vw)';
    }
    if (phase === 'preview' || phase === 'extracting' || (phase === 'error' && this.previewKind())) {
      return 'min(920px, 98vw)';
    }
    return '560px';
  });

  private currentFile: File | null = null;
  private confirmPending = false;
  private objectUrl: string | null = null;
  private selectionSeq = 0;
  /** Sens imposé par l'utilisateur, rejoué si l'analyse est relancée. */
  private forcedDirection: DocumentDirection | undefined;
  private subscription?: Subscription;
  private timer?: ReturnType<typeof setInterval>;
  /**
   * Échap qui ferme une liste déroulante ouverte (compte, tiers, TVA) : la liste se ferme d'abord,
   * puis PrimeNG voit la modale au premier plan et demande sa fermeture. On ignore cette demande.
   */
  private escapeClosesOverlay = false;
  private escapeResetTimer?: ReturnType<typeof setTimeout>;
  private readonly escapeCaptureListener = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.visible) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target || !this.host.nativeElement.contains(target)) return;
    if (target.closest('[aria-expanded="true"]')) {
      this.escapeClosesOverlay = true;
      clearTimeout(this.escapeResetTimer);
      // Après la fin de la propagation de cet événement (les microtâches passeraient trop tôt).
      this.escapeResetTimer = setTimeout(() => (this.escapeClosesOverlay = false));
    }
  };

  constructor() {
    this.document.addEventListener('keydown', this.escapeCaptureListener, true);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible']?.currentValue === true) {
      this.loadCapabilities();
    }
  }

  ngOnDestroy(): void {
    this.document.removeEventListener('keydown', this.escapeCaptureListener, true);
    clearTimeout(this.escapeResetTimer);
    this.selectionSeq++;
    this.stopTimer();
    this.subscription?.unsubscribe();
    this.revokePreviewUrl();
  }

  /** Appelé par le parent à l'ouverture : signale une éventuelle indisponibilité de l'IA. */
  loadCapabilities(): void {
    this.importService.capabilities().subscribe({
      next: (caps) => {
        this.externalProvider.set(caps.documentExtractionProvider ?? null);
        if (!caps.aiFallbackAvailable) {
          this.capabilityHint.set(
            $localize`:@@accounting.accounting-document-import-dialog.ts.analyse.ia.indisponible.pour.votre.compt.4c261844:Analyse IA indisponible pour votre compte : seules les factures émises par InstaFact pourront être lues.`);
          return;
        }
        if (caps.visionModel && caps.visionModelReady === false) {
          this.capabilityHint.set(
            $localize`:@@accounting.accounting-document-import-dialog.ts.le.modele.vision.d.import.visionmodel.n.5ee55a7a:Le modèle vision d'import (${caps.visionModel}:visionModel:) n'est pas prêt sur le serveur. Les photos de factures pourraient échouer — contactez l'administrateur InstaFact.`);
          return;
        }
        this.capabilityHint.set(null);
      },
      error: () => this.capabilityHint.set(null)
    });
  }

  chooseFile(): void {
    this.fileInput?.nativeElement.click();
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    const seq = ++this.selectionSeq;
    const classified = await classifyDocumentFile(file);
    if (seq !== this.selectionSeq) {
      return;
    }
    if (!classified.accepted) {
      this.clearHeldFile();
      this.rejection.set(classified.reason);
      this.errorMessage.set('');
      this.phase.set('error');
      return;
    }
    this.mountPreview(file, classified);
  }

  /** Envoie la pièce déjà montrée. Aucun octet ne part avant cet appel. */
  analyze(): void {
    if (!this.currentFile || !this.previewKind()) {
      return;
    }
    this.rejection.set(null);
    this.runAnalysis(this.forcedDirection);
  }

  changeDirection(direction: DocumentDirection): void {
    const current = this.proposal();
    if (!current || current.direction === direction || !this.currentFile) {
      return;
    }
    if (this.hasManualEdits()) {
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
    if (this.hasManualEdits()) {
      this.confirmDiscardEdits(() => this.reanalyzeAfterThirdPartyCreated(current.direction));
      return;
    }
    this.reanalyzeAfterThirdPartyCreated(current.direction);
  }

  private reanalyzeWithDirection(direction: DocumentDirection): void {
    if (!this.currentFile) return;
    this.forcedDirection = direction;
    this.reanalyzing.set(true);
    this.subscription?.unsubscribe();
    this.subscription = this.importService.propose(this.currentFile, direction).subscribe({
      next: (p) => {
        this.proposal.set(p);
        this.reanalyzing.set(false);
      },
      error: (err: Error) => {
        this.reanalyzing.set(false);
        this.rejection.set(null);
        this.errorMessage.set(err.message);
        this.phase.set('error');
      }
    });
  }

  private reanalyzeAfterThirdPartyCreated(direction: DocumentDirection): void {
    if (!this.currentFile) return;
    this.forcedDirection = direction;
    this.reanalyzing.set(true);
    this.subscription?.unsubscribe();
    this.subscription = this.importService.propose(this.currentFile, direction).subscribe({
      next: (p) => {
        this.proposal.set(p);
        this.reanalyzing.set(false);
      },
      error: () => this.reanalyzing.set(false)
    });
  }

  apply(): void {
    if (this.confirmPending || !this.canApply() || !this.currentFile || !this.proposalEditor()?.mergedProposal()) {
      return;
    }
    if (!this.needsApplyConfirmation()) {
      this.emitApplied();
      return;
    }
    const singleLine = this.submittableCount() < 2;
    const { gap, currency } = this.formattedGap();
    this.confirm({
      header: singleLine
        ? $localize`:@@accounting.accounting-document-import-dialog.ts.ecriture.incomplete.f2fca376:Écriture incomplète`
        : $localize`:@@accounting.accounting-document-import-dialog.ts.ecriture.non.equilibree.9a3c79dd:Écriture non équilibrée`,
      message: singleLine
        ? $localize`:@@accounting.accounting-document-import-dialog.ts.l.ecriture.ne.comporte.qu.une.seule.ligne.elle.s.25e2ace1:L'écriture ne comporte qu'une seule ligne. Elle sera reportée dans la saisie, mais ne pourra pas être enregistrée tant qu'elle n'a pas au moins deux lignes. Appliquer quand même ?`
        : $localize`:@@accounting.accounting-document-import-dialog.ts.l.ecriture.presente.un.ecart.de.elle.sera.report.9b1d7480:L'écriture présente un écart de ${gap}:gap: ${currency}:currency:. Elle sera reportée dans la saisie, mais ne pourra pas être enregistrée tant qu'elle n'est pas équilibrée. Appliquer quand même ?`,
      acceptLabel: $localize`:@@accounting.accounting-document-import-dialog.ts.appliquer.quand.meme.36c7b8b0:Appliquer quand même`,
      rejectLabel: $localize`:@@accounting.accounting-document-import-dialog.ts.revenir.aux.lignes.0f53977f:Revenir aux lignes`,
      accept: () => this.emitApplied()
    });
  }

  /** Conservé pour compatibilité : même règle que `canApply`. */
  canApplyNow(): boolean {
    return this.canApply();
  }

  hasManualEdits(): boolean {
    return this.proposalEditor()?.hasManualEdits() ?? false;
  }

  /** « Autre pièce » : confirme avant de perdre les lignes modifiées. */
  chooseAnotherFile(): void {
    if (this.hasManualEdits()) {
      this.confirmDiscardEdits(() => this.chooseFile());
      return;
    }
    this.chooseFile();
  }

  /**
   * Croix et Échap : PrimeNG demande la fermeture via `visibleChange` sans se masquer lui-même.
   * Avec des lignes modifiées, on confirme d'abord ; sinon la modale reste ouverte.
   */
  onDialogVisibleChange(visible: boolean): void {
    if (visible || this.confirmPending || this.escapeClosesOverlay) {
      return;
    }
    if (this.phase() === 'review' && this.hasManualEdits()) {
      this.confirmDiscardEdits(() => this.close());
      return;
    }
    this.close();
  }

  /** Donne le focus à la carte « Contrôles » (lien du bandeau des lignes). */
  focusDiagnostics(): void {
    const card = this.diagnosticsCard?.nativeElement;
    if (!card) return;
    card.scrollIntoView({ block: 'nearest' });
    card.focus();
  }

  /** Relit la proposition fusionnée au moment d'appliquer (après une éventuelle confirmation). */
  private emitApplied(): void {
    const merged = this.proposalEditor()?.mergedProposal();
    if (!merged || !this.currentFile || !this.canApply()) {
      return;
    }
    this.applied.emit({ proposal: merged, file: this.currentFile });
    this.close();
  }

  private confirmDiscardEdits(onConfirm: () => void): void {
    this.confirm({
      message: $localize`:@@accounting.accounting-document-import-dialog.ts.vos.modifications.sur.l.ecriture.propose.61542b1a:Vos modifications sur l'écriture proposée seront perdues. Continuer ?`,
      header: $localize`:@@accounting.accounting-document-import-dialog.ts.confirmation.3424edc2:Confirmation`,
      acceptLabel: $localize`:@@accounting-document-import-dialog.component.acceptLabel.Continuer:Continuer`,
      rejectLabel: $localize`:@@accounting-document-import-dialog.component.rejectLabel.Annuler:Annuler`,
      accept: onConfirm
    });
  }

  /**
   * Une seule confirmation à la fois : Échap dans la confirmation atteint aussi la modale PrimeNG,
   * qui redemanderait sa fermeture.
   */
  private confirm(options: { header: string; message: string; acceptLabel: string; rejectLabel: string; accept: () => void }): void {
    this.confirmPending = true;
    this.confirmationService.confirm({
      ...options,
      accept: () => {
        this.confirmPending = false;
        options.accept();
      },
      reject: () => {
        this.confirmPending = false;
      }
    });
  }

  cancelImport(): void {
    this.subscription?.unsubscribe();
    this.stopTimer();
    if (this.currentFile && this.previewKind()) {
      this.phase.set('preview');
      this.focusAnalyze();
      return;
    }
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

  private runAnalysis(direction?: DocumentDirection): void {
    if (!this.currentFile) {
      return;
    }
    this.forcedDirection = direction;
    this.phase.set('extracting');
    this.rejection.set(null);
    this.errorMessage.set('');
    this.proposal.set(null);
    this.startTimer();

    const file = this.currentFile;
    const request = direction
      ? this.importService.propose(file, direction)
      : this.importService.propose(file);
    this.subscription?.unsubscribe();
    this.subscription = request.subscribe({
      next: (p) => {
        this.stopTimer();
        this.proposal.set(p);
        this.phase.set('review');
      },
      error: (err: Error) => {
        this.stopTimer();
        this.rejection.set(null);
        this.errorMessage.set(err.message || $localize`:@@accounting.accounting-document-import-dialog.ts.l.analyse.de.la.piece.a.echoue.b308ea32:L'analyse de la pièce a échoué.`);
        this.phase.set('error');
      }
    });
  }

  private mountPreview(file: File, classified: AcceptedDocumentPreview): void {
    this.revokePreviewUrl();
    this.currentFile = file;
    this.forcedDirection = undefined;
    this.selectedFileName.set(file.name);
    this.previewKind.set(classified.kind);
    this.previewFileSize.set(file.size);
    this.attachmentMayBeRejected.set(classified.attachmentMayBeRejected);
    this.rejection.set(null);
    this.errorMessage.set('');
    if (classified.kind !== 'unsupported') {
      const typed = new Blob([file], { type: classified.mime });
      const url = URL.createObjectURL(typed);
      this.objectUrl = url;
      if (classified.kind === 'pdf') {
        // Uniquement l'URL créée ci-dessus, jamais une adresse fournie par l'utilisateur.
        this.pdfUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(url));
        this.imageUrl.set(null);
      } else {
        this.imageUrl.set(url);
        this.pdfUrl.set(null);
      }
    }
    this.phase.set('preview');
    this.focusAnalyze();
  }

  private clearHeldFile(): void {
    this.revokePreviewUrl();
    this.currentFile = null;
    this.forcedDirection = undefined;
    this.previewKind.set(null);
    this.previewFileSize.set(0);
    this.attachmentMayBeRejected.set(false);
    this.selectedFileName.set('');
    this.imageUrl.set(null);
    this.pdfUrl.set(null);
  }

  private revokePreviewUrl(): void {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.imageUrl.set(null);
    this.pdfUrl.set(null);
  }

  private focusAnalyze(): void {
    setTimeout(() => {
      const button = this.host.nativeElement.querySelector('[data-adi-analyze] button');
      if (button instanceof HTMLButtonElement) {
        button.focus();
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
    this.selectionSeq++;
    this.clearHeldFile();
    this.phase.set('idle');
    this.proposal.set(null);
    this.errorMessage.set('');
    this.rejection.set(null);
    this.reanalyzing.set(false);
  }
}
