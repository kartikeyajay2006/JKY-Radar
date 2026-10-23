// Applies the saved or system theme before first paint (external file so the CSP can forbid inline scripts).
try {
  var t = localStorage.getItem('jky-theme');
  var dark = t ? t === 'dark' : !window.matchMedia('(prefers-color-scheme: light)').matches;
  document.documentElement.classList.toggle('dark', dark);
} catch (e) {
  document.documentElement.classList.add('dark');
}
