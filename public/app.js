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

// State
let selectedFile = null;
let enhancedImageData = null;
let enhancedMimeType = null;

// Constants
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Initialize
function init() {
  setupDragAndDrop();
  setupFileInput();
  setupButtons();
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

  // Validate file type
  if (!ALLOWED_TYPES.includes(file.type)) {
    showError('Please select a valid image file (JPEG, PNG, or WebP).');
    return;
  }

  // Validate file size
  if (file.size > MAX_FILE_SIZE) {
    showError('File is too large. Maximum size is 10MB.');
    return;
  }

  selectedFile = file;
  showPreview();
}

function showPreview() {
  // Create object URL for preview
  const objectUrl = URL.createObjectURL(selectedFile);
  originalPreview.src = objectUrl;

  // Clean up old object URL when image loads
  originalPreview.onload = () => {
    // Revoke will happen on clear/replace
  };

  // Show preview section, hide upload
  uploadSection.classList.add('hidden');
  previewSection.classList.remove('hidden');
  optionsSection.classList.remove('hidden');

  // Reset result state
  resultCard.classList.add('hidden');
  downloadSection.classList.add('hidden');
  enhancedImageData = null;
  enhancedMimeType = null;

  // Reset enhance button
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

// Enhance
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

    const response = await fetch('/api/enhance', {
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

    // Display result
    resultPreview.src = `data:${enhancedMimeType};base64,${enhancedImageData}`;
    resultCard.classList.remove('hidden');
    downloadSection.classList.remove('hidden');

  } catch (error) {
    console.error('Enhancement error:', error);
    showError(error.message || 'Something went wrong. Please try again.');
  } finally {
    setLoadingState(false);
  }
}

function setLoadingState(loading) {
  const btnText = enhanceBtn.querySelector('.btn-text');
  const btnLoading = enhanceBtn.querySelector('.btn-loading');

  if (loading) {
    enhanceBtn.disabled = true;
    btnText.classList.add('hidden');
    btnLoading.classList.remove('hidden');
    resultCard.classList.add('loading');
    resultCard.classList.remove('hidden');
  } else {
    enhanceBtn.disabled = false;
    btnText.classList.remove('hidden');
    btnLoading.classList.add('hidden');
    resultCard.classList.remove('loading');
  }
}

function resetEnhanceButton() {
  const btnText = enhanceBtn.querySelector('.btn-text');
  const btnLoading = enhanceBtn.querySelector('.btn-loading');
  enhanceBtn.disabled = false;
  btnText.classList.remove('hidden');
  btnLoading.classList.add('hidden');
}

// Replace
function handleReplace() {
  fileInput.click();
}

// Clear
function handleClear() {
  // Revoke object URL
  if (originalPreview.src.startsWith('blob:')) {
    URL.revokeObjectURL(originalPreview.src);
  }

  // Reset state
  selectedFile = null;
  enhancedImageData = null;
  enhancedMimeType = null;
  originalPreview.src = '';
  resultPreview.src = '';
  additionalInstructions.value = '';
  fileInput.value = '';

  // Reset UI
  uploadSection.classList.remove('hidden');
  previewSection.classList.add('hidden');
  optionsSection.classList.add('hidden');
  downloadSection.classList.add('hidden');
  resultCard.classList.add('hidden');
  hideError();
  resetEnhanceButton();
}

// Download
function handleDownload() {
  if (!enhancedImageData || !enhancedMimeType) return;

  // Create download link
  const link = document.createElement('a');
  link.href = `data:${enhancedMimeType};base64,${enhancedImageData}`;

  // Generate filename
  const extension = enhancedMimeType.split('/')[1] || 'png';
  const originalName = selectedFile?.name || 'photo';
  const baseName = originalName.replace(/\.[^/.]+$/, '');
  link.download = `${baseName}-restored.${extension}`;

  // Trigger download
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Restore Again
function handleRestoreAgain() {
  // Hide result and download
  resultCard.classList.add('hidden');
  downloadSection.classList.add('hidden');
  enhancedImageData = null;
  enhancedMimeType = null;
  resultPreview.src = '';

  // Focus on instructions for potential adjustment
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
