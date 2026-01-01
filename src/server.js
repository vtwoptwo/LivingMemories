import express from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { GoogleGenAI } from '@google/genai';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Validate API key exists
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('ERROR: GEMINI_API_KEY environment variable is required');
  console.error('Get your key from: https://aistudio.google.com/app/apikey');
  console.error('Set it with: export GEMINI_API_KEY=your_api_key');
  process.exit(1);
}

// Initialize Gemini with new SDK
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// Use Gemini 2.5 Flash Image model for image generation/editing
// Alternative models: 'gemini-3-pro-image-preview', 'gemini-2.0-flash-preview-image-generation'
const MODEL_ID = 'gemini-2.5-flash-image';

// Configure multer for memory storage (no disk persistence)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, and WebP are allowed.'));
    }
  },
});

// Rate limiting - 20 requests per minute per IP
const enhanceLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Too many requests. Please wait a moment before trying again.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());

// Base restoration prompt
const BASE_PROMPT = `You are a professional photo restoration expert. Your task is to restore this old or damaged photograph while preserving EVERYTHING about the original.

RESTORATION TASKS (what to fix):
- Remove dust, scratches, tears, and physical damage marks
- Remove stains, spots, and discoloration artifacts
- Reduce noise and grain while keeping natural film texture
- Correct faded colors - restore vibrancy without altering the original palette
- Fix minor exposure issues
- Improve overall clarity and sharpness gently

ABSOLUTE CONSTRAINTS (what must NOT change):
- DO NOT alter any facial features, expressions, or proportions
- DO NOT change anyone's apparent age, weight, or body shape
- DO NOT modify the background, setting, or environment
- DO NOT change the composition, framing, or cropping
- DO NOT add any elements that weren't in the original
- DO NOT remove any people, objects, or elements from the scene

The goal is RESTORATION, not enhancement. Output ONLY the restored image.`;

// Enhance endpoint
app.post('/api/enhance', enhanceLimiter, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided.' });
    }

    const additionalInstructions = req.body.additionalInstructions?.trim();

    // Build the complete prompt
    let fullPrompt = BASE_PROMPT;
    if (additionalInstructions) {
      fullPrompt += `\n\nADDITIONAL USER INSTRUCTIONS:\n${additionalInstructions}`;
    }

    // Convert image to base64
    const imageBase64 = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype;

    console.log('Processing image with Gemini...');

    // Call Gemini with the new SDK
    const response = await ai.models.generateContent({
      model: MODEL_ID,
      contents: [
        {
          role: 'user',
          parts: [
            { text: fullPrompt },
            {
              inlineData: {
                mimeType: mimeType,
                data: imageBase64,
              },
            },
          ],
        },
      ],
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
      },
    });

    // Extract image from response - try different possible structures
    let enhancedImageData = null;
    let enhancedMimeType = 'image/png';

    // Check for parts in candidates
    const candidates = response.candidates || [];
    for (const candidate of candidates) {
      const parts = candidate.content?.parts || [];
      for (const part of parts) {
        if (part.inlineData) {
          enhancedImageData = part.inlineData.data;
          enhancedMimeType = part.inlineData.mimeType || 'image/png';
          break;
        }
      }
      if (enhancedImageData) break;
    }

    // Also check response.parts directly (some SDK versions)
    if (!enhancedImageData && response.parts) {
      for (const part of response.parts) {
        if (part.inlineData) {
          enhancedImageData = part.inlineData.data;
          enhancedMimeType = part.inlineData.mimeType || 'image/png';
          break;
        }
      }
    }

    if (!enhancedImageData) {
      // Check if there's text explaining why it couldn't process
      let errorText = '';
      for (const candidate of candidates) {
        const parts = candidate.content?.parts || [];
        for (const part of parts) {
          if (part.text) {
            errorText = part.text;
            break;
          }
        }
      }
      console.error('No image in response. Text:', errorText);
      return res.status(422).json({
        error: errorText || 'Unable to process image. Please try a different photo.'
      });
    }

    res.json({
      success: true,
      image: enhancedImageData,
      mimeType: enhancedMimeType,
    });

  } catch (error) {
    console.error('Enhancement error:', error);

    // Handle specific error types
    if (error.message?.includes('not available in your country')) {
      return res.status(422).json({
        error: 'Image generation is not available in your region. Try using a VPN to a supported country (e.g., US).'
      });
    }

    if (error.message?.includes('SAFETY')) {
      return res.status(422).json({
        error: 'This image could not be processed due to content restrictions. Please try a different photo.'
      });
    }

    if (error.message?.includes('Invalid file type')) {
      return res.status(400).json({ error: error.message });
    }

    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 10MB.' });
    }

    res.status(500).json({
      error: 'Something went wrong while processing your image. Please try again.'
    });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 10MB.' });
    }
  }
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'An unexpected error occurred.' });
});

app.listen(PORT, () => {
  console.log(`Photo Restore server running at http://localhost:${PORT}`);
});
