import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { ProductFormComponent } from './product-form.component';
import { ProductService } from '@core/services/product.service';
import { ProductCategoryService } from '@core/services/product-category.service';
import { SupplierService } from '@core/services/supplier.service';
import { StockService, StockFeatures } from '@core/services/stock.service';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { ErrorMessageService } from '@core/services/error-message.service';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';

const ALL_SIDE_FEATURES: StockFeatures = {
  lotTrackingEnabled: true,
  serialTrackingEnabled: true,
  expiryTrackingEnabled: true,
  productVariantsEnabled: true,
  fifoLifoValuationEnabled: true,
  blockExpiredLotsOnExit: false,
  strictTrackedAllocation: false
};

function sectionNumbers(fixture: ComponentFixture<ProductFormComponent>): string[] {
  return Array.from(
    fixture.nativeElement.querySelectorAll('.form-grid .section-number') as NodeListOf<HTMLElement>
  ).map(el => el.textContent?.trim() ?? '');
}

describe('ProductFormComponent — layout', () => {
  let component: ProductFormComponent;
  let fixture: ComponentFixture<ProductFormComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProductFormComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => null } } }
        },
        {
          provide: ProductService,
          useValue: {
            getProduct: jasmine.createSpy('getProduct'),
            createProduct: jasmine.createSpy('createProduct'),
            updateProduct: jasmine.createSpy('updateProduct'),
            resolveProductImageUrl: (url: string | null) => url,
            listAttributes: () => of({ success: true, data: [] })
          }
        },
        {
          provide: ProductCategoryService,
          useValue: {
            getCategoryOptionsForDropdown: () => of([])
          }
        },
        {
          provide: SupplierService,
          useValue: {
            getSuppliers: () => of({ data: { items: [] } })
          }
        },
        {
          provide: StockService,
          useValue: {
            getFeatures: () => of({ success: true, data: ALL_SIDE_FEATURES })
          }
        },
        { provide: ToastService, useValue: { add: jasmine.createSpy('add') } },
        {
          provide: ErrorHandlerService,
          useValue: {
            extractErrorMessage: () => 'Erreur',
            logError: jasmine.createSpy('logError')
          }
        },
        { provide: ErrorMessageService, useValue: { getErrorMessage: () => 'Erreur' } },
        {
          provide: AuthService,
          useValue: {
            hasPermission: (p: string) =>
              p === PERMISSIONS.products.create || p === PERMISSIONS.products.update,
            hasModule: () => true
          }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ProductFormComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  function renderAsProductWithSideSections(): void {
    component.stockFeatures.set(ALL_SIDE_FEATURES);
    component.form.patchValue({ category: 'Produit' });
    fixture.detectChanges();
  }

  it('état C (Service): no side rail, Infos=1 and Tarification=2', () => {
    expect(component.form.get('category')?.value).toBe('Service');
    expect(component.hasSideSections()).toBe(false);
    expect(component.showVariantsSection()).toBe(false);
    expect(component.showTraceabilitySection()).toBe(false);

    const grid = fixture.nativeElement.querySelector('.form-grid') as HTMLElement;
    expect(grid.classList.contains('form-grid--with-side')).toBe(false);
    expect(fixture.nativeElement.querySelector('.section-side')).toBeNull();
    expect(fixture.nativeElement.querySelector('#variantes')).toBeNull();
    expect(sectionNumbers(fixture)).toEqual(['1', '2']);
    expect(component.pricingSectionNumber()).toBe(2);
  });

  it('état A (Produit + flags): side rail stacks Variantes then Traçabilité, numbering 1-2-3-4', () => {
    renderAsProductWithSideSections();

    expect(component.hasSideSections()).toBe(true);
    expect(component.showVariantsSection()).toBe(true);
    expect(component.showTraceabilitySection()).toBe(true);

    const grid = fixture.nativeElement.querySelector('.form-grid') as HTMLElement;
    expect(grid.classList.contains('form-grid--with-side')).toBe(true);

    const side = fixture.nativeElement.querySelector('.section-side') as HTMLElement;
    expect(side).toBeTruthy();
    const sideTitles = Array.from(side.querySelectorAll('h3')).map(el => el.textContent?.trim());
    expect(sideTitles).toEqual(['Variantes', 'Traçabilité et valorisation']);

    expect(fixture.nativeElement.querySelector('#variantes')).toBeTruthy();
    expect(sectionNumbers(fixture)).toEqual(['1', '2', '3', '4']);
    expect(component.variantsSectionNumber()).toBe(2);
    expect(component.traceSectionNumber()).toBe(3);
    expect(component.pricingSectionNumber()).toBe(4);
    expect(component.clientPricesSectionNumber()).toBe(5);
  });

  it('état B (trace only): Variantes hidden, Traçabilité is 2, Tarification is 3', () => {
    component.stockFeatures.set({
      ...ALL_SIDE_FEATURES,
      productVariantsEnabled: false
    });
    component.form.patchValue({ category: 'Produit' });
    fixture.detectChanges();

    expect(component.hasSideSections()).toBe(true);
    expect(component.showVariantsSection()).toBe(false);
    expect(component.showTraceabilitySection()).toBe(true);
    expect(fixture.nativeElement.querySelector('#variantes')).toBeNull();
    expect(sectionNumbers(fixture)).toEqual(['1', '2', '3']);
    expect(component.traceSectionNumber()).toBe(2);
    expect(component.pricingSectionNumber()).toBe(3);
  });

  it('keeps critical formControlName fields in the DOM', () => {
    renderAsProductWithSideSections();

    const ids = [
      'code',
      'category',
      'name',
      'isStockManaged',
      'isVariantTemplate',
      'trackingMode',
      'purchasePrice',
      'unitPrice',
      'salePriceTtc'
    ];
    for (const id of ids) {
      expect(fixture.nativeElement.querySelector(`#${id}`))
        .withContext(`missing #${id}`)
        .toBeTruthy();
    }
  });

  it('renders reorganized Tarification sub-blocks and enriched price preview', () => {
    renderAsProductWithSideSections();

    const titles = Array.from(
      fixture.nativeElement.querySelectorAll('.section-pricing .pricing-subblock-title') as NodeListOf<HTMLElement>
    ).map(el => el.textContent?.trim());

    expect(titles).toEqual(['Paramètres de vente', 'Montants']);

    const readonlyGroup = fixture.nativeElement.querySelector('.pricing-readonly-group') as HTMLElement;
    expect(readonlyGroup).toBeTruthy();
    expect(readonlyGroup.querySelector('#lastPurchasePrice')).toBeTruthy();
    expect(readonlyGroup.querySelector('#weightedAverageCost')).toBeTruthy();

    const vatEl = fixture.nativeElement.querySelector('#vatRate') as HTMLElement;
    const ttcEl = fixture.nativeElement.querySelector('#salePriceTtc') as HTMLElement;
    expect(vatEl.compareDocumentPosition(ttcEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(fixture.nativeElement.querySelector('.price-preview .preview-row.total')).toBeTruthy();

    const purchaseRow = fixture.nativeElement.querySelector('.form-row-purchase-ht-ttc') as HTMLElement;
    expect(purchaseRow).toBeTruthy();
    expect(purchaseRow.querySelector('#purchasePrice')).toBeTruthy();
    expect(purchaseRow.querySelector('#purchasePriceTtc')).toBeTruthy();
  });

  it('hasSideSections follows the same gates as variants/trace methods', () => {
    component.stockFeatures.set(ALL_SIDE_FEATURES);
    component.form.patchValue({ category: 'Service' });
    expect(component.hasSideSections()).toBe(false);

    component.form.patchValue({ category: 'Produit' });
    expect(component.hasSideSections()).toBe(true);

    component.stockFeatures.set({
      ...ALL_SIDE_FEATURES,
      productVariantsEnabled: false,
      lotTrackingEnabled: false,
      serialTrackingEnabled: false,
      expiryTrackingEnabled: false,
      fifoLifoValuationEnabled: false
    });
    expect(component.hasSideSections()).toBe(false);
  });
});
