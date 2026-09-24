import { TestBed } from '@angular/core/testing';
import { LandingCopyService } from './landing-copy.service';
import { LANDING_COPY_FR } from './landing-copy.fr';

describe('LandingCopyService', () => {
  let service: LandingCopyService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [LandingCopyService] });
    service = TestBed.inject(LandingCopyService);
  });

  it('expose le dictionnaire FR par défaut', () => {
    expect(service.locale()).toBe('fr');
    expect(service.t()).toBe(LANDING_COPY_FR);
    expect(service.t().shared.nav.cabinets).toBe('Cabinets comptables');
    expect(service.isLoaded('fr')).toBeTrue();
    expect(service.isLoaded('ar')).toBeFalse();
  });

  it('charge le dictionnaire AR à la demande puis le rend courant', async () => {
    const copy = await service.ensureLoaded('ar');
    expect(copy.locale).toBe('ar');
    expect(service.locale()).toBe('ar');
    expect(service.t().locale).toBe('ar');
    expect(service.isLoaded('ar')).toBeTrue();
  });

  it('rebascule sur FR de manière synchrone une fois les deux dictionnaires chargés', async () => {
    await service.ensureLoaded('ar');
    service.use('fr');
    expect(service.t().locale).toBe('fr');
    service.use('ar');
    expect(service.t().locale).toBe('ar');
  });

  it('format() remplace les placeholders connus et conserve les inconnus', () => {
    expect(service.format('Économie de {amount} par an', { amount: '120 TND' })).toBe('Économie de 120 TND par an');
    expect(service.format('{count} / {max}', { count: 3, max: 2000 })).toBe('3 / 2000');
    expect(service.format('Bonjour {name}', {})).toBe('Bonjour {name}');
  });

  it('rich() découpe gras, italique et segments LTR sans interpréter de HTML', () => {
    expect(service.rich('Facturez en **dinars**, avec _sérénité_ et [[TEJ]].')).toEqual([
      { text: 'Facturez en ' },
      { text: 'dinars', kind: 'strong' },
      { text: ', avec ' },
      { text: 'sérénité', kind: 'em' },
      { text: ' et ' },
      { text: 'TEJ', kind: 'ltr' },
      { text: '.' }
    ]);
    expect(service.rich('<b>brut</b>')).toEqual([{ text: '<b>brut</b>' }]);
    expect(service.rich('')).toEqual([]);
  });
});
