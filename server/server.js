// server/server.js
import { GoogleGenAI } from "@google/genai";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import multer from "multer";

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
const BASE_PROMPT = `Act as a senior digital imaging specialist and high-end portrait retoucher. Your goal is to transform this vintage reference into a modern, high-resolution digital photograph.

### 1. ABSOLUTE PRESERVATION (Identity & Attire)
- The subjects must remain 100% recognizable. Do NOT alter facial geometry, expressions, or the specific proportions of the two women and child.
- The clothing (sweaters, lace collars, patterns) must be preserved exactly as they are in the original photo, but rendered with high-frequency digital detail.

### 2. MODERN DIGITALIZATION & QUALITY
- Render the image as if captured on a modern full-frame digital camera with a 85mm prime lens at f/1.8.
- Apply professional post-production color grading: convert the sepia/monochrome into a vibrant, natural color palette with realistic skin tones.
- Implement modern High Dynamic Range (HDR): ensure deep, clean blacks and bright, crisp whites with no digital noise or grain.
- Add a soft "bokeh" background blur to create contemporary depth and focus on the subjects.

### 3. HYPER-REALISTIC DETAIL RECONSTRUCTION
- Reconstruct the blurry areas into sharp, digital textures:
    - **Skin:** Render realistic skin texture with visible pores and natural imperfections (avoid the "plastic" AI look).
    - **Eyes:** Add realistic "catchlights" (reflections) to the eyes to make them look alive and sharp.
    - **Hair:** Define sharp, individual strands and soft highlights.
    - **Fabric:** Enhance the weave and micro-fibers of the clothing to look tactile and high-definition.

### 4. RESTORATION & FINISH
- Remove every trace of the original physical damage, including the large tears on the edges and all internal creases.
- Output a flawless, ultra-high-definition 8k digital image that looks like a contemporary studio portrait.`.trim();

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
