import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { TableTotalsBarComponent, TotalMetric } from '@shared/components/table-totals-bar/table-totals-bar.component';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { InputTextModule } from 'primeng/inputtext';
import { Textarea } from 'primeng/textarea';
import { InputNumberModule } from 'primeng/inputnumber';
import { CheckboxModule } from 'primeng/checkbox';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { CrmService, OpportunityDto } from '../services/crm.service';
import { ClientService, ClientListItem } from '@core/services/client.service';
import { AuthService } from '@core/services/auth.service';

interface StageOption {
  label: string;
  value: number | null;
}

@Component({
  selector: 'app-opportunity-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    TableModule,
    DialogModule,
    SelectModule,
    DatePickerModule,
    InputTextModule,
    Textarea,
    InputNumberModule,
    CheckboxModule,
    PageHeaderComponent,
    ButtonComponent,
    TableTotalsBarComponent
  ],
  template: `
    <app-page-header title="Opportunités" i18n-title="@@crm.opportunities.opportunites.0dbfa3c5" subtitle="Pipeline commercial" />
    <div class="card p-3 mb-3 opportunity-toolbar">
      <div class="toolbar-row">
        <p-select
          [options]="stageOptions"
          [(ngModel)]="selectedStageOption"
          optionLabel="label"
          placeholder="Stage" i18n-placeholder="@@crm.opportunities.stage.ca6d0e3a"
          [showClear]="true"
          styleClass="toolbar-dropdown"
          inputId="oppStageFilter"
          (onChange)="load()"
          [attr.aria-label]="'Filtrer par stage'"></p-select>
        <div class="toolbar-mine">
          <p-checkbox
            inputId="oppMineOnly"
            name="oppMineOnly"
            [(ngModel)]="myOpportunitiesOnly"
            [binary]="true"
            (ngModelChange)="load()"></p-checkbox>
          <label for="oppMineOnly" i18n="@@crm.opportunities.mes.opportunites.a7f22363">Mes opportunités</label>
        </div>
        <app-button variant="secondary" icon="pi pi-refresh" iconPos="left" (click)="load()" ariaLabel="Actualiser la liste" i18n="@@crm.opportunities.actualiser.9d3b2a7d"> Actualiser </app-button>
        <app-button variant="primary" icon="pi pi-plus" iconPos="left" (click)="openCreate()" ariaLabel="Nouvelle opportunité" i18n="@@crm.opportunities.nouvelle.opportunite.ffadea57"> Nouvelle opportunité </app-button>
      </div>
    </div>
    @if (error()) {
      <p class="text-danger p-3" role="alert">{{ error() }}</p>
    }
    <app-table-totals-bar [metrics]="summaryMetrics()"></app-table-totals-bar>
    <p-table [value]="items()" [paginator]="true" [rows]="15" styleClass="p-datatable-sm opportunity-table">
      <ng-template pTemplate="header">
        <tr>
          <th scope="col" i18n="@@crm.opportunities.titre.eb97899a">Titre</th>
          <th scope="col" i18n="@@crm.opportunities.commercial.b48513e4">Commercial</th>
          <th scope="col" i18n="@@crm.opportunities.stage.ca6d0e3a">Stage</th>
          <th scope="col" i18n="@@crm.opportunities.montant.4adcd9fc">Montant</th>
          <th scope="col" i18n="@@crm.opportunities.prob.9690cb4f">Prob.</th>
          <th scope="col" i18n="@@crm.opportunities.pondere.c48371c8">Pondéré</th>
          <th scope="col" i18n="@@crm.opportunities.echeance.f9a77ff6">Échéance</th>
          <th scope="col" class="col-actions" i18n="@@crm.opportunities.actions.c3cd636a">Actions</th>
        </tr>
      </ng-template>
      <ng-template pTemplate="body" let-o>
        <tr>
          <td style="font-weight:600">{{ o.title }}</td>
          <td>{{ o.assignedUserName }}</td>
          <td><span class="badge" [class]="'badge-' + o.stageColor">{{ o.stageName }}</span></td>
          <td>{{ o.expectedAmount | number:'1.0-0' }}</td>
          <td>{{ o.probability }}%</td>
          <td>{{ o.weightedAmount | number:'1.0-0' }}</td>
          <td>{{ o.expectedCloseDate | date:'shortDate' }}</td>
          <td class="col-actions">
            <div class="action-cell">
              @if (o.stage < 4) {
                <app-button
                  variant="ghost"
                  size="sm"
                  [iconOnly]="true"
                  icon="pi pi-angle-right"
                  ariaLabel="Avancer l’opportunité"
                  title="Avancer" i18n-title="@@crm.opportunities.avancer.ddc5c41f"
                  [iconAlwaysVisible]="true"
                  (click)="advance(o.id)"></app-button>
                <app-button
                  variant="ghost"
                  size="sm"
                  [iconOnly]="true"
                  icon="pi pi-check"
                  ariaLabel="Marquer comme gagnée"
                  title="Gagnée" i18n-title="@@crm.opportunities.gagnee.7dffc692"
                  [iconAlwaysVisible]="true"
                  (click)="win(o.id)"></app-button>
                <app-button
                  variant="ghost"
                  size="sm"
                  [iconOnly]="true"
                  icon="pi pi-times"
                  ariaLabel="Marquer comme perdue"
                  title="Perdue" i18n-title="@@crm.opportunities.perdue.2b13797b"
                  [iconAlwaysVisible]="true"
                  (click)="openLose(o)"></app-button>
              }
              <app-button
                variant="outline"
                size="sm"
                [iconOnly]="true"
                icon="pi pi-pencil"
                ariaLabel="Modifier l’opportunité"
                title="Modifier" i18n-title="@@crm.opportunities.modifier.f260e757"
                (click)="openEdit(o)"></app-button>
            </div>
          </td>
        </tr>
      </ng-template>
      <ng-template pTemplate="emptymessage">
        <tr>
          <td colspan="8" class="empty-cell">
            <div class="empty-state">
              <p class="empty-title" i18n="@@crm.opportunities.aucune.opportunite.pour.ces.criteres.56b4694e">Aucune opportunité pour ces critères</p>
              <p class="empty-hint" i18n="@@crm.opportunities.creez.une.opportunite.pour.suivre.un.deal.dans.l.5ed28c3c">Créez une opportunité pour suivre un deal dans le pipeline.</p>
              <app-button variant="primary" icon="pi pi-plus" iconPos="left" (click)="openCreate()" ariaLabel="Créer une opportunité" i18n="@@crm.opportunities.nouvelle.opportunite.ffadea57"> Nouvelle opportunité </app-button>
            </div>
          </td>
        </tr>
      </ng-template>
    </p-table>

    <p-dialog
      [(visible)]="formDialogVisible"
      [modal]="true"
      [draggable]="false"
      styleClass="opp-form-dialog"
      [contentStyle]="{ overflow: 'visible', padding: 0 }"
      [header]="editingId ? loc_ui_tern_modifier_l_opportunite_c169c9 : loc_ui_tern_nouvelle_opportunite_ffadea"
      [style]="{ width: 'min(560px, 96vw)' }"
      (onHide)="resetFormDialog()"
      [attr.aria-describedby]="'opp-form-desc'">
      <p id="opp-form-desc" class="sr-only">
        {{ editingId ? loc_ui_tern_modifiez_les_champs_puis_enregistrez_d6b04c : loc_ui_tern_renseignez_le_client_le_montant_et_la_date_e8d113 }}
      </p>
      <div class="opp-dialog-body">
        <form [formGroup]="oppForm" (ngSubmit)="saveOpportunity()" class="opp-form">
          <section class="opp-form-section" aria-labelledby="opp-section-deal">
            <h3 id="opp-section-deal" class="form-block-title" i18n="@@crm.opportunities.deal.87078fc0">Deal</h3>
            @if (!editingId) {
              <div class="form-field">
                <label class="field-label" for="oppClient"><ng-container i18n="@@crm.opportunities.client.1bdd79b1">Client </ng-container> <span class="required" aria-hidden="true" i18n="@@crm.opportunities.text.df58248c">*</span></label>
                <p-select
                  inputId="oppClient"
                  formControlName="clientId"
                  [options]="clients"
                  optionLabel="name"
                  optionValue="id"
                  placeholder="Sélectionner un client" i18n-placeholder="@@crm.opportunities.selectionner.un.client.20f49a7a"
                  [filter]="true"
                  filterBy="name,code"
                  styleClass="w-full"
                  [showClear]="true"
                  [class.ng-invalid]="oppForm.get('clientId')?.invalid && oppForm.get('clientId')?.touched"
                  [attr.aria-invalid]="oppForm.get('clientId')?.invalid && oppForm.get('clientId')?.touched ? true : null"
                  [attr.aria-describedby]="oppForm.get('clientId')?.invalid && oppForm.get('clientId')?.touched ? 'opp-client-error' : null"></p-select>
                @if (oppForm.get('clientId')?.invalid && oppForm.get('clientId')?.touched) {
                  <small id="opp-client-error" class="field-error" role="alert" i18n="@@crm.opportunities.selectionnez.un.client.8fb40ef8">Sélectionnez un client.</small>
                }
              </div>
            }
            <div class="form-field">
              <label class="field-label" for="oppTitle"><ng-container i18n="@@crm.opportunities.titre.eb97899a">Titre </ng-container> <span class="required" aria-hidden="true" i18n="@@crm.opportunities.text.df58248c">*</span></label>
              <input
                pInputText
                id="oppTitle"
                class="w-full"
                formControlName="title"
                autocomplete="off"
                [attr.aria-invalid]="oppForm.get('title')?.invalid && oppForm.get('title')?.touched ? true : null"
                [attr.aria-describedby]="oppForm.get('title')?.invalid && oppForm.get('title')?.touched ? 'opp-title-error' : null" />
              @if (oppForm.get('title')?.invalid && oppForm.get('title')?.touched) {
                <small id="opp-title-error" class="field-error" role="alert" i18n="@@crm.opportunities.le.titre.est.obligatoire.27415fac">Le titre est obligatoire.</small>
              }
            </div>
            <div class="form-grid-2">
              <div class="form-field">
                <label class="field-label" for="oppAmount"><ng-container i18n="@@crm.opportunities.montant.attendu.tnd.05d34754">Montant attendu (TND) </ng-container> <span class="required" aria-hidden="true" i18n="@@crm.opportunities.text.df58248c">*</span></label>
                <p-inputNumber
                  inputId="oppAmount"
                  formControlName="expectedAmount"
                  mode="decimal"
                  [minFractionDigits]="0"
                  [maxFractionDigits]="3"
                  styleClass="w-full"></p-inputNumber>
              </div>
              <div class="form-field">
                <label class="field-label" for="oppProb"><ng-container i18n="@@crm.opportunities.probabilite.0871fb8b">Probabilité (%) </ng-container> <span class="required" aria-hidden="true" i18n="@@crm.opportunities.text.df58248c">*</span></label>
                <p-inputNumber
                  inputId="oppProb"
                  formControlName="probability"
                  [min]="0"
                  [max]="100"
                  styleClass="w-full"></p-inputNumber>
              </div>
            </div>
            <div class="form-field">
              <label class="field-label" for="oppClose"><ng-container i18n="@@crm.opportunities.date.de.cloture.attendue.f610b7d3">Date de clôture attendue </ng-container> <span class="required" aria-hidden="true" i18n="@@crm.opportunities.text.df58248c">*</span></label>
              <p-datepicker
                inputId="oppClose"
                formControlName="expectedCloseDate"
                dateFormat="dd/mm/yy"
                [showIcon]="true"
                [readonlyInput]="true"
                appendTo="body"
                styleClass="w-full"
                [attr.aria-invalid]="oppForm.get('expectedCloseDate')?.invalid && oppForm.get('expectedCloseDate')?.touched ? true : null"
                [attr.aria-describedby]="oppForm.get('expectedCloseDate')?.invalid && oppForm.get('expectedCloseDate')?.touched ? 'opp-close-error' : null"></p-datepicker>
              @if (oppForm.get('expectedCloseDate')?.invalid && oppForm.get('expectedCloseDate')?.touched) {
                <small id="opp-close-error" class="field-error" role="alert" i18n="@@crm.opportunities.la.date.de.cloture.est.obligatoire.2cc53478">La date de clôture est obligatoire.</small>
              }
            </div>
          </section>

          <section class="opp-form-section opp-form-section-secondary" aria-labelledby="opp-section-extra">
            <h3 id="opp-section-extra" class="form-block-title" i18n="@@crm.opportunities.complements.31a9dae2">Compléments</h3>
            <div class="form-field">
              <label class="field-label" for="oppSource" i18n="@@crm.opportunities.source.optionnel.f8f1af37">Source (optionnel)</label>
              <input pInputText id="oppSource" class="w-full" formControlName="source" />
            </div>
            <div class="form-field">
              <label class="field-label" for="oppNotes" i18n="@@crm.opportunities.notes.optionnel.c4bb754a">Notes (optionnel)</label>
              <textarea
                pTextarea
                id="oppNotes"
                class="w-full opp-notes-textarea"
                rows="5"
                formControlName="notes"
                [autoResize]="true"></textarea>
            </div>
          </section>

          @if (formError()) {
            <p class="form-banner-error text-danger text-sm" role="alert">{{ formError() }}</p>
          }
        </form>
      </div>
      <ng-template pTemplate="footer">
        <div class="opp-dialog-footer-actions">
          <app-button variant="outline" icon="pi-times" iconPos="left" type="button" (click)="formDialogVisible = false" ariaLabel="Annuler" i18n="@@crm.opportunities.annuler.49ba3292"> Annuler </app-button>
          <app-button
            variant="primary"
            [icon]="saving() ? 'pi-spin pi-spinner' : 'pi-check'"
            iconPos="left"
            type="button"
            (click)="saveOpportunity()"
            [disabled]="oppForm.invalid || saving()"
            [attr.aria-label]="editingId ? loc_ui_tern_enregistrer_l_opportunite_62ea6f : loc_ui_tern_creer_l_opportunite_19bea5">
            {{ saving() ? (editingId ? loc_ui_tern_enregistrement_9bf105 : loc_ui_tern_creation_dca950) : (editingId ? loc_ui_tern_enregistrer_f7c8bc : loc_ui_tern_creer_1a6861) }}
          </app-button>
        </div>
      </ng-template>
    </p-dialog>

    <p-dialog
      [(visible)]="loseDialogVisible"
      [modal]="true"
      [draggable]="false"
      styleClass="opp-lose-dialog"
      [contentStyle]="{ overflow: 'auto', padding: 0 }"
      header="Motif de perte" i18n-header="@@crm.opportunities.motif.de.perte.943b55a1"
      [style]="{ width: 'min(420px, 96vw)' }"
      (onHide)="resetLoseDialog()">
      <div class="opp-dialog-body opp-dialog-body--lose">
        <form [formGroup]="loseForm" (ngSubmit)="confirmLose()" class="opp-form opp-form-lose">
          <p id="lose-reason-hint" class="lose-dialog-hint" i18n="@@crm.opportunities.decrivez.brievement.pourquoi.l.opportunite.est.p.a98518e5"> Décrivez brièvement pourquoi l’opportunité est perdue (prix, concurrent, report, absence de budget…). Réservé à
            l’équipe interne. </p>
          <div class="form-field">
            <label class="field-label" for="loseReason"><ng-container i18n="@@crm.opportunities.motif.2a198f47">Motif </ng-container> <span class="required" aria-hidden="true" i18n="@@crm.opportunities.text.df58248c">*</span></label>
            <textarea
              pTextarea
              id="loseReason"
              class="w-full lose-reason-textarea"
              rows="5"
              formControlName="reason"
              placeholder="Ex. : offre concurrente moins chère, projet gelé par le client…" i18n-placeholder="@@crm.opportunities.ex.offre.concurrente.moins.chere.projet.gele.par.2466d0a6"
              [attr.aria-describedby]="loseReasonAriaDescribedBy()"
              [attr.aria-invalid]="loseForm.get('reason')?.invalid && loseForm.get('reason')?.touched ? true : null"></textarea>
            @if (loseForm.get('reason')?.invalid && loseForm.get('reason')?.touched) {
              <small id="lose-reason-error" class="field-error" role="alert" i18n="@@crm.opportunities.indiquez.un.motif.au.moins.2.caracteres.31534665">Indiquez un motif (au moins 2 caractères).</small>
            }
          </div>
          @if (loseError()) {
            <p class="form-banner-error text-danger text-sm" role="alert">{{ loseError() }}</p>
          }
        </form>
      </div>
      <ng-template pTemplate="footer">
        <div class="opp-dialog-footer-actions opp-dialog-footer-actions--lose">
          <app-button variant="ghost" size="sm" type="button" (click)="loseDialogVisible = false" ariaLabel="Annuler" i18n="@@crm.opportunities.annuler.49ba3292"> Annuler </app-button>
          <app-button
            variant="primary"
            [icon]="loseSaving() ? 'pi-spin pi-spinner' : 'pi-check'"
            iconPos="left"
            type="button"
            (click)="confirmLose()"
            [disabled]="loseForm.invalid || loseSaving()"
            ariaLabel="Confirmer la perte du deal">
            {{ loseSaving() ? loc_ui_tern_envoi_5a377e : loc_ui_tern_confirmer_80a664 }}
          </app-button>
        </div>
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .opportunity-toolbar .toolbar-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.75rem 1rem;
    }
    :host ::ng-deep .toolbar-dropdown {
      min-width: 200px;
    }
    .toolbar-mine {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
    }
    .toolbar-mine label {
      margin: 0;
      cursor: pointer;
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
    }
    .col-actions {
      width: 1%;
      white-space: nowrap;
    }
    .action-cell {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
      align-items: center;
      justify-content: flex-end;
    }
    .empty-cell {
      text-align: center;
      padding: 2.5rem 1rem !important;
      border: none !important;
    }
    .empty-state {
      max-width: 360px;
      margin: 0 auto;
    }
    .empty-title {
      font-weight: var(--font-weight-semibold);
      margin-bottom: 0.25rem;
    }
    .empty-hint {
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
      margin-bottom: 1rem;
    }

    .opp-dialog-body {
      padding: var(--spacing-6);
    }
    .opp-form {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-4);
    }
    .opp-form-lose {
      gap: var(--spacing-3);
    }
    .opp-dialog-body--lose {
      padding-top: var(--spacing-5);
    }
    .lose-dialog-hint {
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
      margin: 0 0 var(--spacing-1);
      line-height: 1.45;
      max-width: 42rem;
    }
    .lose-reason-textarea {
      min-height: 8rem;
      resize: vertical;
    }
    .opp-form-section {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-4);
    }
    .opp-form-section-secondary {
      padding-top: var(--spacing-2);
    }
    .form-block-title {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-tertiary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin: 0;
      padding-top: var(--spacing-2);
      border-top: 1px solid var(--color-border-subtle);
    }
    .opp-form-section:first-of-type .form-block-title {
      padding-top: 0;
      border-top: none;
    }
    .form-field {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
    }
    .field-label {
      display: block;
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
      margin: 0;
    }
    .required {
      color: var(--color-error-600);
      margin-left: var(--spacing-1);
    }
    .field-error {
      display: block;
      font-size: var(--font-size-xs);
      color: var(--color-error-600);
      margin-top: calc(-1 * var(--spacing-1));
    }
    .form-banner-error {
      margin: 0;
      padding-top: var(--spacing-2);
    }
    .form-grid-2 {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: var(--spacing-4);
    }
    @media (max-width: 480px) {
      .form-grid-2 {
        grid-template-columns: 1fr;
      }
    }
    .opp-notes-textarea {
      min-height: 7.5rem;
    }
    .w-full {
      width: 100%;
    }
    .opp-dialog-footer-actions {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--spacing-4);
      width: 100%;
    }
    .opp-dialog-footer-actions--lose {
      gap: var(--spacing-3);
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    :host ::ng-deep .opp-form-dialog.p-dialog,
    :host ::ng-deep .opp-lose-dialog.p-dialog {
      border-radius: var(--radius-xl, 0.75rem);
      box-shadow: var(--shadow-xl);
      overflow: hidden;
    }
    :host ::ng-deep .opp-form-dialog .p-dialog-header,
    :host ::ng-deep .opp-lose-dialog .p-dialog-header {
      padding: var(--spacing-4) var(--spacing-6);
      border-bottom: 1px solid var(--color-border-subtle, #e2e8f0);
      background: var(--color-background-elevated, var(--color-white));
    }
    :host ::ng-deep .opp-form-dialog .p-dialog-title,
    :host ::ng-deep .opp-lose-dialog .p-dialog-title {
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary, var(--color-neutral-900));
    }
    :host ::ng-deep .opp-form-dialog .p-dialog-content,
    :host ::ng-deep .opp-lose-dialog .p-dialog-content {
      border-radius: 0;
    }
    :host ::ng-deep .opp-form-dialog .p-dialog-footer,
    :host ::ng-deep .opp-lose-dialog .p-dialog-footer {
      padding: var(--spacing-4) var(--spacing-6);
      border-top: 1px solid var(--color-border-subtle, #e2e8f0);
      background: var(--color-background-subtle, #f8fafc);
    }
    :host ::ng-deep .opp-form-dialog .p-select,
    :host ::ng-deep .opp-form-dialog .p-inputnumber,
    :host ::ng-deep .opp-form-dialog .p-datepicker {
      width: 100%;
    }
    :host ::ng-deep .opp-form-dialog .p-datepicker.p-datepicker-w-btn .p-datepicker-trigger {
      background: var(--color-background-elevated);
      border-color: var(--color-border-default);
      color: var(--color-text-secondary);
      min-width: 2.75rem;
      width: 2.75rem;
      padding: 0;
    }
    :host ::ng-deep .opp-form-dialog .p-datepicker.p-datepicker-w-btn .p-datepicker-trigger:hover {
      background: var(--color-background-subtle);
      border-color: var(--color-border-strong);
      color: var(--color-text-primary);
    }
    :host ::ng-deep .opp-form-dialog .p-datepicker.p-datepicker-w-btn .p-datepicker-trigger:focus {
      box-shadow: 0 0 0 3px var(--color-primary-200);
      outline: none;
    }

    :host ::ng-deep .opp-lose-dialog textarea.lose-reason-textarea {
      width: 100%;
      box-sizing: border-box;
      border-radius: var(--radius-lg);
      border: 1px solid var(--color-border-default);
      padding: var(--spacing-3) var(--spacing-4);
      font-family: inherit;
      font-size: var(--font-size-base);
      line-height: 1.5;
      background: var(--color-background-elevated);
      color: var(--color-text-primary);
      transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
    }
    :host ::ng-deep .opp-lose-dialog textarea.lose-reason-textarea:focus {
      outline: none;
      border-color: var(--color-primary-500);
      box-shadow: 0 0 0 3px var(--color-primary-200);
    }
    :host ::ng-deep .opp-lose-dialog textarea.lose-reason-textarea.ng-invalid.ng-touched {
      border-color: var(--color-error-600);
    }
    :host ::ng-deep .opp-lose-dialog textarea.lose-reason-textarea::placeholder {
      color: var(--color-text-tertiary);
    }
  `
})
export class OpportunityListComponent implements OnInit {
  readonly loc_ui_tern_modifier_l_opportunite_c169c9 = $localize`:@@ui.tern.modifier.l.opportunite.c169c9:Modifier l’opportunité`;
  readonly loc_ui_tern_nouvelle_opportunite_ffadea = $localize`:@@ui.tern.nouvelle.opportunite.ffadea:Nouvelle opportunité`;
  readonly loc_ui_tern_modifiez_les_champs_puis_enregistrez_d6b04c = $localize`:@@ui.tern.modifiez.les.champs.puis.enregistrez.d6b04c:Modifiez les champs puis enregistrez.`;
  readonly loc_ui_tern_renseignez_le_client_le_montant_et_la_date_e8d113 = $localize`:@@ui.tern.renseignez.le.client.le.montant.et.la.date.e8d113:Renseignez le client, le montant et la date de clôture attendue.`;
  readonly loc_ui_tern_enregistrer_l_opportunite_62ea6f = $localize`:@@ui.tern.enregistrer.l.opportunite.62ea6f:Enregistrer l’opportunité`;
  readonly loc_ui_tern_creer_l_opportunite_19bea5 = $localize`:@@ui.tern.creer.l.opportunite.19bea5:Créer l’opportunité`;
  readonly loc_ui_tern_enregistrement_9bf105 = $localize`:@@ui.tern.enregistrement.9bf105:Enregistrement...`;
  readonly loc_ui_tern_creation_dca950 = $localize`:@@ui.tern.creation.dca950:Création...`;
  readonly loc_ui_tern_enregistrer_f7c8bc = $localize`:@@ui.tern.enregistrer.f7c8bc:Enregistrer`;
  readonly loc_ui_tern_creer_1a6861 = $localize`:@@ui.tern.creer.1a6861:Créer`;
  readonly loc_ui_tern_envoi_5a377e = $localize`:@@ui.tern.envoi.5a377e:Envoi...`;
  readonly loc_ui_tern_confirmer_80a664 = $localize`:@@ui.tern.confirmer.80a664:Confirmer`;
  private readonly crm = inject(CrmService);
  private readonly clientsApi = inject(ClientService);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder);

  readonly items = signal<OpportunityDto[]>([]);
  readonly error = signal<string | null>(null);
  readonly formError = signal<string | null>(null);
  readonly loseError = signal<string | null>(null);
  readonly saving = signal(false);
  readonly loseSaving = signal(false);

  /** Totaux de la zone, calculés sur les opportunités filtrées (chargées côté client). */
  readonly summaryMetrics = computed<TotalMetric[]>(() => {
    const rows = this.items();
    return [
      { label: 'Opportunités', value: rows.length, format: 'number', icon: 'pi-briefcase', tone: 'primary' },
      { label: 'Montant attendu', value: rows.reduce((acc, o) => acc + (o.expectedAmount ?? 0), 0), format: 'currency', icon: 'pi-wallet', tone: 'primary' },
      { label: 'Pondéré', value: rows.reduce((acc, o) => acc + (o.weightedAmount ?? 0), 0), format: 'currency', icon: 'pi-percentage', tone: 'cyan' },
      { label: 'Ouvertes', value: rows.filter(o => o.stage < 4).length, format: 'number', icon: 'pi-clock', tone: 'amber' },
      { label: 'Gagnées', value: rows.filter(o => o.stage === 4).length, format: 'number', icon: 'pi-check-circle', tone: 'emerald' }
    ];
  });

  clients: ClientListItem[] = [];
  myOpportunitiesOnly = false;
  formDialogVisible = false;
  loseDialogVisible = false;
  editingId: string | null = null;
  loseTargetId: string | null = null;

  stageOptions: StageOption[] = [
    { label: 'Tous les stages', value: null },
    { label: 'Prospection', value: 0 },
    { label: 'Qualification', value: 1 },
    { label: 'Proposition', value: 2 },
    { label: 'Négociation', value: 3 },
    { label: 'Gagnée', value: 4 },
    { label: 'Perdue', value: 5 }
  ];
  selectedStageOption: StageOption | null = this.stageOptions[0];

  oppForm = this.fb.group({
    clientId: [''],
    title: ['', [Validators.required, Validators.maxLength(200)]],
    expectedAmount: [0, [Validators.required, Validators.min(0)]],
    probability: [50, [Validators.required, Validators.min(0), Validators.max(100)]],
    expectedCloseDate: [null as Date | null, Validators.required],
    source: [''],
    notes: ['']
  });

  loseForm = this.fb.group({
    reason: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(2000)]]
  });

  /** Ids for aria-describedby on the loss reason field (hint + optional inline error). */
  loseReasonAriaDescribedBy(): string {
    const r = this.loseForm.get('reason');
    const ids = ['lose-reason-hint'];
    if (r?.invalid && r.touched) {
      ids.push('lose-reason-error');
    }
    return ids.join(' ');
  }

  ngOnInit(): void {
    this.clientsApi.getClients({ pageSize: 500, isActive: true }).subscribe({
      next: res => {
        if (res.success && res.data?.items) {
          this.clients = res.data.items;
        }
      },
      error: () => {
        this.clients = [];
      }
    });
    this.load();
  }

  load(): void {
    this.error.set(null);
    const stage = this.selectedStageOption?.value ?? undefined;
    const uid = this.myOpportunitiesOnly ? this.auth.user()?.id : undefined;
    this.crm.getOpportunities(stage, uid).subscribe({
      next: r => {
        if (r.success && r.data) {
          this.items.set(r.data);
        } else {
          this.error.set(r.error ?? $localize`:@@ui.tern.erreur.ab546c:Erreur`);
        }
      },
      error: () => this.error.set('Erreur réseau')
    });
  }

  openCreate(): void {
    this.editingId = null;
    this.formError.set(null);
    this.oppForm.reset({
      clientId: '',
      title: '',
      expectedAmount: 0,
      probability: 50,
      expectedCloseDate: new Date(),
      source: '',
      notes: ''
    });
    const clientCtl = this.oppForm.get('clientId');
    clientCtl?.setValidators([Validators.required]);
    clientCtl?.enable();
    clientCtl?.updateValueAndValidity({ emitEvent: false });
    this.formDialogVisible = true;
  }

  openEdit(o: OpportunityDto): void {
    this.editingId = o.id;
    this.formError.set(null);
    const clientCtl = this.oppForm.get('clientId');
    clientCtl?.clearValidators();
    clientCtl?.updateValueAndValidity({ emitEvent: false });
    this.oppForm.patchValue({
      title: o.title,
      expectedAmount: o.expectedAmount,
      probability: o.probability,
      expectedCloseDate: o.expectedCloseDate ? new Date(o.expectedCloseDate) : new Date(),
      source: o.source ?? '',
      notes: o.notes ?? ''
    });
    clientCtl?.disable();
    this.formDialogVisible = true;
  }

  resetFormDialog(): void {
    this.editingId = null;
    this.formError.set(null);
    this.oppForm.get('clientId')?.enable();
  }

  saveOpportunity(): void {
    this.formError.set(null);
    if (this.oppForm.invalid) {
      this.oppForm.markAllAsTouched();
      return;
    }
    const v = this.oppForm.getRawValue();
    const title = (v.title ?? '').trim();
    if (!title) {
      this.formError.set('Le titre est obligatoire.');
      return;
    }
    const close = v.expectedCloseDate;
    if (!close) {
      this.formError.set('La date de clôture est obligatoire.');
      return;
    }
    const iso = close instanceof Date ? close.toISOString() : new Date(close).toISOString();

    this.saving.set(true);
    if (this.editingId) {
      this.crm
        .updateOpportunity(this.editingId, {
          title,
          expectedAmount: Number(v.expectedAmount),
          probability: Math.round(Number(v.probability)),
          expectedCloseDate: iso,
          source: v.source?.trim() || undefined,
          notes: v.notes?.trim() || undefined
        })
        .subscribe({
          next: r => {
            this.saving.set(false);
            if (r.success) {
              this.formDialogVisible = false;
              this.load();
            } else {
              this.formError.set(r.error ?? $localize`:@@ui.tern.enregistrement.impossible.1e5e10:Enregistrement impossible`);
            }
          },
          error: () => {
            this.saving.set(false);
            this.formError.set('Erreur réseau');
          }
        });
      return;
    }

    const clientId = v.clientId?.trim();
    if (!clientId) {
      this.saving.set(false);
      this.formError.set('Sélectionnez un client.');
      return;
    }

    this.crm
      .createOpportunity({
        title,
        clientId,
        expectedAmount: Number(v.expectedAmount),
        probability: Math.round(Number(v.probability)),
        expectedCloseDate: iso,
        source: v.source?.trim() || undefined,
        notes: v.notes?.trim() || undefined
      })
      .subscribe({
        next: r => {
          this.saving.set(false);
          if (r.success) {
            this.formDialogVisible = false;
            this.load();
          } else {
            this.formError.set(r.error ?? $localize`:@@ui.tern.creation.impossible.e15c59:Création impossible`);
          }
        },
        error: () => {
          this.saving.set(false);
          this.formError.set('Erreur réseau');
        }
      });
  }

  advance(id: string): void {
    this.crm.advanceOpportunity(id).subscribe({
      next: r => {
        if (!r.success) {
          this.error.set(r.error ?? $localize`:@@ui.tern.action.impossible.f9002b:Action impossible`);
        }
        this.load();
      },
      error: () => this.error.set('Erreur réseau')
    });
  }

  win(id: string): void {
    this.crm.winOpportunity(id).subscribe({
      next: r => {
        if (!r.success) {
          this.error.set(r.error ?? $localize`:@@ui.tern.action.impossible.f9002b:Action impossible`);
        }
        this.load();
      },
      error: () => this.error.set('Erreur réseau')
    });
  }

  openLose(o: OpportunityDto): void {
    this.loseTargetId = o.id;
    this.loseError.set(null);
    this.loseForm.reset({ reason: '' });
    this.loseDialogVisible = true;
  }

  resetLoseDialog(): void {
    this.loseTargetId = null;
    this.loseError.set(null);
  }

  confirmLose(): void {
    this.loseError.set(null);
    if (this.loseForm.invalid || !this.loseTargetId) {
      this.loseForm.markAllAsTouched();
      return;
    }
    const reason = this.loseForm.get('reason')?.value?.trim() ?? '';
    this.loseSaving.set(true);
    this.crm.loseOpportunity(this.loseTargetId, reason).subscribe({
      next: r => {
        this.loseSaving.set(false);
        if (r.success) {
          this.loseDialogVisible = false;
          this.loseTargetId = null;
          this.load();
        } else {
          this.loseError.set(r.error ?? $localize`:@@ui.tern.action.impossible.f9002b:Action impossible`);
        }
      },
      error: () => {
        this.loseSaving.set(false);
        this.loseError.set('Erreur réseau');
      }
    });
  }
}
