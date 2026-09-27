/// <reference types="@angular/localize" />
import { Routes } from '@angular/router';
import { permissionGuard } from '@core/guards/permission.guard';
import { PERMISSIONS } from '@core/config/permission-keys';

export const STOCK_ROUTES: Routes = [
    {
        path: '',
        loadComponent: () => import('./stock-simple/stock-simple.component').then(m => m.StockSimpleComponent),
        title: $localize`:@@stock.routes.title.Mon_Stock_InstaFact:Mon Stock - InstaFact`
    },
    {
        path: 'advanced',
        loadComponent: () => import('./stock-list/stock-list.component').then(m => m.StockListComponent),
        title: $localize`:@@stock.routes.title.Gestion_du_Stock_Avanc_:Gestion du Stock (Avancée) - InstaFact`
    },
    {
        path: 'entries/new',
        canActivate: [permissionGuard],
        data: { permissions: [PERMISSIONS.stockVouchers.create], kind: 'Entry' },
        loadComponent: () => import('../stock-vouchers/stock-voucher-form.component').then(m => m.StockVoucherFormComponent),
        title: $localize`:@@stock.stock.routes.ts.nouveau.bon.d.entree.instafact.ebf9619a:Nouveau bon d'entrée - InstaFact`
    },
    {
        path: 'entries/:id/edit',
        canActivate: [permissionGuard],
        data: { permissions: [PERMISSIONS.stockVouchers.update], kind: 'Entry' },
        loadComponent: () => import('../stock-vouchers/stock-voucher-form.component').then(m => m.StockVoucherFormComponent),
        title: $localize`:@@stock.stock.routes.ts.modifier.bon.d.entree.instafact.021b4a5b:Modifier bon d'entrée - InstaFact`
    },
    {
        path: 'entries/:id',
        canActivate: [permissionGuard],
        data: { permissions: [PERMISSIONS.stockVouchers.read], kind: 'Entry' },
        loadComponent: () => import('../stock-vouchers/stock-voucher-detail.component').then(m => m.StockVoucherDetailComponent),
        title: $localize`:@@stock.stock.routes.ts.detail.bon.d.entree.instafact.0cd21d64:Détail bon d'entrée - InstaFact`
    },
    {
        path: 'entries',
        canActivate: [permissionGuard],
        data: { permissions: [PERMISSIONS.stockVouchers.read], kind: 'Entry' },
        loadComponent: () => import('../stock-vouchers/stock-voucher-list.component').then(m => m.StockVoucherListComponent),
        title: $localize`:@@stock.stock.routes.ts.bons.d.entree.instafact.b6e6ec34:Bons d'entrée - InstaFact`
    },
    {
        path: 'issues/new',
        canActivate: [permissionGuard],
        data: { permissions: [PERMISSIONS.stockVouchers.create], kind: 'Issue' },
        loadComponent: () => import('../stock-vouchers/stock-voucher-form.component').then(m => m.StockVoucherFormComponent),
        title: $localize`:@@stock.routes.title.Nouveau_bon_de_sortie_:Nouveau bon de sortie - InstaFact`
    },
    {
        path: 'issues/:id/edit',
        canActivate: [permissionGuard],
        data: { permissions: [PERMISSIONS.stockVouchers.update], kind: 'Issue' },
        loadComponent: () => import('../stock-vouchers/stock-voucher-form.component').then(m => m.StockVoucherFormComponent),
        title: $localize`:@@stock.routes.title.Modifier_bon_de_sortie_:Modifier bon de sortie - InstaFact`
    },
    {
        path: 'issues/:id',
        canActivate: [permissionGuard],
        data: { permissions: [PERMISSIONS.stockVouchers.read], kind: 'Issue' },
        loadComponent: () => import('../stock-vouchers/stock-voucher-detail.component').then(m => m.StockVoucherDetailComponent),
        title: $localize`:@@stock.routes.title.D_tail_bon_de_sortie_I:Détail bon de sortie - InstaFact`
    },
    {
        path: 'issues',
        canActivate: [permissionGuard],
        data: { permissions: [PERMISSIONS.stockVouchers.read], kind: 'Issue' },
        loadComponent: () => import('../stock-vouchers/stock-voucher-list.component').then(m => m.StockVoucherListComponent),
        title: $localize`:@@stock.routes.title.Bons_de_sortie_InstaFa:Bons de sortie - InstaFact`
    },
    {
        path: 'entry',
        redirectTo: '/stock/entries/new',
        pathMatch: 'full'
    },
    {
        path: 'exit',
        redirectTo: '/stock/issues/new',
        pathMatch: 'full'
    },
    {
        path: 'advanced/entry',
        redirectTo: '/stock/entries/new',
        pathMatch: 'full'
    },
    {
        path: 'advanced/exit',
        redirectTo: '/stock/issues/new',
        pathMatch: 'full'
    },
    {
        path: 'advanced/:id/history',
        loadComponent: () => import('./stock-history/stock-history.component').then(m => m.StockHistoryComponent),
        title: $localize`:@@stock.routes.title.Historique_mouvements_A:Historique mouvements (Avancée) - InstaFact`
    },
    {
        path: ':id/history',
        loadComponent: () => import('./stock-history/stock-history.component').then(m => m.StockHistoryComponent),
        title: $localize`:@@stock.routes.title.Historique_mouvements_:Historique mouvements - InstaFact`
    }
];
