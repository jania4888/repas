import { FirmClientDossier } from '@core/services/firm-assignment.service';
import {
  FIRM_CLIENT_SEARCH_MAX,
  FirmClientFilterCriteria,
  filterFirmClientDossiers,
  hasActiveFirmClientFilters,
  isFirmClientAwaitingAssignment,
  sanitizeFirmClientSearch,
  uniqueManagers
} from './firm-clients-filters';

function dossier(partial: Partial<FirmClientDossier> & Pick<FirmClientDossier, 'assignmentId' | 'companyName'>): FirmClientDossier {
  return {
    companyTenantId: `tenant-${partial.assignmentId}`,
    activeSince: '2026-10-02',
    hasPermanentFile: true,
    permanentFileStatus: 1,
    permanentFileStatusDisplay: 'En cours',
    assignedAccountantUserId: 'user-salem',
    assignedAccountantName: 'Cabinet salem',
    isAwaitingAccountantAssignment: false,
    isFirmManaged: false,
    ...partial
  };
}

const all: FirmClientFilterCriteria = { q: '', manager: 'all', dpStatus: 'all', kind: 'all' };

const alia = dossier({
  assignmentId: 'asg-alia',
  companyName: 'Sté Alía',
  assignedAccountantName: 'Cabinet salem',
  isFirmManaged: true,
  permanentFileStatus: 1
});
const texto = dossier({
  assignmentId: 'asg-texto',
  companyName: 'Ste Texto',
  assignedAccountantName: 'Cabinet Rania',
  assignedAccountantUserId: 'user-rania',
  isFirmManaged: false,
  hasPermanentFile: true,
  permanentFileStatus: 2,
  permanentFileStatusDisplay: 'Complet'
});
const awaiting = dossier({
  assignmentId: 'asg-wait',
  companyName: 'Ste Bhouri',
  assignedAccountantName: null,
  assignedAccountantUserId: null,
  isAwaitingAccountantAssignment: true,
  hasPermanentFile: false,
  permanentFileStatus: null,
  isFirmManaged: true
});
const xss = dossier({
  assignmentId: 'asg-xss',
  companyName: 'Ste <img src=x onerror=alert(1)>',
  assignedAccountantName: 'Cabinet salem'
});

const rows = [alia, texto, awaiting, xss];

describe('filterFirmClientDossiers', () => {
  it('ignore accents et casse sur la société', () => {
    const found = filterFirmClientDossiers(rows, { ...all, q: 'alia' });
    expect(found.map(r => r.assignmentId)).toEqual(['asg-alia']);
  });

  it('cherche aussi le nom du gestionnaire', () => {
    const found = filterFirmClientDossiers(rows, { ...all, q: 'rania' });
    expect(found.map(r => r.assignmentId)).toEqual(['asg-texto']);
  });

  it('combine les critères en ET', () => {
    const found = filterFirmClientDossiers(rows, {
      q: 'ste',
      manager: 'Cabinet Rania',
      dpStatus: '2',
      kind: 'platform'
    });
    expect(found.map(r => r.assignmentId)).toEqual(['asg-texto']);
  });

  it('isole les dossiers en attente, y compris sans nom', () => {
    expect(isFirmClientAwaitingAssignment(awaiting)).toBeTrue();
    const found = filterFirmClientDossiers(rows, { ...all, manager: 'awaiting' });
    expect(found.map(r => r.assignmentId)).toEqual(['asg-wait']);
  });

  it('traite un flag d’attente même si un nom est encore présent', () => {
    const stale = dossier({
      assignmentId: 'asg-stale',
      companyName: 'Ste Stale',
      assignedAccountantName: 'Cabinet salem',
      isAwaitingAccountantAssignment: true
    });
    expect(isFirmClientAwaitingAssignment(stale)).toBeTrue();
    const byName = filterFirmClientDossiers([stale], { ...all, manager: 'Cabinet salem' });
    expect(byName).toEqual([]);
  });

  it('filtre le dossier permanent absent et par statut', () => {
    expect(filterFirmClientDossiers(rows, { ...all, dpStatus: 'absent' }).map(r => r.assignmentId))
      .toEqual(['asg-wait']);
    expect(filterFirmClientDossiers(rows, { ...all, dpStatus: '2' }).map(r => r.assignmentId))
      .toEqual(['asg-texto']);
  });

  it('filtre le type géré par le cabinet ou client plateforme', () => {
    expect(filterFirmClientDossiers(rows, { ...all, kind: 'firmManaged' }).map(r => r.assignmentId))
      .toEqual(['asg-alia', 'asg-wait']);
    expect(filterFirmClientDossiers(rows, { ...all, kind: 'platform' }).every(r => r.isFirmManaged !== true))
      .toBeTrue();
  });

  it('retourne une liste vide sans lever d’exception', () => {
    expect(filterFirmClientDossiers([], all)).toEqual([]);
    expect(filterFirmClientDossiers(null, all)).toEqual([]);
  });

  it('trim, ignore les caractères de contrôle et tronque à 80 caractères', () => {
    expect(sanitizeFirmClientSearch('  Texto \u0000 ')).toBe('Texto');
    expect(sanitizeFirmClientSearch('x'.repeat(200)).length).toBe(FIRM_CLIENT_SEARCH_MAX);

    const byControl = filterFirmClientDossiers(rows, { ...all, q: 'Te\u0000xto' });
    expect(byControl.map(r => r.assignmentId)).toEqual(['asg-texto']);

    const longLeading = filterFirmClientDossiers(rows, { ...all, q: `${'x'.repeat(80)}Texto` });
    expect(longLeading).toEqual([]);

    const prefix = 'Société '.padEnd(FIRM_CLIENT_SEARCH_MAX, 'N');
    const longRow = dossier({ assignmentId: 'asg-long', companyName: prefix });
    const longWithHit = filterFirmClientDossiers([longRow], { ...all, q: `${prefix}QUE-LA-SUITE` });
    expect(longWithHit.map(r => r.assignmentId)).toEqual(['asg-long']);
  });

  it('conserve le libellé XSS tel quel et ne matche pas les identifiants', () => {
    const found = filterFirmClientDossiers(rows, { ...all, q: 'onerror' });
    expect(found.length).toBe(1);
    expect(found[0]).toBe(xss);
    expect(found[0].companyName).toBe('Ste <img src=x onerror=alert(1)>');

    expect(filterFirmClientDossiers(rows, { ...all, q: 'asg-texto' })).toEqual([]);
    expect(filterFirmClientDossiers(rows, { ...all, q: 'tenant-asg-texto' })).toEqual([]);
    expect(filterFirmClientDossiers(rows, { ...all, q: 'user-rania' })).toEqual([]);
  });

  it('ne matche pas une injection dans le filtre gestionnaire ou un statut inconnu', () => {
    expect(filterFirmClientDossiers(rows, { ...all, manager: "' OR 1=1 --" })).toEqual([]);
    expect(filterFirmClientDossiers(rows, { ...all, dpStatus: '99' })).toEqual([]);
    expect(filterFirmClientDossiers(rows, { ...all, kind: 'other' as 'all' })).toEqual([]);
  });

  it('ne mute pas la liste source', () => {
    const source = [alia, texto];
    const snapshot = [...source];
    filterFirmClientDossiers(source, { ...all, q: 'texto' });
    expect(source).toEqual(snapshot);
  });
});

describe('uniqueManagers / hasActiveFirmClientFilters', () => {
  it('liste les gestionnaires uniques triés, sans les dossiers en attente', () => {
    expect(uniqueManagers(rows)).toEqual(['Cabinet Rania', 'Cabinet salem']);
    expect(uniqueManagers([])).toEqual([]);
  });

  it('détecte un filtre actif', () => {
    expect(hasActiveFirmClientFilters(all)).toBeFalse();
    expect(hasActiveFirmClientFilters({ ...all, q: '  a  ' })).toBeTrue();
    expect(hasActiveFirmClientFilters({ ...all, q: '\u0000' })).toBeFalse();
    expect(hasActiveFirmClientFilters({ ...all, manager: 'awaiting' })).toBeTrue();
    expect(hasActiveFirmClientFilters({ ...all, dpStatus: 'absent' })).toBeTrue();
    expect(hasActiveFirmClientFilters({ ...all, kind: 'platform' })).toBeTrue();
  });
});
