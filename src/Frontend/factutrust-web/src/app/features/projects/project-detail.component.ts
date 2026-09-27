/// <reference types="@angular/localize" />
import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TabsModule } from 'primeng/tabs';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { Textarea } from 'primeng/textarea';
import { ButtonComponent } from '@shared/components/button/button.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { FormSectionComponent } from '@shared/components/form-section/form-section.component';
import { AuthService } from '@core/services/auth.service';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { ProductService } from '@core/services/product.service';
import { PurchaseOrderService, PurchaseOrderStatus } from '@core/services/purchase-order.service';
import { SupplierService } from '@core/services/supplier.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import {
  ProjectActivity,
  ProjectApiService,
  ProjectAssignableUser,
  ProjectAttachment,
  BillableProjectTask,
  BillableProjectTimeEntry,
  ProjectBillingReadiness,
  ProjectBudget,
  ProjectComment,
  ProjectCostLine,
  ProjectDetail,
  ProjectMember,
  ProjectMilestone,
  ProjectSituation,
  ProjectSubcontractor,
  ProjectTask,
  ProjectTimeEntry,
  ProjectWorkloadRow,
  ProjectPurchaseOrder,
  ProjectSettingsPayload,
  UpsertMemberPayload,
  UpsertProjectPayload,
  UpsertTaskPayload
} from './project-api.service';
import {
  ProjectTaskStatusCode,
  canActivate,
  canCancel,
  canComplete,
  canEditProject,
  canHold,
  isBtp,
  parseProjectBillingMode,
  parseProjectKind,
  projectStatusBadge,
  projectUiProfile,
  showTimeTab,
  showProfitabilityTab,
  TabKey,
  toIsoDate
} from './project-enums';
import { ProjectOverviewTabComponent } from './tabs/project-overview.tab';
import { ProjectTasksTabComponent } from './tabs/project-tasks.tab';
import { CreateTimePayload, ProjectTimeTabComponent, TimeFilterPayload } from './tabs/project-time.tab';
import { ProductOption, ProjectBudgetTabComponent } from './tabs/project-budget.tab';
import { ProjectTeamTabComponent } from './tabs/project-team.tab';
import { ProjectFilesTabComponent } from './tabs/project-files.tab';
import { ProjectBillingTabComponent, SupplierOption } from './tabs/project-billing.tab';
import { ProjectProfitabilityTabComponent } from './tabs/project-profitability.tab';
import { ProjectSummarySidebarComponent } from './components/project-summary-sidebar.component';
import { ProjectDetailHeroComponent } from './components/project-detail-hero.component';
import { ProjectDetailKpiStripComponent } from './components/project-detail-kpi-strip.component';
import { ProjectActivityTabComponent } from './tabs/project-activity.tab';
import { ProjectSettingsTabComponent } from './tabs/project-settings.tab';
import { ProjectFavoritesService } from './project-favorites.service';

@Component({
  selector: 'app-project-detail',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TabsModule,
    DialogModule,
    InputTextModule,
    InputNumberModule,
    SelectModule,
    DatePickerModule,
    Textarea,
    ButtonComponent,
    BreadcrumbComponent,
    FormSectionComponent,
    ProjectOverviewTabComponent,
    ProjectTasksTabComponent,
    ProjectTimeTabComponent,
    ProjectBudgetTabComponent,
    ProjectTeamTabComponent,
    ProjectFilesTabComponent,
    ProjectBillingTabComponent,
    ProjectProfitabilityTabComponent,
    ProjectSummarySidebarComponent,
    ProjectDetailHeroComponent,
    ProjectDetailKpiStripComponent,
    ProjectActivityTabComponent,
    ProjectSettingsTabComponent
  ],
  template: `
    @if (project(); as p) {
      <app-breadcrumb [items]="breadcrumbItems()"></app-breadcrumb>

      <app-project-detail-hero
        [project]="p"
        [canUpdate]="canUpdate"
        [showSiteChip]="uiProfile(p.kind).showSiteChip"
        [favorite]="isFavorite(p.id)"
        (activate)="activate()"
        (hold)="hold()"
        (complete)="complete()"
        (cancel)="cancel()"
        (edit)="openEdit()"
        (toggleFavorite)="toggleFavorite(p.id)"
        (goList)="goList()" />

      <app-project-detail-kpi-strip
        class="proj-detail-kpi-wrap"
        [project]="p"
        [budget]="budget()"
        [tasks]="tasks()" />

      <div class="proj-layout-with-sidebar" [class.proj-layout-with-sidebar--full]="showSidebar()">
        <div class="proj-detail-tabs-wrap">
      <p-tabs class="ft-tabs proj-detail-tabs" [value]="tab()" [lazy]="true" (valueChange)="onTab($event)">
        <p-tablist>
          <p-tab value="overview" [class.proj-tab-emphasis]="isEmphasizedTab('overview')" i18n="@@projects.project-detail.apercu.047586dd">
            <i class="pi pi-th-large"></i> Aperçu
          </p-tab>
          <p-tab value="tasks" [class.proj-tab-emphasis]="isEmphasizedTab('tasks')" i18n="@@projects.project-detail.taches.4108188a">
            <i class="pi pi-check-square"></i> Tâches
          </p-tab>
          @if (showTimeTab(p)) {
          <p-tab value="time" [class.proj-tab-emphasis]="isEmphasizedTab('time')" i18n="@@projects.project-detail.temps.d4c14181">
            <i class="pi pi-clock"></i> Temps
          </p-tab>
          }
          <p-tab value="budget" [class.proj-tab-emphasis]="isEmphasizedTab('budget')" i18n="@@projects.project-detail.budget.17ebfd3e">
            <i class="pi pi-wallet"></i> Budget
          </p-tab>
          @if (showProfitabilityTab(p)) {
          <p-tab value="profitability" [class.proj-tab-emphasis]="isEmphasizedTab('profitability')" i18n="@@projects.project-detail.rentabilite.77f947d4">
            <i class="pi pi-chart-line"></i> Rentabilité
          </p-tab>
          }
          <p-tab value="team" [class.proj-tab-emphasis]="isEmphasizedTab('team')" i18n="@@projects.project-detail.equipe.b7cb3db3">
            <i class="pi pi-users"></i> Équipe
          </p-tab>
          <p-tab value="files" [class.proj-tab-emphasis]="isEmphasizedTab('files')" i18n="@@projects.project-detail.fichiers.5ff136ad">
            <i class="pi pi-folder"></i> Fichiers
          </p-tab>
          <p-tab value="billing" [class.proj-tab-emphasis]="isEmphasizedTab('billing')" i18n="@@projects.project-detail.facturation.2e05f350">
            <i class="pi pi-file"></i> Facturation
          </p-tab>
          <p-tab value="activity" [class.proj-tab-emphasis]="isEmphasizedTab('activity')" i18n="@@projects.project-detail.activite.79339f80">
            <i class="pi pi-history"></i> Activité
          </p-tab>
          <p-tab value="settings" i18n="@@projects.project-detail.parametres.2de39beb">
            <i class="pi pi-cog"></i> Paramètres
          </p-tab>
        </p-tablist>
        <p-tabpanels>
          <p-tabpanel value="overview">
            <app-project-overview-tab
              [project]="p"
              [budget]="budget()"
              [tasks]="tasks()"
              [members]="members()"
              [users]="users()"
              [activities]="activities()"
              (viewBudget)="goTab('budget')"
              (viewTeam)="goTab('team')"
              (viewActivity)="goTab('activity')" />
          </p-tabpanel>
          <p-tabpanel value="tasks">
            <app-project-tasks-tab
              [project]="p"
              [tasks]="tasks()"
              [users]="users()"
              [canCreate]="canCreateTask"
              [canUpdateTask]="canUpdateTask"
              [canCreateTime]="canCreateTime"
              (create)="createTask($event)"
              (move)="moveTask($event)"
              (refresh)="reloadTasks()"
              (logTime)="logTimeFromTasks($event)" />
          </p-tabpanel>
          @if (showTimeTab(p)) {
          <p-tabpanel value="time">
            <app-project-time-tab [project]="p" [entries]="timeEntries()" [tasks]="tasks()"
              [canCreate]="canCreateTime" [canSubmit]="canSubmitTime" [canValidate]="canValidateTime"
              [canActivate]="canUpdate" (create)="createTime($event)" (updateEntry)="updateTime($event)"
              (filterChange)="onTimeFilter($event)" (submitEntry)="submitTime($event)"
              (validateEntry)="validateTime($event)" (deleteEntry)="deleteTime($event)"
              (reopenEntry)="reopenTime($event)" (activate)="activate()" />
          </p-tabpanel>
          }
          <p-tabpanel value="budget">
            <app-project-budget-tab [project]="p" [budget]="budget()" [costs]="costs()" [products]="products()"
              [purchaseOrders]="purchaseOrders()" [linkedPurchaseOrders]="linkedPurchaseOrders()"
              [canUpdate]="canUpdate" (cost)="addCost($event)"
              (stockExit)="stockExit($event)" (assignPurchaseOrder)="assignPurchaseOrder($event)" />
          </p-tabpanel>
          @if (showProfitabilityTab(p)) {
          <p-tabpanel value="profitability">
            <app-project-profitability-tab [project]="p" />
          </p-tabpanel>
          }
          <p-tabpanel value="team">
            <app-project-team-tab [project]="p" [members]="members()" [users]="users()" [workload]="workload()"
              [canManage]="canManageTeam" (addMember)="addMember($event)" (updateMember)="updateMember($event)"
              (remove)="removeMember($event)" />
          </p-tabpanel>
          <p-tabpanel value="files">
            <app-project-files-tab [files]="files()" [comments]="comments()" [canUpdate]="canUpdate"
              (upload)="uploadFile($event)" (download)="downloadFile($event)" (remove)="deleteFile($event)"
              (comment)="addComment($event)" />
          </p-tabpanel>
          <p-tabpanel value="billing">
            <app-project-billing-tab [project]="p" [readiness]="readiness()" [billableTasks]="billableTasks()"
              [billableTimeEntries]="billableTimeEntries()"
              [milestones]="milestones()"
              [situations]="situations()" [subs]="subs()" [suppliers]="suppliers()"
              [canBill]="canCreateBilling" [canUpdate]="canUpdate"
              [invoicesRefreshToken]="billingRefreshToken()"
              (activate)="activate()" (invoiceTime)="invoiceTime($event)" (invoiceTasks)="invoiceTasks($event)"
              (invoiceDraftLoadError)="onInvoiceDraftLoadError($event)"
              (refreshBillableTasks)="loadBillableTasks($event)" (refreshBillableTimeEntries)="loadBillableTimeEntries()"
              (invoiceFixedPrice)="invoiceFixedPrice($event)"
              (addMilestone)="addMilestone($event)" (invoiceMilestone)="invoiceMilestone($event)"
              (addSituation)="addSituation($event)" (updateSituation)="updateSituation($event)"
              (validateSituation)="validateSituation($event)" (invoiceSituation)="invoiceSituation($event)"
              (addSubcontractor)="addSubcontractor($event)" (updateSubcontractor)="updateSubcontractor($event)" />
          </p-tabpanel>
          <p-tabpanel value="activity">
            <app-project-activity-tab [activities]="activities()" [users]="users()" />
          </p-tabpanel>
          <p-tabpanel value="settings">
            <app-project-settings-tab
              [project]="p"
              [canUpdate]="canUpdate"
              (save)="saveSettings($event)" />
          </p-tabpanel>
        </p-tabpanels>
      </p-tabs>
        </div>
        @if (showSidebar()) {
          <app-project-summary-sidebar
            [project]="p"
            [budget]="budget()"
            [tasks]="tasks()"
            [activities]="activities()" />
        }
      </div>
    }

    <p-dialog [(visible)]="editVisible" header="Modifier le projet" i18n-header="@@projects.project-detail.modifier.le.projet.64e99f20" [modal]="true" [style]="{ width: '52rem' }">
      <app-form-section title="Identité" i18n-title="@@projects.project-detail.identite.3138be1c" icon="pi-id-card" variant="compact">
        <div class="flex flex-column gap-3">
          <label><ng-container i18n="@@projects.project-detail.nom.7ff20370">Nom </ng-container> <input pInputText class="w-full" [(ngModel)]="editDraft.name" /></label>
          <label><ng-container i18n="@@projects.project-detail.type.3deb7456">Type
            </ng-container><input pInputText class="w-full" [value]="project()?.kindDisplay" readonly />
          </label>
          <label><ng-container i18n="@@projects.project-detail.description.55f8ebc8">Description </ng-container> <textarea pTextarea class="w-full" rows="2" [(ngModel)]="editDraft.description"></textarea></label>
          <label><ng-container i18n="@@projects.project-detail.chef.de.projet.7a1d6008">Chef de projet
            </ng-container><p-select class="w-full" [options]="users()" [(ngModel)]="editDraft.ownerUserId" optionLabel="displayName" optionValue="id" [showClear]="true" />
          </label>
          <div class="flex gap-2">
            <label class="flex-1"><ng-container i18n="@@projects.project-detail.debut.f0955314">Début </ng-container> <p-datepicker class="w-full" [(ngModel)]="editStart" dateFormat="dd/mm/yy" /></label>
            <label class="flex-1"><ng-container i18n="@@projects.project-detail.fin.4251065f">Fin </ng-container> <p-datepicker class="w-full" [(ngModel)]="editEnd" dateFormat="dd/mm/yy" /></label>
          </div>
          <label><ng-container i18n="@@projects.project-detail.budget.ht.0374a3ad">Budget HT </ng-container> <p-inputNumber class="w-full" [(ngModel)]="editDraft.budgetHt" mode="decimal" [minFractionDigits]="3" /></label>
        </div>
      </app-form-section>
      @if (project() && isBtp(project()!.kind)) {
        <app-form-section title="Chantier BTP" i18n-title="@@projects.project-detail.chantier.btp.20419af9" icon="pi-building" variant="compact">
          <div class="flex flex-column gap-3">
            <label><ng-container i18n="@@projects.project-detail.adresse.chantier.62e0d1f1">Adresse chantier </ng-container> <input pInputText class="w-full" [(ngModel)]="editDraft.siteAddress" /></label>
            <label><ng-container i18n="@@projects.project-detail.n.marche.6eb7d3b6">N° marché </ng-container> <input pInputText class="w-full" [(ngModel)]="editDraft.contractNumber" /></label>
          </div>
        </app-form-section>
      }
      <ng-template pTemplate="footer">
        <app-button variant="secondary" (click)="editVisible = false" i18n="@@projects.project-detail.annuler.49ba3292">Annuler</app-button>
        <app-button variant="primary" (click)="saveEdit()" i18n="@@projects.project-detail.enregistrer.f7c8bcd8">Enregistrer</app-button>
      </ng-template>
    </p-dialog>
  `,
})
export class ProjectDetailComponent implements OnInit {
  private readonly api = inject(ProjectApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly errors = inject(ErrorHandlerService);
  private readonly confirm = inject(ConfirmationService);
  private readonly productsApi = inject(ProductService);
  private readonly purchaseOrdersApi = inject(PurchaseOrderService);
  private readonly suppliersApi = inject(SupplierService);
  private readonly favorites = inject(ProjectFavoritesService);

  readonly project = signal<ProjectDetail | null>(null);
  readonly tasks = signal<ProjectTask[]>([]);
  readonly timeEntries = signal<ProjectTimeEntry[]>([]);
  readonly budget = signal<ProjectBudget | null>(null);
  readonly costs = signal<ProjectCostLine[]>([]);
  readonly members = signal<ProjectMember[]>([]);
  readonly users = signal<ProjectAssignableUser[]>([]);
  readonly comments = signal<ProjectComment[]>([]);
  readonly files = signal<ProjectAttachment[]>([]);
  readonly activities = signal<ProjectActivity[]>([]);
  readonly milestones = signal<ProjectMilestone[]>([]);
  readonly situations = signal<ProjectSituation[]>([]);
  readonly subs = signal<ProjectSubcontractor[]>([]);
  readonly workload = signal<ProjectWorkloadRow[]>([]);
  readonly readiness = signal<ProjectBillingReadiness | null>(null);
  readonly billingRefreshToken = signal(0);
  readonly billableTasks = signal<BillableProjectTask[]>([]);
  readonly billableTimeEntries = signal<BillableProjectTimeEntry[]>([]);
  readonly products = signal<ProductOption[]>([]);
  readonly purchaseOrders = signal<ProductOption[]>([]);
  readonly linkedPurchaseOrders = signal<ProjectPurchaseOrder[]>([]);
  readonly suppliers = signal<SupplierOption[]>([]);
  readonly tab = signal<TabKey>('overview');
  private id = '';
  editVisible = false;
  editStart: Date | null = null;
  editEnd: Date | null = null;
  editDraft: UpsertProjectPayload = {
    clientId: '', name: '', kind: 'Generic', billingMode: 'None', budgetHt: 0,
    timesheetsEnabled: true, milestonesEnabled: false, allocatedHours: 0, analyticAccountCode: null
  };
  timeFrom?: string;
  timeTo?: string;
  timeStatus?: string;
  readonly canActivate = canActivate;
  readonly canHold = canHold;
  readonly canComplete = canComplete;
  readonly canCancel = canCancel;
  readonly canEditProject = canEditProject;
  readonly isBtp = isBtp;
  readonly statusBadge = projectStatusBadge;

  uiProfile(kind: ProjectDetail['kind']) {
    return projectUiProfile(kind);
  }

  isEmphasizedTab(key: TabKey): boolean {
    const p = this.project();
    if (!p) return false;
    return projectUiProfile(p.kind).emphasizeTabs.includes(key);
  }

  isFavorite(id: string): boolean {
    return this.favorites.isFavorite(id);
  }

  toggleFavorite(id: string): void {
    this.favorites.toggle(id);
  }

  get canUpdate(): boolean { return this.auth.hasPermission(PERMISSIONS.projects.update); }
  get canCreateTask(): boolean { return this.auth.hasPermission(PERMISSIONS.projectTasks.create); }
  get canUpdateTask(): boolean { return this.auth.hasPermission(PERMISSIONS.projectTasks.update); }
  get canCreateTime(): boolean { return this.auth.hasPermission(PERMISSIONS.projectTime.create); }
  get canSubmitTime(): boolean { return this.auth.hasPermission(PERMISSIONS.projectTime.submit); }
  get canValidateTime(): boolean { return this.auth.hasPermission(PERMISSIONS.projectTime.validate); }
  get canManageTeam(): boolean { return this.auth.hasPermission(PERMISSIONS.projects.manageTeam); }
  get canCreateBilling(): boolean { return this.auth.hasPermission(PERMISSIONS.projectBilling.create); }

  readonly showTimeTab = showTimeTab;
  readonly showProfitabilityTab = showProfitabilityTab;

  breadcrumbItems(): BreadcrumbItem[] {
    return [
      { label: $localize`:@@projects.project-detail.ts.accueil.a8ff8fd2:Accueil`, route: '/' },
      { label: $localize`:@@projects.project-detail.ts.projets.b1e8cd4d:Projets`, route: '/projects' },
      { label: this.project()?.name ?? $localize`:@@ui.tern.fiche.6ad303:Fiche` }
    ];
  }

  showSidebar(): boolean {
    const t = this.tab();
    return t !== 'overview' && t !== 'activity';
  }

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    const initialTab = this.route.snapshot.queryParamMap.get('tab') as TabKey | null;
    if (initialTab && ['overview', 'tasks', 'time', 'budget', 'profitability', 'team', 'files', 'billing', 'activity', 'settings'].includes(initialTab)) {
      this.tab.set(initialTab);
    }
    this.api.users().subscribe(r => { if (r.success && r.data) this.users.set(r.data); });
    this.reloadProject();
    this.loadTab(this.tab());
  }

  onTab(value: string | number): void {
    this.goTab(String(value) as TabKey);
  }

  goTab(key: TabKey): void {
    this.tab.set(key);
    void this.router.navigate([], { relativeTo: this.route, queryParams: { tab: key }, queryParamsHandling: 'merge', replaceUrl: true });
    this.loadTab(key);
  }

  goList(): void {
    void this.router.navigate(['/projects']);
  }

  private fail(err: unknown, fallback: string): void {
    this.toast.add({ severity: 'error', summary: fallback, detail: this.errors.extractErrorMessage(err) });
  }

  private ok(summary: string, detail?: string): void {
    this.toast.add({ severity: 'success', summary, detail });
  }

  private reloadProject(): void {
    this.api.get(this.id).subscribe({
      next: r => {
        if (r.success && r.data) {
          this.project.set(r.data);
          if (this.tab() === 'time' && !showTimeTab(r.data)) {
            this.goTab('overview');
          }
          if (this.tab() === 'profitability' && !showProfitabilityTab(r.data)) {
            this.goTab('overview');
          }
        }
      },
      error: err => this.fail(err, $localize`:@@projects.project-detail.ts.chargement.du.projet.ddfdc00f:Chargement du projet`)
    });
    this.api.budget(this.id).subscribe({
      next: r => { if (r.success && r.data) this.budget.set(r.data); },
      error: () => { /* optional KPI */ }
    });
    this.api.tasks(this.id).subscribe({
      next: r => { if (r.success && r.data) this.tasks.set(r.data); },
      error: () => { /* KPI */ }
    });
  }

  private loadTab(tab: TabKey): void {
    switch (tab) {
      case 'overview':
        this.api.activity(this.id).subscribe(r => { if (r.success && r.data) this.activities.set(r.data); });
        this.api.members(this.id).subscribe(r => { if (r.success && r.data) this.members.set(r.data); });
        break;
      case 'activity':
        this.api.activity(this.id).subscribe(r => { if (r.success && r.data) this.activities.set(r.data); });
        break;
      case 'tasks':
        this.api.tasks(this.id).subscribe(r => { if (r.success && r.data) this.tasks.set(r.data); });
        break;
      case 'time':
        this.api.time({
          projectId: this.id,
          from: this.timeFrom,
          to: this.timeTo,
          status: this.timeStatus
        }).subscribe({
          next: r => { if (r.success && r.data) this.timeEntries.set(r.data); },
          error: err => this.fail(err, $localize`:@@projects.project-detail.ts.temps.2986a8c2:Temps`)
        });
        this.api.tasks(this.id).subscribe(r => { if (r.success && r.data) this.tasks.set(r.data); });
        break;
      case 'budget':
        this.api.budget(this.id).subscribe(r => { if (r.success && r.data) this.budget.set(r.data); });
        this.api.costs(this.id).subscribe(r => { if (r.success && r.data) this.costs.set(r.data); });
        if (this.project() && isBtp(this.project()!.kind) && this.products().length === 0) {
          this.productsApi.getProducts({ isActive: true, page: 1, pageSize: 80 }).subscribe(r => {
            if (r.success && r.data) this.products.set(r.data.items.map(i => ({ id: i.id, name: `${i.code} — ${i.name}` })));
          });
        }
        this.api.listPurchaseOrders(this.id).subscribe({
          next: linkedRes => {
            const linked = linkedRes.success && linkedRes.data ? linkedRes.data : [];
            this.linkedPurchaseOrders.set(linked);
            const linkedIds = new Set(linked.map(p => p.id));
            this.purchaseOrdersApi.getPurchaseOrders({ page: 1, pageSize: 80 }).subscribe({
              next: r => {
                if (r.success && r.data) {
                  this.purchaseOrders.set(
                    r.data.items
                      .filter(i => i.status !== PurchaseOrderStatus.Cancelled && !linkedIds.has(i.id))
                      .map(i => ({ id: i.id, name: `${i.number} — ${i.supplierName}` }))
                  );
                }
              },
              error: () => this.purchaseOrders.set([])
            });
          },
          error: () => {
            this.linkedPurchaseOrders.set([]);
            this.purchaseOrdersApi.getPurchaseOrders({ page: 1, pageSize: 80 }).subscribe({
              next: r => {
                if (r.success && r.data) {
                  this.purchaseOrders.set(
                    r.data.items
                      .filter(i => i.status !== PurchaseOrderStatus.Cancelled)
                      .map(i => ({ id: i.id, name: `${i.number} — ${i.supplierName}` }))
                  );
                }
              },
              error: () => this.purchaseOrders.set([])
            });
          }
        });
        break;
      case 'profitability':
        break;
      case 'team':
        this.api.members(this.id).subscribe(r => { if (r.success && r.data) this.members.set(r.data); });
        this.api.workload(this.id).subscribe(r => { if (r.success && r.data) this.workload.set(r.data); });
        break;
      case 'files':
        this.api.attachments(this.id).subscribe(r => { if (r.success && r.data) this.files.set(r.data); });
        this.api.comments(this.id).subscribe(r => { if (r.success && r.data) this.comments.set(r.data); });
        break;
      case 'billing':
        this.billingRefreshToken.update(t => t + 1);
        this.api.billingReadiness(this.id).subscribe({
          next: r => { if (r.success && r.data) this.readiness.set(r.data); },
          error: err => this.fail(err, $localize`:@@projects.project-detail.ts.facturation.04716c6b:Facturation`)
        });
        this.api.milestones(this.id).subscribe(r => { if (r.success && r.data) this.milestones.set(r.data); });
        this.api.situations(this.id).subscribe(r => { if (r.success && r.data) this.situations.set(r.data); });
        this.api.subcontractors(this.id).subscribe(r => { if (r.success && r.data) this.subs.set(r.data); });
        this.loadBillableTimeEntries();
        if (this.suppliers().length === 0) {
          this.suppliersApi.getSuppliers({ page: 1, pageSize: 80, isActive: true }).subscribe(r => {
            if (r.success && r.data) this.suppliers.set(r.data.items.map(s => ({ id: s.id, name: s.name })));
          });
        }
        break;
    }
  }

  activate(): void {
    this.api.activate(this.id).subscribe({
      next: () => { this.ok($localize`:@@projects.project-detail.ts.projet.active.403f7aff:Projet activé`, $localize`:@@projects.project-detail.ts.vous.pouvez.saisir.du.temps.93741395:Vous pouvez saisir du temps.`); this.reloadProject(); this.loadTab(this.tab()); },
      error: err => this.fail(err, $localize`:@@projects.project-detail.ts.activation.impossible.819a2a55:Activation impossible`)
    });
  }

  hold(): void {
    this.confirm.confirm({
      header: $localize`:@@projects.project-detail.ts.mettre.en.pause.4515da4b:Mettre en pause`,
      message: $localize`:@@projects.project-detail.ts.le.projet.ne.pourra.plus.recevoir.de.tem.1d586a98:Le projet ne pourra plus recevoir de temps tant qu’il est en pause. Continuer ?`,
      accept: () => this.api.hold(this.id).subscribe({
        next: () => { this.ok('Projet en pause'); this.reloadProject(); },
        error: err => this.fail(err, $localize`:@@projects.project-detail.ts.mise.en.pause.impossible.5290422f:Mise en pause impossible`)
      })
    });
  }

  complete(): void {
    this.confirm.confirm({
      header: $localize`:@@projects.project-detail.ts.cloturer.le.projet.9fdfb3ff:Clôturer le projet`,
      message: $localize`:@@projects.project-detail.ts.validez.ou.annulez.les.temps.ouverts.ava.8dddb315:Validez ou annulez les temps ouverts avant de clôturer. Aucune nouvelle saisie de temps ne sera possible.`,
      accept: () => this.api.complete(this.id).subscribe({
        next: () => { this.ok($localize`:@@projects.project-detail.ts.projet.cloture.428e3461:Projet clôturé`); this.reloadProject(); },
        error: err => this.fail(err, $localize`:@@projects.project-detail.ts.cloture.impossible.9bf627fc:Clôture impossible`)
      })
    });
  }

  cancel(): void {
    this.confirm.confirm({
      header: $localize`:@@projects.project-detail.ts.annuler.le.projet.492bf989:Annuler le projet`,
      message: $localize`:@@projects.project-detail.ts.cette.action.est.irreversible.le.projet.1543b7c7:Cette action est irréversible. Le projet passera au statut Annulé.`,
      accept: () => this.api.cancel(this.id).subscribe({
        next: () => { this.ok($localize`:@@projects.project-detail.ts.projet.annule.15dcb18a:Projet annulé`); this.reloadProject(); },
        error: err => this.fail(err, $localize`:@@projects.project-detail.ts.annulation.impossible.54c16533:Annulation impossible`)
      })
    });
  }

  openEdit(): void {
    const p = this.project();
    if (!p) return;
    this.editDraft = {
      clientId: p.clientId,
      name: p.name,
      description: p.description,
      kind: parseProjectKind(p.kind) ?? 'Generic',
      billingMode: parseProjectBillingMode(p.billingMode) ?? 'None',
      budgetHt: p.budgetHt,
      ownerUserId: p.ownerUserId,
      siteAddress: p.siteAddress,
      contractNumber: p.contractNumber,
      timesheetsEnabled: p.timesheetsEnabled,
      milestonesEnabled: p.milestonesEnabled ?? false,
      allocatedHours: p.allocatedHours ?? 0,
      analyticAccountCode: p.analyticAccountCode ?? null
    };
    this.editStart = p.startDate ? new Date(p.startDate) : null;
    this.editEnd = p.endDate ? new Date(p.endDate) : null;
    this.editVisible = true;
  }

  saveEdit(): void {
    this.api.update(this.id, this.buildUpdatePayload(this.editDraft, {
      startDate: toIsoDate(this.editStart),
      endDate: toIsoDate(this.editEnd),
      ownerUserId: this.editDraft.ownerUserId || null
    })).subscribe({
      next: r => {
        if (r.success) { this.editVisible = false; this.ok($localize`:@@projects.project-detail.ts.projet.mis.a.jour.cc40b018:Projet mis à jour`); this.reloadProject(); }
        else this.toast.add({ severity: 'error', summary: $localize`:@@project-detail.component.summary.Mise à jour :Mise à jour impossible`, detail: r.message || '' });
      },
      error: err => this.fail(err, $localize`:@@projects.project-detail.ts.mise.a.jour.impossible.56d51741:Mise à jour impossible`)
    });
  }

  saveSettings(settings: ProjectSettingsPayload): void {
    const p = this.project();
    if (!p) return;
    const payload = this.buildUpdatePayload({
      clientId: p.clientId,
      name: p.name,
      description: p.description,
      kind: parseProjectKind(p.kind) ?? 'Generic',
      billingMode: settings.billingMode,
      budgetHt: p.budgetHt,
      ownerUserId: p.ownerUserId,
      siteAddress: p.siteAddress,
      contractNumber: p.contractNumber,
      timesheetsEnabled: settings.timesheetsEnabled,
      milestonesEnabled: settings.milestonesEnabled,
      allocatedHours: settings.allocatedHours,
      analyticAccountCode: p.analyticAccountCode ?? null,
      startDate: p.startDate,
      endDate: p.endDate
    });
    this.api.update(this.id, payload).subscribe({
      next: r => {
        if (r.success) {
          this.ok($localize`:@@projects.project-detail.ts.parametres.enregistres.904f75c6:Paramètres enregistrés`);
          this.reloadProject();
          this.loadTab('settings');
        } else {
          this.toast.add({ severity: 'error', summary: $localize`:@@project-detail.component.summary.Enregistrement_i:Enregistrement impossible`, detail: r.message || '' });
        }
      },
      error: err => this.fail(err, $localize`:@@projects.project-detail.ts.enregistrement.impossible.1e5e1075:Enregistrement impossible`)
    });
  }

  private buildUpdatePayload(
    draft: UpsertProjectPayload,
    overrides: Partial<UpsertProjectPayload> = {}
  ): UpsertProjectPayload {
    const merged = { ...draft, ...overrides };
    return {
      ...merged,
      ownerUserId: merged.ownerUserId || null,
      analyticAccountCode: merged.analyticAccountCode?.trim() || null
    };
  }

  createTask(payload: UpsertTaskPayload): void {
    this.api.createTask(this.id, payload).subscribe({
      next: () => { this.ok($localize`:@@projects.project-detail.ts.tache.creee.80944c5c:Tâche créée`); this.loadTab('tasks'); this.reloadProject(); },
      error: err => this.fail(err, $localize`:@@projects.project-detail.ts.creation.de.tache.bb7a1e72:Création de tâche`)
    });
  }

  moveTask(ev: { taskId: string; phaseId: string; status?: ProjectTaskStatusCode }): void {
    this.api.moveTask(ev.taskId, ev.phaseId, ev.status).subscribe({
      next: () => {
        this.ok($localize`:@@projects.project-detail.ts.tache.deplacee.940d5262:Tâche déplacée`);
        this.reloadTasks();
        this.reloadProject();
      },
      error: err => {
        this.fail(err, $localize`:@@projects.project-detail.ts.deplacement.impossible.bafa84d7:Déplacement impossible`);
        this.reloadTasks();
      }
    });
  }

  createTime(payload: CreateTimePayload): void {
    this.api.createTime(payload).subscribe({
      next: () => {
        this.ok($localize`:@@projects.project-detail.ts.temps.enregistre.24b97877:Temps enregistré`);
        if (this.tab() === 'tasks') {
          this.reloadTasks();
        } else {
          this.loadTab('time');
        }
        this.reloadProject();
      },
      error: err => this.fail(err, $localize`:@@projects.project-detail.ts.saisie.des.temps.86f92f4d:Saisie des temps`)
    });
  }

  logTimeFromTasks(payload: CreateTimePayload): void {
    this.createTime(payload);
  }

  reloadTasks(): void {
    this.api.tasks(this.id).subscribe({
      next: r => { if (r.success && r.data) this.tasks.set(r.data); },
      error: err => this.fail(err, $localize`:@@projects.project-detail.ts.actualisation.des.taches.6f209c72:Actualisation des tâches`)
    });
  }

  onTimeFilter(filters: TimeFilterPayload): void {
    this.timeFrom = filters.from;
    this.timeTo = filters.to;
    this.timeStatus = filters.status;
    this.loadTab('time');
  }

  updateTime(ev: { id: string; payload: CreateTimePayload }): void {
    this.api.updateTime(ev.id, ev.payload).subscribe({
      next: () => { this.ok($localize`:@@projects.project-detail.ts.temps.mis.a.jour.72c2292d:Temps mis à jour`); this.loadTab('time'); },
      error: err => this.fail(err, $localize`:@@projects.project-detail.ts.mise.a.jour.du.temps.b1bc9449:Mise à jour du temps`)
    });
  }

  submitTime(id: string): void {
    this.api.submitTime(id).subscribe({
      next: () => { this.ok($localize`:@@projects.project-detail.ts.temps.soumis.106b6c0f:Temps soumis`); this.loadTab('time'); },
      error: err => this.fail(err, $localize`:@@projects.project-detail.ts.soumission.impossible.fd1d13ac:Soumission impossible`)
    });
  }

  validateTime(id: string): void {
    this.api.validateTime(id).subscribe({
      next: () => { this.ok($localize`:@@projects.project-detail.ts.temps.valide.e19f0e51:Temps validé`); this.loadTab('time'); this.reloadProject(); },
      error: err => this.fail(err, $localize`:@@projects.project-detail.ts.validation.impossible.8b8efd73:Validation impossible`)
    });
  }

  deleteTime(id: string): void {
    this.api.deleteTime(id).subscribe({
      next: () => { this.ok($localize`:@@projects.project-detail.ts.temps.supprime.65a2ed13:Temps supprimé`); this.loadTab('time'); },
      error: err => this.fail(err, $localize`:@@projects.project-detail.ts.suppression.impossible.55762ff2:Suppression impossible`)
    });
  }

  reopenTime(id: string): void {
    this.api.reopenTime(id).subscribe({
      next: () => { this.ok($localize`:@@projects.project-detail.ts.temps.rouvert.en.brouillon.358ffbbe:Temps rouvert en brouillon`); this.loadTab('time'); this.reloadProject(); },
      error: err => this.fail(err, $localize`:@@projects.project-detail.ts.reouverture.impossible.a7bf0a97:Réouverture impossible`)
    });
  }

  addCost(payload: { description: string; amountHt: number; occurredOn: string }): void {
    this.api.addCost(this.id, payload).subscribe({
      next: () => { this.ok($localize`:@@projects.project-detail.ts.cout.ajoute.3cbd4c44:Coût ajouté`); this.loadTab('budget'); this.reloadProject(); },
      error: err => this.fail(err, $localize`:@@projects.project-detail.ts.cout.4a4aa395:Coût`)
    });
  }

  stockExit(payload: { productId: string; quantity: number; warehouseId?: string; notes?: string }): void {
    this.api.stockExit(this.id, payload).subscribe({
      next: () => { this.ok($localize`:@@projects.project-detail.ts.sortie.de.stock.81497eb8:Sortie de stock`); this.loadTab('budget'); this.reloadProject(); },
      error: err => this.fail(err, $localize`:@@projects.project-detail.ts.sortie.stock.a8d04156:Sortie stock`)
    });
  }

  assignPurchaseOrder(purchaseOrderId: string): void {
    this.api.assignPurchaseOrder(this.id, purchaseOrderId).subscribe({
      next: () => { this.ok($localize`:@@projects.project-detail.ts.bon.de.commande.associe.17b33d38:Bon de commande associé`); this.loadTab('budget'); },
      error: err => this.fail(err, $localize`:@@projects.project-detail.ts.association.bon.de.commande.a5fd8617:Association bon de commande`)
    });
  }

  addMember(payload: UpsertMemberPayload): void {
    this.api.addMember(this.id, payload).subscribe({
      next: () => { this.ok($localize`:@@projects.project-detail.ts.membre.ajoute.59aa3977:Membre ajouté`); this.loadTab('team'); },
      error: err => this.fail(err, $localize`:@@projects.project-detail.ts.equipe.1a7daffc:Équipe`)
    });
  }

  updateMember(ev: { id: string; payload: UpsertMemberPayload }): void {
    this.api.updateMember(ev.id, ev.payload).subscribe({
      next: () => { this.ok($localize`:@@projects.project-detail.ts.membre.mis.a.jour.fa733353:Membre mis à jour`); this.loadTab('team'); },
      error: err => this.fail(err, $localize`:@@projects.project-detail.ts.equipe.1a7daffc:Équipe`)
    });
  }

  removeMember(id: string): void {
    this.confirm.confirm({
      header: $localize`:@@projects.project-detail.ts.retirer.le.membre.609e13cf:Retirer le membre`,
      message: $localize`:@@projects.project-detail.ts.retirer.cette.personne.de.l.equipe.du.pr.2e97fa97:Retirer cette personne de l’équipe du projet ?`,
      accept: () => this.api.removeMember(id).subscribe({
        next: () => { this.ok($localize`:@@projects.project-detail.ts.membre.retire.1bbbee73:Membre retiré`); this.loadTab('team'); },
        error: err => this.fail(err, $localize`:@@projects.project-detail.ts.equipe.1a7daffc:Équipe`)
      })
    });
  }

  uploadFile(file: File): void {
    this.api.uploadAttachment(this.id, file).subscribe({
      next: () => { this.ok($localize`:@@projects.project-detail.ts.fichier.ajoute.a1c4743f:Fichier ajouté`); this.loadTab('files'); },
      error: err => this.fail(err, $localize`:@@projects.project-detail.ts.televersement.02766189:Téléversement`)
    });
  }

  downloadFile(f: ProjectAttachment): void {
    this.api.downloadAttachment(this.id, f.id).subscribe({
      next: blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = f.fileName;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: err => this.fail(err, $localize`:@@projects.project-detail.ts.telechargement.de2a6733:Téléchargement`)
    });
  }

  deleteFile(id: string): void {
    this.api.deleteAttachment(this.id, id).subscribe({
      next: () => { this.ok($localize`:@@projects.project-detail.ts.fichier.supprime.c57ed83a:Fichier supprimé`); this.loadTab('files'); },
      error: err => this.fail(err, $localize`:@@projects.project-detail.ts.suppression.c3b592c0:Suppression`)
    });
  }

  addComment(body: string): void {
    this.api.addComment(this.id, body).subscribe({
      next: () => this.loadTab('files'),
      error: err => this.fail(err, $localize`:@@projects.project-detail.ts.commentaire.bcb916ab:Commentaire`)
    });
  }

  onInvoiceDraftLoadError(message: string): void {
    this.toast.add({ severity: 'error', summary: $localize`:@@project-detail.component.summary.Facturation:Facturation`, detail: message });
  }

  invoiceTime(ev: { groupBy: string; notes?: string; timeEntryIds: string[]; targetInvoiceId?: string }): void {
    this.api.invoiceTime(this.id, ev.timeEntryIds, ev.notes, ev.targetInvoiceId).subscribe({
      next: r => {
        if (r.success && r.data) {
          this.loadBillableTimeEntries();
          this.api.billingReadiness(this.id).subscribe({
            next: res => { if (res.success && res.data) this.readiness.set(res.data); }
          });
          void this.router.navigate(['/invoices', r.data.invoiceId]);
        } else {
          this.toast.add({ severity: 'error', summary: $localize`:@@project-detail.component.summary.Facturation_impo:Facturation impossible`, detail: r.message || '' });
        }
      },
      error: err => this.fail(err, $localize`:@@projects.project-detail.ts.facturation.impossible.b7ff7da0:Facturation impossible`)
    });
  }

  loadBillableTimeEntries(): void {
    this.api.billableTimeEntries(this.id).subscribe({
      next: r => { if (r.success && r.data) this.billableTimeEntries.set(r.data); },
      error: err => this.fail(err, 'Temps facturables')
    });
  }

  loadBillableTasks(method: 'fixed' | 'hourly'): void {
    this.api.billableTasks(this.id, method).subscribe({
      next: r => { if (r.success && r.data) this.billableTasks.set(r.data); },
      error: err => this.fail(err, $localize`:@@projects.project-detail.ts.taches.facturables.221e2ffd:Tâches facturables`)
    });
  }

  invoiceTasks(ev: { method: 'fixed' | 'hourly'; notes?: string; tasks: { taskId: string; amountHt?: number; hourlyRate?: number }[]; targetInvoiceId?: string }): void {
    this.api.invoiceTasks(this.id, ev.method, ev.tasks, ev.notes, ev.targetInvoiceId).subscribe({
      next: r => {
        if (r.success && r.data) {
          this.loadBillableTasks(ev.method);
          void this.router.navigate(['/invoices', r.data.invoiceId]);
        } else {
          this.toast.add({ severity: 'error', summary: $localize`:@@project-detail.component.summary.Facturation_par_:Facturation par tâche`, detail: r.message || '' });
        }
      },
      error: err => this.fail(err, $localize`:@@projects.project-detail.ts.facturation.par.tache.90c6a5e5:Facturation par tâche`)
    });
  }

  invoiceFixedPrice(ev: { amountHt: number; notes?: string }): void {
    this.api.invoiceFixedPrice(this.id, ev.amountHt, ev.notes).subscribe({
      next: r => {
        if (r.success && r.data) {
          this.ok($localize`:@@projects.project-detail.ts.forfait.facture.80798c53:Forfait facturé`);
          void this.router.navigate(['/invoices', r.data.invoiceId]);
        } else {
          this.toast.add({ severity: 'error', summary: $localize`:@@project-detail.component.summary.Facturation_forf:Facturation forfait`, detail: r.message || '' });
        }
      },
      error: err => this.fail(err, $localize`:@@projects.project-detail.ts.facturation.forfait.8b13aef4:Facturation forfait`)
    });
  }

  addMilestone(payload: { name: string; percent: number; amountHt: number; dueDate?: string | null }): void {
    this.api.addMilestone(this.id, payload).subscribe({
      next: () => { this.ok($localize`:@@projects.project-detail.ts.jalon.ajoute.34f35689:Jalon ajouté`); this.loadTab('billing'); },
      error: err => this.fail(err, $localize`:@@projects.project-detail.ts.jalon.6e891b2f:Jalon`)
    });
  }

  invoiceMilestone(id: string): void {
    this.api.invoiceMilestone(this.id, id).subscribe({
      next: r => { if (r.success && r.data) void this.router.navigate(['/invoices', r.data.invoiceId]); },
      error: err => this.fail(err, 'Facturation jalon')
    });
  }

  addSituation(payload: {
    periodStart: string; periodEnd: string; cumulativePercent: number;
    grossAmountHt: number; retainageAmountHt: number; vatRatePercent: number;
  }): void {
    this.api.createSituation(this.id, payload).subscribe({
      next: () => { this.ok($localize`:@@projects.project-detail.ts.situation.creee.fb6f4616:Situation créée`); this.loadTab('billing'); },
      error: err => this.fail(err, 'Situation')
    });
  }

  validateSituation(id: string): void {
    this.confirm.confirm({
      header: $localize`:@@projects.project-detail.ts.valider.la.situation.713df0b8:Valider la situation`,
      message: $localize`:@@projects.project-detail.ts.une.situation.validee.ne.pourra.plus.etr.186a9faa:Une situation validée ne pourra plus être modifiée. Continuer ?`,
      accept: () => this.api.validateSituation(id).subscribe({
        next: () => { this.ok($localize`:@@projects.project-detail.ts.situation.validee.5d6e9925:Situation validée`); this.loadTab('billing'); },
        error: err => this.fail(err, 'Validation situation')
      })
    });
  }

  updateSituation(ev: {
    id: string;
    payload: {
      periodStart: string;
      periodEnd: string;
      cumulativePercent: number;
      grossAmountHt: number;
      retainageAmountHt: number;
      vatRatePercent: number;
    };
  }): void {
    this.api.updateSituation(ev.id, ev.payload).subscribe({
      next: () => { this.ok($localize`:@@projects.project-detail.ts.situation.mise.a.jour.e7db861c:Situation mise à jour`); this.loadTab('billing'); },
      error: err => this.fail(err, $localize`:@@projects.project-detail.ts.mise.a.jour.situation.09e24286:Mise à jour situation`)
    });
  }

  invoiceSituation(id: string): void {
    this.api.invoiceSituation(this.id, id).subscribe({
      next: r => { if (r.success && r.data) void this.router.navigate(['/invoices', r.data.invoiceId]); },
      error: err => this.fail(err, 'Facturation situation')
    });
  }

  addSubcontractor(payload: { supplierId: string; contractReference?: string; amountHt: number; retainagePercent: number }): void {
    this.api.addSubcontractor(this.id, payload).subscribe({
      next: () => { this.ok($localize`:@@projects.project-detail.ts.sous.traitant.ajoute.02add446:Sous-traitant ajouté`); this.loadTab('billing'); },
      error: err => this.fail(err, 'Sous-traitant')
    });
  }

  updateSubcontractor(ev: {
    id: string;
    payload: { contractReference?: string; amountHt: number; retainagePercent: number };
  }): void {
    this.api.updateSubcontractor(ev.id, ev.payload).subscribe({
      next: () => { this.ok($localize`:@@projects.project-detail.ts.sous.traitant.mis.a.jour.123f5880:Sous-traitant mis à jour`); this.loadTab('billing'); },
      error: err => this.fail(err, 'Sous-traitant')
    });
  }
}
