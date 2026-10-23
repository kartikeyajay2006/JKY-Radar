import { useEffect, useMemo, useRef } from 'react';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { yaml } from '@codemirror/lang-yaml';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { RangeSetBuilder, type Extension } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

export interface LineHighlight {
  line: number;
  kind: 'del' | 'add' | 'focus';
}

const highlight = HighlightStyle.define([
  { tag: [t.propertyName, t.definition(t.propertyName)], color: 'var(--accent)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--safe)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--potential)' },
  { tag: [t.keyword, t.typeName], color: 'var(--inconclusive)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--faint)', fontStyle: 'italic' },
  { tag: [t.punctuation, t.separator, t.bracket], color: 'var(--muted)' },
]);

const baseTheme = EditorView.theme({
  '&': { color: 'var(--fg-soft)', backgroundColor: 'var(--code-bg)', height: '100%' },
  '.cm-content': { caretColor: 'var(--accent)', padding: '8px 0' },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--fg)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--hl-focus) !important',
  },
  '.cm-cursor': { borderLeftColor: 'var(--accent)' },
  '.cm-foldGutter': { display: 'none' },
});

function languageFor(content: string, fileName?: string | null): Extension[] {
  const head = content.trimStart()[0];
  if (head === '{' || head === '[' || /\.json$/i.test(fileName ?? '')) return [json()];
  if (/\.(ya?ml)$/i.test(fileName ?? '') || /^[\w"'$-]+\s*:/m.test(content.slice(0, 400))) return [yaml()];
  return [];
}

function lineDecorations(lines: LineHighlight[]): Extension {
  return EditorView.decorations.compute([], (state) => {
    const b = new RangeSetBuilder<Decoration>();
    const sorted = [...lines]
      .filter((l) => l.line >= 1 && l.line <= state.doc.lines)
      .sort((a, c) => a.line - c.line);
    let last = -1;
    for (const l of sorted) {
      if (l.line === last) continue;
      last = l.line;
      const line = state.doc.line(l.line);
      b.add(line.from, line.from, Decoration.line({ class: `jky-hl-${l.kind}` }));
    }
    return b.finish();
  });
}

export default function CodePane({
  value,
  fileName,
  highlights = [],
  scrollTo,
  editable = false,
  onChange,
  height = '420px',
  ariaLabel,
}: {
  value: string;
  fileName?: string | null;
  highlights?: LineHighlight[];
  scrollTo?: number | null;
  editable?: boolean;
  onChange?: (v: string) => void;
  height?: string;
  ariaLabel: string;
}) {
  const ref = useRef<ReactCodeMirrorRef>(null);
  const lang = useMemo(() => languageFor(value, fileName), [value.slice(0, 400), fileName]); // eslint-disable-line react-hooks/exhaustive-deps
  const extensions = useMemo(
    () => [
      ...lang,
      baseTheme,
      syntaxHighlighting(highlight),
      lineDecorations(highlights),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of(
        editable
          ? { 'aria-label': ariaLabel, tabindex: '0' }
          : {
              'aria-label': ariaLabel,
              tabindex: '0',
              role: 'textbox',
              'aria-readonly': 'true',
              'aria-multiline': 'true',
            },
      ),
    ],
    [lang, highlights, ariaLabel, editable],
  );

  useEffect(() => {
    const view = ref.current?.view;
    if (!view || !scrollTo || scrollTo < 1 || scrollTo > view.state.doc.lines) return;
    const pos = view.state.doc.line(scrollTo).from;
    view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
  }, [scrollTo, value]);

  return (
    <CodeMirror
      ref={ref}
      value={value}
      height={height}
      theme="none"
      editable={editable}
      readOnly={!editable}
      onChange={onChange}
      extensions={extensions}
      basicSetup={{
        foldGutter: false,
        highlightActiveLine: editable,
        highlightActiveLineGutter: editable,
        autocompletion: false,
        searchKeymap: true,
      }}
      className="overflow-hidden"
    />
  );
}
