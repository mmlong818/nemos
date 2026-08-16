/* 设置页「外观」面板：壁纸选择、上传与恢复默认 */
(function () {
  'use strict';

  var grid = document.getElementById('wallpaperGrid');
  if (!grid || !window.WALLPAPERS) return;

  var preview = document.getElementById('wallpaperPreview');
  var nameEl = document.getElementById('wallpaperCurrentName');
  var urlForm = document.getElementById('wallpaperUrlForm');
  var urlInput = document.getElementById('wallpaperUrl');
  var uploadButton = document.getElementById('wallpaperUpload');
  var fileInput = document.getElementById('wallpaperFile');
  var resetButton = document.getElementById('wallpaperReset');
  var status = document.getElementById('wallpaperStatus');

  function say(message) {
    if (status) status.textContent = message;
  }

  function nameFor(url) {
    var hit = window.WALLPAPERS.find(function (item) { return item.url === url; });
    if (hit) return hit.name;
    if (url && url.indexOf('data:') === 0) return '本机上传图片';
    return '自定义图片';
  }

  function refresh() {
    var url = window.getWallpaper();
    preview.style.backgroundImage = 'url("' + url + '")';
    nameEl.textContent = '当前：' + nameFor(url);
    grid.querySelectorAll('button').forEach(function (button) {
      button.classList.toggle('is-current', button.dataset.wallpaper === url);
    });
  }

  window.WALLPAPERS.forEach(function (item) {
    var button = document.createElement('button');
    button.type = 'button';
    button.dataset.wallpaper = item.url;
    button.innerHTML = '<span class="wallpaper-thumb" style="background-image:url(\'' + item.url + '\')"></span><span class="wallpaper-name">' + item.name + '</span>';
    button.addEventListener('click', function () {
      window.setWallpaper(item.url);
      refresh();
      say('已更换为「' + item.name + '」。');
    });
    grid.appendChild(button);
  });

  urlForm.addEventListener('submit', function (event) {
    event.preventDefault();
    var value = urlInput.value.trim();
    if (!value) {
      say('请先粘贴图片地址。');
      return;
    }
    window.setWallpaper(value);
    urlInput.value = '';
    refresh();
    say('已使用自定义图片。');
  });

  uploadButton.addEventListener('click', function () {
    fileInput.click();
  });

  fileInput.addEventListener('change', async function () {
    var file = fileInput.files && fileInput.files[0];
    if (!file) return;
    if (!file.type || file.type.indexOf('image/') !== 0) {
      say('请选择图片文件。');
      fileInput.value = '';
      return;
    }
    try {
      say('正在保存本机图片…');
      await window.setWallpaperFile(file);
      refresh();
      say('已使用本机图片。');
    } catch (error) {
      say(error && error.message ? error.message : '保存图片失败，请重试。');
    } finally {
      fileInput.value = '';
    }
  });

  window.addEventListener('clownfish-wallpaper-change', refresh);

  resetButton.addEventListener('click', function () {
    window.resetWallpaper();
    refresh();
    say('已恢复默认壁纸。');
  });

  refresh();
})();
