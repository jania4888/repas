# Glossaire FR → AR de la landing (InstaFact)

Source de vérité de la terminologie arabe de la landing. Importé par le test de parité
(`landing-copy.parity.spec.ts`) pour bannir les termes exclus. Toute modification est
validée par le client avant la rédaction (TD7) et avant l'activation de
`landing.arabicEnabled`.

## Règles générales

- Arabe standard moderne (MSA), registre B2B ; terminaisons de l'usage officiel tunisien.
- Jamais translittéré : **InstaFact**, **TEJ**, **NCT**. Sigles latins conservés :
  PDF, XML, API, TEJ, NCT, CNSS (avec traduction + sigle latin entre parenthèses à la
  première occurrence pour TVA, DGI, NIF, IRPP, CNSS).
- Chiffres occidentaux (0-9) partout ; montants « 49 د.ت » (nombre en `dir="ltr"`).
- Boutons et infinitifs impersonnels : « إنشاء حساب », « طلب الوصول » (pas d'impératif tutoyé).
- Ponctuation arabe : ، ؛ ؟ — guillemets « ».
- Longueur cible : ≤ FR × 1,3.

## Termes bannis (échec du test de parité)

| Banni | Utiliser |
| --- | --- |
| إنستافاكت | InstaFact (latin) |
| الضريبة على القيمة المضافة | الأداء على القيمة المضافة (TVA) |
| العميل | حريف (sauf liste blanche explicite ci-dessous) |

## Glossaire

| Français | Arabe |
| --- | --- |
| facture | فاتورة |
| facturation / facturation électronique | الفوترة / الفوترة الإلكترونية |
| devis | عرض أسعار |
| bon de livraison | وصل تسليم |
| avoir (facture d') | فاتورة دائنة |
| client / dossier client | حريف / ملف الحريف |
| fournisseur | مزوّد |
| stock | المخزون |
| trésorerie | الخزينة |
| rapprochement bancaire | المطابقة البنكية |
| lettrage | التسوية (التقابض) |
| immobilisations / amortissements | الأصول الثابتة / الاستهلاكات |
| comptabilité | المحاسبة |
| plan comptable | مخطط الحسابات |
| états financiers (NCT) | القوائم المالية (NCT) |
| liasse fiscale / déclaration annuelle | التصريح السنوي (الحزمة الجبائية) |
| déclaration mensuelle (DM) | التصريح الشهري |
| échéancier fiscal | الرزنامة الجبائية |
| TVA | الأداء على القيمة المضافة (TVA) |
| retenue à la source | الخصم من المورد |
| NIF / matricule fiscal | المعرّف الجبائي |
| IRPP | الضريبة على دخل الأشخاص الطبيعيين (IRPP) |
| DGI | الإدارة العامة للأداءات |
| CNSS | الصندوق الوطني للضمان الاجتماعي (CNSS) |
| TEJ (télétransmission) | TEJ – منظومة الفوترة الإلكترونية |
| paie / bulletin de paie | الأجور / كشف الراتب |
| congés | العطل |
| feuille de temps | جدول الساعات |
| note de frais | مذكرة مصاريف |
| expert-comptable | خبير محاسب |
| cabinet comptable / cabinets comptables | مكتب محاسبة / مكاتب المحاسبة |
| collaborateur (cabinet) | معاون (مساعد محاسب) |
| responsable de cabinet | مدير المكتب |
| honoraires | الأتعاب |
| mission (comptable) | مهمة |
| dossier (client) | ملف (الحريف) |
| audit / journal d'audit | التدقيق / سجل التدقيق |
| chaîne d'audit | سلسلة التدقيق |
| tableau de bord | لوحة المتابعة |
| indicateurs | المؤشرات |
| IA / assistant IA | الذكاء الاصطناعي / المساعد الذكي |
| prévisions de trésorerie | توقعات الخزينة |
| sécurité / chiffrement / sauvegarde | الأمان / التشفير / النسخ الاحتياطي |
| authentification à deux facteurs (2FA) | المصادقة الثنائية |
| rôles utilisateurs | أدوار المستخدمين |
| module / modules activables | وحدة / وحدات قابلة للتفعيل |
| point de vente (POS) | نقطة البيع |
| CRM / portail client | إدارة الحرفاء / بوابة الحريف |
| projets / contrats récurrents | المشاريع / العقود الدورية |
| commandes clients | طلبيات الحرفاء |
| tarification et promotions | التسعير والتخفيضات |
| bons de retour / transferts | وصولات الإرجاع / التحويلات |
| intégrations / exports | الاندماجات / التصديرات |
| essai gratuit | تجربة مجانية |
| demander une démo | طلب عرض توضيحي |
| demander un accès | طلب الوصول |
| créer un compte | إنشاء حساب |
| se connecter | تسجيل الدخول |
| nous contacter | اتصلوا بنا |
| en savoir plus | اعرفوا المزيد |
| tarifs | الأسعار |
| par mois / par an | شهرياً / سنوياً |
| dinar tunisien (TND) | دينار تونسي (د.ت) |
| sur devis | حسب عرض الأسعار |
| visite virtuelle | الزيارة الافتراضية |
| menu : Accueil / Fonctionnalités / Sécurité / Tarifs | الرئيسية / المزايا / الأمان / الأسعار |
| cabinets comptables (entrée de menu) | مكاتب المحاسبة |
| nouveautés | الجديد |
| selon activation | حسب التفعيل |
| sans engagement | دون التزام |
| inscription sur invitation | التسجيل بدعوة |

## À trancher par le client (avant TD7)

- « collaborateur » : **معاون** (proposé) ou مساعد محاسب.
- « client » : **حريف** (usage tunisien, proposé) ou عميل (MSA standard).
- « impôt/taxe » générique : **الأداء** (usage tunisien) ou الضريبة (MSA).
