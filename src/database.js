import { supabase } from './supabase.js';
import crypto from 'crypto';

// ============================
// Storage Operations
// ============================

export async function uploadToStorage(userId, fileBuffer, mimeType, isOriginal = true) {
  const ext = mimeType.split('/')[1] || 'jpg';
  const filename = `${crypto.randomUUID()}.${ext}`;
  const objectKey = `${userId}/${isOriginal ? 'originals' : 'enhanced'}/${filename}`;

  const { data, error } = await supabase.storage
    .from('photos')
    .upload(objectKey, fileBuffer, {
      contentType: mimeType,
      upsert: false,
    });

  if (error) throw error;

  return {
    bucket: 'photos',
    objectKey,
    path: data.path,
  };
}

export async function getSignedUrl(bucket, objectKey, expiresIn = 3600) {
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(objectKey, expiresIn);

  if (error) throw error;
  return data.signedUrl;
}

export async function deleteFromStorage(bucket, objectKey) {
  const { error } = await supabase.storage
    .from(bucket)
    .remove([objectKey]);

  if (error) throw error;
}

// ============================
// Storage Objects (DB records)
// ============================

export async function createStorageObject(userId, { bucket, objectKey, checksum, bytes, mimeType, width, height }) {
  const { data, error } = await supabase
    .from('storage_objects')
    .insert({
      user_id: userId,
      bucket,
      object_key: objectKey,
      checksum_sha256: checksum,
      bytes,
      mime_type: mimeType,
      width,
      height,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ============================
// Photos
// ============================

export async function createPhoto(userId, { folderId, title, description, capturedDate }) {
  const { data, error } = await supabase
    .from('photos')
    .insert({
      user_id: userId,
      folder_id: folderId || null,
      title,
      description,
      captured_date: capturedDate,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getPhoto(photoId, userId) {
  const { data, error } = await supabase
    .from('photos')
    .select(`
      *,
      folder:folders!photos_folder_id_fkey(id, name),
      versions:photo_versions(
        *,
        storage:storage_objects(*)
      ),
      jobs:enhancement_jobs(*)
    `)
    .eq('id', photoId)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .single();

  if (error) throw error;
  return data;
}

export async function getUserPhotos(userId, { folderId, limit = 50, offset = 0, favorites = false } = {}) {
  let query = supabase
    .from('photos')
    .select(`
      *,
      folder:folders!photos_folder_id_fkey(id, name),
      versions:photo_versions(
        *,
        storage:storage_objects(*)
      )
    `, { count: 'exact' })
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (folderId !== undefined) {
    if (folderId === null) {
      query = query.is('folder_id', null);
    } else {
      query = query.eq('folder_id', folderId);
    }
  }

  if (favorites) {
    query = query.eq('favorite', true);
  }

  const { data, error, count } = await query;

  if (error) throw error;
  return { photos: data, total: count };
}

export async function updatePhoto(photoId, userId, updates) {
  const { data, error } = await supabase
    .from('photos')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', photoId)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function softDeletePhoto(photoId, userId) {
  return updatePhoto(photoId, userId, { deleted_at: new Date().toISOString() });
}

// ============================
// Photo Versions
// ============================

export async function createPhotoVersion(userId, { photoId, storageObjectId, isOriginal, parentVersionId, label, notes }) {
  const { data, error } = await supabase
    .from('photo_versions')
    .insert({
      user_id: userId,
      photo_id: photoId,
      storage_object_id: storageObjectId,
      is_original: isOriginal || false,
      parent_version_id: parentVersionId || null,
      label,
      notes,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getPhotoVersions(photoId, userId) {
  const { data, error } = await supabase
    .from('photo_versions')
    .select(`
      *,
      storage:storage_objects(*)
    `)
    .eq('photo_id', photoId)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data;
}

// ============================
// Enhancement Jobs
// ============================

export async function createEnhancementJob(userId, { photoId, inputVersionId, modelName, modelVersion, parameters }) {
  const { data, error } = await supabase
    .from('enhancement_jobs')
    .insert({
      user_id: userId,
      photo_id: photoId,
      input_version_id: inputVersionId,
      status: 'queued',
      model_name: modelName,
      model_version: modelVersion,
      parameters: parameters || {},
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateEnhancementJob(jobId, userId, updates) {
  const { data, error } = await supabase
    .from('enhancement_jobs')
    .update(updates)
    .eq('id', jobId)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function startEnhancementJob(jobId, userId) {
  return updateEnhancementJob(jobId, userId, {
    status: 'running',
    started_at: new Date().toISOString(),
  });
}

export async function completeEnhancementJob(jobId, userId, outputVersionId) {
  return updateEnhancementJob(jobId, userId, {
    status: 'succeeded',
    output_version_id: outputVersionId,
    finished_at: new Date().toISOString(),
  });
}

export async function failEnhancementJob(jobId, userId, errorMessage) {
  return updateEnhancementJob(jobId, userId, {
    status: 'failed',
    error_message: errorMessage,
    finished_at: new Date().toISOString(),
  });
}

export async function getUserJobs(userId, { status, limit = 20, offset = 0 } = {}) {
  let query = supabase
    .from('enhancement_jobs')
    .select(`
      *,
      photo:photos(id, title),
      input_version:photo_versions!input_version_id(
        *,
        storage:storage_objects(*)
      ),
      output_version:photo_versions!output_version_id(
        *,
        storage:storage_objects(*)
      )
    `, { count: 'exact' })
    .eq('user_id', userId)
    .order('queued_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error, count } = await query;

  if (error) throw error;
  return { jobs: data, total: count };
}

// ============================
// Folders
// ============================

export async function createFolder(userId, { parentId, name }) {
  const { data, error } = await supabase
    .from('folders')
    .insert({
      user_id: userId,
      parent_id: parentId || null,
      name,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getUserFolders(userId, parentId = null) {
  let query = supabase
    .from('folders')
    .select('*')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (parentId === null) {
    query = query.is('parent_id', null);
  } else {
    query = query.eq('parent_id', parentId);
  }

  const { data, error } = await query;

  if (error) throw error;
  return data;
}

export async function getAllUserFolders(userId) {
  const { data, error } = await supabase
    .from('folders')
    .select('*')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) throw error;
  return data;
}

export async function updateFolder(folderId, userId, updates) {
  const { data, error } = await supabase
    .from('folders')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', folderId)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function softDeleteFolder(folderId, userId) {
  return updateFolder(folderId, userId, { deleted_at: new Date().toISOString() });
}

// ============================
// Tags
// ============================

export async function createTag(userId, name) {
  const { data, error } = await supabase
    .from('tags')
    .insert({ user_id: userId, name })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getUserTags(userId) {
  const { data, error } = await supabase
    .from('tags')
    .select('*')
    .eq('user_id', userId)
    .order('name', { ascending: true });

  if (error) throw error;
  return data;
}

export async function addTagToPhoto(photoId, tagId) {
  const { error } = await supabase
    .from('photo_tags')
    .insert({ photo_id: photoId, tag_id: tagId });

  if (error && error.code !== '23505') throw error; // ignore duplicate
}

export async function removeTagFromPhoto(photoId, tagId) {
  const { error } = await supabase
    .from('photo_tags')
    .delete()
    .eq('photo_id', photoId)
    .eq('tag_id', tagId);

  if (error) throw error;
}

// ============================
// Comments
// ============================

export async function createComment(userId, { photoId, versionId, body }) {
  const { data, error } = await supabase
    .from('comments')
    .insert({
      user_id: userId,
      photo_id: photoId,
      version_id: versionId || null,
      body,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getPhotoComments(photoId) {
  const { data, error } = await supabase
    .from('comments')
    .select('*')
    .eq('photo_id', photoId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data;
}

// ============================
// Profiles
// ============================

export async function getOrCreateProfile(userId) {
  // Try to get existing profile
  let { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error && error.code === 'PGRST116') {
    // Profile doesn't exist, create it
    const { data: newProfile, error: createError } = await supabase
      .from('profiles')
      .insert({ id: userId })
      .select()
      .single();

    if (createError) throw createError;
    return newProfile;
  }

  if (error) throw error;
  return data;
}

export async function updateProfile(userId, updates) {
  const { data, error } = await supabase
    .from('profiles')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ============================
// Utility: Calculate SHA256 checksum
// ============================

export function calculateChecksum(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}
