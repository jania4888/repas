import { ActivatedRouteSnapshot } from '@angular/router';
import {
  deskTenantKey,
  deskWindowKeyFromSnapshot,
  deskWindowKeyFromUrl,
  isDeskHomeUrl,
  isDeskWindowUrl,
  normalizeDeskUrl
} from './desk-window-key';

function snapshot(segments: string[], query: Record<string, string> = {}): ActivatedRouteSnapshot {
  return {
    url: segments.map(path => ({ path })),
    queryParams: query,
    parent: null,
    firstChild: null,
    outlet: 'primary',
    routeConfig: { path: segments.at(-1) ?? '' },
    component: class Page {}
  } as unknown as ActivatedRouteSnapshot;
}

describe('deskWindowKey', () => {
  it('isole le dossier délégué du tenant société', () => {
    expect(deskTenantKey({
      accessMode: 'delegated',
      contextTenantId: 'client-a',
      tenantId: 'firm-1'
    })).toBe('delegated:client-a');
    expect(deskTenantKey({ accessMode: 'native', tenantId: 'company-1' })).toBe('native:company-1');
    expect(deskTenantKey(null)).toBe('');
  });

  it('traite un écran comme une seule fenêtre et ignore les filtres', () => {
    expect(deskWindowKeyFromUrl('/accounting/journal?from=2026-01-01&to=2026-01-31')).toBe('/accounting/journal');
    expect(deskWindowKeyFromUrl('/accounting/journal?to=2026-01-31&from=2026-01-01')).toBe('/accounting/journal');
    expect(normalizeDeskUrl('/accounting/journal?to=2&from=1')).toBe('/accounting/journal?from=1&to=2');
  });

  it('ouvre une seule fenêtre « Tableau de bord », insensible à la période en query string', () => {
    expect(isDeskWindowUrl('/accounting/dashboard')).toBe(true);
    expect(deskWindowKeyFromUrl('/accounting/dashboard')).toBe('/accounting/dashboard');
    expect(deskWindowKeyFromUrl('/accounting/dashboard?fiscalYear=2026&month=10')).toBe(
      '/accounting/dashboard'
    );
  });

  it('distingue une saisie nouvelle d’une écriture, et deux écritures entre elles', () => {
    expect(deskWindowKeyFromUrl('/accounting/manual-entry')).toBe('/accounting/manual-entry');
    expect(deskWindowKeyFromUrl('/accounting/manual-entry?entryId=0100056')).toBe(
      '/accounting/manual-entry?entryId=0100056'
    );
    expect(deskWindowKeyFromUrl('/accounting/manual-entry?from=2026-01-01&entryId=0100056')).toBe(
      '/accounting/manual-entry?entryId=0100056'
    );
    expect(deskWindowKeyFromUrl('/accounting/manual-entry?entryId=0100057')).not.toBe(
      deskWindowKeyFromUrl('/accounting/manual-entry?entryId=0100056')
    );
  });

  it('distingue deux immobilisations et deux sessions de relevé par leur chemin', () => {
    const first = deskWindowKeyFromSnapshot(snapshot(['accounting', 'fixed-assets', 'asset-a']));
    const second = deskWindowKeyFromSnapshot(snapshot(['accounting', 'fixed-assets', 'asset-b']));
    expect(first).toBe('/accounting/fixed-assets/asset-a');
    expect(second).toBe('/accounting/fixed-assets/asset-b');
    expect(first).not.toBe(second);

    expect(deskWindowKeyFromUrl('/accounting/bank-statement-entries/session/sess-1')).toBe(
      '/accounting/bank-statement-entries/session/sess-1'
    );
    expect(deskWindowKeyFromUrl('/accounting/bank-statement-entries/statement/stmt-9')).toBe(
      '/accounting/bank-statement-entries/statement/stmt-9'
    );
  });

  it('n’ouvre pas de fenêtre pour le refus, le cabinet, l’assistant ou le bureau vide', () => {
    expect(isDeskWindowUrl('/access-denied')).toBeFalse();
    expect(isDeskWindowUrl('/firm/dashboard')).toBeFalse();
    expect(isDeskWindowUrl('/firm/payroll')).toBeFalse();
    expect(isDeskWindowUrl('/ai-assistant')).toBeFalse();
    expect(isDeskWindowUrl('/desk')).toBeFalse();
    expect(isDeskHomeUrl('/desk')).toBeTrue();
    expect(deskWindowKeyFromUrl('/access-denied?returnUrl=/accounting/chart')).toBeNull();
    expect(isDeskWindowUrl('/accounting/chart')).toBeTrue();
    expect(isDeskWindowUrl('/payroll/runs')).toBeTrue();
  });
});
