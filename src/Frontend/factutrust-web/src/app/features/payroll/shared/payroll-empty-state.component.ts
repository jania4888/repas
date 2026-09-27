import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { SkeletonTableComponent, type SkeletonColumn } from '@shared/components/skeleton/skeleton-table.component';

@Component({
  selector: 'app-payroll-empty-state',
  standalone: true,
  imports: [CommonModule, EmptyStateComponent, SkeletonTableComponent],
  template: `
    @if (loading) {
      <app-skeleton-table [rows]="skeletonRows" [columns]="skeletonColumnsDef" />
    } @else {
      <app-empty-state
        [icon]="icon"
        [title]="title"
        [description]="description"
        [showAction]="showAction"
        [actionLabel]="actionLabel"
        [actionRoute]="actionRoute"
        (actionClick)="actionClick.emit()" />
    }
  `
})
export class PayrollEmptyStateComponent {
  @Input() loading = false;
  @Input() icon = 'pi-inbox';
  @Input() title = $localize`:@@payroll.payroll-empty-state.ts.aucune.donnee.434e5488:Aucune donnée`;
  @Input() description?: string;
  @Input() showAction = false;
  @Input() actionLabel?: string;
  @Input() actionRoute?: string;
  @Input() skeletonRows = 5;
  @Input() skeletonColumns = 4;
  @Output() actionClick = new EventEmitter<void>();

  get skeletonColumnsDef(): SkeletonColumn[] {
    return Array.from({ length: this.skeletonColumns }, () => ({ width: '100%' }));
  }
}
