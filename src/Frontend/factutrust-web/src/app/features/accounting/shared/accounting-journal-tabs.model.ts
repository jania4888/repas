export interface AccountingJournalTab {
  code: string;
  label: string;
  icon: string;
  shortLabel: string;
}

export interface AccountingJournalTabChange {
  index: number;
  code: string;
}

export const ACCOUNTING_SUB_JOURNALS: readonly AccountingJournalTab[] = [
  { code: 'JV', label: $localize`:@@accounting.accounting-journal-tabs.ts.ventes.9087fc4f:Ventes`, icon: 'pi pi-shopping-cart', shortLabel: 'JV' },
  { code: 'JA', label: $localize`:@@accounting.accounting-journal-tabs.ts.achats.ee5b078c:Achats`, icon: 'pi pi-shopping-bag', shortLabel: 'JA' },
  { code: 'JC', label: $localize`:@@accounting.accounting-journal-tabs.ts.caisse.ce5a5c98:Caisse`, icon: 'pi pi-wallet', shortLabel: 'JC' },
  { code: 'JB', label: $localize`:@@accounting.accounting-journal-tabs.ts.banque.2a7302cd:Banque`, icon: 'pi pi-building', shortLabel: 'JB' },
  { code: 'JOD', label: $localize`:@@accounting.accounting-journal-tabs.ts.operations.diverses.1735f774:Opérations diverses`, icon: 'pi pi-book', shortLabel: 'JOD' },
  { code: 'JIM', label: $localize`:@@accounting.accounting-journal-tabs.ts.immobilisations.1e4cbe01:Immobilisations`, icon: 'pi pi-box', shortLabel: 'JIM' }
];
