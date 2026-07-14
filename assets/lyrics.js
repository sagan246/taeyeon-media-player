// Lyrics helpers for local text and LRC files.
//
// The player owns fetching and current playback time. This module keeps the
// parsing and synced-line UI rules isolated so lyric fixes do not disturb audio.
(function(){
  const ui = window.MediaPlayerUi || {};
  const esc = ui.esc || (value => String(value ?? ""));

  function parseLrcTimestamp(value){
    const match = String(value || "").match(/^(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?$/);
    if(!match) return null;
    const fraction = match[3] ? Number(`0.${match[3].padEnd(3, "0").slice(0, 3)}`) : 0;
    return Number(match[1]) * 60 + Number(match[2]) + fraction;
  }

  function parseLrc(text){
    const lines = [];
    String(text || "").split(/\r?\n/).forEach(rawLine => {
      const stamps = [...rawLine.matchAll(/\[([0-9:.]+)\]/g)]
        .map(match => parseLrcTimestamp(match[1]))
        .filter(value => value !== null);
      const lyric = rawLine.replace(/\[[^\]]+\]/g, "").trim();
      if(!stamps.length || !lyric) return;
      stamps.forEach(time => lines.push({time, lyric}));
    });
    return lines.sort((a, b) => a.time - b.time);
  }

  function looksLikeLrc(text){
    return /\[[0-9]{1,2}:[0-9]{2}(?:[.:][0-9]{1,3})?\]/.test(String(text || ""));
  }

  function syncedLyricsHtml(lines){
    return lines.map((line, index) => `<button type="button" class="lrcLine" data-lrc-index="${index}" data-lrc-time="${esc(line.time)}">${esc(line.lyric)}</button>`).join("");
  }

  function activeLrcIndex(lines, currentTime, offset=.15){
    let activeIndex = -1;
    for(let i = 0; i < lines.length; i++){
      if(lines[i].time <= currentTime + offset) activeIndex = i;
      else break;
    }
    return activeIndex;
  }

  function scrollLyricIntoFocus(activeLine, forceScroll=false){
    const scroller = activeLine.closest(".syncedLyrics");
    if(!scroller){
      activeLine.scrollIntoView({block:"center", behavior:"auto"});
      return;
    }
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const desktopLyrics = window.matchMedia("(min-width: 1100px)").matches;
    const activeCenter = activeLine.offsetTop + activeLine.offsetHeight / 2;
    // On mobile, anchor the top edge so wrapped lyrics do not climb into the
    // faded mask. Desktop keeps its centered reading position.
    const targetTop = Math.max(28, scroller.clientHeight * .09);
    const scrollTop = desktopLyrics
      ? activeCenter - scroller.clientHeight * .42
      : activeLine.offsetTop - targetTop;
    scroller.scrollTo({
      top: Math.max(0, scrollTop),
      behavior: forceScroll || reduceMotion || !desktopLyrics ? "auto" : "smooth",
    });
  }

  window.MediaPlayerLyrics = {
    activeLrcIndex,
    looksLikeLrc,
    parseLrc,
    parseLrcTimestamp,
    scrollLyricIntoFocus,
    syncedLyricsHtml,
  };
})();
