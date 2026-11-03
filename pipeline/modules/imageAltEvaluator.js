const axios  = require('axios');
const { askAI } = require('./aiClient');

function detectMediaType(contentType, url) {
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'image/jpeg';
  if (contentType.includes('png'))  return 'image/png';
  if (contentType.includes('webp')) return 'image/webp';
  if (contentType.includes('gif'))  return 'image/gif';
  if (contentType.includes('svg'))  return 'image/svg+xml';
  if (url.match(/\.jpe?g/i)) return 'image/jpeg';
  if (url.match(/\.png/i))   return 'image/png';
  if (url.match(/\.webp/i))  return 'image/webp';
  if (url.match(/\.gif/i))   return 'image/gif';
  if (url.match(/\.svg/i))   return 'image/svg+xml';
  return 'image/jpeg';
}

async function downloadImage(imageUrl, pageUrl) {
  try {
    const absoluteUrl = new URL(imageUrl, pageUrl).href;
    const response = await axios.get(absoluteUrl, {
      responseType: 'arraybuffer',
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Accessibility Auditor)' },
    });
    const buffer    = Buffer.from(response.data);
    const mediaType = detectMediaType(response.headers['content-type'] || '', absoluteUrl);

    if (mediaType === 'image/svg+xml') return null;

    return {
      base64: buffer.toString('base64'),
      mediaType,
      absoluteUrl,
      sizeKb: Math.round(buffer.length / 1024),
    };
  } catch {
    return null;
  }
}

function validateDescriptionResult(result) {
  if (!result || result.error) return null;

  if (typeof result.description !== 'string' || result.description.trim() === '') return null;

  if (typeof result.isDecorative !== 'boolean') return null;

  return result;
}

function validateEvaluationResult(result) {
  if (!result || result.error) return null;

  if (typeof result.pass !== 'boolean') return null;

  if (typeof result.score !== 'number' || isNaN(result.score)) return null;

  result.score = Math.max(0, Math.min(100, result.score));
  return result;
}

async function evaluateImageAltTexts(pageData) {
  const { dom, url } = pageData;
  const results = [];

  for (const img of dom.images) {
    if (!img.src) continue;

    if (img.width > 0 && img.width < 10 && img.height > 0 && img.height < 10) {
      results.push({
        src: img.src,
        skipped: true,
        reason: 'Tracking pixel or tiny icon (<10px)',
      });
      continue;
    }

    if (img.src.startsWith('data:')) {
      if (img.alt === null) {
        results.push({
          src: img.src.slice(0, 40) + '...',
          alt: null,
          pass: false,
          score: 0,
          severity: 'critical',
          issue: 'alt attribute is completely missing from inline data URI image',
          suggestion: 'Add alt="" for decorative images, or a meaningful description for informative images',
          source: 'rule-based',
        });
      } else {
        results.push({
          src: img.src.slice(0, 40) + '...',
          alt: img.alt,
          skipped: true,
          reason: 'Data URI image — skipped for AI analysis, alt attribute present',
        });
      }
      continue;
    }

    if (img.alt === null) {
      results.push({
        src: img.src,
        alt: null,
        pass: false,
        score: 0,
        severity: 'critical',
        issue: 'alt attribute is completely missing from <img> tag',
        suggestion: 'Add alt="" for decorative images, or a meaningful description for informative images',
        aiDescription: null,
        source: 'rule-based',
      });
      continue;
    }

    const imageData = await downloadImage(img.src, url);
    if (!imageData) {
      results.push({
        src: img.src,
        alt: img.alt,
        pass: null,
        score: null,
        skipped: true,
        reason: 'Image could not be downloaded for analysis',
        severity: 'warning',
      });
      continue;
    }

    const descriptionRaw = await askAI(
      `You are an accessibility expert. Describe this image as you would write alt text for it on a website.
Be concise but specific — mention the main subject, any visible text,
the setting or context, and any details important for understanding its purpose.

Return ONLY a JSON object with these exact fields and no other text:
{
  "description": "your generated alt text description of what the image shows",
  "imageType": "one of: photo, icon, chart, logo, banner, decorative, diagram, screenshot, other",
  "hasVisibleText": boolean indicating whether text is visible inside the image,
  "visibleText": "the exact text visible in the image as a string, or null if none",
  "isDecorative": boolean indicating whether this image is purely decorative with no informational value,
  "mainSubject": "one sentence describing the core subject of the image"
}`,
      [{ base64: imageData.base64, mediaType: imageData.mediaType }],
      2000
    );

    const aiDescription = validateDescriptionResult(descriptionRaw);

    if (!aiDescription) {
      results.push({
        src: img.src,
        alt: img.alt,
        pass: null,
        score: null,
        skipped: true,
        reason: 'AI image description failed or returned unusable response',
        severity: 'warning',
        raw: descriptionRaw,
      });
      continue;
    }

    if (aiDescription.isDecorative && img.alt === '') {
      results.push({
        src: img.src,
        alt: img.alt,
        pass: true,
        score: 100,
        imageType: aiDescription.imageType,
        reason: 'Correctly marked decorative with empty alt=""',
        aiDescription: aiDescription.description,
        source: 'ai-decorative-check',
      });
      continue;
    }

    if (!aiDescription.isDecorative && img.alt === '') {
      results.push({
        src: img.src,
        alt: '',
        pass: false,
        score: 0,
        severity: 'critical',
        imageType: aiDescription.imageType,
        issue: 'Meaningful image has empty alt text — screen readers will skip it entirely',
        suggestion: aiDescription.description,
        aiDescription: aiDescription.description,
        source: 'ai-decorative-check',
      });
      continue;
    }

    const evaluationRaw = await askAI(
      `You are a WCAG 1.1.1 accessibility expert evaluating the quality of alt text written by a developer.

IMAGE CONTENT — what the image actually shows (AI-generated description):
"${aiDescription.description}"

Image type: ${aiDescription.imageType}
${aiDescription.hasVisibleText
  ? `Text visible inside the image: "${aiDescription.visibleText}"`
  : 'No visible text inside the image'}

ACTUAL ALT TEXT written by the developer:
"${img.alt}"

SURROUNDING PAGE CONTEXT:
"${img.context}"

Evaluate the alt text on these five WCAG 1.1.1 criteria:

1. Accuracy — does the alt text correctly describe what the image actually shows,
   or does it describe something unrelated or incorrect?

2. Completeness — does it include any visible text from the image and the key
   details a sighted user would notice?

3. Conciseness — is it an appropriate length? Not so short it is meaningless,
   not so long it is exhausting to hear on a screen reader.

4. Contextual fit — is the alt text useful given the surrounding page content?
   Redundant text that just repeats nearby visible text is also a problem.

5. Specificity — is the alt text specific and meaningful, or is it a generic
   placeholder that conveys nothing? Examples of failing specificity:
   "image", "photo", "banner", "logo", "icon", "picture", "graphic", "img",
   "image001", or any single generic word with no further detail.
   These technically exist as alt attributes but are functionally useless.

Return ONLY a JSON object with these exact fields and no other text:
{
  "pass": boolean indicating overall pass or fail,
  "score": number between 0 and 100,
  "severity": "one of: critical, serious, moderate, minor, null",
  "issues": ["describe a specific problem with the alt text"],
  "suggestion": "the improved alt text you would write instead",
  "reasoning": "one sentence explaining the overall assessment",
  "isGenericPlaceholder": boolean indicating if the alt text is a generic useless placeholder,
  "accuracyIssue": boolean indicating if the alt text describes the wrong thing
}`,
      [],
      4000
    );

    const evaluation = validateEvaluationResult(evaluationRaw);

    if (!evaluation) {
      results.push({
        src: img.src,
        alt: img.alt,
        pass: null,
        score: null,
        skipped: true,
        reason: 'AI alt text evaluation failed or returned unusable response',
        severity: 'warning',
        aiDescription: aiDescription.description,
        raw: evaluationRaw,
      });
      continue;
    }

    results.push({
      src: img.src,
      alt: img.alt,
      imageType: aiDescription.imageType,
      isDecorative: aiDescription.isDecorative,
      aiDescription: aiDescription.description,
      visibleTextInImage: aiDescription.visibleText || null,
      pass: evaluation.pass,
      score: evaluation.score,
      severity: evaluation.severity ?? null,
      issues: evaluation.issues ?? [],
      suggestion: evaluation.suggestion ?? null,
      reasoning: evaluation.reasoning ?? null,
      isGenericPlaceholder: evaluation.isGenericPlaceholder ?? false,
      accuracyIssue: evaluation.accuracyIssue ?? false,
      source: 'ai-evaluation',
    });
  }

  const scoredItems = results.filter(
    r => !r.skipped &&
         r.pass !== null &&
         r.score !== null &&
         typeof r.score === 'number' &&
         !isNaN(r.score)
  );

  const failed = scoredItems.filter(r => r.pass === false);

  const moduleScore = scoredItems.length > 0
    ? Math.round(scoredItems.reduce((s, r) => s + r.score, 0) / scoredItems.length)
    : null;

  return {
    moduleName: 'Image Alt Text Quality',
    wcag: '1.1.1',
    total: results.length,
    evaluated: scoredItems.length,
    skipped: results.filter(r => r.skipped).length,
    passed: scoredItems.filter(r => r.pass === true).length,
    failed: failed.length,
    score: moduleScore,
    items: results,
  };
}

module.exports = { evaluateImageAltTexts };
