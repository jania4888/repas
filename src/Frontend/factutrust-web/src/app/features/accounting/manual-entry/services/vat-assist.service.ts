import { Injectable } from '@angular/core';
import { ChartOfAccountDto } from '../../services/accounting.service';
import { EntryFormStore } from './entry-form.store';
import { EntryLine, createEmptyLine } from '../models/entry-form.model';

export type VatSide = 'deductible' | 'collected';

const DEDUCTIBLE_ACCOUNTS = ['43666', '43662'] as const;
const COLLECTED_ACCOUNT = '436711';

@Injectable()
export class VatAssistService {
  resolveVatAccount(
    side: VatSide,
    counterpartAccount: string | null,
    accounts: ChartOfAccountDto[]
  ): { account: string | null; warning?: string } {
    const active = new Set(accounts.filter(a => a.isActive).map(a => a.accountNumber));

    if (side === 'collected') {
      if (active.has(COLLECTED_ACCOUNT)) return { account: COLLECTED_ACCOUNT };
      return { account: null, warning: `Compte TVA collectée ${COLLECTED_ACCOUNT} absent du plan.` };
    }

    const isFixedAsset = counterpartAccount
      ? accounts.find(a => a.accountNumber === counterpartAccount)?.accountClass === 2
      : false;

    const preferred = isFixedAsset ? '43662' : '43666';
    if (active.has(preferred)) return { account: preferred };

    for (const c of DEDUCTIBLE_ACCOUNTS) {
      if (active.has(c)) return { account: c };
    }

    return { account: null, warning: 'Aucun compte TVA déductible (43666/43662) trouvé dans le plan.' };
  }

  computeVatAmount(base: number, ratePercent: number): number {
    return Math.round(base * ratePercent) / 100;
  }

  applyVatToLine(
    store: EntryFormStore,
    lineIndex: number,
    ratePercent: number | null,
    side: VatSide,
    accounts: ChartOfAccountDto[]
  ): void {
    const lines = [...store.lines()];
    const line = lines[lineIndex];
    if (!line || line.isVatGenerated) return;

    const base = Math.max(Number(line.debit) || 0, Number(line.credit) || 0);
    if (!ratePercent || ratePercent <= 0 || base <= 0) {
      this.removeLinkedVatLine(store, line.vatLinkId);
      lines[lineIndex] = { ...line, vatRatePercent: null, vatLinkId: null };
      store.setLines(lines);
      return;
    }

    const vatAmount = this.computeVatAmount(base, ratePercent);
    const { account, warning } = this.resolveVatAccount(side, line.accountNumber, accounts);
    if (!account) {
      store.error.set(warning ?? $localize`:@@accounting.vat-assist.ts.compte.tva.introuvable.850afb98:Compte TVA introuvable.`);
      return;
    }

    const linkId = line.vatLinkId ?? `vat-${lineIndex}-${Date.now()}`;
    const vatLabel = `TVA ${ratePercent}% — ${line.lineLabel || store.entryLabel()}`;
    const isDebitBase = (Number(line.debit) || 0) > 0;

    let vatLineIndex = lines.findIndex(l => l.vatLinkId === linkId && l.isVatGenerated);
    const vatLine: EntryLine = {
      ...createEmptyLine(),
      accountNumber: account,
      lineLabel: vatLabel,
      debit: side === 'deductible' && isDebitBase ? vatAmount : null,
      credit: side === 'collected' && !isDebitBase ? vatAmount : side === 'deductible' && !isDebitBase ? null : vatAmount,
      isVatGenerated: true,
      vatLinkId: linkId,
      vatRatePercent: ratePercent
    };

    if (side === 'deductible') {
      vatLine.debit = isDebitBase ? vatAmount : null;
      vatLine.credit = isDebitBase ? null : vatAmount;
    } else {
      vatLine.credit = isDebitBase ? null : vatAmount;
      vatLine.debit = isDebitBase ? vatAmount : null;
    }

    lines[lineIndex] = { ...line, vatRatePercent: ratePercent, vatLinkId: linkId };

    if (vatLineIndex >= 0) {
      lines[vatLineIndex] = vatLine;
    } else {
      lines.splice(lineIndex + 1, 0, vatLine);
    }

    store.setLines(lines);
  }

  removeLinkedVatLine(store: EntryFormStore, linkId: string | null | undefined): void {
    if (!linkId) return;
    const filtered = store.lines().filter(l => !(l.isVatGenerated && l.vatLinkId === linkId));
    if (filtered.length < 2) {
      while (filtered.length < 2) filtered.push(createEmptyLine());
    }
    store.setLines(filtered);
  }
}
