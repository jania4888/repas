/// <reference types="@angular/localize" />
import { Component, DestroyRef, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AccountingService, JournalEntryTemplateDto } from '../../services/accounting.service';
import { ToastService } from '@core/services/toast.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';

@Component({
  selector: 'app-template-picker-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    @if (visible()) {
      <div class="tpm-backdrop" (click)="onBackdropClick($event)" role="presentation">
        <div class="tpm-modal" role="dialog" aria-modal="true" aria-labelledby="tpm-title" (click)="$event.stopPropagation()">
          <header class="tpm-header">
            <h2 id="tpm-title" class="tpm-title" i18n="@@accounting.manual-entry.charger.un.modele.d.ecriture.f370a44a">Charger un modèle d'écriture</h2>
            <button type="button" class="tpm-close" (click)="onClose()" aria-label="Fermer la modale" i18n-aria-label="@@accounting.manual-entry.fermer.la.modale.7e5fc47f" i18n="@@accounting.manual-entry.text.0951b9a0">✕</button>
          </header>

          <div class="tpm-search">
            <input type="search"
                   class="tpm-input"
                   placeholder="Rechercher par nom, description ou code journal…" i18n-placeholder="@@accounting.manual-entry.rechercher.par.nom.description.ou.code.journal.bdefd4e3"
                   [ngModel]="search()"
                   (ngModelChange)="search.set($event)"
                   aria-label="Recherche dans les modèles" i18n-aria-label="@@accounting.manual-entry.recherche.dans.les.modeles.2f715207" />
          </div>

          <div class="tpm-body">
            @if (loading()) {
              <p class="tpm-state" role="status" i18n="@@accounting.manual-entry.chargement.des.modeles.6f00e426">Chargement des modèles…</p>
            } @else if (error()) {
              <p class="tpm-state tpm-state-error" role="alert">{{ error() }}</p>
            } @else if (filtered().length === 0) {
              <p class="tpm-state" i18n="@@accounting.manual-entry.aucun.modele.ne.correspond.a.votre.recherche.9a10fd92">Aucun modèle ne correspond à votre recherche.</p>
            } @else {
              <ul class="tpm-list" role="listbox" aria-label="Liste des modèles" i18n-aria-label="@@accounting.manual-entry.liste.des.modeles.855969f9">
                @for (t of filtered(); track t.id) {
                  <li class="tpm-item"
                      [class.tpm-item-selected]="selected()?.id === t.id"
                      role="option"
                      [attr.aria-selected]="selected()?.id === t.id"
                      tabindex="0"
                      (click)="selected.set(t)"
                      (keydown.enter)="selected.set(t)"
                      (keydown.space)="selected.set(t); $event.preventDefault()">
                    <div class="tpm-item-main">
                      <strong class="tpm-item-name">{{ t.name }}</strong>
                      <span class="tpm-item-journal">{{ t.journalCode }}</span>
                    </div>
                    @if (t.description) {
                      <span class="tpm-item-desc">{{ t.description }}</span>
                    }
                    <span class="tpm-item-meta">{{ t.lines.length }} ligne{{ t.lines.length > 1 ? 's' : '' }} · utilisé {{ t.usageCount }} fois</span>
                  </li>
                }
              </ul>
            }
          </div>

          @if (selected(); as sel) {
            <div class="tpm-preview" aria-label="Aperçu du modèle sélectionné" i18n-aria-label="@@accounting.manual-entry.apercu.du.modele.selectionne.6503af4e">
              <h3 class="tpm-preview-title">Aperçu : {{ sel.name }}</h3>
              @if (sel.labelTemplate) {
                <p class="tpm-preview-label"><em i18n="@@accounting.manual-entry.libelle.par.defaut.2bc34c67">Libellé par défaut :</em> {{ sel.labelTemplate }}</p>
              }
              <table class="tpm-preview-table">
                <thead>
                  <tr>
                    <th i18n="@@accounting.manual-entry.text.d08f88df">#</th>
                    <th i18n="@@accounting.manual-entry.compte.c45740bb">Compte</th>
                    <th i18n="@@accounting.manual-entry.libelle.f5485bba">Libellé</th>
                    <th class="text-right" i18n="@@accounting.manual-entry.debit.f528224f">Débit</th>
                    <th class="text-right" i18n="@@accounting.manual-entry.credit.19194bdf">Crédit</th>
                  </tr>
                </thead>
                <tbody>
                  @for (l of sel.lines; track l.id) {
                    <tr>
                      <td>{{ l.lineNumber }}</td>
                      <td class="tpm-mono">{{ l.accountNumber }}</td>
                      <td>{{ l.lineLabelTemplate || '—' }}</td>
                      <td class="text-right tpm-mono">{{ l.fixedDebit != null ? (l.fixedDebit | number : '1.3-3') : '—' }}</td>
                      <td class="text-right tpm-mono">{{ l.fixedCredit != null ? (l.fixedCredit | number : '1.3-3') : '—' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }

          <footer class="tpm-footer">
            <div class="tpm-footer-left">
              @if (selected()) {
                <button type="button"
                        class="btn btn-outline-danger btn-sm"
                        (click)="onDelete()"
                        [disabled]="deleting()">
                  {{ deleting() ? loc_ui_tern_suppression_a620db : loc_ui_tern_supprimer_ce_modele_6a6201 }}
                </button>
              }
            </div>
            <div class="tpm-footer-right">
              <button type="button" class="btn btn-outline-secondary" (click)="onClose()" i18n="@@accounting.manual-entry.annuler.49ba3292">Annuler</button>
              <button type="button"
                      class="btn btn-primary"
                      (click)="onApply()"
                      [disabled]="!selected()" i18n="@@accounting.manual-entry.charger.ce.modele.ef52dc55"> Charger ce modèle </button>
            </div>
          </footer>
        </div>
      </div>
    }
  `,
  styles: `
    .tpm-backdrop { position:fixed; inset:0; background:rgba(15,23,42,0.55); display:flex; align-items:center; justify-content:center; z-index:1000; padding:var(--spacing-4); }
    .tpm-modal { background:var(--color-background-elevated,#fff); border-radius:var(--radius-lg); box-shadow:var(--shadow-xl,0 20px 25px -5px rgba(0,0,0,0.1)); width:100%; max-width:42rem; max-height:90vh; display:flex; flex-direction:column; overflow:hidden; }
    .tpm-header { display:flex; align-items:center; justify-content:space-between; padding:var(--spacing-4); border-bottom:1px solid var(--color-border-subtle); }
    .tpm-title { font-size:var(--font-size-lg,1.125rem); font-weight:var(--font-weight-semibold); margin:0; }
    .tpm-close { background:none; border:none; font-size:1.25rem; cursor:pointer; padding:var(--spacing-1) var(--spacing-2); border-radius:var(--radius-sm); color:var(--color-text-secondary); }
    .tpm-close:hover { background:var(--color-background-subtle); }
    .tpm-search { padding:var(--spacing-3) var(--spacing-4); border-bottom:1px solid var(--color-border-subtle); }
    .tpm-input { width:100%; padding:var(--spacing-2) var(--spacing-3); border:1px solid var(--color-border-default); border-radius:var(--radius-md); font-size:var(--font-size-sm); }
    .tpm-body { flex:1; overflow-y:auto; min-height:8rem; max-height:18rem; }
    .tpm-state { padding:var(--spacing-4); text-align:center; color:var(--color-text-secondary); }
    .tpm-state-error { color:var(--color-error-700,#b91c1c); }
    .tpm-list { list-style:none; margin:0; padding:0; }
    .tpm-item { padding:var(--spacing-3) var(--spacing-4); border-bottom:1px solid var(--color-border-subtle); cursor:pointer; display:flex; flex-direction:column; gap:var(--spacing-1); }
    .tpm-item:hover { background:var(--color-background-subtle,#f1f5f9); }
    .tpm-item-selected { background:var(--color-primary-50,#eff6ff); border-left:3px solid var(--color-primary-500,#3b82f6); }
    .tpm-item-main { display:flex; justify-content:space-between; align-items:center; gap:var(--spacing-3); }
    .tpm-item-name { font-size:var(--font-size-md); }
    .tpm-item-journal { font-family:monospace; background:var(--color-background-subtle); padding:0.125rem var(--spacing-2); border-radius:var(--radius-sm); font-size:var(--font-size-xs); font-weight:var(--font-weight-semibold); }
    .tpm-item-desc { color:var(--color-text-secondary); font-size:var(--font-size-sm); }
    .tpm-item-meta { color:var(--color-text-tertiary); font-size:var(--font-size-xs); }
    .tpm-preview { padding:var(--spacing-3) var(--spacing-4); border-top:1px solid var(--color-border-subtle); background:var(--color-background-subtle,#f8fafc); max-height:14rem; overflow-y:auto; }
    .tpm-preview-title { font-size:var(--font-size-sm); font-weight:var(--font-weight-semibold); margin:0 0 var(--spacing-2); }
    .tpm-preview-label { font-size:var(--font-size-sm); margin:0 0 var(--spacing-2); color:var(--color-text-secondary); }
    .tpm-preview-table { width:100%; font-size:var(--font-size-xs); border-collapse:collapse; }
    .tpm-preview-table th, .tpm-preview-table td { padding:var(--spacing-1) var(--spacing-2); border-bottom:1px solid var(--color-border-subtle); }
    .tpm-mono { font-family:monospace; font-variant-numeric:tabular-nums; }
    .text-right { text-align:right; }
    .tpm-footer { display:flex; justify-content:space-between; align-items:center; gap:var(--spacing-3); padding:var(--spacing-4); border-top:1px solid var(--color-border-subtle); }
    .tpm-footer-right { display:flex; gap:var(--spacing-2); }
  `
})
export class TemplatePickerModalComponent implements OnInit {
  readonly loc_ui_tern_suppression_a620db = $localize`:@@ui.tern.suppression.a620db:Suppression…`;
  readonly loc_ui_tern_supprimer_ce_modele_6a6201 = $localize`:@@ui.tern.supprimer.ce.modele.6a6201:🗑 Supprimer ce modèle`;
  private readonly errors = inject(ErrorHandlerService);
  private readonly api = inject(AccountingService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly confirmationService = inject(ConfirmationService);

  readonly visible = input<boolean>(false);
  readonly close = output<void>();
  readonly templateSelected = output<JournalEntryTemplateDto>();

  readonly templates = signal<JournalEntryTemplateDto[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly deleting = signal(false);
  readonly search = signal('');
  readonly selected = signal<JournalEntryTemplateDto | null>(null);

  readonly filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    if (!q) return this.templates();
    return this.templates().filter(t =>
      t.name.toLowerCase().includes(q) ||
      (t.description ?? '').toLowerCase().includes(q) ||
      t.journalCode.toLowerCase().includes(q)
    );
  });

  ngOnInit(): void {
    this.loadTemplates();
  }

  private loadTemplates(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.getJournalTemplates(true)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: res => {
          this.loading.set(false);
          if (res.success && res.data) {
            this.templates.set(res.data);
          } else {
            this.error.set(res.error ?? $localize`:@@ui.tern.erreur.lors.du.chargement.des.modeles.d6d566:Erreur lors du chargement des modèles.`);
          }
        },
        error: err => {
          this.loading.set(false);
          this.error.set(this.errors.extractErrorMessage(err, 'Erreur réseau lors du chargement des modèles.'));
        }
      });
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.onClose();
    }
  }

  onClose(): void {
    this.selected.set(null);
    this.search.set('');
    this.close.emit();
  }

  onApply(): void {
    const sel = this.selected();
    if (!sel) return;
    this.templateSelected.emit(sel);
    this.onClose();
  }

  onDelete(): void {
    const sel = this.selected();
    if (!sel) return;
    this.confirmationService.confirm({
      message: `Voulez-vous vraiment supprimer le modèle « ${sel.name} » ? Cette action est irréversible.`,
      header: 'Confirmation de suppression',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: $localize`:@@template-picker-modal.component.acceptLabel.Supprimer:Supprimer`,
      rejectLabel: $localize`:@@template-picker-modal.component.rejectLabel.Annuler:Annuler`,
      acceptButtonStyleClass: 'btn-danger',
      accept: () => {
        this.deleting.set(true);
        this.api.deleteJournalTemplate(sel.id)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: res => {
              this.deleting.set(false);
              if (res.success) {
                this.toast.add({
                  severity: 'success',
                  summary: $localize`:@@template-picker-modal.component.summary.Modèle suppr:Modèle supprimé`,
                  detail: `Le modèle « ${sel.name} » a été supprimé.`,
                  life: 4000
                });
                this.templates.update(list => list.filter(t => t.id !== sel.id));
                this.selected.set(null);
              } else {
                this.toast.add({
                  severity: 'error',
                  summary: $localize`:@@template-picker-modal.component.summary._chec_de_la_supp:Échec de la suppression`,
                  detail: res.error ?? $localize`:@@ui.tern.erreur.lors.de.la.suppression.54158e:Erreur lors de la suppression.`,
                  life: 6000
                });
              }
            },
            error: err => {
              this.deleting.set(false);
              this.toast.add({
                severity: 'error',
                summary: $localize`:@@template-picker-modal.component.summary.Impossible d:Impossible de supprimer le modèle.`,
                detail: this.errors.extractErrorMessage(err, 'Erreur réseau'),
                life: 6000
              });
            }
          });
      }
    });
  }
}
