import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { AssistancePageComponent } from './assistance-page.component';
import {
  CompanySupportBootstrap,
  CompanySupportMessage,
  CompanySupportService
} from '@core/services/company-support.service';
import { ApiResponse } from '@core/services/auth.service';
import { CompanySupportBadgeService } from '@core/services/company-support-badge.service';

describe('AssistancePageComponent', () => {
  let fixture: ComponentFixture<AssistancePageComponent>;
  let component: AssistancePageComponent;
  let support: jasmine.SpyObj<CompanySupportService>;
  let badge: jasmine.SpyObj<CompanySupportBadgeService>;

  function message(overrides: Partial<CompanySupportMessage> = {}): CompanySupportMessage {
    return {
      id: 'm1',
      conversationId: 'c1',
      authorSide: 'Company',
      authorDisplayName: 'Sami',
      category: 'Question',
      body: 'bonjour',
      sentAt: '2026-09-24T22:15:00.000Z',
      attachments: [],
      ...overrides
    };
  }

  function ok<T>(data: T): ApiResponse<T> {
    return { success: true, data, message: null, errors: [] };
  }

  function setup(messages: CompanySupportMessage[] = []): void {
    support.bootstrap.and.returnValue(of(ok({
      conversationId: messages.length ? 'c1' : null,
      messages,
      lastReadAt: null,
      unreadCount: 0
    })));
    fixture.detectChanges();
  }

  beforeEach(async () => {
    support = jasmine.createSpyObj('CompanySupportService', [
      'bootstrap',
      'messagesAfter',
      'post',
      'markRead',
      'download'
    ]);
    badge = jasmine.createSpyObj('CompanySupportBadgeService', ['refresh']);
    support.markRead.and.returnValue(of(ok(null)));
    support.messagesAfter.and.returnValue(of(ok([])));

    await TestBed.configureTestingModule({
      imports: [AssistancePageComponent],
      providers: [
        { provide: CompanySupportService, useValue: support },
        { provide: CompanySupportBadgeService, useValue: badge }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(AssistancePageComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('shows a loading state until the conversation arrives', () => {
    const pending = new Subject<ApiResponse<CompanySupportBootstrap>>();
    support.bootstrap.and.returnValue(pending.asObservable());
    fixture.detectChanges();

    expect(component.loading()).toBeTrue();
    expect(fixture.nativeElement.querySelector('.assist-thread').getAttribute('aria-busy')).toBe('true');
    expect(fixture.nativeElement.textContent).toContain('Chargement');

    pending.next(ok({ conversationId: null, messages: [], lastReadAt: null, unreadCount: 0 }));
    pending.complete();
    fixture.detectChanges();

    expect(component.loading()).toBeFalse();
    expect(fixture.nativeElement.textContent).toContain('Aucun message');
  });

  it('refuses to send when the message is empty and no file is attached', () => {
    setup();
    component.body = '   ';
    component.files = [];

    expect(component.canSend()).toBeFalse();
    component.send();

    expect(support.post).not.toHaveBeenCalled();
  });

  it('refuses a Reply category from the company composer', () => {
    setup();
    component.category = 'Reply';
    component.body = 'réponse';

    expect(component.canSend()).toBeFalse();
    component.send();

    expect(support.post).not.toHaveBeenCalled();
    const options = [...fixture.nativeElement.querySelectorAll('option')].map(option => (option as HTMLOptionElement).value);
    expect(options).toEqual(['Question', 'Proposal', 'Complaint']);
  });

  it('keeps only the first five selected files and warns about the rest', () => {
    setup();
    const selected = Array.from({ length: 6 }, (_, index) => new File(['a'], `f${index}.txt`, { type: 'text/plain' }));

    component.onFiles({ target: { files: selected } } as unknown as Event);

    expect(component.files.length).toBe(5);
    expect(component.files.map(file => file.name)).toEqual(['f0.txt', 'f1.txt', 'f2.txt', 'f3.txt', 'f4.txt']);
    expect(component.fileLimitReached()).toBeTrue();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('5 premiers fichiers');
  });

  it('sends the trimmed body and the files still attached after a removal', () => {
    setup();
    const kept = new File(['a'], 'kept.txt', { type: 'text/plain' });
    const dropped = new File(['b'], 'dropped.txt', { type: 'text/plain' });
    component.files = [dropped, kept];
    component.removeFile(0);
    component.body = '  bonjour  ';
    component.category = 'Proposal';
    support.post.and.returnValue(of(ok(message({ id: 'sent', category: 'Proposal', body: 'bonjour' }))));

    component.send();

    expect(support.post).toHaveBeenCalledWith('Proposal', 'bonjour', jasmine.any(String), [kept]);
    expect(component.body).toBe('');
    expect(component.files).toEqual([]);
    expect(badge.refresh).toHaveBeenCalled();
  });

  it('clears the native file input after a successful send', () => {
    setup();
    const input = fixture.nativeElement.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['a'], 'note.txt', { type: 'text/plain' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change'));
    support.post.and.returnValue(of(ok(message({ id: 'sent' }))));
    component.body = 'bonjour';

    component.send();

    expect(input.value).toBe('');
    expect(component.files).toEqual([]);
  });

  it('shows the server message when sending fails and keeps the draft', () => {
    setup();
    component.body = 'bonjour';
    component.files = [new File(['a'], 'note.txt', { type: 'text/plain' })];
    support.post.and.returnValue(of({
      success: false,
      data: null as unknown as CompanySupportMessage,
      message: 'Refusé',
      errors: ['Refusé']
    }));

    component.send();
    fixture.detectChanges();

    expect(component.body).toBe('bonjour');
    expect(component.files.length).toBe(1);
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('Refusé');
  });

  it('labels platform messages as Assistance and escapes the body as text', () => {
    setup([
      message({
        id: 'platform',
        authorSide: 'Platform',
        authorDisplayName: 'Opérateur Secret',
        category: 'Reply',
        body: '<script>alert(1)</script>'
      })
    ]);

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Assistance');
    expect(text).not.toContain('Opérateur Secret');
    expect(text).toContain('<script>alert(1)</script>');
    expect(fixture.nativeElement.querySelector('script')).toBeNull();
    expect(fixture.nativeElement.querySelector('.chip').getAttribute('data-category')).toBe('Reply');
    expect(fixture.nativeElement.querySelector('time').getAttribute('datetime')).toBe('2026-09-24T22:15:00.000Z');
  });

  it('downloads an attachment through the support service', () => {
    setup([
      message({
        attachments: [{ id: 'file-1', fileName: 'preuve.pdf', contentType: 'application/pdf', sizeBytes: 2048 }]
      })
    ]);
    support.download.and.returnValue(of(new Blob(['pdf'])));
    spyOn(URL, 'createObjectURL').and.returnValue('blob:preuve');
    spyOn(URL, 'revokeObjectURL');

    fixture.nativeElement.querySelector('.file-link').click();

    expect(support.download).toHaveBeenCalledWith('file-1');
    expect(fixture.nativeElement.querySelector('.file-link').textContent).toContain('preuve.pdf');
    expect(fixture.nativeElement.querySelector('.file-link').textContent).toContain('Ko');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preuve');
  });

  it('reports a download failure without navigating away', () => {
    setup();
    support.download.and.returnValue(throwError(() => new Error('network')));

    component.download('file-1', 'preuve.pdf');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('Téléchargement impossible');
  });

  it('does not append a message that is already in the thread', () => {
    const existing = message({ id: 'same' });
    setup([existing]);
    support.post.and.returnValue(of(ok(existing)));
    component.body = 'bonjour';

    component.send();

    expect(component.messages().length).toBe(1);
  });

  it('shows a load error and leaves the composer usable', () => {
    support.bootstrap.and.returnValue(throwError(() => new Error('down')));
    fixture.detectChanges();

    expect(component.loading()).toBeFalse();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('Impossible de charger');
    expect(fixture.nativeElement.querySelector('button.send')).not.toBeNull();
  });
});
