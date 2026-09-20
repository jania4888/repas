import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import type { CompanyRegistrationSubmitRequest } from '@core/registration/registration-wizard-mode';
import {
  governorateValidator,
  identityPasswordValidator,
  nifValidator,
  passwordsMatchValidator,
  postalCodeValidator,
  tunisianPhoneValidator
} from '@core/registration/registration-validators';
import { normalizeNif, normalizePhone } from '@core/registration/tunisian-validation';

/**
 * Formulaire de création d'entreprise, découpé en sous-groupes correspondant aux étapes.
 *
 * Ce découpage n'est pas cosmétique : il permet de garder l'état « cette étape est-elle
 * valide ? » sur `group.valid`, au lieu d'une liste de contrôles maintenue à la main qui se
 * désynchronise au premier champ ajouté.
 */
export type CreateCompanyForm = FormGroup;

export function buildCreateCompanyForm(fb: FormBuilder): CreateCompanyForm {
  return fb.group({
    sector: fb.nonNullable.group({
      companySegment: [''],
      businessDomain: ['']
    }),
    identity: fb.nonNullable.group(
      {
        email: ['', [Validators.required, Validators.email]],
        password: ['', [Validators.required, identityPasswordValidator]],
        confirmPassword: ['', Validators.required],
        firstName: ['', Validators.required],
        lastName: ['', Validators.required],
        companyName: ['', Validators.required],
        nif: ['', [Validators.required, nifValidator]],
        companyEmail: ['', [Validators.required, Validators.email]],
        phone: ['', [Validators.required, tunisianPhoneValidator]]
      },
      { validators: passwordsMatchValidator() }
    ),
    address: fb.nonNullable.group({
      street: ['', Validators.required],
      streetLine2: [''],
      city: ['', Validators.required],
      governorate: ['', [Validators.required, governorateValidator]],
      postalCode: ['', postalCodeValidator],
      website: [''],
      warehouseName: [''],
      taxRegime: [0],
      plan: [0]
    }),
    recap: fb.nonNullable.group({
      acceptResponsibility: [false, Validators.requiredTrue]
    })
  });
}

/** Valeurs brutes du formulaire, telles que `getRawValue()` les produit. */
export interface CreateCompanyRawValue {
  sector: { companySegment: string; businessDomain: string };
  identity: {
    email: string;
    password: string;
    confirmPassword: string;
    firstName: string;
    lastName: string;
    companyName: string;
    nif: string;
    companyEmail: string;
    phone: string;
  };
  address: {
    street: string;
    streetLine2: string;
    city: string;
    governorate: string;
    postalCode: string;
    website: string;
    warehouseName: string;
    taxRegime: number;
    plan: number;
  };
  recap: { acceptResponsibility: boolean };
}

/** Requête envoyée au serveur, avec le forfait plateforme transporté à part. */
export interface CreateCompanySubmitPayload extends CompanyRegistrationSubmitRequest {
  plan?: number;
}

function trimmedOrUndefined(value: string | null | undefined): string | undefined {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Construit la charge utile à partir des valeurs du formulaire.
 *
 * Deux règles de fond :
 *  - les champs facultatifs vides sont **omis** plutôt qu'envoyés vides — côté serveur,
 *    `null` signifie « non renseigné », `""` déclencherait une validation ;
 *  - quand le catalogue sectoriel est désactivé, secteur et modules sont omis complètement :
 *    le serveur les ignorerait et renverrait des avertissements inutiles.
 */
export function buildSubmitRequest(
  raw: CreateCompanyRawValue,
  selectedModules: readonly number[],
  options: { sectorEnabled: boolean }
): CreateCompanySubmitPayload {
  const payload: CreateCompanySubmitPayload = {
    email: raw.identity.email.trim(),
    password: raw.identity.password,
    confirmPassword: raw.identity.confirmPassword,
    firstName: raw.identity.firstName.trim(),
    lastName: raw.identity.lastName.trim(),
    companyName: raw.identity.companyName.trim(),
    nif: normalizeNif(raw.identity.nif),
    taxRegime: raw.address.taxRegime,
    street: raw.address.street.trim(),
    city: raw.address.city.trim(),
    governorate: raw.address.governorate.trim(),
    companyEmail: raw.identity.companyEmail.trim(),
    phone: normalizePhone(raw.identity.phone)
  };

  const streetLine2 = trimmedOrUndefined(raw.address.streetLine2);
  if (streetLine2) payload.streetLine2 = streetLine2;

  const postalCode = trimmedOrUndefined(raw.address.postalCode);
  if (postalCode) payload.postalCode = postalCode;

  const website = trimmedOrUndefined(raw.address.website);
  if (website) payload.website = website;

  const warehouseName = trimmedOrUndefined(raw.address.warehouseName);
  if (warehouseName) payload.warehouseName = warehouseName;

  if (options.sectorEnabled) {
    const segment = trimmedOrUndefined(raw.sector.companySegment);
    if (segment) payload.companySegment = segment;

    const domain = trimmedOrUndefined(raw.sector.businessDomain);
    if (domain) payload.businessDomain = domain;

    if (selectedModules.length > 0) {
      payload.enabledModules = [...selectedModules].sort((a, b) => a - b);
    }
  }

  if (raw.address.plan > 0) {
    payload.plan = raw.address.plan;
  }

  return payload;
}
