/// <reference types="@angular/localize" />
import { Routes } from '@angular/router';
import { AGENT_SCOPE_CONFIGS } from './config/agent-scopes.config';

export const AI_ASSISTANT_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./ai-assistant-page.component').then(m => m.AiAssistantPageComponent),
    title: $localize`:@@ai-assistant.routes.title.Assistant_IA_InstaFact:Assistant IA - InstaFact`
  },
  // Pages dédiées des assistants experts par module (/ai-assistant/<slug>). Même composant
  // coquille : le panneau embarqué est rendu par MainLayout, scopé via resolveScopeFromUrl.
  ...AGENT_SCOPE_CONFIGS.map(config => ({
    path: config.slug,
    loadComponent: () =>
      import('./ai-assistant-page.component').then(m => m.AiAssistantPageComponent),
    title: `${config.title} - InstaFact`
  }))
];
