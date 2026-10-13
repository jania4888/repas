using FactuTrust.Infrastructure.Services.Lettering;
using Xunit;

namespace FactuTrust.Infrastructure.Tests.Services.Lettering;

/// <summary>
/// Phase 3 du lettrage (p3-4) : recherche bornée de sous-ensemble pour la règle R4. Couvre la
/// solution minimale, le départage déterministe, le budget de nœuds et l'élagage des doublons.
/// </summary>
public sealed class SubsetSumSearchTests
{
    private const int MaxSize = 4;
    private const int Budget = 20_000;

    private static readonly DateTime Day0 = new(2026, 1, 1);

    private static SubsetItem Item(int index, long amount, int day = 0, int? rank = null)
        => new(index, amount, Day0.AddDays(day).Ticks, rank ?? index);

    [Fact]
    public void Find_ThreeForOne_ReturnsTheThreeLines()
    {
        var items = new[] { Item(0, 400_000), Item(1, 350_000), Item(2, 250_000), Item(3, 999_000) };

        var result = SubsetSumSearch.Find(1_000_000, items, MaxSize, Budget);

        Assert.True(result.Found);
        Assert.Equal(new[] { 0, 1, 2 }, result.ItemIndexes);
        Assert.Equal(1, result.AlternativeCount);
        Assert.False(result.BudgetExhausted);
    }

    [Fact]
    public void Find_NoCombinationMatches_ReturnsEmpty()
    {
        var items = new[] { Item(0, 300_000), Item(1, 300_000), Item(2, 300_000) };

        var result = SubsetSumSearch.Find(1_000_000, items, MaxSize, Budget);

        Assert.False(result.Found);
        Assert.Empty(result.ItemIndexes);
        Assert.Equal(0, result.AlternativeCount);
        Assert.False(result.BudgetExhausted);
    }

    [Fact]
    public void Find_SolutionNeedsMaxSizePlusOne_IsNotFound()
    {
        // Seule solution : 5 lignes de 200,000 ; maxSize = 4.
        var items = Enumerable.Range(0, 5).Select(i => Item(i, 200_000)).ToArray();

        Assert.False(SubsetSumSearch.Find(1_000_000, items, 4, Budget).Found);
        Assert.Equal(5, SubsetSumSearch.Find(1_000_000, items, 5, Budget).ItemIndexes.Count);
    }

    [Fact]
    public void Find_PrefersFewestLines()
    {
        // 600 + 400 (2 lignes) gagne sur 500 + 300 + 200 (3 lignes).
        var items = new[] { Item(0, 500), Item(1, 300), Item(2, 200), Item(3, 600), Item(4, 400) };

        var result = SubsetSumSearch.Find(1_000, items, MaxSize, Budget);

        Assert.Equal(new[] { 3, 4 }, result.ItemIndexes);
    }

    [Fact]
    public void Find_SameSize_PrefersSmallestDateSpread()
    {
        // {700, 300} étalé sur 90 jours ; {600, 400} sur 2 jours.
        var items = new[] { Item(0, 700, day: 0), Item(1, 300, day: 90), Item(2, 600, day: 10), Item(3, 400, day: 12) };

        var result = SubsetSumSearch.Find(1_000, items, MaxSize, Budget);

        Assert.Equal(new[] { 2, 3 }, result.ItemIndexes);
        Assert.Equal(2, result.AlternativeCount);
    }

    [Fact]
    public void Find_SameSizeAndSpread_PrefersLowestOrderRanks()
    {
        var items = new[] { Item(0, 700, rank: 5), Item(1, 300, rank: 6), Item(2, 600, rank: 1), Item(3, 400, rank: 9) };

        var result = SubsetSumSearch.Find(1_000, items, MaxSize, Budget);

        Assert.Equal(new[] { 2, 3 }, result.ItemIndexes); // rangs {1, 9} < {5, 6}
    }

    [Fact]
    public void Find_EqualAmounts_TakesLowestOrderRank()
    {
        var items = new[] { Item(0, 500, rank: 7), Item(1, 500, rank: 2), Item(2, 500, rank: 4) };

        var result = SubsetSumSearch.Find(1_000, items, MaxSize, Budget);

        Assert.Equal(new[] { 1, 2 }, result.ItemIndexes);
        Assert.Equal(1, result.AlternativeCount); // un seul multi-ensemble de montants
    }

    [Fact]
    public void Find_IsIndependentOfInputOrder()
    {
        var items = new[]
        {
            Item(0, 410, day: 3), Item(1, 290, day: 5), Item(2, 300, day: 1), Item(3, 700, day: 9),
            Item(4, 150, day: 2), Item(5, 150, day: 8), Item(6, 550, day: 4), Item(7, 160, day: 6),
        };
        var expected = SubsetSumSearch.Find(1_000, items, MaxSize, Budget);

        var random = new Random(42);
        for (var round = 0; round < 10; round++)
        {
            var shuffled = items.OrderBy(_ => random.Next()).ToArray();
            var result = SubsetSumSearch.Find(1_000, shuffled, MaxSize, Budget);
            Assert.Equal(expected.ItemIndexes, result.ItemIndexes);
            Assert.Equal(expected.AlternativeCount, result.AlternativeCount);
            Assert.Equal(expected.NodesVisited, result.NodesVisited);
        }
    }

    [Fact]
    public void Find_TwentyFiveIdenticalAmounts_FinishesWithinBudget()
    {
        var items = Enumerable.Range(0, 25).Select(i => Item(i, 250_000)).ToArray();

        var result = SubsetSumSearch.Find(1_000_000, items, MaxSize, Budget);

        Assert.True(result.Found);
        Assert.Equal(new[] { 0, 1, 2, 3 }, result.ItemIndexes);
        Assert.False(result.BudgetExhausted);
        // Élagage des doublons : un seul chemin par profondeur (2 + 3 + 4 nœuds au plus).
        Assert.True(result.NodesVisited <= 10, $"NodesVisited = {result.NodesVisited}");
    }

    [Fact]
    public void Find_TwentyFiveIdenticalAmounts_NoSolution_StaysTiny()
    {
        var items = Enumerable.Range(0, 25).Select(i => Item(i, 300_000)).ToArray();

        var result = SubsetSumSearch.Find(1_000_000, items, 6, Budget);

        Assert.False(result.Found);
        Assert.False(result.BudgetExhausted);
        Assert.True(result.NodesVisited <= 25, $"NodesVisited = {result.NodesVisited}");
    }

    [Fact]
    public void Find_BudgetExhausted_IsFlaggedAndDeterministic()
    {
        // 40 montants distincts, aucune solution (cible impaire, montants pairs) : l'espace dépasse le budget.
        var items = Enumerable.Range(0, 40).Select(i => Item(i, 1_000 + (2L * i * i))).ToArray();

        var first = SubsetSumSearch.Find(10_001, items, 6, 500);
        var second = SubsetSumSearch.Find(10_001, items, 6, 500);

        Assert.True(first.BudgetExhausted);
        Assert.False(first.Found);
        Assert.Equal(500, first.NodesVisited);
        Assert.Equal(first.NodesVisited, second.NodesVisited);
        Assert.Equal(first.ItemIndexes, second.ItemIndexes);
        Assert.Equal(first.BudgetExhausted, second.BudgetExhausted);
    }

    [Fact]
    public void Find_LargeSearchSpace_StaysWithinNodeBudget()
    {
        var items = Enumerable.Range(0, 40).Select(i => Item(i, 1_000 + (7L * i))).ToArray();

        var result = SubsetSumSearch.Find(5_555, items, 6, Budget);

        Assert.True(result.NodesVisited <= Budget);
    }

    [Theory]
    [InlineData(0L)]
    [InlineData(-1_000L)]
    [InlineData(long.MaxValue)]
    public void Find_InvalidTarget_ReturnsEmpty(long target)
    {
        var items = new[] { Item(0, 500), Item(1, 500) };

        var result = SubsetSumSearch.Find(target, items, MaxSize, Budget);

        Assert.False(result.Found);
        Assert.Equal(0, result.NodesVisited);
    }

    [Fact]
    public void Find_IgnoresNonPositiveAndOversizedAmounts()
    {
        var items = new[] { Item(0, 0), Item(1, -500), Item(2, 1_500), Item(3, 600), Item(4, 400) };

        var result = SubsetSumSearch.Find(1_000, items, MaxSize, Budget);

        Assert.Equal(new[] { 3, 4 }, result.ItemIndexes);
    }

    [Theory]
    [InlineData(1, Budget)]
    [InlineData(MaxSize, 0)]
    public void Find_InvalidLimits_ReturnsEmpty(int maxSize, int budget)
    {
        var items = new[] { Item(0, 500), Item(1, 500) };

        Assert.False(SubsetSumSearch.Find(1_000, items, maxSize, budget).Found);
    }

    [Fact]
    public void Find_SingleLineEqualToTarget_IsNotASubset()
    {
        // Une seule ligne égale à la cible relève de R3 : R4 exige au moins 2 lignes.
        var items = new[] { Item(0, 1_000), Item(1, 10) };

        Assert.False(SubsetSumSearch.Find(1_000, items, MaxSize, Budget).Found);
    }

    [Fact]
    public void Find_MatchesBruteForce_OnRandomInputs()
    {
        // Les élagages ne perdent jamais de solution : même taille minimale et même nombre de
        // multi-ensembles de montants qu'une énumération exhaustive (graine fixe).
        var random = new Random(20261012);
        for (var round = 0; round < 300; round++)
        {
            var count = random.Next(2, 12);
            var items = Enumerable.Range(0, count)
                .Select(i => Item(i, random.Next(1, 20) * 50L, day: random.Next(0, 60)))
                .ToArray();
            var target = random.Next(2, 40) * 50L;

            var result = SubsetSumSearch.Find(target, items, MaxSize, 1_000_000);
            var (size, multisets) = BruteForce(target, items, MaxSize);

            Assert.False(result.BudgetExhausted);
            Assert.Equal(size, result.ItemIndexes.Count);
            Assert.Equal(multisets, result.AlternativeCount);
            if (result.Found)
                Assert.Equal(target, result.ItemIndexes.Sum(i => items[i].Amount));
        }
    }

    private static (int Size, int Multisets) BruteForce(long target, SubsetItem[] items, int maxSize)
    {
        for (var size = 2; size <= maxSize; size++)
        {
            var seen = new HashSet<string>();
            for (var mask = 0; mask < 1 << items.Length; mask++)
            {
                if (System.Numerics.BitOperations.PopCount((uint)mask) != size)
                    continue;
                var picked = Enumerable.Range(0, items.Length).Where(i => (mask & (1 << i)) != 0).ToArray();
                if (picked.Sum(i => items[i].Amount) == target)
                    seen.Add(string.Join(",", picked.Select(i => items[i].Amount).OrderBy(a => a)));
            }
            if (seen.Count > 0)
                return (size, seen.Count);
        }
        return (0, 0);
    }
}
