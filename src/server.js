import express from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { GoogleGenAI } from '@google/genai';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { supabase, authMiddleware } from './supabase.js';
import * as db from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase config for client-side
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

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

// Serve static files with Supabase config injection
const publicPath = path.join(__dirname, '../public');

// Inject Supabase config into HTML files
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path === '/') {
    const filePath = req.path === '/' ? '/index.html' : req.path;
    const fullPath = path.join(publicPath, filePath);

    if (fs.existsSync(fullPath)) {
      let html = fs.readFileSync(fullPath, 'utf8');

      // Inject Supabase config before other scripts
      const supabaseConfig = `
    <script>
      window.SUPABASE_URL = "${SUPABASE_URL || ''}";
      window.SUPABASE_ANON_KEY = "${SUPABASE_ANON_KEY || ''}";
    </script>`;

      html = html.replace('</head>', `${supabaseConfig}\n</head>`);
      res.set('Content-Type', 'text/html');
      return res.send(html);
    }
  }
  next();
});

app.use(express.static(publicPath));
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

// ============================
// Photo Upload & Enhancement
// ============================

// Upload a new photo (creates photo + original version)
app.post('/api/photos', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided.' });
    }

    const userId = req.user.id;
    const { title, folderId } = req.body;

    // Upload to Supabase Storage
    const { bucket, objectKey } = await db.uploadToStorage(
      userId,
      req.file.buffer,
      req.file.mimetype,
      true // is original
    );

    // Calculate checksum
    const checksum = db.calculateChecksum(req.file.buffer);

    // Create storage object record
    const storageObject = await db.createStorageObject(userId, {
      bucket,
      objectKey,
      checksum,
      bytes: req.file.size,
      mimeType: req.file.mimetype,
    });

    // Create photo record
    const photo = await db.createPhoto(userId, {
      folderId: folderId ? parseInt(folderId) : null,
      title: title || req.file.originalname,
    });

    // Create original version
    const version = await db.createPhotoVersion(userId, {
      photoId: photo.id,
      storageObjectId: storageObject.id,
      isOriginal: true,
      label: 'Original',
    });

    // Get signed URL for the original
    const signedUrl = await db.getSignedUrl(bucket, objectKey);

    res.json({
      success: true,
      photo: {
        ...photo,
        originalVersion: {
          ...version,
          signedUrl,
        },
      },
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to upload photo.' });
  }
});

// Enhance a photo (creates job, processes, creates result version)
app.post('/api/photos/:photoId/enhance', authMiddleware, enhanceLimiter, async (req, res) => {
  const userId = req.user.id;
  const photoId = parseInt(req.params.photoId);
  const { additionalInstructions, versionId } = req.body;

  let job = null;

  try {
    // Get the photo with versions
    const photo = await db.getPhoto(photoId, userId);
    if (!photo) {
      return res.status(404).json({ error: 'Photo not found.' });
    }

    // Find the input version (specified or original)
    let inputVersion;
    if (versionId) {
      inputVersion = photo.versions.find(v => v.id === parseInt(versionId));
    } else {
      inputVersion = photo.versions.find(v => v.is_original);
    }

    if (!inputVersion) {
      return res.status(400).json({ error: 'Input version not found.' });
    }

    // Create enhancement job
    job = await db.createEnhancementJob(userId, {
      photoId,
      inputVersionId: inputVersion.id,
      modelName: 'gemini',
      modelVersion: MODEL_ID,
      parameters: { additionalInstructions: additionalInstructions || '' },
    });

    // Mark job as running
    await db.startEnhancementJob(job.id, userId);

    // Get the input image from storage
    const signedUrl = await db.getSignedUrl(
      inputVersion.storage.bucket,
      inputVersion.storage.object_key
    );

    // Fetch the image
    const imageResponse = await fetch(signedUrl);
    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
    const imageBase64 = imageBuffer.toString('base64');
    const mimeType = inputVersion.storage.mime_type;

    // Build prompt
    let fullPrompt = BASE_PROMPT;
    if (additionalInstructions?.trim()) {
      fullPrompt += `\n\nADDITIONAL USER INSTRUCTIONS:\n${additionalInstructions}`;
    }

    console.log(`Processing photo ${photoId} with Gemini...`);

    // Call Gemini
    const response = await ai.models.generateContent({
      model: MODEL_ID,
      contents: [
        {
          role: 'user',
          parts: [
            { text: fullPrompt },
            { inlineData: { mimeType, data: imageBase64 } },
          ],
        },
      ],
      config: { responseModalities: ['TEXT', 'IMAGE'] },
    });

    // Extract enhanced image
    let enhancedImageData = null;
    let enhancedMimeType = 'image/png';

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
      await db.failEnhancementJob(job.id, userId, errorText || 'No image returned');
      return res.status(422).json({
        error: errorText || 'Unable to process image. Please try a different photo.',
        jobId: job.id,
      });
    }

    // Upload enhanced image to storage
    const enhancedBuffer = Buffer.from(enhancedImageData, 'base64');
    const { bucket, objectKey } = await db.uploadToStorage(
      userId,
      enhancedBuffer,
      enhancedMimeType,
      false // not original
    );

    // Create storage object for enhanced image
    const enhancedStorageObject = await db.createStorageObject(userId, {
      bucket,
      objectKey,
      checksum: db.calculateChecksum(enhancedBuffer),
      bytes: enhancedBuffer.length,
      mimeType: enhancedMimeType,
    });

    // Count existing enhanced versions
    const enhancedCount = photo.versions.filter(v => !v.is_original).length;

    // Create enhanced version
    const enhancedVersion = await db.createPhotoVersion(userId, {
      photoId,
      storageObjectId: enhancedStorageObject.id,
      isOriginal: false,
      parentVersionId: inputVersion.id,
      label: `Enhanced v${enhancedCount + 1}`,
    });

    // Complete the job
    await db.completeEnhancementJob(job.id, userId, enhancedVersion.id);

    // Get signed URL for the result
    const resultSignedUrl = await db.getSignedUrl(bucket, objectKey);

    res.json({
      success: true,
      jobId: job.id,
      version: {
        ...enhancedVersion,
        signedUrl: resultSignedUrl,
      },
      image: enhancedImageData,
      mimeType: enhancedMimeType,
    });

  } catch (error) {
    console.error('Enhancement error:', error);

    if (job) {
      await db.failEnhancementJob(job.id, userId, error.message).catch(console.error);
    }

    if (error.message?.includes('not available in your country')) {
      return res.status(422).json({
        error: 'Image generation is not available in your region.',
        jobId: job?.id,
      });
    }

    if (error.message?.includes('SAFETY')) {
      return res.status(422).json({
        error: 'This image could not be processed due to content restrictions.',
        jobId: job?.id,
      });
    }

    res.status(500).json({
      error: 'Something went wrong while processing your image.',
      jobId: job?.id,
    });
  }
});

// Main enhance endpoint - processes image and returns result (does NOT save to library)
app.post('/api/enhance', authMiddleware, enhanceLimiter, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided.' });
    }

    const additionalInstructions = req.body.additionalInstructions?.trim();

    // Build prompt
    let fullPrompt = BASE_PROMPT;
    if (additionalInstructions) {
      fullPrompt += `\n\nADDITIONAL USER INSTRUCTIONS:\n${additionalInstructions}`;
    }

    const imageBase64 = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype;

    console.log('Processing image with Gemini...');

    // Call Gemini
    const response = await ai.models.generateContent({
      model: MODEL_ID,
      contents: [
        {
          role: 'user',
          parts: [
            { text: fullPrompt },
            { inlineData: { mimeType, data: imageBase64 } },
          ],
        },
      ],
      config: { responseModalities: ['TEXT', 'IMAGE'] },
    });

    // Extract enhanced image
    let enhancedImageData = null;
    let enhancedMimeType = 'image/png';

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

    // Return the enhanced image (saving to library is done separately via /api/save-to-library)
    res.json({
      success: true,
      image: enhancedImageData,
      mimeType: enhancedMimeType,
    });

  } catch (error) {
    console.error('Enhancement error:', error);

    if (error.message?.includes('not available in your country')) {
      return res.status(422).json({
        error: 'Image generation is not available in your region.'
      });
    }

    if (error.message?.includes('SAFETY')) {
      return res.status(422).json({
        error: 'This image could not be processed due to content restrictions.'
      });
    }

    if (error.message?.includes('Invalid file type')) {
      return res.status(400).json({ error: error.message });
    }

    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 10MB.' });
    }

    res.status(500).json({
      error: 'Something went wrong while processing your image.'
    });
  }
});

// ============================
// Save to Library (after enhancement)
// ============================

// Save an already-enhanced photo to library
app.post('/api/save-to-library', authMiddleware, upload.fields([
  { name: 'original', maxCount: 1 },
  { name: 'enhanced', maxCount: 1 }
]), async (req, res) => {
  try {
    const userId = req.user.id;

    // Get files
    const originalFile = req.files['original']?.[0];
    const enhancedFile = req.files['enhanced']?.[0];

    if (!originalFile || !enhancedFile) {
      return res.status(400).json({ error: 'Both original and enhanced images are required.' });
    }

    // Get metadata
    const title = req.body.title?.trim() || originalFile.originalname;
    const notes = req.body.notes?.trim() || null;
    const assignedDate = req.body.assignedDate || null;
    const folderId = req.body.folderId ? parseInt(req.body.folderId) : null;
    const additionalInstructions = req.body.additionalInstructions?.trim() || '';

    // Upload original to storage
    const original = await db.uploadToStorage(
      userId,
      originalFile.buffer,
      originalFile.mimetype,
      true
    );

    // Create storage object for original
    const originalStorageObject = await db.createStorageObject(userId, {
      bucket: original.bucket,
      objectKey: original.objectKey,
      checksum: db.calculateChecksum(originalFile.buffer),
      bytes: originalFile.size,
      mimeType: originalFile.mimetype,
    });

    // Create photo with metadata
    const photo = await db.createPhoto(userId, {
      title,
      folderId,
      description: notes,
      capturedDate: assignedDate,
    });

    // Update assigned_date if provided
    if (assignedDate) {
      await db.updatePhoto(photo.id, userId, { assigned_date: assignedDate });
    }

    // Create original version
    const originalVersion = await db.createPhotoVersion(userId, {
      photoId: photo.id,
      storageObjectId: originalStorageObject.id,
      isOriginal: true,
      label: 'Original',
    });

    // Upload enhanced to storage
    const enhanced = await db.uploadToStorage(
      userId,
      enhancedFile.buffer,
      enhancedFile.mimetype,
      false
    );

    // Create storage object for enhanced
    const enhancedStorageObject = await db.createStorageObject(userId, {
      bucket: enhanced.bucket,
      objectKey: enhanced.objectKey,
      checksum: db.calculateChecksum(enhancedFile.buffer),
      bytes: enhancedFile.size,
      mimeType: enhancedFile.mimetype,
    });

    // Create enhanced version
    const enhancedVersion = await db.createPhotoVersion(userId, {
      photoId: photo.id,
      storageObjectId: enhancedStorageObject.id,
      isOriginal: false,
      parentVersionId: originalVersion.id,
      label: 'Enhanced v1',
      notes,
    });

    // Create enhancement job record (already completed)
    const job = await db.createEnhancementJob(userId, {
      photoId: photo.id,
      inputVersionId: originalVersion.id,
      modelName: 'gemini',
      modelVersion: MODEL_ID,
      parameters: { additionalInstructions },
    });

    await db.startEnhancementJob(job.id, userId);
    await db.completeEnhancementJob(job.id, userId, enhancedVersion.id);

    // Add comment with notes if provided
    if (notes) {
      await db.createComment(userId, {
        photoId: photo.id,
        versionId: enhancedVersion.id,
        body: notes,
      });
    }

    res.json({
      success: true,
      photoId: photo.id,
      jobId: job.id,
    });

  } catch (error) {
    console.error('Save to library error:', error);
    res.status(500).json({ error: 'Failed to save to library.' });
  }
});

// ============================
// Photos API
// ============================

// Get user's photos
app.get('/api/photos', authMiddleware, async (req, res) => {
  try {
    const { folderId, limit, offset, favorites } = req.query;
    const result = await db.getUserPhotos(req.user.id, {
      folderId: folderId === 'null' ? null : (folderId ? parseInt(folderId) : undefined),
      limit: limit ? parseInt(limit) : 50,
      offset: offset ? parseInt(offset) : 0,
      favorites: favorites === 'true',
    });

    // Add signed URLs to versions
    for (const photo of result.photos) {
      for (const version of photo.versions || []) {
        if (version.storage) {
          version.signedUrl = await db.getSignedUrl(
            version.storage.bucket,
            version.storage.object_key
          );
        }
      }
    }

    res.json(result);
  } catch (error) {
    console.error('Get photos error:', error);
    res.status(500).json({ error: 'Failed to get photos.' });
  }
});

// Get single photo with all versions
app.get('/api/photos/:photoId', authMiddleware, async (req, res) => {
  try {
    const photo = await db.getPhoto(parseInt(req.params.photoId), req.user.id);
    if (!photo) {
      return res.status(404).json({ error: 'Photo not found.' });
    }

    // Add signed URLs
    for (const version of photo.versions || []) {
      if (version.storage) {
        version.signedUrl = await db.getSignedUrl(
          version.storage.bucket,
          version.storage.object_key
        );
      }
    }

    res.json(photo);
  } catch (error) {
    console.error('Get photo error:', error);
    res.status(500).json({ error: 'Failed to get photo.' });
  }
});

// Update photo
app.patch('/api/photos/:photoId', authMiddleware, async (req, res) => {
  try {
    const { title, description, folderId, favorite, rating, assignedDate } = req.body;
    const photo = await db.updatePhoto(parseInt(req.params.photoId), req.user.id, {
      ...(title !== undefined && { title }),
      ...(description !== undefined && { description }),
      ...(folderId !== undefined && { folder_id: folderId }),
      ...(favorite !== undefined && { favorite }),
      ...(rating !== undefined && { rating }),
      ...(assignedDate !== undefined && { assigned_date: assignedDate }),
    });
    res.json(photo);
  } catch (error) {
    console.error('Update photo error:', error);
    res.status(500).json({ error: 'Failed to update photo.' });
  }
});

// Delete photo (soft delete)
app.delete('/api/photos/:photoId', authMiddleware, async (req, res) => {
  try {
    await db.softDeletePhoto(parseInt(req.params.photoId), req.user.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete photo error:', error);
    res.status(500).json({ error: 'Failed to delete photo.' });
  }
});

// ============================
// Folders API
// ============================

app.get('/api/folders', authMiddleware, async (req, res) => {
  try {
    const { parentId, all } = req.query;

    // If 'all' is true, return all folders (for dropdowns)
    if (all === 'true') {
      const folders = await db.getAllUserFolders(req.user.id);
      res.json(folders);
    } else {
      const folders = await db.getUserFolders(
        req.user.id,
        parentId === 'null' ? null : (parentId ? parseInt(parentId) : null)
      );
      res.json(folders);
    }
  } catch (error) {
    console.error('Get folders error:', error);
    res.status(500).json({ error: 'Failed to get folders.' });
  }
});

app.post('/api/folders', authMiddleware, async (req, res) => {
  try {
    const { name, parentId } = req.body;
    const folder = await db.createFolder(req.user.id, {
      name,
      parentId: parentId ? parseInt(parentId) : null,
    });
    res.json(folder);
  } catch (error) {
    console.error('Create folder error:', error);
    res.status(500).json({ error: 'Failed to create folder.' });
  }
});

app.patch('/api/folders/:folderId', authMiddleware, async (req, res) => {
  try {
    const { name, parentId, sortOrder } = req.body;
    const folder = await db.updateFolder(parseInt(req.params.folderId), req.user.id, {
      ...(name !== undefined && { name }),
      ...(parentId !== undefined && { parent_id: parentId }),
      ...(sortOrder !== undefined && { sort_order: sortOrder }),
    });
    res.json(folder);
  } catch (error) {
    console.error('Update folder error:', error);
    res.status(500).json({ error: 'Failed to update folder.' });
  }
});

app.delete('/api/folders/:folderId', authMiddleware, async (req, res) => {
  try {
    await db.softDeleteFolder(parseInt(req.params.folderId), req.user.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete folder error:', error);
    res.status(500).json({ error: 'Failed to delete folder.' });
  }
});

// ============================
// Jobs API
// ============================

app.get('/api/jobs', authMiddleware, async (req, res) => {
  try {
    const { status, limit, offset } = req.query;
    const result = await db.getUserJobs(req.user.id, {
      status,
      limit: limit ? parseInt(limit) : 20,
      offset: offset ? parseInt(offset) : 0,
    });

    // Add signed URLs
    for (const job of result.jobs) {
      if (job.input_version?.storage) {
        job.input_version.signedUrl = await db.getSignedUrl(
          job.input_version.storage.bucket,
          job.input_version.storage.object_key
        );
      }
      if (job.output_version?.storage) {
        job.output_version.signedUrl = await db.getSignedUrl(
          job.output_version.storage.bucket,
          job.output_version.storage.object_key
        );
      }
    }

    res.json(result);
  } catch (error) {
    console.error('Get jobs error:', error);
    res.status(500).json({ error: 'Failed to get jobs.' });
  }
});

// ============================
// Tags API
// ============================

app.get('/api/tags', authMiddleware, async (req, res) => {
  try {
    const tags = await db.getUserTags(req.user.id);
    res.json(tags);
  } catch (error) {
    console.error('Get tags error:', error);
    res.status(500).json({ error: 'Failed to get tags.' });
  }
});

app.post('/api/tags', authMiddleware, async (req, res) => {
  try {
    const { name } = req.body;
    const tag = await db.createTag(req.user.id, name);
    res.json(tag);
  } catch (error) {
    console.error('Create tag error:', error);
    res.status(500).json({ error: 'Failed to create tag.' });
  }
});

app.post('/api/photos/:photoId/tags/:tagId', authMiddleware, async (req, res) => {
  try {
    await db.addTagToPhoto(parseInt(req.params.photoId), parseInt(req.params.tagId));
    res.json({ success: true });
  } catch (error) {
    console.error('Add tag error:', error);
    res.status(500).json({ error: 'Failed to add tag.' });
  }
});

app.delete('/api/photos/:photoId/tags/:tagId', authMiddleware, async (req, res) => {
  try {
    await db.removeTagFromPhoto(parseInt(req.params.photoId), parseInt(req.params.tagId));
    res.json({ success: true });
  } catch (error) {
    console.error('Remove tag error:', error);
    res.status(500).json({ error: 'Failed to remove tag.' });
  }
});

// ============================
// Comments API
// ============================

app.get('/api/photos/:photoId/comments', authMiddleware, async (req, res) => {
  try {
    const comments = await db.getPhotoComments(parseInt(req.params.photoId));
    res.json(comments);
  } catch (error) {
    console.error('Get comments error:', error);
    res.status(500).json({ error: 'Failed to get comments.' });
  }
});

app.post('/api/photos/:photoId/comments', authMiddleware, async (req, res) => {
  try {
    const { body, versionId } = req.body;
    const comment = await db.createComment(req.user.id, {
      photoId: parseInt(req.params.photoId),
      versionId: versionId ? parseInt(versionId) : null,
      body,
    });
    res.json(comment);
  } catch (error) {
    console.error('Create comment error:', error);
    res.status(500).json({ error: 'Failed to create comment.' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Get current user (protected)
app.get('/api/me', authMiddleware, (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
    }
  });
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
