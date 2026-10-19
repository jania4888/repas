using FactuTrust.Domain.Entities;
using FactuTrust.Domain.Enums;
using FactuTrust.Domain.ValueObjects;
using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Repositories;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Repositories;

public sealed class PurchaseReceiptRepositoryTests : IDisposable
{
    private readonly TestTenantDbContextFactory _contextFactory;
    private readonly PurchaseReceiptRepository _repository;

    public PurchaseReceiptRepositoryTests()
    {
        _contextFactory = new TestTenantDbContextFactory($"TestDb_PurchaseReceipts_{Guid.NewGuid()}");
        _repository = new PurchaseReceiptRepository(_contextFactory);
    }

    [Fact]
    public async Task UpdateAsync_WithMultipleLinesSharingSameCategory_ShouldNotThrowTrackingException()
    {
        var category = await PersistCategoryAsync("Cat. BR Update", "Catégorie de test BR Update");
        var product1Persisted = await PersistProductAsync("BRU001", "Produit BR Update 1", 200m, category.Id);
        var product2Persisted = await PersistProductAsync("BRU002", "Produit BR Update 2", 250m, category.Id);

        var (supplier, warehouse) = await PersistSupplierAndWarehouseAsync(
            "Fournisseur BR Update",
            "br-update@test.com",
            "1234567/A/B/C/901");

        var reloadedProduct1 = await ReloadProductWithCategoryAsync(product1Persisted.Id);
        var reloadedProduct2 = await ReloadProductWithCategoryAsync(product2Persisted.Id);

        Assert.NotSame(reloadedProduct1.Category, reloadedProduct2.Category);
        Assert.Equal(reloadedProduct1.Category!.Id, reloadedProduct2.Category!.Id);

        var receipt = PurchaseReceipt.Create(
            PurchaseReceiptNumber.Create("BR", 2026, 100),
            supplier,
            warehouse,
            DateTime.UtcNow.Date,
            notes: "Brouillon initial").Value;

        Assert.True(receipt.AddLine(reloadedProduct1, 1m, Money.Create(200m, "TND")).IsSuccess);
        Assert.True(receipt.AddLine(reloadedProduct2, 1m, Money.Create(250m, "TND")).IsSuccess);

        var added = await _repository.AddAsync(receipt);
        Assert.NotEqual(Guid.Empty, added.Id);

        // Handler path: reload receipt without Category, clear lines, re-fetch products
        // from separate contexts (two distinct ProductCategory instances for the same Id).
        var detached = await _repository.GetByIdWithLinesAsync(added.Id);
        Assert.NotNull(detached);
        Assert.True(detached!.ClearLines().IsSuccess);

        var product1ForUpdate = await ReloadProductWithCategoryAsync(product1Persisted.Id);
        var product2ForUpdate = await ReloadProductWithCategoryAsync(product2Persisted.Id);
        Assert.NotSame(product1ForUpdate.Category, product2ForUpdate.Category);

        detached.UpdateHeader(
            detached.ReceiptDate,
            detached.WarehouseId,
            detached.SupplierReference,
            detached.TransporterName,
            detached.DeliveryNoteNumber,
            "Notes mises à jour pour test régression tracking");

        Assert.True(detached.AddLine(product1ForUpdate, 1m, Money.Create(200m, "TND")).IsSuccess);
        Assert.True(detached.AddLine(product2ForUpdate, 1m, Money.Create(250m, "TND")).IsSuccess);

        var updateException = await Record.ExceptionAsync(() => _repository.UpdateAsync(detached));

        Assert.Null(updateException);

        using var verify = _contextFactory.CreateContext();
        var verified = await verify.PurchaseReceipts
            .Include(r => r.Lines)
            .FirstOrDefaultAsync(r => r.Id == added.Id);
        Assert.NotNull(verified);
        Assert.Equal("Notes mises à jour pour test régression tracking", verified!.Notes);
        Assert.Equal(2, verified.Lines.Count);
    }

    [Fact]
    public async Task UpdateAsync_AfterClearLinesAndReAdd_ReplacesPersistedLines()
    {
        var category = await PersistCategoryAsync("Cat. BR Replace", "Catégorie remplacement lignes");
        var product1 = await PersistProductAsync("BRR001", "Produit BR Replace 1", 80m, category.Id);
        var product2 = await PersistProductAsync("BRR002", "Produit BR Replace 2", 120m, category.Id);

        var (supplier, warehouse) = await PersistSupplierAndWarehouseAsync(
            "Fournisseur BR Replace",
            "br-replace@test.com",
            "1234567/A/B/C/902");

        var receipt = PurchaseReceipt.Create(
            PurchaseReceiptNumber.Create("BR", 2026, 101),
            supplier,
            warehouse,
            DateTime.UtcNow.Date).Value;

        var product1WithCategory = await ReloadProductWithCategoryAsync(product1.Id);
        Assert.True(receipt.AddLine(product1WithCategory, 3m, Money.Create(80m, "TND")).IsSuccess);

        var attachment = PurchaseReceiptAttachment.Create(
            receipt,
            "bl-fournisseur.pdf",
            "application/pdf",
            1024,
            "receipts/bl-fournisseur.pdf",
            "tester");
        Assert.True(attachment.IsSuccess, attachment.Error?.Description);
        Assert.True(receipt.AddAttachment(attachment.Value).IsSuccess);

        var added = await _repository.AddAsync(receipt);
        var originalLineId = added.Lines.Single().Id;

        var detached = await _repository.GetByIdWithLinesAsync(added.Id);
        Assert.NotNull(detached);
        Assert.Empty(detached!.Attachments);

        Assert.True(detached.ClearLines().IsSuccess);
        var product2WithCategory = await ReloadProductWithCategoryAsync(product2.Id);
        Assert.True(detached.AddLine(product2WithCategory, 2m, Money.Create(120m, "TND")).IsSuccess);

        var newLineId = detached.Lines.Single().Id;
        Assert.NotEqual(originalLineId, newLineId);

        var updateException = await Record.ExceptionAsync(() => _repository.UpdateAsync(detached));
        Assert.Null(updateException);

        var verified = await _repository.GetByIdWithDetailsAsync(added.Id);
        Assert.NotNull(verified);
        var persistedLine = Assert.Single(verified!.Lines);
        Assert.Equal(newLineId, persistedLine.Id);
        Assert.Equal(product2.Id, persistedLine.ProductId);
        Assert.Equal(2m, persistedLine.ReceivedQuantity);
        Assert.Equal(120m, persistedLine.UnitPrice.Amount);
        Assert.Equal(240m, persistedLine.SubTotal.Amount);
        Assert.Equal(240m, verified.SubTotal.Amount);
        Assert.Equal(45.6m, verified.TotalVat.Amount);
        Assert.Equal(285.6m, verified.TotalAmount.Amount);

        using var verify = _contextFactory.CreateContext();
        Assert.False(await verify.PurchaseReceiptLines.AnyAsync(l => l.Id == originalLineId));
        Assert.Equal(1, await verify.PurchaseReceiptLines.CountAsync(l => l.PurchaseReceiptId == added.Id));

        var persistedAttachment = Assert.Single(verified.Attachments);
        Assert.Equal("bl-fournisseur.pdf", persistedAttachment.FileName);
    }

    [Fact]
    public async Task UpdateAsync_AfterClearLinesAndReAdd_WithGetPurchasePrice_PersistsUnitPrice()
    {
        var category = await PersistCategoryAsync("Cat. BR Price", "Catégorie prix d'achat");
        var product = await PersistProductAsync("BRP001", "Produit BR Prix", 95m, category.Id);

        var (supplier, warehouse) = await PersistSupplierAndWarehouseAsync(
            "Fournisseur BR Prix",
            "br-price@test.com",
            "1234567/A/B/C/903");

        var receipt = PurchaseReceipt.Create(
            PurchaseReceiptNumber.Create("BR", 2026, 102),
            supplier,
            warehouse,
            DateTime.UtcNow.Date).Value;

        var productForCreate = await ReloadProductWithCategoryAsync(product.Id);
        Assert.True(receipt.AddLine(productForCreate, 1m, Money.Create(80m, "TND")).IsSuccess);

        var added = await _repository.AddAsync(receipt);

        var detached = await _repository.GetByIdWithLinesAsync(added.Id);
        Assert.NotNull(detached);
        Assert.True(detached!.ClearLines().IsSuccess);

        var productForUpdate = await ReloadProductWithCategoryAsync(product.Id);
        Assert.True(detached.AddLine(productForUpdate, 3m, productForUpdate.GetPurchasePrice()).IsSuccess);
        Assert.NotSame(productForUpdate.PurchasePrice, detached.Lines.Single().UnitPrice);

        var updateException = await Record.ExceptionAsync(() => _repository.UpdateAsync(detached));
        Assert.Null(updateException);

        var verified = await _repository.GetByIdWithLinesAsync(added.Id);
        Assert.NotNull(verified);
        var persistedLine = Assert.Single(verified!.Lines);
        Assert.Equal(95m, persistedLine.UnitPrice.Amount);
        Assert.Equal(285m, persistedLine.SubTotal.Amount);
        Assert.Equal(285m, verified.SubTotal.Amount);
        Assert.Equal(54.15m, verified.TotalVat.Amount);
        Assert.Equal(339.15m, verified.TotalAmount.Amount);
    }

    [Fact]
    public async Task Attachment_added_to_a_reloaded_receipt_persists_its_row()
    {
        // Régression (contrat auto-attach de l'import de document) : UploadAttachment recharge le
        // bon avec détails, appelle AddAttachment puis persistait via UpdateAsync. UpdateAsync
        // faisait context.Attach(entity) : le nouvel enfant (clé Guid déjà assignée) était suivi
        // comme Unchanged -> jamais INSERT (200 OK mais aucune ligne en base).
        var (supplier, warehouse) = await PersistSupplierAndWarehouseAsync(
            "Fournisseur BR Attach",
            "br-attach@test.com",
            "1234567/A/B/C/904");

        var receipt = PurchaseReceipt.Create(
            PurchaseReceiptNumber.Create("BR", 2026, 103),
            supplier,
            warehouse,
            DateTime.UtcNow.Date).Value;

        var added = await _repository.AddAsync(receipt);

        // Flux exact du contrôleur : rechargement avec détails (contexte différent), puis ajout.
        var detached = await _repository.GetByIdWithDetailsAsync(added.Id);
        Assert.NotNull(detached);
        Assert.Empty(detached!.Attachments);

        var attachment = PurchaseReceiptAttachment.Create(
            detached,
            "bl-source.pdf",
            "application/pdf",
            2048,
            "purchase-receipts/x/bl-source.pdf",
            "tester").Value;
        Assert.True(detached.AddAttachment(attachment).IsSuccess);

        await _repository.AddAttachmentAsync(attachment);

        using var verify = _contextFactory.CreateContext();
        var persisted = await verify.PurchaseReceiptAttachments
            .FirstOrDefaultAsync(a => a.PurchaseReceiptId == added.Id);
        Assert.NotNull(persisted);
        Assert.Equal(attachment.Id, persisted!.Id);
        Assert.Equal("bl-source.pdf", persisted.FileName);
        Assert.Equal("application/pdf", persisted.ContentType);
        Assert.Equal(2048, persisted.SizeBytes);
    }

    [Fact]
    public async Task DeleteAttachmentAsync_removes_the_persisted_row()
    {
        // Miroir du bug d'ajout : RemoveAttachment vidait la collection en mémoire puis UpdateAsync
        // marquait la collection IsLoaded = false -> EF ne voyait jamais la suppression (fichier
        // supprimé du disque, ligne orpheline en base).
        var (supplier, warehouse) = await PersistSupplierAndWarehouseAsync(
            "Fournisseur BR AttachDel",
            "br-attachdel@test.com",
            "1234567/A/B/C/905");

        var receipt = PurchaseReceipt.Create(
            PurchaseReceiptNumber.Create("BR", 2026, 104),
            supplier,
            warehouse,
            DateTime.UtcNow.Date).Value;

        var attachment = PurchaseReceiptAttachment.Create(
            receipt,
            "bl-a-supprimer.pdf",
            "application/pdf",
            1024,
            "purchase-receipts/x/bl-a-supprimer.pdf",
            "tester").Value;
        Assert.True(receipt.AddAttachment(attachment).IsSuccess);

        var added = await _repository.AddAsync(receipt);

        var detached = await _repository.GetByIdWithDetailsAsync(added.Id);
        Assert.NotNull(detached);
        var persistedAttachment = Assert.Single(detached!.Attachments);
        Assert.True(detached.RemoveAttachment(persistedAttachment.Id).IsSuccess);

        await _repository.DeleteAttachmentAsync(persistedAttachment);

        using var verify = _contextFactory.CreateContext();
        Assert.False(await verify.PurchaseReceiptAttachments
            .AnyAsync(a => a.PurchaseReceiptId == added.Id));
    }

    [Fact]
    public async Task UpdateAsync_on_a_receipt_loaded_without_attachments_keeps_existing_attachment_rows()
    {
        // Garde-fou inverse : les chemins qui rechargent SANS les pièces jointes (édition des
        // lignes, validation, annulation) ne doivent pas supprimer les lignes d'attachement.
        var (supplier, warehouse) = await PersistSupplierAndWarehouseAsync(
            "Fournisseur BR KeepAttach",
            "br-keepattach@test.com",
            "1234567/A/B/C/906");

        var receipt = PurchaseReceipt.Create(
            PurchaseReceiptNumber.Create("BR", 2026, 105),
            supplier,
            warehouse,
            DateTime.UtcNow.Date).Value;

        var attachment = PurchaseReceiptAttachment.Create(
            receipt,
            "bl-conserve.pdf",
            "application/pdf",
            1024,
            "purchase-receipts/x/bl-conserve.pdf",
            "tester").Value;
        Assert.True(receipt.AddAttachment(attachment).IsSuccess);

        var added = await _repository.AddAsync(receipt);

        var detached = await _repository.GetByIdWithLinesAsync(added.Id);
        Assert.NotNull(detached);
        Assert.Empty(detached!.Attachments); // non chargées — ne doit pas signifier « supprimer »
        detached.UpdateHeader(
            detached.ReceiptDate,
            detached.WarehouseId,
            detached.SupplierReference,
            detached.TransporterName,
            detached.DeliveryNoteNumber,
            "Notes mises à jour sans toucher aux pièces jointes");

        await _repository.UpdateAsync(detached);

        using var verify = _contextFactory.CreateContext();
        var kept = await verify.PurchaseReceiptAttachments
            .Where(a => a.PurchaseReceiptId == added.Id)
            .ToListAsync();
        Assert.Single(kept);
        Assert.Equal("bl-conserve.pdf", kept[0].FileName);
    }

    private async Task<ProductCategory> PersistCategoryAsync(string code, string name)
    {
        using var context = _contextFactory.CreateContext();
        var categoryResult = ProductCategory.Create(code, name);
        Assert.True(categoryResult.IsSuccess, categoryResult.Error?.Description);
        context.ProductCategories.Add(categoryResult.Value);
        await context.SaveChangesAsync();
        return categoryResult.Value;
    }

    private async Task<Product> PersistProductAsync(string code, string name, decimal price, Guid categoryId)
    {
        using var context = _contextFactory.CreateContext();
        var productResult = Product.Create(
            code: code,
            name: name,
            type: ProductType.Product,
            unitPrice: Money.Create(price, "TND"),
            vatRate: VatRate.Standard,
            categoryId: categoryId,
            purchasePrice: Money.Create(price, "TND"));
        Assert.True(productResult.IsSuccess, productResult.Error?.Description);
        context.Products.Add(productResult.Value);
        await context.SaveChangesAsync();
        return productResult.Value;
    }

    private async Task<Product> ReloadProductWithCategoryAsync(Guid productId)
    {
        using var context = _contextFactory.CreateContext();
        return await context.Products
            .Include(p => p.Category)
            .FirstAsync(p => p.Id == productId);
    }

    private async Task<(Supplier Supplier, Warehouse Warehouse)> PersistSupplierAndWarehouseAsync(
        string supplierName,
        string email,
        string nifValue)
    {
        using var context = _contextFactory.CreateContext();

        var addressResult = Address.Create("123 Rue Test", "Tunis", "Tunis");
        Assert.True(addressResult.IsSuccess, addressResult.Error?.Description);
        var emailResult = Email.Create(email);
        Assert.True(emailResult.IsSuccess, emailResult.Error?.Description);
        var nifResult = NIF.Create(nifValue);
        Assert.True(nifResult.IsSuccess, nifResult.Error?.Description);

        var supplierResult = Supplier.Create(
            supplierName,
            SupplierType.Business,
            addressResult.Value,
            emailResult.Value,
            nif: nifResult.Value);
        Assert.True(supplierResult.IsSuccess, supplierResult.Error?.Description);

        var warehouseResult = Warehouse.Create("WH-BR", "Entrepôt BR");
        Assert.True(warehouseResult.IsSuccess, warehouseResult.Error?.Description);

        context.Suppliers.Add(supplierResult.Value);
        context.Warehouses.Add(warehouseResult.Value);
        await context.SaveChangesAsync();

        return (supplierResult.Value, warehouseResult.Value);
    }

    private sealed class TestTenantDbContextFactory : ITenantDbContextFactory
    {
        private readonly string _databaseName;

        public TestTenantDbContextFactory(string databaseName)
        {
            _databaseName = databaseName;
        }

        public TenantDbContext CreateContext()
        {
            var options = new DbContextOptionsBuilder<TenantDbContext>()
                .UseInMemoryDatabase(databaseName: _databaseName)
                .Options;

            return new TenantDbContext(options);
        }
    }

    public void Dispose()
    {
        using var context = _contextFactory.CreateContext();
        context.Database.EnsureDeleted();
    }
}
