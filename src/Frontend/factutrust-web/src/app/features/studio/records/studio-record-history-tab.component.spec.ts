import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MessageService } from 'primeng/api';
import { environment } from '@environments/environment';
import { CustomField, CustomFieldType } from '@shared/studio-runtime/studio-runtime.models';
import { StudioRecordHistoryEntry } from './studio-record-history.models';
import { StudioRecordHistoryTabComponent } from './studio-record-history-tab.component';

const HISTORY_URL = `${environment.apiUrl}/studio/records/interventions/r1/history`;

function field(key: string, fieldType: CustomFieldType, extra: Partial<CustomField> = {}): CustomField {
  return {
    id: `id-${key}`, key, label: key.toUpperCase(), fieldType, isRequired: false, isUnique: false,
    sortOrder: 0, rules: null, options: null, relation: null, isActive: true, ...extra
  };
}

const FIELDS: CustomField[] = [
  field('nom', CustomFieldType.Text, { label: 'Nom' }),
  field('statut', CustomFieldType.Select, {
    label: 'Statut',
    options: [{ value: 'a_planifier', label: 'À planifier' }, { value: 'termine', label: 'Terminé' }]
  }),
  field('urgent', CustomFieldType.Boolean, { label: 'Urgent' }),
  field('ancien_code', CustomFieldType.Text, { label: 'Ancien code', isActive: false })
];

const ENTRIES: StudioRecordHistoryEntry[] = [
  {
    id: 'h1', action: 'Studio.Record.Updated', createdAt: '2026-09-19T10:30:00Z', userName: 'Alice Martin',
    changes: [
      { key: 'statut', oldValue: 'a_planifier', newValue: 'termine' },
      { key: 'nom', oldValue: 'Pompe A', newValue: 'Pompe A2' },
      { key: 'urgent', oldValue: 'true', newValue: null }
    ]
  },
  {
    id: 'h2', action: 'Studio.Record.Created', createdAt: '2026-09-18T08:00:00Z', userName: null,
    changes: [
      { key: 'nom', oldValue: null, newValue: 'Pompe A' },
      { key: 'ancien_code', oldValue: null, newValue: 'X-12' },
      { key: 'champ_supprime', oldValue: null, newValue: 'legacy' },
      { key: '_raw', oldValue: null, newValue: '{"a":1}' }
    ]
  },
  { id: 'h3', action: 'Studio.Record.Deleted', createdAt: '2026-09-20T12:00:00Z', userName: 'Bob', changes: [] }
];

function page(items: StudioRecordHistoryEntry[], opts: { page?: number; totalCount?: number; hasNextPage?: boolean } = {}) {
  const totalCount = opts.totalCount ?? items.length;
  return {
    success: true,
    data: {
      items, page: opts.page ?? 1, pageSize: 20, totalCount, totalPages: Math.max(1, Math.ceil(totalCount / 20)),
      hasNextPage: opts.hasNextPage ?? false, hasPreviousPage: (opts.page ?? 1) > 1
    },
    message: null,
    error: null
  };
}

describe('StudioRecordHistoryTabComponent — onglet « Historique » de la fiche (4.7h4, D-47-65)', () => {
  let fixture: ComponentFixture<StudioRecordHistoryTabComponent>;
  let component: StudioRecordHistoryTabComponent;
  let httpMock: HttpTestingController;
  let toastSpy: jasmine.Spy;

  function setup(fields: CustomField[] = FIELDS): void {
    TestBed.configureTestingModule({
      imports: [StudioRecordHistoryTabComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideNoopAnimations(), MessageService]
    });
    toastSpy = spyOn(TestBed.inject(MessageService), 'add');
    fixture = TestBed.createComponent(StudioRecordHistoryTabComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.componentRef.setInput('entityKey', 'interventions');
    fixture.componentRef.setInput('recordId', 'r1');
    fixture.componentRef.setInput('fields', fields);
    fixture.detectChanges();
  }

  function el(testid: string): HTMLElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${testid}"]`);
  }

  function text(testid: string): string {
    return (el(testid)?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  function expectHistoryRequest(expectedPage: string): TestRequest {
    const req = httpMock.expectOne(r => r.url === HISTORY_URL);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('page')).toBe(expectedPage);
    expect(req.request.params.get('pageSize')).toBe('20');
    return req;
  }

  /** Clic sur un p-button repéré par data-testid (hôte p-button ⇒ bouton interne). */
  function clickButton(testid: string): void {
    const host = el(testid);
    expect(host).withContext(`bouton ${testid} présent`).not.toBeNull();
    const button = host!.tagName === 'BUTTON' ? host! : host!.querySelector('button');
    (button as HTMLButtonElement).click();
    fixture.detectChanges();
  }

  afterEach(() => httpMock.verify());

  it('charge la page 1 (pageSize=20) à l’initialisation et affiche le squelette pendant le chargement', () => {
    setup();
    expect(component.loading()).toBeTrue();
    expect((fixture.nativeElement as HTMLElement).querySelector('app-skeleton-table')).not.toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('p-table')).toBeNull();
    const req = expectHistoryRequest('1');
    req.flush(page(ENTRIES));
    fixture.detectChanges();
    expect(component.loading()).toBeFalse();
    expect((fixture.nativeElement as HTMLElement).querySelector('app-skeleton-table')).toBeNull();
    expect(text('srh-count')).toBe('3 sur 3');
  });

  it('rend une ligne par entrée : date, action (tag), utilisateur ou « Utilisateur inconnu »', () => {
    setup();
    expectHistoryRequest('1').flush(page(ENTRIES));
    fixture.detectChanges();
    expect(el('srh-row-h1')).not.toBeNull();
    expect(el('srh-row-h2')).not.toBeNull();
    expect(el('srh-row-h3')).not.toBeNull();
    expect(text('srh-date-h1')).toMatch(/^\d{2}\/\d{2}\/2026 \d{2}:\d{2}$/);
    expect(text('srh-action-h1')).toBe('Modification');
    expect(text('srh-action-h2')).toBe('Création');
    expect(text('srh-action-h3')).toBe('Suppression');
    expect(text('srh-user-h1')).toBe('Alice Martin');
    expect(text('srh-user-h2')).toBe('Utilisateur inconnu');
    expect(el('srh-user-h2')!.classList).toContain('studio-muted');
    expect(el('srh-user-h1')!.classList).not.toContain('studio-muted');
  });

  it('affiche les changements inline : changé (ancien → nouveau), ajouté (nouveau seul), retiré (ancien → (vide))', () => {
    setup();
    expectHistoryRequest('1').flush(page(ENTRIES));
    fixture.detectChanges();
    expect(text('srh-change-h1-statut')).toBe('Statut : À planifier → Terminé');
    expect(el('srh-change-h1-statut')!.querySelector('.srh-old')!.textContent!.trim()).toBe('À planifier');
    expect(el('srh-change-h1-statut')!.querySelector('.srh-new')!.textContent!.trim()).toBe('Terminé');
    expect(text('srh-change-h1-urgent')).toBe('Urgent : Oui → (vide)');
    expect(text('srh-change-h2-nom')).toBe('Nom : Pompe A');
    expect(el('srh-change-h2-nom')!.querySelector('.srh-old')).toBeNull();
  });

  it('rend « — » pour une suppression (aucun changement)', () => {
    setup();
    expectHistoryRequest('1').flush(page(ENTRIES));
    fixture.detectChanges();
    expect(text('srh-changes-h3')).toBe('—');
    expect(el('srh-changes-h3')!.tagName).toBe('SPAN');
    expect(el('srh-more-h3')).toBeNull();
  });

  it('résout les libellés de champ sur le schéma complet (actif, inactif) et replie sur la clé brute (_raw, champ supprimé)', () => {
    setup();
    expectHistoryRequest('1').flush(page(ENTRIES));
    fixture.detectChanges();
    expect(text('srh-change-h2-nom')).toContain('Nom :');
    expect(text('srh-change-h2-ancien_code')).toBe('Ancien code : X-12');
    expect(text('srh-change-h2-champ_supprime')).toBe('champ_supprime : legacy');
    expect(text('srh-change-h2-_raw')).toBe('_raw : {"a":1}');
  });

  it('replie au-delà de 5 changements (« Afficher les n autres ») puis déplie (« Réduire »)', () => {
    setup();
    const many: StudioRecordHistoryEntry = {
      id: 'h9', action: 'Studio.Record.Created', createdAt: '2026-09-19T10:00:00Z', userName: 'Alice Martin',
      changes: Array.from({ length: 7 }, (_, i) => ({ key: `c${i + 1}`, oldValue: null, newValue: `v${i + 1}` }))
    };
    expectHistoryRequest('1').flush(page([many]));
    fixture.detectChanges();
    expect(el('srh-changes-h9')!.querySelectorAll('li').length).toBe(5);
    expect(el('srh-change-h9-c6')).toBeNull();
    expect(text('srh-more-h9')).toBe('Afficher les 2 autres');
    expect(el('srh-more-h9')!.getAttribute('aria-expanded')).toBe('false');

    clickButton('srh-more-h9');
    expect(el('srh-changes-h9')!.querySelectorAll('li').length).toBe(7);
    expect(el('srh-change-h9-c7')).not.toBeNull();
    expect(text('srh-more-h9')).toBe('Réduire');
    expect(el('srh-more-h9')!.getAttribute('aria-expanded')).toBe('true');

    clickButton('srh-more-h9');
    expect(el('srh-changes-h9')!.querySelectorAll('li').length).toBe(5);
  });

  it('affiche l’état vide (srh-empty) sans compteur quand l’historique est vide', () => {
    setup();
    expectHistoryRequest('1').flush(page([]));
    fixture.detectChanges();
    expect(el('srh-empty')).not.toBeNull();
    expect(text('srh-empty')).toContain('Aucun historique pour cet enregistrement');
    expect(el('srh-count')).toBeNull();
    expect(el('srh-load-more')).toBeNull();
  });

  it('affiche la bannière d’erreur en ligne (message serveur) et « Réessayer » relance la page 1', () => {
    setup();
    expectHistoryRequest('1').flush({ success: false, data: null, message: 'Panne', error: 'Historique indisponible' },
      { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
    expect(el('srh-error')).not.toBeNull();
    expect(el('srh-error')!.getAttribute('role')).toBe('alert');
    expect(text('srh-error')).toContain('Historique indisponible');
    expect((fixture.nativeElement as HTMLElement).querySelector('p-table')).toBeNull();
    expect(toastSpy).not.toHaveBeenCalled();

    clickButton('srh-retry');
    expectHistoryRequest('1').flush(page(ENTRIES));
    fixture.detectChanges();
    expect(el('srh-error')).toBeNull();
    expect(el('srh-row-h1')).not.toBeNull();
  });

  it('« Charger plus » n’apparaît que s’il reste une page, ajoute la page 2 dédoublonnée, puis disparaît', () => {
    setup();
    expectHistoryRequest('1').flush(page(ENTRIES, { totalCount: 5, hasNextPage: true }));
    fixture.detectChanges();
    expect(el('srh-load-more')).not.toBeNull();
    expect(text('srh-count')).toBe('3 sur 5');

    clickButton('srh-load-more');
    expect(component.loadingMore()).toBeTrue();
    const h4: StudioRecordHistoryEntry = { id: 'h4', action: 'Studio.Record.Updated', createdAt: '2026-09-17T09:00:00Z', userName: 'Bob', changes: [] };
    const h5: StudioRecordHistoryEntry = { id: 'h5', action: 'Studio.Record.Created', createdAt: '2026-09-16T09:00:00Z', userName: 'Bob', changes: [] };
    expectHistoryRequest('2').flush(page([ENTRIES[2], h4, h5], { page: 2, totalCount: 5, hasNextPage: false }));
    fixture.detectChanges();
    expect(component.entries().map(e => e.id)).toEqual(['h1', 'h2', 'h3', 'h4', 'h5']);
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('tr[data-testid^="srh-row-"]').length).toBe(5);
    expect(text('srh-count')).toBe('5 sur 5');
    expect(el('srh-load-more')).toBeNull();
    expect(component.page()).toBe(2);
  });

  it('n’expose aucune action d’écriture et garde le tableau si « Charger plus » échoue (toast warn)', () => {
    setup();
    expectHistoryRequest('1').flush(page(ENTRIES, { totalCount: 40, hasNextPage: true }));
    fixture.detectChanges();
    const buttons = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'));
    const allowed = ['srh-load-more', 'srh-retry'];
    for (const button of buttons) {
      const testid = button.closest('[data-testid]')?.getAttribute('data-testid') ?? '';
      expect(allowed.includes(testid) || testid.startsWith('srh-more-')).withContext(`bouton inattendu ${testid}`).toBeTrue();
    }
    expect((fixture.nativeElement as HTMLElement).querySelector('input, textarea, select, form')).toBeNull();
    expect((fixture.nativeElement as HTMLElement).innerHTML).not.toMatch(/[\w.-]+@[\w.-]+\.\w+/);

    clickButton('srh-load-more');
    expectHistoryRequest('2').flush({ success: false, data: null, message: null, error: 'Trop de requêtes' },
      { status: 429, statusText: 'Too Many Requests' });
    fixture.detectChanges();
    expect(component.loadingMore()).toBeFalse();
    expect(component.entries().length).toBe(3);
    expect(el('srh-row-h1')).not.toBeNull();
    expect(el('srh-error')).toBeNull();
    expect(el('srh-load-more')).not.toBeNull();
    expect(toastSpy).toHaveBeenCalledWith(jasmine.objectContaining({ severity: 'warn', detail: 'Trop de requêtes' }));
  });
});
