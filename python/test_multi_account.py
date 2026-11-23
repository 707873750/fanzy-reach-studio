import unittest
import tempfile
from pathlib import Path
from publisher import Publisher

class MultiAccountTests(unittest.TestCase):
    def test_legacy_and_new_profiles_are_isolated(self):
        p = Publisher(None)
        with tempfile.TemporaryDirectory() as root:
            request = dict(platform='x', channel='chrome', profilesRoot=root)
            legacy = p.profile(request)
            self.assertEqual(legacy, Path(root).resolve() / 'chrome' / 'x')
            self.assertEqual(legacy, p.profile(dict(request, accountId='default-x')))
            first = p.profile(dict(request, accountId='12345678-1234-1234-1234-123456789abc'))
            second = p.profile(dict(request, accountId='12345678-1234-1234-1234-123456789abd'))
            self.assertNotEqual(first, second)
            self.assertNotEqual(first, legacy)
            for invalid in ['../../escape', 'default-instagram', '', 42, '/absolute']:
                with self.assertRaises(ValueError): p.profile(dict(request, accountId=invalid))

if __name__ == '__main__': unittest.main()
