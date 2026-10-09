import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { EntryBottomTabsComponent } from './entry-bottom-tabs.component';

describe('EntryBottomTabsComponent', () => {
  let fixture: ComponentFixture<EntryBottomTabsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EntryBottomTabsComponent],
      providers: [provideNoopAnimations()]
    }).compileComponents();

    fixture = TestBed.createComponent(EntryBottomTabsComponent);
    fixture.detectChanges();
  });

  it('renders three bottom tabs without ventilation analytique', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).not.toContain('Ventilation analytique');
    expect(el.textContent).toContain('Notes');
    expect(el.textContent).toContain('Historique');
    expect(el.textContent).toMatch(/Pièces jointes/i);
  });

  it('shows historique placeholder when Historique tab is selected', async () => {
    const historiqueTab = (
      Array.from(fixture.nativeElement.querySelectorAll('[role="tab"]')) as HTMLElement[]
    ).find(el => el.textContent?.includes('Historique'));
    historiqueTab?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      "L'historique des modifications sera disponible après l'enregistrement de l'écriture."
    );
  });
});
