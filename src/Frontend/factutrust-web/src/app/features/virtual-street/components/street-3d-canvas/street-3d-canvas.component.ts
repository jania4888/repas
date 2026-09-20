import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import type { StreetMapEntry } from '../../services/street-api.service';
import { VirtualStreetScene } from '../../3d/street-scene.runtime';

@Component({
  selector: 'app-street-3d-canvas',
  standalone: true,
  imports: [CommonModule],
  template: `
    <canvas
      #cv
      class="street-canvas"
      role="application"
      [attr.aria-label]="ariaLabel()"
      tabindex="0"
      (keydown)="onCanvasKeydown($event)"></canvas>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
        height: min(70vh, 720px);
      }
      .street-canvas {
        width: 100%;
        height: 100%;
        display: block;
        border-radius: 12px;
        outline: none;
      }
      .street-canvas:focus-visible {
        box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.55);
      }
    `
  ]
})
export class Street3dCanvasComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('cv', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  @Input({ required: true }) map!: StreetMapEntry[];
  @Input() selectedSlug: string | null = null;

  @Output() readonly storefrontNavigate = new EventEmitter<string>();
  @Output() readonly hoverSlugChange = new EventEmitter<string | null>();
  @Output() readonly keyboardSelectionChange = new EventEmitter<string>();

  readonly ariaLabel = signal('Rue virtuelle InstaFact, vue 3D. Flèches pour parcourir les vitrines, Entrée pour ouvrir.');

  private runtime: VirtualStreetScene | null = null;
  private mounted = false;

  ngAfterViewInit(): void {
    if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    const canvas = this.canvasRef.nativeElement;
    const parent = canvas.parentElement;
    if (!parent) return;

    this.ariaLabel.set(
      `Rue virtuelle InstaFact, ${this.map.length} vitrine${this.map.length > 1 ? 's' : ''}. ` +
        `Flèches pour parcourir, Entrée pour ouvrir la sélection.`
    );

    const scene = new VirtualStreetScene(
      {
        onStorefrontClickSlug: slug => this.storefrontNavigate.emit(slug),
        onHoverSlugChange: slug => this.hoverSlugChange.emit(slug)
      },
      parent,
      canvas
    );
    this.runtime = scene;
    void scene.mount(this.map).then(() => {
      if (!this.runtime) return;
      this.mounted = true;
      scene.setSelectedSlug(this.selectedSlug ?? null);
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['map'] && this.runtime && this.mounted) {
      this.runtime.updateMap(this.map);
    }
    if (changes['selectedSlug'] && this.runtime && this.mounted) {
      this.runtime.setSelectedSlug(this.selectedSlug ?? null);
    }
  }

  onCanvasKeydown(ev: KeyboardEvent): void {
    if (ev.key === 'Enter') {
      const slug = this.selectedSlug;
      if (slug) {
        ev.preventDefault();
        this.storefrontNavigate.emit(slug);
      }
    } else if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') {
      ev.preventDefault();
      this.emitAdjacent(1);
    } else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      this.emitAdjacent(-1);
    }
  }

  private emitAdjacent(delta: number): void {
    const ordered = [...this.map].sort((a, b) => a.streetPositionIndex - b.streetPositionIndex);
    if (ordered.length === 0) return;
    const cur = this.selectedSlug;
    let idx = ordered.findIndex(s => s.slug === cur);
    if (idx < 0) idx = delta > 0 ? -1 : 0;
    const next = (idx + delta + ordered.length) % ordered.length;
    const slug = ordered[next]!.slug;
    this.keyboardSelectionChange.emit(slug);
  }

  ngOnDestroy(): void {
    this.runtime?.dispose();
    this.runtime = null;
    this.mounted = false;
  }
}
