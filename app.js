/************************************************************
 * app.js
 * ระบบบันทึกจุดเสี่ยงในพื้นที่ทำงาน
 ************************************************************/

const API_BASE = window.APP_CONFIG.API_BASE;
const LOGO_URL = window.APP_CONFIG.LOGO_URL;
const IMAGE_MAX_WIDTH = window.APP_CONFIG.IMAGE_MAX_WIDTH || 1280;
const IMAGE_QUALITY = window.APP_CONFIG.IMAGE_QUALITY || 0.8;
const STORAGE_KEYS = window.APP_CONFIG.STORAGE_KEYS;

const STATE = {
  inspector: '',
  points: [],
  filteredPoints: [],
  selectedPoint: null,
  images: {
    1: null,
    2: null
  },
  summaryData: null,
  activeSummaryDate: ''
};

/************************************************************
 * Init
 ************************************************************/

document.addEventListener('DOMContentLoaded', initApp);

function initApp() {
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

  $('#photoInput1')?.addEventListener('change', e => handlePhotoChange(e, 1));
  $('#photoInput2')?.addEventListener('change', e => handlePhotoChange(e, 2));

  $('#inspectionForm')?.addEventListener('submit', handleSaveInspection);
  $('#resetInspectionBtn')?.addEventListener('click', resetInspectionForm);

  $('#openSummaryBtn')?.addEventListener('click', openSummaryPicker);
  $('#showSummaryBtn')?.addEventListener('click', handleShowSummary);
}

function setDefaultDates() {
  const today = toInputDate(new Date());

  if ($('#summaryDateInput')) $('#summaryDateInput').value = today;
  if ($('#workDateInput')) $('#workDateInput').value = today;
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

async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    }
  });

  return parseApiResponse(res);
}

async function apiPost(path, payload) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(payload || {})
  });

  return parseApiResponse(res);
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

  const pass = $('#passInput').value.trim();

  if (!pass) {
    showWarning('กรุณากรอกรหัสผู้ตรวจ');
    return;
  }

  setButtonLoading('loginBtn', true, 'กำลังตรวจสอบ...');

  try {
    const data = await apiPost('/api/login', { pass });

    STATE.inspector = data.inspector;
    localStorage.setItem(STORAGE_KEYS.INSPECTOR, data.inspector);
    localStorage.setItem(STORAGE_KEYS.LOGIN_TIME, new Date().toISOString());

    updateInspectorUI();

    await Swal.fire({
      icon: 'success',
      title: 'เข้าสู่ระบบสำเร็จ',
      text: `ผู้ตรวจ: ${data.inspector}`,
      timer: 1200,
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

    $('#passInput').value = '';
    showSection('loginSection');
  });
}

function updateInspectorUI() {
  setText('welcomeText', `ผู้ตรวจ: ${STATE.inspector}`);
  setText('inspectionInspectorText', `ผู้ตรวจ: ${STATE.inspector}`);
}

/************************************************************
 * Risk Points
 ************************************************************/

async function loadRiskPoints() {
  setButtonLoading('refreshPointsBtn', true, 'กำลังโหลด...');

  try {
    const data = await apiGet('/api/points');

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
  const keyword = ($('#pointSearchInput').value || '').trim().toLowerCase();

  if (!keyword) {
    STATE.filteredPoints = [...STATE.points];
  } else {
    STATE.filteredPoints = STATE.points.filter(item => {
      return (
        String(item.point || '').toLowerCase().includes(keyword) ||
        String(item.coordinates || '').toLowerCase().includes(keyword)
      );
    });
  }

  renderPointCards();
}

function renderPointCards() {
  const box = $('#pointList');
  const empty = $('#emptyPointState');

  box.innerHTML = '';

  if (!STATE.filteredPoints.length) {
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');

  STATE.filteredPoints.forEach((item, index) => {
    const card = document.createElement('article');
    card.className = 'point-card';
    card.innerHTML = `
      <div class="point-card-header">
        <span class="point-index">${index + 1}</span>
        <h3>${escapeHtml(item.point)}</h3>
      </div>

      <div class="map-box point-map-box">
        <iframe
          title="แผนที่ ${escapeHtml(item.point)}"
          src="${escapeAttr(item.mapUrl)}"
          loading="lazy"
          referrerpolicy="no-referrer-when-downgrade">
        </iframe>
      </div>

      <div class="point-meta">
        <span>พิกัด</span>
        <strong>${escapeHtml(item.coordinates)}</strong>
      </div>

      <button type="button" class="primary-btn full-btn">
        ตรวจจุดนี้
      </button>
    `;

    card.querySelector('button').addEventListener('click', () => openInspection(item));
    box.appendChild(card);
  });
}

/************************************************************
 * Inspection Form
 ************************************************************/

function openInspection(point) {
  STATE.selectedPoint = point;
  resetInspectionForm(false);

  setText('selectedPointName', point.point);
  setText('selectedPointCoordinates', `พิกัด: ${point.coordinates}`);
  $('#selectedPointMap').src = point.mapUrl || '';

  showSection('inspectionSection');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function handleStatusChange() {
  const status = $('#statusSelect').value;

  if (status === 'ผิดปกติ') {
    $('#abnormalBox').classList.remove('hidden');
    $('#abnormalDetailInput').setAttribute('required', 'required');
    $('#riskLevelSelect').setAttribute('required', 'required');
  } else {
    $('#abnormalBox').classList.add('hidden');
    $('#abnormalDetailInput').removeAttribute('required');
    $('#riskLevelSelect').removeAttribute('required');

    $('#abnormalDetailInput').value = '';
    $('#riskLevelSelect').value = '';
    $('#correctiveActionInput').value = '';
  }
}

async function handlePhotoChange(e, index) {
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

  box.innerHTML = `
    <img src="${base64}" alt="ภาพที่ ${index}" />
    <div class="photo-ok-badge">ภาพที่ ${index} พร้อมใช้งาน</div>
  `;
}

async function handleSaveInspection(e) {
  e.preventDefault();

  const payload = buildInspectionPayload();

  const validation = validateInspectionPayload(payload);
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
    const data = await apiPost('/api/save', payload);

    await Swal.fire({
      icon: 'success',
      title: 'บันทึกสำเร็จ',
      html: `
        <div class="save-success-box">
          <p><b>จุดเสี่ยง:</b> ${escapeHtml(data.point)}</p>
          <p><b>ผู้ตรวจ:</b> ${escapeHtml(data.inspector)}</p>
          <p><b>เวลา:</b> ${escapeHtml(data.timestamp)}</p>
          <p><b>สถานะ:</b> ${escapeHtml(data.status)}</p>
        </div>
      `,
      confirmButtonText: 'กลับหน้ารายการ',
      customClass: getSwalClass()
    });

    resetInspectionForm();
    showSection('mainSection');

  } catch (err) {
    showError(err.message);
  } finally {
    setButtonLoading('saveInspectionBtn', false, 'บันทึกผลตรวจ');
  }
}

function buildInspectionPayload() {
  const status = $('#statusSelect').value.trim();

  return {
    inspector: STATE.inspector,
    point: STATE.selectedPoint?.point || '',
    coordinates: STATE.selectedPoint?.coordinates || '',
    workDate: inputDateToThai($('#workDateInput').value),
    status,
    abnormalDetail: $('#abnormalDetailInput').value.trim(),
    riskLevel: $('#riskLevelSelect').value.trim(),
    correctiveAction: $('#correctiveActionInput').value.trim(),
    deviceInfo: navigator.userAgent || '',
    images: [
      STATE.images[1],
      STATE.images[2]
    ]
  };
}

function validateInspectionPayload(payload) {
  if (!payload.inspector) {
    return { ok: false, message: 'ไม่พบชื่อผู้ตรวจ กรุณาเข้าสู่ระบบใหม่' };
  }

  if (!payload.point) {
    return { ok: false, message: 'ไม่พบจุดเสี่ยงที่เลือก' };
  }

  if (!payload.workDate) {
    return { ok: false, message: 'กรุณาเลือกวันที่รอบงาน' };
  }

  if (!payload.status) {
    return { ok: false, message: 'กรุณาเลือกสถานะพื้นที่' };
  }

  if (payload.status === 'ผิดปกติ') {
    if (!payload.abnormalDetail) {
      return { ok: false, message: 'กรุณากรอกรายละเอียดความผิดปกติ' };
    }

    if (!payload.riskLevel) {
      return { ok: false, message: 'กรุณาเลือกระดับความเสี่ยง' };
    }
  }

  if (!payload.images[0] || !payload.images[0].base64) {
    return { ok: false, message: 'กรุณาถ่ายภาพที่ 1' };
  }

  if (!payload.images[1] || !payload.images[1].base64) {
    return { ok: false, message: 'กรุณาถ่ายภาพที่ 2' };
  }

  return { ok: true };
}

function resetInspectionForm(clearPoint = true) {
  $('#inspectionForm')?.reset();

  const today = toInputDate(new Date());
  if ($('#workDateInput')) $('#workDateInput').value = today;

  STATE.images[1] = null;
  STATE.images[2] = null;

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
 ************************************************************/

function openSummaryPicker() {
  const date = $('#summaryDateInput')?.value || toInputDate(new Date());

  Swal.fire({
    title: 'เลือกวันที่สรุปผลตรวจ',
    html: `
      <div class="summary-picker-box">
        <img src="${LOGO_URL}" class="summary-picker-logo" alt="logo">
        <p>ระบบจะแสดงข้อมูลก่อนหน้า 1 วัน / วันที่เลือก / ถัดไป 1 วัน</p>
        <input id="swalSummaryDate" type="date" class="swal-date-input" value="${escapeAttr(date)}">
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: 'แสดงสรุป',
    cancelButtonText: 'ยกเลิก',
    customClass: getSwalClass(),
    preConfirm: () => {
      const value = document.getElementById('swalSummaryDate').value;
      if (!value) {
        Swal.showValidationMessage('กรุณาเลือกวันที่');
        return false;
      }
      return value;
    }
  }).then(result => {
    if (result.isConfirmed) {
      $('#summaryDateInput').value = result.value;
      loadSummary(result.value);
    }
  });
}

function handleShowSummary() {
  const date = $('#summaryDateInput').value;

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
    const data = await apiGet(`/api/summary?date=${encodeURIComponent(dateText)}`);

    STATE.summaryData = data;
    STATE.activeSummaryDate = data.selectedDate;

    Swal.close();
    renderSummaryPopup(data, data.selectedDate);

  } catch (err) {
    Swal.close();
    showError(err.message);
  }
}

function renderSummaryPopup(data, activeDate) {
  const day = data.days.find(d => d.date === activeDate) || data.days[1] || data.days[0];

  const html = buildSummaryHtml(data, day);

  Swal.fire({
    title: '',
    html,
    width: '96%',
    showConfirmButton: true,
    showDenyButton: true,
    confirmButtonText: 'ปิด',
    denyButtonText: 'คัดลอกสรุปข้อความ',
    customClass: {
      popup: 'risk-report-popup',
      htmlContainer: 'risk-report-html',
      confirmButton: 'risk-report-confirm',
      denyButton: 'risk-report-copy'
    },
    didOpen: () => {
      bindSummaryTabs(data);
    }
  }).then(result => {
    if (result.isDenied) {
      copySummaryText(day);
      renderSummaryPopup(data, day.date);
    }
  });
}

function buildSummaryHtml(data, day) {
  const inspectorsText = day.inspectors.length ? day.inspectors.join(', ') : '-';

  const tabs = data.days.map(d => {
    const active = d.date === day.date ? 'active' : '';
    return `
      <button type="button" class="summary-tab ${active}" data-date="${escapeAttr(d.date)}">
        ${escapeHtml(d.date)}
        <span>${d.total}</span>
      </button>
    `;
  }).join('');

  const itemsHtml = day.items.length
    ? day.items.map(buildSummaryItemCard).join('')
    : `
      <div class="summary-empty">
        <strong>ไม่พบข้อมูลการตรวจในวันนี้</strong>
        <p>ลองเลือกวันที่ก่อนหน้าหรือถัดไป</p>
      </div>
    `;

  return `
    <div class="risk-report-capture">
      <div class="risk-report-header">
        <img src="${LOGO_URL}" alt="logo">
        <div>
          <h2>สรุปผลตรวจจุดเสี่ยง</h2>
          <p>วันที่ ${escapeHtml(day.date)}</p>
        </div>
      </div>

      <div class="risk-report-stats">
        <div>
          <span>ตรวจทั้งหมด</span>
          <strong>${day.total}</strong>
        </div>
        <div>
          <span>ปกติ</span>
          <strong>${day.normal}</strong>
        </div>
        <div class="${day.abnormal > 0 ? 'danger' : ''}">
          <span>ผิดปกติ</span>
          <strong>${day.abnormal}</strong>
        </div>
      </div>

      <div class="risk-report-inspectors">
        <span>ผู้ตรวจ</span>
        <strong>${escapeHtml(inspectorsText)}</strong>
      </div>

      <div class="summary-tabs">
        ${tabs}
      </div>

      <div class="summary-items">
        ${itemsHtml}
      </div>
    </div>
  `;
}

function buildSummaryItemCard(item, index) {
  const isAbnormal = item.status === 'ผิดปกติ';

  const imageHtml = item.image1Url
    ? `<img src="${escapeAttr(item.image1Url)}" alt="ภาพแรก" loading="lazy">`
    : `<div class="no-image">ไม่มีภาพ</div>`;

  const mapHtml = item.mapUrl
    ? `<iframe src="${escapeAttr(item.mapUrl)}" loading="lazy"></iframe>`
    : `<div class="no-image">ไม่มีแผนที่</div>`;

  return `
    <article class="summary-item-card ${isAbnormal ? 'abnormal' : 'normal'}">
      <div class="summary-item-main">
        <div>
          <h3>${escapeHtml(item.point)}</h3>
          <p>${escapeHtml(item.inspector)} | ${escapeHtml(item.time || '-')}</p>
        </div>

        <span class="status-pill ${isAbnormal ? 'bad' : 'good'}">
          ${escapeHtml(item.status || '-')}
        </span>
      </div>

      ${isAbnormal ? `
        <div class="summary-abnormal-detail">
          <b>รายละเอียด:</b> ${escapeHtml(item.abnormalDetail || '-')}
          ${item.riskLevel ? `<span>ระดับ: ${escapeHtml(item.riskLevel)}</span>` : ''}
        </div>
      ` : ''}

      <div class="summary-media-row">
        <div class="summary-thumb">
          ${imageHtml}
        </div>
        <div class="summary-map">
          ${mapHtml}
        </div>
      </div>
    </article>
  `;
}

function bindSummaryTabs(data) {
  document.querySelectorAll('.summary-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const date = btn.dataset.date;
      Swal.close();
      renderSummaryPopup(data, date);
    });
  });
}

async function copySummaryText(day) {
  const abnormalItems = day.items.filter(x => x.status === 'ผิดปกติ');

  let text = '';
  text += `สรุปผลตรวจจุดเสี่ยง ${day.date}\n`;
  text += `ตรวจทั้งหมด ${day.total} จุด\n`;
  text += `ปกติ ${day.normal} จุด\n`;
  text += `ผิดปกติ ${day.abnormal} จุด\n`;
  text += `ผู้ตรวจ: ${day.inspectors.length ? day.inspectors.join(', ') : '-'}\n`;

  if (abnormalItems.length) {
    text += `\nรายการผิดปกติ:\n`;
    abnormalItems.forEach((item, i) => {
      text += `${i + 1}. ${item.point} - ${item.abnormalDetail || '-'} - ระดับ ${item.riskLevel || '-'}\n`;
    });
  } else {
    text += `\nไม่พบรายการผิดปกติ\n`;
  }

  try {
    await navigator.clipboard.writeText(text);
    await Swal.fire({
      icon: 'success',
      title: 'คัดลอกข้อความแล้ว',
      timer: 1000,
      showConfirmButton: false,
      customClass: getSwalClass()
    });
  } catch (err) {
    await Swal.fire({
      title: 'คัดลอกข้อความ',
      text,
      confirmButtonText: 'ปิด',
      customClass: getSwalClass()
    });
  }
}

/************************************************************
 * Image Compression
 ************************************************************/

function compressImage(file, options = {}) {
  const maxWidth = options.maxWidth || 1280;
  const quality = options.quality || 0.8;

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
  if (el) el.textContent = text;
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
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('`', '&#096;');
}

/************************************************************
 * Selectors
 ************************************************************/

function $(selector) {
  return document.querySelector(selector);
}
