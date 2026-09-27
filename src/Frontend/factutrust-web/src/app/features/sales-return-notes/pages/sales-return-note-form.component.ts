/// <reference types="@angular/localize" />
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { ToastService } from '@core/services/toast.service';
import { formatLocalDate } from '@core/utils/date.util';
import { SalesReturnNoteService } from '../services/sales-return-note.service';
import {
  EligibleDeliveryNoteDto,
  SalesReturnNotePrefillDto,
  SalesReturnNotePrefillLineDto,
  canSaveSalesReturnNote,
  clampReturnedQuantity
} from '../models/sales-return-note.model';

interface EditableLine extends SalesReturnNotePrefillLineDto {
  returnedQuantity: number;
}

@Component({
  selector: 'app-sales-return-note-form',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, PageHeaderComponent, BreadcrumbComponent, ButtonComponent],
  template: `
    <app-breadcrumb [items]="breadcrumbItems"></app-breadcrumb>
    <app-page-header
      title="Nouveau bon de retour" i18n-title="@@sales-return-notes.pages.nouveau.bon.de.retour.362bee47"
      subtitle="Document logistique : réintègre le stock et réduit la quantité facturable du BL. Ce n'est pas un avoir." i18n-subtitle="@@sales-return-notes.pages.document.logistique.reintegre.le.stock.e.ab800030">
      <app-button variant="secondary" routerLink="/return-notes" i18n="@@sales-return-notes.pages.annuler.49ba3292">Annuler</app-button>
      <app-button variant="outline" [disabled]="saving() || !canSave()" (clicked)="save(false)" i18n="@@sales-return-notes.pages.enregistrer.le.brouillon.6a319595"> Enregistrer le brouillon </app-button>
      @if (canConfirm()) {
        <app-button variant="primary" [disabled]="saving() || !canSave()" (clicked)="save(true)" i18n="@@sales-return-notes.pages.enregistrer.et.confirmer.cbe52895"> Enregistrer et confirmer </app-button>
      }
    </app-page-header>

    <p class="help" i18n="@@sales-return-notes.pages.un.bon.de.retour.s.applique.uniquement.a.5a69b9d7">
      <ng-container> Un bon de retour s'applique uniquement aux articles </ng-container> <strong>livrés et non encore facturés</strong>.
      Après facture, utilisez un <strong>avoir de vente</strong>.
      Le stock n’est réintégré qu’après confirmation sur la fiche.
    </p>

    <section class="card">
      <label i18n="@@sales-return-notes.pages.bon.de.livraison.eligible.1a977bce">Bon de livraison éligible</label>
      <select class="form-control" [ngModel]="selectedBlId()" (ngModelChange)="onBlSelected($event)">
        <option value="" i18n="@@sales-return-notes.pages.choisir.un.bl.livre.non.facture.948c909d">— Choisir un BL livré non facturé —</option>
        @for (bl of eligible(); track bl.id) {
          <option [value]="bl.id" i18n="@@sales-return-notes.pages.reste.953dfa53">{{ bl.number }} — {{ bl.clientName }} (reste {{ bl.totalInvoiceableQuantity }})</option>
        }
      </select>
    </section>

    @if (prefill(); as p) {
      <section class="card">
        <p><strong i18n="@@sales-return-notes.pages.client.9c5b4ff1">Client :</strong> {{ p.clientName }} · <strong i18n="@@sales-return-notes.pages.bl.4fa58d85">BL :</strong> {{ p.deliveryNoteNumber }}</p>
        <label i18n="@@sales-return-notes.pages.date.de.retour.f1d5eba0">Date de retour</label>
        <input class="form-control" type="date" [ngModel]="returnDate()" (ngModelChange)="returnDate.set($event)" />
        <label for="return-reason" i18n="@@sales-return-notes.pages.motif.obligatoire.14e480c5">Motif (obligatoire)</label>
        <input
          id="return-reason"
          class="form-control"
          type="text"
          maxlength="500"
          [class.invalid]="showErrors() && !hasValidReason()"
          [attr.aria-invalid]="showErrors() && !hasValidReason()"
          [ngModel]="reason()"
          (ngModelChange)="reason.set($event)"
          placeholder="Ex. marchandise endommagée, erreur de commande" i18n-placeholder="@@sales-return-notes.pages.ex.marchandise.endommagee.erreur.de.commande.3bc77544" />
        @if (showErrors() && !hasValidReason()) {
          <p class="field-error" i18n="@@sales-return-notes.pages.indiquez.un.motif.d.au.moins.3.caracteres.f93a617f">Indiquez un motif d’au moins 3 caractères.</p>
        }
        <label i18n="@@sales-return-notes.pages.notes.70440046">Notes</label>
        <textarea class="form-control" rows="2" [ngModel]="notes()" (ngModelChange)="notes.set($event)"></textarea>
      </section>

      <section class="card">
        <h3 i18n="@@sales-return-notes.pages.quantites.a.retourner.5dc26617">Quantités à retourner</h3>
        @if (showErrors() && !hasPositiveQty()) {
          <p class="field-error" i18n="@@sales-return-notes.pages.saisissez.au.moins.une.quantite.a.retourner.d54e588e">Saisissez au moins une quantité à retourner.</p>
        }
        <table class="data-table">
          <thead>
            <tr>
              <th i18n="@@sales-return-notes.pages.article.4360c2dc">Article</th>
              <th class="text-right" i18n="@@sales-return-notes.pages.livre.0a1317e9">Livré</th>
              <th class="text-right" i18n="@@sales-return-notes.pages.deja.retourne.ac47573d">Déjà retourné</th>
              <th class="text-right" i18n="@@sales-return-notes.pages.restant.8df32592">Restant</th>
              <th class="text-right" i18n="@@sales-return-notes.pages.a.retourner.84c99781">À retourner</th>
            </tr>
          </thead>
          <tbody>
            @for (line of lines(); track line.deliveryNoteLineId) {
              <tr>
                <td>{{ line.designation }} <small class="muted">{{ line.productCode }}</small></td>
                <td class="text-right mono">{{ line.deliveredQuantity | number:'1.0-3' }}</td>
                <td class="text-right mono">{{ line.alreadyReturnedQuantity | number:'1.0-3' }}</td>
                <td class="text-right mono">{{ line.invoiceableQuantity | number:'1.0-3' }}</td>
                <td class="text-right">
                  <input class="qty" type="number" min="0" [max]="line.invoiceableQuantity" step="0.001"
                         [ngModel]="line.returnedQuantity"
                         (ngModelChange)="setQty(line, $event)" />
                </td>
              </tr>
            }
          </tbody>
        </table>
      </section>
    }
  `,
  styles: [`
    .help { margin: 0 0 1rem; color: var(--text-muted, #475569); }
    .card { background: var(--surface-card, #fff); border: 1px solid var(--surface-border, #e5e7eb); border-radius: 8px; padding: 1rem; margin-bottom: 1rem; }
    label { display: block; font-weight: 600; margin: 0.75rem 0 0.35rem; }
    .form-control, .qty { width: 100%; padding: 0.45rem 0.6rem; }
    .form-control.invalid { border-color: var(--color-danger-500, #dc2626); }
    .qty { max-width: 8rem; text-align: right; }
    .data-table { width: 100%; border-collapse: collapse; }
    .data-table th, .data-table td { padding: 0.5rem; border-bottom: 1px solid var(--surface-border, #e5e7eb); }
    .text-right { text-align: right; }
    .mono { font-variant-numeric: tabular-nums; }
    .muted { color: var(--text-muted, #64748b); }
    .field-error { margin: 0.35rem 0 0; color: var(--color-danger-600, #dc2626); font-size: 0.875rem; }
  `]
})
export class SalesReturnNoteFormComponent implements OnInit {
  private readonly service = inject(SalesReturnNoteService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);

  readonly breadcrumbItems: BreadcrumbItem[] = [
    { label: 'Tableau de bord', route: '/dashboard', icon: 'pi-home' },
    { label: 'Bons de retour', route: '/return-notes' },
    { label: 'Nouveau' }
  ];

  eligible = signal<EligibleDeliveryNoteDto[]>([]);
  selectedBlId = signal('');
  prefill = signal<SalesReturnNotePrefillDto | null>(null);
  lines = signal<EditableLine[]>([]);
  returnDate = signal(formatLocalDate(new Date()));
  reason = signal('');
  notes = signal('');
  saving = signal(false);
  showErrors = signal(false);

  canConfirm = computed(() => this.auth.hasPermission(PERMISSIONS.returnNotes.update));
  canSave = computed(() =>
    canSaveSalesReturnNote(this.reason(), this.lines().map(l => l.returnedQuantity)));

  ngOnInit(): void {
    const preselected = this.route.snapshot.queryParamMap.get('deliveryNoteId');
    this.service.getEligibleDeliveryNotes().subscribe({
      next: res => {
        this.eligible.set(res.data ?? []);
        if (preselected) {
          this.selectedBlId.set(preselected);
          this.loadPrefill(preselected);
        }
      }
    });
  }

  hasValidReason(): boolean {
    return this.reason().trim().length >= 3;
  }

  hasPositiveQty(): boolean {
    return this.lines().some(l => l.returnedQuantity > 0);
  }

  onBlSelected(id: string): void {
    this.selectedBlId.set(id);
    if (id) this.loadPrefill(id);
    else {
      this.prefill.set(null);
      this.lines.set([]);
    }
  }

  setQty(line: EditableLine, raw: number): void {
    line.returnedQuantity = clampReturnedQuantity(Number(raw), line.invoiceableQuantity);
    this.lines.set([...this.lines()]);
  }

  save(confirmAfterCreate: boolean): void {
    const p = this.prefill();
    if (!p) return;
    this.showErrors.set(true);
    if (!this.canSave()) {
      this.toast.add({
        severity: 'warn',
        summary: $localize`:@@sales-return-note-form.component.summary.Formulaire_incom:Formulaire incomplet`,
        detail: !this.hasValidReason()
          ? $localize`:@@ui.tern.indiquez.un.motif.d.au.moins.3.caracteres.f93a61:Indiquez un motif d’au moins 3 caractères.`
          : $localize`:@@ui.tern.saisissez.au.moins.une.quantite.a.retourne.d54e58:Saisissez au moins une quantité à retourner.`
      });
      return;
    }

    const selected = this.lines()
      .map(l => ({
        deliveryNoteLineId: l.deliveryNoteLineId,
        returnedQuantity: clampReturnedQuantity(l.returnedQuantity, l.invoiceableQuantity)
      }))
      .filter(l => l.returnedQuantity > 0);

    this.saving.set(true);
    this.service.create({
      deliveryNoteId: p.deliveryNoteId,
      returnDate: this.returnDate(),
      reason: this.reason().trim(),
      notes: this.notes() || undefined,
      lines: selected
    }).subscribe({
      next: res => {
        if (!res.success || !res.data) {
          this.saving.set(false);
          this.toast.add({
            severity: 'error',
            summary: $localize`:@@sales-return-note-form.component.summary.Enregistrement_i:Enregistrement impossible`,
            detail: res.message || 'Le brouillon n’a pas pu être créé.'
          });
          return;
        }
        const id = res.data;
        if (!confirmAfterCreate) {
          this.saving.set(false);
          this.toast.add({ severity: 'success', summary: $localize`:@@sales-return-note-form.component.summary.Brouillon_cr_:Brouillon créé`, detail: $localize`:@@sales-return-note-form.component.detail.Le_stock_n_est_p:Le stock n’est pas encore réintégré.` });
          this.router.navigate(['/return-notes', id]);
          return;
        }
        this.service.confirm(id).subscribe({
          next: confirmRes => {
            this.saving.set(false);
            if (confirmRes.success) {
              this.toast.add({
                severity: 'success',
                summary: $localize`:@@sales-return-note-form.component.summary.Confirm_:Confirmé`,
                detail: $localize`:@@sales-return-note-form.component.detail.Stock_r_int_gr_:Stock réintégré, quantité facturable du BL mise à jour.`
              });
            } else {
              this.toast.add({
                severity: 'warn',
                summary: $localize`:@@sales-return-note-form.component.summary.Brouillon_enregi:Brouillon enregistré, confirmation refusée`,
                detail: confirmRes.message || 'Ouvrez la fiche pour réessayer.'
              });
            }
            this.router.navigate(['/return-notes', id]);
          },
          error: err => {
            this.saving.set(false);
            this.toast.add({
              severity: 'warn',
              summary: $localize`:@@sales-return-note-form.component.summary.Brouillon_enregi:Brouillon enregistré, confirmation refusée`,
              detail: this.apiError(err)
            });
            this.router.navigate(['/return-notes', id]);
          }
        });
      },
      error: err => {
        this.saving.set(false);
        this.toast.add({
          severity: 'error',
          summary: $localize`:@@sales-return-note-form.component.summary.Enregistrement_i:Enregistrement impossible`,
          detail: this.apiError(err)
        });
      }
    });
  }

  private apiError(err: { error?: { message?: string } }): string {
    return err?.error?.message || 'Une erreur est survenue. Réessayez.';
  }

  private loadPrefill(deliveryNoteId: string): void {
    this.service.prefillFromDeliveryNote(deliveryNoteId).subscribe({
      next: res => {
        if (!res.success || !res.data) return;
        this.prefill.set(res.data);
        this.lines.set(res.data.lines.map(l => ({
          ...l,
          returnedQuantity: l.invoiceableQuantity
        })));
      },
      error: err => {
        this.toast.add({
          severity: 'error',
          summary: $localize`:@@sales-return-note-form.component.summary.BL_non_ligible:BL non éligible`,
          detail: this.apiError(err)
        });
      }
    });
  }
}
