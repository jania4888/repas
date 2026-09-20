import { AppModule } from '@core/models/app-module';
import {
  MODULES_REQUIRED_BY_FIRST_SEGMENT,
  PERMISSIONS_ALL_REQUIRED_BY_FIRST_SEGMENT
} from './layout-module-policy';

describe('layout-module-policy — return-notes', () => {
  it('requires the Sales module and return_notes:read', () => {
    expect(MODULES_REQUIRED_BY_FIRST_SEGMENT['return-notes']).toEqual([AppModule.Sales]);
    expect(PERMISSIONS_ALL_REQUIRED_BY_FIRST_SEGMENT['return-notes']).toEqual(['return_notes:read']);
  });
});

describe('layout-module-policy — projects', () => {
  it('requires the Projects module and projects:read', () => {
    expect(MODULES_REQUIRED_BY_FIRST_SEGMENT['projects']).toEqual([AppModule.Projects]);
    expect(PERMISSIONS_ALL_REQUIRED_BY_FIRST_SEGMENT['projects']).toEqual(['projects:read']);
  });
});

describe('layout-module-policy — ai-assistant', () => {
  it('requires the AI module and ai:chat (route accessible ⇔ menu visible ⇔ API autorisée)', () => {
    // Aligné avec l'entrée du menu (`app-navigation.registry.ts`, permissionsAll: ['ai:chat'])
    // et le garde de la coquille IA (`canUseAiAssistant`, main-layout.component.ts).
    expect(MODULES_REQUIRED_BY_FIRST_SEGMENT['ai-assistant']).toEqual([AppModule.AI]);
    expect(PERMISSIONS_ALL_REQUIRED_BY_FIRST_SEGMENT['ai-assistant']).toEqual(['ai:chat']);
  });
});

describe('layout-module-policy — stock vouchers (sous /stock)', () => {
  it('keeps BE/BS under the Stock module and stock:read (no dedicated first segment)', () => {
    expect(MODULES_REQUIRED_BY_FIRST_SEGMENT['stock']).toEqual([AppModule.Stock]);
    expect(PERMISSIONS_ALL_REQUIRED_BY_FIRST_SEGMENT['stock']).toEqual(['stock:read']);
    expect(MODULES_REQUIRED_BY_FIRST_SEGMENT['entries']).toBeUndefined();
    expect(MODULES_REQUIRED_BY_FIRST_SEGMENT['issues']).toBeUndefined();
  });
});

// Phase 2 (plan §4.4): audit of every routed first segment in app.routes.ts against the module
// policy map — these five were routed but missing an entry (moduleGuard silently let any
// authenticated user through regardless of their module grants).
describe('layout-module-policy — Phase 2 audit: previously-missing routed segments', () => {
  it('gates sales-orders behind Sales + sales_orders:read', () => {
    expect(MODULES_REQUIRED_BY_FIRST_SEGMENT['sales-orders']).toEqual([AppModule.Sales]);
    expect(PERMISSIONS_ALL_REQUIRED_BY_FIRST_SEGMENT['sales-orders']).toEqual(['sales_orders:read']);
  });

  it('gates pricing behind Sales + pricing:read', () => {
    expect(MODULES_REQUIRED_BY_FIRST_SEGMENT['pricing']).toEqual([AppModule.Sales]);
    expect(PERMISSIONS_ALL_REQUIRED_BY_FIRST_SEGMENT['pricing']).toEqual(['pricing:read']);
  });

  it('gates forecasting behind Forecasting + forecasting:view', () => {
    expect(MODULES_REQUIRED_BY_FIRST_SEGMENT['forecasting']).toEqual([AppModule.Forecasting]);
    expect(PERMISSIONS_ALL_REQUIRED_BY_FIRST_SEGMENT['forecasting']).toEqual(['forecasting:view']);
  });

  it('gates studio behind Studio + custom_records:read (D11 lifted in 4.5)', () => {
    expect(MODULES_REQUIRED_BY_FIRST_SEGMENT['studio']).toEqual([AppModule.Studio]);
    expect(PERMISSIONS_ALL_REQUIRED_BY_FIRST_SEGMENT['studio']).toEqual(['custom_records:read']);
  });

  it('gates recurring-contracts behind RecurringContracts + recurring_contracts:read', () => {
    expect(MODULES_REQUIRED_BY_FIRST_SEGMENT['recurring-contracts']).toEqual([AppModule.RecurringContracts]);
    expect(PERMISSIONS_ALL_REQUIRED_BY_FIRST_SEGMENT['recurring-contracts']).toEqual(['recurring_contracts:read']);
  });

  it('leaves documentation/exchanges/firm unrestricted by design (dedicated guards, no matching AppModule)', () => {
    expect(MODULES_REQUIRED_BY_FIRST_SEGMENT['documentation']).toBeUndefined();
    expect(MODULES_REQUIRED_BY_FIRST_SEGMENT['exchanges']).toBeUndefined();
    expect(MODULES_REQUIRED_BY_FIRST_SEGMENT['firm']).toBeUndefined();
  });
});
