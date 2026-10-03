/// <reference types="@angular/localize" />
import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
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
  imports: [BackendLabelPipe, 
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
      <p i18n="@@payroll.employees.chargement.01cba1df">Chargement…</p>
    } @else if (employee()) {
      <app-page-header [title]="employee()!.fullName" [subtitle]="loc_ui_tern_matricule_6d6b53 + employee()!.employeeNumber">
        @if (canManage()) {
          <app-button variant="outline" icon="pi-pencil" iconPos="left" [routerLink]="[routeBase() + '/employees', employee()!.id, 'edit']" i18n="@@payroll.employees.modifier.f260e757">Modifier</app-button>
          @if (!employee()!.terminationDate) {
            <app-button variant="outline" icon="pi-sign-out" iconPos="left" (click)="departureDialogVisible = true" i18n="@@payroll.employees.declarer.un.depart.97498276">Déclarer un départ</app-button>
          }
          <app-button variant="outline" [icon]="employee()!.isActive ? 'pi-ban' : 'pi-check'" iconPos="left" (click)="toggleActive()">
            {{ employee()!.isActive ? loc_ui_tern_desactiver_d28397 : loc_ui_tern_reactiver_822dbd }}
          </app-button>
          <app-button variant="danger" icon="pi-trash" iconPos="left" (click)="confirmDelete()" i18n="@@payroll.employees.supprimer.1acfc1c7">Supprimer</app-button>
        }
      </app-page-header>

      <app-payroll-consult-banner
        [visible]="showConsultBanner()"
        message="Mode consultation — la gestion des dossiers salariés est réservée à la société cliente." i18n-message="@@payroll.employees.mode.consultation.la.gestion.des.dossier.70b001ac" />

      @if (alerts().length) {
        <div class="payroll-alert-list">
          @for (alert of alerts(); track alert) {
            <p-message [severity]="alert.severity" [text]="alert.text" styleClass="w-full" />
          }
        </div>
      }

      <p-tabs class="ft-tabs" [lazy]="true" [(value)]="activeTab">
        <p-tablist>
          <p-tab [value]="0"><i class="pi pi-id-card mr-2"></i><span i18n="@@payroll.employees.informations.54937b3a">Informations</span></p-tab>
          <p-tab [value]="1"><i class="pi pi-file mr-2"></i><span i18n="@@payroll.employees.contrats.d35fbb32">Contrats</span></p-tab>
          <p-tab [value]="2"><i class="pi pi-calendar mr-2"></i><span i18n="@@payroll.employees.conges.042d16a6">Congés</span></p-tab>
          <p-tab [value]="3"><i class="pi pi-building mr-2"></i><span i18n="@@payroll.employees.ij.cnss.ba1104da">IJ CNSS</span></p-tab>
          <p-tab [value]="4"><i class="pi pi-ban mr-2"></i><span i18n="@@payroll.employees.suspensions.8d1d54a8">Suspensions</span></p-tab>
          <p-tab [value]="5"><i class="pi pi-wallet mr-2"></i><span i18n="@@payroll.employees.avances.59b65531">Avances</span></p-tab>
          <p-tab [value]="6"><i class="pi pi-heart mr-2"></i><span i18n="@@payroll.employees.mutuelles.5a091ac3">Mutuelles</span></p-tab>
          <p-tab [value]="7"><i class="pi pi-home mr-2"></i><span i18n="@@payroll.employees.avantages.en.nature.7683e287">Avantages en nature</span></p-tab>
          <p-tab [value]="8"><i class="pi pi-credit-card mr-2"></i><span i18n="@@payroll.employees.prets.54264e09">Prêts</span></p-tab>
          <p-tab [value]="9"><i class="pi pi-exclamation-triangle mr-2"></i><span i18n="@@payroll.employees.saisies.1b5fdae4">Saisies</span></p-tab>
          <p-tab [value]="10"><i class="pi pi-file-pdf mr-2"></i><span i18n="@@payroll.employees.documents.rh.57cc3bb8">Documents RH</span></p-tab>
        </p-tablist>
        <p-tabpanels>
        <p-tabpanel [value]="0">
          <dl class="payroll-detail-grid card p-3">
            <div>
              <dt i18n="@@payroll.employees.cin.748d5d16">CIN</dt>
              <dd>{{ employee()!.cin || '—' }}</dd>
            </div>
            <div>
              <dt i18n="@@payroll.employees.cnss.a04d171a">CNSS</dt>
              <dd>
                @if (employee()!.cnssNumber) {
                  {{ employee()!.cnssNumber }}
                } @else {
                  <p-tag value="CNSS manquant" severity="warn" />
                }
              </dd>
            </div>
            <div>
              <dt i18n="@@payroll.employees.categorie.6b38300a">Catégorie</dt>
              <dd>{{ employee()!.category || '—' }}</dd>
            </div>
            <div>
              <dt i18n="@@payroll.employees.echelon.8d0277a5">Échelon</dt>
              <dd>{{ employee()!.echelon || '—' }}</dd>
            </div>
            <div>
              <dt i18n="@@payroll.employees.date.naissance.e3945b67">Date naissance</dt>
              <dd>{{ employee()!.dateOfBirth ? (employee()!.dateOfBirth | date:'dd/MM/yyyy') : '—' }}</dd>
            </div>
            <div>
              <dt i18n="@@payroll.employees.embauche.5660c937">Embauche</dt>
              <dd>{{ employee()!.hireDate | date:'dd/MM/yyyy' }}</dd>
            </div>
            @if (employee()!.terminationDate) {
              <div>
                <dt i18n="@@payroll.employees.date.de.sortie.a963425d">Date de sortie</dt>
                <dd>{{ employee()!.terminationDate | date:'dd/MM/yyyy' }}</dd>
              </div>
            }
            <div>
              <dt i18n="@@payroll.employees.situation.familiale.3b708781">Situation familiale</dt>
              <dd>{{ employee()!.maritalStatusDisplay | backendLabel }}</dd>
            </div>
            <div>
              <dt i18n="@@payroll.employees.chef.de.famille.0ba5a38a">Chef de famille</dt>
              <dd>{{ employee()!.isHeadOfFamily ? loc_ui_tern_oui_eaa02f : loc_ui_tern_non_a72199 }}</dd>
            </div>
            <div>
              <dt i18n="@@payroll.employees.enfants.a.charge.d024299f">Enfants à charge</dt>
              <dd>{{ employee()!.dependentChildren }}</dd>
            </div>
            <div>
              <dt i18n="@@payroll.employees.dont.etudiants.infirmes.3f2a5be9">Dont étudiants / infirmes</dt>
              <dd>{{ employee()!.studentChildren }} / {{ employee()!.disabledChildren }}</dd>
            </div>
            <div>
              <dt i18n="@@payroll.employees.parents.a.charge.ce5fcb65">Parents à charge</dt>
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
                <dt i18n="@@payroll.employees.declarations.nominatives.c901bf65">Déclarations nominatives</dt>
                <dd>
                  <ul>
                    @for (claim of employee()!.dependentParentClaims!; track claim.parentCin) {
                      <li>
                        {{ claim.kinship === 'Father' ? loc_ui_tern_pere_3b0ae0 : loc_ui_tern_mere_0c6533 }}
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
              <dt i18n="@@payroll.employees.email.84add5b2">Email</dt>
              <dd>{{ employee()!.email || '—' }}</dd>
            </div>
            <div>
              <dt i18n="@@payroll.employees.telephone.d3b023ea">Téléphone</dt>
              <dd>{{ employee()!.phone || '—' }}</dd>
            </div>
            <div>
              <dt i18n="@@payroll.employees.rib.61f3ea57">RIB</dt>
              <dd>{{ employee()!.rib || '—' }}</dd>
            </div>
            <div>
              <dt i18n="@@payroll.employees.adresse.522e1466">Adresse</dt>
              <dd>{{ employee()!.address?.fullAddress || formatAddress() }}</dd>
            </div>
            <div>
              <dt i18n="@@payroll.employees.statut.659499f3">Statut</dt>
              <dd>
                <p-tag [value]="employee()!.isActive ? loc_ui_tern_actif_2eb75f : loc_ui_tern_inactif_d2e033" [severity]="employee()!.isActive ? 'success' : 'secondary'" />
              </dd>
            </div>
          </dl>
        </p-tabpanel>

        <p-tabpanel [value]="1">
          @if (canManage()) {
            <app-button variant="primary" icon="pi-plus" iconPos="left" (click)="openContractDialog()" class="mb-3" i18n="@@payroll.employees.ajouter.un.contrat.08d8a5b5">Ajouter un contrat</app-button>
          }
          @for (c of employee()!.contracts; track c.id) {
            <div class="card p-3 mb-3">
              <div class="contract-header">
                <div>
                  <strong>{{ c.typeDisplay | backendLabel }}</strong> — {{ c.regimeDisplay | backendLabel }} — {{ c.weeklyRegimeDisplay | backendLabel }}
                  @if (!c.isActive) { <p-tag value="Inactif" severity="secondary" class="ml-2" /> }
                </div>
                @if (canManage()) {
                  <span class="contract-actions">
                    <button type="button" class="p-button p-button-text p-button-sm" (click)="editContract(c)" i18n="@@payroll.employees.modifier.f260e757">Modifier</button>
                    <button type="button" class="p-button p-button-text p-button-danger p-button-sm" (click)="confirmDeleteContract(c)" i18n="@@payroll.employees.supprimer.1acfc1c7">Supprimer</button>
                  </span>
                }
              </div>
              <p><ng-container i18n="@@payroll.employees.du.71a2b148">Du {{ c.startDate | date:'dd/MM/yyyy' }} </ng-container>@if (c.endDate) {<ng-container i18n="@@payroll.employees.au.a6c23617"> au {{ c.endDate | date:'dd/MM/yyyy' }} </ng-container>}</p>
              <p i18n="@@payroll.employees.salaire.base.at.c78d0616">Salaire base : {{ c.baseSalary | payrollAmount }} — AT : {{ c.workAccidentRate }} %</p>
              @if (c.jobTitle) { <p i18n="@@payroll.employees.poste.4d4e64e1">Poste : {{ c.jobTitle }}</p> }
              @if (c.allowances.length) {
                <p-table [value]="c.allowances" styleClass="p-datatable-sm mt-2">
                  <ng-template pTemplate="header">
                    <tr><th i18n="@@payroll.employees.prime.2533d6c7">Prime</th><th class="text-right" i18n="@@payroll.employees.montant.4adcd9fc">Montant</th><th i18n="@@payroll.employees.imposable.49743e0c">Imposable</th><th i18n="@@payroll.employees.cnss.a04d171a">CNSS</th></tr>
                  </ng-template>
                  <ng-template pTemplate="body" let-a>
                    <tr>
                      <td>{{ a.label }}</td>
                      <td class="text-right">{{ a.amount | payrollAmount }}</td>
                      <td>{{ a.taxable ? loc_ui_tern_oui_eaa02f : loc_ui_tern_non_a72199 }}</td>
                      <td>{{ a.subjectToCnss ? loc_ui_tern_oui_eaa02f : loc_ui_tern_non_a72199 }}</td>
                    </tr>
                  </ng-template>
                </p-table>
              }
            </div>
          } @empty {
            <p i18n="@@payroll.employees.aucun.contrat.enregistre.5deb93f5">Aucun contrat enregistré.</p>
          }
        </p-tabpanel>

        <p-tabpanel [value]="2">
          @if (firmInternal()) {
            <!-- Paie interne du cabinet : les congés se saisissent une seule fois, côté RH,
                 et sont reportés automatiquement ici à l'approbation. -->
            <div class="leaves-source-banner">
              <i class="pi pi-info-circle"></i>
              <div>
                <strong i18n="@@payroll.employees.les.conges.du.cabinet.se.saisissent.dans.conges..37342f87">Les congés du cabinet se saisissent dans Congés &amp; Absences.</strong>
                <p i18n="@@payroll.employees.cette.vue.reflete.les.conges.approuves.qui.ont.e.a81d0218">Cette vue reflète les congés approuvés qui ont été reportés en paie.</p>
              </div>
              <a routerLink="/firm/governance/leaves" class="banner-link" i18n="@@payroll.employees.ouvrir.conges.amp.absences.8df27d06">Ouvrir Congés &amp; Absences</a>
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
    .ml-2 { margin-inline-start: var(--spacing-2); }
    .mt-2 { margin-top: var(--spacing-2); }
    .mr-2 { margin-inline-end: var(--spacing-2); }
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
    .leaves-source-banner .banner-link { margin-inline-start: auto; color: var(--color-primary, #0f766e); white-space: nowrap; }
  `]
})
export class EmployeeDetailComponent implements OnInit {
  readonly loc_ui_tern_matricule_6d6b53 = $localize`:@@ui.tern.matricule.6d6b53:Matricule `;
  readonly loc_ui_tern_desactiver_d28397 = $localize`:@@ui.tern.desactiver.d28397:Désactiver`;
  readonly loc_ui_tern_reactiver_822dbd = $localize`:@@ui.tern.reactiver.822dbd:Réactiver`;
  readonly loc_ui_tern_oui_eaa02f = $localize`:@@ui.tern.oui.eaa02f:Oui`;
  readonly loc_ui_tern_non_a72199 = $localize`:@@ui.tern.non.a72199:Non`;
  readonly loc_ui_tern_pere_3b0ae0 = $localize`:@@ui.tern.pere.3b0ae0:Père`;
  readonly loc_ui_tern_mere_0c6533 = $localize`:@@ui.tern.mere.0c6533:Mère`;
  readonly loc_ui_tern_actif_2eb75f = $localize`:@@ui.tern.actif.2eb75f:Actif`;
  readonly loc_ui_tern_inactif_d2e033 = $localize`:@@ui.tern.inactif.d2e033:Inactif`;
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly employees = inject(EmployeeService);
  private readonly payroll = inject(PayrollService);
  private readonly toast = inject(ToastService);
  private readonly confirmation = inject(ConfirmationService);
  readonly auth = inject(AuthService);

  loading = signal(true);
  /** Onglet affiché. 0 = Informations, sélectionné dès le montage de la fiche. */
  activeTab = 0;
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
      items.push({ severity: 'warn', text: $localize`:@@payroll.employee-detail.ts.numero.cnss.manquant.requis.pour.la.decl.d509b7b4:Numéro CNSS manquant — requis pour la déclaration sociale et la paie.` });
    }
    const activeContract = e.contracts.find(c => c.isActive);
    if (!activeContract) {
      items.push({ severity: 'warn', text: $localize`:@@payroll.employee-detail.ts.aucun.contrat.actif.impossible.de.calcul.11b9f20a:Aucun contrat actif — impossible de calculer la paie pour ce salarié.` });
    } else {
      const smig = this.monthlySmig();
      if (smig != null && activeContract.baseSalary < smig) {
        items.push({ severity: 'error', text: $localize`:@@payroll.employee-detail.ts.salaire.de.base.formatpayrollamount.infe.a26e96b4:Salaire de base (${formatPayrollAmount(activeContract.baseSalary)}:formatPayrollAmount:) inférieur au SMIG mensuel (${formatPayrollAmount(smig)}:formatPayrollAmount1:).` });
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
        this.toast.add({ severity: 'error', summary: $localize`:@@employee-detail.component.summary.Salarié:Salarié`, detail: $localize`:@@employee-detail.component.detail.Salari_introuva:Salarié introuvable.` });
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
      message: $localize`:@@payroll.employee-detail.ts.supprimer.le.contrat.typedisplay.7c214dac:Supprimer le contrat ${c.typeDisplay}:typeDisplay: ?`,
      header: $localize`:@@payroll.employee-detail.ts.confirmation.3424edc2:Confirmation`,
      acceptLabel: $localize`:@@employee-detail.component.acceptLabel.Supprimer:Supprimer`,
      rejectLabel: $localize`:@@employee-detail.component.rejectLabel.Annuler:Annuler`,
      acceptButtonStyleClass: 'btn-danger',
      accept: () => {
        this.employees.deleteContract(c.id).subscribe({
          next: () => {
            this.toast.add({ severity: 'success', summary: $localize`:@@employee-detail.component.summary.Contrat:Contrat`, detail: $localize`:@@employee-detail.component.detail.Contrat_supprim_:Contrat supprimé.` });
            this.reload();
          },
          error: err => this.toast.add({ severity: 'error', summary: $localize`:@@employee-detail.component.summary.Contrat:Contrat`, detail: err.error?.message ?? $localize`:@@ui.tern.suppression.impossible.0dffe4:Suppression impossible.` })
        });
      }
    });
  }

  toggleActive(): void {
    if (!this.canManage() || !this.employee()) return;
    this.employees.toggleActive(this.employee()!.id).subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: $localize`:@@employee-detail.component.summary.Salarié:Salarié`, detail: $localize`:@@employee-detail.component.detail.Statut mis à:Statut mis à jour.` });
        this.reload();
      },
      error: err => this.toast.add({ severity: 'error', summary: $localize`:@@employee-detail.component.summary.Salarié:Salarié`, detail: err.error?.message ?? $localize`:@@ui.tern.action.impossible.cd5717:Action impossible.` })
    });
  }

  confirmDelete(): void {
    if (!this.canManage() || !this.employee()) return;
    this.confirmation.confirm({
      message: $localize`:@@payroll.employee-detail.ts.supprimer.le.salarie.fullname.b6d83592:Supprimer le salarié « ${this.employee()!.fullName}:fullName: » ?`,
      header: $localize`:@@payroll.employee-detail.ts.confirmation.de.suppression.6a082d0b:Confirmation de suppression`,
      acceptLabel: $localize`:@@employee-detail.component.acceptLabel.Supprimer:Supprimer`,
      rejectLabel: $localize`:@@employee-detail.component.rejectLabel.Annuler:Annuler`,
      acceptButtonStyleClass: 'btn-danger',
      accept: () => {
        this.employees.delete(this.employee()!.id).subscribe({
          next: () => {
            this.toast.add({ severity: 'success', summary: $localize`:@@employee-detail.component.summary.Salarié:Salarié`, detail: $localize`:@@employee-detail.component.detail.Salarié supp:Salarié supprimé.` });
            this.router.navigate([this.routeBase() + '/employees']);
          },
          error: err => this.toast.add({ severity: 'error', summary: $localize`:@@employee-detail.component.summary.Salarié:Salarié`, detail: err.error?.message ?? $localize`:@@ui.tern.suppression.impossible.0dffe4:Suppression impossible.` })
        });
      }
    });
  }
}
