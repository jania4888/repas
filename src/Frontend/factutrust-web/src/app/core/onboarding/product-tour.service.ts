import { Injectable, inject, NgZone } from '@angular/core';
import { driver } from 'driver.js';
import { ProductTourStepDef } from './product-onboarding.models';

export interface ProductTourRunOptions {
  steps: ProductTourStepDef[];
  isReplay: boolean;
  onExpandNav?: (tourId: string) => void;
  onRestoreNav?: () => void;
  onSkip: () => void;
  onComplete: () => void;
}

interface DriverPopoverDom {
  wrapper?: HTMLElement;
  closeButton?: HTMLElement;
  previousButton?: HTMLElement;
  nextButton?: HTMLElement;
}

const TOUR_Z_OVERLAY = 1118;
const TOUR_Z_POPOVER = 1120;

@Injectable({ providedIn: 'root' })
export class ProductTourService {
  private readonly zone = inject(NgZone);
  private instance: ReturnType<typeof driver> | null = null;
  private restoreNav: (() => void) | null = null;
  private finishing = false;

  get isActive(): boolean {
    return this.instance !== null;
  }

  start(options: ProductTourRunOptions): void {
    this.destroy();
    if (options.steps.length === 0) {
      return;
    }

    this.finishing = false;
    this.restoreNav = options.onRestoreNav ?? null;
    const driveSteps = options.steps.map(step => {
      const popover = {
        title: step.title ?? '',
        description: step.description,
        side: 'right' as const,
        align: 'start' as const
      };
      return step.selector ? { element: step.selector, popover } : { popover };
    });

    const instance = driver({
      steps: driveSteps,
      showProgress: true,
      progressText: $localize`:@@core.product-tour.ts.etape.current.total.85fa23b7:Étape {{current}} / {{total}}`,
      nextBtnText: $localize`:@@core.product-tour.ts.suivant.596d29a7:Suivant`,
      prevBtnText: $localize`:@@core.product-tour.ts.precedent.a527f171:Précédent`,
      doneBtnText: $localize`:@@core.product-tour.ts.terminer.6bf1bd74:Terminer`,
      showButtons: ['next', 'previous', 'close'],
      allowClose: true,
      overlayOpacity: 0.55,
      stagePadding: 8,
      stageRadius: 8,
      popoverClass: 'ft-product-tour',
      overlayColor: '#0f172a',
      disableActiveInteraction: true,
      smoothScroll: true,
      animate: !prefersReducedMotion(),
      onPopoverRender: (popover: DriverPopoverDom) => {
        const root = popover.wrapper ?? document.querySelector('.driver-popover');
        if (root) {
          root.setAttribute('role', 'dialog');
          root.setAttribute('aria-modal', 'true');
          root.setAttribute('aria-label', $localize`:@@core.product-tour.ts.visite.guidee.d7638488:Visite guidée`);
        }
        const closeBtn = popover.closeButton;
        if (closeBtn) {
          closeBtn.textContent = $localize`:@@core.product-tour.ts.ignorer.b0d64e49:Ignorer`;
          closeBtn.setAttribute('aria-label', $localize`:@@core.product-tour.ts.ignorer.la.visite.5b848b39:Ignorer la visite`);
          closeBtn.classList.add('ft-product-tour__skip');
        }
        const prev = popover.previousButton;
        if (prev && !instance.hasPreviousStep()) {
          prev.setAttribute('disabled', 'true');
          prev.setAttribute('aria-disabled', 'true');
        }
        applyTourZIndex();
      },
      onHighlightStarted: (
        _el: unknown,
        _step: unknown,
        ctx?: { state?: { activeIndex?: number } }
      ) => {
        const def = options.steps[ctx?.state?.activeIndex ?? 0];
        options.onRestoreNav?.();
        if (def?.expandNavTourId) {
          options.onExpandNav?.(def.expandNavTourId);
        }
      },
      onNextClick: () => {
        if (!instance.hasNextStep()) {
          this.finish('complete', options);
          return;
        }
        instance.moveNext();
      },
      onPrevClick: () => {
        if (instance.hasPreviousStep()) {
          instance.movePrevious();
        }
      },
      onCloseClick: () => {
        this.finish('skip', options);
      },
      onDestroyStarted: () => {
        if (this.finishing) {
          return;
        }
        this.finish('skip', options);
      },
      onDestroyed: () => {
        this.restoreNav?.();
        this.restoreNav = null;
        this.instance = null;
      }
    });

    this.instance = instance;
    this.zone.runOutsideAngular(() => instance.drive());
  }

  destroy(): void {
    const inst = this.instance;
    this.instance = null;
    this.restoreNav?.();
    this.restoreNav = null;
    this.finishing = true;
    if (inst) {
      try {
        inst.destroy();
      } catch {
        /* already destroyed */
      }
    }
    this.finishing = false;
  }

  private finish(kind: 'skip' | 'complete', options: ProductTourRunOptions): void {
    if (this.finishing) {
      return;
    }
    this.finishing = true;
    const inst = this.instance;
    this.instance = null;
    this.restoreNav?.();
    this.restoreNav = null;
    try {
      inst?.destroy();
    } catch {
      /* ignore */
    }
    this.zone.run(() => {
      if (kind === 'complete') {
        options.onComplete();
      } else {
        options.onSkip();
      }
    });
  }
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

function applyTourZIndex(): void {
  const overlay = document.querySelector('.driver-overlay') as HTMLElement | null;
  if (overlay) {
    overlay.style.zIndex = String(TOUR_Z_OVERLAY);
  }
  const popover = document.querySelector('.driver-popover') as HTMLElement | null;
  if (popover) {
    popover.style.zIndex = String(TOUR_Z_POPOVER);
  }
}
