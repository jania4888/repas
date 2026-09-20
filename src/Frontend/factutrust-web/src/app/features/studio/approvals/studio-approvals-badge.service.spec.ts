import { signal } from '@angular/core';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from '@core/services/auth.service';
import { environment } from '@environments/environment';
import { StudioApprovalsBadgeService } from './studio-approvals-badge.service';

describe('StudioApprovalsBadgeService', () => {
  let http: HttpTestingController;
  let service: StudioApprovalsBadgeService;
  /** Stub d'`AuthService.isAuthenticated` (4.5g) : le vrai service injecterait HttpClient + Router. */
  let authed: ReturnType<typeof signal<boolean>>;

  const COUNT_URL = `${environment.apiUrl}/studio/workflows/approvals/mine/count`;

  beforeEach(() => {
    authed = signal(true);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { isAuthenticated: authed } }
      ]
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(StudioApprovalsBadgeService);
  });

  afterEach(() => http.verify());

  it('démarre un polling à 60 s et expose le compteur', fakeAsync(() => {
    service.start();
    tick(0);
    http.expectOne(COUNT_URL).flush({ success: true, data: { count: 3 }, message: null, error: null });
    expect(service.count()).toBe(3);
    expect(service.visible()).toBe(true);

    tick(StudioApprovalsBadgeService.POLL_INTERVAL_MS);
    http.expectOne(COUNT_URL).flush({ success: true, data: { count: 5 }, message: null, error: null });
    expect(service.count()).toBe(5);
    expect(service.polling()).toBe(true);

    service.stop();
  }));

  it('est idempotent : un second start() ne crée pas de second polling', fakeAsync(() => {
    service.start();
    service.start();
    tick(0);
    http.expectOne(COUNT_URL).flush({ success: true, data: { count: 2 }, message: null, error: null });
    expect(service.count()).toBe(2);

    service.stop();
  }));

  it("s'arrête définitivement après un 403 ou un 404", fakeAsync(() => {
    service.start();
    tick(0);
    http.expectOne(COUNT_URL).flush('introuvable', { status: 404, statusText: 'Not Found' });
    expect(service.count()).toBe(0);
    expect(service.visible()).toBe(false);
    expect(service.polling()).toBe(false);

    tick(StudioApprovalsBadgeService.POLL_INTERVAL_MS);
    http.expectNone(COUNT_URL);

    service.start(); // arrêt définitif : aucun nouveau polling
    tick(0);
    http.expectNone(COUNT_URL);
  }));

  it('expose available=true après une sonde 200, false après un 404 définitif ou reset()', fakeAsync(() => {
    expect(service.available()).toBe(false); // aucun flash avant la première réponse

    service.start();
    tick(0);
    http.expectOne(COUNT_URL).flush({ success: true, data: { count: 3 }, message: null, error: null });
    expect(service.available()).toBe(true);

    tick(StudioApprovalsBadgeService.POLL_INTERVAL_MS);
    http.expectOne(COUNT_URL).flush('introuvable', { status: 404, statusText: 'Not Found' });
    expect(service.available()).toBe(false);
    expect(service.polling()).toBe(false);

    service.reset();
    expect(service.available()).toBe(false);
    service.start();
    tick(0);
    http.expectOne(COUNT_URL).flush({ success: true, data: { count: 0 }, message: null, error: null });
    expect(service.available()).toBe(true); // 200 avec 0 demande : disponible quand même
    expect(service.visible()).toBe(false);

    service.reset();
    expect(service.available()).toBe(false);
  }));

  it('remet le compteur à zéro et arrête le polling à la déconnexion (D-44-64)', fakeAsync(() => {
    service.start();
    tick(0);
    http.expectOne(COUNT_URL).flush({ success: true, data: { count: 3 }, message: null, error: null });
    expect(service.count()).toBe(3);
    expect(service.polling()).toBe(true);
    expect(service.available()).toBe(true);

    authed.set(false);
    TestBed.flushEffects();

    expect(service.count()).toBe(0);
    expect(service.visible()).toBe(false);
    expect(service.polling()).toBe(false);
    expect(service.available()).toBe(false);
    tick(StudioApprovalsBadgeService.POLL_INTERVAL_MS);
    http.expectNone(COUNT_URL); // polling arrêté : plus aucune sonde

    // Reconnexion : reset() (non définitif) autorise un nouveau start() piloté par le shell.
    authed.set(true);
    TestBed.flushEffects();
    service.start();
    tick(0);
    http.expectOne(COUNT_URL).flush({ success: true, data: { count: 1 }, message: null, error: null });
    expect(service.count()).toBe(1);

    service.stop();
  }));

  it('garde la dernière valeur sur une erreur réseau puis réessaie', fakeAsync(() => {
    service.start();
    tick(0);
    http.expectOne(COUNT_URL).flush({ success: true, data: { count: 3 }, message: null, error: null });
    expect(service.count()).toBe(3);

    tick(StudioApprovalsBadgeService.POLL_INTERVAL_MS);
    http.expectOne(COUNT_URL).flush('panne', { status: 0, statusText: 'Unknown Error' });
    expect(service.count()).toBe(3);

    tick(StudioApprovalsBadgeService.POLL_INTERVAL_MS);
    http.expectOne(COUNT_URL).flush({ success: true, data: { count: 4 }, message: null, error: null });
    expect(service.count()).toBe(4);

    service.stop();
  }));
});
