/// <reference types="@angular/localize" />
import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import { AccountingTableActionsComponent } from '../shared/accounting-table-actions.component';
import { ToastService } from '@core/services/toast.service';
import { AccountingService, JournalDto, JournalFamilyDto } from '../services/accounting.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';

interface JournalForm {
  id: string | null;
  code: string;
  label: string;
  familyId: string | null;
}

@Component({
  selector: 'app-journals',
  standalone: true,
  imports: [CommonModule, FormsModule, TableModule, PageHeaderComponent, ButtonComponent, AccountingStatusBannerComponent, AccountingTableActionsComponent],
  template: `
    <app-page-header title="Journaux & familles" i18n-title="@@accounting.journals.journaux.familles.31f7dca1" subtitle="Gestion des journaux comptables et de leurs familles" />

    <app-accounting-status-banner variant="error" [message]="error() ?? ''" />

    <div class="card jr-toolbar">
      <app-button variant="primary" icon="pi pi-plus" type="button" (click)="startCreate()" [disabled]="loading()" i18n="@@accounting.journals.nouveau.journal.a81ef718">Nouveau journal</app-button>
      <app-button variant="secondary" icon="pi pi-folder-plus" type="button" (click)="showFamily.set(!showFamily())" [disabled]="loading()" i18n="@@accounting.journals.nouvelle.famille.7ce846aa">Nouvelle famille</app-button>
    </div>

    @if (showFamily()) {
      <div class="card jr-family-form">
        <h3 class="jr-form-title" i18n="@@accounting.journals.nouvelle.famille.7ce846aa">Nouvelle famille</h3>
        <div class="jr-fields">
          <div class="jr-field"><label class="jr-lbl" i18n="@@accounting.journals.code.adac6937">Code</label><input class="jr-inp" [(ngModel)]="famCode" placeholder="Ex. DIV" i18n-placeholder="@@accounting.journals.ex.div.d8f73f47" /></div>
          <div class="jr-field jr-grow"><label class="jr-lbl" i18n="@@accounting.journals.libelle.f5485bba">Libellé</label><input class="jr-inp" [(ngModel)]="famLabel" /></div>
          <div class="jr-form-actions">
            <button type="button" class="btn btn-secondary" (click)="showFamily.set(false)" i18n="@@accounting.journals.annuler.49ba3292">Annuler</button>
            <button type="button" class="btn btn-primary" (click)="createFamily()" [disabled]="!famCode.trim() || !famLabel.trim()" i18n="@@accounting.journals.enregistrer.f7c8bcd8">Enregistrer</button>
          </div>
        </div>
      </div>
    }

    @if (form(); as f) {
      <div class="card jr-form">
        <h3 class="jr-form-title">{{ f.id ? loc_ui_tern_modifier_le_journal_30515a : loc_ui_tern_nouveau_journal_a81ef7 }}</h3>
        <div class="jr-fields">
          <div class="jr-field"><label class="jr-lbl" i18n="@@accounting.journals.code.adac6937">Code</label><input class="jr-inp" [(ngModel)]="f.code" [disabled]="!!f.id" placeholder="Ex. JX" i18n-placeholder="@@accounting.journals.ex.jx.ce96445c" /></div>
          <div class="jr-field jr-grow"><label class="jr-lbl" i18n="@@accounting.journals.libelle.f5485bba">Libellé</label><input class="jr-inp" [(ngModel)]="f.label" /></div>
          <div class="jr-field"><label class="jr-lbl" i18n="@@accounting.journals.famille.3b0121d3">Famille</label>
            <select class="jr-inp" [(ngModel)]="f.familyId">
              <option [ngValue]="null" i18n="@@accounting.journals.text.1b93795b">—</option>
              @for (fam of families(); track fam.id) { <option [ngValue]="fam.id">{{ fam.label }}</option> }
            </select>
          </div>
          <div class="jr-form-actions">
            <button type="button" class="btn btn-secondary" (click)="form.set(null)" [disabled]="saving()" i18n="@@accounting.journals.annuler.49ba3292">Annuler</button>
            <button type="button" class="btn btn-primary" (click)="save()" [disabled]="saving() || !f.code.trim() || !f.label.trim()">
              {{ saving() ? loc_ui_tern_enregistrement_e7d5f2 : loc_ui_tern_enregistrer_f7c8bc }}
            </button>
          </div>
        </div>
      </div>
    }

    <div class="card jr-list">
      <p-table [value]="journals()" [loading]="loading()" styleClass="p-datatable-sm accounting-datatable" [rowHover]="true">
        <ng-template pTemplate="header">
          <tr><th scope="col" i18n="@@accounting.journals.code.adac6937">Code</th><th scope="col" i18n="@@accounting.journals.libelle.f5485bba">Libellé</th><th scope="col" i18n="@@accounting.journals.famille.3b0121d3">Famille</th><th scope="col" i18n="@@accounting.journals.systeme.62d09520">Système</th><th scope="col" i18n="@@accounting.journals.actif.2eb75f84">Actif</th><th scope="col" i18n="@@accounting.journals.actions.c3cd636a">Actions</th></tr>
        </ng-template>
        <ng-template pTemplate="body" let-j>
          <tr [class.jr-inactive]="!j.isActive">
            <td class="jr-mono">{{ j.code }}</td>
            <td>{{ j.label }}</td>
            <td>{{ j.familyLabel }}</td>
            <td>{{ j.isSystem ? loc_ui_tern_oui_eaa02f : loc_ui_tern_non_a72199 }}</td>
            <td>{{ j.isActive ? loc_ui_tern_oui_eaa02f : loc_ui_tern_non_a72199 }}</td>
            <td>
              <app-accounting-table-actions>
              <app-button variant="ghost" size="sm" icon="pi-pencil" [iconOnly]="true" [iconAlwaysVisible]="true"
                type="button" (click)="startEdit(j)" ariaLabel="Modifier" />
              @if (!j.isSystem) {
                <app-button variant="ghost" size="sm"
                  [icon]="j.isActive ? 'pi-eye-slash' : 'pi-eye'"
                  [iconOnly]="true" [iconAlwaysVisible]="true"
                  type="button" (click)="toggle(j)"
                  [attr.aria-label]="j.isActive ? loc_ui_tern_desactiver_d28397 : loc_ui_tern_activer_b96fa7" />
              }
              </app-accounting-table-actions>
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage"><tr><td colspan="6" class="jr-empty" i18n="@@accounting.journals.aucun.journal.6c18811f">Aucun journal.</td></tr></ng-template>
      </p-table>
    </div>
  `,
  styles: `
    .jr-toolbar, .jr-form, .jr-family-form, .jr-list { padding: var(--spacing-4); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); margin-bottom: var(--spacing-4); }
    .jr-toolbar { display: flex; gap: var(--spacing-3); }
    .jr-form-title { margin: 0 0 var(--spacing-3); font-size: var(--font-size-md); font-weight: var(--font-weight-semibold); }
    .jr-fields { display: flex; flex-wrap: wrap; gap: var(--spacing-3); align-items: flex-end; }
    .jr-field { display: flex; flex-direction: column; gap: var(--spacing-1); min-width: 8rem; }
    .jr-grow { flex: 1 1 14rem; }
    .jr-lbl { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); }
    .jr-inp { padding: var(--spacing-2) var(--spacing-3); border: 1px solid var(--color-border-default); border-radius: var(--radius-md); background: var(--color-background-elevated); color: var(--color-text-primary); font-size: var(--font-size-sm); width: 100%; }
    .jr-form-actions { display: flex; gap: var(--spacing-2); margin-left: auto; }
    .jr-mono { font-family: ui-monospace, monospace; }
    .jr-inactive { opacity: 0.6; }
    .jr-empty { text-align: center; padding: var(--spacing-6); color: var(--color-text-tertiary); }
    .btn { padding: var(--spacing-2) var(--spacing-4); border-radius: var(--radius-md); font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); cursor: pointer; border: 1px solid transparent; }
    .btn-secondary { background: var(--color-background-subtle); color: var(--color-text-primary); border-color: var(--color-border-default); }
    .btn-primary { background: var(--color-primary-500, #2563eb); color: #fff; }
    .btn:disabled { opacity: 0.6; cursor: not-allowed; }
  `
})
export class JournalsComponent implements OnInit {
  readonly loc_ui_tern_modifier_le_journal_30515a = $localize`:@@ui.tern.modifier.le.journal.30515a:Modifier le journal`;
  readonly loc_ui_tern_nouveau_journal_a81ef7 = $localize`:@@ui.tern.nouveau.journal.a81ef7:Nouveau journal`;
  readonly loc_ui_tern_enregistrement_e7d5f2 = $localize`:@@ui.tern.enregistrement.e7d5f2:Enregistrement…`;
  readonly loc_ui_tern_enregistrer_f7c8bc = $localize`:@@ui.tern.enregistrer.f7c8bc:Enregistrer`;
  readonly loc_ui_tern_oui_eaa02f = $localize`:@@ui.tern.oui.eaa02f:Oui`;
  readonly loc_ui_tern_non_a72199 = $localize`:@@ui.tern.non.a72199:Non`;
  readonly loc_ui_tern_desactiver_d28397 = $localize`:@@ui.tern.desactiver.d28397:Désactiver`;
  readonly loc_ui_tern_activer_b96fa7 = $localize`:@@ui.tern.activer.b96fa7:Activer`;
  private readonly errors = inject(ErrorHandlerService);
  private readonly api = inject(AccountingService);
  private readonly toast = inject(ToastService);

  readonly journals = signal<JournalDto[]>([]);
  readonly families = signal<JournalFamilyDto[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly form = signal<JournalForm | null>(null);
  readonly showFamily = signal(false);
  famCode = '';
  famLabel = '';

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.getJournalFamilies().subscribe({ next: r => { if (r.success && r.data) this.families.set(r.data); } });
    this.api.getJournals(true).subscribe({
      next: res => {
        this.loading.set(false);
        if (res.success && res.data) this.journals.set(res.data);
        else this.error.set(res.error ?? $localize`:@@ui.tern.erreur.ab546c:Erreur`);
      },
      error: err => { this.loading.set(false); this.error.set(this.errors.extractErrorMessage(err, 'Erreur réseau')); }
    });
  }

  startCreate(): void { this.form.set({ id: null, code: '', label: '', familyId: null }); }
  startEdit(j: JournalDto): void { this.form.set({ id: j.id, code: j.code, label: j.label, familyId: j.familyId ?? null }); }

  save(): void {
    const f = this.form();
    if (!f || this.saving()) return;
    this.saving.set(true);
    const done = (ok: boolean, err?: string) => {
      this.saving.set(false);
      if (ok) { this.toast.add({ severity: 'success', summary: $localize`:@@journals.component.summary.Journal_enregist:Journal enregistré`, detail: f.code, life: 4000 }); this.form.set(null); this.load(); }
      else this.error.set(err ?? $localize`:@@ui.tern.erreur.ab546c:Erreur`);
    };
    if (f.id) {
      this.api.updateJournal(f.id, { label: f.label.trim(), familyId: f.familyId }).subscribe({ next: r => done(r.success, r.error), error: err => done(false, this.errors.extractErrorMessage(err, 'Erreur réseau')) });
    } else {
      this.api.createJournal({ code: f.code.trim().toUpperCase(), label: f.label.trim(), familyId: f.familyId }).subscribe({ next: r => done(r.success, r.error), error: err => done(false, this.errors.extractErrorMessage(err, 'Erreur réseau')) });
    }
  }

  toggle(j: JournalDto): void {
    this.api.toggleJournal(j.id).subscribe({
      next: r => { if (r.success) this.load(); else this.error.set(r.error ?? $localize`:@@ui.tern.erreur.ab546c:Erreur`); },
      error: err => this.error.set(this.errors.extractErrorMessage(err, 'Erreur réseau'))
    });
  }

  createFamily(): void {
    if (!this.famCode.trim() || !this.famLabel.trim()) return;
    this.api.createJournalFamily({ code: this.famCode.trim().toUpperCase(), label: this.famLabel.trim() }).subscribe({
      next: r => {
        if (r.success) { this.toast.add({ severity: 'success', summary: $localize`:@@journals.component.summary.Famille créé:Famille créée`, detail: this.famLabel, life: 4000 }); this.famCode = ''; this.famLabel = ''; this.showFamily.set(false); this.load(); }
        else this.error.set(r.error ?? $localize`:@@ui.tern.erreur.ab546c:Erreur`);
      },
      error: err => this.error.set(this.errors.extractErrorMessage(err, 'Erreur réseau'))
    });
  }
}
