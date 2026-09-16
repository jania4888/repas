import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ProjectSettingsTabComponent } from './project-settings.tab';

import { ProjectDetail } from '../project-api.service';



describe('ProjectSettingsTabComponent', () => {

  let fixture: ComponentFixture<ProjectSettingsTabComponent>;

  let component: ProjectSettingsTabComponent;



  const esnProject: ProjectDetail = {

    id: 'p1',

    name: 'Mission Alpha',

    clientId: 'c1',

    clientName: 'Client SA',

    kind: 'Esn',

    kindDisplay: 'ESN / Services',

    billingMode: 'TimeAndMaterials',

    billingModeDisplay: 'Régie (temps)',

    status: 'Active',

    statusDisplay: 'Actif',

    budgetHt: 10000,

    currency: 'TND',

    timesheetsEnabled: true,

    milestonesEnabled: false,

    allocatedHours: 120,

    phases: []

  };



  const btpProject: ProjectDetail = {

    ...esnProject,

    kind: 'Btp',

    kindDisplay: 'BTP / Chantier',

    billingMode: 'ProgressSituations',

    billingModeDisplay: 'Situations de travaux',

    milestonesEnabled: true

  };



  beforeEach(async () => {

    await TestBed.configureTestingModule({

      imports: [ProjectSettingsTabComponent]

    }).compileComponents();



    fixture = TestBed.createComponent(ProjectSettingsTabComponent);

    component = fixture.componentInstance;

  });



  it('shows milestones option for ESN projects', () => {

    component.project = esnProject;

    component.ngOnChanges({ project: { currentValue: esnProject, previousValue: null, firstChange: true, isFirstChange: () => true } });

    fixture.detectChanges();



    expect(fixture.nativeElement.querySelector('#settingsMilestones')).not.toBeNull();

  });



  it('shows milestones option for BTP projects', () => {

    component.project = btpProject;

    component.ngOnChanges({ project: { currentValue: btpProject, previousValue: null, firstChange: true, isFirstChange: () => true } });

    fixture.detectChanges();



    expect(fixture.nativeElement.querySelector('#settingsMilestones')).not.toBeNull();

  });



  it('emits save with updated settings payload', () => {

    component.project = esnProject;

    component.canUpdate = true;

    component.ngOnChanges({ project: { currentValue: esnProject, previousValue: null, firstChange: true, isFirstChange: () => true } });

    fixture.detectChanges();



    component.settingsDraft.milestonesEnabled = true;

    component.settingsDraft.allocatedHours = 200;



    const spy = spyOn(component.save, 'emit');

    component.onSave();



    expect(spy).toHaveBeenCalledWith({

      billingMode: 'TimeAndMaterials',

      timesheetsEnabled: true,

      milestonesEnabled: true,

      allocatedHours: 200

    });

  });



  it('hides save button and shows readonly message when canUpdate is false', () => {

    component.project = esnProject;

    component.canUpdate = false;

    component.ngOnChanges({ project: { currentValue: esnProject, previousValue: null, firstChange: true, isFirstChange: () => true } });

    fixture.detectChanges();



    expect(fixture.nativeElement.querySelector('app-button')).toBeNull();

    expect(fixture.nativeElement.textContent).toContain("Vous n'avez pas la permission");

  });



  it('disables save button when there are no changes', () => {

    component.project = esnProject;

    component.canUpdate = true;

    component.ngOnChanges({ project: { currentValue: esnProject, previousValue: null, firstChange: true, isFirstChange: () => true } });

    fixture.detectChanges();



    expect(component.hasChanges()).toBeFalse();

  });

});


