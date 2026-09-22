// Central i18n types. Every language file must satisfy `Strings`,
// so all languages share exactly the same translation keys and
// English is always a complete fallback.

export type LanguageCode =
  | "en" | "hi" | "mr" | "bn" | "gu" | "pa"
  | "ta" | "te" | "kn" | "ml" | "or" | "as";

export interface LanguageMeta {
  code: LanguageCode;
  /** Native-language label shown in the dropdown. */
  label: string;
  /** Short code badge shown in the header. */
  short: string;
}

interface TextPair {
  title: string;
  desc: string;
}

interface QuestionAnswer {
  q: string;
  a: string;
}

export interface Strings {
  common: {
    home: string;
    help: string;
    language: string;
    download: string;
    paste: string;
    getMedia: string;
    close: string;
    clear: string;
    resolving: string;
    downloading: string;
    tryAgain: string;
    menu: string;
    mobileNav: string;
    startDownloading: string;
    backHome: string;
    emailSupport: string;
    downloadFailed: string;
  };
  header: {
    themeToLight: string;
    themeToDark: string;
    openMenu: string;
    closeMenu: string;
  };
  nav: {
    features: string;
    howItWorks: string;
    faq: string;
  };
  hero: {
    badge: string;
    titleA: string;
    titleB: string;
    subtitle: string;
    cardTitle: string;
    placeholder: string;
    audioPlaceholder: string;
    inputLabel: string;
    foot1: string;
    foot2: string;
    foot3: string;
    analyzing: string;
  };
  tabs: {
    reels: string;
    videos: string;
    photos: string;
    stories: string;
    highlights: string;
    audio: string;
  };
  typeBadges: {
    reel: string;
    post: string;
    carousel: string;
    story: string;
    highlight: string;
    video: string;
    photo: string;
    content: string;
  };
  steps: {
    eyebrow: string;
    title: string;
    subtitle: string;
    stepWord: string;
    items: [TextPair, TextPair, TextPair];
  };
  workflow: {
    title: string;
    subtitle: string;
    viewAll: string;
    items: [TextPair, TextPair, TextPair];
  };
  features: {
    eyebrow: string;
    title: string;
    subtitle: string;
    items: [TextPair, TextPair, TextPair, TextPair, TextPair, TextPair, TextPair];
  };
  why: {
    eyebrow: string;
    title: string;
    subtitle: string;
    items: [TextPair, TextPair, TextPair, TextPair, TextPair, TextPair];
  };
  quick: {
    items: [TextPair, TextPair, TextPair, TextPair];
  };
  faq: {
    eyebrow: string;
    title: string;
    subtitle: string;
    items: QuestionAnswer[];
  };
  result: {
    audio: string;
    metaVideo: string;
    metaAudio: string;
    download: string;
    downloadAudio: string;
    downloading: string;
    tryAgain: string;
    downloadFailed: string;
    tempNote: string;
    extractingAudio: string;
    previewUnavailable: string;
    newBtn: string;
    playVideo: string;
    pauseVideo: string;
    playAudio: string;
    pauseAudio: string;
    videoProgress: string;
    audioProgress: string;
    audioErrorFallback: string;
    downloadVideoLabel: string;
    downloadAudioLabel: string;
  };
  errors: {
    empty: string;
    invalid: string;
    failed: string;
    unreachable: string;
  };
  footer: {
    tagline: string;
    desc: string;
    product: string;
    resources: string;
    legal: string;
    email: string;
    legalLinks: {
      privacy: string;
      terms: string;
      dmca: string;
      disclaimer: string;
    };
    disclaimer: string;
    rights: string;
    madeWith: string;
    homeLabel: string;
  };
  help: {
    metaTitle: string;
    metaDesc: string;
    title: string;
    subtitle: string;
    s1title: string;
    steps: [string, string, string, string, string, string, string];
    s2title: string;
    s2note: string;
    s3title: string;
    s3desc: string;
    flow: [string, string, string, string];
    s4title: string;
    s4steps: [string, string, string, string, string, string];
    s5title: string;
    problems: [QuestionAnswer, QuestionAnswer, QuestionAnswer, QuestionAnswer, QuestionAnswer];
    s6title: string;
    privacy: [string, string, string, string, string];
    s7title: string;
    faq: [QuestionAnswer, QuestionAnswer, QuestionAnswer, QuestionAnswer, QuestionAnswer, QuestionAnswer, QuestionAnswer, QuestionAnswer, QuestionAnswer, QuestionAnswer];
    supportTitle: string;
    supportDesc: string;
    supportBtn: string;
  };
}
