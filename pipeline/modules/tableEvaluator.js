const { askAI } = require('./aiClient');

function validateTableResult(result) {
  if (!result || result.error) return null;

  if (typeof result.pass !== 'boolean') return null;

  if (typeof result.score !== 'number' || isNaN(result.score)) return null;

  result.score = Math.max(0, Math.min(100, result.score));
  return result;
}

async function evaluateTableHeaders(pageData) {
  const { dom } = pageData;
  const results = [];

  if (dom.tables.length === 0) {
    return {
      moduleName: 'Table Header Quality',
      wcag: '1.3.1',
      total: 0,
      passed: 0,
      failed: 0,
      score: 100,
      note: 'No tables found on this page',
      items: [],
    };
  }

  for (const table of dom.tables) {
    if (table.headers.length === 0) {
      results.push({
        caption:    table.caption,
        headerCount: 0,
        rowCount:   table.rowCount,
        pass:       false,
        score:      0,
        severity:   'critical',
        source:     'rule-based',
        issue:      'Table has no <th> header elements — screen readers cannot associate data cells with their meaning',
        suggestion: 'Add <th scope="col"> for column headers and <th scope="row"> for row headers',
        sampleData: table.sampleData,
      });
      continue;
    }

    const tableContext = JSON.stringify({
      caption:         table.caption,
      summary:         table.summary,
      headers:         table.headers,
      rowCount:        table.rowCount,
      sampleDataCells: table.sampleData,
    }, null, 2);

    const rawResult = await askAI(
      `You are a WCAG 1.3.1 accessibility expert evaluating data table structure.

Screen reader users navigate tables cell-by-cell. The header text is announced
before each data cell, so headers must be descriptive, unambiguous, and properly
associated with their data cells using scope attributes.

Table details:
${tableContext}

Evaluate these five things:

1. Are the header texts descriptive enough for a screen reader user to understand
   what data is in each column or row?

2. Do the headers use appropriate scope attributes (scope="col" or scope="row")?
   Missing scope attributes make it ambiguous which cells a header applies to.

3. Are any abbreviations in headers explained using the abbr attribute?

4. Is the table caption or summary informative and helpful?

5. For complex tables with merged cells — are there any data cell association issues
   that would confuse screen reader navigation?

Return ONLY a JSON object with these exact fields and no other text:
{
  "pass": boolean indicating whether this table meets WCAG 1.3.1,
  "score": number between 0 and 100,
  "severity": "one of: critical, serious, moderate, minor, null",
  "vagueHeaders": ["header text that is too generic to be meaningful"],
  "missingScope": boolean indicating whether scope attributes are missing from headers,
  "captionIssue": "describe a problem with the caption or summary, or null if adequate",
  "issues": ["describe a specific accessibility problem with this table"],
  "suggestions": ["specific actionable recommendation to fix an issue"]
}`,
      [],
      2000
    );

    const evaluation = validateTableResult(rawResult);

    if (!evaluation) {
      console.warn(`    ⚠️  [tableEvaluator] AI response invalid for table "${table.caption || 'untitled'}"`);
      results.push({
        caption:    table.caption,
        headerCount: table.headers.length,
        rowCount:   table.rowCount,
        pass:       null,
        score:      null,
        skipped:    true,
        reason:     'AI returned unusable response for this table',
        source:     'ai-evaluation',
        raw:        rawResult,
      });
      continue;
    }

    results.push({
      caption:      table.caption,
      headerCount:  table.headers.length,
      rowCount:     table.rowCount,
      pass:         evaluation.pass,
      score:        evaluation.score,
      severity:     evaluation.severity    ?? null,
      vagueHeaders: evaluation.vagueHeaders ?? [],
      missingScope: evaluation.missingScope ?? null,
      captionIssue: evaluation.captionIssue ?? null,
      issues:       evaluation.issues       ?? [],
      suggestions:  evaluation.suggestions  ?? [],
      source:       'ai-evaluation',
    });
  }

  const scoredItems = results.filter(
    r => !r.skipped &&
         r.score !== null &&
         r.score !== undefined &&
         typeof r.score === 'number' &&
         !isNaN(r.score)
  );

  const moduleScore = scoredItems.length > 0
    ? Math.round(scoredItems.reduce((s, r) => s + r.score, 0) / scoredItems.length)
    : null;

  const failed = results.filter(r => r.pass === false);

  return {
    moduleName: 'Table Header Quality',
    wcag: '1.3.1',
    total:   results.length,
    passed:  results.filter(r => r.pass === true).length,
    failed:  failed.length,
    skipped: results.filter(r => r.skipped).length,
    score:   moduleScore,
    items:   results,
  };
}

module.exports = { evaluateTableHeaders };
