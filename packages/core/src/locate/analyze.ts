import { Node, Project, SyntaxKind, ts, type CallExpression, type SourceFile } from 'ts-morph';
import type { CallPattern } from '../domain/enums.js';
import type { CallSite, LocateTarget, UnsupportedUsage } from './types.js';

const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);
type Client = 'fetch' | 'axios_static' | 'axios_instance' | 'alias' | 'unknown';

function imported(node: Node) {
  const declaration = node.getFirstAncestorByKind(SyntaxKind.ImportDeclaration);
  return declaration?.getModuleSpecifierValue();
}

// Resolve only declarations in the in-memory project. No target configuration or code executes.
function client(node: Node, seen = new Set<Node>()): Client {
  if (seen.has(node)) return 'unknown';
  seen.add(node);
  if (!Node.isIdentifier(node)) return 'unknown';
  const declarations = node.getSymbol()?.getDeclarations() ?? [];
  if (node.getText() === 'fetch' && declarations.length === 0) return 'fetch';
  for (const d of declarations) {
    if (Node.isImportClause(d) && imported(d) === 'axios') return 'axios_static';
    if (Node.isImportSpecifier(d)) {
      if (imported(d) === 'axios' || ['fetch', 'axios'].includes(d.getName())) return 'alias';
      const module = d
        .getFirstAncestorByKind(SyntaxKind.ImportDeclaration)
        ?.getModuleSpecifierSourceFile();
      if (module?.getExportDeclarations().some((e) => e.getModuleSpecifier())) return 'alias';
      const resolved = d.getSymbol()?.getAliasedSymbol()?.getDeclarations() ?? [];
      if (
        resolved.some((r) => Node.isVariableDeclaration(r) && isInstance(r.getInitializer(), seen))
      )
        return 'axios_instance';
      return resolved.some(Node.isExportSpecifier) ? 'alias' : 'unknown';
    }
    if (Node.isImportClause(d)) {
      const resolved =
        d.getDefaultImport()?.getSymbol()?.getAliasedSymbol()?.getDeclarations() ?? [];
      if (
        resolved.some((r) => Node.isVariableDeclaration(r) && isInstance(r.getInitializer(), seen))
      )
        return 'axios_instance';
      return 'unknown';
    }
    if (Node.isBindingElement(d)) {
      const init = d.getFirstAncestorByKind(SyntaxKind.VariableDeclaration)?.getInitializer();
      if (init && client(init, seen) !== 'unknown') return 'alias';
    }
    if (Node.isNamespaceImport(d) && imported(d) === 'axios') return 'alias';
    if (Node.isVariableDeclaration(d)) {
      const init = d.getInitializer();
      if (isInstance(init, seen)) return 'axios_instance';
      if (init && Node.isIdentifier(init) && client(init, seen) !== 'unknown') return 'alias';
      if (
        init &&
        Node.isPropertyAccessExpression(init) &&
        client(init.getExpression(), seen) !== 'unknown'
      )
        return 'alias';
    }
  }
  return 'unknown';
}
function isInstance(node: Node | undefined, seen: Set<Node>): boolean {
  if (!node || !Node.isCallExpression(node)) return false;
  const expression = node.getExpression();
  return (
    Node.isPropertyAccessExpression(expression) &&
    expression.getName() === 'create' &&
    client(expression.getExpression(), new Set(seen)) === 'axios_static'
  );
}
function literal(node: Node | undefined): string | undefined {
  return node && (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node))
    ? node.getLiteralText()
    : undefined;
}
function property(object: Node | undefined, name: string): Node | undefined {
  if (!object || !Node.isObjectLiteralExpression(object)) return undefined;
  const p = object.getProperty(name);
  return p && Node.isPropertyAssignment(p) ? p.getInitializer() : undefined;
}
function certainObject(node: Node | undefined): boolean {
  return (
    !node ||
    (Node.isObjectLiteralExpression(node) &&
      node
        .getProperties()
        .every(
          (p) => Node.isPropertyAssignment(p) && !Node.isComputedPropertyName(p.getNameNode()),
        ))
  );
}
function parameter(node: Node): boolean {
  return (
    Node.isIdentifier(node) &&
    (node.getSymbol()?.getDeclarations() ?? []).some(Node.isParameterDeclaration)
  );
}
function segment(node: Node, seen = new Set<Node>()): boolean {
  if (seen.has(node)) return false;
  seen.add(node);
  if (Node.isNumericLiteral(node) || Node.isStringLiteral(node))
    return !node.getText().includes('/');
  // Parameters are supported within an already anchored route, but computed local paths are not.
  if (parameter(node)) return true;
  return (
    Node.isIdentifier(node) &&
    (node.getSymbol()?.getDeclarations() ?? []).some((d) => {
      const init = Node.isVariableDeclaration(d) ? d.getInitializer() : undefined;
      return init ? segment(init, seen) : false;
    })
  );
}
function urlTemplate(node: Node | undefined): { path?: string; wrapper?: boolean } {
  const text = literal(node);
  if (text !== undefined) return { path: normalizePath(text) };
  if (!node) return {};
  if (!Node.isTemplateExpression(node)) return { wrapper: parameter(node) };
  let path = node.getHead().getLiteralText();
  const spans = node.getTemplateSpans();
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i]!;
    const tail = span.getLiteral().getLiteralText();
    if (i === 0 && path === '' && tail.startsWith('/')) {
      path = tail; // leading configured base, e.g. apiBaseUrl(), BASE, process.env.API_URL
      continue;
    }
    const expression = span.getExpression();
    if (!path.startsWith('/') && !path.startsWith('http://') && !path.startsWith('https://'))
      return { wrapper: spans.some((s) => parameter(s.getExpression())) };
    if (!segment(expression)) return {};
    path += '{}' + tail;
  }
  return { path: normalizePath(path) };
}
function normalizePath(path: string): string {
  // URL normalization only; calls themselves are discovered exclusively from syntax nodes.
  return path
    .replace(/^https?:\/\/[^/]+/, '')
    .split(/[?#]/)[0]!
    .replace(/\{[^}]*\}/g, '{}');
}
function matchesPath(actual: string, target: string): boolean {
  const parts = actual.split('/');
  const wanted = normalizePath(target).split('/');
  return (
    parts.length === wanted.length &&
    parts.every((part, i) => (wanted[i] === '{}' ? part.length > 0 : part === wanted[i]))
  );
}
function evidence(node: Node) {
  const source = node.getSourceFile();
  const position = source.getLineAndColumnAtPos(node.getStart());
  return {
    filePath: source.getFilePath().slice('/repo/'.length),
    line: position.line,
    column: position.column,
    excerpt: source
      .getFullText()
      .split(/\r\n|\n|\r/)
      .slice(Math.max(0, position.line - 3), position.line + 2)
      .join('\n'),
  };
}
function generated(call: CallExpression, target: LocateTarget): boolean {
  const expression = call.getExpression();
  if (!target.operationId || !Node.isIdentifier(expression)) return false;
  return (expression.getSymbol()?.getDeclarations() ?? []).some(
    (d) =>
      Node.isImportSpecifier(d) &&
      d.getName() === target.operationId &&
      (imported(d)?.split('/').includes('generated') ?? false),
  );
}

/** Analyze selected source snapshots with an isolated, memory-only TypeScript project. */
export function analyzeSources(
  sources: ReadonlyMap<string, string>,
  target: LocateTarget,
): { callSites: CallSite[]; unsupported: UnsupportedUsage[]; invalidFiles: string[] } {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      noLib: true,
    },
  });
  for (const [path, text] of sources) project.createSourceFile(`/repo/${path}`, text);
  const callSites: CallSite[] = [];
  const unsupported: UnsupportedUsage[] = [];
  const invalidFiles: string[] = [];
  const addUnsupported = (node: Node, kind: UnsupportedUsage['kind']) => {
    const e = evidence(node);
    if (!unsupported.some((u) => u.filePath === e.filePath && u.line === e.line && u.kind === kind))
      unsupported.push({ filePath: e.filePath, line: e.line, excerpt: e.excerpt, kind });
  };
  function inspect(source: SourceFile) {
    if (project.getProgram().compilerObject.getSyntacticDiagnostics(source.compilerNode).length) {
      invalidFiles.push(source.getFilePath().slice('/repo/'.length));
      return;
    }
    for (const declaration of source.getExportDeclarations())
      if (
        declaration.getModuleSpecifier() ||
        declaration.getNamedExports().some((e) => ['fetch', 'axios'].includes(e.getName()))
      )
        addUnsupported(declaration, 'reexported_alias');
    for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (generated(call, target)) {
        callSites.push({ ...evidence(call), pattern: 'generated_client' });
        continue;
      }
      const expression = call.getExpression();
      const args = call.getArguments();
      let kind: Client;
      let method: string | undefined;
      let url: Node | undefined;
      if (Node.isIdentifier(expression)) {
        kind = client(expression);
        if (kind === 'fetch') {
          const options = args[1];
          const methodNode = property(options, 'method');
          method = certainObject(options)
            ? methodNode
              ? literal(methodNode)?.toUpperCase()
              : 'GET'
            : undefined;
          url = args[0];
        } else if (kind === 'axios_static' || kind === 'axios_instance') {
          method = certainObject(args[0])
            ? (literal(property(args[0], 'method')) ?? 'GET').toUpperCase()
            : undefined;
          if (property(args[0], 'method') && literal(property(args[0], 'method')) === undefined)
            method = undefined;
          url = property(args[0], 'url');
        } else if (kind === 'alias') {
          addUnsupported(call, 'reexported_alias');
          continue;
        } else if (expression.getText() === 'fetch') {
          addUnsupported(call, 'unknown_client');
          continue;
        } else continue;
      } else if (Node.isPropertyAccessExpression(expression)) {
        const name = expression.getName();
        kind = client(expression.getExpression());
        if (name === 'create' && kind === 'axios_static') continue;
        if (!METHODS.has(name)) {
          if (kind !== 'unknown' || name === 'fetch') addUnsupported(call, 'unknown_client');
          continue;
        }
        if (kind === 'alias') {
          addUnsupported(call, 'reexported_alias');
          continue;
        }
        if (kind !== 'axios_static' && kind !== 'axios_instance') {
          addUnsupported(call, 'unknown_client');
          continue;
        }
        method = name.toUpperCase();
        url = args[0];
      } else {
        if (Node.isElementAccessExpression(expression)) addUnsupported(call, 'unknown_client');
        continue;
      }
      if (!method) {
        addUnsupported(call, 'unknown_client');
        continue;
      }
      const template = urlTemplate(url);
      if (!template.path) {
        addUnsupported(call, template.wrapper ? 'wrapper' : 'dynamic_url');
        continue;
      }
      if (method === target.method && matchesPath(template.path, target.path))
        callSites.push({ ...evidence(call), pattern: kind as CallPattern });
    }
  }
  for (const source of project.getSourceFiles()) inspect(source);
  return { callSites, unsupported, invalidFiles };
}
