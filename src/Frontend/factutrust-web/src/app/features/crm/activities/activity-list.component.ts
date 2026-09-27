/// <reference types="@angular/localize" />
import { Component, HostListener, OnDestroy, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { TableModule, TableLazyLoadEvent } from 'primeng/table';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { InputTextModule } from 'primeng/inputtext';
import { Textarea } from 'primeng/textarea';
import { CheckboxModule } from 'primeng/checkbox';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { TableTotalsBarComponent, TotalMetric } from '@shared/components/table-totals-bar/table-totals-bar.component';
import { formatLocalDate } from '@core/utils/date.util';
import {
  CrmService,
  CrmAssignableUserDto,
  OpportunityDto,
  SalesActivityDto,
  ActivityListSummary
} from '../services/crm.service';
import { ClientService, ClientListItem } from '@core/services/client.service';
import { AuthService } from '@core/services/auth.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { ToastService } from '@core/services/toast.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { OverlayOptions } from 'primeng/api';

type StatusFilter = 'all' | 'open' | 'done';

interface StatusFilterOption {
  label: string;
  value: StatusFilter;
}

@Component({
  selector: 'app-activity-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    TableModule,
    SelectModule,
    DatePickerModule,
    InputTextModule,
    Textarea,
    CheckboxModule,
    PageHeaderComponent,
    ButtonComponent,
    TableTotalsBarComponent
  ],
  template: `
    <app-page-header title="Activités" i18n-title="@@crm.activities.activites.9c1f6186" subtitle="Appels, rendez-vous, tâches et relances" i18n-subtitle="@@crm.activities.appels.rendez.vous.taches.et.relances.450f20fd" />

    <div class="card p-3 mb-3 activity-toolbar">
      <div class="toolbar-row">
        <span class="p-input-icon-left toolbar-search">
          <i class="pi pi-search" aria-hidden="true"></i>
          <input
            pInputText
            type="search"
            [(ngModel)]="searchInput"
            (ngModelChange)="onSearchInput($event)"
            placeholder="Rechercher par sujet…" i18n-placeholder="@@crm.activities.rechercher.par.sujet.4a4d26d9"
            class="w-full"
            aria-label="Rechercher par sujet" i18n-aria-label="@@crm.activities.rechercher.par.sujet.3de067d0" />
        </span>
        <p-select
          [options]="statusFilterOptions"
          [(ngModel)]="statusFilter"
          optionLabel="label"
          optionValue="value"
          placeholder="Statut" i18n-placeholder="@@crm.activities.statut.659499f3"
          inputId="actStatusFilter"
          styleClass="toolbar-dropdown"
          (onChange)="onFiltersChanged()"
          [attr.aria-label]="'Filtrer par statut'"></p-select>
        <p-select
          [options]="typeFilterOptions"
          [(ngModel)]="typeFilter"
          optionLabel="label"
          optionValue="value"
          placeholder="Type" i18n-placeholder="@@crm.activities.type.3deb7456"
          [showClear]="true"
          inputId="actTypeFilter"
          styleClass="toolbar-dropdown"
          (onChange)="onFiltersChanged()"
          [attr.aria-label]="'Filtrer par type'"></p-select>
        <p-select
          [options]="clients()"
          [(ngModel)]="selectedClient"
          optionLabel="name"
          placeholder="Client" i18n-placeholder="@@crm.activities.client.1bdd79b1"
          [showClear]="true"
          [filter]="true"
          filterBy="name,code"
          inputId="actClientFilter"
          styleClass="toolbar-dropdown"
          (onChange)="onFiltersChanged()"
          [attr.aria-label]="'Filtrer par client'"></p-select>
        <p-select
          [options]="filteredOpportunities()"
          [(ngModel)]="selectedOpportunity"
          optionLabel="title"
          placeholder="Opportunité" i18n-placeholder="@@crm.activities.opportunite.d013f335"
          [showClear]="true"
          [filter]="true"
          filterBy="title"
          inputId="actOppFilter"
          styleClass="toolbar-dropdown"
          (onChange)="onFiltersChanged()"
          [attr.aria-label]="'Filtrer par opportunité'"></p-select>
        <div class="toolbar-dates">
          <label class="sr-only" for="actDueFrom" i18n="@@crm.activities.echeance.du.168e2cce">Échéance du</label>
          <p-datepicker
            inputId="actDueFrom"
            [(ngModel)]="dueFrom"
            dateFormat="dd/mm/yy"
            [showIcon]="true"
            [showClear]="true"
            placeholder="Échéance du" i18n-placeholder="@@crm.activities.echeance.du.168e2cce"
            appendTo="body"
            (onSelect)="onFiltersChanged()"
            (onClearClick)="onDueClear()"></p-datepicker>
          <label class="sr-only" for="actDueTo" i18n="@@crm.activities.echeance.au.89dc2a04">Échéance au</label>
          <p-datepicker
            inputId="actDueTo"
            [(ngModel)]="dueTo"
            dateFormat="dd/mm/yy"
            [showIcon]="true"
            [showClear]="true"
            placeholder="Échéance au" i18n-placeholder="@@crm.activities.echeance.au.89dc2a04"
            appendTo="body"
            (onSelect)="onFiltersChanged()"
            (onClearClick)="onDueClear()"></p-datepicker>
        </div>
        <div class="toolbar-mine">
          <p-checkbox
            inputId="actMineOnly"
            name="actMineOnly"
            [(ngModel)]="myActivitiesOnly"
            [binary]="true"
            (ngModelChange)="onFiltersChanged()"></p-checkbox>
          <label for="actMineOnly" i18n="@@crm.activities.mes.activites.ed4435e5">Mes activités</label>
        </div>
        <app-button variant="secondary" icon="pi pi-refresh" iconPos="left" (click)="reload()" ariaLabel="Actualiser la liste" i18n-ariaLabel="@@crm.activities.actualiser.la.liste.fefe8aed" i18n="@@crm.activities.actualiser.9d3b2a7d"> Actualiser </app-button>
        @if (canCreate()) {
          <app-button variant="primary" icon="pi pi-plus" iconPos="left" (click)="openCreate()" ariaLabel="Nouvelle activité" i18n-ariaLabel="@@crm.activities.nouvelle.activite.327e655c" i18n="@@crm.activities.nouvelle.activite.1b50af31"> Nouvelle activité </app-button>
        }
      </div>
    </div>

    @if (error()) {
      <p class="text-danger p-3" role="alert">{{ error() }}</p>
    }

    <app-table-totals-bar [metrics]="summaryMetrics()" [loading]="summaryLoading()"></app-table-totals-bar>

    <p-table
      [value]="items()"
      [loading]="loading()"
      [lazy]="true"
      [lazyLoadOnInit]="false"
      [paginator]="true"
      [rows]="pageSize"
      [first]="firstIdx()"
      [totalRecords]="totalRecords()"
      [showCurrentPageReport]="true"
      currentPageReportTemplate="Affichage de {first} à {last} sur {totalRecords} activités" i18n-currentPageReportTemplate="@@crm.activities.affichage.de.first.a.last.sur.totalrecords.activ.5875172a"
      [rowsPerPageOptions]="[15, 25, 50]"
      (onLazyLoad)="onLazyLoad($event)"
      styleClass="p-datatable-sm activity-table">
      <ng-template pTemplate="header">
        <tr>
          <th scope="col" i18n="@@crm.activities.type.3deb7456">Type</th>
          <th scope="col" i18n="@@crm.activities.sujet.d7742281">Sujet</th>
          <th scope="col" i18n="@@crm.activities.client.1bdd79b1">Client</th>
          <th scope="col" i18n="@@crm.activities.commercial.b48513e4">Commercial</th>
          <th scope="col" i18n="@@crm.activities.echeance.f9a77ff6">Échéance</th>
          <th scope="col" i18n="@@crm.activities.priorite.eede91d2">Priorité</th>
          <th scope="col" i18n="@@crm.activities.statut.659499f3">Statut</th>
          <th scope="col" class="col-actions" i18n="@@crm.activities.actions.c3cd636a">Actions</th>
        </tr>
      </ng-template>
      <ng-template pTemplate="body" let-a>
        <tr [style.opacity]="a.isCompleted ? 0.6 : 1">
          <td><i [class]="'pi ' + a.typeIcon" style="margin-right:0.25rem" aria-hidden="true"></i>{{ a.typeName }}</td>
          <td>
            <span style="font-weight:600">{{ a.subject }}</span>
            @if (a.description) {
              <div class="text-muted text-sm">{{ a.description!.length > 80 ? (a.description | slice:0:80) + '…' : a.description }}</div>
            }
          </td>
          <td>{{ a.clientName || '—' }}</td>
          <td>{{ a.assignedUserName }}</td>
          <td>{{ a.dueDate | date:'shortDate' }}</td>
          <td><span [class]="loc_ui_tern_badge_badge_e609fe + a.priorityColor">{{ a.priorityName }}</span></td>
          <td>{{ a.isCompleted ? loc_ui_tern_terminee_459368 : loc_ui_tern_en_cours_bc9b53 }}</td>
          <td class="col-actions">
            <div class="action-cell">
              @if (!a.isCompleted && canUpdate()) {
                <app-button
                  variant="ghost"
                  size="sm"
                  [iconOnly]="true"
                  icon="pi pi-check"
                  ariaLabel="Terminer l’activité" i18n-ariaLabel="@@crm.activities.terminer.l.activite.99839a51"
                  title="Terminer" i18n-title="@@crm.activities.terminer.6bf1bd74"
                  [iconAlwaysVisible]="true"
                  (click)="complete(a)"></app-button>
              }
              @if (canUpdate()) {
                <app-button
                  variant="ghost"
                  size="sm"
                  [iconOnly]="true"
                  icon="pi pi-pencil"
                  ariaLabel="Modifier l’activité" i18n-ariaLabel="@@crm.activities.modifier.l.activite.53659408"
                  title="Modifier" i18n-title="@@crm.activities.modifier.f260e757"
                  [iconAlwaysVisible]="true"
                  (click)="openEdit(a)"></app-button>
              }
              @if (canDelete()) {
                <app-button
                  variant="ghost"
                  size="sm"
                  [iconOnly]="true"
                  icon="pi pi-trash"
                  ariaLabel="Supprimer l’activité" i18n-ariaLabel="@@crm.activities.supprimer.l.activite.f2e5f591"
                  title="Supprimer" i18n-title="@@crm.activities.supprimer.1acfc1c7"
                  [iconAlwaysVisible]="true"
                  (click)="confirmDelete(a)"></app-button>
              }
            </div>
          </td>
        </tr>
      </ng-template>
      <ng-template pTemplate="emptymessage">
        <tr>
          <td colspan="8" class="empty-cell">
            <div class="empty-state">
              <p class="empty-title" i18n="@@crm.activities.aucune.activite.pour.ces.criteres.888fb490">Aucune activité pour ces critères</p>
              <p class="empty-hint" i18n="@@crm.activities.creez.une.relance.un.rendez.vous.ou.une.tache.po.5460a53e">Créez une relance, un rendez-vous ou une tâche pour suivre votre prospection.</p>
              @if (canCreate()) {
                <app-button variant="primary" icon="pi pi-plus" iconPos="left" (click)="openCreate()" ariaLabel="Créer une activité" i18n-ariaLabel="@@crm.activities.creer.une.activite.1f8ccf44" i18n="@@crm.activities.nouvelle.activite.1b50af31"> Nouvelle activité </app-button>
              }
            </div>
          </td>
        </tr>
      </ng-template>
    </p-table>

    @if (formDialogVisible) {
      <div class="activity-panel-overlay" (click)="closeActivityPanel()" role="presentation">
        <div
          class="activity-panel"
          (click)="$event.stopPropagation()"
          role="dialog"
          aria-modal="true"
          aria-labelledby="activity-panel-title"
          [attr.aria-describedby]="'act-form-desc'">
          <div class="activity-panel-header">
            <div class="activity-panel-header-text">
              <h2 id="activity-panel-title">{{ editingId() ? loc_ui_tern_modifier_l_activite_0681d2 : loc_ui_tern_nouvelle_activite_1b50af }}</h2>
              <p class="activity-panel-subtitle" i18n="@@crm.activities.suivi.commercial.et.relances.227f714d">
                {{ editingId() ? loc_ui_tern_edition_b8056d : loc_ui_tern_creation_b50615 }} · Suivi commercial et relances
              </p>
            </div>
            <button
              type="button"
              class="activity-panel-close"
              (click)="closeActivityPanel()"
              aria-label="Fermer le panneau" i18n-aria-label="@@crm.activities.fermer.le.panneau.e1210a2f">
              <i class="pi pi-times" aria-hidden="true"></i>
            </button>
          </div>
          <div class="activity-panel-body">
            <p id="act-form-desc" class="sr-only">
              {{ editingId() ? loc_ui_tern_modifiez_les_champs_puis_enregistrez_d6b04c : loc_ui_tern_renseignez_le_client_le_type_et_le_sujet_23d08c }}
            </p>
            <form [formGroup]="activityForm" (ngSubmit)="save()" class="activity-form">
          <section class="act-form-section" aria-labelledby="act-section-details">
            <h3 id="act-section-details" class="form-block-title activity-panel-section-title" i18n="@@crm.activities.details.de.l.activite.c70d5b27">Détails de l’activité</h3>
            <div class="form-field">
              <label class="field-label" for="actType"><ng-container i18n="@@crm.activities.type.3deb7456">Type </ng-container> <span class="required" aria-hidden="true" i18n="@@crm.activities.text.df58248c">*</span></label>
              <p-select
                inputId="actType"
                formControlName="type"
                [options]="typeOptions"
                optionLabel="label"
                optionValue="value"
                placeholder="Type" i18n-placeholder="@@crm.activities.type.3deb7456"
                styleClass="w-full"
                appendTo="body"
                [overlayOptions]="activityPanelPrimeOverlayOptions"></p-select>
            </div>
            @if (!editingId()) {
              <div class="form-field">
                <label class="field-label" for="actClient"><ng-container i18n="@@crm.activities.client.1bdd79b1">Client </ng-container> <span class="required" aria-hidden="true" i18n="@@crm.activities.text.df58248c">*</span></label>
                <p-select
                  inputId="actClient"
                  formControlName="clientId"
                  [options]="clients()"
                  optionLabel="name"
                  optionValue="id"
                  placeholder="Sélectionner un client" i18n-placeholder="@@crm.activities.selectionner.un.client.20f49a7a"
                  [filter]="true"
                  filterBy="name,code"
                  styleClass="w-full"
                  appendTo="body"
                  [overlayOptions]="activityPanelPrimeOverlayOptions"
                  (onChange)="onFormClientChange()"></p-select>
              </div>
            }
            <div class="form-field">
              <label class="field-label" for="actSubject"><ng-container i18n="@@crm.activities.sujet.d7742281">Sujet </ng-container> <span class="required" aria-hidden="true" i18n="@@crm.activities.text.df58248c">*</span></label>
              <input pInputText id="actSubject" class="w-full" formControlName="subject" autocomplete="off" />
            </div>
            <div class="form-field">
              <label class="field-label" for="actDesc" i18n="@@crm.activities.description.55f8ebc8">Description</label>
              <p id="act-desc-hint" class="act-field-hint" i18n="@@crm.activities.compte.rendu.prochaine.action.ou.precisions.opti.f1f8b6ff">Compte rendu, prochaine action ou précisions — optionnel, max. 2000 caractères.</p>
              <textarea
                pTextarea
                id="actDesc"
                class="w-full activity-desc-textarea"
                rows="5"
                formControlName="description"
                placeholder="Détails, compte rendu, prochaine action…" i18n-placeholder="@@crm.activities.details.compte.rendu.prochaine.action.39f02ee4"
                aria-describedby="act-desc-hint"></textarea>
            </div>
          </section>

          <section class="act-form-section act-form-section-secondary" aria-labelledby="act-section-context">
            <h3 id="act-section-context" class="form-block-title activity-panel-section-title" i18n="@@crm.activities.contexte.8112e9eb">Contexte</h3>
            <div class="form-field">
              <label class="field-label" for="actOpp" i18n="@@crm.activities.opportunite.optionnel.49421928">Opportunité (optionnel)</label>
              <p-select
                inputId="actOpp"
                formControlName="opportunityId"
                [options]="formOpportunityOptions()"
                optionLabel="title"
                optionValue="id"
                placeholder="Aucune" i18n-placeholder="@@crm.activities.aucune.e8f88273"
                [showClear]="true"
                [filter]="true"
                filterBy="title"
                styleClass="w-full"
                appendTo="body"
                [overlayOptions]="activityPanelPrimeOverlayOptions"></p-select>
            </div>
            <div class="form-field">
              <label class="field-label" for="actAssignee" i18n="@@crm.activities.assigne.a.a769dca6">Assigné à</label>
              <p-select
                inputId="actAssignee"
                formControlName="assignedUserId"
                [options]="assigneeDropdownOptions()"
                optionLabel="label"
                optionValue="value"
                placeholder="Moi par défaut" i18n-placeholder="@@crm.activities.moi.par.defaut.7fd82a51"
                [showClear]="true"
                styleClass="w-full"
                appendTo="body"
                [overlayOptions]="activityPanelPrimeOverlayOptions"></p-select>
            </div>
            <div class="form-field">
              <label class="field-label" for="actPriority"><ng-container i18n="@@crm.activities.priorite.eede91d2">Priorité </ng-container> <span class="required" aria-hidden="true" i18n="@@crm.activities.text.df58248c">*</span></label>
              <p-select
                inputId="actPriority"
                formControlName="priority"
                [options]="priorityOptions"
                optionLabel="label"
                optionValue="value"
                styleClass="w-full"
                appendTo="body"
                [overlayOptions]="activityPanelPrimeOverlayOptions"></p-select>
            </div>
          </section>

          <section class="act-form-section act-form-section-secondary" aria-labelledby="act-section-plan">
            <h3 id="act-section-plan" class="form-block-title activity-panel-section-title" i18n="@@crm.activities.planification.17624316">Planification</h3>
            <div class="form-grid-2">
              <div class="form-field">
                <label class="field-label" for="actDue" i18n="@@crm.activities.echeance.f9a77ff6">Échéance</label>
                <p-datepicker
                  inputId="actDue"
                  formControlName="dueDate"
                  dateFormat="dd/mm/yy"
                  [showIcon]="true"
                  [readonlyInput]="true"
                  appendTo="body"
                  [baseZIndex]="activityPanelPrimeBaseZIndex"
                  styleClass="w-full"></p-datepicker>
              </div>
              <div class="form-field">
                <label class="field-label" for="actRem" i18n="@@crm.activities.rappel.a1ec24e4">Rappel</label>
                <p-datepicker
                  inputId="actRem"
                  formControlName="reminderDate"
                  dateFormat="dd/mm/yy"
                  [showIcon]="true"
                  [readonlyInput]="true"
                  appendTo="body"
                  [baseZIndex]="activityPanelPrimeBaseZIndex"
                  styleClass="w-full"></p-datepicker>
              </div>
            </div>
          </section>

          @if (formError()) {
            <p class="form-banner-error text-danger text-sm" role="alert">{{ formError() }}</p>
          }
            </form>
          </div>
          <div class="activity-panel-footer">
            <div class="activity-dialog-footer-actions">
              <app-button variant="ghost" size="sm" type="button" (click)="closeActivityPanel()" ariaLabel="Annuler" i18n-ariaLabel="@@crm.activities.annuler.e063e8ff" i18n="@@crm.activities.annuler.49ba3292"> Annuler </app-button>
              <app-button
                variant="primary"
                [icon]="saving() ? 'pi-spin pi-spinner' : 'pi-check'"
                iconPos="left"
                type="button"
                (click)="save()"
                [disabled]="activityForm.invalid || saving()"
                [attr.aria-label]="editingId() ? loc_ui_tern_enregistrer_f7c8bc : loc_ui_tern_creer_1a6861">
                {{ saving() ? loc_ui_tern_enregistrement_e7d5f2 : editingId() ? loc_ui_tern_enregistrer_f7c8bc : loc_ui_tern_creer_1a6861 }}
              </app-button>
            </div>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    .activity-toolbar .toolbar-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.75rem 1rem;
    }
    .toolbar-search {
      flex: 1 1 200px;
      min-width: 180px;
    }
    :host ::ng-deep .toolbar-dropdown {
      min-width: 180px;
    }
    .toolbar-dates {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      align-items: center;
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
      max-width: 400px;
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
    .text-sm {
      font-size: var(--font-size-sm);
    }
    .activity-panel-overlay {
      position: fixed;
      inset: 0;
      z-index: 1100;
      display: flex;
      justify-content: flex-end;
      align-items: stretch;
      background: rgba(15, 23, 42, 0.28);
      backdrop-filter: blur(4px);
      animation: activityPanelFadeIn 200ms ease-out;
    }
    .activity-panel {
      position: relative;
      z-index: 1101;
      display: flex;
      flex-direction: column;
      width: min(520px, 100vw);
      max-height: 100dvh;
      height: 100%;
      background: var(--color-background-elevated, var(--color-white));
      box-shadow: -12px 0 40px rgba(15, 23, 42, 0.12);
      animation: activityPanelSlideIn 260ms cubic-bezier(0.4, 0, 0.2, 1);
      overflow: hidden;
    }
    .activity-panel-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--spacing-4);
      padding: var(--spacing-5) var(--spacing-5) var(--spacing-4);
      border-bottom: 1px solid var(--color-border-subtle);
      background: linear-gradient(
        180deg,
        var(--color-background-elevated) 0%,
        var(--color-background-subtle) 100%
      );
      flex-shrink: 0;
    }
    .activity-panel-header-text {
      min-width: 0;
    }
    .activity-panel-header h2 {
      margin: 0 0 var(--spacing-1);
      font-size: var(--font-size-xl);
      font-weight: var(--font-weight-bold);
      color: var(--color-text-primary);
      line-height: 1.25;
    }
    .activity-panel-subtitle {
      margin: 0;
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
      line-height: 1.4;
    }
    .activity-panel-close {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      flex-shrink: 0;
      border: none;
      border-radius: var(--radius-lg);
      background: var(--color-neutral-100);
      color: var(--color-text-tertiary);
      cursor: pointer;
      transition: background 200ms ease, color 200ms ease;
    }
    .activity-panel-close:hover {
      background: var(--color-neutral-200);
      color: var(--color-text-primary);
    }
    .activity-panel-body {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: var(--spacing-5);
    }
    .activity-panel-footer {
      flex-shrink: 0;
      padding: var(--spacing-4) var(--spacing-5);
      border-top: 1px solid var(--color-border-subtle);
      background: var(--color-background-subtle);
    }
    .activity-panel .activity-panel-section-title {
      border-left: 3px solid var(--color-primary-500);
      padding-left: var(--spacing-3);
    }
    @keyframes activityPanelFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes activityPanelSlideIn {
      from { transform: translateX(100%); }
      to { transform: translateX(0); }
    }
    .activity-form {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-4);
    }
    .act-form-section {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-4);
    }
    .act-form-section-secondary {
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
    .act-form-section:first-of-type .form-block-title {
      padding-top: 0;
      border-top: none;
    }
    .form-field {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
    }
    .field-label {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
      margin: 0;
    }
    .act-field-hint {
      font-size: var(--font-size-xs);
      color: var(--color-text-secondary);
      margin: 0 0 var(--spacing-1);
      line-height: 1.4;
    }
    .activity-desc-textarea {
      min-height: 7.5rem;
      resize: vertical;
    }
    .required {
      color: var(--color-error-600);
    }
    .form-grid-2 {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--spacing-4);
    }
    @media (max-width: 520px) {
      .form-grid-2 {
        grid-template-columns: 1fr;
      }
    }
    .form-banner-error {
      margin: 0;
      padding-top: var(--spacing-2);
    }
    .activity-dialog-footer-actions {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: var(--spacing-4);
      flex-wrap: wrap;
      width: 100%;
    }
    .w-full {
      width: 100%;
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

    :host ::ng-deep .activity-panel .p-select,
    :host ::ng-deep .activity-panel .p-datepicker {
      width: 100%;
    }
    :host ::ng-deep .activity-panel .p-datepicker.p-datepicker-w-btn .p-datepicker-trigger {
      background: var(--color-background-elevated);
      border-color: var(--color-border-default);
      color: var(--color-text-secondary);
      min-width: 2.75rem;
      width: 2.75rem;
      padding: 0;
    }
    :host ::ng-deep .activity-panel .p-datepicker.p-datepicker-w-btn .p-datepicker-trigger:hover {
      background: var(--color-background-subtle);
      border-color: var(--color-border-strong);
      color: var(--color-text-primary);
    }
    :host ::ng-deep .activity-panel .p-datepicker.p-datepicker-w-btn .p-datepicker-trigger:focus {
      box-shadow: 0 0 0 3px var(--color-primary-200);
      outline: none;
    }
  `
})
export class ActivityListComponent implements OnInit, OnDestroy {
  readonly loc_ui_tern_badge_badge_e609fe = "badge badge-";
  readonly loc_ui_tern_terminee_459368 = $localize`:@@ui.tern.terminee.459368:Terminée`;
  readonly loc_ui_tern_en_cours_bc9b53 = $localize`:@@ui.tern.en.cours.bc9b53:En cours`;
  readonly loc_ui_tern_modifier_l_activite_0681d2 = $localize`:@@ui.tern.modifier.l.activite.0681d2:Modifier l’activité`;
  readonly loc_ui_tern_nouvelle_activite_1b50af = $localize`:@@ui.tern.nouvelle.activite.1b50af:Nouvelle activité`;
  readonly loc_ui_tern_edition_b8056d = $localize`:@@ui.tern.edition.b8056d:Édition`;
  readonly loc_ui_tern_creation_b50615 = $localize`:@@ui.tern.creation.b50615:Création`;
  readonly loc_ui_tern_modifiez_les_champs_puis_enregistrez_d6b04c = $localize`:@@ui.tern.modifiez.les.champs.puis.enregistrez.d6b04c:Modifiez les champs puis enregistrez.`;
  readonly loc_ui_tern_renseignez_le_client_le_type_et_le_sujet_23d08c = $localize`:@@ui.tern.renseignez.le.client.le.type.et.le.sujet.23d08c:Renseignez le client, le type et le sujet.`;
  readonly loc_ui_tern_enregistrer_f7c8bc = $localize`:@@ui.tern.enregistrer.f7c8bc:Enregistrer`;
  readonly loc_ui_tern_creer_1a6861 = $localize`:@@ui.tern.creer.1a6861:Créer`;
  readonly loc_ui_tern_enregistrement_e7d5f2 = $localize`:@@ui.tern.enregistrement.e7d5f2:Enregistrement…`;
  private readonly crm = inject(CrmService);
  private readonly clientsApi = inject(ClientService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(FormBuilder);
  private readonly confirm = inject(ConfirmationService);
  private readonly toast = inject(ToastService);

  readonly items = signal<SalesActivityDto[]>([]);
  readonly error = signal<string | null>(null);
  readonly loading = signal(false);
  readonly totalRecords = signal(0);
  readonly firstIdx = signal(0);
  readonly clients = signal<ClientListItem[]>([]);
  readonly allOpportunities = signal<OpportunityDto[]>([]);
  readonly assignableUsers = signal<CrmAssignableUserDto[]>([]);
  readonly editingId = signal<string | null>(null);
  readonly saving = signal(false);
  readonly formError = signal<string | null>(null);

  /** Totaux agrégés (backend) sur l'ensemble filtré complet — alimente la zone de totaux. */
  readonly summary = signal<ActivityListSummary | null>(null);
  readonly summaryLoading = signal(false);

  readonly summaryMetrics = computed<TotalMetric[]>(() => {
    const s = this.summary();
    return [
      { label: 'Activités', value: s?.count, format: 'number', icon: 'pi-calendar', tone: 'primary' },
      { label: 'Ouvertes', value: s?.openCount, format: 'number', icon: 'pi-clock', tone: 'amber' },
      { label: 'Terminées', value: s?.completedCount, format: 'number', icon: 'pi-check-circle', tone: 'emerald' },
      { label: 'En retard', value: s?.overdueCount, format: 'number', icon: 'pi-exclamation-triangle', tone: 'rose' }
    ];
  });

  /** Above activity drawer overlay (1100) / panel (1101) for PrimeNG appendTo="body" overlays */
  readonly activityPanelPrimeOverlayOptions: OverlayOptions = { baseZIndex: 1200 };
  readonly activityPanelPrimeBaseZIndex = 1200;

  pageSize = 15;
  private page = 1;

  formDialogVisible = false;

  searchInput = '';
  private readonly search$ = new Subject<string>();
  private subs = new Subscription();

  statusFilter: StatusFilter = 'all';
  statusFilterOptions: StatusFilterOption[] = [
    { label: 'Toutes', value: 'all' },
    { label: 'En cours', value: 'open' },
    { label: 'Terminées', value: 'done' }
  ];

  typeFilter: number | null = null;
  typeFilterOptions = [
    { label: 'Appel', value: 0 },
    { label: 'Email', value: 1 },
    { label: 'Rendez-vous', value: 2 },
    { label: 'Tâche', value: 3 },
    { label: 'Note', value: 4 }
  ];

  typeOptions = this.typeFilterOptions;

  priorityOptions = [
    { label: 'Basse', value: 0 },
    { label: 'Moyenne', value: 1 },
    { label: 'Haute', value: 2 },
    { label: 'Urgente', value: 3 }
  ];

  selectedClient: ClientListItem | null = null;
  selectedOpportunity: OpportunityDto | null = null;
  myActivitiesOnly = false;
  dueFrom: Date | null = null;
  dueTo: Date | null = null;

  activityForm = this.fb.nonNullable.group({
    type: [3, Validators.required],
    subject: ['', [Validators.required, Validators.maxLength(500)]],
    description: ['', Validators.maxLength(2000)],
    clientId: [''],
    opportunityId: [''],
    assignedUserId: [''],
    priority: [1, Validators.required],
    dueDate: [null as Date | null],
    reminderDate: [null as Date | null]
  });

  canCreate(): boolean {
    return this.auth.hasAllPermissions([PERMISSIONS.crm.create]);
  }

  canUpdate(): boolean {
    return this.auth.hasAllPermissions([PERMISSIONS.crm.update]);
  }

  canDelete(): boolean {
    return this.auth.hasAllPermissions([PERMISSIONS.crm.delete]);
  }

  filteredOpportunities(): OpportunityDto[] {
    if (!this.selectedClient) return this.allOpportunities();
    return this.allOpportunities().filter(o => o.clientId === this.selectedClient!.id);
  }

  formOpportunityOptions(): OpportunityDto[] {
    const cid = this.activityForm.get('clientId')?.value;
    if (!cid) return [];
    return this.allOpportunities().filter(o => o.clientId === cid);
  }

  assigneeDropdownOptions(): { label: string; value: string }[] {
    const opts = [{ label: 'Moi par défaut', value: '' }];
    for (const u of this.assignableUsers()) {
      opts.push({ label: u.displayName, value: u.id });
    }
    return opts;
  }

  ngOnInit(): void {
    const q = this.route.snapshot.queryParamMap;
    if (q.get('mine') === '1') {
      this.myActivitiesOnly = true;
    }
    const c = q.get('completed');
    if (c === 'true') this.statusFilter = 'done';
    else if (c === 'false') this.statusFilter = 'open';

    this.subs.add(
      this.search$.pipe(debounceTime(400), distinctUntilChanged()).subscribe(() => {
        this.resetPagingAndLoad();
      })
    );

    this.loadClients();
    this.loadOpportunities();
    this.loadAssignableUsers();
    this.resetPagingAndLoad();
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  onSearchInput(value: string): void {
    this.search$.next(value?.trim() ?? '');
  }

  onFiltersChanged(): void {
    this.resetPagingAndLoad();
  }

  onDueClear(): void {
    this.onFiltersChanged();
  }

  reload(): void {
    this.loadActivities();
  }

  onLazyLoad(event: TableLazyLoadEvent): void {
    this.firstIdx.set(event.first ?? 0);
    this.pageSize = event.rows ?? this.pageSize;
    this.page = Math.floor((event.first ?? 0) / this.pageSize) + 1;
    this.loadActivities();
  }

  private resetPagingAndLoad(): void {
    this.firstIdx.set(0);
    this.page = 1;
    this.loadActivities();
  }

  /** Totaux conformes aux filtres ; échec silencieux pour ne pas perturber la liste. */
  private loadSummary(params: { clientId?: string; assignedUserId?: string; opportunityId?: string; completed?: boolean; dueFrom?: string; dueTo?: string; activityType?: number; search?: string }): void {
    this.summaryLoading.set(true);
    this.crm.getActivitiesSummary(params).subscribe({
      next: r => {
        this.summary.set(r.success && r.data ? r.data : null);
        this.summaryLoading.set(false);
      },
      error: () => {
        this.summary.set(null);
        this.summaryLoading.set(false);
      }
    });
  }

  private loadClients(): void {
    this.clientsApi.getClients({ page: 1, pageSize: 500, isActive: true }).subscribe({
      next: res => {
        if (res.success && res.data?.items) this.clients.set(res.data.items);
      }
    });
  }

  private loadOpportunities(): void {
    this.crm.getOpportunities().subscribe({
      next: res => {
        if (res.success && res.data) this.allOpportunities.set(res.data);
      }
    });
  }

  private loadAssignableUsers(): void {
    this.crm.getAssignableUsers().subscribe({
      next: res => {
        if (res.success && res.data) this.assignableUsers.set(res.data);
      }
    });
  }

  private completedParam(): boolean | undefined {
    if (this.statusFilter === 'open') return false;
    if (this.statusFilter === 'done') return true;
    return undefined;
  }

  private formatDate(d: Date | null): string | undefined {
    if (!d) return undefined;
    const x = new Date(d);
    return formatLocalDate(x);
  }

  private loadActivities(): void {
    this.loading.set(true);
    this.error.set(null);
    const uid = this.auth.user()?.id;
    const params = {
      clientId: this.selectedClient?.id,
      assignedUserId: this.myActivitiesOnly && uid ? uid : undefined,
      opportunityId: this.selectedOpportunity?.id,
      completed: this.completedParam(),
      dueFrom: this.formatDate(this.dueFrom),
      dueTo: this.formatDate(this.dueTo),
      activityType: this.typeFilter !== null ? this.typeFilter : undefined,
      search: this.searchInput.trim() || undefined,
      page: this.page,
      pageSize: this.pageSize
    };

    this.loadSummary(params);

    this.crm.getActivitiesPaged(params).subscribe({
      next: r => {
        this.loading.set(false);
        if (r.success && r.data) {
          this.items.set(r.data.items);
          this.totalRecords.set(r.data.totalCount);
        } else {
          const msg = r.errors?.[0] ?? r.message ?? r.error ?? $localize`:@@ui.tern.erreur.ab546c:Erreur`;
          this.error.set(msg);
        }
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Erreur réseau');
      }
    });
  }

  openCreate(): void {
    this.editingId.set(null);
    this.formError.set(null);
    this.activityForm.reset({
      type: 3,
      subject: '',
      description: '',
      clientId: '',
      opportunityId: '',
      assignedUserId: '',
      priority: 1,
      dueDate: null,
      reminderDate: null
    });
    this.activityForm.get('clientId')?.setValidators([Validators.required]);
    this.activityForm.get('clientId')?.updateValueAndValidity();
    this.activityForm.get('clientId')?.enable();
    this.formDialogVisible = true;
  }

  openEdit(a: SalesActivityDto): void {
    if (a.isCompleted) {
      this.toast.add({ severity: 'warn', summary: $localize`:@@activity-list.component.summary.Activit_termin_:Activité terminée`, detail: $localize`:@@activity-list.component.detail.Impossible_de_mo:Impossible de modifier une activité terminée.`, life: 5000 });
      return;
    }
    this.editingId.set(a.id);
    this.formError.set(null);
    this.activityForm.patchValue({
      type: a.type,
      subject: a.subject,
      description: a.description ?? '',
      clientId: a.clientId,
      opportunityId: a.opportunityId ?? '',
      assignedUserId: a.assignedUserId,
      priority: a.priority,
      dueDate: a.dueDate ? new Date(a.dueDate) : null,
      reminderDate: a.reminderDate ? new Date(a.reminderDate) : null
    });
    this.activityForm.get('clientId')?.clearValidators();
    this.activityForm.get('clientId')?.updateValueAndValidity();
    this.activityForm.get('clientId')?.disable();
    this.formDialogVisible = true;
  }

  onFormClientChange(): void {
    this.activityForm.patchValue({ opportunityId: '' });
  }

  closeActivityPanel(): void {
    this.formDialogVisible = false;
    this.resetFormDialog();
  }

  @HostListener('document:keydown.escape', ['$event'])
  onActivityPanelEscape(event: KeyboardEvent): void {
    if (!this.formDialogVisible) {
      return;
    }
    event.preventDefault();
    this.closeActivityPanel();
  }

  resetFormDialog(): void {
    this.formError.set(null);
    this.activityForm.get('clientId')?.enable();
  }

  save(): void {
    if (this.activityForm.invalid) {
      this.activityForm.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.formError.set(null);
    const v = this.activityForm.getRawValue();
    const due = v.dueDate ? new Date(v.dueDate) : null;
    const rem = v.reminderDate ? new Date(v.reminderDate) : null;

    const id = this.editingId();
    if (id) {
      const body: Record<string, unknown> = {
        type: v.type,
        subject: v.subject.trim(),
        description: v.description?.trim() || null,
        priority: v.priority,
        dueDate: due ? due.toISOString() : null,
        reminderDate: rem ? rem.toISOString() : null,
        opportunityId: v.opportunityId || null,
        assignedUserId: v.assignedUserId || null
      };
      this.crm.updateActivity(id, body).subscribe({
        next: r => {
          this.saving.set(false);
          if (r.success) {
            this.closeActivityPanel();
            this.loadActivities();
            this.toast.add({ severity: 'success', summary: $localize`:@@activity-list.component.summary.Activité mis:Activité mise à jour`, life: 3000 });
          } else {
            this.formError.set(r.errors?.[0] ?? r.message ?? r.error ?? $localize`:@@ui.tern.erreur.ab546c:Erreur`);
          }
        },
        error: () => {
          this.saving.set(false);
          this.formError.set('Erreur réseau');
        }
      });
      return;
    }

    const body: Record<string, unknown> = {
      type: v.type,
      subject: v.subject.trim(),
      description: v.description?.trim() || null,
      clientId: v.clientId,
      priority: v.priority,
      dueDate: due ? due.toISOString() : null,
      reminderDate: rem ? rem.toISOString() : null,
      opportunityId: v.opportunityId || null
    };
    if (v.assignedUserId) {
      body['assignedUserId'] = v.assignedUserId;
    }

    this.crm.createActivity(body).subscribe({
      next: r => {
        this.saving.set(false);
        if (r.success) {
          this.closeActivityPanel();
          this.resetPagingAndLoad();
          this.toast.add({ severity: 'success', summary: $localize`:@@activity-list.component.summary.Activité cré:Activité créée`, life: 3000 });
        } else {
          this.formError.set(r.errors?.[0] ?? r.message ?? r.error ?? $localize`:@@ui.tern.erreur.ab546c:Erreur`);
        }
      },
      error: () => {
        this.saving.set(false);
        this.formError.set('Erreur réseau');
      }
    });
  }

  complete(a: SalesActivityDto): void {
    this.crm.completeActivity(a.id).subscribe({
      next: r => {
        if (r.success) {
          this.loadActivities();
          this.toast.add({ severity: 'success', summary: $localize`:@@activity-list.component.summary.Activit_termin_:Activité terminée`, life: 3000 });
        } else {
          const msg = r.errors?.[0] ?? r.message ?? r.error ?? $localize`:@@ui.tern.impossible.de.terminer.l.activite.0da4cb:Impossible de terminer l’activité`;
          this.toast.add({ severity: 'error', summary: $localize`:@@activity-list.component.summary.Erreur:Erreur`, detail: msg, life: 6000 });
        }
      },
      error: () => {
        this.toast.add({ severity: 'error', summary: $localize`:@@activity-list.component.summary.Erreur résea:Erreur réseau`, detail: $localize`:@@activity-list.component.detail.R_essayez_dans_u:Réessayez dans un instant.`, life: 6000 });
      }
    });
  }

  confirmDelete(a: SalesActivityDto): void {
    this.confirm.confirm({
      header: 'Supprimer l’activité',
      message: `Supprimer « ${a.subject} » ? Cette action est définitive.`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: $localize`:@@activity-list.component.acceptLabel.Supprimer:Supprimer`,
      rejectLabel: $localize`:@@activity-list.component.rejectLabel.Annuler:Annuler`,
      acceptButtonStyleClass: 'btn-danger',
      accept: () => {
        this.crm.deleteActivity(a.id).subscribe({
          next: r => {
            if (r.success) {
              this.loadActivities();
              this.toast.add({ severity: 'success', summary: $localize`:@@activity-list.component.summary.Activité sup:Activité supprimée`, life: 3000 });
            } else {
              const msg = r.errors?.[0] ?? r.message ?? r.error ?? $localize`:@@ui.tern.suppression.impossible.55762f:Suppression impossible`;
              this.toast.add({ severity: 'error', summary: $localize`:@@activity-list.component.summary.Erreur:Erreur`, detail: msg, life: 6000 });
            }
          },
          error: () => {
            this.toast.add({ severity: 'error', summary: $localize`:@@activity-list.component.summary.Erreur résea:Erreur réseau`, life: 6000 });
          }
        });
      }
    });
  }
}
