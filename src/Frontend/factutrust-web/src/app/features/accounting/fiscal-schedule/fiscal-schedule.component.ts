import { CommonModule, Location } from '@angular/common';
import { Component, HostListener, OnInit, inject } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  FormGroup,
  ValidationErrors,
  Validators
} from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { finalize } from 'rxjs/operators';
import { AuthService } from '@core/services/auth.service';
import { FirmAssignmentService, FirmClientDossier } from '@core/services/firm-assignment.service';
import { FirmFiscalScheduleService } from '@core/services/firm-fiscal-schedule.service';
import { ToastService } from '@core/services/toast.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import {
  CreateFiscalScheduleEntryRequest,
  FiscalAssignableUserDto,
  FiscalObligationType,
  FiscalReminderChannel,
  FiscalScheduleAttachmentDto,
  FiscalScheduleEntryDto,
  FiscalScheduleFilters,
  FiscalScheduleHistoryDto,
  FiscalScheduleListDto,
  FiscalScheduleService,
  FiscalScheduleStatus
} from '../services/fiscal-schedule.service';
import { FiscalScheduleDetailComponent } from './fiscal-schedule-detail.component';
import { FiscalScheduleEntryDialogComponent } from './fiscal-schedule-entry-dialog.component';
import { FiscalScheduleFiltersComponent } from './fiscal-schedule-filters.component';
import { FiscalScheduleFooterComponent } from './fiscal-schedule-footer.component';
import { FiscalScheduleSummaryComponent } from './fiscal-schedule-summary.component';
import { FiscalScheduleTableComponent } from './fiscal-schedule-table.component';
import { FiscalScheduleToolbarComponent } from './fiscal-schedule-toolbar.component';
import { FiscalScheduleWorkflowDialogComponent, FiscalWorkflowMode } from './fiscal-schedule-workflow-dialog.component';
import {
  defaultObligationLabel,
  fiscalSourceRoute,
  formatFiscalDate,
  toInputDate
} from './fiscal-schedule.view-model';
import { ErrorHandlerService } from '@core/services/error-handler.service';

@Component({
  selector: 'app-fiscal-schedule',
  standalone: true,
  imports: [
    CommonModule,
    PageHeaderComponent,
    AccountingStatusBannerComponent,
    FiscalScheduleToolbarComponent,
    FiscalScheduleSummaryComponent,
    FiscalScheduleFiltersComponent,
    FiscalScheduleTableComponent,
    FiscalScheduleDetailComponent,
    FiscalScheduleFooterComponent,
    FiscalScheduleEntryDialogComponent,
    FiscalScheduleWorkflowDialogComponent
  ],
  template: `
    <section class="fiscal-schedule-page" [class.print-selected]="printSelectedOnly">
      <app-page-header
        title="Echeancier fiscal" i18n-title="Echeancier fiscal"
        [subtitle]="isFirmScope ? 'Vue consolidee des dossiers clients actifs du cabinet' : 'Suivi des obligations, depots, paiements et rappels fiscaux'">
        <app-fiscal-schedule-toolbar
          [canCreate]="canCreate"
          [canEdit]="canEdit"
          [canDelete]="canDelete"
          [hasSelection]="!!selected"
          (create)="openCreate()"
          (edit)="openEdit()"
          (delete)="deleteSelected()"
          (refresh)="load()"
          (planReminder)="openWorkflow('reminder')"
          (printCurrent)="print(false)"
          (printSelected)="print(true)"
          (exportFiltered)="exportCsv(false)"
          (exportPage)="exportCsv(true)" />
      </app-page-header>

      <app-accounting-status-banner
        *ngIf="errorMessage"
        variant="error"
        title="Chargement impossible" i18n-title="Chargement impossible"
        [message]="errorMessage"
        [showRetry]="true"
        (retry)="load()" />

      <app-fiscal-schedule-summary
        *ngIf="list"
        [summary]="list.summary"
        (statusClick)="setStatus($event)"
        (clearStatus)="clearStatus()" />

      <app-fiscal-schedule-filters
        [filters]="filters"
        [years]="years"
        [isFirmScope]="isFirmScope"
        [companies]="companies"
        [users]="users"
        (apply)="applyFilters()"
        (fiscalYearChange)="onFiscalYearFilterChange($event)" />

      <app-fiscal-schedule-table
        [list]="list"
        [loading]="loading"
        [selected]="selected"
        [companyLabel]="tenantCompanyName"
        [showEmptyActions]="canCreate"
        [generating]="generating"
        [page]="filters.page ?? 1"
        [pageSize]="filters.pageSize ?? 25"
        (selectRow)="select($event)"
        (rowDblClick)="onRowDblClick($event)"
        (pageChange)="goToPage($event)"
        (pageSizeChange)="onPageSizeChange($event)"
        (generate)="generateSchedule()"
        (create)="openCreate()" />

      <app-fiscal-schedule-detail
        *ngIf="selected"
        [selected]="selected"
        [history]="history"
        [attachments]="attachments"
        [isFirmScope]="isFirmScope"
        [canMutate]="canCreate"
        [canValidate]="canValidateSelected"
        [companyLabel]="tenantCompanyName"
        [readOnlyAttachments]="isFirmScope && !firmWriteCompanyId"
        [readOnlyHistory]="isFirmScope && !firmWriteCompanyId"
        (openSource)="openSource()"
        (deposit)="openWorkflow('deposit')"
        (validate)="openWorkflow('validate')"
        (payment)="openWorkflow('payment')"
        (reminder)="openWorkflow('reminder')"
        (fileSelected)="onFileSelected($event)"
        (downloadAttachment)="downloadAttachment($event)"
        (deleteAttachment)="deleteAttachment($event)" />

      <app-fiscal-schedule-footer
        (close)="closePage()"
        (newReminder)="openWorkflow('reminder')" />
    </section>

    <app-fiscal-schedule-entry-dialog
      [open]="formOpen"
      [editing]="!!editingId"
      [form]="entryForm"
      [showQuarterField]="showQuarterField"
      [saving]="saving"
      (save)="saveForm()"
      (cancel)="closeForm()"
      (obligationTypeChange)="onObligationTypeChange()" />

    <app-fiscal-schedule-workflow-dialog
      [open]="workflowOpen && !!selected"
      [mode]="workflowMode"
      [saving]="saving"
      [workflowDate]="workflowDate"
      [workflowDateTime]="workflowDateTime"
      [workflowObservations]="workflowObservations"
      [reminderChannel]="reminderChannel"
      (submit)="submitWorkflow()"
      (cancel)="workflowOpen = false" />
  `,
  styles: [`
    .fiscal-schedule-page { display: block; color: #1f2937; padding-bottom: 8px; }
    @media print {
      app-fiscal-schedule-toolbar,
      app-fiscal-schedule-filters,
      app-fiscal-schedule-footer,
      app-fiscal-schedule-summary {
        display: none !important;
      }
      .fiscal-schedule-page.print-selected app-fiscal-schedule-table {
        display: none !important;
      }
    }
  `]
})
export class FiscalScheduleComponent implements OnInit {
  private readonly errors = inject(ErrorHandlerService);
  private readonly schedule = inject(FiscalScheduleService);
  private readonly firmSchedule = inject(FirmFiscalScheduleService);
  private readonly firmAssignment = inject(FirmAssignmentService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder);
  private readonly confirmationService = inject(ConfirmationService);

  readonly years = this.buildYears();

  get canCreate(): boolean {
    return this.auth.hasPermission('accounting:create');
  }

  get canEdit(): boolean {
    return this.canCreate;
  }

  get canDelete(): boolean {
    return this.canCreate;
  }

  get tenantCompanyName(): string {
    return this.auth.user()?.companyName ?? '-';
  }

  get firmWriteCompanyId(): string | null {
    if (!this.isFirmScope) return null;
    return this.selected?.companyTenantId ?? this.filters.companyTenantId ?? null;
  }

  get canValidateSelected(): boolean {
    if (!this.selected) return false;
    return !!this.selected.depositDate
      && this.selected.status !== FiscalScheduleStatus.Paid
      && this.selected.status !== FiscalScheduleStatus.Validated
      && this.selected.status !== FiscalScheduleStatus.Cancelled;
  }

  readonly entryForm: FormGroup = this.fb.group(
    {
      obligationType: [FiscalObligationType.MonthlyDeclaration, Validators.required],
      obligationLabel: ['', [Validators.required, Validators.maxLength(200)]],
      fiscalYear: [new Date().getFullYear(), [Validators.required, Validators.min(2000), Validators.max(2100)]],
      periodMonth: [null as number | null],
      periodQuarter: [null as number | null],
      dueDate: ['', Validators.required],
      estimatedAmount: [0, [Validators.required, Validators.min(0)]],
      currency: ['TND'],
      responsibleName: [''],
      observations: ['']
    },
    { validators: [this.periodConsistencyValidator.bind(this)] }
  );

  isFirmScope = false;
  loading = false;
  saving = false;
  generating = false;
  errorMessage = '';
  printSelectedOnly = false;
  list: FiscalScheduleListDto | null = null;
  selected: FiscalScheduleEntryDto | null = null;
  history: FiscalScheduleHistoryDto[] = [];
  attachments: FiscalScheduleAttachmentDto[] = [];
  companies: FirmClientDossier[] = [];
  users: FiscalAssignableUserDto[] = [];

  filters: FiscalScheduleFilters = {
    fiscalYear: new Date().getFullYear(),
    periodMonth: null,
    periodQuarter: null,
    obligationType: null,
    status: null,
    companyTenantId: null,
    responsibleUserId: null,
    dueFrom: `${new Date().getFullYear()}-01-01`,
    dueTo: `${new Date().getFullYear()}-12-31`,
    page: 1,
    pageSize: 25
  };

  formOpen = false;
  editingId: string | null = null;

  workflowOpen = false;
  workflowMode: FiscalWorkflowMode = 'deposit';
  workflowDate = toInputDate();
  workflowDateTime = '';
  workflowObservations = '';
  reminderChannel = FiscalReminderChannel.Email;

  get showQuarterField(): boolean {
    return this.entryForm.get('obligationType')?.value === FiscalObligationType.QuarterlyVat;
  }

  get totalPages(): number {
    if (!this.list) return 1;
    return Math.max(1, Math.ceil(this.list.totalCount / this.list.pageSize));
  }

  ngOnInit(): void {
    this.isFirmScope = this.route.snapshot.data['fiscalScheduleScope'] === 'firm';
    if (this.isFirmScope) {
      this.firmAssignment.getActiveClients().subscribe(response => {
        if (response.success) this.companies = response.data;
      });
    } else {
      // Responsables : collaborateurs du cabinet en mode délégué, utilisateurs de la société en
      // natif. Échec silencieux : l'écran reste pleinement utilisable sans le filtre Responsable.
      this.schedule.getAssignableUsers().subscribe({
        next: response => {
          this.users = response.success && response.data ? response.data : [];
        },
        error: () => {
          this.users = [];
        }
      });
    }
    this.applyQueryParamFilters();
    this.load();
  }

  /** Deep-link depuis la déclaration mensuelle : ?fiscalYear=2026&periodMonth=7 pré-filtre l'écran. */
  private applyQueryParamFilters(): void {
    const params = this.route.snapshot.queryParamMap;
    const fiscalYear = Number(params.get('fiscalYear'));
    const periodMonth = Number(params.get('periodMonth'));
    if (Number.isInteger(fiscalYear) && fiscalYear >= 2000 && fiscalYear <= 2100) {
      this.filters.fiscalYear = fiscalYear;
      this.filters.dueFrom = `${fiscalYear}-01-01`;
      this.filters.dueTo = `${fiscalYear}-12-31`;
    }
    if (Number.isInteger(periodMonth) && periodMonth >= 1 && periodMonth <= 12) {
      this.filters.periodMonth = periodMonth;
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.formOpen) {
      this.closeForm();
      return;
    }
    if (this.workflowOpen) this.workflowOpen = false;
  }

  onFiscalYearFilterChange(year: number): void {
    this.syncFilterDateRangeFromYear(year);
    this.applyFilters();
  }

  generateSchedule(): void {
    if (!this.canCreate || !this.filters.fiscalYear) return;
    const companyId = this.firmWriteCompanyId;
    if (this.isFirmScope && !companyId) {
      this.notify('warn', 'Selectionnez une societe pour generer l\'echeancier.');
      return;
    }
    this.generating = true;
    const request$ = this.isFirmScope && companyId
      ? this.firmSchedule.ensureFiscalYear(companyId, this.filters.fiscalYear)
      : this.schedule.ensureFiscalYear(this.filters.fiscalYear);

    request$
      .pipe(finalize(() => this.generating = false))
      .subscribe({
        next: response => {
          if (!response.success) {
            this.notify('error', this.responseMessage(response));
            return;
          }
          this.notify('success', response.message || `${response.data} echeance(s) generee(s).`);
          this.load();
        },
        error: err => this.notify('error', this.httpErrorMessage(err, "L'echeancier n'a pas pu etre genere."))
      });
  }

  load(): void {
    this.loading = true;
    this.errorMessage = '';
    const request$ = this.isFirmScope
      ? this.firmSchedule.getSchedule(this.filters)
      : this.schedule.getSchedule(this.filters);

    request$
      .pipe(finalize(() => this.loading = false))
      .subscribe({
        next: response => {
          if (!response.success) {
            this.errorMessage = this.responseMessage(response);
            return;
          }
          this.list = response.data;
          if (this.isFirmScope && response.data.companies?.length) {
            this.companies = response.data.companies.map(c => ({
              assignmentId: c.assignmentId,
              companyTenantId: c.companyTenantId,
              companyName: c.companyName,
              activeSince: c.activeSince
            }));
          }
          const previousId = this.selected?.id;
          this.selected = this.list.items.find(item => item.id === previousId) ?? this.list.items[0] ?? null;
          this.loadSelectedDetails();
        },
        error: err => this.errorMessage = this.errors.extractErrorMessage(err, "Impossible de charger l'echeancier fiscal.")
      });
  }

  applyFilters(): void {
    this.filters.page = 1;
    this.load();
  }

  setStatus(status: number): void {
    this.filters.status = status;
    this.applyFilters();
  }

  clearStatus(): void {
    this.filters.status = null;
    this.applyFilters();
  }

  goToPage(page: number): void {
    this.filters.page = Math.min(Math.max(page, 1), this.totalPages);
    this.load();
  }

  onPageSizeChange(pageSize: number): void {
    this.filters.pageSize = pageSize;
    this.goToPage(1);
  }

  select(row: FiscalScheduleEntryDto | null): void {
    this.selected = row;
    this.loadSelectedDetails();
  }

  onRowDblClick(row: FiscalScheduleEntryDto): void {
    this.selected = row;
    const route = fiscalSourceRoute(row);
    if (route) {
      this.router.navigateByUrl(route);
      return;
    }
    if (this.canEdit) this.openEdit();
  }

  openCreate(): void {
    if (!this.canCreate) return;
    if (this.isFirmScope && !this.firmWriteCompanyId) {
      this.notify('warn', 'Selectionnez une societe pour creer une echeance.');
      return;
    }
    this.editingId = null;
    this.resetEntryForm(this.createEmptyFormValues());
    this.formOpen = true;
  }

  openEdit(): void {
    if (!this.selected || !this.canEdit) return;
    this.editingId = this.selected.id;
    this.resetEntryForm({
      obligationType: this.selected.obligationType,
      obligationLabel: this.selected.obligationLabel,
      fiscalYear: this.selected.fiscalYear,
      periodMonth: this.selected.periodMonth ?? null,
      periodQuarter: this.selected.periodQuarter ?? null,
      dueDate: toInputDate(this.selected.dueDate),
      estimatedAmount: this.selected.estimatedAmount,
      currency: this.selected.currency,
      responsibleName: this.selected.responsibleName ?? '',
      observations: this.selected.observations ?? ''
    });
    this.formOpen = true;
  }

  closeForm(): void {
    this.formOpen = false;
    this.editingId = null;
  }

  saveForm(): void {
    if (this.entryForm.invalid) {
      this.entryForm.markAllAsTouched();
      return;
    }
    const payload = this.buildEntryRequest();
    this.saving = true;
    const wasEditing = !!this.editingId;
    const companyId = this.firmWriteCompanyId;
    const request$ = wasEditing
      ? (this.isFirmScope && companyId
        ? this.firmSchedule.update(companyId, this.editingId!, payload)
        : this.schedule.update(this.editingId!, payload))
      : (this.isFirmScope && companyId
        ? this.firmSchedule.create(companyId, payload)
        : this.schedule.create(payload));

    request$
      .pipe(finalize(() => this.saving = false))
      .subscribe({
        next: response => {
          if (!response.success) {
            this.notify('error', this.responseMessage(response));
            return;
          }
          this.closeForm();
          this.selected = response.data;
          this.ensureEntryVisibleAfterSave(response.data);
          this.notify('success', wasEditing ? 'Echeance mise a jour.' : 'Echeance creee.');
          this.load();
        },
        error: err => this.notify('error', this.httpErrorMessage(err, "L'echeance n'a pas pu etre enregistree."))
      });
  }

  deleteSelected(): void {
    if (!this.selected || !this.canDelete) return;
    this.confirmationService.confirm({
      message: 'Annuler cette echeance fiscale ?',
      header: 'Confirmation de suppression',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Annuler l\'échéance',
      rejectLabel: 'Retour',
      acceptButtonStyleClass: 'btn-danger',
      accept: () => {
        const companyId = this.firmWriteCompanyId;
        const request$ = this.isFirmScope && companyId
          ? this.firmSchedule.delete(companyId, this.selected!.id)
          : this.schedule.delete(this.selected!.id);

        request$.subscribe({
          next: response => {
            if (!response.success) {
              this.notify('error', this.responseMessage(response));
              return;
            }
            this.notify('success', 'Echeance annulee.');
            this.selected = null;
            this.load();
          },
          error: err => this.notify('error', this.httpErrorMessage(err, "L'echeance n'a pas pu etre annulee."))
        });
      }
    });
  }

  openWorkflow(mode: FiscalWorkflowMode): void {
    if (!this.selected || !this.canCreate) return;
    if (this.isFirmScope && !this.firmWriteCompanyId) {
      this.notify('warn', 'Selectionnez une societe pour effectuer cette action.');
      return;
    }
    this.workflowMode = mode;
    this.workflowDate = toInputDate();
    this.workflowDateTime = '';
    this.workflowObservations = '';
    this.reminderChannel = FiscalReminderChannel.Email;
    this.workflowOpen = true;
  }

  submitWorkflow(): void {
    if (!this.selected) return;
    this.saving = true;
    const companyId = this.firmWriteCompanyId;
    const useFirm = this.isFirmScope && !!companyId;
    const id = this.selected.id;

    let request$;
    if (this.workflowMode === 'payment') {
      const body = { paymentDate: this.workflowDate, observations: this.workflowObservations };
      request$ = useFirm ? this.firmSchedule.capturePayment(companyId!, id, body) : this.schedule.capturePayment(id, body);
    } else if (this.workflowMode === 'reminder') {
      const body = { channel: this.reminderChannel, reminderAt: this.workflowDateTime || null };
      request$ = useFirm ? this.firmSchedule.scheduleReminder(companyId!, id, body) : this.schedule.scheduleReminder(id, body);
    } else if (this.workflowMode === 'validate') {
      const body = { validatedDate: this.workflowDate, observations: this.workflowObservations };
      request$ = useFirm ? this.firmSchedule.markValidated(companyId!, id, body) : this.schedule.markValidated(id, body);
    } else {
      const body = { depositDate: this.workflowDate, observations: this.workflowObservations };
      request$ = useFirm ? this.firmSchedule.markDeposited(companyId!, id, body) : this.schedule.markDeposited(id, body);
    }

    request$
      .pipe(finalize(() => this.saving = false))
      .subscribe({
        next: response => {
          if (!response.success) {
            this.notify('error', this.responseMessage(response));
            return;
          }
          this.workflowOpen = false;
          this.selected = response.data;
          this.notify('success', 'Action fiscale enregistree.');
          this.load();
        },
        error: err => this.notify('error', this.httpErrorMessage(err, "L'action fiscale n'a pas pu etre enregistree."))
      });
  }

  onObligationTypeChange(): void {
    const type = this.entryForm.get('obligationType')?.value;
    if (type === FiscalObligationType.QuarterlyVat) {
      this.entryForm.patchValue({ periodMonth: null });
    } else {
      this.entryForm.patchValue({ periodQuarter: null });
    }
    this.syncLabelFromType();
    this.entryForm.updateValueAndValidity();
  }

  syncLabelFromType(): void {
    const currentLabel = String(this.entryForm.get('obligationLabel')?.value ?? '');
    const obligationType = this.entryForm.get('obligationType')?.value;
    if (!currentLabel || defaultObligationLabel(obligationType) === currentLabel) {
      this.entryForm.patchValue({ obligationLabel: defaultObligationLabel(obligationType) });
    }
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !this.selected) return;
    const companyId = this.firmWriteCompanyId;
    const request$ = this.isFirmScope && companyId
      ? this.firmSchedule.uploadAttachment(companyId, this.selected.id, file)
      : this.schedule.uploadAttachment(this.selected.id, file);

    request$.subscribe({
      next: response => {
        if (!response.success) {
          this.notify('error', this.responseMessage(response));
          return;
        }
        this.notify('success', 'Piece jointe ajoutee.');
        this.loadSelectedDetails();
      },
      error: () => this.notify('error', "La piece jointe n'a pas pu etre ajoutee.")
    });
    input.value = '';
  }

  downloadAttachment(attachment: FiscalScheduleAttachmentDto): void {
    if (!this.selected) return;
    const companyId = this.firmWriteCompanyId;
    const request$ = this.isFirmScope && companyId
      ? this.firmSchedule.downloadAttachment(companyId, this.selected.id, attachment.id)
      : this.schedule.downloadAttachment(this.selected.id, attachment.id);

    request$.subscribe(blob => this.downloadBlob(blob, attachment.fileName));
  }

  deleteAttachment(attachment: FiscalScheduleAttachmentDto): void {
    if (!this.selected) return;
    this.confirmationService.confirm({
      message: 'Supprimer cette piece jointe ?',
      header: 'Confirmation de suppression',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Supprimer',
      rejectLabel: 'Annuler',
      acceptButtonStyleClass: 'btn-danger',
      accept: () => {
        const companyId = this.firmWriteCompanyId;
        const request$ = this.isFirmScope && companyId
          ? this.firmSchedule.deleteAttachment(companyId, this.selected!.id, attachment.id)
          : this.schedule.deleteAttachment(this.selected!.id, attachment.id);

        request$.subscribe({
          next: response => {
            if (!response.success) {
              this.notify('error', this.responseMessage(response));
              return;
            }
            this.notify('success', 'Piece jointe supprimee.');
            this.loadSelectedDetails();
          },
          error: () => this.notify('error', "La piece jointe n'a pas pu etre supprimee.")
        });
      }
    });
  }

  openSource(): void {
    if (!this.selected) return;
    if (this.isFirmScope && this.selected.companyTenantId) {
      this.router.navigate(['/firm/open', this.selected.companyTenantId]);
      return;
    }
    const route = fiscalSourceRoute(this.selected);
    if (route) this.router.navigateByUrl(route);
  }

  print(selectedOnly: boolean): void {
    this.printSelectedOnly = selectedOnly;
    setTimeout(() => {
      window.print();
      this.printSelectedOnly = false;
    });
  }

  exportCsv(pageOnly: boolean): void {
    if (this.isFirmScope) {
      this.downloadClientCsv(pageOnly);
      return;
    }
    const filters = pageOnly
      ? { ...this.filters, page: this.filters.page, pageSize: this.filters.pageSize }
      : { ...this.filters, page: 1, pageSize: 200 };
    this.schedule.exportSchedule(filters).subscribe(blob => {
      const suffix = pageOnly ? `page_${filters.page}` : `filtres_${this.filters.fiscalYear}`;
      this.downloadBlob(blob, `echeancier_fiscal_${suffix}.csv`);
    });
  }

  closePage(): void {
    if (this.isFirmScope) {
      this.router.navigate(['/firm/dashboard']);
      return;
    }
    if (window.history.length > 1) {
      this.location.back();
      return;
    }
    this.router.navigate(['/accounting/home']);
  }

  private loadSelectedDetails(): void {
    this.history = [];
    this.attachments = [];
    if (!this.selected) return;

    const companyId = this.firmWriteCompanyId;
    const history$ = this.isFirmScope && companyId
      ? this.firmSchedule.getHistory(companyId, this.selected.id)
      : !this.isFirmScope
        ? this.schedule.getHistory(this.selected.id)
        : null;
    const attachments$ = this.isFirmScope && companyId
      ? this.firmSchedule.getAttachments(companyId, this.selected.id)
      : !this.isFirmScope
        ? this.schedule.getAttachments(this.selected.id)
        : null;

    history$?.subscribe(response => {
      if (response.success) this.history = response.data;
    });
    attachments$?.subscribe(response => {
      if (response.success) this.attachments = response.data;
    });
  }

  private createEmptyFormValues(): Record<string, unknown> {
    const now = new Date();
    return {
      obligationType: FiscalObligationType.MonthlyDeclaration,
      obligationLabel: defaultObligationLabel(FiscalObligationType.MonthlyDeclaration),
      fiscalYear: this.filters.fiscalYear ?? now.getFullYear(),
      periodMonth: now.getMonth() + 1,
      periodQuarter: null,
      dueDate: toInputDate(now),
      estimatedAmount: 0,
      currency: 'TND',
      responsibleName: '',
      observations: ''
    };
  }

  private resetEntryForm(values: Record<string, unknown>): void {
    this.entryForm.reset(values);
    this.entryForm.markAsPristine();
    this.entryForm.markAsUntouched();
  }

  private buildEntryRequest(): CreateFiscalScheduleEntryRequest {
    const raw = this.entryForm.getRawValue();
    const isQuarterly = raw.obligationType === FiscalObligationType.QuarterlyVat;
    return {
      obligationType: raw.obligationType,
      obligationLabel: String(raw.obligationLabel ?? '').trim(),
      fiscalYear: Number(raw.fiscalYear),
      periodMonth: isQuarterly ? null : raw.periodMonth,
      periodQuarter: isQuarterly ? raw.periodQuarter : null,
      periodStart: null,
      periodEnd: null,
      dueDate: raw.dueDate,
      estimatedAmount: Number(raw.estimatedAmount),
      currency: raw.currency || 'TND',
      responsibleUserId: null,
      responsibleName: raw.responsibleName || null,
      observations: raw.observations || null
    };
  }

  private periodConsistencyValidator(control: AbstractControl): ValidationErrors | null {
    const type = control.get('obligationType')?.value;
    const month = control.get('periodMonth')?.value;
    const quarter = control.get('periodQuarter')?.value;
    if (type === FiscalObligationType.QuarterlyVat) {
      if (!quarter) return { periodQuarterRequired: true };
      if (month) return { periodConflict: true };
      return null;
    }
    if (month && quarter) return { periodConflict: true };
    return null;
  }

  private syncFilterDateRangeFromYear(year: number): void {
    this.filters.dueFrom = `${year}-01-01`;
    this.filters.dueTo = `${year}-12-31`;
  }

  private ensureEntryVisibleAfterSave(entry: FiscalScheduleEntryDto): void {
    const dueDate = toInputDate(entry.dueDate);
    const fiscalYear = entry.fiscalYear;
    const dueFrom = this.filters.dueFrom ?? '';
    const dueTo = this.filters.dueTo ?? '';
    const outOfRange = dueDate < dueFrom || dueDate > dueTo;
    const wrongYear = this.filters.fiscalYear !== fiscalYear;
    if (wrongYear) {
      this.filters.fiscalYear = fiscalYear;
      this.syncFilterDateRangeFromYear(fiscalYear);
    } else if (outOfRange) {
      this.syncFilterDateRangeFromYear(fiscalYear);
    }
  }

  private downloadClientCsv(pageOnly: boolean): void {
    const rows = pageOnly ? (this.list?.items ?? []) : (this.list?.items ?? []);
    const header = "Date d'echeance;Type;Periode;Societe;Montant;Statut;Responsable;Observations";
    const lines = rows.map(row => [
      formatFiscalDate(row.dueDate),
      row.obligationTypeDisplay,
      row.periodDisplay,
      row.companyName ?? '',
      row.estimatedAmount.toFixed(3),
      row.statusDisplay,
      row.responsibleName ?? '',
      row.observations ?? ''
    ].map(value => this.csvEscape(value)).join(';'));
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    this.downloadBlob(blob, `echeancier_fiscal_cabinet_${this.filters.fiscalYear}.csv`);
  }

  private csvEscape(value: string): string {
    return /[;"\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  }

  private downloadBlob(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private httpErrorMessage(error: unknown, fallback: string): string {
    if (error && typeof error === 'object' && 'message' in error && typeof (error as { message?: string }).message === 'string') {
      return (error as { message: string }).message;
    }
    return fallback;
  }

  private buildYears(): number[] {
    const year = new Date().getFullYear();
    return [year - 2, year - 1, year, year + 1, year + 2];
  }

  private responseMessage(response: { message?: string | null; errors?: string[] }): string {
    return response.message || response.errors?.join(', ') || 'Operation impossible.';
  }

  private notify(severity: 'success' | 'info' | 'warn' | 'error', detail: string): void {
    this.toast.add({ severity, summary: severity === 'success' ? 'Echeancier fiscal' : 'Attention', detail });
  }
}
