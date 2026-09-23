namespace FactuTrust.Infrastructure.Services.Email;

/// <summary>
/// Lot C2 — Catalogue des templates email plateforme, définis en code (lecture seule).
///
/// Une migration vers une table <c>EmailTemplates</c> en BD (avec éditeur côté backoffice)
/// est prévue dans un sous-lot ultérieur. Pour l'instant, les templates sont versionnés
/// dans le code source — c'est plus simple et auditable.
///
/// Variables disponibles dans les templates :
/// <list type="bullet">
///   <item><c>{{ recipientName }}</c> — nom du destinataire</item>
///   <item><c>{{ companyName }}</c> — raison sociale du tenant si applicable</item>
///   <item><c>{{ inviteUrl }}</c>, <c>{{ initialPassword }}</c> — pour <c>account-invited</c></item>
///   <item><c>{{ planName }}</c>, <c>{{ trialEndDate }}</c> — pour <c>welcome</c>, <c>trial-ending-7d</c></item>
///   <item><c>{{ amount }}</c>, <c>{{ invoiceNumber }}</c> — pour <c>payment-received</c>, <c>invoice-issued</c></item>
/// </list>
/// </summary>
public static class EmailTemplates
{
    public sealed record EmailTemplate(
        string Code,
        string SubjectTemplate,
        string HtmlBodyTemplate,
        string TextBodyTemplate);

    private static readonly Dictionary<string, EmailTemplate> Catalog = new(StringComparer.OrdinalIgnoreCase)
    {
        ["welcome"] = new(
            Code: "welcome",
            SubjectTemplate: "Bienvenue sur InstaFact, {{ recipientName }} !",
            HtmlBodyTemplate: WrapHtml(
                "Bienvenue sur InstaFact",
                @"<p>Bonjour <strong>{{ recipientName }}</strong>,</p>
<p>Votre compte InstaFact pour <strong>{{ companyName }}</strong> est désormais opérationnel.</p>
<p>Vous bénéficiez de la formule <strong>{{ planName }}</strong>. N'hésitez pas à explorer les modules accessibles depuis votre tableau de bord.</p>
<p>Bonne facturation !</p>"),
            TextBodyTemplate: @"Bonjour {{ recipientName }},

Votre compte InstaFact pour {{ companyName }} est désormais opérationnel.
Vous bénéficiez de la formule {{ planName }}.

Bonne facturation !
"),

        ["account-invited"] = new(
            Code: "account-invited",
            SubjectTemplate: "Votre accès administrateur InstaFact",
            HtmlBodyTemplate: WrapHtml(
                "Invitation administrateur",
                @"<p>Bonjour <strong>{{ recipientName }}</strong>,</p>
<p>Vous venez d'être invité comme administrateur sur la plateforme InstaFact avec le rôle <strong>{{ role }}</strong>.</p>
<p>Connectez-vous avec ce mot de passe initial à changer immédiatement :</p>
<p style=""font-family:monospace;background:#f4f4f4;padding:10px;border-radius:4px;font-size:14px;"">{{ initialPassword }}</p>
<p><a href=""{{ inviteUrl }}"" style=""display:inline-block;padding:10px 20px;background:#58a6ff;color:white;text-decoration:none;border-radius:4px;"">Accéder au backoffice</a></p>
<p style=""color:#666;font-size:12px;"">Ce mot de passe est à usage unique. Vous serez invité à le changer à votre première connexion.</p>"),
            TextBodyTemplate: @"Bonjour {{ recipientName }},

Vous venez d'être invité comme administrateur sur InstaFact avec le rôle {{ role }}.

Mot de passe initial : {{ initialPassword }}
URL : {{ inviteUrl }}

(à changer immédiatement à votre première connexion)
"),

        ["firm-collaborator-invited"] = new(
            Code: "firm-collaborator-invited",
            SubjectTemplate: "Invitation collaborateur — {{ companyName }}",
            HtmlBodyTemplate: WrapHtml(
                "Invitation collaborateur",
                @"<p>Bonjour <strong>{{ recipientName }}</strong>,</p>
<p>Vous venez d'être ajouté comme collaborateur du cabinet <strong>{{ companyName }}</strong> sur InstaFact.</p>
<p>Connectez-vous avec ce mot de passe initial :</p>
<p style=""font-family:monospace;background:#f4f4f4;padding:10px;border-radius:4px;font-size:14px;"">{{ initialPassword }}</p>
<p><a href=""{{ inviteUrl }}"" style=""display:inline-block;padding:10px 20px;background:#58a6ff;color:white;text-decoration:none;border-radius:4px;"">Accéder à InstaFact</a></p>
<p style=""color:#666;font-size:12px;"">Changez ce mot de passe dès votre première connexion.</p>"),
            TextBodyTemplate: @"Bonjour {{ recipientName }},

Vous venez d'être ajouté comme collaborateur du cabinet {{ companyName }} sur InstaFact.

Mot de passe initial : {{ initialPassword }}
URL : {{ inviteUrl }}
"),

        ["trial-ending-7d"] = new(
            Code: "trial-ending-7d",
            SubjectTemplate: "Votre essai InstaFact se termine dans 7 jours",
            HtmlBodyTemplate: WrapHtml(
                "Fin d'essai dans 7 jours",
                @"<p>Bonjour <strong>{{ recipientName }}</strong>,</p>
<p>Votre période d'essai pour <strong>{{ companyName }}</strong> se termine le <strong>{{ trialEndDate }}</strong>.</p>
<p>Pour continuer à utiliser InstaFact sans interruption, basculez vers la formule <strong>{{ planName }}</strong> dès maintenant.</p>"),
            TextBodyTemplate: @"Bonjour {{ recipientName }},

Votre période d'essai se termine le {{ trialEndDate }}.
Basculez vers {{ planName }} pour continuer.
"),

        ["payment-received"] = new(
            Code: "payment-received",
            SubjectTemplate: "Reçu de paiement {{ amount }} TND — InstaFact",
            HtmlBodyTemplate: WrapHtml(
                "Paiement reçu",
                @"<p>Bonjour <strong>{{ recipientName }}</strong>,</p>
<p>Nous avons bien reçu votre paiement de <strong>{{ amount }} TND</strong> pour la facture <strong>{{ invoiceNumber }}</strong>.</p>
<p>Merci de votre confiance.</p>"),
            TextBodyTemplate: @"Bonjour {{ recipientName }},

Nous avons reçu votre paiement de {{ amount }} TND (facture {{ invoiceNumber }}).
Merci !
"),

        ["payment-failed"] = new(
            Code: "payment-failed",
            SubjectTemplate: "Échec de paiement — Action requise (InstaFact)",
            HtmlBodyTemplate: WrapHtml(
                "Échec de paiement",
                @"<p>Bonjour <strong>{{ recipientName }}</strong>,</p>
<p>Le paiement de la facture <strong>{{ invoiceNumber }}</strong> ({{ amount }} TND) a échoué.</p>
<p>Pour éviter une suspension de service, veuillez régulariser dans les 7 jours en accédant à votre espace abonnement.</p>"),
            TextBodyTemplate: @"Bonjour {{ recipientName }},

Le paiement de la facture {{ invoiceNumber }} ({{ amount }} TND) a échoué.
Régularisez sous 7 jours pour éviter la suspension.
"),

        ["test-email"] = new(
            Code: "test-email",
            SubjectTemplate: "Test d'envoi InstaFact",
            HtmlBodyTemplate: WrapHtml(
                "Test SMTP",
                @"<p>Si vous lisez ce message, votre configuration SMTP fonctionne.</p>
<p>Émis depuis le backoffice plateforme à <strong>{{ timestamp }}</strong>.</p>"),
            TextBodyTemplate: @"Test SMTP — Si vous lisez ce message, votre configuration SMTP fonctionne.
Émis à {{ timestamp }}.
"),

        // Lot C6 — Templates dunning (4 étapes par défaut)
        ["dunning-step-1-soft"] = new(
            Code: "dunning-step-1-soft",
            SubjectTemplate: "Rappel : facture InstaFact en attente de règlement",
            HtmlBodyTemplate: WrapHtml(
                "Rappel doux",
                @"<p>Bonjour <strong>{{ tenantName }}</strong>,</p>
<p>Une facture InstaFact est arrivée à échéance le <strong>{{ dueDate }}</strong> et n'a pas encore été réglée.</p>
<p>Si vous avez déjà effectué le paiement, vous pouvez ignorer ce message — il peut prendre jusqu'à 48h pour être enregistré.</p>
<p>Sinon, connectez-vous à votre espace InstaFact pour régler en quelques clics.</p>"),
            TextBodyTemplate: @"Bonjour {{ tenantName }},

Une facture InstaFact est arrivée à échéance le {{ dueDate }} et n'a pas encore été réglée.
Connectez-vous à votre espace pour régler.
"),

        ["dunning-step-2-second"] = new(
            Code: "dunning-step-2-second",
            SubjectTemplate: "Deuxième rappel : facture InstaFact en retard",
            HtmlBodyTemplate: WrapHtml(
                "Deuxième rappel",
                @"<p>Bonjour <strong>{{ tenantName }}</strong>,</p>
<p>Votre facture InstaFact échue le <strong>{{ dueDate }}</strong> reste impayée. Votre abonnement est désormais marqué « impayé » (PastDue).</p>
<p>Pour éviter toute interruption, merci de régulariser sous quelques jours.</p>
<p>Si vous rencontrez une difficulté, répondez à ce message — nous pouvons étendre le délai sur demande.</p>"),
            TextBodyTemplate: @"Bonjour {{ tenantName }},

Votre facture InstaFact échue le {{ dueDate }} reste impayée.
Votre abonnement est marqué « impayé ». Régularisez sous quelques jours.
"),

        ["dunning-step-3-warning"] = new(
            Code: "dunning-step-3-warning",
            SubjectTemplate: "⚠ Avertissement : suspension imminente de votre abonnement InstaFact",
            HtmlBodyTemplate: WrapHtml(
                "Avertissement de suspension",
                @"<p>Bonjour <strong>{{ tenantName }}</strong>,</p>
<p>Votre facture InstaFact échue le <strong>{{ dueDate }}</strong> reste impayée depuis 7 jours.</p>
<p style=""color:#b91c1c;font-weight:600;"">Sans règlement dans les 7 prochains jours, votre abonnement sera automatiquement suspendu, ce qui rendra inaccessible la création de nouveaux documents fiscaux.</p>
<p>Réglez dès maintenant pour éviter l'interruption.</p>"),
            TextBodyTemplate: @"Bonjour {{ tenantName }},

Avertissement : votre abonnement InstaFact sera suspendu dans 7 jours si la facture
échue le {{ dueDate }} n'est pas réglée.
"),

        ["dunning-step-4-suspended"] = new(
            Code: "dunning-step-4-suspended",
            SubjectTemplate: "Votre abonnement InstaFact a été suspendu",
            HtmlBodyTemplate: WrapHtml(
                "Abonnement suspendu",
                @"<p>Bonjour <strong>{{ tenantName }}</strong>,</p>
<p>Faute de règlement de la facture échue le <strong>{{ dueDate }}</strong>, votre abonnement InstaFact a été <strong>suspendu</strong>.</p>
<p>Vous pouvez réactiver votre compte à tout moment en réglant la facture en attente.</p>
<p>Pour toute question, contactez le support.</p>"),
            TextBodyTemplate: @"Bonjour {{ tenantName }},

Faute de règlement, votre abonnement InstaFact est suspendu.
Réactivez votre compte en réglant la facture en attente.
"),

        ["portal-invite"] = new(
            Code: "portal-invite",
            SubjectTemplate: "{{ companyName }} vous invite dans son espace client",
            HtmlBodyTemplate: WrapHtml(
                "Invitation espace client",
                @"<p>Bonjour <strong>{{ recipientName }}</strong>,</p>
<p><strong>{{ companyName }}</strong> vous invite à consulter les factures et paiements de <strong>{{ clientName }}</strong> dans l'espace client InstaFact.</p>
<p><a href=""{{ inviteUrl }}"" style=""display:inline-block;padding:10px 20px;background:#2563eb;color:white;text-decoration:none;border-radius:6px;"">Activer mon accès</a></p>
<p style=""color:#666;font-size:12px;"">Ce lien expire après 7 jours. Si vous n'êtes pas à l'origine de cette invitation, ignorez cet e-mail.</p>"),
            TextBodyTemplate: @"Bonjour {{ recipientName }},

{{ companyName }} vous invite à consulter les factures de {{ clientName }} dans l'espace client InstaFact.
Activez votre accès : {{ inviteUrl }}

Ce lien expire après 7 jours.
"),

        // Lot C — formulaire de contact public. Le handler fournit deux clés par champ saisi :
        // xHtml (HtmlEncode, message avec <br>) pour la partie HTML, xText pour la partie texte.
        // Aucune valeur saisie dans le sujet ; aucun mailto:/URL construit à partir des saisies.
        ["contact-request-received"] = new(
            Code: "contact-request-received",
            SubjectTemplate: "[InstaFact] Nouvelle demande — {{ subjectLabel }} — {{ reference }}",
            HtmlBodyTemplate: WrapHtml(
                "Nouvelle demande de contact",
                @"<p>Référence <strong>{{ reference }}</strong> · Objet : <strong>{{ subjectLabel }}</strong> · Langue : {{ locale }}</p>
<table cellpadding=""4"">
<tr><th align=""left"">Nom</th><td>{{ fullNameHtml }}</td></tr>
<tr><th align=""left"">Organisation</th><td>{{ organizationHtml }}</td></tr>
<tr><th align=""left"">E-mail</th><td>{{ emailHtml }}</td></tr>
<tr><th align=""left"">Téléphone</th><td>{{ phoneHtml }}</td></tr>
<tr><th align=""left"">Taille</th><td>{{ sizeHtml }}</td></tr>
</table>
<p><strong>Message</strong></p>
<blockquote style=""border-left:3px solid #ccc;padding-left:8px"">{{ messageHtml }}</blockquote>
<p style=""color:#666;font-size:12px"">Reçue le {{ createdAt }} (UTC) · anti-bot : {{ captcha }} · consentement {{ consentVersion }} · IP (hachage) {{ ipHashPrefix }}</p>"),
            TextBodyTemplate: @"Nouvelle demande de contact {{ reference }} ({{ subjectLabel }}, {{ locale }})
Nom : {{ fullNameText }}
Organisation : {{ organizationText }}
E-mail : {{ emailText }}
Téléphone : {{ phoneText }}
Taille : {{ sizeText }}

Message :
{{ messageText }}

Reçue le {{ createdAt }} (UTC) - anti-bot : {{ captcha }} - consentement {{ consentVersion }}
"),

        // Lot C — accusé de réception au demandeur : contenu fixe FR/AR fourni par le handler
        // (title/body/referenceLabel), aucune reprise du nom ni du message saisis.
        ["contact-request-ack"] = new(
            Code: "contact-request-ack",
            SubjectTemplate: "InstaFact — {{ title }} ({{ reference }})",
            HtmlBodyTemplate: WrapHtml(
                "InstaFact",
                @"<p><strong>{{ title }}</strong></p>
<p>{{ body }}</p>
<p>{{ referenceLabel }} : <strong>{{ reference }}</strong></p>"),
            TextBodyTemplate: @"{{ title }}

{{ body }}

{{ referenceLabel }} : {{ reference }}
")
    };

    /// <summary>Liste les codes de templates connus.</summary>
    public static IReadOnlyCollection<string> AllCodes => Catalog.Keys;

    /// <summary>Récupère un template par son code (insensible à la casse). Renvoie <c>null</c> si inconnu.</summary>
    public static EmailTemplate? Get(string code)
        => Catalog.TryGetValue(code, out var t) ? t : null;

    /// <summary>Wrapper HTML standard avec en-tête + pied de page de marque.</summary>
    private static string WrapHtml(string title, string contentHtml)
    {
        return $@"<!DOCTYPE html>
<html lang=""fr"">
<head>
<meta charset=""utf-8"">
<title>{title}</title>
</head>
<body style=""margin:0;padding:0;font-family:Arial,sans-serif;background:#f4f4f4;color:#1f2937;"">
<table role=""presentation"" width=""100%"" cellpadding=""0"" cellspacing=""0"">
  <tr><td align=""center"" style=""padding:24px;"">
    <table role=""presentation"" width=""600"" cellpadding=""0"" cellspacing=""0"" style=""background:white;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,0.1);"">
      <tr><td style=""padding:24px 32px;border-bottom:1px solid #e5e7eb;"">
        <span style=""font-size:18px;font-weight:600;color:#0d1117;"">InstaFact</span>
      </td></tr>
      <tr><td style=""padding:32px;line-height:1.55;font-size:15px;"">
        {contentHtml}
      </td></tr>
      <tr><td style=""padding:16px 32px;background:#f9fafb;border-top:1px solid #e5e7eb;border-radius:0 0 8px 8px;color:#6b7280;font-size:12px;text-align:center;"">
        InstaFact — Plateforme de gestion commerciale intelligente conforme à la fiscalité tunisienne.
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>";
    }
}
