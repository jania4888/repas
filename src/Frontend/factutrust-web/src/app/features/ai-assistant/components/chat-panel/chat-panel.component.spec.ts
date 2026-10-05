import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { ChatPanelComponent } from './chat-panel.component';
import { AiChatSessionService } from '../../services/ai-chat-session.service';
import { AiPromptFavoritesService } from '../../services/ai-prompt-favorites.service';
import { MessageSelectionService } from '../../services/message-selection.service';
import { AiChatService } from '../../services/ai-chat.service';
import { PowerPointExportService } from '../../services/powerpoint-export.service';

@Component({
  standalone: true,
  imports: [ChatPanelComponent],
  template: `
    <app-chat-panel
      [isOpen]="true"
      [embedded]="embedded"
      [workspaceTab]="workspaceTab"
      [pageFill]="pageFill"
      (close)="onClose()" />
  `
})
class HostComponent {
  embedded = false;
  workspaceTab = false;
  pageFill = false;
  closeCount = 0;

  onClose(): void {
    this.closeCount += 1;
  }
}

describe('ChatPanelComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    const sessionMock: Pick<
      AiChatSessionService,
      | 'messages'
      | 'isStreaming'
      | 'aiAvailable'
      | 'awaitingFirstToken'
      | 'assistantComplianceMode'
      | 'agentScope'
      | 'lastStreamTraceId'
      | 'lastScreenAnalysisTrace'
      | 'selectedModelSupportsVision'
      | 'showSidebar'
      | 'dailyBriefing'
      | 'requestWarmUpActiveModel'
      | 'setAgentScope'
      | 'toggleSidebar'
      | 'setAssistantComplianceMode'
    > = {
      messages: signal([]),
      isStreaming: signal(false),
      aiAvailable: signal(true),
      awaitingFirstToken: signal(false),
      assistantComplianceMode: signal(false),
      agentScope: signal(0),
      lastStreamTraceId: signal(null),
      lastScreenAnalysisTrace: signal(null),
      showSidebar: signal(false),
      dailyBriefing: signal(null),
      selectedModelSupportsVision: () => false,
      requestWarmUpActiveModel: jasmine.createSpy('requestWarmUpActiveModel'),
      setAgentScope: jasmine.createSpy('setAgentScope'),
      toggleSidebar: jasmine.createSpy('toggleSidebar'),
      setAssistantComplianceMode: jasmine.createSpy('setAssistantComplianceMode')
    };

    const favoritesMock: Pick<AiPromptFavoritesService, 'favorites' | 'setScope' | 'add' | 'remove'> = {
      favorites: signal([]),
      setScope: jasmine.createSpy('setScope'),
      add: jasmine.createSpy('add'),
      remove: jasmine.createSpy('remove')
    };

    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        MessageSelectionService,
        { provide: AiChatService, useValue: { extractDocument: jasmine.createSpy('extractDocument') } },
        { provide: AiChatSessionService, useValue: sessionMock },
        { provide: AiPromptFavoritesService, useValue: favoritesMock },
        { provide: PowerPointExportService, useValue: {} },
        { provide: Router, useValue: { navigate: jasmine.createSpy('navigate') } }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('does not apply fill host class when not embedded', () => {
    const panel = fixture.nativeElement.querySelector('app-chat-panel');
    expect(panel?.classList.contains('chat-panel-host--fill')).toBe(false);
  });

  it('applies fill host class when embedded', () => {
    host.embedded = true;
    fixture.detectChanges();

    const panel = fixture.nativeElement.querySelector('app-chat-panel');
    expect(panel?.classList.contains('chat-panel-host--fill')).toBe(true);
  });

  it('emits close when header close button is clicked', () => {
    const closeBtn = fixture.nativeElement.querySelector(
      '.panel-header .icon-btn[title="Fermer"]'
    ) as HTMLButtonElement;
    expect(closeBtn).toBeTruthy();

    closeBtn.click();
    expect(host.closeCount).toBe(1);
  });

  it('keeps the drawer close button and omits the page-fill class by default', () => {
    const panel = fixture.nativeElement.querySelector('.chat-panel') as HTMLElement;
    expect(panel.classList.contains('embedded-page')).toBe(false);
    expect(fixture.nativeElement.querySelector('.panel-header .icon-btn[title="Fermer"]')).toBeTruthy();
  });

  it('applies the page-fill class and hides close when embedded and pageFill', () => {
    host.embedded = true;
    host.pageFill = true;
    fixture.detectChanges();

    const panel = fixture.nativeElement.querySelector('.chat-panel') as HTMLElement;
    expect(panel.classList.contains('embedded')).toBe(true);
    expect(panel.classList.contains('embedded-page')).toBe(true);
    expect(fixture.nativeElement.querySelector('.panel-header .icon-btn[title="Fermer"]')).toBeNull();
  });
});
