using FactuTrust.Infrastructure.MultiTenancy;
using FactuTrust.Infrastructure.Persistence;
using FactuTrust.Infrastructure.Repositories;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Repositories;

/// <summary>
/// 4.7 suite (D-47-93) : la garde défensive des repositories à paramètres de page bruts borne le
/// décalage à <c>int.MaxValue</c> au lieu de déborder en négatif (Skip négatif ⇒ 500 sur SQL Server).
/// Identité pour toute valeur saine ; <c>page &lt; 1</c> reste ramené à la première page.
/// </summary>
public sealed class PagingBoundsTests
{
    [Theory]
    [InlineData(1, 20, 0)]
    [InlineData(2, 20, 20)]
    [InlineData(10, 100, 900)]
    [InlineData(0, 20, 0)]       // page < 1 ⇒ première page (Math.Max(1, page))
    [InlineData(-5, 20, 0)]
    [InlineData(1, 0, 0)]        // pageSize < 1 ⇒ 1 ligne (Math.Max(1, pageSize))
    public void SafeSkip_is_identity_for_healthy_values(int page, int pageSize, int expected)
        => Assert.Equal(expected, PagingBounds.SafeSkip(page, pageSize));

    [Theory]
    [InlineData(int.MaxValue, 200)]
    [InlineData(int.MaxValue, 50)]
    [InlineData(10737420, 200)]  // (10737420 - 1) * 200 > int.MaxValue : au-delà de la borne sûre
    public void SafeSkip_never_overflows_and_clamps_to_int_max(int page, int pageSize)
    {
        var skip = PagingBounds.SafeSkip(page, pageSize);
        Assert.True(skip >= 0, "le décalage ne doit jamais être négatif (Skip négatif ⇒ 500)");
        Assert.Equal(int.MaxValue, skip);
    }

    [Fact]
    public void SafeSkip_at_the_exact_boundary_stays_int()
        => Assert.Equal((int.MaxValue / 200 - 1) * 200, PagingBounds.SafeSkip(int.MaxValue / 200, 200));

    // — Repositories (InMemory) : page ≈ int.MaxValue + grande taille ⇒ réponse, pas d'exception —

    private sealed class TestTenantDbContextFactory : ITenantDbContextFactory
    {
        private readonly string _name = $"PagingBoundsRepo_{Guid.NewGuid()}";
        public TenantDbContext CreateContext() =>
            new(new DbContextOptionsBuilder<TenantDbContext>().UseInMemoryDatabase(_name).Options);
    }

    // ClientRepository (et les autres repositories prenant la factory concrète TenantDbContextFactory)
    // est couvert côté SQL Server par ClientRepositoryTests : voir ci-dessous, l'intégration existante
    // est complétée d'un fait « page max ». Ici, un repository sur l'interface suffit à verrouiller la
    // garde côté EF.

    [Fact]
    public async Task StockMovementRepository_SearchAsync_with_max_page_answers_an_empty_page()
    {
        var repo = new StockMovementRepository(new TestTenantDbContextFactory());
        var (items, total) = await repo.SearchAsync(null, null, null, null, null, int.MaxValue, 100, CancellationToken.None);
        Assert.Equal(0, total);
        Assert.Empty(items);
    }
}
