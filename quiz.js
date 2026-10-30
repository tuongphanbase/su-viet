// Trắc nghiệm lịch sử: questions are generated from the same period (P) and
// people (PEOPLE) data that drive the timeline, so the quiz always agrees with
// what the site shows.
// P rows: [start, end, dynasty, leader, state, capital, confidence, summary, event1, event2]
(function (root) {
  'use strict';

  var QUIZ_LENGTH = 10;
  var BEST_KEY = 'suviet_quiz_best';

  function yearLabel(y) { return y < 0 ? Math.abs(y) + ' TCN' : String(y); }
  function rangeLabel(p) { return yearLabel(p[0]) + '–' + yearLabel(p[1]); }
  // "thời Nhà Lý", but not "thời Thời Pháp thuộc".
  function era(name, capital) {
    var phrase = /^thời\s/i.test(name) ? name.replace(/^Thời/, 'thời') : 'thời ' + name;
    return capital ? phrase.charAt(0).toUpperCase() + phrase.slice(1) : phrase;
  }

  // Small seeded RNG so tests are repeatable; the page uses Math.random.
  function rng(seed) {
    if (seed == null) return Math.random;
    var s = seed >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  function shuffle(arr, rand) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rand() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function norm(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim();
  }

  // Three wrong answers whose text differs from the right one (and each other).
  function distractors(values, correct, rand) {
    var seen = {}; seen[norm(correct)] = true;
    var out = [];
    shuffle(values, rand).forEach(function (v) {
      var k = norm(v);
      if (v && !seen[k] && out.length < 3) { seen[k] = true; out.push(v); }
    });
    return out.length === 3 ? out : null;
  }

  function periodQuestion(kind, i, P, prompt, correct, pool, rand) {
    var options = distractors(pool, correct, rand);
    if (!options || !correct) return null;
    return {
      kind: kind, period: i, prompt: prompt,
      options: shuffle(options.concat(correct), rand), answer: correct,
      explain: P[i][2] + ' (' + rangeLabel(P[i]) + '): ' + P[i][7]
    };
  }
  function pick(list, rand) { return list[Math.floor(rand() * list.length)]; }
  function col(P, k) { return P.map(function (q) { return q[k]; }); }

  // People who belong to Vietnamese history and to exactly one period, so
  // "which period?" has a single right answer.
  function vnPeople(people) {
    return (people || []).filter(function (x) {
      return x && x.relevance === 'direct' && x.region === 'Việt Nam' && x.name;
    });
  }

  // ---- Question kinds -------------------------------------------------------
  // To add a new kind of question, add an entry here (or call
  // SuVietQuiz.addQuestionKind from another script). make(data, rand) returns
  // {kind, period, prompt, options, answer, explain} or null to skip.
  var KINDS = [
    { kind: 'capital', make: function (d, rand) {
      var i = Math.floor(rand() * d.P.length), p = d.P[i];
      return periodQuestion('capital', i, d.P, 'Kinh đô / trung tâm chính trị ' + era(p[2]) + ' (' + rangeLabel(p) + ') ở đâu?', p[5], col(d.P, 5), rand);
    } },
    { kind: 'leader', make: function (d, rand) {
      var i = Math.floor(rand() * d.P.length), p = d.P[i];
      return periodQuestion('leader', i, d.P, 'Ai là người cầm quyền tiêu biểu của ' + era(p[2]) + ' (' + rangeLabel(p) + ')?', p[3], col(d.P, 3), rand);
    } },
    { kind: 'start', make: function (d, rand) {
      var i = Math.floor(rand() * d.P.length), p = d.P[i];
      return periodQuestion('start', i, d.P, era(p[2], true) + ' bắt đầu vào năm nào?', yearLabel(p[0]), d.P.map(function (q) { return yearLabel(q[0]); }), rand);
    } },
    { kind: 'event', make: function (d, rand) {
      var i = Math.floor(rand() * d.P.length), p = d.P[i], event = p[8];
      // Only ask "which period" for events that appear in exactly one period.
      var owners = d.P.filter(function (q) { return norm(q[8]) === norm(event) || norm(q[9]) === norm(event); });
      if (!event || owners.length !== 1) return null;
      return periodQuestion('event', i, d.P, 'Sự kiện “' + event + '” thuộc thời kỳ nào?', p[2], col(d.P, 2), rand);
    } },
    { kind: 'order', make: function (d, rand) {
      var i = Math.floor(rand() * d.P.length), j = Math.floor(rand() * d.P.length), p = d.P[i], q = d.P[j];
      if (j === i || q[0] === p[0] || norm(q[2]) === norm(p[2])) return null;
      var earlier = p[0] < q[0] ? p : q;
      return {
        kind: 'order', period: d.P.indexOf(earlier),
        prompt: 'Thời kỳ nào diễn ra SỚM HƠN?',
        options: shuffle([p[2], q[2]], rand), answer: earlier[2],
        explain: p[2] + ': ' + rangeLabel(p) + ' · ' + q[2] + ': ' + rangeLabel(q) + '.'
      };
    } },
    { kind: 'state', make: function (d, rand) {
      var i = Math.floor(rand() * d.P.length), p = d.P[i];
      return periodQuestion('state', i, d.P, 'Quốc hiệu / chính thể ' + era(p[2]) + ' là gì?', p[4], col(d.P, 4), rand);
    } },
    { kind: 'person-era', make: function (d, rand) {
      var person = pick(vnPeople(d.people).filter(function (x) { return x.eraHints && x.eraHints.length === 1; }), rand);
      if (!person) return null;
      var i = person.eraHints[0], p = d.P[i];
      if (!p) return null;
      // Wrong answers: periods this person has nothing to do with.
      var pool = d.P.filter(function (q, k) { return k !== i; }).map(function (q) { return q[2]; });
      var options = distractors(pool, p[2], rand);
      if (!options) return null;
      return {
        kind: 'person-era', period: i,
        prompt: person.name + ' gắn với thời kỳ nào?',
        options: shuffle(options.concat(p[2]), rand), answer: p[2],
        explain: person.name + ': ' + person.summary + ' (' + p[2] + ', ' + rangeLabel(p) + ')'
      };
    } },
    { kind: 'era-person', make: function (d, rand) {
      var people = vnPeople(d.people).filter(function (x) { return x.eraHints && x.eraHints.length; });
      var person = pick(people, rand);
      if (!person) return null;
      var i = pick(person.eraHints, rand), p = d.P[i];
      if (!p) return null;
      // Wrong answers: Vietnamese figures with no link to this period.
      var others = people.filter(function (x) { return x.eraHints.indexOf(i) < 0; }).map(function (x) { return x.name; });
      var options = distractors(others, person.name, rand);
      if (!options) return null;
      return {
        kind: 'era-person', period: i,
        prompt: 'Nhân vật nào gắn với ' + era(p[2]) + ' (' + rangeLabel(p) + ')?',
        options: shuffle(options.concat(person.name), rand), answer: person.name,
        explain: person.name + ': ' + person.summary
      };
    } }
  ];

  function addQuestionKind(kind, make) { KINDS.push({ kind: kind, make: make }); }

  // Builds `count` distinct questions, cycling through the question kinds.
  function buildQuiz(P, opts) {
    opts = opts || {};
    var rand = rng(opts.seed);
    var count = opts.count || QUIZ_LENGTH;
    var data = { P: P, people: opts.people || [] };
    var kinds = KINDS.filter(function (k) { return data.people.length || k.kind.indexOf('person') < 0; });
    var out = [], used = {}, tries = 0;
    while (out.length < count && tries < 800) {
      tries++;
      var q = kinds[(out.length + tries) % kinds.length].make(data, rand);
      if (!q || used[q.prompt]) continue;
      used[q.prompt] = true;
      out.push(q);
    }
    return shuffle(out, rand);
  }

  /* ---------- UI (browser only) ---------- */

  function mount() {
    var doc = root.document;
    var section = doc.getElementById('quiz');
    if (!section || typeof P === 'undefined') return;
    var els = {
      body: doc.getElementById('quizBody'), progress: doc.getElementById('quizProgress'),
      score: doc.getElementById('quizScore'), best: doc.getElementById('quizBest')
    };
    var state = { questions: [], i: 0, score: 0, answered: false, wrong: [] };

    function getBest() { try { return Number(root.localStorage.getItem(BEST_KEY)) || 0; } catch (e) { return 0; } }
    function setBest(v) { try { root.localStorage.setItem(BEST_KEY, String(v)); } catch (e) { /* blocked */ } }
    function el(tag, cls, text) { var n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

    function showOnTimeline(periodIndex) {
      var y = P[periodIndex][0];
      var slider = doc.getElementById('slider');
      if (slider) slider.value = String(y);
      if (typeof render === 'function') render(y);
      var target = doc.getElementById('explore');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function updateHeader() {
      els.progress.textContent = state.i < state.questions.length ? 'Câu ' + (state.i + 1) + ' / ' + state.questions.length : 'Hoàn thành';
      els.score.textContent = 'Đúng ' + state.score;
      var best = getBest();
      els.best.textContent = best ? 'Kỷ lục ' + best + '/' + QUIZ_LENGTH : '';
    }

    function renderQuestion() {
      state.answered = false;
      updateHeader();
      var q = state.questions[state.i];
      var wrap = el('div', 'quiz-card');
      wrap.appendChild(el('p', 'quiz-q', q.prompt));
      var list = el('div', 'quiz-options');
      list.setAttribute('role', 'group');
      list.setAttribute('aria-label', 'Các lựa chọn');
      q.options.forEach(function (opt, k) {
        var b = el('button', 'quiz-opt');
        b.type = 'button';
        b.appendChild(el('span', 'quiz-key', String(k + 1)));
        b.appendChild(el('span', 'quiz-text', opt));
        b.addEventListener('click', function () { answer(opt, b, list); });
        list.appendChild(b);
      });
      wrap.appendChild(list);
      wrap.appendChild(el('div', 'quiz-feedback'));
      els.body.replaceChildren(wrap);
      list.firstChild.focus({ preventScroll: true });
    }

    function answer(choice, button, list) {
      if (state.answered) return;
      state.answered = true;
      var q = state.questions[state.i];
      var right = choice === q.answer;
      if (right) state.score++; else state.wrong.push({ q: q, choice: choice });
      Array.prototype.forEach.call(list.children, function (b) {
        var text = b.querySelector('.quiz-text').textContent;
        b.disabled = true;
        if (text === q.answer) { b.classList.add('correct'); b.querySelector('.quiz-key').textContent = '✓'; }
        else if (b === button) { b.classList.add('wrong'); b.querySelector('.quiz-key').textContent = '✗'; }
      });
      var fb = els.body.querySelector('.quiz-feedback');
      fb.appendChild(el('p', 'quiz-verdict ' + (right ? 'ok' : 'no'), right ? '✓ Chính xác!' : '✗ Chưa đúng. Đáp án: ' + q.answer));
      fb.appendChild(el('p', 'quiz-explain', q.explain));
      var actions = el('div', 'quiz-actions');
      var look = el('button', 'quiz-link', 'Xem thời kỳ này trên dòng thời gian');
      look.type = 'button';
      look.addEventListener('click', function () { showOnTimeline(q.period); });
      var next = el('button', 'quiz-next', state.i + 1 < state.questions.length ? 'Câu tiếp' : 'Xem kết quả');
      next.type = 'button';
      next.addEventListener('click', function () { state.i++; state.i < state.questions.length ? renderQuestion() : renderResult(); });
      actions.appendChild(look); actions.appendChild(next);
      fb.appendChild(actions);
      updateHeader();
      next.focus({ preventScroll: true });
    }

    function renderResult() {
      var total = state.questions.length;
      var best = getBest();
      var isRecord = state.score > best;
      if (isRecord) setBest(state.score);
      updateHeader();
      var wrap = el('div', 'quiz-card quiz-result');
      wrap.appendChild(el('p', 'quiz-big', state.score + ' / ' + total));
      var msg = state.score === total ? 'Xuất sắc! Bạn nắm rất chắc các thời kỳ.'
        : state.score >= total * 0.7 ? 'Rất tốt! Chỉ còn vài chỗ cần ôn lại.'
        : state.score >= total * 0.4 ? 'Khá! Xem lại các câu sai bên dưới nhé.'
        : 'Hãy khám phá dòng thời gian rồi thử lại nhé.';
      wrap.appendChild(el('p', 'quiz-msg', msg + (isRecord && best ? ' Kỷ lục mới!' : '')));
      if (state.wrong.length) {
        wrap.appendChild(el('p', 'quiz-review-title', 'Cần ôn lại'));
        var ul = el('ul', 'quiz-review');
        state.wrong.forEach(function (w) {
          var li = el('li');
          li.appendChild(el('strong', null, w.q.prompt));
          li.appendChild(el('span', null, 'Bạn chọn: ' + w.choice + ' · Đáp án: ' + w.q.answer));
          var look = el('button', 'quiz-link', 'Xem trên dòng thời gian');
          look.type = 'button';
          look.addEventListener('click', function () { showOnTimeline(w.q.period); });
          li.appendChild(look);
          ul.appendChild(li);
        });
        wrap.appendChild(ul);
      }
      var again = el('button', 'quiz-next', 'Làm bộ câu hỏi mới ↻');
      again.type = 'button';
      again.addEventListener('click', start);
      wrap.appendChild(again);
      els.body.replaceChildren(wrap);
    }

    function start() {
      state = { questions: buildQuiz(P, { people: typeof PEOPLE !== 'undefined' ? PEOPLE : [] }), i: 0, score: 0, answered: false, wrong: [] };
      renderQuestion();
    }

    section.addEventListener('keydown', function (e) {
      if (state.answered || !/^[1-4]$/.test(e.key)) return;
      var b = els.body.querySelectorAll('.quiz-opt')[Number(e.key) - 1];
      if (b) b.click();
    });
    start();
  }

  var api = { buildQuiz: buildQuiz, addQuestionKind: addQuestionKind, yearLabel: yearLabel, QUIZ_LENGTH: QUIZ_LENGTH };
  root.SuVietQuiz = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', mount);
    else mount();
  }
})(typeof window !== 'undefined' ? window : globalThis);
