import { useState } from 'react';
import { cleanNickname, saveNickname } from '../lib/storage';

interface NicknameFieldProps {
  value: string;
  onSaved: (name: string) => void;
  compact?: boolean;
}

/** Player name for the global leaderboard and online duels (typed once, stored locally). */
export function NicknameField({ value, onSaved, compact = false }: NicknameFieldProps) {
  const [draft, setDraft] = useState(value);
  const clean = cleanNickname(draft);
  const valid = clean.length >= 2;
  const dirty = clean !== value;

  return (
    <form
      className={`nick ${compact ? 'nick--compact' : ''}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onSaved(saveNickname(clean).nickname);
      }}
    >
      <label className="t-label" htmlFor="nickname">
        Твой ник
      </label>
      <div className="nick__row">
        <input
          id="nickname"
          className="nick__input"
          value={draft}
          maxLength={20}
          placeholder="например, Motion Hero"
          autoComplete="nickname"
          onChange={(e) => setDraft(e.target.value)}
        />
        {dirty && (
          <button type="submit" className="btn btn--primary btn--small" disabled={!valid}>
            Сохранить
          </button>
        )}
      </div>
    </form>
  );
}
