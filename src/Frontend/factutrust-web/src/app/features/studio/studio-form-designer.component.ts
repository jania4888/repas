import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { DynamicFormComponent } from '@shared/studio-runtime/dynamic-form.component';
import { StudioService } from './studio.service';
import { CustomEntity, CustomField, FormLayout } from './studio.models';
import { StudioPageShellComponent } from './shared/studio-page-shell.component';
import { StudioDesignerShellComponent } from './shared/studio-designer-shell.component';
import { STUDIO_BREADCRUMBS } from './shared/studio-breadcrumb.util';
import { BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';

type DesignerRow =
  | { kind: 'section'; title: string }
  | { kind: 'field'; field: CustomField; labelOverride: string; width: 'full' | 'half' };

@Component({
  selector: 'app-studio-form-designer',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterModule, DragDropModule,
    ButtonModule, InputTextModule, SelectModule, ToastModule,
    DynamicFormComponent, StudioPageShellComponent, StudioDesignerShellComponent
  ],
  template: `
    <p-toast></p-toast>
    @if (entity(); as e) {
      <app-studio-page-shell
        [title]="'Mise en page — ' + e.displayName"
        subtitle="Organisez les champs : ordre, sections, libellés, largeur."
        [breadcrumbs]="breadcrumbs()">
        <button pButton type="button" label="Enregistrer" icon="fa-solid fa-check" studioActions
          [disabled]="saving()" (click)="save()"></button>

        <app-studio-designer-shell previewTitle="Aperçu">
          <div studioEditor>
            <div class="studio-add-bar">
              <p-select [options]="availableFields()" [(ngModel)]="fieldToAdd" optionLabel="label" optionValue="id"
                placeholder="Ajouter un champ" i18n-placeholder="Ajouter un champ" [showClear]="true" appendTo="body" panelStyleClass="studio-theme" styleClass="studio-add-dd"></p-select>
              <button pButton type="button" icon="fa-solid fa-plus" label="Champ" [disabled]="!fieldToAdd" (click)="addField()"></button>
              <button pButton type="button" icon="fa-solid fa-heading" label="Section" class="p-button-outlined" (click)="addSection()"></button>
            </div>

            <div cdkDropList (cdkDropListDropped)="drop($event)">
              @for (r of rows(); let i = $index; track trackRow(i, r)) {
                <div class="studio-row" cdkDrag [class.studio-row-section]="r.kind === 'section'">
                  <i class="fa-solid fa-grip-vertical studio-drag-handle" cdkDragHandle></i>
                  @if (r.kind === 'section') {
                    <i class="fa-solid fa-heading"></i>
                    <input pInputText [(ngModel)]="r.title" placeholder="Titre de section" i18n-placeholder="Titre de section" class="studio-grow" />
                  }
                  @if (r.kind === 'field') {
                    <code class="studio-cname">{{ r.field.key }}</code>
                    <input pInputText [(ngModel)]="r.labelOverride" [placeholder]="r.field.label" class="studio-grow" />
                    <p-select [options]="widthOptions" [(ngModel)]="r.width" optionLabel="label" optionValue="value" appendTo="body" panelStyleClass="studio-theme"></p-select>
                  }
                  <button pButton type="button" icon="fa-solid fa-xmark" class="p-button-text p-button-sm p-button-danger" (click)="removeRow(i)"></button>
                </div>
              }
              @if (rows().length === 0) {
                <p class="studio-hint" i18n="@@studio.studio-form-designer.aucun.champ.ajoutez.des.champs.ci.dessus.5cb25489">Aucun champ. Ajoutez des champs ci-dessus.</p>
              }
            </div>
          </div>
          <div studioPreview>
            <app-dynamic-form [fields]="fields()" [layout]="previewLayout()" [saving]="true"></app-dynamic-form>
          </div>
        </app-studio-designer-shell>
      </app-studio-page-shell>
    }
  `,
  styles: [`
    .studio-drag-handle { cursor: grab; color: var(--color-neutral-400); }
    :host ::ng-deep .studio-add-dd { min-width: 14rem; }
    :host ::ng-deep .studio-preview app-dynamic-form .studio-form-actions { display: none; }
  `],
  styleUrl: './shared/studio-layout.scss',
})
export class StudioFormDesignerComponent implements OnInit {
  private readonly studio = inject(StudioService);
  private readonly toast = inject(MessageService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly entity = signal<CustomEntity | null>(null);
  readonly fields = signal<CustomField[]>([]);
  readonly rows = signal<DesignerRow[]>([]);
  readonly saving = signal(false);
  readonly breadcrumbs = signal<BreadcrumbItem[]>([]);

  entityId = '';
  fieldToAdd: string | null = null;
  readonly widthOptions = [
    { label: 'Pleine largeur', value: 'full' },
    { label: 'Demi-largeur', value: 'half' }
  ];

  readonly availableFields = computed(() => {
    const used = new Set(this.rows().filter(r => r.kind === 'field').map(r => (r as { field: CustomField }).field.id));
    return this.fields().filter(f => !used.has(f.id));
  });

  readonly previewLayout = computed<FormLayout>(() => this.toLayout(this.rows()));

  ngOnInit(): void {
    this.entityId = this.route.snapshot.paramMap.get('id') ?? '';
    this.studio.getEntity(this.entityId).subscribe({
      next: res => {
        if (res.success) {
          this.entity.set(res.data);
          this.breadcrumbs.set(STUDIO_BREADCRUMBS.formDesigner(res.data.displayName, this.entityId));
        }
      }
    });
    this.studio.listFields(this.entityId, false).subscribe({
      next: res => {
        if (res.success) {
          this.fields.set(res.data ?? []);
          this.loadLayout();
        }
      }
    });
  }

  drop(event: CdkDragDrop<DesignerRow[]>): void {
    const arr = [...this.rows()];
    moveItemInArray(arr, event.previousIndex, event.currentIndex);
    this.rows.set(arr);
  }

  trackRow(index: number, row: DesignerRow): string {
    return row.kind === 'field' ? `f:${row.field.id}` : `s:${index}:${row.title ?? ''}`;
  }

  private loadLayout(): void {
    this.studio.getForm(this.entityId).subscribe({
      next: res => {
        if (res.success) this.rows.set(this.fromLayout(res.data.layout));
        else this.rows.set(this.defaultRows());
      },
      error: () => this.rows.set(this.defaultRows())
    });
  }

  private defaultRows(): DesignerRow[] {
    return [...this.fields()].sort((a, b) => a.sortOrder - b.sortOrder)
      .map<DesignerRow>(f => ({ kind: 'field', field: f, labelOverride: '', width: 'full' }));
  }

  private fromLayout(layout: FormLayout): DesignerRow[] {
    const byKey = new Map(this.fields().map(f => [f.key, f]));
    const rows: DesignerRow[] = [];
    for (const s of layout.sections ?? []) {
      if (s.title) rows.push({ kind: 'section', title: s.title });
      for (const ref of s.fields ?? []) {
        const field = byKey.get(ref.key);
        if (field) rows.push({ kind: 'field', field, labelOverride: ref.labelOverride ?? '', width: ref.width === 'half' ? 'half' : 'full' });
      }
    }
    return rows.length ? rows : this.defaultRows();
  }

  private toLayout(rows: DesignerRow[]): FormLayout {
    const sections: FormLayout['sections'] = [];
    let current: { title: string | null; fields: { key: string; labelOverride: string | null; width: 'full' | 'half' }[] } =
      { title: null, fields: [] };
    const flush = () => { if (current.fields.length) sections.push({ title: current.title, fields: current.fields }); };
    for (const r of rows) {
      if (r.kind === 'section') {
        flush();
        current = { title: r.title?.trim() || null, fields: [] };
      } else {
        current.fields.push({ key: r.field.key, labelOverride: r.labelOverride?.trim() || null, width: r.width });
      }
    }
    flush();
    return { sections };
  }

  addField(): void {
    const f = this.fields().find(x => x.id === this.fieldToAdd);
    if (!f) return;
    this.rows.update(rs => [...rs, { kind: 'field', field: f, labelOverride: '', width: 'full' }]);
    this.fieldToAdd = null;
  }

  addSection(): void {
    this.rows.update(rs => [...rs, { kind: 'section', title: '' }]);
  }

  removeRow(index: number): void {
    this.rows.update(rs => rs.filter((_, i) => i !== index));
  }

  save(): void {
    this.saving.set(true);
    this.studio.saveForm(this.entityId, { layout: this.toLayout(this.rows()), displayName: null }).subscribe({
      next: res => {
        this.saving.set(false);
        if (res.success) {
          this.toast.add({ severity: 'success', summary: 'Mise en page enregistrée' });
          this.router.navigate(['/studio', this.entityId]);
        } else {
          this.toast.add({ severity: 'error', summary: 'Erreur', detail: res.errors?.[0] ?? res.message ?? 'Échec.' });
        }
      },
      error: err => { this.saving.set(false); this.toast.add({ severity: 'error', summary: 'Erreur', detail: err?.error?.message ?? 'Enregistrement impossible.' }); }
    });
  }
}
