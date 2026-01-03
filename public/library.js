// Library state
let currentView = 'all';
let currentFolderId = null;
let photos = [];
let folders = [];
let allFolders = [];
let jobs = [];
let currentPhoto = null;
let currentVersionIndex = 0;

// Photo Detail View state
let originalVersion = null;
let enhancedVersion = null;
let currentComparisonView = 'side-by-side';

// Image cache
const imageCache = new Map();

// DOM Elements (initialized after DOM ready)
let photoGrid, jobsView, jobsList, emptyState, loadingState, viewTitle;
let folderList, photoDetailView, folderModal, libraryHeader;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  // Initialize DOM references
  photoGrid = document.getElementById('photoGrid');
  jobsView = document.getElementById('jobsView');
  jobsList = document.getElementById('jobsList');
  emptyState = document.getElementById('emptyState');
  loadingState = document.getElementById('loadingState');
  viewTitle = document.getElementById('viewTitle');
  folderList = document.getElementById('folderList');
  photoDetailView = document.getElementById('photoDetailView');
  folderModal = document.getElementById('folderModal');
  libraryHeader = document.querySelector('.library-header');

  // Check authentication
  const isAuthenticated = await Auth.requireAuth('/login.html');
  if (!isAuthenticated) return;

  // Setup user menu
  const user = await Auth.getCurrentUser();
  if (user) {
    document.getElementById('userEmail').textContent = user.email;
    document.getElementById('userMenu').classList.remove('hidden');
  }

  // Setup logout
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await Auth.signOut();
    window.location.href = '/login.html';
  });

  // Setup sidebar navigation
  setupSidebarNav();

  // Setup modals and inline view
  setupModals();
  setupPhotoDetailView();

  // Setup view toggle
  setupViewToggle();

  // Load initial data
  await loadFolders();
  await loadPhotos();
});

// Image caching functions
async function loadCachedImage(url) {
  if (!url) return '';

  // Check memory cache first
  if (imageCache.has(url)) {
    return imageCache.get(url);
  }

  // Try to load and cache
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    imageCache.set(url, objectUrl);
    return objectUrl;
  } catch (error) {
    console.error('Image cache error:', error);
    return url; // Fallback to original URL
  }
}

function preloadImages(urls) {
  urls.forEach(url => {
    if (url && !imageCache.has(url)) {
      const img = new Image();
      img.onload = () => {
        // Image is now in browser cache
      };
      img.src = url;
    }
  });
}

// Sidebar Navigation
function setupSidebarNav() {
  document.querySelectorAll('.sidebar-btn[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      setActiveView(view);
    });
  });

  // New folder button (root level)
  document.getElementById('newFolderBtn').addEventListener('click', () => {
    const modalTitle = folderModal.querySelector('.modal-title');
    modalTitle.textContent = 'New Folder';
    document.getElementById('parentFolder').value = '';
    document.getElementById('folderName').value = '';
    folderModal.classList.remove('hidden');
    document.getElementById('folderName').focus();
  });
}

function setActiveView(view, folderId = null) {
  currentView = view;
  currentFolderId = folderId;

  // Update active button
  document.querySelectorAll('.sidebar-btn').forEach(btn => {
    btn.classList.remove('active');
  });

  if (folderId) {
    document.querySelector(`.sidebar-btn[data-folder="${folderId}"]`)?.classList.add('active');
  } else {
    document.querySelector(`.sidebar-btn[data-view="${view}"]`)?.classList.add('active');
  }

  // Update title
  const titles = {
    all: 'All Photos',
    favorites: 'Favorites',
    recent: 'Recent',
    jobs: 'Enhancement Jobs',
  };

  if (folderId) {
    const folder = folders.find(f => f.id === folderId);
    viewTitle.textContent = folder?.name || 'Folder';
  } else {
    viewTitle.textContent = titles[view] || 'All Photos';
  }

  // Load content
  if (view === 'jobs') {
    loadJobs();
  } else {
    loadPhotos();
  }
}

// Load Photos
async function loadPhotos() {
  showLoading();
  hideContent();

  try {
    const params = new URLSearchParams();

    if (currentView === 'favorites') {
      params.set('favorites', 'true');
    }

    if (currentFolderId !== null) {
      params.set('folderId', currentFolderId === null ? 'null' : currentFolderId);
    }

    const response = await Auth.authFetch(`/api/photos?${params}`);
    const data = await response.json();

    photos = data.photos || [];

    // Preload all thumbnail images
    const imageUrls = photos.flatMap(photo => {
      const versions = photo.versions || [];
      return versions.map(v => v.signedUrl).filter(Boolean);
    });
    preloadImages(imageUrls);

    hideLoading();

    if (photos.length === 0) {
      showEmpty();
    } else {
      renderPhotos();
    }
  } catch (error) {
    console.error('Load photos error:', error);
    hideLoading();
    showEmpty();
  }
}

function renderPhotos() {
  photoGrid.innerHTML = '';
  photoGrid.classList.remove('hidden');
  jobsView.classList.add('hidden');
  emptyState.classList.add('hidden');

  photos.forEach(photo => {
    const card = createPhotoCard(photo);
    photoGrid.appendChild(card);
  });
}

function createPhotoCard(photo) {
  const card = document.createElement('div');
  card.className = 'photo-card';
  card.onclick = () => openPhotoDetail(photo);

  // Get the best thumbnail (latest version or original)
  const versions = photo.versions || [];
  const latestVersion = versions.find(v => !v.is_original) || versions.find(v => v.is_original);
  const thumbnailUrl = latestVersion?.signedUrl || '';

  const versionCount = versions.filter(v => !v.is_original).length;

  card.innerHTML = `
    <div class="photo-card-image">
      <img src="${thumbnailUrl}" alt="${photo.title || 'Photo'}" loading="lazy">
      ${versionCount > 0 ? `<span class="photo-card-badge">${versionCount} version${versionCount > 1 ? 's' : ''}</span>` : ''}
      ${photo.favorite ? `
        <span class="photo-card-favorite">
          <svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
        </span>
      ` : ''}
    </div>
    <div class="photo-card-info">
      <div class="photo-card-title">${photo.title || 'Untitled'}</div>
      <div class="photo-card-date">${formatDate(photo.created_at)}</div>
    </div>
  `;

  return card;
}

// Load Jobs
async function loadJobs() {
  showLoading();
  hideContent();

  try {
    const response = await Auth.authFetch('/api/jobs');
    const data = await response.json();

    jobs = data.jobs || [];

    hideLoading();

    if (jobs.length === 0) {
      showEmpty();
    } else {
      renderJobs();
    }
  } catch (error) {
    console.error('Load jobs error:', error);
    hideLoading();
    showEmpty();
  }
}

function renderJobs() {
  jobsList.innerHTML = '';
  photoGrid.classList.add('hidden');
  jobsView.classList.remove('hidden');
  emptyState.classList.add('hidden');

  jobs.forEach(job => {
    const item = createJobItem(job);
    jobsList.appendChild(item);
  });
}

function createJobItem(job) {
  const item = document.createElement('div');
  item.className = 'job-item';

  const thumbnailUrl = job.input_version?.signedUrl || '';
  const outputUrl = job.output_version?.signedUrl || '';

  item.innerHTML = `
    <div class="job-thumbnail">
      <img src="${outputUrl || thumbnailUrl}" alt="Job thumbnail" loading="lazy">
    </div>
    <div class="job-info">
      <div class="job-title">${job.photo?.title || 'Photo'}</div>
      <div class="job-meta">
        ${job.model_name} ${job.model_version ? `(${job.model_version})` : ''} &bull; ${formatDate(job.queued_at)}
      </div>
    </div>
    <span class="job-status ${job.status}">${job.status}</span>
  `;

  return item;
}

// Load Folders
async function loadFolders() {
  try {
    const response = await Auth.authFetch('/api/folders?all=true');
    allFolders = await response.json();
    folders = buildFolderTree(allFolders);
    renderFolders();
    populateParentFolderDropdown();
  } catch (error) {
    console.error('Load folders error:', error);
  }
}

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

function populateParentFolderDropdown() {
  const select = document.getElementById('parentFolder');
  if (!select) return;

  select.innerHTML = '<option value="">None (root level)</option>';

  function addOptions(folders, depth = 0) {
    folders.forEach(folder => {
      const option = document.createElement('option');
      option.value = folder.id;
      option.textContent = '  '.repeat(depth) + (depth > 0 ? '└ ' : '') + folder.name;
      select.appendChild(option);

      if (folder.children && folder.children.length > 0) {
        addOptions(folder.children, depth + 1);
      }
    });
  }

  addOptions(folders);
}

function renderFolders() {
  folderList.innerHTML = '';
  renderFolderItems(folders, folderList, 0);
}

function renderFolderItems(folderTree, container, depth) {
  folderTree.forEach(folder => {
    const li = document.createElement('li');
    li.style.paddingLeft = depth > 0 ? `${depth * 12}px` : '0';

    li.innerHTML = `
      <div class="folder-item">
        <button class="sidebar-btn" data-folder="${folder.id}">
          <svg class="sidebar-icon folder-icon" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="0">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
          ${folder.name}
        </button>
        <button class="folder-add-btn" title="Create subfolder" data-parent-id="${folder.id}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>
      </div>
    `;

    li.querySelector('.sidebar-btn').addEventListener('click', () => {
      setActiveView('folder', folder.id);
    });

    li.querySelector('.folder-add-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openCreateSubfolderModal(folder.id, folder.name);
    });

    container.appendChild(li);

    if (folder.children && folder.children.length > 0) {
      renderFolderItems(folder.children, container, depth + 1);
    }
  });
}

function openCreateSubfolderModal(parentId, parentName) {
  const parentSelect = document.getElementById('parentFolder');
  parentSelect.value = parentId;

  const modalTitle = folderModal.querySelector('.modal-title');
  modalTitle.textContent = `New Subfolder in "${parentName}"`;

  folderModal.classList.remove('hidden');
  document.getElementById('folderName').focus();
}

// Setup inline photo detail view
function setupPhotoDetailView() {
  // Back button
  const backBtn = document.getElementById('backToGridBtn');
  if (backBtn) {
    backBtn.addEventListener('click', closePhotoDetail);
  }

  // Setup comparison toggle and actions
  setupComparisonToggle();
  setupComparisonActions();
  setupPhotoDetailButtons();

  // Setup editable fields
  setupEditableFields();
}

function openPhotoDetail(photo) {
  currentPhoto = photo;

  // Set read-only meta
  document.getElementById('photoCreated').textContent = formatDate(photo.created_at);
  document.getElementById('photoVersionCount').textContent = photo.versions?.length || 0;

  // Populate editable fields
  const titleInput = document.getElementById('editPhotoTitle');
  const dateInput = document.getElementById('editPhotoDate');
  const folderSelect = document.getElementById('editPhotoFolder');
  const notesInput = document.getElementById('editPhotoNotes');

  titleInput.value = photo.title || '';
  dateInput.value = photo.assigned_date || photo.photo_date || '';
  notesInput.value = photo.description || photo.notes || '';

  // Populate folder dropdown
  populateDetailFolderDropdown(photo.folder_id);

  // Store original values for change detection
  titleInput.dataset.original = titleInput.value;
  dateInput.dataset.original = dateInput.value;
  folderSelect.dataset.original = photo.folder_id || '';
  notesInput.dataset.original = notesInput.value;

  // Reset save button state
  const saveBtn = document.getElementById('savePhotoBtn');
  const saveStatus = document.getElementById('saveStatus');
  if (saveBtn) saveBtn.disabled = true;
  if (saveStatus) saveStatus.classList.add('hidden');

  // Find original and enhanced versions
  const versions = photo.versions || [];
  originalVersion = versions.find(v => v.is_original);
  enhancedVersion = versions.find(v => !v.is_original);

  // Set images
  const originalImg = document.getElementById('originalImage');
  const enhancedImg = document.getElementById('enhancedImage');

  if (originalVersion?.signedUrl) {
    originalImg.src = originalVersion.signedUrl;
  } else {
    originalImg.src = '';
  }

  if (enhancedVersion?.signedUrl) {
    enhancedImg.src = enhancedVersion.signedUrl;
  } else {
    enhancedImg.src = '';
  }

  // Reset to side-by-side view
  setComparisonView('side-by-side');

  // Update favorite button
  updateFavoriteButton(photo.favorite);

  // Hide grid/jobs views and header, show detail view
  photoGrid.classList.add('hidden');
  jobsView.classList.add('hidden');
  emptyState.classList.add('hidden');
  libraryHeader.classList.add('hidden');
  photoDetailView.classList.remove('hidden');
}

function closePhotoDetail() {
  photoDetailView.classList.add('hidden');
  libraryHeader.classList.remove('hidden');

  // Re-render the grid to reflect any changes made
  if (currentView === 'jobs') {
    jobsView.classList.remove('hidden');
  } else if (photos.length === 0) {
    emptyState.classList.remove('hidden');
  } else {
    renderPhotos(); // Re-render to update titles, etc.
    photoGrid.classList.remove('hidden');
  }
}

function setComparisonView(view) {
  currentComparisonView = view;
  const comparisonView = document.getElementById('comparisonView');
  const originalPanel = document.getElementById('originalPanel');
  const enhancedPanel = document.getElementById('enhancedPanel');

  // Update toggle buttons
  document.querySelectorAll('.comparison-toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });

  // Show/hide panels based on view
  comparisonView.classList.remove('single-view');
  originalPanel.classList.remove('hidden');
  enhancedPanel.classList.remove('hidden');

  if (view === 'original') {
    comparisonView.classList.add('single-view');
    enhancedPanel.classList.add('hidden');
  } else if (view === 'enhanced') {
    comparisonView.classList.add('single-view');
    originalPanel.classList.add('hidden');
  }
}

function setupComparisonToggle() {
  document.querySelectorAll('.comparison-toggle-btn').forEach(btn => {
    btn.onclick = () => setComparisonView(btn.dataset.view);
  });
}

function setupComparisonActions() {
  document.querySelectorAll('.comparison-action-btn').forEach(btn => {
    btn.onclick = async () => {
      const action = btn.dataset.action;
      const versionType = btn.dataset.version;
      const version = versionType === 'original' ? originalVersion : enhancedVersion;

      if (!version?.signedUrl) return;

      if (action === 'download') {
        downloadVersion(version, versionType);
      } else if (action === 'copy') {
        await copyVersionToClipboard(version, versionType);
      }
    };
  });
}

function downloadVersion(version, versionType) {
  const link = document.createElement('a');
  link.href = version.signedUrl;
  link.download = `${currentPhoto?.title || 'photo'}-${versionType}.jpg`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

async function copyVersionToClipboard(version, versionType) {
  try {
    const response = await fetch(version.signedUrl);
    const blob = await response.blob();
    await navigator.clipboard.write([
      new ClipboardItem({ [blob.type]: blob })
    ]);
    showToast(`${versionType === 'original' ? 'Original' : 'Enhanced'} copied to clipboard`);
  } catch (error) {
    console.error('Copy error:', error);
    try {
      await navigator.clipboard.writeText(version.signedUrl);
      showToast('Image URL copied to clipboard');
    } catch (e) {
      console.error('Fallback copy error:', e);
    }
  }
}

function showToast(message) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--color-leather, #654321);
    color: var(--color-cream, #fdfbf5);
    padding: 12px 24px;
    border-radius: 8px;
    font-size: 14px;
    z-index: 1000;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    animation: fadeIn 0.3s ease;
  `;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 3000);
}

function setupPhotoDetailButtons() {
  // Enhance again
  const enhanceBtn = document.getElementById('enhanceAgainBtn');
  if (enhanceBtn) {
    enhanceBtn.onclick = () => {
      if (!currentPhoto) return;
      window.location.href = `/?photoId=${currentPhoto.id}`;
    };
  }

  // Favorite
  const favoriteBtn = document.getElementById('favoriteBtn');
  if (favoriteBtn) {
    favoriteBtn.onclick = async () => {
      if (!currentPhoto) return;
      try {
        const newFavorite = !currentPhoto.favorite;
        await Auth.authFetch(`/api/photos/${currentPhoto.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ favorite: newFavorite }),
        });
        currentPhoto.favorite = newFavorite;
        updateFavoriteButton(newFavorite);

        const photoIndex = photos.findIndex(p => p.id === currentPhoto.id);
        if (photoIndex >= 0) {
          photos[photoIndex].favorite = newFavorite;
        }
      } catch (error) {
        console.error('Favorite error:', error);
      }
    };
  }

  // Delete
  const deleteBtn = document.getElementById('deletePhotoBtn');
  if (deleteBtn) {
    deleteBtn.onclick = async () => {
      if (!currentPhoto) return;
      if (!confirm('Are you sure you want to delete this photo?')) return;

      try {
        await Auth.authFetch(`/api/photos/${currentPhoto.id}`, {
          method: 'DELETE',
        });
        closePhotoDetail();
        loadPhotos(); // Reload to update the list
      } catch (error) {
        console.error('Delete error:', error);
      }
    };
  }
}

function updateFavoriteButton(isFavorite) {
  const btn = document.getElementById('favoriteBtn');
  if (!btn) return;

  btn.innerHTML = `
    <svg class="btn-icon" viewBox="0 0 24 24" fill="${isFavorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
    </svg>
    ${isFavorite ? 'Favorited' : 'Favorite'}
  `;
}

// Modals
function setupModals() {
  // Close modal on backdrop click
  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', () => {
      backdrop.closest('.modal').classList.add('hidden');
    });
  });

  // Close buttons
  document.querySelectorAll('.modal-close, .modal-cancel').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.closest('.modal').classList.add('hidden');
    });
  });

  // Folder form
  const folderForm = document.getElementById('folderForm');
  if (folderForm) {
    folderForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('folderName').value.trim();
      const parentId = document.getElementById('parentFolder').value;
      if (!name) return;

      try {
        const body = { name };
        if (parentId) {
          body.parentId = parseInt(parentId);
        }

        await Auth.authFetch('/api/folders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        document.getElementById('folderName').value = '';
        document.getElementById('parentFolder').value = '';
        folderModal.classList.add('hidden');
        await loadFolders();
      } catch (error) {
        console.error('Create folder error:', error);
      }
    });
  }
}

// View Toggle
function setupViewToggle() {
  const gridBtn = document.getElementById('gridViewBtn');
  const listBtn = document.getElementById('listViewBtn');

  if (gridBtn) {
    gridBtn.addEventListener('click', () => {
      gridBtn.classList.add('active');
      listBtn?.classList.remove('active');
      photoGrid.style.display = 'grid';
    });
  }

  if (listBtn) {
    listBtn.addEventListener('click', () => {
      listBtn.classList.add('active');
      gridBtn?.classList.remove('active');
      photoGrid.style.display = 'flex';
      photoGrid.style.flexDirection = 'column';
    });
  }
}

// Utility functions
function showLoading() {
  loadingState?.classList.remove('hidden');
}

function hideLoading() {
  loadingState?.classList.add('hidden');
}

function showEmpty() {
  emptyState?.classList.remove('hidden');
}

function hideContent() {
  photoGrid?.classList.add('hidden');
  jobsView?.classList.add('hidden');
  emptyState?.classList.add('hidden');
  photoDetailView?.classList.add('hidden');
  libraryHeader?.classList.remove('hidden');
}

function formatDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ============================================
// EDITABLE FIELDS & SAVE FUNCTIONALITY
// ============================================

function setupEditableFields() {
  const titleInput = document.getElementById('editPhotoTitle');
  const dateInput = document.getElementById('editPhotoDate');
  const folderSelect = document.getElementById('editPhotoFolder');
  const notesInput = document.getElementById('editPhotoNotes');
  const saveBtn = document.getElementById('savePhotoBtn');

  // Add change listeners to all editable fields
  [titleInput, dateInput, folderSelect, notesInput].forEach(field => {
    if (field) {
      field.addEventListener('input', checkForChanges);
      field.addEventListener('change', checkForChanges);
    }
  });

  // Save button click handler
  if (saveBtn) {
    saveBtn.addEventListener('click', savePhotoChanges);
  }
}

function populateDetailFolderDropdown(selectedFolderId) {
  const select = document.getElementById('editPhotoFolder');
  if (!select) return;

  select.innerHTML = '<option value="">No folder</option>';

  // Use the allFolders array that was loaded
  const folderTree = buildFolderTree(allFolders);

  function addOptions(folders, depth = 0) {
    folders.forEach(folder => {
      const option = document.createElement('option');
      option.value = folder.id;
      option.textContent = '  '.repeat(depth) + (depth > 0 ? '└ ' : '') + folder.name;
      if (folder.id === selectedFolderId) {
        option.selected = true;
      }
      select.appendChild(option);

      if (folder.children && folder.children.length > 0) {
        addOptions(folder.children, depth + 1);
      }
    });
  }

  addOptions(folderTree);
}

function checkForChanges() {
  const titleInput = document.getElementById('editPhotoTitle');
  const dateInput = document.getElementById('editPhotoDate');
  const folderSelect = document.getElementById('editPhotoFolder');
  const notesInput = document.getElementById('editPhotoNotes');
  const saveBtn = document.getElementById('savePhotoBtn');
  const saveStatus = document.getElementById('saveStatus');

  if (!saveBtn) return;

  // Check if any field has changed from original
  const hasChanges =
    titleInput?.value !== titleInput?.dataset.original ||
    dateInput?.value !== dateInput?.dataset.original ||
    folderSelect?.value !== folderSelect?.dataset.original ||
    notesInput?.value !== notesInput?.dataset.original;

  saveBtn.disabled = !hasChanges;

  // Hide the "saved" message when making new changes
  if (hasChanges && saveStatus) {
    saveStatus.classList.add('hidden');
  }
}

async function savePhotoChanges() {
  if (!currentPhoto) return;

  const saveBtn = document.getElementById('savePhotoBtn');
  const saveStatus = document.getElementById('saveStatus');
  const btnText = saveBtn?.querySelector('.btn-text');
  const btnLoading = saveBtn?.querySelector('.btn-loading');

  // Get current values
  const title = document.getElementById('editPhotoTitle')?.value.trim();
  const assignedDate = document.getElementById('editPhotoDate')?.value || null;
  const folderId = document.getElementById('editPhotoFolder')?.value || null;
  const description = document.getElementById('editPhotoNotes')?.value.trim() || null;

  // Show loading state
  if (saveBtn) saveBtn.disabled = true;
  if (btnText) btnText.classList.add('hidden');
  if (btnLoading) btnLoading.classList.remove('hidden');

  try {
    const response = await Auth.authFetch(`/api/photos/${currentPhoto.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title || 'Untitled',
        description,
        folderId: folderId ? parseInt(folderId) : null,
        assignedDate,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to save changes');
    }

    const updatedPhoto = await response.json();

    // Update currentPhoto with new values
    currentPhoto.title = updatedPhoto.title;
    currentPhoto.description = updatedPhoto.description;
    currentPhoto.folder_id = updatedPhoto.folder_id;
    currentPhoto.assigned_date = updatedPhoto.assigned_date;

    // Update the original values for change detection
    const titleInput = document.getElementById('editPhotoTitle');
    const dateInput = document.getElementById('editPhotoDate');
    const folderSelect = document.getElementById('editPhotoFolder');
    const notesInput = document.getElementById('editPhotoNotes');

    if (titleInput) titleInput.dataset.original = titleInput.value;
    if (dateInput) dateInput.dataset.original = dateInput.value;
    if (folderSelect) folderSelect.dataset.original = folderSelect.value;
    if (notesInput) notesInput.dataset.original = notesInput.value;

    // Update the photo in the photos array
    const photoIndex = photos.findIndex(p => p.id === currentPhoto.id);
    if (photoIndex !== -1) {
      photos[photoIndex] = { ...photos[photoIndex], ...updatedPhoto };
    }

    // Show success message
    if (saveStatus) {
      saveStatus.classList.remove('hidden');
      // Hide after 3 seconds
      setTimeout(() => {
        saveStatus.classList.add('hidden');
      }, 3000);
    }

  } catch (error) {
    console.error('Save error:', error);
    alert('Failed to save changes. Please try again.');
  } finally {
    // Reset button state
    if (btnText) btnText.classList.remove('hidden');
    if (btnLoading) btnLoading.classList.add('hidden');
    checkForChanges(); // Re-check to update button state
  }
}
