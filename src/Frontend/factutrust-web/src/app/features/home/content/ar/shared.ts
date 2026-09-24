import type { LandingSharedCopy } from '../landing-copy.types';

/** Zone partagée AR (header, footer, CTA, sélecteur de langue). Traduction TD7 selon docs/landing/ar-glossary.md. */
export const SHARED_AR: LandingSharedCopy = {
  brand: {
    name: 'InstaFact',
    tagline: 'إدارة تجارية ذكية',
    logoAlt: 'InstaFact — إدارة تجارية ومحاسبة وأجور'
  },
  nav: {
    home: 'الرئيسية',
    modules: 'الوحدات',
    newFeatures: 'الجديد',
    pricing: 'الأسعار',
    cabinets: 'مكاتب المحاسبة',
    security: 'الأمان',
    faq: 'الأسئلة الشائعة',
    login: 'تسجيل الدخول',
    menuOpen: 'فتح القائمة',
    menuClose: 'إغلاق القائمة',
    menuLabel: 'التنقل الرئيسي'
  },
  langSwitcher: {
    label: 'اختيار اللغة',
    fr: 'FR',
    ar: 'العربية',
    switchTo: {
      fr: 'عرض الصفحة بالفرنسية',
      ar: 'عرض الصفحة بالعربية'
    }
  },
  cta: {
    company: {
      open: 'إنشاء حساب مجاني',
      closed: 'طلب الوصول'
    },
    firm: {
      open: 'إنشاء فضاء المكتب',
      closed: 'طلب عرض توضيحي للمكتب'
    },
    skeleton: 'جارٍ تحميل زر الإجراء'
  },
  virtualTour: {
    link: 'الزيارة الافتراضية',
    title: 'شارع InstaFact',
    text: 'تصفحوا الواجهات العمومية للمؤسسات الشريكة (باشتراك اختياري، بيانات عمومية فقط).'
  },
  footer: {
    baseline: 'InstaFact — إدارة تجارية ومحاسبة وأجور للمؤسسات التونسية.',
    logoAlt: 'InstaFact',
    product: {
      title: 'المنتج',
      modules: 'الوحدات',
      newFeatures: 'الجديد',
      pricing: 'الأسعار',
      security: 'الأمان',
      faq: 'الأسئلة الشائعة'
    },
    segments: {
      title: 'الشرائح',
      sme: 'المؤسسات الصغرى والمتوسطة والمحلات التجارية',
      cabinets: 'مكاتب المحاسبة',
      virtualTour: 'الزيارة الافتراضية ثلاثية الأبعاد'
    },
    resources: {
      title: 'الموارد',
      faq: 'الأسئلة الشائعة',
      contact: 'اتصلوا بنا',
      login: 'تسجيل الدخول'
    },
    legal: {
      title: 'قانوني',
      terms: 'شروط الاستخدام',
      legalNotice: 'البيانات القانونية'
    },
    copyright: '© {year} InstaFact. جميع الحقوق محفوظة.'
  },
  common: {
    skipToContent: 'الانتقال إلى المحتوى',
    learnMore: 'اعرفوا المزيد',
    uponActivation: '(حسب التفعيل)',
    currency: 'د.ت',
    perMonth: '/ شهرياً',
    perYear: '/ سنوياً'
  }
};
