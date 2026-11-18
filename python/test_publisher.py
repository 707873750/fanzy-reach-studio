import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock
from adapters import caption, validate, submit


class PublicationSafetyTests(unittest.TestCase):
    def test_validation_prevents_empty_or_missing_media_and_missing_board(self):
        for job in ({"platform": "unknown"}, {"platform": "x", "files": []},
                    {"platform": "x", "files": ["does-not-exist.jpg"]}):
            with self.assertRaises(ValueError):
                validate(job)
        with tempfile.TemporaryDirectory() as folder:
            file = Path(folder) / "image.jpg"
            file.write_bytes(b"image")
            with self.assertRaises(ValueError):
                validate({"platform": "pinterest", "files": [str(file)]})
            validate({"platform": "pinterest", "files": [str(file)], "boardName": "Art"})
            with self.assertRaises(ValueError):
                validate({"platform": "x", "files": [str(file)] * 5})

    def test_alt_text_is_not_in_caption(self):
        self.assertEqual(caption({"title": "Title", "caption": "Body", "hashtags": ["#art"], "altText": "Secret alt"}), "Title\n\nBody\n\n#art")

    def test_no_click_if_checkpoint_fails(self):
        control = Mock()
        control.count.return_value = 1
        control.is_enabled.return_value = True
        with self.assertRaises(OSError):
            submit(Mock(), control, Mock(), Mock(side_effect=OSError("disk full")))
        control.click.assert_not_called()

    def test_no_click_with_stale_confirmation(self):
        control, success = Mock(), Mock()
        success.wait_for.side_effect = TimeoutError()
        with self.assertRaises(TimeoutError):
            submit(Mock(), control, success, Mock())
        control.click.assert_not_called()

    def test_checkpoint_before_click_and_confirmation_after(self):
        events = []
        control, success, page = Mock(), Mock(), Mock()
        page.url = "https://x.com/artist/status/123"
        control.count.return_value = 1
        control.is_enabled.return_value = True
        control.click.side_effect = lambda **_: events.append("click")
        success.wait_for.side_effect = lambda **kw: events.append(kw["state"])
        self.assertEqual(submit(page, control, success, lambda: events.append("checkpoint")), page.url)
        self.assertEqual(events, ["hidden", "checkpoint", "click", "visible"])

    def test_timeout_after_submission_does_not_retry_click(self):
        control, success = Mock(), Mock()
        control.count.return_value = 1
        control.is_enabled.return_value = True
        success.wait_for.side_effect = [None, TimeoutError()]
        with self.assertRaises(TimeoutError):
            submit(Mock(), control, success, Mock())
        control.click.assert_called_once()


if __name__ == "__main__":
    unittest.main()
