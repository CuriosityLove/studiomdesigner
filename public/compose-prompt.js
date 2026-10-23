/* Builds the composition prompt from a brief and a shortlist of catalog ids.
   Shared by the page (inside Claude) and server.js (on Render), so the server
   never forwards a prompt written by the browser. */
(function (root) {
  const clip = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);

  function cleanInput(input, byId) {
    input = input || {};
    return {
      brief: clip(input.brief, 2000),
      chips: (Array.isArray(input.chips) ? input.chips : []).slice(0, 8).map(c => ({
        label: clip(c && c.label, 30),
        values: (Array.isArray(c && c.values) ? c.values : []).slice(0, 12).map(v => clip(v, 40)),
      })),
      rooms: (Array.isArray(input.rooms) ? input.rooms : []).slice(0, 14).map(r => clip(r, 40)).filter(Boolean),
      ids: [...new Set((Array.isArray(input.ids) ? input.ids : []).map(String))].filter(id => byId[id]).slice(0, 240),
      moodCount: Math.max(0, Math.min(4, parseInt(input.moodCount) || 0)),
      hasPlan: !!input.hasPlan,
    };
  }

  function buildPrompt(raw, byId) {
    const input = cleanInput(raw, byId);
    const lines = input.ids.map(id => {
      const p = byId[id];
      return [p.id, p.type, p.name, p.coll, p.designer, p.finish, p.material, p.dims, p.rating, p.lumens && p.lumens + 'lm', (p.desc || '').slice(0, 260)].join(' | ');
    }).join('\n');
    const rooms = input.rooms.length ? input.rooms.join(', ')
      : (input.hasPlan ? 'read the rooms from the floor plan image' : 'Entry, Living, Dining, Kitchen, Primary Bedroom, Bath');
    const chips = input.chips.map(c => `${c.label}: ${c.values.join(', ') || '—'}`).join('\n');
    const imgNote = (input.moodCount || input.hasPlan)
      ? `\nAttached images: ${input.moodCount} mood image(s)${input.hasPlan ? ' followed by 1 floor plan (the last image)' : ''}. Read the mood images for material, color and atmosphere. ${input.hasPlan ? 'Read the floor plan for the rooms and their rough sizes.' : ''}`
      : '';
    return `You are the lead lighting designer at Studio M, a design-led lighting house. Compose a cohesive lighting package for this project using ONLY products from the catalog below (refer to them by exact id).

PROJECT BRIEF
${input.brief || '(no text brief)'}
${chips}
Rooms: ${rooms}${imgNote}

HOW TO COMPOSE
- Choose one finish story (one dominant metal, at most one supporting tone) and repeat it across rooms.
- Layer every room: ambient, task, accent. Use realistic quantities (sconces in pairs, island pendants in 2–3s unless linear).
- Bath pieces must be Damp or Wet. Exterior pieces must be Wet.
- Prefer repeating a collection between adjacent rooms where it helps cohesion. Do not use the same product id twice.
- Write like an editor at a design magazine: concrete, plain, no hype, no em-dashes. Mention real materials, sizes and how pieces relate.
- No prices.

CATALOG (id | type | name | collection | designer | finish | glass/shade | dimensions | rating | lumens | description)
${lines}

Reply with only JSON in this shape:
{"title":"short editorial title for the house (max 7 words)","thesis":"2-3 sentences on the lighting idea","principles":[{"h":"3-5 words","t":"one sentence"}, x3],"palette":{"finishes":["..."],"materials":["..."],"cct":"e.g. 2700K"},"hero":"id of the signature piece","rooms":[{"name":"Room","note":"1-2 sentences on the room's lighting","items":[{"id":"...","qty":2,"role":"e.g. Over the table","layer":"Ambient|Task|Accent","why":"1-2 sentences on why this piece, here"}]}]}`;
  }

  const api = { buildPrompt, cleanInput };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SMPrompt = api;
})(typeof window !== 'undefined' ? window : globalThis);
