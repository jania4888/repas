import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AccountingService, ChartOfAccountDto } from '../services/accounting.service';
import { ChartAccountEditDialogComponent } from './chart-account-edit-dialog.component';

describe('ChartAccountEditDialogComponent', () => {
  let fixture: ComponentFixture<ChartAccountEditDialogComponent>;
  let component: ChartAccountEditDialogComponent;
  let updateChartOfAccount: jasmine.Spy;

  function account(partial: Partial<ChartOfAccountDto> = {}): ChartOfAccountDto {
    return {
      id: 'acc-1',
      accountNumber: '411001',
      label: 'Client ABC',
      accountClass: 4,
      natureType: 0,
      isSystem: false,
      isActive: true,
      level: 5,
      accountType: 1,
      isAuxiliary: true,
      fiscalId: null,
      ...partial
    };
  }

  function create(acc: ChartOfAccountDto, rows: ChartOfAccountDto[] = []): void {
    fixture = TestBed.createComponent(ChartAccountEditDialogComponent);
    fixture.componentRef.setInput('account', acc);
    fixture.componentRef.setInput('rows', rows);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(async () => {
    updateChartOfAccount = jasmine.createSpy('updateChartOfAccount').and.returnValue(of({ success: true, data: true }));
    await TestBed.configureTestingModule({
      imports: [ChartAccountEditDialogComponent],
      providers: [
        { provide: AccountingService, useValue: { updateChartOfAccount } }
      ]
    }).compileComponents();
  });

  it('initialise le libellé et le matricule fiscal depuis le compte fourni', () => {
    create(account({ label: 'Client ABC', fiscalId: '1234567A/B/M/000' }));
    expect(component.label).toBe('Client ABC');
    expect(component.fiscalId).toBe('1234567A/B/M/000');
  });

  it('affiche le champ matricule fiscal pour un compte Client auxiliaire', () => {
    create(account({ accountType: 1, isAuxiliary: true }));
    expect(component.showFiscalIdField()).toBeTrue();
  });

  it('masque le champ matricule fiscal pour un compte Autre', () => {
    create(account({ accountType: 3, isAuxiliary: false }));
    expect(component.showFiscalIdField()).toBeFalse();
  });

  it('masque le champ matricule fiscal pour un compte Client non auxiliaire (collectif)', () => {
    create(account({ accountType: 1, isAuxiliary: false }));
    expect(component.showFiscalIdField()).toBeFalse();
  });

  describe('canSave', () => {
    it('refuse un libellé vide', () => {
      create(account({ label: 'Client ABC' }));
      component.label = '   ';
      expect(component.canSave()).toBeFalse();
    });

    it('refuse si rien n’a changé', () => {
      create(account({ label: 'Client ABC', fiscalId: null }));
      expect(component.canSave()).toBeFalse();
    });

    it('autorise un changement de libellé seul', () => {
      create(account({ label: 'Client ABC', fiscalId: null }));
      component.label = 'Client ABC modifié';
      expect(component.canSave()).toBeTrue();
    });

    it('autorise un changement de matricule fiscal seul', () => {
      create(account({ label: 'Client ABC', fiscalId: null }));
      component.fiscalId = '1234567A/B/M/000';
      expect(component.canSave()).toBeTrue();
    });

    it('refuse si le matricule fiscal saisi est invalide', () => {
      create(account({ label: 'Client ABC', fiscalId: null }));
      component.fiscalId = 'ABC123';
      expect(component.canSave()).toBeFalse();
    });

    it('refuse si le matricule fiscal est un doublon chez un autre compte du même type', () => {
      create(
        account({ id: 'acc-1', label: 'Client ABC', fiscalId: null, accountType: 1 }),
        [account({ id: 'acc-2', accountNumber: '411002', label: 'Client XYZ', fiscalId: '1234567A/B/M/000', accountType: 1 })]
      );
      component.fiscalId = '1234567ABM000';
      expect(component.canSave()).toBeFalse();
      expect(component.fiscalIdError()).toContain('411002');
    });

    it('n’est pas bloqué par son propre matricule fiscal inchangé (excludeId)', () => {
      create(
        account({ id: 'acc-1', label: 'Client ABC', fiscalId: '1234567A/B/M/000', accountType: 1 })
      );
      component.label = 'Client ABC renommé';
      expect(component.canSave()).toBeTrue();
      expect(component.fiscalIdError()).toBeNull();
    });
  });

  describe('save', () => {
    it('envoie label/fiscalId/updateFiscalId et émet saved en cas de succès', () => {
      create(account({ id: 'acc-1', label: 'Client ABC', fiscalId: null, accountType: 1 }));
      component.label = 'Client ABC modifié';
      component.fiscalId = '1234567ABM000';
      const savedSpy = jasmine.createSpy('saved');
      component.saved.subscribe(savedSpy);

      component.save();

      expect(updateChartOfAccount).toHaveBeenCalledWith('acc-1', {
        label: 'Client ABC modifié',
        fiscalId: '1234567A/B/M/000',
        updateFiscalId: true
      });
      expect(savedSpy).toHaveBeenCalled();
      expect(component.saving()).toBeFalse();
    });

    it('n’envoie pas updateFiscalId pour un compte qui ne le supporte pas', () => {
      create(account({ id: 'acc-1', label: 'Compte Autre', fiscalId: null, accountType: 3, isAuxiliary: false }));
      component.label = 'Compte Autre renommé';

      component.save();

      expect(updateChartOfAccount).toHaveBeenCalledWith('acc-1', {
        label: 'Compte Autre renommé',
        fiscalId: null,
        updateFiscalId: false
      });
    });

    it('affiche l’erreur serveur du matricule fiscal sans écraser le libellé si success:false avec code métier', () => {
      updateChartOfAccount.and.returnValue(of({
        success: false,
        error: 'Doublon',
        code: 'ChartAccount.FiscalIdDuplicate'
      }));
      create(account({ id: 'acc-1', label: 'Client ABC', fiscalId: null, accountType: 1 }));
      component.fiscalId = '1234567ABM000';

      component.save();

      expect(component.serverError()).toBe('Doublon');
      expect(component.saveError()).toBeNull();
    });

    it('affiche l’erreur générique quand la réponse échoue sans rapport avec le matricule fiscal', () => {
      updateChartOfAccount.and.returnValue(of({ success: false, error: 'Erreur inattendue.' }));
      create(account({ id: 'acc-1', label: 'Client ABC', fiscalId: null, accountType: 1 }));
      component.label = 'Client ABC modifié';

      component.save();

      expect(component.saveError()).toBe('Erreur inattendue.');
      expect(component.serverError()).toBeNull();
    });

    it('affiche le repli réseau sur erreur HTTP sans rapport avec le matricule fiscal', () => {
      updateChartOfAccount.and.returnValue(throwError(() => new HttpErrorResponse({ status: 0 })));
      create(account({ id: 'acc-1', label: 'Client ABC', fiscalId: null, accountType: 1 }));
      component.label = 'Client ABC modifié';

      component.save();

      expect(component.saveError()).toBe('Erreur réseau lors de la modification du compte.');
      expect(component.saving()).toBeFalse();
    });

    it('affiche l’erreur serveur du matricule fiscal issue de fieldErrors sur erreur HTTP 400', () => {
      updateChartOfAccount.and.returnValue(throwError(() => new HttpErrorResponse({
        status: 400,
        error: { fieldErrors: { FiscalId: [{ message: 'Format invalide côté serveur.' }] } }
      })));
      create(account({ id: 'acc-1', label: 'Client ABC', fiscalId: null, accountType: 1 }));
      component.fiscalId = '1234567ABM000';

      component.save();

      expect(component.serverError()).toBe('Format invalide côté serveur.');
      expect(component.saveError()).toBeNull();
    });

    it('ne fait rien si canSave() est faux', () => {
      create(account({ id: 'acc-1', label: 'Client ABC', fiscalId: null }));
      component.save();
      expect(updateChartOfAccount).not.toHaveBeenCalled();
    });
  });

  describe('affichage', () => {
    it('accountTypeLabel distingue Client / Fournisseur / Autre', () => {
      create(account({ accountType: 1 }));
      expect(component.accountTypeLabel()).toBe('Client');

      create(account({ accountType: 2 }));
      expect(component.accountTypeLabel()).toBe('Fournisseur');

      create(account({ accountType: 3 }));
      expect(component.accountTypeLabel()).toBe('Autre');
    });

    it('parentLabel résout le compte parent depuis rows()', () => {
      create(
        account({ parentAccountNumber: '411' }),
        [account({ id: 'parent', accountNumber: '411', label: 'Clients', accountType: 1, isAuxiliary: false })]
      );
      expect(component.parentLabel()).toBe('411 — Clients');
    });

    it('parentLabel renvoie null sans compte parent', () => {
      create(account({ parentAccountNumber: null }));
      expect(component.parentLabel()).toBeNull();
    });

    it('rend un libellé de compte parent malveillant en texte, jamais en HTML (binding `{{ }}`, pas innerHTML)', () => {
      const malicious = '<img src=x onerror=alert(1)>Clients';
      create(
        account({ parentAccountNumber: '411' }),
        [account({ id: 'parent', accountNumber: '411', label: malicious, accountType: 1, isAuxiliary: false })]
      );
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      // La chaîne entière (avec ses chevrons) doit apparaître comme texte brut — aucune balise
      // <img> ne doit avoir été injectée dans le DOM.
      expect(el.textContent).toContain(malicious);
      expect(el.querySelector('img')).toBeNull();
    });
  });

  it('émet closed() quand close() est appelé', () => {
    create(account());
    const closedSpy = jasmine.createSpy('closed');
    component.closed.subscribe(closedSpy);
    component.close();
    expect(closedSpy).toHaveBeenCalled();
  });

  it('se ferme sur la touche Échap (document:keydown.escape)', () => {
    create(account());
    const closedSpy = jasmine.createSpy('closed');
    component.closed.subscribe(closedSpy);
    component.onEscape();
    expect(closedSpy).toHaveBeenCalled();
  });

  it('place le focus sur le champ libellé après l’initialisation de la vue', () => {
    create(account());
    expect(document.activeElement).toBe(component.labelInputRef?.nativeElement ?? null);
  });

  it('normalizeFiscalIdInput délègue à la fonction pure du module', () => {
    create(account());
    expect(component.normalizeFiscalIdInput('1234567ABM000')).toBe('1234567A/B/M/000');
  });
});
