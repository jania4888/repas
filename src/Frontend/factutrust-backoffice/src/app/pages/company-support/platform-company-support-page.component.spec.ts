import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { environment } from '@environments/environment';
import { PlatformPermission } from '@core/models/platform.models';
import { PlatformPermissionsService } from '@core/services/platform-permissions.service';
import type { PlatformSupportInboxItem, PlatformSupportMessage } from '@core/services/platform-company-support.service';
import { PlatformCompanySupportPageComponent } from './platform-company-support-page.component';

describe('PlatformCompanySupportPageComponent', () => {
  let fixture: ComponentFixture<PlatformCompanySupportPageComponent>;
  let component: PlatformCompanySupportPageComponent;
  let http: HttpTestingController;

  const base = `${environment.apiUrl}/platform/company-support`;

  function company(name = 'Alpha SARL', id = 'tenant-1'): PlatformSupportInboxItem {
    return {
      conversationId: `conv-${id}`,
      companyTenantId: id,
      companyName: name,
      lastMessageAt: '2026-03-10T09:30:00Z',
      lastMessagePreview: 'Bonjour',
      lastMessageCategory: 'Question',
      lastAuthorSide: 'Company',
      unreadCount: 2
    };
  }

  function message(body: string, id = 'm1'): PlatformSupportMessage {
    return {
      id,
      conversationId: 'conv-tenant-1',
      authorSide: 'Company',
      authorDisplayName: 'Ada',
      category: 'Question',
      body,
      sentAt: '2026-03-10T09:30:00Z',
      attachments: []
    };
  }

  function ok<T>(data: T) {
    return { success: true, data, message: null };
  }

  function create(permissions: string[]): void {
    TestBed.configureTestingModule({
      imports: [PlatformCompanySupportPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: PlatformPermissionsService,
          useValue: {
            has: (key: string) => permissions.includes(key),
            isLoaded: signal(true)
          }
        }
      ]
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(PlatformCompanySupportPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  function inboxRequest(predicate?: (params: URLSearchParams) => boolean) {
    return http.expectOne(request => {
      if (request.url !== `${base}/conversations`) return false;
      if (!predicate) return true;
      return predicate(new URLSearchParams(request.params.toString()));
    });
  }

  function flushInbox(items: PlatformSupportInboxItem[] = [], totalCount = items.length): void {
    inboxRequest().flush(ok({ items, totalCount }));
    fixture.detectChanges();
  }

  function flushThread(tenantId: string, messages: PlatformSupportMessage[]): void {
    http.expectOne(`${base}/conversations/${tenantId}`).flush(ok({
      conversationId: `conv-${tenantId}`,
      messages,
      lastReadAt: null,
      unreadCount: 1
    }));
    if (messages.length) {
      http.expectOne(request => request.method === 'POST' && request.url === `${base}/conversations/${tenantId}/read`)
        .flush(ok(null));
      http.expectOne(`${base}/unread-count`).flush(ok(0));
    }
    fixture.detectChanges();
  }

  afterEach(() => http.verify());

  it('hides the composer without write permission', () => {
    create([PlatformPermission.CompanySupportRead]);
    flushInbox();
    component['selectedId'].set('tenant-1');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Lecture seule');
  });

  it('shows the composer with write permission once a company is selected', () => {
    create([PlatformPermission.CompanySupportRead, PlatformPermission.CompanySupportWrite]);
    flushInbox();
    component['selectedId'].set('tenant-1');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('form')).not.toBeNull();
  });

  it('renders the company name and category', () => {
    create([PlatformPermission.CompanySupportRead]);
    const row = company();
    row.lastMessageCategory = 2;
    flushInbox([row]);
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Alpha SARL');
    expect(text).toContain('Réclamation');
  });

  it('shows an empty inbox without pretending a filter matched nothing', () => {
    create([PlatformPermission.CompanySupportRead]);
    flushInbox();
    expect(fixture.nativeElement.textContent).toContain('Aucune conversation.');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows a list error without the empty copy', () => {
    create([PlatformPermission.CompanySupportRead]);
    inboxRequest().flush(null, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
    const alert = fixture.nativeElement.querySelector('[role="alert"]') as HTMLElement;
    expect(alert.textContent).toContain('Impossible de charger les conversations.');
    expect(fixture.nativeElement.textContent).not.toContain('Aucune conversation.');
  });

  it('sends search and unread filters', fakeAsync(() => {
    create([PlatformPermission.CompanySupportRead]);
    flushInbox([company()]);
    component.onSearchChange('  Acme  ');
    tick(300);
    const search = inboxRequest(params => params.get('companyName') === 'Acme');
    expect(search.request.params.get('page')).toBe('1');
    expect(search.request.params.get('pageSize')).toBe('50');
    search.flush(ok({ items: [], totalCount: 0 }));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Aucun résultat.');

    component.setUnreadOnly(true);
    const unread = inboxRequest(params => params.get('unreadOnly') === 'true');
    expect(unread.request.params.get('companyName')).toBe('Acme');
    unread.flush(ok({ items: [], totalCount: 0 }));
  }));

  it('drops a stale inbox response when the filter changes', () => {
    create([PlatformPermission.CompanySupportRead]);
    flushInbox([company()]);
    component.setCategory('Question');
    const first = inboxRequest(params => params.get('category') === 'Question');
    component.setCategory('Reply');
    expect(first.cancelled).toBeTrue();
    const second = inboxRequest(params => params.get('category') === 'Reply');
    expect(second.request.params.get('page')).toBe('1');
    second.flush(ok({ items: [company('Beta')], totalCount: 1 }));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Beta');
    expect(fixture.nativeElement.textContent).not.toContain('Alpha SARL');
  });

  it('requests the next page without clearing the draft', () => {
    create([PlatformPermission.CompanySupportRead, PlatformPermission.CompanySupportWrite]);
    flushInbox([company()], 120);
    component['selectedId'].set('tenant-1');
    component.body = 'Brouillon';
    fixture.detectChanges();
    const next = fixture.nativeElement.querySelector('.pager-next') as HTMLButtonElement;
    next.click();
    const request = inboxRequest(params => params.get('page') === '2');
    request.flush(ok({ items: [company('Page deux', 'tenant-2')], totalCount: 120 }));
    fixture.detectChanges();
    expect(component.body).toBe('Brouillon');
    expect(component['selectedId']()).toBe('tenant-1');
    expect(fixture.nativeElement.textContent).toContain('Page 2 / 3');
  });

  it('ignores a thread response for a company that is no longer selected', () => {
    create([PlatformPermission.CompanySupportRead]);
    const first = company('Alpha SARL', 'tenant-a');
    const second = company('Beta', 'tenant-b');
    flushInbox([first, second]);
    component.open(first);
    const stale = http.expectOne(`${base}/conversations/tenant-a`);
    component.open(second);
    expect(stale.cancelled).toBeTrue();
    flushThread('tenant-b', [message('depuis Beta', 'm-b')]);
    expect(component.messages().map(entry => entry.body)).toEqual(['depuis Beta']);
    expect(fixture.nativeElement.textContent).not.toContain('depuis Alpha');
  });

  it('keeps message html as text', () => {
    create([PlatformPermission.CompanySupportRead]);
    const row = company();
    flushInbox([row]);
    component.open(row);
    flushThread(row.companyTenantId, [message('<script>alert(1)</script>')]);
    const body = fixture.nativeElement.querySelector('.body') as HTMLElement;
    expect(body.textContent).toContain('<script>alert(1)</script>');
    expect(body.querySelector('script')).toBeNull();
    expect(body.innerHTML).not.toContain('<script');
  });

  it('downloads an attachment with a basename', () => {
    create([PlatformPermission.CompanySupportRead]);
    flushInbox();
    const created: HTMLAnchorElement[] = [];
    const original = document.createElement.bind(document);
    spyOn(document, 'createElement').and.callFake((tag: string) => {
      const element = original(tag);
      if (String(tag).toLowerCase() === 'a') created.push(element as HTMLAnchorElement);
      return element;
    });
    spyOn(HTMLAnchorElement.prototype, 'click').and.stub();
    spyOn(URL, 'createObjectURL').and.returnValue('blob:test');
    spyOn(URL, 'revokeObjectURL');

    component.download('att-1', '../a.pdf');
    http.expectOne(`${base}/attachments/att-1`).flush(new Blob(['x']));

    expect(created.length).toBe(1);
    expect(created[0].download).toBe('a.pdf');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test');
  });

  it('clears the draft after a successful reply', () => {
    create([PlatformPermission.CompanySupportRead, PlatformPermission.CompanySupportWrite]);
    const row = company();
    row.lastMessagePreview = 'Extrait';
    flushInbox([row]);
    component['selectedId'].set(row.companyTenantId);
    component.body = 'Bonjour';
    component.files = [new File(['a'], 'note.txt', { type: 'text/plain' })];
    fixture.detectChanges();

    component.send();
    http.expectOne(request =>
      request.method === 'POST' && request.url === `${base}/conversations/${row.companyTenantId}/messages`
    ).flush(ok(message('Bonjour', 'm-sent')));
    fixture.detectChanges();

    expect(component.body).toBe('');
    expect(component.files).toEqual([]);
    expect(fixture.nativeElement.textContent).toContain('Bonjour');
  });

  it('keeps the draft and shows an error when the reply fails', () => {
    create([PlatformPermission.CompanySupportRead, PlatformPermission.CompanySupportWrite]);
    const row = company();
    flushInbox([row]);
    component['selectedId'].set(row.companyTenantId);
    component.body = 'Bonjour';
    fixture.detectChanges();

    component.send();
    http.expectOne(`${base}/conversations/${row.companyTenantId}/messages`).flush(
      { success: false, data: null, message: 'non' },
      { status: 400, statusText: 'Bad Request' }
    );
    fixture.detectChanges();

    expect(component.body).toBe('Bonjour');
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('Envoi impossible.');
  });
});
