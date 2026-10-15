import { deskShortcuts } from './desk-shortcuts';
import { NavItem } from '@core/config/app-navigation.registry';

describe('deskShortcuts', () => {
  it('ne propose que les routes déjà visibles, pas les actions ni le cabinet', () => {
    const items: NavItem[] = [
      {
        id: 'accounting',
        label: 'Comptabilité',
        route: '/accounting/chart',
        icon: 'pi pi-book',
        children: [
          { label: 'Journal', route: '/accounting/journal?journalCode=JV' },
          { label: 'Retour cabinet', route: '/firm/dashboard', action: 'returnToFirm' }
        ]
      },
      { id: 'firm', label: 'Cabinet', route: '/firm/payroll' }
    ];

    expect(deskShortcuts(items).map(shortcut => shortcut.route)).toEqual([
      '/accounting/chart',
      '/accounting/journal?journalCode=JV'
    ]);
  });
});
