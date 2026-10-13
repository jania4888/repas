import {
  Component,
  computed,
  effect,
  Input,
  OnChanges,
  OnInit,
  SimpleChanges,
  inject,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { EntryFormStore } from '../../services/entry-form.store';
import { EntryReferenceStore } from '../../services/entry-reference.store';
import { VatAssistService } from '../../services/vat-assist.service';
import { EntryGridNavigationService } from '../../services/entry-grid-navigation.service';
import { EntryHeaderFormComponent } from '../entry-header-form.component';
import { EntryLinesGridComponent } from '../entry-lines-grid.component';
import { JournalEntryProposal } from '../../models/accounting-document-import.models';
import { DEFAULT_COLUMN_VISIBILITY } from '../../models/entry-form.model';
import {
  buildStoreSnapshot,
  getSubmittableEntryLines,
  hasMeaningfulEdits,
  isImportProposalBalanced,
  mergeProposalWithStore
} from './import-proposal.utils';

/**
 * Éditeur de la proposition d'écriture dans la modale d'import : en-tête + grille, avec un
 * `EntryFormStore` isolé. L'état exposé (proposition fusionnée, contrôles, équilibre) est dérivé
 * par signaux : il suit les éditions et le chargement du plan comptable sans événement à relayer.
 */
@Component({
  selector: 'app-import-proposal-editor',
  standalone: true,
  imports: [CommonModule, EntryHeaderFormComponent, EntryLinesGridComponent],
  providers: [EntryFormStore, EntryReferenceStore, VatAssistService, EntryGridNavigationService],
  template: `
    <div class="ipe-editor">
      <app-entry-header-form [compact]="true" [lockJournal]="lockJournal" idPrefix="ipe-" />
      <app-entry-lines-grid
        [compactMode]="true"
        [hideAnalyzeSlot]="true"
        [title]="linesTitle"
        [vatSide]="vatSide"
        [neutralBalancedLabel]="true"
        idPrefix="ipe-" />
    </div>
  `,
  styles: `
    .ipe-editor { display:flex; flex-direction:column; gap:var(--spacing-3); }
    .ipe-editor ::ng-deep .entry-header { padding:var(--spacing-3); margin-bottom:0; }
    .ipe-editor ::ng-deep .lines-grid { padding:var(--spacing-3); margin-bottom:0; }
  `
})
export class ImportProposalEditorComponent implements OnChanges, OnInit {
  private readonly store = inject(EntryFormStore);
  private readonly refs = inject(EntryReferenceStore);

  @Input({ required: true }) proposal!: JournalEntryProposal;

  linesTitle = $localize`:@@accounting.import-proposal-editor.ts.ecriture.proposee.3b3b973e:Écriture proposée`;
  lockJournal = true;
  vatSide: 'deductible' | 'collected' = 'deductible';

  /** Proposition reçue (avant édition) : base de la fusion et de la détection des éditions. */
  private readonly baseline = signal<JournalEntryProposal | null>(null);

  /** Vrai tant que les référentiels (plan comptable, périodes, journaux…) se chargent. */
  readonly refsLoading = this.refs.loading;
  /** Vrai quand le chargement du plan comptable a échoué. */
  readonly accountsLoadFailed = this.refs.accountsLoadFailed;
  /** Les contrôles de compte ne sont recalculés qu'avec un plan comptable réellement chargé. */
  readonly accountsAvailable = computed(() => !this.refs.loading() && !this.refs.accountsLoadFailed());

  /** Lignes de la grille, dans l'ordre affiché. */
  readonly lines = this.store.lines;

  private readonly snapshot = computed(() =>
    buildStoreSnapshot(
      {
        journalCode: this.store.journalCode(),
        entryDate: this.store.entryDate(),
        entryLabel: this.store.entryLabel(),
        pieceRef: this.store.pieceRef(),
        pieceDate: this.store.pieceDate()
      },
      this.store.lines(),
      this.store.periodClosed(),
      this.store.periodsLoaded()
    )
  );

  /** Proposition éditée, avec contrôles recalculés (null avant la première proposition). */
  readonly mergedProposal = computed<JournalEntryProposal | null>(() => {
    const base = this.baseline();
    if (!base) return null;
    return mergeProposalWithStore(base, this.snapshot(), this.refs.accounts(), {
      accountsAvailable: this.accountsAvailable()
    });
  });

  readonly balanced = computed(() => isImportProposalBalanced(this.store.lines()));
  /** Nombre de lignes exploitables (compte + montant). */
  readonly submittableCount = computed(() => getSubmittableEntryLines(this.store.lines()).length);
  /** Écart débit − crédit, dans la devise de l'écriture. */
  readonly balanceGap = this.store.balance;
  /** Code de la devise de l'écriture (devise de tenue en mono-devise). */
  readonly currencyCode = this.store.currency;
  /** Format `DecimalPipe` des montants (3 décimales en dinar, sinon celles de la devise). */
  readonly amountFormat = this.store.amountFormat;
  readonly manualEdits = computed(() => {
    const base = this.baseline();
    return !!base && hasMeaningfulEdits(base, this.snapshot());
  });

  constructor() {
    effect(() => {
      this.store.setAccounts(this.refs.accounts());
      // Les périodes ne sont transmises qu'une fois chargées : sinon une liste vide passe pour
      // « périodes connues » et la clôture signalée par l'analyse serait effacée à tort.
      if (!this.refs.loading()) {
        this.store.setPeriods(this.refs.periods());
      }
      const opts = this.refs.journalOptions();
      if (opts.length > 0) {
        this.store.setJournalOptions(opts);
      }
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['proposal']?.currentValue) {
      this.applyProposal(this.proposal);
    }
  }

  ngOnInit(): void {
    this.refs.loadAll();
    // Filet pour une entrée posée sans liaison de gabarit (pas de ngOnChanges) : jamais deux fois.
    if (this.proposal && !this.baseline()) {
      this.applyProposal(this.proposal);
    }
  }

  getMergedProposal(): JournalEntryProposal {
    return this.mergedProposal() ?? this.proposal;
  }

  isBalanced(): boolean {
    return this.balanced();
  }

  hasManualEdits(): boolean {
    return this.manualEdits();
  }

  private applyProposal(proposal: JournalEntryProposal): void {
    this.lockJournal = true;
    this.vatSide = proposal.direction === 'SALE' ? 'collected' : 'deductible';
    this.linesTitle = $localize`:@@accounting.import-proposal-editor.ts.ecriture.proposee.journal.journalcode.468e90e1:Écriture proposée — journal ${proposal.journalCode}:journalCode:`;

    this.store.columnVisibility.set({
      ...DEFAULT_COLUMN_VISIBILITY,
      piece: false,
      dueDate: false,
      lettering: false,
      vat: true
    });

    this.store.applyDocumentProposal(proposal);
    // Pièce sans date lue : on ne préremplit pas la date du jour, l'utilisateur la saisit.
    if (!proposal.entryDate) {
      this.store.entryDate.set('');
    }
    this.baseline.set(proposal);
  }
}
