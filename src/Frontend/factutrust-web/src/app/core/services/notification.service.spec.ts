import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { SKIP_ERROR_TOAST } from '@core/http-context';
import { environment } from '@environments/environment';
import { FirmAssignmentService } from './firm-assignment.service';
import {
  NotificationList,
  NotificationService,
  STUDIO_WORKFLOW_NOTIFICATION_TYPES,
  isStudioWorkflowNotification
} from './notification.service';

describe('NotificationService', () => {
  let service: NotificationService;
  let httpMock: HttpTestingController;
  const baseUrl = `${environment.apiUrl}/notifications`;

  const emptyList: NotificationList = { items: [], totalCount: 0, unreadCount: 0, page: 1, pageSize: 10 };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: FirmAssignmentService,
          useValue: { getIncomingInvitations: () => ({ subscribe: () => {} }) }
        }
      ]
    });
    service = TestBed.inject(NotificationService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('refresh met à jour le compteur non-lues et les dernières notifications', () => {
    service.refresh();

    const req = httpMock.expectOne(r => r.url === baseUrl);
    expect(req.request.method).toBe('GET');
    req.flush({
      success: true,
      data: {
        items: [
          { id: 'n1', type: 0, title: 'Nouvelle demande', body: 'Corps', createdAt: '2026-07-18T10:00:00Z' }
        ],
        totalCount: 1,
        unreadCount: 1,
        page: 1,
        pageSize: 10
      }
    });

    expect(service.unreadCount()).toBe(1);
    expect(service.latest().length).toBe(1);
    expect(service.latest()[0].title).toBe('Nouvelle demande');
  });

  it('markRead poste sur {id}/read avec SKIP_ERROR_TOAST puis rafraîchit', () => {
    service.markRead('n1');

    const readReq = httpMock.expectOne(`${baseUrl}/n1/read`);
    expect(readReq.request.method).toBe('POST');
    expect(readReq.request.context.get(SKIP_ERROR_TOAST)).toBe(true);
    readReq.flush({ success: true, data: null });
    httpMock.expectOne(r => r.url === baseUrl).flush({ success: true, data: emptyList });

    expect(service.unreadCount()).toBe(0);
  });

  it('markAllRead poste sur read-all avec SKIP_ERROR_TOAST puis rafraîchit', () => {
    service.markAllRead();

    const readAllReq = httpMock.expectOne(`${baseUrl}/read-all`);
    expect(readAllReq.request.method).toBe('POST');
    expect(readAllReq.request.context.get(SKIP_ERROR_TOAST)).toBe(true);
    readAllReq.flush({ success: true, data: null });
    httpMock.expectOne(r => r.url === baseUrl).flush({ success: true, data: emptyList });

    expect(service.unreadCount()).toBe(0);
  });

  it('une erreur de refresh reste silencieuse (état inchangé)', () => {
    service.refresh();

    httpMock
      .expectOne(r => r.url === baseUrl)
      .flush('boom', { status: 500, statusText: 'Server Error' });

    expect(service.unreadCount()).toBe(0);
    expect(service.latest()).toEqual([]);
  });

  it('reconnaît les notifications de workflow Studio (types 15 à 18)', () => {
    expect(STUDIO_WORKFLOW_NOTIFICATION_TYPES).toEqual({
      approvalRequested: 15,
      approvalDecided: 16,
      stepFailed: 17,
      message: 18
    });
    for (const type of [15, 16, 17, 18]) {
      expect(isStudioWorkflowNotification(type)).withContext(`type ${type}`).toBeTrue();
    }
    for (const type of [-1, 0, 14, 19, 100]) {
      expect(isStudioWorkflowNotification(type)).withContext(`type ${type}`).toBeFalse();
    }
  });

  // D-44-94 : l'API sérialise `NotificationType` en chaîne PascalCase (JsonStringEnumConverter global,
  // Program.cs) — la seule forme numérique laissait le badge d'approbations sans rafraîchissement immédiat.
  it("reconnaît la forme chaîne PascalCase émise par l'API pour les types 15 à 18", () => {
    for (const type of ['StudioWorkflowApprovalRequested', 'StudioWorkflowApprovalDecided', 'StudioWorkflowStepFailed', 'StudioWorkflowMessage']) {
      expect(isStudioWorkflowNotification(type)).withContext(type).toBeTrue();
    }
    for (const type of ['FirmAssignmentRequested', 'ExchangeMessageReceived', 'FirmTimeSheetSubmitted', '', 'studioWorkflowMessage']) {
      expect(isStudioWorkflowNotification(type)).withContext(`type ${type}`).toBeFalse();
    }
  });
});
