import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { environment } from '@environments/environment';
import { RegistrationCatalogService } from './registration-catalog.service';
import type { SectorCatalogDto } from './sector-catalog.models';

const CATALOG_URL = `${environment.apiUrl}/public/sector-catalog`;

function buildCatalog(overrides: Partial<SectorCatalogDto> = {}): SectorCatalogDto {
  return {
    segments: [
      {
        code: 'commerce',
        labelFr: 'Commerce',
        descriptionFr: 'Négoce et distribution',
        iconKey: 'shopping-cart',
        sortOrder: 1,
        coreModuleIds: [0, 1, 2, 3, 4, 5],
        recommendedModuleIds: [6, 7, 10],
        defaultWarehouseName: 'Magasin principal',
        domainCodes: ['alimentation-agroalimentaire', 'autre']
      }
    ],
    domains: [
      { code: 'alimentation-agroalimentaire', labelFr: 'Alimentation', sortOrder: 1, additionalModuleIds: [7, 6] },
      { code: 'autre', labelFr: 'Autre domaine', sortOrder: 2, additionalModuleIds: [] },
      { code: 'transport-logistique', labelFr: 'Transport', sortOrder: 3, additionalModuleIds: [7] }
    ],
    modules: [
      { id: 0, code: 'Clients', labelFr: 'Clients', isCore: true, availableOnFreePlan: true },
      { id: 1, code: 'Products', labelFr: 'Produits', isCore: true, availableOnFreePlan: true },
      { id: 2, code: 'Sales', labelFr: 'Ventes', isCore: true, availableOnFreePlan: true },
      { id: 3, code: 'Treasury', labelFr: 'Trésorerie', isCore: true, availableOnFreePlan: true },
      { id: 4, code: 'Reports', labelFr: 'Rapports', isCore: true, availableOnFreePlan: true },
      { id: 5, code: 'Administration', labelFr: 'Administration', isCore: true, availableOnFreePlan: true },
      { id: 10, code: 'Fiscal', labelFr: 'Fiscal', isCore: false, availableOnFreePlan: true },
      { id: 6, code: 'Purchases', labelFr: 'Achats', isCore: false, availableOnFreePlan: true },
      { id: 7, code: 'Stock', labelFr: 'Stock', isCore: false, availableOnFreePlan: true },
      { id: 11, code: 'AI', labelFr: 'Assistant IA', isCore: false, availableOnFreePlan: false }
    ],
    moduleDependencies: [{ moduleId: 7, requiredModuleId: 6 }],
    suggestedTaxRegimes: [{ segmentCode: 'commerce', regime: 0, noteFr: 'Régime usuel du commerce.' }],
    catalogVersion: 'db:12',
    ...overrides
  };
}

describe('RegistrationCatalogService', () => {
  let service: RegistrationCatalogService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(RegistrationCatalogService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('utilise réellement le catalogue renvoyé par l’API', done => {
    service.load().subscribe(() => {
      expect(service.loadState()).toBe('remote');
      expect(service.segments().map(s => s.code)).toEqual(['commerce']);
      done();
    });

    httpMock.expectOne(CATALOG_URL).flush({ success: true, data: buildCatalog() });
  });

  it('n’offre que les domaines rattachés au segment', done => {
    service.load().subscribe(() => {
      const codes = service.domainsForSegment('commerce').map(d => d.code);
      expect(codes).toEqual(['alimentation-agroalimentaire', 'autre']);
      // Un domaine non rattaché serait refusé par le serveur : il ne doit pas être proposé.
      expect(codes).not.toContain('transport-logistique');
      done();
    });

    httpMock.expectOne(CATALOG_URL).flush({ success: true, data: buildCatalog() });
  });

  it('ne propose aucun domaine tant qu’aucun segment n’est choisi', () => {
    expect(service.domainsForSegment(null)).toEqual([]);
  });

  it('fusionne socle, recommandations du segment et apports du domaine', done => {
    service.load().subscribe(() => {
      expect(service.recommendedModuleIds('commerce', 'alimentation-agroalimentaire'))
        .toEqual([0, 1, 2, 3, 4, 5, 6, 7, 10]);
      done();
    });

    httpMock.expectOne(CATALOG_URL).flush({ success: true, data: buildCatalog() });
  });

  it('résout les prérequis d’un module et ses dépendants', done => {
    service.load().subscribe(() => {
      expect(service.requiredBy(7)).toEqual([6]);
      expect(service.dependentsOf(6, [7])).toEqual([7]);
      expect(service.dependentsOf(6, [])).toEqual([]);
      done();
    });

    httpMock.expectOne(CATALOG_URL).flush({ success: true, data: buildCatalog() });
  });

  it('signale les modules réservés à un forfait supérieur', done => {
    service.load().subscribe(() => {
      expect(service.isLockedOnFreePlan(11)).toBeTrue();
      expect(service.isLockedOnFreePlan(6)).toBeFalse();
      done();
    });

    httpMock.expectOne(CATALOG_URL).flush({ success: true, data: buildCatalog() });
  });

  it('bascule en mode « désactivé » sur un 404, sans aucune reprise', done => {
    service.load().subscribe(() => {
      expect(service.loadState()).toBe('disabled');
      expect(service.isDisabled()).toBeTrue();
      done();
    });

    // Un 404 est une réponse définitive : réessayer serait du bruit.
    httpMock.expectOne(CATALOG_URL).flush(null, { status: 404, statusText: 'Not Found' });
  });

  it('retombe sur le catalogue statique après épuisement des reprises (5xx)', fakeAsync(() => {
    service.load().subscribe();

    // Tentative initiale + 2 reprises, chacune apres un backoff lineaire.
    for (let attempt = 0; attempt < 3; attempt++) {
      httpMock.expectOne(CATALOG_URL).flush(null, { status: 500, statusText: 'Server Error' });
      tick(1000);
    }

    expect(service.loadState()).toBe('fallback');
    expect(service.usedStaticFallback()).toBeTrue();
    // Le repli conserve des codes valides : c'est ce qui évite la saisie libre fautive.
    expect(service.segments().map(s => s.code)).toContain('commerce');
    expect(service.domainsForSegment('btp-construction').map(d => d.code)).toContain('immobilier');
  }));

  it('retombe aussi sur le statique si l’API renvoie un catalogue vide', done => {
    service.load().subscribe(() => {
      expect(service.loadState()).toBe('fallback');
      done();
    });

    httpMock.expectOne(CATALOG_URL).flush({ success: true, data: buildCatalog({ segments: [] }) });
  });

  it('propose le régime fiscal usuel du segment avec sa justification', done => {
    service.load().subscribe(() => {
      expect(service.suggestedTaxRegimeFor('commerce')).toEqual({
        regime: 0,
        noteFr: 'Régime usuel du commerce.'
      });
      expect(service.suggestedTaxRegimeFor('inconnu')).toBeNull();
      done();
    });

    httpMock.expectOne(CATALOG_URL).flush({ success: true, data: buildCatalog() });
  });
});
