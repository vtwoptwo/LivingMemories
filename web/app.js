// API endpoint - adjust if your server is hosted elsewhere
const API_URL = "http://localhost:5050";

// DOM Elements
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const previewContainer = document.getElementById("previewContainer");
const previewImage = document.getElementById("previewImage");
const removeBtn = document.getElementById("removeBtn");
const userPromptInput = document.getElementById("userPrompt");
const enhanceBtn = document.getElementById("enhanceBtn");
const resultSection = document.getElementById("resultSection");
const originalThumb = document.getElementById("originalThumb");
const resultImage = document.getElementById("resultImage");
const downloadBtn = document.getElementById("downloadBtn");
const errorSection = document.getElementById("errorSection");
const errorMessage = document.getElementById("errorMessage");

// State
let selectedFile = null;

// Dropzone click to trigger file input
dropzone.addEventListener("click", () => fileInput.click());

// File input change handler
fileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) handleFile(file);
});

// Drag and drop handlers
dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("dragover");
});

dropzone.addEventListener("dragleave", () => {
  dropzone.classList.remove("dragover");
});

dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("dragover");
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith("image/")) {
    handleFile(file);
  }
});

// Handle selected file
function handleFile(file) {
  selectedFile = file;

  // Show preview
  const reader = new FileReader();
  reader.onload = (e) => {
    previewImage.src = e.target.result;
    dropzone.hidden = true;
    previewContainer.hidden = false;
    enhanceBtn.disabled = false;
  };
  reader.readAsDataURL(file);

  // Clear previous results
  hideResults();
  hideError();
}

// Remove selected file
removeBtn.addEventListener("click", () => {
  selectedFile = null;
  fileInput.value = "";
  previewImage.src = "";
  dropzone.hidden = false;
  previewContainer.hidden = true;
  enhanceBtn.disabled = true;
  hideResults();
  hideError();
});

// Enhance button click handler
enhanceBtn.addEventListener("click", async () => {
  if (!selectedFile) return;

  setLoading(true);
  hideError();
  hideResults();

  try {
    const formData = new FormData();
    formData.append("photo", selectedFile);
    formData.append("userPrompt", userPromptInput.value.trim());

    const response = await fetch(`${API_URL}/api/enhance`, {
      method: "POST",
      body: formData,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Enhancement failed");
    }

    // Display results
    const enhancedDataUrl = `data:${data.mimeType};base64,${data.base64}`;
    originalThumb.src = previewImage.src;
    resultImage.src = enhancedDataUrl;
    downloadBtn.href = enhancedDataUrl;

    // Set proper filename extension based on mime type
    const ext = data.mimeType.split("/")[1] || "png";
    downloadBtn.download = `enhanced-photo.${ext}`;

    resultSection.hidden = false;
  } catch (err) {
    showError(err.message);
  } finally {
    setLoading(false);
  }
});

// UI Helpers
function setLoading(loading) {
  enhanceBtn.classList.toggle("loading", loading);
  enhanceBtn.disabled = loading;
  enhanceBtn.querySelector(".btn-text").hidden = loading;
  enhanceBtn.querySelector(".btn-loading").hidden = !loading;
}

function showError(message) {
  errorMessage.textContent = message;
  errorSection.hidden = false;
}

function hideError() {
  errorSection.hidden = true;
}

function hideResults() {
  resultSection.hidden = true;
}
