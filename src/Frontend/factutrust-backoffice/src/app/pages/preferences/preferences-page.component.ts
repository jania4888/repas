import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { MessageService } from 'primeng/api';
import {
  PlatformPreferencesService,
  type TableDensity
} from '@core/services/platform-preferences.service';
import { FtPageHeaderComponent } from '@core/ui/page-header/ft-page-header.component';

@Component({
  selector: 'app-preferences-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    ButtonModule,
    SelectModule,
    ToggleSwitchModule,
    FtPageHeaderComponent
  ],
  template: `
    <ft-page-header title="Préférences" subtitle="Personnalisez votre expérience dans le backoffice plateforme.">
      <ng-container ftActions>
        <p-button label="Retour" icon="pi pi-arrow-left" [outlined]="true" routerLink="/tenants" />
      </ng-container>
    </ft-page-header>

    <article class="prefs-card">
      <section class="pref-row">
        <div>
          <h2>Densité des tableaux</h2>
          <p class="muted">Ajuste l'espacement des lignes dans les listes et tableaux.</p>
        </div>
        <p-select
          [options]="densityOptions"
          [(ngModel)]="tableDensity"
          optionLabel="label"
          optionValue="value"
          (ngModelChange)="onDensityChange($event)"
          styleClass="ft-dd"
        />
      </section>

      <section class="pref-row">
        <div>
          <h2>Confirmation avant déconnexion</h2>
          <p class="muted">Demande une confirmation lorsque vous cliquez sur « Déconnexion ».</p>
        </div>
        <p-toggleswitch [(ngModel)]="confirmLogout" (ngModelChange)="onConfirmLogoutChange($event)" />
      </section>

      <div class="prefs-actions">
        <p-button label="Réinitialiser" icon="pi pi-refresh" [outlined]="true" (onClick)="reset()" />
      </div>
    </article>
  `,
  styles: [
    `
      .prefs-card {
        background: var(--ft-surface);
        border: 1px solid var(--ft-border);
        border-radius: var(--ft-radius);
        padding: var(--gap-lg);
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
      }
      .pref-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        padding-bottom: 1rem;
        border-bottom: 1px solid var(--ft-border);
      }
      .pref-row:last-of-type {
        border-bottom: none;
        padding-bottom: 0;
      }
      .pref-row h2 {
        margin: 0;
        font-size: 1rem;
      }
      .muted {
        margin: 0.25rem 0 0;
        color: var(--ft-text-muted);
        font-size: 0.85rem;
      }
      .prefs-actions {
        display: flex;
        justify-content: flex-end;
      }
    `
  ]
})
export class PreferencesPageComponent {
  private readonly prefs = inject(PlatformPreferencesService);
  private readonly messages = inject(MessageService);

  readonly densityOptions = [
    { label: 'Normal', value: 'normal' as TableDensity },
    { label: 'Compact', value: 'compact' as TableDensity }
  ];

  tableDensity: TableDensity = this.prefs.tableDensity();
  confirmLogout = this.prefs.confirmLogout();

  onDensityChange(value: TableDensity): void {
    this.prefs.update({ tableDensity: value });
    document.documentElement.dataset['tableDensity'] = value;
    this.messages.add({ severity: 'success', summary: 'Préférences', detail: 'Densité enregistrée.' });
  }

  onConfirmLogoutChange(value: boolean): void {
    this.prefs.update({ confirmLogout: value });
    this.messages.add({ severity: 'info', summary: 'Préférences', detail: 'Préférence de déconnexion enregistrée.' });
  }

  reset(): void {
    this.prefs.reset();
    this.tableDensity = this.prefs.tableDensity();
    this.confirmLogout = this.prefs.confirmLogout();
    document.documentElement.dataset['tableDensity'] = this.tableDensity;
    this.messages.add({ severity: 'info', summary: 'Préférences', detail: 'Préférences réinitialisées.' });
  }
}
