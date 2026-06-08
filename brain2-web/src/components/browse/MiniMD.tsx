/*
 * Brain2 Console — shared minimal markdown renderer (headings, bold, italic,
 * code, wiki-links [[..]], citation footnotes [^n] / [#n], blockquote, lists).
 * Faithful TS port of docs/design/v1/project/md.jsx.
 */
import { Fragment, type ReactNode } from 'react';

type CiteFn = ((token: string) => void) | undefined;
type WikiLinkFn = ((topic: string) => void) | undefined;

interface MdOpts {
  onCite?: CiteFn;
  onWikiLink?: WikiLinkFn;
  knownTopics?: Set<string>;
}

function mdInline(s: string, key: number | string, opts: MdOpts = {}): ReactNode {
  const { onCite, onWikiLink, knownTopics } = opts;
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`|\[\[[^\]]+\]\]|\[\^\d+\]|\[#\d+\])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) parts.push(s.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('**')) parts.push(<b key={i++} style={{ fontWeight: 600, color: 'var(--fg)' }}>{t.slice(2, -2)}</b>);
    else if (t.startsWith('*')) parts.push(<i key={i++} style={{ fontStyle: 'italic' }}>{t.slice(1, -1)}</i>);
    else if (t.startsWith('`')) parts.push(<code key={i++} style={{ fontFamily: 'var(--mono-font)', fontSize: '0.88em', background: 'var(--surface-2)', padding: '1px 5px', borderRadius: 5, color: 'var(--fg)' }}>{t.slice(1, -1)}</code>);
    else if (t.startsWith('[[')) {
      const topic = t.slice(2, -2);
      const resolved = !knownTopics || knownTopics.has(topic);
      parts.push(
        <a
          key={i++}
          href={`/wiki/${encodeURIComponent(topic)}`}
          onClick={(e) => {
            if (!onWikiLink) return;
            e.preventDefault();
            onWikiLink(topic);
          }}
          title={resolved ? topic : `${topic} - no page yet`}
          style={{
            color: resolved ? 'var(--accent)' : 'var(--fg-muted)',
            textDecoration: 'none',
            cursor: 'pointer',
            borderBottom: resolved ? '1px solid var(--accent-line)' : '1px dashed var(--border-strong)',
          }}
        >
          {topic}
        </a>,
      );
    }
    else if (t.startsWith('[#')) parts.push(<a key={i++} onClick={() => onCite && onCite(t)} style={{ color: 'var(--accent)', textDecoration: 'none', fontFamily: 'var(--mono-font)', fontSize: '0.82em', fontWeight: 600, background: 'var(--accent-soft)', borderRadius: 5, padding: '1px 5px', margin: '0 1px', cursor: 'pointer' }}>{t.slice(1, -1)}</a>);
    else parts.push(<sup key={i++} onClick={() => onCite && onCite(t)} style={{ color: 'var(--accent)', fontFamily: 'var(--mono-font)', fontSize: '0.7em', cursor: 'pointer', background: 'var(--accent-soft)', borderRadius: 4, padding: '1px 4px', margin: '0 1px' }}>{t.replace(/[[\]^]/g, '')}</sup>);
    last = m.index + t.length;
  }
  if (last < s.length) parts.push(s.slice(last));
  return <Fragment key={key}>{parts}</Fragment>;
}

export function MiniMD({ text, onCite, onWikiLink, knownTopics }: {
  text: string; onCite?: CiteFn; onWikiLink?: WikiLinkFn; knownTopics?: Set<string>;
}) {
  const opts: MdOpts = { onCite, onWikiLink, knownTopics };
  const lines = (text || '').split('\n');
  const out: ReactNode[] = [];
  let list: ReactNode[] = [];
  const flush = (k: number | string) => { if (list.length) { out.push(<ul key={'u' + k} style={{ margin: '6px 0 12px', paddingLeft: 20, color: 'var(--fg-muted)' }}>{list}</ul>); list = []; } };
  lines.forEach((ln, i) => {
    if (/^### /.test(ln)) { flush(i); out.push(<h3 key={i} style={{ fontFamily: 'var(--display-font)', fontSize: 15, fontWeight: 600, color: 'var(--fg)', margin: '16px 0 6px' }}>{mdInline(ln.slice(4), i, opts)}</h3>); }
    else if (/^## /.test(ln)) { flush(i); out.push(<h2 key={i} style={{ fontFamily: 'var(--display-font)', fontSize: 18, fontWeight: 600, color: 'var(--fg)', margin: '20px 0 8px', letterSpacing: 'var(--display-track)' }}>{mdInline(ln.slice(3), i, opts)}</h2>); }
    else if (/^# /.test(ln)) { flush(i); out.push(<h1 key={i} style={{ fontFamily: 'var(--display-font)', fontSize: 24, fontWeight: 700, color: 'var(--fg)', margin: '4px 0 12px', letterSpacing: 'var(--display-track)' }}>{mdInline(ln.slice(2), i, opts)}</h1>); }
    else if (/^> /.test(ln)) { flush(i); out.push(<blockquote key={i} style={{ margin: '10px 0', padding: '6px 14px', borderLeft: '3px solid var(--accent-line)', color: 'var(--fg-muted)', fontStyle: 'italic' }}>{mdInline(ln.slice(2), i, opts)}</blockquote>); }
    else if (/^\[\^\d+\]:/.test(ln)) { flush(i); out.push(<div key={i} style={{ fontSize: 12, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)', margin: '2px 0', paddingTop: 6 }}>{ln}</div>); }
    else if (/^- /.test(ln)) { list.push(<li key={i} style={{ margin: '3px 0', lineHeight: 1.55 }}>{mdInline(ln.slice(2), i, opts)}</li>); }
    else if (ln.trim() === '') { flush(i); }
    else { flush(i); out.push(<p key={i} style={{ margin: '0 0 10px', color: 'var(--fg-muted)', lineHeight: 1.65 }}>{mdInline(ln, i, opts)}</p>); }
  });
  flush('end');
  return <div>{out}</div>;
}
