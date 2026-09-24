import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { FirmAssignmentService, FirmClientAssignment } from '@core/services/firm-assignment.service';
import { ToastService } from '@core/services/toast.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { AccountingFirmSettingsComponent } from './accounting-firm-settings.component';

function assignment(partial: Partial<FirmClientAssignment>): FirmClientAssignment {
  return {
    id: 'a1',
    companyTenantId: 'c1',
    companyName: 'Ma Société',
    firmTenantId: 'f1',
    firmDisplayName: 'Cabinet Test',
    status: 0,
    statusDisplay: '',
    requestedAt: '2026-07-18T09:00:00Z',
    ...partial
  };
}

describe('AccountingFirmSettingsComponent', () => {
  function setup(current: FirmClientAssignment | null, history: FirmClientAssignment[] = []) {
    const service = {
      getCompanyCurrent: () => of({ success: true, data: current }),
      getCompanyHistory: () => of({ success: true, data: history }),
      searchDirectory: jasmine.createSpy('searchDirectory').and.returnValue(of({ success: true, items: [] as unknown[], totalCount: 0, page: 1, companyGovernorate: null })),
      requestAssignment: jasmine.createSpy('requestAssignment').and.returnValue(of({ success: true, data: current })),
      cancelPendingRequest: jasmine.createSpy('cancelPendingRequest').and.returnValue(of({ success: true, data: null })),
      revokeByCompany: jasmine.createSpy('revokeByCompany').and.returnValue(of({ success: true, data: null }))
    };

    TestBed.configureTestingModule({
      imports: [AccountingFirmSettingsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: FirmAssignmentService, useValue: service },
        { provide: ToastService, useValue: { add: jasmine.createSpy('add') } },
        { provide: ConfirmationService, useValue: { confirm: (c: { accept?: () => void }) => c.accept?.() } }
      ]
    });

    const fixture = TestBed.createComponent(AccountingFirmSettingsComponent);
    fixture.detectChanges();
    return { fixture, service };
  }

  it('affiche la recherche quand aucune liaison ouverte', () => {
    const { fixture } = setup(null, []);
    const html = fixture.nativeElement.textContent as string;
    expect(html).toContain('Rechercher un cabinet');
    expect(html).toContain('Comparez les cabinets');
    expect(html).not.toContain('Envoyer la demande');
  });

  it('choisit une carte puis envoie le même POST de demande', () => {
    const firm = {
      firmTenantId: 'f-99',
      displayName: 'Cabinet Ahmed',
      city: 'Tunis',
      governorate: 'Tunis',
      description: 'Spécialiste TVA',
      practiceAreas: ['tva']
    };
    const { fixture, service } = setup(null, []);
    service.searchDirectory.and.returnValue(of({
      success: true,
      items: [firm],
      totalCount: 1,
      page: 1,
      companyGovernorate: null
    }));
    fixture.componentInstance.loadDirectory(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Cabinet Ahmed');
    expect(fixture.nativeElement.textContent).toContain('Choisir ce cabinet');
    fixture.componentInstance.selectFirm(firm);
    fixture.detectChanges();
    fixture.componentInstance.confirmAndSubmit();
    expect(service.requestAssignment).toHaveBeenCalledWith('f-99', undefined);
  });

  it('affiche le bouton « Annuler la demande » pour une demande en attente (number)', () => {
    const { fixture } = setup(assignment({ status: 0 }));
    const html = fixture.nativeElement.textContent as string;
    expect(html).toContain('Annuler la demande');
    expect(html).toContain("En attente d'acceptation");
    expect(html).not.toContain('Rechercher un cabinet');
  });

  it('affiche le badge et « Annuler » pour status PascalCase PendingFirmApproval', () => {
    const { fixture } = setup(assignment({ status: 'PendingFirmApproval' }));
    const html = fixture.nativeElement.textContent as string;
    expect(html).toContain('Annuler la demande');
    expect(html).toContain("En attente d'acceptation");
    expect(html).not.toContain('INCONNU');
    expect(html).not.toContain('Inconnu');
  });

  it('affiche « Révoquer l\'affectation » pour une liaison active avec libellé corrigé', () => {
    const { fixture } = setup(assignment({
      status: 1,
      respondedAt: '2026-07-18T10:00:00Z',
      firmContactPhone: '71111222',
      firmContactEmail: 'cabinet@example.com',
      firmCity: 'Tunis',
      firmPracticeAreas: ['tva']
    }));
    const html = fixture.nativeElement.textContent as string;
    expect(html).toContain("Révoquer l'affectation");
    expect(html).toContain('Liaison active');
    expect(html).toContain('71111222');
    expect(html).not.toContain('Rechercher un cabinet');
  });

  it('affiche « Révoquer » et « Actif depuis » pour status PascalCase Active', () => {
    const { fixture } = setup(
      assignment({ status: 'Active', respondedAt: '2026-07-18T10:00:00Z' })
    );
    const html = fixture.nativeElement.textContent as string;
    expect(html).toContain("Révoquer l'affectation");
    expect(html).toContain('Liaison active');
    expect(html).toContain('Actif depuis');
    expect(html).not.toContain('Inconnu');
  });

  it('débloque la recherche et affiche le motif après un refus', () => {
    const rejected = assignment({ status: 2, rejectionReason: 'Dossier incomplet', respondedAt: '2026-07-18T11:00:00Z' });
    const { fixture } = setup(null, [rejected]);
    const html = fixture.nativeElement.textContent as string;
    expect(html).toContain('Rechercher un cabinet');
    expect(html).toContain('Refusée');
    expect(html).toContain('Dossier incomplet');
  });

  it('débloque la recherche après un refus PascalCase Rejected', () => {
    const rejected = assignment({
      status: 'Rejected',
      rejectionReason: 'Dossier incomplet',
      respondedAt: '2026-07-18T11:00:00Z'
    });
    const { fixture } = setup(null, [rejected]);
    const html = fixture.nativeElement.textContent as string;
    expect(html).toContain('Refusée');
    expect(html).not.toContain('Inconnu');
  });

  it('annule la demande en attente via le service (confirmation auto-acceptée)', () => {
    const { fixture, service } = setup(assignment({ status: 0 }));
    fixture.componentInstance.cancelPending();
    expect(service.cancelPendingRequest).toHaveBeenCalled();
  });
});
