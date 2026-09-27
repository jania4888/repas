import {
  Component,
  effect,
  EventEmitter,
  Input,
  OnChanges,
  OnInit,
  Output,
  SimpleChanges,
  inject
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
  hasMeaningfulEdits,
  isImportProposalBalanced,
  mergeProposalWithStore
} from './import-proposal.utils';

@Component({
  selector: 'app-import-proposal-editor',
  standalone: true,
  imports: [CommonModule, EntryHeaderFormComponent, EntryLinesGridComponent],
  providers: [EntryFormStore, EntryReferenceStore, VatAssistService, EntryGridNavigationService],
  template: `
    <div class="ipe-editor">
      <app-entry-header-form [compact]="true" [lockJournal]="lockJournal" />
      <app-entry-lines-grid
        [compactMode]="true"
        [hideAnalyzeSlot]="true"
        [title]="linesTitle"
        [vatSide]="vatSide" />
    </div>
  `,
  styles: `
    .ipe-editor { display:flex; flex-direction:column; gap:var(--spacing-3); }
    .ipe-editor :host ::ng-deep .entry-header,
    .ipe-editor ::ng-deep .entry-header { padding:var(--spacing-3); margin-bottom:0; }
    .ipe-editor ::ng-deep .lines-grid { padding:var(--spacing-3); margin-bottom:0; }
  `
})
export class ImportProposalEditorComponent implements OnChanges, OnInit {
  private readonly store = inject(EntryFormStore);
  private readonly refs = inject(EntryReferenceStore);

  @Input({ required: true }) proposal!: JournalEntryProposal;

  /** Émis quand l'état éditable change (diagnostics, équilibre, éditions manuelles). */
  @Output() readonly stateChange = new EventEmitter<void>();

  linesTitle = $localize`:@@accounting.import-proposal-editor.ts.ecriture.proposee.3b3b973e:Écriture proposée`;
  lockJournal = true;
  vatSide: 'deductible' | 'collected' = 'deductible';

  private baselineProposal: JournalEntryProposal | null = null;

  constructor() {
    effect(() => {
      this.store.setAccounts(this.refs.accounts());
      this.store.setPeriods(this.refs.periods());
      const opts = this.refs.journalOptions();
      if (opts.length > 0) {
        this.store.setJournalOptions(opts);
      }
    });

    effect(() => {
      this.store.journalCode();
      this.store.entryDate();
      this.store.entryLabel();
      this.store.pieceRef();
      this.store.pieceDate();
      this.store.lines();
      this.store.periodClosed();
      this.stateChange.emit();
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['proposal']?.currentValue) {
      this.applyProposal(this.proposal);
    }
  }

  ngOnInit(): void {
    this.refs.loadAll();
    if (this.proposal) {
      this.applyProposal(this.proposal);
    }
  }

  getMergedProposal(): JournalEntryProposal {
    if (!this.baselineProposal) {
      return this.proposal;
    }
    const snapshot = this.currentSnapshot();
    return mergeProposalWithStore(this.baselineProposal, snapshot, this.refs.accounts());
  }

  isBalanced(): boolean {
    return isImportProposalBalanced(this.store.lines());
  }

  hasManualEdits(): boolean {
    if (!this.baselineProposal) {
      return false;
    }
    return hasMeaningfulEdits(this.baselineProposal, this.currentSnapshot());
  }

  private applyProposal(proposal: JournalEntryProposal): void {
    this.baselineProposal = proposal;
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
    this.stateChange.emit();
  }

  private currentSnapshot() {
    return buildStoreSnapshot(
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
    );
  }
}
