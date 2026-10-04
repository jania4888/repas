
import { Injectable, inject, DOCUMENT } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class StreetThemeService {
  private readonly doc = inject(DOCUMENT);
  private depth = 0;

  activate(): void {
    this.depth++;
    if (this.depth === 1) {
      this.doc.body.classList.add('street-theme');
    }
  }

  deactivate(): void {
    if (this.depth > 0) {
      this.depth--;
    }
    if (this.depth === 0) {
      this.doc.body.classList.remove('street-theme');
    }
  }
}
