import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { Textarea } from 'primeng/textarea';
import { TooltipModule } from 'primeng/tooltip';
import { CheckboxModule } from 'primeng/checkbox';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { StudioService } from './studio.service';
import { CustomEntity } from './studio.models';
import { StudioPageShellComponent } from './shared/studio-page-shell.component';
import { STUDIO_BREADCRUMBS } from './shared/studio-breadcrumb.util';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { StatusBadgeComponent } from '@shared/components/status-badge/status-badge.component';
import { SkeletonTableComponent } from '@shared/components/skeleton/skeleton-table.component';
import { STUDIO_RUNTIME_LABELS } from './shared/studio-runtime-labels';
import { slugifyKey } from './shared/studio-text.util';

@Component({
  selector: 'app-studio-entity-list',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterModule, TableModule, ButtonModule, DialogModule,
    InputTextModule, Textarea, TooltipModule, ToastModule, CheckboxModule,
    StudioPageShellComponent, EmptyStateComponent, StatusBadgeComponent, SkeletonTableComponent
  ],
  template: `
    <p-toast></p-toast>
    <app-studio-page-shell
      title="Studio — Tables personnalisées"
      subtitle="Créez vos propres tables sans écrire de code."
      [breadcrumbs]="breadcrumbs">
      <label studioActions class="studio-line studio-hide-junctions">
        <p-checkbox [binary]="true" [(ngModel)]="hideJunctions" data-testid="hide-junctions" />
        <span>{{ runtimeLabels.entities.hideJunctions }}</span>
      </label>
      <button pButton type="button" label="Assistant IA" icon="fa-solid fa-wand-magic-sparkles" studioActions
        class="p-button-outlined" routerLink="/studio/ai" pTooltip="Créer une table en langage naturel"></button>
      <button pButton type="button" label="Nouvelle table" icon="fa-solid fa-plus" studioActions (click)="openCreate()"></button>

      <div class="ft-table-card">
        @if (loading()) {
          <app-skeleton-table [columns]="[{width:'25%'},{width:'15%'},{width:'10%'},{width:'10%'},{width:'40%'}]" [rows]="5" />
        } @else if (entities().length === 0) {
          <app-empty-state
            icon="pi-table"
            title="Aucune table"
            description="Créez votre première table personnalisée pour commencer."
            actionLabel="Nouvelle table"
            [showAction]="true"
            (actionClick)="openCreate()" />
        } @else {
          <p-table [value]="visibleEntities()" styleClass="p-datatable-sm" [paginator]="visibleEntities().length > 10" [rows]="10">
            <ng-template pTemplate="header">
              <tr>
                <th>Nom</th>
                <th>Clé</th>
                <th class="studio-num">Champs</th>
                <th>État</th>
                <th style="width: 24rem"></th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-e>
              <tr>
                <td>
                  <i [class]="e.icon || 'fa-solid fa-table'" class="studio-mr"></i>
                  <strong>{{ e.displayName }}</strong>
                  @if (e.kind === 'Junction') {
                    <span class="studio-badge-soft" data-testid="junction-badge">{{ runtimeLabels.entities.junctionBadge }}</span>
                  }
                </td>
                <td><code>{{ e.key }}</code></td>
                <td class="studio-num">{{ e.fieldCount }}</td>
                <td>
                  <app-status-badge [status]="e.isActive ? 'active' : 'inactive'"
                    [label]="e.isActive ? 'Active' : 'Inactive'" />
                </td>
                <td class="studio-actions">
                  <button pButton type="button" icon="fa-solid fa-list-check" label="Champs"
                    class="p-button-sm p-button-text" [routerLink]="['/studio', e.id]" pTooltip="Concevoir les champs"></button>
                  <button pButton type="button" icon="fa-solid fa-table-cells-large" label="Formulaire"
                    class="p-button-sm p-button-text" [routerLink]="['/studio', e.id, 'form']" pTooltip="Mise en page"></button>
                  <button pButton type="button" icon="fa-solid fa-table-list" label="Données"
                    class="p-button-sm p-button-text" [routerLink]="['/studio/d', e.key]"></button>
                </td>
              </tr>
            </ng-template>
          </p-table>
        }
      </div>
    </app-studio-page-shell>

    <p-dialog header="Nouvelle table" [(visible)]="createVisible" [modal]="true" [style]="{ width: '32rem' }">
      <div class="studio-form">
        <label>Nom (singulier) *</label>
        <input pInputText [(ngModel)]="draftName" (ngModelChange)="onNameChange($event)" placeholder="Ex. Contrat" />
        <label>Nom (pluriel)</label>
        <input pInputText [(ngModel)]="draftPlural" placeholder="Ex. Contrats" />
        <label>Clé technique *</label>
        <input pInputText [(ngModel)]="draftKey" placeholder="ex. contrat" />
        <small class="studio-hint">Minuscules, chiffres et « _ », commence par une lettre.</small>
        <label>Icône (FontAwesome)</label>
        <input pInputText [(ngModel)]="draftIcon" placeholder="fa-solid fa-file-contract" />
        <label>Description</label>
        <textarea pTextarea [(ngModel)]="draftDescription" rows="2"></textarea>
      </div>
      <ng-template pTemplate="footer">
        <button pButton type="button" label="Annuler" class="p-button-text" (click)="createVisible = false"></button>
        <button pButton type="button" label="Créer" icon="fa-solid fa-check" [disabled]="saving()" (click)="create()"></button>
      </ng-template>
    </p-dialog>
  `,
  styleUrl: './shared/studio-layout.scss',
  styles: [`
    .studio-hide-junctions { display: inline-flex; align-items: center; margin-right: auto; font-size: var(--font-size-sm); color: var(--color-neutral-600); gap: var(--spacing-2); margin-bottom: 0; }
    .studio-badge-soft {
      display: inline-block; margin-left: var(--spacing-2); padding: 0 var(--spacing-2);
      border-radius: var(--radius-full, 999px); background: var(--color-neutral-100, #f1f5f9);
      color: var(--color-neutral-600); font-size: var(--font-size-xs); font-weight: 600;
    }
  `],
})
export class StudioEntityListComponent implements OnInit {
  private readonly studio = inject(StudioService);
  private readonly toast = inject(MessageService);

  readonly entities = signal<CustomEntity[]>([]);
  readonly loading = signal(false);
  readonly runtimeLabels = STUDIO_RUNTIME_LABELS;
  /** Les jonctions N-N sont masquées par défaut (le backend les renvoie dans `GET entities`). */
  readonly hideJunctions = signal(true);
  readonly visibleEntities = computed(() =>
    this.hideJunctions() ? this.entities().filter(e => e.kind !== 'Junction') : this.entities());
  readonly saving = signal(false);
  readonly breadcrumbs = STUDIO_BREADCRUMBS.entities();

  createVisible = false;
  draftName = '';
  draftPlural = '';
  draftKey = '';
  draftIcon = '';
  draftDescription = '';
  private keyTouched = false;

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading.set(true);
    this.studio.listEntities(true).subscribe({
      next: res => { this.loading.set(false); if (res.success) this.entities.set(res.data ?? []); },
      error: () => { this.loading.set(false); this.toast.add({ severity: 'error', summary: 'Erreur', detail: 'Chargement impossible.' }); }
    });
  }

  openCreate(): void {
    this.draftName = this.draftPlural = this.draftKey = this.draftIcon = this.draftDescription = '';
    this.keyTouched = false;
    this.createVisible = true;
  }

  onNameChange(value: string): void {
    if (!this.keyTouched) this.draftKey = slugifyKey(value, 'f_');   // 4.5h : corps partagé (shared/studio-text.util.ts)
  }

  create(): void {
    if (!this.draftName.trim() || !this.draftKey.trim()) {
      this.toast.add({ severity: 'warn', summary: 'Champs requis', detail: 'Le nom et la clé sont obligatoires.' });
      return;
    }
    this.saving.set(true);
    this.studio.createEntity({
      key: this.draftKey.trim().toLowerCase(),
      displayName: this.draftName.trim(),
      displayNamePlural: this.draftPlural.trim() || null,
      icon: this.draftIcon.trim() || null,
      description: this.draftDescription.trim() || null
    }).subscribe({
      next: res => {
        this.saving.set(false);
        if (res.success) {
          this.createVisible = false;
          this.toast.add({ severity: 'success', summary: 'Table créée', detail: res.data.displayName });
          this.load();
        } else {
          this.toast.add({ severity: 'error', summary: 'Erreur', detail: res.errors?.[0] ?? res.message ?? 'Échec.' });
        }
      },
      error: err => {
        this.saving.set(false);
        this.toast.add({ severity: 'error', summary: 'Erreur', detail: err?.error?.message ?? 'Création impossible.' });
      }
    });
  }
}
