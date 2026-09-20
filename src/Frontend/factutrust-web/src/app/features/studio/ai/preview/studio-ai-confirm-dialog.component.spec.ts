import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { StudioAiActivePlan } from '../studio-ai-session.store';
import { StudioSpecCounters } from '../studio-ai.models';
import { StudioAiConfirmDialogComponent } from './studio-ai-confirm-dialog.component';

const PLAN: StudioAiActivePlan = {
  planId: 'p1',
  kind: 'CreateSystem',
  expiresAt: null,
  rowVersion: 'rv1',
  summary: {
    kind: 'CreateSystem',
    title: 'Gestion des congés',
    steps: [],
    entities: [],
    warnings: []
  }
};

const COUNTERS: StudioSpecCounters = {
  entities: 4, fields: 28, relations: 3, forms: 4, seedRecords: 5, reports: 2, views: 0, workflows: 0
};

describe('StudioAiConfirmDialogComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StudioAiConfirmDialogComponent],
      providers: [provideNoopAnimations()]
    }).compileComponents();
  });

  function create() {
    const fixture = TestBed.createComponent(StudioAiConfirmDialogComponent);
    fixture.componentRef.setInput('plan', PLAN);
    fixture.componentRef.setInput('counters', COUNTERS);
    fixture.componentRef.setInput('warnings', ['Vérifiez la formule « Solde restant ».']);
    fixture.componentInstance.visible.set(true);
    fixture.detectChanges();
    return fixture;
  }

  function buttonByLabel(label: string): HTMLButtonElement | undefined {
    return Array.from(document.querySelectorAll('button'))
      .find(b => (b.textContent ?? '').includes(label)) as HTMLButtonElement | undefined;
  }

  /** Coche la case obligatoire via le vrai `input` rendu par p-checkbox. */
  async function check(fixture: ComponentFixture<StudioAiConfirmDialogComponent>): Promise<void> {
    const box = document.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    expect(box).withContext('case « J’ai vérifié la structure » absente').toBeTruthy();
    box?.click();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  it('affiche le nom du plan, les compteurs, les avertissements et la case obligatoire', () => {
    create();
    const text = document.body.textContent ?? '';
    expect(text).toContain('Gestion des congés');
    expect(text).toContain('Les éléments suivants vont être créés');
    expect(text).toContain('28');
    expect(text).toContain('Vérifiez la formule');
    expect(text).toContain('La création est définitive');
    expect(text).toContain('J’ai vérifié la structure');
  });

  it('garde « Intégrer » désactivé tant que la case n’est pas cochée', async () => {
    const fixture = create();
    let confirmed = 0;
    fixture.componentInstance.confirmed.subscribe(() => confirmed++);

    expect(buttonByLabel('Intégrer')?.disabled).toBeTrue();
    buttonByLabel('Intégrer')?.click();
    fixture.detectChanges();
    expect(confirmed).toBe(0);
    expect(fixture.componentInstance.visible()).toBeTrue();

    await check(fixture);
    expect(buttonByLabel('Intégrer')?.disabled).toBeFalse();
  });

  it('émet « confirmed » et referme le dialogue après avoir coché puis cliqué', async () => {
    const fixture = create();
    let confirmed = 0;
    fixture.componentInstance.confirmed.subscribe(() => confirmed++);

    await check(fixture);
    buttonByLabel('Intégrer')?.click();
    fixture.detectChanges();

    expect(confirmed).toBe(1);
    expect(fixture.componentInstance.visible()).toBeFalse();
  });

  it('remet la case à zéro à chaque réouverture', async () => {
    const fixture = create();
    await check(fixture);
    expect(buttonByLabel('Intégrer')?.disabled).toBeFalse();

    // p-dialog détruit puis reconstruit son contenu : on vérifie l'état interne, pas le DOM du footer.
    fixture.componentInstance.visible.set(false);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance.visible.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance['checked']()).toBeFalse();
  });

  it('émet « cancelled » sur « Annuler »', () => {
    const fixture = create();
    let cancelled = 0;
    fixture.componentInstance.cancelled.subscribe(() => cancelled++);

    buttonByLabel('Annuler')?.click();
    fixture.detectChanges();

    expect(cancelled).toBe(1);
    expect(fixture.componentInstance.visible()).toBeFalse();
  });
});
