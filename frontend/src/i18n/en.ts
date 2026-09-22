import type { Strings } from "./types";

export const en: Strings = {
  common: {
    home: "Home",
    help: "Help",
    language: "Language",
    download: "Download",
    paste: "Paste",
    getMedia: "Get Media",
    close: "Close",
    clear: "Clear",
    resolving: "Resolving...",
    downloading: "Downloading...",
    tryAgain: "Try again",
    menu: "Menu",
    mobileNav: "Mobile navigation",
    startDownloading: "Start Downloading",
    backHome: "Back to home",
    emailSupport: "Email Support",
    downloadFailed: "Download failed. Please try again.",
  },
  header: {
    themeToLight: "Switch to light mode",
    themeToDark: "Switch to dark mode",
    openMenu: "Open menu",
    closeMenu: "Close menu",
  },
  nav: {
    features: "Features",
    howItWorks: "How It Works",
    faq: "FAQ",
  },
  hero: {
    badge: "Fast · Free · No login required",
    titleA: "Download Instagram",
    titleB: "Media in Seconds",
    subtitle: "Paste a public Instagram link and preview or save your media in seconds.",
    cardTitle: "Paste an Instagram Link",
    placeholder: "https://www.instagram.com/reel/...",
    audioPlaceholder: "https://www.instagram.com/reel/...",
    inputLabel: "Instagram URL input",
    foot1: "No account required",
    foot2: "Public content only",
    foot3: "No download history",
    analyzing: "Analyzing your link...",
  },
  tabs: {
    reels: "Reels",
    videos: "Videos",
    photos: "Photos",
    stories: "Stories",
    highlights: "Highlights",
    audio: "Audio",
  },
  typeBadges: {
    reel: "Reel",
    post: "Post",
    carousel: "Carousel",
    story: "Story",
    highlight: "Highlight",
    video: "Video",
    photo: "Photo",
    content: "Content",
  },
  steps: {
    eyebrow: "Simple by Design",
    title: "Three steps, that's it",
    subtitle: "A straightforward process that gets out of your way.",
    stepWord: "STEP",
    items: [
      {
        title: "Copy the link",
        desc: "Open the Instagram post, reel, or story you want to save and copy its share link.",
      },
      {
        title: "Paste it here",
        desc: "Drop the link into SnapSave. One paste is all it takes — no complicated setup.",
      },
      {
        title: "Preview and save",
        desc: "We fetch the available media instantly. Choose what you want and download it in full quality.",
      },
    ],
  },
  workflow: {
    title: "How it works",
    subtitle: "Get your Instagram content in 3 simple steps",
    viewAll: "View all features →",
    items: [
      { title: "Copy the link", desc: "Grab the share link from Instagram" },
      { title: "Paste it here", desc: "Drop it into the input above" },
      { title: "Preview & download", desc: "Choose your media and save it" },
    ],
  },
  features: {
    eyebrow: "Capabilities",
    title: "Everything you need to save",
    subtitle: "Supports all the major Instagram content formats, in one refined place.",
    items: [
      {
        title: "Reels",
        desc: "Short-form videos and trending reels, saved in full quality with zero compression.",
      },
      {
        title: "Videos",
        desc: "Standard video posts and IGTV content, ready to watch offline anywhere.",
      },
      {
        title: "Photos",
        desc: "Individual image posts preserved at their original resolution and detail.",
      },
      {
        title: "Carousels",
        desc: "Multi-image and mixed posts — every slide saved individually in one tap.",
      },
      {
        title: "Stories",
        desc: "Public stories from any profile, captured before they disappear.",
      },
      {
        title: "Highlights",
        desc: "Saved highlight collections from public Instagram profiles, all at once.",
      },
      {
        title: "Audio",
        desc: "Extract and save just the audio track from any reel or video, as a clean MP3.",
      },
    ],
  },
  why: {
    eyebrow: "Why SnapSave",
    title: "Built for simplicity",
    subtitle: "Everything you need, nothing you don't.",
    items: [
      {
        title: "Fast link-based workflow",
        desc: "No hoops to jump through. Paste a link, preview the media, and download.",
      },
      {
        title: "Works great on phones",
        desc: "Fully responsive and touch-friendly. Save content right from your mobile browser.",
      },
      {
        title: "Clean media preview",
        desc: "See exactly what you're downloading before saving it. No guesswork involved.",
      },
      {
        title: "Multiple content types",
        desc: "Reels, photos, videos, carousels, stories, and highlights — all in one tool.",
      },
      {
        title: "No account required",
        desc: "Skip the sign-up entirely. The tool works with public content through a simple link.",
      },
      {
        title: "Browser-based tool",
        desc: "Nothing to install. Works directly in your browser, on any modern device.",
      },
    ],
  },
  quick: {
    items: [
      { title: "HD Quality", desc: "Best quality output, every time" },
      { title: "Safe & Secure", desc: "Your privacy matters — no login" },
      { title: "Fast & Reliable", desc: "Download content in seconds" },
      { title: "All Devices", desc: "Works on mobile, tablet & desktop" },
    ],
  },
  faq: {
    eyebrow: "Support",
    title: "Common questions",
    subtitle: "Quick answers to what people usually ask.",
    items: [
      {
        q: "Does SnapSave require login?",
        a: "No. SnapSave works with public links only — no account, login, or password needed.",
      },
      {
        q: "Which Instagram links are supported?",
        a: "Public posts, reels, videos, photos, carousels, stories, and highlights. Private content is never supported.",
      },
      {
        q: "Where are downloaded files saved?",
        a: "Files are saved to your device's default downloads folder — just like any browser download.",
      },
      {
        q: "Is the media stored on SnapSave?",
        a: "No. Media is streamed directly and not permanently stored. Temporary links expire quickly, so download while available.",
      },
      {
        q: "Why can a media link expire?",
        a: "Instagram CDN links are temporary and signed. After a short time they expire — just resolve the original URL again for a fresh link.",
      },
      {
        q: "Why might a download fail?",
        a: "The post may be private or deleted, the link expired, the network dropped, or the content type isn't supported. Check the link and try again.",
      },
      {
        q: "How does Audio mode work?",
        a: "Select the Audio tab, paste a public video link, and SnapSave extracts the audio as an MP3 using server-side processing.",
      },
    ],
  },
  result: {
    audio: "Audio",
    metaVideo: "Video · MP4 · HD",
    metaAudio: "Audio · MP3",
    download: "Download",
    downloadAudio: "Download Audio",
    downloading: "Downloading...",
    tryAgain: "Try again",
    downloadFailed: "Download failed. Please try again.",
    tempNote: "Media links are temporary — download now while available.",
    extractingAudio: "Extracting audio...",
    previewUnavailable: "Preview unavailable",
    newBtn: "New",
    playVideo: "Play video",
    pauseVideo: "Pause video",
    playAudio: "Play audio",
    pauseAudio: "Pause audio",
    videoProgress: "Video progress",
    audioProgress: "Audio progress",
    audioErrorFallback: "Failed to extract audio",
    downloadVideoLabel: "Download video as MP4",
    downloadAudioLabel: "Download audio as MP3",
  },
  errors: {
    empty: "Please enter a link to an Instagram post, reel, story, or highlight.",
    invalid:
      "That doesn't look like a valid Instagram link. Try a link to a post, reel, story, highlight, or video.",
    failed: "Something went wrong. Please try again.",
    unreachable: "Could not reach the server. Check your connection and try again.",
  },
  footer: {
    tagline: "Fast, simple & secure public-media downloader.",
    desc: "Download publicly available videos, photos, reels and audio in a clean, easy-to-use experience.",
    product: "Product",
    resources: "Resources",
    legal: "Legal",
    email: "Email",
    legalLinks: {
      privacy: "Privacy Policy",
      terms: "Terms of Service",
      dmca: "DMCA / Copyright",
      disclaimer: "Disclaimer",
    },
    disclaimer:
      "SnapSave is not affiliated with Instagram or Meta. Only download content you have the right to save.",
    rights: "All rights reserved.",
    madeWith: "Made with ♥ for a simpler web.",
    homeLabel: "SnapSave home",
  },
  help: {
    metaTitle: "Help & Guide | SnapSave",
    metaDesc:
      "Learn how to use SnapSave, troubleshoot common download issues, and find answers to frequently asked questions.",
    title: "How can we help?",
    subtitle: "Everything you need to know about using SnapSave.",
    s1title: "Getting started",
    steps: [
      "Copy the URL of publicly accessible Instagram content.",
      "Open SnapSave in your browser.",
      "Select the right content type tab if needed.",
      "Paste the URL into the input box.",
      'Click "Get Media".',
      "Preview the available media.",
      "Click Download to save it.",
    ],
    s2title: "Supported content",
    s2note:
      "Availability depends on whether the content is publicly accessible and supported by the current backend. Not every Instagram URL will work, and private content is never supported.",
    s3title: "How SnapSave works",
    s3desc:
      "Paste a link and SnapSave detects the content, shows you a preview, and lets you download it. Everything happens through public links — no login needed.",
    flow: ["Link", "Content Detection", "Media Preview", "Download"],
    s4title: "Audio download",
    s4steps: [
      "Select the Audio tab.",
      "Paste a supported public video URL.",
      'Click "Get Media".',
      "SnapSave processes the available video.",
      "Audio becomes available when server-side processing is ready.",
      "Download the MP3 file.",
    ],
    s5title: "Common problems",
    problems: [
      {
        q: "Why isn't my URL working?",
        a: "The URL may be invalid, the content may not be public, removed, temporarily unavailable, expired, or unsupported — or there may be a temporary network issue.",
      },
      {
        q: "Why did my download stop working?",
        a: "Some media URLs are temporary. Resolve the original URL again to get a fresh link.",
      },
      {
        q: "Why can't I download private content?",
        a: "SnapSave only supports publicly accessible content and never bypasses private restrictions. Never share your Instagram password or session cookies.",
      },
      {
        q: "Why is audio extraction unavailable?",
        a: "Audio extraction needs server-side processing and may be temporarily unavailable.",
      },
      {
        q: "Why is the preview not loading?",
        a: "The media link may have expired, or there may be a temporary network or provider issue. Try resolving the link again.",
      },
    ],
    s6title: "Privacy & safety",
    privacy: [
      "SnapSave never asks for your Instagram password.",
      "Only download content you are authorized to use.",
      "Private access controls are never bypassed.",
      "Media links may be temporary.",
      "Resolved links are kept only briefly to complete your request.",
    ],
    s7title: "Frequently asked questions",
    faq: [
      { q: "Is SnapSave free?", a: "Yes, SnapSave is free to use." },
      {
        q: "Do I need an Instagram login?",
        a: "No. Everything works through public links with no login.",
      },
      {
        q: "Can I download private Instagram content?",
        a: "No. Only publicly accessible content is supported.",
      },
      {
        q: "Which content types are supported?",
        a: "Reels, videos, photos, stories, highlights, and audio extraction from videos.",
      },
      {
        q: "Why did my media link expire?",
        a: "Media URLs are temporary. Resolve the original link again for a fresh one.",
      },
      {
        q: "Can I download audio?",
        a: "Yes. Use the Audio tab with a public video link to get an MP3.",
      },
      {
        q: "Why is my URL not working?",
        a: "Check that the link is complete, public, and of a supported type, then try again.",
      },
      {
        q: "Is my Instagram password required?",
        a: "Never. SnapSave will never ask for your password or cookies.",
      },
      {
        q: "How can I report a problem?",
        a: "Describe the issue and the link you tried, then send it to our support email below.",
      },
      { q: "How can I contact SnapSave?", a: "Use the Email Support button below." },
    ],
    supportTitle: "Still need help?",
    supportDesc: "Send us an email and we'll help you with your issue.",
    supportBtn: "Email Support",
  },
};
