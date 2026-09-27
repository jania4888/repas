/// <reference types="@angular/localize" />
import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { TableLazyLoadEvent } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { DynamicReportComponent } from '@shared/studio-runtime/dynamic-report.component';
import { ReportResult } from '@shared/studio-runtime/studio-runtime.models';
import { exportRowsCsv, exportRowsXlsx } from '@shared/studio-runtime/studio-export.util';
import { StudioService } from './studio.service';
import { CustomView, SqlQueryResult } from './studio.models';
import { StudioPageShellComponent } from './shared/studio-page-shell.component';
import { STUDIO_BREADCRUMBS } from './shared/studio-breadcrumb.util';
import { BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';

@Component({
  selector: 'app-studio-view-runner',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterModule, ButtonModule, InputTextModule, ToastModule,
    DynamicReportComponent, StudioPageShellComponent
  ],
  template: `
    <p-toast></p-toast>
    <app-studio-page-shell
      [title]="view()?.displayName ?? loc_ui_tern_vue_lecture_seule_8649da"
      subtitle="Consultation en lecture seule des données SQL." i18n-subtitle="@@studio.studio-view-runner.consultation.en.lecture.seule.des.donnee.43b49f5a"
      [breadcrumbs]="breadcrumbs()">
      @if (view()?.definition?.search !== false) {
        <div class="ft-filters">
          <div class="ft-filters__header">
            <h3 class="ft-filters__title" i18n="@@studio.studio-view-runner.recherche.5d0766ce"><i class="pi pi-search"></i> Recherche</h3>
          </div>
          <div class="studio-toolbar">
            <input pInputText [(ngModel)]="search" (keyup.enter)="reload()" placeholder="Rechercher…" i18n-placeholder="@@studio.studio-view-runner.rechercher.1d12cdfb" class="studio-search-input" />
            <button pButton type="button" icon="fa-solid fa-magnifying-glass" label="Rechercher" i18n-label="@@studio.studio-view-runner.rechercher.91f7d3e9" class="p-button-sm" (click)="reload()"></button>
          </div>
        </div>
      }

      <app-dynamic-report
        [result]="result()"
        [loading]="loading()"
        [lazy]="true"
        [totalRecords]="totalRecords()"
        [pageSize]="pageSize"
        [exportName]="view()?.displayName ?? 'vue'"
        (lazyLoad)="onLazy($event)"
        (exportAll)="exportAll($event)" />
    </app-studio-page-shell>
  `,
  styleUrl: './shared/studio-layout.scss',
})
export class StudioViewRunnerComponent implements OnInit {
  readonly loc_ui_tern_vue_lecture_seule_8649da = $localize`:@@ui.tern.vue.lecture.seule.8649da:Vue (lecture seule)`;
  private readonly studio = inject(StudioService);
  private readonly toast = inject(MessageService);
  private readonly route = inject(ActivatedRoute);

  readonly view = signal<CustomView | null>(null);
  readonly result = signal<ReportResult | null>(null);
  readonly loading = signal(true);
  readonly totalRecords = signal(0);
  readonly breadcrumbs = signal<BreadcrumbItem[]>(STUDIO_BREADCRUMBS.viewRunner('Vue'));

  private id = '';
  search = '';
  page = 1;
  pageSize = 25;

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    this.studio.getView(this.id).subscribe({
      next: res => {
        if (res.success && res.data) {
          this.view.set(res.data);
          this.breadcrumbs.set(STUDIO_BREADCRUMBS.viewRunner(res.data.displayName));
        }
        this.fetch();
      },
      error: () => this.fetch()
    });
  }

  onLazy(event: TableLazyLoadEvent): void {
    const first = event.first ?? 0;
    const rows = event.rows ?? this.pageSize;
    const nextPage = Math.floor(first / rows) + 1;
    // The table emits onLazyLoad when it (re)mounts after a load; ignore that echo when paging is
    // unchanged (ngOnInit already performed the initial fetch) to avoid a redundant re-query.
    if (nextPage === this.page && rows === this.pageSize) return;
    this.pageSize = rows;
    this.page = nextPage;
    this.fetch();
  }

  reload(): void {
    this.page = 1;
    this.fetch();
  }

  private fetch(): void {
    this.loading.set(true);
    this.studio.runView(this.id, this.search.trim() || null, this.page, this.pageSize).subscribe({
      next: res => {
        this.loading.set(false);
        if (res.success) {
          this.result.set(this.map(res.data));
          this.totalRecords.set(res.data.totalRows);
        }
      },
      error: () => {
        this.loading.set(false);
        this.toast.add({ severity: 'error', summary: $localize`:@@studio-view-runner.component.summary.Erreur:Erreur`, detail: $localize`:@@studio-view-runner.component.detail.Vue_introuvable_:Vue introuvable.` });
      }
    });
  }

  exportAll(format: 'csv' | 'xlsx'): void {
    this.studio.runView(this.id, this.search.trim() || null, 1, Math.min(this.totalRecords(), 10000)).subscribe({
      next: res => {
        if (!res.success) return;
        const mapped = this.map(res.data);
        const cols = mapped.columns.map(c => ({ key: c.key, label: c.label }));
        if (format === 'csv') exportRowsCsv(mapped.columns[0]?.label ?? 'vue', cols, mapped.rows);
        else exportRowsXlsx(mapped.columns[0]?.label ?? 'vue', cols, mapped.rows);
      }
    });
  }

  private map(r: SqlQueryResult): ReportResult {
    const v = this.view();
    const labelByName = new Map((v?.definition?.columns ?? []).map(c => [c.name, c.label?.trim() || c.name] as const));
    const formatByName = new Map((v?.definition?.columns ?? []).map(c => [c.name, c] as const));

    return {
      columns: r.columns.map(c => {
        const def = formatByName.get(c.key);
        return {
          key: c.key,
          label: c.label || labelByName.get(c.key) || c.key,
          kind: c.kind,
          format: c.format ?? def?.format ?? null,
          formatOptions: c.formatOptions ?? def?.formatOptions ?? null,
          dataType: c.dataType,
          numeric: c.numeric
        };
      }),
      rows: r.rows,
      totalRows: r.totalRows,
      displayValues: r.displayValues ?? null
    };
  }
}
