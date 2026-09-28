import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-studio-designer-shell',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="studio-designer">
      <div class="studio-editor">
        <ng-content select="[studioEditor]" />
      </div>
      <div class="studio-preview">
        @if (previewTitle) {
          <h3 class="studio-preview-title">{{ previewTitle }}</h3>
        }
        <ng-content select="[studioPreview]" />
      </div>
    </div>
  `,
  styleUrl: './studio-layout.scss',
})
export class StudioDesignerShellComponent {
  @Input() previewTitle = $localize`:@@studio.studio-designer-shell.ts.apercu.f0f53004:Aperçu`;
}