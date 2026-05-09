import { useState, useRef, useEffect } from 'react';

const NODE_COLOR = {
  battle: '#5577cc',
  elite:  '#cc6633',
  shop:   '#ccaa22',
  rest:   '#33bb66',
  boss:   '#cc3333',
};

const NODE_ICON = {
  battle: '⚔️',
  elite:  '💀',
  shop:   '🛒',
  rest:   '🔥',
  boss:   '👑',
};

const NODE_LABEL = {
  battle: 'Battle',
  elite:  'Elite',
  shop:   'Shop',
  rest:   'Rest Site',
  boss:   'Boss',
};

const W = 540;          // SVG / container width
const FLOOR_H = 88;     // vertical spacing between floors
const R = 24;           // node circle radius
const COL_X = [96, 270, 444]; // x-centre for positions 0, 1, 2

function nodeX(position) { return COL_X[position]; }
function nodeY(floor, totalFloors) { return (totalFloors - 1 - floor) * FLOOR_H + R + 12; }

export default function SpireMap({ map, currentNodeId, visitedNodes, gold, onSelectNode, allLees }) {
  const [hoveredId, setHoveredId]   = useState(null);
  const scrollRef                   = useRef(null);
  const { floors, nodes, startNodeIds, totalFloors } = map;

  // Which nodes can the player move to next?
  const availableIds = currentNodeId === null
    ? new Set(startNodeIds)
    : new Set((nodes[currentNodeId]?.connections) ?? []);

  const svgHeight = totalFloors * FLOOR_H + R * 2 + 12;

  // Auto-scroll to keep current node visible
  useEffect(() => {
    if (!scrollRef.current) return;
    const targetFloor = currentNodeId ? nodes[currentNodeId]?.floor ?? 0 : 0;
    const y = nodeY(targetFloor, totalFloors);
    const el = scrollRef.current;
    const visibleTop    = el.scrollTop;
    const visibleBottom = el.scrollTop + el.clientHeight;
    if (y < visibleTop + 80 || y > visibleBottom - 80) {
      el.scrollTop = Math.max(0, y - el.clientHeight / 2);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentNodeId]);

  const previewNode = hoveredId ? nodes[hoveredId] : null;

  return (
    <div style={{
      display: 'flex', gap: 20, justifyContent: 'center',
      alignItems: 'flex-start', padding: '24px 16px',
    }}>

      {/* ── Map scroll container ── */}
      <div
        ref={scrollRef}
        style={{
          width: W, maxHeight: '82vh', overflowY: 'auto', overflowX: 'hidden',
          background: '#080814', borderRadius: 12, border: '1px solid #1e1e2e',
          scrollBehavior: 'smooth',
        }}
      >
        <svg width={W} height={svgHeight} style={{ display: 'block' }}>

          {/* Connection lines */}
          {floors.flat().map(node =>
            node.connections.map(tid => {
              const target = nodes[tid];
              if (!target) return null;
              const x1 = nodeX(node.position), y1 = nodeY(node.floor, totalFloors);
              const x2 = nodeX(target.position), y2 = nodeY(target.floor, totalFloors);
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
            const y         = nodeY(node.floor, totalFloors);
            const available = availableIds.has(node.id);
            const visited   = visitedNodes.has(node.id);
            const current   = node.id === currentNodeId;
            const hovered   = node.id === hoveredId;
            const color     = NODE_COLOR[node.type];
            const dimmed    = visited && !current;

            return (
              <g key={node.id}
                onClick={() => available && onSelectNode(node.id)}
                onMouseEnter={() => setHoveredId(node.id)}
                onMouseLeave={() => setHoveredId(null)}
                style={{ cursor: available ? 'pointer' : 'default' }}
              >
                {/* Glow ring for available nodes */}
                {available && !visited && (
                  <circle cx={x} cy={y} r={R + 10} fill={color} opacity={hovered ? 0.22 : 0.10} />
                )}

                {/* Main circle */}
                <circle
                  cx={x} cy={y}
                  r={hovered && available ? R + 3 : R}
                  fill={current ? '#101028' : dimmed ? '#0a0a14' : '#0d0d22'}
                  stroke={current ? '#fff' : available ? color : dimmed ? '#252530' : '#252530'}
                  strokeWidth={current ? 3 : available ? 2.5 : 1.5}
                  opacity={dimmed ? 0.4 : 1}
                />

                {/* Icon */}
                <text x={x} y={y + 7} textAnchor="middle" fontSize={18} opacity={dimmed ? 0.4 : 1}>
                  {NODE_ICON[node.type]}
                </text>

                {/* Player marker */}
                {current && (
                  <text x={x} y={y - R - 8} textAnchor="middle" fontSize={14}>👤</text>
                )}

                {/* Floor label on leftmost column */}
                {node.position === 0 && (
                  <text x={14} y={y + 5} fontSize={9} fill="#2a2a3a" fontFamily="monospace">
                    {node.floor + 1}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* ── Side panel ── */}
      <div style={{ width: 220, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Gold display */}
        <div style={{
          background: '#111', border: '1px solid #2a2620', borderRadius: 8,
          padding: '10px 14px', fontFamily: 'monospace',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 18 }}>🪙</span>
          <span style={{ color: '#ccaa33', fontSize: 15, fontWeight: 'bold' }}>{gold}</span>
          <span style={{ color: '#555', fontSize: 11 }}>gold</span>
        </div>

        {/* Node preview */}
        {previewNode ? (
          <NodePreview node={previewNode} allLees={allLees} available={availableIds.has(previewNode.id)} />
        ) : (
          <div style={{ color: '#333', fontSize: 11, fontFamily: 'monospace', padding: 4 }}>
            Hover a node to preview it.<br />
            {availableIds.size > 0 && <span style={{ color: '#4455aa' }}>
              {availableIds.size} path{availableIds.size > 1 ? 's' : ''} available.
            </span>}
          </div>
        )}
      </div>
    </div>
  );
}

function NodePreview({ node, allLees, available }) {
  const color   = NODE_COLOR[node.type];
  const enemies = node.enemyRosterIds
    ? node.enemyRosterIds.map(id => allLees.find(l => l.id === id)).filter(Boolean)
    : [];

  return (
    <div style={{
      background: '#0e0e1a', border: `1px solid ${color}55`, borderRadius: 10,
      padding: 14, fontFamily: 'monospace',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 22 }}>{NODE_ICON[node.type]}</span>
        <div>
          <div style={{ color, fontSize: 14, fontWeight: 'bold' }}>{NODE_LABEL[node.type]}</div>
          <div style={{ color: '#444', fontSize: 10 }}>Floor {node.floor + 1}</div>
        </div>
        {!available && <div style={{ color: '#333', fontSize: 9, marginLeft: 'auto' }}>not reachable</div>}
      </div>

      {(node.type === 'battle' || node.type === 'elite' || node.type === 'boss') && (
        <>
          <div style={{
            color: node.type === 'elite' ? '#aa5522' : node.type === 'boss' ? '#882222' : '#445588',
            fontSize: 10, marginBottom: 6,
          }}>
            {available ? 'Enemies:' : 'Enemy preview locked'}
          </div>
          {available && enemies.map(lee => (
            <div key={lee.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
              <span style={{ fontSize: 18 }}>{lee.emoji}</span>
              <div>
                <div style={{ color: '#ccc', fontSize: 11 }}>{lee.name}</div>
                <div style={{ color: '#444', fontSize: 9 }}>
                  Tier {lee.tier}{node.type === 'elite' ? ' ★ Enhanced' : node.type === 'boss' ? ' ★★ Boss' : ''}
                </div>
              </div>
            </div>
          ))}
          {!available && (
            <div style={{ color: '#333', fontSize: 10 }}>
              Reach this node to unlock the preview.
            </div>
          )}
          {available && (
            <div style={{
              color: '#333', fontSize: 9, marginTop: 8,
              borderTop: '1px solid #1a1a28', paddingTop: 6,
            }}>
              {node.type === 'elite'
                ? 'Reward: +2 Draft Picks · +30 🪙'
                : node.type === 'boss'
                ? 'Clear this to win the run!'
                : 'Reward: +1 Draft Pick · +15 🪙'}
            </div>
          )}
        </>
      )}

      {node.type === 'shop' && (
        <>
          <div style={{ color: '#888', fontSize: 11, marginBottom: 8, lineHeight: 1.5 }}>
            Spend your gold on upgrades and recruits.
          </div>
          <div style={{ color: '#444', fontSize: 10, lineHeight: 1.8 }}>
            • Heal All Units — 20 🪙<br />
            • Recruit a Lee — 50 🪙<br />
            • Remove a Lee — 35 🪙
          </div>
        </>
      )}

      {node.type === 'rest' && (
        <>
          <div style={{ color: '#888', fontSize: 11, marginBottom: 8, lineHeight: 1.5 }}>
            Recover your team between battles.
          </div>
          <div style={{ color: '#444', fontSize: 10, lineHeight: 1.8 }}>
            • Rest — heal all units 25% HP<br />
            • Train — permanently buff one unit
          </div>
        </>
      )}
    </div>
  );
}
