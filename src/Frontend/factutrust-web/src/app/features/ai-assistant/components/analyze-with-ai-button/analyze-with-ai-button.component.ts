import { Component, computed, inject, input } from '@angular/core';
import { AuthService } from '@core/services/auth.service';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AiScreenAnalysisService } from '../../services/ai-screen-analysis.service';
import { canUseAiAssistant } from '../../utils/ai-access.util';

@Component({
  selector: 'app-analyze-with-ai-button',
  standalone: true,
  imports: [ButtonComponent],
  template: `
    @if (canUse()) {
      <app-button
        variant="outline"
        icon="pi-sparkles"
        iconPos="left"
        type="button"
        [disabled]="disabled()"
        (click)="run()"
        [ariaLabel]="ariaLabelText()">
        <span class="analyze-label-full" i18n="@@ai-assistant.components.analyser.avec.l.assistant.ia.48bd0ffb">Analyser avec l'assistant IA</span>
        <span class="analyze-label-compact" i18n="@@ai-assistant.components.analyser.avec.l.ia.78ea80a9">Analyser avec l'IA</span>
      </app-button>
    }
  `,
  styles: [`
    .analyze-label-compact { display: none; }
    :host.analyze-density-toolbar .analyze-label-full { display: none; }
    :host.analyze-density-toolbar .analyze-label-compact { display: inline; }
    @media (max-width: 768px) {
      .analyze-label-full { display: none; }
      .analyze-label-compact { display: inline; }
    }
    @media (min-width: 1200px) {
      :host.analyze-density-toolbar .analyze-label-full { display: inline; }
      :host.analyze-density-toolbar .analyze-label-compact { display: none; }
    }
  `],
  host: {
    '[class.analyze-density-toolbar]': 'density() === "toolbar"'
  }
})
export class AnalyzeWithAiButtonComponent {
  private readonly auth = inject(AuthService);
  private readonly analysis = inject(AiScreenAnalysisService);

  readonly screenId = input.required<string>();
  readonly payloadBuilder = input.required<() => unknown>();
  readonly autoSend = input(true);
  readonly disabled = input(false);
  readonly density = input<'default' | 'toolbar'>('default');

  readonly canUse = computed(() => canUseAiAssistant(this.auth));

  readonly ariaLabelText = computed(() => `Analyser l'écran ${this.screenId()} avec l'assistant IA`);

  run(): void {
    if (!this.canUse() || this.disabled()) {
      return;
    }
    let payload: unknown;
    try {
      payload = this.payloadBuilder()();
    } catch {
      payload = { buildError: true };
    }
    this.analysis.startAnalysis(this.screenId(), payload, { autoSend: this.autoSend() });
  }
}
