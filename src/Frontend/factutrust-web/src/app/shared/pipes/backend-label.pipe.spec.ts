import { BackendLabelPipe } from './backend-label.pipe';
describe('BackendLabelPipe', () => {
  it('fr identity', () => {
    document.documentElement.setAttribute('lang', 'fr');
    expect(new BackendLabelPipe().transform('X')).toBe('X');
  });
});
