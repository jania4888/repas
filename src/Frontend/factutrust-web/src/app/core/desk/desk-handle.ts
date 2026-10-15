import { DeskDetachedHandle } from './desk-window.model';

export function asDeskHandle(handle: unknown): DeskDetachedHandle | null {
  if (!handle || typeof handle !== 'object') return null;
  return handle as DeskDetachedHandle;
}

export function deskHandleInstance(handle: unknown): object | null {
  const ref = asDeskHandle(handle)?.componentRef;
  const instance = ref?.instance;
  return instance && typeof instance === 'object' ? instance : null;
}

/** Détruit l'instance détachée. `store(null)` ne doit pas passer par ici : le routeur en a repris la propriété. */
export function destroyDeskHandle(handle: unknown): void {
  const ref = asDeskHandle(handle)?.componentRef;
  try {
    ref?.destroy?.();
  } catch {
    // Déjà détruite par le routeur.
  }
}

export function componentIsDirty(instance: object | null): boolean {
  if (!instance) return false;
  const candidate = instance as { isDirty?: () => boolean };
  if (typeof candidate.isDirty !== 'function') return false;
  try {
    return candidate.isDirty() === true;
  } catch {
    return false;
  }
}

/** `false` seulement quand le composant refuse explicitement. */
export function componentCanClose(instance: object | null): boolean {
  if (!instance) return true;
  const candidate = instance as { canDeactivate?: () => boolean };
  if (typeof candidate.canDeactivate !== 'function') return true;
  try {
    return candidate.canDeactivate() !== false;
  } catch {
    return false;
  }
}
