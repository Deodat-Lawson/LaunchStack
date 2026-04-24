// Scripted demo sequencer. Ported from the Claude Design bundle
// (launstack/project/hero-demo.js). Types a question into the composer,
// checks source nodes, streams a cited answer into the thread, loops.

import type { HeroGraphApi } from './heroGraph';

type Beat = {
  q: string;
  checked: string[];
  cited: Array<{ id: string; label: string }>;
  stream: Array<{ text?: string; strong?: boolean; cite?: number }>;
};

const SCRIPT: Beat[] = [
  {
    q: 'What did our interviewees actually say about privacy?',
    checked: ['maya', 'jordan', 'priya', 'ravi', 'synth'],
    cited: [
      { id: 'maya',   label: 'Maya K. · 12:04' },
      { id: 'jordan', label: 'Jordan R. · 08:31' },
      { id: 'priya',  label: 'Priya S. · 04:12' },
    ],
    stream: [
      { text: 'Across ' },
      { text: '4 recordings', strong: true },
      { text: ', privacy was the ' },
      { text: '#1 repeated objection', strong: true },
      { text: '. Specifically:\n\n' },
      { text: '· "I don\u2019t trust AI with my notes." ' },
      { cite: 0 },
      { text: '\n· Wants on-device processing. ' },
      { cite: 1 },
      { text: '\n· Left Notion after data-training news. ' },
      { cite: 2 },
      { text: '\n\n' },
      { text: 'Next step:', strong: true },
      { text: ' make privacy the headline of pricing — not a footnote.' },
    ],
  },
  {
    q: 'Which competitors already address this?',
    checked: ['linear', 'granola', 'mem', 'notion-ai'],
    cited: [
      { id: 'linear',    label: 'Linear teardown · p.4' },
      { id: 'granola',   label: 'Granola notes' },
      { id: 'notion-ai', label: 'Notion AI changelog' },
    ],
    stream: [
      { text: 'Three direct comparables:\n\n' },
      { text: '· Linear', strong: true },
      { text: ' ships per-workspace opt-out and SOC 2 badges on every export. ' },
      { cite: 0 },
      { text: '\n· Granola', strong: true },
      { text: ' processes audio fully on-device. ' },
      { cite: 1 },
      { text: '\n· Notion AI', strong: true },
      { text: ' added a data-training toggle after backlash. ' },
      { cite: 2 },
      { text: '\n\nYou\u2019re the only one combining ' },
      { text: 'all three', strong: true },
      { text: '.' },
    ],
  },
  {
    q: 'Draft two privacy headlines I can A/B test.',
    checked: ['synth', 'linear', 'privacy'],
    cited: [
      { id: 'synth',  label: 'Synthesis notes' },
      { id: 'linear', label: 'Linear teardown' },
    ],
    stream: [
      { text: 'Based on ' },
      { text: '"trust" ', strong: true },
      { text: 'appearing ' },
      { text: '11 times ', strong: true },
      { text: 'in your interviews ' },
      { cite: 0 },
      { text: ':\n\n' },
      { text: 'A. ', strong: true },
      { text: '"Your notes never train a model. Not ours. Not anyone\u2019s."\n\n' },
      { text: 'B. ', strong: true },
      { text: '"Private by default. On-device when you ask."\n\n' },
      { text: 'B borrows Granola\u2019s language; A is more directly differentiated.' },
    ],
  },
];

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function ce<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, txt?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (txt != null) el.textContent = txt;
  return el;
}

export type HeroDemoHandle = { stop(): void };

export function runHeroDemo(
  hero: HeroGraphApi,
  composer: HTMLElement,
  thread: HTMLElement,
  classes: {
    msg: string; msgUser: string; msgAi: string;
    sources: string; chip: string; body: string; inlineChip: string;
    typing: string;
  },
): HeroDemoHandle {
  let cancelled = false;

  async function typeInto(el: HTMLElement, text: string, perChar = 22) {
    for (let i = 0; i < text.length; i++) {
      if (cancelled) return;
      el.textContent = text.slice(0, i + 1);
      el.parentElement?.scrollTo({ top: 99999 });
      await sleep(perChar + (text[i] === ' ' ? 10 : 0));
    }
  }

  async function runBeat(beat: Beat) {
    while (thread.children.length > 6) thread.removeChild(thread.firstChild!);

    composer.textContent = '';
    composer.classList.add(classes.typing);
    await typeInto(composer, beat.q, 26);
    composer.classList.remove(classes.typing);
    await sleep(250);

    const userBubble = ce('div', `${classes.msg} ${classes.msgUser}`, beat.q);
    thread.appendChild(userBubble);
    composer.textContent = '';
    if (cancelled) return;

    hero.checkNodes(
      Object.keys(hero.graph.nodeById).filter(id => !beat.checked.includes(id)),
      false,
    );
    hero.checkNodes(beat.checked, true);
    hero.magnetizeTo(beat.checked, 140, -10, 0.04);
    await sleep(400);

    const aiBubble = ce('div', `${classes.msg} ${classes.msgAi}`);
    const chipsRow = ce('div', classes.sources);
    beat.cited.forEach((c, i) => {
      const chip = ce('span', classes.chip);
      chip.dataset.idx = String(i);
      chip.textContent = c.label;
      chipsRow.appendChild(chip);
    });
    aiBubble.appendChild(chipsRow);
    const body = ce('div', classes.body);
    aiBubble.appendChild(body);
    thread.appendChild(aiBubble);

    for (const tok of beat.stream) {
      if (cancelled) return;
      if (tok.cite != null) {
        const cited = beat.cited[tok.cite]!;
        const inline = ce('span', classes.inlineChip, cited.label);
        body.appendChild(inline);
        hero.pulseNodes([cited.id], 1);
        await sleep(280);
      } else if (tok.strong) {
        const s = ce('strong');
        body.appendChild(s);
        await typeInto(s, tok.text ?? '', 14);
      } else {
        const span = ce('span');
        body.appendChild(span);
        await typeInto(span, tok.text ?? '', 14);
      }
    }

    await sleep(3800);
  }

  (async function loop() {
    let i = 0;
    while (!cancelled) {
      await runBeat(SCRIPT[i % SCRIPT.length]!);
      i++;
    }
  })();

  return { stop() { cancelled = true; } };
}
