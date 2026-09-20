import { Route } from '@angular/router';
import { StudioShellComponent } from './shared/studio-shell.component';
import { permissionGuard } from '@core/guards/permission.guard';
import { PERMISSIONS } from '@core/config/permission-keys';
import { STUDIO_CHILD_ROUTES, STUDIO_ROUTES } from './studio.routes';
import { approvalsAccessGuard } from './approvals/approvals-access.guard';

describe('STUDIO_ROUTES', () => {
  const shell = STUDIO_ROUTES[0];
  const child = (path: string): Route => {
    const found = STUDIO_CHILD_ROUTES.find(r => r.path === path);
    if (!found) throw new Error(`route ${path} introuvable`);
    return found;
  };

  it('enveloppe toutes les pages Studio dans StudioShellComponent (thème indigo D2)', () => {
    expect(STUDIO_ROUTES.length).toBe(1);
    expect(shell.path).toBe('');
    expect(shell.component).toBe(StudioShellComponent);
    expect(shell.children).toBe(STUDIO_CHILD_ROUTES);
    expect(STUDIO_CHILD_ROUTES.length).toBeGreaterThan(10);
  });

  it('protège chaque page par permissionGuard (premier de la liste) avec une liste de permissions non vide (V4)', () => {
    for (const r of STUDIO_CHILD_ROUTES) {
      expect(r.canActivate?.length).withContext(r.path ?? '').toBeGreaterThanOrEqual(1);
      expect(r.canActivate?.[0]).withContext(r.path ?? '').toBe(permissionGuard);
      expect(Array.isArray(r.data?.['permissions'])).withContext(r.path ?? '').toBeTrue();
      expect((r.data?.['permissions'] as string[]).length).withContext(r.path ?? '').toBeGreaterThanOrEqual(1);
      // Mode « toutes les permissions » uniquement : en mode 'any', une liste mixte s'ouvrirait au lecteur (revue 4.5i★).
      expect(r.data?.['permissionMode']).withContext(r.path ?? '').not.toBe('any');
    }
  });

  it("n'ouvre au lecteur (custom_records:read seul) que les cinq pages d'exécution prévues (4.5d1, D-45-12 ; fiche /view en 4.7 suite, D-47-94)", () => {
    // La policy de module `studio` accepte custom_records:read depuis 4.5d1 : toute nouvelle route Studio
    // doit donc porter une permission de conception, sinon elle s'ouvrirait aux lecteurs.
    const readerOnly = STUDIO_CHILD_ROUTES
      .filter(r => (r.data?.['permissions'] as string[]).every(p => p === PERMISSIONS.customData.recordsRead))
      .map(r => r.path)
      .sort();
    expect(readerOnly).toEqual(['approvals', 'd/:key', 'd/:key/:id/view', 'records/:key/:id', 'systems/:key']);
  });

  it('déclare ai, ai/projects et ai/templates avant systems/:key (sinon :key capturerait le segment)', () => {
    const paths = STUDIO_CHILD_ROUTES.map(r => r.path);
    const idx = (p: string) => paths.indexOf(p);
    expect(idx('ai')).toBeGreaterThan(-1);
    expect(idx('ai/projects')).toBeGreaterThan(idx('ai'));
    expect(idx('ai/templates')).toBeGreaterThan(idx('ai'));
    expect(idx('ai/projects')).toBeLessThan(idx('systems/:key'));
    expect(idx('ai/templates')).toBeLessThan(idx('systems/:key'));
    expect(idx('ai/templates')).toBeLessThan(idx(':id'));
  });

  it('donne un titre français aux pages du rail', () => {
    expect(child('ai/projects').title).toBe('Mes projets - InstaFact');
    expect(child('ai/templates').title).toBe('Bibliothèque de modèles - InstaFact');
    expect(typeof child('ai/projects').loadComponent).toBe('function');
    expect(typeof child('ai/templates').loadComponent).toBe('function');
  });

  it('déclare d/:key/views/new et d/:key/views/:viewId avant d/:key/:id/edit (sinon `views` serait capturé comme :id)', () => {
    const paths = STUDIO_CHILD_ROUTES.map(r => r.path);
    const idx = (p: string) => paths.indexOf(p);
    expect(idx('d/:key/views/new')).toBeGreaterThan(-1);
    expect(idx('d/:key/views/:viewId')).toBeGreaterThan(-1);
    expect(idx('d/:key/views/new')).toBeLessThan(idx('d/:key/:id/edit'));
    expect(idx('d/:key/views/:viewId')).toBeLessThan(idx('d/:key/:id/edit'));
    // D-47-94 : la fiche en lecture seule `/view` est déclarée après `/edit` (segment littéral,
    // aucune capture possible) et reste réservée à recordsRead (assertion « lecteur » ci-dessus).
    expect(idx('d/:key/:id/view')).toBeGreaterThan(idx('d/:key/:id/edit'));
  });

  it('garde les routes de vues par permissionGuard + capabilityGuard(recordViewsEnabled)', () => {
    for (const path of ['d/:key/views/new', 'd/:key/views/:viewId']) {
      const route = child(path);
      expect(route.canActivate?.length).withContext(path).toBe(2);
      expect(route.canActivate?.[0]).withContext(path).toBe(permissionGuard);
    }
  });

  it('déclare relations avant :id (sinon :id capturerait le segment) et la garde par capabilityGuard(manyToManyEnabled)', () => {
    const paths = STUDIO_CHILD_ROUTES.map(r => r.path);
    const idx = (p: string) => paths.indexOf(p);
    expect(idx('relations')).toBeGreaterThan(-1);
    expect(idx('relations')).toBeLessThan(idx(':id'));
    const relations = child('relations');
    expect(relations.canActivate?.length).toBe(2);
    expect(relations.canActivate?.[0]).toBe(permissionGuard);
  });

  it('déclare workflows et records/:key/:id avant relations et :id, gardés par permissionGuard (+ capabilityGuard pour workflows)', () => {
    const paths = STUDIO_CHILD_ROUTES.map(r => r.path);
    const idx = (p: string) => paths.indexOf(p);
    expect(idx('workflows')).toBeGreaterThan(-1);
    expect(idx('records/:key/:id')).toBeGreaterThan(-1);
    expect(idx('workflows')).toBeLessThan(idx('relations'));
    expect(idx('records/:key/:id')).toBeLessThan(idx('relations'));
    expect(idx('records/:key/:id')).toBeLessThan(idx(':id'));
    const workflows = child('workflows');
    expect(workflows.canActivate?.length).toBe(2);
    expect(workflows.canActivate?.[0]).toBe(permissionGuard);
    expect(workflows.data?.['permissions']).toEqual([PERMISSIONS.studio.designEntities]);
    // 4.4e1 : `workflows/new` avant `workflows/:id` (sinon `new` serait capturé comme identifiant),
    // les deux avant `relations`, mêmes gardes que le hub.
    expect(idx('workflows/new')).toBeGreaterThan(idx('workflows'));
    expect(idx('workflows/new')).toBeLessThan(idx('workflows/:id'));
    expect(idx('workflows/:id')).toBeLessThan(idx('relations'));
    for (const path of ['workflows/new', 'workflows/:id']) {
      const route = child(path);
      expect(route.canActivate?.length).withContext(path).toBe(2);
      expect(route.canActivate?.[0]).withContext(path).toBe(permissionGuard);
      expect(route.data?.['permissions']).withContext(path).toEqual([PERMISSIONS.studio.designEntities]);
      expect(typeof route.loadComponent).withContext(path).toBe('function');
    }
    // Pas de capabilityGuard sur la redirection : les liens de notification doivent fonctionner
    // même si le flag workflows est coupé ensuite (D6/D-44-19).
    const redirect = child('records/:key/:id');
    expect(redirect.canActivate?.length).toBe(1);
    expect(redirect.canActivate?.[0]).toBe(permissionGuard);
    expect(redirect.data?.['permissions']).toEqual([PERMISSIONS.customData.recordsRead]);
  });

  it('approvals enchaîne permissionGuard puis approvalsAccessGuard et exige custom_records:read (4.4g2)', () => {
    const paths = STUDIO_CHILD_ROUTES.map(r => r.path);
    const idx = (p: string) => paths.indexOf(p);
    expect(idx('approvals')).toBeGreaterThan(-1);
    expect(idx('approvals')).toBeLessThan(idx('relations'));   // après les routes workflows*/records, avant relations
    expect(idx('approvals')).toBeLessThan(idx(':id'));
    const approvals = child('approvals');
    expect(approvals.canActivate?.length).toBe(2);
    expect(approvals.canActivate?.[0]).toBe(permissionGuard);
    expect(approvals.canActivate?.[1]).toBe(approvalsAccessGuard);
    expect(approvals.data?.['permissions']).toEqual([PERMISSIONS.customData.recordsRead]);
    expect(typeof approvals.loadComponent).toBe('function');
    expect(approvals.title).toBe('Mes approbations - InstaFact');
  });
});

