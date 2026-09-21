import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Router } from '@angular/router';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';

import { PlatformTenantsPageComponent } from './platform-tenants-page.component';
import { PlatformTenantService } from '@core/services/platform-tenant.service';
import { PlatformPermissionsService } from '@core/services/platform-permissions.service';
import { PlatformPermission } from '@core/models/platform.models';

/**
 * Regression : le menu « Nouveau cabinet comptable » ne repondait pas au clic.
 *
 * `[model]` recevait un tableau reconstruit à chaque lecture ; le setter `model` du TieredMenu de
 * PrimeNG rebâtit alors ses `processedItems` et son `ngFor` (sans `trackBy`) détruit puis recrée
 * les `<li>`. Le nœud disparaissant entre `mousedown` et `mouseup`, le navigateur n'émet aucun
 * `click` et la commande ne part jamais. La garde est donc une assertion d'IDENTITÉ de référence,
 * pas d'égalité de contenu : un `toEqual` laisserait le bug passer.
 */
describe('PlatformTenantsPageComponent — menu de création', () => {
  let fixture: ComponentFixture<PlatformTenantsPageComponent>;
  let component: PlatformTenantsPageComponent;
  let router: jasmine.SpyObj<Router>;

  function setup(options?: { accountingFirms?: boolean }): void {
    const api = jasmine.createSpyObj<PlatformTenantService>(
      'PlatformTenantService',
      ['list', 'stats', 'loadSavedViews', 'saveView', 'deleteSavedView'],
      { builtInViews: [] }
    );
    api.list.and.returnValue(of({ success: true, data: { items: [], totalCount: 0 } }) as never);
    api.stats.and.returnValue(of({ success: true, data: { totalTenants: 0, payingSubscribers: 0, nonPayingSubscribers: 0 } }) as never);
    api.loadSavedViews.and.returnValue([]);

    const permissions = jasmine.createSpyObj<PlatformPermissionsService>(
      'PlatformPermissionsService',
      ['has', 'hasAny', 'hasAll', 'hasRole', 'hasFeature', 'isLoaded']
    );
    permissions.isLoaded.and.returnValue(true);
    permissions.has.and.callFake((p: string) => p === PlatformPermission.TenantsWrite);
    permissions.hasFeature.and.returnValue(options?.accountingFirms ?? true);

    router = jasmine.createSpyObj<Router>('Router', ['navigate', 'createUrlTree', 'serializeUrl']);
    router.navigate.and.returnValue(Promise.resolve(true));

    TestBed.configureTestingModule({
      imports: [PlatformTenantsPageComponent],
      providers: [
        { provide: PlatformTenantService, useValue: api },
        { provide: PlatformPermissionsService, useValue: permissions },
        { provide: Router, useValue: router },
        MessageService,
        provideNoopAnimations()
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(PlatformTenantsPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('garde la MÊME référence de tableau entre deux cycles de détection', () => {
    setup();
    const first = component.createTenantMenuItems();

    fixture.detectChanges();
    fixture.detectChanges();

    expect(component.createTenantMenuItems()).toBe(first);
    expect(component.createTenantMenuItems()[0]).toBe(first[0]);
  });

  it('navigue vers le formulaire cabinet quand la commande de l’item est exécutée', () => {
    setup();
    const item = component.createTenantMenuItems()[0];

    expect(item.label).toBe('Nouveau cabinet comptable');
    item.command?.({} as never);

    expect(router.navigate).toHaveBeenCalledWith(['/tenants/new/firm']);
  });

  it('garde le meme noeud DOM sous le curseur apres un survol de l’item', () => {
    setup();

    const host = fixture.nativeElement as HTMLElement;
    const dropdown = host.querySelector<HTMLElement>(
      '.p-splitbutton-dropdown, .p-splitbutton button + button'
    );
    expect(dropdown).withContext('bouton d’ouverture du menu introuvable').toBeTruthy();
    dropdown!.click();
    fixture.detectChanges();

    const content = host.querySelector<HTMLElement>('.p-tieredmenu-item-content');
    expect(content).withContext('item de menu introuvable').toBeTruthy();

    // Le survol declenche un cycle de detection : c'est la que l'ancien code rebatissait le
    // modele et faisait recreer le <li>. Un noeud detache entre mousedown et mouseup empeche le
    // navigateur d'emettre le `click` : l'action devenait injouable a la souris.
    content!.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    fixture.detectChanges();
    fixture.detectChanges();

    expect(content!.isConnected).withContext('le noeud survole a ete detache du document').toBeTrue();
    expect(host.querySelector('.p-tieredmenu-item-content')).toBe(content);
  });

  it('offre le menu quand le drapeau accountingFirms est actif', () => {
    setup({ accountingFirms: true });
    expect(component.canCreateTenant()).toBeTrue();
    expect(component.canCreateFirm()).toBeTrue();
  });

  it('retire le menu quand l’instance a désactivé les cabinets', () => {
    setup({ accountingFirms: false });
    expect(component.canCreateTenant()).toBeTrue();
    expect(component.canCreateFirm()).toBeFalse();
  });
});
