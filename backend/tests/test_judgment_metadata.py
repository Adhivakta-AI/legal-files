import unittest

from scripts.judgment_metadata import (
    parse_opening_page,
    parse_upstream_metadata,
    reconcile_with_opening_page,
)


RAW_HTML = """
<button><input type='hidden' id='cnr' value=ESCR010002102026></button>
<br><strong>Coram : N KOTISWAR SINGH<sup class="tooltip-sup"
data-tooltip="Author">*</sup>, SANJAY KAROL</strong><br>
<strong class='caseDetailsTD'>
<span> Decision Date :</span><font> 01-07-2026</font>
<span> | Case No :</span><font> CRIMINAL APPEAL No. 3092/2026</font>
<span> | Disposal Nature :</span><font> Appeal(s) allowed</font>
<span> | Bench :</span><font> 2 Judges</font></strong>
"""


class JudgmentMetadataParserTests(unittest.TestCase):
    def test_parses_coram_author_bench_case_number_and_cnr(self) -> None:
        parsed = parse_upstream_metadata({"raw_html": RAW_HTML})

        self.assertEqual(parsed.judges, ("N KOTISWAR SINGH", "SANJAY KAROL"))
        self.assertEqual(parsed.author_judges, ("N KOTISWAR SINGH",))
        self.assertEqual(parsed.bench_size, 2)
        self.assertEqual(parsed.case_number, "CRIMINAL APPEAL No. 3092/2026")
        self.assertEqual(parsed.cnr, "ESCR010002102026")
        self.assertEqual(parsed.status, "verified")
        self.assertEqual(parsed.warnings, ())

    def test_case_number_is_optional_without_invalidating_bench(self) -> None:
        parsed = parse_upstream_metadata(
            {"raw_html": "<strong>Coram : A JUDGE, B JUDGE</strong> Bench : 2 Judges"}
        )

        self.assertEqual(parsed.status, "verified")
        self.assertEqual(parsed.warnings, ("missing_case_number",))

    def test_count_mismatch_is_sent_to_review(self) -> None:
        parsed = parse_upstream_metadata(
            {"raw_html": "<strong>Coram : A JUDGE</strong> Bench : 2 Judges"}
        )

        self.assertEqual(parsed.status, "needs_review")
        self.assertIn("bench_coram_count_mismatch", parsed.warnings)

    def test_missing_html_is_invalid(self) -> None:
        parsed = parse_upstream_metadata({})
        self.assertEqual(parsed.status, "invalid")
        self.assertEqual(parsed.warnings, ("missing_raw_html",))

    def test_pdf_opening_supplies_display_order_names_and_case_number(self) -> None:
        upstream = parse_upstream_metadata({"raw_html": RAW_HTML})
        opening = parse_opening_page(
            """
            (Criminal Appeal No. 3092 of 2026)
            [Sanjay Karol* and Nongmeikapam Kotiswar Singh, JJ.]
            """
        )
        parsed = reconcile_with_opening_page(upstream, opening)

        self.assertEqual(
            parsed.judges,
            ("Sanjay Karol", "Nongmeikapam Kotiswar Singh"),
        )
        self.assertEqual(parsed.author_judges, ("Sanjay Karol",))
        self.assertEqual(parsed.case_number, "Criminal Appeal No. 3092 of 2026")
        self.assertEqual(parsed.status, "verified")
        self.assertIn("upstream_author_marker_disagrees_with_pdf", parsed.warnings)

    def test_pdf_opening_handles_chief_justice_designation(self) -> None:
        opening = parse_opening_page("[A. Judge, C.J., B. Judge and C. Judge, JJ.]")
        self.assertEqual(opening.judges, ("A. Judge", "B. Judge", "C. Judge"))

    def test_noisy_ocr_does_not_override_consistent_upstream_coram(self) -> None:
        upstream = parse_upstream_metadata({"raw_html": RAW_HTML})
        parsed = reconcile_with_opening_page(
            upstream,
            parse_opening_page("[N. Koriswar Singh and Sanjay Karol, JJ.]"),
        )
        self.assertEqual(parsed.judges, upstream.judges)
        self.assertEqual(parsed.status, "verified")
        self.assertIn("ocr_coram_mismatch", parsed.warnings)


if __name__ == "__main__":
    unittest.main()
