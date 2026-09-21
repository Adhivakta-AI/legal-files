# Vidhi Kosh reading-copy pipeline

The renderer has two inputs with separate responsibilities:

- Indexed chunks supply stable judgment/chunk identifiers and the searchable text anchor.
- The preserved source PDF supplies typography, layout evidence, and high-confidence display-text repairs.

The source PDF remains the authoritative document. Generated reading copies are labelled unofficial editorial reproductions.

## Build one judgment

```bash
npm run reading-copy:build -- \
  reading-copy-data/samples/ISC-767B10C61F95314D1D77.md \
  --pdf /path/to/preserved-source.pdf
```

This runs five gated stages:

1. Extract positioned font runs with Poppler `pdftohtml`.
2. Align each indexed block to the known source PDF page.
3. Recover semantic case-law-reference tables from PDF geometry: stable citation, treatment, and paragraph-pinpoint columns are reconstructed across source pages with row-level chunk provenance.
4. Write and validate a versioned layout JSON with chunk IDs, source pages, styles, confidence, hashes, tables, and warnings, then render the HTML and tagged PDF with headless Chrome.
5. Compare the structured table and row counts with markers in the rendered HTML and verify that no table-source block leaked into ordinary digest text.

Artifacts are written to:

- `reading-copy-data/structured/<JUDGMENT_ID>-layout.json`
- `reading-copy-data/generated/<JUDGMENT_ID>-pipeline.html`
- `reading-copy-data/generated/<JUDGMENT_ID>-pipeline.pdf`

The Poppler XML is deliberately temporary. For the corpus batch, upload compressed layout JSON and generated PDFs to R2; store only a small version/status manifest in D1.

Case-law-reference extraction is fail-closed. Geometry that does not meet the structural, confidence, or provenance thresholds is rejected during layout validation. If a validated table is omitted, duplicated, loses rows during rendering, or also appears as digest prose, the post-render integrity gate fails the build and automatically moves the HTML and PDF into `reading-copy-data/quarantine/<JUDGMENT_ID>/...`. Quarantined artifacts are never publication candidates.

These machine-verifiable invariants replace document-by-document visual checking for this feature: every accepted source row has coordinates and chunk provenance, every structured row must have exactly one rendered row marker, and source table blocks must have no second prose rendering. Human review can therefore focus on template and extraction-rule changes instead of manually checking every generated judgment.

## Safety and fallback

- High-confidence embedded text can repair extraction artifacts, while `indexedText` and chunk IDs are retained for audit.
- Low-confidence blocks keep indexed text and plain styling rather than guessing.
- OCR-only/image-only sources need an explicit OCR fallback and lower style confidence.
- Physical source-page boundaries never terminate a logical paragraph or its styling.
