import tempfile
import unittest
from pathlib import Path
from adapters import validate


class MediaValidationTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
