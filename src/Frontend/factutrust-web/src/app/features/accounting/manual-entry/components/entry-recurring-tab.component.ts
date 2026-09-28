/// <reference types="@angular/localize" />
import { Component, OnInit, inject, signal, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AccountingService, JournalEntryTemplateDto } from '../../services/accounting.service';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';

@Component({
  selector: 'app-entry-recurring-tab',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <section class="recurring-tab card">
      @if (loading()) {
        <p i18n="@@accounting.manual-entry.chargement.01cba1df">Chargement…</p>
      } @else if (templates().length === 0) {
        <p class="empty" i18n="@@accounting.manual-entry.aucune.ecriture.recurrente.configuree.e0d67d31">Aucune écriture récurrente configurée.</p>
        <a routerLink="/accounting/entry-templates" class="link" i18n="@@accounting.manual-entry.configurer.des.modeles.recurrents.4f5d9724">Configurer des modèles récurrents →</a>
      } @else {
        <table class="recurring-table">
          <thead>
            <tr>
              <th i18n="@@accounting.manual-entry.modele.9853170f">Modèle</th>
              <th i18n="@@accounting.manual-entry.frequence.bafbfba7">Fréquence</th>
              <th i18n="@@accounting.manual-entry.prochaine.execution.7969ae74">Prochaine exécution</th>
              <th i18n="@@accounting.manual-entry.actions.c3cd636a">Actions</th>
            </tr>
          </thead>
          <tbody>
            @for (t of templates(); track t.id) {
              <tr>
                <td><strong>{{ t.name }}</strong></td>
                <td>{{ freqLabel(t.recurrenceFrequency) }}</td>
                <td>{{ t.nextRunDate ? (t.nextRunDate | date:'dd/MM/yyyy') : '—' }}</td>
                <td>
                  <button type="button" class="btn btn-sm btn-primary"
                          [disabled]="runningId() === t.id"
                          (click)="runNow(t)">
                    {{ runningId() === t.id ? loc_ui_tern_generation_ce4e34 : loc_ui_tern_generer_maintenant_3ad084 }}
                  </button>
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
      <a routerLink="/accounting/entry-templates" class="link" i18n="@@accounting.manual-entry.gerer.les.modeles.recurrents.36d0225c">Gérer les modèles récurrents →</a>
    </section>
  `,
  styles: `
    .recurring-tab { padding:var(--spacing-5); }
    .recurring-table { width:100%; border-collapse:collapse; font-size:var(--font-size-sm); margin-bottom:var(--spacing-4); }
    .recurring-table th, .recurring-table td { padding:var(--spacing-2) var(--spacing-3); border-bottom:1px solid var(--color-border-subtle); text-align:start; }
    .empty { color:var(--color-text-secondary); }
    .link { font-size:var(--font-size-sm); color:var(--color-primary-600); }
  `
})
export class EntryRecurringTabComponent implements OnInit {
  readonly loc_ui_tern_generation_ce4e34 = $localize`:@@ui.tern.generation.ce4e34:Génération…`;
  readonly loc_ui_tern_generer_maintenant_3ad084 = $localize`:@@ui.tern.generer.maintenant.3ad084:Générer maintenant`;
  private readonly errors = inject(ErrorHandlerService);
  private readonly api = inject(AccountingService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly templates = signal<JournalEntryTemplateDto[]>([]);
  readonly loading = signal(true);
  readonly runningId = signal<string | null>(null);

  ngOnInit(): void {
    this.api.getJournalTemplates(true)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: res => {
          const all = res.success && res.data ? res.data : [];
          this.templates.set(all.filter(t => t.isRecurring));
          this.loading.set(false);
        },
        error: () => this.loading.set(false)
      });
  }

  freqLabel(f: number): string {
    switch (f) {
      case 1: return $localize`:@@accounting.entry-recurring-tab.ts.mensuelle.15af1be3:Mensuelle`;
      case 2: return $localize`:@@accounting.entry-recurring-tab.ts.trimestrielle.9379d384:Trimestrielle`;
      case 3: return $localize`:@@accounting.entry-recurring-tab.ts.annuelle.0e25612c:Annuelle`;
      default: return '—';
    }
  }

  runNow(t: JournalEntryTemplateDto): void {
    this.runningId.set(t.id);
    this.api.runTemplateRecurrence(t.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: res => {
          this.runningId.set(null);
          if (res.success) {
            this.toast.add({ severity: 'success', summary: $localize`:@@entry-recurring-tab.component.summary._criture_g_n_r_e:Écriture générée`, detail: $localize`:@@accounting.entry-recurring-tab.ts.le.modele.name.a.ete.execute.82ce2b4a:Le modèle « ${t.name}:name: » a été exécuté.`, life: 5000 });
          } else {
            this.toast.add({ severity: 'error', summary: $localize`:@@entry-recurring-tab.component.summary.Échec:Échec`, detail: res.error ?? $localize`:@@ui.tern.erreur.ab546c:Erreur`, life: 6000 });
          }
        },
        error: err => {
          this.runningId.set(null);
          this.toast.add({ severity: 'error', summary: $localize`:@@entry-recurring-tab.component.summary.Impossible_de_g_:Impossible de générer l'écriture.`, detail: this.errors.extractErrorMessage(err, $localize`:@@accounting.entry-recurring-tab.ts.erreur.reseau.0683007f:Erreur réseau`), life: 6000 });
        }
      });
  }
}
