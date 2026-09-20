import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { InputNumberModule } from 'primeng/inputnumber';
import { SkeletonTableComponent } from '@shared/components/skeleton/skeleton-table.component';
import { STUDIO_RUNTIME_LABELS } from '../shared/studio-runtime-labels';
import { EntityRelationDto } from './studio-relations.models';
import { CustomRecord } from '../studio.models';
import { StudioLinkedRecordsService, JunctionAttribute, LinkedRecordRow, primaryLabel, projectLinkedRows } from './studio-linked-records.service';

interface TargetOption { id: string; label: string; }

/**
 * Onglet « Liés » de la fiche d'un enregistrement (2.5e2) : liste les liens N-N via la jonction,
 * ajout/retrait conditionnés à `canWrite` (le service compose les endpoints CRUD de la jonction ;
 * une paire existante ⇒ 409 `record.duplicate_link` rendu en ligne). Le libellé cible est résolu
 * en une passe par `resolveTargetLabels` (les records de jonction ne portent que les ids) et la
 * projection jonction → lignes est `projectLinkedRows` (partagée avec l'éditeur de puces).
 */

@Component({
  selector: 'app-studio-linked-records-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DatePipe, ButtonModule, SelectModule, InputNumberModule, SkeletonTableComponent],
  template: `
    <section class="slinked" [attr.aria-label]="labels.linked.tabLabel">
      @if (error(); as message) {
        <div class="studio-row studio-row-section" role="alert" data-testid="linked-error">{{ message }}</div>
      }
      @if (truncated()) {
        <div class="studio-row" role="status" data-testid="linked-truncated">{{ labels.linked.truncated }}</div>
      }

      @if (canWrite()) {
        <div class="slinked__addbar">
          <p-select class="slinked__search" [options]="options()" [ngModel]="selectedTarget()"
            (ngModelChange)="selectedTarget.set($event)" optionLabel="label" optionValue="id" [filter]="true"
            filterBy="label" (onFilter)="onFilter($event)" [placeholder]="relation().targetLabel" appendTo="body"
            panelStyleClass="studio-theme" data-testid="linked-search" />
          @if (attribute(); as attr) {
            @if (attr.numeric) {
              <p-inputNumber [ngModel]="newAttributeValue()" (ngModelChange)="newAttributeValue.set($event)"
                [placeholder]="attr.label" [disabled]="saving()" data-testid="linked-attr-input" />
            }
          }
          <p-button [label]="labels.linked.add" icon="pi pi-link" size="small" [disabled]="!selectedTarget() || saving()"
            (onClick)="add()" data-testid="linked-add" />
        </div>
      }

      @if (loading()) {
        <app-skeleton-table [columns]="[{width:'60%'},{width:'30%'},{width:'10%'}]" [rows]="3" />
      } @else {
        @for (row of rows(); track row.junctionRecordId) {
          <div class="studio-row" [attr.data-testid]="'linked-row-' + row.targetId">
            <span class="studio-grow">{{ row.targetLabel }}</span>
            @if (attribute(); as attr) {
              @if (editingAttr() === row.junctionRecordId) {
                <p-inputNumber [ngModel]="editAttrValue()" (ngModelChange)="editAttrValue.set($event)"
                  data-testid="linked-attr-edit-input" />
                <p-button icon="pi pi-check" [text]="true" size="small" severity="success" [disabled]="saving()"
                  [attr.aria-label]="labels.linked.save" (onClick)="saveAttribute(row)"
                  [attr.data-testid]="'linked-attr-save-' + row.targetId" />
                <p-button icon="pi pi-undo" [text]="true" size="small" [disabled]="saving()"
                  [attr.aria-label]="labels.linked.cancel" (onClick)="editingAttr.set(null)"
                  data-testid="linked-attr-cancel" />
              } @else {
                <span class="studio-muted" [attr.data-testid]="'linked-attr-' + row.targetId">{{ row.attributeValue ?? '—' }}</span>
                @if (attr.numeric && canWrite()) {
                  <p-button icon="pi pi-pencil" [text]="true" size="small" [disabled]="saving()"
                    [attr.aria-label]="labels.linked.edit" (onClick)="beginAttributeEdit(row)"
                    [attr.data-testid]="'linked-attr-edit-' + row.targetId" />
                }
              }
            }
            <span class="studio-muted">{{ row.createdAt | date:'dd/MM/yyyy' }}</span>
            @if (canWrite()) {
              <p-button icon="pi pi-times" [text]="true" size="small" severity="danger" [disabled]="saving()"
                [attr.aria-label]="labels.linked.remove" (onClick)="remove(row)" data-testid="linked-remove" />
            }
          </div>
        } @empty {
          <p class="studio-muted" data-testid="linked-empty">Aucune fiche liée.</p>
        }
      }
    </section>
  `,
  // studio-layout.scss fournit .studio-row / .studio-row-section / .studio-grow / .studio-muted
  // (encapsulation émulée : sans styleUrl ici, les lignes « Liés » n'étaient pas stylées).
  styleUrl: '../shared/studio-layout.scss',
  styles: [`
    .slinked__addbar { display: flex; gap: var(--spacing-2); margin-bottom: var(--spacing-3); }
    .slinked__search { flex: 1; max-width: 24rem; }
  `]
})
export class StudioLinkedRecordsTabComponent implements OnInit {
  readonly relation = input.required<EntityRelationDto>();
  readonly recordId = input.required<string>();
  readonly canWrite = input(false);

  private readonly linked = inject(StudioLinkedRecordsService);
  private readonly toast = inject(MessageService);

  readonly labels = STUDIO_RUNTIME_LABELS;
  readonly pageSize = 50;
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly rows = signal<LinkedRecordRow[]>([]);
  readonly options = signal<TargetOption[]>([]);
  readonly selectedTarget = signal<string | null>(null);
  readonly truncated = signal(false);
  /** v1.1 / D-47-40 : attribut de liaison (null ⇒ rendu strictement v1). */
  readonly attribute = signal<JunctionAttribute | null>(null);
  readonly newAttributeValue = signal<number | null>(null);
  readonly editingAttr = signal<string | null>(null);   // junctionRecordId en cours d'édition
  readonly editAttrValue = signal<number | null>(null);

  private lastJunctions: CustomRecord[] = [];
  private lastLabels = new Map<string, string>();

  ngOnInit(): void {
    this.linked.getJunctionAttribute(this.relation()).subscribe(a => {
      this.attribute.set(a);
      if (this.lastJunctions.length) this.projectRows();   // l'attribut peut arriver après la liste
    });
    this.refresh();
    this.searchTargets(null);
  }

  refresh(): void {
    this.loading.set(true);
    this.linked.listLinks(this.relation(), this.recordId(), 1, this.pageSize).subscribe({
      next: res => {
        this.loading.set(false);
        if (!res.success) { this.error.set(res.message || this.labels.linked.error); return; }
        this.lastJunctions = res.data.items ?? [];
        this.truncated.set((res.data.totalCount ?? 0) > this.pageSize);
        this.resolveLabels();
      },
      error: () => { this.loading.set(false); this.error.set(this.labels.linked.error); }
    });
  }

  /** Résout les libellés cibles en une passe (200 — borne haute, couvre les cibles déjà liées). */
  private resolveLabels(): void {
    if (!this.relation().junctionTargetFieldKey) { this.rows.set([]); return; }
    this.linked.resolveTargetLabels(this.relation()).subscribe(labels => {
      this.lastLabels = labels;
      this.projectRows();
    });
  }

  /** (Re)projette les lignes depuis la dernière liste — rejoué si l'attribut arrive après la liste. */
  private projectRows(): void {
    this.rows.set(projectLinkedRows(
      this.lastJunctions, this.relation().junctionTargetFieldKey, this.lastLabels, this.attribute()?.key));
  }

  searchTargets(search: string | null): void {
    this.linked.searchTargets(this.relation(), search).subscribe({
      next: res => {
        if (!res.success) return;
        this.options.set((res.data.items ?? []).map(r => ({ id: r.id, label: primaryLabel(r, []) })));
      },
      error: () => { /* liste de choix indisponible : le tableau reste fonctionnel */ }
    });
  }

  onFilter(event: { filter?: string }): void {
    this.searchTargets(event.filter ?? null);
  }

  add(): void {
    const targetId = this.selectedTarget();
    if (!targetId || !this.canWrite()) return;
    this.saving.set(true);
    this.error.set(null);
    this.linked.link(this.relation(), this.recordId(), targetId, this.attribute(), this.newAttributeValue()).subscribe({
      next: res => {
        this.saving.set(false);
        if (!res.success) { this.error.set(res.message || this.labels.linked.error); return; }
        this.selectedTarget.set(null);
        this.newAttributeValue.set(null);
        this.refresh();
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(err.status === 409 && err.error?.code === 'record.duplicate_link'
          ? this.labels.linked.duplicate
          : (typeof err.error?.message === 'string' ? err.error.message : this.labels.linked.error));
      }
    });
  }

  beginAttributeEdit(row: LinkedRecordRow): void {
    this.editAttrValue.set(typeof row.attributeValue === 'number' ? row.attributeValue : null);
    this.editingAttr.set(row.junctionRecordId);
  }

  /** v1.1 : PATCH de l'attribut avec le rowVersion de la ligne ; 409 périmé ⇒ message + rechargement. */
  saveAttribute(row: LinkedRecordRow): void {
    const attr = this.attribute();
    if (!attr || !row.rowVersion) return;
    this.saving.set(true);
    this.error.set(null);
    const value = this.editAttrValue();
    this.linked.patchLink(this.relation(), row.junctionRecordId, { [attr.key]: value }, row.rowVersion).subscribe({
      next: res => {
        this.saving.set(false);
        if (!res.success) { this.error.set(res.message || this.labels.linked.error); return; }
        this.editingAttr.set(null);
        this.rows.update(rows => rows.map(r => r.junctionRecordId === row.junctionRecordId
          ? { ...r, attributeValue: value, rowVersion: res.data?.rowVersion ?? r.rowVersion }
          : r));
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.editingAttr.set(null);
        // 409 Conflict = jeton périmé ⇒ message + rechargement (record.duplicate_link impossible ici :
        // les clés de paire ne sont pas patchées — le chemin générique la rendrait quand même).
        if (err.status === 409) { this.error.set(this.labels.linked.conflict); this.refresh(); return; }
        this.error.set(typeof err.error?.message === 'string' ? err.error.message : this.labels.linked.error);
      }
    });
  }

  remove(row: LinkedRecordRow): void {
    if (!this.canWrite()) return;
    this.saving.set(true);
    this.error.set(null);
    this.linked.unlink(this.relation(), row.junctionRecordId).subscribe({
      next: () => {
        this.saving.set(false);
        this.toast.add({ severity: 'success', summary: this.labels.linked.tabLabel, detail: this.labels.linked.remove });
        this.rows.update(rows => rows.filter(r => r.junctionRecordId !== row.junctionRecordId));
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(typeof err.error?.message === 'string' ? err.error.message : this.labels.linked.error);
      }
    });
  }
}
