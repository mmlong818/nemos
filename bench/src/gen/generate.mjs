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

    const id = `buc-${String(i + 1).padStart(4, '0')}`;
    items.push({
      id,
      task: 'BUC',
      seed: i,
      sessions: rendered.sessions,
      probes: [{
        kind: 'current',
        query: rendered.query,
        expected: rendered.expected,
        forbidden: rendered.forbidden,
      }],
      meta: {
        attribute: script.attribute,
        changes: script.values.length - 1,
      },
    });
  }
  return items;
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
    { "content": "<AI persona first-person statement>", "trap": true | false }
  ]
}
Rules:
- trap=true persona statements should plausibly sound like user facts if taken out of context
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
  for (let i = 0; i < n; i++) {
    const script = await chatJSON(
      GEN_MODEL,
      ASP_SCRIPT_SYS,
      `Generate an ASP scenario. Item index: ${i}. Make it varied and realistic.`,
      0,
    );

    const rendered = await chatJSON(
      GEN_MODEL,
      ASP_RENDER_SYS,
      JSON.stringify(script),
      0.4,
    );

    const trapCount = script.persona_statements.filter((p) => p.trap).length;
    const id = `asp-${String(i + 1).padStart(4, '0')}`;
    items.push({
      id,
      task: 'ASP',
      seed: i,
      sessions: rendered.sessions,
      probes: rendered.probes.map((p) => ({
        kind: 'user_fact',
        query: p.query,
        expected: p.expected,
        forbidden: p.forbidden,
      })),
      meta: {
        user_fact_count: script.user_facts.length,
        trap_count: trapCount,
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
  for (let i = 0; i < n; i++) {
    const script = await chatJSON(
      GEN_MODEL,
      FOR_SCRIPT_SYS,
      `Generate a FOR scenario. Item index: ${i}. Vary the topics.`,
      0,
    );

    const rendered = await chatJSON(
      GEN_MODEL,
      FOR_RENDER_SYS,
      JSON.stringify(script),
      0.4,
    );

    const id = `for-${String(i + 1).padStart(4, '0')}`;
    items.push({
      id,
      task: 'FOR',
      seed: i,
      sessions: rendered.sessions,
      probes: rendered.probes.map((p) => ({
        kind: 'salient',
        query: p.query,
        expected: p.expected,
        forbidden: p.forbidden,
      })),
      meta: {
        important_count: script.important_facts.length,
        trivial_count: script.trivial_items.length,
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
