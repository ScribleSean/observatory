import { useState, type RefObject } from 'react';

/** The Ask field. A question never opens a new page: a local rules matcher picks the blocks that answer it. */
export function AskField({ inputRef, onAsk }: { inputRef: RefObject<HTMLInputElement | null>; onAsk: (question: string) => void }) {
  const [text, setText] = useState('');
  return (
    <label className="askbox">
      <span className="fa">Ask</span>
      <input ref={inputRef} value={text} placeholder="where did today's spend go" autoComplete="off" spellCheck={false} aria-label="Ask a question about your usage"
        onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && text.trim()) onAsk(text.trim()); }} />
      <kbd>/</kbd>
    </label>
  );
}
