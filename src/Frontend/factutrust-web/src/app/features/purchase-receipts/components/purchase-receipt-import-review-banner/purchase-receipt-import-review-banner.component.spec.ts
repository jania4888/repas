import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PurchaseReceiptImportReviewBannerComponent } from './purchase-receipt-import-review-banner.component';

describe('PurchaseReceiptImportReviewBannerComponent', () => {
  let fixture: ComponentFixture<PurchaseReceiptImportReviewBannerComponent>;
  let component: PurchaseReceiptImportReviewBannerComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PurchaseReceiptImportReviewBannerComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(PurchaseReceiptImportReviewBannerComponent);
    component = fixture.componentInstance;
  });

  it('n’affiche pas de bloc document source sans nom de fichier', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.pirb-srcdoc')).toBeNull();
  });

  it('affiche le nom du fichier source et la note de pièce jointe', () => {
    component.sourceFileName = 'bl-2026-12.pdf';
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('bl-2026-12.pdf');
    expect(text).toContain("Sera joint au bon à l'enregistrement");
  });

  it('traduit le moteur docstrange en libellé générique, sans nom commercial', () => {
    component.sourceFileName = 'bl.pdf';
    component.extractionProvider = 'docstrange';
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain("Service d'extraction documentaire");
    // Le nom commercial du moteur ne s'affiche jamais (libellé générique uniquement).
    expect(text.toLowerCase()).not.toContain('docstrange');
  });

  it('traduit les moteurs llm en « Modèle d’import IA » et n’affiche rien pour une lecture native', () => {
    component.sourceFileName = 'bl.pdf';
    component.extractionProvider = 'llm-vision';
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain("Modèle d'import IA");

    component.extractionProvider = 'native-pdf';
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain("Modèle d'import IA");
    expect(fixture.nativeElement.querySelector('.pirb-srcdoc__engine')).toBeNull();
  });
});
