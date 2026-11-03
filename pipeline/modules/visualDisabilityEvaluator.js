const { askAI } = require('./aiClient');

const wait = ms => new Promise(r => setTimeout(r, ms));

function validateVisualResult(result, testName, wcag) {
  if (!result || result.error) {
    return {
      test: testName,
      wcag,
      pass: null,
      score: null,
      error: result?.error || result?.raw || 'AI returned no usable response',
    };
  }

  if (typeof result.pass !== 'boolean') {
    return {
      test: testName,
      wcag,
      pass: null,
      score: null,
      error: `AI response missing valid "pass" field — got: ${JSON.stringify(result.pass)}`,
      raw: result,
    };
  }

  const score = typeof result.score === 'number' && !isNaN(result.score)
    ? Math.max(0, Math.min(100, result.score))
    : null;

  return { ...result, test: testName, wcag, score };
}

async function testFocusIndicators(browser, url) {
  const page = await browser.newPage();
  const results = [];

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });

    const outlineNoneFound = await page.evaluate(() => {
      const sheets = [...document.styleSheets];
      for (const sheet of sheets) {
        try {
          const rules = [...sheet.cssRules || []];
          for (const rule of rules) {
            if (
              rule.cssText &&
              rule.cssText.includes('outline') &&
              (rule.cssText.includes(': none') || rule.cssText.includes(':none') ||
               rule.cssText.includes(': 0') || rule.cssText.includes(':0')) &&
              (rule.selectorText?.includes(':focus') || rule.selectorText?.includes('*'))
            ) {
              return { found: true, rule: rule.cssText.slice(0, 200) };
            }
          }
        } catch {  }
      }
      return { found: false };
    });

    if (outlineNoneFound.found) {
      results.push({
        test: 'CSS outline:none on focus',
        pass: false,
        score: 0,
        severity: 'critical',
        wcag: '2.4.7',
        issue: 'CSS removes focus outline globally — keyboard users have no visible focus indicator',
        detail: outlineNoneFound.rule,
        suggestion: 'Remove outline:none from :focus selectors, or replace with a custom visible focus style',
      });
    }

    const beforeScreenshot = await page.screenshot({ encoding: 'base64' });
    await page.keyboard.press('Tab');
    await wait(300);
    const afterScreenshot = await page.screenshot({ encoding: 'base64' });

    const focusRaw = await askAI(
      `You are a WCAG 2.4.7 accessibility expert evaluating focus indicator visibility.

I am showing you two screenshots of the same webpage:
- Image 1: the page before any keyboard interaction (no element focused)
- Image 2: the page after pressing the Tab key once (one element should be focused)

Your task:
1. Compare the two images and identify whether a visible focus indicator appeared in Image 2.
2. Describe exactly what you see (outline, highlight, underline, box shadow, etc.)
3. Assess whether it meets sufficient contrast to be perceivable.
4. Assess whether it appears to meet the WCAG 2.4.11 minimum 2px outline size.

Return ONLY a JSON object with these exact fields and no other text:
{
  "focusVisibleInScreenshot": boolean,
  "focusIndicatorDescription": "describe what changed between image 1 and image 2, or say none visible",
  "meetsContrastRequirement": boolean,
  "pass": boolean,
  "score": number between 0 and 100,
  "severity": "critical or serious or moderate or minor or null",
  "issue": "describe the problem or null if passing",
  "suggestion": "how to fix or null if passing"
}`,
      [
        { base64: beforeScreenshot, mediaType: 'image/png' },
        { base64: afterScreenshot,  mediaType: 'image/png' },
      ],
      4000
    );

    results.push(validateVisualResult(focusRaw, 'Focus indicator visibility', '2.4.7 / 2.4.11'));
  } catch (err) {
    results.push({
      test: 'Focus indicator visibility',
      wcag: '2.4.7',
      pass: null,
      score: null,
      error: err.message,
    });
  } finally {
    await page.close();
  }

  return results;
}

async function testZoomReflow(browser, url) {
  const results = [];
  const page = await browser.newPage();

  try {
    await page.setViewport({ width: 320, height: 568, deviceScaleFactor: 2 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });

    const zoomedScreenshot = await page.screenshot({ encoding: 'base64', fullPage: false });

    const hasHorizontalScroll = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth
    );

    const overflowIssues = await page.evaluate(() => {
      const issues = [];
      for (const el of document.querySelectorAll('p, h1, h2, h3, li, td, span')) {
        if (el.scrollWidth > el.clientWidth && el.clientWidth > 0) {
          issues.push({
            tag: el.tagName,
            text: el.innerText?.slice(0, 50),
            overflow: el.scrollWidth - el.clientWidth,
          });
        }
      }
      return issues.slice(0, 5);
    });

    const overflowSummary = overflowIssues.length > 0
      ? overflowIssues.map(i => `<${i.tag}> overflows by ${i.overflow}px: "${i.text}"`).join('; ')
      : 'none detected';

    const zoomRaw = await askAI(
      `You are evaluating a webpage screenshot taken at a 320px wide viewport (equivalent to 200% browser zoom).

WCAG 1.4.10 Reflow requires that content remains readable at 320px width without requiring horizontal scrolling.

Measurements from the page:
- Horizontal scroll present: ${hasHorizontalScroll}
- Text overflow elements: ${overflowSummary}

Look at the screenshot and evaluate:
1. Can the main content be read without horizontal scrolling?
2. Is any text visibly cut off, clipped, or overlapping other elements?
3. Is the overall layout still usable and functional at this width?

Return ONLY a JSON object with these exact fields and no other text:
{
  "pass": boolean,
  "score": number between 0 and 100,
  "severity": "critical or serious or moderate or minor or null",
  "hasHorizontalScroll": boolean,
  "textOverflowCount": number,
  "visualIssues": ["list any specific issues you see, or empty array if none"],
  "suggestion": "recommendation to fix the issues, or null if passing"
}`,
      [{ base64: zoomedScreenshot, mediaType: 'image/png' }],
      4000
    );

    const validated = validateVisualResult(zoomRaw, 'Zoom/Reflow at 200%', '1.4.10');
    results.push({
      ...validated,
      hasHorizontalScroll,
      textOverflowCount: overflowIssues.length,
      overflowElements: overflowIssues,
    });
  } catch (err) {
    results.push({
      test: 'Zoom/Reflow at 200%',
      wcag: '1.4.10',
      pass: null,
      score: null,
      error: err.message,
    });
  } finally {
    await page.close();
  }

  return results;
}

async function testTextSpacing(browser, url) {
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });

    await page.addStyleTag({
      content: `
        * {
          line-height: 1.5 !important;
          letter-spacing: 0.12em !important;
          word-spacing: 0.16em !important;
        }
        p { margin-bottom: 2em !important; }
      `,
    });

    await wait(500);

    const spacedScreenshot = await page.screenshot({ encoding: 'base64', fullPage: false });

    const clippedElements = await page.evaluate(() => {
      const clipped = [];
      for (const el of document.querySelectorAll('p, h1, h2, h3, li, button, a, span')) {
        if (el.scrollHeight > el.clientHeight && el.clientHeight > 0 &&
            window.getComputedStyle(el).overflow === 'hidden') {
          clipped.push({
            tag: el.tagName,
            text: el.innerText?.slice(0, 60),
          });
        }
      }
      return clipped.slice(0, 5);
    });

    const clippedSummary = clippedElements.length > 0
      ? clippedElements.map(e => `<${e.tag}>: "${e.text}"`).join('; ')
      : 'none detected';

    const spacingRaw = await askAI(
      `You are evaluating WCAG 1.4.12 Text Spacing compliance.

The screenshot shows a webpage after injecting these CSS overrides:
- line-height: 1.5
- letter-spacing: 0.12em
- word-spacing: 0.16em
- paragraph margin-bottom: 2em

According to WCAG 1.4.12, no content or functionality should be lost when users apply these overrides.

Programmatic clipping detected: ${clippedSummary}

Look at the screenshot and evaluate:
1. Is any text visibly cut off or hidden inside fixed-height containers?
2. Do any buttons or UI elements clip their label text?
3. Does the layout break in a way that makes content unreadable or unusable?

Return ONLY a JSON object with these exact fields and no other text:
{
  "pass": boolean,
  "score": number between 0 and 100,
  "severity": "critical or serious or moderate or minor or null",
  "contentClipped": boolean,
  "layoutBroken": boolean,
  "issues": ["list specific issues found, or empty array if none"],
  "suggestion": "how to fix or null if passing"
}`,
      [{ base64: spacedScreenshot, mediaType: 'image/png' }],
      3000
    );

    const validated = validateVisualResult(spacingRaw, 'Text Spacing Override', '1.4.12');
    return [{
      ...validated,
      clippedElementsFound: clippedElements.length,
      clippedElements,
    }];
  } catch (err) {
    return [{
      test: 'Text Spacing Override',
      wcag: '1.4.12',
      pass: null,
      score: null,
      error: err.message,
    }];
  } finally {
    await page.close();
  }
}

async function testColorModeSupport(browser, url) {
  const results = [];
  const page = await browser.newPage();

  try {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
    const darkScreenshot = await page.screenshot({ encoding: 'base64', fullPage: false });

    const mediaQuerySupport = await page.evaluate(() => {
      const sheets = [...document.styleSheets];
      let hasDarkMode = false, hasReducedMotion = false, hasForcedColors = false;
      for (const sheet of sheets) {
        try {
          for (const rule of [...sheet.cssRules || []]) {
            if (rule.conditionText) {
              if (rule.conditionText.includes('prefers-color-scheme')) hasDarkMode = true;
              if (rule.conditionText.includes('prefers-reduced-motion')) hasReducedMotion = true;
              if (rule.conditionText.includes('forced-colors')) hasForcedColors = true;
            }
          }
        } catch {}
      }
      return { hasDarkMode, hasReducedMotion, hasForcedColors };
    });

    const colorRaw = await askAI(
      `You are evaluating dark mode accessibility for a website.

The screenshot shows the website with the CSS media feature "prefers-color-scheme: dark" applied.

CSS media query support detected in the stylesheet:
- prefers-color-scheme supported: ${mediaQuerySupport.hasDarkMode}
- prefers-reduced-motion supported: ${mediaQuerySupport.hasReducedMotion}
- forced-colors supported: ${mediaQuerySupport.hasForcedColors}

Look at the screenshot and evaluate:
1. Has the site adapted its colours for dark mode, or does it still show a light/white background?
2. If dark mode is active, is text still readable with sufficient contrast?
3. Are any images or UI elements broken or invisible in dark mode?

Return ONLY a JSON object with these exact fields and no other text:
{
  "darkModeSupported": boolean,
  "darkModeScore": number between 0 and 100,
  "pass": boolean,
  "score": number between 0 and 100,
  "severity": "serious or moderate or minor or null",
  "issues": ["list specific issues, or empty array if none"],
  "suggestions": ["list recommendations, or empty array if none"]
}`,
      [{ base64: darkScreenshot, mediaType: 'image/png' }],
      4000
    );

    const validated = validateVisualResult(colorRaw, 'Dark Mode Support', '1.4.3');
    results.push({
      ...validated,
      mediaQuerySupport,
      darkModeSupported: colorRaw?.darkModeSupported ?? false,
      note: 'High contrast (forced-colors) skipped — not supported in Puppeteer 21',
    });
  } catch (err) {
    results.push({
      test: 'Dark Mode Support',
      wcag: '1.4.3',
      pass: null,
      score: null,
      error: err.message,
    });
  } finally {
    await page.close();
  }

  return results;
}

async function evaluateVisualDisabilities(browser, url) {
  console.log(`    👁️  Running visual disability checks...`);

  const [focus, zoom, textSpacing, colorModes] = await Promise.all([
    testFocusIndicators(browser, url),
    testZoomReflow(browser, url),
    testTextSpacing(browser, url),
    testColorModeSupport(browser, url),
  ]);

  const allResults = [...focus, ...zoom, ...textSpacing, ...colorModes];

  const scored = allResults.filter(
    r => r.score !== null && r.score !== undefined && typeof r.score === 'number' && !isNaN(r.score)
  );
  const failed  = allResults.filter(r => r.pass === false);
  const errored = allResults.filter(r => r.error);

  const moduleScore = scored.length > 0
    ? Math.round(scored.reduce((a, b) => a + b.score, 0) / scored.length)
    : null;

  if (errored.length > 0) {
    console.warn(`    ⚠️  Visual module: ${errored.length}/${allResults.length} sub-tests errored`);
  }

  return {
    moduleName: 'Visual Disability Checks',
    category: 'visual',
    wcagPrinciples: ['Perceivable', 'Operable'],
    affectedUsers: 'Blind users, low-vision users, photosensitive users',
    total: allResults.length,
    passed:  allResults.filter(r => r.pass === true).length,
    failed:  failed.length,
    errored: errored.length,
    score:   moduleScore,
    items:   allResults,
  };
}

module.exports = { evaluateVisualDisabilities };
