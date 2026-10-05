import { TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { provideRouter, Router } from '@angular/router';
import { LayoutRouteService } from './layout-route.service';

@Component({ standalone: true, template: '' })
class StubComponent {}

describe('LayoutRouteService', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          {
            path: 'invoices',
            children: [
              { path: '', component: StubComponent },
              {
                path: 'new',
                component: StubComponent,
                data: { hideLayout: true, fullWidth: true }
              }
            ]
          },
          { path: 'dashboard', component: StubComponent },
          {
            path: 'firm',
            children: [
              { path: 'dashboard', component: StubComponent },
              {
                path: 'assistant',
                component: StubComponent,
                data: { fullWidth: true, fillPane: true }
              }
            ]
          }
        ])
      ]
    });
  });

  it('returns default flags when route has no layout data', async () => {
    const router = TestBed.inject(Router);
    const service = TestBed.inject(LayoutRouteService);
    await router.navigateByUrl('/dashboard');
    expect(service.flags()).toEqual({ hideLayout: false, fullWidth: false, fillPane: false });
  });

  it('reads hideLayout and fullWidth from leaf route', async () => {
    const router = TestBed.inject(Router);
    const service = TestBed.inject(LayoutRouteService);
    await router.navigateByUrl('/invoices/new');
    expect(service.flags()).toEqual({ hideLayout: true, fullWidth: true, fillPane: false });
  });

  it('returns default flags for parent list route without layout data', async () => {
    const router = TestBed.inject(Router);
    const service = TestBed.inject(LayoutRouteService);
    await router.navigateByUrl('/invoices');
    expect(service.flags()).toEqual({ hideLayout: false, fullWidth: false, fillPane: false });
  });

  it('reads fillPane only from the leaf route', async () => {
    const router = TestBed.inject(Router);
    const service = TestBed.inject(LayoutRouteService);

    await router.navigateByUrl('/firm/assistant');
    expect(service.flags()).toEqual({ hideLayout: false, fullWidth: true, fillPane: true });

    await router.navigateByUrl('/firm/dashboard');
    expect(service.flags()).toEqual({ hideLayout: false, fullWidth: false, fillPane: false });
  });
});