/************************************************************
 * app.js
 * ระบบบันทึกจุดเสี่ยงในพื้นที่ทำงาน
 *
 * เวอร์ชันปรับปรุงใหม่
 * - กล้องใช้ Native Camera เป็นหลัก เพื่อรองรับมือถือ/LINE Browser ดีขึ้น
 * - มีตัวเลือกกล้องสด getUserMedia เป็นทางเลือก
 * - แผนที่ซูมใกล้ขึ้น z=20 + satellite layer
 * - การ์ดจุดเสี่ยงแสดงข้อมูลตรวจล่าสุด
 * - บันทึกภาพ 2 ภาพ
 * - รองรับ Summary Report
 * - เพิ่มระบบเลือกกะทำงาน A, B, C, DH, NH
 * - Summary กรองด้วย วันที่รอบงาน + ผู้ตรวจที่ Login + กะทำงาน
 * - กะ C และ NH รองรับงานข้ามวันโดยยึดวันที่รอบงาน
 ************************************************************/

const API_BASE = window.APP_CONFIG.API_BASE;
const LOGO_URL = window.APP_CONFIG.LOGO_URL;
const IMAGE_MAX_WIDTH = Math.min(Number(window.APP_CONFIG.IMAGE_MAX_WIDTH || 960), 960);
const IMAGE_QUALITY = Math.min(Number(window.APP_CONFIG.IMAGE_QUALITY || 0.65), 0.65);

const STORAGE_KEYS = window.APP_CONFIG.STORAGE_KEYS || {
  INSPECTOR: 'riskpoint_inspector',
  LOGIN_TIME: 'riskpoint_login_time',
  WORK_SHIFT: 'riskpoint_work_shift',
  WORK_DATE: 'riskpoint_work_date'
};

const WORK_SHIFTS = Array.isArray(window.APP_CONFIG.WORK_SHIFTS)
  ? window.APP_CONFIG.WORK_SHIFTS
  : ['A', 'B', 'C', 'DH', 'NH'];

const CROSS_DAY_SHIFTS = Array.isArray(window.APP_CONFIG.CROSS_DAY_SHIFTS)
  ? window.APP_CONFIG.CROSS_DAY_SHIFTS
  : ['C', 'NH'];

const STATE = {
  inspector: '',
  points: [],
  filteredPoints: [],
  selectedPoint: null,
  images: {
    1: null,
    2: null
  },
  currentCameraStream: null,
  currentFacingMode: 'environment',
  summaryData: null,
  activeSummaryDate: '',
  activeSummaryFilters: {
    inspector: '',
    workShift: ''
  },
  currentGps: null,
  workShift: ''
};

/************************************************************
 * Init
 ************************************************************/

document.addEventListener('DOMContentLoaded', initApp);

function initApp() {
  injectDynamicStyles();
  bindEvents();
  setDefaultDates();
  restoreLogin();

  apiHealth().catch(() => {
    setText('systemStatusText', 'เชื่อมต่อไม่ได้');
  });
}

function bindEvents() {
  $('#loginForm')?.addEventListener('submit', handleLogin);
  $('#togglePassBtn')?.addEventListener('click', togglePassword);
  $('#logoutBtn')?.addEventListener('click', logout);

  $('#refreshPointsBtn')?.addEventListener('click', loadRiskPoints);
  $('#pointSearchInput')?.addEventListener('input', handleSearchPoint);

  $('#backToMainBtn')?.addEventListener('click', () => showSection('mainSection'));

  $('#statusSelect')?.addEventListener('change', handleStatusChange);

  $('#inspectionForm')?.addEventListener('submit', handleSaveInspection);
  $('#resetInspectionBtn')?.addEventListener('click', resetInspectionForm);

  $('#openSummaryBtn')?.addEventListener('click', openSummaryPicker);
  $('#showSummaryBtn')?.addEventListener('click', handleShowSummary);

  $('#workShiftSelect')?.addEventListener('change', handleWorkShiftChange);
  $('#summaryShiftSelect')?.addEventListener('change', handleSummaryShiftChange);
  $('#workDateInput')?.addEventListener('change', handleWorkDateChange);

  bindCameraBoxes();

  $('#photoInput1')?.addEventListener('change', e => handlePhotoFileChange(e, 1));
  $('#photoInput2')?.addEventListener('change', e => handlePhotoFileChange(e, 2));
}

function setDefaultDates() {
  const today = toInputDate(new Date());
  const savedWorkDate = localStorage.getItem(STORAGE_KEYS.WORK_DATE) || '';
  const savedShift = localStorage.getItem(STORAGE_KEYS.WORK_SHIFT) || '';

  if ($('#summaryDateInput')) $('#summaryDateInput').value = today;
  if ($('#workDateInput')) $('#workDateInput').value = savedWorkDate || today;

  if ($('#workShiftSelect')) $('#workShiftSelect').value = WORK_SHIFTS.includes(savedShift) ? savedShift : '';
  if ($('#summaryShiftSelect')) $('#summaryShiftSelect').value = WORK_SHIFTS.includes(savedShift) ? savedShift : '';

  STATE.workShift = WORK_SHIFTS.includes(savedShift) ? savedShift : '';
  updateShiftHint();
}

function restoreLogin() {
  const inspector = localStorage.getItem(STORAGE_KEYS.INSPECTOR) || '';

  if (inspector) {
    STATE.inspector = inspector;
    updateInspectorUI();
    showSection('mainSection');
    loadRiskPoints();
  } else {
    showSection('loginSection');
  }
}

/************************************************************
 * API
 ************************************************************/

async function apiGet(path, timeoutMs = 45000) {
  const res = await fetchWithTimeout(`${API_BASE}${path}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    }
  }, timeoutMs);

  return parseApiResponse(res);
}

async function apiPost(path, payload, timeoutMs = 120000) {
  const res = await fetchWithTimeout(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(payload || {})
  }, timeoutMs);

  return parseApiResponse(res);
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('ระบบใช้เวลานานเกินไป กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function parseApiResponse(res) {
  let data;

  try {
    data = await res.json();
  } catch (err) {
    throw new Error('ระบบไม่ได้ส่งข้อมูลกลับเป็น JSON');
  }

  if (!res.ok || !data.ok) {
    throw new Error(data.message || 'เกิดข้อผิดพลาดจากระบบ');
  }

  return data;
}

async function apiHealth() {
  const data = await apiGet('/api/health');
  setText('systemStatusText', data.ok ? 'พร้อมใช้งาน' : 'ผิดปกติ');
  return data;
}

/************************************************************
 * Login
 ************************************************************/

async function handleLogin(e) {
  e.preventDefault();

  const pass = $('#passInput')?.value.trim();

  if (!pass) {
    showWarning('กรุณากรอกรหัสผู้ตรวจ');
    return;
  }

  setButtonLoading('loginBtn', true, 'กำลังตรวจสอบ...');

  try {
    const data = await apiPost('/api/login', { pass }, 45000);

    STATE.inspector = data.inspector;
    localStorage.setItem(STORAGE_KEYS.INSPECTOR, data.inspector);
    localStorage.setItem(STORAGE_KEYS.LOGIN_TIME, new Date().toISOString());

    updateInspectorUI();
    syncSummaryFiltersFromLogin();

    await Swal.fire({
      icon: 'success',
      title: 'เข้าสู่ระบบสำเร็จ',
      text: `ผู้ตรวจ: ${data.inspector}`,
      timer: 1000,
      showConfirmButton: false,
      customClass: getSwalClass()
    });

    showSection('mainSection');
    await loadRiskPoints();

  } catch (err) {
    showError(err.message);
  } finally {
    setButtonLoading('loginBtn', false, 'เข้าสู่ระบบ');
  }
}

function togglePassword() {
  const input = $('#passInput');
  const btn = $('#togglePassBtn');

  if (!input || !btn) return;

  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = 'ซ่อน';
  } else {
    input.type = 'password';
    btn.textContent = 'แสดง';
  }
}

function logout() {
  Swal.fire({
    title: 'ออกจากระบบ?',
    text: 'ต้องการออกจากระบบผู้ตรวจนี้หรือไม่',
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'ออกจากระบบ',
    cancelButtonText: 'ยกเลิก',
    customClass: getSwalClass()
  }).then(result => {
    if (!result.isConfirmed) return;

    localStorage.removeItem(STORAGE_KEYS.INSPECTOR);
    localStorage.removeItem(STORAGE_KEYS.LOGIN_TIME);

    STATE.inspector = '';
    STATE.points = [];
    STATE.filteredPoints = [];
    STATE.selectedPoint = null;
    STATE.images[1] = null;
    STATE.images[2] = null;

    if ($('#passInput')) $('#passInput').value = '';

    showSection('loginSection');
  });
}

function updateInspectorUI() {
  setText('welcomeText', `ผู้ตรวจ: ${STATE.inspector}`);
  setText('inspectionInspectorText', `ผู้ตรวจ: ${STATE.inspector}`);

  const summaryInspectorInput = $('#summaryInspectorInput');
  if (summaryInspectorInput) summaryInspectorInput.value = STATE.inspector || '';

  const inspectionInspectorView = $('#inspectionInspectorView');
  if (inspectionInspectorView) inspectionInspectorView.value = STATE.inspector || '';
}

function syncSummaryFiltersFromLogin() {
  const summaryInspectorInput = $('#summaryInspectorInput');
  if (summaryInspectorInput) summaryInspectorInput.value = STATE.inspector || '';

  const savedShift = localStorage.getItem(STORAGE_KEYS.WORK_SHIFT) || '';
  if ($('#summaryShiftSelect') && WORK_SHIFTS.includes(savedShift)) {
    $('#summaryShiftSelect').value = savedShift;
  }
}

/************************************************************
 * Risk Points
 ************************************************************/

async function loadRiskPoints() {
  setButtonLoading('refreshPointsBtn', true, 'กำลังโหลด...');

  try {
    const data = await apiGet('/api/points', 60000);

    STATE.points = Array.isArray(data.points) ? data.points : [];
    STATE.filteredPoints = [...STATE.points];

    setText('totalPointText', STATE.points.length);
    renderPointCards();

  } catch (err) {
    showError(err.message);
  } finally {
    setButtonLoading('refreshPointsBtn', false, 'โหลดจุดเสี่ยงใหม่');
  }
}

function handleSearchPoint() {
  const keyword = ($('#pointSearchInput')?.value || '').trim().toLowerCase();

  if (!keyword) {
    STATE.filteredPoints = [...STATE.points];
  } else {
    STATE.filteredPoints = STATE.points.filter(item => {
      const latest = item.latestInspection || {};

      return (
        String(item.point || '').toLowerCase().includes(keyword) ||
        String(item.coordinates || '').toLowerCase().includes(keyword) ||
        String(latest.inspector || '').toLowerCase().includes(keyword) ||
        String(latest.status || '').toLowerCase().includes(keyword) ||
        String(latest.workShift || '').toLowerCase().includes(keyword)
      );
    });
  }

  renderPointCards();
}

function renderPointCards() {
  const box = $('#pointList');
  const empty = $('#emptyPointState');

  if (!box) return;

  box.innerHTML = '';

  if (!STATE.filteredPoints.length) {
    empty?.classList.remove('hidden');
    return;
  }

  empty?.classList.add('hidden');

  STATE.filteredPoints.forEach((item, index) => {
    const latest = item.latestInspection || null;
    const mapUrl = buildMapEmbedUrl(item.coordinates, 20);

    const latestHtml = latest && latest.timestamp
      ? `
        <div class="latest-inspection-box ${latest.status === 'ผิดปกติ' ? 'latest-bad' : 'latest-good'}">
          <span>ตรวจล่าสุด</span>
          <strong>${escapeHtml(latest.timestamp)}</strong>
          <small>${escapeHtml(latest.inspector || '-')} | กะ ${escapeHtml(latest.workShift || '-')} | ${escapeHtml(latest.status || '-')}</small>
        </div>
      `
      : `
        <div class="latest-inspection-box latest-none">
          <span>สถานะตรวจล่าสุด</span>
          <strong>ยังไม่พบประวัติการตรวจ</strong>
          <small>กดตรวจจุดนี้เพื่อบันทึกข้อมูล</small>
        </div>
      `;

    const card = document.createElement('article');
    card.className = `point-card ${latest && latest.timestamp ? 'checked-point-card' : ''}`;

    card.innerHTML = `
      <div class="point-card-header">
        <span class="point-index">${index + 1}</span>
        <h3>${escapeHtml(item.point)}</h3>
      </div>

      <div class="map-box point-map-box close-map-box">
        <iframe
          title="แผนที่ ${escapeAttr(item.point)}"
          src="${escapeAttr(mapUrl)}"
          loading="lazy"
          referrerpolicy="no-referrer-when-downgrade">
        </iframe>
      </div>

      <div class="point-meta">
        <span>พิกัด</span>
        <strong>${escapeHtml(item.coordinates)}</strong>
      </div>

      ${latestHtml}

      <button type="button" class="primary-btn full-btn">
        ตรวจจุดนี้
      </button>
    `;

    card.querySelector('button').addEventListener('click', () => {
      openInspection({
        ...item,
        mapUrl
      });
    });

    box.appendChild(card);
  });
}

function buildMapEmbedUrl(coordinates, zoom = 20) {
  const text = String(coordinates || '').trim();
  if (!text) return '';

  return `https://maps.google.com/maps?q=${encodeURIComponent(text)}&z=${zoom}&t=k&output=embed`;
}

/************************************************************
 * Inspection Form
 ************************************************************/

function openInspection(point) {
  const mapUrl = buildMapEmbedUrl(point.coordinates, 20);

  STATE.selectedPoint = {
    ...point,
    mapUrl
  };

  resetInspectionForm(false);

  setText('selectedPointName', point.point);
  setText('selectedPointCoordinates', `พิกัด: ${point.coordinates}`);

  if ($('#selectedPointMap')) {
    $('#selectedPointMap').src = mapUrl;
  }

  showSection('inspectionSection');

  setTimeout(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, 80);
}

function handleWorkShiftChange() {
  const shift = $('#workShiftSelect')?.value || '';

  STATE.workShift = shift;

  if (shift) {
    localStorage.setItem(STORAGE_KEYS.WORK_SHIFT, shift);
  } else {
    localStorage.removeItem(STORAGE_KEYS.WORK_SHIFT);
  }

  if ($('#summaryShiftSelect') && shift) {
    $('#summaryShiftSelect').value = shift;
  }

  applyCrossDayWorkDateSuggestion(shift);
  updateShiftHint();
}

function handleSummaryShiftChange() {
  const shift = $('#summaryShiftSelect')?.value || '';

  if (shift) {
    localStorage.setItem(STORAGE_KEYS.WORK_SHIFT, shift);
  } else {
    localStorage.removeItem(STORAGE_KEYS.WORK_SHIFT);
  }

  if ($('#workShiftSelect') && shift) {
    $('#workShiftSelect').value = shift;
    STATE.workShift = shift;
    applyCrossDayWorkDateSuggestion(shift);
    updateShiftHint();
  }
}

function handleWorkDateChange() {
  const value = $('#workDateInput')?.value || '';

  if (value) {
    localStorage.setItem(STORAGE_KEYS.WORK_DATE, value);
  } else {
    localStorage.removeItem(STORAGE_KEYS.WORK_DATE);
  }
}

function applyCrossDayWorkDateSuggestion(shift) {
  if (!CROSS_DAY_SHIFTS.includes(shift)) return;

  const workDateInput = $('#workDateInput');
  if (!workDateInput) return;

  const now = new Date();
  const hour = now.getHours();

  if (hour >= 0 && hour < 8) {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    const suggestedDate = toInputDate(yesterday);
    const currentValue = workDateInput.value || '';

    if (!currentValue || currentValue === toInputDate(now)) {
      workDateInput.value = suggestedDate;
      localStorage.setItem(STORAGE_KEYS.WORK_DATE, suggestedDate);
    }
  }
}

function updateShiftHint() {
  const shift = $('#workShiftSelect')?.value || '';
  const hintBox = $('#shiftHintBox');

  if (!hintBox) return;

  if (CROSS_DAY_SHIFTS.includes(shift)) {
    hintBox.classList.remove('hidden');
  } else {
    hintBox.classList.add('hidden');
  }
}

function handleStatusChange() {
  const status = $('#statusSelect')?.value || '';

  if (status === 'ผิดปกติ') {
    $('#abnormalBox')?.classList.remove('hidden');
    $('#abnormalDetailInput')?.setAttribute('required', 'required');
    $('#riskLevelSelect')?.setAttribute('required', 'required');
  } else {
    $('#abnormalBox')?.classList.add('hidden');
    $('#abnormalDetailInput')?.removeAttribute('required');
    $('#riskLevelSelect')?.removeAttribute('required');

    if ($('#abnormalDetailInput')) $('#abnormalDetailInput').value = '';
    if ($('#riskLevelSelect')) $('#riskLevelSelect').value = '';
    if ($('#correctiveActionInput')) $('#correctiveActionInput').value = '';
  }
}

/************************************************************
 * Camera Stable Version
 ************************************************************/

function bindCameraBoxes() {
  const box1 = document.querySelector('label[for="photoInput1"]');
  const box2 = document.querySelector('label[for="photoInput2"]');

  if (box1) {
    box1.addEventListener('click', e => {
      e.preventDefault();
      openCameraChoice(1);
    });
  }

  if (box2) {
    box2.addEventListener('click', e => {
      e.preventDefault();
      openCameraChoice(2);
    });
  }
}

async function openCameraChoice(index) {
  await Swal.fire({
    title: `ถ่ายภาพที่ ${index}`,
    html: `
      <div class="camera-choice-box">
        <img src="${LOGO_URL}" class="summary-picker-logo" alt="logo">

        <p>เลือกวิธีถ่ายภาพพื้นที่จริงของจุดเสี่ยง</p>

        <div class="camera-choice-actions">
          <button type="button" id="nativeCameraBtn" class="camera-choice-primary">
            เปิดกล้องมือถือ
          </button>

          <button type="button" id="liveCameraBtn" class="camera-choice-secondary">
            กล้องสดในเว็บ
          </button>

          <button type="button" id="galleryBtn" class="camera-choice-secondary">
            เลือกรูปจากเครื่อง
          </button>
        </div>

        <small class="camera-choice-note">
          แนะนำให้ใช้ “เปิดกล้องมือถือ” เพราะรองรับมือถือและ LINE Browser ได้ดีที่สุด
        </small>
      </div>
    `,
    showConfirmButton: false,
    showCancelButton: true,
    cancelButtonText: 'ปิด',
    customClass: getSwalClass(),
    didOpen: () => {
      document.getElementById('nativeCameraBtn').onclick = () => {
        Swal.close();
        setTimeout(() => openNativeCamera(index), 120);
      };

      document.getElementById('liveCameraBtn').onclick = () => {
        Swal.close();
        setTimeout(() => openLiveCamera(index), 120);
      };

      document.getElementById('galleryBtn').onclick = () => {
        Swal.close();
        setTimeout(() => openGalleryPicker(index), 120);
      };
    }
  });
}

function openNativeCamera(index) {
  const input = createDynamicImageInput({
    capture: 'environment',
    index
  });

  input.click();
}

function openGalleryPicker(index) {
  const input = createDynamicImageInput({
    capture: '',
    index
  });

  input.click();
}

function createDynamicImageInput({ capture, index }) {
  const input = document.createElement('input');

  input.type = 'file';
  input.accept = 'image/*';

  if (capture) {
    input.setAttribute('capture', capture);
  }

  input.style.position = 'fixed';
  input.style.left = '-9999px';
  input.style.top = '-9999px';
  input.style.opacity = '0';
  input.style.pointerEvents = 'none';

  input.addEventListener('change', async e => {
    await handlePhotoFileChange(e, index);
    setTimeout(() => input.remove(), 500);
  });

  document.body.appendChild(input);

  return input;
}

async function openLiveCamera(index) {
  const canUseCamera =
    window.isSecureContext &&
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function';

  if (!canUseCamera) {
    showWarning('อุปกรณ์นี้ไม่รองรับกล้องสดในเว็บ ระบบจะเปิดกล้องมือถือแทน');
    setTimeout(() => openNativeCamera(index), 500);
    return;
  }

  let localStream = null;

  await Swal.fire({
    title: '',
    html: `
      <div class="camera-modal">
        <div class="camera-header">
          <img src="${LOGO_URL}" alt="logo">

          <div>
            <h3>ถ่ายภาพที่ ${index}</h3>
            <p>กล้องสดในเว็บ</p>
          </div>
        </div>

        <div class="camera-video-wrap">
          <video id="riskCameraVideo" autoplay playsinline muted></video>
          <div id="cameraStatusText" class="camera-status">กำลังเปิดกล้อง...</div>
        </div>

        <div class="camera-actions">
          <button type="button" id="captureCameraBtn" class="camera-primary-btn">
            ถ่ายภาพ
          </button>

          <button type="button" id="switchCameraBtn" class="camera-soft-btn">
            สลับกล้อง
          </button>

          <button type="button" id="nativeFallbackBtn" class="camera-soft-btn">
            เปิดกล้องมือถือ
          </button>
        </div>
      </div>
    `,
    width: '96%',
    showConfirmButton: false,
    showCancelButton: true,
    cancelButtonText: 'ปิด',
    allowOutsideClick: false,
    customClass: {
      popup: 'camera-swal-popup',
      htmlContainer: 'camera-swal-html',
      cancelButton: 'custom-swal-cancel'
    },
    didOpen: async () => {
      const video = document.getElementById('riskCameraVideo');
      const status = document.getElementById('cameraStatusText');
      const captureBtn = document.getElementById('captureCameraBtn');
      const switchBtn = document.getElementById('switchCameraBtn');
      const nativeFallbackBtn = document.getElementById('nativeFallbackBtn');

      async function startCamera() {
        stopCameraStream(localStream);

        try {
          status.textContent = 'กำลังขอสิทธิ์กล้อง...';
          status.style.opacity = '1';

          localStream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: {
                ideal: STATE.currentFacingMode || 'environment'
              },
              width: {
                ideal: 1280
              },
              height: {
                ideal: 720
              }
            },
            audio: false
          });

          STATE.currentCameraStream = localStream;
          video.srcObject = localStream;

          await video.play();

          status.textContent = 'กล้องพร้อมใช้งาน';

          setTimeout(() => {
            if (status) status.style.opacity = '0';
          }, 800);

        } catch (err) {
          status.style.opacity = '1';
          status.textContent = 'เปิดกล้องสดไม่ได้ ระบบจะเปิดกล้องมือถือแทน';

          setTimeout(() => {
            Swal.close();
            openNativeCamera(index);
          }, 900);
        }
      }

      await startCamera();

      captureBtn.onclick = async () => {
        try {
          const image = await captureVideoFrame(video, index);

          STATE.images[index] = image;
          renderPhotoPreview(index, image.base64);

          stopCameraStream(localStream);
          Swal.close();

        } catch (err) {
          showError('ถ่ายภาพไม่สำเร็จ: ' + err.message);
        }
      };

      switchBtn.onclick = async () => {
        STATE.currentFacingMode =
          STATE.currentFacingMode === 'environment' ? 'user' : 'environment';

        status.style.opacity = '1';
        status.textContent = 'กำลังสลับกล้อง...';

        await startCamera();
      };

      nativeFallbackBtn.onclick = () => {
        stopCameraStream(localStream);
        Swal.close();

        setTimeout(() => openNativeCamera(index), 150);
      };
    },
    willClose: () => {
      stopCameraStream(localStream);
      stopCameraStream(STATE.currentCameraStream);
    }
  });
}

function stopCameraStream(stream) {
  if (!stream) return;

  try {
    stream.getTracks().forEach(track => track.stop());
  } catch (err) {
    // ignore
  }

  if (STATE.currentCameraStream === stream) {
    STATE.currentCameraStream = null;
  }
}

function captureVideoFrame(video, index) {
  return new Promise((resolve, reject) => {
    if (!video || !video.videoWidth || !video.videoHeight) {
      reject(new Error('กล้องยังไม่พร้อม กรุณารอสักครู่'));
      return;
    }

    const canvas = document.createElement('canvas');

    let width = video.videoWidth;
    let height = video.videoHeight;

    if (width > IMAGE_MAX_WIDTH) {
      height = Math.round((height * IMAGE_MAX_WIDTH) / width);
      width = IMAGE_MAX_WIDTH;
    }

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, width, height);

    const base64 = canvas.toDataURL('image/jpeg', IMAGE_QUALITY);

    resolve({
      name: `camera_photo_${index}.jpg`,
      mimeType: 'image/jpeg',
      base64,
      size: Math.round((base64.length * 3) / 4)
    });
  });
}

async function handlePhotoFileChange(e, index) {
  const file = e.target.files && e.target.files[0];

  if (!file) return;

  if (!file.type.startsWith('image/')) {
    showWarning('กรุณาเลือกไฟล์รูปภาพเท่านั้น');
    e.target.value = '';
    return;
  }

  try {
    showLoading('กำลังเตรียมรูปภาพ...');

    const compressed = await compressImage(file, {
      maxWidth: IMAGE_MAX_WIDTH,
      quality: IMAGE_QUALITY
    });

    STATE.images[index] = compressed;
    renderPhotoPreview(index, compressed.base64);

    Swal.close();

  } catch (err) {
    Swal.close();
    showError('ไม่สามารถอ่านรูปภาพได้: ' + err.message);
    e.target.value = '';
  }
}

function renderPhotoPreview(index, base64) {
  const box = $(`#photoPreview${index}`);

  if (!box) return;

  box.innerHTML = `
    <img src="${base64}" alt="ภาพที่ ${index}" />
    <div class="photo-ok-badge">ภาพที่ ${index} พร้อมใช้งาน</div>
  `;
}

/************************************************************
 * Save Inspection
 ************************************************************/

async function handleSaveInspection(e) {
  e.preventDefault();

  let payload = buildInspectionPayload();
  let validation = validateInspectionPayload(payload, { requireGps: false });

  if (!validation.ok) {
    showWarning(validation.message);
    return;
  }

  showLoading('กำลังตรวจสอบตำแหน่ง GPS...');

  try {
    const gps = await requireGpsLocation();
    STATE.currentGps = gps;
    payload = buildInspectionPayload();
    payload.gps = gps;
  } catch (err) {
    Swal.close();
    showError(err.message || 'ไม่สามารถอ่านตำแหน่ง GPS ได้');
    return;
  }

  Swal.close();

  validation = validateInspectionPayload(payload, { requireGps: true });
  if (!validation.ok) {
    showWarning(validation.message);
    return;
  }

  const confirm = await Swal.fire({
    title: 'ยืนยันการบันทึก?',
    html: `
      <div class="confirm-save-box">
        <strong>${escapeHtml(payload.point)}</strong>
        <p>สถานะพื้นที่: ${escapeHtml(payload.status)}</p>
        <p>วันที่รอบงาน: ${escapeHtml(payload.workDate)}</p>
        <p>กะทำงาน: ${escapeHtml(payload.workShift)}</p>
        <p>ภาพยืนยัน: ครบ 2 ภาพ</p>
        <p>GPS: ${escapeHtml(payload.gps.latitude)}, ${escapeHtml(payload.gps.longitude)}</p>
        <p>ความแม่นยำ: ${escapeHtml(payload.gps.accuracy || '-')} เมตร</p>
      </div>
    `,
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'บันทึก',
    cancelButtonText: 'ยกเลิก',
    customClass: getSwalClass()
  });

  if (!confirm.isConfirmed) return;

  setButtonLoading('saveInspectionBtn', true, 'กำลังบันทึก...');
  showLoading('กำลังอัปโหลดภาพและบันทึกข้อมูล...');

  try {
    const data = await apiPost('/api/save', payload, 90000);

    await Swal.fire({
      icon: 'success',
      title: 'บันทึกสำเร็จ',
      html: `
        <div class="save-success-box">
          <p><b>จุดเสี่ยง:</b> ${escapeHtml(data.point)}</p>
          <p><b>ผู้ตรวจ:</b> ${escapeHtml(data.inspector)}</p>
          <p><b>เวลา:</b> ${escapeHtml(data.timestamp)}</p>
          <p><b>วันที่รอบงาน:</b> ${escapeHtml(data.workDate || payload.workDate)}</p>
          <p><b>กะทำงาน:</b> ${escapeHtml(data.workShift || payload.workShift)}</p>
          <p><b>สถานะ:</b> ${escapeHtml(data.status)}</p>
          <p><b>GPS:</b> ${escapeHtml(payload.gps.latitude)}, ${escapeHtml(payload.gps.longitude)}</p>
        </div>
      `,
      confirmButtonText: 'กลับหน้ารายการ',
      customClass: getSwalClass()
    });

    resetInspectionForm();
    showSection('mainSection');
    await loadRiskPoints();

  } catch (err) {
    showError(err.message);
  } finally {
    setButtonLoading('saveInspectionBtn', false, 'บันทึกผลตรวจ');
  }
}

function buildInspectionPayload() {
  const status = $('#statusSelect')?.value.trim() || '';

  return {
    inspector: STATE.inspector,
    point: STATE.selectedPoint?.point || '',
    coordinates: STATE.selectedPoint?.coordinates || '',
    workDate: inputDateToThai($('#workDateInput')?.value || ''),
    workShift: $('#workShiftSelect')?.value.trim() || '',
    status,
    abnormalDetail: $('#abnormalDetailInput')?.value.trim() || '',
    riskLevel: $('#riskLevelSelect')?.value.trim() || '',
    correctiveAction: $('#correctiveActionInput')?.value.trim() || '',
    deviceInfo: navigator.userAgent || '',
    gps: STATE.currentGps,
    images: [STATE.images[1], STATE.images[2]]
  };
}

function validateInspectionPayload(payload, options = {}) {
  const requireGps = options.requireGps !== false;

  if (!payload.inspector) return { ok: false, message: 'ไม่พบชื่อผู้ตรวจ กรุณาเข้าสู่ระบบใหม่' };
  if (!payload.point) return { ok: false, message: 'ไม่พบจุดเสี่ยงที่เลือก' };
  if (!payload.workDate) return { ok: false, message: 'กรุณาเลือกวันที่รอบงาน' };
  if (!payload.workShift) return { ok: false, message: 'กรุณาเลือกกะทำงาน' };
  if (!WORK_SHIFTS.includes(payload.workShift)) return { ok: false, message: 'กะทำงานไม่ถูกต้อง' };
  if (!payload.status) return { ok: false, message: 'กรุณาเลือกสถานะพื้นที่' };

  if (payload.status === 'ผิดปกติ') {
    if (!payload.abnormalDetail) return { ok: false, message: 'กรุณากรอกรายละเอียดความผิดปกติ' };
    if (!payload.riskLevel) return { ok: false, message: 'กรุณาเลือกระดับความเสี่ยง' };
  }

  if (!payload.images[0] || !payload.images[0].base64) return { ok: false, message: 'กรุณาถ่ายภาพที่ 1' };
  if (!payload.images[1] || !payload.images[1].base64) return { ok: false, message: 'กรุณาถ่ายภาพที่ 2' };

  if (requireGps && (!payload.gps || payload.gps.latitude === undefined || payload.gps.longitude === undefined)) {
    return { ok: false, message: 'กรุณาเปิด GPS และอนุญาตให้ระบบเข้าถึงตำแหน่งก่อนบันทึก' };
  }

  return { ok: true };
}

function resetInspectionForm(clearPoint = true) {
  $('#inspectionForm')?.reset();

  const today = toInputDate(new Date());
  const savedShift = localStorage.getItem(STORAGE_KEYS.WORK_SHIFT) || '';
  const savedWorkDate = localStorage.getItem(STORAGE_KEYS.WORK_DATE) || '';

  if ($('#workDateInput')) $('#workDateInput').value = savedWorkDate || today;

  if ($('#workShiftSelect')) {
    $('#workShiftSelect').value = WORK_SHIFTS.includes(savedShift) ? savedShift : '';
    STATE.workShift = $('#workShiftSelect').value || '';
  }

  const inspectionInspectorView = $('#inspectionInspectorView');
  if (inspectionInspectorView) inspectionInspectorView.value = STATE.inspector || '';

  updateShiftHint();

  STATE.images[1] = null;
  STATE.images[2] = null;
  STATE.currentGps = null;

  resetPhotoPreview(1);
  resetPhotoPreview(2);

  $('#abnormalBox')?.classList.add('hidden');

  if ($('#photoInput1')) $('#photoInput1').value = '';
  if ($('#photoInput2')) $('#photoInput2').value = '';

  if (clearPoint) {
    STATE.selectedPoint = null;
  }
}

function resetPhotoPreview(index) {
  const box = $(`#photoPreview${index}`);

  if (!box) return;

  box.innerHTML = `
    <div class="photo-placeholder">
      <span>📷</span>
      <strong>ภาพที่ ${index}</strong>
      <small>กดเพื่อเปิดกล้อง</small>
    </div>
  `;
}

/************************************************************
 * Summary
 * - หน้า Summary ปกติ: แสดง Map เหมือนเดิม
 * - โหมดบันทึกภาพ PNG: ตัด Map ออก และใช้ข้อมูลจุดตรวจแทน
 * - Copy ข้อความ: เอาลิงก์ภาพ/ลิงก์แผนที่ออก เหลือเฉพาะข้อมูล
 ************************************************************/

function openSummaryPicker() {
  const date = $('#summaryDateInput')?.value || toInputDate(new Date());
  const currentShift = $('#summaryShiftSelect')?.value || localStorage.getItem(STORAGE_KEYS.WORK_SHIFT) || '';
  const inspector = STATE.inspector || '';

  Swal.fire({
    title: 'เลือกเงื่อนไขสรุปผลตรวจ',
    html: `
      <div class="summary-picker-box">
        <img src="${LOGO_URL}" class="summary-picker-logo" alt="logo">
        <p>ระบบจะกรองจากวันที่รอบงาน ผู้ตรวจที่เข้าสู่ระบบ และกะทำงาน</p>

        <label class="swal-field-label">วันที่รอบงาน</label>
        <input id="swalSummaryDate" type="date" class="swal-date-input" value="${escapeAttr(date)}">

        <label class="swal-field-label">ผู้ตรวจ</label>
        <input id="swalSummaryInspector" type="text" class="swal-date-input" value="${escapeAttr(inspector)}" readonly>

        <label class="swal-field-label">กะทำงาน</label>
        <select id="swalSummaryShift" class="swal-date-input">
          <option value="">ทุกกะ</option>
          ${WORK_SHIFTS.map(shift => `
            <option value="${escapeAttr(shift)}" ${currentShift === shift ? 'selected' : ''}>กะ ${escapeHtml(shift)}</option>
          `).join('')}
        </select>

        <small class="summary-picker-note">
          กะ C และ NH เป็นกะข้ามวัน ให้เลือกวันที่รอบงานจริงของกะนั้น
        </small>
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: 'แสดงสรุป',
    cancelButtonText: 'ยกเลิก',
    customClass: getSwalClass(),
    preConfirm: () => {
      const value = document.getElementById('swalSummaryDate').value;
      const shift = document.getElementById('swalSummaryShift').value;

      if (!value) {
        Swal.showValidationMessage('กรุณาเลือกวันที่');
        return false;
      }

      return {
        date: value,
        workShift: shift
      };
    }
  }).then(result => {
    if (!result.isConfirmed) return;

    if ($('#summaryDateInput')) $('#summaryDateInput').value = result.value.date;
    if ($('#summaryShiftSelect')) $('#summaryShiftSelect').value = result.value.workShift || '';

    if (result.value.workShift) {
      localStorage.setItem(STORAGE_KEYS.WORK_SHIFT, result.value.workShift);
    }

    loadSummary(result.value.date);
  });
}

function handleShowSummary() {
  const date = $('#summaryDateInput')?.value || '';

  if (!date) {
    showWarning('กรุณาเลือกวันที่');
    return;
  }

  loadSummary(date);
}

async function loadSummary(inputDate) {
  showLoading('กำลังโหลดสรุปผลตรวจ...');

  try {
    const dateText = inputDate.includes('-') ? inputDate : thaiDateToInput(inputDate);
    const inspector = STATE.inspector || '';
    const workShift = $('#summaryShiftSelect')?.value || '';

    STATE.activeSummaryFilters = {
      inspector,
      workShift
    };

    const query = new URLSearchParams({
      date: dateText,
      inspector,
      workShift
    });

    const data = await apiGet(`/api/summary?${query.toString()}`, 60000);

    STATE.summaryData = data;
    STATE.activeSummaryDate = data.selectedDate;

    Swal.close();
    renderSummaryPopup(data, data.selectedDate);

  } catch (err) {
    Swal.close();
    showError(err.message);
  }
}

function getSummaryDay(data, activeDate) {
  const days = Array.isArray(data?.days) ? data.days : [];

  return (
    days.find(d => d.date === activeDate) ||
    days.find(d => d.date === data?.selectedDate) ||
    days[1] ||
    days[0] ||
    {
      date: activeDate || '',
      total: 0,
      normal: 0,
      abnormal: 0,
      inspectors: [],
      items: []
    }
  );
}

function renderSummaryPopup(data, activeDate) {
  const day = getSummaryDay(data, activeDate);

  injectSummaryCaptureStyles();

  Swal.fire({
    title: '',
    html: buildSummaryHtml(data, day),
    width: '96%',
    showConfirmButton: true,
    showDenyButton: true,
    showCancelButton: true,
    confirmButtonText: 'ปิด',
    denyButtonText: 'คัดลอกข้อความทั้งหมด',
    cancelButtonText: 'โหมดบันทึกภาพ',
    customClass: {
      popup: 'risk-report-popup risk-report-popup-complete',
      htmlContainer: 'risk-report-html',
      confirmButton: 'risk-report-confirm',
      denyButton: 'risk-report-copy',
      cancelButton: 'risk-report-image-btn'
    },
    didOpen: () => {
      bindSummaryTabs(data);
    }
  }).then(async result => {
    if (result.isDenied) {
      await copySummaryText(day);
      return;
    }

    if (result.dismiss === Swal.DismissReason.cancel) {
      openSummaryCaptureView(day);
    }
  });
}

function buildSummaryHtml(data, day) {
  const items = Array.isArray(day.items) ? day.items : [];
  const inspectorsText = day.inspectors && day.inspectors.length ? day.inspectors.join(', ') : '-';
  const filterInspector = STATE.activeSummaryFilters.inspector || STATE.inspector || '-';
  const filterShift = STATE.activeSummaryFilters.workShift || 'ทุกกะ';

  const tabs = Array.isArray(data.days)
    ? data.days.map(d => {
        const active = d.date === day.date ? 'active' : '';

        return `
          <button type="button" class="summary-tab ${active}" data-date="${escapeAttr(d.date)}">
            ${escapeHtml(d.date)}
            <span>${Number(d.total || 0)}</span>
          </button>
        `;
      }).join('')
    : '';

  const itemsHtml = items.length
    ? items.map((item, index) => buildSummaryItemCard(item, index, {
        mode: 'normal',
        showMap: true
      })).join('')
    : `
      <div class="summary-empty">
        <strong>ไม่พบข้อมูลการตรวจในวันนี้</strong>
        <p>กรุณาตรวจสอบวันที่รอบงาน ผู้ตรวจ หรือกะทำงาน</p>
      </div>
    `;

  return `
    <div class="risk-report-capture" id="riskReportCaptureArea">

      <div class="risk-report-header">
        <img src="${LOGO_URL}" alt="logo">
        <div>
          <h2>สรุปผลตรวจจุดเสี่ยง</h2>
          <p>วันที่รอบงาน ${escapeHtml(day.date || '-')}</p>
        </div>
      </div>

      <div class="risk-report-stats">
        <div>
          <span>ตรวจทั้งหมด</span>
          <strong>${Number(day.total || 0)}</strong>
        </div>

        <div>
          <span>ปกติ</span>
          <strong>${Number(day.normal || 0)}</strong>
        </div>

        <div class="${Number(day.abnormal || 0) > 0 ? 'danger' : ''}">
          <span>ผิดปกติ</span>
          <strong>${Number(day.abnormal || 0)}</strong>
        </div>
      </div>

      <div class="risk-report-inspectors">
        <span>ตัวกรองรายงาน</span>
        <strong>ผู้ตรวจ: ${escapeHtml(filterInspector)} | กะ: ${escapeHtml(filterShift)}</strong>
        <small>ผู้ตรวจในข้อมูล: ${escapeHtml(inspectorsText)}</small>
      </div>

      <div class="summary-capture-note">
        <strong>หมายเหตุ:</strong>
        <span>หน้า Summary นี้ยังแสดง Map ตามปกติ แต่โหมดบันทึกภาพจะตัด Map ออกและใช้ข้อมูลจุดตรวจแทน</span>
      </div>

      <div class="summary-tabs">
        ${tabs}
      </div>

      <div class="summary-items summary-items-complete">
        ${itemsHtml}
      </div>

    </div>
  `;
}

function buildSummaryItemCard(item, index, options = {}) {
  const mode = options.mode || 'normal';
  const showMap = options.showMap !== false;
  const isCapture = mode === 'capture';
  const isAbnormal = item.status === 'ผิดปกติ';

  const point = item.point || '-';
  const date = item.date || item.workDate || '';
  const time = item.time || extractTimeFromTimestamp(item.timestamp) || '-';
  const inspector = item.inspector || '-';
  const workShift = item.workShift || '-';
  const status = item.status || '-';
  const coordinates = item.coordinates || '-';
  const abnormalDetail = item.abnormalDetail || '';
  const riskLevel = item.riskLevel || '';
  const correctiveAction = item.correctiveAction || '';
  const distanceMeters = item.distanceMeters || '';
  const gpsAccuracy = item.gpsAccuracy || '';
  const mapUrl = item.mapUrl || buildMapEmbedUrl(item.coordinates, 20);

  const image1Url = buildSummaryImageUrlBySlot(item, 1);
  const image2Url = buildSummaryImageUrlBySlot(item, 2);

  const image1Html = buildSummaryImageBox({
    title: 'ภาพตรวจ 1',
    url: image1Url,
    fallbackFileId: item.image1FileId
  });

  const image2Html = buildSummaryImageBox({
    title: 'ภาพตรวจ 2',
    url: image2Url,
    fallbackFileId: item.image2FileId
  });

  const mapOrPointDataHtml = showMap
    ? buildSummaryMapBox(mapUrl, coordinates)
    : buildSummaryPointDataBox({
        point,
        coordinates,
        status,
        workShift,
        inspector
      });

  const abnormalHtml = isAbnormal
    ? `
      <div class="summary-abnormal-detail summary-abnormal-complete">
        <div>
          <b>รายละเอียดผิดปกติ:</b>
          <span>${escapeHtml(abnormalDetail || '-')}</span>
        </div>

        <div class="summary-detail-grid">
          <span><b>ระดับ:</b> ${escapeHtml(riskLevel || '-')}</span>
          <span><b>การแก้ไข:</b> ${escapeHtml(correctiveAction || '-')}</span>
        </div>
      </div>
    `
    : `
      <div class="summary-normal-detail">
        ผลตรวจปกติ ไม่พบความผิดปกติจากการตรวจรอบนี้
      </div>
    `;

  const gpsHtml = `
    <div class="summary-gps-line">
      <span><b>พิกัด:</b> ${escapeHtml(coordinates)}</span>
      ${distanceMeters ? `<span><b>ระยะห่าง:</b> ${escapeHtml(distanceMeters)} ม.</span>` : ''}
      ${gpsAccuracy ? `<span><b>GPS:</b> ±${escapeHtml(gpsAccuracy)} ม.</span>` : ''}
    </div>
  `;

  return `
    <article class="summary-item-card summary-item-complete ${isCapture ? 'capture-item-card' : ''} ${isAbnormal ? 'abnormal' : 'normal'}">

      <div class="summary-item-main">
        <div>
          <div class="summary-item-title-row">
            <span class="summary-item-index">${index + 1}</span>
            <h3>${escapeHtml(point)}</h3>
          </div>

          <p>
            วันที่: ${escapeHtml(date || '-')} |
            เวลา: ${escapeHtml(time)} |
            กะ: ${escapeHtml(workShift)}
          </p>

          <p>
            ผู้ตรวจ: ${escapeHtml(inspector)}
          </p>
        </div>

        <span class="status-pill ${isAbnormal ? 'bad' : 'good'}">
          ${escapeHtml(status)}
        </span>
      </div>

      ${abnormalHtml}

      ${gpsHtml}

      <div class="summary-media-row summary-media-row-complete">
        ${image1Html}
        ${image2Html}
        ${mapOrPointDataHtml}
      </div>

    </article>
  `;
}

function buildSummaryMapBox(mapUrl, coordinates) {
  if (!mapUrl) {
    return `
      <div class="summary-media-box summary-media-empty">
        <div class="summary-media-title">แผนที่</div>
        <span>ไม่มีแผนที่</span>
      </div>
    `;
  }

  return `
    <div class="summary-media-box summary-map-box">
      <div class="summary-media-title">แผนที่</div>
      <iframe
        src="${escapeAttr(mapUrl)}"
        loading="lazy"
        referrerpolicy="no-referrer-when-downgrade">
      </iframe>
    </div>
  `;
}

function buildSummaryPointDataBox({ point, coordinates, status, workShift, inspector }) {
  return `
    <div class="summary-media-box summary-point-data-box">
      <div class="summary-media-title">ข้อมูลจุดตรวจ</div>
      <div class="summary-point-data">
        <strong>${escapeHtml(status || '-')}</strong>
        <span>กะ ${escapeHtml(workShift || '-')}</span>
        <small>${escapeHtml(coordinates || '-')}</small>
      </div>
    </div>
  `;
}

function buildSummaryImageBox({ title, url, fallbackFileId }) {
  if (!url) {
    return `
      <div class="summary-media-box summary-media-empty">
        <div class="summary-media-title">${escapeHtml(title)}</div>
        <span>ไม่มีภาพ</span>
      </div>
    `;
  }

  const fallback = fallbackFileId ? buildDriveFallbackImageUrl(fallbackFileId) : '';

  return `
    <div class="summary-media-box">
      <div class="summary-media-title">${escapeHtml(title)}</div>
      <img
        src="${escapeAttr(url)}"
        alt="${escapeAttr(title)}"
        loading="lazy"
        crossorigin="anonymous"
        referrerpolicy="no-referrer"
        onerror="this.onerror=null;${fallback ? `this.src='${escapeAttr(fallback)}';` : `this.parentElement.classList.add('summary-media-empty');this.remove();`}"
      >
    </div>
  `;
}

function bindSummaryTabs(data) {
  document.querySelectorAll('.summary-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const date = btn.dataset.date;
      Swal.close();

      setTimeout(() => {
        renderSummaryPopup(data, date);
      }, 100);
    });
  });
}

/************************************************************
 * Copy Summary Text
 * ไม่มีลิงก์ภาพ / ไม่มีลิงก์แผนที่
 ************************************************************/

async function copySummaryText(day) {
  const items = Array.isArray(day.items) ? day.items : [];
  const filterInspector = STATE.activeSummaryFilters.inspector || STATE.inspector || '-';
  const filterShift = STATE.activeSummaryFilters.workShift || 'ทุกกะ';
  const inspectorsText = day.inspectors && day.inspectors.length ? day.inspectors.join(', ') : '-';

  let text = '';
  text += `สรุปผลตรวจจุดเสี่ยง\n`;
  text += `วันที่รอบงาน: ${day.date || '-'}\n`;
  text += `ผู้ตรวจที่กรอง: ${filterInspector}\n`;
  text += `กะทำงานที่กรอง: ${filterShift}\n`;
  text += `ผู้ตรวจในข้อมูล: ${inspectorsText}\n`;
  text += `ตรวจทั้งหมด: ${Number(day.total || 0)} จุด\n`;
  text += `ปกติ: ${Number(day.normal || 0)} จุด\n`;
  text += `ผิดปกติ: ${Number(day.abnormal || 0)} จุด\n`;

  if (!items.length) {
    text += `\nไม่พบข้อมูลการตรวจในเงื่อนไขนี้\n`;
  } else {
    text += `\nรายละเอียดทุกจุดตรวจ\n`;

    items.forEach((item, index) => {
      const isAbnormal = item.status === 'ผิดปกติ';

      text += `\n${index + 1}. ${item.point || '-'}\n`;
      text += `วันที่: ${item.date || item.workDate || day.date || '-'}\n`;
      text += `เวลา: ${item.time || extractTimeFromTimestamp(item.timestamp) || '-'}\n`;
      text += `ผู้ตรวจ: ${item.inspector || '-'}\n`;
      text += `กะ: ${item.workShift || '-'}\n`;
      text += `ผลตรวจ: ${item.status || '-'}\n`;
      text += `พิกัด: ${item.coordinates || '-'}\n`;

      if (item.distanceMeters) {
        text += `ระยะห่างจากจุดเสี่ยง: ${item.distanceMeters} เมตร\n`;
      }

      if (item.gpsAccuracy) {
        text += `ความแม่นยำ GPS: ±${item.gpsAccuracy} เมตร\n`;
      }

      if (isAbnormal) {
        text += `รายละเอียดผิดปกติ: ${item.abnormalDetail || '-'}\n`;
        text += `ระดับความเสี่ยง: ${item.riskLevel || '-'}\n`;
        text += `แนวทางแก้ไข/ติดตาม: ${item.correctiveAction || '-'}\n`;
      } else {
        text += `รายละเอียด: ปกติ ไม่พบความผิดปกติ\n`;
      }
    });
  }

  try {
    await navigator.clipboard.writeText(text);

    await Swal.fire({
      icon: 'success',
      title: 'คัดลอกข้อความทั้งหมดแล้ว',
      text: 'คัดลอกเฉพาะข้อมูลเรียบร้อย ไม่มีลิงก์ภาพหรือแผนที่',
      timer: 1300,
      showConfirmButton: false,
      customClass: getSwalClass()
    });

  } catch (err) {
    await Swal.fire({
      title: 'คัดลอกข้อความ',
      html: `
        <textarea
          style="width:100%;height:360px;border:1px solid #d9e5f2;border-radius:12px;padding:10px;font-family:monospace;font-size:12px;"
          readonly
        >${escapeHtml(text)}</textarea>
      `,
      confirmButtonText: 'ปิด',
      customClass: getSwalClass()
    });
  }
}

/************************************************************
 * Capture View
 * สำคัญ: ไม่ปิด Swal ก่อนแคป เพื่อให้ DOM ยังอยู่
 ************************************************************/

function openSummaryCaptureView(day) {
  injectSummaryCaptureStyles();

  Swal.fire({
    title: '',
    html: buildSummaryCaptureHtml(day),
    width: '96%',
    showConfirmButton: true,
    showDenyButton: true,
    confirmButtonText: 'ปิด',
    denyButtonText: 'คัดลอกข้อความทั้งหมด',
    showCancelButton: false,
    customClass: {
      popup: 'risk-report-popup risk-report-popup-complete capture-mode-popup',
      htmlContainer: 'risk-report-html capture-mode-html',
      confirmButton: 'risk-report-confirm',
      denyButton: 'risk-report-copy'
    },
    didOpen: () => {
      const captureArea = document.getElementById('riskReportCapturePage');
      const btn = document.getElementById('downloadSummaryPngBtn');

      if (captureArea) {
        captureArea.scrollTop = 0;
      }

      if (btn) {
        btn.addEventListener('click', async () => {
          await captureSummaryReportAsImage(day);
        });
      }
    }
  }).then(async result => {
    if (result.isDenied) {
      await copySummaryText(day);
    }
  });
}

function buildSummaryCaptureHtml(day) {
  const items = Array.isArray(day.items) ? day.items : [];
  const filterInspector = STATE.activeSummaryFilters.inspector || STATE.inspector || '-';
  const filterShift = STATE.activeSummaryFilters.workShift || 'ทุกกะ';

  const itemsHtml = items.length
    ? items.map((item, index) => buildSummaryItemCard(item, index, {
        mode: 'capture',
        showMap: false
      })).join('')
    : `
      <div class="summary-empty">
        <strong>ไม่พบข้อมูลการตรวจในวันนี้</strong>
      </div>
    `;

  return `
    <div class="risk-report-capture capture-page" id="riskReportCapturePage">

      <div class="capture-page-header">
        <img src="${LOGO_URL}" alt="logo">
        <div>
          <h2>สรุปผลตรวจจุดเสี่ยง</h2>
          <p>วันที่รอบงาน ${escapeHtml(day.date || '-')}</p>
          <p>ผู้ตรวจ: ${escapeHtml(filterInspector)} | กะ: ${escapeHtml(filterShift)}</p>
        </div>
      </div>

      <div class="capture-page-stats">
        <div>ทั้งหมด <b>${Number(day.total || 0)}</b></div>
        <div>ปกติ <b>${Number(day.normal || 0)}</b></div>
        <div class="${Number(day.abnormal || 0) > 0 ? 'danger' : ''}">
          ผิดปกติ <b>${Number(day.abnormal || 0)}</b>
        </div>
      </div>

      <div class="capture-page-note">
        ภาพรายงานนี้ตัด Map ออกแล้ว และใช้ข้อมูลจุดตรวจ/พิกัดแทนในช่องที่ 3
      </div>

      <button id="downloadSummaryPngBtn" type="button" class="download-summary-png-btn">
        ดาวน์โหลดภาพรายงาน PNG
      </button>

      <div class="summary-items summary-items-complete">
        ${itemsHtml}
      </div>

    </div>
  `;
}

async function captureSummaryReportAsImage(day) {
  const target = document.getElementById('riskReportCapturePage');

  if (!target) {
    showWarning('ไม่พบพื้นที่รายงานสำหรับสร้างภาพ');
    return;
  }

  const btn = document.getElementById('downloadSummaryPngBtn');

  let originalMaxHeight = '';
  let originalOverflow = '';
  let originalHeight = '';
  let originalWidth = '';
  let originalScrollTop = 0;
  let originalBtnDisplay = '';

  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'กำลังสร้างภาพ...';
      originalBtnDisplay = btn.style.display;
      btn.style.display = 'none';
    }

    await ensureHtml2CanvasLoaded();

    originalScrollTop = target.scrollTop;
    originalMaxHeight = target.style.maxHeight;
    originalOverflow = target.style.overflow;
    originalHeight = target.style.height;
    originalWidth = target.style.width;

    target.scrollTop = 0;
    target.style.maxHeight = 'none';
    target.style.overflow = 'visible';
    target.style.height = 'auto';
    target.style.width = target.offsetWidth + 'px';

    await waitForImagesInElement(target, 9000);
    await delay(500);

    const canvas = await window.html2canvas(target, {
      backgroundColor: '#ffffff',
      scale: Math.min(window.devicePixelRatio || 2, 2),
      useCORS: true,
      allowTaint: false,
      logging: false,
      scrollX: 0,
      scrollY: 0,
      windowWidth: target.scrollWidth,
      windowHeight: target.scrollHeight,
      width: target.scrollWidth,
      height: target.scrollHeight
    });

    const imageData = canvas.toDataURL('image/png');
    const fileName = buildSummaryImageFileName(day);

    downloadBase64Image(imageData, fileName);

    await Swal.fire({
      icon: 'success',
      title: 'สร้างภาพรายงานสำเร็จ',
      text: 'ระบบดาวน์โหลดภาพ PNG เรียบร้อยแล้ว',
      timer: 1400,
      showConfirmButton: false,
      customClass: getSwalClass()
    });

  } catch (err) {
    await Swal.fire({
      icon: 'error',
      title: 'สร้างภาพไม่สำเร็จ',
      html: `
        <div style="text-align:left;line-height:1.55">
          <p><b>รายละเอียด:</b> ${escapeHtml(err.message || String(err))}</p>
          <p><b>สาเหตุที่เป็นไปได้:</b></p>
          <p>1. รูปจาก Google Drive บางรูปติดสิทธิ์ CORS</p>
          <p>2. รายงานยาวมากจนหน่วยความจำมือถือไม่พอ</p>
          <p>3. อินเทอร์เน็ตโหลดภาพไม่ครบ</p>
          <p><b>แนะนำ:</b> ใช้ Long Screenshot ในโหมดรายงานนี้ หรือกดคัดลอกข้อความทั้งหมด</p>
        </div>
      `,
      confirmButtonText: 'ตกลง',
      customClass: getSwalClass()
    });

  } finally {
    target.style.maxHeight = originalMaxHeight;
    target.style.overflow = originalOverflow;
    target.style.height = originalHeight;
    target.style.width = originalWidth;
    target.scrollTop = originalScrollTop;

    if (btn) {
      btn.disabled = false;
      btn.textContent = 'ดาวน์โหลดภาพรายงาน PNG';
      btn.style.display = originalBtnDisplay;
    }
  }
}

function ensureHtml2CanvasLoaded() {
  return new Promise((resolve, reject) => {
    if (typeof window.html2canvas === 'function') {
      resolve();
      return;
    }

    const existing = document.getElementById('html2canvasScript');

    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', () => reject(new Error('โหลด html2canvas ไม่สำเร็จ')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = 'html2canvasScript';
    script.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
    script.async = true;

    script.onload = () => resolve();
    script.onerror = () => reject(new Error('โหลด html2canvas ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ต'));

    document.head.appendChild(script);
  });
}

function waitForImagesInElement(element, timeoutMs = 9000) {
  return new Promise(resolve => {
    const images = Array.from(element.querySelectorAll('img'));

    if (!images.length) {
      resolve();
      return;
    }

    let completed = 0;
    let done = false;

    const finishOne = () => {
      completed += 1;

      if (!done && completed >= images.length) {
        done = true;
        resolve();
      }
    };

    setTimeout(() => {
      if (!done) {
        done = true;
        resolve();
      }
    }, timeoutMs);

    images.forEach(img => {
      if (img.complete) {
        finishOne();
      } else {
        img.onload = () => finishOne();
        img.onerror = () => finishOne();
      }
    });
  });
}

function downloadBase64Image(base64, fileName) {
  const link = document.createElement('a');

  link.href = base64;
  link.download = fileName || 'risk-point-summary.png';

  document.body.appendChild(link);
  link.click();

  setTimeout(() => {
    link.remove();
  }, 300);
}

function buildSummaryImageFileName(day) {
  const date = String(day?.date || '')
    .replace(/\//g, '-')
    .replace(/\s+/g, '_');

  const inspector = String(STATE.activeSummaryFilters.inspector || STATE.inspector || 'inspector')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '_');

  const shift = String(STATE.activeSummaryFilters.workShift || 'all')
    .replace(/[\\/:*?"<>|]/g, '');

  return `สรุปจุดเสี่ยง_${date || 'date'}_${inspector}_กะ${shift}.png`;
}

function buildSummaryImageUrlBySlot(item, slot) {
  const fileId = String(item[`image${slot}FileId`] || '').trim();
  const url = String(item[`image${slot}Url`] || '').trim();

  if (fileId) {
    return `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w1000`;
  }

  const extractedId = extractDriveFileIdFromUrl(url);
  if (extractedId) {
    return `https://drive.google.com/thumbnail?id=${encodeURIComponent(extractedId)}&sz=w1000`;
  }

  return url;
}

function extractTimeFromTimestamp(timestamp) {
  const text = String(timestamp || '').trim();

  if (!text) return '';

  const match = text.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
  return match ? match[1] : '';
}

function injectSummaryCaptureStyles() {
  if (document.getElementById('riskSummaryCaptureStyles')) return;

  const style = document.createElement('style');
  style.id = 'riskSummaryCaptureStyles';

  style.textContent = `
    .risk-report-popup-complete {
      width: min(96vw, 760px) !important;
      border-radius: 22px !important;
      overflow: hidden !important;
    }

    .risk-report-popup-complete .swal2-actions {
      gap: 8px !important;
      padding: 0 10px 12px !important;
      margin-top: 8px !important;
    }

    .risk-report-capture {
      max-height: min(78vh, 760px) !important;
      overflow-y: auto !important;
      padding: 12px !important;
    }

    .summary-capture-note {
      display: grid;
      gap: 2px;
      margin: 8px 0;
      padding: 8px 10px;
      border-radius: 14px;
      background: #f8fafc;
      border: 1px dashed #d9e5f2;
      color: #64748b;
      font-size: 12px;
      line-height: 1.35;
    }

    .summary-capture-note strong {
      color: #073b66;
      font-family: var(--font-heading, "Prompt", system-ui, sans-serif);
    }

    .summary-items-complete {
      display: grid !important;
      gap: 9px !important;
    }

    .summary-item-complete {
      padding: 10px !important;
      border-radius: 16px !important;
      page-break-inside: avoid;
      break-inside: avoid;
    }

    .summary-item-title-row {
      display: flex;
      align-items: flex-start;
      gap: 7px;
      min-width: 0;
    }

    .summary-item-index {
      flex: 0 0 auto;
      width: 22px;
      height: 22px;
      display: inline-grid;
      place-items: center;
      border-radius: 8px;
      background: #e8f2fc;
      color: #073b66;
      font-family: var(--font-heading, "Prompt", system-ui, sans-serif);
      font-size: 11px;
      font-weight: 900;
    }

    .summary-item-complete .summary-item-main h3 {
      margin: 0 !important;
      font-size: 14px !important;
      line-height: 1.25 !important;
    }

    .summary-item-complete .summary-item-main p {
      margin: 2px 0 0 !important;
      font-size: 11.5px !important;
      line-height: 1.3 !important;
    }

    .summary-abnormal-complete {
      display: grid;
      gap: 5px;
      margin-top: 7px !important;
      padding: 7px 8px !important;
      font-size: 11.5px !important;
      line-height: 1.35 !important;
    }

    .summary-normal-detail {
      margin-top: 7px;
      padding: 7px 8px;
      border-radius: 12px;
      background: #dcfce7;
      color: #15803d;
      font-size: 11.5px;
      font-weight: 700;
      line-height: 1.35;
    }

    .summary-detail-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 3px;
    }

    .summary-gps-line {
      display: grid;
      gap: 2px;
      margin-top: 7px;
      padding: 7px 8px;
      border-radius: 12px;
      background: #f8fafc;
      color: #334155;
      font-size: 11.3px;
      line-height: 1.3;
    }

    .summary-media-row-complete {
      display: grid !important;
      grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
      gap: 6px !important;
      margin-top: 7px !important;
    }

    .summary-media-box {
      position: relative;
      height: 82px;
      overflow: hidden;
      border-radius: 12px;
      border: 1px solid #d9e5f2;
      background: #f1f5f9;
    }

    .summary-media-box img,
    .summary-media-box iframe {
      width: 100%;
      height: 100%;
      object-fit: cover;
      border: 0;
      display: block;
    }

    .summary-media-title {
      position: absolute;
      z-index: 2;
      left: 5px;
      top: 5px;
      padding: 2px 6px;
      border-radius: 999px;
      background: rgba(15, 23, 42, 0.7);
      color: #fff;
      font-size: 9.5px;
      font-weight: 800;
      line-height: 1.2;
    }

    .summary-media-empty {
      display: grid;
      place-items: center;
      color: #64748b;
      font-size: 11px;
      text-align: center;
    }

    .summary-media-empty .summary-media-title {
      background: rgba(100, 116, 139, 0.7);
    }

    .summary-point-data-box {
      display: block !important;
      background: #f8fafc !important;
    }

    .summary-point-data {
      height: 100%;
      padding: 24px 7px 7px;
      display: grid;
      align-content: center;
      gap: 2px;
      text-align: center;
    }

    .summary-point-data strong {
      color: #073b66;
      font-family: var(--font-heading, "Prompt", system-ui, sans-serif);
      font-size: 12px;
    }

    .summary-point-data span {
      color: #334155;
      font-size: 10.5px;
      font-weight: 700;
    }

    .summary-point-data small {
      color: #64748b;
      font-size: 8.5px;
      line-height: 1.25;
      word-break: break-all;
    }

    .download-summary-png-btn {
      width: 100%;
      min-height: 42px;
      margin: 8px 0;
      border: 0;
      border-radius: 13px;
      background: linear-gradient(135deg, #15803d, #16a34a);
      color: #fff;
      font-family: var(--font-heading, "Prompt", system-ui, sans-serif);
      font-weight: 900;
      cursor: pointer;
    }

    .download-summary-png-btn:disabled {
      opacity: 0.65;
      cursor: wait;
    }

    .risk-report-image-btn {
      background: linear-gradient(135deg, #15803d, #16a34a) !important;
      color: #fff !important;
      border-radius: 13px !important;
      padding: 10px 18px !important;
      font-family: var(--font-heading, "Prompt", system-ui, sans-serif) !important;
      font-weight: 800 !important;
    }

    .capture-mode-popup {
      width: min(96vw, 820px) !important;
    }

    .capture-mode-html {
      overflow: hidden !important;
    }

    .capture-page {
      width: 760px;
      max-width: 100%;
      max-height: 80vh !important;
      overflow-y: auto !important;
      background: #ffffff !important;
      margin: 0 auto;
    }

    .capture-page-header {
      display: grid;
      grid-template-columns: 48px 1fr;
      gap: 10px;
      align-items: center;
      padding: 10px;
      border-radius: 16px;
      background: linear-gradient(135deg, #073b66, #0d5b93);
      color: #fff;
    }

    .capture-page-header img {
      width: 48px;
      height: 48px;
      object-fit: contain;
      padding: 5px;
      border-radius: 14px;
      background: #fff;
    }

    .capture-page-header h2 {
      margin: 0;
      font-family: var(--font-heading, "Prompt", system-ui, sans-serif);
      font-size: 17px;
      line-height: 1.25;
    }

    .capture-page-header p {
      margin: 2px 0 0;
      font-size: 12px;
      opacity: 0.94;
    }

    .capture-page-stats {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 6px;
      margin: 8px 0;
    }

    .capture-page-stats div {
      padding: 7px;
      border-radius: 12px;
      background: #f8fafc;
      border: 1px solid #d9e5f2;
      text-align: center;
      font-size: 12px;
      color: #64748b;
    }

    .capture-page-stats b {
      display: block;
      color: #073b66;
      font-size: 17px;
      font-family: var(--font-heading, "Prompt", system-ui, sans-serif);
    }

    .capture-page-stats .danger b {
      color: #b91c1c;
    }

    .capture-page-note {
      margin-bottom: 8px;
      padding: 7px 8px;
      border-radius: 12px;
      background: #fff7ed;
      color: #9a3412;
      font-size: 11.5px;
      line-height: 1.35;
    }

    @media (max-width: 560px) {
      .risk-report-popup-complete {
        width: calc(100% - 8px) !important;
        border-radius: 18px !important;
      }

      .risk-report-capture {
        padding: 8px !important;
        max-height: 78vh !important;
      }

      .summary-media-row-complete {
        grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
        gap: 5px !important;
      }

      .summary-media-box {
        height: 66px !important;
        border-radius: 10px !important;
      }

      .summary-media-title {
        font-size: 8.5px !important;
        padding: 2px 5px !important;
      }

      .summary-item-complete {
        padding: 7px !important;
        border-radius: 13px !important;
      }

      .summary-item-title-row {
        gap: 5px !important;
      }

      .summary-item-index {
        width: 20px !important;
        height: 20px !important;
        font-size: 10px !important;
      }

      .summary-item-complete .summary-item-main {
        grid-template-columns: minmax(0, 1fr) 56px !important;
        gap: 5px !important;
      }

      .summary-item-complete .summary-item-main h3 {
        font-size: 12.5px !important;
      }

      .summary-item-complete .summary-item-main p {
        font-size: 10.5px !important;
      }

      .summary-abnormal-complete,
      .summary-normal-detail,
      .summary-gps-line {
        padding: 6px !important;
        font-size: 10.5px !important;
        border-radius: 10px !important;
      }

      .summary-capture-note {
        display: none !important;
      }

      .risk-report-popup-complete .swal2-actions {
        display: grid !important;
        grid-template-columns: 1fr !important;
      }

      .risk-report-popup-complete .swal2-actions button {
        width: 100% !important;
        margin: 0 !important;
      }
    }
  `;

  document.head.appendChild(style);
}
/************************************************************
 * GPS
 ************************************************************/

function requireGpsLocation() {
  return new Promise((resolve, reject) => {
    if (!window.isSecureContext) {
      reject(new Error('ระบบ GPS ต้องใช้งานผ่าน HTTPS เท่านั้น'));
      return;
    }

    if (!navigator.geolocation) {
      reject(new Error('อุปกรณ์นี้ไม่รองรับ GPS กรุณาใช้อุปกรณ์ที่รองรับตำแหน่ง'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      position => {
        const coords = position.coords;
        resolve({
          latitude: Number(coords.latitude).toFixed(8),
          longitude: Number(coords.longitude).toFixed(8),
          accuracy: coords.accuracy ? Math.round(coords.accuracy) : '',
          timestamp: new Date().toISOString(),
          mapUrl: `https://maps.google.com/maps?q=${coords.latitude},${coords.longitude}&z=20&t=k&output=embed`
        });
      },
      error => {
        let message = 'ไม่สามารถอ่านตำแหน่ง GPS ได้';
        if (error.code === error.PERMISSION_DENIED) message = 'กรุณาอนุญาตสิทธิ์ตำแหน่ง GPS ก่อนบันทึก หากเคยกดบล็อก ให้เปิด Site settings แล้ว Allow Location';
        else if (error.code === error.POSITION_UNAVAILABLE) message = 'ไม่พบสัญญาณ GPS กรุณาเปิด Location/GPS แล้วลองใหม่';
        else if (error.code === error.TIMEOUT) message = 'อ่านตำแหน่ง GPS ไม่ทันเวลา กรุณาเปิด GPS แล้วลองใหม่อีกครั้ง';
        reject(new Error(message));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

/************************************************************
 * Image Compression
 ************************************************************/

function compressImage(file, options = {}) {
  const maxWidth = options.maxWidth || 1280;
  const quality = options.quality || 0.78;

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = e => {
      const img = new Image();

      img.onload = () => {
        const canvas = document.createElement('canvas');

        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const base64 = canvas.toDataURL('image/jpeg', quality);

        resolve({
          name: file.name || 'photo.jpg',
          mimeType: 'image/jpeg',
          base64,
          size: Math.round((base64.length * 3) / 4)
        });
      };

      img.onerror = () => reject(new Error('อ่านรูปภาพไม่สำเร็จ'));
      img.src = e.target.result;
    };

    reader.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ'));
    reader.readAsDataURL(file);
  });
}

/************************************************************
 * UI Helpers
 ************************************************************/

function showSection(sectionId) {
  document.querySelectorAll('.page-section').forEach(sec => {
    sec.classList.remove('active');
  });

  $(`#${sectionId}`)?.classList.add('active');
}

function showLoading(title = 'กำลังดำเนินการ...') {
  Swal.fire({
    title,
    allowOutsideClick: false,
    allowEscapeKey: false,
    showConfirmButton: false,
    customClass: getSwalClass(),
    didOpen: () => {
      Swal.showLoading();
    }
  });
}

function showError(message) {
  Swal.fire({
    icon: 'error',
    title: 'เกิดข้อผิดพลาด',
    text: message || 'ไม่สามารถดำเนินการได้',
    confirmButtonText: 'ตกลง',
    customClass: getSwalClass()
  });
}

function showWarning(message) {
  Swal.fire({
    icon: 'warning',
    title: 'ตรวจสอบข้อมูล',
    text: message || 'กรุณาตรวจสอบข้อมูลอีกครั้ง',
    confirmButtonText: 'ตกลง',
    customClass: getSwalClass()
  });
}

function getSwalClass() {
  return {
    popup: 'custom-swal-popup',
    title: 'custom-swal-title',
    htmlContainer: 'custom-swal-html',
    confirmButton: 'custom-swal-confirm',
    cancelButton: 'custom-swal-cancel'
  };
}

function setButtonLoading(id, loading, text) {
  const btn = $(`#${id}`);

  if (!btn) return;

  btn.disabled = loading;
  btn.textContent = text;
}

function setText(id, text) {
  const el = $(`#${id}`);

  if (el) {
    el.textContent = text;
  }
}

/************************************************************
 * Date Helpers
 ************************************************************/

function toInputDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');

  return `${y}-${m}-${d}`;
}

function inputDateToThai(inputDate) {
  if (!inputDate) return '';

  const [y, m, d] = inputDate.split('-');

  return `${d}/${m}/${y}`;
}

function thaiDateToInput(thaiDate) {
  if (!thaiDate) return '';

  const [d, m, y] = thaiDate.split('/');

  return `${y}-${m}-${d}`;
}

/************************************************************
 * Escape Helpers
 ************************************************************/

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#096;');
}

/************************************************************
 * Dynamic Styles
 ************************************************************/

function injectDynamicStyles() {
  if (document.getElementById('riskPointDynamicStyle')) return;

  const style = document.createElement('style');
  style.id = 'riskPointDynamicStyle';

  style.textContent = `
    .checked-point-card {
      border-color: rgba(21, 128, 61, 0.25);
    }

    .close-map-box iframe {
      filter: contrast(1.06) saturate(1.06);
    }

    .latest-inspection-box {
      display: grid;
      gap: 2px;
      padding: 10px 11px;
      border-radius: 15px;
      border: 1px solid var(--border, #dbe3ef);
      background: #f8fafc;
    }

    .latest-inspection-box span {
      font-size: 12px;
      color: var(--text-muted, #64748b);
    }

    .latest-inspection-box strong {
      color: var(--primary, #0f3d66);
      font-family: var(--font-heading, "Prompt", system-ui, sans-serif);
      font-size: 14px;
      line-height: 1.35;
    }

    .latest-inspection-box small {
      color: var(--text-muted, #64748b);
      font-size: 12px;
    }

    .latest-good {
      background: var(--success-soft, #dcfce7);
      border-color: rgba(21, 128, 61, 0.22);
    }

    .latest-good strong {
      color: var(--success, #15803d);
    }

    .latest-bad {
      background: var(--danger-soft, #fee2e2);
      border-color: rgba(185, 28, 28, 0.22);
    }

    .latest-bad strong {
      color: var(--danger, #b91c1c);
    }

    .latest-none {
      background: #f8fafc;
      border-style: dashed;
    }

    .camera-choice-box {
      text-align: center;
      padding: 4px 0 0;
    }

    .camera-choice-box p {
      margin: 8px 0 12px;
      color: var(--text-muted, #64748b);
      font-size: 14px;
    }

    .camera-choice-actions {
      display: grid;
      gap: 9px;
    }

    .camera-choice-primary,
    .camera-choice-secondary {
      min-height: 48px;
      border: 0;
      border-radius: 15px;
      padding: 10px 14px;
      font-family: var(--font-heading, "Prompt", system-ui, sans-serif);
      font-weight: 800;
      cursor: pointer;
    }

    .camera-choice-primary {
      background: linear-gradient(135deg, var(--primary, #0f3d66), var(--primary-2, #155a92));
      color: #fff;
      box-shadow: 0 10px 24px rgba(15, 61, 102, 0.22);
    }

    .camera-choice-secondary {
      background: var(--primary-soft, #e7f1fb);
      color: var(--primary, #0f3d66);
      border: 1px solid rgba(21, 90, 146, 0.13);
    }

    .camera-choice-note {
      display: block;
      margin-top: 10px;
      color: var(--text-muted, #64748b);
      font-size: 12px;
      line-height: 1.45;
    }

    .camera-swal-popup {
      border-radius: 24px !important;
      padding: 0 !important;
      overflow: hidden !important;
      background: #f8fafc !important;
      font-family: "Sarabun", system-ui, sans-serif !important;
    }

    .camera-swal-html {
      margin: 0 !important;
      padding: 0 !important;
    }

    .camera-modal {
      padding: 14px;
      text-align: left;
    }

    .camera-header {
      display: grid;
      grid-template-columns: 52px 1fr;
      gap: 12px;
      align-items: center;
      margin-bottom: 12px;
      padding: 12px;
      border-radius: 20px;
      background: linear-gradient(135deg, #0f3d66, #155a92);
      color: #fff;
    }

    .camera-header img {
      width: 52px;
      height: 52px;
      padding: 5px;
      border-radius: 14px;
      background: #fff;
      object-fit: contain;
    }

    .camera-header h3 {
      margin: 0;
      font-family: "Prompt", system-ui, sans-serif;
      font-size: 20px;
    }

    .camera-header p {
      margin: 3px 0 0;
      font-size: 13px;
      opacity: 0.92;
    }

    .camera-video-wrap {
      position: relative;
      width: 100%;
      height: min(62vh, 520px);
      min-height: 320px;
      overflow: hidden;
      border-radius: 22px;
      background: #020617;
      border: 1px solid #cbd5e1;
    }

    #riskCameraVideo {
      width: 100%;
      height: 100%;
      object-fit: cover;
      background: #020617;
    }

    .camera-status {
      position: absolute;
      left: 12px;
      right: 12px;
      bottom: 12px;
      padding: 10px 12px;
      border-radius: 14px;
      background: rgba(15, 23, 42, 0.72);
      color: #fff;
      font-weight: 700;
      text-align: center;
      transition: opacity .2s ease;
    }

    .camera-actions {
      display: grid;
      grid-template-columns: 1.2fr .9fr .9fr;
      gap: 8px;
      margin-top: 12px;
    }

    .camera-primary-btn,
    .camera-soft-btn {
      min-height: 46px;
      border: 0;
      border-radius: 14px;
      padding: 10px;
      font-family: "Prompt", system-ui, sans-serif;
      font-weight: 800;
      cursor: pointer;
    }

    .camera-primary-btn {
      background: linear-gradient(135deg, #0f3d66, #155a92);
      color: #fff;
    }

    .camera-soft-btn {
      background: #e7f1fb;
      color: #0f3d66;
    }

    .shift-hint-box {
      display: grid;
      gap: 4px;
      padding: 10px 12px;
      border-radius: 16px;
      background: var(--warning-soft, #fef3c7);
      border: 1px solid rgba(180, 83, 9, 0.22);
      color: #78350f;
      font-size: 13px;
      line-height: 1.45;
    }

    .shift-hint-box strong {
      font-family: var(--font-heading, "Prompt", system-ui, sans-serif);
      color: #92400e;
    }

    .summary-filter-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      align-items: end;
    }

    .summary-filter-item small,
    .summary-picker-note {
      display: block;
      margin-top: 5px;
      color: var(--text-muted, #64748b);
      font-size: 12px;
      line-height: 1.35;
    }

    .full-inline-btn {
      width: 100%;
    }

    .swal-field-label {
      display: block;
      margin: 10px 0 5px;
      font-family: var(--font-heading, "Prompt", system-ui, sans-serif);
      font-weight: 800;
      font-size: 13px;
      color: var(--primary, #0f3d66);
      text-align: left;
    }

    .risk-report-inspectors small {
      display: block;
      margin-top: 3px;
      color: var(--text-muted, #64748b);
      font-size: 12px;
      line-height: 1.35;
    }

    @media (max-width: 560px) {
      .camera-video-wrap {
        height: 58vh;
        min-height: 280px;
      }

      .camera-actions {
        grid-template-columns: 1fr;
      }

      .camera-header h3 {
        font-size: 18px;
      }

      .latest-inspection-box {
        padding: 9px 10px;
      }

      .latest-inspection-box strong {
        font-size: 13px;
      }

      .summary-filter-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .summary-filter-action {
        grid-column: 1 / -1;
      }

      .work-round-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
  `;

  document.head.appendChild(style);
}

/************************************************************
 * Selector
 ************************************************************/

function buildSummaryImageUrl(item) {
  const fileId = String(item.image1FileId || '').trim();

  if (fileId) {
    return `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w900`;
  }

  const url = String(item.image1Url || '').trim();
  const extractedId = extractDriveFileIdFromUrl(url);

  if (extractedId) {
    return `https://drive.google.com/thumbnail?id=${encodeURIComponent(extractedId)}&sz=w900`;
  }

  return url;
}

function buildDriveFallbackImageUrl(fileId) {
  const id = String(fileId || '').trim();

  if (!id) return '';

  return `https://lh3.googleusercontent.com/d/${encodeURIComponent(id)}=w900`;
}

function extractDriveFileIdFromUrl(url) {
  const text = String(url || '').trim();
  if (!text) return '';

  let match = text.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match && match[1]) return match[1];

  match = text.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (match && match[1]) return match[1];

  return '';
}

function $(selector) {
  return document.querySelector(selector);
}
