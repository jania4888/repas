import { Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { environment } from '@environments/environment';
import { AuthService } from '@core/services/auth.service';
import { STUDIO_WORKFLOW_LABELS } from '../studio-workflow-labels';
import { WorkflowRecipient } from '../studio-workflows.models';
import { StudioAssigneePickerComponent } from './studio-assignee-picker.component';

@Component({
  standalone: true,
  imports: [StudioAssigneePickerComponent],
  template: `<app-studio-assignee-picker [(value)]="value" [allowStartedBy]="allowStartedBy" />`
})
class TestHostComponent {
  value: WorkflowRecipient | null = null;
  allowStartedBy = false;
}

/** Accès typé aux membres protected du picker (sondage uniquement). */
interface PickerProbe {
  kindOptions(): { label: string; value: string }[];
  roleOptions: { label: string; value: string }[];
  userOptions(): { label: string; value: string }[];
  setKind(kind: WorkflowRecipient['kind']): void;
}

describe('StudioAssigneePickerComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let host: TestHostComponent;
  let picker: StudioAssigneePickerComponent;
  let probe: PickerProbe;
  let httpMock: HttpTestingController;
  let admin: WritableSignal<boolean>;

  beforeEach(async () => {
    admin = signal(true);
    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
      providers: [
        provideNoopAnimations(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { isAdmin: admin } }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(TestHostComponent);
    host = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    picker = fixture.debugElement.query(By.directive(StudioAssigneePickerComponent)).componentInstance;
    probe = picker as unknown as PickerProbe;
    fixture.detectChanges();
  });

  afterEach(() => httpMock.verify());

  it('charge la liste des utilisateurs (GET tenant-users) quand kind = user et admin', () => {
    host.value = { kind: 'user', value: null };
    fixture.detectChanges();
    fixture.detectChanges();   // effect de chargement après mise à jour du model

    const req = httpMock.expectOne(`${environment.apiUrl}/tenant-users`);
    expect(req.request.method).toBe('GET');
    req.flush({
      success: true,
      data: [
        { id: 'u1', email: 'ada@x.fr', firstName: 'Ada', lastName: 'Lovelace', role: 'Administrator', roleDisplay: '', isActive: true, lastLoginAt: null, enabledModuleIds: [] },
        { id: 'u2', email: 'bob@x.fr', firstName: 'Bob', lastName: 'Inactif', role: 'Client', roleDisplay: '', isActive: false, lastLoginAt: null, enabledModuleIds: [] }
      ]
    });
    fixture.detectChanges();

    expect(probe.userOptions()).toEqual([{ label: 'Ada Lovelace (ada@x.fr)', value: 'u1' }]);   // inactif exclu
  });

  it('propose startedBy seulement si allowStartedBy', () => {
    expect(probe.kindOptions().map(o => o.value)).toEqual(['user', 'role']);

    host.allowStartedBy = true;
    fixture.detectChanges();

    expect(probe.kindOptions().map(o => o.value)).toEqual(['user', 'role', 'startedBy']);
    expect(probe.roleOptions.length).toBe(11);   // D-44-13 : 11 rôles tenant, rôles cabinet exclus
    expect(probe.roleOptions.map(o => o.value)).toEqual(Object.keys(STUDIO_WORKFLOW_LABELS.roles));

    // Variante non administrateur (D-44-16) : kind = user ⇒ saisie du Guid, aucun appel HTTP.
    admin.set(false);
    host.value = { kind: 'user', value: null };
    fixture.detectChanges();
    fixture.detectChanges();

    httpMock.expectNone(`${environment.apiUrl}/tenant-users`);
    const guid = fixture.debugElement.query(By.css('[data-testid="assignee-user-id"]'));
    expect(guid).not.toBeNull();
    expect(fixture.debugElement.query(By.css('[data-testid="assignee-user"]'))).toBeNull();
  });
});
