import sys
from pathlib import Path
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from captions import validate_request, prompt_for
class StyleTests(unittest.TestCase):
    def data(self):
        return dict(images=["data:image/jpeg;base64,/9j/2Q=="], platforms=["x"], shared=False, hasVideo=False)
    def test_style(self):
        d=self.data(); d["style"]={k:"test" for k in ["name","language","tone","audience","brand","forbidden"]}
        self.assertEqual(validate_request(d),d)
        self.assertIn('Style:',prompt_for(d))
        self.assertIn('260',prompt_for(d))
    def test_invalid_style(self):
        for style in [[], {}, {"name":123}]:
            d=self.data();d["style"]=style
            with self.assertRaises(ValueError):validate_request(d)
    def test_default(self):
        self.assertIn('idiomatic English',prompt_for(self.data()))
