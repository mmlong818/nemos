/* Scramble OS 2026 壁纸系统
 * - 默认 4 张内置壁纸（assets/wallpapers/）
 * - localStorage['clownfish-wallpaper'] 持久化（URL 或 base64 dataURL）
 * - 暴露 window.setWallpaper(url) / window.resetWallpaper() / window.getWallpaper()
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'clownfish-wallpaper';
  var DEFAULT_WALLPAPER = '/assets/wallpapers/wallpaper-ventura.svg';

  var WALLPAPERS = [
    { id: 'ventura',  name: '湖蓝晨光', url: '/assets/wallpapers/wallpaper-ventura.svg' },
    { id: 'sonoma',   name: '索诺玛晚霞', url: '/assets/wallpapers/wallpaper-sonoma.svg' },
    { id: 'monterey', name: '蒙特雷薄暮', url: '/assets/wallpapers/wallpaper-monterey.svg' },
    { id: 'silver',   name: '雾银白昼', url: '/assets/wallpapers/wallpaper-silver.svg' }
  ];

  function apply(url) {
    var value = (url && String(url).trim()) || DEFAULT_WALLPAPER;
    document.documentElement.style.setProperty('--wallpaper-url', 'url("' + value.replace(/"/g, '\\"') + '")');
  }

  function getWallpaper() {
    try {
      return localStorage.getItem(STORAGE_KEY) || DEFAULT_WALLPAPER;
    } catch (e) {
      return DEFAULT_WALLPAPER;
    }
  }

  function setWallpaper(url) {
    var value = (url && String(url).trim()) || DEFAULT_WALLPAPER;
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch (e) {
      /* 存储失败（如 base64 超限）时仅本次生效 */
    }
    apply(value);
    return value;
  }

  function resetWallpaper() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) { /* ignore */ }
    apply(DEFAULT_WALLPAPER);
    return DEFAULT_WALLPAPER;
  }

  // 首帧前应用，避免壁纸闪烁
  apply(getWallpaper());

  window.WALLPAPERS = WALLPAPERS;
  window.DEFAULT_WALLPAPER = DEFAULT_WALLPAPER;
  window.setWallpaper = setWallpaper;
  window.resetWallpaper = resetWallpaper;
  window.getWallpaper = getWallpaper;
})();
