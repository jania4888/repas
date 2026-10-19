import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { QuickCreateSupplierDialogComponent, QuickCreateSupplierPrefill } from './quick-create-supplier-dialog.component';
import { SupplierService, SupplierType } from '@core/services/supplier.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';

describe('QuickCreateSupplierDialogComponent', () => {
  let fixture: ComponentFixture<QuickCreateSupplierDialogComponent>;
  let component: QuickCreateSupplierDialogComponent;
  let supplierService: jasmine.SpyObj<SupplierService>;

  beforeEach(async () => {
    supplierService = jasmine.createSpyObj<SupplierService>('SupplierService', ['createSupplier', 'getSuppliers', 'getSupplier']);
    supplierService.getSuppliers.and.returnValue(of({ success: true, data: { items: [], total: 0 }, message: null, errors: [] } as any));

    await TestBed.configureTestingModule({
      imports: [QuickCreateSupplierDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: SupplierService, useValue: supplierService },
        { provide: ErrorHandlerService, useValue: { extractErrorMessage: () => 'Erreur serveur' } }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(QuickCreateSupplierDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  function fillValidBusinessForm(): void {
    component.name.set('ACME SARL');
    component.type.set(SupplierType.Business);
    component.nif.set('1772793W/A/M/000');
    component.street.set('1 rue Test');
    component.city.set('Tunis');
    component.governorate.set('Tunis');
  }

  it('resets the form when opened without prefill', () => {
    component.name.set('stale');
    component.visible = true;
    fixture.detectChanges();

    expect(component.name()).toBe('');
    expect(component.type()).toBe(SupplierType.Business);
    expect(component.nif()).toBe('');
    expect(component.submitAttempted()).toBeFalse();
  });

  it('applies the prefill after resetForm when opened', () => {
    const prefill: QuickCreateSupplierPrefill = {
      name: 'Fournisseur Extrait',
      type: SupplierType.Business,
      nif: '1772793W/A/M/000',
      street: 'Zone Industrielle',
      city: 'Sfax',
      governorate: 'Sfax',
      postalCode: '3000',
      email: 'contact@extrait.tn',
      phone: '71000000'
    };
    component.prefill = prefill;
    component.visible = true;
    fixture.detectChanges();

    expect(component.name()).toBe('Fournisseur Extrait');
    expect(component.nif()).toBe('1772793W/A/M/000');
    expect(component.street()).toBe('Zone Industrielle');
    expect(component.city()).toBe('Sfax');
    expect(component.governorate()).toBe('Sfax');
    expect(component.postalCode()).toBe('3000');
    expect(component.email()).toBe('contact@extrait.tn');
    expect(component.phone()).toBe('71000000');
  });

  it('only keeps defined prefill fields, leaving the rest at their reset defaults', () => {
    component.prefill = { name: 'Juste le nom' };
    component.visible = true;
    fixture.detectChanges();

    expect(component.name()).toBe('Juste le nom');
    expect(component.street()).toBe('');
    expect(component.city()).toBe('');
  });

  it('requires name, street, city, governorate and, for a business, a valid NIF', () => {
    component.visible = true;
    fixture.detectChanges();
    expect(component.canSubmit()).toBeFalse();

    fillValidBusinessForm();
    expect(component.canSubmit()).toBeTrue();

    component.nif.set('');
    expect(component.nifValid()).toBeFalse();
    expect(component.canSubmit()).toBeFalse();
  });

  it('does not require a NIF for an individual supplier', () => {
    fillValidBusinessForm();
    component.type.set(SupplierType.Individual);
    component.nif.set('');
    expect(component.nifValid()).toBeTrue();
    expect(component.canSubmit()).toBeTrue();
  });

  it('rejects an invalid NIF for a business supplier', () => {
    fillValidBusinessForm();
    component.nif.set('not-a-nif');
    expect(component.nifValid()).toBeFalse();
    expect(component.canSubmit()).toBeFalse();
  });

  it('shows the missing-field errors only once touched or after a submit attempt', () => {
    fixture.detectChanges();
    expect(component.showStreetError()).toBeFalse();

    component.streetTouched.set(true);
    expect(component.showStreetError()).toBeTrue();

    component.streetTouched.set(false);
    component.submitAttempted.set(true);
    expect(component.showStreetError()).toBeTrue();
  });

  it('runs a duplicate search (by NIF/name) when the name or NIF changes, and surfaces matches', () => {
    supplierService.getSuppliers.and.returnValue(of({
      success: true,
      data: { items: [{ id: 'sup-1', name: 'ACME SARL', nif: '1772793W/A/M/000' }], total: 1 },
      message: null,
      errors: []
    } as any));

    component.onNameChange('ACME SARL');

    expect(supplierService.getSuppliers).toHaveBeenCalled();
    const callArgs = supplierService.getSuppliers.calls.mostRecent().args[0] as { skipGlobalErrorUi?: boolean };
    expect(callArgs?.skipGlobalErrorUi).toBeTrue();
    expect(component.duplicates()).toEqual([{ id: 'sup-1', name: 'ACME SARL', nif: '1772793W/A/M/000' }]);
  });

  it('clears duplicates when the search term is too short', () => {
    component.duplicates.set([{ id: 'x', name: 'y', nif: null }]);
    component.onNameChange('a');
    expect(component.duplicates()).toEqual([]);
  });

  it('creates the supplier and emits supplierCreated on success', () => {
    fillValidBusinessForm();
    supplierService.createSupplier.and.returnValue(of({ success: true, data: 'sup-42', message: null, errors: [] } as any));
    const emitSpy = spyOn(component.supplierCreated, 'emit');

    component.submit();

    expect(supplierService.createSupplier).toHaveBeenCalled();
    expect(emitSpy).toHaveBeenCalledWith({ id: 'sup-42', name: 'ACME SARL' });
    expect(component.visible).toBeFalse();
  });

  it('shows the server message when creation returns success=false', () => {
    fillValidBusinessForm();
    supplierService.createSupplier.and.returnValue(of({ success: false, data: null, message: 'Validation échouée', errors: [] } as any));

    component.submit();

    expect(component.errorMessage()).toBe('Validation échouée');
    expect(component.submitting()).toBeFalse();
  });

  it('on a 409 conflict, keeps the existingSupplierId and offers "Utiliser ce fournisseur"', () => {
    component.visible = true;
    fixture.detectChanges();
    fillValidBusinessForm();
    supplierService.createSupplier.and.returnValue(
      throwError(() => new HttpErrorResponse({
        status: 409,
        error: { message: 'Un fournisseur avec ce matricule existe déjà.', data: { existingSupplierId: 'sup-7' } }
      }))
    );

    component.submit();
    fixture.detectChanges();

    expect(component.errorMessage()).toBe('Un fournisseur avec ce matricule existe déjà.');
    expect(component.conflictSupplierId()).toBe('sup-7');

    const button = fixture.nativeElement.querySelector('.error-message app-button');
    expect(button).not.toBeNull();
  });

  it('useConflicting fetches the existing supplier, emits useExisting and closes', () => {
    fillValidBusinessForm();
    supplierService.createSupplier.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 409, error: { data: { existingSupplierId: 'sup-7' } } }))
    );
    component.submit();

    supplierService.getSupplier.and.returnValue(of({ success: true, data: { id: 'sup-7', name: 'ACME (existant)' }, message: null, errors: [] } as any));
    const useExistingSpy = spyOn(component.useExisting, 'emit');

    component.useConflicting();

    expect(supplierService.getSupplier).toHaveBeenCalledWith('sup-7');
    expect(useExistingSpy).toHaveBeenCalledWith({ id: 'sup-7', name: 'ACME (existant)' });
    expect(component.visible).toBeFalse();
  });

  it('on a generic HTTP failure (non-409), uses the error handler message', () => {
    fillValidBusinessForm();
    supplierService.createSupplier.and.returnValue(throwError(() => new HttpErrorResponse({ status: 500 })));

    component.submit();

    expect(component.errorMessage()).toBe('Erreur serveur');
    expect(component.conflictSupplierId()).toBeNull();
  });

  it('does not submit while the form is invalid, and marks submitAttempted', () => {
    component.visible = true;
    fixture.detectChanges();

    component.submit();

    expect(component.submitAttempted()).toBeTrue();
    expect(supplierService.createSupplier).not.toHaveBeenCalled();
  });
});
