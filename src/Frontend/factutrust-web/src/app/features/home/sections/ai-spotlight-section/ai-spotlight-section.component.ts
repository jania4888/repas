import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LandingRichComponent } from '../../shared/landing-rich/landing-rich.component';
import { LANDING_FACTS } from '../../content/landing-facts';
import { LandingCopyBase } from '../../shared/landing-copy-base';

/**
 * Spotlight IA (plan A.4.9) : section sombre (capacités + garde-fous),
 * capacités ({count} → outils IA), garde-fous et disponibilité. Textes : `t().home.ai`.
 */
@Component({
  selector: 'app-ai-spotlight-section',
  standalone: true,
  imports: [LandingRichComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section id="ia" class="ai-section" tabindex="-1" aria-labelledby="ai-title">
      <div class="ai-bg-glow blob-a" aria-hidden="true"></div>
      <div class="ai-bg-glow blob-b" aria-hidden="true"></div>

      <div class="section-container">
        <div class="section-header">
          <span class="eyebrow">
            <i class="pi pi-bolt" aria-hidden="true"></i>
            {{ t().home.ai.kicker }}
          </span>
          <h2 id="ai-title" class="section-title">{{ t().home.ai.title }}</h2>
          <p class="section-description">
            <app-landing-rich [segments]="rich(t().home.ai.subtitle)" />
          </p>
        </div>

        <div class="ai-notes">
          <p class="note-capabilities">
            <i class="pi pi-bolt" aria-hidden="true"></i>
            <span><app-landing-rich [segments]="rich(fillCounts(t().home.ai.capabilities))" /></span>
          </p>
          <p class="note-guardrails">
            <i class="pi pi-shield" aria-hidden="true"></i>
            <span><app-landing-rich [segments]="rich(t().home.ai.guardrails)" /></span>
          </p>
          <p class="note-availability">{{ t().home.ai.availability }}</p>
        </div>
      </div>
    </section>
  `,
  styles: [`
    .ai-section {
      padding: var(--spacing-20) var(--spacing-6);
      background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
      color: white;
      position: relative;
      overflow: hidden;
      isolation: isolate;
    }

    .ai-section:focus {
      outline: none;
    }

    .ai-bg-glow {
      position: absolute;
      border-radius: 50%;
      filter: blur(100px);
      pointer-events: none;
      z-index: 0;
    }

    .blob-a {
      width: 600px;
      height: 600px;
      background: radial-gradient(circle, #8b5cf6 0%, transparent 70%);
      opacity: 0.25;
      top: -200px;
      inset-inline-end: -150px;
    }

    .blob-b {
      width: 500px;
      height: 500px;
      background: radial-gradient(circle, #06b6d4 0%, transparent 70%);
      opacity: 0.2;
      bottom: -150px;
      inset-inline-start: -100px;
    }

    .section-container {
      max-width: 1080px;
      margin: 0 auto;
      position: relative;
      z-index: 1;
    }

    .section-header {
      text-align: center;
      margin-bottom: var(--spacing-12);
      max-width: 760px;
      margin-inline: auto;
    }

    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-2);
      padding: var(--spacing-2) var(--spacing-4);
      background: rgba(139, 92, 246, 0.15);
      color: #c4b5fd;
      border: 1px solid rgba(139, 92, 246, 0.3);
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
      color: white;
      line-height: var(--line-height-tight);
      margin: 0 0 var(--spacing-4) 0;
    }

    .section-description {
      font-size: var(--font-size-lg);
      line-height: var(--line-height-relaxed);
      color: #c7d2fe;
      margin: 0;
    }

    .ai-notes {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-3);
      max-width: 760px;
      margin-inline: auto;
    }

    .note-capabilities,
    .note-guardrails {
      display: flex;
      align-items: flex-start;
      gap: var(--spacing-3);
      margin: 0;
      font-size: var(--font-size-sm);
      line-height: var(--line-height-relaxed);
      color: var(--color-neutral-200);

      i {
        flex-shrink: 0;
        margin-top: 0.15rem;
        color: #67e8f9;
      }
    }

    .note-guardrails i {
      color: #4ade80;
    }

    .note-availability {
      margin: var(--spacing-2) 0 0 0;
      font-size: var(--font-size-xs);
      color: var(--color-neutral-400);
      text-align: center;
    }

    @media (max-width: 768px) {
      .ai-section {
        padding: var(--spacing-12) var(--spacing-4);
      }
    }
  `]
})
export class AiSpotlightSectionComponent extends LandingCopyBase {

  protected readonly facts = LANDING_FACTS;

  /** `{count}` / `{toolsCount}` → nombre d'outils IA. */
  protected fillCounts(text: string): string {
    return this.copy.format(text, {
      count: LANDING_FACTS.aiToolsCount,
      toolsCount: LANDING_FACTS.aiToolsCount
    });
  }
}
