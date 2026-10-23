/** @import { ReactCodeMirrorRef } from '@uiw/react-codemirror' */
/** @import { Extension } from '@codemirror/state' */
import { useEffect, useMemo, useRef } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { yaml } from '@codemirror/lang-yaml';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

/**
 * @typedef {Object} LineHighlight
 * @property {number} line
 * @property {'del' | 'add' | 'focus'} kind
 */

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

/**
 * @param {string} content
 * @param {string | null} [fileName]
 * @returns {Extension[]}
 */
function languageFor(content, fileName) {
  const head = content.trimStart()[0];
  if (head === '{' || head === '[' || /\.json$/i.test(fileName ?? '')) return [json()];
  if (/\.(ya?ml)$/i.test(fileName ?? '') || /^[\w"'$-]+\s*:/m.test(content.slice(0, 400))) return [yaml()];
  return [];
}

/**
 * @param {LineHighlight[]} lines
 * @returns {Extension}
 */
function lineDecorations(lines) {
  return EditorView.decorations.compute([], (state) => {
    /** @type {RangeSetBuilder<Decoration>} */
    const b = new RangeSetBuilder();
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

/** @param {{ value: string; fileName?: string | null; highlights?: LineHighlight[]; scrollTo?: number | null; editable?: boolean; onChange?: (v: string) => void; height?: string; ariaLabel: string; }} props */
export default function CodePane({
  value,
  fileName,
  highlights = [],
  scrollTo,
  editable = false,
  onChange,
  height = '420px',
  ariaLabel,
}) {
  const ref = useRef(/** @type {ReactCodeMirrorRef} */ (null));
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

  /** @param {EditorView | undefined} view */
  const scroll = (view) => {
    if (!view || !scrollTo || scrollTo < 1 || scrollTo > view.state.doc.lines) return;
    const pos = view.state.doc.line(scrollTo).from;
    view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
  };
  useEffect(() => {
    // The view is created asynchronously; retry on the next frame when it is not ready yet.
    if (ref.current?.view) scroll(ref.current.view);
    else requestAnimationFrame(() => scroll(ref.current?.view));
  }, [scrollTo, value]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <CodeMirror
      ref={ref}
      value={value}
      height={height}
      theme="none"
      editable={editable}
      readOnly={!editable}
      onChange={onChange}
      onCreateEditor={(view) => requestAnimationFrame(() => scroll(view))}
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
