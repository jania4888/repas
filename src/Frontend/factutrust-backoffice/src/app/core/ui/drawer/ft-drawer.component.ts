import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnDestroy, Output, inject } from '@angular/core';
import { DrawerModule } from 'primeng/drawer';
import { ButtonModule } from 'primeng/button';
import { FtOverlayCleanupService } from '@core/services/ft-overlay-cleanup.service';

/**
 * Drawer latéral droit, wrappant `p-drawer` avec un look unifié.
 *
 * Usage :
 *  ```html
 *  <ft-drawer [(visible)]="open"
 *             title="Détails de l'entreprise"
 *             subtitle="ACME SARL"
 *             [width]="'520px'">
 *    <p>Contenu</p>
 *    <ng-container ftFooter>
 *      <p-button label="Voir page complète" />
 *    </ng-container>
 *  </ft-drawer>
 *  ```
 */
@Component({
  selector: 'ft-drawer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DrawerModule, ButtonModule],
  template: `
    <p-drawer
      [visible]="visible"
      (visibleChange)="onVisibleChange($event)"
      position="right"
      [style]="{ width: width, maxWidth: '100vw' }"
      [showCloseIcon]="false"
      [dismissible]="dismissible"
      [modal]="true"
      styleClass="ft-drawer-host"
    >
      <header class="drawer__head">
        <div class="drawer__titles">
          <h2 class="drawer__title">{{ title }}</h2>
          @if (subtitle) {
            <p class="drawer__subtitle">{{ subtitle }}</p>
          }
        </div>
        <p-button
          icon="pi pi-times"
          [text]="true"
          [rounded]="true"
          severity="secondary"
          ariaLabel="Fermer"
          (onClick)="onClose()"
        />
      </header>
      <section class="drawer__body">
        <ng-content />
      </section>
      <footer class="drawer__foot">
        <ng-content select="[ftFooter]" />
      </footer>
    </p-drawer>
  `,
  styles: [
    `
      :host ::ng-deep .ft-drawer-host {
        background: var(--ft-surface) !important;
        border-left: 1px solid var(--ft-border) !important;
        color: var(--ft-text) !important;
      }

      :host ::ng-deep .ft-drawer-host .p-drawer-content {
        padding: 0;
        display: flex;
        flex-direction: column;
        height: 100%;
      }

      .drawer__head {
        display: flex;
        align-items: flex-start;
        gap: var(--gap-md);
        padding: var(--gap-md) var(--gap-lg);
        border-bottom: 1px solid var(--ft-border);
        position: sticky;
        top: 0;
        background: var(--ft-surface);
        z-index: 1;
      }

      .drawer__titles {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
      }

      .drawer__title {
        margin: 0;
        font-size: 1.05rem;
        font-weight: 600;
        color: var(--ft-text);
      }

      .drawer__subtitle {
        margin: 0;
        font-size: 0.85rem;
        color: var(--ft-text-muted);
      }

      .drawer__body {
        flex: 1;
        overflow-y: auto;
        padding: var(--gap-lg);
      }

      .drawer__foot:not(:empty) {
        padding: var(--gap-md) var(--gap-lg);
        border-top: 1px solid var(--ft-border);
        display: flex;
        gap: var(--gap-xs);
        justify-content: flex-end;
        background: var(--ft-surface);
      }
    `
  ]
})
export class FtDrawerComponent implements OnDestroy {
  @Input() visible = false;
  @Output() visibleChange = new EventEmitter<boolean>();
  @Input({ required: true }) title = '';
  @Input() subtitle: string | null = null;
  @Input() width = '480px';
  @Input() dismissible = true;

  private readonly overlayCleanup = inject(FtOverlayCleanupService);

  ngOnDestroy(): void {
    this.visible = false;
    this.overlayCleanup.clearOrphanOverlays();
  }

  onVisibleChange(value: boolean): void {
    this.visible = value;
    this.visibleChange.emit(value);
    if (!value) {
      this.overlayCleanup.clearOrphanOverlays();
    }
  }

  onClose(): void {
    this.onVisibleChange(false);
  }
}
