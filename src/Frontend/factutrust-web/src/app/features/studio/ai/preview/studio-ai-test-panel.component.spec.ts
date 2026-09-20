import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { DynamicFormComponent } from '@shared/studio-runtime/dynamic-form.component';
import { DynamicReportComponent } from '@shared/studio-runtime/dynamic-report.component';
import { ReportResult } from '@shared/studio-runtime/studio-runtime.models';
import { STUDIO_AI_LABELS } from '../studio-ai-labels';
import { StudioAiTestPanelComponent } from './studio-ai-test-panel.component';
import { studioAiSpecFixture } from './testing/studio-ai-spec.fixture';

describe('StudioAiTestPanelComponent', () => {
  let fixture: ComponentFixture<StudioAiTestPanelComponent>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StudioAiTestPanelComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideNoopAnimations()]
    }).compileComponents();
    fixture = TestBed.createComponent(StudioAiTestPanelComponent);
    httpMock = TestBed.inject(HttpTestingController);
    fixture.componentRef.setInput('spec', studioAiSpecFixture());
    fixture.detectChanges();
  });

  afterEach(() => httpMock.verify());

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return (host().textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  function dynamicForm(): DynamicFormComponent {
    const debug = fixture.debugElement.query(By.directive(DynamicFormComponent));
    expect(debug).withContext('le formulaire dynamique est rendu').not.toBeNull();
    return debug.componentInstance as DynamicFormComponent;
  }

  it('rend le formulaire dynamique de la table choisie sans appel HTTP', () => {
    // Par défaut : première table de la spec.
    let dyn = dynamicForm();
    expect(dyn.entityKey).toBe('employes');
    expect(dyn.fields.map(f => f.key)).toEqual(['matricule', 'nom', 'statut']);
    expect(text()).toContain('Matricule');

    // Choix de la table « demandes » via le sélecteur (overlay PrimeNG dans le body) ;
    // PrimeNG 19 porte la classe `p-select` et le gestionnaire de clic sur l'hôte lui-même.
    const select = host().querySelector<HTMLElement>('p-select[data-component-id="sai-test-entity"]');
    expect(select).withContext('sélecteur de table à tester').not.toBeNull();
    select!.click();
    fixture.detectChanges();
    const option = Array.from(document.body.querySelectorAll<HTMLElement>('.p-select-option'))
      .find(o => o.textContent?.includes('Demande de congé'));
    expect(option).withContext('option « Demande de congé » du sélecteur').not.toBeNull();
    option!.click();
    fixture.detectChanges();

    // Champs + mise en page (2 sections) issus de la spec ; options de relation issues du seed local.
    dyn = dynamicForm();
    expect(dyn.entityKey).toBe('demandes');
    expect(dyn.fields.map(f => f.key)).toEqual(['employe_id', 'client_id', 'date_debut', 'nb_jours', 'montant']);
    expect(text()).toContain('Demandeur');
    expect(text()).toContain('Période');
    const relation = dyn.fields.find(f => f.key === 'employe_id');
    expect(relation?.options?.map(o => o.value)).toEqual(['E-001', 'E-002']);

    httpMock.verify();
  });

  it('Enregistrer (simulation) n’émet aucune requête et affiche le message', () => {
    // Formulaire valide : les champs requis de la première table sont renseignés.
    const dyn = dynamicForm();
    dyn.form.controls['matricule'].setValue('E-003');
    dyn.form.controls['nom'].setValue('Durand');
    fixture.detectChanges();

    const submit = host().querySelector<HTMLButtonElement>('app-dynamic-form button[type="submit"]');
    expect(submit).withContext('bouton Enregistrer du formulaire dynamique').not.toBeNull();
    expect(text()).not.toContain(STUDIO_AI_LABELS.simulation.saved);

    submit!.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.saved()).toBeTrue();
    expect(host().querySelector('[data-component-id="sai-test-saved"]')).not.toBeNull();
    expect(text()).toContain(STUDIO_AI_LABELS.simulation.saved);
    httpMock.verify();
  });

  it('affiche le bandeau Simulation', () => {
    const banner = host().querySelector('.p-message-warn');
    expect(banner).withContext('p-message severity="warn"').not.toBeNull();
    expect(banner?.textContent).toContain(STUDIO_AI_LABELS.simulation.banner);
  });

  it('préfère l’échantillon serveur au calcul local', () => {
    // « demandes » a un rapport ET des données de départ : le calcul local serait possible…
    const spec = studioAiSpecFixture();
    spec.seed = [
      ...(spec.seed ?? []),
      { entityRef: 'demandes', records: [{ employe_id: 'E-001', nb_jours: 5 }, { employe_id: 'E-002', nb_jours: 3 }] }
    ];
    fixture.componentRef.setInput('spec', spec);
    // …mais l'échantillon fourni par le serveur (summary.sample, P5) prime.
    const sample: ReportResult = {
      columns: [
        { key: 'employe_id', label: 'Employé', kind: 'dimension' },
        { key: 'count', label: 'count', kind: 'measure' }
      ],
      rows: [{ employe_id: 'Échantillon serveur', count: 99 }],
      totalRows: 1
    };
    fixture.componentRef.setInput('sample', sample);
    fixture.componentInstance.onEntityChange('demandes');
    fixture.detectChanges();

    expect(fixture.componentInstance.reportResult()).toBe(sample);
    const source = host().querySelector('[data-component-id="sai-test-report-source"]');
    expect(source?.textContent).toContain(STUDIO_AI_LABELS.simulation.sampleFromServer);
    expect(text()).toContain('Échantillon serveur');
    httpMock.verify();
  });

  it('affiche « indisponible » sans échantillon', () => {
    // « demandes » déclare un rapport mais la fixture n'a aucune donnée de départ pour elle.
    fixture.componentInstance.onEntityChange('demandes');
    fixture.detectChanges();

    expect(fixture.componentInstance.reportResult()).toBeNull();
    expect(host().querySelector('app-dynamic-report')).toBeNull();
    const zone = host().querySelector('[data-component-id="sai-test-report"]');
    expect(zone?.textContent).toContain('État des congés'); // rapport déclaré sur la table
    expect(zone?.textContent).toContain(STUDIO_AI_LABELS.simulation.reportUnavailable);
    httpMock.verify();
  });

  it('aucun appel HTTP pendant l’affichage du rapport', () => {
    // Données de départ sur « demandes » ⇒ échantillon agrégé localement, sans réseau.
    const spec = studioAiSpecFixture();
    spec.seed = [
      ...(spec.seed ?? []),
      {
        entityRef: 'demandes',
        records: [
          { employe_id: 'E-001', date_debut: '2026-09-01', nb_jours: 5 },
          { employe_id: 'E-001', date_debut: '2026-09-03', nb_jours: 3 },
          { employe_id: 'E-002', date_debut: '2026-09-02', nb_jours: 2 }
        ]
      }
    ];
    fixture.componentRef.setInput('spec', spec);
    fixture.componentInstance.onEntityChange('demandes');
    fixture.detectChanges();

    const report = fixture.debugElement.query(By.directive(DynamicReportComponent));
    expect(report).withContext('le rapport dynamique est rendu').not.toBeNull();
    expect((report.componentInstance as DynamicReportComponent).result?.totalRows).toBe(2);
    expect(text()).toContain('sum (Nombre de jours)');
    const source = host().querySelector('[data-component-id="sai-test-report-source"]');
    expect(source?.textContent).toContain(STUDIO_AI_LABELS.simulation.sampleFromSeed);
    // Export masqué (D21) : conteneur non interactif, `DynamicReportComponent` inchangé.
    const noexport = host().querySelector('.sai-test-report--noexport');
    expect(noexport?.getAttribute('aria-disabled')).toBe('true');
    expect(text()).toContain(STUDIO_AI_LABELS.simulation.exportUnavailable);
    httpMock.verify();
  });
});
