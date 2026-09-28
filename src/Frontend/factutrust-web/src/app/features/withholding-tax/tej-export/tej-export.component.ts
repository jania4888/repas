import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import {
  WithholdingTaxService,
  TejSubmissionType,
  TejXmlExportLogListItem
} from '@core/services/withholding-tax.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { ConfirmationService } from '@core/services/confirmation.service';

@Component({
  selector: 'app-tej-export',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  template: `
    <div class="page-container">
      <div class="page-header">
        <div>
          <h1 i18n="@@withholding-tax.tej-export.export.tej.declaration.xml.77169891">Export TEJ — Déclaration XML</h1>
          <p class="subtitle" i18n="@@withholding-tax.tej-export.generez.le.fichier.xml.pour.preparer.la.declarat.647cd798">Générez le fichier XML pour préparer la déclaration ; la soumission officielle se fait sur le portail TEJ (connexion OIDC).</p>
        </div>
        <a routerLink="/withholding-tax/dashboard" class="btn btn-outline" i18n="@@withholding-tax.tej-export.tableau.de.bord.817f7ae6">
          <i class="fa-solid fa-arrow-left"></i> Tableau de bord
        </a>
      </div>

      <!-- Parameters -->
      <div class="card">
        <h3 i18n="@@withholding-tax.tej-export.parametres.de.la.declaration.8a091a6d">Paramètres de la déclaration</h3>
        <div class="form-grid">
          <div class="form-group">
            <label for="ex-y" i18n="@@withholding-tax.tej-export.exercice.annee.a59f2bc1">Exercice (année) *</label>
            <select id="ex-y" [(ngModel)]="exerciceYear" (ngModelChange)="onPeriodChange()">
              @for (y of years; track y) {
                <option [ngValue]="y">{{ y }}</option>
              }
            </select>
          </div>
          <div class="form-group">
            <label for="ex-m" i18n="@@withholding-tax.tej-export.mois.b5e21de4">Mois *</label>
            <select id="ex-m" [(ngModel)]="month" (ngModelChange)="onPeriodChange()">
              @for (m of months; track m.value) {
                <option [ngValue]="m.value">{{ m.label }}</option>
              }
            </select>
          </div>
          <div class="form-group">
            <label for="ex-t" i18n="@@withholding-tax.tej-export.type.de.soumission.35d5b450">Type de soumission *</label>
            <select id="ex-t" [(ngModel)]="submissionType">
              <option [ngValue]="TejSubmissionType.Initiale" i18n="@@withholding-tax.tej-export.initiale.6e2ba30f">Initiale</option>
              <option [ngValue]="TejSubmissionType.Corrective" i18n="@@withholding-tax.tej-export.corrective.6a9731be">Corrective</option>
            </select>
          </div>
        </div>

        <div class="form-actions">
          <button
            type="button"
            class="btn btn-outline"
            (click)="preview()"
            [disabled]="previewing || exportActionsBlocked"
            [attr.title]="exportActionsBlocked ? exportBlockedTitle : null">
            @if (previewing) { <i class="fa-solid fa-spinner fa-spin"></i> }
            <ng-container i18n="@@withholding-tax.tej-export.previsualiser.xml.03563d34"><i class="fa-solid fa-eye"></i> Prévisualiser XML
          </ng-container></button>
          <button
            type="button"
            class="btn btn-primary"
            (click)="generate()"
            [disabled]="generating || exportActionsBlocked"
            [attr.title]="exportActionsBlocked ? exportBlockedTitle : null">
            @if (generating) { <i class="fa-solid fa-spinner fa-spin"></i> }
            <ng-container i18n="@@withholding-tax.tej-export.generer.et.telecharger.9ecfe4a7"><i class="fa-solid fa-download"></i> Générer et télécharger
          </ng-container></button>
        </div>
      </div>

      @if (periodHintLoading) {
        <p class="muted period-hint" i18n="@@withholding-tax.tej-export.verification.des.factures.fournisseurs.eligibles.7aeb3eea">Vérification des factures fournisseurs éligibles pour cette période…</p>
      }
      @if (!periodHintLoading && periodEligibleCount === 0) {
        <div class="card card-warning" role="status">
          <h3 i18n="@@withholding-tax.tej-export.aucune.facture.fournisseur.eligible.pour.be0022a5"><i class="fa-solid fa-circle-info"></i> Aucune facture fournisseur éligible pour cette période</h3>
          <p class="hint-p" i18n="@@withholding-tax.tej-export.une.facture.n.apparait.dans.le.fichier.q.69270d77"><ng-container>Une facture n’apparaît dans le fichier que si </ng-container> <strong>toutes</strong> les conditions suivantes sont remplies :</p>
          <ul class="hint-list">
            <li i18n="@@withholding-tax.tej-export.statut.payee.soldee.8c1cd5c5"><ng-container>statut </ng-container> <strong>Payée</strong> (soldée) ;</li>
            <li i18n="@@withholding-tax.tej-export.retenue.calculee.et.enregistree.sur.la.f.d011a67c"><ng-container>retenue calculée et enregistrée sur la facture (fournisseur </ng-container> <strong>assujetti à la RS</strong>, type d’opération RS, montant &gt; 0) ;</li>
            <li i18n="@@withholding-tax.tej-export.date.de.solde.payee.le.dans.le.mois.et.l.ad9c1f09"><ng-container>date de solde (</ng-container><strong>Payée le</strong>) dans le <strong>mois et l’année</strong> sélectionnés.</li>
          </ul>
          <p class="hint-p muted-hint" i18n="@@withholding-tax.tej-export.un.montant.ttc.superieur.au.seuil.rs7.achats.ne..f60823e9">Un montant TTC supérieur au seuil RS7 (achats) ne suffit pas si le fournisseur n’est pas paramétré comme assujetti ou si la facture n’est pas encore soldée.</p>
          <a routerLink="/withholding-tax/dashboard" class="btn btn-outline btn-sm" i18n="@@withholding-tax.tej-export.tableau.de.bord.retenue.a.la.source.fa7f4511">Tableau de bord retenue à la source</a>
        </div>
      }

      @if (apiError) {
        <div class="card card-error" role="alert">
          <h3 i18n="@@withholding-tax.tej-export.action.impossible.617d5932"><i class="fa-solid fa-circle-xmark"></i> Action impossible</h3>
          <p class="hint-p">{{ apiError }}</p>
        </div>
      }

      <!-- Validation results -->
      @if (validationErrors.length) {
        <div class="card card-error">
          <h3 i18n="@@withholding-tax.tej-export.erreurs.de.validation.79ec8ae9"><i class="fa-solid fa-triangle-exclamation"></i> Erreurs de validation</h3>
          <ul>
            @for (err of validationErrors; track $index) {
              <li>{{ err }}</li>
            }
          </ul>
          <p class="help-text" i18n="@@withholding-tax.tej-export.corrigez.ces.erreurs.avant.de.soumettre.le.fichi.3b5e9b29">Corrigez ces erreurs avant de soumettre le fichier sur la plateforme TEJ.</p>
        </div>
      }

      @if (validationSuccess) {
        <div class="card card-success">
          <h3 i18n="@@withholding-tax.tej-export.validation.reussie.71d082b3"><i class="fa-solid fa-check-circle"></i> Validation réussie</h3>
          <p i18n="@@withholding-tax.tej-export.le.fichier.xml.est.pret.pour.controle.verifiez.l.631e4ea3">Le fichier XML est prêt pour contrôle ; vérifiez-le sur le portail avant envoi définitif.</p>
        </div>
      }

      <!-- XML preview -->
      @if (xmlPreview) {
        <div class="card">
          <div class="preview-header">
            <h3 i18n="@@withholding-tax.tej-export.previsualisation.xml.871ea180">Prévisualisation XML</h3>
            <button type="button" class="btn btn-outline btn-sm" (click)="copyXml()" i18n="@@withholding-tax.tej-export.copier.0246a8b8">
              <i class="fa-solid fa-copy"></i> Copier
            </button>
          </div>
          <pre class="xml-preview"><code>{{ xmlPreview }}</code></pre>
        </div>
      }

      <!-- History -->
      <div class="card">
        <h3 i18n="@@withholding-tax.tej-export.historique.des.exports.ed5f4fcf">Historique des exports</h3>
        @if (historyLoading) {
          <p class="muted" i18n="@@withholding-tax.tej-export.chargement.01cba1df">Chargement…</p>
        } @else if (exportHistory.length === 0) {
          <p class="muted" i18n="@@withholding-tax.tej-export.aucun.export.enregistre.pour.ce.tenant.0baa3e76">Aucun export enregistré pour ce tenant.</p>
        } @else {
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th i18n="@@withholding-tax.tej-export.date.eb9a4bc1">Date</th>
                  <th i18n="@@withholding-tax.tej-export.fichier.f0fa5745">Fichier</th>
                  <th i18n="@@withholding-tax.tej-export.periode.de2110b7">Période</th>
                  <th i18n="@@withholding-tax.tej-export.lignes.xml.38c04a57">Lignes XML</th>
                  <th i18n="@@withholding-tax.tej-export.valide.67175216">Valide</th>
                  <th i18n="@@withholding-tax.tej-export.empreinte.sha.256.e830bea9">Empreinte SHA-256</th>
                </tr>
              </thead>
              <tbody>
                @for (row of exportHistory; track row.id) {
                  <tr>
                    <td>{{ row.createdAt | date:'short' }}</td>
                    <td class="mono">{{ row.fileName }}</td>
                    <td>{{ row.month }}/{{ row.year }}</td>
                    <td>{{ row.certificateCount }}</td>
                    <td>{{ row.isValid ? loc_ui_tern_oui_eaa02f : loc_ui_tern_non_a72199 }}</td>
                    <td class="mono hash">{{ row.sha256Hex }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>

      <!-- Help section -->
      <div class="card help-card">
        <h3 i18n="@@withholding-tax.tej-export.portail.tej.et.securite.edf9c6c2"><i class="fa-solid fa-info-circle"></i> Portail TEJ et sécurité</h3>
        <div class="help-grid help-grid-3">
          <div>
            <h4 i18n="@@withholding-tax.tej-export.format.du.fichier.6d4c98d7">Format du fichier</h4>
            <ul>
              <li i18n="@@withholding-tax.tej-export.xml.structure.validation.interne.schema.envelopp.06dfae72">XML structuré (validation interne + schéma enveloppe embarqué ; complétez avec les XSD officiels si fournis)</li>
              <li i18n="@@withholding-tax.tej-export.montants.en.millimes.entiers.2240017b">Montants en millimes (entiers)</li>
              <li i18n="@@withholding-tax.tej-export.dates.au.format.jj.mm.aaaa.71f12c3e">Dates au format JJ/MM/AAAA</li>
              <li i18n="@@withholding-tax.tej-export.encodage.utf.8.e0abfc3a">Encodage UTF-8</li>
            </ul>
          </div>
          <div>
            <h4 i18n="@@withholding-tax.tej-export.connexion.au.portail.a1d7376f">Connexion au portail</h4>
            <p class="help-p" i18n="@@withholding-tax.tej-export.l.authentification.se.fait.via.openid.co.f8f74ae5"><ng-container>L’authentification se fait via </ng-container> <strong>OpenID Connect</strong> sur le domaine dédié (ex. <code>login-tej.finances.gov.tn</code>). InstaFact ne stocke <strong>aucun mot de passe</strong> du portail TEJ.</p>
            <ol>
              <li i18n="@@withholding-tax.tej-export.generez.le.fichier.xml.dans.instafact.2f619d44">Générez le fichier XML dans InstaFact</li>
              <li i18n="@@withholding-tax.tej-export.ouvrez.une.session.sur.le.portail.tej.avec.vos.i.cb605efe">Ouvrez une session sur le portail TEJ avec vos identifiants institutionnels</li>
              <li i18n="@@withholding-tax.tej-export.televersez.le.fichier.et.suivez.la.procedure.de..0fcba7ab">Téléversez le fichier et suivez la procédure de déclaration</li>
            </ol>
          </div>
          <div>
            <h4 i18n="@@withholding-tax.tej-export.dossier.fiscal.amp.eligibilite.212549f5">Dossier fiscal &amp; éligibilité</h4>
            <p class="help-p" i18n="@@withholding-tax.tej-export.pour.verifier.le.matricule.fiscal.ou.consulter.u.a9ed0e71">Pour vérifier le matricule fiscal ou consulter un dossier, utilisez les services en ligne du ministère des Finances.</p>
            <p class="help-p">
              <a
                href="https://www.finances.gov.tn"
                target="_blank"
                rel="noopener noreferrer"
                class="ext-link" i18n="@@withholding-tax.tej-export.portail.des.finances.publiques.tunisie.3529e2e2">Portail des finances publiques (Tunisie)</a>
            </p>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .page-container { padding: 1.5rem; max-width: 960px; }
    .page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem; }
    .page-header h1 { font-size: 1.5rem; font-weight: 600; margin: 0; }
    .subtitle { color: var(--text-secondary); margin: 0.25rem 0 0; font-size: 0.875rem; }
    .card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 1.25rem; margin-bottom: 1.5rem; }
    .card h3 { font-size: 1rem; font-weight: 600; margin: 0 0 1rem; display: flex; align-items: center; gap: 0.5rem; }
    .card-error { border-color: #fca5a5; background: #fef2f2; }
    .card-error h3 { color: #b91c1c; }
    .card-error ul { margin: 0; padding-inline-start: 1.25rem; }
    .card-error li { color: #991b1b; font-size: 0.875rem; margin-bottom: 0.25rem; }
    .card-success { border-color: #86efac; background: #f0fdf4; }
    .card-success h3 { color: #166534; }
    .card-success p { color: #166534; font-size: 0.875rem; margin: 0; }
    .card-warning { border-color: #fcd34d; background: #fffbeb; }
    .card-warning h3 { color: #b45309; font-size: 0.9375rem; }
    .hint-p { font-size: 0.875rem; line-height: 1.5; margin: 0 0 0.75rem; color: var(--text-secondary); }
    .hint-list { margin: 0 0 0.75rem; padding-inline-start: 1.25rem; font-size: 0.875rem; line-height: 1.5; color: var(--text-secondary); }
    .hint-list li { margin-bottom: 0.35rem; }
    .muted-hint { font-size: 0.8125rem; color: var(--text-secondary); opacity: 0.95; }
    .period-hint { margin: -0.5rem 0 1rem; font-size: 0.8125rem; }
    .help-text { font-size: 0.8125rem; color: #b91c1c; margin: 0.5rem 0 0; }
    .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 1rem; margin-bottom: 1rem; }
    .form-group { display: flex; flex-direction: column; gap: 0.25rem; }
    .form-group label { font-size: 0.8125rem; font-weight: 500; color: var(--text-secondary); }
    .form-group select { padding: 0.5rem 0.75rem; border: 1px solid var(--border); border-radius: 6px; font-size: 0.875rem; }
    .form-actions { display: flex; gap: 0.75rem; justify-content: flex-end; flex-wrap: wrap; }
    .preview-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; }
    .preview-header h3 { margin: 0; }
    .xml-preview { background: var(--bg-secondary); padding: 1rem; border-radius: 6px; overflow-x: auto; font-size: 0.8125rem; line-height: 1.5; max-height: 400px; overflow-y: auto; margin: 0; }
    .help-card { background: var(--bg-secondary); }
    .help-grid { display: grid; gap: 1.5rem; }
    .help-grid-3 { grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
    .help-grid h4 { font-size: 0.875rem; font-weight: 600; margin: 0 0 0.5rem; }
    .help-grid ul, .help-grid ol { margin: 0; padding-inline-start: 1.25rem; }
    .help-grid li { font-size: 0.8125rem; margin-bottom: 0.25rem; }
    .help-p { font-size: 0.8125rem; line-height: 1.5; margin: 0 0 0.75rem; color: var(--text-secondary); }
    .ext-link { color: var(--primary); font-weight: 500; }
    .muted { font-size: 0.875rem; color: var(--text-secondary); margin: 0; }
    .table-wrap { overflow-x: auto; }
    .data-table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
    .data-table th, .data-table td { padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border); text-align: start; }
    .data-table th { color: var(--text-secondary); font-weight: 600; }
    .mono { font-family: ui-monospace, monospace; }
    .hash { max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .btn { padding: 0.5rem 1rem; border: 1px solid var(--border); border-radius: 6px; cursor: pointer; font-size: 0.875rem; display: inline-flex; align-items: center; gap: 0.5rem; text-decoration: none; background: transparent; }
    .btn-primary { background: var(--primary); color: white; border-color: var(--primary); }
    .btn-outline { background: transparent; }
    .btn-sm { padding: 0.25rem 0.5rem; font-size: 0.75rem; }
    code { font-size: 0.8em; padding: 0.1rem 0.35rem; border-radius: 4px; background: var(--bg-secondary); }
  `]
})
export class TejExportComponent implements OnInit {
  readonly loc_ui_tern_oui_eaa02f = $localize`:@@ui.tern.oui.eaa02f:Oui`;
  readonly loc_ui_tern_non_a72199 = $localize`:@@ui.tern.non.a72199:Non`;
  /** Aligné sur `Error.Validation` côté API (ExportTejXml / preview). */
  private static readonly tejNoEligibleInvoicesApiMessage =
    $localize`:@@withholding-tax.tej-export.ts.aucune.facture.fournisseur.soldee.avec.r.45d95c40:Aucune facture fournisseur soldée avec retenue à la source pour cette période`;

  private service = inject(WithholdingTaxService);
  private errorHandler = inject(ErrorHandlerService);
  private confirmation = inject(ConfirmationService);

  readonly TejSubmissionType = TejSubmissionType;

  exerciceYear = new Date().getFullYear();
  month = new Date().getMonth() + 1;
  submissionType = TejSubmissionType.Initiale;

  generating = false;
  previewing = false;
  xmlPreview = '';
  validationErrors: string[] = [];
  validationSuccess = false;
  apiError = '';

  /** null = chargement ou indisponible ; 0 = aucune FF éligible pour la période */
  periodEligibleCount: number | null = null;
  periodHintLoading = false;

  exportHistory: TejXmlExportLogListItem[] = [];
  historyLoading = true;

  years = Array.from({ length: 7 }, (_, i) => new Date().getFullYear() - i);
  months = [
    { value: 1, label: $localize`:@@withholding-tax.tej-export.ts.janvier.7a32ae0f:Janvier` }, { value: 2, label: $localize`:@@withholding-tax.tej-export.ts.fevrier.63fc1803:Février` }, { value: 3, label: $localize`:@@withholding-tax.tej-export.ts.mars.1778011d:Mars` },
    { value: 4, label: $localize`:@@withholding-tax.tej-export.ts.avril.4efeee46:Avril` }, { value: 5, label: $localize`:@@withholding-tax.tej-export.ts.mai.afe526a6:Mai` }, { value: 6, label: $localize`:@@withholding-tax.tej-export.ts.juin.8b1e84b6:Juin` },
    { value: 7, label: $localize`:@@withholding-tax.tej-export.ts.juillet.e8e0920c:Juillet` }, { value: 8, label: $localize`:@@withholding-tax.tej-export.ts.aout.460b6696:Août` }, { value: 9, label: $localize`:@@withholding-tax.tej-export.ts.septembre.08d23f31:Septembre` },
    { value: 10, label: $localize`:@@withholding-tax.tej-export.ts.octobre.0ed28485:Octobre` }, { value: 11, label: $localize`:@@withholding-tax.tej-export.ts.novembre.632580af:Novembre` }, { value: 12, label: $localize`:@@withholding-tax.tej-export.ts.decembre.03bcd9b0:Décembre` }
  ];

  ngOnInit(): void {
    this.loadHistory();
    this.refreshPeriodHint();
  }

  onPeriodChange(): void {
    this.apiError = '';
    this.refreshPeriodHint();
  }

  /** Bloque preview/generate tant que le hint charge ou qu’il n’y a aucune FF éligible (null = indisponible, ne pas bloquer). */
  get exportActionsBlocked(): boolean {
    return this.periodHintLoading || this.periodEligibleCount === 0;
  }

  get exportBlockedTitle(): string {
    if (this.periodHintLoading) {
      return $localize`:@@withholding-tax.tej-export.ts.verification.des.factures.eligibles.pour.752c86d5:Vérification des factures éligibles pour cette période en cours…`;
    }
    if (this.periodEligibleCount === 0) {
      return $localize`:@@withholding-tax.tej-export.ts.aucune.facture.fournisseur.soldee.avec.r.507209f0:Aucune facture fournisseur soldée avec retenue pour ce mois. La date de solde doit correspondre à la période choisie.`;
    }
    return '';
  }

  private refreshPeriodHint(): void {
    this.periodHintLoading = true;
    this.service.getTejEligibleInvoiceCount(this.exerciceYear, this.month).subscribe({
      next: (res) => {
        this.periodEligibleCount = res.count ?? 0;
        this.periodHintLoading = false;
      },
      error: () => {
        this.periodEligibleCount = null;
        this.periodHintLoading = false;
      }
    });
  }

  private extractHttpMessage(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      return this.errorHandler.extractErrorMessage(err);
    }
    return $localize`:@@withholding-tax.tej-export.ts.une.erreur.est.survenue.9a133198:Une erreur est survenue.`;
  }

  private isTejNoEligibleInvoicesError(message: string): boolean {
    const t = message.trim().replace(/\.\s*$/, '');
    return t === TejExportComponent.tejNoEligibleInvoicesApiMessage;
  }

  private showNoEligibleInvoicesModal(): void {
    this.confirmation.alert({
      header: $localize`:@@withholding-tax.tej-export.ts.aucune.facture.eligible.pour.cette.perio.712a5264:Aucune facture éligible pour cette période`,
      message:
        $localize`:@@withholding-tax.tej-export.ts.l.export.tej.inclut.uniquement.les.factu.1866df69:L’export TEJ inclut uniquement les factures fournisseurs payées avec retenue enregistrée (fournisseur assujetti, montant et type RS), pour la date de solde (mois/année) sélectionnés.\n\nVérifiez le paramétrage fournisseur, le statut Payée et que la date de solde tombe dans la période.`,
      icon: 'pi pi-exclamation-triangle',
      size: 'md',
      scrollable: true
    });
  }

  private handleTejExportHttpError(message: string): void {
    if (this.isTejNoEligibleInvoicesError(message)) {
      this.showNoEligibleInvoicesModal();
    } else {
      this.apiError = message;
    }
  }

  loadHistory(): void {
    this.historyLoading = true;
    this.service.getTejExportHistory(50).subscribe({
      next: (res) => {
        this.exportHistory = res.items ?? [];
        this.historyLoading = false;
      },
      error: () => {
        this.exportHistory = [];
        this.historyLoading = false;
      }
    });
  }

  preview(): void {
    if (this.periodHintLoading) return;
    if (this.periodEligibleCount === 0) {
      this.showNoEligibleInvoicesModal();
      return;
    }

    this.previewing = true;
    this.xmlPreview = '';
    this.validationErrors = [];
    this.validationSuccess = false;
    this.apiError = '';

    this.service
      .previewXml(
        {
          exerciceYear: this.exerciceYear,
          month: this.month,
          submissionType: this.submissionType
        },
        { skipGlobalErrorUi: true }
      )
      .subscribe({
        next: (result) => {
          this.xmlPreview = result.xmlContent;
          if (result.validationErrors?.length) {
            this.validationErrors = result.validationErrors;
          } else {
            this.validationSuccess = true;
          }
          this.previewing = false;
        },
        error: (err) => {
          this.handleTejExportHttpError(this.extractHttpMessage(err));
          this.previewing = false;
        }
      });
  }

  generate(): void {
    if (this.periodHintLoading) return;
    if (this.periodEligibleCount === 0) {
      this.showNoEligibleInvoicesModal();
      return;
    }

    this.generating = true;
    this.validationErrors = [];
    this.validationSuccess = false;
    this.apiError = '';

    this.service
      .generateXml(
        {
          exerciceYear: this.exerciceYear,
          month: this.month,
          submissionType: this.submissionType
        },
        { skipGlobalErrorUi: true }
      )
      .subscribe({
        next: (blob) => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `DeclarationsRS_${this.exerciceYear}_${String(this.month).padStart(2, '0')}.xml`;
          a.click();
          URL.revokeObjectURL(url);
          this.generating = false;
          this.loadHistory();
        },
        error: (err) => {
          this.handleTejExportHttpError(this.extractHttpMessage(err));
          this.generating = false;
        }
      });
  }

  copyXml(): void {
    void navigator.clipboard.writeText(this.xmlPreview);
  }
}
