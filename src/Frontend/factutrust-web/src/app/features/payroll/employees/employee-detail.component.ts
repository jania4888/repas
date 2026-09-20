import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { TabsModule } from 'primeng/tabs';
import { TagModule } from 'primeng/tag';
import { MessageModule } from 'primeng/message';
import { TableModule } from 'primeng/table';
import { EmployeeService, EmployeeDetail, EmploymentContract } from '@core/services/employee.service';
import { PayrollService } from '@core/services/payroll.service';
import { ToastService } from '@core/services/toast.service';
import { AuthService } from '@core/services/auth.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { canManagePayrollEmployees, canManageGarnishments as userCanManageGarnishments, isPayrollConsultMode } from '@core/utils/payroll-access';
import { ContractFormDialogComponent } from './contract-form-dialog.component';
import { EmployeeLeavesTabComponent } from './employee-leaves-tab.component';
import { EmployeeCnssIjClaimsTabComponent } from './employee-cnss-ij-claims-tab.component';
import { EmployeeAdvancesTabComponent } from './employee-advances-tab.component';
import { EmployeeSocialFundsTabComponent } from './employee-social-funds-tab.component';
import { EmployeeInKindBenefitsTabComponent } from './employee-in-kind-benefits-tab.component';
import { EmployeeLoansTabComponent } from './employee-loans-tab.component';
import { EmployeeGarnishmentsTabComponent } from './employee-garnishments-tab.component';
import { EmployeeHrDocumentsComponent } from './employee-hr-documents.component';
import { EmployeeSuspensionsTabComponent } from './employee-suspensions-tab.component';
import { EmployeeDepartureDialogComponent } from './employee-departure-dialog.component';
import { PayrollConsultBannerComponent, PayrollAmountPipe, formatPayrollAmount } from '../shared';

@Component({
  selector: 'app-employee-detail',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    TabsModule,
    TagModule,
    MessageModule,
    TableModule,
    PageHeaderComponent,
    ButtonComponent,
    ContractFormDialogComponent,
    EmployeeLeavesTabComponent,
    EmployeeCnssIjClaimsTabComponent,
    EmployeeAdvancesTabComponent,
    EmployeeSocialFundsTabComponent,
    EmployeeInKindBenefitsTabComponent,
    EmployeeLoansTabComponent,
    EmployeeGarnishmentsTabComponent,
    EmployeeHrDocumentsComponent,
    EmployeeSuspensionsTabComponent,
    EmployeeDepartureDialogComponent,
    PayrollConsultBannerComponent,
    PayrollAmountPipe
  ],
  template: `
    @if (loading()) {
      <p>Chargement…</p>
    } @else if (employee()) {
      <app-page-header [title]="employee()!.fullName" [subtitle]="'Matricule ' + employee()!.employeeNumber">
        @if (canManage()) {
          <app-button variant="outline" icon="pi-pencil" iconPos="left" [routerLink]="[routeBase() + '/employees', employee()!.id, 'edit']">Modifier</app-button>
          @if (!employee()!.terminationDate) {
            <app-button variant="outline" icon="pi-sign-out" iconPos="left" (click)="departureDialogVisible = true">Déclarer un départ</app-button>
          }
          <app-button variant="outline" [icon]="employee()!.isActive ? 'pi-ban' : 'pi-check'" iconPos="left" (click)="toggleActive()">
            {{ employee()!.isActive ? 'Désactiver' : 'Réactiver' }}
          </app-button>
          <app-button variant="danger" icon="pi-trash" iconPos="left" (click)="confirmDelete()">Supprimer</app-button>
        }
      </app-page-header>

      <app-payroll-consult-banner
        [visible]="showConsultBanner()"
        message="Mode consultation — la gestion des dossiers salariés est réservée à la société cliente." />

      @if (alerts().length) {
        <div class="payroll-alert-list">
          @for (alert of alerts(); track alert) {
            <p-message [severity]="alert.severity" [text]="alert.text" styleClass="w-full" />
          }
        </div>
      }

      <p-tabs class="ft-tabs" [lazy]="true">
        <p-tablist>
          <p-tab [value]="0"><i class="pi pi-id-card mr-2"></i><span>Informations</span></p-tab>
          <p-tab [value]="1"><i class="pi pi-file mr-2"></i><span>Contrats</span></p-tab>
          <p-tab [value]="2"><i class="pi pi-calendar mr-2"></i><span>Congés</span></p-tab>
          <p-tab [value]="3"><i class="pi pi-building mr-2"></i><span>IJ CNSS</span></p-tab>
          <p-tab [value]="4"><i class="pi pi-ban mr-2"></i><span>Suspensions</span></p-tab>
          <p-tab [value]="5"><i class="pi pi-wallet mr-2"></i><span>Avances</span></p-tab>
          <p-tab [value]="6"><i class="pi pi-heart mr-2"></i><span>Mutuelles</span></p-tab>
          <p-tab [value]="7"><i class="pi pi-home mr-2"></i><span>Avantages en nature</span></p-tab>
          <p-tab [value]="8"><i class="pi pi-credit-card mr-2"></i><span>Prêts</span></p-tab>
          <p-tab [value]="9"><i class="pi pi-exclamation-triangle mr-2"></i><span>Saisies</span></p-tab>
          <p-tab [value]="10"><i class="pi pi-file-pdf mr-2"></i><span>Documents RH</span></p-tab>
        </p-tablist>
        <p-tabpanels>
        <p-tabpanel [value]="0">
          <dl class="payroll-detail-grid card p-3">
            <div>
              <dt>CIN</dt>
              <dd>{{ employee()!.cin || '—' }}</dd>
            </div>
            <div>
              <dt>CNSS</dt>
              <dd>
                @if (employee()!.cnssNumber) {
                  {{ employee()!.cnssNumber }}
                } @else {
                  <p-tag value="CNSS manquant" severity="warn" />
                }
              </dd>
            </div>
            <div>
              <dt>Catégorie</dt>
              <dd>{{ employee()!.category || '—' }}</dd>
            </div>
            <div>
              <dt>Échelon</dt>
              <dd>{{ employee()!.echelon || '—' }}</dd>
            </div>
            <div>
              <dt>Date naissance</dt>
              <dd>{{ employee()!.dateOfBirth ? (employee()!.dateOfBirth | date:'dd/MM/yyyy') : '—' }}</dd>
            </div>
            <div>
              <dt>Embauche</dt>
              <dd>{{ employee()!.hireDate | date:'dd/MM/yyyy' }}</dd>
            </div>
            @if (employee()!.terminationDate) {
              <div>
                <dt>Date de sortie</dt>
                <dd>{{ employee()!.terminationDate | date:'dd/MM/yyyy' }}</dd>
              </div>
            }
            <div>
              <dt>Situation familiale</dt>
              <dd>{{ employee()!.maritalStatusDisplay }}</dd>
            </div>
            <div>
              <dt>Chef de famille</dt>
              <dd>{{ employee()!.isHeadOfFamily ? 'Oui' : 'Non' }}</dd>
            </div>
            <div>
              <dt>Enfants à charge</dt>
              <dd>{{ employee()!.dependentChildren }}</dd>
            </div>
            <div>
              <dt>Dont étudiants / infirmes</dt>
              <dd>{{ employee()!.studentChildren }} / {{ employee()!.disabledChildren }}</dd>
            </div>
            <div>
              <dt>Parents à charge</dt>
              <dd>
                {{ employee()!.dependentParents }}
                @if (employee()!.parentClaimsStatus === 'Incomplete') {
                  <p-tag value="À compléter" severity="warn" class="ml-2" />
                }
                @if (employee()!.parentClaimsStatus === 'Conflict') {
                  <p-tag value="Conflit non-cumul" severity="danger" class="ml-2" />
                }
              </dd>
            </div>
            @if (employee()!.dependentParentClaims?.length) {
              <div class="parents-claims-detail">
                <dt>Déclarations nominatives</dt>
                <dd>
                  <ul>
                    @for (claim of employee()!.dependentParentClaims!; track claim.parentCin) {
                      <li>
                        {{ claim.kinship === 'Father' ? 'Père' : 'Mère' }}
                        — CIN {{ claim.parentCin }}
                        @if (claim.firstName || claim.lastName) {
                          ({{ claim.firstName }} {{ claim.lastName }})
                        }
                      </li>
                    }
                  </ul>
                </dd>
              </div>
            }
            <div>
              <dt>Email</dt>
              <dd>{{ employee()!.email || '—' }}</dd>
            </div>
            <div>
              <dt>Téléphone</dt>
              <dd>{{ employee()!.phone || '—' }}</dd>
            </div>
            <div>
              <dt>RIB</dt>
              <dd>{{ employee()!.rib || '—' }}</dd>
            </div>
            <div>
              <dt>Adresse</dt>
              <dd>{{ employee()!.address?.fullAddress || formatAddress() }}</dd>
            </div>
            <div>
              <dt>Statut</dt>
              <dd>
                <p-tag [value]="employee()!.isActive ? 'Actif' : 'Inactif'" [severity]="employee()!.isActive ? 'success' : 'secondary'" />
              </dd>
            </div>
          </dl>
        </p-tabpanel>

        <p-tabpanel [value]="1">
          @if (canManage()) {
            <app-button variant="primary" icon="pi-plus" iconPos="left" (click)="openContractDialog()" class="mb-3">Ajouter un contrat</app-button>
          }
          @for (c of employee()!.contracts; track c.id) {
            <div class="card p-3 mb-3">
              <div class="contract-header">
                <div>
                  <strong>{{ c.typeDisplay }}</strong> — {{ c.regimeDisplay }} — {{ c.weeklyRegimeDisplay }}
                  @if (!c.isActive) { <p-tag value="Inactif" severity="secondary" class="ml-2" /> }
                </div>
                @if (canManage()) {
                  <span class="contract-actions">
                    <button type="button" class="p-button p-button-text p-button-sm" (click)="editContract(c)">Modifier</button>
                    <button type="button" class="p-button p-button-text p-button-danger p-button-sm" (click)="confirmDeleteContract(c)">Supprimer</button>
                  </span>
                }
              </div>
              <p>Du {{ c.startDate | date:'dd/MM/yyyy' }} @if (c.endDate) { au {{ c.endDate | date:'dd/MM/yyyy' }} }</p>
              <p>Salaire base : {{ c.baseSalary | payrollAmount }} — AT : {{ c.workAccidentRate }} %</p>
              @if (c.jobTitle) { <p>Poste : {{ c.jobTitle }}</p> }
              @if (c.allowances.length) {
                <p-table [value]="c.allowances" styleClass="p-datatable-sm mt-2">
                  <ng-template pTemplate="header">
                    <tr><th>Prime</th><th class="text-right">Montant</th><th>Imposable</th><th>CNSS</th></tr>
                  </ng-template>
                  <ng-template pTemplate="body" let-a>
                    <tr>
                      <td>{{ a.label }}</td>
                      <td class="text-right">{{ a.amount | payrollAmount }}</td>
                      <td>{{ a.taxable ? 'Oui' : 'Non' }}</td>
                      <td>{{ a.subjectToCnss ? 'Oui' : 'Non' }}</td>
                    </tr>
                  </ng-template>
                </p-table>
              }
            </div>
          } @empty {
            <p>Aucun contrat enregistré.</p>
          }
        </p-tabpanel>

        <p-tabpanel [value]="2">
          @if (firmInternal()) {
            <!-- Paie interne du cabinet : les congés se saisissent une seule fois, côté RH,
                 et sont reportés automatiquement ici à l'approbation. -->
            <div class="leaves-source-banner">
              <i class="pi pi-info-circle"></i>
              <div>
                <strong>Les congés du cabinet se saisissent dans Congés &amp; Absences.</strong>
                <p>Cette vue reflète les congés approuvés qui ont été reportés en paie.</p>
              </div>
              <a routerLink="/firm/governance/leaves" class="banner-link">Ouvrir Congés &amp; Absences</a>
            </div>
          }
          <app-employee-leaves-tab
            [employeeId]="employee()!.id"
            [readOnly]="!canManage() || firmInternal()" />
        </p-tabpanel>

        <p-tabpanel [value]="3">
          <app-employee-cnss-ij-claims-tab [employeeId]="employee()!.id" [readOnly]="!canManage()" />
        </p-tabpanel>

        <p-tabpanel [value]="4">
          <app-employee-suspensions-tab [employeeId]="employee()!.id" [readOnly]="!canManage()" />
        </p-tabpanel>

        <p-tabpanel [value]="5">
          <app-employee-advances-tab [employeeId]="employee()!.id" [readOnly]="!canManage()" />
        </p-tabpanel>

        <p-tabpanel [value]="6">
          <app-employee-social-funds-tab [employeeId]="employee()!.id" [readOnly]="!canManage()" />
        </p-tabpanel>

        <p-tabpanel [value]="7">
          <app-employee-in-kind-benefits-tab [employeeId]="employee()!.id" [readOnly]="!canManage()" />
        </p-tabpanel>

        <p-tabpanel [value]="8">
          <app-employee-loans-tab [employeeId]="employee()!.id" [readOnly]="!canManage()" />
        </p-tabpanel>

        <p-tabpanel [value]="9">
          <app-employee-garnishments-tab [employeeId]="employee()!.id" [readOnly]="!canManageGarnishments()" />
        </p-tabpanel>

        <p-tabpanel [value]="10">
          <app-employee-hr-documents
            [employeeId]="employee()!.id"
            [terminationDate]="employee()!.terminationDate" />
        </p-tabpanel>
        </p-tabpanels>
      </p-tabs>

      <app-contract-form-dialog
        [(visible)]="contractDialogVisible"
        [employeeId]="employee()!.id"
        [editContract]="editingContract"
        (saved)="reload()" />

      <app-employee-departure-dialog
        [employeeId]="employee()!.id"
        [(visible)]="departureDialogVisible"
        (completed)="reload()" />
    }
  `,
  styles: [`
    .contract-header { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--spacing-4); }
    .contract-actions { white-space: nowrap; }
    .mb-3 { margin-bottom: var(--spacing-4); display: block; }
    .ml-2 { margin-left: var(--spacing-2); }
    .mt-2 { margin-top: var(--spacing-2); }
    .mr-2 { margin-right: var(--spacing-2); }
    .leaves-source-banner {
      display: flex; align-items: flex-start; gap: .75rem; flex-wrap: wrap;
      border: 1px solid var(--color-border-subtle, #e2e8f0);
      background: var(--color-surface-muted, #f8fafc);
      border-radius: var(--radius-lg, 12px);
      padding: var(--spacing-3, 12px);
      margin-bottom: var(--spacing-4, 16px);
      font-size: .875rem;
    }
    .leaves-source-banner p { margin: .2rem 0 0; color: var(--color-text-muted, #64748b); }
    .leaves-source-banner .banner-link { margin-left: auto; color: var(--color-primary, #0f766e); white-space: nowrap; }
  `]
})
export class EmployeeDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly employees = inject(EmployeeService);
  private readonly payroll = inject(PayrollService);
  private readonly toast = inject(ToastService);
  private readonly confirmation = inject(ConfirmationService);
  readonly auth = inject(AuthService);

  loading = signal(true);
  employee = signal<EmployeeDetail | null>(null);
  monthlySmig = signal<number | null>(null);
  contractDialogVisible = false;
  departureDialogVisible = false;
  editingContract: EmploymentContract | null = null;
  routeBase = signal('/payroll');
  firmInternal = signal(false);

  canManage = computed(() => canManagePayrollEmployees(this.auth));
  canManageGarnishments = computed(() => userCanManageGarnishments(this.auth));
  showConsultBanner = computed(() => !this.firmInternal() && isPayrollConsultMode(this.auth));

  alerts = computed(() => {
    const e = this.employee();
    if (!e) return [];
    const items: { severity: 'warn' | 'error' | 'info'; text: string }[] = [];
    if (!e.cnssNumber?.trim()) {
      items.push({ severity: 'warn', text: 'Numéro CNSS manquant — requis pour la déclaration sociale et la paie.' });
    }
    const activeContract = e.contracts.find(c => c.isActive);
    if (!activeContract) {
      items.push({ severity: 'warn', text: 'Aucun contrat actif — impossible de calculer la paie pour ce salarié.' });
    } else {
      const smig = this.monthlySmig();
      if (smig != null && activeContract.baseSalary < smig) {
        items.push({ severity: 'error', text: `Salaire de base (${formatPayrollAmount(activeContract.baseSalary)}) inférieur au SMIG mensuel (${formatPayrollAmount(smig)}).` });
      }
    }
    return items;
  });

  ngOnInit(): void {
    const data = this.route.snapshot.data;
    this.routeBase.set(data['payrollRouteBase'] ?? '/payroll');
    this.firmInternal.set(!!data['firmInternalPayroll']);
    this.loadSmig();
    this.reload();
  }

  private loadSmig(): void {
    this.payroll.getParameters(new Date().getFullYear()).subscribe({
      next: res => this.monthlySmig.set(res.data?.monthlySmig ?? null),
      error: () => this.monthlySmig.set(null)
    });
  }

  reload(): void {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.loading.set(true);
    this.employees.getById(id).subscribe({
      next: res => {
        this.employee.set(res.data ?? null);
        this.loading.set(false);
      },
      error: () => {
        this.toast.add({ severity: 'error', summary: 'Salarié', detail: 'Salarié introuvable.' });
        this.loading.set(false);
      }
    });
  }

  formatAddress(): string {
    const a = this.employee()?.address;
    if (!a) return '—';
    return [a.street, a.streetLine2, a.city, a.governorate].filter(Boolean).join(', ') || '—';
  }

  openContractDialog(): void {
    if (!this.canManage()) return;
    this.editingContract = null;
    this.contractDialogVisible = true;
  }

  editContract(c: EmploymentContract): void {
    if (!this.canManage()) return;
    this.editingContract = c;
    this.contractDialogVisible = true;
  }

  confirmDeleteContract(c: EmploymentContract): void {
    if (!this.canManage()) return;
    this.confirmation.confirm({
      message: `Supprimer le contrat ${c.typeDisplay} ?`,
      header: 'Confirmation',
      acceptLabel: 'Supprimer',
      rejectLabel: 'Annuler',
      acceptButtonStyleClass: 'btn-danger',
      accept: () => {
        this.employees.deleteContract(c.id).subscribe({
          next: () => {
            this.toast.add({ severity: 'success', summary: 'Contrat', detail: 'Contrat supprimé.' });
            this.reload();
          },
          error: err => this.toast.add({ severity: 'error', summary: 'Contrat', detail: err.error?.message ?? 'Suppression impossible.' })
        });
      }
    });
  }

  toggleActive(): void {
    if (!this.canManage() || !this.employee()) return;
    this.employees.toggleActive(this.employee()!.id).subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: 'Salarié', detail: 'Statut mis à jour.' });
        this.reload();
      },
      error: err => this.toast.add({ severity: 'error', summary: 'Salarié', detail: err.error?.message ?? 'Action impossible.' })
    });
  }

  confirmDelete(): void {
    if (!this.canManage() || !this.employee()) return;
    this.confirmation.confirm({
      message: `Supprimer le salarié « ${this.employee()!.fullName} » ?`,
      header: 'Confirmation de suppression',
      acceptLabel: 'Supprimer',
      rejectLabel: 'Annuler',
      acceptButtonStyleClass: 'btn-danger',
      accept: () => {
        this.employees.delete(this.employee()!.id).subscribe({
          next: () => {
            this.toast.add({ severity: 'success', summary: 'Salarié', detail: 'Salarié supprimé.' });
            this.router.navigate([this.routeBase() + '/employees']);
          },
          error: err => this.toast.add({ severity: 'error', summary: 'Salarié', detail: err.error?.message ?? 'Suppression impossible.' })
        });
      }
    });
  }
}
