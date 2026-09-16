import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { ProjectDetail, ProjectTask } from '../project-api.service';
import { ProjectTasksTabComponent } from './project-tasks.tab';

describe('ProjectTasksTabComponent', () => {
  let fixture: ComponentFixture<ProjectTasksTabComponent>;
  let component: ProjectTasksTabComponent;

  const sampleTask: ProjectTask = {
    id: 't1',
    projectId: 'p1',
    phaseId: 'ph1',
    phaseName: 'À faire',
    title: 'Rédiger la proposition',
    status: 'Todo',
    statusDisplay: 'À faire',
    priority: 'Normal',
    priorityDisplay: 'Normale',
    progressPercent: 0,
    estimatedHours: 8,
    loggedHours: 1,
    isOverdue: false
  };

  function sampleProject(status: ProjectDetail['status']): ProjectDetail {
    return {
      id: 'p1',
      name: 'Projet test',
      clientId: 'c1',
      clientName: 'Client',
      kind: 'Generic',
      kindDisplay: 'Général',
      billingMode: 'None',
      billingModeDisplay: 'Aucune',
      status,
      statusDisplay: String(status),
      budgetHt: 0,
      currency: 'EUR',
      timesheetsEnabled: true,
      milestonesEnabled: false,
      allocatedHours: 0,
      phases: [{ id: 'ph1', name: 'À faire', sortOrder: 0 }]
    };
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProjectTasksTabComponent],
      providers: [provideRouter([]), provideNoopAnimations()]
    }).compileComponents();

    fixture = TestBed.createComponent(ProjectTasksTabComponent);
    component = fixture.componentInstance;
    component.tasks = [sampleTask];
    component.project = sampleProject('Active');
    component.canCreateTime = true;
    fixture.detectChanges();
  });

  it('shows Play and kebab when time logging is allowed', () => {
    const play = fixture.nativeElement.querySelector('button[aria-label="Saisir du temps"]');
    const menu = fixture.nativeElement.querySelector('button[aria-label="Actions"]');
    expect(play).not.toBeNull();
    expect(menu).not.toBeNull();
  });

  it('hides Play but keeps kebab when the project cannot receive time', () => {
    component.project = sampleProject('Draft');
    fixture.detectChanges();

    const play = fixture.nativeElement.querySelector('button[aria-label="Saisir du temps"]');
    const menu = fixture.nativeElement.querySelector('button[aria-label="Actions"]');
    expect(play).toBeNull();
    expect(menu).not.toBeNull();
  });

  it('does not emit logTime when hours are outside 0–24', () => {
    component.openLogTime(sampleTask);
    component.logHours = 0;
    const spy = spyOn(component.logTime, 'emit');
    component.submitLogTime();
    expect(spy).not.toHaveBeenCalled();
    expect(component.logTimeVisible).toBe(true);

    component.logHours = 25;
    component.submitLogTime();
    expect(spy).not.toHaveBeenCalled();
  });

  it('emits logTime payload and closes the dialog for a valid entry', () => {
    component.openLogTime(sampleTask);
    component.logHours = 1.5;
    component.logBillable = false;
    component.logNotes = 'Atelier';
    const spy = spyOn(component.logTime, 'emit');

    component.submitLogTime();

    expect(spy).toHaveBeenCalledWith(jasmine.objectContaining({
      projectId: 'p1',
      taskId: 't1',
      hours: 1.5,
      isBillable: false,
      notes: 'Atelier'
    }));
    expect(component.logTimeVisible).toBe(false);
  });

  it('renders the log-time dialog with the create-task field layout', () => {
    component.openLogTime(sampleTask);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.task-create-form')).not.toBeNull();
    expect(root.querySelector('#log-time-date, label[for="log-time-date"]')).not.toBeNull();
    expect(root.querySelector('label[for="log-time-hours"]')).not.toBeNull();
  });
});
