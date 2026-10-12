namespace FactuTrust.Infrastructure.Services.Lettering;

/// <summary>Ligne candidate pour <see cref="SubsetSumSearch"/> (montant absolu en millimes).</summary>
/// <param name="Index">Identifiant opaque rendu tel quel dans le résultat (position chez l'appelant).</param>
/// <param name="Amount">Montant absolu, en millimes. Les montants ≤ 0 ou supérieurs à la cible sont ignorés.</param>
/// <param name="DateTicks">Date de la ligne (ticks), pour départager par étalement de dates.</param>
/// <param name="OrderRank">Rang stable de la ligne (date, pièce, id), pour un départage déterministe.</param>
internal readonly record struct SubsetItem(int Index, long Amount, long DateTicks, int OrderRank);

/// <summary>Résultat de <see cref="SubsetSumSearch.Find"/>.</summary>
/// <param name="ItemIndexes">
/// <see cref="SubsetItem.Index"/> de la meilleure solution, triés par ordre croissant ; vide si aucune solution.
/// </param>
/// <param name="AlternativeCount">Nombre de solutions distinctes de même taille, meilleure incluse (0 si aucune).</param>
/// <param name="BudgetExhausted">
/// Vrai si la recherche s'est arrêtée sur le budget de nœuds : la solution rendue (s'il y en a une) peut ne
/// pas être la meilleure, et une solution plus courte n'est pas exclue au-delà du budget.
/// </param>
/// <param name="NodesVisited">Nombre de nœuds visités (déterministe, pour le budget global de l'appelant).</param>
internal sealed record SubsetSearchResult(
    IReadOnlyList<int> ItemIndexes,
    int AlternativeCount,
    bool BudgetExhausted,
    long NodesVisited)
{
    internal bool Found => ItemIndexes.Count > 0;
}

/// <summary>
/// Recherche bornée d'un sous-ensemble de 2 à <c>maxSize</c> lignes dont la somme vaut exactement la cible
/// (règle R4 « plusieurs pour un » du moteur de propositions, plan v2, annexe C §2.5).
/// </summary>
/// <remarks>
/// <para>
/// Pur et déterministe : même entrée (quel que soit son ordre), même résultat, même nombre de nœuds.
/// Le coût est borné par <c>nodeBudget</c> (nombre d'appels de la recherche en profondeur), jamais par le temps.
/// </para>
/// <para>
/// Algorithme : lignes triées par montant décroissant puis <see cref="SubsetItem.OrderRank"/> ; recherche
/// en profondeur taille par taille (2, 3, … <c>maxSize</c>), arrêt à la première taille qui a une solution
/// (moins de lignes d'abord). Élagages : montant qui dépasse le reste à atteindre ; borne haute (les
/// <c>r</c> plus grands restants n'atteignent pas la cible) ; borne basse (les <c>r</c> plus petits la
/// dépassent) ; montants égaux à la même profondeur explorés une seule fois.
/// </para>
/// <para>
/// Départage entre solutions de même taille : plus faible étalement de dates, puis ordre lexicographique
/// des <see cref="SubsetItem.OrderRank"/> triés. Les solutions sont comptées par multi-ensemble de montants :
/// entre lignes de même montant, la ligne au plus petit <see cref="SubsetItem.OrderRank"/> est retenue.
/// Aucune allocation par nœud : tableaux de travail réutilisés.
/// </para>
/// </remarks>
internal static class SubsetSumSearch
{
    /// <summary>Taille minimale d'un sous-ensemble (une seule ligne relève de R3, pas de R4).</summary>
    internal const int MinSize = 2;

    // Garde contre le dépassement : au plus 64 montants ≤ cible sont additionnés.
    private const long MaxTarget = long.MaxValue / 64;

    private static readonly SubsetSearchResult Empty = new(Array.Empty<int>(), 0, false, 0);

    internal static SubsetSearchResult Find(long target, IReadOnlyList<SubsetItem> items, int maxSize, int nodeBudget)
    {
        ArgumentNullException.ThrowIfNull(items);
        if (target <= 0 || target > MaxTarget || maxSize < MinSize || nodeBudget <= 0)
            return Empty;

        var sorted = items
            .Where(i => i.Amount > 0 && i.Amount <= target)
            .OrderByDescending(i => i.Amount)
            .ThenBy(i => i.OrderRank)
            .ThenBy(i => i.Index)
            .ToArray();
        if (sorted.Length < MinSize)
            return Empty;

        var search = new Search(sorted, target, Math.Min(maxSize, sorted.Length), nodeBudget);
        return search.Run();
    }

    private sealed class Search
    {
        private readonly SubsetItem[] _items;
        private readonly long _target;
        private readonly int _maxSize;
        private readonly long _nodeBudget;
        private readonly long[] _prefix;   // _prefix[i] = somme des i premiers montants (plus grands d'abord).
        private readonly int[] _path;      // positions de la solution en cours, réutilisé.
        private readonly int[] _best;      // positions de la meilleure solution, réutilisé.
        private readonly int[] _ranksA;    // tampons de comparaison des OrderRank, réutilisés.
        private readonly int[] _ranksB;

        private long _nodes;
        private bool _exhausted;
        private int _size;
        private int _solutions;
        private long _bestSpread;

        internal Search(SubsetItem[] items, long target, int maxSize, int nodeBudget)
        {
            _items = items;
            _target = target;
            _maxSize = maxSize;
            _nodeBudget = nodeBudget;
            _prefix = new long[items.Length + 1];
            for (var i = 0; i < items.Length; i++)
                _prefix[i + 1] = _prefix[i] + items[i].Amount;
            _path = new int[maxSize];
            _best = new int[maxSize];
            _ranksA = new int[maxSize];
            _ranksB = new int[maxSize];
        }

        internal SubsetSearchResult Run()
        {
            for (_size = MinSize; _size <= _maxSize && !_exhausted; _size++)
            {
                Dfs(depth: 0, start: 0, remaining: _target);
                if (_solutions > 0)
                    return Result();
            }

            return new SubsetSearchResult(Array.Empty<int>(), 0, _exhausted, _nodes);
        }

        private SubsetSearchResult Result()
        {
            var indexes = new int[_size];
            for (var i = 0; i < _size; i++)
                indexes[i] = _items[_best[i]].Index;
            Array.Sort(indexes);
            return new SubsetSearchResult(indexes, _solutions, _exhausted, _nodes);
        }

        private void Dfs(int depth, int start, long remaining)
        {
            if (_nodes >= _nodeBudget)
            {
                _exhausted = true;
                return;
            }
            _nodes++;

            var needed = _size - depth;
            var n = _items.Length;

            // Borne basse : les `needed` plus petits montants dépassent déjà le reste.
            if (_prefix[n] - _prefix[n - needed] > remaining)
                return;

            long previousAmount = 0;
            for (var i = start; i <= n - needed; i++)
            {
                var amount = _items[i].Amount;

                // Borne haute : les `needed` plus grands à partir de i n'atteignent pas le reste ;
                // les positions suivantes ont des montants plus petits, donc on arrête.
                if (_prefix[i + needed] - _prefix[i] < remaining)
                    return;

                // Dépassement, ou montant déjà exploré à cette profondeur (même sous-arbre de sommes).
                if (amount > remaining || amount == previousAmount)
                    continue;
                previousAmount = amount;

                _path[depth] = i;
                if (needed == 1)
                {
                    if (amount == remaining)
                        Record();
                    continue;
                }

                Dfs(depth + 1, i + 1, remaining - amount);
                if (_exhausted)
                    return;
            }
        }

        private void Record()
        {
            _solutions++;
            var spread = Spread(_path);
            if (_solutions == 1 || spread < _bestSpread || (spread == _bestSpread && RanksLess(_path, _best)))
            {
                Array.Copy(_path, _best, _size);
                _bestSpread = spread;
            }
        }

        private long Spread(int[] positions)
        {
            long min = long.MaxValue, max = long.MinValue;
            for (var i = 0; i < _size; i++)
            {
                var ticks = _items[positions[i]].DateTicks;
                if (ticks < min) min = ticks;
                if (ticks > max) max = ticks;
            }
            return max - min;
        }

        private bool RanksLess(int[] candidate, int[] best)
        {
            for (var i = 0; i < _size; i++)
            {
                _ranksA[i] = _items[candidate[i]].OrderRank;
                _ranksB[i] = _items[best[i]].OrderRank;
            }
            Array.Sort(_ranksA, 0, _size);
            Array.Sort(_ranksB, 0, _size);
            for (var i = 0; i < _size; i++)
            {
                if (_ranksA[i] != _ranksB[i])
                    return _ranksA[i] < _ranksB[i];
            }
            return false;
        }
    }
}
