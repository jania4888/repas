import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { DepreciationRunResultDto, FixedAssetsService } from '../services/fixed-assets.service';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import { AccountingCorrectionBannerComponent } from '../shared/accounting-correction-banner.component';
import {
  FixedAssetSettingsForm,
  defaultFiscalYearSettings,
  normalizeFiscalYearSettings
} from '../services/fixed-asset-settings-defaults';
import {
  FiscalYearOption,
  buildFiscalYearOptions,
  fiscalYearKey
} from '../services/fiscal-year.util';
import { AccountingAmountPipe } from '../shared/accounting-amount.pipe';

@Component({
  selector: 'app-depreciation-run',
  standalone: true,
  imports: [AccountingAmountPipe, 
    CommonModule,
    FormsModule,
    RouterModule,
    PageHeaderComponent,
    ButtonComponent,
    AccountingStatusBannerComponent,
    AccountingCorrectionBannerComponent
  ],
  template: `
    <app-page-header
      title="Dotations immobilisations" i18n-title="@@accounting.fixed-assets.dotations.immobilisations.a4c57aa0"
      subtitle="Comptabiliser les amortissements de l'exercice (écritures 681 / 281 — journal JIM)" i18n-subtitle="@@accounting.fixed-assets.comptabiliser.les.amortissements.de.l.ex.0b28d56d" />

    <app-accounting-correction-banner />

    <div class="card">
      <p class="hint" i18n="@@accounting.fixed-assets.le.tableau.d.amortissement.est.genere.automatiqu.e3b052ae"> Le tableau d'amortissement est généré automatiquement à la mise en service de chaque actif.
        Si une dotation attendue n'apparaît pas, ouvrez la fiche de l'actif et générez son tableau. </p>
      <app-accounting-status-banner
        *ngIf="isOffset()"
        title="Exercice décalé" i18n-title="@@accounting.fixed-assets.exercice.decale.e52f5dfd"
        [message]="offsetHint"
        variant="warning" />
      <label>
        <ng-container i18n="@@accounting.fixed-assets.exercice.fiscal.25ea5f92"> Exercice fiscal </ng-container>
        <select class="accounting-filter-input" [(ngModel)]="fiscalYear" [disabled]="loading()">
          <option *ngFor="let opt of fiscalYearOptions()" [ngValue]="opt.key">{{ opt.label }}</option>
        </select>
        <span class="hint" *ngIf="!settingsLoaded()" i18n="@@accounting.fixed-assets.chargement.des.exercices.ade10a7b">Chargement des exercices…</span>
      </label>
      <div class="actions">
        <app-button variant="primary" type="button" (click)="run()" [disabled]="loading()" i18n="@@accounting.fixed-assets.comptabiliser.les.dotations.e264ad6f"> Comptabiliser les dotations </app-button>
        <app-button variant="outline" type="button" icon="pi-download" (click)="exportReport()" [disabled]="loading()" i18n="@@accounting.fixed-assets.export.excel.dotations.b3950169"> Export Excel dotations </app-button>
        <app-button variant="secondary" type="button" routerLink="/accounting/fixed-assets" i18n="@@accounting.fixed-assets.retour.au.registre.aa646cbf">Retour au registre</app-button>
        <app-button
          variant="secondary"
          type="button"
          routerLink="/accounting/fixed-assets/amortization-table"
          [queryParams]="{ refresh: 1 }" i18n="@@accounting.fixed-assets.voir.tableau.amortissements.52f1668b"> Voir tableau amortissements </app-button>
        <app-button variant="secondary" type="button" icon="pi pi-cog" routerLink="/accounting/fixed-assets/settings" i18n="@@accounting.fixed-assets.parametres.d.exercice.7fa4b6fc"> Paramètres d'exercice </app-button>
      </div>
    </div>

    <app-accounting-status-banner [message]="error() ?? ''" variant="error" *ngIf="error()" />

    <div class="card result" *ngIf="result()">
      <h3 i18n="@@accounting.fixed-assets.resultat.exercice.ff1bbdd3">Résultat — exercice {{ resultLabel() }}</h3>
      <p *ngIf="rerunMessage() as msg"><strong>{{ msg }}</strong></p>
      <ng-container *ngIf="!rerunMessage()">
        <p><strong i18n="@@accounting.fixed-assets.dotations.comptabilisees.c94eb1ab">Dotations comptabilisées :</strong> {{ result()!.postedCount }}</p>
        <p><strong i18n="@@accounting.fixed-assets.ignorees.en.erreur.ced67bdb">Ignorées / en erreur :</strong> {{ result()!.skippedCount }}</p>
        <p><strong i18n="@@accounting.fixed-assets.total.dotations.91dee0b7">Total dotations :</strong> {{ result()!.totalDepreciationAmount | accountingAmount }}</p>
        <ul *ngIf="result()!.errors?.length">
          <li *ngFor="let e of result()!.errors">{{ e }}</li>
        </ul>
      </ng-container>
    </div>
  `,
  styles: [
    `
      label {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        max-width: 240px;
      }
      .hint {
        font-size: 0.8rem;
        color: #64748b;
        margin: 0 0 0.75rem;
      }
      .actions {
        display: flex;
        gap: 0.75rem;
        margin-top: 1rem;
        flex-wrap: wrap;
      }
      .result p {
        margin: 0.35rem 0;
      }
    `
  ]
})
export class DepreciationRunComponent implements OnInit {
  private readonly api = inject(FixedAssetsService);
  private readonly route = inject(ActivatedRoute);

  /** Clé d'exercice sélectionnée (année de début) — envoyée au backend via le run. */
  fiscalYear = new Date().getFullYear();

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly result = signal<DepreciationRunResultDto | null>(null);

  /** Paramètres d'exercice chargés depuis le tenant (repli civil tant que non chargés). */
  readonly settings = signal<FixedAssetSettingsForm>(defaultFiscalYearSettings());
  readonly settingsLoaded = signal(false);

  /** Vrai si l'exercice du dossier est décalé (mois de début ≠ janvier). */
  readonly isOffset = computed(() => this.settings().fiscalYearStartMonth !== 1);

  readonly offsetHint =
    $localize`:@@accounting.depreciation-run.ts.le.dossier.est.en.exercice.decale.les.do.9e94cb87:Le dossier est en exercice décalé : les dotations sont rattachées à l'exercice sélectionné ` +
    $localize`:@@accounting.depreciation-run.ts.cle.annee.de.debut.le.grand.livre.reste.84dd6e0c:(clé = année de début). Le Grand-Livre reste en année civile (limitation transitoire).`;

  /** Liste des exercices proposés au sélecteur (calculée côté client depuis le paramétrage). */
  readonly fiscalYearOptions = computed<FiscalYearOption[]>(() => {
    const { fiscalYearStartMonth, fiscalYearLabelFormat } = this.settings();
    const currentKey = fiscalYearKey(new Date(), fiscalYearStartMonth);
    return buildFiscalYearOptions(currentKey, fiscalYearStartMonth, fiscalYearLabelFormat);
  });

  /** Libellé d'exercice du résultat : privilégie `fiscalYearLabel` (P3), repli sur la clé. */
  readonly resultLabel = computed(() => {
    const r = this.result();
    if (!r) return '';
    return r.fiscalYearLabel || String(r.fiscalYear);
  });

  // T14 (re-run) — quand aucune nouvelle dotation n'est comptabilisée mais que des dotations
  // étaient déjà postées pour cet exercice, on affiche un message explicite au lieu du « 0 »
  // cryptique (capture 2410).
  readonly rerunMessage = computed(() => {
    const r = this.result();
    if (!r) return null;
    const alreadyPosted = r.alreadyPostedCount ?? 0;
    if (r.postedCount === 0 && alreadyPosted > 0) {
      return `Aucune nouvelle dotation — ${alreadyPosted} dotation(s) déjà comptabilisée(s) pour cet exercice.`;
    }
    return null;
  });

  ngOnInit(): void {
    // Un queryParam `fiscalYear` explicite (clé d'exercice) surclasse la sélection par défaut.
    const fy = this.route.snapshot.queryParamMap.get('fiscalYear');
    let queryOverride: number | null = null;
    if (fy) {
      const year = Number(fy);
      if (!Number.isNaN(year)) {
        this.fiscalYear = year;
        queryOverride = year;
      }
    }
    this.loadSettings(queryOverride);
  }

  private loadSettings(queryOverride: number | null): void {
    this.api.getSettings().subscribe({
      next: res => {
        this.settings.set(normalizeFiscalYearSettings(res.data));
        this.settingsLoaded.set(true);
        // Sans surcharge queryParam, on sélectionne l'exercice courant du dossier.
        if (queryOverride === null) {
          this.fiscalYear = fiscalYearKey(new Date(), this.settings().fiscalYearStartMonth);
        }
      },
      error: () => {
        // Repli civil : options en année civile, sélection = année civile courante.
        this.settings.set(defaultFiscalYearSettings());
        this.settingsLoaded.set(true);
        if (queryOverride === null) {
          this.fiscalYear = new Date().getFullYear();
        }
      }
    });
  }

  run(): void {
    // C7 — garde anti double-clic : en plus du [disabled] du bouton, on court-circuite tout appel
    // tant qu'un run est déjà en cours (une race entre deux clics peut contourner le disabled).
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set(null);
    this.result.set(null);
    this.api.postDepreciationRun(this.fiscalYear).subscribe({
      next: res => {
        this.result.set(res.data ?? null);
        this.loading.set(false);
      },
      error: err => {
        this.error.set(err?.error?.message ?? $localize`:@@ui.tern.erreur.lors.de.la.comptabilisation.des.dot.fc608d:Erreur lors de la comptabilisation des dotations.`);
        this.loading.set(false);
      }
    });
  }

  exportReport(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.exportDepreciationReportExcel(this.fiscalYear).subscribe({
      next: blob => {
        this.loading.set(false);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `dotations-immobilisations-${this.fiscalYear}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: err => {
        this.loading.set(false);
        this.error.set(err?.error?.message ?? $localize`:@@ui.tern.erreur.export.excel.dd1ee1:Erreur export Excel.`);
      }
    });
  }
}
