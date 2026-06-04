/************************************************************
 * config-security.js
 * ระบบตรวจจุดเสี่ยง Security
 ************************************************************/

window.APP_CONFIG = {
  API_BASE: 'https://riskpoint.somchaibutphon.workers.dev/api',

  // ระบบ Security
  APP_MODULE: 'security',

  LOGO_URL: 'https://lh5.googleusercontent.com/d/1HicYHV18UaA5y4GFyHJaG9aNI-qjIzIY',

  IMAGE_MAX_WIDTH: 960,
  IMAGE_QUALITY: 0.65,

  WORK_SHIFTS: ['A', 'B', 'C', 'DH', 'NH'],
  CROSS_DAY_SHIFTS: ['C', 'NH'],

  STORAGE_KEYS: {
    INSPECTOR: 'riskpoint_inspector',
    LOGIN_TIME: 'riskpoint_login_time',
    WORK_SHIFT: 'riskpoint_work_shift',
    WORK_DATE: 'riskpoint_work_date'
  }
};
