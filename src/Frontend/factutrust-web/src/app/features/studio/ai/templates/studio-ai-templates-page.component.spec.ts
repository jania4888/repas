import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { StudioAiBuildService } from '../../studio-ai-build.service';
import { StudioAiCapabilitiesService } from '../studio-ai-capabilities.service';
import { STUDIO_AI_LABELS } from '../studio-ai-labels';
import { STUDIO_AI_CAPABILITIES_FALLBACK, StudioTemplateListItemDto } from '../studio-ai.models';
import { StudioAiTemplatesPageComponent, groupTemplates } from './studio-ai-templates-page.component';

function template(key: string, over: Partial<StudioTemplateListItemDto> = {}): StudioTemplateListItemDto {
  return {
    key, displayName: `Modèle ${key}`, description: `Description ${key}`, category: 'Commercial', moduleTag: 'crm',
    source: 'builtin', entityCount: 4, ...over
  };
}

describe('StudioAiTemplatesPageComponent', () => {
  let fixture: ComponentFixture<StudioAiTemplatesPageComponent>;
  let builds: jasmine.SpyObj<StudioAiBuildService>;

  beforeEach(async () => {
    builds = jasmine.createSpyObj<StudioAiBuildService>('StudioAiBuildService', ['listTemplates', 'getCapabilities']);
    builds.listTemplates.and.returnValue(of({ success: true, data: [], message: null, errors: [] }) as never);
    builds.getCapabilities.and.returnValue(of({
      success: true, message: null, errors: [], data: { ...STUDIO_AI_CAPABILITIES_FALLBACK, workbenchEnabled: true, templatesEnabled: true }
    }) as never);

    await TestBed.configureTestingModule({
      imports: [StudioAiTemplatesPageComponent],
      providers: [provideRouter([]), provideNoopAnimations(), { provide: StudioAiBuildService, useValue: builds }]
    }).compileComponents();
  });

  function create(): void {
    fixture = TestBed.createComponent(StudioAiTemplatesPageComponent);
    fixture.detectChanges();
  }

  function cards(): HTMLElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('[data-template-key]'));
  }

  it('renders the templates grouped by category with their source badge and « Utiliser ce modèle » → /studio/ai?template=key', () => {
    builds.listTemplates.and.returnValue(of({
      success: true, message: null, errors: [],
      data: [template('crm'), template('paie', { category: 'RH', source: 'tenant' }), template('stock', { category: '' })]
    }) as never);
    create();

    const groups = Array.from(fixture.nativeElement.querySelectorAll('[data-category]')) as HTMLElement[];
    expect(groups.map(g => g.getAttribute('data-category'))).toEqual(['Commercial', 'RH', STUDIO_AI_LABELS.templates.uncategorized]);
    expect(cards().length).toBe(3);
    expect(cards()[0].textContent).toContain('Modèle crm');
    expect(cards()[0].textContent).toContain(STUDIO_AI_LABELS.templates.sourceBuiltin);
    expect(cards()[0].textContent).toContain('4 table(s)');
    expect(cards()[1].textContent).toContain(STUDIO_AI_LABELS.templates.sourceTenant);
    const use = cards()[0].querySelector('a.sat__use') as HTMLAnchorElement;
    expect(use.textContent).toContain(STUDIO_AI_LABELS.templates.use);
    expect(use.getAttribute('href')).toBe('/studio/ai?template=crm');
  });

  it('shows the empty message when the catalogue is empty', () => {
    create();
    expect(fixture.nativeElement.querySelector('[data-testid="templates-empty"]').textContent).toContain(STUDIO_AI_LABELS.templates.empty);
  });

  it('shows the French error on HTTP failure', () => {
    builds.listTemplates.and.returnValue(throwError(() => new HttpErrorResponse({ status: 500 })) as never);
    create();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain(STUDIO_AI_LABELS.templates.loadFailed);
  });

  it('tells the user when the library is disabled by the administrator', () => {
    builds.getCapabilities.and.returnValue(of({
      success: true, message: null, errors: [], data: { ...STUDIO_AI_CAPABILITIES_FALLBACK, workbenchEnabled: true, templatesEnabled: false }
    }) as never);
    create();
    expect(TestBed.inject(StudioAiCapabilitiesService).state()).toBe('ready');
    expect(fixture.nativeElement.querySelector('[data-testid="templates-disabled"]').textContent).toContain(STUDIO_AI_LABELS.templates.disabled);
  });

  it('affiche le module, le nombre de relations et les modes de vue normalisés d\'un modèle', () => {
    builds.listTemplates.and.returnValue(of({
      success: true, message: null, errors: [],
      data: [template('paie', { moduleTag: 'RH & Paie', relationCount: 3, viewModes: ['list', 'kanban', 'calendar'] })]
    }) as never);
    create();

    const card = cards()[0];
    expect(card.querySelector('.sat__module')?.textContent).toContain('RH & Paie');
    expect(card.querySelector('.sat__card-relations')?.textContent).toContain('3 relation(s)');
    expect(card.querySelector('.sat__card-views')?.textContent?.trim()).toBe(
      `${STUDIO_AI_LABELS.views.list} · ${STUDIO_AI_LABELS.views.kanban} · ${STUDIO_AI_LABELS.views.calendar}`
    );
    expect(card.textContent).toContain('4 table(s)');
  });

  it('modes de vue dédoublonnés et traduits (List/kanban ⇒ Liste · Kanban)', () => {
    builds.listTemplates.and.returnValue(of({
      success: true, message: null, errors: [],
      data: [template('crm', { viewModes: ['List', 'liste', 'kanban', 'Kanban', 'table'] })]
    }) as never);
    create();

    expect(fixture.componentInstance.viewModesText(template('x', { viewModes: ['List', 'kanban'] }))).toBe('Liste · Kanban');
    expect(cards()[0].querySelector('.sat__card-views')?.textContent?.trim()).toBe('Liste · Kanban');
  });

  it('relationCount absent ou 0 ⇒ pas de mention de relation', () => {
    builds.listTemplates.and.returnValue(of({
      success: true, message: null, errors: [],
      data: [template('a'), template('b', { relationCount: 0, viewModes: null }), template('c', { relationCount: 2, viewModes: [] })]
    }) as never);
    create();

    expect(fixture.componentInstance.relationsText(template('a'))).toBe('');
    expect(cards()[0].querySelector('.sat__card-relations')).toBeNull();
    expect(cards()[0].textContent).not.toContain('relation(s)');
    expect(cards()[1].querySelector('.sat__card-relations')).toBeNull();
    expect(cards()[1].querySelector('.sat__card-views')).toBeNull();
    expect(cards()[2].querySelector('.sat__card-relations')?.textContent).toContain('2 relation(s)');
    expect(cards()[2].querySelector('.sat__card-views')).toBeNull();
  });

  it('groupTemplates keeps the first-seen category order', () => {
    const groups = groupTemplates([template('a', { category: 'B' }), template('b', { category: 'A' }), template('c', { category: 'B' })]);
    expect(groups.map(g => g.category)).toEqual(['B', 'A']);
    expect(groups[0].templates.map(t => t.key)).toEqual(['a', 'c']);
  });
});
