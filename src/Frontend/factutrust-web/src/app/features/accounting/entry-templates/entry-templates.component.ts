/// <reference types="@angular/localize" />
import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import { AccountingTableActionsComponent } from '../shared/accounting-table-actions.component';
import { AccountingAmountInputComponent } from '../shared/accounting-amount-input.component';
import { ToastService } from '@core/services/toast.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import {
  AccountingService,
  JournalEntryTemplateDto,
  JournalEntryTemplateLineRequest
} from '../services/accounting.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';

interface TemplateForm {
  id: string | null;
  name: string;
  description: string;
  journalCode: string;
  labelTemplate: string;
  isActive: boolean;
  /** 0 = aucune, 1 = mensuelle, 2 = trimestrielle, 3 = annuelle. */
  recurrenceFrequency: number;
  recurrenceDayOfMonth: number | null;
  recurrenceStartDate: string;
  recurrenceEndDate: string;
  lines: JournalEntryTemplateLineRequest[];
}

const JOURNAL_CODES = ['JV', 'JA', 'JC', 'JB', 'JOD', 'JIM', 'JAN'];

@Component({
  selector: 'app-entry-templates',
  standalone: true,
  imports: [CommonModule, FormsModule, TableModule, PageHeaderComponent, ButtonComponent, AccountingStatusBannerComponent, AccountingTableActionsComponent, AccountingAmountInputComponent],
  template: `
    <app-page-header title="Modèles d'écriture" i18n-title="@@accounting.entry-templates.modeles.d.ecriture.a2fb584f" subtitle="Modèles réutilisables pour la saisie manuelle" i18n-subtitle="@@accounting.entry-templates.modeles.reutilisables.pour.la.saisie.man.c128df52" />

    <app-accounting-status-banner variant="error" [message]="error() ?? ''" />

    <div class="card tpl-toolbar-card">
      <app-button variant="primary" icon="pi pi-plus" type="button" (click)="startCreate()" [disabled]="loading()" i18n="@@accounting.entry-templates.nouveau.modele.c5b99d5d"> Nouveau modèle </app-button>
    </div>

    @if (form(); as f) {
      <div class="card tpl-form-card">
        <h3 class="tpl-form-title">{{ f.id ? loc_ui_tern_modifier_le_modele_840a7c : loc_ui_tern_nouveau_modele_c5b99d }}</h3>
        <div class="tpl-fields">
          <div class="tpl-field tpl-field-grow">
            <label class="field-label" for="tpl-name" i18n="@@accounting.entry-templates.nom.7ff20370">Nom</label>
            <input id="tpl-name" class="tpl-input" [(ngModel)]="f.name" [disabled]="saving()" />
          </div>
          <div class="tpl-field">
            <label class="field-label" for="tpl-journal" i18n="@@accounting.entry-templates.journal.57d7f743">Journal</label>
            <select id="tpl-journal" class="tpl-input" [(ngModel)]="f.journalCode" [disabled]="saving()">
              @for (jc of journalCodes; track jc) { <option [value]="jc">{{ jc }}</option> }
            </select>
          </div>
          <div class="tpl-field tpl-field-grow">
            <label class="field-label" for="tpl-label" i18n="@@accounting.entry-templates.libelle.type.1ef6afdb">Libellé type</label>
            <input id="tpl-label" class="tpl-input" [(ngModel)]="f.labelTemplate" [disabled]="saving()" placeholder="Ex. Écriture de {{'{'}}mois{{'}'}}" />
          </div>
        </div>
        <div class="tpl-field">
          <label class="field-label" for="tpl-desc" i18n="@@accounting.entry-templates.description.55f8ebc8">Description</label>
          <input id="tpl-desc" class="tpl-input" [(ngModel)]="f.description" [disabled]="saving()" />
        </div>

        <h4 class="tpl-lines-title" i18n="@@accounting.entry-templates.recurrence.planifiee.8c97c8f6">Récurrence planifiée</h4>
        <p class="tpl-recurrence-hint" i18n="@@accounting.entry-templates.genere.automatiquement.l.ecriture.a.chaque.echea.ed4e553f"> Génère automatiquement l'écriture à chaque échéance (loyers, assurances…). Toutes les lignes
          doivent porter un montant fixe et être équilibrées. </p>
        <div class="tpl-fields">
          <div class="tpl-field">
            <label class="field-label" for="tpl-rec-freq" i18n="@@accounting.entry-templates.frequence.bafbfba7">Fréquence</label>
            <select id="tpl-rec-freq" class="tpl-input" [(ngModel)]="f.recurrenceFrequency" [disabled]="saving()">
              <option [ngValue]="0" i18n="@@accounting.entry-templates.aucune.e8f88273">Aucune</option>
              <option [ngValue]="1" i18n="@@accounting.entry-templates.mensuelle.15af1be3">Mensuelle</option>
              <option [ngValue]="2" i18n="@@accounting.entry-templates.trimestrielle.9379d384">Trimestrielle</option>
              <option [ngValue]="3" i18n="@@accounting.entry-templates.annuelle.0e25612c">Annuelle</option>
            </select>
          </div>
          @if (f.recurrenceFrequency > 0) {
            <div class="tpl-field">
              <label class="field-label" for="tpl-rec-day" i18n="@@accounting.entry-templates.jour.du.mois.1.28.19f45a35">Jour du mois (1–28)</label>
              <input id="tpl-rec-day" type="number" min="1" max="28" class="tpl-input" [(ngModel)]="f.recurrenceDayOfMonth" [disabled]="saving()" />
            </div>
            <div class="tpl-field">
              <label class="field-label" for="tpl-rec-start" i18n="@@accounting.entry-templates.debut.f0955314">Début</label>
              <input id="tpl-rec-start" type="date" class="tpl-input" [(ngModel)]="f.recurrenceStartDate" [disabled]="saving()" />
            </div>
            <div class="tpl-field">
              <label class="field-label" for="tpl-rec-end"><ng-container i18n="@@accounting.entry-templates.fin.4251065f">Fin </ng-container> <span class="tpl-optional" i18n="@@accounting.entry-templates.facultatif.6d7d6db4">(facultatif)</span></label>
              <input id="tpl-rec-end" type="date" class="tpl-input" [(ngModel)]="f.recurrenceEndDate" [disabled]="saving()" />
            </div>
          }
        </div>

        <h4 class="tpl-lines-title" i18n="@@accounting.entry-templates.lignes.41c7025e">Lignes</h4>
        <table class="tpl-lines">
          <thead>
            <tr>
              <th scope="col" i18n="@@accounting.entry-templates.compte.c45740bb">Compte</th>
              <th scope="col" i18n="@@accounting.entry-templates.libelle.ligne.1f1cffb3">Libellé ligne</th>
              <th scope="col" class="tpl-col-amount" i18n="@@accounting.entry-templates.debit.fixe.e62f54f3">Débit fixe</th>
              <th scope="col" class="tpl-col-amount" i18n="@@accounting.entry-templates.credit.fixe.5eccc2d2">Crédit fixe</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            @for (line of f.lines; track $index) {
              <tr>
                <td><input class="tpl-input" [(ngModel)]="line.accountNumber" [disabled]="saving()" /></td>
                <td><input class="tpl-input" [(ngModel)]="line.lineLabelTemplate" [disabled]="saving()" /></td>
                <td>
                  <app-accounting-amount-input
                    [(ngModel)]="line.fixedDebit"
                    [disabled]="saving()"
                    [compact]="true"
                    side="debit"
                    [inputId]="'tpl-debit-' + $index"
                    ariaLabel="Débit fixe" i18n-ariaLabel="@@accounting.entry-templates.debit.fixe.aedfb877" />
                </td>
                <td>
                  <app-accounting-amount-input
                    [(ngModel)]="line.fixedCredit"
                    [disabled]="saving()"
                    [compact]="true"
                    side="credit"
                    [inputId]="'tpl-credit-' + $index"
                    ariaLabel="Crédit fixe" i18n-ariaLabel="@@accounting.entry-templates.credit.fixe.4e494a32" />
                </td>
                <td>
                  <app-button variant="ghost" size="sm" icon="pi-trash" [iconOnly]="true" [iconAlwaysVisible]="true"
                    type="button" (click)="removeLine($index)" [disabled]="saving()" ariaLabel="Supprimer la ligne" i18n-ariaLabel="@@accounting.entry-templates.supprimer.la.ligne.7e5f9ae0" />
                </td>
              </tr>
            }
          </tbody>
        </table>
        <button type="button" class="tpl-add-line" (click)="addLine()" [disabled]="saving()" i18n="@@accounting.entry-templates.ajouter.une.ligne.4ab97b5b"><i class="pi pi-plus"></i> Ajouter une ligne</button>

        <div class="tpl-form-actions">
          <button type="button" class="btn btn-secondary" (click)="cancel()" [disabled]="saving()" i18n="@@accounting.entry-templates.annuler.49ba3292">Annuler</button>
          <button type="button" class="btn btn-primary" (click)="save()" [disabled]="saving() || !f.name.trim() || f.lines.length < 2">
            {{ saving() ? loc_ui_tern_enregistrement_e7d5f2 : loc_ui_tern_enregistrer_f7c8bc }}
          </button>
        </div>
      </div>
    }

    <div class="card tpl-list-card">
      <p-table [value]="templates()" [loading]="loading()" styleClass="p-datatable-sm accounting-datatable" [rowHover]="true">
        <ng-template pTemplate="header">
          <tr>
            <th scope="col" i18n="@@accounting.entry-templates.nom.7ff20370">Nom</th>
            <th scope="col" i18n="@@accounting.entry-templates.journal.57d7f743">Journal</th>
            <th scope="col" i18n="@@accounting.entry-templates.lignes.41c7025e">Lignes</th>
            <th scope="col" i18n="@@accounting.entry-templates.recurrence.a1e1903a">Récurrence</th>
            <th scope="col" i18n="@@accounting.entry-templates.utilisations.67a8be8f">Utilisations</th>
            <th scope="col" i18n="@@accounting.entry-templates.actif.2eb75f84">Actif</th>
            <th scope="col" i18n="@@accounting.entry-templates.actions.c3cd636a">Actions</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-t>
          <tr>
            <td>{{ t.name }}</td>
            <td>{{ t.journalCode }}</td>
            <td>{{ t.lines.length }}</td>
            <td>
              @if (t.isRecurring) {
                <span class="tpl-rec-badge" [title]="loc_ui_tern_prochaine_echeance_570437 + (t.nextRunDate ? (t.nextRunDate | date : 'shortDate') : loc_ui_tern_epuisee_5d2b17)">
                  {{ frequencyLabel(t.recurrenceFrequency) }}
                  @if (t.nextRunDate) { · {{ t.nextRunDate | date : 'shortDate' }} }
                </span>
              } @else {
                <span class="tpl-rec-none" i18n="@@accounting.entry-templates.text.1b93795b">—</span>
              }
            </td>
            <td>{{ t.usageCount }}</td>
            <td>{{ t.isActive ? loc_ui_tern_oui_eaa02f : loc_ui_tern_non_a72199 }}</td>
            <td>
              <app-accounting-table-actions>
              @if (t.isRecurring && t.nextRunDate && t.isActive) {
                <app-button
                  variant="ghost"
                  size="sm"
                  icon="pi-bolt"
                  [iconOnly]="true"
                  [iconAlwaysVisible]="true"
                  type="button"
                  (click)="runNow(t)"
                  [disabled]="runningId() === t.id"
                  ariaLabel="Générer l'écriture maintenant" i18n-ariaLabel="@@accounting.entry-templates.generer.l.ecriture.maintenant.5a587eab"
                  title="Générer l'écriture de la prochaine échéance maintenant" i18n-title="@@accounting.entry-templates.generer.l.ecriture.de.la.prochaine.echeance.main.1334a720" />
              }
              <app-button variant="ghost" size="sm" icon="pi-pencil" [iconOnly]="true" [iconAlwaysVisible]="true"
                type="button" (click)="startEdit(t)" ariaLabel="Modifier" i18n-ariaLabel="@@accounting.entry-templates.modifier.ead890f7" />
              <app-button variant="ghost" size="sm" icon="pi-trash" [iconOnly]="true" [iconAlwaysVisible]="true"
                type="button" (click)="remove(t)" ariaLabel="Supprimer" i18n-ariaLabel="@@accounting.entry-templates.supprimer.d9f6d96e" />
              </app-accounting-table-actions>
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr><td colspan="7" class="tpl-empty" i18n="@@accounting.entry-templates.aucun.modele.creez.en.un.avec.nouveau.modele.3a0ab35e">Aucun modèle. Créez-en un avec « Nouveau modèle ».</td></tr>
        </ng-template>
      </p-table>
    </div>
  `,
  styles: `
    .tpl-toolbar-card, .tpl-form-card, .tpl-list-card { padding: var(--spacing-4); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); margin-bottom: var(--spacing-4); }
    .tpl-form-title { margin: 0 0 var(--spacing-3); font-size: var(--font-size-md); font-weight: var(--font-weight-semibold); }
    .tpl-lines-title { margin: var(--spacing-4) 0 var(--spacing-2); font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); }
    .tpl-fields { display: flex; flex-wrap: wrap; gap: var(--spacing-3); margin-bottom: var(--spacing-3); }
    .tpl-field { display: flex; flex-direction: column; gap: var(--spacing-1); min-width: 8rem; }
    .tpl-field-grow { flex: 1 1 14rem; }
    .field-label { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); }
    .tpl-input { padding: var(--spacing-2) var(--spacing-3); border: 1px solid var(--color-border-default); border-radius: var(--radius-md); background: var(--color-background-elevated); color: var(--color-text-primary); font-size: var(--font-size-sm); width: 100%; }
    .tpl-lines { width: 100%; border-collapse: collapse; }
    .tpl-lines th { text-align: left; font-size: var(--font-size-xs); text-transform: uppercase; color: var(--color-text-tertiary); padding: var(--spacing-1) var(--spacing-2); }
    .tpl-lines td { padding: 2px var(--spacing-2); }
    .tpl-col-amount, .tpl-amount { text-align: right; }
    .tpl-add-line { margin-top: var(--spacing-2); background: none; border: 1px dashed var(--color-border-default); border-radius: var(--radius-md); padding: var(--spacing-2) var(--spacing-3); color: var(--color-text-secondary); cursor: pointer; font-size: var(--font-size-sm); }
    .tpl-form-actions { display: flex; justify-content: flex-end; gap: var(--spacing-3); margin-top: var(--spacing-4); padding-top: var(--spacing-3); border-top: 1px solid var(--color-border-subtle); }
    .tpl-recurrence-hint { margin: 0 0 var(--spacing-2); font-size: var(--font-size-xs); color: var(--color-text-tertiary); }
    .tpl-optional { font-weight: var(--font-weight-normal); font-size: var(--font-size-xs); color: var(--color-text-tertiary); }
    .tpl-rec-badge {
      display: inline-block; padding: 0.15rem 0.5rem;
      border: 1px solid var(--color-primary-200, #bfdbfe); border-radius: var(--radius-pill, 999px);
      background: var(--color-primary-50, #eff6ff); color: var(--color-primary-700, #1d4ed8);
      font-size: var(--font-size-xs); font-weight: var(--font-weight-semibold); white-space: nowrap;
    }
    .tpl-rec-none { color: var(--color-text-tertiary); }
    .tpl-empty { text-align: center; padding: var(--spacing-6); color: var(--color-text-tertiary); }
  `
})
export class EntryTemplatesComponent implements OnInit {
  readonly loc_ui_tern_modifier_le_modele_840a7c = $localize`:@@ui.tern.modifier.le.modele.840a7c:Modifier le modèle`;
  readonly loc_ui_tern_nouveau_modele_c5b99d = $localize`:@@ui.tern.nouveau.modele.c5b99d:Nouveau modèle`;
  readonly loc_ui_tern_enregistrement_e7d5f2 = $localize`:@@ui.tern.enregistrement.e7d5f2:Enregistrement…`;
  readonly loc_ui_tern_enregistrer_f7c8bc = $localize`:@@ui.tern.enregistrer.f7c8bc:Enregistrer`;
  readonly loc_ui_tern_prochaine_echeance_570437 = $localize`:@@ui.tern.prochaine.echeance.570437:Prochaine échéance : `;
  readonly loc_ui_tern_epuisee_5d2b17 = $localize`:@@ui.tern.epuisee.5d2b17:épuisée`;
  readonly loc_ui_tern_oui_eaa02f = $localize`:@@ui.tern.oui.eaa02f:Oui`;
  readonly loc_ui_tern_non_a72199 = $localize`:@@ui.tern.non.a72199:Non`;
  private readonly errors = inject(ErrorHandlerService);
  private readonly api = inject(AccountingService);
  private readonly toast = inject(ToastService);
  private readonly confirmationService = inject(ConfirmationService);
  readonly journalCodes = JOURNAL_CODES;

  readonly templates = signal<JournalEntryTemplateDto[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly form = signal<TemplateForm | null>(null);
  /** Id du modèle en cours de génération immédiate. */
  readonly runningId = signal<string | null>(null);

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.getJournalTemplates(false).subscribe({
      next: res => {
        this.loading.set(false);
        if (res.success && res.data) this.templates.set(res.data);
        else this.error.set(res.error ?? $localize`:@@ui.tern.erreur.ab546c:Erreur`);
      },
      error: err => { this.loading.set(false); this.error.set(this.errors.extractErrorMessage(err, 'Erreur réseau')); }
    });
  }

  startCreate(): void {
    this.form.set({
      id: null, name: '', description: '', journalCode: 'JOD', labelTemplate: '', isActive: true,
      recurrenceFrequency: 0, recurrenceDayOfMonth: 1, recurrenceStartDate: '', recurrenceEndDate: '',
      lines: [
        { lineNumber: 1, accountNumber: '', lineLabelTemplate: '', fixedDebit: null, fixedCredit: null },
        { lineNumber: 2, accountNumber: '', lineLabelTemplate: '', fixedDebit: null, fixedCredit: null }
      ]
    });
  }

  startEdit(t: JournalEntryTemplateDto): void {
    this.form.set({
      id: t.id, name: t.name, description: t.description ?? '', journalCode: t.journalCode,
      labelTemplate: t.labelTemplate ?? '', isActive: t.isActive,
      recurrenceFrequency: t.recurrenceFrequency ?? 0,
      recurrenceDayOfMonth: t.recurrenceDayOfMonth ?? 1,
      recurrenceStartDate: t.recurrenceStartDate ? t.recurrenceStartDate.substring(0, 10) : '',
      recurrenceEndDate: t.recurrenceEndDate ? t.recurrenceEndDate.substring(0, 10) : '',
      lines: t.lines.map(l => ({ lineNumber: l.lineNumber, accountNumber: l.accountNumber, lineLabelTemplate: l.lineLabelTemplate ?? '', fixedDebit: l.fixedDebit ?? null, fixedCredit: l.fixedCredit ?? null }))
    });
  }

  frequencyLabel(freq: number): string {
    switch (freq) {
      case 1: return 'Mensuelle';
      case 2: return 'Trimestrielle';
      case 3: return 'Annuelle';
      default: return '—';
    }
  }

  cancel(): void { this.form.set(null); }

  addLine(): void {
    const f = this.form();
    if (!f) return;
    f.lines.push({ lineNumber: f.lines.length + 1, accountNumber: '', lineLabelTemplate: '', fixedDebit: null, fixedCredit: null });
    this.form.set({ ...f });
  }

  removeLine(index: number): void {
    const f = this.form();
    if (!f) return;
    f.lines.splice(index, 1);
    f.lines.forEach((l, i) => (l.lineNumber = i + 1));
    this.form.set({ ...f });
  }

  save(): void {
    const f = this.form();
    if (!f || this.saving()) return;
    if (f.recurrenceFrequency > 0 && !f.recurrenceStartDate) {
      this.error.set('La date de début est obligatoire pour une récurrence.');
      return;
    }
    this.saving.set(true);
    const request = {
      name: f.name.trim(), description: f.description || null, journalCode: f.journalCode,
      labelTemplate: f.labelTemplate || null,
      recurrenceFrequency: f.recurrenceFrequency,
      recurrenceDayOfMonth: f.recurrenceFrequency > 0 ? f.recurrenceDayOfMonth : null,
      recurrenceStartDate: f.recurrenceFrequency > 0 && f.recurrenceStartDate ? f.recurrenceStartDate : null,
      recurrenceEndDate: f.recurrenceFrequency > 0 && f.recurrenceEndDate ? f.recurrenceEndDate : null,
      lines: f.lines
    };
    const done = (ok: boolean, err?: string) => {
      this.saving.set(false);
      if (ok) {
        this.toast.add({ severity: 'success', summary: $localize`:@@entry-templates.component.summary.Mod_le_enregistr:Modèle enregistré`, detail: $localize`:@@entry-templates.component.detail.Le_mod_le_d_cri:Le modèle d'écriture a été enregistré.`, life: 4000 });
        this.form.set(null);
        this.load();
      } else this.error.set(err ?? $localize`:@@ui.tern.erreur.ab546c:Erreur`);
    };
    if (f.id) {
      this.api.updateJournalTemplate(f.id, { ...request, isActive: f.isActive }).subscribe({
        next: res => done(res.success, res.error), error: err => done(false, this.errors.extractErrorMessage(err, 'Erreur réseau'))
      });
    } else {
      this.api.createJournalTemplate(request).subscribe({
        next: res => done(res.success, res.error), error: err => done(false, this.errors.extractErrorMessage(err, 'Erreur réseau'))
      });
    }
  }

  /** Génère l'écriture de la prochaine échéance immédiatement (l'échéance suivante est avancée). */
  runNow(t: JournalEntryTemplateDto): void {
    this.confirmationService.confirm({
      message: `Générer maintenant l'écriture du modèle « ${t.name} » (échéance du ${t.nextRunDate?.substring(0, 10)}) ?`,
      header: 'Confirmation',
      acceptLabel: $localize`:@@entry-templates.component.acceptLabel.G_n_rer:Générer`,
      rejectLabel: $localize`:@@entry-templates.component.rejectLabel.Annuler:Annuler`,
      accept: () => {
        this.runningId.set(t.id);
        this.error.set(null);
        this.api.runTemplateRecurrence(t.id).subscribe({
          next: res => {
            this.runningId.set(null);
            if (res.success) {
              this.toast.add({ severity: 'success', summary: $localize`:@@entry-templates.component.summary._criture_g_n_r_e:Écriture générée`, detail: `Le modèle « ${t.name} » a généré son écriture.`, life: 4000 });
              this.load();
            } else this.error.set(res.error ?? $localize`:@@ui.tern.erreur.lors.de.la.generation.a98600:Erreur lors de la génération.`);
          },
          error: err => { this.runningId.set(null); this.error.set(this.errors.extractErrorMessage(err, 'Erreur réseau lors de la génération.')); }
        });
      }
    });
  }

  remove(t: JournalEntryTemplateDto): void {
    this.api.deleteJournalTemplate(t.id).subscribe({
      next: res => {
        if (res.success) { this.toast.add({ severity: 'success', summary: $localize`:@@entry-templates.component.summary.Modèle suppr:Modèle supprimé`, detail: t.name, life: 4000 }); this.load(); }
        else this.error.set(res.error ?? $localize`:@@ui.tern.erreur.ab546c:Erreur`);
      },
      error: err => this.error.set(this.errors.extractErrorMessage(err, 'Erreur réseau'))
    });
  }
}
