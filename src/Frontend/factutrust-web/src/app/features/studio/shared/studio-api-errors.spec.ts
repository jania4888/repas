import { HttpErrorResponse } from '@angular/common/http';
import { isStudioPlanLimitError } from './studio-api-errors';

describe('isStudioPlanLimitError', () => {
  const arabic = 'تم بلوغ حد الباقة: 20 مسارات عمل لكل جدول كحد أقصى.';

  it('reconnaît la limite au code, quel que soit la langue du message', () => {
    const err = new HttpErrorResponse({ status: 400, error: { success: false, error: arabic, code: 'Validation.Plan' } });
    expect(isStudioPlanLimitError(err, arabic)).toBeTrue();
  });

  it('un autre code n’est jamais la limite, même si le texte ressemble', () => {
    const err = new HttpErrorResponse({ status: 400, error: { success: false, code: 'Validation.Key' } });
    expect(isStudioPlanLimitError(err, 'Limite du plan atteinte : 20 workflows par table maximum.')).toBeFalse();
  });

  it('repli sur le texte français pour une réponse sans code', () => {
    const err = new HttpErrorResponse({ status: 400, error: { success: false, error: 'Limite du plan atteinte' } });
    expect(isStudioPlanLimitError(err, 'Limite du plan atteinte : 20 workflows par table maximum.')).toBeTrue();
    expect(isStudioPlanLimitError(err, 'La clé est invalide.')).toBeFalse();
  });
});
