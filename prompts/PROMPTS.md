# Prompts sent to Gemini 2.5 Flash

These are the exact prompt templates used by the audit pipeline, copied from the source code in `pipeline/modules/`. Placeholders such as `${img.alt}` or `${dom.bodyText}` are filled with data extracted from each page at run time. Every prompt is sent by `aiClient.js`, which appends the final line *"IMPORTANT: Respond with valid JSON only..."* (shown at the end of each prompt below).

Model settings for every call: model `gemini-2.5-flash`, temperature 0.1, one call per element or test (no repeated sampling). Text-only calls also set `responseMimeType: application/json`; multimodal calls (with images) cannot, and rely on the prompt instruction instead.

14 prompt templates in total.

### P1. imageAltEvaluator.js — `evaluateImageAltTexts()`

- Input images: 1 screenshot/image(s) (multimodal call)
- maxOutputTokens: 2000

```text
You are an accessibility expert. Describe this image as you would write alt text for it on a website.
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
}

IMPORTANT: Respond with valid JSON only. No markdown, no explanation, no code fences.
```

### P2. imageAltEvaluator.js — `evaluateImageAltTexts()`

- Input images: none (text-only call; JSON response requested)
- maxOutputTokens: 4000

```text
You are a WCAG 1.1.1 accessibility expert evaluating the quality of alt text written by a developer.

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
}

IMPORTANT: Respond with valid JSON only. No markdown, no explanation, no code fences.
```

### P3. linkTextEvaluator.js — `evaluateLinkTexts()`

- Input images: none (text-only call; JSON response requested)
- maxOutputTokens: 10000

```text
You are a WCAG 2.4.4 accessibility expert evaluating link text quality.

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
}]

IMPORTANT: Respond with valid JSON only. No markdown, no explanation, no code fences.
```

### P4. headingEvaluator.js — `evaluateHeadingStructure()`

- Input images: none (text-only call; JSON response requested)
- maxOutputTokens: 3500

```text
You are a WCAG 2.4.6 accessibility expert evaluating the semantic quality of page headings.

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
}

IMPORTANT: Respond with valid JSON only. No markdown, no explanation, no code fences.
```

### P5. readingLevelEvaluator.js — `evaluateReadingLevel()`

- Input images: none (text-only call; JSON response requested)
- maxOutputTokens: 10000

```text
You are a plain language and accessibility expert evaluating a government/public service website.

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
}

IMPORTANT: Respond with valid JSON only. No markdown, no explanation, no code fences.
```

### P6. tableEvaluator.js — `evaluateTableHeaders()`

- Input images: none (text-only call; JSON response requested)
- maxOutputTokens: 2000

```text
You are a WCAG 1.3.1 accessibility expert evaluating data table structure.

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
}

IMPORTANT: Respond with valid JSON only. No markdown, no explanation, no code fences.
```

### P7. pageTitleEvaluator.js — `evaluatePageTitle()`

- Input images: none (text-only call; JSON response requested)
- maxOutputTokens: 3000

```text
You are a WCAG 2.4.2 accessibility expert evaluating page title quality.

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
}

IMPORTANT: Respond with valid JSON only. No markdown, no explanation, no code fences.
```

### P8. languageEvaluator.js — `evaluateAlbanianContent()`

- Input images: none (text-only call; JSON response requested)
- maxOutputTokens: 10000

```text
You are a linguistic expert and WCAG accessibility auditor specializing in Albanian language quality assessment.

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
}

IMPORTANT: Respond with valid JSON only. No markdown, no explanation, no code fences.
```

### P9. languageEvaluator.js — `detectPageLanguage()`

- Input images: none (text-only call; JSON response requested)
- maxOutputTokens: 4000

```text
You are a language detection expert. Identify what language or languages this web page content is written in.

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
}

IMPORTANT: Respond with valid JSON only. No markdown, no explanation, no code fences.
```

### P10. visualDisabilityEvaluator.js — `testFocusIndicators()`

- Input images: 2 screenshot/image(s) (multimodal call)
- maxOutputTokens: 4000

```text
You are a WCAG 2.4.7 accessibility expert evaluating focus indicator visibility.

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
}

IMPORTANT: Respond with valid JSON only. No markdown, no explanation, no code fences.
```

### P11. visualDisabilityEvaluator.js — `testZoomReflow()`

- Input images: 1 screenshot/image(s) (multimodal call)
- maxOutputTokens: 4000

```text
You are evaluating a webpage screenshot taken at a 320px wide viewport (equivalent to 200% browser zoom).

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
}

IMPORTANT: Respond with valid JSON only. No markdown, no explanation, no code fences.
```

### P12. visualDisabilityEvaluator.js — `testTextSpacing()`

- Input images: 1 screenshot/image(s) (multimodal call)
- maxOutputTokens: 3000

```text
You are evaluating WCAG 1.4.12 Text Spacing compliance.

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
}

IMPORTANT: Respond with valid JSON only. No markdown, no explanation, no code fences.
```

### P13. visualDisabilityEvaluator.js — `testColorModeSupport()`

- Input images: 1 screenshot/image(s) (multimodal call)
- maxOutputTokens: 4000

```text
You are evaluating dark mode accessibility for a website.

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
}

IMPORTANT: Respond with valid JSON only. No markdown, no explanation, no code fences.
```

### P14. motorDisabilityEvaluator.js — `testKeyboardNavigation()`

- Input images: none (text-only call; JSON response requested)
- maxOutputTokens: 3000

```text
You are a WCAG 2.4.3 accessibility expert evaluating keyboard focus order.

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
}

IMPORTANT: Respond with valid JSON only. No markdown, no explanation, no code fences.
```
