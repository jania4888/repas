import { ChangeDetectionStrategy, Component, computed, effect, inject, input, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { AuthService } from '@core/services/auth.service';
import { TenantUsersService } from '@core/services/tenant-users.service';
import { STUDIO_WORKFLOW_LABELS } from '../studio-workflow-labels';
import type { WorkflowRecipient } from '../studio-workflows.models';

/**
 * Sélecteur de destinataire d'une étape de workflow (4.4c1) : utilisateur, rôle tenant ou
 * « la personne qui a lancé » (`startedBy`, réservé à `notify.to` via `allowStartedBy` ;
 * `approval.assignee` l'exclut — D-44-13). La liste des utilisateurs n'est appelée que pour
 * un administrateur (`TenantUsersController` `[Authorize(Roles = Administrator)]` l.21 —
 * D-44-16) ; sinon saisie libre du Guid. Les 11 rôles proposés sont les rôles tenant
 * (`STUDIO_WORKFLOW_LABELS.roles` ; rôles cabinet exclus — D-44-13).
 */
@Component({
  selector: 'app-studio-assignee-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, InputTextModule, SelectModule],
  template: `
    <div class="sap" data-testid="assignee-picker">
      <p-select [options]="kindOptions()" [ngModel]="value()?.kind ?? null" (ngModelChange)="setKind($event)"
        optionLabel="label" optionValue="value" [disabled]="disabled()" appendTo="body" panelStyleClass="studio-theme"
        styleClass="sap__w" data-testid="assignee-kind" [attr.aria-label]="L.assignee.user" />
      @switch (value()?.kind) {
        @case ('user') {
          @if (canListUsers()) {
            <p-select [options]="userOptions()" [ngModel]="value()?.value ?? null" (ngModelChange)="setValue($event)"
              optionLabel="label" optionValue="value" [filter]="true" [showClear]="true" [disabled]="disabled()"
              appendTo="body" panelStyleClass="studio-theme" styleClass="sap__w" data-testid="assignee-user"
              [placeholder]="L.assignee.pickUser" [attr.aria-label]="L.assignee.pickUser" />
          } @else {
            <input pInputText class="sap__w" [ngModel]="value()?.value ?? ''" (ngModelChange)="setValue($event || null)"
              [disabled]="disabled()" data-testid="assignee-user-id" [placeholder]="L.assignee.pickUser"
              [attr.aria-label]="L.assignee.pickUser" autocomplete="off" />
            <small class="sap__hint">{{ L.assignee.userIdHint }}</small>
          }
        }
        @case ('role') {
          <p-select [options]="roleOptions" [ngModel]="value()?.value ?? null" (ngModelChange)="setValue($event)"
            optionLabel="label" optionValue="value" [showClear]="true" [disabled]="disabled()"
            appendTo="body" panelStyleClass="studio-theme" styleClass="sap__w" data-testid="assignee-role"
            [placeholder]="L.assignee.pickRole" [attr.aria-label]="L.assignee.pickRole" />
        }
      }
    </div>
  `,
  styles: [`
    .sap { display: flex; flex-direction: column; gap: .35rem; }
    .sap__hint { color: var(--text-color-secondary); font-size: .75rem; }
    :host ::ng-deep .sap__w { width: 100%; }
  `]
})
export class StudioAssigneePickerComponent {
  readonly value = model<WorkflowRecipient | null>(null);
  readonly allowStartedBy = input(false);          // notify.to : true ; approval.assignee : false
  readonly disabled = input(false);

  private readonly users = inject(TenantUsersService);
  private readonly auth = inject(AuthService);
  private usersLoaded = false;

  protected readonly L = STUDIO_WORKFLOW_LABELS;
  protected readonly kindOptions = computed(() => [
    { label: this.L.assignee.user, value: 'user' },
    { label: this.L.assignee.role, value: 'role' },
    ...(this.allowStartedBy() ? [{ label: this.L.assignee.startedBy, value: 'startedBy' }] : [])
  ]);
  /** Valeurs = noms exacts de l'enum UserRole (Enum.TryParse ignoreCase:false, D-44-13). */
  protected readonly roleOptions = Object.entries(STUDIO_WORKFLOW_LABELS.roles).map(([value, label]) => ({ label, value }));
  protected readonly userOptions = signal<{ label: string; value: string }[]>([]);
  protected readonly canListUsers = computed(() => this.auth.isAdmin());   // D-44-16

  constructor() {
    effect(() => { if (this.value()?.kind === 'user' && this.canListUsers() && !this.usersLoaded) this.loadUsers(); });
  }

  protected setKind(kind: WorkflowRecipient['kind']): void { this.value.set(kind === 'startedBy' ? { kind } : { kind, value: null }); }
  protected setValue(v: string | null): void { const cur = this.value(); if (cur) this.value.set({ ...cur, value: v }); }

  private loadUsers(): void {
    this.usersLoaded = true;
    this.users.list().subscribe({
      next: r => this.userOptions.set((r.data ?? []).filter(u => u.isActive).map(u => ({ label: `${u.firstName} ${u.lastName} (${u.email})`, value: u.id }))),
      error: () => this.userOptions.set([])
    });
  }
}
