import type { LandingContactCopy } from '../landing-copy.types';

/**
 * Formulaire de demande d'accès / de démo — traduction AR (TD7) de la copy FR finale (TB7),
 * selon docs/landing/ar-glossary.md.
 *
 * Placeholders injectés par `LandingCopyService.format()` : {min}, {max}, {count},
 * {seconds}, {reference}, {email}. Les placeholders e-mail/téléphone restent en latin
 * (saisie en `dir="ltr"`). Aucune promesse de délai de réponse (exclusion § 6.1).
 */
export const CONTACT_AR: LandingContactCopy = {
  title: 'طلب الوصول أو عرض توضيحي',
  lead: 'صِفوا حاجتكم في بضعة أسطر: نعاود الاتصال بكم سريعاً.',
  subjects: {
    'acces-entreprise': 'طلب الوصول (مؤسسة)',
    'demo-cabinet': 'طلب عرض توضيحي (مكتب محاسبة)',
    entreprise: 'مشروع حسب الطلب (مؤسسة كبرى)',
    autre: 'طلب آخر'
  },
  fields: {
    subject: {
      label: 'موضوع الطلب',
      placeholder: 'اختاروا الموضوع',
      hint: 'نوجّه طلبكم إلى الفريق المناسب.'
    },
    fullName: {
      label: 'الاسم الكامل',
      placeholder: 'الاسم واللقب',
      hint: 'كما سيظهر في مراسلاتنا.'
    },
    organization: {
      label: 'المؤسسة أو المكتب',
      placeholder: 'اسم مؤسستكم أو مكتبكم',
      hint: 'التسمية القانونية أو التجارية.'
    },
    email: {
      label: 'البريد الإلكتروني المهني',
      placeholder: 'name@example.tn',
      hint: 'نجيبكم على هذا العنوان.'
    },
    phone: {
      label: 'الهاتف',
      placeholder: '+216 XX XXX XXX',
      hint: 'رقم تونسي، مع +216 أو بدونه.'
    },
    size: {
      label: 'الحجم',
      placeholder: 'اختاروا',
      hint: 'اختياري: يكفي تقدير تقريبي.'
    },
    message: {
      label: 'الرسالة',
      placeholder: 'صِفوا نشاطكم وأدواتكم الحالية وحاجاتكم.',
      hint: 'بين 10 و2000 حرفاً.'
    },
    consent: {
      label: 'أوافق على استعمال معلوماتي لمعالجة طلبي.',
      linkLabel: 'شروط الاستخدام'
    },
    website: { label: 'الموقع الإلكتروني' }
  },
  sizes: {
    none: 'غير محدد',
    dossiers: [
      { value: 'dossiers:1-5', label: 'من 1 إلى 5 ملفات' },
      { value: 'dossiers:6-20', label: 'من 6 إلى 20 ملفاً' },
      { value: 'dossiers:21-50', label: 'من 21 إلى 50 ملفاً' },
      { value: 'dossiers:50+', label: 'أكثر من 50 ملفاً' }
    ],
    employes: [
      { value: 'employes:1-5', label: 'من 1 إلى 5 أعوان' },
      { value: 'employes:6-20', label: 'من 6 إلى 20 عوناً' },
      { value: 'employes:21-100', label: 'من 21 إلى 100 عون' },
      { value: 'employes:100+', label: 'أكثر من 100 عون' }
    ]
  },
  messageCounter: '{count} / {max}',
  submit: {
    idle: 'إرسال طلبي',
    submitting: 'جارٍ الإرسال…',
    retry: 'إعادة المحاولة',
    another: 'إرسال طلب آخر'
  },
  reassurance: ['دون بطاقة بنكية', 'لا تُباع بياناتكم أبداً'],
  success: {
    title: 'تم تسجيل الطلب',
    reference: 'المرجع: {reference}',
    text: 'نعاود الاتصال بكم سريعاً.'
  },
  errors: {
    required: 'هذا الحقل إجباري.',
    minLength: 'أدخلوا {min} أحرف على الأقل.',
    maxLength: 'أدخلوا {max} حرفاً كحد أقصى.',
    email: 'أدخلوا بريداً إلكترونياً صحيحاً.',
    phone: 'أدخلوا رقماً تونسياً صحيحاً (8 أرقام، مع +216 أو بدونه).',
    consent: 'موافقتكم ضرورية لمعالجة الطلب.',
    validationGlobal: 'بعض الحقول غير صحيحة. صحّحوها ثم أعيدوا المحاولة.',
    rateLimited: 'طلبات كثيرة. أعيدوا المحاولة بعد {seconds} ث.',
    rateLimitedFallback: 'طلبات كثيرة. أعيدوا المحاولة بعد قليل.',
    disabled: 'الاستمارة غير متاحة مؤقتاً. راسلونا على {email}.',
    network: 'تعذّر الاتصال. تحققوا من اتصالكم ثم أعيدوا المحاولة.',
    unknown: 'حدث خطأ. أعيدوا المحاولة بعد قليل.',
    turnstileUnavailable: 'تعذّر تحميل التحقق من الروبوتات. أعيدوا تحميل الصفحة ثم حاولوا من جديد.'
  },
  turnstile: {
    ariaLabel: 'التحقق من الروبوتات'
  }
};

/**
 * Adresse e-mail de repli affichée quand le formulaire est indisponible (503) : le composant
 * l'injecte dans `errors.disabled` via le placeholder `{email}`.
 * NOTE : la clé `fallbackEmail` n'existe pas dans le type `LandingContactCopy` (figé par TD1) ;
 * la constante est exportée ici en attendant une extension additive du type.
 * (Adresse technique, identique en FR et AR.)
 */
export const CONTACT_FALLBACK_EMAIL = 'contact@instafact.shop';
