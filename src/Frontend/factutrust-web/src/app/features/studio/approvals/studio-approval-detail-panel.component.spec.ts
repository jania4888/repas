import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { StudioApprovalDetailPanelComponent } from './studio-approval-detail-panel.component';
import { ApprovalRow, toApprovalRow } from './studio-approvals.util';
import { STUDIO_WORKFLOW_LABELS } from '../workflows/studio-workflow-labels';
import type { WorkflowApprovalInboxItemDto } from '../workflows/studio-workflows.models';

const labels = STUDIO_WORKFLOW_LABELS.approvals;

/** Item de boîte de réception au format H-1 (même forme que la spec de la page, 4.4g2) ; `startedByName` optionnel (4.5a2). */
function inboxItem(startedByName?: string | null): WorkflowApprovalInboxItemDto {
  return {
    approval: {
      id: 'a1', instanceId: 'i1', stepKey: 'approval_1', title: 'Valider le devis', status: 'pending',
      dueAt: '2026-09-17T12:00:00Z', createdAt: '2026-09-17T08:00:00Z', comment: null, message: 'Merci de relire',
      assigneeUserId: null, assigneeRole: 'Administrator', decidedBy: null, decidedAt: null, rowVersion: 'v1'
    },
    instanceId: 'i1', workflowKey: 'validation_devis', workflowName: 'Validation devis',
    entityKey: 'devis', entityName: 'Devis', recordId: 'r1', recordLabel: 'DEV-001',
    startedBy: null, startedAt: '2026-09-16T09:00:00Z', startedByName
  };
}

/** Clic sur un p-button hôte (bouton interne). */
function click(host: HTMLElement | null): void {
  expect(host).withContext('bouton présent').not.toBeNull();
  ((host!.querySelector('button') as HTMLElement | null) ?? host!).click();
}

describe('StudioApprovalDetailPanelComponent', () => {
  let fixture: ComponentFixture<StudioApprovalDetailPanelComponent>;
  let row: ApprovalRow;

  function setup(inputs: { canDecide?: boolean; busy?: boolean; startedByName?: string | null } = {}): void {
    TestBed.configureTestingModule({
      imports: [StudioApprovalDetailPanelComponent],
      providers: [provideNoopAnimations()]
    });
    fixture = TestBed.createComponent(StudioApprovalDetailPanelComponent);
    row = toApprovalRow(inboxItem(inputs.startedByName));
    fixture.componentRef.setInput('item', row);
    fixture.componentRef.setInput('canDecide', inputs.canDecide ?? false);
    fixture.componentRef.setInput('busy', inputs.busy ?? false);
    fixture.componentRef.setInput('nowMs', Date.parse('2026-09-17T10:00:00Z'));
    fixture.detectChanges();
  }

  it('affiche les données de la demande, son statut traduit (p-tag) et son échéance', () => {
    setup({ canDecide: true });
    const el = fixture.nativeElement as HTMLElement;
    const text = el.textContent ?? '';

    const status = el.querySelector('p-tag[data-status="pending"]') as HTMLElement;
    expect(status).not.toBeNull();
    expect(status.textContent).toContain('En attente');                       // approvalStatus.pending (4.4a1)

    expect(text).toContain('Validation devis');
    expect(text).toContain('Valider le devis');
    expect(text).toContain('DEV-001');
    expect(text).toContain('(Devis)');
    expect(text).toContain(labels.startedAt);                                 // « Lancé le »
    expect(text).toContain('16/09/2026 09:00');
    expect(text).toContain(labels.requestedAt);                               // « Demandé le »
    expect(text).toContain('17/09/2026 08:00');
    expect(text).toContain(labels.requestComment);                            // « Message du demandeur »
    expect(text).toContain('Merci de relire');

    const facts = Array.from(el.querySelectorAll('.sapd__facts dd'));
    const due = facts.map(d => d.textContent ?? '').find(t => t.includes('Dans'));
    expect(due).withContext('échéance « Dans 2 h »').toContain('Dans 2 h');   // nowMs 10:00 ⇒ dueAt 12:00
  });

  it('masque les boutons de décision et affiche la note lecture seule sans canDecide', () => {
    setup();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('.sapd__actions')).toBeNull();
    const note = el.querySelector('.sap-readonly[role="note"]') as HTMLElement;
    expect(note).not.toBeNull();
    expect(note.textContent).toContain(labels.readOnly);
  });

  it('émet approve et reject avec la ligne', () => {
    setup({ canDecide: true });
    const el = fixture.nativeElement as HTMLElement;
    const component = fixture.componentInstance;
    let approved: ApprovalRow | undefined;
    let rejected: ApprovalRow | undefined;
    component.approve.subscribe(r => (approved = r));
    component.reject.subscribe(r => (rejected = r));

    const buttons = Array.from(el.querySelectorAll<HTMLElement>('.sapd__actions p-button'));
    click(buttons.find(b => (b.textContent ?? '').includes(labels.approve)) ?? null);
    expect(approved).toBe(row);
    click(buttons.find(b => (b.textContent ?? '').includes(labels.reject)) ?? null);
    expect(rejected).toBe(row);
  });

  it('affiche « Demandé par » avec le nom du demandeur ou —', () => {
    setup({ startedByName: 'Alice Martin' });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain(labels.requestedBy);                       // « Demandé par »
    expect(el.querySelector('[data-testid="sapd-requested-by"]')?.textContent?.trim()).toBe('Alice Martin');

    fixture.componentRef.setInput('item', toApprovalRow(inboxItem(null)));
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="sapd-requested-by"]')?.textContent?.trim()).toBe('—');
  });

  it("affiche Voir l'instance pour tout lecteur et émet l'identifiant d'instance", () => {
    setup();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="sapd-instance"]')).withContext('bouton rendu sans studio:design_entities (4.5d3)').not.toBeNull();

    let emitted: string | undefined;
    fixture.componentInstance.openInstance.subscribe(id => (emitted = id));
    click(el.querySelector('[data-testid="sapd-instance"]') as HTMLElement);
    expect(emitted).toBe('i1');
  });
});
