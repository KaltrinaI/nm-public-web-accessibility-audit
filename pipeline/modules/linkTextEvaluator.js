const { askAI } = require('./aiClient');

const VAGUE_PATTERNS = /^(click here|here|read more|more|learn more|this|link|download|view|see more|details|info|click|go|visit|open|continue|next|previous|back|forward|submit|ok|yes|no|\.\.\.)$/i;

function validateLinkResult(item) {
  if (!item || typeof item !== 'object') return null;

  if (typeof item.pass !== 'boolean') return null;

  if (typeof item.score !== 'number' || isNaN(item.score)) return null;

  item.score = Math.max(0, Math.min(100, item.score));
  return item;
}

async function evaluateLinkTexts(pageData) {
  const { dom } = pageData;
  const results = [];

  const linksToCheck = dom.links.filter(link => {
    if (!link.text && !link.ariaLabel) return false;
    if (link.ariaLabel) return false;
    if (link.hasImage && !link.text) return false;
    if (!link.href) return false;
    if (link.href.startsWith('mailto:')) return false;
    if (link.href.startsWith('tel:')) return false;
    if (link.href.startsWith('javascript:')) return false;
    return true;
  });

  const batchSize = 10;

  for (let i = 0; i < linksToCheck.length; i += batchSize) {
    const batch = linksToCheck.slice(i, i + batchSize);

    const rawResult = await askAI(
      `You are a WCAG 2.4.4 accessibility expert evaluating link text quality.

A screen reader user often navigates a page by cycling through links only,
hearing each link text without any surrounding context. Link text must be
descriptive enough to understand the destination or purpose on its own.

For each link below, evaluate:
1. Is the link text descriptive enough when read completely out of context?
2. Does it clearly communicate where the link goes or what it does?
3. Is it unique enough to distinguish from other links on the same page?
4. If it opens in a new tab, does the link text warn the user?

Links to evaluate:
${JSON.stringify(batch.map(l => ({
  text: l.text,
  context: l.context?.slice(0, 150),
  href: l.href?.slice(0, 80),
  isNavigation: l.isNavigation,
  openNewTab: l.openNewTab,
})), null, 2)}

Return ONLY a JSON array with exactly ${batch.length} objects in the SAME ORDER as the input.
Each object must have these exact fields and no other text:
[{
  "text": "the original link text being evaluated",
  "pass": boolean indicating whether this link text is acceptable,
  "score": number between 0 and 100,
  "severity": "one of: critical, serious, moderate, minor, null",
  "issue": "describe the specific problem with this link text, or null if passing",
  "suggestion": "a better link text you would write instead, or null if passing",
  "additionalIssue": "describe any secondary issue such as opening a new tab without warning, or null"
}]`,
      [],
      10000
    );

    if (!Array.isArray(rawResult)) {
      console.warn(`    ⚠️  [linkTextEvaluator] Batch ${Math.floor(i / batchSize) + 1} returned non-array — skipping batch`);

      batch.forEach(link => {
        results.push({
          ...link,
          pass: null,
          score: null,
          skipped: true,
          reason: 'AI batch evaluation failed for this batch',
        });
      });
      continue;
    }

    rawResult.forEach((item, idx) => {
      const link = batch[idx];
      if (!link) return;

      const validated = validateLinkResult(item);

      if (!validated) {
        results.push({
          ...link,
          pass: null,
          score: null,
          skipped: true,
          reason: 'AI returned invalid result for this link',
          raw: item,
        });
      } else {
        results.push({
          ...link,
          pass: validated.pass,
          score: validated.score,
          severity: validated.severity ?? null,
          issue: validated.issue ?? null,
          suggestion: validated.suggestion ?? null,
          additionalIssue: validated.additionalIssue ?? null,
        });
      }
    });
  }

  const linkTextMap = {};
  dom.links.forEach(l => {
    if (!l.text) return;
    const key = l.text.toLowerCase().trim();
    if (!linkTextMap[key]) linkTextMap[key] = new Set();
    linkTextMap[key].add(l.href);
  });

  const duplicateIssues = [];
  for (const [text, hrefs] of Object.entries(linkTextMap)) {
    if (hrefs.size > 1 && VAGUE_PATTERNS.test(text)) {
      duplicateIssues.push({
        text,
        pass: false,
        score: 20,
        severity: 'serious',
        source: 'rule-based',
        issue: `"${text}" is used for ${hrefs.size} different destinations — screen reader users cannot distinguish them`,
        suggestion: 'Give each link unique descriptive text that reflects its specific destination',
        duplicateCount: hrefs.size,
      });
    }
  }

  const allResults = [...results, ...duplicateIssues];

  const scoredItems = allResults.filter(
    r => !r.skipped &&
         r.pass !== null &&
         r.score !== null &&
         typeof r.score === 'number' &&
         !isNaN(r.score)
  );

  const moduleScore = scoredItems.length > 0
    ? Math.round(scoredItems.reduce((s, r) => s + r.score, 0) / scoredItems.length)
    : null;

  const failed = scoredItems.filter(r => r.pass === false);

  return {
    moduleName: 'Link Text Meaningfulness',
    wcag: '2.4.4',
    total: allResults.length,
    evaluated: scoredItems.length,
    skipped: allResults.filter(r => r.skipped).length,
    passed: scoredItems.filter(r => r.pass === true).length,
    failed: failed.length,
    score: moduleScore,
    items: allResults,
  };
}

module.exports = { evaluateLinkTexts };
