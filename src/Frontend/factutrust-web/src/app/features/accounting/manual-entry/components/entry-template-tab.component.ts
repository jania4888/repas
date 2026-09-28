import { Component, EventEmitter, OnInit, Output, inject, signal, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AccountingService, JournalEntryTemplateDto } from '../../services/accounting.service';

@Component({
  selector: 'app-entry-template-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  template: `
    <section class="template-tab card">
      <div class="template-tab__search">
        <input type="search" class="me-input" placeholder="Rechercher un modèle…" i18n-placeholder="@@accounting.manual-entry.rechercher.un.modele.57af3d5f"
               [(ngModel)]="search" (ngModelChange)="load()" />
      </div>
      @if (loading()) {
        <p i18n="@@accounting.manual-entry.chargement.01cba1df">Chargement…</p>
      } @else if (templates().length === 0) {
        <p class="empty" i18n="@@accounting.manual-entry.aucun.modele.d.ecriture.disponible.33f3056c">Aucun modèle d'écriture disponible.</p>
      } @else {
        <table class="template-table">
          <thead>
            <tr>
              <th i18n="@@accounting.manual-entry.modele.9853170f">Modèle</th>
              <th i18n="@@accounting.manual-entry.description.55f8ebc8">Description</th>
              <th i18n="@@accounting.manual-entry.journal.conseille.0a43106d">Journal conseillé</th>
              <th i18n="@@accounting.manual-entry.action.97c89a4d">Action</th>
            </tr>
          </thead>
          <tbody>
            @for (t of templates(); track t.id) {
              <tr>
                <td><strong>{{ t.name }}</strong></td>
                <td>{{ t.description || '—' }}</td>
                <td>{{ t.journalCode }}</td>
                <td>
                  <button type="button" class="btn btn-sm btn-primary" (click)="apply.emit(t)" i18n="@@accounting.manual-entry.utiliser.fb5e43ce">Utiliser</button>
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
      <a routerLink="/accounting/entry-templates" class="template-tab__link" i18n="@@accounting.manual-entry.voir.tous.les.modeles.d9194c68">Voir tous les modèles →</a>
    </section>
  `,
  styles: `
    .template-tab { padding:var(--spacing-5); }
    .template-tab__search { margin-bottom:var(--spacing-4); max-width:24rem; }
    .me-input { width:100%; padding:var(--spacing-2) var(--spacing-3); border:1px solid var(--color-border-default); border-radius:var(--radius-md); }
    .template-table { width:100%; border-collapse:collapse; font-size:var(--font-size-sm); }
    .template-table th, .template-table td { padding:var(--spacing-2) var(--spacing-3); border-bottom:1px solid var(--color-border-subtle); text-align:start; }
    .template-tab__link { display:inline-block; margin-top:var(--spacing-4); font-size:var(--font-size-sm); color:var(--color-primary-600); }
    .empty { color:var(--color-text-secondary); }
  `
})
export class EntryTemplateTabComponent implements OnInit {
  private readonly api = inject(AccountingService);
  private readonly destroyRef = inject(DestroyRef);

  @Output() apply = new EventEmitter<JournalEntryTemplateDto>();

  readonly templates = signal<JournalEntryTemplateDto[]>([]);
  readonly loading = signal(true);
  search = '';

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.api.getJournalTemplates(true, this.search.trim() || undefined)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: res => {
          this.templates.set(res.success && res.data ? res.data : []);
          this.loading.set(false);
        },
        error: () => this.loading.set(false)
      });
  }
}
