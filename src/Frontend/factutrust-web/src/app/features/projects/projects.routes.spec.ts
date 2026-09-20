import { PROJECTS_ROUTES } from './projects.routes';

describe('projects.routes', () => {
  it('registers dashboard and time before the :id wildcard', () => {
    expect(PROJECTS_ROUTES.map(r => r.path)).toEqual([
      'dashboard',
      '',
      'time',
      ':id',
      ':id/tasks/:taskId'
    ]);
  });

  it('exposes native FactuTrust screens including dashboard', () => {
    // Les routes de pure redirection (ex. « time » → /timesheets) n'ont pas de composant par nature.
    expect(PROJECTS_ROUTES.filter(r => !r.redirectTo).every(r => r.loadComponent)).toBe(true);
  });
});
