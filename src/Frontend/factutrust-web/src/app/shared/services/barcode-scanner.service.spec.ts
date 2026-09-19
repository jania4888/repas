import { TestBed, fakeAsync, tick } from '@angular/core/testing';

import { BarcodeScannerService, ScannerRegistration } from './barcode-scanner.service';

/**
 * Socle de détection de douchette partagé par tous les écrans.
 *
 * <p>
 * Deux exigences y sont vérifiées. La première est la sûreté : la capture ne doit jamais voler
 * les frappes destinées à un champ de saisie — sur une grille de lignes, une douchette qui
 * intercepte ce que l'utilisateur tape dans une quantité ou un prix corrompt des documents.
 * </p>
 *
 * <p>
 * La seconde est l'empilement : plusieurs écrans peuvent être montés en même temps (une boîte
 * de dialogue au-dessus d'un formulaire), et un seul doit réagir à un scan.
 * </p>
 */
describe('BarcodeScannerService', () => {
  let service: BarcodeScannerService;
  let registrations: ScannerRegistration[];
  let hostInput: HTMLInputElement;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [BarcodeScannerService] });
    service = TestBed.inject(BarcodeScannerService);
    registrations = [];

    hostInput = document.createElement('input');
    document.body.appendChild(hostInput);
  });

  afterEach(() => {
    registrations.forEach(r => r.unregister());
    hostInput.remove();
  });

  function register(onScan: (code: string) => void, options: Record<string, unknown> = {}) {
    const registration = service.register({ onScan, ...options });
    registrations.push(registration);
    return registration;
  }

  function typeCode(code: string, target: EventTarget = document): void {
    for (const char of code) {
      target.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
    }
  }

  function pressEnter(target: EventTarget = document): void {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }

  function scan(code: string, target: EventTarget = document): void {
    typeCode(code, target);
    pressEnter(target);
  }

  it('émet le code complet une fois Enter reçu', () => {
    const scans: string[] = [];
    register(code => scans.push(code));

    scan('4006381333931');

    expect(scans).toEqual(['4006381333931']);
  });

  it('ignore les frappes quand le focus est dans un champ de saisie', () => {
    // Le garde-fou central : une douchette ne doit jamais détourner ce que l'utilisateur tape
    // dans un champ quantité ou prix.
    const scans: string[] = [];
    register(code => scans.push(code));

    scan('4006381333931', hostInput);

    expect(scans).toEqual([]);
  });

  it('peut être autorisé à capturer même dans un champ, à la demande', () => {
    const scans: string[] = [];
    register(code => scans.push(code), { ignoreWhenFocusInEditable: false });

    scan('4006381333931', hostInput);

    expect(scans).toEqual(['4006381333931']);
  });

  it('vide le tampon après le délai d\'inactivité', fakeAsync(() => {
    const scans: string[] = [];
    register(code => scans.push(code), { bufferMs: 50 });

    typeCode('4006381333931');
    tick(51);
    pressEnter();

    expect(scans).toEqual([]);
  }));

  it('ignore un code plus court que la longueur minimale', () => {
    const scans: string[] = [];
    register(code => scans.push(code), { minLength: 5 });

    scan('1234');
    scan('12345');

    expect(scans).toEqual(['12345']);
  });

  it('ignore les frappes combinées à un modificateur', () => {
    const scans: string[] = [];
    register(code => scans.push(code));

    for (const char of '4006381333931') {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: char, ctrlKey: true, bubbles: true })
      );
    }
    pressEnter();

    expect(scans).toEqual([]);
  });

  it('ne livre le scan qu\'à l\'inscription du sommet de la pile', () => {
    // Une boîte de dialogue ouverte au-dessus d'un formulaire : les deux ne doivent pas
    // réagir au même scan.
    const formScans: string[] = [];
    const dialogScans: string[] = [];

    register(code => formScans.push(code));
    const dialog = register(code => dialogScans.push(code));

    scan('4006381333931');

    expect(dialogScans).toEqual(['4006381333931']);
    expect(formScans).toEqual([]);

    dialog.unregister();
    scan('5901234123457');

    expect(formScans).toEqual(['5901234123457']);
  });

  it('cesse d\'écouter après la désinscription', () => {
    const scans: string[] = [];
    const registration = register(code => scans.push(code));

    registration.unregister();
    scan('4006381333931');

    expect(scans).toEqual([]);
  });

  it('supporte une désinscription répétée', () => {
    const registration = register(() => undefined);

    registration.unregister();

    expect(() => registration.unregister()).not.toThrow();
  });

  it('n\'écoute plus le document une fois la dernière inscription retirée', () => {
    const spy = spyOn(document, 'removeEventListener').and.callThrough();
    const first = register(() => undefined);
    const second = register(() => undefined);

    first.unregister();
    expect(spy).not.toHaveBeenCalled();

    second.unregister();
    expect(spy).toHaveBeenCalled();
  });

  it('détoure le code avant de l\'émettre', () => {
    const scans: string[] = [];
    register(code => scans.push(code));

    typeCode(' 4006381333931 ');
    pressEnter();

    expect(scans).toEqual(['4006381333931']);
  });
});
