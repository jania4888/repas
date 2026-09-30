import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { SalesJournalReportsComponent } from './sales-journal-reports.component';
import { MessageService } from 'primeng/api';

describe('SalesJournalReportsComponent', () => {
  let fixture: ComponentFixture<SalesJournalReportsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SalesJournalReportsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        MessageService
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(SalesJournalReportsComponent);
    fixture.detectChanges();
  });

  it('should create and show journal title', () => {
    expect(fixture.componentInstance).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Journal de ventes');
  });
});
