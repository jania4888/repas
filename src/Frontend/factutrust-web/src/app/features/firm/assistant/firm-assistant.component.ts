import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ChatPanelComponent } from '@features/ai-assistant/components/chat-panel/chat-panel.component';
import { AssistantAgentScope } from '@features/ai-assistant/models/ai-chat.models';

/**
 * Page de l'agent « Chef de mission », côté cabinet en mode natif.
 *
 * Volontairement hors de `/ai-assistant/**` : cette famille de routes est réservée aux experts de
 * module d'une société, et `firmNativeRedirectGuard` en écarte les utilisateurs cabinet natifs.
 * Vivre sous `/firm/**` évite de toucher ce garde, `canUseAiAssistant` et les listes d'autorisation
 * du mode délégué — donc aucune régression sur l'assistant société.
 *
 * Le panneau est réutilisé tel quel : le scope passé en entrée suffit à basculer la session sur la
 * surface HTTP cabinet (cf. `AiChatSessionService`).
 */
@Component({
  selector: 'app-firm-assistant',
  standalone: true,
  imports: [ChatPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-chat-panel
      [isOpen]="true"
      [embedded]="true"
      [pageFill]="true"
      [agentScope]="firmMissionScope" />
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        flex: 1 1 auto;
        align-self: stretch;
        min-height: 0;
        height: 100%;
      }
    `
  ]
})
export class FirmAssistantComponent {
  protected readonly firmMissionScope = AssistantAgentScope.FirmMission;
}
