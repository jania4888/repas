/**
 * Barrel export pour les composants atomiques du backoffice plateforme.
 *
 * Lot A1 — Foundation design system (cf. plan).
 *
 * Import-pattern recommandé :
 *  ```ts
 *  import { FtPageHeaderComponent, FtKpiCardComponent, FtBadgeComponent } from '@core/ui';
 *  ```
 */

// Atomes simples
export { FtBadgeComponent } from './badge/ft-badge.component';
export type { FtTone, FtBadgeSize } from './badge/ft-badge.component';

export { FtAvatarComponent } from './avatar/ft-avatar.component';
export type { FtAvatarSize } from './avatar/ft-avatar.component';

export { FtChipComponent } from './chip/ft-chip.component';

export { FtSkeletonComponent } from './skeleton/ft-skeleton.component';
export type { FtSkeletonShape } from './skeleton/ft-skeleton.component';

export { FtStatusDotComponent } from './status-dot/ft-status-dot.component';

export { FtFieldErrorComponent } from './field-error/ft-field-error.component';

// Layout/structure
export { FtPageHeaderComponent } from './page-header/ft-page-header.component';
export { FtBreadcrumbComponent } from './breadcrumb/ft-breadcrumb.component';
export type { FtBreadcrumbItem } from './breadcrumb/ft-breadcrumb.component';
export { FtDrawerComponent } from './drawer/ft-drawer.component';
export { FtFilterToolbarComponent } from './filter-toolbar/ft-filter-toolbar.component';
export { FtEmptyStateComponent } from './empty-state/ft-empty-state.component';
export type { FtEmptyVariant } from './empty-state/ft-empty-state.component';

// Composants complexes
export { FtKpiCardComponent } from './kpi-card/ft-kpi-card.component';
export { FtConfirmActionComponent } from './confirm-action/ft-confirm-action.component';
export type { FtConfirmVariant } from './confirm-action/ft-confirm-action.component';

// Cellules de table
export { FtCellTenantComponent } from './table-cells/ft-cell-tenant.component';
export { FtCellMoneyComponent } from './table-cells/ft-cell-money.component';
export { FtCellRelativeDateComponent } from './table-cells/ft-cell-relative-date.component';
export { FtCellStatusComponent } from './table-cells/ft-cell-status.component';
export { FtCellActionsMenuComponent } from './table-cells/ft-cell-actions-menu.component';
export { FtCellPlanComponent } from './table-cells/ft-cell-plan.component';
export { FtUserMenuComponent } from './user-menu/ft-user-menu.component';
export { FtKeyboardShortcutsDialogComponent } from './keyboard-shortcuts/ft-keyboard-shortcuts-dialog.component';

// Pipes (utiles à importer dans les composants pages)
export { FtRelativeDatePipe } from '../pipes/ft-relative-date.pipe';
export { FtTndCurrencyPipe } from '../pipes/ft-tnd-currency.pipe';
