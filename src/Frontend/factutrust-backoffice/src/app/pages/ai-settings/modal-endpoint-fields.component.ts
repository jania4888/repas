import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { InputTextModule } from 'primeng/inputtext';

@Component({
  selector: 'app-modal-endpoint-fields',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, ToggleSwitchModule, InputTextModule],
  template: `
    <div class="field field-row">
      <label [attr.for]="idPrefix() + '-enabled'">Activer Modal</label>
      <p-toggleswitch
        [inputId]="idPrefix() + '-enabled'"
        [ngModel]="enabled()"
        (ngModelChange)="enabled.set($event)"
        [disabled]="disabled()" />
    </div>
    <div class="field">
      <label [attr.for]="idPrefix() + '-display'">Nom affiché</label>
      <input
        [id]="idPrefix() + '-display'"
        type="text"
        pInputText
        class="w-full"
        [ngModel]="displayName()"
        (ngModelChange)="displayName.set($event)"
        [disabled]="disabled()" />
    </div>
    <div class="field">
      <label [attr.for]="idPrefix() + '-base'">URL de base</label>
      <input
        [id]="idPrefix() + '-base'"
        type="url"
        pInputText
        class="w-full"
        [ngModel]="baseUrl()"
        (ngModelChange)="baseUrl.set($event)"
        [placeholder]="urlPlaceholder()"
        [disabled]="disabled()" />
      <small class="hint">Doit être en HTTPS et se terminer par /v1 (sans /chat/completions).</small>
    </div>
    <div class="field">
      <label [attr.for]="idPrefix() + '-token-id'">Token ID</label>
      <input
        [id]="idPrefix() + '-token-id'"
        type="text"
        pInputText
        class="w-full"
        autocomplete="off"
        [ngModel]="tokenId()"
        (ngModelChange)="tokenId.set($event)"
        placeholder="wk-…"
        [disabled]="disabled()" />
    </div>
    <div class="field">
      <label [attr.for]="idPrefix() + '-token-secret'">Token secret</label>
      <input
        [id]="idPrefix() + '-token-secret'"
        type="password"
        pInputText
        class="w-full"
        autocomplete="off"
        [ngModel]="tokenSecret()"
        (ngModelChange)="tokenSecret.set($event)"
        [placeholder]="keyPlaceholder()"
        [disabled]="disabled()" />
      @if (apiKeyConfigured()) {
        <small class="hint">Token configuré (se termine par …{{ apiKeyLast4() }})</small>
      }
    </div>
    @if (warning()) {
      <p class="warn">{{ warning() }}</p>
    }
  `,
  styles: [
    `
      .field {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        margin-bottom: 0.75rem;
      }
      .field-row {
        flex-direction: row;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
      }
      .field label {
        font-size: 0.78rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--ft-text-muted);
        font-weight: 600;
      }
      .hint {
        margin: 0.15rem 0 0;
        font-size: 0.8rem;
        color: var(--ft-text-muted);
        line-height: 1.45;
      }
      .warn {
        margin: 0.65rem 0 0;
        font-size: 0.85rem;
        color: var(--ft-warning);
        line-height: 1.5;
      }
      :host ::ng-deep .w-full {
        width: 100%;
      }
    `
  ]
})
export class ModalEndpointFieldsComponent {
  readonly idPrefix = input('modal');
  readonly enabled = model(false);
  readonly displayName = model('');
  readonly baseUrl = model('');
  readonly tokenId = model('');
  readonly tokenSecret = model('');
  readonly apiKeyConfigured = input(false);
  readonly apiKeyLast4 = input<string | null>(null);
  readonly urlPlaceholder = input('');
  readonly warning = input<string | null>(null);
  readonly disabled = input(false);

  protected keyPlaceholder(): string {
    return this.apiKeyConfigured()
      ? `••••••••${this.apiKeyLast4() ?? ''}`
      : 'ws-…';
  }
}
