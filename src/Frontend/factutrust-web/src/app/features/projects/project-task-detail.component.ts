/// <reference types="@angular/localize" />
import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TabsModule } from 'primeng/tabs';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { Textarea } from 'primeng/textarea';
import { ProgressBarModule } from 'primeng/progressbar';
import { TableModule } from 'primeng/table';
import { CheckboxModule } from 'primeng/checkbox';
import { MessageModule } from 'primeng/message';
import { TooltipModule } from 'primeng/tooltip';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { StatusBadgeComponent } from '@shared/components/status-badge/status-badge.component';
import { AuthService } from '@core/services/auth.service';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import {
  ProjectActivity,
  ProjectApiService,
  ProjectAssignableUser,
  ProjectAttachment,
  ProjectComment,
  ProjectDetail,
  ProjectTask,
  ProjectTimeEntry,
  UpsertTaskPayload
} from './project-api.service';
import {
  PROJECT_PRIORITY_OPTIONS,
  PROJECT_TASK_STATUS_OPTIONS,
  canCreateTimeEntry as canCreateTimeEntryOnProject,
  canDeleteTimeEntry,
  canEditTimeEntry,
  canReopenSubmittedTimeEntry,
  canReopenValidatedTimeEntry,
  canSubmitTimeEntry,
  canValidateTimeEntry,
  daysUntilDue,
  formatFileSize,
  parseProjectTaskPriority,
  parseProjectTaskStatus,
  parseProjectTimeStatus,
  showTaskTimeTab,
  taskStatusBadge,
  timeEntryCreationBlockedMessage,
  timeEntryStatusBadge,
  timeEntryStatusLabel,
  toIsoDate
} from './project-enums';
import {
  ProjectStatusChangeDialogComponent,
  ProjectStatusChangePayload
} from './components/project-status-change-dialog.component';

type TaskTab = 'overview' | 'subtasks' | 'files' | 'time' | 'history';

@Component({
  selector: 'app-project-task-detail',
  standalone: true,
  imports: [BackendLabelPipe, 
    CommonModule,
    FormsModule,
    RouterLink,
    TabsModule,
    InputTextModule,
    InputNumberModule,
    SelectModule,
    DatePickerModule,
    Textarea,
    ProgressBarModule,
    TableModule,
    CheckboxModule,
    MessageModule,
    TooltipModule,
    PageHeaderComponent,
    ButtonComponent,
    BreadcrumbComponent,
    StatusBadgeComponent,
    ProjectStatusChangeDialogComponent
  ],
  styleUrls: ['./projects.scss'],
  template: `
    @if (task(); as t) {
      <app-breadcrumb [items]="crumbs(t)"></app-breadcrumb>
      <app-page-header [title]="t.title" [subtitle]="t.phaseName">
        <app-status-badge [status]="taskStatusBadge(t.status)" [label]="t.statusDisplay | backendLabel" />
        @if (canCreateTimeEntry) {
          <app-button variant="outline" (click)="goToTimeTab()" i18n="@@projects.project-task-detail.saisir.du.temps.829487f5">Saisir du temps</app-button>
        }
        @if (canUpdate) {
          <app-button variant="outline" (click)="openStatusDialog()" i18n="@@projects.project-task-detail.changer.statut.3db910c4">Changer statut</app-button>
          <app-button variant="primary" (click)="save()" i18n="@@projects.project-task-detail.enregistrer.f7c8bcd8">Enregistrer</app-button>
          <app-button variant="danger" (click)="deleteTask()" i18n="@@projects.project-task-detail.supprimer.1acfc1c7">Supprimer</app-button>
        }
        <a routerLink="/projects/{{ t.projectId }}" [queryParams]="{ tab: 'tasks' }" class="p-button p-button-outlined p-button-sm" i18n="@@projects.project-task-detail.retour.au.projet.c83aebd1">Retour au projet</a>
      </app-page-header>

      <div class="proj-meta-chips mb-2">
        @if (canUpdate) {
          <p-select [options]="statusOptions" [(ngModel)]="status" optionLabel="label" optionValue="value" placeholder="Statut" i18n-placeholder="Statut" />
          <p-select [options]="priorityOptions" [(ngModel)]="priority" optionLabel="label" optionValue="value" />
        }
        <span class="proj-chip">
          <i class="pi pi-calendar"></i>
          {{ dueDate ? (dueDate | date:'shortDate') : loc_ui_tern_sans_echeance_4a0d4b }}
          @if (daysLeft() !== null && daysLeft()! <= 5 && daysLeft()! >= 0) {
            <span class="text-danger"> · J{{ daysLeft() }}</span>
          }
        </span>
      </div>

      <div class="task-detail-grid">
        <div class="task-detail-main-tabs">
          <p-tabs [value]="tab()" (valueChange)="tab.set($any($event))">
            <p-tablist>
              <p-tab value="overview" i18n="@@projects.project-task-detail.apercu.f0f53004">Aperçu</p-tab>
              <p-tab value="subtasks">Sous-tâches {{ doneSubtasks() }}/{{ subtasks().length }}</p-tab>
              <p-tab value="files">Fichiers {{ taskFiles().length }}</p-tab>
              @if (showTaskTimeTab(project(), t)) {
              <p-tab value="time" i18n="@@projects.project-task-detail.temps.passe.94914a53">Temps passé</p-tab>
              }
              <p-tab value="history" i18n="@@projects.project-task-detail.historique.34f3a06a">Historique</p-tab>
            </p-tablist>
            <p-tabpanels>
              <p-tabpanel value="overview">
                <div class="card p-3">
                  @if (canUpdate) {
                    <input pInputText class="w-full mb-2" [(ngModel)]="title" />
                    <textarea pTextarea class="w-full" [(ngModel)]="description" rows="4" placeholder="Description" i18n-placeholder="Description"></textarea>
                    <div class="flex flex-wrap gap-2 mt-2">
                      <p-select [options]="users()" [(ngModel)]="assigneeId" optionLabel="displayName" optionValue="id" placeholder="Assigné" i18n-placeholder="Assigné" [showClear]="true" />
                      <p-datepicker [(ngModel)]="dueDate" dateFormat="dd/mm/yy" placeholder="Échéance" i18n-placeholder="Échéance" />
                      <p-inputNumber [(ngModel)]="estimatedHours" [min]="0" placeholder="Estimé h" i18n-placeholder="Estimé h" />
                    </div>
                  } @else {
                    <p>{{ t.description || 'Pas de description.' }}</p>
                  }
                  <div class="mt-3">
                    <strong>{{ t.progressPercent }} %</strong>
                    <p-progressBar [value]="t.progressPercent" />
                    <p class="text-sm text-color-secondary m-0">{{ doneSubtasks() }}/{{ subtasks().length }} sous-tâches terminées</p>
                  </div>
                  <div class="flex gap-3 mt-3">
                    <div class="proj-kpi-card flex-1">
                      <span class="proj-kpi-label" i18n="@@projects.project-task-detail.temps.estime.b398ea0b">Temps estimé</span>
                      <strong>{{ t.estimatedHours | number:'1.0-1' }} h</strong>
                    </div>
                    <div class="proj-kpi-card flex-1">
                      <span class="proj-kpi-label" i18n="@@projects.project-task-detail.temps.passe.94914a53">Temps passé</span>
                      <strong>{{ t.loggedHours | number:'1.0-1' }} h</strong>
                      @if (canCreateTimeEntry) {
                        <button type="button" class="proj-tasks-link-btn" (click)="goToTimeTab()" i18n="@@projects.project-task-detail.saisir.du.temps.829487f5">Saisir du temps</button>
                      }
                    </div>
                  </div>
                </div>
                <div class="card p-3 mt-3">
                  <h3 class="mt-0" i18n="@@projects.project-task-detail.commentaires.dbdeccaf">Commentaires</h3>
                  @if (canUpdate) {
                    <textarea pTextarea class="w-full" [(ngModel)]="body" rows="3"></textarea>
                    <app-button class="mt-2" variant="primary" (click)="comment()" i18n="@@projects.project-task-detail.ajouter.87c57ed1">Ajouter</app-button>
                  }
                  <ul class="proj-sidebar-list">
                    @for (c of comments(); track c.id) {
                      <li><strong>{{ c.authorName }}</strong> — {{ c.body }} <time class="text-sm">{{ c.createdAt | date:'short' }}</time></li>
                    }
                  </ul>
                </div>
              </p-tabpanel>
              <p-tabpanel value="subtasks">
                <div class="card p-3">
                  <p-table [value]="subtasks()" styleClass="p-datatable-sm">
                    <ng-template pTemplate="header"><tr><th i18n="@@projects.project-task-detail.titre.eb97899a">Titre</th><th i18n="@@projects.project-task-detail.statut.659499f3">Statut</th><th i18n="@@projects.project-task-detail.avancement.e1963fc4">Avancement</th></tr></ng-template>
                    <ng-template pTemplate="body" let-s>
                      <tr [routerLink]="['/projects', s.projectId, 'tasks', s.id]" style="cursor:pointer">
                        <td>{{ s.title }}</td>
                        <td><app-status-badge [status]="taskStatusBadge(s.status)" [label]="s.statusDisplay | backendLabel" /></td>
                        <td>{{ s.progressPercent }}%</td>
                      </tr>
                    </ng-template>
                  </p-table>
                  @if (canUpdate) {
                    <div class="flex gap-2 mt-2">
                      <input pInputText [(ngModel)]="subTitle" placeholder="Nouvelle sous-tâche" i18n-placeholder="Nouvelle sous-tâche" class="flex-1" />
                      <app-button (click)="addSub()" i18n="@@projects.project-task-detail.ajouter.87c57ed1">Ajouter</app-button>
                    </div>
                  }
                </div>
              </p-tabpanel>
              <p-tabpanel value="files">
                <div class="card p-3">
                  @if (taskFiles().length) {
                    <ul class="proj-sidebar-list">
                      @for (f of taskFiles(); track f.id) {
                        <li>
                          <strong>{{ f.fileName }}</strong>
                          <span class="text-sm text-color-secondary">{{ formatSize(f.sizeBytes) }} · {{ f.createdAt | date:'shortDate' }}</span>
                          <app-button size="sm" variant="outline" (click)="downloadFile(f)" i18n="@@projects.project-task-detail.telecharger.b332d06d">Télécharger</app-button>
                        </li>
                      }
                    </ul>
                  } @else {
                    <p class="text-color-secondary m-0" i18n="@@projects.project-task-detail.aucun.fichier.rattache.a.cette.tache.8af2d734">Aucun fichier rattaché à cette tâche.</p>
                  }
                </div>
              </p-tabpanel>
              @if (showTaskTimeTab(project(), t)) {
              <p-tabpanel value="time">
                <div class="card p-3">
                  @if (!canReadTime) {
                    <p-message severity="info" styleClass="w-full mb-3"
                      text="Vous n'avez pas l'accès aux feuilles de temps." />
                  }
                  @if (project() && !canCreateTimeEntry && !editTimeId) {
                    <p-message severity="warn" styleClass="w-full mb-3"
                      [text]="timeLoggingBlockedMessage()" />
                  }

                  @if (canCreateTimeEntry || editTimeId) {
                    <div class="task-create-form mb-3">
                      <p class="task-create-intro">
                        @if (editTimeId) {
                          Modifier la ligne de temps
                        } @else {
                          Nouvelle ligne de temps
                        }
                      </p>
                      <div class="task-create-field">
                        <label for="task-time-date"><ng-container i18n="@@projects.project-task-detail.date.eb9a4bc1">Date </ng-container> <span class="ft-required" i18n="@@projects.project-task-detail.text.df58248c">*</span></label>
                        <p-datepicker
                          inputId="task-time-date"
                          class="w-full"
                          [(ngModel)]="logWorkDate"
                          dateFormat="dd/mm/yy"
                          placeholder="jj/mm/aa" i18n-placeholder="jj/mm/aa"
                          [showIcon]="true"
                          appendTo="body" />
                      </div>
                      <div class="task-create-field">
                        <label for="task-time-hours"><ng-container i18n="@@projects.project-task-detail.heures.b4448c06">Heures </ng-container> <span class="ft-required" i18n="@@projects.project-task-detail.text.df58248c">*</span></label>
                        <p-inputNumber
                          inputId="task-time-hours"
                          class="w-full"
                          [(ngModel)]="logHours"
                          [min]="0.25"
                          [max]="24"
                          [step]="0.25"
                          mode="decimal"
                          [minFractionDigits]="0"
                          [maxFractionDigits]="2" />
                      </div>
                      <div class="task-create-check">
                        <p-checkbox [(ngModel)]="logBillable" [binary]="true" inputId="taskTimeBillable" />
                        <label for="taskTimeBillable" i18n="@@projects.project-task-detail.facturable.63134237">Facturable</label>
                      </div>
                      <div class="task-create-field">
                        <label for="task-time-notes" i18n="@@projects.project-task-detail.notes.70440046">Notes</label>
                        <textarea
                          id="task-time-notes"
                          pTextarea
                          class="w-full"
                          [(ngModel)]="logNotes"
                          rows="3"
                          placeholder="Détails, contexte…" i18n-placeholder="Détails, contexte…"></textarea>
                      </div>
                      <div class="task-create-actions">
                        @if (editTimeId) {
                          <app-button variant="secondary" (click)="cancelEditTime()" i18n="@@projects.project-task-detail.annuler.la.modification.a5ded982">Annuler la modification</app-button>
                        }
                        <app-button variant="primary" [disabled]="!canSubmitLogTime" (click)="submitLogTime()" i18n="@@projects.project-task-detail.enregistrer.f7c8bcd8">Enregistrer</app-button>
                      </div>
                    </div>
                  }

                  <p-table [value]="timeEntries()" styleClass="p-datatable-sm">
                    <ng-template pTemplate="header">
                      <tr>
                        <th i18n="@@projects.project-task-detail.date.eb9a4bc1">Date</th>
                        <th i18n="@@projects.project-task-detail.heures.b4448c06">Heures</th>
                        <th i18n="@@projects.project-task-detail.statut.659499f3">Statut</th>
                        <th i18n="@@projects.project-task-detail.facturable.63134237">Facturable</th>
                        <th i18n="@@projects.project-task-detail.notes.70440046">Notes</th>
                        <th></th>
                      </tr>
                    </ng-template>
                    <ng-template pTemplate="body" let-e>
                      <tr>
                        <td>{{ e.workDate | date:'shortDate' }}</td>
                        <td>{{ e.hours | number:'1.0-1' }} h</td>
                        <td>
                          <app-status-badge [status]="timeEntryStatusBadge(e)" [label]="timeEntryStatusLabel(e)" />
                        </td>
                        <td>{{ e.isBillable ? loc_ui_tern_oui_eaa02f : loc_ui_tern_non_a72199 }}</td>
                        <td>{{ e.notes || '—' }}</td>
                        <td class="proj-time-row-actions">
                          @if (canEditTimeEntry(e) && canCreateTime) {
                            <app-button size="sm" variant="outline" (click)="startEditTime(e)" i18n="@@projects.project-task-detail.modifier.f260e757">Modifier</app-button>
                          }
                          @if (canDeleteTimeEntry(e) && canCreateTime) {
                            <app-button size="sm" variant="ghost" icon="pi-trash" [iconOnly]="true"
                              pTooltip="Supprimer" i18n-pTooltip="Supprimer" tooltipPosition="top" ariaLabel="Supprimer"
                              (click)="deleteTimeEntry(e.id)" />
                          }
                          @if (canSubmitTimeEntry(e) && canSubmitTime) {
                            <app-button size="sm" variant="ghost" icon="pi-send" [iconOnly]="true"
                              pTooltip="Soumettre" i18n-pTooltip="Soumettre" tooltipPosition="top" ariaLabel="Soumettre"
                              (click)="submitTimeEntry(e.id)" />
                          }
                          @if (canValidateTimeEntry(e) && canValidateTime) {
                            <app-button size="sm" variant="primary" icon="pi-check" [iconOnly]="true"
                              pTooltip="Valider" i18n-pTooltip="Valider" tooltipPosition="top" ariaLabel="Valider"
                              (click)="validateTimeEntry(e.id)" />
                          }
                          @if (canReopenSubmittedTimeEntry(e) && canSubmitTime) {
                            <app-button size="sm" variant="ghost" icon="pi-undo" [iconOnly]="true"
                              pTooltip="Rouvrir en brouillon" i18n-pTooltip="Rouvrir en brouillon" tooltipPosition="top" ariaLabel="Rouvrir en brouillon"
                              (click)="reopenTimeEntry(e.id)" />
                          }
                          @if (canReopenValidatedTimeEntry(e) && canValidateTime) {
                            <app-button size="sm" variant="ghost" icon="pi-undo" [iconOnly]="true"
                              pTooltip="Rouvrir en brouillon" i18n-pTooltip="Rouvrir en brouillon" tooltipPosition="top" ariaLabel="Rouvrir en brouillon"
                              (click)="reopenTimeEntry(e.id)" />
                          }
                        </td>
                      </tr>
                    </ng-template>
                    <ng-template pTemplate="emptymessage"><tr><td colspan="6" i18n="@@projects.project-task-detail.aucun.temps.saisi.sur.cette.tache.620a133d">Aucun temps saisi sur cette tâche.</td></tr></ng-template>
                  </p-table>
                </div>
              </p-tabpanel>
              }
              <p-tabpanel value="history">
                <div class="card p-3">
                  <ul class="proj-sidebar-activity">
                    @for (a of taskActivity(); track a.id) {
                      <li>
                        <span class="proj-sidebar-activity-msg">{{ a.message }}</span>
                        <time>{{ a.createdAt | date:'short' }}</time>
                      </li>
                    } @empty {
                      <li class="text-color-secondary" i18n="@@projects.project-task-detail.aucun.historique.b806a0d9">Aucun historique.</li>
                    }
                  </ul>
                </div>
              </p-tabpanel>
            </p-tabpanels>
          </p-tabs>
        </div>

        <aside class="proj-sidebar-panel">
          <section class="proj-sidebar-section">
            <h3 class="proj-sidebar-title" i18n="@@projects.project-task-detail.informations.54937b3a">Informations</h3>
            <dl class="proj-sidebar-dl">
              <dt i18n="@@projects.project-task-detail.id.89f89c02">ID</dt><dd>{{ t.id.slice(0, 8) }}</dd>
              <dt i18n="@@projects.project-task-detail.projet.a9de3a26">Projet</dt><dd><a [routerLink]="['/projects', t.projectId]" i18n="@@projects.project-task-detail.voir.le.projet.4dfb4818">Voir le projet</a></dd>
              <dt i18n="@@projects.project-task-detail.colonne.064b24f9">Colonne</dt><dd>{{ t.phaseName }}</dd>
              <dt i18n="@@projects.project-task-detail.assigne.be552b5f">Assigné</dt><dd>{{ t.assigneeUserName || '—' }}</dd>
              <dt i18n="@@projects.project-task-detail.priorite.eede91d2">Priorité</dt><dd>{{ t.priorityDisplay | backendLabel }}</dd>
            </dl>
          </section>
          <section class="proj-sidebar-section">
            <h3 class="proj-sidebar-title" i18n="@@projects.project-task-detail.activite.8fe12048">Activité</h3>
            <ul class="proj-sidebar-activity">
              @for (a of taskActivity().slice(0, 5); track a.id) {
                <li>
                  <span class="proj-sidebar-activity-msg">{{ a.message }}</span>
                  <time>{{ a.createdAt | date:'short' }}</time>
                </li>
              }
            </ul>
          </section>
        </aside>
      </div>

      <app-project-status-change-dialog
        [(visible)]="statusDialogVisible"
        [currentStatus]="status"
        (confirmChange)="onStatusChange($event)" />
    }
  `
})
export class ProjectTaskDetailComponent implements OnInit {
  readonly loc_ui_tern_sans_echeance_4a0d4b = $localize`:@@ui.tern.sans.echeance.4a0d4b:Sans échéance`;
  readonly loc_ui_tern_oui_eaa02f = $localize`:@@ui.tern.oui.eaa02f:Oui`;
  readonly loc_ui_tern_non_a72199 = $localize`:@@ui.tern.non.a72199:Non`;
  private readonly api = inject(ProjectApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly errors = inject(ErrorHandlerService);
  private readonly confirm = inject(ConfirmationService);

  readonly task = signal<ProjectTask | null>(null);
  readonly project = signal<ProjectDetail | null>(null);
  readonly comments = signal<ProjectComment[]>([]);
  readonly users = signal<ProjectAssignableUser[]>([]);
  readonly subtasks = signal<ProjectTask[]>([]);
  readonly attachments = signal<ProjectAttachment[]>([]);
  readonly timeEntries = signal<ProjectTimeEntry[]>([]);
  readonly activities = signal<ProjectActivity[]>([]);
  readonly tab = signal<TaskTab>('overview');
  statusDialogVisible = false;
  body = '';
  subTitle = '';
  title = '';
  description = '';
  priority: 'Low' | 'Normal' | 'High' | 'Urgent' = 'Normal';
  status: 'Todo' | 'InProgress' | 'Waiting' | 'Done' | 'Cancelled' = 'Todo';
  assigneeId: string | null = null;
  dueDate: Date | null = null;
  estimatedHours = 0;
  logWorkDate: Date = new Date();
  logHours = 1;
  logBillable = true;
  logNotes = '';
  editTimeId: string | null = null;
  readonly priorityOptions = PROJECT_PRIORITY_OPTIONS;
  readonly statusOptions = PROJECT_TASK_STATUS_OPTIONS;
  readonly taskStatusBadge = taskStatusBadge;
  readonly canEditTimeEntry = canEditTimeEntry;
  readonly canDeleteTimeEntry = canDeleteTimeEntry;
  readonly canSubmitTimeEntry = canSubmitTimeEntry;
  readonly canValidateTimeEntry = canValidateTimeEntry;
  readonly canReopenSubmittedTimeEntry = canReopenSubmittedTimeEntry;
  readonly canReopenValidatedTimeEntry = canReopenValidatedTimeEntry;
  readonly timeEntryStatusBadge = timeEntryStatusBadge;
  readonly timeEntryStatusLabel = timeEntryStatusLabel;
  readonly showTaskTimeTab = showTaskTimeTab;
  readonly formatSize = formatFileSize;

  get canUpdate(): boolean { return this.auth.hasPermission(PERMISSIONS.projectTasks.update); }
  get canReadTime(): boolean { return this.auth.hasPermission(PERMISSIONS.projectTime.read); }
  get canCreateTime(): boolean { return this.auth.hasPermission(PERMISSIONS.projectTime.create); }
  get canSubmitTime(): boolean { return this.auth.hasPermission(PERMISSIONS.projectTime.submit); }
  get canValidateTime(): boolean { return this.auth.hasPermission(PERMISSIONS.projectTime.validate); }
  get canCreateTimeEntry(): boolean {
    const p = this.project();
    return this.canCreateTime && !!p && canCreateTimeEntryOnProject(p);
  }
  get canSubmitLogTime(): boolean {
    return typeof this.logHours === 'number' && this.logHours > 0 && this.logHours <= 24;
  }

  taskFiles(): ProjectAttachment[] {
    const id = this.task()?.id;
    return id ? this.attachments().filter(a => a.taskId === id) : [];
  }

  taskActivity(): ProjectActivity[] {
    return this.activities();
  }

  doneSubtasks(): number {
    return this.subtasks().filter(s => s.status === 'Done' || s.status === 3).length;
  }

  daysLeft(): number | null {
    return daysUntilDue(this.task()?.dueDate);
  }

  crumbs(t: ProjectTask): BreadcrumbItem[] {
    return [
      { label: 'Accueil', route: '/' },
      { label: 'Projets', route: '/projects' },
      { label: 'Projet', route: `/projects/${t.projectId}` },
      { label: t.title }
    ];
  }

  ngOnInit(): void {
    const taskId = this.route.snapshot.paramMap.get('taskId') ?? '';
    this.api.users().subscribe(r => { if (r.success && r.data) this.users.set(r.data); });
    this.reload(taskId);
  }

  openStatusDialog(): void {
    this.statusDialogVisible = true;
  }

  onStatusChange(payload: ProjectStatusChangePayload): void {
    this.status = payload.status;
    if (payload.comment) {
      const t = this.task();
      if (t) {
        this.api.addComment(t.projectId, payload.comment, t.id).subscribe();
      }
    }
    if (payload.notifyCollaborators) {
      this.toast.add({ severity: 'info', summary: $localize`:@@project-task-detail.component.summary.Notification:Notification`, detail: $localize`:@@project-task-detail.component.detail.Les_collaborateu:Les collaborateurs seront notifiés prochainement.` });
    }
    this.save();
  }

  goToTimeTab(): void {
    this.tab.set('time');
  }

  timeLoggingBlockedMessage(): string {
    const p = this.project();
    if (!p) return '';
    return timeEntryCreationBlockedMessage(p.status);
  }

  isDraftTime(entry: ProjectTimeEntry): boolean {
    return parseProjectTimeStatus(entry.status) === 'Draft';
  }

  resetLogForm(): void {
    this.editTimeId = null;
    this.logWorkDate = new Date();
    this.logHours = 1;
    this.logBillable = true;
    this.logNotes = '';
  }

  startEditTime(entry: ProjectTimeEntry): void {
    this.editTimeId = entry.id;
    this.logWorkDate = entry.workDate ? new Date(entry.workDate) : new Date();
    this.logHours = entry.hours;
    this.logBillable = entry.isBillable;
    this.logNotes = entry.notes ?? '';
    this.tab.set('time');
  }

  cancelEditTime(): void {
    this.resetLogForm();
  }

  submitLogTime(): void {
    const t = this.task();
    if (!t || !this.canSubmitLogTime) return;
    const payload = {
      projectId: t.projectId,
      taskId: t.id,
      workDate: toIsoDate(this.logWorkDate) ?? new Date().toISOString(),
      hours: this.logHours,
      isBillable: this.logBillable,
      notes: this.logNotes.trim() || undefined
    };
    if (this.editTimeId) {
      if (!this.canCreateTime) return;
      this.api.updateTime(this.editTimeId, payload).subscribe({
        next: () => {
          this.toast.add({ severity: 'success', summary: $localize`:@@project-task-detail.component.summary.Temps mis à :Temps mis à jour` });
          this.resetLogForm();
          this.reload(t.id);
        },
        error: err => this.toast.add({ severity: 'error', summary: $localize`:@@project-task-detail.component.summary.Mise à jour :Mise à jour du temps`, detail: this.errors.extractErrorMessage(err) })
      });
      return;
    }
    if (!this.canCreateTimeEntry) return;
    this.api.createTime(payload).subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: $localize`:@@project-task-detail.component.summary.Temps_enregistr_:Temps enregistré` });
        this.resetLogForm();
        this.reload(t.id);
      },
      error: err => this.toast.add({ severity: 'error', summary: $localize`:@@project-task-detail.component.summary.Saisie des t:Saisie des temps`, detail: this.errors.extractErrorMessage(err) })
    });
  }

  deleteTimeEntry(id: string): void {
    const t = this.task();
    this.api.deleteTime(id).subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: $localize`:@@project-task-detail.component.summary.Temps suppri:Temps supprimé` });
        if (t) this.reload(t.id);
      },
      error: err => this.toast.add({ severity: 'error', summary: $localize`:@@project-task-detail.component.summary.Suppression_impo:Suppression impossible`, detail: this.errors.extractErrorMessage(err) })
    });
  }

  submitTimeEntry(id: string): void {
    const t = this.task();
    this.api.submitTime(id).subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: $localize`:@@project-task-detail.component.summary.Temps soumis:Temps soumis` });
        if (t) this.reload(t.id);
      },
      error: err => this.toast.add({ severity: 'error', summary: $localize`:@@project-task-detail.component.summary.Soumission_impos:Soumission impossible`, detail: this.errors.extractErrorMessage(err) })
    });
  }

  validateTimeEntry(id: string): void {
    const t = this.task();
    this.api.validateTime(id).subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: $localize`:@@project-task-detail.component.summary.Temps validé:Temps validé` });
        if (t) this.reload(t.id);
      },
      error: err => this.toast.add({ severity: 'error', summary: $localize`:@@project-task-detail.component.summary.Validation_impos:Validation impossible`, detail: this.errors.extractErrorMessage(err) })
    });
  }

  reopenTimeEntry(id: string): void {
    const t = this.task();
    this.api.reopenTime(id).subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: $localize`:@@project-task-detail.component.summary.Temps_rouvert_en:Temps rouvert en brouillon` });
        if (t) this.reload(t.id);
      },
      error: err => this.toast.add({ severity: 'error', summary: $localize`:@@project-task-detail.component.summary.Réouverture :Réouverture impossible`, detail: this.errors.extractErrorMessage(err) })
    });
  }

  private reload(taskId: string): void {
    this.api.getTask(taskId).subscribe({
      next: r => {
        if (r.success && r.data) {
          const t = r.data;
          this.task.set(t);
          this.title = t.title;
          this.description = t.description ?? '';
          this.priority = parseProjectTaskPriority(t.priority) ?? 'Normal';
          this.status = parseProjectTaskStatus(t.status) ?? 'Todo';
          this.assigneeId = t.assigneeUserId ?? null;
          this.dueDate = t.dueDate ? new Date(t.dueDate) : null;
          this.estimatedHours = t.estimatedHours;
          this.api.get(t.projectId).subscribe(pr => {
            if (pr.success && pr.data) this.project.set(pr.data);
          });
          this.api.comments(t.projectId, t.id).subscribe(c => {
            if (c.success && c.data) this.comments.set(c.data);
          });
          this.api.tasks(t.projectId).subscribe(list => {
            if (list.success && list.data) {
              this.subtasks.set(list.data.filter(x => x.parentTaskId === t.id));
            }
          });
          this.api.attachments(t.projectId).subscribe(a => {
            if (a.success && a.data) this.attachments.set(a.data);
          });
          if (this.canReadTime) {
            this.api.time({ projectId: t.projectId }).subscribe(te => {
              if (te.success && te.data) {
                this.timeEntries.set(te.data.filter(e => this.timeEntryMatchesTask(e, t.id)));
              }
            });
          } else {
            this.timeEntries.set([]);
          }
          this.api.activity(t.projectId).subscribe(act => {
            if (act.success && act.data) this.activities.set(act.data);
          });
        }
      },
      error: err => this.toast.add({ severity: 'error', summary: $localize`:@@project-task-detail.component.summary.Tâche:Tâche`, detail: this.errors.extractErrorMessage(err) })
    });
  }

  save(): void {
    const t = this.task();
    if (!t) return;
    const payload: UpsertTaskPayload = {
      phaseId: t.phaseId,
      parentTaskId: t.parentTaskId,
      title: this.title,
      description: this.description,
      priority: this.priority,
      status: this.status,
      dueDate: toIsoDate(this.dueDate),
      assigneeUserId: this.assigneeId,
      estimatedHours: this.estimatedHours,
      progressPercent: t.progressPercent
    };
    this.api.updateTask(t.id, payload).subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: $localize`:@@project-task-detail.component.summary.T_che_enregistr_:Tâche enregistrée` });
        this.reload(t.id);
      },
      error: err => this.toast.add({ severity: 'error', summary: $localize`:@@project-task-detail.component.summary.Enregistrement:Enregistrement`, detail: this.errors.extractErrorMessage(err) })
    });
  }

  addSub(): void {
    const t = this.task();
    if (!t || !this.subTitle.trim()) return;
    this.api.createTask(t.projectId, {
      phaseId: t.phaseId,
      parentTaskId: t.id,
      title: this.subTitle.trim(),
      priority: 'Normal',
      estimatedHours: 0,
      progressPercent: 0
    }).subscribe({
      next: () => { this.subTitle = ''; this.reload(t.id); },
      error: err => this.toast.add({ severity: 'error', summary: $localize`:@@project-task-detail.component.summary.Sous-tâche:Sous-tâche`, detail: this.errors.extractErrorMessage(err) })
    });
  }

  comment(): void {
    const t = this.task();
    if (!t || !this.body.trim()) return;
    this.api.addComment(t.projectId, this.body, t.id).subscribe({
      next: () => {
        this.body = '';
        this.api.comments(t.projectId, t.id).subscribe(c => {
          if (c.success && c.data) this.comments.set(c.data);
        });
      },
      error: err => this.toast.add({ severity: 'error', summary: $localize`:@@project-task-detail.component.summary.Commentaire:Commentaire`, detail: this.errors.extractErrorMessage(err) })
    });
  }

  downloadFile(f: ProjectAttachment): void {
    const t = this.task();
    if (!t) return;
    this.api.downloadAttachment(t.projectId, f.id).subscribe({
      next: blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = f.fileName;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: err => this.toast.add({ severity: 'error', summary: $localize`:@@project-task-detail.component.summary.T_l_chargement:Téléchargement`, detail: this.errors.extractErrorMessage(err) })
    });
  }

  private timeEntryMatchesTask(entry: ProjectTimeEntry, taskId: string): boolean {
    if (!entry.taskId) return false;
    return entry.taskId.toLowerCase() === taskId.toLowerCase();
  }

  deleteTask(): void {
    const t = this.task();
    if (!t) return;
    this.confirm.confirm({
      header: 'Supprimer la tâche',
      message: 'Cette action est irréversible. Supprimer cette tâche ?',
      accept: () => this.api.deleteTask(t.id).subscribe({
        next: () => {
          this.toast.add({ severity: 'success', summary: $localize`:@@project-task-detail.component.summary.Tâche suppri:Tâche supprimée` });
          void this.router.navigate(['/projects', t.projectId], { queryParams: { tab: 'tasks' } });
        },
        error: err => this.toast.add({ severity: 'error', summary: $localize`:@@project-task-detail.component.summary.Suppression:Suppression`, detail: this.errors.extractErrorMessage(err) })
      })
    });
  }
}
