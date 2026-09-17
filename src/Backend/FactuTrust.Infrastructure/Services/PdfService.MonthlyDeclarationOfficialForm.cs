using FactuTrust.Application.DTOs;
using FactuTrust.Application.Features.Accounting.OfficialForm;
using FactuTrust.Infrastructure.Services.OfficialForms;

namespace FactuTrust.Infrastructure.Services;

public partial class PdfService
{
    /// <inheritdoc />
    public Task<byte[]> GenerateMonthlyDeclarationOfficialFormPdfAsync(
        VatDeclarationDto declaration,
        IReadOnlyDictionary<string, decimal>? withholdingLines = null,
        IReadOnlyDictionary<string, decimal>? configuredBoxes = null,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(declaration);
        cancellationToken.ThrowIfCancellationRequested();

        // Contrairement aux autres exports, aucune mise en page n'est produite ici : le document
        // EST le formulaire officiel. Le binder traduit la déclaration en valeurs de cases, le
        // stamper les dépose aux coordonnées du millésime.
        var map = OfficialFormFieldMap.Load(MonthlyDeclarationFormBinder.FormVersion);
        var values = MonthlyDeclarationFormBinder.Bind(declaration, withholdingLines, configuredBoxes);

        return Task.FromResult(_officialFormStamper.Stamp(map, values));
    }
}
