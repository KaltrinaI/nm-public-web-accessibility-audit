const { askAI } = require('./aiClient');

function validateTitleResult(result) {
  if (!result || result.error) return null;

  if (typeof result.pass !== 'boolean') return null;

  if (typeof result.score !== 'number' || isNaN(result.score)) return null;

  result.score = Math.max(0, Math.min(100, result.score));
  return result;
}

async function evaluatePageTitle(pageData) {
  const { dom, url } = pageData;
  const title = dom.meta.title;

  if (!title || title.trim() === '') {
    return {
      moduleName: 'Page Title Quality',
      wcag: '2.4.2',
      currentTitle: null,
      total: 1,
      passed: 0,
      failed: 1,
      score: 0,
      items: [{
        pass: false,
        score: 0,
        severity: 'critical',
        source: 'rule-based',
        issue: 'Page has no <title> element at all',
        suggestion: 'Add a descriptive title in the format: "Page Purpose — Site Name"',
      }],
    };
  }

  const h1Text            = dom.headings.find(h => h.level === 1)?.text || 'none';
  const metaDescription   = dom.meta.metaDescription || 'none';
  const contentSample     = dom.bodyText.slice(0, 300);
  const characterCount    = title.length;

  const rawResult = await askAI(
    `You are a WCAG 2.4.2 accessibility expert evaluating page title quality.

Screen reader users hear the page title immediately when a page loads.
Browser tab titles help users orient themselves when switching between tabs.
A good title describes the page's unique purpose AND identifies the website.

Page URL: ${url}
Page title: "${title}"
Title character count: ${characterCount}
Page h1 (if any): "${h1Text}"
Page meta description: "${metaDescription}"
Page content sample: "${contentSample}"

Evaluate these six criteria:

1. Specificity — does the title describe THIS specific page, not just the site name?

2. Organisation identification — does it identify the website or organisation?

3. Front-loading — is the most unique information FIRST?
   Good example: "Contact Us — Ministry of Finance"
   Bad example:  "Ministry of Finance - Contact" (buries the page purpose)

4. Conciseness — is it an appropriate length (typically under 60 characters)?
   The title is ${characterCount} characters long.

5. Content match — does the title match what the page is actually about?

6. Generic titles — is it just "Home", "Homepage", "Untitled", or the site name alone?
   These are too generic to be useful for orientation.

Return ONLY a JSON object with these exact fields and no other text:
{
  "pass": boolean indicating whether this title meets WCAG 2.4.2,
  "score": number between 0 and 100,
  "severity": "one of: critical, serious, moderate, minor, null",
  "issues": ["describe a specific problem with this title"],
  "suggestion": "the improved title you would write instead",
  "isTooGeneric": boolean indicating if the title is too generic to be useful,
  "isFrontLoaded": boolean indicating if the most specific information comes first,
  "includesSiteName": boolean indicating if the title includes the site or organisation name,
  "characterCount": ${characterCount}
}`,
    [],
    3000
  );

  const evaluation = validateTitleResult(rawResult);

  if (!evaluation) {
    console.warn(`    ⚠️  [pageTitleEvaluator] AI response invalid or unparseable`);
    return {
      moduleName: 'Page Title Quality',
      wcag: '2.4.2',
      currentTitle: title,
      total: 1,
      passed: 0,
      failed: 0,
      score: null,
      error: 'AI returned unusable response — module excluded from score',
      raw: rawResult,
      items: [],
    };
  }

  return {
    moduleName: 'Page Title Quality',
    wcag: '2.4.2',
    currentTitle: title,
    total: 1,
    passed: evaluation.pass ? 1 : 0,
    failed: evaluation.pass ? 0 : 1,
    score: evaluation.score,
    items: [{
      pass:             evaluation.pass,
      score:            evaluation.score,
      severity:         evaluation.severity       ?? null,
      issues:           evaluation.issues          ?? [],
      suggestion:       evaluation.suggestion      ?? null,
      isTooGeneric:     evaluation.isTooGeneric    ?? null,
      isFrontLoaded:    evaluation.isFrontLoaded   ?? null,
      includesSiteName: evaluation.includesSiteName ?? null,
      characterCount,
      source: 'ai-evaluation',
    }],
  };
}

module.exports = { evaluatePageTitle };
