import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Menu } from 'primeng/menu';
import { DocumentActionsMenuComponent } from './document-actions-menu.component';
import { MenuItem } from '@shared/models/menu-item.model';

describe('DocumentActionsMenuComponent', () => {
  let fixture: ComponentFixture<DocumentActionsMenuComponent>;
  let component: DocumentActionsMenuComponent;

  const sampleItems: MenuItem[] = [
    { label: 'Télécharger PDF', icon: 'pi pi-download', command: () => undefined },
    { label: 'Envoyer par email', icon: 'pi pi-envelope', command: () => undefined }
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DocumentActionsMenuComponent, NoopAnimationsModule]
    }).compileComponents();

    fixture = TestBed.createComponent(DocumentActionsMenuComponent);
    component = fixture.componentInstance;
  });

  it('renders the Actions button with the default label', () => {
    fixture.componentRef.setInput('items', sampleItems);
    fixture.detectChanges();

    const btn = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.textContent?.trim()).toContain('Actions');
  });

  it('hides the trigger when there are no visible items', () => {
    fixture.componentRef.setInput('items', [
      { separator: true },
      { label: 'Hidden', visible: false, command: () => undefined }
    ]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('button')).toBeNull();
    expect(fixture.nativeElement.querySelector('p-menu')).toBeNull();
  });

  it('configures p-menu with appendTo="body"', () => {
    fixture.componentRef.setInput('items', sampleItems);
    fixture.detectChanges();

    const menuDebug = fixture.debugElement.query(By.directive(Menu));
    expect(menuDebug).toBeTruthy();
    const menu = menuDebug.componentInstance as Menu;
    expect(menu.appendTo()).toBe('body'); // v20 : appendTo est un signal input
    expect(menu.popup).toBeTrue();
    expect(menu.styleClass).toContain('ft-document-actions-menu');
  });

  it('toggles the PrimeNG menu when the button is clicked', () => {
    fixture.componentRef.setInput('items', sampleItems);
    fixture.detectChanges();

    const menuDebug = fixture.debugElement.query(By.directive(Menu));
    const menu = menuDebug.componentInstance as Menu;
    const toggleSpy = spyOn(menu, 'toggle');

    const btn = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    btn.click();

    expect(toggleSpy).toHaveBeenCalled();
  });

  it('realigns the overlay to the end of the trigger on show', () => {
    fixture.componentRef.setInput('items', sampleItems);
    fixture.componentRef.setInput('align', 'end');
    fixture.detectChanges();

    const menuDebug = fixture.debugElement.query(By.directive(Menu));
    const menu = menuDebug.componentInstance as Menu & { container?: HTMLElement; target?: HTMLElement };

    const container = document.createElement('div');
    Object.defineProperty(container, 'offsetWidth', { value: 220 });
    container.style.position = 'absolute';
    container.style.left = '1000px';

    const targetRight = 400;
    const target = document.createElement('button');
    spyOn(target, 'getBoundingClientRect').and.returnValue({
      left: 260,
      right: targetRight,
      top: 80,
      bottom: 120,
      width: 140,
      height: 40,
      x: 260,
      y: 80,
      toJSON: () => ({})
    } as DOMRect);

    menu.container = container;
    menu.target = target;

    component.onShow();

    return Promise.resolve().then(() => {
      const left = parseFloat(container.style.left);
      const expected = targetRight - 220; // align end, within typical headless viewport
      expect(left).toBe(expected);
      expect(component.menuVisible()).toBeTrue();
    });
  });
});
