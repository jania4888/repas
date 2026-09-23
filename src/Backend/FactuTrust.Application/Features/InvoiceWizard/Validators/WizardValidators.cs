using FactuTrust.Application.Common.Validation;
using FactuTrust.Application.DTOs;
using FluentValidation;

namespace FactuTrust.Application.Features.InvoiceWizard.Validators;

/// <summary>
/// Validator for step 1 - Metadata.
/// Validates invoice type, dates, currency, and linked invoice for credit notes.
/// </summary>
public sealed class WizardStepMetadataValidator : AbstractValidator<WizardStepMetadataDto>
{
    public WizardStepMetadataValidator()
    {
        RuleFor(x => x.Type)
            .NotEmpty()
            .WithMessage("Le type de document est obligatoire")
            .WithErrorCode(ValidationErrorCodes.Required)
            .Must(t => TunisianValidationRules.ValidInvoiceTypes.Contains(t))
            .WithMessage("Le type de document doit être INVOICE ou CREDIT_NOTE")
            .WithErrorCode(ValidationErrorCodes.InvalidEnum);

        RuleFor(x => x.IssueDate)
            .NotEmpty()
            .WithMessage("La date d'émission est obligatoire")
            .WithErrorCode(ValidationErrorCodes.Required)
            .LessThanOrEqualTo(DateTime.UtcNow.Date.AddDays(1))
            .WithMessage("La date d'émission ne peut pas être dans le futur")
            .WithErrorCode(ValidationErrorCodes.FutureDate);

        RuleFor(x => x.DueDate)
            .GreaterThanOrEqualTo(x => x.IssueDate)
            .When(x => x.DueDate.HasValue)
            .WithMessage("La date d'échéance doit être postérieure ou égale à la date d'émission")
            .WithErrorCode(ValidationErrorCodes.DateRange);

        RuleFor(x => x.Currency)
            .NotEmpty()
            .WithMessage("La devise est obligatoire")
            .WithErrorCode(ValidationErrorCodes.Required)
            .Must(c => TunisianValidationRules.ValidCurrencies.Contains(c))
            .WithMessage("La devise doit être TND, EUR ou USD")
            .WithErrorCode(ValidationErrorCodes.InvalidEnum);

        RuleFor(x => x.InternalReference)
            .MaximumLength(TunisianValidationRules.MaxLengths.InternalReference)
            .WithMessage($"La référence interne ne peut pas dépasser {TunisianValidationRules.MaxLengths.InternalReference} caractères")
            .WithErrorCode(ValidationErrorCodes.MaxLength);

        // Credit note must be linked to an existing invoice
        RuleFor(x => x.LinkedInvoiceId)
            .NotEmpty()
            .When(x => x.Type == "CREDIT_NOTE")
            .WithMessage("Une facture d'avoir doit être liée à une facture existante")
            .WithErrorCode(ValidationErrorCodes.Required);
    }
}

/// <summary>
/// Validator for step 3 - Client selection or creation.
/// </summary>
public sealed class WizardStepClientValidator : AbstractValidator<WizardStepClientDto>
{
    public WizardStepClientValidator()
    {
        RuleFor(x => x)
            .Must(x => x.ClientId.HasValue || (x.IsNewClient && x.NewClient != null))
            .WithMessage("Vous devez sélectionner un client ou en créer un nouveau")
            .WithErrorCode(ValidationErrorCodes.Required);

        When(x => x.IsNewClient && x.NewClient != null, () =>
        {
            RuleFor(x => x.NewClient!)
                .SetValidator(new WizardNewClientValidator());
        });
    }
}

/// <summary>
/// Validator for new client creation within the wizard.
/// Includes all Tunisian-specific validations.
/// </summary>
public sealed class WizardNewClientValidator : AbstractValidator<WizardNewClientDto>
{
    public WizardNewClientValidator()
    {
        // Name validation
        RuleFor(x => x.Name)
            .NotEmpty()
            .WithMessage("La raison sociale est obligatoire")
            .WithErrorCode(ValidationErrorCodes.Required)
            .MinimumLength(TunisianValidationRules.MinLengths.ClientName)
            .WithMessage($"La raison sociale doit contenir au moins {TunisianValidationRules.MinLengths.ClientName} caractères")
            .WithErrorCode(ValidationErrorCodes.MinLength)
            .MaximumLength(TunisianValidationRules.MaxLengths.ClientName)
            .WithMessage($"La raison sociale ne peut pas dépasser {TunisianValidationRules.MaxLengths.ClientName} caractères")
            .WithErrorCode(ValidationErrorCodes.MaxLength);

        // Tax type validation
        RuleFor(x => x.TaxType)
            .NotEmpty()
            .WithMessage("Le type de client est obligatoire")
            .WithErrorCode(ValidationErrorCodes.Required)
            .Must(ClientTaxTypes.IsValid)
            .WithMessage("Le type de client est invalide (TAX_SUBJECT, NON_TAX_SUBJECT, TAX_EXEMPT)")
            .WithErrorCode(ValidationErrorCodes.InvalidEnum);

        // NIF validation - required only for TAX_SUBJECT
        RuleFor(x => x.Nif)
            .NotEmpty()
            .When(x => TunisianValidationRules.RequiresNif(x.TaxType))
            .WithMessage("Le matricule fiscal est obligatoire pour un client assujetti")
            .WithErrorCode(ValidationErrorCodes.Required);

        RuleFor(x => x.Nif)
            .Must(TunisianValidationRules.IsValidNif)
            .When(x => !string.IsNullOrEmpty(x.Nif))
            .WithMessage("Le format du matricule fiscal est invalide (attendu: 1772793W/A/M/000)")
            .WithErrorCode(ValidationErrorCodes.InvalidNif);

        // Address validation
        RuleFor(x => x.Address)
            .NotNull()
            .WithMessage("L'adresse est obligatoire")
            .WithErrorCode(ValidationErrorCodes.Required)
            .SetValidator(new WizardAddressValidator());

        // Email facultatif : format contrôlé seulement s'il est renseigné.
        RuleFor(x => x.Email)
            .Must(email => string.IsNullOrEmpty(email) || TunisianValidationRules.IsValidEmail(email))
            .When(x => !string.IsNullOrEmpty(x.Email))
            .WithMessage("L'adresse email est invalide")
            .WithErrorCode(ValidationErrorCodes.InvalidEmail)
            .MaximumLength(TunisianValidationRules.MaxLengths.Email)
            .WithMessage($"L'email ne peut pas dépasser {TunisianValidationRules.MaxLengths.Email} caractères")
            .WithErrorCode(ValidationErrorCodes.MaxLength);

        // Phone validation (optional but must be valid if provided)
        RuleFor(x => x.Phone)
            .Must(TunisianValidationRules.IsValidTunisianPhone)
            .When(x => !string.IsNullOrEmpty(x.Phone))
            .WithMessage("Le format du numéro de téléphone est invalide. Format attendu: +216 XX XXX XXX")
            .WithErrorCode(ValidationErrorCodes.InvalidPhone)
            .MaximumLength(TunisianValidationRules.MaxLengths.Phone)
            .WithMessage($"Le numéro de téléphone ne peut pas dépasser {TunisianValidationRules.MaxLengths.Phone} caractères")
            .WithErrorCode(ValidationErrorCodes.MaxLength);
    }
}

/// <summary>
/// Validator for Tunisian address.
/// </summary>
public sealed class WizardAddressValidator : AbstractValidator<WizardAddressDto>
{
    public WizardAddressValidator()
    {
        RuleFor(x => x.Street)
            .NotEmpty()
            .WithMessage("L'adresse est obligatoire")
            .WithErrorCode(ValidationErrorCodes.Required)
            .MaximumLength(TunisianValidationRules.MaxLengths.Street)
            .WithMessage($"L'adresse ne peut pas dépasser {TunisianValidationRules.MaxLengths.Street} caractères")
            .WithErrorCode(ValidationErrorCodes.MaxLength);

        RuleFor(x => x.City)
            .NotEmpty()
            .WithMessage("La ville est obligatoire")
            .WithErrorCode(ValidationErrorCodes.Required)
            .MaximumLength(TunisianValidationRules.MaxLengths.City)
            .WithMessage($"La ville ne peut pas dépasser {TunisianValidationRules.MaxLengths.City} caractères")
            .WithErrorCode(ValidationErrorCodes.MaxLength);

        RuleFor(x => x.Governorate)
            .NotEmpty()
            .WithMessage("Le gouvernorat est obligatoire")
            .WithErrorCode(ValidationErrorCodes.Required)
            .Must(TunisianValidationRules.IsValidGovernorate)
            .WithMessage("Le gouvernorat est invalide")
            .WithErrorCode(ValidationErrorCodes.InvalidGovernorate);

        RuleFor(x => x.PostalCode)
            .Must(TunisianValidationRules.IsValidPostalCode)
            .When(x => !string.IsNullOrEmpty(x.PostalCode))
            .WithMessage("Le code postal doit contenir 4 chiffres")
            .WithErrorCode(ValidationErrorCodes.InvalidPostalCode);
    }
}

/// <summary>
/// Validator for invoice lines collection (step 4).
/// </summary>
public sealed class WizardStepLinesValidator : AbstractValidator<List<WizardStepLineDto>>
{
    public WizardStepLinesValidator()
    {
        RuleFor(x => x)
            .NotEmpty()
            .WithMessage("La facture doit contenir au moins une ligne")
            .WithErrorCode(ValidationErrorCodes.Required);

        RuleForEach(x => x)
            .SetValidator(new WizardStepLineValidator());
    }
}

/// <summary>
/// Validator for individual invoice line.
/// Includes calculation validation and discount limits.
/// </summary>
public sealed class WizardStepLineValidator : AbstractValidator<WizardStepLineDto>
{
    public WizardStepLineValidator()
    {
        // Designation validation
        RuleFor(x => x.Designation)
            .NotEmpty()
            .WithMessage("La désignation est obligatoire")
            .WithErrorCode(ValidationErrorCodes.Required)
            .MinimumLength(TunisianValidationRules.MinLengths.Designation)
            .WithMessage($"La désignation doit contenir au moins {TunisianValidationRules.MinLengths.Designation} caractères")
            .WithErrorCode(ValidationErrorCodes.MinLength)
            .MaximumLength(TunisianValidationRules.MaxLengths.Designation)
            .WithMessage($"La désignation ne peut pas dépasser {TunisianValidationRules.MaxLengths.Designation} caractères")
            .WithErrorCode(ValidationErrorCodes.MaxLength);

        // Description validation (optional)
        RuleFor(x => x.Description)
            .MaximumLength(TunisianValidationRules.MaxLengths.Description)
            .When(x => !string.IsNullOrEmpty(x.Description))
            .WithMessage($"La description ne peut pas dépasser {TunisianValidationRules.MaxLengths.Description} caractères")
            .WithErrorCode(ValidationErrorCodes.MaxLength);

        // Quantity validation
        RuleFor(x => x.Quantity)
            .GreaterThan(0)
            .WithMessage("La quantité doit être supérieure à zéro")
            .WithErrorCode(ValidationErrorCodes.MinValue)
            .GreaterThanOrEqualTo(TunisianValidationRules.NumericLimits.MinQuantity)
            .WithMessage($"La quantité minimum est {TunisianValidationRules.NumericLimits.MinQuantity}")
            .WithErrorCode(ValidationErrorCodes.MinValue);

        // Unit price validation
        RuleFor(x => x.UnitPriceHT)
            .GreaterThanOrEqualTo(0)
            .WithMessage("Le prix unitaire HT ne peut pas être négatif")
            .WithErrorCode(ValidationErrorCodes.MinValue);

        // VAT rate validation
        RuleFor(x => x.VatRate)
            .Must(TunisianValidationRules.IsValidVatRate)
            .WithMessage("Le taux de TVA est invalide (0%, 7%, 13% ou 19% autorisés)")
            .WithErrorCode(ValidationErrorCodes.InvalidVatRate);

        // Discount type validation
        When(x => !string.IsNullOrEmpty(x.DiscountType), () =>
        {
            RuleFor(x => x.DiscountType)
                .Must(t => t is "PERCENT" or "AMOUNT")
                .WithMessage("Le type de remise doit être PERCENT ou AMOUNT")
                .WithErrorCode(ValidationErrorCodes.InvalidEnum);

            RuleFor(x => x.DiscountValue)
                .NotNull()
                .WithMessage("La valeur de remise est obligatoire lorsqu'un type est spécifié")
                .WithErrorCode(ValidationErrorCodes.Required)
                .GreaterThanOrEqualTo(0)
                .WithMessage("La remise ne peut pas être négative")
                .WithErrorCode(ValidationErrorCodes.MinValue);

            // Percentage discount cannot exceed 100%
            RuleFor(x => x.DiscountValue)
                .LessThanOrEqualTo(TunisianValidationRules.NumericLimits.MaxDiscountPercent)
                .When(x => x.DiscountType == "PERCENT")
                .WithMessage("La remise en pourcentage ne peut pas dépasser 100%")
                .WithErrorCode(ValidationErrorCodes.MaxValue);

            // Amount discount cannot exceed line subtotal
            RuleFor(x => x)
                .Must(line =>
                {
                    if (line.DiscountType != "AMOUNT" || !line.DiscountValue.HasValue)
                        return true;
                    var subtotal = line.Quantity * line.UnitPriceHT;
                    return line.DiscountValue.Value <= subtotal;
                })
                .When(x => x.DiscountType == "AMOUNT" && x.DiscountValue.HasValue)
                .WithMessage("La remise ne peut pas dépasser le montant de la ligne")
                .WithErrorCode(ValidationErrorCodes.DiscountExceedsTotal);
        });
    }
}

/// <summary>
/// Validator for payment and legal information (step 5).
/// </summary>
public sealed class WizardStepPaymentLegalValidator : AbstractValidator<WizardStepPaymentLegalDto>
{
    public WizardStepPaymentLegalValidator()
    {
        // Payment method validation
        RuleFor(x => x.PaymentMethod)
            .NotEmpty()
            .WithMessage("Le mode de paiement est obligatoire")
            .WithErrorCode(ValidationErrorCodes.Required)
            .Must(PaymentMethods.IsValid)
            .WithMessage("Le mode de paiement est invalide")
            .WithErrorCode(ValidationErrorCodes.InvalidEnum);

        // Days until due validation
        RuleFor(x => x.DaysUntilDue)
            .InclusiveBetween(0, TunisianValidationRules.NumericLimits.MaxPaymentDays)
            .When(x => x.DaysUntilDue.HasValue)
            .WithMessage($"Le délai de paiement doit être entre 0 et {TunisianValidationRules.NumericLimits.MaxPaymentDays} jours")
            .WithErrorCode(ValidationErrorCodes.InvalidFormat);

        // Payment terms validation
        RuleFor(x => x.PaymentTerms)
            .MaximumLength(TunisianValidationRules.MaxLengths.PaymentTerms)
            .When(x => !string.IsNullOrEmpty(x.PaymentTerms))
            .WithMessage($"Les conditions de paiement ne peuvent pas dépasser {TunisianValidationRules.MaxLengths.PaymentTerms} caractères")
            .WithErrorCode(ValidationErrorCodes.MaxLength);

        // Bank info validation for bank transfers
        When(x => x.PaymentMethod == PaymentMethods.BankTransfer, () =>
        {
            When(x => x.BankInfo != null, () =>
            {
                // RIB validation (Tunisian format: 20 digits)
                RuleFor(x => x.BankInfo!.Rib)
                    .Must(TunisianValidationRules.IsValidRib)
                    .When(x => !string.IsNullOrEmpty(x.BankInfo?.Rib))
                    .WithMessage("Le format du RIB est invalide (20 chiffres attendus)")
                    .WithErrorCode(ValidationErrorCodes.InvalidRib);

                // IBAN validation (Tunisian format: TN + 22 digits)
                RuleFor(x => x.BankInfo!.Iban)
                    .Must(TunisianValidationRules.IsValidTunisianIban)
                    .When(x => !string.IsNullOrEmpty(x.BankInfo?.Iban))
                    .WithMessage("Le format de l'IBAN tunisien est invalide (TN + 22 chiffres)")
                    .WithErrorCode(ValidationErrorCodes.InvalidIban);

                // Bank name validation
                RuleFor(x => x.BankInfo!.BankName)
                    .MaximumLength(TunisianValidationRules.MaxLengths.BankName)
                    .When(x => !string.IsNullOrEmpty(x.BankInfo?.BankName))
                    .WithMessage($"Le nom de la banque ne peut pas dépasser {TunisianValidationRules.MaxLengths.BankName} caractères")
                    .WithErrorCode(ValidationErrorCodes.MaxLength);
            });
        });

        // Legal mentions validation
        When(x => x.LegalMentions != null, () =>
        {
            RuleFor(x => x.LegalMentions!.VatMention)
                .NotEmpty()
                .WithMessage("La mention TVA est obligatoire")
                .WithErrorCode(ValidationErrorCodes.Required);

            RuleFor(x => x.LegalMentions!.CustomMention)
                .MaximumLength(TunisianValidationRules.MaxLengths.CustomMention)
                .When(x => !string.IsNullOrEmpty(x.LegalMentions?.CustomMention))
                .WithMessage($"La mention personnalisée ne peut pas dépasser {TunisianValidationRules.MaxLengths.CustomMention} caractères")
                .WithErrorCode(ValidationErrorCodes.MaxLength);
        });
    }
}

/// <summary>
/// Validator for the complete draft before submission.
/// Combines all step validators.
/// </summary>
public sealed class CompleteDraftValidator : AbstractValidator<SaveDraftRequest>
{
    public CompleteDraftValidator()
    {
        RuleFor(x => x.Metadata)
            .NotNull()
            .WithMessage("Les métadonnées sont obligatoires")
            .WithErrorCode(ValidationErrorCodes.Required)
            .SetValidator(new WizardStepMetadataValidator()!);

        RuleFor(x => x.SellerId)
            .NotEmpty()
            .WithMessage("L'émetteur est obligatoire")
            .WithErrorCode(ValidationErrorCodes.Required);

        RuleFor(x => x.Client)
            .NotNull()
            .WithMessage("Le client est obligatoire")
            .WithErrorCode(ValidationErrorCodes.Required)
            .SetValidator(new WizardStepClientValidator()!);

        RuleFor(x => x.Lines)
            .NotNull()
            .WithMessage("Les lignes sont obligatoires")
            .WithErrorCode(ValidationErrorCodes.Required)
            .SetValidator(new WizardStepLinesValidator()!);

        RuleFor(x => x.PaymentLegal)
            .NotNull()
            .WithMessage("Les informations de paiement sont obligatoires")
            .WithErrorCode(ValidationErrorCodes.Required)
            .SetValidator(new WizardStepPaymentLegalValidator()!);
    }
}

/// <summary>
/// Validator for submit invoice request.
/// </summary>
public sealed class SubmitInvoiceWizardValidator : AbstractValidator<SubmitInvoiceWizardRequest>
{
    public SubmitInvoiceWizardValidator()
    {
        RuleFor(x => x.DraftId)
            .NotEmpty()
            .WithMessage("L'identifiant du brouillon est obligatoire")
            .WithErrorCode(ValidationErrorCodes.Required);

        RuleFor(x => x.IdempotencyKey)
            .NotEmpty()
            .WithMessage("La clé d'idempotence est obligatoire")
            .WithErrorCode(ValidationErrorCodes.Required)
            .Length(32, 64)
            .WithMessage("La clé d'idempotence doit contenir entre 32 et 64 caractères")
            .WithErrorCode(ValidationErrorCodes.InvalidFormat);
    }
}
