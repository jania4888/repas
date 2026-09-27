import { Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from '@core/services/auth.service';
import { LayoutRouteService } from '@core/layout/layout-route.service';
import { ProductTourLayoutBridge } from './product-tour-layout.bridge';
import { isProductOnboardingUiEnabled, ProductOnboardingApiService } from './product-onboarding.service';
import { ProductTourService } from './product-tour.service';
import { COMPANY_TOUR_STEPS, FIRM_TOUR_STEPS, filterTourSteps } from './product-onboarding.catalog';
import {
  canStartProductTour,
  hasBlockingModalOpen,
  ProductTourStepDef
} from './product-onboarding.models';

@Component({
  selector: 'app-product-tour-host',
  standalone: true,
  template: ''
})
export class ProductTourHostComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly layoutRoute = inject(LayoutRouteService);
  private readonly layout = inject(ProductTourLayoutBridge);
  private readonly api = inject(ProductOnboardingApiService);
  private readonly tour = inject(ProductTourService);
  private readonly destroyRef = inject(DestroyRef);

  private autoStarted = false;
  private replayMode = false;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private lastReplayTick = 0;

  constructor() {
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed()
      )
      .subscribe(() => {
        if (!this.isOnboardingRoute() && this.tour.isActive) {
          this.tour.destroy();
          this.api.isTourRunning.set(false);
        }
        this.scheduleMaybeStart();
      });

    const replayWatch = window.setInterval(() => {
      const tick = this.api.replayTick();
      if (tick > this.lastReplayTick) {
        this.lastReplayTick = tick;
        this.autoStarted = false;
        this.scheduleMaybeStart(true);
      }
      if (!this.auth.user() && this.tour.isActive) {
        this.tour.destroy();
        this.api.isTourRunning.set(false);
        this.autoStarted = false;
      }
    }, 250);
    this.destroyRef.onDestroy(() => {
      window.clearInterval(replayWatch);
      this.clearTimer();
      this.tour.destroy();
      this.api.isTourRunning.set(false);
    });

    queueMicrotask(() => this.scheduleMaybeStart());
  }

  private scheduleMaybeStart(replay = false): void {
    this.clearTimer();
    if (replay) {
      this.replayMode = true;
    }
    this.startTimer = setTimeout(() => this.tryStart(), 350);
  }

  private tryStart(): void {
    if (this.tour.isActive) {
      return;
    }

    const replay = this.replayMode;
    if (!canStartProductTour({
      uiEnabled: isProductOnboardingUiEnabled(),
      isReplay: replay,
      status: this.auth.user()?.productOnboardingStatus,
      hideLayout: this.layoutRoute.flags().hideLayout,
      isDelegated: this.auth.isDelegatedMode(),
      isOnboardingRoute: this.isOnboardingRoute(),
      hasBlockingModal: hasBlockingModalOpen(),
      hasNavItems: this.layout.hasNavItems()
    })) {
      return;
    }

    if (!replay && this.autoStarted) {
      return;
    }

    this.replayMode = false;

    const compact = typeof window !== 'undefined' && window.innerWidth < 768;
    this.layout.expandSidebar();
    this.layout.closeAiPanel();

    const catalog = this.auth.isAccountingFirm() ? FIRM_TOUR_STEPS : COMPANY_TOUR_STEPS;
    const steps = this.localizeWelcome(
      filterTourSteps(catalog, {
        compact,
        elementExists: selector => !!document.querySelector(selector)
      }).filter(step => step.id !== 'ai-fab')
    );
    if (steps.length === 0) {
      return;
    }

    this.autoStarted = true;
    this.api.isTourRunning.set(true);

    if (!replay && this.auth.user()?.productOnboardingStatus === 'NotStarted') {
      this.api.patch({ status: 'InProgress' }).subscribe();
    }

    let previousSection: string | null = null;
    this.tour.start({
      steps,
      isReplay: replay,
      onExpandNav: tourId => {
        previousSection = this.layout.expandNavSection(tourId);
      },
      onRestoreNav: () => this.layout.restoreNavSection(previousSection),
      onSkip: () => {
        this.api.isTourRunning.set(false);
        if (!replay) {
          this.api.patch({ status: 'Dismissed' }).subscribe();
        }
      },
      onComplete: () => {
        this.api.isTourRunning.set(false);
        this.api.patch({ status: 'Completed' }).subscribe();
      }
    });
  }

  private localizeWelcome(steps: ProductTourStepDef[]): ProductTourStepDef[] {
    const companyName = this.auth.user()?.companyName?.trim();
    return steps.map(step => {
      if (step.id !== 'welcome') {
        return step;
      }
      if (this.auth.isAccountingFirm()) {
        return {
          ...step,
          description:
            $localize`:@@core.product-tour-host.ts.bienvenue.dans.votre.espace.cabinet.voic.6bceb745:Bienvenue dans votre espace cabinet. Voici les fonctions essentielles — 2 minutes.`
        };
      }
      if (!companyName) {
        return step;
      }
      return {
        ...step,
        description: $localize`:@@core.product-tour-host.ts.bienvenue.dans.companyname.voici.les.fon.f12dd394:Bienvenue dans ${companyName}:companyName:. Voici les fonctions essentielles — 2 minutes.`
      };
    });
  }

  private isOnboardingRoute(): boolean {
    const url = this.router.url.split('?')[0];
    if (this.auth.isAccountingFirm()) {
      return url === '/firm/dashboard' || url.startsWith('/firm/dashboard/');
    }
    return url === '/dashboard' || url.startsWith('/dashboard/');
  }

  private clearTimer(): void {
    if (this.startTimer) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }
  }
}
