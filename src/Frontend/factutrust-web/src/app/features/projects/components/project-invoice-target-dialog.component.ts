import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { RadioButtonModule } from 'primeng/radiobutton';
import { MessageModule } from 'primeng/message';
import { ButtonComponent } from '@shared/components/button/button.component';
import { ProjectDraftInvoice } from '../project-api.service';

export interface ProjectInvoiceTargetChoice {
  targetInvoiceId?: string;
}

@Component({
  selector: 'app-project-invoice-target-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, DialogModule, RadioButtonModule, MessageModule, ButtonComponent],
  template: `
    <p-dialog
      [(visible)]="visible"
      [modal]="true"
      header="Facturer la sélection" i18n-header="@@projects.components.facturer.la.selection.37788e00"
      [style]="{ width: '34rem' }"
      [draggable]="false"
      (onShow)="reset()"
      (onHide)="cancelled.emit()">
      @if (step === 'mode') {
        <p class="intro" i18n="@@projects.components.choisissez.comment.facturer.les.elements.selecti.e12b687e">Choisissez comment facturer les éléments sélectionnés.</p>
        <div class="mode-options">
          <div class="mode-option">
            <p-radiobutton name="invoiceTargetMode" value="new" [(ngModel)]="mode" inputId="inv-target-new" />
            <label for="inv-target-new" i18n="@@projects.components.creer.une.nouvelle.facture.e51d1303">Créer une nouvelle facture</label>
          </div>
          <div class="mode-option">
            <p-radiobutton name="invoiceTargetMode" value="existing" [(ngModel)]="mode" inputId="inv-target-existing" />
            <label for="inv-target-existing" i18n="@@projects.components.ajouter.a.une.facture.brouillon.existante.d090e3f0">Ajouter à une facture brouillon existante</label>
          </div>
        </div>
      } @else {
        <p class="intro" i18n="@@projects.components.selectionnez.une.facture.brouillon.du.meme.clien.522bcb6f">Sélectionnez une facture brouillon du même client et du même projet.</p>
        @if (!drafts.length) {
          <p-message severity="warn" text="Aucune facture brouillon compatible." i18n-text="@@projects.components.aucune.facture.brouillon.compatible.06ca82e6" styleClass="w-full" />
        } @else {
          <div class="draft-list">
            @for (d of drafts; track d.invoiceId) {
              <div class="draft-row">
                <p-radiobutton
                  name="draftPick"
                  [value]="d.invoiceId"
                  [(ngModel)]="selectedDraftId"
                  [inputId]="'draft-' + d.invoiceId" />
                <label [for]="'draft-' + d.invoiceId" i18n="@@projects.components.ht.ligne.s.a3a0b7c1">
                  <span class="draft-number">{{ d.number }}</span>
                  <span class="draft-meta">{{ d.issueDate | date:'dd/MM/yyyy' }} — {{ d.amountHT | number:'1.3-3' }} HT — {{ d.lineCount }} ligne(s)</span>
                </label>
              </div>
            }
          </div>
        }
      }
      @if (error) {
        <p-message severity="error" [text]="error" styleClass="w-full mt-2" />
      }
      <ng-template pTemplate="footer">
        @if (step === 'mode') {
          <app-button variant="secondary" (click)="close()" i18n="@@projects.components.annuler.49ba3292">Annuler</app-button>
          <app-button variant="primary" (click)="continueFromMode()" i18n="@@projects.components.continuer.129ffff9">Continuer</app-button>
        } @else {
          <app-button variant="secondary" (click)="backToMode()" i18n="@@projects.components.retour.e5befb1f">Retour</app-button>
          <app-button variant="primary" [disabled]="!selectedDraftId" (click)="confirmExisting()" i18n="@@projects.components.ajouter.a.la.facture.b56e1738">Ajouter à la facture</app-button>
        }
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    .intro {
      margin: 0 0 var(--spacing-3);
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
    }
    .mode-options {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-3);
    }
    .mode-option {
      display: flex;
      align-items: flex-start;
      gap: var(--spacing-2);
    }
    .mode-option label {
      cursor: pointer;
      line-height: 1.4;
    }
    .draft-list {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
      max-height: 16rem;
      overflow: auto;
    }
    .draft-row {
      display: flex;
      gap: var(--spacing-2);
      align-items: flex-start;
    }
    .draft-row label {
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
    }
    .draft-number {
      font-weight: var(--font-weight-medium);
    }
    .draft-meta {
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
    }
  `]
})
export class ProjectInvoiceTargetDialogComponent {
  @Input() visible = false;
  @Input() preloadedDrafts: ProjectDraftInvoice[] = [];
  @Output() visibleChange = new EventEmitter<boolean>();
  @Output() chosen = new EventEmitter<ProjectInvoiceTargetChoice>();
  @Output() cancelled = new EventEmitter<void>();

  step: 'mode' | 'pick' = 'mode';
  mode: 'new' | 'existing' = 'new';
  error: string | null = null;
  drafts: ProjectDraftInvoice[] = [];
  selectedDraftId: string | null = null;

  reset(): void {
    this.step = 'mode';
    this.mode = 'new';
    this.error = null;
    this.drafts = [...this.preloadedDrafts];
    this.selectedDraftId = null;
  }

  close(): void {
    this.visible = false;
    this.visibleChange.emit(false);
  }

  continueFromMode(): void {
    this.error = null;
    if (this.mode === 'new') {
      this.chosen.emit({});
      this.close();
      return;
    }
    this.step = 'pick';
    this.drafts = [...this.preloadedDrafts];
    if (!this.drafts.length) {
      this.error = 'Aucune facture brouillon compatible pour ce projet.';
    }
  }

  backToMode(): void {
    this.step = 'mode';
    this.error = null;
    this.selectedDraftId = null;
  }

  confirmExisting(): void {
    if (!this.selectedDraftId) return;
    this.chosen.emit({ targetInvoiceId: this.selectedDraftId });
    this.close();
  }
}
