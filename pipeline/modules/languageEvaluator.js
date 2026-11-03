const { askAI } = require('./aiClient');

const ALBANIAN_INDICATORS = [
  /\bshqip\b/i,
  /\balbanian\b/i,
  /\bshqiptar/i,
  /\bal\b/i,
  /\bsq\b/,
  /\/sq\//i,
  /\/al\//i,
  /lang=sq/i,
  /language=sq/i,
  /locale=sq/i,
  /shtëpi/i,
  /ballina/i,
  /shqipëri/i,
];

const MACEDONIAN_INDICATORS = [
  /\bмакедонски\b/i,
  /\bмк\b/i,
  /\bmk\b/,
  /\/mk\//i,
  /lang=mk/i,
  /почетна/i,
  /македонски/i,
];

function validateAIResponse(result, requiredFields = []) {
  if (!result || result.error) return null;
  for (const field of requiredFields) {
    if (result[field] === undefined || result[field] === null) return null;
  }
  return result;
}

async function detectLanguageSwitchersInPage(page) {
  return await page.evaluate(() => {
    const found = [];

    const allLinks = [...document.querySelectorAll('a[href]')];
    for (const a of allLinks) {
      const text      = (a.innerText || a.textContent || '').trim();
      const href      = a.href || '';
      const hreflang  = a.getAttribute('hreflang') || '';
      const ariaLabel = a.getAttribute('aria-label') || '';
      const title     = a.title || '';
      const combined  = `${text} ${href} ${hreflang} ${ariaLabel} ${title}`.toLowerCase();

      const isLangLink =
        combined.match(/shqip|albanian|ballina|shtëpi|shqiptar|\bsq\b|\bal\b|\/sq\/|\/al\/|lang=sq/) ||
        combined.match(/македонски|почетна|\bmk\b|\/mk\/|lang=mk/) ||
        combined.match(/english|\ben\b|\/en\/|lang=en/) ||
        hreflang.match(/^(sq|mk|en|sq-al|mk-mk)/i);

      if (isLangLink) {
        found.push({
          text:      text.slice(0, 50),
          href,
          hreflang:  hreflang  || null,
          ariaLabel: ariaLabel || null,
          source:    'full-dom-scan',
          isHidden:  (
            window.getComputedStyle(a).display    === 'none' ||
            window.getComputedStyle(a).visibility === 'hidden' ||
            a.offsetParent === null
          ),
        });
      }
    }

    const selects = [...document.querySelectorAll('select')];
    for (const select of selects) {
      for (const option of [...select.options]) {
        const text     = (option.text  || '').toLowerCase();
        const value    = (option.value || '').toLowerCase();
        const combined = `${text} ${value}`;

        if (combined.match(/shqip|albanian|\bsq\b|\bal\b/)) {
          found.push({
            text:       option.text.trim(),
            value:      option.value,
            source:     'select-element',
            selectName: select.name || select.id || null,
            isHidden:   false,
          });
        }
        if (combined.match(/македонски|macedonian|\bmk\b/)) {
          found.push({
            text:       option.text.trim(),
            value:      option.value,
            source:     'select-element',
            selectName: select.name || select.id || null,
            isHidden:   false,
          });
        }
      }
    }

    const langContainers = [...document.querySelectorAll(
      '[class*="lang"], [id*="lang"], [class*="language"], [id*="language"], ' +
      '[class*="translate"], [id*="translate"], ' +
      '[role="navigation"][aria-label*="lang"], ' +
      '[class*="locale"], [id*="locale"]'
    )];
    for (const container of langContainers) {
      const links = [...container.querySelectorAll('a[href], button, [role="menuitem"]')];
      for (const el of links) {
        const text = (el.innerText || el.textContent || '').trim();
        const href = el.href || el.getAttribute('data-href') || el.getAttribute('data-url') || '';
        if (text && text.length < 30) {
          found.push({
            text:           text.slice(0, 50),
            href,
            source:         'lang-container',
            containerClass: container.className?.slice(0, 60) || null,
            isHidden:       window.getComputedStyle(container).display === 'none',
          });
        }
      }
    }

    const hreflangTags = [...document.querySelectorAll('link[hreflang]')];
    for (const tag of hreflangTags) {
      found.push({
        href:     tag.href,
        hreflang: tag.getAttribute('hreflang'),
        source:   'hreflang-head-tag',
        isHidden: false,
      });
    }

    const ogLocale = document.querySelector('meta[property="og:locale:alternate"]');
    if (ogLocale) {
      found.push({
        content:  ogLocale.content,
        source:   'og-locale-meta',
        isHidden: false,
      });
    }

    const clickCandidates = [...document.querySelectorAll('div, span, button, li, a')];
    for (const el of clickCandidates) {
      const wireClick  = el.getAttribute('wire:click')  || '';
      const xonClick   = el.getAttribute('x-on:click') || '';
      const atClick    = el.getAttribute('@click')      || '';
      const onclickVal = el.getAttribute('onclick')     || '';
      const allAttrs   = `${wireClick} ${xonClick} ${atClick} ${onclickVal}`.toLowerCase();

      if (!allAttrs.match(/lang|language|locale/)) continue;

      const text      = (el.innerText || el.textContent || '').trim();
      const textLower = text.toLowerCase();

      if (
        textLower.match(/\bal\b|shqip|albanian|\bsq\b/) ||
        textLower.match(/\bmk\b|македонски/) ||
        textLower.match(/\ben\b|english/)
      ) {
        found.push({
          text:      text.slice(0, 50),
          href:      null,
          source:    'clickable-div',
          isHidden:  window.getComputedStyle(el).display === 'none',
          wireClick: wireClick || xonClick || atClick || null,
        });
      }
    }

    return found;
  });
}

function classifyLanguageLinks(rawLinks) {
  const result = { albanian: [], macedonian: [], english: [], other: [] };

  for (const link of rawLinks) {
    const text     = (link.text     || '').toLowerCase();
    const href     = (link.href     || link.value || '').toLowerCase();
    const hreflang = (link.hreflang || '').toLowerCase();
    const combined = `${text} ${href} ${hreflang}`;

    if (ALBANIAN_INDICATORS.some(p => p.test(combined)) || hreflang.startsWith('sq')) {
      result.albanian.push(link);
    } else if (MACEDONIAN_INDICATORS.some(p => p.test(combined)) || hreflang.startsWith('mk')) {
      result.macedonian.push(link);
    } else if (combined.match(/english|\ben\b|\/en\//) || hreflang.startsWith('en')) {
      result.english.push(link);
    }
  }

  for (const key of Object.keys(result)) {
    const seen = new Set();
    result[key] = result[key].filter(l => {
      const id = l.href || l.value || l.text;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  return result;
}

async function evaluateAlbanianContent(albanianPageData) {
  const { dom, url } = albanianPageData;

  const rawResult = await askAI(
    `You are a linguistic expert and WCAG accessibility auditor specializing in Albanian language quality assessment.

You are evaluating the Albanian language version of a North Macedonian government or public website.
In North Macedonia, Albanian is an official language and government websites are legally required
to provide full Albanian translations under the Law on the Use of Languages.

Albanian page URL: ${url}
HTML lang attribute on this page: "${dom.langAttribute || 'NOT SET'}"
Page title: "${dom.meta.title}"

Page content (Albanian version):
"${dom.bodyText}"

Evaluate these dimensions carefully:

1. LANG ATTRIBUTE — Is the html lang attribute set to "sq" on this Albanian page?

2. ACTUAL LANGUAGE — Is the content actually written in Albanian (Shqip)?
   Or is it still in Macedonian or another language?

3. TRANSLATION COMPLETENESS — Are there untranslated sections remaining?
   Look for Macedonian Cyrillic script mixed into Albanian Latin text.
   Mixed content is a serious accessibility issue.

4. TRANSLATION QUALITY — Is the Albanian natural and fluent, or does it read
   like machine translation? Look for: incorrect verb forms, wrong word order,
   calques from Macedonian, unnatural phrasing, inconsistent register.

5. ALBANIAN STANDARD — Is it standard literary Albanian (Tosk-based)?
   Government sites should use the literary standard, not heavy dialect.

6. CONTENT COMPLETENESS — Does the Albanian version appear to have the same
   amount of content as a full Macedonian version would? Or is it reduced?

7. TECHNICAL TERMS — Are legal and technical terms properly translated,
   or left in Macedonian/English without translation?

8. SPECIAL CHARACTERS — Are Albanian characters ë and ç present where expected?
   Their absence suggests encoding or translation quality issues.

Return ONLY a JSON object with these exact fields and no other text:
{
  "langAttributeCorrect": boolean indicating if lang is set to sq,
  "langAttributeFound": "the actual lang attribute value found, or null if not set",
  "isActuallyAlbanian": boolean indicating if content is actually in Albanian,
  "detectedLanguage": "description of what language or languages are actually present",
  "hasMixedContent": boolean indicating if Macedonian Cyrillic appears in the Albanian text,
  "mixedContentExamples": ["example of Macedonian text found mixed into the Albanian version"],
  "translationQuality": "one of: excellent, good, acceptable, poor, machine-translated, not-translated",
  "translationScore": number between 0 and 100,
  "qualityIssues": ["specific grammatical or phrasing problem found"],
  "completenessEstimate": "one of: full, partial, minimal, empty",
  "completenessScore": number between 0 and 100,
  "missingAlbanianChars": boolean indicating if ë or ç are absent where expected,
  "technicalTermIssues": ["untranslated technical or legal term"],
  "overallPass": boolean indicating overall pass or fail,
  "overallScore": number between 0 and 100,
  "severity": "one of: critical, serious, moderate, minor",
  "summary": "2 to 3 sentence summary of Albanian language quality",
  "recommendations": ["specific actionable recommendation"]
}`,
    [],
    10000
  );

  const validated = validateAIResponse(rawResult, ['overallPass', 'overallScore']);
  if (!validated) {
    console.warn(`    ⚠️  [languageEvaluator] Albanian evaluation response invalid`);
    return {
      error:        'AI returned unusable response for Albanian evaluation',
      overallPass:  false,
      overallScore: null,
      severity:     'serious',
      raw:          rawResult,
    };
  }

  validated.overallScore = Math.max(0, Math.min(100, validated.overallScore));
  if (validated.translationScore  != null) validated.translationScore  = Math.max(0, Math.min(100, validated.translationScore));
  if (validated.completenessScore != null) validated.completenessScore = Math.max(0, Math.min(100, validated.completenessScore));

  return validated;
}

async function collectDom(page) {
  return await page.evaluate(() => ({
    langAttribute: document.documentElement.getAttribute('lang'),
    bodyText:      document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 5000),
    meta:          { title: document.title },
    inlineLangElements: [...document.querySelectorAll('[lang]')].map(el => ({
      lang: el.getAttribute('lang'),
      text: el.innerText.trim().slice(0, 100),
    })),
  }));
}

async function detectPageLanguage(dom) {
  const cyrillicMatch      = dom.bodyText.match(/[\u0400-\u04FF]/g);
  const albanianCharsMatch = dom.bodyText.match(/[ëç]/g);
  const cyrillicRatio      = cyrillicMatch ? cyrillicMatch.length / dom.bodyText.length : 0;

  const rawResult = await askAI(
    `You are a language detection expert. Identify what language or languages this web page content is written in.

HTML lang attribute declared on the page: "${dom.langAttribute || 'none'}"
Page title: "${dom.meta.title}"
Content sample: "${dom.bodyText.slice(0, 1000)}"

Compare the declared lang attribute against the actual content language.
A mismatch means the attribute is wrong — for example, declaring lang="en" on a page written in Macedonian.

Return ONLY a JSON object with these exact fields and no other text:
{
  "detectedLanguages": ["list every language you detect in the content"],
  "primaryLanguage": "the main language of the content as a string",
  "langAttributeMatchesContent": boolean indicating if the declared lang matches the actual content,
  "langAttributeIssue": "description of the mismatch problem, or null if they match",
  "hasCyrillicText": boolean indicating presence of Cyrillic script,
  "hasAlbanianText": boolean indicating presence of Albanian text,
  "hasEnglishText": boolean indicating presence of English text,
  "confidence": "one of: high, medium, low"
}`,
    [],
    4000
  );

  const validated = validateAIResponse(rawResult, ['primaryLanguage', 'langAttributeMatchesContent']);
  if (!validated) {
    console.warn(`    ⚠️  [languageEvaluator] Language detection response invalid`);
    return {
      primaryLanguage:             'unknown',
      langAttributeMatchesContent: null,
      langAttributeIssue:          'AI language detection failed',
      hasCyrillicText:             cyrillicRatio > 0.1,
      hasAlbanianText:             !!albanianCharsMatch,
      hasEnglishText:              false,
      confidence:                  'low',
      cyrillicRatio,
      albanianCharsFound:          !!albanianCharsMatch,
      error:                       'AI returned unusable response',
    };
  }

  return { ...validated, cyrillicRatio, albanianCharsFound: !!albanianCharsMatch };
}

async function evaluateLanguage(pageData, browser) {
  const { dom, url } = pageData;
  const results = {
    moduleName: 'Language Accessibility & Albanian Evaluation',
    wcag:       '3.1.1 / 3.1.2',
    pageUrl:    url,
  };

  console.log(`    🌐 Detecting language switchers (including dropdowns)...`);

  let rawLinks = [];
  try {
    const detectionPage = await browser.newPage();
    await detectionPage.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    await detectionPage.evaluate(() => {
      const candidates = document.querySelectorAll(
        '[class*="lang"], [id*="lang"], [class*="language"], nav, header, ' +
        '[class*="translate"], [class*="locale"]'
      );
      candidates.forEach(el => {
        el.dispatchEvent(new MouseEvent('mouseover',  { bubbles: true }));
        el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      });
    });

    await new Promise(r => setTimeout(r, 600));

    rawLinks = await detectLanguageSwitchersInPage(detectionPage);
    await detectionPage.close();
  } catch (err) {
    console.warn(`    ⚠️  Language switcher detection failed: ${err.message}`);
    rawLinks = dom.langLinks || [];
  }

  const langOptions = classifyLanguageLinks(rawLinks);

  results.languagesOffered = {
    albanian:        langOptions.albanian.length  > 0,
    macedonian:      langOptions.macedonian.length > 0,
    english:         langOptions.english.length   > 0,
    albanianLinks:   langOptions.albanian,
    macedonianLinks: langOptions.macedonian,
    englishLinks:    langOptions.english,
    detectionMethod: 'full-dom-scan including hidden dropdowns, select elements, and clickable-div patterns',
  };

  console.log(`    🔤 Detecting actual page language...`);
  const langDetection = await detectPageLanguage(dom);

  const langMatches = langDetection.langAttributeMatchesContent;
  results.langAttributeCheck = {
    declared:   dom.langAttribute,
    detected:   langDetection.primaryLanguage,
    matches:    langMatches,
    issue:      langDetection.langAttributeIssue,
    pass:       langMatches === true,
    score:      langMatches === true ? 100 : langMatches === false ? 20 : null,
    severity:   langMatches === false ? 'serious' : null,
    confidence: langDetection.confidence,
  };

  if (dom.inlineLangElements && dom.inlineLangElements.length > 0) {
    results.inlineLangUsage = {
      found:    true,
      count:    dom.inlineLangElements.length,
      elements: dom.inlineLangElements.slice(0, 5),
      note:     'Page uses inline lang attributes for mixed-language content — good practice',
    };
  } else if (langDetection.hasAlbanianText && langDetection.hasCyrillicText) {
    results.inlineLangUsage = {
      found:      false,
      pass:       false,
      severity:   'serious',
      issue:      'Page contains content in multiple languages but no inline lang attributes',
      suggestion: 'Wrap Albanian sections in <span lang="sq"> and Macedonian in <span lang="mk">',
    };
  }

  const albanianLinkWithUrl = langOptions.albanian.find(
    l => l.href && l.href.startsWith('http') && l.href !== url
  );
  const albanianClickableDiv = langOptions.albanian.find(
    l => l.source === 'clickable-div' && !l.href
  );

  if (albanianLinkWithUrl) {
    const albanianUrl = albanianLinkWithUrl.href;
    console.log(`    🇦🇱 Albanian version found (via ${albanianLinkWithUrl.source}): ${albanianUrl}`);
    console.log(`    🔍 Evaluating Albanian content quality...`);

    try {
      const albanianPage = await browser.newPage();
      await albanianPage.goto(albanianUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const albanianDom  = await collectDom(albanianPage);
      await albanianPage.close();

      const albanianEval = await evaluateAlbanianContent({ dom: albanianDom, url: albanianUrl });

      results.albanianVersion = {
        found:                       true,
        url:                         albanianUrl,
        detectedVia:                 albanianLinkWithUrl.source,
        wasHidden:                   albanianLinkWithUrl.isHidden ?? false,
        langAttributeOnAlbanianPage: albanianDom.langAttribute,
        evaluation:                  albanianEval,
        overallPass:                 albanianEval.overallPass  ?? false,
        overallScore:                albanianEval.overallScore ?? null,
        severity:                    albanianEval.severity     ?? 'serious',
      };
    } catch (err) {
      results.albanianVersion = {
        found:        true,
        url:          albanianUrl,
        detectedVia:  albanianLinkWithUrl.source,
        error:        `Could not load Albanian version: ${err.message}`,
        overallPass:  false,
        overallScore: null,
        severity:     'critical',
      };
    }
  } else if (albanianClickableDiv) {
    console.log(`    🇦🇱 Albanian switcher found via clickable-div — clicking to activate...`);

    try {
      const clickPage = await browser.newPage();
      await clickPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

      let finalUrl = url;

      await clickPage.evaluate(() => {
        const all = [...document.querySelectorAll('div, span, button, li, a')];
        for (const el of all) {
          const text = (el.innerText || '').trim().toLowerCase();
          const hasLangHandler =
            (el.getAttribute('wire:click')  || '').toLowerCase().match(/lang|language|locale/) ||
            (el.getAttribute('x-on:click') || '').toLowerCase().match(/lang|language|locale/) ||
            (el.getAttribute('@click')      || '').toLowerCase().match(/lang|language|locale/) ||
            (el.getAttribute('onclick')     || '').toLowerCase().match(/lang|language|locale/);

          if (hasLangHandler && text.match(/\bal\b|\bsq\b|shqip|albanian/)) {
            el.click();
            break;
          }
        }
      });

      await Promise.race([
        clickPage.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 })
          .then(() => { finalUrl = clickPage.url(); })
          .catch(() => {}),
        new Promise(r => setTimeout(r, 3000)),
      ]);

      if (finalUrl === url) {
        await new Promise(r => setTimeout(r, 1500));
      }

      const albanianDom  = await collectDom(clickPage);
      await clickPage.close();

      const albanianEval = await evaluateAlbanianContent({ dom: albanianDom, url: finalUrl });

      results.albanianVersion = {
        found:                       true,
        url:                         finalUrl !== url ? finalUrl : url + ' (language switched in-place)',
        detectedVia:                 'clickable-div',
        wasHidden:                   albanianClickableDiv.isHidden ?? false,
        langAttributeOnAlbanianPage: albanianDom.langAttribute,
        evaluation:                  albanianEval,
        overallPass:                 albanianEval.overallPass  ?? false,
        overallScore:                albanianEval.overallScore ?? null,
        severity:                    albanianEval.severity     ?? 'serious',
      };
    } catch (err) {
      results.albanianVersion = {
        found:        true,
        url:          null,
        detectedVia:  'clickable-div',
        error:        `Could not activate Albanian version: ${err.message}`,
        overallPass:  false,
        overallScore: null,
        severity:     'critical',
      };
    }
  } else {
    console.log(`    🇦🇱 No Albanian version detected (checked visible links, dropdowns, selects, hreflang tags, clickable-divs)`);
    results.albanianVersion = {
      found:        false,
      overallPass:  false,
      overallScore: 0,
      severity:     'serious',
      issue:        'No Albanian language version detected on this website',
      suggestion:   "Under North Macedonia's Law on the Use of Languages, public institutions must provide content in Albanian. Add a language switcher linking to a full Albanian version.",
    };
  }

  const scores = [];

  if (results.langAttributeCheck?.score != null) {
    scores.push(results.langAttributeCheck.score);
  }

  if (results.albanianVersion?.overallScore != null) {
    scores.push(results.albanianVersion.overallScore);
  } else if (results.albanianVersion?.found === false) {
    scores.push(0);
  } else if (results.albanianVersion?.found === true && results.albanianVersion?.error) {
    scores.push(0);
  }

  results.total  = scores.length;
  results.score  = scores.length
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : null;
  results.passed = scores.filter(s => s >= 70).length;
  results.failed = scores.filter(s => s < 70).length;

  return results;
}

module.exports = { evaluateLanguage };
