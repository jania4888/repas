import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { InputTextModule } from 'primeng/inputtext';
import { InputSwitchModule } from 'primeng/inputswitch';
import { MessageService } from 'primeng/api';
import { StudioService } from './studio.service';
import {
  Automation, AutomationAction, AutomationTrigger, BridgeParamMapping,
  CustomEntity, CustomField, SaveAutomationRequest
} from './studio.models';
import { StudioPageShellComponent } from './shared/studio-page-shell.component';
import { StudioBridgeActionPickerComponent } from './shared/studio-bridge-action-picker.component';
import { STUDIO_BREADCRUMBS } from './shared/studio-breadcrumb.util';
import { BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';

/**
 * "ERP bridge" automations for a custom entity: bind a record lifecycle event (or a manual run) to a
 * validated ERP action, mapping the record's fields to the action's parameters. Configuration surface;
 * execution is performed best-effort server-side.
 */
@Component({
  selector: 'app-studio-automations',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterModule, TableModule, ButtonModule, DialogModule,
    SelectModule, InputTextModule, InputSwitchModule, StudioPageShellComponent,
    StudioBridgeActionPickerComponent
  ],
  template: `
    <app-studio-page-shell
      [title]="'Pont ERP — ' + (entity()?.displayName ?? '…')"
      subtitle="Déclenchez une action métier réelle (facture, dépense…) à partir d'un enregistrement de cette table."
      [breadcrumbs]="breadcrumbs()">

      <button pButton type="button" label="Nouvelle automatisation" icon="fa-solid fa-bolt" studioActions
        (click)="openAdd()"></button>

      <p-table [value]="automations()" [loading]="loading()" styleClass="p-datatable-sm">
        <ng-template pTemplate="header">
          <tr><th>Nom</th><th>Déclencheur</th><th>Action ERP</th><th>Active</th><th style="width:8rem"></th></tr>
        </ng-template>
        <ng-template pTemplate="body" let-a>
          <tr>
            <td><strong>{{ a.name }}</strong></td>
            <td>{{ triggerLabel(a.trigger) }}</td>
            <td><code>{{ a.actionKey }}</code></td>
            <td><i class="fa-solid" [class.fa-check]="a.isActive" [class.fa-minus]="!a.isActive"></i></td>
            <td class="ft-actions">
              <button pButton type="button" icon="fa-solid fa-pen" class="p-button-text p-button-sm" (click)="openEdit(a)"></button>
              <button pButton type="button" icon="fa-solid fa-trash" class="p-button-text p-button-sm p-button-danger" (click)="remove(a)"></button>
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr><td colspan="5" class="ft-empty">Aucune automatisation. Créez la première pour connecter cette table à l'ERP.</td></tr>
        </ng-template>
      </p-table>
    </app-studio-page-shell>

    <p-dialog [header]="editing() ? 'Modifier l’automatisation' : 'Nouvelle automatisation'"
      [(visible)]="dialogVisible" [modal]="true" [style]="{ width: '46rem' }">
      <div class="ft-form">
        <label>Nom *</label>
        <input pInputText [(ngModel)]="fName" placeholder="Ex. Facturer l'abonnement" />

        <div class="ft-row">
          <div>
            <label>Déclencheur *</label>
            <p-select [options]="triggerOptions" [(ngModel)]="fTrigger" optionLabel="label" optionValue="value"
              appendTo="body" panelStyleClass="studio-theme" styleClass="ft-w-full"></p-select>
          </div>
        </div>

        <app-studio-bridge-action-picker [actions]="actions()" [fields]="fields()" [(action)]="fAction" [(mapping)]="fMapping" />

        <div class="ft-row ft-switches">
          <div><p-inputSwitch [(ngModel)]="fRunOnce"></p-inputSwitch> <span>Exécuter une seule fois par enregistrement</span></div>
          <div><p-inputSwitch [(ngModel)]="fActive"></p-inputSwitch> <span>Active</span></div>
        </div>
      </div>
      <ng-template pTemplate="footer">
        <button pButton type="button" label="Annuler" class="p-button-text" (click)="dialogVisible = false"></button>
        <button pButton type="button" label="Enregistrer" icon="fa-solid fa-check" [disabled]="saving()" (click)="save()"></button>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    .ft-actions { text-align: right; white-space: nowrap; }
    .ft-empty { text-align: center; color: var(--text-color-secondary); padding: 2rem; }
    .ft-form { display: flex; flex-direction: column; gap: .4rem; }
    .ft-form label { font-weight: 600; font-size: .85rem; margin-top: .5rem; }
    .ft-row { display: flex; gap: 1rem; }
    .ft-row > div { flex: 1; display: flex; flex-direction: column; gap: .25rem; }
    .ft-switches { margin-top: .75rem; align-items: center; }
    .ft-switches > div { flex-direction: row; align-items: center; gap: .4rem; }
    :host ::ng-deep .ft-w-full { width: 100%; }
  `]
})
export class StudioAutomationsComponent implements OnInit {
  private readonly studio = inject(StudioService);
  private readonly toast = inject(MessageService);
  private readonly route = inject(ActivatedRoute);

  readonly entity = signal<CustomEntity | null>(null);
  readonly fields = signal<CustomField[]>([]);
  readonly actions = signal<AutomationAction[]>([]);
  readonly automations = signal<Automation[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly editing = signal(false);
  readonly breadcrumbs = signal<BreadcrumbItem[]>(STUDIO_BREADCRUMBS.entities());

  readonly triggerOptions = [
    { label: 'À la création', value: AutomationTrigger.OnCreate },
    { label: 'À la modification', value: AutomationTrigger.OnUpdate },
    { label: 'Manuel (bouton)', value: AutomationTrigger.Manual }
  ];

  private entityId = '';
  dialogVisible = false;
  private editId: string | null = null;
  fName = '';
  fTrigger: AutomationTrigger = AutomationTrigger.OnCreate;
  readonly fAction = signal<string | null>(null);
  readonly fMapping = signal<BridgeParamMapping[]>([]);
  fRunOnce = true;
  fActive = true;

  ngOnInit(): void {
    this.entityId = this.route.snapshot.paramMap.get('id') ?? '';
    this.studio.getEntity(this.entityId).subscribe({
      next: res => {
        if (res.success) {
          this.entity.set(res.data);
          this.breadcrumbs.set(STUDIO_BREADCRUMBS.entityDesigner(res.data.displayName));
        }
      }
    });
    this.studio.listFields(this.entityId, false).subscribe({ next: res => { if (res.success) this.fields.set(res.data ?? []); } });
    this.studio.listAutomationActions().subscribe({ next: res => { if (res.success) this.actions.set(res.data ?? []); } });
    this.loadAutomations();
  }

  loadAutomations(): void {
    this.loading.set(true);
    this.studio.listAutomations(this.entityId).subscribe({
      next: res => { this.loading.set(false); if (res.success) this.automations.set(res.data ?? []); },
      error: () => { this.loading.set(false); this.toast.add({ severity: 'error', summary: 'Erreur', detail: 'Chargement impossible.' }); }
    });
  }

  triggerLabel(t: AutomationTrigger): string {
    return this.triggerOptions.find(o => o.value === t)?.label ?? String(t);
  }

  openAdd(): void {
    this.editing.set(false);
    this.editId = null;
    this.fName = '';
    this.fTrigger = AutomationTrigger.OnCreate;
    this.fAction.set(null);
    this.fMapping.set([]);
    this.fRunOnce = true;
    this.fActive = true;
    this.dialogVisible = true;
  }

  openEdit(a: Automation): void {
    this.editing.set(true);
    this.editId = a.id;
    this.fName = a.name;
    this.fTrigger = a.trigger;
    this.fAction.set(a.actionKey);
    this.fMapping.set([...(a.mapping ?? [])]);
    this.fRunOnce = a.runOnce;
    this.fActive = a.isActive;
    this.dialogVisible = true;
  }

  save(): void {
    if (!this.fName.trim() || !this.fAction()) {
      this.toast.add({ severity: 'warn', summary: 'Champs requis', detail: 'Nom et action obligatoires.' });
      return;
    }

    const req: SaveAutomationRequest = {
      name: this.fName.trim(), trigger: this.fTrigger, actionKey: this.fAction()!,
      mapping: this.fMapping(), runOnce: this.fRunOnce, isActive: this.fActive
    };
    this.saving.set(true);
    const obs = this.editing() && this.editId
      ? this.studio.updateAutomation(this.entityId, this.editId, req)
      : this.studio.createAutomation(this.entityId, req);
    obs.subscribe({
      next: res => {
        this.saving.set(false);
        if (res.success) { this.dialogVisible = false; this.loadAutomations(); }
        else this.toast.add({ severity: 'error', summary: 'Erreur', detail: res.errors?.[0] ?? res.message ?? 'Échec.' });
      },
      error: err => { this.saving.set(false); this.toast.add({ severity: 'error', summary: 'Erreur', detail: err?.error?.message ?? 'Échec.' }); }
    });
  }

  remove(a: Automation): void {
    if (!confirm(`Supprimer l'automatisation « ${a.name} » ?`)) return;
    this.studio.deleteAutomation(a.id).subscribe({
      next: res => { if (res.success) this.loadAutomations(); },
      error: () => this.toast.add({ severity: 'error', summary: 'Erreur', detail: 'Suppression impossible.' })
    });
  }
}
