const { askAI } = require('./aiClient');

function validateSemanticResult(result) {
  if (!result || result.error) return null;

  if (typeof result.overallPass !== 'boolean') return null;

  if (typeof result.overallScore !== 'number' || isNaN(result.overallScore)) return null;

  result.overallScore = Math.max(0, Math.min(100, result.overallScore));

  return result;
}

async function evaluateHeadingStructure(pageData) {
  const { dom } = pageData;
  const results = [];

  if (dom.headings.length === 0) {
    return {
      moduleName: 'Heading Structure Logic',
      wcag: '1.3.1 / 2.4.6',
      total: 0,
      passed: 0,
      failed: 1,
      score: 0,
      items: [{
        pass: false,
        score: 0,
        severity: 'serious',
        issue: 'No heading elements found on page',
        suggestion: 'Add a logical heading structure starting with h1 for the main page topic',
      }],
    };
  }

  const h1s = dom.headings.filter(h => h.level === 1);

  if (h1s.length === 0) {
    results.push({
      type: 'missing-h1',
      pass: false,
      score: 0,
      severity: 'critical',
      issue: 'Page has no h1 element — every page needs exactly one h1 as the main topic',
      suggestion: 'Add a single h1 that describes the main purpose of this page',
    });
  } else if (h1s.length > 1) {
    results.push({
      type: 'multiple-h1',
      pass: false,
      score: 40,
      severity: 'moderate',
      issue: `Page has ${h1s.length} h1 elements — there should be exactly one`,
      h1Texts: h1s.map(h => h.text),
      suggestion: 'Keep one h1 for the primary page title, convert others to h2',
    });
  }

  for (let i = 1; i < dom.headings.length; i++) {
    const prev = dom.headings[i - 1];
    const curr = dom.headings[i];
    if (curr.level - prev.level > 1) {
      results.push({
        type: 'skipped-level',
        pass: false,
        score: 50,
        severity: 'moderate',
        issue: `Heading jumps from h${prev.level} ("${prev.text}") to h${curr.level} ("${curr.text}") — levels should not skip`,
        suggestion: `Change h${curr.level} to h${prev.level + 1} or add intermediate heading levels`,
      });
    }
  }

  const headingTree = dom.headings
    .map(h => `${'  '.repeat(h.level - 1)}h${h.level}: "${h.text}"`)
    .join('\n');

  const rawResult = await askAI(
    `You are a WCAG 2.4.6 accessibility expert evaluating the semantic quality of page headings.

Screen reader users often navigate pages by headings alone, using them as a table of
contents to understand page structure and jump to sections. Headings must be descriptive
and reflect the actual content structure of the page.

Heading hierarchy found on this page:
${headingTree}

Page title: "${dom.meta.title}"
Page body text sample: "${dom.bodyText.slice(0, 800)}"

Evaluate these five things:
1. Does the heading hierarchy accurately represent the page content structure?
2. Are headings descriptive enough to understand section content without reading the full text?
3. Do headings at the same level have comparable importance (parallel structure)?
4. Does the h1 clearly reflect the main topic of the page?
5. Are there content sections that clearly need a heading but do not have one?

Return ONLY a JSON object with these exact fields and no other text:
{
  "overallPass": boolean indicating whether headings meet WCAG 2.4.6 semantic requirements,
  "overallScore": number between 0 and 100,
  "severity": "one of: critical, serious, moderate, minor, null",
  "issues": ["describe a specific semantic heading problem found"],
  "missingSections": ["describe a content section that needs a heading but does not have one"],
  "vagueHeadings": ["heading text that is too generic to be useful"],
  "suggestions": ["specific actionable improvement"],
  "summary": "one sentence overall assessment of the heading quality"
}`,
    [],
    3500
  );

  const semanticEval = validateSemanticResult(rawResult);

  if (!semanticEval) {
    console.warn(`    ⚠️  [headingEvaluator] AI semantic evaluation response invalid`);
    results.push({
      type: 'semantic-quality',
      pass: null,
      score: null,
      error: 'AI returned unusable response — semantic quality not scored',
      raw: rawResult,
    });
  } else {
    results.push({
      type: 'semantic-quality',
      pass: semanticEval.overallPass,
      score: semanticEval.overallScore,
      severity: semanticEval.severity ?? null,
      issues: semanticEval.issues ?? [],
      missingSections: semanticEval.missingSections ?? [],
      vagueHeadings: semanticEval.vagueHeadings ?? [],
      suggestions: semanticEval.suggestions ?? [],
      summary: semanticEval.summary ?? null,
    });
  }

  const scoredItems = results.filter(
    r => r.score !== null && r.score !== undefined &&
         typeof r.score === 'number' && !isNaN(r.score)
  );

  const moduleScore = scoredItems.length > 0
    ? Math.round(scoredItems.reduce((s, r) => s + r.score, 0) / scoredItems.length)
    : null;

  const failed = results.filter(r => r.pass === false);

  return {
    moduleName: 'Heading Structure Logic',
    wcag: '1.3.1 / 2.4.6',
    headingCount: dom.headings.length,
    headingTree: dom.headings.map(h => ({ level: h.level, text: h.text })),
    total: results.length,
    passed: results.filter(r => r.pass === true).length,
    failed: failed.length,
    score: moduleScore,
    items: results,
  };
}

module.exports = { evaluateHeadingStructure };
