(function(){
  "use strict";

  /** Owns fixed/adaptive theme state and renders the theme picker. */
  function create(options){
    const {engine, grid, topPanel, on, esc, getArtworkSource, afterThemeChange} = options;
    const choices = engine.THEME_CHOICES || [];
    const defaultId = engine.DEFAULT_THEME_ID || "albumAdaptiveLight";
    const defaultAdaptiveColor = engine.DEFAULT_ADAPTIVE_COLOR || {r:63, g:111, b:216};
    const adaptiveCache = new Map();
    let activeId = engine.initialTheme ? engine.initialTheme() : defaultId;
    let adaptiveSource = "";

    if(!choices.some(theme => theme.id === activeId)) activeId = defaultId;

    function currentChoice(){
      return choices.find(theme => theme.id === activeId) || choices[0];
    }

    function clearAdaptiveVariables(){
      if(engine.clearAdaptiveThemeVars) engine.clearAdaptiveThemeVars();
      adaptiveSource = "";
    }

    function isAdaptive(){
      return engine.isAdaptiveTheme ? engine.isAdaptiveTheme(activeId) : false;
    }

    function applyAdaptiveColor(color){
      if(engine.applyAdaptiveColor) engine.applyAdaptiveColor(activeId, color);
    }

    async function applyAdaptive(){
      if(!isAdaptive()){
        clearAdaptiveVariables();
        return;
      }
      const source = getArtworkSource();
      if(!source){
        applyAdaptiveColor(defaultAdaptiveColor);
        return;
      }
      if(source === adaptiveSource) return;
      adaptiveSource = source;
      try{
        const color = adaptiveCache.get(source) || await engine.sampleAdaptiveColor(source);
        adaptiveCache.set(source, color);
        if(isAdaptive() && adaptiveSource === source) applyAdaptiveColor(color);
      }catch(error){
        console.warn("[theme] adaptive color failed", error);
        applyAdaptiveColor(defaultAdaptiveColor);
      }
    }

    function render(){
      if(!grid) return;
      const current = currentChoice();
      const mode = current?.mode || "dark";
      const visibleThemes = choices.filter(theme => theme.mode === mode);
      topPanel.innerHTML = `<div class="topTabControls"><strong>Customize</strong></div>`;
      grid.innerHTML = `<div class="themeModeToggle" role="group" aria-label="Appearance"><button type="button" data-theme-mode="light" class="${mode === "light" ? "active" : ""}" aria-pressed="${mode === "light"}">Light</button><button type="button" data-theme-mode="dark" class="${mode === "dark" ? "active" : ""}" aria-pressed="${mode === "dark"}">Dark</button></div><div class="themeChoiceGrid">${visibleThemes.map(theme => {
        const active = theme.id === activeId ? " active" : "";
        return `<button class="themeChoice${active}" data-theme="${esc(theme.id)}" type="button" style="--swatch-a:${esc(theme.swatchA)};--swatch-b:${esc(theme.swatchB)};--swatch-rgb:${esc(theme.swatchRgb)}"><span class="themeSwatch"></span><strong>${esc(theme.label)}</strong></button>`;
      }).join("")}</div>`;
      grid.querySelectorAll("[data-theme-mode]").forEach(button => {
        on(button, "click", () => setMode(button.dataset.themeMode));
      });
      grid.querySelectorAll(".themeChoice").forEach(button => {
        on(button, "click", () => setAccent(button.dataset.theme));
      });
    }

    function setMode(mode){
      const current = currentChoice();
      const matching = choices.find(theme => theme.mode === mode && theme.family === current.family)
        || choices.find(theme => theme.mode === mode && theme.family === "adaptive");
      if(matching) setAccent(matching.id);
    }

    function setAccent(themeId, {persist=true}={}){
      const theme = engine.themeById
        ? engine.themeById(themeId)
        : (choices.find(item => item.id === themeId) || choices[0]);
      if(!theme) return;
      clearAdaptiveVariables();
      if(engine.applyThemeClass) engine.applyThemeClass(theme);
      activeId = theme.id;
      if(persist){
        localStorage.setItem("accentTheme", activeId);
        localStorage.setItem("themePreferenceExplicit", "true");
      }
      applyAdaptive();
      render();
      afterThemeChange();
    }

    function initialize(){
      document.body.classList.add("dark");
      setAccent(activeId, {persist:false});
    }

    return {applyAdaptive, initialize, render};
  }

  window.MediaPlayerThemeController = {create};
})();
