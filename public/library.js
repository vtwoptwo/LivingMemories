// Library state
let currentView = 'all';
let currentFolderId = null;
let photos = [];
let folders = [];
let allFolders = []; // Flat list of all folders for dropdowns
let jobs = [];
let currentPhoto = null;
let currentVersionIndex = 0;

// DOM Elements
const photoGrid = document.getElementById('photoGrid');
const jobsView = document.getElementById('jobsView');
const jobsList = document.getElementById('jobsList');
const emptyState = document.getElementById('emptyState');
const loadingState = document.getElementById('loadingState');
const viewTitle = document.getElementById('viewTitle');
const folderList = document.getElementById('folderList');
const photoModal = document.getElementById('photoModal');
const folderModal = document.getElementById('folderModal');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
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

  // Setup modals
  setupModals();

  // Setup view toggle
  setupViewToggle();

  // Load initial data
  await loadFolders();
  await loadPhotos();
});

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
    // Reset modal for root-level folder creation
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
    // Fetch all folders (flat list)
    const response = await Auth.authFetch('/api/folders?all=true');
    allFolders = await response.json();

    // Build tree structure for sidebar
    folders = buildFolderTree(allFolders);

    renderFolders();
    populateParentFolderDropdown();
  } catch (error) {
    console.error('Load folders error:', error);
  }
}

// Build tree structure from flat list
function buildFolderTree(flatFolders) {
  const map = {};
  const roots = [];

  // Create a map of id -> folder
  flatFolders.forEach(folder => {
    map[folder.id] = { ...folder, children: [] };
  });

  // Build tree
  flatFolders.forEach(folder => {
    if (folder.parent_id && map[folder.parent_id]) {
      map[folder.parent_id].children.push(map[folder.id]);
    } else {
      roots.push(map[folder.id]);
    }
  });

  return roots;
}

// Populate parent folder dropdown in modal
function populateParentFolderDropdown() {
  const select = document.getElementById('parentFolder');
  if (!select) return;

  select.innerHTML = '<option value="">None (root level)</option>';

  // Recursively add folders with indentation
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

    // Render children recursively
    if (folder.children && folder.children.length > 0) {
      renderFolderItems(folder.children, container, depth + 1);
    }
  });
}

// Open create subfolder modal with parent pre-selected
function openCreateSubfolderModal(parentId, parentName) {
  const parentSelect = document.getElementById('parentFolder');
  parentSelect.value = parentId;

  // Update modal title to show context
  const modalTitle = folderModal.querySelector('.modal-title');
  modalTitle.textContent = `New Subfolder in "${parentName}"`;

  folderModal.classList.remove('hidden');
  document.getElementById('folderName').focus();
}

// Photo Detail Modal
let originalVersion = null;
let enhancedVersion = null;
let currentComparisonView = 'side-by-side';

function openPhotoDetail(photo) {
  currentPhoto = photo;

  document.getElementById('photoTitle').textContent = photo.title || 'Untitled';
  document.getElementById('photoCreated').textContent = formatDate(photo.created_at);
  document.getElementById('photoVersionCount').textContent = photo.versions?.length || 0;

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

  // Setup modal buttons
  setupPhotoDetailButtons();
  setupComparisonToggle();
  setupComparisonActions();

  photoModal.classList.remove('hidden');
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
    // Fallback: copy URL
    try {
      await navigator.clipboard.writeText(version.signedUrl);
      showToast('Image URL copied to clipboard');
    } catch (e) {
      console.error('Fallback copy error:', e);
    }
  }
}

function showToast(message) {
  // Simple toast notification
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
    background: #333;
    color: white;
    padding: 12px 24px;
    border-radius: 8px;
    font-size: 14px;
    z-index: 1000;
    animation: fadeIn 0.3s ease;
  `;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 3000);
}

function setupPhotoDetailButtons() {
  // Enhance again
  document.getElementById('enhanceAgainBtn').onclick = async () => {
    if (!currentPhoto) return;
    photoModal.classList.add('hidden');
    window.location.href = `/?photoId=${currentPhoto.id}`;
  };

  // Favorite
  document.getElementById('favoriteBtn').onclick = async () => {
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

      // Update in list
      const photoIndex = photos.findIndex(p => p.id === currentPhoto.id);
      if (photoIndex >= 0) {
        photos[photoIndex].favorite = newFavorite;
      }
    } catch (error) {
      console.error('Favorite error:', error);
    }
  };

  // Delete
  document.getElementById('deletePhotoBtn').onclick = async () => {
    if (!currentPhoto) return;
    if (!confirm('Are you sure you want to delete this photo?')) return;

    try {
      await Auth.authFetch(`/api/photos/${currentPhoto.id}`, {
        method: 'DELETE',
      });
      photoModal.classList.add('hidden');
      loadPhotos();
    } catch (error) {
      console.error('Delete error:', error);
    }
  };
}

function updateFavoriteButton(isFavorite) {
  const btn = document.getElementById('favoriteBtn');
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
  document.getElementById('folderForm').addEventListener('submit', async (e) => {
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

// View Toggle
function setupViewToggle() {
  document.getElementById('gridViewBtn').addEventListener('click', () => {
    document.getElementById('gridViewBtn').classList.add('active');
    document.getElementById('listViewBtn').classList.remove('active');
    photoGrid.style.display = 'grid';
  });

  document.getElementById('listViewBtn').addEventListener('click', () => {
    document.getElementById('listViewBtn').classList.add('active');
    document.getElementById('gridViewBtn').classList.remove('active');
    photoGrid.style.display = 'flex';
    photoGrid.style.flexDirection = 'column';
  });
}

// Utility functions
function showLoading() {
  loadingState.classList.remove('hidden');
}

function hideLoading() {
  loadingState.classList.add('hidden');
}

function showEmpty() {
  emptyState.classList.remove('hidden');
}

function hideContent() {
  photoGrid.classList.add('hidden');
  jobsView.classList.add('hidden');
  emptyState.classList.add('hidden');
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
