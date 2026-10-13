import {
  DeclarationCalculationOrigin,
  MonthlyDeclarationTrackingRowDto,
  VatDeclarationStatus
} from '../services/accounting.service';
import {
  defaultTrackingYear,
  describeRow,
  isTrackableYear,
  periodLabel,
  rowOriginLabel,
  stateLabel,
  stateNeedsAttention,
  summariseTracking,
  trackingState
} from './monthly-declaration-tracking.view-model';

const TODAY = new Date(2026, 8, 16); // 16 septembre 2026

function row(over: Partial<MonthlyDeclarationTrackingRowDto> = {}): MonthlyDeclarationTrackingRowDto {
  return {
    month: 1,
    exists: false,
    status: VatDeclarationStatus.Draft,
    submittedAt: null,
    updatedAt: null,
    totalToPay: 0,
    vatDue: 0,
    revisionNumber: 1,
    isRectificative: false,
    filingDeadline: '2026-02-22T00:00:00Z',
    calculationOrigin: null,
    ...over
  };
}

describe('monthly-declaration-tracking.view-model', () => {
  describe('exercice', () => {
    it("propose l'année du mois écoulé", () => {
      expect(defaultTrackingYear(new Date(2026, 8, 16))).toBe(2026);
    });

    it('reste sur l’année précédente au 1er janvier, dont les déclarations se déposent', () => {
      expect(defaultTrackingYear(new Date(2026, 0, 5))).toBe(2025);
    });

    it('reprend les bornes du serveur', () => {
      expect(isTrackableYear(2026)).toBe(true);
      expect(isTrackableYear(1999)).toBe(false);
      expect(isTrackableYear(2101)).toBe(false);
      expect(isTrackableYear(2026.5)).toBe(false);
    });
  });

  describe('état d’un mois', () => {
    it('distingue verrouillée, déposée et brouillon', () => {
      expect(trackingState(row({ exists: true, status: VatDeclarationStatus.Locked }), TODAY)).toBe('locked');
      expect(trackingState(row({ exists: true, status: VatDeclarationStatus.Submitted }), TODAY)).toBe('submitted');
      expect(trackingState(row({ exists: true, status: VatDeclarationStatus.Draft }), TODAY)).toBe('draft');
    });

    it('sépare le retard de la période simplement à venir', () => {
      expect(trackingState(row({ filingDeadline: '2026-02-22T00:00:00Z' }), TODAY)).toBe('late');
      expect(trackingState(row({ filingDeadline: '2026-11-22T00:00:00Z' }), TODAY)).toBe('missing');
    });

    it('ne compte pas en retard une échéance qui tombe aujourd’hui', () => {
      expect(trackingState(row({ filingDeadline: '2026-09-16T00:00:00Z' }), TODAY)).toBe('missing');
    });

    it('ne se laisse pas troubler par une échéance illisible', () => {
      expect(trackingState(row({ filingDeadline: 'pas une date' }), TODAY)).toBe('missing');
    });

    it('ne signale que les états qui appellent une action', () => {
      expect(stateNeedsAttention('late')).toBe(true);
      expect(stateNeedsAttention('draft')).toBe(true);
      expect(stateNeedsAttention('submitted')).toBe(false);
      expect(stateNeedsAttention('locked')).toBe(false);
      expect(stateNeedsAttention('missing')).toBe(false);
    });

    it('nomme chaque état', () => {
      expect(stateLabel('locked')).toBe('Verrouillée');
      expect(stateLabel('submitted')).toBe('Déposée');
      expect(stateLabel('draft')).toBe('Brouillon');
      expect(stateLabel('late')).toBe('En retard');
      expect(stateLabel('missing')).toBe('À déposer');
    });
  });

  describe('explication d’une ligne', () => {
    it('signale une rectificative avec son numéro', () => {
      const text = describeRow(
        row({
          exists: true,
          status: VatDeclarationStatus.Submitted,
          isRectificative: true,
          revisionNumber: 2
        }),
        TODAY
      );
      expect(text).toContain('rectificative');
      expect(text).toContain('2');
    });

    it('dit qu’un brouillon n’a jamais été déposé', () => {
      expect(describeRow(row({ exists: true, status: VatDeclarationStatus.Draft }), TODAY)).toContain(
        'jamais déposé'
      );
    });

    it('dit que l’échéance est passée sur un mois en retard', () => {
      expect(describeRow(row({ filingDeadline: '2026-02-22T00:00:00Z' }), TODAY)).toContain(
        'échéance est passée'
      );
    });
  });

  describe('synthèse', () => {
    it('compte chaque état', () => {
      const summary = summariseTracking(
        [
          row({ month: 1, exists: true, status: VatDeclarationStatus.Submitted }),
          row({ month: 2, exists: true, status: VatDeclarationStatus.Locked }),
          row({ month: 3, exists: true, status: VatDeclarationStatus.Draft }),
          row({ month: 4, filingDeadline: '2026-05-22T00:00:00Z' }),
          row({ month: 11, filingDeadline: '2026-12-22T00:00:00Z' })
        ],
        TODAY
      );

      expect(summary.filed).toBe(2);
      expect(summary.drafts).toBe(1);
      expect(summary.late).toBe(1);
      expect(summary.missing).toBe(1);
    });

    /** Un brouillon n'est pas un montant dû : le cumul dirait sinon plus que ce qui est engagé. */
    it('ne cumule que le total des périodes réellement déposées', () => {
      const summary = summariseTracking(
        [
          row({ month: 1, exists: true, status: VatDeclarationStatus.Submitted, totalToPay: 100.5 }),
          row({ month: 2, exists: true, status: VatDeclarationStatus.Locked, totalToPay: 200.25 }),
          row({ month: 3, exists: true, status: VatDeclarationStatus.Draft, totalToPay: 999 })
        ],
        TODAY
      );

      expect(summary.totalToPay).toBe(300.75);
    });

    it('supporte une liste absente', () => {
      const summary = summariseTracking(null, TODAY);
      expect(summary.filed).toBe(0);
      expect(summary.totalToPay).toBe(0);
    });
  });

  describe('libellés partagés', () => {
    it('nomme la période comme l’écran de déclaration', () => {
      expect(periodLabel(2026, 3)).toBe('Mars 2026');
    });

    it('nomme le calcul qui a produit le dépôt, et rien sans dépôt', () => {
      expect(
        rowOriginLabel(row({ calculationOrigin: DeclarationCalculationOrigin.Historic }))
      ).toBe('Calcul historique');
      expect(
        rowOriginLabel(row({ calculationOrigin: DeclarationCalculationOrigin.Configured }))
      ).toBe('Calcul paramétré');
      expect(rowOriginLabel(row({ calculationOrigin: null }))).toBe('—');
    });
  });
});
