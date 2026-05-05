import { useState } from 'react';

const ABILITY_TYPES  = ['melee', 'missile', 'mortar', 'heal', 'thorns'];
const ENEMY_TARGETS  = ['nearest-enemy', 'lowest-hp-enemy', 'lowest-hp-col', 'random-enemy'];
const ALLY_TARGETS   = ['nearest-ally', 'lowest-hp-ally'];
const MOVE_BEHAVIORS = ['nearest-enemy', 'weakest-enemy', 'weakest-ally'];
const TYPES          = ['none', 'rage', 'chill', 'whimsy', 'cringe', 'smug', 'unknown'];
const EMOJIS         = ['👊','🏹','🛡️','💚','🔥','❄️','✨','😬','😎','💪','🌀','⚡','🌵','🎯','💣','🧙','🧟','🧌'];

function toKebab(str) {
  return str.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function defaultsForType(type, existing = {}) {
  const base = { ...existing, type };
  if (type === 'melee')   return { ...base, cleave: existing.cleave ?? 0, targeting: existing.targeting?.includes('ally') ? 'nearest-enemy' : (existing.targeting || 'nearest-enemy') };
  if (type === 'missile') return { ...base, aoeRadius: existing.aoeRadius ?? 0, targeting: existing.targeting?.includes('ally') ? 'nearest-enemy' : (existing.targeting || 'nearest-enemy') };
  if (type === 'mortar')  return { ...base, aoeRadius: existing.aoeRadius || 1, minRange: existing.minRange || 2, targeting: existing.targeting?.includes('ally') ? 'nearest-enemy' : (existing.targeting || 'nearest-enemy') };
  if (type === 'heal')    return { ...base, targeting: existing.targeting?.includes('ally') ? existing.targeting : 'lowest-hp-ally' };
  if (type === 'thorns')  return { ...base };
  return base;
}

function newAbility(index) {
  return {
    id: `ability-${Date.now()}-${index}`,
    type: 'melee',
    label: '',
    damage: 10,
    range: 1,
    cleave: 0,
    aoeRadius: 0,
    actSpeed: 0.5,
    attackDelay: 0.1,
    targeting: 'nearest-enemy',
  };
}

// ── Slider field ──────────────────────────────────────────────────────────
function Slider({ label, value, min, max, step, onChange, hint }) {
  const isFloat = step < 1;
  const display = isFloat ? Number(value).toFixed(2) : value;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: '#888' }}>{label}</span>
        <span style={{ fontSize: 11, color: '#ccc', fontFamily: 'monospace' }}>
          {display}{hint ? <span style={{ color: '#555', marginLeft: 4 }}>{hint}</span> : null}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step}
        style={{ width: '100%', accentColor: '#4488ff', cursor: 'pointer', height: 20 }}
        value={value}
        onChange={e => onChange(isFloat ? parseFloat(e.target.value) : parseInt(e.target.value, 10))}
      />
    </div>
  );
}

export default function LeeForm({ value: lee, onChange, existingLees = [] }) {
  const [expandedAbility, setExpandedAbility] = useState(0);

  function set(field, val) {
    const updated = { ...lee, [field]: val };
    if (field === 'name' && !lee._idManuallySet) updated.id = toKebab(val);
    onChange(updated);
  }

  function setStats(field, val) {
    onChange({ ...lee, baseStats: { ...lee.baseStats, [field]: val } });
  }

  function setAbility(index, field, val) {
    let updated = { ...lee.abilities[index], [field]: val };
    if (field === 'type') updated = defaultsForType(val, lee.abilities[index]);
    const abilities = lee.abilities.map((a, i) => i === index ? updated : a);
    onChange({ ...lee, abilities });
  }

  function addAbility() {
    if ((lee.abilities || []).length >= 3) return;
    const abilities = [...(lee.abilities || []), newAbility(lee.abilities.length)];
    onChange({ ...lee, abilities });
    setExpandedAbility(abilities.length - 1);
  }

  function removeAbility(index) {
    const abilities = lee.abilities.filter((_, i) => i !== index);
    onChange({ ...lee, abilities });
    setExpandedAbility(Math.min(expandedAbility, abilities.length - 1));
  }

  const inputStyle = { background: '#1a1a1a', color: '#ddd', border: '1px solid #333', borderRadius: 4, padding: '5px 8px', fontFamily: 'monospace', fontSize: 13, width: '100%' };
  const rowStyle   = { display: 'flex', flexDirection: 'column', gap: 3 };
  const labelStyle = { fontSize: 11, color: '#888', marginBottom: 3, display: 'block' };
  const actionMini = { background: '#1a1a1a', border: '1px solid #333', borderRadius: 4, color: '#aaa', padding: '3px 8px', cursor: 'pointer', fontFamily: 'monospace', fontSize: 11 };
  const secHead    = { fontSize: 12, color: '#555', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

      {/* Identity */}
      <section>
        <div style={secHead}>Identity</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div style={rowStyle}>
            <label style={labelStyle}>Name</label>
            <input style={inputStyle} value={lee.name || ''} onChange={e => set('name', e.target.value)} placeholder="Stupid Lee" />
          </div>
          <div style={rowStyle}>
            <label style={labelStyle}>ID (auto)</label>
            <input style={inputStyle} value={lee.id || ''} onChange={e => onChange({ ...lee, id: e.target.value, _idManuallySet: true })} />
          </div>
          <div style={rowStyle}>
            <label style={labelStyle}>Emoji</label>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {EMOJIS.map(em => (
                <button key={em} onClick={() => set('emoji', em)} style={{ background: lee.emoji === em ? '#333' : 'transparent', border: lee.emoji === em ? '1px solid #666' : '1px solid transparent', borderRadius: 4, padding: '2px 4px', cursor: 'pointer', fontSize: 16 }}>
                  {em}
                </button>
              ))}
            </div>
          </div>
          <div style={rowStyle}>
            <label style={labelStyle}>Type</label>
            <select style={inputStyle} value={lee.type || 'none'} onChange={e => set('type', e.target.value)}>
              {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div style={rowStyle}>
            <label style={labelStyle}>Tier</label>
            <select style={inputStyle} value={lee.tier || 1} onChange={e => set('tier', Number(e.target.value))}>
              <option value={1}>1 — Common</option>
              <option value={2}>2 ✦ — Uncommon</option>
              <option value={3}>3 ✦✦ — Legendary</option>
            </select>
          </div>
          <div style={rowStyle}>
            <label style={labelStyle}>Move Behavior</label>
            <select style={inputStyle} value={lee.moveBehavior || 'nearest-enemy'} onChange={e => set('moveBehavior', e.target.value)}>
              {MOVE_BEHAVIORS.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
        </div>
        <div style={{ ...rowStyle, marginTop: 10 }}>
          <label style={labelStyle}>Flavor text</label>
          <textarea style={{ ...inputStyle, height: 56, resize: 'vertical' }} value={lee.flavor || ''} onChange={e => set('flavor', e.target.value)} placeholder='"He stupidly left his keys in the car."' />
        </div>
      </section>

      {/* Base stats */}
      <section>
        <div style={secHead}>Base Stats</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Slider label="HP"         value={lee.baseStats?.hp        ?? 60}  min={1}   max={500} step={1}   onChange={v => setStats('hp', v)} />
          <Slider label="DEF"        value={lee.baseStats?.def       ?? 4}   min={0}   max={30}  step={1}   onChange={v => setStats('def', v)} />
          <Slider label="Armor"      value={lee.baseStats?.armor     ?? 0}   min={0}   max={20}  step={1}   onChange={v => setStats('armor', v)} />
          <Slider label="Move Speed" value={lee.baseStats?.moveSpeed ?? 1.0} min={0.2} max={3.0} step={0.1} onChange={v => setStats('moveSpeed', v)} />
          <div style={{ gridColumn: '1 / -1' }}>
            <Slider label="Move Mult" value={lee.moveMult ?? 1} min={0} max={1} step={0.1} onChange={v => set('moveMult', v)} hint="(0 = must stand still to charge)" />
          </div>
        </div>
      </section>

      {/* Acquisition */}
      <section>
        <div style={secHead}>Acquisition</div>
        <div style={{ display: 'flex', gap: 16 }}>
          {['draft', 'combine', 'both'].map(m => (
            <label key={m} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: '#aaa', fontSize: 13 }}>
              <input type="radio" name="acquisition" value={m} checked={(lee.acquisition?.method || 'draft') === m} onChange={() => onChange({ ...lee, acquisition: { ...lee.acquisition, method: m } })} />
              {m}
            </label>
          ))}
        </div>
        {(lee.acquisition?.method === 'combine' || lee.acquisition?.method === 'both') && (() => {
          const raw   = lee.acquisition?.combineFrom;
          const pairs = !raw?.length ? [['', '']] : Array.isArray(raw[0]) ? raw : [raw];
          function updatePairs(newPairs) { onChange({ ...lee, acquisition: { ...lee.acquisition, combineFrom: newPairs } }); }
          return (
            <div style={{ marginTop: 10 }}>
              {pairs.map((pair, pi) => (
                <div key={pi} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                  {[0, 1].map(si => (
                    <select key={si} style={{ ...inputStyle, flex: 1 }} value={pair[si] || ''}
                      onChange={e => { const next = pairs.map((p, i) => i === pi ? [si === 0 ? e.target.value : p[0], si === 1 ? e.target.value : p[1]] : p); updatePairs(next); }}>
                      <option value="">— source {si + 1} —</option>
                      {existingLees.filter(l => l.id !== lee.id).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  ))}
                  {pairs.length > 1 && <button onClick={() => updatePairs(pairs.filter((_, i) => i !== pi))} style={{ ...actionMini, color: '#ff6666' }}>✕</button>}
                </div>
              ))}
              <button onClick={() => updatePairs([...pairs, ['', '']])} style={actionMini}>+ route</button>
            </div>
          );
        })()}
      </section>

      {/* Abilities */}
      <section>
        <div style={secHead}>Abilities ({(lee.abilities || []).length}/3)</div>
        {(lee.abilities || []).map((ab, i) => (
          <div key={ab.id} style={{ border: '1px solid #222', borderRadius: 6, marginBottom: 8 }}>
            <div onClick={() => setExpandedAbility(expandedAbility === i ? -1 : i)} style={{ padding: '8px 10px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#141414', borderRadius: expandedAbility === i ? '6px 6px 0 0' : 6 }}>
              <span style={{ fontSize: 13, color: '#ccc' }}>{abilityIcon(ab.type)} {ab.label || ab.type || `Ability ${i + 1}`}</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: '#555' }}>{expandedAbility === i ? '▲' : '▼'}</span>
                <button onClick={e => { e.stopPropagation(); removeAbility(i); }} style={{ background: '#2a1010', border: '1px solid #442222', borderRadius: 4, color: '#ff6666', fontSize: 11, padding: '1px 6px', cursor: 'pointer' }}>✕</button>
              </div>
            </div>
            {expandedAbility === i && (
              <div style={{ padding: 12 }}>
                <AbilityFields ab={ab} index={i} setAbility={setAbility} inputStyle={inputStyle} labelStyle={labelStyle} rowStyle={rowStyle}
                  existingLees={existingLees} />
              </div>
            )}
          </div>
        ))}
        {(lee.abilities || []).length < 3 && (
          <button onClick={addAbility} style={{ background: '#1a2a1a', border: '1px dashed #336633', borderRadius: 6, color: '#669966', padding: '8px 16px', cursor: 'pointer', fontFamily: 'monospace', fontSize: 13, width: '100%' }}>
            + Add Ability
          </button>
        )}
      </section>
    </div>
  );
}

function AbilityFields({ ab, index, setAbility, inputStyle, labelStyle, rowStyle }) {
  const s = (field, val) => setAbility(index, field, val);

  const typeRow = (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
      <div style={rowStyle}>
        <label style={labelStyle}>Type</label>
        <select style={inputStyle} value={ab.type} onChange={e => s('type', e.target.value)}>
          {ABILITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div style={rowStyle}>
        <label style={labelStyle}>Label</label>
        <input style={inputStyle} value={ab.label || ''} onChange={e => s('label', e.target.value)} placeholder="Attack" />
      </div>
    </div>
  );

  const targetRow = (opts) => (
    <div style={rowStyle}>
      <label style={labelStyle}>Targeting</label>
      <select style={inputStyle} value={ab.targeting || opts[0]} onChange={e => s('targeting', e.target.value)}>
        {opts.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
    </div>
  );

  if (ab.type === 'thorns') {
    return (
      <>
        {typeRow}
        <Slider label="Damage (per hit)" value={ab.damage ?? 5} min={0} max={100} step={1} onChange={v => s('damage', v)} />
        <div style={{ fontSize: 11, color: '#555', fontStyle: 'italic', marginTop: 8, padding: '6px 8px', background: '#111', borderRadius: 4 }}>
          Passive — triggers when this unit is hit by a melee attack. No cast bar needed.
        </div>
      </>
    );
  }

  if (ab.type === 'melee') {
    return (
      <>
        {typeRow}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Slider label="Damage"            value={ab.damage       ?? 10}  min={0}   max={200} step={1}    onChange={v => s('damage', v)} />
          <Slider label="Range"             value={ab.range        ?? 1}   min={1}   max={10}  step={1}    onChange={v => s('range', v)} />
          <Slider label="Cleave (each side)"value={ab.cleave       ?? 0}   min={0}   max={6}   step={1}    onChange={v => s('cleave', v)} />
          <Slider label="Action Speed"      value={ab.actSpeed     ?? 0.5} min={0.1} max={3.0} step={0.05} onChange={v => s('actSpeed', v)}    hint={`(cd: ${(1/(ab.actSpeed||0.5)).toFixed(1)}s)`} />
          <Slider label="Attack Delay (s)"  value={ab.attackDelay  ?? 0.1} min={0}   max={2.0} step={0.05} onChange={v => s('attackDelay', v)} />
          {targetRow(ENEMY_TARGETS)}
        </div>
      </>
    );
  }

  if (ab.type === 'missile') {
    return (
      <>
        {typeRow}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Slider label="Damage"           value={ab.damage      ?? 10}  min={0}   max={200} step={1}    onChange={v => s('damage', v)} />
          <Slider label="Range"            value={ab.range       ?? 3}   min={1}   max={10}  step={1}    onChange={v => s('range', v)} />
          <Slider label="AOE Radius"       value={ab.aoeRadius   ?? 0}   min={0}   max={5}   step={1}    onChange={v => s('aoeRadius', v)} />
          <Slider label="Action Speed"     value={ab.actSpeed    ?? 0.5} min={0.1} max={3.0} step={0.05} onChange={v => s('actSpeed', v)}    hint={`(cd: ${(1/(ab.actSpeed||0.5)).toFixed(1)}s)`} />
          <Slider label="Attack Delay (s)" value={ab.attackDelay ?? 0.3} min={0}   max={2.0} step={0.05} onChange={v => s('attackDelay', v)} />
          {targetRow(ENEMY_TARGETS)}
        </div>
      </>
    );
  }

  if (ab.type === 'mortar') {
    return (
      <>
        {typeRow}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Slider label="Damage"           value={ab.damage      ?? 20}  min={0}   max={200} step={1}    onChange={v => s('damage', v)} />
          <Slider label="Max Range"        value={ab.range       ?? 5}   min={2}   max={10}  step={1}    onChange={v => s('range', v)} />
          <Slider label="Min Range"        value={ab.minRange    ?? 2}   min={1}   max={8}   step={1}    onChange={v => s('minRange', v)} />
          <Slider label="AOE Radius"       value={ab.aoeRadius   ?? 1}   min={1}   max={5}   step={1}    onChange={v => s('aoeRadius', v)} />
          <Slider label="Action Speed"     value={ab.actSpeed    ?? 0.4} min={0.1} max={3.0} step={0.05} onChange={v => s('actSpeed', v)}    hint={`(cd: ${(1/(ab.actSpeed||0.4)).toFixed(1)}s)`} />
          <Slider label="Attack Delay (s)" value={ab.attackDelay ?? 0.5} min={0}   max={2.0} step={0.05} onChange={v => s('attackDelay', v)} />
          {targetRow(ENEMY_TARGETS)}
        </div>
      </>
    );
  }

  if (ab.type === 'heal') {
    return (
      <>
        {typeRow}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Slider label="Heal Amount"  value={ab.healAmount ?? 20}  min={0}   max={200} step={1}    onChange={v => s('healAmount', v)} />
          <Slider label="Range"        value={ab.range      ?? 2}   min={1}   max={10}  step={1}    onChange={v => s('range', v)} />
          <Slider label="Action Speed" value={ab.actSpeed   ?? 0.4} min={0.1} max={3.0} step={0.05} onChange={v => s('actSpeed', v)} hint={`(cd: ${(1/(ab.actSpeed||0.4)).toFixed(1)}s)`} />
          {targetRow(ALLY_TARGETS)}
        </div>
      </>
    );
  }

  // Fallback
  return (
    <>
      {typeRow}
      <Slider label="Damage" value={ab.damage ?? 10} min={0} max={200} step={1} onChange={v => s('damage', v)} />
      <Slider label="Range"  value={ab.range  ?? 1}  min={1} max={10}  step={1} onChange={v => s('range', v)} />
      {targetRow([...ENEMY_TARGETS, ...ALLY_TARGETS])}
    </>
  );
}

function abilityIcon(type) {
  const map = { melee: '👊', missile: '🎯', mortar: '💣', heal: '💚', thorns: '🌵' };
  return map[type] || '?';
}
