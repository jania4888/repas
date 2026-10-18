import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Observable, of, Subject, throwError } from 'rxjs';
import { AccountingDocumentImportDialogComponent } from './accounting-document-import-dialog.component';
import { AccountingDocumentImportService } from '../../services/accounting-document-import.service';
import { AccountingService } from '../../../services/accounting.service';
import { TaxService } from '@core/services/tax.service';
import { BankAccountService } from '@core/services/bank-account.service';
import { ClientService } from '@core/services/client.service';
import { SupplierService } from '@core/services/supplier.service';
import { JournalEntryProposal, ProposalDiagnostic } from '../../models/accounting-document-import.models';
import { EntryFormStore } from '../../services/entry-form.store';
import { createEmptyLine } from '../../models/entry-form.model';
import { ImportProposalEditorComponent } from './import-proposal-editor.component';
import { ConfirmationService } from '@core/services/confirmation.service';
import { ACCOUNTING_DOCUMENT_MAX_BYTES } from './accounting-document-preview.util';

function sampleProposal(): JournalEntryProposal {
  return {
    direction: 'PURCHASE',
    directionReason: null,
    journalCode: 'JA',
    entryDate: '2026-08-01',
    label: 'Facture',
    pieceRef: 'FAC-1',
    pieceDate: '2026-08-01',
    thirdParty: null,
    lines: [
      {
        accountNumber: '607',
        accountLabel: 'Achats',
        accountStatus: 'found',
        role: 'expense',
        label: 'HT',
        debit: 100,
        credit: 0,
        vatRatePercent: null,
        thirdPartyId: null,
        thirdPartyKind: null
      },
      {
        accountNumber: '4011',
        accountLabel: 'Fournisseurs',
        accountStatus: 'found',
        role: 'thirdparty',
        label: 'Fournisseur',
        debit: 0,
        credit: 100,
        vatRatePercent: null,
        thirdPartyId: null,
        thirdPartyKind: null
      }
    ],
    totalDebit: 100,
    totalCredit: 100,
    documentTotalTtc: 100,
    extraction: {
      documentType: 'INVOICE',
      documentNumber: 'FAC-1',
      issueDate: '2026-08-01',
      dueDate: null,
      documentStatus: null,
      currency: 'TND',
      seller: null,
      buyer: null,
      lines: [],
      vatBreakdown: [],
      totalHt: 100,
      totalVat: 0,
      fodecAmount: null,
      fiscalStampAmount: null,
      withholdingAmount: null,
      totalTtc: 100,
      confidence: 'high',
      warnings: [],
      extractionMethod: 'native-pdf',
      ocrApplied: false,
      vatBreakdownRecomputed: false
    },
    diagnostics: [],
    hasBlockingDiagnostic: false
  };
}

type ChartResponse = { success: boolean; data: unknown[] };

const CHART_WITH_4011 = [
  { id: '1', accountNumber: '607', label: 'Achats', accountClass: 6, isActive: true, isSystem: false, natureType: 0, level: 1 },
  { id: '2', accountNumber: '4011', label: 'Fournisseurs', accountClass: 4, isActive: true, isSystem: false, natureType: 0, level: 2 }
];

describe('AccountingDocumentImportDialogComponent', () => {
  let fixture: ComponentFixture<AccountingDocumentImportDialogComponent>;
  let component: AccountingDocumentImportDialogComponent;
  let proposeSpy: jasmine.Spy;
  /** Réponse du plan comptable pour l'éditeur (modifiable avant l'ouverture de la revue). */
  let chartOfAccounts: () => Observable<ChartResponse>;

  beforeEach(async () => {
    chartOfAccounts = () => of({ success: true, data: CHART_WITH_4011 });
    spyOn(URL, 'createObjectURL').and.returnValue('blob:preview-test');
    spyOn(URL, 'revokeObjectURL');
    proposeSpy = jasmine.createSpy('propose').and.returnValue(of(sampleProposal()));

    await TestBed.configureTestingModule({
      imports: [AccountingDocumentImportDialogComponent],
      providers: [
        provideNoopAnimations(),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AccountingDocumentImportService,
          useValue: {
            capabilities: () => of({ enabled: true, aiFallbackAvailable: true }),
            propose: proposeSpy
          }
        },
        {
          provide: AccountingService,
          useValue: {
            // Le store de référence charge aussi les devises depuis ce service.
            getCurrencies: () => of({ success: true, data: [] }),
            getChartOfAccounts: () => chartOfAccounts(),
            getPeriods: () => of({ success: true, data: [] }),
            getJournals: () => of({ success: true, data: [{ code: 'JA', label: 'Achats' }] })
          }
        },
        {
          provide: TaxService,
          useValue: {
            getVatRates: () => of({ success: true, data: [{ id: '1', percent: 19, label: '19%' }] })
          }
        },
        {
          provide: BankAccountService,
          useValue: { list: () => of({ success: true, data: [] }) }
        },
        {
          provide: ClientService,
          useValue: { getClients: () => of({ success: true, data: { items: [] } }) }
        },
        {
          provide: SupplierService,
          useValue: { getSuppliers: () => of({ success: true, data: { items: [] } }) }
        }
      ]
    });

    TestBed.overrideComponent(AccountingDocumentImportDialogComponent, {
      set: {
        providers: [
          {
            provide: AccountingDocumentImportService,
            useValue: {
              capabilities: () => of({ enabled: true, aiFallbackAvailable: true }),
              propose: proposeSpy
            }
          }
        ]
      }
    });

    await TestBed.compileComponents();

    fixture = TestBed.createComponent(AccountingDocumentImportDialogComponent);
    component = fixture.componentInstance;
    component.visible = true;
    fixture.detectChanges();
  });

  it('canApply is false when proposal has blocking diagnostic', () => {
    component.proposal.set({
      ...sampleProposal(),
      diagnostics: [{ severity: 'blocking', code: 'PeriodClosed', message: 'Clôturé', relatedLineIndex: null }],
      hasBlockingDiagnostic: true
    });
    component.phase.set('review');
    fixture.detectChanges();
    expect(component.canApply()).toBe(false);
  });

  it('changeDirection asks confirmation when manual edits exist', () => {
    const confirmSpy = spyOn(TestBed.inject(ConfirmationService), 'confirm');
    component.proposal.set(sampleProposal());
    component.phase.set('review');
    component['currentFile'] = new File(['x'], 'test.pdf');
    fixture.detectChanges();

    editorStore().updateLine(0, { lineLabel: 'Modifié' });
    fixture.detectChanges();

    component.changeDirection('SALE');
    expect(confirmSpy).toHaveBeenCalled();
    expect(proposeSpy).not.toHaveBeenCalled();
  });

  it('shows a preview and does not propose until the user analyzes', async () => {
    const file = pdfFile();
    await component.onFileSelected(fileEvent(file));
    fixture.detectChanges();

    expect(component.phase()).toBe('preview');
    expect(proposeSpy).not.toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('object')).not.toBeNull();

    component.analyze();
    expect(proposeSpy).toHaveBeenCalledOnceWith(file);
    expect(component.phase()).toBe('review');
  });

  it('rejects an oversized file before any preview url or propose call', async () => {
    const oversized = {
      name: 'gros.pdf',
      size: ACCOUNTING_DOCUMENT_MAX_BYTES + 1,
      slice: () => new Blob()
    } as unknown as File;

    await component.onFileSelected(fileEvent(oversized));
    fixture.detectChanges();

    expect(component.phase()).toBe('error');
    expect(component.rejection()).toBe('too-large');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(proposeSpy).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Fichier trop volumineux');
  });

  it('rejects a PDF whose bytes are HTML', async () => {
    const file = new File(['<!doctype html>'], 'note.pdf', { type: 'text/html' });
    await component.onFileSelected(fileEvent(file));
    fixture.detectChanges();

    expect(component.phase()).toBe('error');
    expect(component.rejection()).toBe('signature');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(proposeSpy).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('object')).toBeNull();
  });

  it('returns to the preview when analysis is cancelled and ignores a late response', async () => {
    const pending = new Subject<ReturnType<typeof sampleProposal>>();
    proposeSpy.and.returnValue(pending.asObservable());
    const file = pdfFile();
    await component.onFileSelected(fileEvent(file));
    component.analyze();
    expect(component.phase()).toBe('extracting');

    component.cancelImport();
    expect(component.phase()).toBe('preview');
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    pending.next(sampleProposal());
    expect(component.phase()).toBe('preview');
    expect(component.proposal()).toBeNull();
  });

  it('revokes the object url when the dialog closes', async () => {
    await component.onFileSelected(fileEvent(pdfFile()));
    component.onHide();
    expect(URL.revokeObjectURL).toHaveBeenCalledOnceWith('blob:preview-test');
  });

  it('revokes the object url on destroy', async () => {
    await component.onFileSelected(fileEvent(pdfFile()));
    component.ngOnDestroy();
    expect(URL.revokeObjectURL).toHaveBeenCalledOnceWith('blob:preview-test');
  });

  it('applies the original File after preview', async () => {
    const file = pdfFile();
    const emitted: { proposal: ReturnType<typeof sampleProposal>; file: File }[] = [];
    component.applied.subscribe((event) => emitted.push(event));

    await component.onFileSelected(fileEvent(file));
    component.analyze();
    fixture.detectChanges();
    expect(component.canApply()).toBe(true);

    component.apply();
    expect(emitted.length).toBe(1);
    expect(emitted[0].file).toBe(file);
    expect(emitted[0].proposal.pieceRef).toBe('FAC-1');
    expect(URL.revokeObjectURL).toHaveBeenCalledOnceWith('blob:preview-test');
  });

  it('keeps the current phase when the file picker is cancelled', () => {
    component.phase.set('review');
    component.proposal.set(sampleProposal());
    fixture.detectChanges();

    component.chooseFile();
    component.onFileSelected(fileEvent(undefined));
    expect(component.phase()).toBe('review');
    expect(component.proposal()?.pieceRef).toBe('FAC-1');
  });

  it('shows an Office file without an image or pdf viewer and still allows analysis', async () => {
    const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0])], 'facture.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });
    await component.onFileSelected(fileEvent(file));
    fixture.detectChanges();

    expect(component.phase()).toBe('preview');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('object')).toBeNull();
    expect(fixture.nativeElement.querySelector('img')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Analyser la facture');
    expect(fixture.nativeElement.textContent).toContain('Aperçu visuel indisponible');
    expect(proposeSpy).not.toHaveBeenCalled();
  });

  it('shows the short "Analyse par l\'IA" banner when a document extraction provider is configured', async () => {
    component.externalProvider.set('docstrange');
    await component.onFileSelected(fileEvent(pdfFile()));
    fixture.detectChanges();

    const banner = fixture.nativeElement.querySelector('.adi-banner') as HTMLElement | null;
    expect(banner?.textContent?.trim()).toBe("Analyse par l'IA");
    expect(fixture.nativeElement.textContent).not.toContain('quitte le serveur');
  });

  it('shows no provider banner when no document extraction provider is configured', async () => {
    component.externalProvider.set(null);
    await component.onFileSelected(fileEvent(pdfFile()));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.adi-banner')).toBeNull();
  });

  // ---------------------------------------------------------------------------------------------
  // Lignes d'écriture proposées (section du bas, éditable)
  // ---------------------------------------------------------------------------------------------

  function editorStore(): EntryFormStore {
    const editorDe = fixture.debugElement.query(By.directive(ImportProposalEditorComponent));
    expect(editorDe).withContext('éditeur rendu').not.toBeNull();
    return editorDe.injector.get(EntryFormStore);
  }

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function banner(): HTMLElement | null {
    return host().querySelector('.adi-lines-banner');
  }

  function diagnosticTexts(): string[] {
    return Array.from(host().querySelectorAll('.adi-diagnostic span')).map(e => (e.textContent ?? '').trim());
  }

  function applyButton(): HTMLButtonElement {
    const buttons = Array.from(host().querySelectorAll('.adi-footer button')) as HTMLButtonElement[];
    const button = buttons.find(b => (b.textContent ?? '').includes('Appliquer'));
    expect(button).withContext('bouton Appliquer').toBeDefined();
    return button!;
  }

  /** Ouvre la revue avec aperçu, comme l'utilisateur : fichier → Analyser. */
  async function openReview(proposal: JournalEntryProposal = sampleProposal()): Promise<File> {
    proposeSpy.and.returnValue(of(proposal));
    const file = pdfFile();
    await component.onFileSelected(fileEvent(file));
    component.analyze();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return file;
  }

  function withDiagnostics(diagnostics: ProposalDiagnostic[], patch: Partial<JournalEntryProposal> = {}): JournalEntryProposal {
    return {
      ...sampleProposal(),
      ...patch,
      diagnostics,
      hasBlockingDiagnostic: diagnostics.some(d => d.severity === 'blocking')
    };
  }

  it('renders the lines section full width after the review column, without being squashed', async () => {
    await openReview();
    const layout = host().querySelector('.adi-review-layout') as HTMLElement;
    const lines = host().querySelector('.adi-lines') as HTMLElement;
    expect(lines).not.toBeNull();
    expect(lines.parentElement).toBe(layout);
    expect(host().querySelector('.adi-review .adi-lines')).toBeNull();
    expect(host().querySelector('.adi-card--editor')).toBeNull();
    expect(lines.getBoundingClientRect().height).toBeGreaterThanOrEqual(lines.scrollHeight - 1);
    expect(lines.getBoundingClientRect().height).toBeGreaterThan(200);
    expect(lines.querySelector('#adi-lines-title')?.textContent).toContain("Lignes d'écriture proposées");
    expect(lines.querySelectorAll('.entry-lines-table tbody tr').length).toBe(2);
  });

  it('orders the review: direction, third party and zones, controls, then lines', async () => {
    await openReview(withDiagnostics([{ severity: 'warning', code: 'X', message: 'Avertissement', relatedLineIndex: null }]));
    const cards = Array.from(host().querySelectorAll('.adi-card')) as HTMLElement[];
    const titles = cards.map(c => (c.querySelector('.adi-card__title')?.textContent ?? '').trim());
    expect(titles[0]).toBe('Sens de la pièce');
    expect(titles.indexOf('Contrôles')).toBeGreaterThan(titles.indexOf('Zones détectées'));
    expect(titles[titles.length - 1]).toBe("Lignes d'écriture proposées");
  });

  it('recalculates controls on open: matched third party and known accounts clear server diagnostics', async () => {
    await openReview(withDiagnostics(
      [
        { severity: 'warning', code: 'ThirdPartyNotMatched', message: 'Tiers non rapproché (serveur)', relatedLineIndex: 1 },
        { severity: 'blocking', code: 'AccountMissing', message: 'Compte 4011 absent (serveur)', relatedLineIndex: 1 }
      ],
      {
        thirdParty: {
          kind: 2, matchedId: 'sup-1', matchedName: 'ACME', matchedBy: 'nif', collectiveAccountNumber: '4011',
          name: 'ACME', nif: null, email: null, phone: null, street: null, city: null, postalCode: null, governorate: null
        }
      }
    ));
    expect(diagnosticTexts().join(' ')).not.toContain('serveur');
    expect(component.hasBlocking()).toBe(false);
    expect(component.canApply()).toBe(true);
  });

  describe('compte auxiliaire rapproché par matricule fiscal', () => {
    function tp(overrides: Record<string, unknown> = {}) {
      return {
        kind: 2, matchedId: null, matchedName: null, matchedBy: null, collectiveAccountNumber: '4011',
        name: 'ACME', nif: '1234567A/B/M/000', email: null, phone: null, street: null, city: null, postalCode: null, governorate: null,
        ...overrides
      };
    }

    function auxBadge(): HTMLElement | null {
      return host().querySelector('[data-component-id="adi-match-badge"]');
    }

    function auxRow(): HTMLElement | null {
      return (Array.from(host().querySelectorAll('.adi-facts dt'))
        .find(dt => (dt.textContent ?? '').trim() === 'Compte auxiliaire')
        ?.parentElement ?? null) as HTMLElement | null;
    }

    function tiersCard(): HTMLElement {
      const card = host().querySelector('.adi-columns .adi-card');
      expect(card).withContext('carte Tiers').not.toBeNull();
      return card as HTMLElement;
    }

    it('affiche la ligne "Compte auxiliaire" et le badge "Rapproché par matricule fiscal" quand matchedAccountNumber vient du NIF', async () => {
      await openReview(withDiagnostics([], {
        thirdParty: tp({ matchedAccountId: 'acc-9', matchedAccountNumber: '401002', matchedAccountLabel: 'Fournisseur ACME', matchedAccountBy: 'nif' })
      }));

      const row = auxRow();
      expect(row).not.toBeNull();
      expect(row!.textContent).toContain('401002');
      expect(row!.textContent).toContain('Fournisseur ACME');

      const badge = auxBadge();
      expect(badge).not.toBeNull();
      expect(badge!.classList.contains('adi-badge--ok')).toBe(true);
      expect(badge!.textContent).toContain('Rapproché par matricule fiscal');
    });

    it('affiche le badge d’avertissement "Rapproché par nom" quand matchedAccountBy vaut "name"', async () => {
      await openReview(withDiagnostics([], {
        thirdParty: tp({ matchedAccountId: 'acc-9', matchedAccountNumber: '401002', matchedAccountLabel: 'Fournisseur ACME', matchedAccountBy: 'name' })
      }));

      const badge = auxBadge();
      expect(badge).not.toBeNull();
      expect(badge!.classList.contains('adi-badge--warn')).toBe(true);
      expect(badge!.textContent).toContain('Rapproché par nom');
    });

    it('masque la ligne "Compte auxiliaire" quand aucun compte auxiliaire n’a été rapproché', async () => {
      await openReview(withDiagnostics([], { thirdParty: tp() }));
      expect(auxRow()).toBeNull();
    });

    it('n’affiche plus l’avertissement "Tiers non rapproché" ni la création rapide quand un compte auxiliaire est rapproché', async () => {
      await openReview(withDiagnostics([], {
        thirdParty: tp({ matchedAccountId: 'acc-9', matchedAccountNumber: '401002', matchedAccountLabel: 'Fournisseur ACME', matchedAccountBy: 'nif' })
      }));

      // La carte Tiers elle-même ne doit plus porter l'avertissement ni la création rapide
      // (le même libellé peut réapparaître côté panneau Contrôles si la ligne ne porte pas
      // encore le compte auxiliaire proposé — hors périmètre de cette assertion).
      expect(tiersCard().textContent).not.toContain('Tiers non rapproché');
      expect(host().querySelector('app-accounting-third-party-quick-create')).toBeNull();
    });

    it('conserve l’ancien comportement (avertissement + création rapide) quand ni la fiche ni le compte auxiliaire ne sont rapprochés', async () => {
      await openReview(withDiagnostics([], { thirdParty: tp() }));

      expect(tiersCard().textContent).toContain('Tiers non rapproché');
      expect(host().querySelector('app-accounting-third-party-quick-create')).not.toBeNull();
      expect(auxBadge()).toBeNull();
    });

    it('conserve le badge "Rapproché par matricule fiscal" quand c’est la fiche (matchedId) qui est rapprochée par NIF, sans compte auxiliaire', async () => {
      await openReview(withDiagnostics([], {
        thirdParty: tp({ matchedId: 'sup-1', matchedName: 'ACME', matchedBy: 'nif' })
      }));

      const badge = auxBadge();
      expect(badge).not.toBeNull();
      expect(badge!.classList.contains('adi-badge--ok')).toBe(true);
      expect(auxRow()).toBeNull();
    });

    it('rend un nom de tiers malveillant en texte, jamais en HTML (binding `{{ }}`, pas innerHTML)', async () => {
      const malicious = '<img src=x onerror=alert(1)>ACME';
      await openReview(withDiagnostics([], { thirdParty: tp({ name: malicious, matchedName: null }) }));

      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain(malicious);
      expect(el.querySelector('img')).toBeNull();
    });
  });

  it('waits for the chart of accounts before computing account controls', async () => {
    const chart$ = new Subject<ChartResponse>();
    chartOfAccounts = () => chart$.asObservable();
    await openReview();

    expect(component.canApply()).toBe(false);
    expect(applyButton().disabled).toBe(true);
    expect(banner()?.textContent).toContain('Chargement du plan comptable');
    expect(component.displayDiagnostics().some(d => d.code === 'AccountMissing')).toBe(false);

    chart$.next({ success: true, data: [CHART_WITH_4011[0]] });
    chart$.complete();
    fixture.detectChanges();

    expect(component.displayDiagnostics().some(d => d.code === 'AccountMissing')).toBe(true);
    expect(component.canApply()).toBe(false);
    expect(applyButton().disabled).toBe(true);
    expect(diagnosticTexts().some(t => t.startsWith('Ligne 2 — '))).toBe(true);
  });

  it('keeps server account controls when the chart of accounts fails to load', async () => {
    chartOfAccounts = () => throwError(() => new Error('réseau'));
    await openReview(withDiagnostics([
      { severity: 'blocking', code: 'AccountMissing', message: 'Compte 4011 absent (serveur)', relatedLineIndex: 1 }
    ]));

    expect(banner()?.textContent).toContain("Le plan comptable n'a pas pu être chargé");
    const accountDiagnostics = component.displayDiagnostics().filter(d => d.code === 'AccountMissing');
    expect(accountDiagnostics.length).toBe(1);
    expect(accountDiagnostics[0].message).toBe('Compte 4011 absent (serveur)');
    expect(component.canApply()).toBe(false);
  });

  it('allows applying an unbalanced entry after confirmation', async () => {
    const confirmSpy = spyOn(TestBed.inject(ConfirmationService), 'confirm');
    const emitted: { proposal: JournalEntryProposal; file: File }[] = [];
    component.applied.subscribe(e => emitted.push(e));
    const visibleChanges: boolean[] = [];
    component.visibleChange.subscribe(v => visibleChanges.push(v));
    await openReview();

    editorStore().updateLine(0, { debit: 90 });
    fixture.detectChanges();

    expect(component.canApply()).toBe(true);
    expect(applyButton().disabled).toBe(false);
    expect(banner()?.getAttribute('data-banner')).toBe('unbalanced');
    // Séparateur décimal selon la locale de test (pas de LOCALE_ID fr sous Karma).
    expect(banner()?.textContent).toMatch(/écart 10[.,]000 TND/);
    expect(host().querySelector('.adi-lines__summary')?.textContent).toMatch(/-10[.,]000 TND/);

    applyButton().click();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(emitted.length).toBe(0);
    const options = confirmSpy.calls.mostRecent().args[0];
    expect(options.header).toBe('Écriture non équilibrée');
    expect(options.acceptLabel).toBe('Appliquer quand même');
    expect(options.rejectLabel).toBe('Revenir aux lignes');

    options.accept!();
    expect(emitted.length).toBe(1);
    expect(emitted[0].proposal.totalDebit).toBe(90);
    expect(emitted[0].proposal.totalCredit).toBe(100);
    expect(visibleChanges).toContain(false);
  });

  it('applies a balanced entry without confirmation', async () => {
    const confirmSpy = spyOn(TestBed.inject(ConfirmationService), 'confirm');
    const emitted: { proposal: JournalEntryProposal; file: File }[] = [];
    component.applied.subscribe(e => emitted.push(e));
    await openReview();

    expect(banner()).toBeNull();
    applyButton().click();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(emitted.length).toBe(1);
  });

  it('applies the edited lines, including an added line', async () => {
    spyOn(TestBed.inject(ConfirmationService), 'confirm').and.callFake(o => o.accept?.());
    const emitted: { proposal: JournalEntryProposal; file: File }[] = [];
    component.applied.subscribe(e => emitted.push(e));
    await openReview();

    const store = editorStore();
    store.updateLine(0, { lineLabel: 'Achat modifié' });
    store.addLine();
    store.updateLine(2, { accountNumber: '607', debit: 10 });
    fixture.detectChanges();

    component.apply();
    expect(emitted.length).toBe(1);
    const lines = emitted[0].proposal.lines;
    expect(lines.length).toBe(3);
    expect(lines[0].label).toBe('Achat modifié');
    expect(lines[2]).toEqual(jasmine.objectContaining({ accountNumber: '607', debit: 10, role: 'expense' }));
  });

  it('disables apply when no line is usable', async () => {
    await openReview();
    const store = editorStore();
    store.updateLine(0, { accountNumber: '', debit: null });
    store.updateLine(1, { accountNumber: '', credit: null });
    fixture.detectChanges();

    expect(component.canApply()).toBe(false);
    expect(applyButton().disabled).toBe(true);
    expect(banner()?.textContent).toContain('Aucune ligne exploitable');
  });

  it('asks confirmation for a single line entry', async () => {
    const confirmSpy = spyOn(TestBed.inject(ConfirmationService), 'confirm');
    await openReview();
    editorStore().updateLine(1, { accountNumber: '', credit: null });
    fixture.detectChanges();

    expect(component.canApply()).toBe(true);
    expect(banner()?.getAttribute('data-banner')).toBe('singleLine');
    component.apply();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy.calls.mostRecent().args[0].header).toBe('Écriture incomplète');
  });

  it('keeps a server blocking control (AlreadyPosted) even after an edit', async () => {
    await openReview(withDiagnostics([
      { severity: 'blocking', code: 'AlreadyPosted', message: 'Pièce déjà comptabilisée', relatedLineIndex: null }
    ]));
    editorStore().updateLine(0, { lineLabel: 'Autre' });
    fixture.detectChanges();

    expect(component.canApply()).toBe(false);
    expect(applyButton().disabled).toBe(true);
    expect(diagnosticTexts()).toContain('Pièce déjà comptabilisée');
    expect(banner()?.getAttribute('data-banner')).toBe('blocking');
    expect(banner()?.textContent).toContain('Contrôles bloquants à corriger : 1.');

    const card = host().querySelector('.adi-diagnostics-card') as HTMLElement;
    (banner()!.querySelector('button') as HTMLButtonElement).click();
    expect(document.activeElement).toBe(card);
  });

  it('blocks on a missing entry date until the user enters one', async () => {
    await openReview(withDiagnostics(
      [{ severity: 'blocking', code: 'MissingIssueDate', message: 'Date absente (serveur)', relatedLineIndex: null }],
      { entryDate: null }
    ));
    const store = editorStore();
    expect(store.entryDate()).toBe('');
    expect(component.displayDiagnostics().some(d => d.code === 'MissingIssueDate')).toBe(true);
    expect(component.canApply()).toBe(false);

    store.entryDate.set('2026-10-01');
    fixture.detectChanges();
    expect(component.displayDiagnostics().some(d => d.code === 'MissingIssueDate')).toBe(false);
    expect(component.canApply()).toBe(true);
  });

  it('marks the lines busy during a new analysis and refreshes controls afterwards', async () => {
    await openReview();
    const pending = new Subject<JournalEntryProposal>();
    proposeSpy.and.returnValue(pending.asObservable());

    component.changeDirection('SALE');
    fixture.detectChanges();
    const lines = host().querySelector('.adi-lines') as HTMLElement;
    expect(component.canApply()).toBe(false);
    expect(lines.getAttribute('aria-busy')).toBe('true');
    expect(host().querySelector('.adi-lines__editor')?.hasAttribute('inert')).toBe(true);
    expect(banner()?.getAttribute('data-banner')).toBe('reanalyzing');

    pending.next(withDiagnostics(
      [{ severity: 'blocking', code: 'AlreadyPosted', message: 'Pièce déjà comptabilisée', relatedLineIndex: null }],
      { direction: 'SALE', journalCode: 'JV' }
    ));
    fixture.detectChanges();
    expect(lines.getAttribute('aria-busy')).toBeNull();
    expect(diagnosticTexts()).toContain('Pièce déjà comptabilisée');
    expect(editorStore().journalCode()).toBe('JV');
  });

  it('confirms before choosing another file when lines were edited', async () => {
    const confirmSpy = spyOn(TestBed.inject(ConfirmationService), 'confirm');
    await openReview();
    const chooseSpy = spyOn(component, 'chooseFile');

    component.chooseAnotherFile();
    expect(chooseSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).not.toHaveBeenCalled();

    editorStore().updateLine(0, { lineLabel: 'Modifié' });
    fixture.detectChanges();
    component.chooseAnotherFile();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(chooseSpy).toHaveBeenCalledTimes(1);
  });

  it('confirms before closing (cross or Escape) when lines were edited', async () => {
    const confirmSpy = spyOn(TestBed.inject(ConfirmationService), 'confirm');
    const visibleChanges: boolean[] = [];
    component.visibleChange.subscribe(v => visibleChanges.push(v));
    await openReview();
    editorStore().updateLine(0, { lineLabel: 'Modifié' });
    fixture.detectChanges();

    component.onDialogVisibleChange(false);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(component.visible).toBe(true);
    expect(visibleChanges).toEqual([]);

    // Une seconde demande pendant la confirmation (Échap dans la confirmation) est ignorée.
    component.onDialogVisibleChange(false);
    expect(confirmSpy).toHaveBeenCalledTimes(1);

    confirmSpy.calls.mostRecent().args[0].accept!();
    expect(component.visible).toBe(false);
    expect(visibleChanges).toContain(false);
  });

  it('closes directly when nothing was edited', async () => {
    const confirmSpy = spyOn(TestBed.inject(ConfirmationService), 'confirm');
    await openReview();
    component.onDialogVisibleChange(false);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(component.visible).toBe(false);
    expect(component.phase()).toBe('idle');
  });

  it('ignores the close request of an Escape that closes an open dropdown', async () => {
    const confirmSpy = spyOn(TestBed.inject(ConfirmationService), 'confirm');
    await openReview();
    const host = fixture.nativeElement as HTMLElement;
    const combo = document.createElement('input');
    combo.setAttribute('aria-expanded', 'true');
    host.appendChild(combo);
    jasmine.clock().install();
    try {
      combo.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      component.onDialogVisibleChange(false);
      expect(component.visible).toBe(true);
      expect(confirmSpy).not.toHaveBeenCalled();

      jasmine.clock().tick(1);
      combo.setAttribute('aria-expanded', 'false');
      combo.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      component.onDialogVisibleChange(false);
      expect(component.visible).toBe(false);
    } finally {
      jasmine.clock().uninstall();
      combo.remove();
    }
  });

  it('removes the Escape capture listener on destroy', () => {
    const removeSpy = spyOn(document, 'removeEventListener').and.callThrough();
    fixture.destroy();
    expect(removeSpy).toHaveBeenCalledWith('keydown', jasmine.any(Function), true);
  });

  it('prefixes client line controls with the grid row number', async () => {
    await openReview();
    const store = editorStore();
    store.setLines([
      { ...createEmptyLine(), accountNumber: '607', debit: 100 },
      createEmptyLine(),
      { ...createEmptyLine(), accountNumber: '999', credit: 100 }
    ]);
    fixture.detectChanges();

    expect(diagnosticTexts()).toContain('Ligne 3 — Le compte 999 est absent du plan comptable.');
  });

  it('uses prefixed ids inside the dialog', async () => {
    await openReview();
    expect(host().querySelector('#ipe-eh-label')).not.toBeNull();
    expect(host().querySelector('#ipe-lines-title')).not.toBeNull();
    expect(host().querySelector('#eh-label')).toBeNull();
    expect(host().querySelector('#lines-title')).toBeNull();
    expect(host().querySelector('label[for="ipe-eh-date"]')).not.toBeNull();
  });
});

function pdfFile(): File {
  return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])], 'facture.pdf', {
    type: 'application/pdf'
  });
}

function fileEvent(file: File | undefined): Event {
  return { target: { files: file ? [file] : [], value: 'x' } } as unknown as Event;
}
