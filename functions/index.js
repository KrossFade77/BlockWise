/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const {setGlobalOptions} = require("firebase-functions");
const {onRequest} = require("firebase-functions/https");
const {defineSecret} = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
const {buildSchedule} = require("./scheduler");
const Busboy = require('busboy');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');


// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.
setGlobalOptions({ maxInstances: 10 });

// Create and deploy your first functions
// https://firebase.google.com/docs/functions/get-started

// exports.helloWorld = onRequest((request, response) => {
//   logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });


/**
 * JS port of your Python `parse_mcq_text(mcq_text)`.
 * Expects blocks like:
 *
 * **1. Question:** What is ...?
 * * A) Option 1
 * * B) Option 2
 * * C) Option 3
 * * D) Option 4
 * **Correct Answer: B) Option 2**
 */
function parse_mcq_text(mcq_text = "") {
  // Split by double newlines (blank line between questions)
  const blocks = (mcq_text || "").trim().split(/\n\s*\n/);
  const result = [];

  for (const block of blocks) {
    // Extract question
    const qMatch = block.match(/\*\*\d+\.\s*Question:\*\*\s*(.+)/);
    if (!qMatch) continue;
    const question = qMatch[1].trim();

    // Extract options: lines like `* A) text`
    const options = [];
    const optRe = /\*\s+([A-D])\)\s+(.+)/g;
    let m;
    while ((m = optRe.exec(block)) !== null) {
      // m[1] = label (A-D), m[2] = option text
      options.push(m[2].trim());
    }

    // Extract correct answer line
    // e.g. **Correct Answer: B) Option 2**
    const correctMatch = block.match(/\*\*Correct Answer:\s*([A-D])\)\s+(.+)\*\*/);
    const correct = correctMatch ? correctMatch[2].trim() : "";

    result.push({
      Question: question,
      Options: options,
      Correct: correct
    });
  }

  return result;
}

/** Helper to call Gemini 2.5 Flash via REST */
async function callGeminiGenerateContent(prompt, apiKey) {
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" +
    encodeURIComponent(apiKey);

  const body = {
    contents: [{ parts: [{ text: prompt }]}]
  };

  const res = await (await fetch)(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${t}`);
  }

  const json = await res.json();
  // Extract plain text from the response
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return text;
}

/**
 * POST /api/generate
 * Body: { prompt: string }
 * Response: { result: string }  // raw MCQ text from Gemini
 *
 * Mirrors your Python:
 * @app.route("/generate", methods=["POST"])
 * def generate():
 *   ...
 *   model = genai.GenerativeModel("models/gemini-2.5-flash")
 *   response = model.generate_content(prompt)
 *   mcq_text = response.text
 *   return jsonify({"result": mcq_text})
 */
exports.generate = onRequest(
   { region: "asia-southeast1", secrets: [GEMINI_API_KEY] },
   async (req, res) => {
     try {
       if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
       const { prompt } = req.body || {};
       if (!prompt) return res.status(400).json({ error: "Missing 'prompt'" });

       const apiKey = GEMINI_API_KEY.value();
       const mcqText = await callGeminiGenerateContent(prompt, apiKey);
       res.json({ result: mcqText });
     } catch (e) {
       console.error(e);
       res.status(500).json({ error: e.message });
     }
   }
);

/**
 * POST /api/parse
 * Body: { mcq_text: string }
 * Response: { questions: [ { Question, Options[], Correct } ] }
 *
 * Mirrors your Python `parse_mcq_text(mcq_text)` function.
 */
exports.parse = onRequest(
   { region: "asia-southeast1" },
   async (req, res) => {
     try {
       if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
       const { mcq_text } = req.body || {};
       const questions = parse_mcq_text(mcq_text || "");
       res.json({ questions });
     } catch (e) {
       console.error(e);
       res.status(500).json({ error: e.message });
     }
   }
);

exports.renderSchedule = onRequest(
   { region: "asia-southeast1" },
   async (req, res) => {
    try {
      if (req.method !== 'POST') {
        res.status(405).json({ error: 'Use POST' });
        return;
      }

      const payload = req.body || {};
      logger.info('[generate] payload keys', { keys: Object.keys(payload || {}) });

      if (!payload.semester?.startDate || !payload.semester?.endDate) {
        res.status(400).json({ error: 'Missing semester.startDate/endDate' });
        return;
      }
      if (!payload.schedulerConfig?.dailyStart || !payload.schedulerConfig?.dailyEnd) {
        res.status(400).json({ error: 'Missing schedulerConfig.dailyStart/dailyEnd' });
        return;
      }

      const schedule = await buildSchedule(payload);
      res.status(200).json(schedule);
    } catch (err) {
      logger.error('[generate] error', err);
      res.status(500).json({ error: 'Internal error' });
    }
});

/**
 * POST /api/upload
 * Handles file uploads (.txt, .pdf, .docx)
 * Returns: { text: string } or { error: string }
 */
exports.upload = onRequest(
  { region: 'asia-southeast1', timeoutSeconds: 120, memory: '512MiB' },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Use POST' });
      return;
    }

    const ctype = (req.headers['content-type'] || '').toLowerCase();
    if (!ctype.startsWith('multipart/form-data')) {
      res.status(400).json({ error: 'Content-Type must be multipart/form-data' });
      return;
    }

    try {
      const { fileBuffer, filename } = await parseMultipartFromRaw(req);

      if (!filename) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }
      if (!fileBuffer || fileBuffer.length === 0) {
        console.error('[upload] Empty file buffer for', filename);
        res.status(400).json({ error: 'Empty file' });
        return;
      }

      const lower = filename.toLowerCase();
      let text = '';

      if (lower.endsWith('.txt')) {
        text = fileBuffer.toString('utf-8');
      } else if (lower.endsWith('.pdf')) {
        // pdf-parse v2 ESM named export
        const pdfMod = await import('pdf-parse');     // ESM module
        const PDFParse = pdfMod.PDFParse;
        if (!PDFParse) {
          throw new Error('pdf-parse v2 detected but PDFParse class not found');
        }
      
        // Use the buffer you already built
        const parser = new PDFParse({ data: fileBuffer }); // or { buffer: fileBuffer }
        const result = await parser.getText();             // { text, meta, pages, ... }
        await parser.destroy();
      
        text = result?.text || '';
      } else if (lower.endsWith('.docx')) {
        const mammothMod = await import('mammoth');
        const mammothLib = mammothMod.default || mammothMod; // <-- handle default
        const { value } = await mammothLib.extractRawText({ buffer: fileBuffer });
        text = value || '';
      } else {
        res.status(400).json({ error: 'Only .txt, .pdf, .docx supported' });
        return;
      }

      res.status(200).json({ text });
    } catch (err) {
      console.error('[upload] Failed to process file:', err);
      res.status(500).json({ error: 'Failed to process file' });
    }
  }
);

/**
 * Parse multipart/form-data using req.rawBody (CF v2 friendly).
 * Returns { fileBuffer, filename }.
 */
function parseMultipartFromRaw(req) {
  return new Promise((resolve, reject) => {
    const bb = Busboy({ headers: req.headers });

    let fileBuffer = Buffer.alloc(0);
    let filename = '';

    bb.on('file', (fieldname, file, info) => {
      filename = info?.filename || '';
      const chunks = [];
      file.on('data', (d) => chunks.push(d));
      file.on('end', () => {
        fileBuffer = Buffer.concat(chunks);
      });
    });

    // (optional) capture non-file fields if you ever need them:
    // bb.on('field', (name, val) => { ... });

    bb.on('error', (e) => reject(e));
    bb.on('finish', () => resolve({ fileBuffer, filename }));
    bb.on('close', () => { /* some environments emit close; finish is the main one */ });

    // ✅ Feed Busboy with the buffered body instead of piping the req stream
    if (req.rawBody && Buffer.isBuffer(req.rawBody)) {
      bb.end(req.rawBody);
    } else {
      // Fallback: emulator or older envs
      req.pipe(bb);
    }
  });
}