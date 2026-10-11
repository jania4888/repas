import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AutoCompleteModule } from 'primeng/autocomplete';
import { AccountingFilterBarComponent } from '../../../shared/accounting-filter-bar.component';
import { AccountingAmountInputComponent } from '../../../shared/accounting-amount-input.component';
import { AccountingJournalCatalogService } from '../../../shared/accounting-journal-catalog.service';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AnalyzeWithAiButtonComponent } from '@features/ai-assistant/components/analyze-with-ai-button/analyze-with-ai-button.component';
import {
  AccountingJournalTab
} from '../../../shared/accounting-journal-tabs.model';
import { AccountingService, ChartOfAccountDto, ThirdPartyDirectoryRowDto } from '../../../services/accounting.service';
import { LetteringFilters, LetteringStateFilter, LetteringThirdPartyRef } from '../../models/lettering.models';

/**
 * Carte de filtres de l'écran de lettrage (`accounting-filters-card` / `app-accounting-filter-bar`,
 * conventions existantes du module). Composant « bête » : il ne contient aucune logique métier,
 * seulement la saisie des filtres et l'émission de `load`. Le store reste la seule source de
 * vérité pour les lignes chargées.
 */
@Component({
  selector: 'app-lettering-filters',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    AutoCompleteModule,
    AccountingFilterBarComponent,
    AccountingAmountInputComponent,
    ButtonComponent,
    AnalyzeWithAiButtonComponent
  ],
  templateUrl: './lettering-filters.component.html',
  styleUrl: './lettering-filters.component.scss'
})
export class LetteringFiltersComponent implements OnInit {
  private readonly api = inject(AccountingService);
  private readonly journals = inject(AccountingJournalCatalogService);

  @Input({ required: true }) filters!: LetteringFilters;
  @Input() accountHint = '';
  @Input() loading = false;
  @Input() payloadBuilder!: () => unknown;

  @Output() readonly filtersChange = new EventEmitter<LetteringFilters>();
  @Output() readonly load = new EventEmitter<void>();

  readonly journalOptions = signal<readonly AccountingJournalTab[]>([]);
  readonly showAdvanced = signal(false);

  accountQuery = '';
  accountSuggestions: string[] = [];
  private allAccounts: ChartOfAccountDto[] = [];

  thirdPartyQuery: string | ThirdPartyDirectoryRowDto = '';
  thirdPartySuggestions: ThirdPartyDirectoryRowDto[] = [];

  readonly states: { value: LetteringStateFilter; label: string }[] = [
    { value: 'unlettered', label: $localize`:@@accounting.lettering.filters.ts.non.lettrees:Non lettrées` },
    { value: 'partial', label: $localize`:@@accounting.lettering.filters.ts.partiellement.lettrees:Partiellement lettrées` },
    { value: 'lettered', label: $localize`:@@accounting.lettering.filters.ts.lettrees:Lettrées` },
    { value: 'all', label: $localize`:@@accounting.lettering.filters.ts.toutes:Toutes` }
  ];

  ngOnInit(): void {
    this.accountQuery = this.filters.account;
    this.api.getChartOfAccounts().subscribe({
      next: res => {
        if (res.success && res.data) this.allAccounts = res.data;
      }
    });
    this.journals.list().subscribe(list => this.journalOptions.set(list));
  }

  filterAccounts(event: { query: string }): void {
    const q = event.query.toLowerCase();
    this.accountSuggestions = this.allAccounts
      .filter(a => a.accountNumber.toLowerCase().includes(q) || a.label.toLowerCase().includes(q))
      .map(a => a.accountNumber)
      .slice(0, 20);
  }

  onAccountInputChange(value: string): void {
    this.accountQuery = value;
    this.emitPatch({ account: value });
  }

  filterThirdParties(event: { query: string }): void {
    const account = this.allAccounts.find(a => a.accountNumber === this.filters.account);
    const kind = account?.accountType === 1 || account?.accountType === 2 ? account.accountType : null;
    this.api.getThirdPartyDirectory({ search: event.query, kind, pageSize: 20 }).subscribe({
      next: res => {
        this.thirdPartySuggestions = res.success && res.data ? res.data.items : [];
      }
    });
  }

  onThirdPartySelect(row: ThirdPartyDirectoryRowDto): void {
    this.thirdPartyQuery = row;
    const ref: LetteringThirdPartyRef = { id: row.thirdPartyId, kind: row.kind, name: row.name };
    const patch: Partial<LetteringFilters> = { thirdParty: ref };
    if (!this.filters.account) {
      patch.account = row.collectiveAccountNumber;
      this.accountQuery = row.collectiveAccountNumber;
    }
    this.emitPatch(patch);
  }

  onThirdPartyClear(): void {
    this.thirdPartyQuery = '';
    this.emitPatch({ thirdParty: null });
  }

  onStateChange(value: string): void {
    this.emitPatch({ state: value as LetteringStateFilter });
  }

  onJournalChange(value: string): void {
    this.emitPatch({ journalCode: value || null });
  }

  onDateChange(key: 'from' | 'to', value: string): void {
    this.emitPatch({ [key]: value } as Partial<LetteringFilters>);
  }

  onMinAmountChange(value: number | null): void {
    this.emitPatch({ minAmount: value });
  }

  onMaxAmountChange(value: number | null): void {
    this.emitPatch({ maxAmount: value });
  }

  toggleAdvanced(): void {
    this.showAdvanced.update(v => !v);
  }

  onIncludeSubAccountsChange(checked: boolean): void {
    this.emitPatch({ accountMatch: checked ? 'prefix' : 'exact' });
  }

  submit(): void {
    this.load.emit();
  }

  private emitPatch(patch: Partial<LetteringFilters>): void {
    this.filtersChange.emit({ ...this.filters, ...patch });
  }
}
