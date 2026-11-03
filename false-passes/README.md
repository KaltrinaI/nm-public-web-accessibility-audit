# Materials for "False Passes in Automated Accessibility Testing: An LLM-Assisted Hybrid Evaluation"

This folder holds the analysis code, intermediate results and manual validation data for the *False Passes* paper. Everything is computed from the 35 per-site reports in `../data/reports/`, and every number in the paper can be recomputed from this folder.

## Contents

| Path | What it contains |
|---|---|
| `analysis/analyze.py` | Element-level analysis: deterministic failure patterns (Table 1), pairing of rule-based and LLM verdicts, false-pass rates, per-site results |
| `analysis/paper_tables.py` | Statistics of Tables 2 and 3: detection of documented failures, McNemar, Fisher and Mann–Whitney tests |
| `analysis/build_sample.py` | Draws the stratified validation sample of 200 elements (fixed random seed 20261013) |
| `analysis/validate.py` | Compares the manual labels with the LLM verdicts (Table 4) and computes the stratified estimates (Section 3.5 of the results) |
| `results/` | Output of `analyze.py`: `images.csv` and `links.csv` (one row per element), `per_site.csv`, `sites.csv`, `results.json` |
| `validation/sample_public.json` | The 200 sampled elements as shown to the raters (LLM verdicts hidden) |
| `validation/sample_full.json` | The same elements with their stratum, LLM verdict, LLM score and image type |
| `validation/ratings/` | The authors' consensus label for each element (one JSON file per element, E001–E200) |
| `validation/ratings.csv` | The same labels in one table, joined with the element details |
| `validation/validation_rows.json`, `validation/validation_results.json` | Output of `validate.py` |

## Failure patterns (Table 1)

The deterministic patterns are defined in `analysis/analyze.py`:

- **`img_rule()`** covers the F30 patterns for text alternatives that are not alternatives:
  - **file names and identifiers:** file extension, camera prefix with digits, UUID, Facebook image ID, size suffix, AI-tool export name, or a single token joined by `-` or `_`;
  - **placeholders:** "Lorem ipsum", "null", "loading", a generic noun only, or a number only.
- **`link_rule()`** covers the F84 patterns for non-specific link text:
  - the unreplaced template label "Open Link Here";
  - generic phrases in English, Macedonian and Albanian;
  - symbol-only labels.
- **F65 (missing alt attribute)** is taken directly from the pipeline: an `<img>` without an `alt` attribute.

Patterns are matched case-insensitively on the exact attribute or text value.

## Reproducing the results

```bash
cd analysis
pip install -r requirements.txt
python analyze.py ../../data/reports ../results           # Table 1 counts, false-pass rates (RQ1), results/*.csv
python paper_tables.py ../../data/reports ../results      # Tables 2 and 3, McNemar, Fisher, Mann-Whitney (RQ2, RQ3)
python build_sample.py ../../data/reports ../validation   # regenerates the 200-element sample (identical to the one rated)
python validate.py ../validation                          # Table 4, kappa, AUC, score threshold, stratified estimates
```

## Manual validation

- **Sample:** 200 elements passed by axe-core, drawn at random within six strata:
  - 70 images with alt text matching no pattern;
  - 50 images with `alt=""`;
  - 20 images matching F30;
  - 25 links failed by the LLM;
  - 25 links passed by the LLM;
  - 10 links matching F84.
- **Rating:** the two authors rated every element jointly in a web form that hid the LLM verdicts, and agreed on one consensus label per element.
- **Images:** they recorded the role (informative, decorative or functional) and whether the alt text is acceptable for that role (WCAG SC 1.1.1, following the W3C alt decision tree). Nine images that no longer loaded are marked `not_loading` and excluded.
- **Links:** they recorded whether the purpose is clear from the link text alone (SC 2.4.9) and from the text with its context (SC 2.4.4).
- **`rater` field:** it holds the name entered in the form. Labels saved before the name was typed have an empty `rater` field.

## Notes and known limitations

- **Missing-alt images:** of the 138 images without an `alt` attribute, axe-core reported 91. The other 47 were most likely hidden and are excluded from the documented failures (Table 2), because their visibility cannot be established.
- **Image–violation matching:** images are matched to axe-core violations by file name in the HTML that axe-core reports. Some images inside nameless links may therefore be counted as passed.
- **Ministry of Health page:** the axe-core scan of this homepage returned no result. Its 27 images and 126 links therefore appear in no violation and count as passed by the rule engine.
- **The link count of 6,187:** it includes 3 rule-based summary entries produced by the pipeline's duplicate-text check. These are "previous" and "next" on the City of Skopje site and "more" on the Invest North Macedonia site. They are counted in the "other links" group of Table 3.
