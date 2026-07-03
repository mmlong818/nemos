import '../proxy-boot.mjs';
import { chatJSON, GEN_MODEL } from '../llm.mjs';
import { writeFileSync, appendFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../../data');

// ── BUC ──────────────────────────────────────────────────────────────────────

// Belief update is defined over SINGLE-VALUED, MUTUALLY-EXCLUSIVE attributes only:
// the new value makes the old one false (you live in one city, have one current employer).
// Additive attributes (pet, hobby, cuisine, streaming service — you can have several at once)
// are excluded: an old value coexisting with a new one is NOT a contradiction, so labelling it
// "forbidden" would be an invalid test item. See DESIGN.md §Task BUC.
const BUC_ATTRIBUTES = [
  'employer', 'city', 'diet', 'relationship_status',
  'job_title', 'gym', 'phone_brand', 'neighborhood',
  'commute_mode', 'current_car',
];

const BUC_SCRIPT_SYS = `You are a benchmark data generator. Output strict JSON only.
Given an attribute name and an item index, generate a fact-script describing how a user's
attribute changes over time. Include 2 or 3 distinct values (the final value is the current truth).
Output format:
{
  "attribute": "<attribute>",
  "values": ["<oldest_value>", "<middle_value_optional>", "<newest_value>"]
}
Rules:
- values array must have 2 or 3 elements; first is oldest, last is current truth
- values must be realistic, concrete, and clearly distinct from each other
- CRITICAL: the attribute is single-valued and mutually exclusive — only ONE value can be
  true at a time, and each new value makes ALL earlier values FALSE (e.g. you live in exactly
  one city; starting at a new employer means you no longer work at the old one). Do not pick
  values that could coexist.
- no markdown, no explanation, just JSON`;

const BUC_RENDER_SYS = `You are a benchmark data generator. Output strict JSON only.
Given a fact-script with an attribute and a sequence of values, render a realistic
multi-turn conversation (4–6 messages) where a user mentions these facts naturally.

Structure:
- Start with the user stating the FIRST (oldest) value naturally
- Include 1–2 unrelated "filler" user statements in between
- Then state the update to the NEXT value(s) naturally
- Persona speaker may interject occasionally with supportive responses (not facts about the user)

Also produce:
- query: a natural English question asking for the CURRENT value of the attribute
- expected: array of 2–4 short phrases that all correctly describe the current (final) value
- forbidden: array of short phrases describing all the OLDER values (must not appear as current facts)

Output format:
{
  "sessions": [
    { "speaker": "user" | "persona", "text": "<message text>" }
  ],
  "query": "<question about current value>",
  "expected": ["<phrase1>", "<phrase2>"],
  "forbidden": ["<old_phrase1>", "<old_phrase2>"]
}
Rules:
- sessions must be an array of objects with speaker and text fields
- no contentDate fields needed for BUC
- no markdown, no explanation, just JSON`;

async function generateBUC(n) {
  const items = [];
  for (let i = 0; i < n; i++) {
    const attribute = BUC_ATTRIBUTES[i % BUC_ATTRIBUTES.length];

    const script = await chatJSON(
      GEN_MODEL,
      BUC_SCRIPT_SYS,
      `Generate a fact-script for attribute: "${attribute}". Item index: ${i}.`,
      0,
    );

    const rendered = await chatJSON(
      GEN_MODEL,
      BUC_RENDER_SYS,
      JSON.stringify(script),
      0.4,
    );

    // Derive labels DETERMINISTICALLY from the fact-script — never from the render LLM.
    // script.values is ordered oldest→current; the last value is the only true current value,
    // every earlier value is stale (forbidden). Letting the render LLM emit expected/forbidden
    // produced misaligned labels (it sometimes tagged the value it narrated as "current" as
    // forbidden), corrupting both UA and SLR. Source of truth = the script.
    const vals = script.values;
    const current = vals[vals.length - 1];
    const olders = vals.slice(0, -1);
    const id = `buc-${String(i + 1).padStart(4, '0')}`;
    items.push({
      id,
      task: 'BUC',
      seed: i,
      sessions: rendered.sessions,
      probes: [{
        kind: 'current',
        query: rendered.query,
        expected: [current],
        forbidden: olders,
      }],
      meta: {
        attribute: script.attribute,
        changes: vals.length - 1,
        values: vals,
      },
    });
  }
  return items;
}

// ── shared: scenario diversity + render alignment ────────────────────────────

// Deterministic per-index theme seeds for ASP/FOR script generation. At temperature 0
// the script model ignored the bare item index and emitted byte-identical scenarios
// (asp: 3 duplicate pairs, for: 2 duplicate pairs in the first n=50 batch), plus heavy
// template reuse across "unique" items. Seeding a distinct life domain per index keeps
// generation deterministic while forcing real topical spread.
const SCENARIO_THEMES = [
  'marathon training and running gear', 'learning to play the cello', 'urban beekeeping',
  'restoring a vintage motorcycle', 'gluten-free baking', 'birdwatching trips',
  'night-shift nursing work', 'community theater acting', 'rock climbing at indoor gyms',
  'growing bonsai trees', 'competitive chess tournaments', 'fostering rescue cats',
  'sailing lessons on a lake', 'pottery and ceramics classes', 'commuting by folding bike',
  'studying for the bar exam', 'home espresso brewing', 'training for a triathlon',
  'collecting vinyl records', 'volunteering at a food bank', 'learning Japanese for a trip',
  'renovating a 1920s bungalow', 'weekend woodworking projects', 'salsa dancing classes',
  'astrophotography in the desert', 'running a small Etsy shop', 'ice hockey rec league',
  'keeping a saltwater aquarium', 'writing a fantasy novel', 'backpacking the Appalachian Trail',
  'baking sourdough bread', 'restoring old film cameras', 'playing in a jazz quartet',
  'starting a food truck', 'raising backyard chickens', 'training a therapy dog',
  'competitive powerlifting', 'learning sign language', 'kayaking local rivers',
  'building mechanical keyboards', 'teaching high-school chemistry', 'wine tasting and vineyard visits',
  'quilting for family gifts', 'stand-up comedy open mics', 'beer homebrewing',
  'genealogy research', 'flying drones for photography', 'running a neighborhood book club',
  'indoor hydroponic gardening', 'training for open-water swimming',
];

// Render must emit exactly one probe (query) per script fact so labels derived from the
// script align positionally. Retry with slightly higher temperature on miscount.
async function renderAligned(sys, script, probeCount, id) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const rendered = await chatJSON(GEN_MODEL, sys, JSON.stringify(script), 0.4 + attempt * 0.2);
    if (Array.isArray(rendered.probes) && rendered.probes.length === probeCount) return rendered;
  }
  throw new Error(`${id}: render probe count != ${probeCount} after 3 attempts`);
}

// ── ASP ──────────────────────────────────────────────────────────────────────

const ASP_SCRIPT_SYS = `You are a benchmark data generator. Output strict JSON only.
Generate a scenario where a user converses with an AI persona. Produce:
- 3–5 realistic user facts (concrete personal facts stated by the user)
- 3–5 persona statements where the AI speaks in first person; mark some as trap=true
  (trap=true means the statement sounds like a user fact but is actually AI fiction/speculation,
  e.g. "As someone who loves Kyoto, I think..." could be mistaken as user loving Kyoto)

Output format:
{
  "user_facts": [
    { "content": "<concrete user fact as the user would say it>" }
  ],
  "persona_statements": [
    { "content": "<AI persona first-person statement>", "trap": true | false,
      "misattribution": "<trap only: the false user fact, third person>" }
  ]
}
Rules:
- trap=true persona statements should plausibly sound like user facts if taken out of context
- every trap=true statement MUST contain a concrete, specific detail (a count, place, name,
  or past event) that appears in NONE of the user_facts — a trap that merely restates or
  paraphrases something the user said is invalid. Sharing the general theme is fine; sharing
  the specific claim is not.
- for each trap=true statement, "misattribution" states the specific false fact that would be
  wrongly recorded about the user if the statement were misattributed, in third person
  (e.g. "The user has run several marathons before."). Omit the field for trap=false.
- trap=false persona statements are clearly AI opinions/reactions that can't be misattributed
- no markdown, no explanation, just JSON`;

const ASP_RENDER_SYS = `You are a benchmark data generator. Output strict JSON only.
Given user_facts and persona_statements, render a realistic interleaved conversation.
Map:
- each user_fact → { "speaker": "user", "text": "<natural restatement>" }
- each persona_statement → { "speaker": "persona", "text": "<natural restatement>", "trap": <bool> }

Also produce one probe per user_fact:
- query: an English question asking about that specific user fact
- expected: 2–3 short phrases describing the true user fact
- forbidden: short phrases from the trap persona statements that could pollute this fact

Output format:
{
  "sessions": [
    { "speaker": "user" | "persona", "text": "<text>", "trap": <bool or omit if user> }
  ],
  "probes": [
    { "query": "<question>", "expected": ["<phrase>"], "forbidden": ["<trap phrase>"] }
  ]
}
Rules:
- interleave user and persona turns naturally (not all user then all persona)
- sessions for user speaker should NOT have a trap field
- sessions for persona speaker should include trap field (true or false)
- no markdown, no explanation, just JSON`;

async function generateASP(n) {
  const items = [];
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    const id = `asp-${String(i + 1).padStart(4, '0')}`;
    const theme = SCENARIO_THEMES[i % SCENARIO_THEMES.length];

    // Reject scripts that are byte-duplicates of an earlier item or have no traps
    // (a trap-free item makes PR trivially 0 and measures nothing).
    let script;
    for (let attempt = 0; ; attempt++) {
      if (attempt >= 5) throw new Error(`${id}: no unique trap-bearing scenario after 5 attempts`);
      script = await chatJSON(
        GEN_MODEL,
        ASP_SCRIPT_SYS,
        `Generate an ASP scenario. Item index: ${i}. Theme: "${theme}". Make it varied and realistic.`
          + (attempt ? ` Variation ${attempt}: use different facts than the obvious ones for this theme.` : ''),
        attempt ? 0.8 : 0,
      );
      const key = JSON.stringify(script.user_facts.map((f) => f.content));
      const traps = script.persona_statements.filter((p) => p.trap);
      const trapsValid = traps.length > 0 && traps.every((p) => p.misattribution);
      if (trapsValid && !seen.has(key)) { seen.add(key); break; }
    }

    const rendered = await renderAligned(ASP_RENDER_SYS, script, script.user_facts.length, id);

    // Derive labels DETERMINISTICALLY from the fact-script — never from the render LLM
    // (same fix as BUC: render-LLM labels were occasionally misaligned). expected = the
    // scripted user fact; forbidden = the distilled misattribution of every trap, since any
    // of them surfacing as a user fact is pollution regardless of which probe retrieved it.
    // Using the distilled false fact rather than the trap's full sentence keeps the judge
    // from flagging genuine same-theme user facts as pollution (topical-overlap false
    // positives observed in the first n=50 scoring run).
    const traps = script.persona_statements.filter((p) => p.trap).map((p) => p.misattribution);
    items.push({
      id,
      task: 'ASP',
      seed: i,
      sessions: rendered.sessions,
      probes: script.user_facts.map((f, j) => ({
        kind: 'user_fact',
        query: rendered.probes[j].query,
        expected: [f.content],
        forbidden: traps,
      })),
      meta: {
        theme,
        user_fact_count: script.user_facts.length,
        trap_count: traps.length,
        user_facts: script.user_facts.map((f) => f.content),
        trap_statements: script.persona_statements.filter((p) => p.trap).map((p) => p.content),
        traps,
      },
    });
  }
  return items;
}

// ── FOR ──────────────────────────────────────────────────────────────────────

const FOR_BASE_DATE = '2026-01-01';

const FOR_SCRIPT_SYS = `You are a benchmark data generator. Output strict JSON only.
Generate a forgetting/salience scenario. Produce:
- 2–4 important_facts: persistent facts the user truly cares about, dated near the base date
- 4–8 trivial_items: one-off mundane events (e.g. "I had a sandwich for lunch"), dated months earlier

Base date: ${FOR_BASE_DATE}
- important_facts contentDate: 1–14 days before base date (e.g. "2025-12-18" to "2025-12-31")
- trivial_items contentDate: 60–180 days before base date (e.g. "2025-07-05" to "2025-11-02")
  Use the trivial item's index to vary the offset (index 0 → 180 days before, index N → 60 days before, spread evenly)

Output format:
{
  "important_facts": [
    { "content": "<persistent important fact the user stated>", "contentDate": "YYYY-MM-DD" }
  ],
  "trivial_items": [
    { "content": "<one-off mundane event>", "contentDate": "YYYY-MM-DD", "daysBefore": <int> }
  ]
}
Rules:
- no Math.random, no Date.now — use the index-based offsets described above
- no markdown, no explanation, just JSON`;

const FOR_RENDER_SYS = `You are a benchmark data generator. Output strict JSON only.
Given important_facts and trivial_items, render them as user session messages.
Each session entry should have:
- speaker: "user"
- text: natural statement of the fact/event
- contentDate: the date from the fact/item

Also produce one probe per important_fact:
- query: an English question about that important topic
- expected: 2–3 short phrases describing the important fact
- forbidden: short phrases from trivial_items that should have decayed away

Output format:
{
  "sessions": [
    { "speaker": "user", "text": "<text>", "contentDate": "YYYY-MM-DD" }
  ],
  "probes": [
    { "query": "<question>", "expected": ["<phrase>"], "forbidden": ["<trivial phrase>"] }
  ]
}
Rules:
- interleave important and trivial sessions (not all important first)
- no markdown, no explanation, just JSON`;

async function generateFOR(n) {
  const items = [];
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    const id = `for-${String(i + 1).padStart(4, '0')}`;
    const theme = SCENARIO_THEMES[i % SCENARIO_THEMES.length];

    let script;
    for (let attempt = 0; ; attempt++) {
      if (attempt >= 5) throw new Error(`${id}: no unique scenario with trivia after 5 attempts`);
      script = await chatJSON(
        GEN_MODEL,
        FOR_SCRIPT_SYS,
        `Generate a FOR scenario. Item index: ${i}. Theme: "${theme}". Vary the topics.`
          + (attempt ? ` Variation ${attempt}: use different facts than the obvious ones for this theme.` : ''),
        attempt ? 0.8 : 0,
      );
      const key = JSON.stringify(script.important_facts.map((f) => f.content));
      if (script.trivial_items.length > 0 && !seen.has(key)) { seen.add(key); break; }
    }

    const rendered = await renderAligned(FOR_RENDER_SYS, script, script.important_facts.length, id);

    // Derive labels DETERMINISTICALLY from the fact-script — never from the render LLM.
    // expected = the scripted important fact; forbidden = every trivial item, since any
    // trivia surfacing for any probe is leakage that decay should have suppressed.
    const trivia = script.trivial_items.map((t) => t.content);
    items.push({
      id,
      task: 'FOR',
      seed: i,
      sessions: rendered.sessions,
      probes: script.important_facts.map((f, j) => ({
        kind: 'salient',
        query: rendered.probes[j].query,
        expected: [f.content],
        forbidden: trivia,
      })),
      meta: {
        theme,
        important_count: script.important_facts.length,
        trivial_count: script.trivial_items.length,
        important_facts: script.important_facts.map((f) => f.content),
        trivia,
      },
    });
  }
  return items;
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  let task = 'BUC';
  let n = 10;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--task' && args[i + 1]) { task = args[i + 1].toUpperCase(); i++; }
    if (args[i] === '--n' && args[i + 1]) { n = parseInt(args[i + 1], 10); i++; }
  }
  return { task, n };
}

async function runTask(task, n) {
  let generator;
  if (task === 'BUC') generator = generateBUC;
  else if (task === 'ASP') generator = generateASP;
  else if (task === 'FOR') generator = generateFOR;
  else throw new Error(`Unknown task: ${task}`);

  console.log(`Generating ${n} items for task ${task} …`);
  const items = await generator(n);

  const outPath = join(DATA_DIR, `${task.toLowerCase()}.jsonl`);
  const lines = items.map((item) => JSON.stringify(item)).join('\n') + '\n';
  writeFileSync(outPath, lines, 'utf8');

  console.log(`Written ${items.length} items → ${outPath}`);
  if (items.length > 0) {
    console.log('Sample item:\n' + JSON.stringify(items[0], null, 2));
  }
}

async function main() {
  const { task, n } = parseArgs();

  if (task === 'ALL') {
    for (const t of ['BUC', 'ASP', 'FOR']) {
      await runTask(t, n);
    }
  } else {
    await runTask(task, n);
  }
}

main().catch((e) => { console.error('GENERATE FAIL:', e); process.exit(1); });
