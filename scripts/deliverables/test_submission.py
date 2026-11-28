"""Regression checks for submission boundaries; no real credentials are used."""
import unittest
import subprocess
import tempfile
import zipfile
import io
import json
from pathlib import Path
from submission import allowed, checked, build, acceptance_gate, FOLDERS, PARTIAL_BEGIN, PARTIAL_END

MAIN = 'a' * 40


def summary(verdicts=None, commit=MAIN[:12]):
    """An acceptance summary with AT-01..AT-12; override verdicts by id."""
    verdicts = verdicts or {}
    return {'meta': {'commit': commit, 'dirty': False},
            'checks': [{'id': f'AT-{i:02}', 'title': f'Check {i}', 'verdict': verdicts.get(f'AT-{i:02}', 'PASS'),
                        'reason': f'reason {i}  spans\n two lines'} for i in range(1, 13)]}


def report_listing(*items):
    """A final-report fragment listing PARTIAL checks the way final-report.ts writes them."""
    body = '\n'.join(f'- **{i}** Check {int(i[3:])}: reason {int(i[3:])} spans two lines' for i in items)
    return f'Included verbatim from x\n{PARTIAL_BEGIN}\n{body}\n{PARTIAL_END}\n'


class AcceptanceGate(unittest.TestCase):
    def test_all_pass(self):
        self.assertEqual(acceptance_gate(summary(), MAIN, report_listing()), ([], []))

    def test_partial_allowed_and_listed_unchanged(self):
        gaps, partials = acceptance_gate(summary({'AT-06': 'PARTIAL', 'AT-12': 'PARTIAL'}), MAIN,
                                         report_listing('AT-06', 'AT-12'))
        self.assertEqual(gaps, [])
        self.assertEqual([p['id'] for p in partials], ['AT-06', 'AT-12'])
        self.assertTrue(all(p['verdict'] == 'PARTIAL' for p in partials))
        self.assertEqual(partials[0]['reason'], 'reason 6 spans two lines')

    def test_partial_not_in_final_report_blocks(self):
        gaps, _ = acceptance_gate(summary({'AT-06': 'PARTIAL', 'AT-12': 'PARTIAL'}), MAIN, report_listing('AT-06'))
        self.assertEqual(len(gaps), 1)
        self.assertIn('does not list PARTIAL AT-12', gaps[0])

    def test_fail_blocks(self):
        gaps, _ = acceptance_gate(summary({'AT-03': 'FAIL'}), MAIN, report_listing())
        self.assertEqual(gaps, ['AT-03 FAIL: reason 3 spans two lines'])

    def test_unknown_verdict_blocks(self):
        gaps, partials = acceptance_gate(summary({'AT-03': 'SKIPPED'}), MAIN, report_listing())
        self.assertIn("AT-03 has unknown verdict 'SKIPPED'", gaps)
        self.assertEqual(partials, [])

    def test_missing_or_duplicate_record_blocks(self):
        s = summary()
        s['checks'] = s['checks'][:-1]
        self.assertEqual(acceptance_gate(s, MAIN, report_listing())[0], ['Acceptance records missing: AT-12'])
        s = summary()
        s['checks'].append(dict(s['checks'][0]))
        self.assertIn('duplicate', acceptance_gate(s, MAIN, report_listing())[0][0])
        self.assertIn('missing', acceptance_gate(None, MAIN, '')[0][0])

    def test_evidence_not_from_main_blocks(self):
        for commit in ['b' * 12, '', 'not-a-sha']:
            gaps, _ = acceptance_gate(summary(commit=commit), MAIN, report_listing())
            self.assertEqual(gaps, ['Acceptance evidence is not from the submitted origin/main commit'], commit)


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

    def test_final_archive_allows_partial_and_lists_it_in_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def git(*args):
                return subprocess.check_output(['git', *args], cwd=root, stderr=subprocess.DEVNULL)
            git('init')
            git('config', 'user.name', 'Test')
            git('config', 'user.email', 'test@example.invalid')
            (root / 'hello.txt').write_text('safe source')
            # Every committed document the archive collects.
            for name in ['prompts/p.md', 'docs/chat-logs/c.txt', 'docs/prompt-generation.md',
                         'docs/diagrams/class-diagram.md', 'docs/diagrams/reverse-engineered.md',
                         'docs/diagrams/png/class-diagram.png', 'docs/diagrams/png/reverse-engineered.png',
                         'docs/diagrams/statecharts.md', 'docs/architecture.md', 'docs/deliverables.md',
                         'eval/results/x/report.md', 'docs/SRS.md', 'docs/api/index.html',
                         'docs/unit-tests.md', 'docs/presentation-outline.md']:
                (root / name).parent.mkdir(parents=True, exist_ok=True)
                (root / name).write_text('stub')
            git('add', '-A')
            git('commit', '-m', 'test fixture')
            git('update-ref', 'refs/remotes/origin/main', 'HEAD')
            main = git('rev-parse', 'HEAD').decode().strip()
            # Untracked evidence outputs, as a fresh evidence run on origin/main leaves them.
            (root / 'docs/presentation').mkdir(parents=True)
            (root / 'docs/presentation/git-network.png').write_bytes(b'png')
            (root / 'docs/presentation/presentation.pptx').write_bytes(b'pptx')
            (root / 'docs/acceptance/output').mkdir(parents=True)
            write = lambda s: (root / 'docs/acceptance/output/summary.json').write_text(json.dumps(s))
            write(summary({'AT-12': 'PARTIAL'}, commit=main[:12]))
            (root / 'docs/final-report.md').write_text(report_listing('AT-12'))
            with zipfile.ZipFile(io.BytesIO(build(root))) as archive:
                manifest = json.loads(archive.read('MANIFEST.json'))
            self.assertFalse(manifest['draft'])
            self.assertEqual(manifest['missing'], [])
            self.assertEqual(manifest['partialAcceptance'],
                             [{'id': 'AT-12', 'title': 'Check 12', 'verdict': 'PARTIAL', 'reason': 'reason 12 spans two lines'}])
            write(summary({'AT-12': 'FAIL'}, commit=main[:12]))
            with self.assertRaisesRegex(ValueError, 'AT-12 FAIL'):
                build(root)


if __name__ == '__main__':
    unittest.main()
