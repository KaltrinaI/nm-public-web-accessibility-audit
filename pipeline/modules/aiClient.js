const { GoogleGenerativeAI } = require('@google/generative-ai');

if (!process.env.GEMINI_API_KEY) {
  console.error('❌  GEMINI_API_KEY is not set.');
  console.error('    Run: export GEMINI_API_KEY="AIza-your-key-here"');
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const MIN_GAP_MS = 1100;
let lastCallTime  = 0;
let queuedCalls   = 0;

async function rateLimitWait() {
  const mySlot = queuedCalls;
  queuedCalls++;

  const waitUntil = lastCallTime + (mySlot * MIN_GAP_MS);
  const now       = Date.now();
  const delay     = Math.max(0, waitUntil - now);

  if (delay > 0) {
    await new Promise(r => setTimeout(r, delay));
  }

  lastCallTime = Date.now();
  queuedCalls  = Math.max(0, queuedCalls - 1);
}

async function withRetry(fn, retries = 4) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRetryable =
        err.message?.includes('429') ||
        err.message?.includes('quota') ||
        err.message?.includes('rate') ||
        err.message?.includes('503') ||
        err.message?.includes('Service Unavailable') ||
        err.message?.includes('overloaded') ||
        err.message?.includes('500') ||
        err.status === 503 ||
        err.status === 500;

      if (isRetryable && attempt < retries) {
        const wait = attempt * 10000;
        console.warn(`    ⏳ API unavailable — waiting ${wait / 1000}s (retry ${attempt}/${retries})`);
        await new Promise(r => setTimeout(r, wait));
      } else {
        console.warn(`    ⚠️  API failed after ${retries} attempts: ${err.message?.slice(0, 80)}`);
        return { error: err.message?.slice(0, 200) };
      }
    }
  }
}

function parseJSON(text) {
  let clean = text.trim();

  clean = clean.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();

  clean = clean.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();
  clean = clean.replace(/<thought>[\s\S]*?<\/thought>/gi, '').trim();
  clean = clean.replace(/^thinking:[\s\S]*?\n\n/i, '').trim();

  const jsonStart = clean.search(/[\[{]/);
  if (jsonStart < 0) {
    throw new Error(`No JSON structure found in response: "${clean.slice(0, 100)}"`);
  }
  if (jsonStart > 0) clean = clean.slice(jsonStart);

  const lastBrace   = clean.lastIndexOf('}');
  const lastBracket = clean.lastIndexOf(']');
  const jsonEnd     = Math.max(lastBrace, lastBracket);
  if (jsonEnd >= 0) clean = clean.slice(0, jsonEnd + 1);

  try {
    return JSON.parse(clean);
  } catch (firstError) {
    const openBraces    = (clean.match(/\{/g) || []).length;
    const closeBraces   = (clean.match(/\}/g) || []).length;
    const openBrackets  = (clean.match(/\[/g) || []).length;
    const closeBrackets = (clean.match(/\]/g) || []).length;

    const missingBraces   = openBraces   - closeBraces;
    const missingBrackets = openBrackets - closeBrackets;

    if (missingBraces > 5 || missingBrackets > 5) {
      throw new Error(`JSON too truncated to repair safely (missing ${missingBraces} braces, ${missingBrackets} brackets)`);
    }

    let fixed = clean;

    const quoteCount = (fixed.match(/(?<!\\)"/g) || []).length;
    if (quoteCount % 2 !== 0) {
      fixed += '"';
    }

    for (let i = 0; i < missingBrackets; i++) fixed += ']';
    for (let i = 0; i < missingBraces;   i++) fixed += '}';

    try {
      const repaired = JSON.parse(fixed);
      console.warn(`    ⚠️  JSON was truncated and repaired (missing ${missingBraces} braces, ${missingBrackets} brackets)`);
      return repaired;
    } catch (repairError) {
      throw new Error(`JSON parse failed and repair unsuccessful: ${firstError.message}`);
    }
  }
}

async function askAI(prompt, images = [], maxTokens = 2000) {
  await rateLimitWait();

  return await withRetry(async () => {
    const isMultimodal = images.length > 0;

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: 0.1,

        ...(isMultimodal ? {} : { responseMimeType: 'application/json' }),
      },
    });

    const parts = [];

    for (const img of images) {
      parts.push({
        inlineData: {
          mimeType: img.mediaType || 'image/png',
          data: img.base64,
        },
      });
    }

    parts.push({
      text: prompt + '\n\nIMPORTANT: Respond with valid JSON only. No markdown, no explanation, no code fences.',
    });

    const result = await model.generateContent(parts);
    const text   = result.response.text();

    try {
      return parseJSON(text);
    } catch (e) {
      console.warn(`    ⚠️  Gemini returned unparseable response: ${e.message}`);
      console.warn(`    Raw (first 200 chars): ${text.slice(0, 200)}`);
      return { error: 'Could not parse AI response', raw: text.slice(0, 300) };
    }
  });
}

module.exports = { askAI };
