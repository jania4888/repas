import { Component, OnInit, OnDestroy, signal, computed, inject, ChangeDetectionStrategy } from '@angular/core';
import { LandingRichComponent } from '../../shared/landing-rich/landing-rich.component';
import { LANDING_FACTS } from '../../content/landing-facts';
import { LandingCopyBase } from '../../shared/landing-copy-base';

type Accent = 'blue' | 'teal' | 'purple' | 'amber' | 'pink' | 'green';

interface TabVisual {
  icon: string;
  accent: Accent;
}

/** Habillage visuel des onglets (icône + accent couleur), indexé par `tab.id` — pas de texte ici. */
const TAB_VISUALS: Record<string, TabVisual> = {
  invoices: { icon: 'pi-file-edit', accent: 'blue' },
  pos: { icon: 'pi-shopping-cart', accent: 'amber' },
  stock: { icon: 'pi-box', accent: 'teal' },
  treasury: { icon: 'pi-credit-card', accent: 'blue' },
  accounting: { icon: 'pi-calculator', accent: 'pink' },
  fiscal: { icon: 'pi-receipt', accent: 'purple' },
  payroll: { icon: 'pi-id-card', accent: 'green' },
  assets: { icon: 'pi-building', accent: 'amber' },
  projects: { icon: 'pi-briefcase', accent: 'teal' },
  crm: { icon: 'pi-address-book', accent: 'green' },
  ai: { icon: 'pi-bolt', accent: 'purple' },
  forecasting: { icon: 'pi-chart-line', accent: 'amber' }
};

const FALLBACK_VISUAL: TabVisual = { icon: 'pi-th-large', accent: 'blue' };

/**
 * Vitrine des modules (plan A.4.7) : 12 onglets issus de `t().home.modules.tabs`,
 * clavier (flèches/Home/End), rotation automatique 5 s (désactivée si reduced-motion).
 */
@Component({
  selector: 'app-module-showcase-section',
  standalone: true,
  imports: [LandingRichComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section id="modules" class="modules-section" tabindex="-1" aria-labelledby="modules-title" (mouseenter)="pauseRotation()" (mouseleave)="resumeRotation()" (focusin)="pauseRotationOnFocus()" (focusout)="resumeRotationOnFocus()">
      <div class="section-container">
        <div class="section-header">
          <span class="eyebrow">{{ format(t().home.modules.kicker, { count: facts.modulesCount }) }}</span>
          <h2 id="modules-title" class="section-title">{{ t().home.modules.title }}</h2>
          <p class="section-description">
            <app-landing-rich [segments]="rich(t().home.modules.subtitle)" />
          </p>
        </div>

        <div class="showcase-layout">
          <div class="tabs-list" role="tablist" aria-orientation="vertical">
            @for (tab of t().home.modules.tabs; track tab.id; let i = $index) {
              <button
                type="button"
                role="tab"
                [id]="'tab-' + tab.id"
                [attr.aria-selected]="activeIndex() === i"
                [attr.aria-controls]="'panel-' + tab.id"
                [attr.tabindex]="activeIndex() === i ? 0 : -1"
                [class]="'tab-button accent-' + visual(tab.id).accent + (activeIndex() === i ? ' active' : '')"
                (click)="selectTab(i)"
                (keydown)="onKeydown($event, i)">
                <span class="tab-icon" aria-hidden="true">
                  <i [class]="'pi ' + visual(tab.id).icon"></i>
                </span>
                <span class="tab-title">{{ tab.label }}</span>
                <span class="tab-arrow" aria-hidden="true">
                  <i class="pi pi-chevron-right"></i>
                </span>
              </button>
            }
          </div>

          <div
            class="tab-panel"
            role="tabpanel"
            [id]="'panel-' + activeTab().id"
            [attr.aria-labelledby]="'tab-' + activeTab().id">
            <div [class]="'panel-content accent-' + visual(activeTab().id).accent">
              <div class="panel-header">
                <h3 class="panel-title">{{ activeTab().title }}</h3>
                <p class="panel-tagline">{{ activeTab().tagline }}</p>
              </div>

              <ul class="panel-features">
                @for (point of activeTab().points; track point) {
                  <li>
                    <i class="pi pi-check-circle" aria-hidden="true"></i>
                    <span><app-landing-rich [segments]="rich(fillCounts(point))" /></span>
                  </li>
                }
              </ul>

              <div class="panel-visual" aria-hidden="true">
                <div class="visual-icon">
                  <i [class]="'pi ' + visual(activeTab().id).icon"></i>
                </div>
                <div class="visual-orbit"></div>
                <div class="visual-orbit visual-orbit-2"></div>
              </div>
            </div>
          </div>
        </div>

        <div class="rotation-status" aria-hidden="true">
          @for (tab of t().home.modules.tabs; track tab.id; let i = $index) {
            <button
              type="button"
              class="rotation-dot"
              [class.active]="activeIndex() === i"
              [attr.aria-label]="tab.label"
              [attr.tabindex]="-1"
              (click)="selectTab(i)"></button>
          }
        </div>
      </div>
    </section>
  `,
  styles: [`
    .modules-section {
      padding: var(--spacing-20) var(--spacing-6);
      background: white;
      position: relative;
    }

    .modules-section:focus {
      outline: none;
    }

    .section-container {
      max-width: 1280px;
      margin: 0 auto;
    }

    .section-header {
      text-align: center;
      margin-bottom: var(--spacing-12);
      max-width: 720px;
      margin-inline: auto;
    }

    .eyebrow {
      display: inline-block;
      padding: var(--spacing-2) var(--spacing-4);
      background: var(--color-primary-50);
      color: var(--color-primary-700);
      border-radius: var(--radius-full);
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-semibold);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin-bottom: var(--spacing-4);
    }

    .section-title {
      font-size: clamp(1.875rem, 4vw, 2.5rem);
      font-weight: var(--font-weight-bold);
      color: var(--color-neutral-900);
      line-height: var(--line-height-tight);
      margin: 0 0 var(--spacing-4) 0;
    }

    .section-description {
      font-size: var(--font-size-lg);
      line-height: var(--line-height-relaxed);
      color: var(--color-neutral-600);
      margin: 0;
    }

    .showcase-layout {
      display: grid;
      grid-template-columns: 320px 1fr;
      gap: var(--spacing-8);
      align-items: stretch;
      margin-bottom: var(--spacing-8);
    }

    .tabs-list {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
      background: var(--color-neutral-50);
      padding: var(--spacing-3);
      border-radius: var(--radius-2xl);
      border: 1px solid var(--color-neutral-200);
    }

    .tab-button {
      display: flex;
      align-items: center;
      gap: var(--spacing-3);
      padding: var(--spacing-3) var(--spacing-4);
      background: transparent;
      border: 1px solid transparent;
      border-radius: var(--radius-lg);
      cursor: pointer;
      font-family: inherit;
      font-size: var(--font-size-base);
      font-weight: var(--font-weight-medium);
      color: var(--color-neutral-700);
      text-align: start;
      transition: all var(--transition-normal);
      width: 100%;

      &:hover {
        background: white;
        color: var(--color-neutral-900);
      }

      &:focus-visible {
        outline: 3px solid var(--color-primary-300);
        outline-offset: 2px;
      }

      &.active {
        background: white;
        border-color: var(--color-primary-200);
        box-shadow: var(--shadow-md);
        color: var(--color-neutral-900);

        .tab-icon {
          background: var(--color-primary-100);
          color: var(--color-primary-700);
        }

        .tab-arrow {
          opacity: 1;
        }
      }
    }

    .tab-icon {
      width: 36px;
      height: 36px;
      border-radius: var(--radius-md);
      background: var(--color-neutral-200);
      color: var(--color-neutral-600);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: all var(--transition-normal);

      i {
        font-size: 1.1rem;
      }
    }

    .tab-title {
      flex: 1;
      min-width: 0;
    }

    .tab-arrow {
      opacity: 0;
      color: var(--color-primary-600);
      transition: opacity var(--transition-normal);
    }

    .tab-panel {
      background: linear-gradient(135deg, var(--color-neutral-50) 0%, white 100%);
      border: 1px solid var(--color-neutral-200);
      border-radius: var(--radius-2xl);
      padding: var(--spacing-10);
      position: relative;
      overflow: hidden;
      min-height: 320px;
    }

    .panel-content {
      position: relative;
      z-index: 1;
      animation: panelFade 0.4s ease-out;
    }

    @keyframes panelFade {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @media (prefers-reduced-motion: reduce) {
      .panel-content {
        animation: none;
      }
    }

    .panel-header {
      max-width: 520px;
      margin-bottom: var(--spacing-6);
    }

    .panel-title {
      font-size: clamp(1.5rem, 2.5vw, 1.875rem);
      font-weight: var(--font-weight-bold);
      color: var(--color-neutral-900);
      margin: 0 0 var(--spacing-2) 0;
    }

    .panel-tagline {
      font-size: var(--font-size-base);
      line-height: var(--line-height-relaxed);
      color: var(--color-neutral-600);
      margin: 0;
    }

    .panel-features {
      list-style: none;
      padding: 0;
      margin: 0;
      display: grid;
      grid-template-columns: 1fr;
      gap: var(--spacing-3);
      max-width: 600px;

      li {
        display: flex;
        align-items: flex-start;
        gap: var(--spacing-2);
        font-size: var(--font-size-sm);
        color: var(--color-neutral-700);
        line-height: 1.5;

        i {
          color: var(--color-success-600);
          font-size: 1rem;
          margin-top: 2px;
          flex-shrink: 0;
        }
      }
    }

    .panel-visual {
      position: absolute;
      top: 50%;
      inset-inline-end: var(--spacing-8);
      transform: translateY(-50%);
      width: 220px;
      height: 220px;
      pointer-events: none;
    }

    .visual-icon {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 100px;
      height: 100px;
      border-radius: var(--radius-2xl);
      background: linear-gradient(135deg, var(--color-primary-500), var(--color-primary-700));
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 16px 40px rgba(37, 99, 235, 0.25);

      i {
        font-size: 3rem;
        color: white;
      }
    }

    .visual-orbit {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 180px;
      height: 180px;
      border: 1.5px dashed var(--color-primary-200);
      border-radius: 50%;
      animation: orbit 20s linear infinite;
    }

    .visual-orbit-2 {
      width: 240px;
      height: 240px;
      border-color: var(--color-primary-100);
      animation-duration: 28s;
      animation-direction: reverse;
    }

    @keyframes orbit {
      from { transform: translate(-50%, -50%) rotate(0deg); }
      to { transform: translate(-50%, -50%) rotate(360deg); }
    }

    @media (prefers-reduced-motion: reduce) {
      .visual-orbit { animation: none; }
    }

    .accent-teal .visual-icon { background: linear-gradient(135deg, #14b8a6, #0d9488); box-shadow: 0 16px 40px rgba(20, 184, 166, 0.25); }
    .accent-purple .visual-icon { background: linear-gradient(135deg, #8b5cf6, #6d28d9); box-shadow: 0 16px 40px rgba(139, 92, 246, 0.25); }
    .accent-amber .visual-icon { background: linear-gradient(135deg, #f59e0b, #d97706); box-shadow: 0 16px 40px rgba(245, 158, 11, 0.25); }
    .accent-pink .visual-icon { background: linear-gradient(135deg, #ec4899, #be185d); box-shadow: 0 16px 40px rgba(236, 72, 153, 0.25); }
    .accent-green .visual-icon { background: linear-gradient(135deg, #10b981, #047857); box-shadow: 0 16px 40px rgba(16, 185, 129, 0.25); }

    .rotation-status {
      display: flex;
      justify-content: center;
      gap: var(--spacing-2);
    }

    .rotation-dot {
      width: 24px;
      height: 4px;
      border-radius: 2px;
      background: var(--color-neutral-300);
      border: none;
      cursor: pointer;
      padding: 0;
      transition: all var(--transition-normal);

      &:hover {
        background: var(--color-neutral-400);
      }

      &.active {
        width: 40px;
        background: var(--color-primary-600);
      }

      &:focus-visible {
        outline: 3px solid var(--color-primary-300);
        outline-offset: 2px;
      }
    }

    @media (max-width: 1024px) {
      .showcase-layout {
        grid-template-columns: 1fr;
      }

      .tabs-list {
        flex-direction: row;
        overflow-x: auto;
        scroll-snap-type: x mandatory;
        gap: var(--spacing-2);
      }

      .tab-button {
        flex-shrink: 0;
        scroll-snap-align: start;
        min-width: 200px;
      }

      .tab-arrow {
        display: none;
      }

      .panel-visual {
        position: relative;
        top: auto;
        inset-inline-end: auto;
        transform: none;
        margin: var(--spacing-8) auto 0;
      }
    }

    @media (max-width: 768px) {
      .modules-section {
        padding: var(--spacing-12) var(--spacing-4);
      }

      .tab-panel {
        padding: var(--spacing-6);
        min-height: auto;
      }

      .panel-visual {
        width: 160px;
        height: 160px;
      }

      .visual-icon {
        width: 80px;
        height: 80px;

        i {
          font-size: 2.25rem;
        }
      }
    }
  `]
})
export class ModuleShowcaseSectionComponent extends LandingCopyBase implements OnInit, OnDestroy {

  protected readonly facts = LANDING_FACTS;

  protected readonly tabs = computed(() => this.t().home.modules.tabs);
  protected readonly activeIndex = signal(0);
  protected readonly activeTab = computed(() => {
    const tabs = this.tabs();
    return tabs[Math.min(this.activeIndex(), tabs.length - 1)];
  });

  private rotationTimer?: ReturnType<typeof setInterval>;
  private hoverPaused = false;
  private focusPaused = false;

  /** Rotation en pause si le pointeur OU le focus clavier est dans la section (WCAG 2.2.2). */
  private get isPaused(): boolean {
    return this.hoverPaused || this.focusPaused;
  }

  ngOnInit(): void {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    this.startRotation();
  }

  ngOnDestroy(): void {
    this.stopRotation();
  }

  protected visual(tabId: string): TabVisual {
    return TAB_VISUALS[tabId] ?? FALLBACK_VISUAL;
  }

  selectTab(index: number): void {
    this.activeIndex.set(index);
    // Restart rotation when user manually picks
    this.stopRotation();
    if (typeof window !== 'undefined' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.startRotation();
    }
  }

  pauseRotation(): void {
    this.hoverPaused = true;
  }

  resumeRotation(): void {
    this.hoverPaused = false;
  }

  pauseRotationOnFocus(): void {
    this.focusPaused = true;
  }

  resumeRotationOnFocus(): void {
    this.focusPaused = false;
  }

  onKeydown(event: KeyboardEvent, index: number): void {
    const count = this.tabs().length;
    let newIndex = index;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault();
      newIndex = (index + 1) % count;
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault();
      newIndex = (index - 1 + count) % count;
    } else if (event.key === 'Home') {
      event.preventDefault();
      newIndex = 0;
    } else if (event.key === 'End') {
      event.preventDefault();
      newIndex = count - 1;
    } else {
      return;
    }
    this.selectTab(newIndex);
    const tabId = `tab-${this.tabs()[newIndex].id}`;
    requestAnimationFrame(() => {
      document.getElementById(tabId)?.focus();
    });
  }



  /** `{toolsCount}` (onglet IA) → constante vérifiable. */
  protected fillCounts(text: string): string {
    return this.copy.format(text, { toolsCount: LANDING_FACTS.aiToolsCount });
  }

  private startRotation(): void {
    this.rotationTimer = setInterval(() => {
      if (this.isPaused) return;
      const next = (this.activeIndex() + 1) % this.tabs().length;
      this.activeIndex.set(next);
    }, 5000);
  }

  private stopRotation(): void {
    if (this.rotationTimer) {
      clearInterval(this.rotationTimer);
      this.rotationTimer = undefined;
    }
  }
}
