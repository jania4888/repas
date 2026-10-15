import { TestBed } from '@angular/core/testing';
import { DeskWindowService } from '@core/desk/desk-window.service';
import { pendingChangesGuard } from './pending-changes.guard';
import type { FixedAssetDetailComponent } from './fixed-asset-detail.component';

describe('pendingChangesGuard (T15 / C9)', () => {
  function setup(bypass: boolean): void {
    TestBed.configureTestingModule({
      providers: [{ provide: DeskWindowService, useValue: { bypassesDeactivate: () => bypass } }]
    });
  }

  function run(component: FixedAssetDetailComponent | null): boolean {
    return TestBed.runInInjectionContext(() =>
      pendingChangesGuard(component as FixedAssetDetailComponent, {} as never, {} as never, {} as never)
    ) as boolean;
  }

  it('allows deactivation when the component reports no pending changes', () => {
    setup(false);
    const component = { canDeactivate: () => true } as unknown as FixedAssetDetailComponent;

    expect(run(component)).toBeTrue();
  });

  it('blocks deactivation when the component reports pending changes (user cancels)', () => {
    setup(false);
    const component = { canDeactivate: () => false } as unknown as FixedAssetDetailComponent;

    expect(run(component)).toBeFalse();
  });

  it('allows deactivation when there is no component instance', () => {
    setup(false);
    expect(run(null)).toBeTrue();
  });

  it('laisse passer sans demander confirmation quand le bureau conserve la fenêtre', () => {
    setup(true);
    const canDeactivate = jasmine.createSpy('canDeactivate').and.returnValue(false);
    const component = { canDeactivate } as unknown as FixedAssetDetailComponent;

    expect(run(component)).toBeTrue();
    expect(canDeactivate).not.toHaveBeenCalled();
  });
});
