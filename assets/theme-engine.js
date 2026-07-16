// Runtime theme helpers for the browser app.
//
// theme-data.js is just configuration. This file owns the small amount of
// behavior needed to apply a theme, sample artwork for adaptive themes, and
// expose theme CSS values to the visualizer.
(function(){
  const themeData = window.MediaPlayerThemeData || {};
  const DEFAULT_THEME_ID = themeData.defaultThemeId || "albumAdaptiveLight";
  const DARK_ADAPTIVE_THEME_ID = themeData.darkAdaptiveThemeId || "albumAdaptive";
  const LIGHT_ADAPTIVE_THEME_ID = themeData.lightAdaptiveThemeId || "albumAdaptiveLight";
  const DEFAULT_ADAPTIVE_COLOR = themeData.defaultAdaptiveColor || {r:63, g:111, b:216};
  const ADAPTIVE_THEME_IDS = new Set([DARK_ADAPTIVE_THEME_ID, LIGHT_ADAPTIVE_THEME_ID]);
  const ADAPTIVE_STYLE_VARS = themeData.adaptiveStyleVars || [];
  const THEME_CHOICES = themeData.choices || [];

  function clampColor(value){
    return Math.max(0, Math.min(255, Math.round(value)));
  }

  function rgbToHex({r, g, b}){
    return `#${[r, g, b].map(v => clampColor(v).toString(16).padStart(2, "0")).join("")}`;
  }

  function mixRgb(color, target, amount){
    return {
      r: clampColor(color.r + (target.r - color.r) * amount),
      g: clampColor(color.g + (target.g - color.g) * amount),
      b: clampColor(color.b + (target.b - color.b) * amount),
    };
  }

  function colorScore(r, g, b){
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max - min;
    const luminance = (max + min) / 2;
    return saturation * (luminance > 28 && luminance < 238 ? 1 : .25);
  }

  function themeById(themeId){
    return THEME_CHOICES.find(item => item.id === themeId) || THEME_CHOICES[0];
  }

  function initialTheme(){
    const savedTheme = localStorage.getItem("accentTheme");
    const explicitPreference = localStorage.getItem("themePreferenceExplicit") === "true";
    const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;

    // Older versions stored the automatic adaptive default as if the user had
    // selected it. Migrate that value back to an automatic system preference,
    // while preserving any deliberately chosen fixed color theme.
    const legacyAutomaticTheme = !explicitPreference
      && [DEFAULT_THEME_ID, DARK_ADAPTIVE_THEME_ID, LIGHT_ADAPTIVE_THEME_ID].includes(savedTheme);
    const themeId = !savedTheme || legacyAutomaticTheme
      ? (prefersDark ? DARK_ADAPTIVE_THEME_ID : LIGHT_ADAPTIVE_THEME_ID)
      : savedTheme;
    return themeById(themeId) ? themeId : DEFAULT_THEME_ID;
  }

  function isAdaptiveTheme(themeId){
    return ADAPTIVE_THEME_IDS.has(themeId);
  }

  function clearAdaptiveThemeVars(){
    ADAPTIVE_STYLE_VARS.forEach(name => document.body.style.removeProperty(name));
  }

  function applyThemeClass(theme){
    THEME_CHOICES.forEach(item => {
      if(item.className){
        document.body.classList.remove(item.className);
        document.documentElement.classList.remove(item.className);
      }
    });
    if(theme?.className){
      document.body.classList.add(theme.className);
      document.documentElement.classList.add(theme.className);
    }
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if(themeMeta) themeMeta.setAttribute("content", theme?.browserColor || "#000000");
  }

  function applyAdaptiveColor(themeId, color){
    const lightAdaptive = themeId === LIGHT_ADAPTIVE_THEME_ID;
    const strong = mixRgb(color, {r:255, g:255, b:255}, .34);
    const glow = mixRgb(color, {r:255, g:255, b:255}, .22);
    const sheen = mixRgb(color, {r:255, g:255, b:255}, .58);
    const deep = mixRgb(color, {r:0, g:0, b:0}, .22);

    document.body.style.setProperty("--accent-rgb", `${color.r},${color.g},${color.b}`);
    document.body.style.setProperty("--accent-strong-rgb", `${strong.r},${strong.g},${strong.b}`);
    document.body.style.setProperty("--accent-glow-rgb", `${glow.r},${glow.g},${glow.b}`);
    document.body.style.setProperty("--accent-sheen-rgb", `${sheen.r},${sheen.g},${sheen.b}`);
    document.body.style.setProperty("--accent", rgbToHex(color));
    document.body.style.setProperty("--accent-strong", rgbToHex(strong));
    document.body.style.setProperty("--accent-deep", rgbToHex(deep));

    // Light adaptive needs a darker sampled accent for text; dark adaptive can
    // use the brighter sheen without losing contrast.
    const readableAccent = lightAdaptive ? color : sheen;
    document.body.style.setProperty("--accent-link", rgbToHex(lightAdaptive ? deep : sheen));
    document.body.style.setProperty("--ok", rgbToHex(lightAdaptive ? color : strong));
    document.body.style.setProperty("--track-number-color", rgbToHex(readableAccent));
  }

  function sampleAdaptiveColor(src){
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try{
          const canvas = document.createElement("canvas");
          const size = 36;
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext("2d", {willReadFrequently:true});
          ctx.drawImage(img, 0, 0, size, size);
          const data = ctx.getImageData(0, 0, size, size).data;
          let total = 0, rSum = 0, gSum = 0, bSum = 0;
          for(let i = 0; i < data.length; i += 4){
            const alpha = data[i + 3] / 255;
            if(alpha < .45) continue;
            const r = data[i], g = data[i + 1], b = data[i + 2];
            const score = Math.max(1, colorScore(r, g, b)) * alpha;
            total += score;
            rSum += r * score;
            gSum += g * score;
            bSum += b * score;
          }
          if(!total) throw new Error("No sampleable pixels");
          resolve({r:clampColor(rSum / total), g:clampColor(gSum / total), b:clampColor(bSum / total)});
        }catch(err){
          reject(err);
        }
      };
      img.onerror = reject;
      img.src = src;
    });
  }

  function themeCssValue(name, fallback){
    const value = getComputedStyle(document.body).getPropertyValue(name).trim();
    return value || fallback;
  }

  window.MediaPlayerThemeEngine = {
    DEFAULT_THEME_ID,
    DEFAULT_ADAPTIVE_COLOR,
    THEME_CHOICES,
    applyAdaptiveColor,
    applyThemeClass,
    clearAdaptiveThemeVars,
    initialTheme,
    isAdaptiveTheme,
    sampleAdaptiveColor,
    themeById,
    themeCssValue,
  };
})();
