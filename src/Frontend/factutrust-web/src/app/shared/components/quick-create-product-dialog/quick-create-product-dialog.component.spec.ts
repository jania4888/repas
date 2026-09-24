import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { QuickCreateProductDialogComponent } from './quick-create-product-dialog.component';
import { ProductService, CreateProductRequest } from '@core/services/product.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { AuthService } from '@core/services/auth.service';
import { AppModule } from '@core/models/app-module';
import { PERMISSIONS } from '@core/config/permission-keys';

describe('QuickCreateProductDialogComponent', () => {
  let fixture: ComponentFixture<QuickCreateProductDialogComponent>;
  let component: QuickCreateProductDialogComponent;
  let productService: jasmine.SpyObj<ProductService>;
  const authState = signal({ stock: true, canCreate: true });

  beforeEach(async () => {
    authState.set({ stock: true, canCreate: true });
    productService = jasmine.createSpyObj<ProductService>('ProductService', ['createProduct', 'getProduct']);
    productService.createProduct.and.returnValue(
      of({ success: false, data: null, message: null, errors: [] } as never) as never
    );

    await TestBed.configureTestingModule({
      imports: [QuickCreateProductDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: ProductService, useValue: productService },
        {
          provide: ErrorHandlerService,
          useValue: { extractErrorMessage: () => 'Erreur serveur' },
        },
        {
          provide: AuthService,
          useValue: {
            hasModule: (module: AppModule) => module === AppModule.Stock && authState().stock,
            hasPermission: (permission: string) =>
              permission === PERMISSIONS.products.create && authState().canCreate,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(QuickCreateProductDialogComponent);
    component = fixture.componentInstance;
    component.panelMode = true;
    fixture.detectChanges();
  });

  function openDialog(): void {
    component.visible = false;
    component.visible = true;
    fixture.detectChanges();
  }

  function fillValidForm(): void {
    component.code.set('PROD-001');
    component.name.set('Article test');
    component.unitPrice.set(12);
  }

  function submittedRequest(): CreateProductRequest {
    return productService.createProduct.calls.mostRecent().args[0] as CreateProductRequest;
  }

  it('hides the stock toggle and sends false when the stock module is absent', () => {
    authState.set({ stock: false, canCreate: true });
    openDialog();
    component.isStockManaged.set(true);
    fillValidForm();

    expect(fixture.nativeElement.querySelector('#quick-stock')).toBeNull();

    component.submit();

    expect(submittedRequest().isStockManaged).toBeFalse();
  });

  it('defaults stock to enabled for a physical product when the module is available', () => {
    openDialog();
    fillValidForm();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#quick-stock')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Activée');
    expect(component.isStockManaged()).toBeTrue();

    component.submit();

    expect(submittedRequest().isStockManaged).toBeTrue();
  });

  it('sends false when the user turns stock management off', () => {
    openDialog();
    fillValidForm();
    component.isStockManaged.set(false);

    component.submit();

    expect(submittedRequest().isStockManaged).toBeFalse();
  });

  it('forces stock off for a service and restores the default when switching back to a product', () => {
    openDialog();
    fillValidForm();
    component.onCategoryChange('Service');
    fixture.detectChanges();

    const stockSwitch = fixture.debugElement.query(By.css('p-inputSwitch'));
    expect(component.isStockManaged()).toBeFalse();
    expect(stockSwitch).not.toBeNull();
    expect(stockSwitch.componentInstance.disabled).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain('Disponible uniquement pour les produits physiques.');
    expect(fixture.nativeElement.textContent).toContain('Désactivée');

    component.isStockManaged.set(true);
    component.submit();
    expect(submittedRequest().isStockManaged).toBeFalse();

    component.onCategoryChange('Produit');
    fixture.detectChanges();
    expect(component.isStockManaged()).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain('Activée');

    component.submit();
    expect(submittedRequest().isStockManaged).toBeTrue();
  });

  it('shows the supplier hint only while stock management stays enabled', () => {
    component.stockExcludedFromLine = true;
    openDialog();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Cet article ne sera pas ajouté à la facture fournisseur directe.'
    );

    component.isStockManaged.set(false);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain(
      'Cet article ne sera pas ajouté à la facture fournisseur directe.'
    );

    component.isStockManaged.set(true);
    component.onCategoryChange('Service');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain(
      'Cet article ne sera pas ajouté à la facture fournisseur directe.'
    );
  });

  it('does not call the API when the code is too short', () => {
    openDialog();
    component.code.set('A');
    component.name.set('Article test');

    component.submit();

    expect(productService.createProduct).not.toHaveBeenCalled();
    expect(component.visible).toBeTrue();
  });

  it('keeps the dialog open and the stock choice on a duplicate code', () => {
    openDialog();
    fillValidForm();
    const stockChoice = component.isStockManaged();
    productService.createProduct.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 409 }))
    );

    component.submit();
    fixture.detectChanges();

    expect(component.errorMessage()).toBe('Un produit avec ce code existe déjà.');
    expect(component.visible).toBeTrue();
    expect(component.isStockManaged()).toBe(stockChoice);
  });
});
