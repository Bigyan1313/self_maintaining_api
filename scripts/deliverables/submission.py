"""Package the course deliverables; fail closed on unsafe paths and credential strings."""
import argparse
import io
import json
import re
import subprocess
import tarfile
import zipfile
from pathlib import Path, PurePosixPath

BLOCKED = {'.env', '.git', 'node_modules', '.work', 'exports', 'submission', '__pycache__'}
TOKEN = re.compile(rb'(?<![A-Za-z0-9])(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)')
FOLDERS = ['1_prompts', '2_acceptance_tests', '3_class_diagram', '4_statecharts', '5_description', '6_source_code', '7_api_docs', '8_unit_tests', '10_presentation']


def allowed(name):
    """Reject traversal, secret files, dependency trees and generated export directories."""
    path = PurePosixPath(name)
    return not path.is_absolute() and '..' not in path.parts and not any(
        part in BLOCKED or (part.startswith('.env.') and part != '.env.example')
        for part in path.parts
    )


def checked(name, data):
    """Scan bytes without ever printing matched credentials."""
    if TOKEN.search(data):
        raise ValueError(f'Token-looking content in {name}; archive refused (value not printed)')
    return data


def build(root, draft=False):
    """Return a validated bundle in memory, before replacing any output archive."""
    files = {}
    gaps = []
    def add(path, target):
        if not path.exists():
            gaps.append(str(path.relative_to(root)))
            return
        paths = sorted(path.rglob('*')) if path.is_dir() else [path]
        for item in paths:
            if item.is_symlink():
                raise ValueError(f'Symlinks are not permitted: {item.relative_to(root)}')
            if not item.is_file():
                continue
            if not allowed(item.relative_to(root).as_posix()):
                continue
            dest = target + ('/' + item.relative_to(path).as_posix() if path.is_dir() else '')
            files[dest] = checked(dest, item.read_bytes())
    def git(*args):
        return subprocess.check_output(['git', *args], cwd=root)
    main = git('rev-parse', 'origin/main').decode().strip()
    head = git('rev-parse', 'HEAD').decode().strip()
    if head != main:
        gaps.append('HEAD must equal fetched origin/main for the final submission')
    if git('status', '--porcelain').strip():
        gaps.append('Working tree must be clean for the final submission')
    source_commit = head if draft else main
    source = git('archive', '--format=tar', source_commit)
    with tarfile.open(fileobj=io.BytesIO(source)) as tar:
        for member in tar:
            if not allowed(member.name):
                continue
            if member.issym() or member.islnk():
                raise ValueError(f'Archive contains a symlink: {member.name}')
            if member.isfile():
                dest = '6_source_code/' + member.name
                files[dest] = checked(dest, tar.extractfile(member).read())
    for source, target in [
        ('prompts', '1_prompts/prompts'), ('docs/chat-logs', '1_prompts/chat-logs'),
        ('docs/prompt-generation.md', '1_prompts/prompt-generation.md'),
        ('docs/acceptance', '2_acceptance_tests'),
        ('docs/diagrams/class-diagram.md', '3_class_diagram/class-diagram.md'),
        ('docs/diagrams/reverse-engineered.md', '3_class_diagram/reverse-engineered.md'),
        ('docs/diagrams/png/class-diagram.png', '3_class_diagram/png/class-diagram.png'),
        ('docs/diagrams/png/reverse-engineered.png', '3_class_diagram/png/reverse-engineered.png'),
        ('docs/diagrams/statecharts.md', '4_statecharts/statecharts.md'),
        ('docs/architecture.md', '5_description/architecture.md'),
        ('docs/final-report.md', '5_description/final-report.md'),
        ('docs/SRS.md', '5_description/SRS.md'),
        ('docs/api', '7_api_docs'), ('docs/unit-tests.md', '8_unit_tests/unit-tests.md'),
        ('docs/presentation-outline.md', '10_presentation/outline.md'),
        ('docs/presentation', '10_presentation'),
    ]:
        add(root / source, target)
    for path in (root / 'docs/diagrams/png').glob('statechart-*.png'):
        add(path, '4_statecharts/png/' + path.name)
    for name in git('ls-files', '-z').decode().split('\0'):
        if name.endswith(('.test.ts', '.test.tsx')):
            add(root / name, '8_unit_tests/' + name)
    for name in ['docs/presentation/git-network.png', 'docs/presentation/presentation.pptx']:
        if not (root / name).is_file():
            gaps.append(name)
    report = (root / 'docs/final-report.md').read_text() if (root / 'docs/final-report.md').exists() else ''
    if 'Included verbatim from ' not in report:
        gaps.append('Generated evaluation report has not been included')
    summary_path = root / 'docs/acceptance/output/summary.json'
    if summary_path.exists():
        summary = json.loads(summary_path.read_text())
        checks = summary.get('checks', [])
        expected = {f'AT-{i:02}' for i in range(1, 13)}
        if {c['id'] for c in checks} != expected or any(c['verdict'] != 'PASS' for c in checks):
            gaps.append('Acceptance checks are incomplete or not all PASS; review the actual records')
        if not main.startswith(summary.get('meta', {}).get('commit', 'MISSING')):
            gaps.append('Acceptance evidence is not from the submitted main commit')
    else:
        gaps.append('Acceptance summary missing')
    if gaps and not draft:
        raise ValueError('Final submission is incomplete:\n- ' + '\n- '.join(gaps))
    manifest = {'draft': draft, 'sourceCommit': source_commit, 'evidenceCommit': head, 'missing': gaps,
                'note': 'Review generated results and semantic reviews; a bundle is not a certification of model quality.'}
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as out:
        for folder in FOLDERS:
            out.writestr(folder + '/', b'')
        out.writestr('MANIFEST.json', json.dumps(manifest, indent=2))
        for name, data in sorted(files.items()):
            out.writestr(name, data)
    return stream.getvalue()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--draft', action='store_true', help='Label incomplete evidence DRAFT, retaining all security checks')
    options = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    try:
        data = build(root, options.draft)
        directory = root / 'submission'
        directory.mkdir(exist_ok=True)
        target = directory / ('Group13_SelfMaintainingAPIs' + ('_DRAFT' if options.draft else '') + '.zip')
        target.write_bytes(data)
        print(target)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, str(error) + '\n')
