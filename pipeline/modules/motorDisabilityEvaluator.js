const { askAI } = require('./aiClient');

function validateFocusOrderResult(result) {
  if (!result || result.error) return null;
  if (typeof result.pass !== 'boolean') return null;
  if (typeof result.score !== 'number' || isNaN(result.score)) return null;
  result.score = Math.max(0, Math.min(100, result.score));
  return result;
}

async function testKeyboardNavigation(browser, url) {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });

  const results = [];

  await page.evaluate(() => {
    document.addEventListener('mousedown', e => e.preventDefault(), true);
    document.addEventListener('mouseover', e => e.preventDefault(), true);
  });

  const focusableElements = await page.evaluate(() => {
    const els = [...document.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
      'textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), details > summary'
    )].filter(el => {
      const rect  = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 &&
             style.visibility !== 'hidden' &&
             style.display !== 'none';
    });

    return els.map((el, idx) => ({
      idx,
      tag:      el.tagName,
      text:     el.innerText?.trim().slice(0, 40) || el.value || el.placeholder || '',
      tabindex: el.tabIndex,
      type:     el.type || null,
      href:     el.href?.slice(0, 60) || null,
    }));
  });

  const positiveTabindex = focusableElements.filter(el => el.tabindex > 0);
  if (positiveTabindex.length > 0) {
    results.push({
      test: 'Tab order — positive tabindex',
      pass: false,
      score: Math.max(0, 100 - positiveTabindex.length * 10),
      severity: 'moderate',
      wcag: '2.4.3',
      source: 'rule-based',
      issue: `${positiveTabindex.length} elements use tabindex > 0, disrupting the natural tab order`,
      elements: positiveTabindex.map(e => `${e.tag} tabindex="${e.tabindex}" "${e.text}"`),
      suggestion: 'Remove positive tabindex values. Use DOM order to control focus sequence.',
    });
  }

  const firstFocusable = focusableElements[0];
  const hasSkipLink = firstFocusable && (
    firstFocusable.text?.toLowerCase().includes('skip') ||
    firstFocusable.href?.includes('#main') ||
    firstFocusable.href?.includes('#content') ||
    firstFocusable.href?.includes('#skip')
  );

  results.push({
    test: 'Skip navigation link',
    pass: hasSkipLink ?? false,
    score: hasSkipLink ? 100 : 0,
    severity: hasSkipLink ? null : 'serious',
    wcag: '2.4.1',
    source: 'rule-based',
    issue: hasSkipLink
      ? null
      : 'No "Skip to main content" link found — keyboard users must tab through entire navigation on every page',
    suggestion: 'Add <a href="#main" class="skip-link">Skip to main content</a> as the first focusable element',
    firstFocusableElement: firstFocusable ?? null,
  });

  let trapFound   = false;
  let lastFocused = null;
  const tabSequence = [];

  for (let i = 0; i < Math.min(20, focusableElements.length); i++) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? {
        tag:  el.tagName,
        text: el.innerText?.trim().slice(0, 40) || el.value || '',
        href: el.href?.slice(0, 60) || null,
      } : null;
    });

    if (focused) {
      if (lastFocused &&
          focused.tag  === lastFocused.tag &&
          focused.text === lastFocused.text) {
        trapFound = true;
        break;
      }
      lastFocused = focused;
      tabSequence.push(focused);
    }
  }

  results.push({
    test: 'Keyboard trap detection',
    pass: !trapFound,
    score: trapFound ? 0 : 100,
    severity: trapFound ? 'critical' : null,
    wcag: '2.1.2',
    source: 'rule-based',
    focusableElementCount: focusableElements.length,
    tabSequenceSample: tabSequence.slice(0, 8),
    issue: trapFound
      ? 'Keyboard trap detected — user cannot Tab away from an element'
      : null,
    suggestion: trapFound
      ? 'Ensure modals and widgets release focus correctly when closed'
      : null,
  });

  if (tabSequence.length >= 4) {
    const rawResult = await askAI(
      `You are a WCAG 2.4.3 accessibility expert evaluating keyboard focus order.

The tab sequence below shows the first ${tabSequence.length} elements that received
focus when Tab was pressed repeatedly on this page: ${url}

Focus order should generally follow visual reading order — top to bottom,
left to right for left-to-right languages. It must preserve meaning and operability.

Tab sequence observed:
${tabSequence.map((el, i) => `${i + 1}. ${el.tag}: "${el.text}"${el.href ? ` → ${el.href}` : ''}`).join('\n')}

Evaluate whether this focus sequence is logical and predictable for a keyboard user.

Return ONLY a JSON object with these exact fields and no other text:
{
  "pass": boolean indicating whether the focus order is logical and meets WCAG 2.4.3,
  "score": number between 0 and 100,
  "severity": "one of: critical, serious, moderate, minor, null",
  "wcag": "2.4.3",
  "logicalOrder": boolean indicating whether focus follows a predictable visual order,
  "issues": ["describe a specific focus order problem found"],
  "suggestion": "recommendation to fix the focus order, or null if passing"
}`,
      [],
      3000
    );

    const validated = validateFocusOrderResult(rawResult);

    if (!validated) {
      console.warn(`    ⚠️  [motorEvaluator] Focus order AI response invalid — skipping`);
      results.push({
        test: 'Focus order logic',
        pass: null,
        score: null,
        skipped: true,
        reason: 'AI returned unusable response for focus order check',
        raw: rawResult,
      });
    } else {
      results.push({
        test: 'Focus order logic',
        source: 'ai-evaluation',
        pass: validated.pass,
        score: validated.score,
        severity: validated.severity ?? null,
        wcag: '2.4.3',
        logicalOrder: validated.logicalOrder ?? null,
        issues: validated.issues ?? [],
        suggestion: validated.suggestion ?? null,
      });
    }
  }

  await page.close();
  return results;
}

async function testTouchTargets(browser, url) {
  const page = await browser.newPage();
  await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 2 });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });

  const smallTargets = await page.evaluate(() => {
    const MIN_SIZE = 44;
    const issues   = [];

    const interactiveEls = [...document.querySelectorAll(
      'a, button, input, select, [role="button"], [role="link"], [onclick]'
    )];

    for (const el of interactiveEls) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.width < MIN_SIZE || rect.height < MIN_SIZE) {
        issues.push({
          tag:    el.tagName,
          text:   el.innerText?.trim().slice(0, 40) || el.value || '',
          width:  Math.round(rect.width),
          height: Math.round(rect.height),
          issue:  `Touch target ${Math.round(rect.width)}×${Math.round(rect.height)}px is below the 44×44px minimum`,
        });
      }
    }
    return issues.slice(0, 20);
  });

  await page.close();

  return {
    test:             'Touch Target Size',
    wcag:             '2.5.5',
    source:           'rule-based',
    pass:             smallTargets.length === 0,
    score:            smallTargets.length === 0 ? 100 : Math.max(0, 100 - smallTargets.length * 5),
    severity:         smallTargets.length > 5 ? 'serious' : smallTargets.length > 0 ? 'moderate' : null,
    smallTargetsFound: smallTargets.length,
    items:            smallTargets,
    issue:            smallTargets.length > 0
      ? `${smallTargets.length} interactive elements are smaller than the 44×44px minimum touch target size`
      : null,
    suggestion: 'Increase padding on small links and buttons so the clickable area is at least 44×44px',
  };
}

async function checkTimeoutWarnings(page) {
  const timeoutIndicators = await page.evaluate(() => {
    const indicators = {
      hasSessionTimeout:  false,
      hasTimeoutWarning:  false,
      hasExtendOption:    false,
      metaRefresh:        null,
      clues:              [],
    };

    const metaRefresh = document.querySelector('meta[http-equiv="refresh"]');
    if (metaRefresh) {
      const content = metaRefresh.getAttribute('content') || '';
      const seconds = parseInt(content);
      indicators.metaRefresh = { seconds, content };
      if (seconds > 0 && seconds < 72000) {
        indicators.hasSessionTimeout = true;
        indicators.clues.push(`Meta refresh: redirects after ${seconds} seconds`);
      }
    }

    const scripts = [...document.querySelectorAll('script')];
    for (const script of scripts) {
      const text = script.innerText || '';
      if (text.match(/session.?timeout|idle.?timeout|setTimeout.*logout|expire/i)) {
        indicators.hasSessionTimeout = true;
        indicators.clues.push('JavaScript session timeout detected');
      }
      if (text.match(/extend|continue|keep.?alive|renew.?session/i)) {
        indicators.hasExtendOption = true;
      }
    }

    if (document.querySelector('[role="dialog"], .modal, .timeout-warning, #session-warning')) {
      indicators.hasTimeoutWarning = true;
    }

    return indicators;
  });

  if (!timeoutIndicators.hasSessionTimeout) {
    return {
      test:   'Session Timeout Warning',
      wcag:   '2.2.1',
      source: 'rule-based',
      pass:   true,
      score:  100,
      note:   'No session timeout detected on this page',
    };
  }

  const pass = timeoutIndicators.hasTimeoutWarning && timeoutIndicators.hasExtendOption;
  return {
    test:              'Session Timeout Warning',
    wcag:              '2.2.1',
    source:            'rule-based',
    pass,
    score:             pass ? 100 : 20,
    severity:          'serious',
    hasSessionTimeout: true,
    hasWarning:        timeoutIndicators.hasTimeoutWarning,
    hasExtendOption:   timeoutIndicators.hasExtendOption,
    metaRefresh:       timeoutIndicators.metaRefresh,
    issue: !timeoutIndicators.hasTimeoutWarning
      ? 'Session timeout detected but no warning dialog found — users are logged out without notice'
      : !timeoutIndicators.hasExtendOption
      ? 'Timeout warning exists but no option to extend the session'
      : null,
    suggestion: 'Warn users at least 20 seconds before timeout with a dialog offering to extend the session',
  };
}

async function checkStickyHeaderScrollMargin(page) {
  const stickyIssue = await page.evaluate(() => {
    const stickyElements = [...document.querySelectorAll('*')].filter(el => {
      const style = window.getComputedStyle(el);
      return style.position === 'sticky' || style.position === 'fixed';
    });

    if (stickyElements.length === 0) return { hasStickyHeader: false };

    const stickyHeader = stickyElements.find(el =>
      el.tagName === 'HEADER' || el.tagName === 'NAV' ||
      el.getBoundingClientRect().top < 10
    );

    if (!stickyHeader) return { hasStickyHeader: false };

    const headerHeight  = stickyHeader.getBoundingClientRect().height;
    const htmlStyle     = window.getComputedStyle(document.documentElement);
    const scrollPadding = parseInt(htmlStyle.scrollPaddingTop) || 0;

    return {
      hasStickyHeader:  true,
      headerHeight:     Math.round(headerHeight),
      scrollPaddingTop: scrollPadding,
      scrollPaddingSet: scrollPadding > 0,
      issue: scrollPadding < headerHeight
        ? `Sticky header is ${Math.round(headerHeight)}px but scroll-padding-top is only ${scrollPadding}px`
        : null,
    };
  });

  if (!stickyIssue.hasStickyHeader) {
    return {
      test:   'Sticky Header Scroll Margin',
      wcag:   '2.4.12',
      source: 'rule-based',
      pass:   true,
      score:  100,
      note:   'No sticky/fixed header found',
    };
  }

  const pass = stickyIssue.scrollPaddingSet &&
               stickyIssue.scrollPaddingTop >= stickyIssue.headerHeight;

  return {
    test:             'Sticky Header Scroll Margin',
    wcag:             '2.4.12',
    source:           'rule-based',
    pass,
    score:            stickyIssue.scrollPaddingSet ? 70 : 20,
    severity:         stickyIssue.issue ? 'moderate' : null,
    headerHeight:     stickyIssue.headerHeight,
    scrollPaddingTop: stickyIssue.scrollPaddingTop,
    issue:            stickyIssue.issue,
    suggestion:       `Add to CSS: html { scroll-padding-top: ${stickyIssue.headerHeight + 10}px; }`,
  };
}

async function evaluateMotorDisabilities(browser, url, dom) {
  console.log(`    🤝 Running motor disability checks...`);

  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });

  const [keyboardResults, touchResults, timeoutResult, stickyResult] =
    await Promise.all([
      testKeyboardNavigation(browser, url),
      testTouchTargets(browser, url),
      checkTimeoutWarnings(page),
      checkStickyHeaderScrollMargin(page),
    ]);

  await page.close();

  const allResults = [...keyboardResults, touchResults, timeoutResult, stickyResult];
  const failed     = allResults.filter(r => r.pass === false);

  const scoredItems = allResults.filter(
    r => !r.skipped &&
         r.score !== null &&
         r.score !== undefined &&
         typeof r.score === 'number' &&
         !isNaN(r.score)
  );

  const moduleScore = scoredItems.length > 0
    ? Math.round(scoredItems.reduce((a, b) => a + b.score, 0) / scoredItems.length)
    : null;

  if (moduleScore === null) {
    console.warn(`    ⚠️  [motorEvaluator] No sub-tests produced valid scores`);
  }

  return {
    moduleName:   'Motor Disability Checks',
    category:     'motor',
    wcagPrinciples: ['Operable'],
    affectedUsers: 'Users with motor impairments, switch access users, keyboard-only users, tremor/reduced dexterity users',
    total:   allResults.length,
    passed:  allResults.filter(r => r.pass === true).length,
    failed:  failed.length,
    skipped: allResults.filter(r => r.skipped).length,
    score:   moduleScore,
    items:   allResults,
  };
}

module.exports = { evaluateMotorDisabilities };
