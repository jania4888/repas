import { signal } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { of, throwError } from 'rxjs';

import { ProductFormComponent } from './product-form.component';

/**
 * Champ code-barres de la fiche article.
 *
 * <p>
 * C'est l'écran qui manquait : l'API acceptait un code-barres depuis des mois, mais aucune
 * saisie ne l'alimentait. Pire, la charge utile de mise à jour omettait le champ, et le serveur
 * appliquant <c>SetBarcode</c> sans condition, chaque enregistrement <b>effaçait</b> le code.
 * D'où l'insistance de ces tests sur ce que la charge utile transporte.
 * </p>
 *
 * <p>
 * L'instance est fabriquée sans passer par le constructeur, comme le fait déjà
 * <c>stock-voucher-form.component.spec.ts</c> : c'est assez pour mesurer une règle métier, mais
 * les champs initialisés à la déclaration — dont le <c>computed</c> qui affiche la symbologie
 * déduite — ne sont pas construits. Ce libellé est un confort d'affichage, la validation qui
 * fait autorité étant celle du serveur ; il est couvert par les tests de rendu du composant.
 * </p>
 */
describe('ProductFormComponent — code-barres', () => {
  let generateSpy: jasmine.Spy;
  let toastSpy: jasmine.Spy;

  function createComponent(productId: string | null = 'prod-1'): ProductFormComponent {
    const component = Object.create(ProductFormComponent.prototype) as ProductFormComponent;

    component.form = new FormBuilder().group({
      name: ['Article de test'],
      barcode: ['']
    }) as FormGroup;
    component.productId = signal(productId);
    // Champs `readonly` : l'instance est fabriquée sans passer par le constructeur, il faut
    // donc les poser explicitement.
    Object.defineProperty(component, 'generatingBarcode', { value: signal(false) });
    Object.defineProperty(component, 'labelDialogVisible', { value: signal(false) });
    Object.defineProperty(component, 'labelTarget', { value: signal(null) });

    Object.defineProperty(component, 'productService', {
      value: { generateProductBarcode: generateSpy }
    });
    Object.defineProperty(component, 'toastService', { value: { add: toastSpy } });

    return component;
  }

  beforeEach(() => {
    toastSpy = jasmine.createSpy('add');
    generateSpy = jasmine.createSpy('generateProductBarcode').and.returnValue(
      of({ success: true, data: { barcode: '2001234567895', symbology: 'Ean13' } })
    );
  });

  // ─────────────────────── Génération d'un code interne ───────────────────────

  it('pose le code engendré dans le formulaire et le marque modifié', () => {
    // Sans markAsDirty, la garde « quitter sans enregistrer » laisserait partir l'utilisateur
    // en croyant que son code est acquis, alors qu'il n'est pas encore persisté.
    const component = createComponent();

    component.generateBarcode();

    expect(component.form.get('barcode')!.value).toBe('2001234567895');
    expect(component.form.get('barcode')!.dirty).toBeTrue();
    expect(toastSpy).toHaveBeenCalled();
  });

  it('exclut l’article courant, pour qu’il ne se heurte pas à son propre code', () => {
    const component = createComponent('prod-1');

    component.generateBarcode();

    expect(generateSpy).toHaveBeenCalledOnceWith('prod-1');
  });

  it('n’exclut rien sur une création', () => {
    const component = createComponent(null);

    component.generateBarcode();

    expect(generateSpy).toHaveBeenCalledOnceWith(undefined);
  });

  it('ignore un second clic tant que la demande est en cours', () => {
    const component = createComponent();
    component.generatingBarcode.set(true);

    component.generateBarcode();

    expect(generateSpy).not.toHaveBeenCalled();
  });

  it('libère le bouton même quand la demande échoue', () => {
    generateSpy.and.returnValue(throwError(() => new Error('réseau')));
    const component = createComponent();

    component.generateBarcode();

    expect(component.generatingBarcode()).toBeFalse();
    expect(component.form.get('barcode')!.value).toBe('');
  });

  // ─────────────────────── Dialogue d'étiquettes ───────────────────────

  it('prépare le dialogue d’étiquettes depuis la fiche ouverte', () => {
    const component = createComponent('prod-1');
    component.form.get('barcode')!.setValue('4006381333931');

    component.openLabelDialog();

    expect(component.labelDialogVisible()).toBeTrue();
    expect(component.labelTarget()).toEqual({
      id: 'prod-1',
      name: 'Article de test',
      hasBarcode: true
    });
  });

  it('n’ouvre pas le dialogue d’étiquettes sur un article pas encore enregistré', () => {
    // Il n'y a rien à imprimer tant que l'article n'a pas d'identifiant.
    const component = createComponent(null);

    component.openLabelDialog();

    expect(component.labelDialogVisible()).toBeFalse();
  });

  it('prévient que l’étiquette portera le code interne quand il n’y a pas de code-barres', () => {
    const component = createComponent('prod-1');
    component.form.get('barcode')!.setValue('   ');

    component.openLabelDialog();

    expect(component.labelTarget()!.hasBarcode).toBeFalse();
  });
});
