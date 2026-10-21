// Protects the fence-label table: the id sent to `editor.newFile` must be a VS Code language id
// (not the highlight.js name), and an unknown or prototype-ish label must not match.
//
// Provenance: the expectations come from the plan table (`plan-fase2` §Paso 2) and the built-in
// VS Code ids; NOT checked against `vscode.languages.getLanguages()` here (the host does that).
import { describe, expect, it } from 'vitest';
import { toHighlightLanguage, toVscodeLanguage } from './languageIds';

describe('toVscodeLanguage', () => {
  it.each([
    ['ts', 'typescript'],
    ['js', 'javascript'],
    ['py', 'python'],
    ['sh', 'shellscript'],
    ['bash', 'shellscript'],
    ['zsh', 'shellscript'],
    ['ps1', 'powershell'],
    ['powershell', 'powershell'],
    ['yml', 'yaml'],
    ['md', 'markdown'],
    ['cs', 'csharp'],
    ['rs', 'rust'],
    ['TS', 'typescript'],
    [' json ', 'json'],
    ['c', 'c'],
  ])('%j -> %s', (fence, expected) => {
    expect(toVscodeLanguage(fence)).toBe(expected);
  });

  it('is undefined for no label, an unknown label and inherited keys', () => {
    expect(toVscodeLanguage(undefined)).toBeUndefined();
    expect(toVscodeLanguage('klingon')).toBeUndefined();
    expect(toVscodeLanguage('constructor')).toBeUndefined();
    expect(toVscodeLanguage('__proto__')).toBeUndefined();
  });
});

describe('toHighlightLanguage', () => {
  it('uses the highlight.js name, which differs from the VS Code id', () => {
    expect(toHighlightLanguage('sh')).toBe('bash');
    expect(toHighlightLanguage('html')).toBe('xml');
    expect(toHighlightLanguage('tsx')).toBe('typescript');
  });

  it('is undefined for a language we do not register', () => {
    expect(toHighlightLanguage('c')).toBeUndefined();
    expect(toHighlightLanguage('ruby')).toBeUndefined();
  });
});
