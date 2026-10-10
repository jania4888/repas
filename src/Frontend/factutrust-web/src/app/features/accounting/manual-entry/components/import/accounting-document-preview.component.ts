/// <reference types="@angular/localize" />
import { Component, Input, OnChanges, SimpleChanges, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SafeResourceUrl } from '@angular/platform-browser';
import { PreviewKind } from './accounting-document-preview.util';

/**
 * Aperçu visuel d'une pièce déjà classée. Ne crée ni ne révoque d'object URL :
 * le dialogue d'import en est le propriétaire.
 */
@Component({
  selector: 'app-accounting-document-preview',
  standalone: true,
  imports: [CommonModule],
  host: {
    '[class.adp-host--pane]': 'layout === "pane"'
  },
  template: `
    <section class="adp" role="region" aria-label="Aperçu de la facture" i18n-aria-label="@@accounting.manual-entry.apercu.de.la.facture.a6a8b8c5">
      <header class="adp-meta">
        <p class="adp-name">{{ fileName }}</p>
        <p class="adp-size">{{ fileSizeLabel() }}</p>
        @if (kind === 'image' && imageUrl && !imageFailed()) {
          <div class="adp-zoom" role="group" aria-label="Zoom de l'aperçu" i18n-aria-label="@@accounting.manual-entry.zoom.de.l.apercu.423fabdb">
            <button type="button" class="adp-zoom__btn" [class.is-active]="zoom() === 'fit'"
                    [attr.aria-pressed]="zoom() === 'fit'" (click)="zoom.set('fit')"
                    i18n="@@accounting.manual-entry.ajuster.b65f8ead">Ajuster</button>
            <button type="button" class="adp-zoom__btn" [class.is-active]="zoom() === '100'"
                    [attr.aria-pressed]="zoom() === '100'" (click)="zoom.set('100')"
                    i18n="@@accounting.manual-entry.100.ff376401">100 %</button>
            <button type="button" class="adp-zoom__btn" [class.is-active]="zoom() === '150'"
                    [attr.aria-pressed]="zoom() === '150'" (click)="zoom.set('150')"
                    i18n="@@accounting.manual-entry.150.d153f7f9">150 %</button>
          </div>
        }
      </header>

      @if (kind === 'image' && imageUrl && !imageFailed()) {
        <div class="adp-viewport" [class.is-fit]="zoom() === 'fit'" [class.is-100]="zoom() === '100'" [class.is-150]="zoom() === '150'">
          <img [src]="imageUrl" [alt]="fileName" draggable="false" referrerpolicy="no-referrer" (error)="imageFailed.set(true)" />
        </div>
      } @else if (kind === 'pdf' && pdfUrl) {
        <div class="adp-viewport">
          <object [data]="pdfUrl" type="application/pdf" [attr.aria-label]="fileName" referrerpolicy="no-referrer">
            <p class="adp-fallback" i18n="@@accounting.manual-entry.le.navigateur.n.affiche.pas.ce.pdf.l.analyse.res.ef3e0be6">Le navigateur n'affiche pas ce PDF. L'analyse reste possible.</p>
          </object>
        </div>
      } @else {
        <div class="adp-card">
          <i class="pi pi-file adp-card__icon" aria-hidden="true"></i>
          <p class="adp-fallback" i18n="@@accounting.manual-entry.apercu.visuel.indisponible.pour.ce.format.l.anal.fa01f148">Aperçu visuel indisponible pour ce format. L'analyse reste possible.</p>
        </div>
      }

      @if (attachmentMayBeRejected) {
        <p class="adp-warn" role="status" i18n="@@accounting.manual-entry.ce.format.pourra.etre.analyse.mais.la.piece.join.d207f9a0">Ce format pourra être analysé, mais la pièce jointe risque d'être refusée à l'enregistrement (PDF, JPEG, PNG, WebP, Excel, Word uniquement).</p>
      }
    </section>
  `,
  styles: `
    :host { display: flex; flex-direction: column; min-block-size: 0; min-inline-size: 0; }
    .adp { display: flex; flex-direction: column; gap: var(--spacing-2); min-block-size: 0; min-inline-size: 0; }
    .adp-meta { display: flex; flex-wrap: wrap; align-items: center; gap: var(--spacing-2); }
    .adp-name, .adp-size, .adp-fallback, .adp-warn { margin: 0; }
    .adp-name { font-weight: 600; font-size: var(--font-size-sm); overflow-wrap: anywhere; }
    .adp-size, .adp-fallback { font-size: var(--font-size-xs); color: var(--color-text-secondary); }
    .adp-zoom { display: flex; flex-wrap: wrap; gap: var(--spacing-1); margin-inline-start: auto; }
    .adp-zoom__btn {
      border: 1px solid var(--color-border-default);
      background: var(--color-background-elevated);
      color: var(--color-text-primary);
      border-radius: var(--radius-sm);
      padding: var(--spacing-1) var(--spacing-2);
      font: inherit;
      font-size: var(--font-size-xs);
      cursor: pointer;
    }
    .adp-zoom__btn.is-active { border-color: var(--color-primary); color: var(--color-primary); }
    .adp-viewport {
      overflow: auto;
      background: var(--color-background-subtle);
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-md);
      block-size: min(62vh, 720px);
      min-block-size: 420px;
    }
    .adp-viewport.is-fit { display: flex; align-items: center; justify-content: center; }
    .adp-viewport.is-fit img { max-inline-size: 100%; max-block-size: 100%; object-fit: contain; }
    .adp-viewport.is-100 img, .adp-viewport.is-150 img { display: block; max-inline-size: none; }
    .adp-viewport.is-150 img { inline-size: 150%; block-size: auto; }
    .adp-viewport object { display: block; inline-size: 100%; block-size: 100%; min-block-size: 420px; border: 0; }
    .adp-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: var(--spacing-2);
      padding: var(--spacing-4);
      background: var(--color-background-subtle);
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-md);
      min-block-size: 420px;
      justify-content: center;
    }
    .adp-card__icon { font-size: 2rem; color: var(--color-text-tertiary); }
    .adp-warn { font-size: var(--font-size-xs); color: var(--color-warning); }
    :host(.adp-host--pane) { block-size: 100%; }
    :host(.adp-host--pane) .adp { block-size: 100%; }
    :host(.adp-host--pane) .adp-viewport,
    :host(.adp-host--pane) .adp-card {
      flex: 1 1 auto;
      block-size: auto;
      min-block-size: 0;
      max-block-size: none;
    }
    :host(.adp-host--pane) .adp-viewport object { min-block-size: 100%; }
  `
})
export class AccountingDocumentPreviewComponent implements OnChanges {
  @Input({ required: true }) kind!: PreviewKind;
  @Input() imageUrl: string | null = null;
  @Input() pdfUrl: SafeResourceUrl | null = null;
  @Input() fileName = '';
  @Input() fileSize = 0;
  @Input() attachmentMayBeRejected = false;
  @Input() layout: 'full' | 'pane' = 'full';

  readonly imageFailed = signal(false);
  readonly zoom = signal<'fit' | '100' | '150'>('fit');

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['imageUrl'] || changes['kind']) {
      this.imageFailed.set(false);
      this.zoom.set('fit');
    }
  }

  fileSizeLabel(): string {
    const size = this.fileSize;
    if (size < 1024) {
      return `${size} o`;
    }
    if (size < 1024 * 1024) {
      return `${Math.round(size / 1024)} Ko`;
    }
    return `${(size / (1024 * 1024)).toLocaleString('fr-TN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Mo`;
  }
}
