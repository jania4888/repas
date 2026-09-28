import { Component, inject, signal, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap, finalize } from 'rxjs/operators';
import { ClientService, ClientListItem } from '@core/services/client.service';
import { PosStateService } from '../../services/pos-state.service';
import { POS_PASSENGER_CLIENT_EMAIL } from '../../constants/pos-client.constants';

@Component({
  selector: 'app-client-selector',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="client-selector">
      <div class="client-selector__header">
        <span class="client-selector__label" i18n="@@pos.components.client.1bdd79b1">Client</span>
        @if (posState.client()) {
          <button class="client-selector__clear" (click)="clearClient()" title="Client passager" i18n-title="@@pos.components.client.passager.c0cf7273">
            <i class="pi pi-times"></i>
          </button>
        }
      </div>

      @if (posState.client(); as client) {
        <div class="client-selector__selected">
          <i class="pi pi-check-circle client-selector__selected-check"></i>
          <div class="client-selector__avatar">
            <i class="pi pi-user"></i>
          </div>
          <div class="client-selector__client-info">
            <span class="client-selector__client-name">{{ client.name }}</span>
            @if (client.nif) {
              <span class="client-selector__client-nif">{{ client.nif }}</span>
            }
            @if (posState.clientOutstanding(); as out) {
              <span class="client-selector__outstanding" [class.client-selector__outstanding--over]="out.isOverLimit"><ng-container i18n="@@pos.components.encours.tnd.41261043">
                Encours {{ posState.formatAmount(out.totalOutstanding) }} TND
                </ng-container>@if (out.creditLimit != null) {<ng-container i18n="@@pos.components.plafond.61dd3dd1">
                  / plafond {{ posState.formatAmount(out.creditLimit) }}
                </ng-container>}
                @if (out.isOverLimit) {<ng-container i18n="@@pos.components.plafond.depasse.e83bd54a">
                  — plafond dépassé
                </ng-container>}
              </span>
            }
          </div>
          <button class="client-selector__edit" (click)="openSearch()" title="Changer de client" i18n-title="@@pos.components.changer.de.client.b170ee3b">
            <i class="pi pi-pencil"></i>
          </button>
        </div>
      } @else {
        <button class="client-selector__walkin" (click)="openSearch()">
          <div class="client-selector__walkin-icon">
            <i class="pi pi-user"></i>
          </div>
          <div class="client-selector__walkin-info">
            <span class="client-selector__walkin-label" i18n="@@pos.components.client.passager.c0cf7273">Client passager</span>
            <span class="client-selector__walkin-hint" i18n="@@pos.components.cliquez.pour.selectionner.un.client.33e3e8cb">Cliquez pour selectionner un client</span>
          </div>
          <i class="pi pi-chevron-right client-selector__walkin-arrow"></i>
        </button>
      }

      @if (isSearchOpen()) {
        <div class="client-selector__dropdown" (click)="closeSearch()">
          <div class="client-selector__dropdown-content" (click)="$event.stopPropagation()">
            <div class="client-selector__dropdown-search">
              <i class="pi pi-search"></i>
              <input
                #clientSearchInput
                type="text"
                placeholder="Rechercher par nom, NIF, email ou code CLI-..." i18n-placeholder="@@pos.components.rechercher.par.nom.nif.email.ou.code.cli.035fe923"
                [ngModel]="searchQuery()"
                (ngModelChange)="onSearchChange($event)"
                (keydown.escape)="closeSearch()"
                class="client-selector__dropdown-input" />
            </div>

            <div class="client-selector__dropdown-list">
              @if (searching()) {
                <div class="client-selector__dropdown-loading">
                  <i class="pi pi-spin pi-spinner"></i>
                  <span i18n="@@pos.components.recherche.en.cours.4d9c778d">Recherche en cours...</span>
                </div>
              } @else if (results().length === 0 && searchQuery()) {
                <div class="client-selector__dropdown-empty">
                  <i class="pi pi-users"></i>
                  <span i18n="@@pos.components.aucun.client.trouve.75476dc7">Aucun client trouve</span>
                  <span class="client-selector__dropdown-empty-hint" i18n="@@pos.components.essayez.avec.un.autre.terme.de.recherche.4a727703">Essayez avec un autre terme de recherche</span>
                </div>
              } @else {
                @for (client of results(); track client.id) {
                  <button class="client-selector__dropdown-item" (click)="selectClient(client)">
                    <div class="client-selector__dropdown-avatar">
                      <i class="pi pi-user"></i>
                    </div>
                    <div class="client-selector__dropdown-details">
                      <span class="client-selector__dropdown-name">{{ client.name }}</span>
                      <span class="client-selector__dropdown-meta">
                        {{ client.email }}
                        @if (client.nif) {
                          <span> &middot; {{ client.nif }}</span>
                        }
                      </span>
                    </div>
                  </button>
                }
              }
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .client-selector {
      position: relative;
    }

    .client-selector__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: var(--spacing-2);
    }

    .client-selector__label {
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-tertiary);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .client-selector__clear {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border: none;
      border-radius: var(--radius-md);
      background: transparent;
      color: var(--color-text-tertiary);
      cursor: pointer;
      font-size: 0.65rem;
      transition: all var(--transition-fast);
    }

    .client-selector__clear:hover {
      background: var(--color-neutral-100);
      color: var(--color-text-secondary);
    }

    .client-selector__selected {
      display: flex;
      align-items: center;
      gap: var(--spacing-3);
      padding: var(--spacing-3);
      border: 1px solid var(--color-success-200);
      border-radius: var(--radius-xl);
      background: var(--color-white);
      box-shadow: 0 0 0 1px var(--color-success-100);
    }

    .client-selector__avatar {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 34px;
      height: 34px;
      border-radius: var(--radius-full);
      background: var(--color-primary-50);
      color: var(--color-primary-600);
      font-size: 0.85rem;
      flex-shrink: 0;
    }

    .client-selector__client-info {
      display: flex;
      flex-direction: column;
      min-width: 0;
      flex: 1;
    }

    .client-selector__client-name {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .client-selector__outstanding {
      font-size: var(--font-size-xs);
      color: var(--color-text-tertiary);
    }

    .client-selector__outstanding--over {
      color: var(--color-danger);
      font-weight: var(--font-weight-medium);
    }

    .client-selector__client-nif {
      font-size: var(--font-size-xs);
      color: var(--color-text-tertiary);
      font-variant-numeric: tabular-nums;
    }

    .client-selector__edit {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      border: none;
      border-radius: var(--radius-md);
      background: var(--color-neutral-100);
      color: var(--color-text-tertiary);
      cursor: pointer;
      transition: all 200ms ease;
      font-size: 0.75rem;
    }

    .client-selector__edit:hover {
      background: var(--color-neutral-200);
      color: var(--color-primary-600);
    }

    .client-selector__walkin {
      display: flex;
      align-items: center;
      gap: var(--spacing-3);
      width: 100%;
      padding: var(--spacing-4);
      border: 1px solid var(--color-border-subtle);
      border-radius: var(--radius-xl);
      background: var(--color-neutral-50);
      cursor: pointer;
      transition: all 300ms ease;
      text-align: start;
      font-family: var(--font-family);
    }

    .client-selector__walkin:hover {
      border-color: var(--color-primary-200);
      background: var(--color-primary-50);
    }

    .client-selector__walkin:hover .client-selector__walkin-icon {
      background: var(--color-primary-100);
      color: var(--color-primary-600);
    }

    .client-selector__walkin-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      border-radius: var(--radius-full);
      background: #3b82f6;
      color: var(--color-white);
      font-size: 1rem;
      flex-shrink: 0;
      transition: all var(--pos-transition-smooth);
    }

    .client-selector__walkin-info {
      display: flex;
      flex-direction: column;
      flex: 1;
    }

    .client-selector__walkin-label {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      color: var(--color-text-secondary);
    }

    .client-selector__walkin-hint {
      font-size: var(--font-size-xs);
      color: var(--color-text-tertiary);
    }

    .client-selector__walkin-arrow {
      color: var(--color-text-tertiary);
      font-size: 0.7rem;
    }

    .client-selector__dropdown {
      position: fixed;
      inset: 0;
      z-index: var(--z-modal);
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding-top: 120px;
      background: rgba(15, 23, 42, 0.3);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      animation: fadeIn 200ms ease-out;
    }

    .client-selector__dropdown-content {
      width: 480px;
      max-height: 440px;
      background: var(--color-white);
      border-radius: var(--radius-2xl);
      box-shadow: var(--shadow-2xl);
      border: 1px solid var(--color-border-subtle);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      animation: scaleInBounce 250ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
    }

    .client-selector__dropdown-search {
      display: flex;
      align-items: center;
      gap: var(--spacing-3);
      height: 48px;
      padding: 0 var(--spacing-4);
      border-bottom: 1px solid var(--color-border-subtle);
    }

    .client-selector__dropdown-search i {
      color: var(--color-text-tertiary);
      font-size: 1rem;
    }

    .client-selector__dropdown-input {
      flex: 1;
      border: none;
      outline: none;
      font-size: var(--font-size-sm);
      font-family: var(--font-family);
      color: var(--color-text-primary);
      background: transparent;
    }

    .client-selector__dropdown-input::placeholder {
      color: var(--color-text-tertiary);
    }

    .client-selector__dropdown-list {
      flex: 1;
      overflow-y: auto;
      max-height: 360px;
    }

    .client-selector__dropdown-loading {
      display: flex;
      flex-direction: row;
      align-items: center;
      justify-content: center;
      gap: var(--spacing-2);
      padding: var(--spacing-10);
      color: var(--color-text-tertiary);
      font-size: var(--font-size-sm);
    }

    .client-selector__dropdown-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--spacing-2);
      padding: var(--spacing-10);
      color: var(--color-text-secondary);
      font-size: var(--font-size-sm);
      text-align: center;
    }

    .client-selector__dropdown-empty i {
      font-size: 2rem;
      color: var(--color-neutral-400);
      margin-bottom: var(--spacing-2);
    }

    .client-selector__dropdown-empty-hint {
      font-size: var(--font-size-xs);
      color: var(--color-text-tertiary);
    }

    .client-selector__dropdown-item {
      display: flex;
      align-items: center;
      gap: var(--spacing-4);
      width: 100%;
      padding: var(--spacing-4) var(--spacing-5);
      border: none;
      border-bottom: 1px solid var(--color-neutral-100);
      background: transparent;
      cursor: pointer;
      transition: background 200ms ease;
      text-align: start;
      font-family: var(--font-family);
    }

    .client-selector__dropdown-item:last-child {
      border-bottom: none;
    }

    .client-selector__dropdown-item:hover {
      background: var(--color-primary-50);
    }

    .client-selector__dropdown-item:hover .client-selector__dropdown-avatar {
      background: var(--color-primary-100);
      color: var(--color-primary-600);
    }

    .client-selector__dropdown-avatar {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      border-radius: var(--radius-full);
      background: var(--color-neutral-100);
      color: var(--color-neutral-500);
      font-size: 0.9rem;
      flex-shrink: 0;
      transition: all 200ms ease;
    }

    .client-selector__dropdown-details {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .client-selector__dropdown-name {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      color: var(--color-text-primary);
    }

    .client-selector__dropdown-meta {
      font-size: var(--font-size-xs);
      color: var(--color-text-tertiary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @media (max-width: 768px) {
      .client-selector__dropdown-content {
        width: calc(100vw - 32px);
      }
    }
  `]
})
export class ClientSelectorComponent implements OnDestroy {
  readonly posState = inject(PosStateService);
  private readonly clientService = inject(ClientService);

  isSearchOpen = signal(false);
  searchQuery = signal('');
  results = signal<ClientListItem[]>([]);
  searching = signal(false);

  private searchSubject = new Subject<string>();
  private subscription?: Subscription;

  constructor() {
    this.subscription = this.searchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap(query => {
        this.searching.set(true);
        return this.clientService.getClients({
          search: query || undefined,
          isActive: true,
          pageSize: 20
        }).pipe(
          finalize(() => this.searching.set(false))
        );
      })
    ).subscribe(response => {
      if (response.success && response.data) {
        const passengerEmail = POS_PASSENGER_CLIENT_EMAIL.trim().toLowerCase();
        const filtered = response.data.items.filter(
          c => (c.email ?? '').trim().toLowerCase() !== passengerEmail
        );
        this.results.set(filtered);
      }
    });
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  openSearch(): void {
    this.isSearchOpen.set(true);
    this.searchQuery.set('');
    this.searchSubject.next('');

    setTimeout(() => {
      const input = document.querySelector('.client-selector__dropdown-input') as HTMLInputElement;
      input?.focus();
    }, 100);
  }

  closeSearch(): void {
    this.isSearchOpen.set(false);
    this.results.set([]);
    this.searchQuery.set('');
  }

  onSearchChange(value: string): void {
    this.searchQuery.set(value);
    this.searchSubject.next(value);
  }

  selectClient(client: ClientListItem): void {
    this.posState.selectClient(client);
    this.posState.applyFirstPurchaseDiscountIfEligible(10);
    this.clientService.getClientOutstanding(client.id).subscribe({
      next: res => {
        if (res.success && res.data) {
          this.posState.setClientOutstanding(res.data);
        }
      },
      error: () => this.posState.setClientOutstanding(null)
    });
    this.closeSearch();
  }

  clearClient(): void {
    this.posState.setWalkInClient();
  }
}
