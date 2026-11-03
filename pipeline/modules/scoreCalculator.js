const AXE_IMPACT_WEIGHTS = {
  critical: 10,
  serious:  7,
  moderate: 4,
  minor:    1,
};

const MODULE_WEIGHTS = {
  axe:          20,

  images:       10,
  links:         7,
  headings:      7,
  readingLevel:  5,
  tables:        3,
  pageTitle:     5,

  visual:        8,
  motor:         8,

  language:     12,
};

function calculateAxeScore(axeResults) {
  if (!axeResults || axeResults._error) return null;

  if (!axeResults.violations || axeResults.violations.length === 0) return 100;

  let penalty = 0;
  for (const violation of axeResults.violations) {
    const weight = AXE_IMPACT_WEIGHTS[violation.impact] || 1;
    penalty += weight * violation.nodes.length;
  }

  return Math.max(0, Math.round(100 - Math.min(penalty, 100)));
}

function calculateFinalScore(axeResults, moduleResults) {
  const scores         = {};
  const excludedModules = [];
  const includedModules = [];

  scores.axe = calculateAxeScore(axeResults);

  const moduleKeys = [
    'images', 'links', 'headings', 'readingLevel',
    'tables', 'pageTitle', 'language',
    'visual', 'motor',
  ];

  for (const key of moduleKeys) {
    const mod = moduleResults[key];
    const score = mod?.score;

    if (
      score !== null &&
      score !== undefined &&
      typeof score === 'number' &&
      !isNaN(score)
    ) {
      scores[key] = Math.max(0, Math.min(100, score));
    } else {
      scores[key] = null;
    }
  }

  let totalWeight  = 0;
  let weightedSum  = 0;

  for (const [key, weight] of Object.entries(MODULE_WEIGHTS)) {
    if (weight <= 0) continue;

    const score = scores[key];

    if (score !== null && score !== undefined) {
      weightedSum += score * weight;
      totalWeight += weight;
      includedModules.push({ module: key, score, weight });
    } else {
      excludedModules.push({
        module: key,
        reason: moduleResults[key]?.error
          ? `module errored: ${moduleResults[key].error.slice(0, 80)}`
          : moduleResults[key]?.skipped
          ? 'module skipped'
          : 'score is null — could not be evaluated',
      });
    }
  }

  const finalScore = totalWeight > 0
    ? Math.round(weightedSum / totalWeight)
    : null;

  const grade = finalScore == null ? 'N/A'
    : finalScore >= 90 ? 'A'
    : finalScore >= 80 ? 'B'
    : finalScore >= 70 ? 'C'
    : finalScore >= 60 ? 'D'
    : 'F';

  const wcagConformance = finalScore == null ? 'Unable to determine'
    : finalScore >= 85 ? 'AA (likely)'
    : finalScore >= 70 ? 'A (partial AA)'
    : finalScore >= 50 ? 'Partial A'
    : 'Non-conformant';

  const effectiveWeights = {};
  for (const { module, weight } of includedModules) {
    effectiveWeights[module] = totalWeight > 0
      ? Math.round((weight / totalWeight) * 100)
      : 0;
  }

  return {
    scores,
    finalScore,
    grade,
    wcagConformance,

    modulesIncluded:       includedModules.length,
    modulesExcluded:       excludedModules.length,
    excludedModules,
    effectiveWeights,
    totalWeightUsed:       totalWeight,
    totalWeightPossible:   Object.values(MODULE_WEIGHTS).reduce((a, b) => a + b, 0),
  };
}

function getScoreColor(score) {
  if (score == null)  return 'unknown';
  if (score >= 80)    return 'good';
  if (score >= 60)    return 'medium';
  return 'poor';
}

module.exports = { calculateFinalScore, calculateAxeScore, getScoreColor };
