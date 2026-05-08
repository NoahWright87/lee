import { useState } from 'react';

/**
 * Between-round shop. Player spends gold to buy items for any unit in their
 * roster. Each unit can hold one item; buying a second replaces the first.
 *
 * Props:
 *   gold        – current gold balance
 *   goldEarned  – gold earned from the last battle (shown as a banner)
 *   shopItems   – array of items available this visit (from getShopOptions)
 *   allUnits    – all player units (field + bench) to receive items
 *   onBuy       – (unitUid, item) => void  called on each purchase
 *   onContinue  – () => void
 */
export default function ShopScreen({ gold, goldEarned, shopItems, allUnits, onBuy, onContinue }) {
  const [selectedItem, setSelectedItem] = useState(null);
  const [hoveredItem, setHoveredItem]   = useState(null);
  const [hoveredUnit, setHoveredUnit]   = useState(null);
  const [flashUid, setFlashUid]         = useState(null);   // briefly highlight a unit after purchase

  function handleItemClick(item) {
    setSelectedItem(prev => (prev?.id === item.id ? null : item));
  }

  function handleUnitClick(unit) {
    if (!selectedItem) return;
    if (gold < selectedItem.price) return;

    onBuy(unit.uid, selectedItem);
    setFlashUid(unit.uid);
    setTimeout(() => setFlashUid(null), 700);
    setSelectedItem(null);
  }

  const canAfford = item => gold >= item.price;

  return (
    <div style={{
      minHeight: '100vh',
      background: '#080808',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '32px 24px',
      gap: 28,
      fontFamily: 'monospace',
    }}>

      {/* Header */}
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 32, fontWeight: 'bold', letterSpacing: 6, color: '#eee' }}>
          SHOP
        </div>
        {goldEarned > 0 && (
          <div style={{ color: '#c8a000', fontSize: 13, marginTop: 6 }}>
            🪙 +{goldEarned} gold from last battle
          </div>
        )}
        <div style={{
          marginTop: 8,
          fontSize: 18,
          fontWeight: 'bold',
          color: '#ffd700',
          letterSpacing: 1,
        }}>
          🪙 {gold} gold
        </div>
      </div>

      {/* Shop items */}
      <div>
        <div style={{ color: '#555', fontSize: 11, letterSpacing: 2, marginBottom: 12, textAlign: 'center' }}>
          {selectedItem
            ? `"${selectedItem.name}" selected — click a Lee to equip it`
            : 'Click an item to select it'}
        </div>
        <div style={{
          display: 'flex',
          gap: 14,
          flexWrap: 'wrap',
          justifyContent: 'center',
        }}>
          {shopItems.map(item => {
            const isSelected = selectedItem?.id === item.id;
            const isHovered  = hoveredItem === item.id;
            const affordable = canAfford(item);

            return (
              <div
                key={item.id}
                onClick={() => handleItemClick(item)}
                onMouseEnter={() => setHoveredItem(item.id)}
                onMouseLeave={() => setHoveredItem(null)}
                style={{
                  width: 170,
                  background: isSelected ? '#1a1500' : '#111',
                  border: `2px solid ${isSelected ? '#ffd700' : isHovered && affordable ? '#666' : '#2a2a2a'}`,
                  borderRadius: 10,
                  padding: '14px 12px',
                  cursor: affordable ? 'pointer' : 'not-allowed',
                  opacity: affordable ? 1 : 0.45,
                  transition: 'border-color 0.15s, background 0.15s, transform 0.1s',
                  transform: isSelected ? 'translateY(-3px)' : 'none',
                  boxShadow: isSelected ? '0 6px 20px #ffd70033' : 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  userSelect: 'none',
                }}
              >
                <div style={{ fontSize: 32, textAlign: 'center' }}>{item.emoji}</div>
                <div style={{
                  color: isSelected ? '#ffd700' : '#ddd',
                  fontWeight: 'bold',
                  fontSize: 13,
                  textAlign: 'center',
                  transition: 'color 0.15s',
                }}>
                  {item.name}
                </div>
                <div style={{ color: '#44ff88', fontSize: 11, textAlign: 'center' }}>
                  {item.description}
                </div>
                <div style={{ color: '#888', fontSize: 10, fontStyle: 'italic', textAlign: 'center', lineHeight: 1.4 }}>
                  "{item.flavor}"
                </div>
                <div style={{
                  marginTop: 4,
                  color: affordable ? '#ffd700' : '#664400',
                  fontSize: 13,
                  fontWeight: 'bold',
                  textAlign: 'center',
                }}>
                  🪙 {item.price}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Roster */}
      <div style={{ width: '100%', maxWidth: 700 }}>
        <div style={{ color: '#555', fontSize: 11, letterSpacing: 2, marginBottom: 12, textAlign: 'center' }}>
          YOUR LEES
        </div>
        <div style={{
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
          justifyContent: 'center',
        }}>
          {allUnits.map(unit => {
            const isHovered = hoveredUnit === unit.uid;
            const isFlash   = flashUid === unit.uid;
            const canEquip  = !!selectedItem && canAfford(selectedItem) && !unit.injured;
            const hasItem   = !!unit.equippedItem;

            let borderColor = '#2a2a2a';
            if (isFlash)              borderColor = '#44ff88';
            else if (canEquip && isHovered) borderColor = '#ffd700';
            else if (hasItem)         borderColor = '#4466aa';

            return (
              <div
                key={unit.uid}
                onClick={() => handleUnitClick(unit)}
                onMouseEnter={() => setHoveredUnit(unit.uid)}
                onMouseLeave={() => setHoveredUnit(null)}
                style={{
                  width: 160,
                  background: isFlash ? '#0a1a0a' : '#111',
                  border: `2px solid ${borderColor}`,
                  borderRadius: 10,
                  padding: '12px 10px',
                  cursor: canEquip ? 'pointer' : 'default',
                  transition: 'border-color 0.15s, background 0.15s',
                  opacity: unit.injured ? 0.55 : 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 6,
                  userSelect: 'none',
                }}
              >
                <div style={{ fontSize: 28 }}>{unit.emoji}</div>
                <div style={{ color: '#ddd', fontWeight: 'bold', fontSize: 12 }}>{unit.name}</div>
                <div style={{ color: '#666', fontSize: 10 }}>
                  Lv {unit.level}
                  {unit.injured && <span style={{ color: '#ff6644', marginLeft: 6 }}>🩹</span>}
                </div>

                {/* Equipped item slot */}
                {hasItem ? (
                  <div style={{
                    marginTop: 4,
                    background: '#1a1a2a',
                    border: '1px solid #4466aa',
                    borderRadius: 6,
                    padding: '4px 8px',
                    fontSize: 11,
                    color: '#88aadd',
                    textAlign: 'center',
                    width: '100%',
                  }}>
                    {unit.equippedItem.emoji} {unit.equippedItem.name}
                    {canEquip && isHovered && (
                      <div style={{ color: '#ffd700', fontSize: 10, marginTop: 2 }}>
                        Replace?
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{
                    marginTop: 4,
                    border: `1px dashed ${canEquip && isHovered ? '#ffd700' : '#333'}`,
                    borderRadius: 6,
                    padding: '4px 8px',
                    fontSize: 10,
                    color: canEquip && isHovered ? '#ffd700' : '#444',
                    textAlign: 'center',
                    width: '100%',
                    transition: 'color 0.15s, border-color 0.15s',
                  }}>
                    {canEquip && isHovered ? '+ Equip' : 'No item'}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Continue */}
      <button
        onClick={onContinue}
        style={{
          background: '#111',
          border: '2px solid #444',
          borderRadius: 8,
          color: '#aaa',
          fontSize: 15,
          fontFamily: 'monospace',
          fontWeight: 'bold',
          letterSpacing: 2,
          padding: '12px 36px',
          cursor: 'pointer',
          marginTop: 4,
        }}
      >
        CONTINUE →
      </button>
    </div>
  );
}
