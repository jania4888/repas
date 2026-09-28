/// <reference types="@angular/localize" />
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  FirmAssignmentService,
  AccountingFirmDirectoryItem,
  FirmClientAssignment
} from '@core/services/firm-assignment.service';
import { FirmDirectoryCardComponent } from '@shared/accounting-firm/firm-directory-card.component';
import {
  CLIENT_SEGMENT_OPTIONS,
  LANGUAGE_OPTIONS,
  PRACTICE_AREA_OPTIONS,
  firmCodeLabel
} from '@shared/accounting-firm/firm-directory.labels';
import { GOVERNORATE_OPTIONS } from '@features/auth/shared/auth-governorate.options';
import { ToastService } from '@core/services/toast.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { StatusBadgeComponent } from '@shared/components/status-badge/status-badge.component';
import { SkeletonComponent } from '@shared/components/skeleton/skeleton.component';
import {
  firmAssignmentStatusView,
  isActiveAssignment,
  isOpenAssignment,
  isPendingAssignment,
  isRejectedAssignment
} from './firm-assignment-status';

const NOTES_MAX = 1000;

@Component({
  selector: 'app-accounting-firm-settings',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    PageHeaderComponent,
    StatusBadgeComponent,
    SkeletonComponent,
    FirmDirectoryCardComponent
  ],
  template: `
    <app-page-header
      title="Cabinet comptable" i18n-title="@@settings.accounting-firm.cabinet.comptable.0b9c6d02"
      subtitle="Confiez la gestion comptable de votre société à un cabinet partenaire" i18n-subtitle="@@settings.accounting-firm.confiez.la.gestion.comptable.de.votre.so.13e62730">
    </app-page-header>

    @if (loading()) {
      <div class="af-card">
        <app-skeleton width="40%" height="1.4rem"></app-skeleton>
        <app-skeleton width="100%" height="3rem" shape="rounded"></app-skeleton>
        <app-skeleton width="30%" height="2.4rem" shape="rounded"></app-skeleton>
      </div>
    } @else if (current()) {
      @if (current(); as assignment) {
      <div class="af-card">
        <div class="af-liaison">
          <div class="af-liaison__head">
            <div class="af-liaison__identity">
              <span class="af-liaison__firm">{{ assignment.firmDisplayName }}</span>
              <app-status-badge
                [status]="statusView(assignment.status).badge"
                [label]="statusView(assignment.status).label">
              </app-status-badge>
            </div>

            @if (isActive(assignment.status)) {
              <button type="button" class="af-btn af-btn--danger" (click)="revoke()" [disabled]="acting()" i18n="@@settings.accounting-firm.revoquer.l.affectation.398e894c">
                <i class="pi pi-times-circle"></i> Révoquer l'affectation
              </button>
            } @else if (isPending(assignment.status)) {
              <button type="button" class="af-btn af-btn--danger-outline" (click)="cancelPending()" [disabled]="acting()" i18n="@@settings.accounting-firm.annuler.la.demande.05ba01cd">
                <i class="pi pi-ban"></i> Annuler la demande
              </button>
            }
          </div>

          <dl class="af-meta">
            @if (isActive(assignment.status) && assignment.respondedAt) {
              <div class="af-meta__row">
                <dt i18n="@@settings.accounting-firm.actif.depuis.bcdceff3">Actif depuis</dt>
                <dd>{{ assignment.respondedAt | date: 'dd/MM/yyyy' }}</dd>
              </div>
            } @else {
              <div class="af-meta__row">
                <dt i18n="@@settings.accounting-firm.demandee.le.c52dbe79">Demandée le</dt>
                <dd>{{ assignment.requestedAt | date: 'dd/MM/yyyy HH:mm' }}</dd>
              </div>
            }
            @if (isActive(assignment.status) && (assignment.firmCity || assignment.firmGovernorate)) {
              <div class="af-meta__row">
                <dt i18n="@@settings.accounting-firm.localisation.84e3d483">Localisation</dt>
                <dd>{{ assignment.firmCity }}{{ assignment.firmCity && assignment.firmGovernorate ? ', ' : '' }}{{ assignment.firmGovernorate }}</dd>
              </div>
            }
            @if (isActive(assignment.status) && assignment.firmPracticeAreas?.length) {
              <div class="af-meta__row">
                <dt i18n="@@settings.accounting-firm.domaines.244b02f9">Domaines</dt>
                <dd>{{ practiceLabels(assignment.firmPracticeAreas) }}</dd>
              </div>
            }
            @if (isActive(assignment.status) && (assignment.firmContactPhone || assignment.firmContactEmail)) {
              <div class="af-meta__row">
                <dt i18n="@@settings.accounting-firm.contact.b37456c4">Contact</dt>
                <dd>{{ assignment.firmContactPhone }}{{ assignment.firmContactPhone && assignment.firmContactEmail ? ' · ' : '' }}{{ assignment.firmContactEmail }}</dd>
              </div>
            }
            @if (assignment.notes) {
              <div class="af-meta__row">
                <dt i18n="@@settings.accounting-firm.message.envoye.3414873e">Message envoyé</dt>
                <dd class="af-meta__notes">{{ assignment.notes }}</dd>
              </div>
            }
          </dl>

          @if (isPending(assignment.status)) {
            <p class="af-hint" i18n="@@settings.accounting-firm.votre.demande.a.ete.transmise.au.cabinet.10c3ff89">
              <i class="pi pi-info-circle"></i>
              Votre demande a été transmise au cabinet. Vous serez notifié dès qu'elle sera acceptée ou refusée.
            </p>
          }
        </div>
      </div>
      }
    } @else {
      <!-- État : aucune liaison ouverte → recherche + éventuel bandeau de refus -->
      @if (lastClosed(); as closed) {
        <div class="af-banner af-banner--{{ statusView(closed.status).badge }}">
          <i class="pi" [ngClass]="isRejected(closed.status) ? 'pi-times-circle' : 'pi-info-circle'"></i>
          <div class="af-banner__body">
            <strong>{{ closed.firmDisplayName }} — {{ statusView(closed.status).label }}</strong>
            <span class="af-banner__date">{{ (closed.respondedAt || closed.revokedAt || closed.requestedAt) | date: 'dd/MM/yyyy' }}</span>
            @if (closed.rejectionReason) {
              <p class="af-banner__reason" i18n="@@settings.accounting-firm.motif.ac1c6c0e">Motif : {{ closed.rejectionReason }}</p>
            }
            <span class="af-banner__cta" i18n="@@settings.accounting-firm.vous.pouvez.adresser.une.nouvelle.demande.a.un.c.20d16262">Vous pouvez adresser une nouvelle demande à un cabinet ci-dessous.</span>
          </div>
        </div>
      }

      <div class="af-card">
        <h2 class="af-card__title" i18n="@@settings.accounting-firm.rechercher.un.cabinet.77bb1df8">Rechercher un cabinet</h2>
        <p class="af-card__subtitle" i18n="@@settings.accounting-firm.comparez.les.cabinets.puis.envoyez.une.seule.dem.8d99a9af">Comparez les cabinets, puis envoyez une seule demande.</p>

        <button type="button" class="af-filters__toggle" (click)="filtersOpen.set(!filtersOpen())" i18n="@@settings.accounting-firm.filtres.0e268f4a">
          <i class="pi" [ngClass]="filtersOpen() ? 'pi-chevron-down' : 'pi-chevron-right'"></i>
          Filtres
        </button>

          <div class="af-filters" [class.af-filters--open]="filtersOpen()">
            <div class="af-field">
              <label for="firmSearch" i18n="@@settings.accounting-firm.nom.ville.ou.presentation.8204364c">Nom, ville ou présentation</label>
              <input id="firmSearch" class="af-input" [(ngModel)]="searchText" (ngModelChange)="onFilterChange()" placeholder="Ex. TVA, Sousse, cabinet" i18n-placeholder="@@settings.accounting-firm.ex.tva.sousse.cabinet.3a049865" />
            </div>
            <div class="af-field">
              <label for="firmGovernorate" i18n="@@settings.accounting-firm.gouvernorat.b9cd1d99">Gouvernorat</label>
              <select id="firmGovernorate" class="af-input" [(ngModel)]="governorate" (ngModelChange)="onFilterChange()">
                <option value="" i18n="@@settings.accounting-firm.tous.les.gouvernorats.ae8b0ecb">Tous les gouvernorats</option>
                @for (g of governorates; track g.value) {
                  <option [value]="g.value">{{ g.label }}</option>
                }
              </select>
            </div>
            <div class="af-field">
              <label for="firmPractice" i18n="@@settings.accounting-firm.domaine.b6eb3da6">Domaine</label>
              <select id="firmPractice" class="af-input" [(ngModel)]="practiceArea" (ngModelChange)="onFilterChange()">
                <option value="" i18n="@@settings.accounting-firm.tous.les.domaines.9d24299c">Tous les domaines</option>
                @for (o of practiceOptions; track o.value) {
                  <option [value]="o.value">{{ o.label }}</option>
                }
              </select>
            </div>
            <div class="af-field">
              <label for="firmLanguage" i18n="@@settings.accounting-firm.langue.6619264a">Langue</label>
              <select id="firmLanguage" class="af-input" [(ngModel)]="language" (ngModelChange)="onFilterChange()">
                <option value="" i18n="@@settings.accounting-firm.toutes.les.langues.18c88470">Toutes les langues</option>
                @for (o of languageOptions; track o.value) {
                  <option [value]="o.value">{{ o.label }}</option>
                }
              </select>
            </div>
            <div class="af-field">
              <label for="firmSegment" i18n="@@settings.accounting-firm.type.de.societe.68ad1468">Type de société</label>
              <select id="firmSegment" class="af-input" [(ngModel)]="clientSegment" (ngModelChange)="onFilterChange()">
                <option value="" i18n="@@settings.accounting-firm.tous.b97ae3b4">Tous</option>
                @for (o of segmentOptions; track o.value) {
                  <option [value]="o.value">{{ o.label }}</option>
                }
              </select>
            </div>
            <label class="af-check" for="firmRemote">
              <input id="firmRemote" type="checkbox" [(ngModel)]="remoteOnly" (ngModelChange)="onFilterChange()" /><ng-container i18n="@@settings.accounting-firm.accepte.le.distanciel.eabce959">
              Accepte le distanciel
            </ng-container></label>
            <button type="button" class="af-btn af-btn--ghost" (click)="resetFilters()" i18n="@@settings.accounting-firm.reinitialiser.e0e2ad54">Réinitialiser</button>
          </div>

        @if (directoryLoading()) {
          <div class="af-grid">
            <app-skeleton height="9rem" shape="rounded"></app-skeleton>
            <app-skeleton height="9rem" shape="rounded"></app-skeleton>
          </div>
        } @else if (directoryError()) {
          <p class="af-empty" i18n="@@settings.accounting-firm.la.liste.des.cabinets.n.a.pas.pu.etre.chargee.5e761efc">La liste des cabinets n’a pas pu être chargée.</p>
          <button type="button" class="af-btn af-btn--ghost" (click)="loadDirectory(true)" i18n="@@settings.accounting-firm.reessayer.895d416b">Réessayer</button>
        } @else if (firms().length === 0) {
          <p class="af-empty">
            {{ hasActiveFilters() ? loc_ui_tern_aucun_cabinet_ne_correspond_a_ces_filtres_356261 : loc_ui_tern_aucun_cabinet_public_n_est_disponible_pour_a0691a }}
          </p>
        } @else {
          <div class="af-grid">
            @for (firm of firms(); track firm.firmTenantId) {
              <app-firm-directory-card
                [firm]="firm"
                [selectable]="true"
                [selected]="selectedFirm?.firmTenantId === firm.firmTenantId"
                (choose)="selectFirm($event)">
              </app-firm-directory-card>
            }
          </div>
          @if (canLoadMore()) {
            <button type="button" class="af-btn af-btn--ghost" (click)="loadMore()" [disabled]="directoryLoading()" i18n="@@settings.accounting-firm.afficher.plus.5cc35957">Afficher plus</button>
          }
        }

        @if (selectedFirm) {
        <div class="af-field">
          <label for="firmNotes"><ng-container i18n="@@settings.accounting-firm.message.au.cabinet.9019b579">Message au cabinet </ng-container> <span class="af-optional" i18n="@@settings.accounting-firm.facultatif.6d7d6db4">(facultatif)</span></label>
          <textarea
            id="firmNotes"
            [(ngModel)]="notes"
            [maxlength]="NOTES_MAX"
            rows="3"
            class="af-textarea"
            placeholder="Précisez votre demande (période, contexte, attentes...)" i18n-placeholder="@@settings.accounting-firm.precisez.votre.demande.periode.contexte.attentes.61f8a78c"></textarea>
          <small class="af-hint-inline">{{ notes.length }} / {{ NOTES_MAX }}</small>
        </div>

        <div class="af-actions">
          <button
            type="button"
            class="af-btn af-btn--primary"
            (click)="confirmAndSubmit()"
            [disabled]="!selectedFirm || acting()" i18n="@@settings.accounting-firm.envoyer.la.demande.b3cb4a78">
            <i class="pi pi-send"></i> Envoyer la demande
          </button>
        </div>
        }
      </div>

      @if (history().length > 0) {
        <div class="af-card">
          <button type="button" class="af-history__toggle" (click)="historyOpen.set(!historyOpen())" i18n="@@settings.accounting-firm.historique.des.demandes.e82eff43">
            <i class="pi" [ngClass]="historyOpen() ? 'pi-chevron-down' : 'pi-chevron-right'"></i>
            Historique des demandes ({{ history().length }})
          </button>
          @if (historyOpen()) {
            <ul class="af-history__list">
              @for (h of history(); track h.id) {
                <li class="af-history__item">
                  <div class="af-history__main">
                    <span class="af-history__firm">{{ h.firmDisplayName }}</span>
                    <app-status-badge [status]="statusView(h.status).badge" [label]="statusView(h.status).label"></app-status-badge>
                  </div>
                  <div class="af-history__side">
                    <span class="af-history__date">{{ h.requestedAt | date: 'dd/MM/yyyy' }}</span>
                    @if (h.rejectionReason) {
                      <span class="af-history__reason" i18n="@@settings.accounting-firm.motif.8d3d4b69">Motif : {{ h.rejectionReason }}</span>
                    }
                  </div>
                </li>
              }
            </ul>
          }
        </div>
      }
    }
  `,
  styles: [`
    :host { display: block; }

    .af-card {
      background: var(--color-surface, #fff);
      border: 1px solid var(--color-border-subtle, var(--color-neutral-200));
      border-radius: var(--radius-xl, 16px);
      box-shadow: var(--shadow-soft-sm, 0 1px 2px rgba(15, 23, 42, 0.05));
      padding: var(--spacing-6, 24px);
      margin-bottom: var(--spacing-4, 16px);
      display: flex;
      flex-direction: column;
      gap: var(--spacing-4, 16px);
    }

    .af-card__title {
      margin: 0;
      font-size: var(--font-size-lg, 1.125rem);
      font-weight: var(--font-weight-semibold, 600);
      color: var(--color-text-primary, #0f172a);
    }

    .af-card__subtitle {
      margin: -8px 0 0;
      font-size: var(--font-size-sm, 0.875rem);
      color: var(--color-text-secondary, #64748b);
    }

    /* Liaison active / en attente */
    .af-liaison { display: flex; flex-direction: column; gap: var(--spacing-4, 16px); }

    .af-liaison__head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--spacing-4, 16px);
      flex-wrap: wrap;
    }

    .af-liaison__identity { display: flex; align-items: center; gap: var(--spacing-3, 12px); flex-wrap: wrap; }

    .af-liaison__firm {
      font-size: var(--font-size-lg, 1.125rem);
      font-weight: var(--font-weight-semibold, 600);
      color: var(--color-text-primary, #0f172a);
    }

    .af-meta { margin: 0; display: flex; flex-direction: column; gap: var(--spacing-2, 8px); }
    .af-meta__row { display: flex; gap: var(--spacing-3, 12px); }
    .af-meta__row dt {
      min-width: 130px;
      color: var(--color-text-secondary, #64748b);
      font-size: var(--font-size-sm, 0.875rem);
    }
    .af-meta__row dd { margin: 0; color: var(--color-text-primary, #0f172a); font-size: var(--font-size-sm, 0.875rem); }
    .af-meta__notes { white-space: pre-wrap; }

    .af-hint {
      display: flex;
      align-items: center;
      gap: var(--spacing-2, 8px);
      margin: 0;
      padding: var(--spacing-3, 12px);
      background: var(--color-primary-50, #eff6ff);
      border-radius: var(--radius-lg, 12px);
      color: var(--color-primary-800, #1e40af);
      font-size: var(--font-size-sm, 0.875rem);
    }

    /* Bandeau (refus / révocation) */
    .af-banner {
      display: flex;
      gap: var(--spacing-3, 12px);
      padding: var(--spacing-4, 16px);
      border-radius: var(--radius-xl, 16px);
      margin-bottom: var(--spacing-4, 16px);
      border: 1px solid transparent;
    }
    .af-banner > .pi { font-size: 1.25rem; margin-top: 2px; }
    .af-banner--rejected {
      background: var(--color-danger-50, #fef2f2);
      border-color: var(--color-danger-200, #fecaca);
      color: var(--color-danger-800, #991b1b);
    }
    .af-banner--inactive, .af-banner--cancelled {
      background: var(--color-neutral-50, #f8fafc);
      border-color: var(--color-neutral-200, #e2e8f0);
      color: var(--color-text-secondary, #475569);
    }
    .af-banner__body { display: flex; flex-direction: column; gap: 2px; }
    .af-banner__date { font-size: var(--font-size-xs, 0.75rem); opacity: 0.8; }
    .af-banner__reason { margin: 4px 0 0; font-size: var(--font-size-sm, 0.875rem); }
    .af-banner__cta { margin-top: 4px; font-size: var(--font-size-sm, 0.875rem); }

    /* Champs */
    .af-field { display: flex; flex-direction: column; gap: var(--spacing-2, 8px); }
    .af-field label {
      font-size: var(--font-size-sm, 0.875rem);
      font-weight: var(--font-weight-medium, 500);
      color: var(--color-text-primary, #0f172a);
    }
    .af-optional { color: var(--color-text-tertiary, #94a3b8); font-weight: 400; }

    .af-textarea {
      width: 100%;
      resize: vertical;
      padding: var(--spacing-3, 12px);
      border: 1px solid var(--color-border, var(--color-neutral-300));
      border-radius: var(--radius-lg, 12px);
      font-family: inherit;
      font-size: var(--font-size-sm, 0.875rem);
      color: var(--color-text-primary, #0f172a);
    }
    .af-textarea:focus {
      outline: none;
      border-color: var(--color-primary-400, #60a5fa);
      box-shadow: 0 0 0 3px var(--color-primary-100, rgba(37, 99, 235, 0.15));
    }

    .af-hint-inline { font-size: var(--font-size-xs, 0.75rem); color: var(--color-text-tertiary, #94a3b8); }

    .af-suggestion { display: flex; flex-direction: column; gap: 2px; padding: 2px 0; }
    .af-suggestion__name { font-weight: 600; color: var(--color-text-primary, #0f172a); }
    .af-suggestion__meta {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      font-size: var(--font-size-xs, 0.75rem);
      color: var(--color-text-secondary, #64748b);
    }
    .af-suggestion__meta i { margin-inline-end: 4px; }

    .af-actions { display: flex; justify-content: flex-end; }
    .af-filters { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; align-items: end; }
    .af-filters__toggle {
      display: none;
      align-items: center;
      gap: 8px;
      background: none;
      border: none;
      padding: 0;
      cursor: pointer;
      font-weight: 600;
      color: var(--color-text-primary, #0f172a);
    }
    .af-input {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid var(--color-border, #cbd5e1);
      border-radius: 12px;
      font: inherit;
      color: var(--color-text-primary, #0f172a);
      background: var(--color-surface, #fff);
    }
    .af-input:focus-visible { outline: 2px solid var(--color-primary-600, #2563eb); outline-offset: 2px; }
    .af-check { display: flex; align-items: center; gap: 8px; font-size: 0.875rem; }
    .af-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
    .af-empty { margin: 0; color: var(--color-text-secondary, #64748b); }
    .af-btn--ghost {
      background: transparent;
      color: var(--color-primary-700, #1d4ed8);
      border-color: var(--color-primary-200, #bfdbfe);
    }
    @media (max-width: 720px) {
      .af-filters { display: none; }
      .af-filters--open { display: grid; }
      .af-filters__toggle { display: inline-flex; }
      .af-actions { justify-content: stretch; }
      .af-actions .af-btn { width: 100%; justify-content: center; }
    }

    /* Boutons */
    .af-btn {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-2, 8px);
      padding: var(--spacing-3, 10px) var(--spacing-5, 20px);
      border-radius: var(--radius-lg, 12px);
      font-weight: var(--font-weight-medium, 500);
      font-size: var(--font-size-sm, 0.875rem);
      cursor: pointer;
      border: 1px solid transparent;
      transition: all 0.15s ease;
    }
    .af-btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .af-btn--primary { background: var(--color-primary-600, #2563eb); color: #fff; }
    .af-btn--primary:not(:disabled):hover { background: var(--color-primary-700, #1d4ed8); }
    .af-btn--danger { background: var(--color-danger-600, #dc2626); color: #fff; }
    .af-btn--danger:not(:disabled):hover { background: var(--color-danger-700, #b91c1c); }
    .af-btn--danger-outline {
      background: transparent;
      color: var(--color-danger-600, #dc2626);
      border-color: var(--color-danger-300, #fca5a5);
    }
    .af-btn--danger-outline:not(:disabled):hover { background: var(--color-danger-50, #fef2f2); }

    /* Historique */
    .af-history__toggle {
      display: flex;
      align-items: center;
      gap: var(--spacing-2, 8px);
      background: none;
      border: none;
      padding: 0;
      cursor: pointer;
      font-size: var(--font-size-sm, 0.875rem);
      font-weight: var(--font-weight-medium, 500);
      color: var(--color-text-primary, #0f172a);
    }
    .af-history__list { list-style: none; margin: var(--spacing-2, 8px) 0 0; padding: 0; display: flex; flex-direction: column; }
    .af-history__item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--spacing-3, 12px);
      padding: var(--spacing-3, 12px) 0;
      border-top: 1px solid var(--color-border-subtle, var(--color-neutral-100));
      flex-wrap: wrap;
    }
    .af-history__main { display: flex; align-items: center; gap: var(--spacing-3, 12px); }
    .af-history__firm { font-weight: 500; color: var(--color-text-primary, #0f172a); font-size: var(--font-size-sm, 0.875rem); }
    .af-history__side { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
    .af-history__date { font-size: var(--font-size-xs, 0.75rem); color: var(--color-text-tertiary, #94a3b8); }
    .af-history__reason { font-size: var(--font-size-xs, 0.75rem); color: var(--color-text-secondary, #64748b); }
  `]
})
export class AccountingFirmSettingsComponent implements OnInit {
  readonly loc_ui_tern_aucun_cabinet_ne_correspond_a_ces_filtres_356261 = $localize`:@@ui.tern.aucun.cabinet.ne.correspond.a.ces.filtres..356261:Aucun cabinet ne correspond à ces filtres. Élargissez la recherche.`;
  readonly loc_ui_tern_aucun_cabinet_public_n_est_disponible_pour_a0691a = $localize`:@@ui.tern.aucun.cabinet.public.n.est.disponible.pour.a0691a:Aucun cabinet public n’est disponible pour le moment.`;
  private readonly assignments = inject(FirmAssignmentService);
  private readonly toast = inject(ToastService);
  private readonly confirmation = inject(ConfirmationService);

  readonly NOTES_MAX = NOTES_MAX;

  readonly loading = signal(true);
  readonly acting = signal(false);
  readonly current = signal<FirmClientAssignment | null>(null);
  readonly history = signal<FirmClientAssignment[]>([]);
  readonly firms = signal<AccountingFirmDirectoryItem[]>([]);
  readonly directoryLoading = signal(false);
  readonly directoryError = signal(false);
  readonly historyOpen = signal(false);
  readonly filtersOpen = signal(true);
  readonly totalCount = signal(0);
  readonly page = signal(1);

  readonly governorates = GOVERNORATE_OPTIONS;
  readonly practiceOptions = PRACTICE_AREA_OPTIONS;
  readonly languageOptions = LANGUAGE_OPTIONS;
  readonly segmentOptions = CLIENT_SEGMENT_OPTIONS;
  readonly pageSize = 20;

  selectedFirm: AccountingFirmDirectoryItem | null = null;
  notes = '';
  searchText = '';
  governorate = '';
  practiceArea = '';
  language = '';
  clientSegment = '';
  remoteOnly = false;
  private governoratePrefilled = false;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  /** Dernière demande close (refusée/révoquée/annulée) — pour le bandeau, quand aucune liaison n'est ouverte. */
  readonly lastClosed = computed(() => {
    if (this.current()) return null;
    return this.history().find(h => !isOpenAssignment(h.status)) ?? null;
  });

  ngOnInit(): void {
    if (typeof window !== 'undefined' && window.innerWidth <= 720) this.filtersOpen.set(false);
    this.reload();
  }

  statusView(status: number | string) {
    return firmAssignmentStatusView(status);
  }

  isActive(status: number | string): boolean {
    return isActiveAssignment(status);
  }

  isPending(status: number | string): boolean {
    return isPendingAssignment(status);
  }

  isRejected(status: number | string): boolean {
    return isRejectedAssignment(status);
  }

  practiceLabels(codes: string[] | undefined): string {
    return (codes ?? []).map(code => firmCodeLabel(PRACTICE_AREA_OPTIONS, code)).join(', ');
  }

  hasActiveFilters(): boolean {
    return !!(this.searchText.trim() || this.governorate || this.practiceArea || this.language || this.clientSegment || this.remoteOnly);
  }

  canLoadMore(): boolean {
    return this.firms().length < this.totalCount();
  }

  selectFirm(firm: AccountingFirmDirectoryItem): void {
    this.selectedFirm = this.selectedFirm?.firmTenantId === firm.firmTenantId ? null : firm;
  }

  onFilterChange(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.loadDirectory(true), 300);
  }

  resetFilters(): void {
    this.searchText = '';
    this.governorate = '';
    this.practiceArea = '';
    this.language = '';
    this.clientSegment = '';
    this.remoteOnly = false;
    this.governoratePrefilled = true;
    this.loadDirectory(true);
  }

  loadMore(): void {
    this.loadDirectory(false);
  }

  loadDirectory(reset: boolean): void {
    const nextPage = reset ? 1 : this.page() + 1;
    this.directoryLoading.set(true);
    this.directoryError.set(false);
    this.assignments.searchDirectory({
      search: this.searchText.trim() || undefined,
      governorate: this.governorate || undefined,
      practiceArea: this.practiceArea || undefined,
      language: this.language || undefined,
      clientSegment: this.clientSegment || undefined,
      remote: this.remoteOnly || undefined,
      page: nextPage,
      pageSize: this.pageSize
    }).subscribe({
      next: page => {
        this.directoryLoading.set(false);
        if (!page.success) {
          this.directoryError.set(true);
          return;
        }
        if (!this.governoratePrefilled && page.companyGovernorate && !this.governorate) {
          this.governoratePrefilled = true;
          this.governorate = page.companyGovernorate;
          this.loadDirectory(true);
          return;
        }
        this.governoratePrefilled = true;
        this.page.set(page.page);
        this.totalCount.set(page.totalCount);
        this.firms.set(reset ? page.items : [...this.firms(), ...page.items]);
        if (this.selectedFirm && !this.firms().some(f => f.firmTenantId === this.selectedFirm?.firmTenantId)) {
          this.selectedFirm = null;
        }
      },
      error: () => {
        this.directoryLoading.set(false);
        this.directoryError.set(true);
        if (reset) this.firms.set([]);
      }
    });
  }

  confirmAndSubmit(): void {
    const firm = this.selectedFirm;
    if (!firm) return;
    this.confirmation.confirm({
      header: $localize`:@@settings.accounting-firm-settings.ts.envoyer.la.demande.345e1b6d:Envoyer la demande`,
      message: $localize`:@@settings.accounting-firm-settings.ts.confirmez.vous.l.envoi.d.une.demande.de.85d90471:Confirmez-vous l'envoi d'une demande de liaison au cabinet « ${firm.displayName}:displayName: » ?`,
      icon: 'pi pi-send',
      acceptLabel: $localize`:@@accounting-firm-settings.component.acceptLabel.Envoyer:Envoyer`,
      rejectLabel: $localize`:@@accounting-firm-settings.component.rejectLabel.Annuler:Annuler`,
      acceptButtonStyleClass: 'btn-primary',
      accept: () => this.submit(firm)
    });
  }

  private submit(firm: AccountingFirmDirectoryItem): void {
    this.acting.set(true);
    const notes = this.notes.trim() || undefined;
    this.assignments.requestAssignment(firm.firmTenantId, notes).subscribe({
      next: r => {
        this.acting.set(false);
        if (r.success) {
          this.toast.add({ severity: 'success', summary: $localize`:@@accounting-firm-settings.component.summary.Demande_envoy_e:Demande envoyée`, detail: $localize`:@@settings.accounting-firm-settings.ts.votre.demande.a.ete.transmise.a.displayn.594ac70f:Votre demande a été transmise à ${firm.displayName}:displayName:.` });
          this.selectedFirm = null;
          this.notes = '';
          this.current.set(r.data);
        } else {
          this.toast.add({ severity: 'error', summary: $localize`:@@accounting-firm-settings.component.summary.Envoi_impossible:Envoi impossible`, detail: r.message ?? $localize`:@@ui.tern.une.erreur.est.survenue.9a1331:Une erreur est survenue.` });
        }
      },
      error: err => {
        this.acting.set(false);
        this.toast.add({ severity: 'error', summary: $localize`:@@accounting-firm-settings.component.summary.Envoi_impossible:Envoi impossible`, detail: this.errorText(err) });
      }
    });
  }

  cancelPending(): void {
    this.confirmation.confirm({
      header: $localize`:@@settings.accounting-firm-settings.ts.annuler.la.demande.dafe7e62:Annuler la demande`,
      message: $localize`:@@settings.accounting-firm-settings.ts.voulez.vous.vraiment.annuler.votre.deman.7165d248:Voulez-vous vraiment annuler votre demande en attente ? Le cabinet en sera informé.`,
      icon: 'pi pi-ban',
      acceptLabel: $localize`:@@accounting-firm-settings.component.acceptLabel.Annuler_la_deman:Annuler la demande`,
      rejectLabel: $localize`:@@accounting-firm-settings.component.rejectLabel.Retour:Retour`,
      acceptButtonStyleClass: 'btn-danger',
      accept: () => {
        this.acting.set(true);
        this.assignments.cancelPendingRequest().subscribe({
          next: r => {
            this.acting.set(false);
            if (r.success) {
              this.toast.add({ severity: 'success', summary: $localize`:@@accounting-firm-settings.component.summary.Demande_annul_e:Demande annulée` });
              this.reload();
            } else {
              this.toast.add({ severity: 'error', summary: $localize`:@@accounting-firm-settings.component.summary.Annulation_impos:Annulation impossible`, detail: r.message ?? $localize`:@@ui.tern.une.erreur.est.survenue.9a1331:Une erreur est survenue.` });
            }
          },
          error: err => {
            this.acting.set(false);
            this.toast.add({ severity: 'error', summary: $localize`:@@accounting-firm-settings.component.summary.Annulation_impos:Annulation impossible`, detail: this.errorText(err) });
          }
        });
      }
    });
  }

  revoke(): void {
    this.confirmation.confirm({
      header: $localize`:@@settings.accounting-firm-settings.ts.revoquer.l.affectation.0dbc1d1c:Révoquer l'affectation`,
      message: $localize`:@@settings.accounting-firm-settings.ts.voulez.vous.vraiment.revoquer.la.liaison.a4a5b8c5:Voulez-vous vraiment révoquer la liaison avec ce cabinet ? Il perdra l'accès à votre comptabilité.`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: $localize`:@@accounting-firm-settings.component.acceptLabel.Révoquer:Révoquer`,
      rejectLabel: $localize`:@@accounting-firm-settings.component.rejectLabel.Annuler:Annuler`,
      acceptButtonStyleClass: 'btn-danger',
      accept: () => {
        this.acting.set(true);
        this.assignments.revokeByCompany().subscribe({
          next: r => {
            this.acting.set(false);
            if (r.success) {
              this.toast.add({ severity: 'success', summary: $localize`:@@accounting-firm-settings.component.summary.Affectation_r_vo:Affectation révoquée` });
              this.reload();
            } else {
              this.toast.add({ severity: 'error', summary: $localize`:@@accounting-firm-settings.component.summary.R_vocation_impos:Révocation impossible`, detail: r.message ?? $localize`:@@ui.tern.une.erreur.est.survenue.9a1331:Une erreur est survenue.` });
            }
          },
          error: err => {
            this.acting.set(false);
            this.toast.add({ severity: 'error', summary: $localize`:@@accounting-firm-settings.component.summary.R_vocation_impos:Révocation impossible`, detail: this.errorText(err) });
          }
        });
      }
    });
  }

  private reload(): void {
    this.loading.set(true);
    this.assignments.getCompanyCurrent().subscribe({
      next: r => {
        this.current.set(r.success ? r.data : null);
        this.loadHistory();
      },
      error: () => {
        this.current.set(null);
        this.loadHistory();
      }
    });
  }

  private loadHistory(): void {
    this.assignments.getCompanyHistory().subscribe({
      next: r => {
        this.history.set(r.success ? r.data : []);
        this.loading.set(false);
        if (!this.current()) this.loadDirectory(true);
      },
      error: () => {
        this.history.set([]);
        this.loading.set(false);
        if (!this.current()) this.loadDirectory(true);
      }
    });
  }

  private errorText(err: unknown): string {
    const msg = (err as { error?: { message?: string } })?.error?.message;
    return msg ?? $localize`:@@ui.tern.une.erreur.est.survenue.veuillez.reessayer.51f64e:Une erreur est survenue. Veuillez réessayer.`;
  }
}
