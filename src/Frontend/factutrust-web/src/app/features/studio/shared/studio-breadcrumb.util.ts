import { BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';

const STUDIO_ROOT: BreadcrumbItem = { label: 'Studio', route: '/studio', icon: 'fa-solid fa-shapes' };

export function studioBreadcrumb(...items: BreadcrumbItem[]): BreadcrumbItem[] {
  return [STUDIO_ROOT, ...items];
}

export const STUDIO_BREADCRUMBS = {
  entities: (): BreadcrumbItem[] => studioBreadcrumb({ label: 'Tables personnalisées' }),
  aiBuilder: (): BreadcrumbItem[] => studioBreadcrumb({ label: 'Assistant IA' }),
  systemHub: (name: string): BreadcrumbItem[] =>
    studioBreadcrumb({ label: 'Assistant IA', route: '/studio/ai' }, { label: name }),
  entityDesigner: (name: string): BreadcrumbItem[] =>
    studioBreadcrumb({ label: 'Tables', route: '/studio' }, { label: name }),
  forms: (): BreadcrumbItem[] => studioBreadcrumb({ label: 'Formulaires', route: '/studio/forms' }),
  formDesigner: (name: string, entityId: string): BreadcrumbItem[] =>
    studioBreadcrumb(
      { label: 'Tables', route: '/studio' },
      { label: name, route: `/studio/${entityId}` },
      { label: 'Mise en page' }
    ),
  viewDesigner: (name?: string): BreadcrumbItem[] =>
    studioBreadcrumb(
      { label: 'Formulaires', route: '/studio/forms' },
      { label: name ?? 'Nouvelle vue' }
    ),
  viewRunner: (name: string): BreadcrumbItem[] =>
    studioBreadcrumb(
      { label: 'Formulaires', route: '/studio/forms' },
      { label: name }
    ),
  reports: (): BreadcrumbItem[] => studioBreadcrumb({ label: 'Rapports', route: '/studio/reports' }),
  reportDesigner: (name?: string): BreadcrumbItem[] =>
    studioBreadcrumb(
      { label: 'Rapports', route: '/studio/reports' },
      { label: name ?? 'Nouveau rapport' }
    ),
  reportView: (name: string): BreadcrumbItem[] =>
    studioBreadcrumb(
      { label: 'Rapports', route: '/studio/reports' },
      { label: name }
    ),
  records: (name: string, key: string): BreadcrumbItem[] =>
    studioBreadcrumb({ label: name, route: `/studio/d/${key}` }),
  recordForm: (name: string, key: string, editing: boolean): BreadcrumbItem[] =>
    studioBreadcrumb(
      { label: name, route: `/studio/d/${key}` },
      { label: editing ? 'Modifier' : 'Nouveau' }
    ),
  recordViewNew: (name: string, key: string): BreadcrumbItem[] =>
    studioBreadcrumb(
      { label: name, route: `/studio/d/${key}` },
      { label: 'Nouvelle vue' }
    ),
  recordViewEdit: (name: string, key: string, viewName?: string): BreadcrumbItem[] =>
    studioBreadcrumb(
      { label: name, route: `/studio/d/${key}` },
      { label: viewName ?? 'Modifier la vue' }
    ),
  relations: (): BreadcrumbItem[] =>
    studioBreadcrumb({ label: 'Relations' }),
};