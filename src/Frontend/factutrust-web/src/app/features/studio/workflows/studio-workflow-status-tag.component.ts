import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TagModule } from 'primeng/tag';
import { STUDIO_WORKFLOW_LABELS } from './studio-workflow-labels';
import { WorkflowInstanceStatus, instanceStatusSeverity } from './studio-workflows.models';

/** Icônes Font Awesome par statut d'instance (maquette `d44-workflows-designer.html`, colonne droite). */
const STATUS_ICONS: Readonly<Record<WorkflowInstanceStatus, string>> = {
  running: 'fa-solid fa-play',
  waiting: 'fa-solid fa-hourglass-half',
  waiting_approval: 'fa-solid fa-user-check',
  completed: 'fa-solid fa-check',
  failed: 'fa-solid fa-triangle-exclamation',
  cancelled: 'fa-solid fa-ban'
};

/**
 * Étiquette de statut d'une instance de workflow (4.4e2) — partagée avec le détail d'instance
 * (4.4f), l'onglet Workflows de la fiche (4.4h2) et la partie B. Sévérités déléguées à
 * `instanceStatusSeverity` (4.4a1, fait foi) : running=info, waiting/waiting_approval=warn,
 * completed=success, failed=danger, cancelled=secondary — sous-ensemble strict de l'union
 * `severity` de `p-tag` (tag.d.ts l.31), `'contrast'` volontairement non utilisé.
 * `compact` = icône seule + `title` (colonne étroite du concepteur).
 */
@Component({
  selector: 'app-studio-workflow-status-tag',
  standalone: true,
  imports: [TagModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p-tag [value]="label()" [severity]="severity()" [rounded]="true" [icon]="icon()"
    [attr.data-status]="status()" [attr.title]="compact() ? fullLabel() : null" />`
})
export class StudioWorkflowStatusTagComponent {
  readonly status = input.required<WorkflowInstanceStatus>();
  readonly compact = input(false);   // icône seule + title si vrai (colonne étroite)

  /** Libellé FR complet (aussi utilisé en `title` en mode compact). */
  protected readonly fullLabel = computed(() => STUDIO_WORKFLOW_LABELS.instanceStatus[this.status()] ?? this.status());
  protected readonly label = computed(() => this.compact() ? '' : this.fullLabel());
  protected readonly severity = computed(() => instanceStatusSeverity(this.status()));
  protected readonly icon = computed(() => STATUS_ICONS[this.status()]);
}
