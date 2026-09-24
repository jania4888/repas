/**
 * Chiffres vérifiables affichés sur la landing (plan A.4.3 / A.4.16).
 * Doit rester aligné sur le backend :
 *  - `FactuTrust.Domain/Enums/AppModule.cs`   → 18 modules activables ;
 *  - `FactuTrust.Domain/Enums/UserRole.cs`    → 13 rôles utilisateurs ;
 *  - `FactuTrust.Application/Features/AI/Tools/AiToolRegistry.cs` → 98 outils nommés,
 *    arrondi prudent « 90+ » (suffixe affiché à part pour rester correct en RTL).
 * Les libellés viennent du dictionnaire (`t().home.stats` / `t().home.trustStrip`) ;
 * ici uniquement des nombres.
 */
export const LANDING_FACTS = {
  modulesCount: 18,
  rolesCount: 13,
  aiToolsCount: 90,
  aiToolsSuffix: '+'
} as const;
