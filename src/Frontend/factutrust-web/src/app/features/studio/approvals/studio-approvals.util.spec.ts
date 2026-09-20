import { approvalKpis, dueLabel, dueState, toApprovalRow } from './studio-approvals.util';
import type { WorkflowApprovalInboxItemDto } from '../workflows/studio-workflows.models';

const NOW = Date.parse('2026-09-17T12:00:00Z');

/** Item de boîte de réception au format H-1 (forme imbriquée). */
function inboxItem(over: { title?: string; dueAt?: string | null; startedByName?: string | null } = {}): WorkflowApprovalInboxItemDto {
  return {
    approval: {
      id: 'a1', instanceId: 'i1', stepKey: 'approval_1', title: over.title ?? 'Valider le devis',
      message: 'Merci de relire', status: 'pending', assigneeUserId: null, assigneeRole: 'Administrator',
      decidedBy: null, decidedAt: null, comment: null, dueAt: over.dueAt ?? null,
      createdAt: '2026-09-17T08:00:00Z', rowVersion: 'v1'
    },
    instanceId: 'i1', workflowKey: 'validation_devis', workflowName: 'Validation devis',
    entityKey: 'devis', entityName: 'Devis', recordId: 'r1', recordLabel: 'DEV-001',
    startedBy: null, startedAt: '2026-09-16T09:00:00Z', startedByName: over.startedByName
  };
}

describe('studio-approvals.util', () => {
  it('recopie startedByName et remplace une valeur absente par null', () => {
    expect(toApprovalRow(inboxItem({ startedByName: 'Alice Martin' })).startedByName).toBe('Alice Martin');
    expect(toApprovalRow(inboxItem({ startedByName: null })).startedByName).toBeNull();
    expect(toApprovalRow(inboxItem()).startedByName).toBeNull();   // champ absent (backend antérieur à 4.5a2)
  });

  it('aplatit un item de la boîte en ligne (toApprovalRow) avec repli sur stepKey', () => {
    const row = toApprovalRow(inboxItem({ title: '' }));
    expect(row.id).toBe('a1');                       // identifiant de décision = approval.id
    expect(row.stepTitle).toBe('approval_1');        // titre vide ⇒ repli sur la clé d'étape
    expect(row.workflowName).toBe('Validation devis');
    expect(row.recordLabel).toBe('DEV-001');
    expect(row.startedAt).toBe('2026-09-16T09:00:00Z');
    expect(row.rowVersion).toBe('v1');

    const titled = toApprovalRow(inboxItem({ title: '  Valider le devis  ' }));
    expect(titled.stepTitle).toBe('Valider le devis');
  });

  it('classe une échéance passée en retard et une échéance à moins de 24 h en « Sous 24 h »', () => {
    expect(dueState(new Date(NOW - 3_600_000).toISOString(), NOW)).toBe('late');
    expect(dueState(new Date(NOW + 2 * 3_600_000).toISOString(), NOW)).toBe('soon');
    expect(dueState(new Date(NOW + 24 * 3_600_000).toISOString(), NOW)).toBe('soon');   // borne ≤ 24 h incluse
    expect(dueState(new Date(NOW + 3 * 86_400_000).toISOString(), NOW)).toBe('later');
    expect(dueState(null, NOW)).toBe('none');
    expect(dueState('pas-une-date', NOW)).toBe('none');
  });

  it("formate le libellé d'échéance en heures ou en jours", () => {
    expect(dueLabel(new Date(NOW + 5 * 3_600_000).toISOString(), NOW)).toBe('Dans 5 h');
    expect(dueLabel(new Date(NOW + 3 * 86_400_000).toISOString(), NOW)).toBe('Dans 3 j');
    expect(dueLabel(new Date(NOW - 2 * 86_400_000).toISOString(), NOW)).toBe('En retard de 2 j');
    expect(dueLabel(new Date(NOW - 30 * 60_000).toISOString(), NOW)).toBe('En retard de 1 h'); // jamais « 0 h »
    expect(dueLabel(null, NOW)).toBe('—');
  });

  it('calcule les trois KPI et ignore les échéances absentes', () => {
    const rows = [
      toApprovalRow(inboxItem({ dueAt: new Date(NOW - 3_600_000).toISOString() })),   // en retard
      toApprovalRow(inboxItem({ dueAt: new Date(NOW + 2 * 3_600_000).toISOString() })), // sous 24 h
      toApprovalRow(inboxItem({ dueAt: new Date(NOW + 3 * 86_400_000).toISOString() })), // plus tard
      toApprovalRow(inboxItem({ dueAt: null }))                                          // sans échéance
    ];
    expect(approvalKpis(rows, NOW)).toEqual({ pending: 4, late: 1, soon: 1 });
    expect(approvalKpis([], NOW)).toEqual({ pending: 0, late: 0, soon: 0 });
  });
});
