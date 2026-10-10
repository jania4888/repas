import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EntryToolbarComponent } from './entry-toolbar.component';
import { EntryFormStore } from '../services/entry-form.store';
import { AuthService } from '@core/services/auth.service';

/**
 * Ces tests couvrent l'ouverture des menus déroulants de la barre d'outils.
 *
 * Point méthodologique : chaque clic est déclenché par un VRAI événement DOM qui remonte
 * jusqu'à `document` (`dispatchEvent(new MouseEvent('click', { bubbles: true }))`).
 * C'est indispensable : le composant écoute `(document:click)` pour refermer ses menus, et
 * un `triggerEventHandler('click', …)` — qui appelle la méthode sans propagation réelle —
 * passerait au vert même si l'ouverture était cassée.
 */
describe('EntryToolbarComponent', () => {
  let fixture: ComponentFixture<EntryToolbarComponent>;
  let store: EntryFormStore;

  const authMock = { hasPermission: () => true };

  /** Clic utilisateur fidèle : phase cible puis remontée jusqu'à `document`. */
  function click(element: Element): void {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
  }

  function toggleButton(label: string): HTMLButtonElement {
    const buttons = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button')
    );
    const match = buttons.find(b => (b.textContent ?? '').trim().startsWith(label));
    if (!match) {
      throw new Error(`Bouton « ${label} » introuvable dans la barre d'outils.`);
    }
    return match;
  }

  function openMenus(): HTMLElement[] {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.dropdown-menu')
    );
  }

  function menuText(): string {
    return openMenus().map(m => m.textContent ?? '').join(' ');
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EntryToolbarComponent],
      providers: [
        EntryFormStore,
        { provide: AuthService, useValue: authMock }
      ]
    }).compileComponents();

    store = TestBed.inject(EntryFormStore);
    fixture = TestBed.createComponent(EntryToolbarComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('n’affiche aucun menu au départ', () => {
    expect(openMenus().length).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Ouverture — le défaut historique : le menu se refermait dans la même propagation
  // ---------------------------------------------------------------------------

  it('ouvre le menu Import et le laisse ouvert après le cycle de rendu', () => {
    click(toggleButton('Import'));

    expect(openMenus().length).toBe(1);
    expect(menuText()).toContain('Importer une facture');
  });

  it("ouvre le menu Options d'écriture et le laisse ouvert", () => {
    click(toggleButton("Options d'écriture"));

    expect(openMenus().length).toBe(1);
    expect(menuText()).toContain('Colonne Pièce');
  });

  it('ouvre le menu Modèle et le laisse ouvert', () => {
    click(toggleButton('Modèle'));

    expect(openMenus().length).toBe(1);
    expect(menuText()).toContain('Charger un modèle');
  });

  it('ouvre le menu du bouton Enregistrer et le laisse ouvert', () => {
    // Le split n'est actionnable que si l'écriture est soumettable.
    store.entryLabel.set('Test');
    store.setLines([
      { ...store.lines()[0], accountNumber: '607', lineLabel: 'A', debit: 100, credit: null },
      { ...store.lines()[1], accountNumber: '4011', lineLabel: 'B', debit: null, credit: 100 }
    ]);
    fixture.detectChanges();

    const split = (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.dropdown-toggle-split');
    expect(split).withContext('bouton split introuvable').toBeTruthy();

    click(split!);

    expect(openMenus().length).toBe(1);
    expect(menuText()).toContain('Enregistrer & nouveau');
  });

  // ---------------------------------------------------------------------------
  // Exclusivité et fermeture
  // ---------------------------------------------------------------------------

  it('ferme les autres menus quand on en ouvre un', () => {
    click(toggleButton("Options d'écriture"));
    expect(menuText()).toContain('Colonne Pièce');

    click(toggleButton('Import'));

    expect(openMenus().length).toBe(1);
    expect(menuText()).toContain('Importer une facture');
    expect(menuText()).not.toContain('Colonne Pièce');
  });

  it('referme le menu au second clic sur son propre bouton', () => {
    click(toggleButton('Import'));
    expect(openMenus().length).toBe(1);

    click(toggleButton('Import'));
    expect(openMenus().length).toBe(0);
  });

  it('referme le menu ouvert lors d’un clic ailleurs dans le document', () => {
    click(toggleButton('Import'));
    expect(openMenus().length).toBe(1);

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    fixture.detectChanges();

    expect(openMenus().length).toBe(0);
  });

  it("garde le menu Options ouvert quand on coche une de ses cases", () => {
    click(toggleButton("Options d'écriture"));

    const checkbox = (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLInputElement>('.dropdown-item-check input[type="checkbox"]');
    expect(checkbox).withContext('case à cocher introuvable').toBeTruthy();

    checkbox!.click();
    fixture.detectChanges();

    expect(openMenus().length)
      .withContext('le panneau Options doit rester ouvert pendant le réglage des colonnes')
      .toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Contenu du menu Import
  // ---------------------------------------------------------------------------

  it("émet importDocument une seule fois et referme le menu", () => {
    const emitted: void[] = [];
    fixture.componentInstance.importDocument.subscribe(() => emitted.push(undefined));

    click(toggleButton('Import'));

    const item = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.dropdown-item')
    ).find(b => (b.textContent ?? '').includes('Importer une facture'));
    expect(item).withContext('entrée d’import introuvable').toBeTruthy();

    click(item!);

    expect(emitted.length).toBe(1);
    expect(openMenus().length).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Import de relevé bancaire : visible seulement si le serveur l'a activé
  // ---------------------------------------------------------------------------

  function bankStatementItem(): HTMLButtonElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-testid="import-bank-statement"]');
  }

  it("n'affiche pas l'import de relevé bancaire tant que la fonctionnalité est désactivée", () => {
    click(toggleButton('Import'));

    expect(bankStatementItem()).toBeNull();
    expect(menuText()).toContain('Importer une facture');
  });

  it("affiche l'import de relevé bancaire quand le serveur l'active et émet une seule fois", () => {
    fixture.componentRef.setInput('bankStatementImportEnabled', true);
    fixture.detectChanges();
    const emitted: void[] = [];
    fixture.componentInstance.importBankStatement.subscribe(() => emitted.push(undefined));

    click(toggleButton('Import'));
    const item = bankStatementItem();
    expect(item).withContext('entrée « relevé bancaire » introuvable').toBeTruthy();

    click(item!);

    expect(emitted.length).toBe(1);
    expect(openMenus().length).toBe(0);
  });

  it("masque l'import de relevé bancaire sans le droit de création comptable", () => {
    const original = authMock.hasPermission;
    authMock.hasPermission = () => false;
    try {
      fixture.componentRef.setInput('bankStatementImportEnabled', true);
      fixture.detectChanges();

      click(toggleButton('Import'));

      expect(bankStatementItem()).toBeNull();
    } finally {
      authMock.hasPermission = original;
    }
  });

  it("n'expose plus l'import de fichier ni les écritures en brouillard", () => {
    click(toggleButton('Import'));

    const menu = openMenus()[0];
    const hrefs = Array.from(menu.querySelectorAll<HTMLAnchorElement>('a')).map(a => a.getAttribute('href'));
    const text = menu.textContent ?? '';

    expect(hrefs).not.toContain('/accounting/import');
    expect(hrefs).not.toContain('/accounting/draft-batch');
    expect(text).not.toContain('Import de fichier');
    expect(text).not.toContain('Écritures en brouillard');
    expect(text).toContain('Importer une facture');
    expect(menu.querySelector('.dropdown-divider')).toBeNull();
  });
});
