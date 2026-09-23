import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { environment } from '@environments/environment';
import { TurnstileLoaderService } from './turnstile-loader.service';
import { TURNSTILE_LOAD_TIMEOUT_MS, TURNSTILE_SCRIPT_ID, TURNSTILE_SCRIPT_URL, type TurnstileApi } from './turnstile.types';

describe('TurnstileLoaderService', () => {
  const env = environment as { turnstileSiteKey: string };
  const originalKey = env.turnstileSiteKey;
  let service: TurnstileLoaderService;
  let appended: HTMLScriptElement[];
  const fakeApi = { render: () => 'w1', reset: () => undefined, remove: () => undefined } as TurnstileApi;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(TurnstileLoaderService);
    appended = [];
    // Intercepte l'injection du <script> : aucun appel réseau réel vers Cloudflare pendant les tests.
    spyOn(document.head, 'appendChild').and.callFake(<T extends Node>(node: T): T => {
      appended.push(node as unknown as HTMLScriptElement);
      return node;
    });
    delete window.turnstile;
  });

  afterEach(() => {
    env.turnstileSiteKey = originalKey;
    delete window.turnstile;
  });

  it('n’injecte rien et rejette quand aucune clé de site n’est configurée', async () => {
    env.turnstileSiteKey = '';
    expect(service.enabled).toBeFalse();
    await expectAsync(service.load()).toBeRejected();
    expect(appended.length).toBe(0);
  });

  it('injecte le script une seule fois et résout quand window.turnstile apparaît', fakeAsync(() => {
    env.turnstileSiteKey = '1x00000000000000000000AA';
    expect(service.enabled).toBeTrue();
    let api1: TurnstileApi | undefined;
    let api2: TurnstileApi | undefined;
    service.load().then(a => (api1 = a));
    service.load().then(a => (api2 = a));
    flushMicrotasks();

    expect(appended.length).toBe(1);
    const script = appended[0];
    expect(script.tagName).toBe('SCRIPT');
    expect(script.id).toBe(TURNSTILE_SCRIPT_ID);
    expect(script.src).toBe(TURNSTILE_SCRIPT_URL);
    expect(script.async).toBeTrue();

    window.turnstile = fakeApi;
    script.dispatchEvent(new Event('load'));
    flushMicrotasks();
    expect(api1).toBe(fakeApi);
    expect(api2).toBe(fakeApi);
  }));

  it('rejette après 8 s sans window.turnstile, puis autorise une nouvelle tentative', fakeAsync(() => {
    env.turnstileSiteKey = 'key';
    let rejected = false;
    service.load().catch(() => (rejected = true));
    tick(TURNSTILE_LOAD_TIMEOUT_MS + 100);
    flushMicrotasks();
    expect(rejected).toBeTrue();

    let api: TurnstileApi | undefined;
    service.load().then(a => (api = a));
    window.turnstile = fakeApi;
    tick(100);
    flushMicrotasks();
    expect(api).toBe(fakeApi);
  }));

  it('rejette si le script émet une erreur de chargement', fakeAsync(() => {
    env.turnstileSiteKey = 'key';
    let error: unknown;
    service.load().catch(e => (error = e));
    flushMicrotasks();
    appended[0].dispatchEvent(new Event('error'));
    flushMicrotasks();
    expect(error).toBeInstanceOf(Error);
    tick(TURNSTILE_LOAD_TIMEOUT_MS + 100);
  }));

  it('résout immédiatement si window.turnstile existe déjà (sans injecter de script)', async () => {
    env.turnstileSiteKey = 'key';
    window.turnstile = fakeApi;
    await expectAsync(service.load()).toBeResolvedTo(fakeApi);
    expect(appended.length).toBe(0);
  });
});
