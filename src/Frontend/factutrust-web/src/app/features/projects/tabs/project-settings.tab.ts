import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CheckboxModule } from 'primeng/checkbox';
import { SelectModule } from 'primeng/select';
import { InputNumberModule } from 'primeng/inputnumber';
import { ButtonComponent } from '@shared/components/button/button.component';
import { FormSectionComponent } from '@shared/components/form-section/form-section.component';
import { ProjectDetail, ProjectSettingsPayload } from '../project-api.service';
import {
  billingOptionsForKind,
  isBtp,
  isEsn,
  parseProjectBillingMode,
  parseProjectKind
} from '../project-enums';
import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';

@Component({
  selector: 'app-project-settings-tab',
  standalone: true,
  imports: [
    BackendLabelPipe,
    CommonModule,
    FormsModule,
    CheckboxModule,
    SelectModule,
    InputNumberModule,
    ButtonComponent,
    FormSectionComponent
  ],
  template: `
    @if (project) {
      <div class="proj-settings">
        <div class="proj-meta-chips" aria-label="Paramètres actifs" i18n-aria-label="@@projects.tabs.parametres.actifs.cf9bcff9">
          @if (project.timesheetsEnabled) {
            <span class="proj-chip" i18n="@@projects.tabs.feuilles.de.temps.5ad1d040"><i class="pi pi-clock"></i> Feuilles de temps</span>
          }
          @if (project.milestonesEnabled) {
            <span class="proj-chip" i18n="@@projects.tabs.jalons.fafd37b5"><i class="pi pi-flag"></i> Jalons</span>
          }
          <span class="proj-chip"><i class="pi pi-wallet"></i> {{ project.billingModeDisplay | backendLabel }}</span>
        </div>

        <app-form-section title="Facturation" i18n-title="@@projects.tabs.facturation.0a55d22e" icon="pi-sliders-h" variant="compact">
          <div class="ft-form-grid">
            <div class="ft-field ft-field--full">
              <label for="settingsBillingMode" i18n="@@projects.tabs.mode.de.facturation.d797aff0">Mode de facturation</label>
              <p-select
                inputId="settingsBillingMode"
                class="w-full"
                [options]="billingOptions()"
                [(ngModel)]="settingsDraft.billingMode"
                optionLabel="label"
                optionValue="value"
                [disabled]="!canUpdate" />
            </div>
          </div>
        </app-form-section>

        <app-form-section title="Temps & suivi" i18n-title="@@projects.tabs.temps.suivi.44a27d1d" icon="pi-clock" variant="compact">
          <div class="ft-form-grid">
            <div class="ft-field ft-field--full">
              <div class="proj-create-options">
                <div class="proj-create-options__item">
                  <p-checkbox
                    [(ngModel)]="settingsDraft.timesheetsEnabled"
                    [binary]="true"
                    inputId="settingsTimesheets"
                    [disabled]="!canUpdate" />
                  <label for="settingsTimesheets" i18n="@@projects.tabs.feuilles.de.temps.active.la.saisie.et.le.80690e9c">
                    <strong>Feuilles de temps</strong>
                    <span class="text-sm text-color-secondary">Active la saisie et le suivi du temps sur ce projet.</span>
                  </label>
                </div>
                @if (showMilestonesOption()) {
                  <div class="proj-create-options__item">
                    <p-checkbox
                      [(ngModel)]="settingsDraft.milestonesEnabled"
                      [binary]="true"
                      inputId="settingsMilestones"
                      [disabled]="!canUpdate" />
                    <label for="settingsMilestones" i18n="@@projects.tabs.jalons.active.le.suivi.et.la.facturation.88e00fdb">
                      <strong>Jalons</strong>
                      <span class="text-sm text-color-secondary">Active le suivi et la facturation par jalons.</span>
                    </label>
                  </div>
                }
              </div>
            </div>
            <div class="ft-field">
              <label for="settingsAllocatedHours" i18n="@@projects.tabs.heures.allouees.8070df86">Heures allouées</label>
              <p-inputNumber
                inputId="settingsAllocatedHours"
                class="w-full"
                [(ngModel)]="settingsDraft.allocatedHours"
                mode="decimal"
                [min]="0"
                [minFractionDigits]="0"
                [maxFractionDigits]="2"
                suffix=" h"
                [disabled]="!canUpdate" />
            </div>
          </div>
        </app-form-section>

        @if (canUpdate) {
          <div class="proj-settings__actions">
            <app-button
              variant="primary"
              icon="pi-save"
              [disabled]="!hasChanges()"
              (click)="onSave()" i18n="@@projects.tabs.enregistrer.les.parametres.f1ccef8d">
              Enregistrer les paramètres
            </app-button>
          </div>
        } @else {
          <p class="proj-settings__readonly text-sm text-color-secondary m-0" i18n="@@projects.tabs.vous.n.avez.pas.la.permission.de.modifie.0fc57c4b">
            Vous n'avez pas la permission de modifier les paramètres de ce projet.
          </p>
        }
      </div>
    }
  `
})
export class ProjectSettingsTabComponent implements OnChanges {
  @Input() project: ProjectDetail | null = null;
  @Input() canUpdate = false;

  @Output() save = new EventEmitter<ProjectSettingsPayload>();

  settingsDraft: ProjectSettingsPayload = {
    billingMode: 'None',
    timesheetsEnabled: false,
    milestonesEnabled: false,
    allocatedHours: 0
  };

  private baseline = '';

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['project'] && this.project) {
      this.resetDraft();
    }
  }

  billingOptions() {
    const kind = this.project ? parseProjectKind(this.project.kind) ?? 'Generic' : 'Generic';
    return billingOptionsForKind(kind);
  }

  showMilestonesOption(): boolean {
    if (!this.project) return false;
    const kind = parseProjectKind(this.project.kind);
    const billing = parseProjectBillingMode(this.settingsDraft.billingMode);
    return isEsn(this.project.kind) || billing === 'Milestone' || isBtp(this.project.kind);
  }

  hasChanges(): boolean {
    return this.serializeDraft() !== this.baseline;
  }

  onSave(): void {
    if (!this.hasChanges()) return;
    this.save.emit({ ...this.settingsDraft });
  }

  private resetDraft(): void {
    const p = this.project!;
    this.settingsDraft = {
      billingMode: parseProjectBillingMode(p.billingMode) ?? 'None',
      timesheetsEnabled: p.timesheetsEnabled,
      milestonesEnabled: p.milestonesEnabled ?? false,
      allocatedHours: p.allocatedHours ?? 0
    };
    this.baseline = this.serializeDraft();
  }

  private serializeDraft(): string {
    return JSON.stringify(this.settingsDraft);
  }
}
