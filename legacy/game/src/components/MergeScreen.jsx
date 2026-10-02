import LeeCard from './LeeCard.jsx';

/**
 * @param {{
 *   merge: { a: object, b: object, resultId: string },
 *   allLeeDefs: object[],
 *   onMerge: () => void,
 *   onSkip: () => void,
 *   remaining: number,
 * }} props
 */
export default function MergeScreen({ merge, allLeeDefs, onMerge, onSkip, remaining }) {
  const { a, b, resultId } = merge;
  const resultDef = allLeeDefs.find(l => l.id === resultId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, padding: '28px 16px' }}>
      <div style={{ textAlign: 'center' }}>
        <h2 style={{ fontSize: 24, color: '#eee' }}>Merge Available!</h2>
        <p style={{ color: '#888', fontSize: 13, marginTop: 6 }}>
          {remaining > 1 ? `${remaining} merges available` : '1 merge available'}
        </p>
      </div>

      {/* Cards row — wraps to column on narrow screens */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        flexWrap: 'wrap', justifyContent: 'center', maxWidth: '100%',
      }}>
        <LeeCard lee={a} />

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', color: '#888' }}>
          <span style={{ fontSize: 24 }}>+</span>
          <span style={{ fontSize: 10 }}>combine</span>
        </div>

        <LeeCard lee={b} />

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', color: '#888' }}>
          <span style={{ fontSize: 24 }}>→</span>
        </div>

        {resultDef ? (
          <LeeCard lee={resultDef} />
        ) : (
          <div style={{ width: 160, height: 180, background: '#1a1a1a', border: '2px dashed #444', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666', fontSize: 12 }}>
            Unknown: {resultId}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 16 }}>
        <button
          onClick={onMerge}
          style={{
            padding: '12px 32px',
            background: '#22aa55',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: 15,
            fontFamily: 'monospace',
            cursor: 'pointer',
          }}
        >
          ✦ Merge
        </button>
        <button
          onClick={onSkip}
          style={{
            padding: '12px 32px',
            background: '#333',
            color: '#aaa',
            border: '1px solid #444',
            borderRadius: 8,
            fontSize: 15,
            fontFamily: 'monospace',
            cursor: 'pointer',
          }}
        >
          Skip
        </button>
      </div>
    </div>
  );
}
