const { askAI } = require('./aiClient');

function validateReadingLevelResult(result) {
  if (!result || result.error) {
    return null;
  }

  if (typeof result.pass !== 'boolean') {
    return null;
  }

  if (
    typeof result.overallScore !== 'number' ||
    isNaN(result.overallScore)
  ) {
    return null;
  }

  result.overallScore = Math.max(0, Math.min(100, result.overallScore));

  return result;
}

async function evaluateReadingLevel(pageData) {
  const { dom } = pageData;

  if (!dom.bodyText || dom.bodyText.trim().length < 100) {
    return {
      moduleName: 'Reading Level & Plain Language',
      wcag: '3.1.5',
      score: null,
      note: 'Not enough text content to evaluate reading level',
      items: [],
    };
  }

  const rawResult = await askAI(
    `You are a plain language and accessibility expert evaluating a government/public service website.

WCAG 3.1.5 recommends that content be readable at a lower secondary education level (roughly age 12-14),
or that a supplemental version be provided when more complex language is necessary.

Website page title: "${dom.meta.title}"
Detected language: "${dom.langAttribute || 'unknown'}"

Content sample (up to 5000 chars):
"${dom.bodyText}"

Evaluate the following:
1. READING LEVEL — Estimate the education level required to read this content
2. SENTENCE COMPLEXITY — Are sentences overly long or complex?
3. JARGON & TECHNICAL TERMS — Are specialized terms used without explanation?
4. PASSIVE VOICE — Is passive voice overused making content harder to follow?
5. PLAIN LANGUAGE — Is the content written in clear, direct language?
6. INSTRUCTIONS CLARITY — If the page contains instructions, are they step-by-step and clear?

Return ONLY a JSON object with these exact fields and no other text:
{
  "estimatedReadingLevel": "one of: primary, lower-secondary, upper-secondary, university, specialist",
  "estimatedGradeLevel": "approximate grade or year level as a string, for example Grade 8",
  "pass": boolean indicating whether the content meets WCAG 3.1.5,
  "overallScore": number between 0 and 100,
  "severity": "one of: critical, serious, moderate, minor, null",
  "complexSentences": ["example of an overly complex sentence found in the text"],
  "jargonFound": ["technical or specialist term used without explanation"],
  "passiveVoiceExamples": ["example of passive voice that could be rewritten"],
  "positives": ["something the content does well in terms of plain language"],
  "improvements": ["specific actionable suggestion to improve readability"],
  "summary": "two sentence overall assessment of the content readability"
}`,
    [],
    10000
  );

  const evaluation = validateReadingLevelResult(rawResult);

  if (!evaluation) {
    console.warn(`    ⚠️  [readingLevel] AI response invalid or unparseable`);
    return {
      moduleName: 'Reading Level & Plain Language',
      wcag: '3.1.5',
      total: 1,
      passed: 0,
      failed: 0,
      score: null,
      error: 'AI returned an unusable response — module excluded from score',
      raw: rawResult,
      items: [],
    };
  }

  return {
    moduleName: 'Reading Level & Plain Language',
    wcag: '3.1.5',
    total: 1,
    passed: evaluation.pass ? 1 : 0,
    failed: evaluation.pass ? 0 : 1,
    score: evaluation.overallScore,
    severity: evaluation.severity ?? null,
    items: [evaluation],
  };
}

module.exports = { evaluateReadingLevel };
