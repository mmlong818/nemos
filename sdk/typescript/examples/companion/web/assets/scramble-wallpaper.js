/* Scramble OS 2026 壁纸系统
 * - 默认 5 张内置壁纸（assets/wallpapers/）
 * - 图片地址保存在 localStorage，本机图片以 Blob 保存在 IndexedDB
 * - 暴露 window.setWallpaper(url) / window.setWallpaperFile(file) / window.resetWallpaper() / window.getWallpaper()
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'clownfish-wallpaper';
  var LOCAL_FILE_VALUE = 'indexeddb:clownfish-wallpaper-file';
  var DATABASE_NAME = 'clownfish-wallpaper';
  var STORE_NAME = 'files';
  var FILE_KEY = 'active';
  var DEFAULT_WALLPAPER = '/assets/wallpapers/wallpaper-anime-teal.png';
  var activeObjectUrl = '';

  var WALLPAPERS = [
    { id: 'anime-teal', name: '青绿伙伴', url: '/assets/wallpapers/wallpaper-anime-teal.png' },
    { id: 'ventura',  name: '湖蓝晨光', url: '/assets/wallpapers/wallpaper-ventura.svg' },
    { id: 'sonoma',   name: '索诺玛晚霞', url: '/assets/wallpapers/wallpaper-sonoma.svg' },
    { id: 'monterey', name: '蒙特雷薄暮', url: '/assets/wallpapers/wallpaper-monterey.svg' },
    { id: 'silver',   name: '雾银白昼', url: '/assets/wallpapers/wallpaper-silver.svg' }
  ];

  function apply(url) {
    var value = (url && String(url).trim()) || DEFAULT_WALLPAPER;
    document.documentElement.style.setProperty('--wallpaper-url', 'url("' + value.replace(/"/g, '\\"') + '")');
  }

  function openDatabase() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) return reject(new Error('当前浏览器不支持本机图片存储'));
      var request = window.indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = function () {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('无法打开本机图片存储')); };
    });
  }

  function useStoredFile(file) {
    if (activeObjectUrl) URL.revokeObjectURL(activeObjectUrl);
    activeObjectUrl = URL.createObjectURL(file);
    apply(activeObjectUrl);
    window.dispatchEvent(new CustomEvent('clownfish-wallpaper-change'));
    return activeObjectUrl;
  }

  function loadStoredFile() {
    return openDatabase().then(function (database) {
      return new Promise(function (resolve, reject) {
        var request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(FILE_KEY);
        request.onsuccess = function () {
          database.close();
          if (!(request.result instanceof Blob)) return reject(new Error('本机背景图不存在'));
          resolve(useStoredFile(request.result));
        };
        request.onerror = function () {
          database.close();
          reject(request.error || new Error('读取本机背景图失败'));
        };
      });
    });
  }

  function clearStoredFile() {
    if (activeObjectUrl) {
      URL.revokeObjectURL(activeObjectUrl);
      activeObjectUrl = '';
    }
    return openDatabase().then(function (database) {
      return new Promise(function (resolve) {
        var request = database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(FILE_KEY);
        request.onsuccess = request.onerror = function () { database.close(); resolve(); };
      });
    }).catch(function () { /* 没有 IndexedDB 时无需清理 */ });
  }

  function getStoredValue() {
    try {
      return localStorage.getItem(STORAGE_KEY) || DEFAULT_WALLPAPER;
    } catch (e) {
      return DEFAULT_WALLPAPER;
    }
  }

  function getWallpaper() {
    var stored = getStoredValue();
    return stored === LOCAL_FILE_VALUE ? (activeObjectUrl || DEFAULT_WALLPAPER) : stored;
  }

  function setWallpaper(url) {
    var value = (url && String(url).trim()) || DEFAULT_WALLPAPER;
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch (e) {
      /* 存储失败（如 base64 超限）时仅本次生效 */
    }
    clearStoredFile();
    apply(value);
    return value;
  }

  function setWallpaperFile(file) {
    if (!(file instanceof Blob) || !String(file.type || '').startsWith('image/')) {
      return Promise.reject(new Error('请选择图片文件'));
    }
    return openDatabase().then(function (database) {
      return new Promise(function (resolve, reject) {
        var request = database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(file, FILE_KEY);
        request.onsuccess = function () {
          database.close();
          try { localStorage.setItem(STORAGE_KEY, LOCAL_FILE_VALUE); } catch (e) { /* 图片仍可在本次使用 */ }
          resolve(useStoredFile(file));
        };
        request.onerror = function () {
          database.close();
          reject(request.error || new Error('保存背景图失败'));
        };
      });
    });
  }

  function resetWallpaper() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) { /* ignore */ }
    clearStoredFile();
    apply(DEFAULT_WALLPAPER);
    return DEFAULT_WALLPAPER;
  }

  // 首帧前应用，避免壁纸闪烁
  var initialValue = getStoredValue();
  if (initialValue === LOCAL_FILE_VALUE) {
    apply(DEFAULT_WALLPAPER);
    loadStoredFile().catch(function () {
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
    });
  } else {
    apply(initialValue);
  }

  window.WALLPAPERS = WALLPAPERS;
  window.DEFAULT_WALLPAPER = DEFAULT_WALLPAPER;
  window.setWallpaper = setWallpaper;
  window.setWallpaperFile = setWallpaperFile;
  window.resetWallpaper = resetWallpaper;
  window.getWallpaper = getWallpaper;
})();
