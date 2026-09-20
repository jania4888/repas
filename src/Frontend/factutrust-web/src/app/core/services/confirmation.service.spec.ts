import { TestBed } from '@angular/core/testing';
import { NgbModal, NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { ConfirmationService, normalizeConfirmButtonClass } from './confirmation.service';
import { ConfirmModalComponent } from '@shared/components/confirm-modal/confirm-modal.component';
import { PromptModalComponent } from '@shared/components/confirm-modal/prompt-modal.component';

describe('normalizeConfirmButtonClass (4.6T1, D-44-91)', () => {
  it('convertit chaque classe PrimeNG connue en classe Bootstrap globale', () => {
    expect(normalizeConfirmButtonClass('p-button-danger')).toBe('btn-danger');
    expect(normalizeConfirmButtonClass('p-button-success')).toBe('btn-success');
    expect(normalizeConfirmButtonClass('p-button-secondary')).toBe('btn-secondary');
    expect(normalizeConfirmButtonClass('p-button-primary')).toBe('btn-primary');
    expect(normalizeConfirmButtonClass('p-button-warning')).toBe('btn-warning');
    expect(normalizeConfirmButtonClass('p-button-info')).toBe('btn-info');
    expect(normalizeConfirmButtonClass('p-button-help')).toBe('btn-secondary');
  });

  it('retourne telle quelle une valeur inconnue ou déjà Bootstrap, et undefined si absente', () => {
    expect(normalizeConfirmButtonClass('btn-danger')).toBe('btn-danger');
    expect(normalizeConfirmButtonClass('btn-outline-secondary')).toBe('btn-outline-secondary');
    expect(normalizeConfirmButtonClass('p-button-rounded')).toBe('p-button-rounded'); // inconnu ⇒ tel quel
    expect(normalizeConfirmButtonClass(undefined)).toBeUndefined();
  });
});

describe('ConfirmationService', () => {
  let service: ConfirmationService;
  let modal: jasmine.SpyObj<NgbModal>;
  let modalRef: {
    componentInstance: ConfirmModalComponent;
    result: Promise<unknown>;
    close: jasmine.Spy;
    dismiss: jasmine.Spy;
  };

  beforeEach(() => {
    modalRef = {
      componentInstance: {
        message: '',
        header: '',
        icon: '',
        acceptLabel: '',
        rejectLabel: '',
        acceptButtonStyleClass: '',
        showRejectButton: true
      } as ConfirmModalComponent,
      result: Promise.resolve(),
      close: jasmine.createSpy('close'),
      dismiss: jasmine.createSpy('dismiss')
    };

    modal = jasmine.createSpyObj('NgbModal', ['open']);
    modal.open.and.returnValue(modalRef as unknown as NgbModalRef);

    TestBed.configureTestingModule({
      providers: [
        ConfirmationService,
        { provide: NgbModal, useValue: modal }
      ]
    });

    service = TestBed.inject(ConfirmationService);
  });

  it('opens confirm modal with default size sm when size is omitted', () => {
    service.confirm({ message: 'Confirmer ?' });

    expect(modal.open).toHaveBeenCalledWith(
      ConfirmModalComponent,
      jasmine.objectContaining({ size: 'sm' })
    );
  });

  it('normalise la classe du bouton de confirmation (p-button-danger ⇒ btn-danger, D-44-91)', () => {
    service.confirm({ message: 'Supprimer ?', acceptButtonStyleClass: 'p-button-danger' });

    expect(modalRef.componentInstance.acceptButtonStyleClass).toBe('btn-danger');
  });

  it('opens confirm modal with size md when requested', () => {
    service.confirm({
      message: 'Confirmer ?',
      size: 'md',
      acceptLabel: 'Annuler l\'inventaire',
      rejectLabel: 'Continuer le comptage'
    });

    expect(modal.open).toHaveBeenCalledWith(
      ConfirmModalComponent,
      jasmine.objectContaining({ size: 'md' })
    );
    expect(modalRef.componentInstance.acceptLabel).toBe('Annuler l\'inventaire');
    expect(modalRef.componentInstance.rejectLabel).toBe('Continuer le comptage');
  });

  it('invokes accept callback when modal closes', async () => {
    const accept = jasmine.createSpy('accept');
    modalRef.result = Promise.resolve();

    service.confirm({ message: 'OK ?', accept });
    await modalRef.result;

    expect(accept).toHaveBeenCalled();
  });

  it('invokes reject callback when modal is dismissed', async () => {
    const reject = jasmine.createSpy('reject');
    modalRef.result = Promise.reject('dismiss');

    service.confirm({ message: 'OK ?', reject });

    try {
      await modalRef.result;
    } catch {
      // expected dismiss rejection
    }
    // Allow microtask queue to flush the service .then/.catch handlers
    await Promise.resolve();
    await Promise.resolve();

    expect(reject).toHaveBeenCalled();
  });

  it('prompt opens the prompt modal with size md by default and forwards the config', () => {
    const promptRef = {
      componentInstance: {
        message: '', header: '', icon: '', placeholder: '',
        acceptLabel: '', rejectLabel: '', acceptButtonStyleClass: '',
        required: true, maxLength: 500
      } as PromptModalComponent,
      result: Promise.resolve('motif'),
      close: jasmine.createSpy('close'),
      dismiss: jasmine.createSpy('dismiss')
    };
    modal.open.and.returnValue(promptRef as unknown as NgbModalRef);

    service.prompt({ message: 'Motif ?', placeholder: 'Motif', acceptLabel: 'Annuler', size: 'md' });

    expect(modal.open).toHaveBeenCalledWith(PromptModalComponent, jasmine.objectContaining({ size: 'md' }));
    expect(promptRef.componentInstance.placeholder).toBe('Motif');
    expect(promptRef.componentInstance.acceptLabel).toBe('Annuler');
  });

  it('prompt resolves to the entered value when the modal closes', async () => {
    const promptRef = {
      componentInstance: {} as PromptModalComponent,
      result: Promise.resolve('motif rejet'),
      close: jasmine.createSpy('close'),
      dismiss: jasmine.createSpy('dismiss')
    };
    modal.open.and.returnValue(promptRef as unknown as NgbModalRef);

    const result = await service.prompt({ message: 'Motif ?' });

    expect(result).toBe('motif rejet');
  });

  it('prompt resolves to null when the modal is dismissed', async () => {
    const promptRef = {
      componentInstance: {} as PromptModalComponent,
      result: Promise.reject('dismiss'),
      close: jasmine.createSpy('close'),
      dismiss: jasmine.createSpy('dismiss')
    };
    modal.open.and.returnValue(promptRef as unknown as NgbModalRef);

    const result = await service.prompt({ message: 'Motif ?' });

    expect(result).toBeNull();
  });
});
