import type { NavSubItem } from '@core/config/app-navigation.registry';

/** Titre de groupe partagé par la barre latérale et le menu métier. Pas une entrée de navigation. */
export const NAV_REPORTS_SECTION_LABEL = $localize`:@@core.nav.section.reports:Rapports`;

export function isReportsNavChild(child: Pick<NavSubItem, 'navGroup'> | undefined): boolean {
  return child?.navGroup === 'reports';
}

/** Vrai uniquement devant le premier enfant reports d'une liste déjà filtrée. */
export function showReportsSeparator(
  children: ReadonlyArray<Pick<NavSubItem, 'navGroup'>>,
  index: number
): boolean {
  const child = children[index];
  if (!isReportsNavChild(child)) {
    return false;
  }
  return index === 0 || !isReportsNavChild(children[index - 1]);
}

/** Les enfants reports, s'il y en a, occupent un suffixe contigu. */
export function reportsGroupIsContiguousSuffix(
  children: ReadonlyArray<Pick<NavSubItem, 'navGroup'>> | undefined
): boolean {
  if (!children?.length) {
    return true;
  }
  let seenReports = false;
  for (const child of children) {
    if (isReportsNavChild(child)) {
      seenReports = true;
    } else if (seenReports) {
      return false;
    }
  }
  return true;
}
