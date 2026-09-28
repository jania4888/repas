/// <reference types="@angular/localize" />
import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { TableModule } from 'primeng/table';
import { TooltipModule } from 'primeng/tooltip';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import { AccountingFilterBarComponent } from '../shared/accounting-filter-bar.component';
import { AccountingTableActionsComponent } from '../shared/accounting-table-actions.component';
import { AccountingService, ThirdPartyDirectoryRowDto } from '../services/accounting.service';

interface ThirdPartyProfileForm {
  kind: number;
  thirdPartyId: string;
  thirdPartyName: string;
  auxiliaryCode: string;
  collectiveAccountNumber: string;
  paymentTermDays: number | null;
  accountingNotes: string;
}

/**
 * Plan tiers unifié (façon Sage Structure → Plan tiers) : répertoire clients + fournisseurs
 * avec code auxiliaire, compte collectif, délai de règlement et soldes courants ; fiche
 * comptable éditable en ligne et génération des codes manquants (C0001…/F0001…).
 */
@Component({
  selector: 'app-third-parties',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    TableModule,
    TooltipModule,
    PageHeaderComponent,
    ButtonComponent,
    AccountingStatusBannerComponent,
    AccountingFilterBarComponent,
    AccountingTableActionsComponent
  ],
  template: `
    <app-page-header title="Plan tiers" i18n-title="@@accounting.third-parties.plan.tiers.7dfd7c9a" subtitle="Répertoire comptable des clients et fournisseurs — codes auxiliaires, comptes collectifs et soldes" i18n-subtitle="@@accounting.third-parties.repertoire.comptable.des.clients.et.four.dc055763" />

    <div class="card accounting-filters-card">
      <app-accounting-filter-bar ariaLabel="Recherche et filtres du plan tiers" i18n-ariaLabel="@@accounting.third-parties.recherche.et.filtres.du.plan.tiers.e168a853">
        <div accountingFilterFields class="tp-toolbar-fields">
          <div class="accounting-filter-field tp-grow">
            <label class="accounting-filter-label" for="tp-search" i18n="@@accounting.third-parties.recherche.787b5492">Recherche</label>
            <input id="tp-search" [(ngModel)]="search" (keyup.enter)="load()" class="accounting-filter-input"
              placeholder="Nom, e-mail ou code auxiliaire…" i18n-placeholder="@@accounting.third-parties.nom.e.mail.ou.code.auxiliaire.76d3dcd5" />
          </div>
          <div class="accounting-filter-field">
            <label class="accounting-filter-label" for="tp-kind" i18n="@@accounting.third-parties.type.3deb7456">Type</label>
            <select id="tp-kind" [(ngModel)]="kind" class="accounting-filter-input">
              <option [ngValue]="null" i18n="@@accounting.third-parties.tous.b97ae3b4">Tous</option>
              <option [ngValue]="1" i18n="@@accounting.third-parties.clients.28e22fe3">Clients</option>
              <option [ngValue]="2" i18n="@@accounting.third-parties.fournisseurs.06b6d88c">Fournisseurs</option>
            </select>
          </div>
          <div class="accounting-filter-field">
            <label class="accounting-filter-label" for="tp-inactive" i18n="@@accounting.third-parties.inactifs.41c2d03e">Inactifs</label>
            <label class="tp-check">
              <input id="tp-inactive" type="checkbox" [(ngModel)]="includeInactive" />
              <span i18n="@@accounting.third-parties.inclure.eca2de59">Inclure</span>
            </label>
          </div>
        </div>
        <div accountingFilterActions>
          <app-button variant="secondary" icon="pi pi-refresh" iconPos="left" type="button"
            (click)="load()" [disabled]="loading()" ariaLabel="Actualiser le plan tiers" i18n-ariaLabel="@@accounting.third-parties.actualiser.le.plan.tiers.cc448655" i18n="@@accounting.third-parties.actualiser.9d3b2a7d"> Actualiser </app-button>
          <app-button variant="primary" icon="pi pi-hashtag" iconPos="left" type="button"
            (click)="generateCodes()" [disabled]="loading() || generating()"
            ariaLabel="Générer les codes auxiliaires manquants" i18n-ariaLabel="@@accounting.third-parties.generer.les.codes.auxiliaires.manquants.799ec878">
            {{ generating() ? loc_ui_tern_generation_ce4e34 : loc_ui_tern_generer_les_codes_manquants_078786 }}
          </app-button>
        </div>
      </app-accounting-filter-bar>
    </div>

    <app-accounting-status-banner variant="error" [message]="error() ?? ''"
      [showRetry]="!!error()" retryLabel="Réessayer" i18n-retryLabel="@@accounting.third-parties.reessayer.c4f78b12" (retry)="load()" />

    @if (form(); as f) {
      <div class="card tp-form">
        <h3 class="tp-form-title" i18n="@@accounting.third-parties.fiche.comptable.0b3e1a8b">
          Fiche comptable — {{ f.thirdPartyName }}
          <span class="tp-badge" [class.tp-badge-client]="f.kind === 1" [class.tp-badge-supplier]="f.kind === 2">
            {{ f.kind === 1 ? loc_ui_tern_client_1bdd79 : loc_ui_tern_fournisseur_97d91d }}
          </span>
        </h3>
        <div class="tp-fields">
          <div class="tp-field">
            <label class="tp-lbl" for="tp-f-code" i18n="@@accounting.third-parties.code.auxiliaire.44949067">Code auxiliaire</label>
            <input id="tp-f-code" class="tp-inp tp-mono" [(ngModel)]="f.auxiliaryCode" maxlength="20"
              placeholder="Ex. {{ f.kind === 1 ? 'C0001' : 'F0001' }}" />
          </div>
          <div class="tp-field">
            <label class="tp-lbl" for="tp-f-coll" i18n="@@accounting.third-parties.compte.collectif.f1c7e97c">Compte collectif</label>
            <input id="tp-f-coll" class="tp-inp tp-mono" [(ngModel)]="f.collectiveAccountNumber" maxlength="20"
              placeholder="Ex. {{ f.kind === 1 ? '4111' : '4011' }}" />
          </div>
          <div class="tp-field">
            <label class="tp-lbl" for="tp-f-term" i18n="@@accounting.third-parties.delai.de.reglement.j.db50115b">Délai de règlement (j)</label>
            <input id="tp-f-term" type="number" class="tp-inp tp-narrow" [(ngModel)]="f.paymentTermDays" min="0" max="365" />
          </div>
          <div class="tp-field tp-grow">
            <label class="tp-lbl" for="tp-f-notes" i18n="@@accounting.third-parties.notes.comptables.6ed06924">Notes comptables</label>
            <input id="tp-f-notes" class="tp-inp" [(ngModel)]="f.accountingNotes" maxlength="500"
              placeholder="Observations internes (facultatif)" i18n-placeholder="@@accounting.third-parties.observations.internes.facultatif.96766768" />
          </div>
          <div class="tp-form-actions">
            <button type="button" class="btn btn-secondary" (click)="form.set(null)" [disabled]="saving()" i18n="@@accounting.third-parties.annuler.49ba3292">Annuler</button>
            <button type="button" class="btn btn-primary" (click)="save()"
              [disabled]="saving() || !f.auxiliaryCode.trim() || !f.collectiveAccountNumber.trim()">
              {{ saving() ? loc_ui_tern_enregistrement_e7d5f2 : loc_ui_tern_enregistrer_f7c8bc }}
            </button>
          </div>
        </div>
        <p class="tp-help" i18n="@@accounting.third-parties.le.code.auxiliaire.lettres.chiffres.tirets.20.ma.76cdfee3">Le code auxiliaire (lettres, chiffres, tirets — 20 max) est unique et alimente la colonne CompAuxNum du FEC. Le compte collectif est numérique (4111 clients / 4011 fournisseurs par défaut).</p>
      </div>
    }

    <p-table [value]="rows()" [paginator]="true" [rows]="25" [rowsPerPageOptions]="[25, 50, 100]"
      [loading]="loading()" [rowHover]="true" [scrollable]="true" scrollHeight="flex"
      styleClass="p-datatable-sm accounting-datatable tp-table"
      [showCurrentPageReport]="true" currentPageReportTemplate="Affichage de {first} à {last} sur {totalRecords} tiers" i18n-currentPageReportTemplate="@@accounting.third-parties.affichage.de.first.a.last.sur.totalrecords.tiers.05aff86a">
      <ng-template pTemplate="header">
        <tr>
          <th scope="col" i18n="@@accounting.third-parties.code.aux.2d39a431">Code aux.</th>
          <th scope="col" i18n="@@accounting.third-parties.nom.7ff20370">Nom</th>
          <th scope="col" i18n="@@accounting.third-parties.type.3deb7456">Type</th>
          <th scope="col" pTooltip="Compte collectif de rattachement" i18n-pTooltip="@@accounting.third-parties.compte.collectif.de.rattachement.afee6ebb" tooltipPosition="top" i18n="@@accounting.third-parties.collectif.ba912701">Collectif</th>
          <th scope="col" class="text-right" pTooltip="Délai de règlement (jours)" i18n-pTooltip="@@accounting.third-parties.delai.de.reglement.jours.a445720b" tooltipPosition="top" i18n="@@accounting.third-parties.delai.be9a9403">Délai</th>
          <th scope="col" class="text-right" i18n="@@accounting.third-parties.solde.d.3f441081">Solde D</th>
          <th scope="col" class="text-right" i18n="@@accounting.third-parties.solde.c.81de0678">Solde C</th>
          <th scope="col" i18n="@@accounting.third-parties.actif.2eb75f84">Actif</th>
          <th scope="col" i18n="@@accounting.third-parties.actions.c3cd636a">Actions</th>
        </tr>
      </ng-template>
      <ng-template pTemplate="body" let-r>
        <tr [class.tp-inactive]="!r.isActive">
          <td class="tp-mono" data-label="Code aux." i18n-data-label="@@accounting.third-parties.code.aux.2d39a431">{{ r.auxiliaryCode || '—' }}</td>
          <td data-label="Nom" i18n-data-label="@@accounting.third-parties.nom.7ff20370">{{ r.name }}</td>
          <td data-label="Type" i18n-data-label="@@accounting.third-parties.type.3deb7456">
            <span class="tp-badge" [class.tp-badge-client]="r.kind === 1" [class.tp-badge-supplier]="r.kind === 2">
              {{ r.kind === 1 ? loc_ui_tern_client_1bdd79 : loc_ui_tern_fournisseur_97d91d }}
            </span>
          </td>
          <td class="tp-mono" data-label="Collectif" i18n-data-label="@@accounting.third-parties.collectif.ba912701">{{ r.collectiveAccountNumber }}</td>
          <td class="text-right" data-label="Délai" i18n-data-label="@@accounting.third-parties.delai.be9a9403">{{ r.paymentTermDays != null ? r.paymentTermDays + ' j' : '—' }}</td>
          <td class="text-right tp-num" data-label="Solde D" i18n-data-label="@@accounting.third-parties.solde.d.3f441081">{{ r.balanceDebit | number : '1.3-3' }}</td>
          <td class="text-right tp-num" data-label="Solde C" i18n-data-label="@@accounting.third-parties.solde.c.81de0678">{{ r.balanceCredit | number : '1.3-3' }}</td>
          <td data-label="Actif" i18n-data-label="@@accounting.third-parties.actif.2eb75f84">{{ r.isActive ? loc_ui_tern_oui_eaa02f : loc_ui_tern_non_a72199 }}</td>
          <td data-label="Actions" i18n-data-label="@@accounting.third-parties.actions.c3cd636a" class="tp-actions">
            <app-accounting-table-actions>
            <app-button variant="ghost" size="sm" icon="pi-book" [iconOnly]="true" [iconAlwaysVisible]="true"
              [routerLink]="['/accounting/third-party-ledger']"
              [queryParams]="{ thirdPartyId: r.thirdPartyId, kind: r.kind, name: r.name }"
              pTooltip="Grand livre du tiers" i18n-pTooltip="@@accounting.third-parties.grand.livre.du.tiers.7f18aec1" tooltipPosition="top" ariaLabel="Grand livre du tiers" i18n-ariaLabel="@@accounting.third-parties.grand.livre.du.tiers.e144479a" />
            <app-button variant="ghost" size="sm" icon="pi-link" [iconOnly]="true" [iconAlwaysVisible]="true"
              [routerLink]="['/accounting/lettering']"
              pTooltip="Lettrage" i18n-pTooltip="@@accounting.third-parties.lettrage.cfcdd333" tooltipPosition="top" ariaLabel="Lettrage" i18n-ariaLabel="@@accounting.third-parties.lettrage.436ae14b" />
            <app-button variant="ghost" size="sm" icon="pi-pencil" [iconOnly]="true" [iconAlwaysVisible]="true"
              type="button" (click)="startEdit(r)"
              pTooltip="Fiche comptable" i18n-pTooltip="@@accounting.third-parties.fiche.comptable.825252a3" tooltipPosition="top" ariaLabel="Modifier la fiche comptable" i18n-ariaLabel="@@accounting.third-parties.modifier.la.fiche.comptable.4653831b" />
            </app-accounting-table-actions>
          </td>
        </tr>
      </ng-template>
      <ng-template pTemplate="emptymessage">
        <tr><td colspan="9" class="tp-empty" i18n="@@accounting.third-parties.aucun.tiers.ne.correspond.aux.filtres.66ad4318">Aucun tiers ne correspond aux filtres.</td></tr>
      </ng-template>
    </p-table>
  `,
  styles: `
    @use '../shared/accounting-layout';
    .tp-toolbar-fields { display:flex; flex-wrap:wrap; align-items:flex-end; gap:var(--spacing-4); }
    .tp-grow { flex:1 1 14rem; }
    .tp-check { display:flex; align-items:center; gap:var(--spacing-2); padding:var(--spacing-2) 0; font-size:var(--font-size-sm); color:var(--color-text-primary); cursor:pointer; }
    .tp-form { padding:var(--spacing-4); border-radius:var(--radius-lg); box-shadow:var(--shadow-sm); margin-bottom:var(--spacing-4); }
    .tp-form-title { margin:0 0 var(--spacing-3); font-size:var(--font-size-md); font-weight:var(--font-weight-semibold); display:flex; align-items:center; gap:var(--spacing-2); }
    .tp-fields { display:flex; flex-wrap:wrap; gap:var(--spacing-3); align-items:flex-end; }
    .tp-field { display:flex; flex-direction:column; gap:var(--spacing-1); min-width:8rem; }
    .tp-narrow { max-width:7rem; }
    .tp-lbl { font-size:var(--font-size-sm); font-weight:var(--font-weight-semibold); color:var(--color-text-primary); }
    .tp-inp { padding:var(--spacing-2) var(--spacing-3); border:1px solid var(--color-border-default); border-radius:var(--radius-md); background:var(--color-background-elevated); color:var(--color-text-primary); font-size:var(--font-size-sm); width:100%; }
    .tp-form-actions { display:flex; gap:var(--spacing-2); margin-inline-start:auto; }
    .tp-help { margin:var(--spacing-3) 0 0; font-size:var(--font-size-sm); color:var(--color-text-secondary); }
    .tp-mono { font-family:ui-monospace, monospace; }
    .tp-num { font-variant-numeric:tabular-nums; }
    .tp-inactive { opacity:0.6; }
    .tp-badge { display:inline-block; padding:0.15rem 0.55rem; border-radius:var(--radius-pill, 999px); font-size:var(--font-size-xs); font-weight:var(--font-weight-semibold); }
    .tp-badge-client { background:var(--color-primary-50, #eff6ff); color:var(--color-primary-700, #1d4ed8); border:1px solid var(--color-primary-200, #bfdbfe); }
    .tp-badge-supplier { background:var(--color-warning-50, #fffbeb); color:var(--color-warning-700, #a16207); border:1px solid var(--color-warning-200, #fde68a); }
    .tp-actions { white-space:nowrap; }
    .tp-empty { text-align:center; padding:var(--spacing-6); color:var(--color-text-tertiary); }
    .text-right { text-align:end; }
    .btn { padding:var(--spacing-2) var(--spacing-4); border-radius:var(--radius-md); font-size:var(--font-size-sm); font-weight:var(--font-weight-semibold); cursor:pointer; border:1px solid transparent; }
    .btn-secondary { background:var(--color-background-subtle); color:var(--color-text-primary); border-color:var(--color-border-default); }
    .btn-primary { background:var(--color-primary-500, #2563eb); color:#fff; }
    .btn:disabled { opacity:0.6; cursor:not-allowed; }
    :host ::ng-deep .tp-table.p-datatable .p-datatable-table { min-width:64rem; }
  `
})
export class ThirdPartiesComponent implements OnInit {
  readonly loc_ui_tern_generation_ce4e34 = $localize`:@@ui.tern.generation.ce4e34:Génération…`;
  readonly loc_ui_tern_generer_les_codes_manquants_078786 = $localize`:@@ui.tern.generer.les.codes.manquants.078786:Générer les codes manquants`;
  readonly loc_ui_tern_client_1bdd79 = $localize`:@@ui.tern.client.1bdd79:Client`;
  readonly loc_ui_tern_fournisseur_97d91d = $localize`:@@ui.tern.fournisseur.97d91d:Fournisseur`;
  readonly loc_ui_tern_enregistrement_e7d5f2 = $localize`:@@ui.tern.enregistrement.e7d5f2:Enregistrement…`;
  readonly loc_ui_tern_enregistrer_f7c8bc = $localize`:@@ui.tern.enregistrer.f7c8bc:Enregistrer`;
  readonly loc_ui_tern_oui_eaa02f = $localize`:@@ui.tern.oui.eaa02f:Oui`;
  readonly loc_ui_tern_non_a72199 = $localize`:@@ui.tern.non.a72199:Non`;
  private readonly api = inject(AccountingService);
  private readonly toast = inject(ToastService);
  private readonly errorHandler = inject(ErrorHandlerService);

  search = '';
  kind: number | null = null;
  includeInactive = false;
  readonly rows = signal<ThirdPartyDirectoryRowDto[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly generating = signal(false);
  readonly error = signal<string | null>(null);
  readonly form = signal<ThirdPartyProfileForm | null>(null);

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    // Volumes tiers faibles : une page large côté serveur, pagination visuelle côté client.
    this.api.getThirdPartyDirectory({
      kind: this.kind, search: this.search, includeInactive: this.includeInactive, page: 1, pageSize: 500
    }).subscribe({
      next: res => {
        this.loading.set(false);
        if (res.success && res.data) this.rows.set(res.data.items);
        else this.error.set(res.error ?? $localize`:@@ui.tern.erreur.de.chargement.du.plan.tiers.7d7ed6:Erreur de chargement du plan tiers.`);
      },
      error: err => { this.loading.set(false); this.error.set(this.errorHandler.extractErrorMessage(err)); }
    });
  }

  generateCodes(): void {
    if (this.generating()) return;
    this.generating.set(true);
    this.api.ensureAuxiliaryCodes().subscribe({
      next: res => {
        this.generating.set(false);
        if (res.success) {
          const n = res.data ?? 0;
          this.toast.add({
            severity: 'success', summary: $localize`:@@third-parties.component.summary.Codes auxili:Codes auxiliaires`,
            detail: n > 0 ? $localize`:@@ui.tern.ph.code.s.genere.s.fd9598:${n}:p0: code(s) généré(s).` : $localize`:@@ui.tern.tous.les.tiers.actifs.ont.deja.un.code.614d52:Tous les tiers actifs ont déjà un code.`, life: 4000
          });
          if (n > 0) this.load();
        } else {
          this.error.set(res.error ?? $localize`:@@ui.tern.erreur.lors.de.la.generation.des.codes.130fa4:Erreur lors de la génération des codes.`);
        }
      },
      error: err => { this.generating.set(false); this.error.set(this.errorHandler.extractErrorMessage(err)); }
    });
  }

  startEdit(r: ThirdPartyDirectoryRowDto): void {
    this.error.set(null);
    this.api.getThirdPartyProfile(r.kind, r.thirdPartyId).subscribe({
      next: res => {
        if (res.success && res.data) {
          const p = res.data;
          this.form.set({
            kind: p.kind,
            thirdPartyId: p.thirdPartyId,
            thirdPartyName: p.thirdPartyName,
            auxiliaryCode: p.auxiliaryCode ?? '',
            collectiveAccountNumber: p.collectiveAccountNumber,
            paymentTermDays: p.paymentTermDays ?? null,
            accountingNotes: p.accountingNotes ?? ''
          });
        } else {
          this.error.set(res.error ?? $localize`:@@ui.tern.erreur.de.chargement.de.la.fiche.69a06f:Erreur de chargement de la fiche.`);
        }
      },
      error: err => this.error.set(this.errorHandler.extractErrorMessage(err))
    });
  }

  save(): void {
    const f = this.form();
    if (!f || this.saving()) return;
    this.saving.set(true);
    this.api.upsertThirdPartyProfile(f.kind, f.thirdPartyId, {
      auxiliaryCode: f.auxiliaryCode.trim().toUpperCase(),
      collectiveAccountNumber: f.collectiveAccountNumber.trim(),
      paymentTermDays: f.paymentTermDays,
      accountingNotes: f.accountingNotes.trim() || null
    }).subscribe({
      next: res => {
        this.saving.set(false);
        if (res.success) {
          this.toast.add({ severity: 'success', summary: $localize`:@@third-parties.component.summary.Fiche_tiers_enre:Fiche tiers enregistrée`, detail: f.thirdPartyName, life: 4000 });
          this.form.set(null);
          this.load();
        } else {
          this.error.set(res.error ?? $localize`:@@ui.tern.erreur.lors.de.l.enregistrement.de.la.fich.3b6371:Erreur lors de l'enregistrement de la fiche.`);
        }
      },
      error: err => { this.saving.set(false); this.error.set(this.errorHandler.extractErrorMessage(err)); }
    });
  }
}
