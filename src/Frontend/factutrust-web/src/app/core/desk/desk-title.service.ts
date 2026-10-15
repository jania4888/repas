import { Injectable } from '@angular/core';

/** Titres publiés par un écran (saisie : « Modification de l'écriture … ») sans coupler le bureau au formulaire. */
@Injectable({ providedIn: 'root' })
export class DeskTitleService {
  private readonly overrides = new Map<string, string>();

  publish(key: string, title: string): void {
    const trimmed = title.trim();
    if (!key || !trimmed) return;
    this.overrides.set(key, trimmed);
  }

  override(key: string): string | null {
    return this.overrides.get(key) ?? null;
  }

  forget(key: string): void {
    this.overrides.delete(key);
  }
}
