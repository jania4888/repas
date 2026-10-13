import { Injectable, inject } from '@angular/core';
import { Observable, of, shareReplay } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { AccountingService } from '../services/accounting.service';
import { ACCOUNTING_SUB_JOURNALS, AccountingJournalTab } from './accounting-journal-tabs.model';

/**
 * Source unique des journaux proposés par les écrans de consultation (journal, journaux
 * auxiliaires, récapitulatifs). Alimentée par le catalogue serveur — le back-office autorise la
 * création de journaux personnalisés, que les listes figées des écrans ignoraient.
 *
 * Repli garanti : en cas d'erreur réseau ou de catalogue vide, les 6 journaux standards
 * historiques sont renvoyés tels quels. Aucun écran ne peut donc se retrouver sans sélecteur.
 */
@Injectable({ providedIn: 'root' })
export class AccountingJournalCatalogService {
  private readonly api = inject(AccountingService);
  private journals$?: Observable<readonly AccountingJournalTab[]>;

  /** Journaux standards qui ne sont jamais des journaux de banque (JB reste toujours autorisé). */
  private static readonly NonBankJournalCodes = new Set(['JV', 'JA', 'JC', 'JOD', 'JIM', 'JAN']);

  /** Ordre d'affichage historique : les journaux standards d'abord, dans cet ordre. */
  private static readonly PreferredOrder = ACCOUNTING_SUB_JOURNALS.map(j => j.code);

  private static readonly IconByCode: Readonly<Record<string, string>> = Object.fromEntries(
    ACCOUNTING_SUB_JOURNALS.map(j => [j.code, j.icon])
  );

  /**
   * Journaux actifs du catalogue, triés (standards en tête, puis alphabétique).
   * Le résultat est mis en cache pour la durée de la session applicative.
   */
  list(): Observable<readonly AccountingJournalTab[]> {
    this.journals$ ??= this.api.getJournals().pipe(
      map(res => {
        if (!res.success || !res.data || res.data.length === 0) return ACCOUNTING_SUB_JOURNALS;
        const tabs = res.data
          .filter(j => j.isActive)
          .map<AccountingJournalTab>(j => ({
            code: j.code,
            label: j.label,
            shortLabel: j.code,
            icon: AccountingJournalCatalogService.IconByCode[j.code] ?? 'pi pi-book'
          }));
        return tabs.length > 0 ? AccountingJournalCatalogService.sort(tabs) : ACCOUNTING_SUB_JOURNALS;
      }),
      catchError(() => of(ACCOUNTING_SUB_JOURNALS)),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    return this.journals$;
  }

  private static sort(tabs: AccountingJournalTab[]): AccountingJournalTab[] {
    const rank = (code: string): number => {
      const index = AccountingJournalCatalogService.PreferredOrder.indexOf(code);
      return index === -1 ? Number.MAX_SAFE_INTEGER : index;
    };
    return [...tabs].sort((a, b) => {
      const delta = rank(a.code) - rank(b.code);
      return delta !== 0 ? delta : a.code.localeCompare(b.code);
    });
  }

  /**
   * Journaux de trésorerie éligibles pour les imports de relevé bancaire : JB est toujours
   * admis, les autres journaux standards (ventes, achats, OD...) sont exclus. Les journaux
   * personnalisés créés par le back-office restent admis.
   */
  listBankJournals(): Observable<readonly AccountingJournalTab[]> {
    return this.list().pipe(
      map(journals => journals.filter(j => j.code === 'JB' || !AccountingJournalCatalogService.NonBankJournalCodes.has(j.code)))
    );
  }
}
