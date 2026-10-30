// Uses the richer era and people data from history-details.js in the reader.
// Loaded after app.js: it wraps a few of app.js's global functions and falls
// back to the original text when an era or person has no extra details.
// To add details for another era or person, edit history-details.js only.
(function () {
  const D = window.SUVIET_DETAILS;
  if (!D || typeof P === 'undefined') return;

  const eraOf = (p) => D.eras[P.indexOf(p)];

  const timelineMarkup = (rows) => `<ol class="era-timeline">${rows.map(([t, text]) =>
    `<li><strong>${t}</strong><span>${text}</span></li>`).join('')}</ol>`;

  // Era-specific politics, economy, culture and war text instead of the
  // generic sentences shared by every era.
  const baseDetailTexts = window.periodDetailTexts;
  window.periodDetailTexts = function (p) {
    const d = baseDetailTexts(p);
    const e = eraOf(p);
    if (!e) return d;
    if (e.politics) d[0] = e.politics;
    if (e.economy) d[2] = e.economy;
    if (e.culture) d[3] = e.culture;
    if (e.war) d[4] = e.war;
    return d;
  };

  const baseReaderContent = window.readerContent;
  window.readerContent = function (i, tab) {
    const e = D.eras[i];
    if (e && tab === 'events' && e.timeline) {
      const p = P[i];
      const note = e.note ? `<div class="reader-source-note">${e.note}</div>` : '';
      return `<h4>Biên niên ${p[2]}</h4>${note}${timelineMarkup(e.timeline)}<p>Kéo thanh năm trong phạm vi ${fmt(p[0])} – ${fmt(p[1])} để xem bản đồ tại những thời điểm khác nhau của cùng thời kỳ.</p>`;
    }
    return baseReaderContent(i, tab);
  };

  // The story tab ends with a short dated timeline of the era.
  const baseStoryMarkup = window.storyMarkup;
  window.storyMarkup = function (i) {
    const html = baseStoryMarkup(i);
    const e = D.eras[i];
    if (!e || !e.timeline) return html;
    const block = `<div class="story-timeline"><small>Các mốc chính</small>${timelineMarkup(e.timeline)}</div>`;
    const at = html.indexOf('<div class="story-transition">');
    return at < 0 ? html + block : html.slice(0, at) + block + html.slice(at);
  };

  // A person's life tab shows the year of each event when we know it.
  const baseLifeMarkup = window.personLifeMarkup;
  window.personLifeMarkup = function (person) {
    if (!person.datedEvents) return baseLifeMarkup(person);
    const plain = { ...person, events: [] };
    const html = baseLifeMarkup(plain);
    // The original already adds a "Qua đời" row, so skip a bare "Mất" event.
    const events = person.datedEvents.filter(([, text]) => !(person.death != null && /^Mất\b/.test(text)));
    const rows = events.map(([t, text]) =>
      `<div><strong>${t}</strong><span>${text}</span></div>`).join('');
    // Put the dated events after the birth row (or first, if there is none).
    const open = '<div class="person-lifeline">';
    const start = html.indexOf(open);
    if (start < 0) return html;
    const inner = start + open.length;
    const birthEnd = person.birth != null || person.birthLabel !== 'Không rõ'
      ? html.indexOf('</div>', inner) + '</div>'.length : inner;
    let out = html.slice(0, birthEnd) + rows + html.slice(birthEnd);
    // The original adds a placeholder row when it had no rows at all.
    out = out.replace('<div><strong>Niên đại chưa đủ chắc</strong><span>Dùng thời kỳ liên quan và nguồn để đọc thay vì áp một niên biểu giả chính xác.</span></div>', '');
    return out;
  };
})();
