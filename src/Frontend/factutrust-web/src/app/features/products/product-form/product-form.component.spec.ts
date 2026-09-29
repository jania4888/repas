import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { ProductFormComponent } from './product-form.component';
import { ProductService } from '@core/services/product.service';
import { ProductCategoryService } from '@core/services/product-category.service';
import { SupplierService } from '@core/services/supplier.service';
import { StockService } from '@core/services/stock.service';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { ErrorMessageService } from '@core/services/error-message.service';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';

describe('ProductFormComponent — margin enablement', () => {
  let component: ProductFormComponent;
  let fixture: ComponentFixture<ProductFormComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProductFormComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
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
            resolveProductImageUrl: (url: string | null) => url
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
            getFeatures: () => of({ success: true, data: null })
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

  it('keeps margin disabled and shows hint state when purchase price is missing', () => {
    expect(component.canEditMargin()).toBe(false);
    expect(component.form.get('profitMarginPercent')?.disabled).toBe(true);
  });

  it('enables margin when purchase price becomes > 0', () => {
    component.form.patchValue({ purchasePrice: 1400, unitPrice: 1500 }, { emitEvent: false });
    component.onPricingChange('purchasePrice');

    expect(component.canEditMargin()).toBe(true);
    expect(component.form.get('profitMarginPercent')?.enabled).toBe(true);
    expect(component.form.get('profitMarginPercent')?.value).toBeCloseTo(7.143, 3);
  });

  it('seeds margin from existing HT when purchase price is set and margin is null', () => {
    component.form.patchValue(
      { purchasePrice: 1400, unitPrice: 1500, profitMarginPercent: null },
      { emitEvent: false }
    );
    component.onPricingChange('purchasePrice');

    expect(component.form.get('unitPrice')?.value).toBe(1500);
    expect(component.form.get('profitMarginPercent')?.value).toBeCloseTo(7.143, 3);
  });

  it('recalculates unit price from margin (bidirectional)', () => {
    component.form.patchValue(
      { purchasePrice: 1400, unitPrice: 1500, profitMarginPercent: 7.143, vatRate: 19 },
      { emitEvent: false }
    );
    component.onPricingChange('purchasePrice');

    component.form.patchValue({ profitMarginPercent: 12 }, { emitEvent: false });
    component.onPricingChange('margin');

    expect(component.form.get('unitPrice')?.value).toBe(1568);
  });

  it('recalculates margin from unit price HT (bidirectional)', () => {
    component.form.patchValue(
      { purchasePrice: 1400, unitPrice: 1500, vatRate: 19 },
      { emitEvent: false }
    );
    component.onPricingChange('unitPriceHt');

    expect(component.canEditMargin()).toBe(true);
    expect(component.form.get('profitMarginPercent')?.value).toBeCloseTo(7.143, 3);
  });

  it('disables and clears margin when purchase price is cleared', () => {
    component.form.patchValue(
      { purchasePrice: 1400, unitPrice: 1500 },
      { emitEvent: false }
    );
    component.onPricingChange('purchasePrice');
    expect(component.form.get('profitMarginPercent')?.enabled).toBe(true);

    const unitBefore = component.form.get('unitPrice')?.value;
    const ttcBefore = component.form.get('salePriceTtc')?.value;

    component.form.patchValue({ purchasePrice: null }, { emitEvent: false });
    component.onPricingChange('purchasePrice');

    expect(component.canEditMargin()).toBe(false);
    expect(component.form.get('profitMarginPercent')?.disabled).toBe(true);
    expect(component.form.get('profitMarginPercent')?.value).toBeNull();
    expect(component.form.get('unitPrice')?.value).toBe(unitBefore);
    expect(component.form.get('salePriceTtc')?.value).toBe(ttcBefore);
  });

  it('disables and clears margin when purchase price is 0', () => {
    component.form.patchValue({ purchasePrice: 1400, unitPrice: 1500 }, { emitEvent: false });
    component.onPricingChange('purchasePrice');

    component.form.patchValue({ purchasePrice: 0 }, { emitEvent: false });
    component.onPricingChange('purchasePrice');

    expect(component.canEditMargin()).toBe(false);
    expect(component.form.get('profitMarginPercent')?.disabled).toBe(true);
    expect(component.form.get('profitMarginPercent')?.value).toBeNull();
  });

  it('preserves server margin after load-style patch + sync (edit mode)', () => {
    component.form.patchValue(
      {
        purchasePrice: 1400,
        unitPrice: 1500,
        profitMarginPercent: 7.143,
        salePriceTtc: 1785,
        vatRate: 19
      },
      { emitEvent: false }
    );
    // Same sequence as loadProduct: patchValue then sync via pricing refresh
    component.onPricingChange('unitPriceHt');

    expect(component.canEditMargin()).toBe(true);
    expect(component.form.get('profitMarginPercent')?.enabled).toBe(true);
    expect(component.form.get('profitMarginPercent')?.value).toBeCloseTo(7.143, 3);
  });

  it('does not wipe margin when purchase drives HT and margin already set', () => {
    component.form.patchValue(
      { purchasePrice: 1000, unitPrice: 1120, profitMarginPercent: 12, vatRate: 19 },
      { emitEvent: false }
    );
    component.onPricingChange('purchasePrice');

    expect(component.form.get('profitMarginPercent')?.value).toBe(12);
    expect(component.form.get('unitPrice')?.value).toBe(1120);
  });

  it('keeps discount max-percent enable/disable behaviour', () => {
    const maxCtrl = component.form.get('maxDiscountPercent');
    expect(maxCtrl?.disabled).toBe(true);

    component.form.patchValue({ isDiscountEnabled: true });
    expect(maxCtrl?.enabled).toBe(true);
    expect(maxCtrl?.value).toBe(100);

    component.form.patchValue({ isDiscountEnabled: false });
    expect(maxCtrl?.disabled).toBe(true);
    expect(maxCtrl?.value).toBeNull();
  });

  it('recalculates HT and margin from TTC when purchase is set', () => {
    component.form.patchValue(
      { purchasePrice: 1400, unitPrice: 0, salePriceTtc: 1785, vatRate: 19, isFodecApplicable: false },
      { emitEvent: false }
    );
    component.onPricingChange('saleTtc');

    expect(component.form.get('unitPrice')?.value).toBe(1500);
    expect(component.form.get('profitMarginPercent')?.value).toBeCloseTo(7.143, 3);
    expect(component.canEditMargin()).toBe(true);
  });

  it('recalculates TTC from VAT/FODEC without changing margin when HT is stable', () => {
    component.form.patchValue(
      {
        purchasePrice: 1400,
        unitPrice: 1500,
        profitMarginPercent: 7.143,
        salePriceTtc: 1785,
        vatRate: 19,
        isFodecApplicable: false
      },
      { emitEvent: false }
    );
    component.onPricingChange('unitPriceHt');
    const marginBefore = component.form.get('profitMarginPercent')?.value;
    const htBefore = component.form.get('unitPrice')?.value;

    component.form.patchValue({ isFodecApplicable: true }, { emitEvent: false });
    component.onPricingChange('fodec');

    expect(component.form.get('unitPrice')?.value).toBe(htBefore);
    expect(component.form.get('profitMarginPercent')?.value).toBe(marginBefore);
    // 1500 + FODEC 1% (15) + TVA 19% on 1515 = 1500 + 15 + 287.85 = 1802.85
    expect(component.form.get('salePriceTtc')?.value).toBe(1802.85);
  });

  it('previewPurchaseTtc returns null when purchase price is missing', () => {
    component.form.patchValue({ purchasePrice: null, vatRate: 19 }, { emitEvent: false });
    expect(component.previewPurchaseTtc()).toBeNull();
  });

  it('previewPurchaseTtc calculates from HT and VAT rate', () => {
    component.form.patchValue({ purchasePrice: 10.432, vatRate: 19 }, { emitEvent: false });
    expect(component.previewPurchaseTtc()).toBe(12.414);
  });

  it('previewPurchaseTtc updates when VAT changes', () => {
    component.form.patchValue({ purchasePrice: 100, vatRate: 19 }, { emitEvent: false });
    expect(component.previewPurchaseTtc()).toBe(119);

    component.form.patchValue({ vatRate: 0 }, { emitEvent: false });
    expect(component.previewPurchaseTtc()).toBe(100);
  });
});
