export function applyMediaViewerTransform(image, transformStyle, zoomed) {
  image.style.transform = transformStyle;
  image.classList.toggle('zoomed', zoomed);
}

export function openMediaViewerView({ viewer, image, download }, { url, fileName }) {
  image.src = url;
  image.alt = fileName;
  download.href = url;
  download.download = fileName;
  viewer.classList.remove('hidden');
}

export function closeMediaViewerView({ viewer, image, download }) {
  viewer.classList.add('hidden');
  image.removeAttribute('src');
  download.removeAttribute('href');
}

export function isMediaViewerHidden(viewer) {
  return viewer.classList.contains('hidden');
}
