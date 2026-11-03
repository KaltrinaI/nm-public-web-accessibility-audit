# Hybrid AI-assisted web accessibility audit of North Macedonian public-sector websites

Code, prompts and data maintained by Kaltrina Ismaili (Faculty of Contemporary Sciences and Technologies, South East European University, Tetovo, North Macedonia) for two papers:

1. **Assessing Web Accessibility Compliance of Government and Public Sector Websites in North Macedonia: A Hybrid AI-Assisted Audit**
2. **False Passes in Automated Accessibility Testing: An LLM-Assisted Hybrid Evaluation**

Both papers use the same audit of 35 public-sector homepages, run on 23–24 April 2026 with the pipeline in this repository.

## Contents

| Path | What it contains |
|---|---|
| `pipeline/` | Node.js audit pipeline exactly as used for the study (comments removed) |
| `pipeline/modules/` | Page collector, axe-core runner, nine evaluation modules, Gemini client and score calculator |
| `prompts/PROMPTS.md` | All 14 prompt templates sent to the language model, copied verbatim from the code |
| `data/reports/` | One JSON report per audited site (35 files), as produced by the pipeline |
| `data/site_scores.csv` | Composite, axe-core and module scores, timestamps and Albanian-version results for every site |
| `false-passes/` | Materials specific to the *False Passes* paper (see the README in that folder) |

## Audited sites

35 homepages in four categories: 12 central-government bodies, 15 municipalities, 6 public universities and 2 public-transport operators. The full list with URLs, categories and timestamps is in `data/site_scores.csv`.

## Software and model settings

| Component | Version / setting |
|---|---|
| Node.js | 18 or later |
| Puppeteer (headless Chromium) | 24.40.0 |
| axe-core (via @axe-core/puppeteer 4.11.1) | 4.11.2 |
| Google Generative AI SDK (`@google/generative-ai`) | 0.15.0 |
| Language model | `gemini-2.5-flash` |
| Temperature | 0.1 (other sampling parameters at their defaults) |
| Calls per element or test | 1 (no repeated sampling) |
| Spacing between model calls | at least 1.1 s |
| Retries on rate-limit or server errors | up to 4, with 10 s, 20 s, 30 s back-off |

Exact dependency versions are pinned in `pipeline/package-lock.json`.

## Running the pipeline

```bash
cd pipeline
npm ci
export GEMINI_API_KEY="your-key"     # Google AI Studio API key
node index.js
```

The sites to audit are listed in `CONFIG.seedUrls` in `pipeline/index.js` (the study ran them in batches; the file currently contains one site). One report per site is written to `pipeline/reports/{domain}.json`. Sites that already have a report are skipped, so an interrupted run can be restarted.

Each site is audited in three phases:

1. **Text checks, in parallel:** links, headings, reading level, tables, page title.
2. **In sequence:** images, then language (including the Albanian version).
3. **Browser tests, in parallel sessions:** visual and motor.

A full audit took a median of 9.6 minutes per site (range 2.5–43.1).

**Reproducing the results.** Re-running the pipeline today will not give identical numbers:

- **The websites have changed** since April 2026.
- **The model can vary.** Its outputs are not fully deterministic even at temperature 0.1.
- **The model build isn't recorded.** The exact build behind `gemini-2.5-flash` was not logged.

The reports in `data/reports/` are the authoritative record of the study.

## Scoring rules

All module scores are on a 0–100 scale. A module score is the mean of its valid item scores. Items whose model response could not be parsed, or lacked a Boolean verdict and a numeric score, are recorded as skipped and do not count.

**axe-core score (Eq. 1 in the paper).** The score is `max(0, 100 − Σ w × n)`, where `n` is the number of elements affected by a violation. The impact weight `w` is:

| Impact | Weight |
|---|---|
| critical | 10 |
| serious | 7 |
| moderate | 4 |
| minor | 1 |

If the axe-core scan fails, the score is null.

**Composite score (Eq. 2).** The composite is a weighted mean using these relative weights:

| Module | Relative weight | Normalised |
|---|---|---|
| axe | 20 | 24% |
| images | 10 | 12% |
| links | 7 | 8% |
| headings | 7 | 8% |
| reading level | 5 | 6% |
| tables | 3 | 4% |
| page title | 5 | 6% |
| visual | 8 | 9% |
| motor | 8 | 9% |
| language | 12 | 14% |

A module without a valid score is left out, and the remaining weights are rescaled. The composite then maps to a conformance band:

| Composite score | Band |
|---|---|
| 85 or above | Level AA likely |
| 70–84 | Partial AA / full A |
| 50–69 | Partial A |
| below 50 | Non-conformant |

**Module rules.**

- **Images.**
  - Not sent to the model: images under 10 × 10 px, data-URI images and SVG files.
  - A missing `alt` attribute scores 0, with no model call.
  - Empty `alt`: the model judges decorative (100) or informative (0).
  - Non-empty `alt`: the model first describes the image (multimodal call). A text-only call then compares the description, any visible text and up to 200 characters of context with the alt text. The criteria are accuracy, completeness, conciseness, contextual fit and specificity, and the model's score is used.
  - Images that cannot be downloaded are skipped.
- **Links.**
  - Not sent to the model: links with an `aria-label`, image-only links, and `mailto:`, `tel:` and `javascript:` links.
  - The others are sent in batches of ten, each with up to 150 characters of context and the first 80 characters of its target. The model's score is used.
  - A vague text (for example "more" or "next") used for several different targets adds a rule-based item scoring 20.
- **Headings.**
  - A page with no headings scores 0.
  - Rule-based items: missing `h1` = 0, several `h1` = 40, each skipped heading level = 50.
  - These are averaged with the model's semantic score.
- **Reading level.** The model's score on the first 8,000 characters of body text. The module is null if there are fewer than 100 characters.
- **Tables.** No tables = 100; a table without `th` = 0; otherwise the model's score per table.
- **Page title.** A missing title = 0; otherwise the model's score.
- **Language.** The mean of two values:
  - a lang-attribute check: 100 if the declared language matches the content, 20 if not;
  - the Albanian-version score: the model's score for the Albanian page, or 0 if no version exists or it cannot be loaded.

  Albanian switchers are searched for in the page's links, hidden menus, `<select>` options, language containers, `hreflang` tags and script-driven (Alpine.js/Livewire) click handlers.
- **Visual.**
  - A CSS rule removing the focus outline scores 0.
  - Four model-scored tests: focus visibility (screenshots before and after Tab), reflow at a 320 px viewport, text spacing with WCAG 1.4.12 overrides, and dark mode.
- **Motor.**
  - Positive `tabindex`: 100 − 10 per element.
  - Skip link: 100 or 0.
  - Keyboard trap: 0 or 100. Tab is pressed up to 20 times, and a trap is reported when two consecutive presses focus elements with the same tag name and text.
  - Focus order: the model's score, if at least 4 tab stops were recorded.
  - Touch targets at a 375 px viewport: 100 − 5 per target under 44 × 44 px, with at most 20 counted.
  - Session timeout: 100, or 20 without a warning and an extend option.
  - Sticky header: 100 if there is none; 70 if scroll padding is set; 20 if not.

## Report format (`data/reports/*.json`)

| Field | Meaning |
|---|---|
| `site`, `auditedAt` | URL and completion time (UTC) of the site audit |
| `score`, `grade`, `wcagConformance` | Composite score and its bands |
| `axeOnlyScore`, `axeVsHybridDelta` | axe-core score (Eq. 1) and the difference to the composite |
| `homepage.timestamp` | Time the page was loaded and scanned (UTC) |
| `homepage.scores` | Score of every module (null = no valid result) |
| `homepage.axe` | Raw axe-core violations, plus pass and incomplete counts |
| `homepage.modules.*.items` | Every evaluated element or test with the model's verdict, score, severity, issues and suggestion |
| `homepage.violationSummary` | Violations tagged by source (axe-core or module) |

## Known limitations of the data and code

- **Ministry of Health:** the axe-core scan returned no result (`axeOnlyScore` is null). Its elements appear in no axe-core violation.
- **Missing module results:** six module results are null. They are listed in the paper and visible as empty cells in `site_scores.csv`.
- **Keyboard-trap test:** it compares the tag name and text of consecutive focus targets, not element identity. Two adjacent elements with identical text, such as icon-only links, are reported as a trap, so flagged sites need manual confirmation.
- **Touch-target check:** the 44 × 44 px threshold corresponds to SC 2.5.5 (Level AAA). The Level AA criterion (SC 2.5.8) uses 24 × 24 px.
- **Dark-mode test:** this is not a WCAG requirement. It is recorded under SC 1.4.3.
- **Reading-level prompt:** the prompt mentions "up to 5000 chars", but up to 8,000 characters are sent.
- **`moduleHealth.valid` flag:** it is false whenever a module skipped any item, even when the module produced a valid score. Use `homepage.scores` for analysis.
- **Missing test scripts:** `package.json` lists test scripts (`test-basic.js`, `test-ai.js`, `test-one-page.js`) that were development tools and are not included.

## Licence

- **Code:** MIT licence, see `LICENSE`.
- **Data and documentation:** `data/`, `prompts/` and the README are licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- **Third-party content:** the reports contain text and markup copied from public websites; that content belongs to the respective institutions.

## Citation

See `CITATION.cff`. Please cite the corresponding paper when using the code or data.

## Contact

Kaltrina Ismaili, k.ismaili@seeu.edu.mk
