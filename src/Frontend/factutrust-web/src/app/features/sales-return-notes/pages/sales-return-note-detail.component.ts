/// <reference types="@angular/localize" />
import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { StatusBadgeComponent } from '@shared/components/status-badge/status-badge.component';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { ToastService } from '@core/services/toast.service';
import { formatLocalDate } from '@core/utils/date.util';
import { SalesReturnNoteService } from '../services/sales-return-note.service';
import { SalesReturnNoteDetailDto, isSalesReturnNoteDraft } from '../models/sales-return-note.model';

@Component({
  selector: 'app-sales-return-note-detail',
  standalone: true,
  imports: [
    BackendLabelPipe,
    CommonModule,
    RouterModule,
    PageHeaderComponent,
    BreadcrumbComponent,
    ButtonComponent,
    StatusBadgeComponent
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems()"></app-breadcrumb>
    @if (note(); as n) {
      <app-page-header [title]="n.number" [subtitle]="loc_ui_tern_retour_du_cd06bd + formatDate(n.returnDate) + ' — ' + n.clientName">
        <app-status-badge [status]="isDraft(n.status) ? 'draft' : 'validated'" [label]="n.statusDisplay | backendLabel" />
        <app-button variant="secondary" icon="pi-print" (clicked)="printPdf()" i18n="@@sales-return-notes.pages.imprimer.5382c09d">Imprimer</app-button>
        @if (isDraft(n.status) && canUpdate()) {
          <app-button variant="primary" icon="pi-check" (clicked)="confirm()" i18n="@@sales-return-notes.pages.confirmer.80a664c8">Confirmer</app-button>
        }
        @if (isDraft(n.status) && canDelete()) {
          <app-button variant="danger" icon="pi-trash" (clicked)="remove()" i18n="@@sales-return-notes.pages.supprimer.1acfc1c7">Supprimer</app-button>
        }
      </app-page-header>

      <section class="card">
        <p><strong i18n="@@sales-return-notes.pages.motif.15bdb0c5">Motif :</strong> {{ n.reason }}</p>
        <p>
          <strong i18n="@@sales-return-notes.pages.bon.de.livraison.ab07643a">Bon de livraison :</strong>
          <a [routerLink]="['/delivery-notes', n.deliveryNoteId]">{{ n.deliveryNoteNumber }}</a>
        </p>
        @if (n.warehouseName) {
          <p><strong i18n="@@sales-return-notes.pages.depot.de.reintegration.bf64e9f3">Dépôt de réintégration :</strong> {{ n.warehouseName }}</p>
        }
        @if (n.notes) {
          <p><strong i18n="@@sales-return-notes.pages.notes.4ef03540">Notes :</strong> {{ n.notes }}</p>
        }
        <p class="help" i18n="@@sales-return-notes.pages.la.confirmation.reintegre.le.stock.au.meme.depot.5e46e82c">La confirmation réintègre le stock au même dépôt que le BL et diminue la quantité facturable. Ce document n’est pas un avoir.</p>
      </section>

      <table class="data-table">
        <thead>
          <tr>
            <th i18n="@@sales-return-notes.pages.text.d08f88df">#</th>
            <th i18n="@@sales-return-notes.pages.designation.63a9062c">Désignation</th>
            <th class="text-right" i18n="@@sales-return-notes.pages.qte.retournee.6a305fb7">Qté retournée</th>
            <th class="text-right" i18n="@@sales-return-notes.pages.pu.ht.79388cae">PU HT</th>
            <th class="text-right" i18n="@@sales-return-notes.pages.total.ht.2ca17ae6">Total HT</th>
            <th class="text-right" i18n="@@sales-return-notes.pages.total.ttc.9e80ff7c">Total TTC</th>
          </tr>
        </thead>
        <tbody>
          @for (line of n.lines; track line.id) {
            <tr>
              <td>{{ line.lineNumber }}</td>
              <td>{{ line.designation }} <small class="muted">{{ line.productCode }}</small></td>
              <td class="text-right mono">{{ line.returnedQuantity | number:'1.0-3' }} {{ line.unit }}</td>
              <td class="text-right mono">{{ line.unitPriceHT | number:'1.3-3' }}</td>
              <td class="text-right mono">{{ line.totalHT | number:'1.3-3' }}</td>
              <td class="text-right mono">{{ line.totalTTC | number:'1.3-3' }}</td>
            </tr>
          }
        </tbody>
      </table>
    } @else if (!loading()) {
      <p i18n="@@sales-return-notes.pages.bon.de.retour.introuvable.84602b69">Bon de retour introuvable.</p>
      <app-button routerLink="/return-notes" i18n="@@sales-return-notes.pages.retour.a.la.liste.7753f531">Retour à la liste</app-button>
    }
  `,
  styles: [`
    .card { background: var(--surface-card, #fff); border: 1px solid var(--surface-border, #e5e7eb); border-radius: 8px; padding: 1rem; margin-bottom: 1rem; }
    .help { color: var(--text-muted, #475569); }
    .data-table { width: 100%; border-collapse: collapse; }
    .data-table th, .data-table td { padding: 0.55rem 0.7rem; border-bottom: 1px solid var(--surface-border, #e5e7eb); }
    .text-right { text-align: right; }
    .mono { font-variant-numeric: tabular-nums; }
    .muted { color: var(--text-muted, #64748b); }
  `]
})
export class SalesReturnNoteDetailComponent implements OnInit {
  readonly loc_ui_tern_retour_du_cd06bd = $localize`:@@ui.tern.retour.du.cd06bd:Retour du `;
  private readonly service = inject(SalesReturnNoteService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  note = signal<SalesReturnNoteDetailDto | null>(null);
  loading = signal(true);
  readonly isDraft = isSalesReturnNoteDraft;
  canUpdate = computed(() => this.auth.hasPermission(PERMISSIONS.returnNotes.update));
  canDelete = computed(() => this.auth.hasPermission(PERMISSIONS.returnNotes.delete));

  breadcrumbItems = computed<BreadcrumbItem[]>(() => [
    { label: 'Tableau de bord', route: '/dashboard', icon: 'pi-home' },
    { label: 'Bons de retour', route: '/return-notes' },
    { label: this.note()?.number || 'Détail' }
  ]);

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.router.navigate(['/return-notes']);
      return;
    }
    this.load(id);
  }

  formatDate(value: string): string {
    return formatLocalDate(new Date(value));
  }

  confirm(): void {
    const n = this.note();
    if (!n) return;
    if (!confirm(`Confirmer le bon de retour ${n.number} ? Le stock sera réintégré.`)) return;
    this.service.confirm(n.id).subscribe({
      next: res => {
        if (res.success) {
          this.toast.add({ severity: 'success', summary: $localize`:@@sales-return-note-detail.component.summary.Confirm_:Confirmé`, detail: $localize`:@@sales-return-note-detail.component.detail.Stock_r_int_gr_:Stock réintégré, quantité facturable du BL mise à jour.` });
          this.load(n.id);
          return;
        }
        this.toast.add({
          severity: 'error',
          summary: $localize`:@@sales-return-note-detail.component.summary.Confirmation_imp:Confirmation impossible`,
          detail: res.message || 'Le bon de retour n’a pas pu être confirmé.'
        });
      },
      error: err => {
        this.toast.add({
          severity: 'error',
          summary: $localize`:@@sales-return-note-detail.component.summary.Confirmation_imp:Confirmation impossible`,
          detail: err?.error?.message || 'Une erreur est survenue. Réessayez.'
        });
      }
    });
  }

  remove(): void {
    const n = this.note();
    if (!n) return;
    if (!confirm(`Supprimer le brouillon ${n.number} ?`)) return;
    this.service.delete(n.id).subscribe({
      next: res => {
        if (res.success) {
          this.toast.add({ severity: 'success', summary: $localize`:@@sales-return-note-detail.component.summary.Supprimé:Supprimé`, detail: $localize`:@@sales-return-note-detail.component.detail.Brouillon_suppri:Brouillon supprimé.` });
          this.router.navigate(['/return-notes']);
          return;
        }
        this.toast.add({
          severity: 'error',
          summary: $localize`:@@sales-return-note-detail.component.summary.Suppression_impo:Suppression impossible`,
          detail: res.message || 'Le brouillon n’a pas pu être supprimé.'
        });
      },
      error: err => {
        this.toast.add({
          severity: 'error',
          summary: $localize`:@@sales-return-note-detail.component.summary.Suppression_impo:Suppression impossible`,
          detail: err?.error?.message || 'Une erreur est survenue. Réessayez.'
        });
      }
    });
  }

  printPdf(): void {
    const n = this.note();
    if (!n) return;
    this.service.downloadPdf(n.id).subscribe({
      next: blob => {
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
      },
      error: err => {
        this.toast.add({
          severity: 'error',
          summary: $localize`:@@sales-return-note-detail.component.summary.Impression_impos:Impression impossible`,
          detail: err?.error?.message || 'Le PDF n’a pas pu être généré.'
        });
      }
    });
  }

  private load(id: string): void {
    this.loading.set(true);
    this.service.getById(id).subscribe({
      next: res => {
        this.note.set(res.data ?? null);
        this.loading.set(false);
      },
      error: () => {
        this.note.set(null);
        this.loading.set(false);
      }
    });
  }
}
