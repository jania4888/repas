import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { InputNumberModule } from 'primeng/inputnumber';
import { STUDIO_RUNTIME_LABELS } from '../shared/studio-runtime-labels';
import { EntityRelationDto } from './studio-relations.models';
import { CustomRecord } from '../studio.models';
import { JunctionAttribute, LinkedRecordRow, StudioLinkedRecordsService, primaryLabel, projectLinkedRows } from './studio-linked-records.service';

interface TargetOption { id: string; label: string; }

/**
 * Puces N-N inline dans la fiche (v1.1 / D-47-40, R4 complet — maquettes 21–22) : une carte par
 * relation plusieurs-à-plusieurs, montée par `studio-record-form` SOUS la carte du formulaire
 * dynamique (`DynamicFormComponent` non modifié — une relation N-N n'est pas un champ). Édition
 * uniquement (`recordId` exigé, même garde que les onglets « Liés ») ; les actions sont
 * **immédiates** (POST/DELETE/PATCH jonction), indépendantes du bouton « Enregistrer » de la fiche.
 * La quantité (attribut de liaison) s'affiche dans la puce et s'édite au clic quand elle est
 * numérique ; l'onglet « Liés » (tableau complet + dates) reste la surface de gestion complète.
 */
@Component({
  selector: 'app-studio-link-chips-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, ButtonModule, SelectModule, InputNumberModule],
  template: `
    <section class="studio-form-card link-chips" [attr.data-testid]="'chips-' + relation().junctionEntityKey">
      <h3 class="link-chips__title"><i class="pi pi-link"></i> {{ relation().targetLabel }}</h3>

      @if (error(); as message) {
        <div class="studio-row studio-row-section" role="alert" data-testid="chips-error">{{ message }}</div>
      }

      @if (loading()) {
        <span class="studio-muted" data-testid="chips-loading">…</span>
      } @else {
        <div class="link-chips__list">
          @for (row of rows(); track row.junctionRecordId) {
            <span class="link-chips__chip" [attr.data-testid]="'chip-' + row.targetId">
              <span>{{ row.targetLabel }}</span>
              @if (attribute(); as attr) {
                @if (editingAttr() === row.junctionRecordId) {
                  <p-inputNumber [ngModel]="editAttrValue()" (ngModelChange)="editAttrValue.set($event)"
                    data-testid="chip-attr-edit-input" />
                  <p-button icon="pi pi-check" [text]="true" size="small" severity="success" [disabled]="saving()"
                    [attr.aria-label]="labels.linked.save" (onClick)="saveAttribute(row)"
                    [attr.data-testid]="'chip-attr-save-' + row.targetId" />
                  <p-button icon="pi pi-undo" [text]="true" size="small" [disabled]="saving()"
                    [attr.aria-label]="labels.linked.cancel" (onClick)="editingAttr.set(null)"
                    data-testid="chip-attr-cancel" />
                } @else {
                  <span class="link-chips__qty" [class.link-chips__qty--editable]="attr.numeric && canWrite()"
                    [attr.data-testid]="'chip-attr-' + row.targetId"
                    (click)="attr.numeric && canWrite() && beginAttributeEdit(row)">· {{ row.attributeValue ?? '—' }}</span>
                }
              }
              @if (canWrite()) {
                <button type="button" class="link-chips__remove" [disabled]="saving()"
                  [attr.aria-label]="labels.linked.remove" (click)="remove(row)"
                  [attr.data-testid]="'chip-remove-' + row.targetId"><i class="pi pi-times"></i></button>
              }
            </span>
          } @empty {
            <span class="studio-muted" data-testid="chips-empty">Aucune fiche liée.</span>
          }
        </div>

        @if (canWrite()) {
          <div class="link-chips__add">
            <p-select class="link-chips__search" [options]="options()" [ngModel]="selectedTarget()"
              (ngModelChange)="selectedTarget.set($event)" optionLabel="label" optionValue="id" [filter]="true"
              filterBy="label" (onFilter)="onFilter($event)" [placeholder]="relation().targetLabel" appendTo="body"
              panelStyleClass="studio-theme" data-testid="chip-search" />
            @if (attribute(); as attr) {
              @if (attr.numeric) {
                <p-inputNumber [ngModel]="newAttributeValue()" (ngModelChange)="newAttributeValue.set($event)"
                  [placeholder]="attr.label" [disabled]="saving()" data-testid="chip-attr-input" />
              }
            }
            <p-button [label]="labels.linked.add" icon="pi pi-link" size="small" [disabled]="!selectedTarget() || saving()"
              (onClick)="add()" data-testid="chip-add" />
          </div>
        }
      }
    </section>
  `,
  // studio-layout.scss fournit .studio-form-card / .studio-row / .studio-muted (encapsulation émulée).
  styleUrl: '../shared/studio-layout.scss',
  styles: [`
    .link-chips__title { display: flex; align-items: center; gap: var(--spacing-2); margin: 0 0 var(--spacing-2); font-size: 1rem; }
    .link-chips__list { display: flex; flex-wrap: wrap; gap: var(--spacing-2); }
    .link-chips__chip { display: inline-flex; align-items: center; gap: var(--spacing-1);
      padding: 0.15rem 0.6rem; border: 1px solid var(--surface-border, #dee2e6); border-radius: 999px; }
    .link-chips__qty { color: var(--text-color-secondary, #6c757d); }
    .link-chips__qty--editable { cursor: pointer; text-decoration: underline dotted; }
    .link-chips__remove { border: 0; background: none; padding: 0; cursor: pointer; color: var(--text-color-secondary, #6c757d); }
    .link-chips__remove:hover { color: var(--red-500, #ef4444); }
    .link-chips__add { display: flex; gap: var(--spacing-2); margin-top: var(--spacing-3); }
    .link-chips__search { flex: 1; max-width: 24rem; }
  `]
})
export class StudioLinkChipsEditorComponent implements OnInit {
  readonly relation = input.required<EntityRelationDto>();
  readonly recordId = input.required<string>();
  readonly canWrite = input(false);

  private readonly linked = inject(StudioLinkedRecordsService);
  private readonly toast = inject(MessageService);

  readonly labels = STUDIO_RUNTIME_LABELS;
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly rows = signal<LinkedRecordRow[]>([]);
  readonly options = signal<TargetOption[]>([]);
  readonly selectedTarget = signal<string | null>(null);
  readonly attribute = signal<JunctionAttribute | null>(null);
  readonly newAttributeValue = signal<number | null>(null);
  readonly editingAttr = signal<string | null>(null);
  readonly editAttrValue = signal<number | null>(null);

  private lastJunctions: CustomRecord[] = [];
  private lastLabels = new Map<string, string>();

  ngOnInit(): void {
    this.linked.getJunctionAttribute(this.relation()).subscribe(a => {
      this.attribute.set(a);
      if (this.lastJunctions.length) this.projectRows();
    });
    this.refresh();
    this.searchTargets(null);
  }

  refresh(): void {
    this.loading.set(true);
    this.linked.listLinks(this.relation(), this.recordId(), 1, 50).subscribe({
      next: res => {
        this.loading.set(false);
        if (!res.success) { this.error.set(res.message || this.labels.linked.error); return; }
        this.lastJunctions = res.data.items ?? [];
        this.resolveLabels();
      },
      error: () => { this.loading.set(false); this.error.set(this.labels.linked.error); }
    });
  }

  private resolveLabels(): void {
    if (!this.relation().junctionTargetFieldKey) { this.rows.set([]); return; }
    this.linked.resolveTargetLabels(this.relation()).subscribe(labels => {
      this.lastLabels = labels;
      this.projectRows();
    });
  }

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
      error: () => { /* liste de choix indisponible : les puces restent fonctionnelles */ }
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

  beginAttributeEdit(row: LinkedRecordRow): void {
    this.editAttrValue.set(typeof row.attributeValue === 'number' ? row.attributeValue : null);
    this.editingAttr.set(row.junctionRecordId);
  }

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
        if (err.status === 409) { this.error.set(this.labels.linked.conflict); this.refresh(); return; }
        this.error.set(typeof err.error?.message === 'string' ? err.error.message : this.labels.linked.error);
      }
    });
  }
}
