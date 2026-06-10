#!/usr/bin/env node
/**
 * Static i18n site generator for the Meme Chat AI marketing site.
 *
 * Reads templates from website/src/*.html and per-locale string dictionaries
 * from website/i18n/<lang>.json, then writes fully-translated, SEO-ready pages
 * into website/public/:
 *
 *   public/index.html            (default / English, x-default)
 *   public/ios.html
 *   public/support.html
 *   public/<lang>/index.html     (one folder per non-default locale)
 *   public/<lang>/ios.html
 *   public/<lang>/support.html
 *
 * Each page gets a self-referential canonical, hreflang alternates for every
 * locale, a localized <html lang>, localized <title>/meta, a language switcher,
 * and (root page only) an auto-detect redirect for first-time visitors.
 *
 * It also generates public/sitemap.xml with hreflang alternates.
 *
 * Run:  node website/build.cjs        (from repo root)
 *   or: npm run build                 (from website/)
 *
 * privacy.html is intentionally NOT generated here — it stays English-only and
 * is maintained by hand, because translating legal text is a liability.
 */

const fs = require("fs");
const path = require("path");

const DOMAIN = process.env.APP_DOMAIN || "meme-chat-ai.com";
const ORIGIN = `https://${DOMAIN}`;

const ROOT = __dirname;
const SRC_DIR = path.join(ROOT, "src");
const I18N_DIR = path.join(ROOT, "i18n");
const OUT_DIR = path.join(ROOT, "public");

// First entry is the default locale (served at the site root, x-default).
const LOCALES = ["en", "es", "pt", "fr", "de", "ru", "ja", "zh", "hi"];
const DEFAULT_LOCALE = LOCALES[0];

// hreflang codes for the <link rel="alternate"> tags. Keep simple ISO-639-1
// codes; Google matches these to the user's Accept-Language.
const HREFLANG = {
  en: "en",
  es: "es",
  pt: "pt",
  fr: "fr",
  de: "de",
  ru: "ru",
  ja: "ja",
  zh: "zh",
  hi: "hi",
};

// Native names shown in the language switcher.
const NATIVE_NAME = {
  en: "English",
  es: "Español",
  pt: "Português",
  fr: "Français",
  de: "Deutsch",
  ru: "Русский",
  ja: "日本語",
  zh: "中文",
  hi: "हिन्दी",
};

// Pages to generate. slug "" => index (folder root); others map to <slug>.html.
const PAGES = [
  { template: "index.html", slug: "", out: "index.html" },
  { template: "ios.html", slug: "ios", out: "ios.html" },
  { template: "support.html", slug: "support", out: "support.html" },
];

// ---------- helpers ----------

function flatten(obj, prefix = "", target = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      flatten(value, full, target);
    } else {
      target[full] = value;
    }
  }
  return target;
}

function loadDict(locale) {
  const file = path.join(I18N_DIR, `${locale}.json`);
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  return flatten(raw);
}

// Path of a page for a given locale, e.g. ("es","ios") -> "/es/ios", ("en","") -> "/",
// ("es","") -> "/es". No trailing slash on locale roots — hosting uses
// trailingSlash:false, so "/es/" would 301-redirect to "/es".
function pagePath(locale, slug) {
  const prefix = locale === DEFAULT_LOCALE ? "" : `/${locale}`;
  if (slug === "") return prefix === "" ? "/" : prefix;
  return `${prefix}/${slug}`;
}

// Build the hreflang <link> block for a page across every locale.
function alternates(slug) {
  const links = LOCALES.map(
    (loc) =>
      `    <link rel="alternate" hreflang="${HREFLANG[loc]}" href="${ORIGIN}${pagePath(loc, slug)}" />`,
  );
  links.push(
    `    <link rel="alternate" hreflang="x-default" href="${ORIGIN}${pagePath(DEFAULT_LOCALE, slug)}" />`,
  );
  return links.join("\n");
}

// Build the language switcher markup for a page (links to the same page in
// every locale; current locale marked aria-current).
function switcher(locale, slug, dict) {
  const items = LOCALES.map((loc) => {
    const href = pagePath(loc, slug);
    const current = loc === locale ? ' aria-current="true"' : "";
    return `        <a href="${href}" data-lang="${loc}"${current}>${NATIVE_NAME[loc]}</a>`;
  }).join("\n");
  const label = dict["common.languageLabel"] || "Language";
  return `      <details class="lang-switch">
        <summary aria-label="${label}">🌐 ${NATIVE_NAME[locale]}</summary>
        <div class="lang-menu">
${items}
        </div>
      </details>`;
}

// Tiny script: remember the locale of any page the visitor lands on / picks,
// so the root redirect respects their last choice.
function rememberScript(locale) {
  return `    <script>try{localStorage.setItem("mcai_lang",${JSON.stringify(locale)});}catch(e){}</script>`;
}

// Root-only auto-detect: on first visit to "/", send the visitor to their
// language (stored preference first, then browser languages). Crawlers don't
// run this and don't send Accept-Language, so "/" stays indexable as English.
function redirectScript() {
  const supported = JSON.stringify(LOCALES.filter((l) => l !== DEFAULT_LOCALE));
  return `    <script>
      (function () {
        if (location.pathname !== "/") return;
        var supported = ${supported};
        var target = null;
        try {
          var saved = localStorage.getItem("mcai_lang");
          if (saved) target = saved === ${JSON.stringify(DEFAULT_LOCALE)} ? null : (supported.indexOf(saved) >= 0 ? saved : null);
          else {
            var langs = navigator.languages || [navigator.language || ""];
            for (var i = 0; i < langs.length && !target; i++) {
              var code = (langs[i] || "").toLowerCase().split("-")[0];
              if (supported.indexOf(code) >= 0) target = code;
            }
          }
        } catch (e) {}
        if (target) location.replace("/" + target);
      })();
    </script>`;
}

// Click handler so switcher choices persist before navigation.
const SWITCHER_PERSIST = `    <script>
      document.addEventListener("click", function (e) {
        var a = e.target.closest && e.target.closest(".lang-menu a[data-lang]");
        if (a) { try { localStorage.setItem("mcai_lang", a.getAttribute("data-lang")); } catch (err) {} }
      });
    </script>`;

function render(template, vars) {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (m, key) => {
    if (key in vars) return vars[key];
    throw new Error(`Missing template key: ${key}`);
  });
}

// ---------- generate ----------

function buildPage(locale, dict, page) {
  const template = fs.readFileSync(path.join(SRC_DIR, page.template), "utf8");
  const isRoot = page.slug === "" && locale === DEFAULT_LOCALE;

  const computed = {
    __HTML_LANG__: HREFLANG[locale],
    __ORIGIN__: ORIGIN,
    __CANONICAL__: `${ORIGIN}${pagePath(locale, page.slug)}`,
    __PREFIX__: locale === DEFAULT_LOCALE ? "" : `/${locale}`,
    __HOME__: pagePath(locale, ""),
    __ALTERNATES__: alternates(page.slug),
    __SWITCHER__: switcher(locale, page.slug, dict),
    __SCRIPTS__: [
      rememberScript(locale),
      SWITCHER_PERSIST,
      isRoot ? redirectScript() : "",
    ]
      .filter(Boolean)
      .join("\n"),
  };

  const vars = Object.assign({}, dict, computed);
  const html = render(template, vars);

  const dir =
    locale === DEFAULT_LOCALE ? OUT_DIR : path.join(OUT_DIR, locale);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, page.out), html, "utf8");
  return path.relative(OUT_DIR, path.join(dir, page.out));
}

function buildSitemap() {
  const lastmod = new Date().toISOString().slice(0, 10);
  const urls = [];
  // Localized marketing pages with hreflang alternates.
  for (const page of PAGES) {
    for (const locale of LOCALES) {
      const loc = `${ORIGIN}${pagePath(locale, page.slug)}`;
      const xhtml = LOCALES.map(
        (l) =>
          `    <xhtml:link rel="alternate" hreflang="${HREFLANG[l]}" href="${ORIGIN}${pagePath(l, page.slug)}" />`,
      ).join("\n");
      const priority = page.slug === "" ? "1.0" : page.slug === "ios" ? "0.8" : "0.5";
      urls.push(
        `  <url>\n    <loc>${loc}</loc>\n${xhtml}\n    <changefreq>monthly</changefreq>\n    <priority>${priority}</priority>\n  </url>`,
      );
    }
  }
  // Privacy stays English-only.
  urls.push(
    `  <url>\n    <loc>${ORIGIN}/privacy</loc>\n    <changefreq>yearly</changefreq>\n    <priority>0.3</priority>\n  </url>`,
  );
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join("\n")}\n</urlset>\n`;
  fs.writeFileSync(path.join(OUT_DIR, "sitemap.xml"), xml, "utf8");
}

function main() {
  const written = [];
  const skipped = [];
  for (const locale of LOCALES) {
    if (!fs.existsSync(path.join(I18N_DIR, `${locale}.json`))) {
      skipped.push(locale);
      continue;
    }
    const dict = loadDict(locale);
    for (const page of PAGES) {
      written.push(buildPage(locale, dict, page));
    }
  }
  if (skipped.length) console.log(`Skipped (no dictionary yet): ${skipped.join(", ")}`);
  buildSitemap();
  written.push("sitemap.xml");
  console.log(`Built ${written.length} files for ${LOCALES.length} locales:`);
  for (const f of written) console.log(`  ${f.replace(/\\/g, "/")}`);
}

main();
