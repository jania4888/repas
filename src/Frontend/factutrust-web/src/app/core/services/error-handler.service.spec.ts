import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { ErrorHandlerService } from './error-handler.service';

describe('ErrorHandlerService', () => {
  let service: ErrorHandlerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ErrorHandlerService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  /**
   * Le repli réseau existe pour qu'un écran affiche la raison d'un refus métier sans perdre le
   * contexte de son message d'origine (« … lors du chargement du relevé. »). Le piège serait de
   * l'appliquer trop largement : un 4xx porte un message qu'il ne faut jamais masquer.
   */
  describe('extractErrorMessage — repli réseau contextuel', () => {
    const CONTEXTE = 'Erreur réseau lors du chargement du relevé.';

    it('rend le repli quand la requête n’a pas abouti', () => {
      const message = service.extractErrorMessage(new HttpErrorResponse({ status: 0 }), CONTEXTE);

      expect(message).toBe(CONTEXTE);
    });

    it('rend le message du serveur sur un refus métier, jamais le repli', () => {
      const error = new HttpErrorResponse({
        status: 400,
        error: { success: false, error: "La gestion multi-devises n'est pas activée." }
      });

      const message = service.extractErrorMessage(error, CONTEXTE);

      expect(message).toBe("La gestion multi-devises n'est pas activée.");
      expect(message).not.toBe(CONTEXTE);
    });

    it('rend le message par défaut du statut quand le corps ne porte rien', () => {
      // Cas des exports : la réponse est un Blob, illisible ici — le statut reste parlant.
      const error = new HttpErrorResponse({ status: 403, error: new Blob() });

      expect(service.extractErrorMessage(error, CONTEXTE)).toBe('Accès non autorisé.');
    });

    it('sans le paramètre, le comportement est strictement celui d’avant', () => {
      const network = service.extractErrorMessage(new HttpErrorResponse({ status: 0 }));

      expect(network).toContain('se connecter au serveur');
      expect(network).not.toBe(CONTEXTE);
    });
  });

  describe('extractErrorMessage', () => {
    it('should handle network error (status 0)', () => {
      const error = new HttpErrorResponse({ status: 0 });
      const message = service.extractErrorMessage(error);
      expect(message).toContain('se connecter au serveur');
    });

    it('should extract error from ApiResponse format', () => {
      const error = new HttpErrorResponse({
        status: 400,
        error: {
          success: false,
          errors: ['Format du NIF invalide', 'Téléphone invalide']
        }
      });

      const message = service.extractErrorMessage(error);
      expect(message).toBe('Format du NIF invalide, Téléphone invalide');
    });

    it('should extract single error from ApiResponse', () => {
      const error = new HttpErrorResponse({
        status: 400,
        error: {
          success: false,
          errors: ['Le NIF est obligatoire']
        }
      });

      const message = service.extractErrorMessage(error);
      expect(message).toBe('Le NIF est obligatoire');
    });

    it('should extract message from ApiResponse if no errors array', () => {
      const error = new HttpErrorResponse({
        status: 400,
        error: {
          success: false,
          message: 'Une erreur est survenue'
        }
      });

      const message = service.extractErrorMessage(error);
      expect(message).toBe('Une erreur est survenue');
    });

    it('should extract ApiResponse.Fail error string when message is absent', () => {
      const error = new HttpErrorResponse({
        status: 400,
        error: {
          success: false,
          data: null,
          error: 'Le montant dépasse le solde disponible pour ce type (825.000 TND).'
        }
      });

      const message = service.extractErrorMessage(error);
      expect(message).toBe('Le montant dépasse le solde disponible pour ce type (825.000 TND).');
    });

    it('should extract errors from ValidationErrorResponse format', () => {
      const error = new HttpErrorResponse({
        status: 400,
        error: {
          code: 'VALIDATION_FAILED',
          fieldErrors: {
            nif: [{ message: 'Format du NIF invalide' }],
            phone: [{ message: 'Téléphone invalide' }]
          }
        }
      });

      const message = service.extractErrorMessage(error);
      expect(message).toContain('Format du NIF invalide');
      expect(message).toContain('Téléphone invalide');
    });

    it('should handle string error response', () => {
      const error = new HttpErrorResponse({
        status: 400,
        error: 'Simple error message'
      });

      const message = service.extractErrorMessage(error);
      expect(message).toBe('Simple error message');
    });

    it('should return default message for unknown error', () => {
      const error = new HttpErrorResponse({
        status: 500,
        error: null
      });

      const message = service.extractErrorMessage(error);
      expect(message).toContain('Erreur serveur');
    });

    it('should surface ApiResponse message on 500 instead of generic server error', () => {
      const error = new HttpErrorResponse({
        status: 500,
        error: {
          success: false,
          message:
            "L'inscription n'a pas pu être finalisée. Réessayez plus tard ou contactez le support. (réf. REG-abc123def456)",
          error:
            "L'inscription n'a pas pu être finalisée. Réessayez plus tard ou contactez le support. (réf. REG-abc123def456)"
        }
      });

      const message = service.extractErrorMessage(error);
      expect(message).toContain('REG-abc123def456');
      expect(message).not.toBe('Erreur serveur. Veuillez réessayer plus tard.');
    });

    it('should surface ValidationErrorResponse message on INTERNAL_ERROR 500', () => {
      const error = new HttpErrorResponse({
        status: 500,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Détail technique en développement.',
          globalErrors: ['Détail technique en développement.']
        }
      });

      const message = service.extractErrorMessage(error);
      expect(message).toContain('Détail technique');
    });

    it('should handle 404 error', () => {
      const error = new HttpErrorResponse({ status: 404 });
      const message = service.extractErrorMessage(error);
      expect(message).toContain('Ressource non trouvée');
    });

    it('should handle 422 error', () => {
      const error = new HttpErrorResponse({
        status: 422,
        error: {
          errors: ['Données invalides']
        }
      });

      const message = service.extractErrorMessage(error);
      expect(message).toBe('Données invalides');
    });
  });

  describe('extractAllErrors', () => {
    it('should return all errors from ApiResponse', () => {
      const error = new HttpErrorResponse({
        status: 400,
        error: {
          success: false,
          errors: ['Erreur 1', 'Erreur 2', 'Erreur 3']
        }
      });

      const errors = service.extractAllErrors(error);
      expect(errors).toEqual(['Erreur 1', 'Erreur 2', 'Erreur 3']);
    });

    it('should return single error as array', () => {
      const error = new HttpErrorResponse({
        status: 400,
        error: {
          success: false,
          errors: ['Une seule erreur']
        }
      });

      const errors = service.extractAllErrors(error);
      expect(errors).toEqual(['Une seule erreur']);
    });

    it('should extract errors from fieldErrors', () => {
      const error = new HttpErrorResponse({
        status: 400,
        error: {
          fieldErrors: {
            nif: [{ message: 'Erreur NIF' }],
            phone: [{ message: 'Erreur téléphone' }]
          }
        }
      });

      const errors = service.extractAllErrors(error);
      expect(errors).toContain('Erreur NIF');
      expect(errors).toContain('Erreur téléphone');
    });
  });

  describe('isStructuredValidationError', () => {
    it('should be false when status is not 400', () => {
      const error = new HttpErrorResponse({
        status: 422,
        error: { code: 'VALIDATION_FAILED', fieldErrors: { a: [{ message: 'x' }] } }
      });
      expect(service.isStructuredValidationError(error)).toBe(false);
    });

    it('should be true for VALIDATION_FAILED code', () => {
      const error = new HttpErrorResponse({
        status: 400,
        error: { code: 'VALIDATION_FAILED', message: 'La validation a échoué', fieldErrors: {} }
      });
      expect(service.isStructuredValidationError(error)).toBe(true);
    });

    it('should be true when fieldErrors is non-empty', () => {
      const error = new HttpErrorResponse({
        status: 400,
        error: {
          fieldErrors: {
            identificationNumber: [{ message: 'Le numéro CIN doit être composé de 8 chiffres' }]
          }
        }
      });
      expect(service.isStructuredValidationError(error)).toBe(true);
    });

    it('should be true for globalErrors only', () => {
      const error = new HttpErrorResponse({
        status: 400,
        error: { globalErrors: ['Erreur globale'] }
      });
      expect(service.isStructuredValidationError(error)).toBe(true);
    });

    it('should be false for simple BadRequest without validation shape', () => {
      const error = new HttpErrorResponse({
        status: 400,
        error: { success: false, error: 'Description simple' }
      });
      expect(service.isStructuredValidationError(error)).toBe(false);
    });

    it('should detect validation nested under error property', () => {
      const error = new HttpErrorResponse({
        status: 400,
        error: {
          message: 'wrapper',
          error: {
            code: 'VALIDATION_FAILED',
            fieldErrors: { x: [{ message: 'nested' }] }
          }
        }
      });
      expect(service.isStructuredValidationError(error)).toBe(true);
    });
  });

  describe('formatValidationDialogBody', () => {
    it('should join field and global messages with newlines', () => {
      const error = new HttpErrorResponse({
        status: 400,
        error: {
          code: 'VALIDATION_FAILED',
          fieldErrors: {
            a: [{ message: 'Première erreur' }],
            b: [{ message: 'Deuxième erreur' }]
          },
          globalErrors: ['Troisième']
        }
      });
      const body = service.formatValidationDialogBody(error);
      expect(body).toContain('Première erreur');
      expect(body).toContain('Deuxième erreur');
      expect(body).toContain('Troisième');
      expect(body.split('\n').length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('logError', () => {
    it('should log error details', () => {
      spyOn(console, 'error');
      
      const error = new HttpErrorResponse({
        status: 400,
        url: '/api/auth/register',
        error: { errors: ['Test error'] }
      });

      service.logError('Test Context', error);

      expect(console.error).toHaveBeenCalled();
      const callArgs = (console.error as jasmine.Spy).calls.mostRecent().args;
      expect(callArgs[0]).toContain('[ErrorHandler]');
      expect(callArgs[0]).toContain('Test Context');
    });

    it('should log with console.warn when consoleLevel is warn', () => {
      spyOn(console, 'warn');
      spyOn(console, 'error');

      const error = new HttpErrorResponse({
        status: 403,
        url: '/api/company',
        error: { message: 'Accès non autorisé.' }
      });

      service.logError('HTTP 403', error, { consoleLevel: 'warn' });

      expect(console.warn).toHaveBeenCalled();
      expect(console.error).not.toHaveBeenCalled();
    });
  });
});
