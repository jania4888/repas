import { Component, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PosDualScreenService, CustomerDisplayState } from '../../services/pos-dual-screen.service';

@Component({
  selector: 'app-customer-display',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="customer-display">
      <div class="customer-display__header">
        <h1 class="customer-display__title" i18n="@@pos.components.instafact.ff6221f4">InstaFact</h1>
        <p class="customer-display__client">{{ state().clientName || 'Client passager' }}</p>
      </div>

      <div class="customer-display__lines">
        @for (line of state().lines; track line.designation + line.quantity) {
          <div class="customer-display__line">
            <span class="customer-display__line-name">{{ line.designation }}</span>
            <span class="customer-display__line-qty">x{{ line.quantity }}</span>
            <span class="customer-display__line-total">{{ formatAmount(line.totalTTC) }} TND</span>
          </div>
        }
      </div>

      <div class="customer-display__total">
        <span i18n="@@pos.components.total.b25928c6">Total</span>
        <span class="customer-display__total-value">{{ formatAmount(state().totalTTC) }} TND</span>
      </div>
    </div>
  `,
  styles: [`
    .customer-display {
      min-height: 100vh;
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      color: var(--color-white);
      padding: var(--spacing-8);
      font-family: var(--font-family);
    }

    .customer-display__header {
      text-align: center;
      margin-bottom: var(--spacing-8);
    }

    .customer-display__title {
      font-size: 2.5rem;
      font-weight: var(--font-weight-bold);
      margin: 0 0 var(--spacing-2) 0;
      letter-spacing: -0.02em;
    }

    .customer-display__client {
      font-size: 1.25rem;
      opacity: 0.8;
      margin: 0;
    }

    .customer-display__lines {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-4);
      margin-bottom: var(--spacing-8);
    }

    .customer-display__line {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: var(--spacing-4);
      background: rgba(255, 255, 255, 0.08);
      border-radius: var(--radius-xl);
      font-size: 1.5rem;
    }

    .customer-display__line-name {
      flex: 1;
    }

    .customer-display__line-qty {
      opacity: 0.8;
      margin: 0 var(--spacing-4);
    }

    .customer-display__line-total {
      font-weight: var(--font-weight-bold);
      font-variant-numeric: tabular-nums;
    }

    .customer-display__total {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: var(--spacing-6);
      background: rgba(26, 92, 76, 0.4);
      border-radius: var(--radius-2xl);
      font-size: 2rem;
      font-weight: var(--font-weight-bold);
    }

    .customer-display__total-value {
      font-size: 2.5rem;
      font-variant-numeric: tabular-nums;
    }
  `]
})
export class CustomerDisplayComponent implements OnInit, OnDestroy {
  state = signal<CustomerDisplayState>({
    lines: [],
    totalTTC: 0,
    clientName: 'Client passager'
  });

  private channel: BroadcastChannel | null = null;

  ngOnInit(): void {
    this.channel = new BroadcastChannel('pos-customer-display');
    this.channel.onmessage = (e: MessageEvent<CustomerDisplayState>) => {
      this.state.set(e.data);
    };
  }

  ngOnDestroy(): void {
    this.channel?.close();
  }

  formatAmount(amount: number): string {
    return amount.toLocaleString('fr-TN', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3
    });
  }
}
