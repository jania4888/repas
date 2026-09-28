/// <reference types="@angular/localize" />
import { Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonComponent } from '@shared/components/button/button.component';
import { PayrollService } from '@core/services/payroll.service';
import { ToastService } from '@core/services/toast.service';
import { AuthService } from '@core/services/auth.service';
import { canGenerateHrDocuments } from '@core/utils/payroll-access';
import { PayrollSectionComponent } from '../shared';

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

@Component({
  selector: 'app-employee-hr-documents',
  standalone: true,
  imports: [CommonModule, ButtonComponent, PayrollSectionComponent],
  template: `
    <app-payroll-section
      title="Documents RH" i18n-title="@@payroll.employees.documents.rh.57cc3bb8"
      subtitle="Certificats et attestations issus des bulletins de paie figés (cycles validés ou clôturés)." i18n-subtitle="@@payroll.employees.certificats.et.attestations.issus.des.bu.9e867f0e"
      icon="pi-file-pdf">
      @if (!featureReady()) {
        <p i18n="@@payroll.employees.chargement.des.options.520e652e">Chargement des options…</p>
      } @else if (!hrDocumentsEnabled()) {
        <p class="text-muted" i18n="@@payroll.employees.la.generation.de.documents.rh.n.est.pas.activee..bd362f6d">La génération de documents RH n'est pas activée sur cet environnement.</p>
      } @else if (!canDownload()) {
        <p class="text-muted" i18n="@@payroll.employees.vous.n.avez.pas.la.permission.de.generer.des.doc.fb9fe35a">Vous n'avez pas la permission de générer des documents RH.</p>
      } @else {
        <div class="hr-doc-actions">
          <app-button
            variant="outline"
            icon="pi-download"
            iconPos="left"
            [disabled]="downloading() !== null"
            (click)="downloadEmploymentCertificate()" i18n="@@payroll.employees.certificat.de.travail.02713183"> Certificat de travail </app-button>

          <div class="salary-group">
            <span class="group-label" i18n="@@payroll.employees.attestation.de.salaire.dbadd260">Attestation de salaire</span>
            <div class="salary-buttons">
              @for (months of salaryPeriods; track months) {
                <app-button
                  variant="outline"
                  icon="pi-download"
                  iconPos="left"
                  [disabled]="downloading() !== null"
                  (click)="downloadSalaryCertificate(months)" i18n="@@payroll.employees.mois.5d638f01">
                  {{ months }} mois
                </app-button>
              }
            </div>
          </div>

          @if (showStc()) {
            <app-button
              variant="outline"
              icon="pi-download"
              iconPos="left"
              [disabled]="downloading() !== null"
              (click)="downloadSoldeToutCompte()" i18n="@@payroll.employees.solde.de.tout.compte.93fc3ea6"> Solde de tout compte </app-button>
          }
        </div>
      }
    </app-payroll-section>
  `,
  styles: [`
    .hr-doc-actions {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-4);
      align-items: flex-start;
    }
    .salary-group {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
    }
    .group-label {
      font-size: 0.875rem;
      color: var(--text-color-secondary, #6b7280);
      font-weight: 600;
    }
    .salary-buttons {
      display: flex;
      flex-wrap: wrap;
      gap: var(--spacing-2);
    }
    .text-muted {
      color: var(--text-color-secondary, #6b7280);
    }
  `]
})
export class EmployeeHrDocumentsComponent implements OnInit {
  @Input({ required: true }) employeeId!: string;
  @Input() terminationDate?: string | null;

  private readonly payroll = inject(PayrollService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);

  readonly salaryPeriods = [3, 6, 12] as const;

  featureReady = signal(false);
  hrDocumentsEnabled = signal(false);
  downloading = signal<string | null>(null);

  canDownload = computed(() => canGenerateHrDocuments(this.auth));
  showStc = computed(() => !!this.terminationDate);

  ngOnInit(): void {
    this.payroll.getFeatureFlags().subscribe({
      next: res => {
        this.hrDocumentsEnabled.set(res.data?.hrDocumentsEnabled === true);
        this.featureReady.set(true);
      },
      error: () => {
        this.hrDocumentsEnabled.set(false);
        this.featureReady.set(true);
      }
    });
  }

  downloadEmploymentCertificate(): void {
    this.download('employment', () =>
      this.payroll.downloadEmploymentCertificatePdf(this.employeeId),
      `certificat-travail-${this.employeeId}.pdf`,
      $localize`:@@payroll.employee-hr-documents.ts.certificat.de.travail.02713183:Certificat de travail`
    );
  }

  downloadSalaryCertificate(months: 3 | 6 | 12): void {
    this.download(`salary-${months}`, () =>
      this.payroll.downloadSalaryCertificatePdf(this.employeeId, months),
      `attestation-salaire-${months}m-${this.employeeId}.pdf`,
      $localize`:@@payroll.employee-hr-documents.ts.attestation.de.salaire.months.mois.cddcf792:Attestation de salaire (${months}:months: mois)`
    );
  }

  downloadSoldeToutCompte(): void {
    this.download('stc', () =>
      this.payroll.downloadSoldeToutComptePdf(this.employeeId),
      `solde-tout-compte-${this.employeeId}.pdf`,
      $localize`:@@payroll.employee-hr-documents.ts.solde.de.tout.compte.93fc3ea6:Solde de tout compte`
    );
  }

  private download(
    key: string,
    request: () => ReturnType<PayrollService['downloadEmploymentCertificatePdf']>,
    filename: string,
    label: string
  ): void {
    if (!this.canDownload() || !this.hrDocumentsEnabled()) return;
    this.downloading.set(key);
    request().subscribe({
      next: blob => {
        downloadBlob(blob, filename);
        this.toast.add({ severity: 'success', summary: $localize`:@@employee-hr-documents.component.summary.Documents_RH:Documents RH`, detail: $localize`:@@payroll.employee-hr-documents.ts.label.telecharge.e366aafe:${label}:label: téléchargé.` });
        this.downloading.set(null);
      },
      error: err => {
        this.toast.add({
          severity: 'error',
          summary: $localize`:@@employee-hr-documents.component.summary.Documents_RH:Documents RH`,
          detail: err.error?.message ?? $localize`:@@ui.tern.impossible.de.generer.ph.ee5254:Impossible de générer ${label.toLowerCase()}:p0:.`
        });
        this.downloading.set(null);
      }
    });
  }
}
