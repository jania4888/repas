import { Promotion } from '@core/services/pricing.service';

export type PromotionLifecycle = 'running' | 'upcoming' | 'expired' | 'disabled' | 'outOfWindow';

export type PromotionStatusFilter = 'all' | PromotionLifecycle;

export type PromotionScopeFilter = 'all' | 'product' | 'category' | 'client' | 'global';

export interface PromotionPeriodProgress {
  percent: number;
  daysElapsed: number;
  daysTotal: number;
  daysRemaining: number;
  tone: 'success' | 'warning' | 'secondary';
}

export function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function promotionLifecycle(promo: Promotion, today = new Date()): PromotionLifecycle {
  if (!promo.isActive) return 'disabled';

  const d = toDateKey(today);
  if (d < promo.startsOn.slice(0, 10)) return 'upcoming';
  if (d > promo.endsOn.slice(0, 10)) return 'expired';
  if (promo.isRunningToday) return 'running';
  return 'outOfWindow';
}

export function promotionScopeKind(promo: Promotion): PromotionScopeFilter {
  if (promo.productId) return 'product';
  if (promo.productCategoryId) return 'category';
  if (promo.clientId) return 'client';
  return 'global';
}

export function matchesStatusFilter(promo: Promotion, filter: PromotionStatusFilter, today = new Date()): boolean {
  if (filter === 'all') return true;
  return promotionLifecycle(promo, today) === filter;
}

export function matchesScopeFilter(promo: Promotion, filter: PromotionScopeFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'client') return !!promo.clientId;
  return promotionScopeKind(promo) === filter;
}

export function matchesSearchFilter(promo: Promotion, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return promo.name.toLowerCase().includes(q) || promo.scopeLabel.toLowerCase().includes(q);
}

export function filterPromotions(
  promotions: Promotion[],
  options: {
    search: string;
    status: PromotionStatusFilter;
    scope: PromotionScopeFilter;
    today?: Date;
  }
): Promotion[] {
  const today = options.today ?? new Date();
  return promotions.filter(
    p =>
      matchesSearchFilter(p, options.search) &&
      matchesStatusFilter(p, options.status, today) &&
      matchesScopeFilter(p, options.scope)
  );
}

export function promotionPeriodProgress(promo: Promotion, today = new Date()): PromotionPeriodProgress {
  const start = new Date(promo.startsOn.slice(0, 10));
  const end = new Date(promo.endsOn.slice(0, 10));
  const now = new Date(toDateKey(today));

  const daysTotal = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
  const daysElapsed = Math.min(
    daysTotal,
    Math.max(0, Math.round((now.getTime() - start.getTime()) / 86_400_000) + 1)
  );
  const daysRemaining = Math.max(0, daysTotal - daysElapsed);
  const percent = Math.min(100, Math.max(0, Math.round((daysElapsed / daysTotal) * 100)));

  const lifecycle = promotionLifecycle(promo, today);
  const tone: PromotionPeriodProgress['tone'] =
    lifecycle === 'running' ? 'success' : lifecycle === 'upcoming' ? 'warning' : 'secondary';

  return { percent, daysElapsed, daysTotal, daysRemaining, tone };
}

export function periodLabel(promo: Promotion): string {
  const from = new Date(promo.startsOn).toLocaleDateString('fr-TN');
  const to = new Date(promo.endsOn).toLocaleDateString('fr-TN');
  return `${from} → ${to}`;
}

export function discountLabel(promo: Promotion): string {
  if (promo.discountType === 'Percentage') return `${promo.discountPercent ?? 0} %`;
  return `${(promo.discountAmount ?? 0).toFixed(3)} / unité`;
}

export function buildScopePreview(
  productLabel: string | null,
  categoryLabel: string | null,
  clientLabel: string | null
): string {
  const parts: string[] = [];
  if (productLabel) {
    parts.push(`« ${productLabel} »`);
  } else if (categoryLabel) {
    parts.push(`Catégorie « ${categoryLabel} »`);
  } else {
    parts.push('Tous les produits');
  }

  parts.push(clientLabel ? `Client « ${clientLabel} »` : 'Tous les clients');
  return parts.join(' · ');
}

export function lifecycleLabel(lifecycle: PromotionLifecycle): string {
  switch (lifecycle) {
    case 'running':
      return 'En cours';
    case 'upcoming':
      return $localize`:@@settings.promotions.ts.a.venir.5ae4e587:À venir`;
    case 'expired':
      return $localize`:@@settings.promotions.ts.expiree.1f0808dc:Expirée`;
    case 'disabled':
      return $localize`:@@settings.promotions.ts.desactivee.74cc3b9b:Désactivée`;
    case 'outOfWindow':
      return $localize`:@@settings.promotions.ts.hors.periode.eb84848b:Hors période`;
  }
}

export function lifecycleSeverity(lifecycle: PromotionLifecycle): 'success' | 'warning' | 'secondary' | 'danger' | 'info' {
  switch (lifecycle) {
    case 'running':
      return 'success';
    case 'upcoming':
      return 'info';
    case 'expired':
    case 'outOfWindow':
      return 'warning';
    case 'disabled':
      return 'secondary';
  }
}
