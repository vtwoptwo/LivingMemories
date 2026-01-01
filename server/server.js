// server/server.js
import express from "express";
import cors from "cors";
import multer from "multer";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();
app.use(cors({ origin: true })); // tighten to your domain in production
app.use(express.json());

const upload = multer({
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Choose a Gemini image-capable model id available to you.
// Example used here (commonly documented): "gemini-3-pro-image-preview"
const MODEL_ID = "gemini-3-pro-image-preview";

// Base prompt: "remove imperfections but keep everything exactly the same"
const BASE_PROMPT = `
You are restoring an old photograph.
Task: remove imperfections (dust, scratches, stains, noise, minor discoloration) while preserving the photo exactly.
Constraints:
- Do NOT change composition, framing, perspective, or crop.
- Do NOT add or remove objects or details.
- Do NOT alter faces, identity, age, or body shape.
- Preserve original textures, patterns, and background details.
- Keep lighting and color faithful; only correct damage/aging artifacts.
Return only the restored image.
`.trim();

app.post("/api/enhance", upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });

    const userPrompt = (req.body?.userPrompt || "").trim();

    const finalPrompt =
      userPrompt.length > 0
        ? `${BASE_PROMPT}\n\nAdditional instructions:\n${userPrompt}`
        : BASE_PROMPT;

    const base64 = req.file.buffer.toString("base64");
    const mimeType = req.file.mimetype || "image/jpeg";

    const response = await ai.models.generateContent({
      model: MODEL_ID,
      config: {
        responseModalities: ["TEXT", "IMAGE"],
      },
      contents: [
        { text: finalPrompt },
        {
          inlineData: {
            mime_type: mimeType,
            data: base64,
          },
        },
      ],
    });

    // Depending on SDK version, image parts may be on response.outputParts
    // or nested in response.candidates[*].content.parts.
    const parts =
      response.outputParts ||
      response.candidates?.flatMap((c) => c.content?.parts || []) ||
      [];

    const imagePart = parts.find((p) => p.mime_type?.startsWith("image/") && p.data);

    if (!imagePart) {
      return res.status(502).json({
        error: "No image returned from model.",
        debugText: parts.find((p) => p.text)?.text || null,
      });
    }

    res.json({
      mimeType: imagePart.mime_type,
      base64: imagePart.data,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Enhancement failed." });
  }
});

app.get("/health", (_, res) => res.send("ok"));

app.listen(process.env.PORT || 5050, () => {
  console.log(`Server running on http://localhost:${process.env.PORT || 5050}`);
});
