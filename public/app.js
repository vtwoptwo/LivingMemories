// DOM Elements
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const uploadSection = document.getElementById('uploadSection');
const previewSection = document.getElementById('previewSection');
const optionsSection = document.getElementById('optionsSection');
const downloadSection = document.getElementById('downloadSection');
const originalPreview = document.getElementById('originalPreview');
const resultPreview = document.getElementById('resultPreview');
const resultCard = document.getElementById('resultCard');
const additionalInstructions = document.getElementById('additionalInstructions');
const enhanceBtn = document.getElementById('enhanceBtn');
const replaceBtn = document.getElementById('replaceBtn');
const clearBtn = document.getElementById('clearBtn');
const downloadBtn = document.getElementById('downloadBtn');
const restoreAgainBtn = document.getElementById('restoreAgainBtn');
const errorMessage = document.getElementById('errorMessage');

// Save to Library elements
const saveToLibraryBtn = document.getElementById('saveToLibraryBtn');
const savedConfirmation = document.getElementById('savedConfirmation');
const photoTitleInput = document.getElementById('photoTitle');
const photoDateInput = document.getElementById('photoDate');
const photoFolderSelect = document.getElementById('photoFolder');
const photoNotesInput = document.getElementById('photoNotes');
const saveLibraryForm = document.querySelector('.save-library-form');

// State
let selectedFile = null;
let enhancedImageData = null;
let enhancedMimeType = null;
let isSavedToLibrary = false;
let loadingStageInterval = null;

// Enhancement options state
let enhancementOptions = {
  colorize: false,
  modernize: false,
  digitize: false,
};

// Loading stage messages
const loadingStages = [
  'Analyzing photo...',
  'Detecting damage...',
  'Preserving faces...',
  'Removing scratches...',
  'Restoring colors...',
  'Enhancing details...',
  'Finalizing restoration...'
];

// Constants
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Initialize
function init() {
  setupDragAndDrop();
  setupFileInput();
  setupButtons();
  setupEnhancementOptions();
  setupSaveToLibrary();
  loadFolders();
}

// Setup Enhancement Option Toggles
function setupEnhancementOptions() {
  const toggleButtons = document.querySelectorAll('.option-toggle');

  toggleButtons.forEach(button => {
    button.addEventListener('click', () => {
      const option = button.dataset.option;
      if (option && enhancementOptions.hasOwnProperty(option)) {
        enhancementOptions[option] = !enhancementOptions[option];
        button.classList.toggle('active', enhancementOptions[option]);
      }
    });
  });
}

function resetEnhancementOptions() {
  enhancementOptions = {
    colorize: false,
    modernize: false,
    digitize: false,
  };

  document.querySelectorAll('.option-toggle').forEach(button => {
    button.classList.remove('active');
  });
}

// Load folders for the dropdown
async function loadFolders() {
  try {
    const response = await Auth.authFetch('/api/folders?all=true');
    if (response.ok) {
      const folders = await response.json();
      const folderTree = buildFolderTree(folders);
      renderFolderOptions(folderTree);
    }
  } catch (error) {
    console.error('Failed to load folders:', error);
  }
}

// Build tree structure from flat list
function buildFolderTree(flatFolders) {
  const map = {};
  const roots = [];

  flatFolders.forEach(folder => {
    map[folder.id] = { ...folder, children: [] };
  });

  flatFolders.forEach(folder => {
    if (folder.parent_id && map[folder.parent_id]) {
      map[folder.parent_id].children.push(map[folder.id]);
    } else {
      roots.push(map[folder.id]);
    }
  });

  return roots;
}

function renderFolderOptions(folderTree) {
  photoFolderSelect.innerHTML = '<option value="">No folder</option>';

  function addOptions(folders, depth = 0) {
    folders.forEach(folder => {
      const option = document.createElement('option');
      option.value = folder.id;
      option.textContent = '  '.repeat(depth) + (depth > 0 ? '└ ' : '') + folder.name;
      photoFolderSelect.appendChild(option);

      if (folder.children && folder.children.length > 0) {
        addOptions(folder.children, depth + 1);
      }
    });
  }

  addOptions(folderTree);
}

// Drag and Drop
function setupDragAndDrop() {
  dropZone.addEventListener('dragover', handleDragOver);
  dropZone.addEventListener('dragleave', handleDragLeave);
  dropZone.addEventListener('drop', handleDrop);
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });
}

function handleDragOver(e) {
  e.preventDefault();
  e.stopPropagation();
  dropZone.classList.add('drag-over');
}

function handleDragLeave(e) {
  e.preventDefault();
  e.stopPropagation();
  dropZone.classList.remove('drag-over');
}

function handleDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  dropZone.classList.remove('drag-over');

  const files = e.dataTransfer.files;
  if (files.length > 0) {
    handleFile(files[0]);
  }
}

// File Input
function setupFileInput() {
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFile(e.target.files[0]);
    }
  });
}

// File Handling
function handleFile(file) {
  hideError();

  if (!ALLOWED_TYPES.includes(file.type)) {
    showError('Please select a valid image file (JPEG, PNG, or WebP).');
    return;
  }

  if (file.size > MAX_FILE_SIZE) {
    showError('File is too large. Maximum size is 10MB.');
    return;
  }

  selectedFile = file;

  // Auto-fill title from filename
  const baseName = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
  photoTitleInput.value = baseName;

  showPreview();
}

function showPreview() {
  const objectUrl = URL.createObjectURL(selectedFile);
  originalPreview.src = objectUrl;

  uploadSection.classList.add('hidden');
  previewSection.classList.remove('hidden');
  optionsSection.classList.remove('hidden');

  // Reset result state
  resultCard.classList.add('hidden');
  downloadSection.classList.add('hidden');
  enhancedImageData = null;
  enhancedMimeType = null;
  isSavedToLibrary = false;

  resetEnhanceButton();
}

// Button Setup
function setupButtons() {
  enhanceBtn.addEventListener('click', handleEnhance);
  replaceBtn.addEventListener('click', handleReplace);
  clearBtn.addEventListener('click', handleClear);
  downloadBtn.addEventListener('click', handleDownload);
  restoreAgainBtn.addEventListener('click', handleRestoreAgain);
}

// Save to Library Setup
function setupSaveToLibrary() {
  saveToLibraryBtn.addEventListener('click', handleSaveToLibrary);
}

// Enhance - just process, don't save
async function handleEnhance() {
  if (!selectedFile) return;

  hideError();
  setLoadingState(true);

  try {
    const formData = new FormData();
    formData.append('image', selectedFile);

    const instructions = additionalInstructions.value.trim();
    if (instructions) {
      formData.append('additionalInstructions', instructions);
    }

    // Add enhancement options
    formData.append('colorize', enhancementOptions.colorize);
    formData.append('modernize', enhancementOptions.modernize);
    formData.append('digitize', enhancementOptions.digitize);

    const response = await Auth.authFetch('/api/enhance', {
      method: 'POST',
      body: formData,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to enhance image');
    }

    if (!data.success || !data.image) {
      throw new Error(data.error || 'No image returned from server');
    }

    // Store result
    enhancedImageData = data.image;
    enhancedMimeType = data.mimeType || 'image/png';
    isSavedToLibrary = false;

    // Display result
    resultPreview.src = `data:${enhancedMimeType};base64,${enhancedImageData}`;
    resultCard.classList.remove('hidden');
    downloadSection.classList.remove('hidden');

    // Reset save form state
    resetSaveForm();

  } catch (error) {
    console.error('Enhancement error:', error);
    showError(error.message || 'Something went wrong. Please try again.');
  } finally {
    setLoadingState(false);
  }
}

// Save to Library - after enhancement
async function handleSaveToLibrary() {
  if (!selectedFile || !enhancedImageData || isSavedToLibrary) return;

  setSaveLoadingState(true);

  try {
    // Convert base64 enhanced image to blob
    const enhancedBlob = base64ToBlob(enhancedImageData, enhancedMimeType);

    const formData = new FormData();
    formData.append('original', selectedFile);
    formData.append('enhanced', enhancedBlob, 'enhanced.' + (enhancedMimeType.split('/')[1] || 'png'));

    // Add metadata
    const title = photoTitleInput.value.trim();
    const photoDate = photoDateInput.value;
    const folderId = photoFolderSelect.value;
    const notes = photoNotesInput.value.trim();
    const instructions = additionalInstructions.value.trim();

    if (title) formData.append('title', title);
    if (photoDate) formData.append('assignedDate', photoDate);
    if (folderId) formData.append('folderId', folderId);
    if (notes) formData.append('notes', notes);
    if (instructions) formData.append('additionalInstructions', instructions);

    const response = await Auth.authFetch('/api/save-to-library', {
      method: 'POST',
      body: formData,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to save to library');
    }

    // Show success
    isSavedToLibrary = true;
    savedConfirmation.classList.remove('hidden');
    saveLibraryForm.classList.add('saved');

  } catch (error) {
    console.error('Save to library error:', error);
    showError(error.message || 'Failed to save to library. Please try again.');
  } finally {
    setSaveLoadingState(false);
  }
}

// Convert base64 to Blob
function base64ToBlob(base64, mimeType) {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}

function setLoadingState(loading) {
  const btnText = enhanceBtn.querySelector('.btn-text');
  const btnLoading = enhanceBtn.querySelector('.btn-loading');
  const loadingOverlay = document.getElementById('loadingOverlay');
  const loadingStage = document.getElementById('loadingStage');

  if (loading) {
    enhanceBtn.disabled = true;
    btnText.classList.add('hidden');
    btnLoading.classList.remove('hidden');
    resultCard.classList.add('loading');
    resultCard.classList.remove('hidden');

    // Show loading overlay
    loadingOverlay.classList.remove('hidden');
    loadingStage.textContent = loadingStages[0];

    // Cycle through loading stages
    let stageIndex = 0;
    loadingStageInterval = setInterval(() => {
      stageIndex = (stageIndex + 1) % loadingStages.length;
      loadingStage.textContent = loadingStages[stageIndex];
    }, 3000);
  } else {
    enhanceBtn.disabled = false;
    btnText.classList.remove('hidden');
    btnLoading.classList.add('hidden');
    resultCard.classList.remove('loading');

    // Hide loading overlay
    loadingOverlay.classList.add('hidden');

    // Stop cycling stages
    if (loadingStageInterval) {
      clearInterval(loadingStageInterval);
      loadingStageInterval = null;
    }
  }
}

function setSaveLoadingState(loading) {
  const btnText = saveToLibraryBtn.querySelector('.btn-text');
  const btnLoading = saveToLibraryBtn.querySelector('.btn-loading');

  if (loading) {
    saveToLibraryBtn.disabled = true;
    btnText.classList.add('hidden');
    btnLoading.classList.remove('hidden');
  } else {
    saveToLibraryBtn.disabled = false;
    btnText.classList.remove('hidden');
    btnLoading.classList.add('hidden');
  }
}

function resetEnhanceButton() {
  const btnText = enhanceBtn.querySelector('.btn-text');
  const btnLoading = enhanceBtn.querySelector('.btn-loading');
  enhanceBtn.disabled = false;
  btnText.classList.remove('hidden');
  btnLoading.classList.add('hidden');
}

function resetSaveForm() {
  savedConfirmation.classList.add('hidden');
  saveLibraryForm.classList.remove('saved');
  setSaveLoadingState(false);
}

// Replace
function handleReplace() {
  fileInput.click();
}

// Clear
function handleClear() {
  if (originalPreview.src.startsWith('blob:')) {
    URL.revokeObjectURL(originalPreview.src);
  }

  selectedFile = null;
  enhancedImageData = null;
  enhancedMimeType = null;
  isSavedToLibrary = false;
  originalPreview.src = '';
  resultPreview.src = '';

  // Reset form fields
  additionalInstructions.value = '';
  photoTitleInput.value = '';
  photoDateInput.value = '';
  photoFolderSelect.value = '';
  photoNotesInput.value = '';
  fileInput.value = '';

  // Reset UI
  uploadSection.classList.remove('hidden');
  previewSection.classList.add('hidden');
  optionsSection.classList.add('hidden');
  downloadSection.classList.add('hidden');
  resultCard.classList.add('hidden');
  hideError();
  resetEnhanceButton();
  resetSaveForm();
  resetEnhancementOptions();
}

// Download
function handleDownload() {
  if (!enhancedImageData || !enhancedMimeType) return;

  const link = document.createElement('a');
  link.href = `data:${enhancedMimeType};base64,${enhancedImageData}`;

  const extension = enhancedMimeType.split('/')[1] || 'png';
  const title = photoTitleInput.value.trim();
  const originalName = title || selectedFile?.name || 'photo';
  const baseName = originalName.replace(/\.[^/.]+$/, '');
  link.download = `${baseName}-restored.${extension}`;

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Restore Again
function handleRestoreAgain() {
  resultCard.classList.add('hidden');
  downloadSection.classList.add('hidden');
  enhancedImageData = null;
  enhancedMimeType = null;
  isSavedToLibrary = false;
  resultPreview.src = '';
  resetSaveForm();
  additionalInstructions.focus();
}

// Error Handling
function showError(message) {
  errorMessage.textContent = message;
  errorMessage.classList.remove('hidden');
}

function hideError() {
  errorMessage.classList.add('hidden');
  errorMessage.textContent = '';
}

// Initialize on load
document.addEventListener('DOMContentLoaded', init);
