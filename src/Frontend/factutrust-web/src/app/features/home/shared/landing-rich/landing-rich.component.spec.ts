import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LandingRichComponent } from './landing-rich.component';
import type { RichText } from '../../content/landing-copy.types';

@Component({
  standalone: true,
  imports: [LandingRichComponent],
  template: `<p><app-landing-rich [segments]="segments()" /></p>`
})
class HostComponent {
  readonly segments = signal<RichText>([]);
}

describe('LandingRichComponent', () => {
  function render(segments: RichText): HTMLElement {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.segments.set(segments);
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('p') as HTMLElement;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
  });

  it('rend les segments strong / em / ltr dans les bonnes balises', () => {
    const p = render([
      { text: 'Facturez en ' },
      { text: 'dinars', kind: 'strong' },
      { text: ' avec ' },
      { text: 'sérénité', kind: 'em' },
      { text: ' — ' },
      { text: 'TEJ', kind: 'ltr' }
    ]);
    expect(p.querySelector('strong')?.textContent).toBe('dinars');
    expect(p.querySelector('em')?.textContent).toBe('sérénité');
    const ltr = p.querySelector('span.ltr-inline');
    expect(ltr?.getAttribute('dir')).toBe('ltr');
    expect(ltr?.textContent).toBe('TEJ');
    expect(p.textContent?.replace(/\s+/g, ' ').trim()).toBe('Facturez en dinars avec sérénité — TEJ');
  });

  it('affiche littéralement le HTML contenu dans un segment (aucun innerHTML)', () => {
    const p = render([{ text: '<b>brut</b>' }]);
    expect(p.querySelector('b')).toBeNull();
    expect(p.textContent).toContain('<b>brut</b>');
  });

  it('ne rend rien pour une liste vide', () => {
    const p = render([]);
    expect(p.querySelector('app-landing-rich')?.children.length).toBe(0);
    expect(p.textContent?.trim()).toBe('');
  });
});
