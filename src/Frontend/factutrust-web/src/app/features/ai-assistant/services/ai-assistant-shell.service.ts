import { Injectable, signal } from '@angular/core';
import { AssistantAgentScope } from '../models/ai-chat.models';
import { resolveScopeFromUrl } from '../config/agent-scopes.config';

export type WorkspacePane = 'work' | 'ai';

export interface OpenAiGeneralTabOptions {
  /** Current URL used to resolve expert scope (defaults to window location when omitted). */
  url?: string;
  firmDelegated?: boolean;
}

/**
 * Orchestrates the singleton « Assistant IA » workspace tab in MainLayout.
 * Feature pages call {@link requestOpenPanel} (same as the FAB) to open or focus the tab.
 */
@Injectable({ providedIn: 'root' })
export class AiAssistantShellService {
  readonly openPanelTick = signal(0);

  /** True when the general AI tab is present in the workspace tab bar. */
  readonly aiTabOpen = signal(false);

  readonly activePane = signal<WorkspacePane>('work');

  /** Label for the work tab (last breadcrumb segment). */
  readonly workTabTitle = signal($localize`:@@ai-assistant.ai-assistant-shell.ts.accueil.a8ff8fd2:Accueil`);

  /**
   * Agent scope for the workspace tab panel. Locked while the tab is open and a conversation
   * is in progress; updated when opening from a new target URL if the tab was closed.
   */
  readonly workspaceTabScope = signal<AssistantAgentScope>(AssistantAgentScope.None);

  /** True when the current URL is a dedicated /ai-assistant* page (deep link mode). */
  isAiAssistantRoute(url: string): boolean {
    return url.includes('/ai-assistant');
  }

  /** Returns true when navigation to this route should open the workspace tab instead. */
  isWorkspaceAiRoute(route: string | undefined | null): boolean {
    if (!route) {
      return false;
    }
    const path = route.split('?')[0].split('#')[0];
    return path === '/ai-assistant' || path.startsWith('/ai-assistant/');
  }

  setWorkTabTitle(title: string): void {
    const trimmed = title.trim();
    if (trimmed) {
      this.workTabTitle.set(trimmed);
    }
  }

  requestOpenPanel(options?: OpenAiGeneralTabOptions): void {
    this.openAiGeneralTab(options);
    this.openPanelTick.update(n => n + 1);
  }

  openAiGeneralTab(options?: OpenAiGeneralTabOptions): void {
    const url = options?.url ?? (typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/');
    if (!this.aiTabOpen()) {
      this.workspaceTabScope.set(
        resolveScopeFromUrl(url, { firmDelegated: options?.firmDelegated ?? false })
      );
    }
    this.aiTabOpen.set(true);
    this.activePane.set('ai');
  }

  openAiGeneralTabFromRoute(route: string, options?: Omit<OpenAiGeneralTabOptions, 'url'>): void {
    const path = route.split('?')[0].split('#')[0];
    const slugMatch = path.match(/^\/ai-assistant\/([^/]+)/);
    const scope = slugMatch
      ? resolveScopeFromUrl(path, { firmDelegated: options?.firmDelegated ?? false })
      : resolveScopeFromUrl(path, { firmDelegated: options?.firmDelegated ?? false });

    if (!this.aiTabOpen()) {
      this.workspaceTabScope.set(scope);
    } else if (slugMatch) {
      this.workspaceTabScope.set(scope);
    }

    this.aiTabOpen.set(true);
    this.activePane.set('ai');
    this.openPanelTick.update(n => n + 1);
  }

  activateWorkPane(): void {
    this.activePane.set('work');
  }

  activateAiPane(): void {
    if (this.aiTabOpen()) {
      this.activePane.set('ai');
    }
  }

  closeAiTab(): void {
    this.aiTabOpen.set(false);
    this.activePane.set('work');
  }

  /** Called when entering dedicated /ai-assistant* route — never stack two panels. */
  resetWorkspaceTabForDedicatedRoute(): void {
    this.aiTabOpen.set(false);
    this.activePane.set('work');
  }

  /** Sync workspace scope from current route when the tab is closed. */
  syncSuggestedScopeFromUrl(url: string, firmDelegated: boolean): void {
    if (!this.aiTabOpen()) {
      this.workspaceTabScope.set(resolveScopeFromUrl(url, { firmDelegated }));
    }
  }
}
