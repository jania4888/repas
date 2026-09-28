import { BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { STUDIO_WORKFLOW_LABELS } from '../workflows/studio-workflow-labels';

const STUDIO_ROOT: BreadcrumbItem = { label: $localize`:@@studio.studio-breadcrumb.ts.studio.5b23bd71:Studio`, route: '/studio', icon: 'fa-solid fa-shapes' };

export function studioBreadcrumb(...items: BreadcrumbItem[]): BreadcrumbItem[] {
  return [STUDIO_ROOT, ...items];
}

export const STUDIO_BREADCRUMBS = {
  entities: (): BreadcrumbItem[] => studioBreadcrumb({ label: $localize`:@@studio.studio-breadcrumb.ts.tables.personnalisees.ef0d5da7:Tables personnalisées` }),
  aiBuilder: (): BreadcrumbItem[] => studioBreadcrumb({ label: $localize`:@@studio.studio-breadcrumb.ts.assistant.ia.94f6f208:Assistant IA` }),
  systemHub: (name: string): BreadcrumbItem[] =>
    studioBreadcrumb({ label: $localize`:@@studio.studio-breadcrumb.ts.assistant.ia.94f6f208:Assistant IA`, route: '/studio/ai' }, { label: name }),
  entityDesigner: (name: string): BreadcrumbItem[] =>
    studioBreadcrumb({ label: $localize`:@@studio.studio-breadcrumb.ts.tables.193daf13:Tables`, route: '/studio' }, { label: name }),
  forms: (): BreadcrumbItem[] => studioBreadcrumb({ label: $localize`:@@studio.studio-breadcrumb.ts.formulaires.edb3637f:Formulaires`, route: '/studio/forms' }),
  formDesigner: (name: string, entityId: string): BreadcrumbItem[] =>
    studioBreadcrumb(
      { label: $localize`:@@studio.studio-breadcrumb.ts.tables.193daf13:Tables`, route: '/studio' },
      { label: name, route: `/studio/${entityId}` },
      { label: $localize`:@@studio.studio-breadcrumb.ts.mise.en.page.f09e7eee:Mise en page` }
    ),
  viewDesigner: (name?: string): BreadcrumbItem[] =>
    studioBreadcrumb(
      { label: $localize`:@@studio.studio-breadcrumb.ts.formulaires.edb3637f:Formulaires`, route: '/studio/forms' },
      { label: name ?? $localize`:@@studio.studio-breadcrumb.ts.nouvelle.vue.5c1894bc:Nouvelle vue` }
    ),
  viewRunner: (name: string): BreadcrumbItem[] =>
    studioBreadcrumb(
      { label: $localize`:@@studio.studio-breadcrumb.ts.formulaires.edb3637f:Formulaires`, route: '/studio/forms' },
      { label: name }
    ),
  reports: (): BreadcrumbItem[] => studioBreadcrumb({ label: $localize`:@@studio.studio-breadcrumb.ts.rapports.db7d9fbb:Rapports`, route: '/studio/reports' }),
  reportDesigner: (name?: string): BreadcrumbItem[] =>
    studioBreadcrumb(
      { label: $localize`:@@studio.studio-breadcrumb.ts.rapports.db7d9fbb:Rapports`, route: '/studio/reports' },
      { label: name ?? $localize`:@@studio.studio-breadcrumb.ts.nouveau.rapport.98bed007:Nouveau rapport` }
    ),
  reportView: (name: string): BreadcrumbItem[] =>
    studioBreadcrumb(
      { label: $localize`:@@studio.studio-breadcrumb.ts.rapports.db7d9fbb:Rapports`, route: '/studio/reports' },
      { label: name }
    ),
  records: (name: string, key: string): BreadcrumbItem[] =>
    studioBreadcrumb({ label: name, route: `/studio/d/${key}` }),
  recordForm: (name: string, key: string, editing: boolean, viewing = false): BreadcrumbItem[] =>
    studioBreadcrumb(
      { label: name, route: `/studio/d/${key}` },
      { label: viewing ? $localize`:@@studio.studio-breadcrumb.ts.consulter.48eb4968:Consulter` : editing ? $localize`:@@studio.studio-breadcrumb.ts.modifier.f260e757:Modifier` : $localize`:@@studio.studio-breadcrumb.ts.nouveau.b9676c8f:Nouveau` }
    ),
  recordViewNew: (name: string, key: string): BreadcrumbItem[] =>
    studioBreadcrumb(
      { label: name, route: `/studio/d/${key}` },
      { label: $localize`:@@studio.studio-breadcrumb.ts.nouvelle.vue.5c1894bc:Nouvelle vue` }
    ),
  recordViewEdit: (name: string, key: string, viewName?: string): BreadcrumbItem[] =>
    studioBreadcrumb(
      { label: name, route: `/studio/d/${key}` },
      { label: viewName ?? $localize`:@@studio.studio-breadcrumb.ts.modifier.la.vue.6e6ad47d:Modifier la vue` }
    ),
  relations: (): BreadcrumbItem[] =>
    studioBreadcrumb({ label: $localize`:@@studio.studio-breadcrumb.ts.relations.6519fe11:Relations` }),
  workflows: (): BreadcrumbItem[] =>
    studioBreadcrumb({ label: STUDIO_WORKFLOW_LABELS.nav.workflows }),
  workflowDesigner: (name?: string | null): BreadcrumbItem[] =>
    studioBreadcrumb(
      { label: STUDIO_WORKFLOW_LABELS.nav.workflows, route: '/studio/workflows' },
      { label: name?.trim() || STUDIO_WORKFLOW_LABELS.designer.newTitle }
    ),
  approvals: (): BreadcrumbItem[] =>
    studioBreadcrumb({ label: STUDIO_WORKFLOW_LABELS.nav.approvals }),
};