import { canonicalizeNif } from '@shared/validation/validation-rules';

/** Ramène un matricule à la forme carte `1772793W/A/M/000`. */
export function cleanNif(value: string | null | undefined): string {
  return canonicalizeNif(value);
}
