"""Regression checks for submission boundaries; no real credentials are used."""
import unittest
import subprocess
import tempfile
import zipfile
import io
from pathlib import Path
from submission import allowed, checked, build, FOLDERS


class SubmissionSafety(unittest.TestCase):
    def test_exclusions(self):
        for path in ['.env', 'x/.env.local', 'node_modules/a', 'x/.work/a', '../a', '/tmp/a', 'exports/a']:
            self.assertFalse(allowed(path), path)
        self.assertTrue(allowed('.env.example'))
        self.assertTrue(allowed('packages/core/src/index.ts'))

    def test_scan_does_not_print_value(self):
        token = ('gh' + 'p_' + 'z' * 30).encode()
        with self.assertRaises(ValueError) as result:
            checked('source.ts', token)
        self.assertNotIn(token.decode(), str(result.exception))
        self.assertEqual(checked('safe.txt', b'hello'), b'hello')

    def test_draft_manifest_and_final_gate(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def git(*args):
                return subprocess.check_output(['git', *args], cwd=root, stderr=subprocess.DEVNULL)
            git('init')
            git('config', 'user.name', 'Test')
            git('config', 'user.email', 'test@example.invalid')
            (root / 'hello.txt').write_text('safe source')
            (root / '.env').write_text('never archive this')
            git('add', 'hello.txt')
            git('commit', '-m', 'test fixture')
            git('update-ref', 'refs/remotes/origin/main', 'HEAD')
            data = build(root, draft=True)
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                names = archive.namelist()
                for folder in FOLDERS:
                    self.assertIn(folder + '/', names)
                self.assertIn('6_source_code/hello.txt', names)
                self.assertNotIn('6_source_code/.env', names)
                self.assertIn(b'"draft": true', archive.read('MANIFEST.json'))
            with self.assertRaisesRegex(ValueError, 'Final submission is incomplete'):
                build(root)
            # A credential-shaped tracked source must fail even in draft mode.
            (root / 'bad.txt').write_text('gh' + 'p_' + 'z' * 30)
            git('add', 'bad.txt')
            git('commit', '-m', 'planted fixture')
            with self.assertRaisesRegex(ValueError, 'Token-looking content'):
                build(root, draft=True)


if __name__ == '__main__':
    unittest.main()
