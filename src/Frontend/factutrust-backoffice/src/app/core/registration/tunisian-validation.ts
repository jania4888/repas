/**
 * Constantes de validation tunisiennes — copie backoffice.
 *
 * Jumeau : `factutrust-web/src/app/shared/validation/validation-rules.ts`.
 * Les deux applications sont des workspaces npm distincts (dépendances disjointes) : dupliquer
 * ces constantes pures est assumé, une bibliothèque partagée serait un chantier à part entière.
 *
 * Sources de vérité côté serveur — toute modification ici doit s'y refléter :
 *  - NIF        → `src/Backend/FactuTrust.Domain/ValueObjects/NIF.cs`
 *  - Téléphone  → `src/Backend/FactuTrust.Domain/ValueObjects/PhoneNumber.cs`
 *  - Gouvernorats → `TunisianGovernorates.All` dans `src/Backend/FactuTrust.Domain/ValueObjects/Address.cs`
 *  - Mot de passe → configuration ASP.NET Identity dans `src/Backend/FactuTrust.API/Program.cs`
 */

/** Matricule fiscal : `NNNNNNN/L/L/L/NNN`. */
export const NIF_PATTERN = /^\d{7}\/[A-Z]\/[A-Z]\/[A-Z]\/\d{3}$/;

/** Téléphone tunisien : `+216XXXXXXXX`, `216XXXXXXXX` ou `XXXXXXXX` (préfixe 2,3,4,5,7,8,9). */
export const TUNISIAN_PHONE_PATTERN = /^(\+?216)?[2-57-9]\d{7}$/;

/** Code postal tunisien : exactement 4 chiffres. */
export const POSTAL_CODE_PATTERN = /^\d{4}$/;

/**
 * Les 24 gouvernorats, orthographe et accents strictement identiques à
 * `TunisianGovernorates.All`. Le serveur compare sans tenir compte de la casse mais **pas** des
 * accents : « Beja » serait rejeté, « béja » accepté.
 */
export const TUNISIAN_GOVERNORATES: readonly string[] = [
  'Ariana', 'Béja', 'Ben Arous', 'Bizerte', 'Gabès', 'Gafsa',
  'Jendouba', 'Kairouan', 'Kasserine', 'Kébili', 'Le Kef', 'Mahdia',
  'La Manouba', 'Médenine', 'Monastir', 'Nabeul', 'Sfax', 'Sidi Bouzid',
  'Siliana', 'Sousse', 'Tataouine', 'Tozeur', 'Tunis', 'Zaghouan'
];

/** Options prêtes à l'emploi pour un `p-select`. */
export const TUNISIAN_GOVERNORATE_OPTIONS: readonly { label: string; value: string }[] =
  TUNISIAN_GOVERNORATES.map(g => ({ label: g, value: g }));

/** Politique de mot de passe ASP.NET Identity effectivement appliquée par le serveur. */
export const PASSWORD_POLICY = {
  requiredLength: 12,
  requiredUniqueChars: 4,
  requireDigit: true,
  requireLowercase: true,
  requireUppercase: true,
  requireNonAlphanumeric: true
} as const;

/** Normalise un matricule fiscal : trim, suppression des espaces, majuscules. */
export function normalizeNif(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, '').toUpperCase().trim();
}

/** Normalise un téléphone tunisien vers la forme `+216XXXXXXXX` quand c'est possible. */
export function normalizePhone(value: string | null | undefined): string {
  const compact = (value ?? '').replace(/[\s.-]/g, '').trim();
  if (!compact) return '';
  if (/^\+216\d{8}$/.test(compact)) return compact;
  if (/^216\d{8}$/.test(compact)) return `+${compact}`;
  if (/^\d{8}$/.test(compact)) return `+216${compact}`;
  return compact;
}

export function isValidNif(value: string | null | undefined): boolean {
  return NIF_PATTERN.test(normalizeNif(value));
}

export function isValidTunisianPhone(value: string | null | undefined): boolean {
  return TUNISIAN_PHONE_PATTERN.test((value ?? '').replace(/[\s.-]/g, '').trim());
}

export function isValidPostalCode(value: string | null | undefined): boolean {
  return POSTAL_CODE_PATTERN.test((value ?? '').trim());
}

export function isValidGovernorate(value: string | null | undefined): boolean {
  const candidate = (value ?? '').trim().toLowerCase();
  return TUNISIAN_GOVERNORATES.some(g => g.toLowerCase() === candidate);
}
