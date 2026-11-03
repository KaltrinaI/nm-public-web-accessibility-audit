const puppeteer = require('puppeteer');
const fs        = require('fs');
const path      = require('path');

const { collectPageData }          = require('./modules/pageCollector');
const { calculateFinalScore }      = require('./modules/scoreCalculator');

const { evaluateImageAltTexts }    = require('./modules/imageAltEvaluator');
const { evaluateLinkTexts }        = require('./modules/linkTextEvaluator');
const { evaluateHeadingStructure } = require('./modules/headingEvaluator');
const { evaluateReadingLevel }     = require('./modules/readingLevelEvaluator');
const { evaluateTableHeaders }     = require('./modules/tableEvaluator');
const { evaluatePageTitle }        = require('./modules/pageTitleEvaluator');
const { evaluateLanguage }         = require('./modules/languageEvaluator');

const { evaluateVisualDisabilities } = require('./modules/visualDisabilityEvaluator');
const { evaluateMotorDisabilities }  = require('./modules/motorDisabilityEvaluator');

const CONFIG = {
  seedUrls: [
    'https://mls.gov.mk/',
  ],

  outputDir: './reports',

  modules: {
    images:       true,
    links:        true,
    headings:     true,
    readingLevel: true,
    tables:       true,
    pageTitle:    true,
    language:     true,
    visual:       true,
    motor:        true,
  },
};

if (!process.env.GEMINI_API_KEY) {
  console.error('\n❌  GEMINI_API_KEY is not set.');
  console.error('    Run: export GEMINI_API_KEY="AIza-your-key-here"\n');
  process.exit(1);
}

async function safeRun(moduleName, fn) {
  try {
    const result = await fn();

    if (result == null) {
      return { moduleName, skipped: true, score: null, items: [] };
    }

    if (result.score === undefined) {
      result.score = null;
    }

    if (result.score !== null && (typeof result.score !== 'number' || isNaN(result.score))) {
      console.warn(`    ⚠️  [${moduleName}] returned non-numeric score: ${result.score} — setting to null`);
      result.score = null;
    }

    return result;
  } catch (err) {
    console.warn(`    ⚠️  Module [${moduleName}] crashed: ${err.message?.slice(0, 120)}`);
    return {
      moduleName,
      error: err.message?.slice(0, 300),
      score: null,
      items: [],
    };
  }
}

function checkModuleHealth(moduleResults) {
  const health = {};
  for (const [key, mod] of Object.entries(moduleResults)) {
    const valid =
      mod != null &&
      !mod.skipped &&
      !mod.error &&
      mod.score !== null &&
      mod.score !== undefined &&
      typeof mod.score === 'number' &&
      !isNaN(mod.score);

    health[key] = {
      valid,
      score:    mod?.score  ?? null,
      skipped:  mod?.skipped ?? false,
      errored:  !!mod?.error,
      errorMsg: mod?.error   ?? null,
    };
  }
  return health;
}

function buildViolationSummary(axeResults, moduleResults) {
  const summary = { critical: [], serious: [], moderate: [], minor: [], total: 0 };

  for (const v of (axeResults?.violations || [])) {
    (summary[v.impact] || summary.moderate).push({
      source:           'axe-core',
      rule:             v.id,
      description:      v.description,
      wcag:             v.tags?.filter(t => t.startsWith('wcag')).join(', '),
      affectedElements: v.nodes.length,
    });
    summary.total++;
  }

  for (const [moduleName, mod] of Object.entries(moduleResults)) {
    if (!mod?.items) continue;
    for (const item of mod.items) {
      if (item.pass === false && item.severity && summary[item.severity]) {
        summary[item.severity].push({
          source:      moduleName,
          rule:        item.test || item.type || 'AI evaluation',
          description: item.issue || item.issues?.[0] || 'See module details',
          wcag:        item.wcag || mod.wcag || null,
          suggestion:  item.suggestion || null,
        });
        summary.total++;
      }
    }
  }

  const allViolations = [
    ...summary.critical,
    ...summary.serious,
    ...summary.moderate,
    ...summary.minor,
  ];
  summary.axeCoreCount = allViolations.filter(v => v.source === 'axe-core').length;
  summary.aiOnlyCount  = allViolations.filter(v => v.source !== 'axe-core').length;

  return summary;
}

async function auditHomepage(browser, url) {
  console.log(`\n  ♿ Auditing: ${url}`);

  const page = await browser.newPage();
  let pageData;

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    pageData = await collectPageData(page, url);
  } catch (err) {
    await page.close();
    console.warn(`  ⚠️  Failed to load: ${err.message}`);
    return { url, error: err.message };
  }
  await page.close();

  const m = CONFIG.modules;

  console.log(`    [1/3] Text AI checks...`);
  const [links, headings, readingLevel, tables, pageTitle] =
    await Promise.all([
      safeRun('links',        () => m.links        ? evaluateLinkTexts(pageData)       : null),
      safeRun('headings',     () => m.headings     ? evaluateHeadingStructure(pageData) : null),
      safeRun('readingLevel', () => m.readingLevel ? evaluateReadingLevel(pageData)     : null),
      safeRun('tables',       () => m.tables       ? evaluateTableHeaders(pageData)     : null),
      safeRun('pageTitle',    () => m.pageTitle    ? evaluatePageTitle(pageData)        : null),
    ]);

  console.log(`    [2/3] Image & language checks...`);
  const images   = await safeRun('images',   () => m.images   ? evaluateImageAltTexts(pageData)     : null);
  const language = await safeRun('language', () => m.language ? evaluateLanguage(pageData, browser) : null);

  console.log(`    [3/3] Disability checks...`);
  const [visual, motor] = await Promise.all([
    safeRun('visual', () => m.visual ? evaluateVisualDisabilities(browser, url)              : null),
    safeRun('motor',  () => m.motor  ? evaluateMotorDisabilities(browser, url, pageData.dom) : null),
  ]);

  const moduleResults = {
    images, links, headings, readingLevel,
    tables, pageTitle, language,
    visual, motor,
  };

  const moduleHealth     = checkModuleHealth(moduleResults);
  const { scores, finalScore, grade, wcagConformance } =
    calculateFinalScore(pageData.axeResults, moduleResults);
  const violationSummary = buildViolationSummary(pageData.axeResults, moduleResults);

  const axeOnlyScore = scores.axe ?? null;
  const delta        = (finalScore != null && axeOnlyScore != null)
    ? finalScore - axeOnlyScore
    : null;

  const failedModules = Object.entries(moduleHealth)
    .filter(([, h]) => h.errored)
    .map(([k]) => k);

  if (failedModules.length > 0) {
    console.warn(`    ⚠️  Modules with errors: ${failedModules.join(', ')}`);
  }

  console.log(
    `    ✅ Hybrid: ${finalScore}/100 (${grade}) | axe-only: ${axeOnlyScore}/100 | ` +
    `delta: ${delta != null ? (delta >= 0 ? '+' : '') + delta : '?'} | ` +
    `violations — axe: ${violationSummary.axeCoreCount} | AI: ${violationSummary.aiOnlyCount}`
  );

  return {
    url,
    isHomepage:  true,
    timestamp:   pageData.timestamp,

    finalScore,
    grade,
    wcagConformance,
    scores,

    axeOnlyScore,
    axeVsHybridDelta: delta,

    axe: {
      violations: pageData.axeResults.violations,
      passCount:  pageData.axeResults.passes.length,
      incomplete: pageData.axeResults.incomplete.length,
    },

    violationSummary,

    moduleHealth,

    modules: moduleResults,
  };
}

async function auditSite(browser, siteUrl) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`🌐  ${siteUrl}`);
  console.log(`${'═'.repeat(70)}`);

  const result = await auditHomepage(browser, siteUrl);

  return {
    site:             siteUrl,
    auditedAt:        new Date().toISOString(),
    score:            result.finalScore          ?? null,
    grade:            result.grade               ?? 'N/A',
    wcagConformance:  result.wcagConformance      ?? 'N/A',
    axeOnlyScore:     result.axeOnlyScore         ?? null,
    axeVsHybridDelta: result.axeVsHybridDelta     ?? null,
    totalViolations:     result.violationSummary?.total            ?? 0,
    axeCoreViolations:   result.violationSummary?.axeCoreCount     ?? 0,
    aiOnlyViolations:    result.violationSummary?.aiOnlyCount      ?? 0,
    criticalViolations:  result.violationSummary?.critical?.length ?? 0,
    disabilityScores: {
      visual:   result.scores?.visual   ?? null,
      motor:    result.scores?.motor    ?? null,
      language: result.scores?.language ?? null,
    },
    languageSummary: {
      albanianVersionFound: result.modules?.language?.albanianVersion?.found        ?? false,
      albanianScore:        result.modules?.language?.albanianVersion?.overallScore ?? null,
    },
    moduleHealth: result.moduleHealth ?? {},
    homepage:     result,
  };
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║    ACCESSIBILITY AUDIT — MASTER THESIS EDITION                 ║');
  console.log('║    AI Engine: Google Gemini 2.5 Flash (FREE)                   ║');
  console.log('║    Scope: Homepage only · Full module suite per site            ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const estimatedCallsPerSite = 20;
  console.log(`Sites to audit:         ${CONFIG.seedUrls.length}`);
  console.log(`Est. API calls:         ~${CONFIG.seedUrls.length * estimatedCallsPerSite} total`);
  console.log(`Free tier daily limit:  1,500 calls`);
  console.log(`Recommended batch:      ${Math.floor(1500 / estimatedCallsPerSite)} sites/day\n`);

  if (!fs.existsSync(CONFIG.outputDir)) {
    fs.mkdirSync(CONFIG.outputDir, { recursive: true });
  }

  const alreadyDone = new Set(
    fs.readdirSync(CONFIG.outputDir)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''))
  );

  const browser = await puppeteer.launch({
    headless: true,
    protocolTimeout: 60000,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  const sessionResults = [];

  try {
    for (const siteUrl of CONFIG.seedUrls) {
      const domain = new URL(siteUrl).hostname.replace(/\./g, '_');

      if (alreadyDone.has(domain)) {
        console.log(`\n⏭️   Already audited — skipping: ${siteUrl}`);
        continue;
      }

      const result = await auditSite(browser, siteUrl);
      sessionResults.push(result);

      const sitePath = path.join(CONFIG.outputDir, `${domain}.json`);
      fs.writeFileSync(sitePath, JSON.stringify(result, null, 2));
      console.log(`\n💾  Saved: ${sitePath}`);
    }
  } finally {
    await browser.close();
  }

  if (sessionResults.length === 0) {
    console.log('\n✅  All sites in this batch already audited.\n');
    return;
  }

  console.log('\n\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                   SESSION COMPLETE ✅                          ║');
  console.log('╠════════════════════════════════════════════════════════════════╣');

  for (const s of sessionResults) {
    const hybrid  = String(s.score        ?? '?').padStart(3);
    const axe     = String(s.axeOnlyScore ?? '?').padStart(3);
    const delta   = s.axeVsHybridDelta != null
      ? (s.axeVsHybridDelta >= 0 ? `+${s.axeVsHybridDelta}` : `${s.axeVsHybridDelta}`)
      : '?';
    const albanian = s.languageSummary.albanianVersionFound
      ? `✅ ${s.languageSummary.albanianScore ?? '?'}/100`
      : '❌ not found';
    const failedMods = Object.entries(s.moduleHealth || {})
      .filter(([, h]) => h.errored)
      .map(([k]) => k)
      .join(', ') || 'none';

    console.log(`║  ${s.site.slice(0, 62).padEnd(62)}  ║`);
    console.log(`║    Hybrid: ${hybrid}/100  |  axe-only: ${axe}/100  |  delta: ${delta.padStart(3)}        ║`);
    console.log(`║    Violations — axe: ${String(s.axeCoreViolations).padStart(2)}  AI-only: ${String(s.aiOnlyViolations).padStart(2)}  |  Albanian: ${albanian}`.padEnd(65) + '║');
    console.log(`║    Module errors: ${failedMods}`.padEnd(65) + '║');
    console.log('║                                                                ║');
  }

  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log(`\n📁  Reports saved to: ${CONFIG.outputDir}/`);
  console.log(`    One JSON file per site: {domain}.json\n`);
}

main().catch(console.error);
