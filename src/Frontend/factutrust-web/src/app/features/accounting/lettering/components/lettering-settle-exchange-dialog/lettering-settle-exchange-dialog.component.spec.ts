import { LetteringSettleExchangeDialogComponent } from './lettering-settle-exchange-dialog.component';

describe('LetteringSettleExchangeDialogComponent', () => {
  let component: LetteringSettleExchangeDialogComponent;

  beforeEach(() => {
    component = new LetteringSettleExchangeDialogComponent();
  });

  describe('onVisibleChange', () => {
    it('réinitialise le compte saisi à chaque ouverture (aucun défaut persisté)', () => {
      component.account = '655';
      component.onVisibleChange(true);
      expect(component.account).toBe('');
    });

    it('ne réinitialise pas le compte à la fermeture', () => {
      component.account = '655';
      component.onVisibleChange(false);
      expect(component.account).toBe('655');
    });

    it('émet visibleChange avec la valeur reçue', () => {
      const emitted: boolean[] = [];
      component.visibleChange.subscribe(v => emitted.push(v));
      component.onVisibleChange(true);
      component.onVisibleChange(false);
      expect(emitted).toEqual([true, false]);
    });
  });

  describe('onCancel', () => {
    it('émet visibleChange(false) sans émettre settle', () => {
      const visible: boolean[] = [];
      const settled: string[] = [];
      component.visibleChange.subscribe(v => visible.push(v));
      component.settle.subscribe(a => settled.push(a));
      component.onCancel();
      expect(visible).toEqual([false]);
      expect(settled).toEqual([]);
    });
  });

  describe('onSettle', () => {
    it('émet settle avec le compte saisi, nettoyé des espaces', () => {
      component.account = '  655  ';
      const emitted: string[] = [];
      component.settle.subscribe(a => emitted.push(a));
      component.onSettle();
      expect(emitted).toEqual(['655']);
    });

    it("n'émet rien si le compte est vide ou ne contient que des espaces", () => {
      component.account = '   ';
      const emitted: string[] = [];
      component.settle.subscribe(a => emitted.push(a));
      component.onSettle();
      expect(emitted).toEqual([]);
    });

    it("n'émet rien pendant une opération en cours (busy)", () => {
      component.account = '655';
      component.busy = true;
      const emitted: string[] = [];
      component.settle.subscribe(a => emitted.push(a));
      component.onSettle();
      expect(emitted).toEqual([]);
    });
  });
});
