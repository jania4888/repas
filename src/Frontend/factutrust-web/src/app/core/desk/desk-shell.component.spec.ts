import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { AuthService } from '@core/services/auth.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { ToastService } from '@core/services/toast.service';
import { DeskShellComponent } from './desk-shell.component';
import { DeskWindowService } from './desk-window.service';
import { DeskWindowStore } from './desk-window.store';
import { DESK_SESSION_PREFIX } from './desk-window.model';

@Component({
  selector: 'app-desk-shell-host',
  standalone: true,
  imports: [DeskShellComponent],
  template: `
    <app-desk-shell>
      <div data-desk-body>Journal comptable</div>
    </app-desk-shell>
  `
})
class DeskShellHostComponent {}

describe('DeskShellComponent', () => {
  const user = signal({
    id: 'user-1',
    tenantId: 'firm-1',
    accessMode: 'delegated',
    contextTenantId: 'client-a',
    tenantKind: 'accountingFirm'
  });
  let events: Subject<unknown>;
  let navigateByUrl: jasmine.Spy;
  let fixture: ComponentFixture<DeskShellHostComponent>;
  let store: DeskWindowStore;

  beforeEach(async () => {
    user.set({
      id: 'user-1',
      tenantId: 'firm-1',
      accessMode: 'delegated',
      contextTenantId: 'client-a',
      tenantKind: 'accountingFirm'
    });
    clearDeskSession();
    events = new Subject();
    document.documentElement.dir = 'ltr';
    document.querySelector('.p-dialog-mask')?.remove();
    navigateByUrl = jasmine.createSpy('navigateByUrl').and.resolveTo(true);
    await TestBed.configureTestingModule({
      imports: [DeskShellHostComponent],
      providers: [
        {
          provide: AuthService,
          useValue: {
            user,
            isAccountingFirm: () => user().tenantKind === 'accountingFirm',
            isDelegatedMode: () => user().accessMode === 'delegated'
          }
        },
        {
          provide: Router,
          useValue: {
            events,
            navigated: true,
            url: '/accounting/journal',
            getCurrentNavigation: () => null,
            navigateByUrl,
            routerState: { snapshot: { root: { title: 'Journal - InstaFact', firstChild: null } } }
          }
        },
        { provide: ToastService, useValue: { add: jasmine.createSpy('add') } },
        { provide: ConfirmationService, useValue: { confirm() {} } }
      ]
    }).compileComponents();

    store = TestBed.inject(DeskWindowStore);
    fixture = TestBed.createComponent(DeskShellHostComponent);
    store.upsert({
      key: '/accounting/chart',
      url: '/accounting/chart',
      title: 'Plan comptable',
      tenantKey: 'delegated:client-a'
    });
    fixture.detectChanges();
  });

  afterEach(() => {
    document.documentElement.dir = 'ltr';
    document.querySelector('.p-dialog-mask')?.remove();
    clearDeskSession();
  });

  it('ferme, réduit et active depuis le chrome', () => {
    button('Fermer Journal').click();
    expect(navigateByUrl).toHaveBeenCalledWith('/accounting/chart', jasmine.objectContaining({
      state: { deskAction: 'close-current' }
    }));

    button('Réduire Journal').click();
    expect(navigateByUrl).toHaveBeenCalledWith('/accounting/chart', jasmine.objectContaining({
      state: { deskAction: 'preserve' }
    }));

    button('Afficher Plan comptable').click();
    expect(navigateByUrl).toHaveBeenCalledWith('/accounting/chart', jasmine.objectContaining({
      state: { deskAction: 'preserve' }
    }));
  });

  it('refuse la bascule tant qu’une fenêtre de dialogue est ouverte', () => {
    document.body.append(Object.assign(document.createElement('div'), { className: 'p-dialog-mask' }));
    navigateByUrl.calls.reset();

    button('Fermer Journal').click();
    button('Réduire Journal').click();
    button('Afficher Plan comptable').click();

    expect(navigateByUrl).not.toHaveBeenCalled();
    expect(TestBed.inject(ToastService).add).toHaveBeenCalled();
  });

  it('déplace le focus au clavier, y compris en arabe', () => {
    const tasks = fixture.nativeElement.querySelectorAll('.desk__task-main') as NodeListOf<HTMLButtonElement>;
    expect(tasks.length).toBe(2);
    tasks[0].focus();
    tasks[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(tasks[1]);

    document.documentElement.dir = 'rtl';
    tasks[1].focus();
    tasks[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(document.activeElement).toBe(tasks[0]);
  });

  it('place les onglets sous le titre et au-dessus du contenu', () => {
    const title = fixture.nativeElement.querySelector('.desk__titlebar') as HTMLElement;
    const taskbar = fixture.nativeElement.querySelector('.desk__taskbar') as HTMLElement;
    const canvas = fixture.nativeElement.querySelector('.desk__canvas') as HTMLElement;
    const marker = markerIn(fixture);

    expect(title.compareDocumentPosition(taskbar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(taskbar.compareDocumentPosition(canvas) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(canvas.contains(marker)).toBeTrue();
    expect(marker.textContent).toContain('Journal comptable');
  });

  it('affiche le contenu projeté dans le canevas et le conserve hors dossier', () => {
    const marker = markerIn(fixture);
    expect(marker.textContent).toContain('Journal comptable');
    expect(fixture.nativeElement.querySelector('.desk__canvas')?.contains(marker)).toBeTrue();

    user.set(companyUser());
    TestBed.inject(DeskWindowService).syncMode();
    fixture.detectChanges();

    const hidden = markerIn(fixture);
    expect(hidden).toBe(marker);
    expect(fixture.nativeElement.querySelector('.desk__titlebar')).toBeNull();
    expect(fixture.nativeElement.querySelector('.desk__taskbar')).toBeNull();

    user.set(delegatedUser());
    TestBed.inject(DeskWindowService).syncMode();
    fixture.detectChanges();

    const restored = markerIn(fixture);
    expect(restored).toBe(marker);
    expect(fixture.nativeElement.querySelector('.desk__canvas')?.contains(restored)).toBeTrue();
    expect(fixture.nativeElement.querySelector('.desk__taskbar')).not.toBeNull();
  });

  it('n’affiche pas de barre des tâches hors dossier délégué', () => {
    user.set(companyUser());
    TestBed.inject(DeskWindowService).syncMode();
    events.next(new NavigationEnd(1, '/dashboard', '/dashboard'));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.desk__taskbar')).toBeNull();
    expect(fixture.nativeElement.querySelector('.desk__titlebar')).toBeNull();
  });

  function button(label: string): HTMLButtonElement {
    const found = [...fixture.nativeElement.querySelectorAll('button')].find(candidate =>
      (candidate as HTMLButtonElement).getAttribute('aria-label') === label
    ) as HTMLButtonElement | undefined;
    if (!found) throw new Error(`Bouton introuvable : ${label}`);
    return found;
  }
});

function markerIn(fixture: ComponentFixture<DeskShellHostComponent>): HTMLElement {
  const marker = fixture.nativeElement.querySelector('[data-desk-body]') as HTMLElement | null;
  expect(marker).withContext('contenu projeté').not.toBeNull();
  return marker as HTMLElement;
}

function delegatedUser() {
  return {
    id: 'user-1',
    tenantId: 'firm-1',
    accessMode: 'delegated',
    contextTenantId: 'client-a',
    tenantKind: 'accountingFirm'
  };
}

function companyUser() {
  return {
    id: 'user-1',
    tenantId: 'company-1',
    accessMode: 'native',
    contextTenantId: 'company-1',
    tenantKind: 'company'
  };
}

function clearDeskSession(): void {
  for (const key of Object.keys(sessionStorage)) {
    if (key.startsWith(DESK_SESSION_PREFIX)) sessionStorage.removeItem(key);
  }
}
