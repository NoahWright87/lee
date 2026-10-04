/**
 * @param {{ round: number, onRestart: () => void }} props
 */
export default function GameOver({ round, onRestart }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      gap: 24,
    }}>
      <div style={{ fontSize: 64 }}>💀</div>
      <h1 style={{ fontSize: 42, color: '#ff4444', letterSpacing: 4 }}>DEFEATED</h1>
      <p style={{ color: '#888', fontSize: 16 }}>You made it to Round {round}.</p>
      <button
        onClick={onRestart}
        style={{
          marginTop: 16,
          padding: '14px 40px',
          background: '#3366ff',
          color: '#fff',
          border: 'none',
          borderRadius: 8,
          fontSize: 16,
          fontFamily: 'monospace',
          cursor: 'pointer',
          letterSpacing: 1,
        }}
      >
        Try Again
      </button>
    </div>
  );
}
