/// <reference types="@angular/localize" />
import { Component, ElementRef, EventEmitter, Input, OnChanges, Output, SimpleChanges, ViewChild, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { catchError, of } from 'rxjs';
import { Router } from '@angular/router';
import { DialogModule } from 'primeng/dialog';
import { ButtonComponent } from '@shared/components/button/button.component';
import { BankAccountDto } from '@core/services/bank-account.service';
import { AccountingService, ImportableBankAccountDto } from '../services/accounting.service';
import { AccountingJournalCatalogService } from '../shared/accounting-journal-catalog.service';
import { AccountingJournalTab } from '../shared/accounting-journal-tabs.model';
import { BankStatementImportError, BankStatementImportService } from './bank-statement-import.service';
import { BankStatementImportCapabilities } from './bank-statement-import.models';
import { importErrorMessage } from './bank-statement-import.messages';

/** Journaux standards qui ne sont jamais des journaux de banque. */
const NON_BANK_JOURNALS = new Set(['JV', 'JA', 'JC', 'JOD', 'JIM', 'JAN']);

function toBankAccountOption(account: ImportableBankAccountDto): BankAccountDto {
  return {
    id: account.id,
    companyId: '',
    bankCode: '',
    bankName: account.bankName,
    designation: account.designation ?? null,
    agencyName: null,
    rib: '',
    iban: '',
    swiftBic: null,
    isDefault: account.isDefault,
    isActive: account.isActive,
    chartOfAccountNumber: account.chartOfAccountNumber,
    currency: account.currency,
    hasBankingIdentity: account.hasBankingIdentity
  };
}

/** Écran d'où la modale est ouverte : l'analyse y ramène après relecture. */
export type BankStatementImportOrigin = 'manual-entry' | 'reconciliation';

/**
 * Import d'un relevé bancaire depuis la saisie manuelle : compte bancaire, journal, fichier.
 * L'analyse est lancée côté serveur ; la relecture se fait ensuite sur un écran dédié.
 */
@Component({
  selector: 'app-bank-statement-upload-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, DialogModule, ButtonComponent],
  template: `
    <p-dialog
      header="Importer un relevé bancaire" i18n-header="@@accounting.bank-statement-import.importer.un.releve.bancaire.f29101ac"
      [(visible)]="visible"
      [modal]="true"
      [style]="{ width: '600px', maxWidth: '98vw' }"
      [draggable]="false"
      [resizable]="false"
      (onHide)="close()"
      ariaLabel="Importer un relevé bancaire" i18n-ariaLabel="@@accounting.bank-statement-import.importer.un.releve.bancaire.666cc840">

      <input #fileInput type="file" class="bsu-file-input" tabindex="-1" aria-hidden="true"
             accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp"
             (change)="onFileSelected($event)" />

      @if (!capabilities() && !loading()) {
        <div class="bsu-state" role="status">
          <i class="pi pi-lock bsu-icon" aria-hidden="true"></i>
          <p class="bsu-text" i18n="@@accounting.bank-statement-import.l.import.de.releves.bancaires.n.est.pas.efb43f3b">L'import de relevés bancaires n'est pas activé pour ce dossier.</p>
        </div>
      } @else {
        <div class="bsu-form">
          @if (origin === 'reconciliation') {
            <p class="bsu-intro" i18n="@@accounting.bank-statement-import.releve.pdf.ou.photo.de.votre.banque.les.operatio.481bec91">
              Relevé PDF (ou photo) de votre banque : les opérations sont lues et contrôlées par les soldes,
              l'IA relit tout ce qui n'est pas lu avec certitude. Vous relisez le relevé, puis il revient
              dans le rapprochement bancaire.
            </p>
          } @else {
            <p class="bsu-intro" i18n="@@accounting.bank-statement-import.releve.pdf.ou.photo.de.votre.banque.les.7e61a9fe">
              Relevé PDF (ou photo) de votre banque : les opérations sont lues, contrôlées par les soldes,
              puis le système propose une écriture par opération dans le journal de banque. Vous relisez
              avant de générer les écritures en brouillard.
            </p>
          }

          <label class="bsu-label" for="bsu-account" i18n="@@accounting.bank-statement-import.compte.bancaire.485b42ca">Compte bancaire</label>
          <select id="bsu-account" class="bsu-input" [(ngModel)]="bankAccountId" [disabled]="busy()">
            <option [ngValue]="null" disabled i18n="@@accounting.bank-statement-import.choisir.un.compte.bancaire.4f1dc9ba">Choisir un compte bancaire</option>
            @for (account of bankAccounts(); track account.id) {
              <option [ngValue]="account.id" [disabled]="!account.chartOfAccountNumber">
                {{ accountLabel(account) }}
              </option>
            }
          </select>
          @if (selectedAccount(); as account) {
            @if (!account.chartOfAccountNumber) {
              <p class="bsu-hint bsu-hint--warn" role="status" i18n="@@accounting.bank-statement-import.ce.compte.bancaire.n.est.relie.a.aucun.c.f79aaeba">
                Ce compte bancaire n'est relié à aucun compte comptable 532 : reliez-le dans les comptes bancaires avant d'importer.
              </p>
            } @else if (!isDinarAccount(account)) {
              <p class="bsu-hint bsu-hint--warn" role="status" i18n="@@accounting.bank-statement-import.ce.compte.bancaire.n.est.pas.en.dinars.tnd.l.imp.779d721c">
                Ce compte bancaire n'est pas en dinars (TND) : l'import de relevés ne prend en charge que les comptes en dinars.
              </p>
            }
          }
          @if (accountsError(); as accountsMessage) {
            <p class="bsu-error" role="alert">{{ accountsMessage }}</p>
          } @else if (bankAccounts().length === 0 && !loading()) {
            <p class="bsu-hint bsu-hint--warn" role="status" i18n="@@accounting.bank-statement-import.aucun.compte.532.creez.en.un">Créez un compte 5321/5324 dans le plan comptable, ou un compte dans Paiements › Comptes bancaires.</p>
          } @else if (origin === 'reconciliation' && accountsLoaded() && !hasEligibleAccount()) {
            <p class="bsu-hint bsu-hint--warn bsu-no-eligible" role="status" i18n="@@accounting.bank-statement-import.aucun.compte.bancaire.n.est.pret.pour.l.import.d.d519959a">
              Aucun compte bancaire n'est prêt pour l'import du relevé (compte en dinars relié à un compte comptable 532) :
              paramétrez-le dans Paiements › Comptes bancaires, ou importez un export CSV / OFX de votre banque.
            </p>
          }

          <label class="bsu-label" for="bsu-journal" i18n="@@accounting.bank-statement-import.journal.57d7f743">Journal</label>
          <select id="bsu-journal" class="bsu-input" [(ngModel)]="journalCode" [disabled]="busy()">
            @for (journal of journals(); track journal.code) {
              <option [ngValue]="journal.code">{{ journal.code }} — {{ journal.label }}</option>
            }
          </select>

          <div class="bsu-file">
            <app-button variant="secondary" icon="pi-paperclip" iconPos="left" (clicked)="chooseFile()" [disabled]="busy()"
                        ariaLabel="Choisir le fichier du relevé" i18n-ariaLabel="@@accounting.bank-statement-import.choisir.le.fichier.du.releve.5f34088c" i18n="@@accounting.bank-statement-import.choisir.un.fichier.75c27e25">Choisir un fichier</app-button>
            <span class="bsu-filename">{{ file()?.name ?? noFileLabel }}</span>
          </div>
          <p class="bsu-hint" i18n="@@accounting.bank-statement-import.pdf.png.jpeg.ou.webp.taille.maximale.mo.ddc9390d">PDF, PNG, JPEG ou WEBP — taille maximale : {{ maxMegabytes() }} Mo.</p>

          @if (capabilities(); as caps) {
            @if (caps.allDocumentsViaAi) {
              @if (caps.aiAvailable) {
                <p class="bsu-hint" [class.bsu-hint--warn]="(caps.aiEngine === 'text' && !!caps.visionUnavailableReason) || caps.aiProviderKind === 'docstrange'">
                  @if (caps.aiProviderKind === 'docstrange') {
                    <ng-container i18n="@@accounting.bank-statement-import.chaque.releve.est.lu.page.par.page.par.un.servic.597de247">Chaque relevé est lu page par page par un service d'extraction documentaire externe configuré par la plateforme : les pages quittent le serveur. Les opérations lues sont ensuite à contrôler avant l'enregistrement.</ng-container>
                  } @else if (caps.aiEngine === 'vision') {
                    <ng-container i18n="@@accounting.bank-statement-import.chaque.releve.pdf.texte.pdf.scanne.ou.image.est.ff546aeb">Chaque relevé — PDF texte, PDF scanné ou image — est lu page par page par l'IA de la plateforme : comptez une à trois minutes par page sur le serveur. Les opérations lues sont ensuite à contrôler avant l'enregistrement.</ng-container>
                  } @else if (caps.aiEngine === 'text' && caps.visionUnavailableReason) {
                    <ng-container i18n="@@accounting.bank-statement-import.la.lecture.des.images.est.indisponible.les.relev.5d7babb6">La lecture des images est indisponible : les relevés seront lus sans l'image des pages, moins précisément sur les pages scannées.</ng-container>
                  } @else if (caps.aiProviderKind === 'external') {<ng-container i18n="@@accounting.bank-statement-import.pages.scannees.ou.non.lues.avec.certitude.relect.67692986">
                    Pages scannées ou non lues avec certitude : relecture par une IA externe (fournisseur configuré par la plateforme).
                  </ng-container>} @else {<ng-container i18n="@@accounting.bank-statement-import.pages.scannees.ou.non.lues.avec.certitude.relect.ad04271e">
                    Pages scannées ou non lues avec certitude : relecture par l'IA locale du serveur.
                  </ng-container>}
                </p>
              } @else {
                <p class="bsu-hint bsu-hint--blocked" role="alert" i18n="@@accounting.bank-statement-import.ia.de.lecture.indisponible.modele.non.charge.ou.f636f257">IA de lecture indisponible (modèle non chargé ou moteur arrêté) : l'import de relevés est suspendu. Réessayez dans quelques minutes ou contactez l'administrateur de la plateforme.</p>
              }
            } @else if (caps.aiAvailable) {
              <p class="bsu-hint">
                @if (caps.aiProviderKind === 'external') {<ng-container i18n="@@accounting.bank-statement-import.pages.scannees.lecture.par.une.ia.extern.8eb6571b">
                  Pages scannées : lecture par une IA externe (fournisseur configuré par la plateforme).
                </ng-container>} @else {<ng-container i18n="@@accounting.bank-statement-import.pages.scannees.lecture.par.l.ia.locale.d.62375e79">
                  Pages scannées : lecture par l'IA locale du serveur.
                </ng-container>}
              </p>
            } @else {
              <p class="bsu-hint" i18n="@@accounting.bank-statement-import.les.releves.scannes.ne.pourront.pas.etre.fbc52896">Les relevés scannés ne pourront pas être lus (IA indisponible) : seuls les PDF à texte sont acceptés.</p>
            }
          }

          @if (error(); as message) {
            <p class="bsu-error" role="alert">{{ message }}</p>
          }
        </div>
      }

      <ng-template pTemplate="footer">
        <div class="bsu-footer">
          <app-button variant="secondary" (clicked)="close()" [disabled]="busy()" ariaLabel="Fermer" i18n-ariaLabel="@@accounting.bank-statement-import.fermer.39fd9bdb" i18n="@@accounting.bank-statement-import.annuler.49ba3292">Annuler</app-button>
          <app-button variant="primary" icon="pi-search" iconPos="left" (clicked)="analyze()" [disabled]="!canAnalyze()"
                      ariaLabel="Analyser le relevé" i18n-ariaLabel="@@accounting.bank-statement-import.analyser.le.releve.8386ec38">
            {{ busy() ? analyzingLabel : analyzeLabel }}
          </app-button>
        </div>
      </ng-template>
    </p-dialog>
  `,
  styles: `
    .bsu-file-input { position:absolute; width:1px; height:1px; opacity:0; pointer-events:none; }
    .bsu-form { display:flex; flex-direction:column; gap:var(--spacing-2); }
    .bsu-intro { margin:0 0 var(--spacing-2); color:var(--color-text-secondary); font-size:var(--font-size-sm); }
    .bsu-label { font-weight:600; font-size:var(--font-size-sm); margin-block-start:var(--spacing-2); }
    .bsu-input { width:100%; padding:var(--spacing-2); border:1px solid var(--color-border-default); border-radius:var(--radius-sm); background:var(--color-background-elevated); }
    .bsu-file { display:flex; align-items:center; gap:var(--spacing-3); margin-block-start:var(--spacing-3); flex-wrap:wrap; }
    .bsu-filename { font-size:var(--font-size-sm); color:var(--color-text-secondary); overflow-wrap:anywhere; }
    .bsu-hint { margin:0; font-size:var(--font-size-xs); color:var(--color-text-tertiary); }
    .bsu-hint--warn { color:var(--color-warning); }
    .bsu-hint--blocked { color:var(--color-danger); font-size:var(--font-size-sm); font-weight:600; padding:var(--spacing-2) var(--spacing-3); border:1px solid var(--color-danger); border-radius:var(--radius-sm); background:var(--color-danger-subtle, transparent); }
    .bsu-error { margin:var(--spacing-2) 0 0; color:var(--color-danger); font-size:var(--font-size-sm); }
    .bsu-state { display:flex; flex-direction:column; align-items:center; gap:var(--spacing-2); padding:var(--spacing-4); text-align:center; }
    .bsu-icon { font-size:2rem; color:var(--color-text-tertiary); }
    .bsu-text { margin:0; color:var(--color-text-secondary); }
    .bsu-footer { display:flex; justify-content:flex-end; gap:var(--spacing-2); }
  `
})
export class BankStatementUploadDialogComponent implements OnChanges {
  @Input() visible = false;
  @Output() visibleChange = new EventEmitter<boolean>();
  /** Fichier déjà choisi ailleurs (rapprochement) : présélectionné à l'ouverture. */
  @Input() initialFile: File | null = null;
  /** Compte bancaire présélectionné (ex. compte déjà choisi dans le rapprochement). */
  @Input() initialBankAccountId: string | null = null;
  /** Écran d'origine : le rapprochement y revient après la relecture du relevé. */
  @Input() origin: BankStatementImportOrigin = 'manual-entry';
  @ViewChild('fileInput') private fileInput?: ElementRef<HTMLInputElement>;

  private readonly api = inject(BankStatementImportService);
  private readonly accounting = inject(AccountingService);
  private readonly journalCatalog = inject(AccountingJournalCatalogService);
  private readonly router = inject(Router);

  readonly analyzeLabel = $localize`:@@accounting.bank-statement-import.ts.analyser.d06ab560:Analyser`;
  readonly analyzingLabel = $localize`:@@accounting.bank-statement-import.ts.analyse.458c82be:Analyse…`;
  readonly noFileLabel = $localize`:@@accounting.bank-statement-import.ts.aucun.fichier.choisi.7b63b7ff:Aucun fichier choisi`;

  readonly capabilities = signal<BankStatementImportCapabilities | null>(null);
  readonly bankAccounts = signal<BankAccountDto[]>([]);
  readonly journals = signal<readonly AccountingJournalTab[]>([]);
  readonly file = signal<File | null>(null);
  readonly busy = signal(false);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly accountsError = signal<string | null>(null);
  readonly accountsLoaded = signal(false);

  bankAccountId: string | null = null;
  journalCode = 'JB';

  readonly maxMegabytes = computed(() => Math.round((this.capabilities()?.maxFileBytes ?? 10 * 1024 * 1024) / (1024 * 1024)));

  /**
   * Tout relevé passe par l'IA et celle-ci est indisponible : lancer l'analyse produirait une
   * session sans aucune opération. L'import est suspendu jusqu'au retour du moteur.
   */
  readonly aiBlocked = computed(() => {
    const c = this.capabilities();
    return !!c && !!c.allDocumentsViaAi && !c.aiAvailable;
  });

  selectedAccount(): BankAccountDto | undefined {
    return this.bankAccounts().find(a => a.id === this.bankAccountId);
  }

  /** Devise absente du DTO (ancien serveur) : considérée en dinars, le serveur contrôle de toute façon. */
  isDinarAccount(account: BankAccountDto): boolean {
    return !account.currency || account.currency.toUpperCase() === 'TND';
  }

  hasEligibleAccount(): boolean {
    return this.bankAccounts().some(a => !!a.chartOfAccountNumber && this.isDinarAccount(a));
  }

  canAnalyze(): boolean {
    const account = this.selectedAccount();
    return !this.busy() && !!this.capabilities() && !this.aiBlocked() && !!this.file()
      && !!account?.chartOfAccountNumber && this.isDinarAccount(account) && !!this.journalCode;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible']?.currentValue === true) {
      this.reset();
      if (this.initialBankAccountId) this.bankAccountId = this.initialBankAccountId;
      this.useFile(this.initialFile);
      this.load();
    }
  }

  accountLabel(account: BankAccountDto): string {
    const name = account.designation || account.bankName;
    return account.chartOfAccountNumber ? `${account.chartOfAccountNumber} — ${name}` : name;
  }

  chooseFile(): void {
    this.fileInput?.nativeElement.click();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const selected = input.files?.[0] ?? null;
    input.value = '';
    this.error.set(null);
    if (!selected) return;
    this.useFile(selected);
  }

  /** Retient le fichier s'il respecte la taille maximale (contrôlée aussi par le serveur). */
  private useFile(selected: File | null): void {
    if (!selected) return;
    const max = this.capabilities()?.maxFileBytes ?? 10 * 1024 * 1024;
    if (selected.size > max) {
      this.file.set(null);
      this.error.set(importErrorMessage('bank_statement_import.file_too_large'));
      return;
    }
    this.file.set(selected);
  }

  analyze(): void {
    const file = this.file();
    if (!file || !this.bankAccountId || !this.canAnalyze()) return;
    this.busy.set(true);
    this.error.set(null);
    this.api.start(file, this.bankAccountId, this.journalCode).subscribe({
      next: session => {
        this.busy.set(false);
        this.close();
        if (this.origin === 'reconciliation') {
          void this.router.navigate(['/accounting/bank-statement-import/session', session.id], { queryParams: { from: 'reconciliation' } });
        } else {
          void this.router.navigate(['/accounting/bank-statement-import/session', session.id]);
        }
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(importErrorMessage(err instanceof BankStatementImportError ? err.code : null));
      }
    });
  }

  close(): void {
    if (this.busy()) return;
    this.visible = false;
    this.visibleChange.emit(false);
  }

  private reset(): void {
    this.file.set(null);
    this.error.set(null);
    this.accountsError.set(null);
    this.busy.set(false);
    this.accountsLoaded.set(false);
  }

  private load(): void {
    this.loading.set(true);
    this.api.capabilities().subscribe(caps => {
      this.capabilities.set(caps);
      this.loading.set(false);
      // Taille réelle autorisée connue : un fichier présélectionné trop lourd est écarté.
      const file = this.file();
      if (file && caps && file.size > caps.maxFileBytes) this.useFile(file);
    });
    this.accounting.ensureBankGlProjections().pipe(catchError(() => of(null))).subscribe(() => {
      this.accounting.listImportableBankAccounts().subscribe({
        next: res => {
          const accounts = (res?.data ?? []).filter(a => a.isActive).map(toBankAccountOption);
          this.bankAccounts.set(accounts);
          this.accountsLoaded.set(true);
          this.accountsError.set(null);
          if (!this.bankAccountId) {
            const dinar = (a: BankAccountDto) => !!a.chartOfAccountNumber && this.isDinarAccount(a);
            const preferred = accounts.find(a => a.isDefault && dinar(a)) ?? accounts.find(dinar);
            this.bankAccountId = preferred?.id ?? null;
          }
        },
        error: (err: unknown) => {
          this.bankAccounts.set([]);
          this.accountsLoaded.set(true);
          const status = err instanceof HttpErrorResponse ? err.status : 0;
          this.accountsError.set(status === 403
            ? $localize`:@@accounting.bank-statement-import.ts.droit.comptes.import.refuse:Vous n'avez pas le droit de consulter les comptes bancaires de l'import.`
            : $localize`:@@accounting.bank-statement-import.ts.chargement.comptes.impossible:Impossible de charger les comptes bancaires.`);
        }
      });
    });
    this.journalCatalog.list().subscribe(journals => {
      const bankJournals = journals.filter(j => j.code === 'JB' || !NON_BANK_JOURNALS.has(j.code));
      this.journals.set(bankJournals.length > 0 ? bankJournals : journals.filter(j => j.code === 'JB'));
      if (!bankJournals.some(j => j.code === this.journalCode)) this.journalCode = bankJournals[0]?.code ?? 'JB';
    });
  }
}
