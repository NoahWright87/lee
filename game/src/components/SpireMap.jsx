import { useState, useEffect } from 'react';

const NODE_COLOR = {
  battle: '#5577cc',
  elite:  '#cc6633',
  shop:   '#ccaa22',
  rest:   '#33bb66',
  boss:   '#cc3333',
};
const NODE_ICON  = { battle: '⚔️', elite: '💀', shop: '🛒', rest: '🔥', boss: '👑' };
const NODE_LABEL = { battle: 'Battle', elite: 'Elite', shop: 'Shop', rest: 'Rest Site', boss: 'Boss' };

function useWindowSize() {
  const [size, setSize] = useState([window.innerWidth, window.innerHeight]);
  useEffect(() => {
    const h = () => setSize([window.innerWidth, window.innerHeight]);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  return size;
}

export default function SpireMap({ map, currentNodeId, visitedNodes, gold, onSelectNode, allLees }) {
  const [hoveredId, setHoveredId] = useState(null);
  const [vw, vh] = useWindowSize();
  const { floors, nodes, startNodeIds, totalFloors } = map;

  // Portrait = taller than wide (phone portrait, tablet portrait)
  const isPortrait = vw <= vh;

  // ── Geometry ──────────────────────────────────────────────────────
  // Approximate vertical space consumed by elements outside the SVG.
  // App.jsx contributes a ~48px compact header.
  const GOLD_ROW_H  = 40;
  const PREVIEW_H   = isPortrait ? 176 : 0;
  const SIDEBAR_W   = isPortrait ? 0 : 240;
  const H_PAD       = 16;
  const V_OVERHEAD  = 48 + GOLD_ROW_H + PREVIEW_H + 24; // header + gold + preview + padding

  const mapW   = Math.min(vw - SIDEBAR_W - H_PAD * 2, 560);
  const mapH   = Math.max(200, vh - V_OVERHEAD);

  const MAX_R  = isPortrait ? 20 : 24;
  const MIN_R  = 10;
  const idealFloorH = mapH / totalFloors;
  const R      = Math.max(MIN_R, Math.min(MAX_R, Math.floor(idealFloorH * 0.30)));
  const FLOOR_H = Math.max(R * 2 + 6, Math.floor(idealFloorH));

  const COL_X  = [mapW * 0.18, mapW * 0.50, mapW * 0.82];
  const svgH   = totalFloors * FLOOR_H + R * 2 + 8;

  function nodeX(pos)   { return COL_X[pos]; }
  function nodeY(floor) { return (totalFloors - 1 - floor) * FLOOR_H + R + 8; }

  const availableIds = currentNodeId === null
    ? new Set(startNodeIds)
    : new Set(nodes[currentNodeId]?.connections ?? []);

  const previewNode = hoveredId ? nodes[hoveredId] : null;

  // ── Shared SVG content ─────────────────────────────────────────────
  const svgContent = (
    <svg
      width={mapW}
      height={svgH}
      style={{ display: 'block', margin: '0 auto' }}
    >
      {/* Connection lines */}
      {floors.flat().map(node =>
        node.connections.map(tid => {
          const target = nodes[tid];
          if (!target) return null;
          const x1 = nodeX(node.position), y1 = nodeY(node.floor);
          const x2 = nodeX(target.position), y2 = nodeY(target.floor);
          const travelled = visitedNodes.has(node.id) && visitedNodes.has(tid);
          const live = availableIds.has(tid) &&
            (currentNodeId === node.id || (!currentNodeId && startNodeIds.includes(node.id)));
          return (
            <line key={`${node.id}→${tid}`}
              x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={travelled ? '#3355aa' : live ? '#445588' : '#161622'}
              strokeWidth={travelled ? 2.5 : 1.5}
            />
          );
        })
      )}

      {/* Nodes */}
      {floors.flat().map(node => {
        const x         = nodeX(node.position);
        const y         = nodeY(node.floor);
        const available = availableIds.has(node.id);
        const visited   = visitedNodes.has(node.id);
        const current   = node.id === currentNodeId;
        const hovered   = node.id === hoveredId;
        const color     = NODE_COLOR[node.type];
        const dimmed    = visited && !current;
        const r         = hovered && available ? R + 3 : R;

        return (
          <g key={node.id}
            onClick={() => available && onSelectNode(node.id)}
            onMouseEnter={() => setHoveredId(node.id)}
            onMouseLeave={() => setHoveredId(null)}
            style={{ cursor: available ? 'pointer' : 'default' }}
          >
            {available && !visited && (
              <circle cx={x} cy={y} r={R + 10} fill={color} opacity={hovered ? 0.22 : 0.10} />
            )}
            <circle
              cx={x} cy={y} r={r}
              fill={current ? '#101028' : dimmed ? '#0a0a14' : '#0d0d22'}
              stroke={current ? '#fff' : available ? color : '#252530'}
              strokeWidth={current ? 3 : available ? 2.5 : 1.5}
              opacity={dimmed ? 0.4 : 1}
            />
            <text x={x} y={y + Math.floor(R * 0.45)} textAnchor="middle"
              fontSize={Math.max(10, Math.floor(R * 0.85))} opacity={dimmed ? 0.4 : 1}>
              {NODE_ICON[node.type]}
            </text>
            {current && (
              <text x={x} y={y - R - 7} textAnchor="middle" fontSize={Math.max(10, R - 2)}>👤</text>
            )}
            {/* Floor number on leftmost column */}
            {node.position === 0 && (
              <text x={10} y={y + 4} fontSize={8} fill="#252535" fontFamily="monospace">
                {node.floor + 1}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );

  // ── Gold badge ─────────────────────────────────────────────────────
  const goldBadge = (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '6px 14px', height: GOLD_ROW_H,
      fontFamily: 'monospace',
      justifyContent: isPortrait ? 'flex-start' : 'flex-start',
    }}>
      <span style={{ fontSize: 16 }}>🪙</span>
      <span style={{ color: '#ccaa33', fontSize: 15, fontWeight: 'bold' }}>{gold}</span>
      <span style={{ color: '#2a2a3a', fontSize: 10 }}>gold</span>
      {isPortrait && availableIds.size > 0 && (
        <span style={{ color: '#4455aa', fontSize: 10, marginLeft: 8 }}>
          {availableIds.size} path{availableIds.size > 1 ? 's' : ''} available
        </span>
      )}
    </div>
  );

  // ── Preview panel content ──────────────────────────────────────────
  const previewContent = previewNode
    ? <NodePreview node={previewNode} allLees={allLees} available={availableIds.has(previewNode.id)} compact={isPortrait} />
    : (
      <div style={{ color: '#2a2a3a', fontSize: 10, fontFamily: 'monospace', padding: isPortrait ? '8px 16px' : '4px' }}>
        {!isPortrait && <><span style={{ color: '#4455aa' }}>{availableIds.size} path{availableIds.size > 1 ? 's' : ''} available</span><br /></>}
        Hover a node to preview it.
      </div>
    );

  // ── Portrait layout ────────────────────────────────────────────────
  if (isPortrait) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {goldBadge}
        <div style={{
          background: '#080814', borderRadius: 10, margin: '0 8px',
          border: '1px solid #1e1e2e', overflow: 'hidden',
          height: mapH,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {svgContent}
        </div>
        <div style={{
          height: PREVIEW_H, margin: '8px 8px 0',
          background: '#0e0e1a', borderRadius: 10, border: '1px solid #1e1e2e',
          overflow: 'hidden',
        }}>
          {previewContent}
        </div>
      </div>
    );
  }

  // ── Landscape / wide layout ────────────────────────────────────────
  return (
    <div style={{
      display: 'flex', gap: 16, justifyContent: 'center',
      alignItems: 'flex-start', padding: `0 ${H_PAD}px`,
    }}>
      <div style={{
        background: '#080814', borderRadius: 12, border: '1px solid #1e1e2e',
        overflow: 'hidden', flexShrink: 0,
      }}>
        {svgContent}
      </div>

      <div style={{ width: SIDEBAR_W - 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{
          background: '#111', border: '1px solid #2a2620', borderRadius: 8,
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 14px', fontFamily: 'monospace',
        }}>
          <span style={{ fontSize: 18 }}>🪙</span>
          <span style={{ color: '#ccaa33', fontSize: 15, fontWeight: 'bold' }}>{gold}</span>
          <span style={{ color: '#555', fontSize: 11 }}>gold</span>
        </div>
        <div style={{
          background: '#0e0e1a', border: '1px solid #1e1e28',
          borderRadius: 10, minHeight: 80, overflow: 'hidden',
        }}>
          {previewContent}
        </div>
      </div>
    </div>
  );
}

// ── Node Preview ───────────────────────────────────────────────────────────────
function NodePreview({ node, allLees, available, compact }) {
  const color   = NODE_COLOR[node.type];
  const enemies = node.enemyRosterIds
    ? node.enemyRosterIds.map(id => allLees.find(l => l.id === id)).filter(Boolean)
    : [];

  const isCombat = node.type === 'battle' || node.type === 'elite' || node.type === 'boss';

  return (
    <div style={{
      padding: compact ? '10px 14px' : 14,
      fontFamily: 'monospace',
      height: '100%', overflowY: 'auto',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: compact ? 18 : 22 }}>{NODE_ICON[node.type]}</span>
        <div>
          <div style={{ color, fontSize: compact ? 13 : 14, fontWeight: 'bold' }}>{NODE_LABEL[node.type]}</div>
          <div style={{ color: '#444', fontSize: 9 }}>Floor {node.floor + 1}</div>
        </div>
        {!available && <div style={{ color: '#2a2a2a', fontSize: 9, marginLeft: 'auto' }}>not reachable</div>}
      </div>

      {isCombat && (
        <>
          <div style={{ color: node.type === 'elite' ? '#aa5522' : node.type === 'boss' ? '#882222' : '#445588', fontSize: 9, marginBottom: 5 }}>
            {available ? 'Enemies:' : 'Reach this node to unlock preview'}
          </div>
          {available && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {enemies.map(lee => (
                <div key={lee.id} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ fontSize: 16 }}>{lee.emoji}</span>
                  {!compact && <div style={{ fontSize: 10, color: '#bbb' }}>{lee.name}</div>}
                </div>
              ))}
            </div>
          )}
          {available && (
            <div style={{ color: '#333', fontSize: 9, marginTop: 8, borderTop: '1px solid #1a1a28', paddingTop: 6 }}>
              {node.type === 'elite' ? 'Reward: +2 Draft · +30 🪙' : node.type === 'boss' ? 'Clear this to win!' : 'Reward: +1 Draft · +15 🪙'}
            </div>
          )}
        </>
      )}
      {node.type === 'shop' && (
        <div style={{ color: '#888', fontSize: 10, lineHeight: 1.6 }}>
          Spend gold on items for your Lees.
        </div>
      )}
      {node.type === 'rest' && (
        <div style={{ color: '#888', fontSize: 10, lineHeight: 1.6 }}>
          Rest (heal 25%) or Train (+10% max HP to one Lee).
        </div>
      )}
    </div>
  );
}
