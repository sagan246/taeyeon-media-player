    const ui = window.MediaPlayerUi || {};
    const byId = ui.byId || (id => document.getElementById(id));
    const on = ui.on || ((el, event, handler) => el.addEventListener(event, handler));
    const setOpen = ui.setOpen || ((el, open) => el.classList.toggle("open", open));
    const toggleOpen = el => setOpen(el, !el.classList.contains("open"));
    const setActive = ui.setActive || ((el, active) => el.classList.toggle("active", active));
    const setBodyMode = ui.setBodyMode || ((name, active) => document.body.classList.toggle(name, active));
    const esc = ui.esc || (value => String(value ?? ""));
    const localDateString = ui.localDateString || (() => new Date().toISOString().slice(0, 10));
    const fetchJson = ui.fetchJson || (url => fetch(url, {cache:"no-store"}).then(response => {
      if(!response.ok) throw new Error(`${url} returned ${response.status}`);
      return response.json();
    }));
    const components = window.MediaPlayerComponents || {};
    const {
      browseItemsHtml,
      browseSummaryText: componentBrowseSummaryText,
      buttonIcon,
      sectionGroupHtml: componentSectionGroupHtml,
      selectOptionsHtml,
      topControlBarHtml,
      topIconButton,
      topQueueButton,
    } = components;
    const musicComponents = window.MediaPlayerMusicComponents || {};
    const playlistComponents = window.MediaPlayerPlaylistComponents || {};
    const queueComponents = window.MediaPlayerQueueComponents || {};
    const {
      queueListHtml,
      queueSummaryText,
    } = queueComponents;
    const videoComponents = window.MediaPlayerVideoComponents || {};
    const lyricsHelpers = window.MediaPlayerLyrics || {};
    const nowPlayingComponents = window.MediaPlayerNowPlayingComponents || {};
    const statsComponents = window.MediaPlayerStatsComponents || {};
    const {
      allTimeStatsCard,
      fmtStatsSongTime,
      statsHero: statsHeroHtml,
      statsMetric,
      statsRangeControlHtml: statsRangeControlComponentHtml,
      statsTableSection,
    } = statsComponents;
    const themeEngine = window.MediaPlayerThemeEngine || {};
    const musicDomain = window.MediaPlayerMusicDomain || {};
    const videoDomain = window.MediaPlayerVideoDomain || {};
    const statsDomain = window.MediaPlayerStatsDomain || {};
    const playlistDomain = window.MediaPlayerPlaylistDomain || {};
    const editDomain = window.MediaPlayerEditDomain || {};

    // app.js is the stateful coordinator. Stateless markup lives in
    // components.js/stats-components.js so the music, video, queue, and stats
    // screens keep sharing one visual language without sharing playback state.

    // Library caches are loaded once and reused by render functions. Playback
    // endpoints stream directly from disk; metadata/artwork should already be
    // available from these cached scan results before the user presses play.
    let tracks = [];
    let playlists = [];
    let videos = [];
    let interviews = [];
    let tracksLoaded = false;
    let videosLoaded = false;
    let interviewsLoaded = false;

    // Current selections. selectedId/selectedVideoId are UI focus, while
    // playingId/videoQueueIndex describe the actual active media.
    let selectedId = null;
    let playingId = null;
    let selectedVideoId = null;
    let selectedInterviewId = null;
    let selectedInterviewKey = localStorage.getItem("selectedInterviewKey") || "";

    // View mode state is intentionally persisted where it affects what the user
    // expects to see after refresh, but transient details like selected albums
    // stay in memory.
    let mediaType = "music";
    let appMode = "listen";
    let groupMode = "category";
    let selectedGroup = "All";
    let selectedAlbum = "All";
    let selectedPlaylistId = null;
    let selectedVideoGroup = "All";
    let selectedVideoAsFolder = false;

    let sortKey = "date";
    let sortDir = "desc";
    let tableSortActive = false;
    let videoSort = localStorage.getItem("videoSort") || "newest";
    let albumViewMode = localStorage.getItem("albumViewMode") || "newest";
    const STATS_RANGES = [["day","Day"],["week","Week"],["month","Month"],["year","Year"],["all","All Time"]];
    let statsPeriod = localStorage.getItem("statsPeriod") || "week";
    let statsDay = localStorage.getItem("statsDay") || localDateString();
    const legacyStatsRangeEnd = localStorage.getItem("statsRangeEnd") || localDateString();
    const statsRangeAnchors = {week:localStorage.getItem("statsRangeEnd:week")||legacyStatsRangeEnd,month:localStorage.getItem("statsRangeEnd:month")||legacyStatsRangeEnd,year:localStorage.getItem("statsRangeEnd:year")||legacyStatsRangeEnd};
    let repeatMode = localStorage.getItem("repeatMode") || "off";
    let videoRepeatMode = localStorage.getItem("videoRepeatMode") || "off";
    const DEFAULT_THEME_ID = themeEngine.DEFAULT_THEME_ID || "albumAdaptiveLight";
    const DEFAULT_ADAPTIVE_COLOR = themeEngine.DEFAULT_ADAPTIVE_COLOR || {r:63, g:111, b:216};
    const THEME_CHOICES = themeEngine.THEME_CHOICES || [];
    let activeTheme = themeEngine.initialTheme ? themeEngine.initialTheme() : DEFAULT_THEME_ID;
    let adaptiveThemeSource = "";
    let appConfig = {
      editable:true,
      playlistEditable:true,
      appName:"Local Media Player",
      textTabLabel:"Interviews",
      textDir:"Interviews",
      preferredCategories:["Albums","Soundtracks","Live","Covers","Features"],
      preferredVideoCategories:["Concerts"],
    };
    if(!["newest","oldest","sections"].includes(videoSort)) videoSort = "newest";
    if(!STATS_RANGES.some(([value])=>value===statsPeriod)) statsPeriod = "week";
    if(!["off","all","one"].includes(repeatMode)) repeatMode = "off";
    if(!["off","all","one"].includes(videoRepeatMode)) videoRepeatMode = "off";
    // Playback queues are client-side so phone/desktop can resume quickly
    // without rebuilding a queue on every page load.
    let browseCollapsed = true;
    let queue = [], queueIndex = -1, seeking = false, switchingAudioTrack = false;
    let activePlaylistId = null;
    const playlistResumeWrites = new Map();
    const knownDurations = new Map();
    let videoQueue = [], videoQueueIndex = -1;
    let albumClickTimer = null, queueToastTimer = null;
    let playlistDialogMode = "create";
    let nowPlayingRenderedTrackId = null, nowPlayingRenderedArtSrc = "";
    let currentLrcLyrics = null;
    let restoredMusicState = false, lastQueueSaveAt = 0;
    let restoredVideoState = false, restoringVideoStateNow = false, lastVideoSaveAt = 0;
    // Stats are batched to avoid recording skipped tracks as listens. A play is
    // only counted after the threshold, while time is periodically flushed.
    let listeningStats = null, statsSession = null, lastStatsSentAt = 0;
    let statsTopSongTrackIds = [];
    const STATS_MIN_SECONDS_TO_RECORD = 5;
    let savedVisualizerMode = localStorage.getItem("visualizerMode");
    if((!savedVisualizerMode || savedVisualizerMode === "rain") && localStorage.getItem("visualizerDefault") !== "bars"){
      savedVisualizerMode = "bars";
      localStorage.setItem("visualizerMode", "bars");
      localStorage.setItem("visualizerDefault", "bars");
    }
    // The visualizer uses Web Audio only while the page is visible/playing; on
    // iPhone lock screen we keep normal audio playback behavior instead.
    let audioContext = null, analyserNode = null, audioSourceNode = null, visualizerData = null, visualizerFrame = null, visualizerMode = savedVisualizerMode || "bars";
    const selectedIds = new Set();
    const adaptiveThemeCache = new Map();
    const MEDIA_TYPES = ["music", "video", "health", "interviews", "statsPage", "customize"];
    if(!THEME_CHOICES.some(theme=>theme.id===activeTheme)) activeTheme = DEFAULT_THEME_ID;
    const MOBILE_BREAKPOINT = 860;
    const VIDEO_EMPTY_TITLE = "";
    const VIDEO_EMPTY_META = "";
    // Frequently used DOM nodes. Keeping them named here avoids repeated lookups
    // and makes the render functions below less noisy.
    const rowsEl = byId("rows");
    const statsEl = byId("stats");
    const detailEl = byId("detail");
    const searchEl = byId("searchBox");
    const musicFilterEl = byId("musicFilter");
    const albumViewModeEl = byId("albumViewMode");
    const navEl = document.querySelector("nav");
    const groupsEl = byId("groups");
    const browseSummaryEl = byId("browseSummary");
    const selectedCountEl = byId("selectedCount");
    const selectShownEl = byId("selectShown");
    const bulkSaveEl = byId("bulkSave");
    const clearSelectedEl = byId("clearSelected");
    const albumGridEl = byId("albumGrid");
    const viewTitleEl = byId("viewTitle");
    const player = byId("player");
    const nowInfoEl = byId("nowInfo");
    const playPauseBtn = byId("playPauseBtn");
    const repeatBtn = byId("repeatBtn");
    const seekBar = byId("seekBar");
    const volumeBar = byId("volumeBar");
    const topQueueLabelEl = byId("topQueueToggle");
    const queueDrawerEl = byId("queueDrawer");
    const queueListEl = byId("queueList");
    const queueSummaryEl = byId("queueSummary");
    const nowPlayingDrawerEl = byId("nowPlayingDrawer");
    const nowPlayingBodyEl = byId("nowPlayingBody");
    const currentTimeEl = byId("currentTime");
    const durationEl = byId("duration");
    const queueToastEl = byId("queueToast");
    const playlistDialogEl = byId("playlistDialog");
    const playlistFormEl = byId("playlistForm");
    const playlistNameEl = byId("playlistName");
    const playlistMessageEl = byId("playlistMessage");
    const musicTabEl = byId("musicTab");
    const videoTabEl = byId("videoTab");
    const interviewsTabEl = byId("interviewsTab");
    const statsTabEl = byId("statsTab");
    const customizeTabEl = byId("customizeTab");
    const healthTabEl = byId("healthTab");
    const videoGridEl = byId("videoGrid");
    const videoPlayerEl = byId("videoPlayer");
    const videoTitleEl = byId("videoTitle");
    const videoMetaEl = byId("videoMeta");
    const videoViewTitleEl = byId("videoViewTitle");
    const videoQueueToggleEl = byId("videoQueueToggle");
    const videoRepeatBtn = byId("videoRepeatBtn");
    const videoQueueDrawerEl = byId("videoQueueDrawer");
    const videoQueueListEl = byId("videoQueueList");
    const videoQueueSummaryEl = byId("videoQueueSummary");
    const videoSortEl = byId("videoSort");
    const interviewListEl = byId("interviewList");
    const interviewItemsEl = byId("interviewItems");
    const interviewBrowseSummaryEl = byId("interviewBrowseSummary");
    const interviewReaderEl = byId("interviewReader");
    const healthPanelEl = byId("healthPanel");
    const listeningStatsPanelEl = byId("listeningStatsPanel");
    const themeGridEl = byId("themeGrid");
    // Text helpers and library grouping rules.
    function shiftDate(dateText,days){return statsDomain.shiftDate(dateText,days,localDateString);}
    function statsSteppablePeriod(){return ["week","month","year"].includes(statsPeriod);}
    function dateFromText(dateText){return statsDomain.dateFromText(dateText,localDateString);}
    function monthStart(dateText){return statsDomain.monthStart(dateText,localDateString);}
    function monthEnd(dateText){return statsDomain.monthEnd(dateText,localDateString);}
    function yearStart(dateText){return statsDomain.yearStart(dateText,localDateString);}
    function yearEnd(dateText){return statsDomain.yearEnd(dateText,localDateString);}
    function weekStart(dateText){return statsDomain.weekStart(dateText,localDateString);}
    function weekEnd(dateText){return statsDomain.weekEnd(dateText,localDateString);}
    function shiftMonthAnchor(dateText,direction){return statsDomain.shiftMonthAnchor(dateText,direction,localDateString);}
    function shiftYearAnchor(dateText,direction){return statsDomain.shiftYearAnchor(dateText,direction,localDateString);}
    function statsCurrentRangeStart(period=statsPeriod){
      const today = localDateString();
      if(period==="week")return weekStart(today);
      if(period==="month")return monthStart(today);
      if(period==="year")return yearStart(today);
      return today;
    }
    function statsViewedRangeStart(){
      return statsRangeDates().start;
    }
    function statsAtCurrentRange(){
      return statsSteppablePeriod() && statsViewedRangeStart() >= statsCurrentRangeStart();
    }
    function statsAtToday(){
      return (statsDay || localDateString()) >= localDateString();
    }
    function isFutureStatsDay(day){
      return Boolean(day) && day > localDateString();
    }
    function clampStatsDay(day){
      const today=localDateString();
      return day && day < today ? day : today;
    }
    function statsPrimaryMetricLabel(){
      if(statsPeriod==="all")return "all time";
      if(statsPeriod==="day")return statsDay === localDateString() ? "today" : "selected day";
      if(statsPeriod==="week")return statsAtCurrentRange() ? "this week" : "selected week";
      if(statsPeriod==="month")return statsAtCurrentRange() ? "this month" : "selected month";
      if(statsPeriod==="year")return statsAtCurrentRange() ? "this year" : "selected year";
      return "this range";
    }
    function statsRangeAnchor(period=statsPeriod){
      const raw = statsRangeAnchors[period] || localDateString();
      // Saved ranges can outlive the calendar date they were written on.
      // Clamp those on load, while live future clicks below simply no-op.
      const clamped = clampStatsRangeAnchor(period, raw);
      if(clamped !== raw){
        statsRangeAnchors[period] = clamped;
        localStorage.setItem(`statsRangeEnd:${period}`, clamped);
      }
      return clamped;
    }
    function latestStatsAnchor(period){
      const today = localDateString();
      if(period==="week")return weekStart(today);
      if(period==="month")return monthStart(today);
      if(period==="year")return yearStart(today);
      return today;
    }
    function statsRangeCandidateStart(period, value){
      if(period==="week")return weekStart(value);
      if(period==="month")return monthStart(value);
      if(period==="year")return yearStart(value);
      return value;
    }
    function isFutureStatsRangeAnchor(period, value){
      return statsRangeCandidateStart(period, value) > latestStatsAnchor(period);
    }
    function clampStatsRangeAnchor(period, value){
      const latest = latestStatsAnchor(period);
      const candidateStart = statsRangeCandidateStart(period, value);
      return candidateStart > latest ? latest : value;
    }
    function setStatsRangeAnchor(period, value){
      const clamped = clampStatsRangeAnchor(period, value || localDateString());
      statsRangeAnchors[period] = clamped;
      localStorage.setItem(`statsRangeEnd:${period}`, clamped);
      return clamped;
    }
    function trySetStatsRangeAnchor(period, value){
      if(isFutureStatsRangeAnchor(period, value))return false;
      setStatsRangeAnchor(period, value);
      return true;
    }
    function statsRangeDates(){
      const anchor = statsRangeAnchor();
      if(statsPeriod==="week"){
        return {start:weekStart(anchor), end:weekEnd(anchor)};
      }
      if(statsPeriod==="month"){
        return {start:monthStart(anchor), end:monthEnd(anchor)};
      }
      if(statsPeriod==="year"){
        return {start:yearStart(anchor), end:yearEnd(anchor)};
      }
      const end = anchor > localDateString() ? localDateString() : anchor;
      return {start:end, end};
    }
    function statsRangeLabel(){
      const {start,end}=statsRangeDates();
      if(statsPeriod==="year")return start.slice(0,4);
      return start.slice(0,4)===end.slice(0,4) ? `${start.slice(5)} to ${end.slice(5)}` : `${start} to ${end}`;
    }
    function statsMonthTitle(){
      const date = dateFromText(statsRangeDates().start);
      return date.toLocaleDateString(undefined, {month:"long", year:"numeric"});
    }
    function shiftStatsRange(direction){
      let anchor = statsPeriod==="week"
        ? shiftDate(statsRangeAnchor(), direction * 7)
        : statsPeriod==="month"
        ? shiftMonthAnchor(statsRangeAnchor(), direction)
        : statsPeriod==="year"
        ? shiftYearAnchor(statsRangeAnchor(), direction)
        : shiftDate(statsRangeAnchor(), direction);
      if(isFutureStatsRangeAnchor(statsPeriod, anchor))return;
      setStatsRangeAnchor(statsPeriod, anchor);
      loadListeningStats();
    }
    function saveLocalSetting(key, value){
      localStorage.setItem(key, value);
      return value;
    }
    function editHeaders(extra={}){return extra;}
    function musicPathParts(t){
      const folder=folderOf(t);
      return folder==="(root)"?[]:String(folder).replaceAll("\\","/").split("/").filter(Boolean);
    }
    // Music browse categories follow the first two directory levels. This
    // keeps an artist/collection parent and its major sections visible while
    // leaving album directories below them as cards rather than browse rows.
    function categoryOf(t){const parts=musicPathParts(t); return parts.length?parts.slice(0,2).join("/"):"(root)";}
    function folderOf(t){return t.folder || (t.path.includes("/") ? t.path.split("/").slice(0,-1).join("/") : "(root)");}
    function albumOf(t){return t.album || "(No album)";}
    function artUrl(t){return t.artwork_thumb_url || t.artwork_url || "";}
    function smallArtUrl(t){return t.artwork_thumb_small_url || artUrl(t);}
    function fullArtUrl(t){return t.artwork_url || t.artwork_thumb_url || "";}
    function stableAlbumArtUrl(t){const album=albumOf(t); const art=tracks.find(x=>albumOf(x)===album&&x.has_artwork); return art ? fullArtUrl(art) : fullArtUrl(t);}
    function groupOf(t){if(groupMode==="category") return categoryOf(t); if(groupMode==="album") return albumOf(t); return folderOf(t);}
    function musicGroupMatches(t, group=selectedGroup){
      if(group==="All")return true;
      const trackGroup=groupOf(t);
      return groupMode==="category"?(trackGroup===group||trackGroup.startsWith(`${group}/`)):trackGroup===group;
    }
    function searchQuery(){return String(searchEl.value||"").trim().toLowerCase();}
    function containsSearch(values){const q=searchQuery(); if(!q)return true; return values.some(value=>String(value||"").toLowerCase().includes(q));}
    function shortPathLabel(value){const text=String(value||"").replaceAll("\\\\","/"); if(!text||text==="All"||text==="(root)")return text||"(root)"; const parts=text.split("/").filter(Boolean); return parts.length?parts[parts.length-1]:text;}
    function groupLabel(name){return String(name||"").includes("/")?shortPathLabel(name):String(name||"");}
    // Browse children can use a short label such as "Albums", but section
    // headings retain their parent so repeated names remain understandable.
    function sectionLabel(name){return String(name||"").replaceAll("\\\\","/").split("/").filter(Boolean).join(" ")||"(root)";}
    function normalizeCategoryName(value){return String(value||"").toLowerCase().replace(/[^a-z0-9]+/g,"");}
    function preferredCategoryRank(name, preferredCategories=appConfig.preferredCategories){
      const label=normalizeCategoryName(name);
      if(label==="all")return -100;
      const configured=Array.isArray(preferredCategories)?preferredCategories:[];
      const index=configured.findIndex(item=>{
        const preferred=normalizeCategoryName(item);
        return preferred && (label===preferred || label.includes(preferred) || preferred.includes(label));
      });
      if(index>=0)return index;
      if(label.includes("needsbettercopy"))return 90;
      if(label.includes("misc"))return 80;
      return 50;
    }
    function musicCategoryRank(name){return preferredCategoryRank(name);}
    function musicCategoryCompare(a,b){const ar=musicCategoryRank(Array.isArray(a)?a[0]:a), br=musicCategoryRank(Array.isArray(b)?b[0]:b); if(ar!==br)return ar-br; const an=Array.isArray(a)?a[0]:a, bn=Array.isArray(b)?b[0]:b; return String(an).localeCompare(String(bn),undefined,{numeric:true,sensitivity:"base"});}
    function countLabel(count, singular, plural=`${singular}s`){return `${count} ${count===1?singular:plural}`;}
    function videoMetaSummary(v){const year=videoYear(v), format=String(v.format||"video").toUpperCase(); return `${year?`${year} - `:""}${format} - ${esc(v.size_mb)} MB`;}
    function nextRepeatMode(mode){return mode==="off"?"all":mode==="all"?"one":"off";}
    function repeatLabel(mode, prefix="Repeat"){return mode==="one"?`${prefix} one`:mode==="all"?`${prefix} all`:`${prefix} off`;}
    function repeatIconHtml(mode){return `&#8635;${mode==="one"?'<span class="repeatOne">1</span>':""}`;}
    function updateRepeatButton(button, mode, prefix="Repeat"){
      if(!button)return;
      button.innerHTML = repeatIconHtml(mode);
      button.classList.toggle("active", mode !== "off");
      button.title = repeatLabel(mode, prefix);
      button.setAttribute("aria-label", button.title);
    }
    function cycleMusicRepeat(){
      repeatMode=nextRepeatMode(repeatMode);
      localStorage.setItem("repeatMode",repeatMode);
      saveMusicState({force:true});
      updateRepeatButtons();
    }
    function cycleVideoRepeat(){videoRepeatMode=nextRepeatMode(videoRepeatMode); localStorage.setItem("videoRepeatMode",videoRepeatMode); saveVideoState({force:true}); updateRepeatButtons();}
    function updateRepeatButtons(){updateRepeatButton(repeatBtn, repeatMode); updateRepeatButton(byId("repeatQueue"), repeatMode); updateRepeatButton(videoRepeatBtn, videoRepeatMode, "Video repeat"); updateRepeatButton(byId("repeatVideoQueue"), videoRepeatMode, "Video repeat");}
    function isTypingTarget(target){return !!target?.closest?.("input, textarea, select, [contenteditable='true']");}
    function queueMatchesPlaylist(playlist){return playlistDomain.queueMatchesPlaylist(queue,playlist);}
    function persistPlaylistResume(playlist, trackId){
      const previous=playlistResumeWrites.get(playlist.id)||Promise.resolve();
      const next=previous.catch(()=>{}).then(()=>playlistRequest(`/api/playlists/${encodeURIComponent(playlist.id)}/resume`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({track_id:trackId})})).catch(error=>console.warn("[playlist] resume save failed",error));
      playlistResumeWrites.set(playlist.id,next);
    }
    function syncActivePlaylistContext(){
      const playlist=playlistById(activePlaylistId);
      if(!playlist){activePlaylistId=null; return;}
      if(!queueMatchesPlaylist(playlist))return;
      const trackId=queue[queueIndex];
      if(!Number.isInteger(trackId)||playlist.resume_track_id===trackId)return;
      playlist.resume_track_id=trackId;
      persistPlaylistResume(playlist,trackId);
    }
    function playlistResumeIndex(playlist){const saved=playlist.resume_track_id; if(!Number.isInteger(saved))return 0; const index=playlist.track_ids.indexOf(saved); return index<0?0:index;}
    function saveMusicState({force=false}={}){
      if(!force&&Date.now()-lastQueueSaveAt<3000)return;
      lastQueueSaveAt=Date.now();
      if(!queue.length){activePlaylistId=null; localStorage.removeItem("musicPlaybackState"); return;}
      syncActivePlaylistContext();
      const state=musicDomain.buildPlaybackState({queue,queueIndex,playingId,selectedId,activePlaylistId,currentTime:player.currentTime,repeatMode});
      localStorage.setItem("musicPlaybackState", JSON.stringify(state));
    }
    function restoreMusicState(){
      if(restoredMusicState)return;
      restoredMusicState=true;
      const validIds=new Set(tracks.map(t=>t.id));
      const state=musicDomain.parsePlaybackState(localStorage.getItem("musicPlaybackState"),validIds);
      if(!state)return;
      queue=state.queue;
      if(!queue.length){localStorage.removeItem("musicPlaybackState"); return;}
      const localQueueIndex=Math.min(Math.max(Number(state.queueIndex)||0,0),queue.length-1);
      queueIndex=localQueueIndex;
      activePlaylistId=typeof state.activePlaylistId==="string"?state.activePlaylistId:null;
      const activePlaylist=playlistById(activePlaylistId);
      if(queueMatchesPlaylist(activePlaylist))queueIndex=playlistResumeIndex(activePlaylist);
      const restoredId=queue[queueIndex];
      const t=tracks.find(x=>x.id===restoredId);
      if(!t)return;
      playingId=t.id;
      selectedId=t.id;
      const resumeAt=queueIndex===localQueueIndex?(Number(state.currentTime)||0):0;
      musicDomain.prepareSource(player,t,{resumeAt});
      player.pause();
      if(["off","all","one"].includes(state.repeatMode)){
        repeatMode=state.repeatMode;
        localStorage.setItem("repeatMode",repeatMode);
      }
      selectTrack(t.id);
      updateNow();
      renderQueue();
      if(mediaType==="music"&&selectedAlbum==="All")renderAlbums();
    }
    function saveVideoState({force=false}={}){
      if(restoringVideoStateNow)return;
      if(!force&&Date.now()-lastVideoSaveAt<3000)return;
      lastVideoSaveAt=Date.now();
      if(!videoQueue.length){localStorage.removeItem("videoPlaybackState"); return;}
      const state=videoDomain.buildPlaybackState({videoQueue,videoQueueIndex,selectedVideoId,currentTime:videoPlayerEl.currentTime,videoRepeatMode});
      localStorage.setItem("videoPlaybackState", JSON.stringify(state));
    }
    function restoreVideoState(){
      if(restoredVideoState)return;
      restoredVideoState=true;
      const validIds=new Set(videos.map(v=>v.id));
      const state=videoDomain.parsePlaybackState(localStorage.getItem("videoPlaybackState"),validIds);
      if(!state)return;
      videoQueue=state.videoQueue;
      if(!videoQueue.length){localStorage.removeItem("videoPlaybackState"); return;}
      videoQueueIndex=Math.min(Math.max(Number(state.videoQueueIndex)||0,0),videoQueue.length-1);
      const id=validIds.has(Number(state.selectedVideoId))?Number(state.selectedVideoId):videoQueue[videoQueueIndex];
      const resumeAt=Number(state.currentTime)||0;
      if(["off","all","one"].includes(state.videoRepeatMode)){
        videoRepeatMode=state.videoRepeatMode;
        localStorage.setItem("videoRepeatMode",videoRepeatMode);
      }
      restoringVideoStateNow=true;
      selectVideo(id,{autoplay:false,resumeAt,persist:false});
      setTimeout(()=>{restoringVideoStateNow=false;},2000);
      updateVideoQueueLabel();
      renderVideoQueue();
    }
    function waitForAudioEvent(eventName, timeoutMs=2500){
      return new Promise(resolve=>{
        let done=false;
        const finish=()=>{if(done)return; done=true; player.removeEventListener(eventName, finish); resolve();};
        player.addEventListener(eventName, finish, {once:true});
        setTimeout(finish, timeoutMs);
      });
    }
    function currentAudioTrack(){return tracks.find(x=>x.id===playingId);}
    async function reloadCurrentAudioAt(seconds){
      const t=currentAudioTrack();
      if(!t)return false;
      console.debug("[audio] reloading stale audio stream", {id:t.id,title:t.title,currentTime:seconds});
      player.pause();
      player.src=t.audio_url;
      player.load();
      await waitForAudioEvent("loadedmetadata");
      if(Number.isFinite(seconds)&&seconds>0&&Number.isFinite(player.duration)){
        player.currentTime=Math.min(seconds, Math.max(0, player.duration-.25));
      }else if(Number.isFinite(seconds)&&seconds>0){
        try{player.currentTime=seconds;}catch{}
      }
      return true;
    }
    // iOS/Safari can keep the lock-screen Media Session after a paused
    // Cloudflare stream goes stale. Retrying with a same-track reload lets the
    // lock-screen play button recover without losing the listener's place.
    async function playCurrentAudio({retry=true, reload=false}={}){
      if(!player.src&&!currentAudioTrack()){playList(filtered()); return;}
      const resumeAt=Number.isFinite(player.currentTime)?player.currentTime:0;
      if(reload||player.error||(!player.getAttribute("src")&&currentAudioTrack())){
        await reloadCurrentAudioAt(resumeAt);
      }
      await resumeVisualizerContext();
      try{
        await player.play();
        startVisualizer();
      }catch(err){
        if(retry&&currentAudioTrack()){
          console.warn("[audio] play failed; retrying with stream reload", err);
          if(await reloadCurrentAudioAt(resumeAt)){
            try{
              await player.play();
              startVisualizer();
              return;
            }catch(retryErr){
              console.warn("[audio] play retry failed", retryErr);
            }
          }
        }else{
          console.warn("[audio] play failed", err);
        }
      }finally{
        updateNow();
      }
    }
    function toggleAudioPlayback(){
      if(!player.src&&!currentAudioTrack()){playList(filtered()); return;}
      if(player.paused)playCurrentAudio();
      else player.pause();
    }
    // Shared UI glue. The markup fragments come from components.js, but these
    // functions still bind app-specific state and click handlers.
    function browseSummaryText(count, singular){
      return componentBrowseSummaryText(count, singular);
    }
    function renderBrowseItems(items, isActive, onChoose, summaryText=""){
      if(browseSummaryEl) browseSummaryEl.textContent = summaryText;
      const entries=items.map(item=>Array.isArray(item)?{name:item[0],count:item[1]}:item);
      groupsEl.innerHTML = browseItemsHtml(entries.map(item => ({...item,label:item.label||groupLabel(item.name),active:isActive(item.name)})));
      groupsEl.querySelectorAll(".groupItem").forEach(btn=>btn.addEventListener("click",()=>{
        onChoose(btn.dataset.group);
        setOpen(navEl, false);
      }));
    }
    function sectionGroupHtml(title, countText, cardsHtml, sectionClass="", gridClass="", actionHtml=""){
      return componentSectionGroupHtml({title,label:sectionLabel(title),countText,cardsHtml,sectionClass,gridClass,actionHtml});
    }
    function topControlBar(title, metricsHtml, controlsHtml){
      statsEl.innerHTML = topControlBarHtml({title,metricsHtml,controlsHtml});
      bindTopControls();
    }
    // Top controls are rebuilt by each tab so desktop and mobile can share the
    // same compact header instead of carrying duplicate controls inside panels.
    function albumViewOptions(){
      return selectOptionsHtml([["newest","Newest"],["oldest","Oldest"],["sections","Sections"],["years","Year"]], albumViewMode);
    }
    function renderMusicTopControls(){
      const controls = [
        topIconButton("musicBrowse","Browse",buttonIcon("browse"),"browseToggle"),
        topQueueButton("musicQueue","Queue",queue.length),
        `<select class="topSelect" data-top-action="albumView" title="Album view" aria-label="Album view">${albumViewOptions()}</select>`,
        topIconButton("musicPlay","Play shown songs","&#9654;"),
        topIconButton("musicShuffle","Shuffle shown songs","&#8644;"),
      ].join("");
      topControlBar("Music", "", controls);
    }
    function renderVideoTopControls(title){
      const controls = [
        topQueueButton("videoQueue","Video queue",videoQueue.length),
        topIconButton("videoShuffle","Shuffle shown videos","&#8644;"),
      ].join("");
      topControlBar(title, "", controls);
    }
    function renderInterviewsTopControls(){
      topControlBar("Interviews", "", [
        topIconButton("interviewBrowse","Browse",buttonIcon("browse"),"browseToggle"),
        topIconButton("interviewShuffle","Random interview","&#8644;"),
      ].join(""));
    }
    function renderHealthTopControls(){
      topControlBar("Library Health", "", topIconButton("healthRefresh","Refresh","&#8635;"));
    }
    async function refreshHealth(){
      await loadTracks(true, selectedId);
      if(!videosLoaded) await loadVideos();
      if(mediaType==="health") renderHealth();
    }
    function bindTopControls(){
      statsEl.querySelectorAll("[data-top-action]").forEach(control=>{
        const action = control.dataset.topAction;
        if(control.tagName === "SELECT"){
          on(control,"change",()=>{if(action==="albumView")setAlbumViewMode(control.value);});
          return;
        }
        on(control,"click",()=>{
          if(action==="musicBrowse")toggleBrowse();
          else if(action==="musicQueue")toggleMusicQueue();
          else if(action==="musicPlay")playList(currentPlaybackList());
          else if(action==="musicShuffle")playList(currentPlaybackList(),true);
          else if(action==="videoQueue")toggleVideoQueue();
          else if(action==="videoShuffle")playVideoList(videoFiltered(),true);
          else if(action==="interviewBrowse")toggleBrowse();
          else if(action==="interviewShuffle")shuffleInterview();
          else if(action==="healthRefresh")refreshHealth();
        });
      });
    }
    function bindQueueList(listEl, playIndex, removeIndex){
      listEl.querySelectorAll(".queueItem[data-index]").forEach(item=>item.addEventListener("click",e=>{
        if(e.target.closest("button[data-remove]")) return;
        playIndex(Number(item.dataset.index));
      }));
      listEl.querySelectorAll("button[data-remove]").forEach(btn=>btn.addEventListener("click",e=>{
        e.stopPropagation();
        removeIndex(Number(btn.dataset.remove));
      }));
    }
    function passesFieldFilter(t){
      const value = musicFilterEl.value;
      if(value==="all") return true;
      if(value==="missing:any") return t.missing_fields.length > 0;
      if(value.startsWith("missing:")) return t.missing_fields.includes(value.split(":")[1]);
      if(value==="review:any") return t.review_flags.length > 0;
      if(value.startsWith("review:")) return t.review_flags.includes(value.slice(7));
      return true;
    }
    function sortValue(t,key){if(key==="has_artwork")return t.has_artwork?1:0; return String(t[key]??"").toLowerCase();}
    // Prefer embedded track numbers, but fall back to names like "01 - Title.flac".
    function trackParts(t){const raw=String(t.tracknumber||"").trim(); const match=raw.match(/(?:(\d+)[/. -]+)?(\d+)/); const pathMatch=String(t.path||"").match(/(?:^|[\\/])(?:(\d+)-)?(\d+)\s*[-.]/); const disc=match&&match[1]?Number(match[1]):pathMatch&&pathMatch[1]?Number(pathMatch[1]):1; const track=match&&match[2]?Number(match[2]):pathMatch&&pathMatch[2]?Number(pathMatch[2]):9999; return {disc,track};}
    function albumTrackList(list){return [...list].sort((a,b)=>{const at=trackParts(a), bt=trackParts(b); if(at.disc!==bt.disc)return at.disc-bt.disc; if(at.track!==bt.track)return at.track-bt.track; return String(a.title||a.path||"").localeCompare(String(b.title||b.path||""),undefined,{numeric:true,sensitivity:"base"});});}
    function sortedList(list){return [...list].sort((a,b)=>{const av=sortValue(a,sortKey), bv=sortValue(b,sortKey); let result=0; if(typeof av==="number"&&typeof bv==="number") result=av-bv; else result=String(av).localeCompare(String(bv),undefined,{numeric:true,sensitivity:"base"}); return sortDir==="asc"?result:-result;});}
    function newestFirstList(list){return [...list].sort((a,b)=>{const ay=Number(String(a.date||"").slice(0,4))||0, by=Number(String(b.date||"").slice(0,4))||0; if(ay!==by)return by-ay; const ad=String(a.date||""), bd=String(b.date||""); if(ad!==bd)return bd.localeCompare(ad,undefined,{numeric:true,sensitivity:"base"}); const aa=albumOf(a), ba=albumOf(b); if(aa!==ba)return aa.localeCompare(ba,undefined,{numeric:true,sensitivity:"base"}); const at=Number(String(a.tracknumber||"").split("/")[0])||0, bt=Number(String(b.tracknumber||"").split("/")[0])||0; if(at!==bt)return at-bt; return String(a.title||"").localeCompare(String(b.title||""),undefined,{numeric:true,sensitivity:"base"});});}
    function showQueueToast(message){if(!queueToastEl)return; clearTimeout(queueToastTimer); queueToastEl.textContent=message; queueToastEl.classList.add("show"); queueToastTimer=setTimeout(()=>queueToastEl.classList.remove("show"),1300);}
    function pulseQueueButton(button){if(!button)return; button.classList.remove("queuePulse"); void button.offsetWidth; button.classList.add("queuePulse");}
    function clearSearchQuery(){if(searchEl)searchEl.value="";}
    // Named view transitions keep screen state changes in one place.
    function resetMusicSelection(){selectedGroup="All"; selectedAlbum="All"; selectedPlaylistId=null;}
    function openMusicGroup(group){clearSearchQuery(); selectedGroup=group; selectedAlbum="All"; selectedPlaylistId=null; renderAll();}
    function openMusicAlbum(album){selectedAlbum=album; selectedPlaylistId=null; renderAll();}
    function openPlaylist(id){selectedGroup="Playlists"; selectedAlbum="All"; selectedPlaylistId=id; renderAll();}
    function closeMusicAlbum(){
      const closingPlaylist=Boolean(selectedPlaylistId);
      selectedAlbum="All";
      selectedPlaylistId=null;
      // A playlist is a detail destination, not a sticky library filter.
      // Return to the complete album library when its detail view closes.
      if(closingPlaylist)selectedGroup="All";
      renderAll();
    }
    function setAlbumViewMode(mode){albumViewMode=mode; localStorage.setItem("albumViewMode",albumViewMode); tableSortActive=false; selectedAlbum="All"; selectedPlaylistId=null; if(albumViewMode==="sections"||albumViewMode==="years"){selectedGroup="All"; searchEl.value="";} renderAll();}
    function openVideoGroup(group){clearSearchQuery(); selectedVideoGroup=group; selectedVideoAsFolder=false; renderVideoAll();}
    function openVideoFolder(folder){selectedVideoGroup=folder; selectedVideoAsFolder=true; renderVideoAll();}
    function closeVideoFolder(){selectedVideoGroup="All"; selectedVideoAsFolder=false; renderVideoAll();}
    // Music filtering/rendering. These functions decide what the current music page shows.
    function playlistById(id=selectedPlaylistId){return playlists.find(playlist=>playlist.id===id)||null;}
    function playlistTracks(playlist=playlistById()){return playlist?playlist.track_ids.map(id=>tracks.find(track=>track.id===id)).filter(Boolean):[];}
    function baseFiltered(){if(selectedPlaylistId)return playlistTracks(); const filter=musicFilterEl.value; return tracks.filter(t=>{if(selectedGroup!=="Playlists"&&!musicGroupMatches(t))return false; if(selectedGroup==="Playlists")return false; if(selectedAlbum!=="All"&&albumOf(t)!==selectedAlbum)return false; if(filter==="art:with"&&!t.has_artwork)return false; if(filter==="art:missing"&&t.has_artwork)return false; if(!passesFieldFilter(t))return false; if(!containsSearch([t.title,t.artist,t.album,t.albumartist,t.date,t.path,t.folder]))return false; return true;});}
    function filtered(){const list=baseFiltered(); if(selectedPlaylistId)return list; if(selectedAlbum!=="All")return albumTrackList(list); return appMode==="listen"&&!tableSortActive?currentPlaybackList():sortedList(list);}
    function musicBrowseHierarchy(counts){
      const parentGroups=new Map();
      for(const [name,count] of counts){
        const parts=String(name).split("/").filter(Boolean);
        const parent=parts[0]||"(root)";
        if(!parentGroups.has(parent))parentGroups.set(parent,{count:0,children:[]});
        const group=parentGroups.get(parent);
        group.count+=count;
        if(parts.length>1)group.children.push([name,count]);
      }
      const entries=[];
      for(const [parent,{count,children}] of [...parentGroups.entries()].sort(musicCategoryCompare)){
        entries.push({name:parent,label:parent,count,className:children.length?"browseParent":""});
        children.sort(musicCategoryCompare).forEach(([name,childCount])=>entries.push({name,label:groupLabel(name),count:childCount,className:"browseChild"}));
      }
      return entries;
    }
    function renderGroups(){
      const counts = new Map();
      for(const t of tracks){
        const group = groupOf(t);
        counts.set(group, (counts.get(group) || 0) + 1);
      }
      let groups;
      if(groupMode==="category"){
        groups=[{name:"All",count:tracks.length,className:"browseRoot"}];
        if(playlists.length)groups.push({name:"Playlists",count:playlists.length,className:"browseRoot"});
        groups.push(...musicBrowseHierarchy(counts));
      }else{
        groups=[["All",tracks.length],...counts.entries()].sort((a,b)=>a[0]==="All"?-1:b[0]==="All"?1:b[1]-a[1]||a[0].localeCompare(b[0]));
        if(playlists.length)groups.splice(1,0,["Playlists",playlists.length]);
      }
      if(!groups.some(item=>(Array.isArray(item)?item[0]:item.name)===selectedGroup))selectedGroup="All";
      renderBrowseItems(groups, name=>name===selectedGroup, openMusicGroup, browseSummaryText(tracks.length, "track"));
    }
    function renderStats(){renderMusicTopControls();}
    function renderSortHeaders(){const showSort=appMode!=="listen"||selectedAlbum!=="All"||tableSortActive; document.querySelectorAll("th.sortable").forEach(th=>{const active=showSort&&th.dataset.sort===sortKey; th.classList.toggle("sorted",active); th.classList.toggle("asc",active&&sortDir==="asc"); th.classList.toggle("desc",active&&sortDir==="desc");});}
    function renderSelection(){selectedCountEl.textContent=`${selectedIds.size} selected`; const shown=filtered().map(t=>t.id); selectShownEl.checked=shown.length>0&&shown.every(id=>selectedIds.has(id)); const selectedArt=byId("saveSelectedArt"); if(selectedArt){selectedArt.disabled=selectedIds.size===0; selectedArt.textContent=selectedIds.size?`Replace ${selectedIds.size} Selected`:"Replace Selected Art";}}
    function badges(t){const bits=[]; if(t.missing_fields.length) bits.push(`<span class="pill missing">Missing: ${esc(t.missing_fields.join(", "))}</span>`); if(t.review_flags.length) bits.push(`<span class="pill missing">Review</span>`); return bits.join(" ");}
    function albumSource(){if(selectedGroup==="Playlists")return []; return tracks.filter(t=>musicGroupMatches(t)&&containsSearch([t.title,t.artist,t.album,t.albumartist,t.date,t.path,t.folder]));}
    function albumList(name){return albumSource().filter(t=>albumOf(t)===name);}
    function albumYears(list){return [...new Set(list.map(t=>(t.date||"").slice(0,4)).filter(Boolean))].sort();}
    function albumFormats(list){return [...new Set(list.map(t=>String(t.format||"").toUpperCase()).filter(Boolean))].sort();}
    function albumArtists(list){return [...new Set(list.map(t=>t.artist).filter(Boolean))].slice(0,4);}
    function albumSizeMb(list){return list.reduce((sum,t)=>sum+(Number(t.size_mb)||0),0).toFixed(1);}
    function albumWarnings(list, formats){const warnings=[]; const missingArt=list.filter(t=>!t.has_artwork).length; const missingDate=list.filter(t=>!t.date).length; const missingTrack=list.filter(t=>!t.tracknumber).length; if(missingArt)warnings.push(`${missingArt} missing art`); if(missingDate)warnings.push(`${missingDate} missing date`); if(missingTrack)warnings.push(`${missingTrack} missing track #`); if(formats.length>1)warnings.push(`Mixed formats: ${formats.join(", ")}`); return warnings;}
    function albumCoverHtml(list){const art=list.find(t=>t.has_artwork); return art?`<img class="albumDetailCover detailArt" src="${fullArtUrl(art)}" alt="" loading="lazy" decoding="async">`:`<div class="albumDetailCover detailArt">No Art</div>`;}
    function albumWarningHtml(warnings){return musicComponents.albumWarningHtml(warnings);}
    function renderAlbumDetail(list){
      if(selectedAlbum==="All"||!list.length)return "";
      const years=albumYears(list), formats=albumFormats(list), artists=albumArtists(list), warnings=albumWarnings(list,formats);
      return musicComponents.albumDetailHtml({
        coverHtml:albumCoverHtml(list),
        title:selectedAlbum,
        meta:`${artists.join(", ")||"Unknown artist"}${years.length?` - ${years.join(", ")}`:""}`,
        stats:[countLabel(list.length,"track"), formats.join(", ")||"Unknown format", `${albumSizeMb(list)} MB`],
        warnings,
        queueCount:queue.length,
        queueIconHtml:buttonIcon("queue"),
      });
    }
    function scrollQueueCurrentToTop(listEl,index){
      if(index<0){listEl.style.setProperty("--queue-scroll-runway","0px"); return;}
      requestAnimationFrame(()=>{
        const item=listEl.querySelector(`.queueItem[data-index="${index}"]`);
        if(!item)return;
        const runway=Math.max(0,listEl.clientHeight-item.offsetHeight-16);
        listEl.style.setProperty("--queue-scroll-runway",`${runway}px`);
        const listRect=listEl.getBoundingClientRect();
        const itemRect=item.getBoundingClientRect();
        listEl.scrollTop+=itemRect.top-listRect.top-8;
      });
    }
    function toggleMusicQueue(){
      const opening=!queueDrawerEl.classList.contains("open");
      toggleOpen(queueDrawerEl);
      renderQueue();
      if(opening)scrollQueueCurrentToTop(queueListEl,queueIndex);
    }
    function toggleVideoQueue(){
      const opening=!videoQueueDrawerEl.classList.contains("open");
      toggleOpen(videoQueueDrawerEl);
      renderVideoQueue();
      if(opening)scrollQueueCurrentToTop(videoQueueListEl,videoQueueIndex);
    }
    // Albums sort by their earliest track year, so multi-year albums stay together.
    function albumSortYear(list){const years=list.map(t=>Number(String(t.date||"").slice(0,4))).filter(y=>Number.isFinite(y)&&y>0); return years.length?Math.min(...years):-1;}
    function albumEntries(source){const albums=new Map(); for(const t of source){const name=albumOf(t); if(!albums.has(name)) albums.set(name,[]); albums.get(name).push(t);} return [...albums.entries()].sort((a,b)=>albumSortYear(b[1])-albumSortYear(a[1])||a[0].localeCompare(b[0],undefined,{numeric:true,sensitivity:"base"}));}
    function albumCardHtml(name,list){const art=list.find(t=>t.has_artwork); const years=[...new Set(list.map(t=>(t.date||"").slice(0,4)).filter(Boolean))].sort(); return musicComponents.albumCardHtml({name,artHtml:art?`<img class="albumArt" src="${artUrl(art)}" alt="" loading="lazy" decoding="async">`:"No Art",years,countText:countLabel(list.length,"track"),isPlaying:list.some(t=>t.id===playingId)});}
    function playlistArtUrls(playlist, full=false){
      const seenAlbums=new Set();
      return playlistTracks(playlist).filter(track=>{
        if(!track.has_artwork)return false;
        const albumKey=`${String(track.albumartist||track.artist||"").toLowerCase()}\u0000${String(albumOf(track)||track.folder||track.id).toLowerCase()}`;
        if(seenAlbums.has(albumKey))return false;
        seenAlbums.add(albumKey);
        return true;
      }).map(track=>full?fullArtUrl(track):artUrl(track));
    }
    function playlistFormats(playlist){return albumFormats(playlistTracks(playlist));}
    function playlistSizeMb(playlist){return albumSizeMb(playlistTracks(playlist));}
    function playlistCardHtml(playlist){return playlistComponents.cardHtml({playlist,artUrls:playlistArtUrls(playlist),isPlaying:playlist.track_ids.includes(playingId)});}
    function visiblePlaylists(){const query=searchQuery(); if(!query)return playlists; return playlists.filter(playlist=>playlist.name.toLowerCase().includes(query)||playlistTracks(playlist).some(t=>containsSearch([t.title,t.artist,t.album])));}
    function renderPlaylistDetail(playlist){return playlistComponents.detailHtml({playlist,artUrls:playlistArtUrls(playlist,true),formats:playlistFormats(playlist),sizeMb:playlistSizeMb(playlist),queueCount:queue.length,queueIconHtml:buttonIcon("queue"),editable:appConfig.playlistEditable});}
    function bindPlaylistCards(){
      albumGridEl.querySelectorAll("button[data-playlist-action]").forEach(btn=>on(btn,"click",event=>{event.stopPropagation(); const playlist=playlistById(btn.dataset.playlistId); if(!playlist)return; const list=playlistTracks(playlist); if(btn.dataset.playlistAction==="add")addToMusicQueue(list); else playPlaylist(playlist,btn.dataset.playlistAction==="shuffle");}));
      albumGridEl.querySelectorAll(".playlistCard[data-playlist-id]").forEach(card=>{const open=()=>openPlaylist(card.dataset.playlistId); on(card,"click",event=>{if(!event.target.closest(".cardActions"))open();}); on(card,"keydown",event=>{if(event.key==="Enter")open();});});
    }
    function bindPlaylistDetail(playlist){
      const list=playlistTracks(playlist);
      on(byId("playlistPlay"),"click",()=>playPlaylist(playlist));
      on(byId("playlistShuffle"),"click",()=>playPlaylist(playlist,true));
      on(byId("playlistAddQueue"),"click",()=>addToMusicQueue(list));
      on(byId("playlistQueue"),"click",toggleMusicQueue);
      const rename=byId("playlistRename"), remove=byId("playlistDelete");
      if(rename)on(rename,"click",()=>openPlaylistDialog("rename",playlist));
      if(remove)on(remove,"click",()=>deletePlaylist(playlist));
    }
    function renderPlaylists(){
      const playlist=playlistById();
      const isOpen=Boolean(playlist);
      document.body.classList.toggle("albumSelected",isOpen);
      const back=byId("showAllAlbums");
      if(back)back.hidden=!isOpen;
      albumGridEl.classList.toggle("albumFocus",isOpen);
      albumGridEl.innerHTML=isOpen?renderPlaylistDetail(playlist):visiblePlaylists().map(playlistCardHtml).join("");
      if(isOpen)bindPlaylistDetail(playlist); else bindPlaylistCards();
    }
    function albumSectionName(list){const counts=new Map(); for(const t of list){const name=categoryOf(t); counts.set(name,(counts.get(name)||0)+1);} return [...counts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],undefined,{numeric:true,sensitivity:"base"}))[0]?.[0]||"(root)";}
    function albumSections(ordered){const buckets=new Map(); for(const [name,list] of ordered){const bucket=albumSectionName(list); if(!buckets.has(bucket))buckets.set(bucket,[]); buckets.get(bucket).push([name,list]);} return [...buckets.entries()].sort(musicCategoryCompare);}
    function albumYearName(list){const year=albumSortYear(list); return year>0?String(year):"Unknown Year";}
    function albumYearSections(ordered){const buckets=new Map(); for(const [name,list] of ordered){const bucket=albumYearName(list); if(!buckets.has(bucket))buckets.set(bucket,[]); buckets.get(bucket).push([name,list]);} return [...buckets.entries()].sort((a,b)=>{const ay=Number(a[0]), by=Number(b[0]); if(Number.isFinite(ay)&&Number.isFinite(by))return by-ay; if(a[0]==="Unknown Year")return 1; if(b[0]==="Unknown Year")return -1; return a[0].localeCompare(b[0]);});}
    function albumDisplayEntries(source=albumSource()){const ordered=albumEntries(source); if(albumViewMode==="oldest")return [...ordered].reverse(); if(albumViewMode==="sections"&&!searchQuery())return albumSections(ordered).flatMap(([_title,items])=>items); if(albumViewMode==="years"&&!searchQuery())return albumYearSections(ordered).flatMap(([_title,items])=>items); return ordered;}
    function currentPlaybackList(){if(selectedPlaylistId)return playlistTracks(); if(selectedAlbum!=="All")return albumTrackList(albumList(selectedAlbum)); return albumDisplayEntries(albumSource()).flatMap(([_name,list])=>albumTrackList(list));}
    function musicSectionActionHtml(title){
      return `<button class="secondary iconControl sectionPlayButton" data-music-section-play="${esc(title)}" type="button" title="Play section" aria-label="Play ${esc(sectionLabel(title))}">&#9654;</button>`;
    }
    function renderAlbumSectionGroups(groups){return groups.map(([title,items])=>sectionGroupHtml(title, `${items.length} album${items.length===1?"":"s"}`, items.map(([name,list])=>albumCardHtml(name,list)).join(""), "", "", musicSectionActionHtml(title))).join("");}
    function renderAlbumSections(ordered){if(searchQuery())return ordered.map(([name,list])=>albumCardHtml(name,list)).join(""); return renderAlbumSectionGroups(albumSections(ordered));}
    function renderAlbumYearSections(ordered){if(searchQuery())return ordered.map(([name,list])=>albumCardHtml(name,list)).join(""); return renderAlbumSectionGroups(albumYearSections(ordered));}
    function sourceAlbumList(source, album){return albumTrackList(source.filter(t=>albumOf(t)===album));}
    function bindAlbumButtons(source){albumGridEl.querySelectorAll("button[data-action]").forEach(btn=>btn.addEventListener("click",(e)=>{e.stopPropagation(); btn.blur(); const album=btn.dataset.album, action=btn.dataset.action; if(action==="resume-play")return; if(action==="select"){openMusicAlbum(album); return;} const list=sourceAlbumList(source,album); if(action==="add"){addToMusicQueue(list); return;} playList(list, action==="shuffle");}));}
    function bindAlbumCards(source){albumGridEl.querySelectorAll(".albumCard[data-album]").forEach(card=>{card.addEventListener("click",e=>{if(e.target.closest(".cardActions"))return; clearTimeout(albumClickTimer); albumClickTimer=setTimeout(()=>openMusicAlbum(card.dataset.album),220);}); card.addEventListener("keydown",e=>{if(e.key==="Enter")openMusicAlbum(card.dataset.album);}); card.addEventListener("dblclick",e=>{if(e.target.closest(".cardActions"))return; clearTimeout(albumClickTimer); playList(sourceAlbumList(source,card.dataset.album));});});}
    function sectionTrackList(title){const ordered=albumEntries(albumSource()); const groups=albumViewMode==="years"?albumYearSections(ordered):albumSections(ordered); const group=groups.find(([groupTitle])=>groupTitle===title); return group?group[1].flatMap(([_name,list])=>albumTrackList(list)):[];}
    function bindAlbumSectionActions(){albumGridEl.querySelectorAll("button[data-music-section-play]").forEach(btn=>btn.addEventListener("click",e=>{e.stopPropagation(); const list=sectionTrackList(btn.dataset.musicSectionPlay); if(list.length)playList(list);}));}
    function bindAlbumDetailActions(){const play=byId("albumPlay"), shuffleBtn=byId("albumShuffle"), addBtn=byId("albumAddQueue"), queueBtn=byId("albumQueue"), edit=byId("albumEdit"); if(play)on(play,"click",()=>playList(filtered())); if(shuffleBtn)on(shuffleBtn,"click",()=>playList(filtered(),true)); if(addBtn)on(addBtn,"click",()=>addToMusicQueue(filtered())); if(queueBtn)on(queueBtn,"click",toggleMusicQueue); if(edit)on(edit,"click",()=>enterEditMode());}
    function renderAlbums(){if(selectedGroup==="Playlists"){renderPlaylists(); return;} const source=albumSource(); const ordered=albumEntries(source); const displayOrdered=albumDisplayEntries(source); const selectedList=selectedAlbum==="All"?[]:albumList(selectedAlbum); const albumOpen=selectedAlbum!=="All"; document.body.classList.toggle("albumSelected",albumOpen); const backToAlbums=byId("showAllAlbums"); if(backToAlbums)backToAlbums.hidden=!albumOpen; if(albumViewModeEl)albumViewModeEl.value=albumViewMode; albumGridEl.classList.toggle("albumFocus",albumOpen); let homeHtml=albumViewMode==="sections"?renderAlbumSections(ordered):albumViewMode==="years"?renderAlbumYearSections(ordered):displayOrdered.map(([name,list])=>albumCardHtml(name,list)).join(""); if(albumViewMode==="sections"&&selectedGroup==="All"&&playlists.length&&!searchQuery())homeHtml=sectionGroupHtml("Playlists",countLabel(playlists.length,"playlist"),playlists.map(playlistCardHtml).join(""),"playlistHomeSection")+homeHtml; albumGridEl.innerHTML=albumOpen?renderAlbumDetail(selectedList):homeHtml; bindAlbumButtons(source); bindAlbumCards(source); bindAlbumSectionActions(); bindAlbumDetailActions(); bindPlaylistCards();}
    function trackRowHtml(track, divider=""){
      const trackNo=String(track.tracknumber||"").split("/")[0];
      const art=track.has_artwork?`<img class="coverThumb" src="${smallArtUrl(track)}" alt="" loading="lazy" decoding="async">`:`<span class="noArt">?</span>`;
      return `${divider}${musicComponents.trackRowHtml({track,trackNo:trackNo||"",artHtml:art,badgesHtml:badges(track),selected:track.id===selectedId,playing:track.id===playingId,checked:selectedIds.has(track.id)})}`;
    }
    function trackRowsHtml(list){
      let lastAlbum=null;
      return list.map(track=>{
        const album=albumOf(track);
        const divider=album!==lastAlbum?musicComponents.mobileAlbumDividerHtml(album):"";
        lastAlbum=album;
        return trackRowHtml(track,divider);
      }).join("");
    }
    function bindTrackRows(){
      rowsEl.querySelectorAll("tr[data-id]").forEach(row=>row.addEventListener("click",event=>{
        if(event.target.closest(".rowActions")||event.target.classList.contains("rowCheck"))return;
        const id=Number(row.dataset.id);
        if(appMode==="listen") playSingleTrack(id); else selectTrack(id);
      }));
      rowsEl.querySelectorAll(".playSong").forEach(btn=>btn.addEventListener("click",event=>{event.stopPropagation(); playSingleTrack(Number(btn.dataset.id));}));
      rowsEl.querySelectorAll(".addSongQueue").forEach(btn=>btn.addEventListener("click",event=>{
        event.stopPropagation();
        const track=tracks.find(item=>item.id===Number(btn.dataset.id));
        if(track)addToMusicQueue([track]);
      }));
      rowsEl.querySelectorAll(".rowCheck").forEach(check=>check.addEventListener("change",()=>{
        const id=Number(check.dataset.id);
        check.checked?selectedIds.add(id):selectedIds.delete(id);
        renderSelection();
      }));
    }
    function renderRows(){
      const list=filtered();
      viewTitleEl.textContent = selectedPlaylistId ? "Playlist" : selectedAlbum!=="All" ? (appMode==="listen"?"Album":selectedAlbum) : selectedGroup;
      renderStats();
      renderSortHeaders();
      rowsEl.innerHTML=trackRowsHtml(list);
      bindTrackRows();
      renderSelection();
    }
    function updatePlayingHighlights(){const t=tracks.find(x=>x.id===playingId); rowsEl.querySelectorAll("tr[data-id]").forEach(row=>row.classList.toggle("playingNow",Number(row.dataset.id)===playingId)); albumGridEl.querySelectorAll(".albumCard[data-album]").forEach(card=>card.classList.toggle("playingNow",!!t&&card.dataset.album===albumOf(t))); albumGridEl.querySelectorAll(".playlistCard[data-playlist-id]").forEach(card=>card.classList.toggle("playingNow",Boolean(playlistById(card.dataset.playlistId)?.track_ids.includes(playingId))));}
    function renderAll(){renderGroups(); renderAlbums(); renderRows();}
    // Video browsing treats folders like albums. Cover images come from cover.jpg/png/webp.
    const yearFromText=videoDomain.yearFromText;
    const videoYear=videoDomain.videoYear;
    const videoFileCompare=videoDomain.videoFileCompare;
    function videoCompare(a,b){const ay=videoYear(a), by=videoYear(b); if(ay!==by)return videoSort==="oldest"?ay-by:by-ay; return videoFileCompare(a,b);}
    function videoFiltered(){return videos.filter(v=>{const matchesGroup=selectedVideoGroup==="All" || (selectedVideoAsFolder?v.folder===selectedVideoGroup:(v.category===selectedVideoGroup || v.folder===selectedVideoGroup)); if(!matchesGroup)return false; return containsSearch([v.title,v.folder,v.category,v.path,v.format]);}).sort(videoFileCompare);}
    function isVideoCategory(group){return !selectedVideoAsFolder&&group!=="All"&&videos.some(v=>v.category===group);}
    function videoCategoryRank(name){return preferredCategoryRank(name, appConfig.preferredVideoCategories);}
    function videoNameCompare(a,b){const ar=videoCategoryRank(a), br=videoCategoryRank(b); if(ar!==br)return ar-br; return String(a).localeCompare(String(b),undefined,{numeric:true,sensitivity:"base"});}
    function videoFolderSort(a,b){const ar=videoCategoryRank(a[0]), br=videoCategoryRank(b[0]); if(ar!==br)return ar-br; const ay=Math.max(...a[1].map(videoYear).filter(Boolean),0), by=Math.max(...b[1].map(videoYear).filter(Boolean),0); if(ay!==by)return videoSort==="oldest"?ay-by:by-ay; return a[0].localeCompare(b[0],undefined,{numeric:true,sensitivity:"base"});}
    function videoFolderGroups(category){const groups=new Map(); const source=category==="All"?videos:videos.filter(v=>v.category===category); for(const v of source){const name=v.folder||"(root)"; if(!groups.has(name))groups.set(name,[]); groups.get(name).push(v);} return [...groups.entries()].filter(([name])=>name!=="(root)").sort(videoFolderSort);}
    function videoFolderActionsHtml(folder){return videoComponents.folderActionsHtml(folder);}
    function videoActionsHtml(id){return videoComponents.videoActionsHtml(id);}
    function videoGroupActionsHtml(group){return videoComponents.groupActionsHtml(group);}
    function setVideoGridMode(mode){videoGridEl.classList.toggle("videoFileMode",mode==="files"); videoGridEl.classList.toggle("videoCollectionMode",mode==="collections"); if(mode!=="files"){videoGridEl.classList.remove("videoFolderOpen"); document.body.classList.remove("videoAlbumSelected");}}
    function videoFolderCoverHtml(list, className="videoThumb"){return videoComponents.folderCoverHtml(list, className);}
    function videoFolderFormats(list){return [...new Set(list.map(v=>String(v.format||"").toUpperCase()).filter(Boolean))].sort();}
    function videoFolderSizeMb(list){return list.reduce((sum,v)=>sum+(Number(v.size_mb)||0),0).toFixed(1);}
    function savedVideoResumeTime(){
      const current=Number(videoPlayerEl.currentTime);
      if(Number.isFinite(current)&&current>1)return current;
      try{return Number(JSON.parse(localStorage.getItem("videoPlaybackState")||"{}").currentTime)||0;}catch{return 0;}
    }
    function videoResumeCardHtml(){
      if(!videoQueue.length||videoQueueIndex<0)return "";
      if(selectedVideoId!==null && videoPlayerEl.currentSrc)return "";
      const v=videos.find(x=>x.id===selectedVideoId)||videos.find(x=>x.id===videoQueue[videoQueueIndex]);
      if(!v)return "";
      const resumeAt=savedVideoResumeTime();
      const queueText=videoQueue.length===1?"1 video":`${videoQueue.length} videos`;
      return videoComponents.resumeCardHtml({
        video:v,
        resumeAtText:resumeAt>1?` at ${fmt(resumeAt)}`:"",
        queueText,
        groupLabel:groupLabel(v.folder||v.category||"Video"),
      });
    }
    function videoCollectionCardHtml(name,list,kind="folder"){const years=[...new Set(list.map(videoYear).filter(Boolean))].sort((a,b)=>b-a); const actions=kind==="section"?videoGroupActionsHtml(name):videoFolderActionsHtml(name); return videoComponents.collectionCardHtml({name,label:groupLabel(name),list,kind,years,actionsHtml:actions});}
    function videoFolderDetailHtml(name,list){
      const years=[...new Set(list.map(videoYear).filter(Boolean))].sort((a,b)=>b-a);
      const formats=videoFolderFormats(list);
      return videoComponents.folderDetailHtml({name,label:groupLabel(name),list,years,formats,sizeMb:videoFolderSizeMb(list),countText:countLabel(list.length,"video")});
    }
    function videoAlbumRowsHtml(list){
      return videoComponents.albumRowsHtml(list.map((v,index)=>({
        id:v.id,
        index,
        title:v.title,
        meta:`${videoMetaSummary(v)}${v.browser_friendly?"":" - may need conversion"}`,
        active:v.id===selectedVideoId,
      })));
    }
    function videoSectionGroups(){const groups=new Map(); for(const v of videos){const name=v.category||"(root)"; if(!groups.has(name))groups.set(name,[]); groups.get(name).push(v);} return [...groups.entries()].sort(videoFolderSort);}
    function bindVideoFolderCards(){videoGridEl.querySelectorAll("button[data-folder-action]").forEach(btn=>btn.addEventListener("click",e=>{e.stopPropagation(); const folder=btn.dataset.folder, action=btn.dataset.folderAction; const list=videos.filter(v=>v.folder===folder).sort(videoFileCompare); if(action==="add"){addToVideoQueue(list); return;} playVideoList(list, action==="shuffle");})); videoGridEl.querySelectorAll(".videoFolderCard[data-folder]").forEach(card=>{card.addEventListener("click",e=>{if(e.target.closest(".cardActions"))return; openVideoFolder(card.dataset.folder);}); card.addEventListener("keydown",e=>{if(e.key==="Enter")openVideoFolder(card.dataset.folder);});});}
    function bindVideoResumeCard(){const card=videoGridEl.querySelector(".videoResumeCard"); if(!card)return; const resume=()=>{const id=selectedVideoId||videoQueue[videoQueueIndex]; if(id!==undefined)selectVideo(id,{autoplay:true,resumeAt:savedVideoResumeTime()});}; card.addEventListener("click",e=>{if(e.target.closest("button"))return; resume();}); card.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault(); resume();}}); const btn=card.querySelector("button[data-action='video-resume-play']"); if(btn)btn.addEventListener("click",e=>{e.stopPropagation(); btn.blur(); resume();});}
    function bindVideoGroupActions(){videoGridEl.querySelectorAll("button[data-video-group-action]").forEach(btn=>btn.addEventListener("click",e=>{e.stopPropagation(); const group=btn.dataset.group, action=btn.dataset.videoGroupAction; const list=videos.filter(v=>v.category===group).sort(videoFileCompare); if(action==="add"){addToVideoQueue(list); return;} playVideoList(list, action==="shuffle");})); videoGridEl.querySelectorAll(".videoFolderCard[data-section]").forEach(card=>{card.addEventListener("click",e=>{if(e.target.closest(".cardActions"))return; openVideoGroup(card.dataset.section);}); card.addEventListener("keydown",e=>{if(e.key==="Enter")openVideoGroup(card.dataset.section);});});}
    function renderVideoSections(){if(selectedVideoGroup!=="All"||searchQuery()||videoSort!=="sections")return false; setVideoGridMode("collections"); const sections=videoSectionGroups(); const list=videoFiltered(); videoViewTitleEl.textContent="Video Sections"; renderVideoStats(list); videoGridEl.innerHTML=videoResumeCardHtml()+sections.map(([sectionName,items])=>{const folders=videoFolderGroups(sectionName); const cards=folders.length?folders.map(([folder,folderList])=>videoCollectionCardHtml(folder,folderList,"folder")).join(""):videoCollectionCardHtml(sectionName,items,"section"); return sectionGroupHtml(sectionName, `${items.length} video${items.length===1?"":"s"}`, cards, "videoHomeSection", "videoSectionGrid");}).join(""); bindVideoResumeCard(); bindVideoFolderCards(); bindVideoGroupActions(); return true;}
    function renderVideoFolderCards(category){if(searchQuery())return false; const folders=videoFolderGroups(category); if(!folders.length)return false; setVideoGridMode("collections"); const allList=videoFiltered(); videoViewTitleEl.textContent=category==="All"?"Videos":groupLabel(category); renderVideoStats(allList); videoGridEl.innerHTML=videoResumeCardHtml()+folders.map(([folder,list])=>videoCollectionCardHtml(folder,list,"folder")).join(""); bindVideoResumeCard(); bindVideoFolderCards(); return true;}
    function renderVideoGroups(){
      const counts = new Map();
      counts.set("All", videos.length);
      for(const v of videos){
        const category = v.category || "(root)";
        counts.set(category, (counts.get(category) || 0) + 1);
      }
      if(!counts.has(selectedVideoGroup) && !isVideoFolder(selectedVideoGroup)) selectedVideoGroup = "All";
      const groups = [...counts.entries()].sort((a,b)=>videoNameCompare(a[0],b[0]));
      renderBrowseItems(groups, name=>!selectedVideoAsFolder&&name===selectedVideoGroup, openVideoGroup, browseSummaryText(videos.length, "video"));
    }
    function renderVideoStats(){renderVideoTopControls(videoViewTitleEl.textContent || "Videos");}
    // Health is only for real cleanup issues, not personal preference warnings.
    function renderHealthStats(){renderHealthTopControls();}
    function renderInterviewStats(){renderInterviewsTopControls();}
    function groupByAlbum(){const albums=new Map(); for(const t of tracks){const key=`${albumOf(t)}||${t.albumartist||t.artist||""}`; if(!albums.has(key))albums.set(key,{name:albumOf(t), artist:t.albumartist||t.artist||"", tracks:[]}); albums.get(key).tracks.push(t);} return [...albums.values()].sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:"base"}));}
    function healthItem(title,sub,action,label="Review"){return `<div class="healthItem"><div><div class="healthItemTitle">${esc(title)}</div><div class="healthItemSub">${esc(sub)}</div></div><button class="secondary" data-health-action="${esc(action)}">${esc(label)}</button></div>`;}
    function healthTrackList(list){return list.slice(0,10).map(t=>healthItem(t.title,`${t.artist||"Unknown artist"} - ${t.album||"No album"}`,`track:${t.id}`)).join("");}
    function healthCardHtml(count,label){return count>0?`<div class="healthCard"><div class="healthNumber">${count}</div><div class="healthLabel">${esc(label)}</div></div>`:"";}
    function healthSectionHtml(title,body){return body?`<section class="healthSection"><h3>${esc(title)}</h3><div class="healthList">${body}</div></section>`:"";}
    function healthVideoList(list){return list.slice(0,12).map(v=>healthItem(v.title,`${groupLabel(v.folder||v.category||"Videos")} - ${videoMetaSummary(v)}`,`video:${v.id}`,"View")).join("");}
    function collectHealthIssues(){
      const albums=groupByAlbum();
      const missingArt=tracks.filter(t=>!t.has_artwork);
      const missingDate=tracks.filter(t=>!t.date);
      const needsReview=tracks.filter(t=>(t.review_flags||[]).length);
      const nonEnglish=tracks.filter(t=>(t.review_flags||[]).includes("non-English title"));
      const videosNeedingConversion=videos.filter(v=>!v.browser_friendly);
      const albumsMissingArt=albums
        .map(a=>({...a, missingArt:a.tracks.filter(t=>!t.has_artwork).length}))
        .filter(a=>a.missingArt>0);
      return {missingArt, missingDate, needsReview, nonEnglish, videosNeedingConversion, albumsMissingArt};
    }
    function healthCardsHtml(issues){
      return [
        healthCardHtml(issues.missingArt.length,"tracks missing artwork"),
        healthCardHtml(issues.missingDate.length,"tracks missing dates"),
        healthCardHtml(issues.needsReview.length,"tracks needing review"),
        healthCardHtml(issues.albumsMissingArt.length,"albums missing some artwork"),
        healthCardHtml(issues.nonEnglish.length,"non-English title flags"),
        healthCardHtml(issues.videosNeedingConversion.length,"videos may not play on web")
      ].join("");
    }
    function healthSectionsHtml(issues){
      return [
        healthSectionHtml("Missing Artwork",healthTrackList(issues.missingArt)),
        healthSectionHtml("Albums Missing Some Artwork",issues.albumsMissingArt.slice(0,12).map(a=>healthItem(a.name,`${a.missingArt} of ${a.tracks.length} tracks missing embedded artwork`, `album:${a.name}`,"Review")).join("")),
        healthSectionHtml("Missing Dates",healthTrackList(issues.missingDate)),
        healthSectionHtml("Needs Review",healthTrackList(issues.needsReview)),
        healthSectionHtml("Non-English Title Flags",healthTrackList(issues.nonEnglish)),
        healthSectionHtml("Videos That May Not Play on Web",healthVideoList(issues.videosNeedingConversion))
      ].join("");
    }
    function renderHealth(){
      const issues=collectHealthIssues();
      const cards=healthCardsHtml(issues);
      const sections=healthSectionsHtml(issues);
      renderHealthStats();
      healthPanelEl.innerHTML=`<div class="healthHero"><div><h2>Library Health</h2><p>Cleanup overview for actual library problems. Review buttons open Edit Mode on the right album or track.</p></div><button id="healthRefresh" class="secondary">Refresh</button></div>${cards?`<div class="healthGrid">${cards}</div>`:`<div class="healthEmpty">No health issues found.</div>`}${sections?`<div class="healthSections">${sections}</div>`:""}`;
      on(byId("healthRefresh"),"click",refreshHealth);
      healthPanelEl.querySelectorAll("button[data-health-action]").forEach(btn=>on(btn,"click",()=>openHealthAction(btn.dataset.healthAction)));
    }
    async function openMusicReview(albumName, trackId=null){if(!(await unlockEditMode()))return; selectedGroup="All"; selectedAlbum=albumName||"All"; searchEl.value=""; musicFilterEl.value="all"; setAppMode("edit"); setMediaType("music"); if(trackId!==null){selectTrack(trackId); const row=rowsEl.querySelector(`tr[data-id="${trackId}"]`); if(row)row.scrollIntoView({block:"center",behavior:"smooth"});}else{albumGridEl.scrollIntoView({block:"start",behavior:"smooth"});}}
    function openHealthAction(action){
      if(action.startsWith("track:")){
        const id=Number(action.slice(6));
        const track=tracks.find(t=>t.id===id);
        if(track)openMusicReview(albumOf(track),id);
        return;
      }
      if(action.startsWith("album:")){
        openMusicReview(action.slice(6));
        return;
      }
      if(action.startsWith("video:")){
        const id=Number(action.slice(6));
        const video=videos.find(v=>v.id===id);
        if(!video)return;
        selectedVideoGroup=video.folder||video.category||"All";
        selectedVideoAsFolder=Boolean(video.folder);
        setMediaType("video");
        selectVideo(id,{autoplay:false});
      }
    }
    // Interviews are plain text files, grouped by their cleaned source/title.
    function interviewKey(i){return i ? (i.path || i.filename || `${i.source}|${i.year}|${i.title}`) : "";}
    function saveSelectedInterview(i){selectedInterviewId=i?.id ?? null; selectedInterviewKey=interviewKey(i); if(selectedInterviewKey)localStorage.setItem("selectedInterviewKey", selectedInterviewKey);}
    function filteredInterviews(){return [...interviews].filter(i=>containsSearch([i.source,i.year,i.filename,i.content])).sort((a,b)=>(Number(b.year)||0)-(Number(a.year)||0)||a.source.localeCompare(b.source,undefined,{numeric:true,sensitivity:"base"}));}
    function shuffleInterview(){const ordered=filteredInterviews(); if(!ordered.length)return; const currentIndex=ordered.findIndex(i=>i.id===selectedInterviewId); let nextIndex=Math.floor(Math.random()*ordered.length); if(ordered.length>1&&nextIndex===currentIndex)nextIndex=(nextIndex+1)%ordered.length; saveSelectedInterview(ordered[nextIndex]); setOpen(interviewListEl,false); renderInterviews(); interviewReaderEl.scrollTo({top:0,behavior:"smooth"});}
    function renderInterviews(){
      renderInterviewStats();
      const ordered=filteredInterviews();
      if(interviewBrowseSummaryEl) interviewBrowseSummaryEl.textContent = browseSummaryText(ordered.length, "file");
      if(ordered.length){
        const selectedStillVisible=ordered.find(i=>i.id===selectedInterviewId);
        const remembered=selectedInterviewKey?ordered.find(i=>interviewKey(i)===selectedInterviewKey):null;
        if(!selectedStillVisible)saveSelectedInterview(remembered||ordered[0]);
      }
      interviewItemsEl.innerHTML=ordered.length
        ? ordered.map(i=>`<button class="interviewItem ${i.id===selectedInterviewId?"active":""}" data-id="${i.id}" title="${esc(i.filename)}"><span class="interviewItemTitle">${esc(i.source)}</span><span class="interviewItemSub">${esc(i.year||"Unknown year")}</span></button>`).join("")
        : `<div class="interviewItem"><span class="interviewItemTitle">No interviews found</span><span class="interviewItemSub">Try a different search.</span></div>`;
      interviewItemsEl.querySelectorAll(".interviewItem[data-id]").forEach(btn=>btn.addEventListener("click",()=>{
        const picked=interviews.find(i=>i.id===Number(btn.dataset.id));
        clearSearchQuery();
        saveSelectedInterview(picked);
        setOpen(interviewListEl,false);
        renderInterviews();
      }));
      const current=interviews.find(i=>i.id===selectedInterviewId&&ordered.some(match=>match.id===i.id))||ordered[0];
      if(!current){
        interviewReaderEl.innerHTML=`<h2>${esc(appConfig.textTabLabel||"Interviews")}</h2><div class="interviewReaderMeta">No matching text files found.</div>`;
        return;
      }
      interviewReaderEl.innerHTML=`<h2>${esc(current.source)}</h2><div class="interviewReaderMeta">${esc(current.year||"Unknown year")}</div><div class="interviewText">${esc(current.content)}</div>`;
    }
    function videoThumb(v){if(v.has_thumbnail)return `<img src="${v.thumbnail_url}" alt="" loading="lazy" decoding="async">`; return v.browser_friendly?"Preview":esc(String(v.format||"video").toUpperCase());}
    function isVideoFolder(group){return group!=="All"&&(selectedVideoAsFolder||!isVideoCategory(group))&&videos.some(v=>v.folder===group);}
    function bindVideoFolderDetail(list){const play=byId("videoFolderPlay"), shuffleBtn=byId("videoFolderShuffle"), add=byId("videoFolderAdd"), back=byId("videoBackToAlbums"); if(play)on(play,"click",()=>playVideoList(list)); if(shuffleBtn)on(shuffleBtn,"click",()=>playVideoList(list,true)); if(add)on(add,"click",()=>addToVideoQueue(list)); if(back)on(back,"click",closeVideoFolder);}
    function renderVideos(){if(renderVideoSections())return; if((selectedVideoGroup==="All"||isVideoCategory(selectedVideoGroup))&&renderVideoFolderCards(selectedVideoGroup))return; setVideoGridMode("files"); const list=videoFiltered(); const folderOpen=isVideoFolder(selectedVideoGroup); document.body.classList.toggle("videoAlbumSelected",folderOpen); videoGridEl.classList.toggle("videoFolderOpen",folderOpen); videoViewTitleEl.textContent=selectedVideoGroup==="All"?"All Videos":groupLabel(selectedVideoGroup); renderVideoStats(list); const detail=folderOpen?videoFolderDetailHtml(selectedVideoGroup,list):""; const closeButton=folderOpen?videoComponents.closeAlbumButtonHtml():""; const filesHtml=folderOpen?videoAlbumRowsHtml(list):(list.length?list.map(v=>videoComponents.fileCardHtml({video:v,active:v.id===selectedVideoId,meta:videoMetaSummary(v),warning:v.browser_friendly?"":"Browser may not play this format"})).join(""):videoComponents.emptyCardHtml()); videoGridEl.innerHTML=(folderOpen?"":videoResumeCardHtml())+closeButton+detail+filesHtml; bindVideoResumeCard(); if(folderOpen)bindVideoFolderDetail(list); videoGridEl.querySelectorAll("button[data-video-action]").forEach(btn=>btn.addEventListener("click",e=>{e.stopPropagation(); const id=Number(btn.dataset.id), action=btn.dataset.videoAction; if(action==="add"){const v=videos.find(x=>x.id===id); if(v)addToVideoQueue([v]); return;} playVideoList(list,false,id);})); videoGridEl.querySelectorAll(".videoCard[data-id], .videoAlbumVideoRow[data-id]").forEach(card=>{card.addEventListener("click",e=>{if(e.target.closest(".cardActions")||e.target.closest(".rowActions"))return; playVideoList(list,false,Number(card.dataset.id));}); card.addEventListener("keydown",e=>{if(e.key==="Enter")playVideoList(list,false,Number(card.dataset.id));});});}
    function renderVideoAll(){renderVideoGroups(); renderVideos();}
    function playVideoList(list, randomize=false, startId=null){const playable=randomize?shuffle(list):[...list]; if(!playable.length)return; videoQueue=playable.map(v=>v.id); videoQueueIndex=startId===null?0:Math.max(0,videoQueue.indexOf(startId)); saveVideoState({force:true}); playVideoQueueIndex(videoQueueIndex);}
    function addToVideoQueue(list){const ids=list.map(v=>v.id).filter(id=>!videoQueue.includes(id)); if(!ids.length)return; const wasEmpty=videoQueue.length===0; videoQueue.push(...ids); showQueueToast(ids.length===1?"Added video to queue":`Added ${ids.length} videos to queue`); pulseQueueButton(videoQueueToggleEl); if(wasEmpty){videoQueueIndex=0; saveVideoState({force:true}); playVideoQueueIndex(0);} else {saveVideoState({force:true}); updateVideoQueueLabel(); renderVideoQueue();}}
    function playVideoQueueIndex(index){if(index<0||index>=videoQueue.length)return; videoQueueIndex=index; saveVideoState({force:true}); selectVideo(videoQueue[videoQueueIndex]); renderVideoQueue();}
    function selectVideo(id,{autoplay=true,resumeAt=null,persist=true}={}){const v=videos.find(x=>x.id===id); if(!v)return; player.pause(); selectedVideoId=id; videoDomain.prepareSource(videoPlayerEl,v,{autoplay,resumeAt}); videoTitleEl.textContent=v.title; videoMetaEl.textContent=`${videoMetaSummary(v)}${v.browser_friendly?"":" - may need conversion for browser playback"}`; if(persist)saveVideoState({force:true}); updateVideoQueueLabel(); renderVideos();}
    function removeVideoQueueIndex(index){if(index<0||index>=videoQueue.length)return; videoQueue.splice(index,1); if(index<videoQueueIndex)videoQueueIndex--; else if(index===videoQueueIndex){if(videoQueue.length){videoQueueIndex=Math.min(index,videoQueue.length-1); saveVideoState({force:true}); playVideoQueueIndex(videoQueueIndex);}else{videoQueueIndex=-1; stopVideoPlayback(); saveVideoState({force:true}); renderVideos();}} saveVideoState({force:true}); updateVideoQueueLabel(); renderVideoQueue();}
    function moveVideoQueueItem(fromIndex,toIndex){if(fromIndex===toIndex||fromIndex<0||toIndex<0||fromIndex>=videoQueue.length||toIndex>=videoQueue.length)return; const current=videoQueue[videoQueueIndex]; const [item]=videoQueue.splice(fromIndex,1); videoQueue.splice(toIndex,0,item); videoQueueIndex=current===undefined?-1:videoQueue.indexOf(current); saveVideoState({force:true}); updateVideoQueueLabel(); renderVideoQueue();}
    function videoQueueSummaryText(){return queueSummaryText ? queueSummaryText(videoQueue.length, "video") : `${videoQueue.length} video${videoQueue.length===1?"":"s"}`;}
    function updateVideoQueueLabel(){videoQueueToggleEl.innerHTML=`${buttonIcon("queue")}<span>${videoQueue.length}</span>`; if(videoQueueSummaryEl)videoQueueSummaryEl.textContent=videoQueueSummaryText(); updateTopQueueCounts();}
    function videoQueueArtHtml(v){
      return v.has_folder_cover
        ? `<img src="${v.folder_cover_url}" alt="" loading="lazy" decoding="async">`
        : `<div class="noArt">?</div>`;
    }
    function videoQueueSubtitle(v){
      const album = groupLabel(v.folder || v.category || "Video");
      const year = videoYear(v);
      const format = String(v.format || "video").toUpperCase();
      return `${album}${year?` - ${year}`:""} - ${format}`;
    }
    function renderVideoQueue(){
      updateVideoQueueLabel();
      const items = videoQueue.map((id,index)=>({index, video:videos.find(x=>x.id===id)})).filter(item=>item.video).map(({index, video:v})=>({
        index,
        artworkHtml: videoQueueArtHtml(v),
        title: v.title,
        subtitle: videoQueueSubtitle(v),
      }));
      videoQueueListEl.innerHTML = queueListHtml
        ? queueListHtml({items, activeIndex:videoQueueIndex, emptyTitle:"Video queue is empty"})
        : "";
      bindQueueList(videoQueueListEl, playVideoQueueIndex, removeVideoQueueIndex);
      bindQueueDrag(videoQueueListEl, moveVideoQueueItem);
    }
    function isIOSDevice(){return /iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);}
    /** @brief Disable WebAudio visualizer on iOS so lock-screen playback works. */
    function visualizerAllowed(){return !isIOSDevice();}
    // Audio visualizer. iOS disables this so lock-screen playback keeps working.
    /** @brief Ordered visualizer modes cycled by clicking the Now Playing canvas. */
    function visualizerModes(){return ["bars","wave","dots","mirror","ring","mountain","orbit","rain"];}
    function setVisualizerMode(mode){const modes=visualizerModes(); visualizerMode=modes.includes(mode)?mode:"bars"; localStorage.setItem("visualizerMode",visualizerMode); const canvas=byId("nowPlayingVisualizer"); if(canvas)canvas.title=`Visualizer: ${visualizerMode}. Click to switch.`;}
    function cycleVisualizerMode(){const modes=visualizerModes(); const next=modes[(modes.indexOf(visualizerMode)+1)%modes.length]; setVisualizerMode(next); clearVisualizer("nowPlayingVisualizer"); if(!player.paused&&!player.ended)requestAnimationFrame(startVisualizer);}
    function initAudioVisualizer(){if(!visualizerAllowed())return false; if(analyserNode)return true; const Ctx=window.AudioContext||window.webkitAudioContext; if(!Ctx)return false; try{audioContext=new Ctx(); analyserNode=audioContext.createAnalyser(); analyserNode.fftSize=128; analyserNode.smoothingTimeConstant=.78; visualizerData=new Uint8Array(analyserNode.frequencyBinCount); audioSourceNode=audioContext.createMediaElementSource(player); audioSourceNode.connect(analyserNode); analyserNode.connect(audioContext.destination); return true;}catch(err){console.warn("[audio] visualizer unavailable", err); analyserNode=null; return false;}}
    function resumeVisualizerContext(){if(!initAudioVisualizer())return Promise.resolve(false); if(audioContext&&audioContext.state==="suspended")return audioContext.resume().then(()=>true).catch(()=>false); return Promise.resolve(true);}
    function startVisualizer(){resumeVisualizerContext().then(ok=>{if(!ok||visualizerFrame||player.paused||player.ended)return; drawVisualizers();});}
    function stopVisualizer(){if(visualizerFrame){cancelAnimationFrame(visualizerFrame); visualizerFrame=null;} clearVisualizer("nowPlayingVisualizer");}
    function clearVisualizer(id){const canvas=byId(id); if(!canvas)return; const ctx=canvas.getContext("2d"); if(!ctx)return; ctx.clearRect(0,0,canvas.width,canvas.height);}
    function fillRounded(ctx,x,y,width,height,radius){if(ctx.roundRect){ctx.beginPath(); ctx.roundRect(x,y,width,height,radius); ctx.fill();}else{ctx.fillRect(x,y,width,height);}}
    function prepVisualizer(canvas){const ctx=canvas.getContext("2d"); if(!ctx||!analyserNode||!visualizerData)return null; const rect=canvas.getBoundingClientRect(); const dpr=window.devicePixelRatio||1; const width=Math.max(1,Math.round(rect.width*dpr)), height=Math.max(1,Math.round(rect.height*dpr)); if(canvas.width!==width||canvas.height!==height){canvas.width=width; canvas.height=height;} analyserNode.getByteFrequencyData(visualizerData); ctx.clearRect(0,0,width,height); return {ctx,dpr,width,height};}
    function visualizerValue(start,end){let sum=0; for(let j=start;j<end;j++)sum+=visualizerData[j]; return sum/(end-start)/255;}
    function themeCssValue(name, fallback){
      return themeEngine.themeCssValue ? themeEngine.themeCssValue(name, fallback) : fallback;
    }
    function themeColor(name, fallback){return themeCssValue(name, fallback);}
    function themeRgba(name, fallback, alpha){return `rgba(${themeCssValue(name, fallback)},${alpha})`;}
    function usingLightTheme(){return [...document.body.classList].some(name=>name.includes("theme-light"));}
    function drawBars(canvas, count){const state=prepVisualizer(canvas); if(!state)return; const {ctx,dpr,width,height}=state; const gap=Math.max(2*dpr, width/(count*5)); const barWidth=(width-gap*(count-1))/count; for(let i=0;i<count;i++){const start=Math.floor((i/count)*visualizerData.length*.72); const end=Math.max(start+1,Math.floor(((i+1)/count)*visualizerData.length*.72)); const value=visualizerValue(start,end); const barHeight=Math.max(3*dpr, value*height*.92); const x=i*(barWidth+gap); const y=height-barHeight; const gradient=ctx.createLinearGradient(0,y,0,height); gradient.addColorStop(0,themeColor("--accent-link","#8db7ff")); gradient.addColorStop(1,themeColor("--accent","#3f6fd8")); ctx.fillStyle=gradient; fillRounded(ctx,x,y,barWidth,barHeight,Math.min(barWidth/2,4*dpr));}}
    function drawWave(canvas, count){const state=prepVisualizer(canvas); if(!state)return; const {ctx,dpr,width,height}=state; const mid=height*.55; ctx.lineWidth=3*dpr; ctx.lineCap="round"; const gradient=ctx.createLinearGradient(0,0,width,0); gradient.addColorStop(0,themeColor("--accent","#3f6fd8")); gradient.addColorStop(.5,themeColor("--accent-link","#9cc4ff")); gradient.addColorStop(1,themeColor("--accent","#3f6fd8")); ctx.strokeStyle=gradient; ctx.beginPath(); for(let i=0;i<count;i++){const start=Math.floor((i/count)*visualizerData.length*.72); const end=Math.max(start+1,Math.floor(((i+1)/count)*visualizerData.length*.72)); const value=visualizerValue(start,end); const x=(i/(count-1))*width; const y=mid-Math.sin(i*.55+performance.now()/260)*value*height*.32-value*height*.22; if(i===0)ctx.moveTo(x,y); else ctx.lineTo(x,y);} ctx.stroke();}
    function drawDots(canvas, count){const state=prepVisualizer(canvas); if(!state)return; const {ctx,dpr,width,height}=state; const cols=count, rows=4, gap=width/(cols+1); for(let i=0;i<cols;i++){const start=Math.floor((i/cols)*visualizerData.length*.72); const end=Math.max(start+1,Math.floor(((i+1)/cols)*visualizerData.length*.72)); const value=visualizerValue(start,end); const lit=Math.max(1,Math.round(value*rows)); for(let row=0;row<rows;row++){const alpha=row<lit?.35+value*.65:.08; ctx.fillStyle=themeRgba("--accent-sheen-rgb","141,183,255",alpha); ctx.beginPath(); ctx.arc((i+1)*gap,height-(row+1)*(height/(rows+1)),Math.max(2.5*dpr,4*dpr*value),0,Math.PI*2); ctx.fill();}}}
    function drawMirror(canvas, count){const state=prepVisualizer(canvas); if(!state)return; const {ctx,dpr,width,height}=state; const mid=height*.5, gap=Math.max(2*dpr,width/(count*5)), barWidth=(width-gap*(count-1))/count; for(let i=0;i<count;i++){const start=Math.floor((i/count)*visualizerData.length*.72); const end=Math.max(start+1,Math.floor(((i+1)/count)*visualizerData.length*.72)); const value=visualizerValue(start,end); const barHeight=Math.max(2*dpr,value*height*.45); const x=i*(barWidth+gap); const gradient=ctx.createLinearGradient(0,mid-barHeight,0,mid+barHeight); gradient.addColorStop(0,themeRgba("--accent-sheen-rgb","156,196,255",.95)); gradient.addColorStop(.5,themeRgba("--accent-rgb","63,111,216",.45)); gradient.addColorStop(1,themeRgba("--accent-sheen-rgb","156,196,255",.95)); ctx.fillStyle=gradient; fillRounded(ctx,x,mid-barHeight,barWidth,barHeight*2,Math.min(barWidth/2,4*dpr));}}
    function drawRing(canvas, count){const state=prepVisualizer(canvas); if(!state)return; const {ctx,dpr,width,height}=state; const cx=width/2, cy=height/2, base=Math.min(width,height)*.18; let total=0; for(let i=0;i<visualizerData.length*.72;i++)total+=visualizerData[i]; const avg=total/(visualizerData.length*.72)/255; ctx.lineCap="round"; for(let i=0;i<count;i++){const start=Math.floor((i/count)*visualizerData.length*.72); const end=Math.max(start+1,Math.floor(((i+1)/count)*visualizerData.length*.72)); const value=visualizerValue(start,end); const angle=(i/count)*Math.PI*2+performance.now()/2400; const inner=base+avg*height*.12; const outer=inner+value*height*.26; ctx.strokeStyle=themeRgba("--accent-sheen-rgb","141,183,255",.22+value*.72); ctx.lineWidth=Math.max(2*dpr,3*dpr*value); ctx.beginPath(); ctx.moveTo(cx+Math.cos(angle)*inner,cy+Math.sin(angle)*inner); ctx.lineTo(cx+Math.cos(angle)*outer,cy+Math.sin(angle)*outer); ctx.stroke();} ctx.strokeStyle=themeRgba("--accent-rgb","63,111,216",.28); ctx.lineWidth=1*dpr; ctx.beginPath(); ctx.arc(cx,cy,base+avg*height*.12,0,Math.PI*2); ctx.stroke();}
    function drawMountain(canvas, count){const state=prepVisualizer(canvas); if(!state)return; const {ctx,width,height}=state; const ground=height*.9; const gradient=ctx.createLinearGradient(0,height*.12,0,ground); gradient.addColorStop(0,themeRgba("--accent-sheen-rgb","156,196,255",.55)); gradient.addColorStop(.55,themeRgba("--accent-rgb","63,111,216",.26)); gradient.addColorStop(1,themeRgba("--accent-rgb","63,111,216",.02)); ctx.fillStyle=gradient; ctx.beginPath(); ctx.moveTo(0,ground); for(let i=0;i<count;i++){const start=Math.floor((i/count)*visualizerData.length*.72); const end=Math.max(start+1,Math.floor(((i+1)/count)*visualizerData.length*.72)); const value=visualizerValue(start,end); const x=(i/(count-1))*width; const y=ground-value*height*.78-Math.sin(i*.5+performance.now()/500)*height*.035; ctx.lineTo(x,y);} ctx.lineTo(width,ground); ctx.closePath(); ctx.fill();}
    function drawOrbit(canvas, count){const state=prepVisualizer(canvas); if(!state)return; const {ctx,dpr,width,height}=state; const cx=width/2, cy=height/2; let bass=0; for(let i=0;i<10&&i<visualizerData.length;i++)bass+=visualizerData[i]; bass=bass/Math.min(10,visualizerData.length)/255; const base=Math.min(width,height)*(.18+bass*.18), time=performance.now()/900; for(let i=0;i<count;i++){const start=Math.floor((i/count)*visualizerData.length*.72); const end=Math.max(start+1,Math.floor(((i+1)/count)*visualizerData.length*.72)); const value=visualizerValue(start,end); const angle=(i/count)*Math.PI*2+time*(i%2?1:-.7); const radius=base+value*height*.23; ctx.fillStyle=themeRgba("--accent-sheen-rgb","141,183,255",.18+value*.65); ctx.beginPath(); ctx.arc(cx+Math.cos(angle)*radius,cy+Math.sin(angle)*radius,Math.max(2*dpr,5*dpr*value),0,Math.PI*2); ctx.fill();}}
    function drawRain(canvas, count){const state=prepVisualizer(canvas); if(!state)return; const {ctx,dpr,width,height}=state; const light=usingLightTheme(); const time=performance.now()/38; for(let i=0;i<count;i++){const start=Math.floor((i/count)*visualizerData.length*.72); const end=Math.max(start+1,Math.floor(((i+1)/count)*visualizerData.length*.72)); const value=visualizerValue(start,end); const x=(i+.5)*(width/count); const drops=Math.max(1,Math.round(value*4)); for(let d=0;d<drops;d++){const y=(time*(.45+value)+i*17+d*29)%height; ctx.fillStyle=light?themeRgba("--accent-rgb","63,111,216",.28+value*.62):themeRgba("--accent-sheen-rgb","141,183,255",.12+value*.55); fillRounded(ctx,x-(light?1.75:1.5)*dpr,y,(light?3.5:3)*dpr,Math.max(6*dpr,18*dpr*value),2*dpr);}}}
    /** @brief Draw the active Now Playing visualizer frame. */
    function drawVisualizers(){visualizerFrame=null; if(player.paused||player.ended){stopVisualizer(); return;} const big=byId("nowPlayingVisualizer"); if(big){if(visualizerMode==="wave")drawWave(big,44); else if(visualizerMode==="dots")drawDots(big,32); else if(visualizerMode==="mirror")drawMirror(big,32); else if(visualizerMode==="ring")drawRing(big,48); else if(visualizerMode==="mountain")drawMountain(big,48); else if(visualizerMode==="orbit")drawOrbit(big,28); else if(visualizerMode==="rain")drawRain(big,40); else drawBars(big,32);} visualizerFrame=requestAnimationFrame(drawVisualizers);}
    // Edit mode writes directly to MP3/FLAC files, so keep these handlers boring.
    function field(name,label,t){return `<label>${label}<input name="${name}" value="${esc(t[name]||"")}"></label>`;}
    function artworkPanel(t){const supported=["mp3","flac"].includes(String(t.format||"").toLowerCase()); return `<div class="artworkPanel"><strong>Artwork</strong><input id="artworkFile" type="file" accept="image/jpeg,image/png,image/webp" ${supported?"":"disabled"}><img id="artworkPreview" class="artworkPreview" alt=""><div class="actions artworkActions"><button type="button" id="saveSongArt" ${supported?"":"disabled"}>Replace Song Art</button><button type="button" class="secondary" id="saveAlbumArt" ${supported?"":"disabled"}>Replace Album Art</button></div><div class="message" id="artworkMsg">${supported?"MP3/FLAC only. Changes write directly to the file. Album art uses the selected song's album tag.":"Artwork editing is only enabled for MP3 and FLAC."}</div></div>`;}
    function selectTrack(id){selectedId=id; const t=tracks.find(x=>x.id===id); if(!t)return; if(playingId===null)applyAdaptiveTheme(); detailEl.innerHTML=`${t.has_artwork?`<img class="bigCover" src="${t.artwork_url}" alt="">`:`<div class="bigCover emptyCover">No Artwork</div>`}<div class="detailTitle">${esc(t.title)}</div><div class="detailSub">${esc(t.artist||"Unknown artist")} - ${esc(t.album||"No album")} ${t.date?`(${esc(t.date)})`:""}</div>${artworkPanel(t)}<form id="editForm">${field("title","Title",t)}${field("artist","Artist",t)}${field("album","Album",t)}${field("albumartist","Album Artist",t)}${field("date","Date",t)}${field("tracknumber","Track Number",t)}${field("genre","Genre",t)}<label>Path<input value="${esc(t.path)}" disabled></label><div class="actions"><button type="submit">Save Metadata</button><button type="button" class="secondary" id="resetBtn">Reset</button></div><div class="message" id="msg"></div></form>`; const form=byId("editForm"); if(form){on(form,"submit", saveSelected); on(byId("resetBtn"),"click",()=>selectTrack(id));} const artInput=byId("artworkFile"), artPreview=byId("artworkPreview"); if(artInput){const songArt=byId("saveSongArt"), albumArt=byId("saveAlbumArt"), selectedArt=byId("saveSelectedArt"); on(artInput,"change",()=>{const file=artInput.files&&artInput.files[0]; if(!file)return; const url=URL.createObjectURL(file); artPreview.src=url; artPreview.style.display="block";}); if(songArt)on(songArt,"click",()=>saveArtwork("song")); if(albumArt)on(albumArt,"click",()=>saveArtwork("album")); if(selectedArt)on(selectedArt,"click",()=>saveArtwork("selected"));} renderRows();}
    function readArtworkFile(){return new Promise((resolve,reject)=>{const input=byId("artworkFile"); const file=input&&input.files&&input.files[0]; if(!file){reject(new Error("Choose an artwork image first")); return;} if(!["image/jpeg","image/png","image/webp"].includes(file.type)){reject(new Error("Artwork must be JPG, PNG, or WEBP")); return;} const reader=new FileReader(); reader.onload=()=>resolve(reader.result); reader.onerror=()=>reject(new Error("Could not read artwork image")); reader.readAsDataURL(file);});}
    async function saveArtwork(scope){const msg=byId("artworkMsg"); try{if(scope==="selected"&&selectedIds.size===0){msg.className="message error"; msg.textContent="Select tracks first."; return;} msg.className="message"; msg.textContent=scope==="album"?"Saving album artwork...":scope==="selected"?"Saving selected artwork...":"Saving song artwork..."; const imageData=await readArtworkFile(); const result=await fetchJson(`/api/track/${selectedId}/artwork`,{method:"POST",headers:editHeaders({"Content-Type":"application/json"}),body:JSON.stringify({scope,image_data:imageData,ids:[...selectedIds]})}); if(!result.ok){msg.className="message error"; msg.textContent=result.error||"Artwork save failed"; return;} msg.className="message ok"; msg.textContent=`Saved artwork to ${result.changed} file${result.changed===1?"":"s"}.`; if(scope==="album"||scope==="selected")selectedIds.clear(); await loadTracks(true, selectedId);}catch(err){msg.className="message error"; msg.textContent=err.message||String(err);}}
    async function saveSelected(event){event.preventDefault(); const msg=byId("msg"), form=event.currentTarget, data=editDomain.metadataPayload(form); msg.className="message"; msg.textContent="Saving..."; const result=await fetchJson(`/api/track/${selectedId}/metadata`,{method:"POST",headers:editHeaders({"Content-Type":"application/json"}),body:JSON.stringify(data)}); if(!result.ok){msg.className="message error"; msg.textContent=result.error||"Save failed"; return;} msg.className="message ok"; msg.textContent=result.changed.length?`Saved: ${result.changed.join(", ")}.`:"No changes."; await loadTracks(false, selectedId);}
    async function bulkSave(){const values=editDomain.bulkMetadataPayload({artist:bulkArtist,album:bulkAlbum,albumartist:bulkAlbumArtist,date:bulkDate,genre:bulkGenre}); const result=await fetchJson("/api/bulk/metadata",{method:"POST",headers:editHeaders({"Content-Type":"application/json"}),body:JSON.stringify({ids:[...selectedIds],values})}); if(!result.ok){alert(result.error||"Bulk save failed"); return;} const changed=result.results.filter(r=>r.ok).length; selectedIds.clear(); alert(`Bulk save complete for ${changed} files. Selection cleared.`); await loadTracks(false, selectedId);}
    // Music queue and playback. The queue is just an ordered list of track IDs.
    function shuffle(list){const copy=[...list]; for(let i=copy.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1)); [copy[i],copy[j]]=[copy[j],copy[i]];} return copy;}
    function uniqueTracks(list){const seen=new Set(); return list.filter(track=>track&&!seen.has(track.id)&&seen.add(track.id));}
    /** @brief Replace the music queue and start playback at the requested track. */
    function playList(list, randomize=false, startId=null, options={}){const unique=uniqueTracks(list); const playable=randomize?shuffle(unique):unique; if(!playable.length)return; activePlaylistId=options.playlistId||null; queue=playable.map(t=>t.id); const savedIndex=Number(options.startIndex); queueIndex=Number.isInteger(savedIndex)?Math.min(Math.max(savedIndex,0),queue.length-1):startId===null?0:Math.max(0,queue.indexOf(startId)); saveMusicState({force:true}); playQueueIndex(queueIndex, options);}
    function playPlaylist(playlist, randomize=false, startId=null){
      const list=playlistTracks(playlist);
      if(!list.length)return;
      if(!randomize&&startId===null&&activePlaylistId===playlist.id&&queueMatchesPlaylist(playlist)&&playingId===queue[queueIndex]){playCurrentAudio(); return;}
      const startIndex=startId===null?playlistResumeIndex(playlist):Math.max(0,playlist.track_ids.indexOf(startId));
      playList(list,randomize,startId,{playlistId:randomize?null:playlist.id,startIndex:randomize?0:startIndex});
    }
    // When a track is opened from an album page, Next should continue through
    // the album and then later albums in the current browse order.
    function albumPlaybackContext(startId){const current=tracks.find(t=>t.id===startId); if(!current||selectedAlbum==="All")return [current].filter(Boolean); const ordered=albumDisplayEntries(albumSource()); const albumIndex=ordered.findIndex(([name])=>name===selectedAlbum); if(albumIndex<0)return albumTrackList(albumList(selectedAlbum)); const list=[]; for(const [_name,tracksForAlbum] of ordered.slice(albumIndex)){list.push(...albumTrackList(tracksForAlbum));} return list.length?list:[current];}
    function playSingleTrack(id, options={}){const t=tracks.find(x=>x.id===id); if(!t)return; if(appMode==="listen"&&selectedPlaylistId){const playlist=playlistById(); if(playlist)playPlaylist(playlist,false,id); return;} if(appMode==="listen"&&selectedAlbum!=="All"){playList(albumPlaybackContext(id), false, id, options); return;} playList([t], false, id, options);}
    // If the queue was empty, adding songs starts playback immediately. If
    // something is already playing, additions are non-disruptive.
    function addToMusicQueue(list){
      const ids=list.map(t=>t.id).filter(id=>!queue.includes(id));
      if(!ids.length)return;
      const wasEmpty=queue.length===0;
      queue.push(...ids);
      showQueueToast(ids.length===1?"Added to queue":`Added ${ids.length} to queue`);
      pulseQueueButton(topQueueLabelEl);
      if(wasEmpty){
        queueIndex=0;
        saveMusicState({force:true});
        playQueueIndex(0);
      } else {
        saveMusicState({force:true});
        updateNow();
        renderQueue();
      }
    }
    function playQueueIndex(index, options={}){
      if(index<0||index>=queue.length)return;
      flushListeningStats({force:true});
      queueIndex=index;
      const t=tracks.find(x=>x.id===queue[queueIndex]);
      if(!t)return;
      console.debug("[audio] play button tapped", {id:t.id,title:t.title,format:t.format,size_mb:t.size_mb});
      switchingAudioTrack=!player.paused;
      playingId=t.id;
      selectedId=t.id;
      resetPlaybackTimeline(t);
      musicDomain.prepareSource(player,t);
      resetStatsSession(t.id);
      console.debug("[audio] audio url requested", t.audio_url);
      saveMusicState({force:true});
      playCurrentAudio().finally(()=>{
        switchingAudioTrack=false;
        updateNow();
      });
      if(options.selectInMusic!==false)selectTrack(t.id);
      requestAnimationFrame(startVisualizer);
      renderQueue();
    }
    function removeQueueIndex(index){
      if(index<0||index>=queue.length)return;
      queue.splice(index,1);
      if(index<queueIndex){
        queueIndex--;
      } else if(index===queueIndex){
        if(queue.length){
          queueIndex=Math.min(index,queue.length-1);
          saveMusicState({force:true});
          playQueueIndex(queueIndex);
        } else {
          queueIndex=-1;
          player.pause();
          player.removeAttribute("src");
          playingId=null;
          saveMusicState({force:true});
          updateNow();
          renderRows();
        }
      }
      saveMusicState({force:true});
      updateNow();
      renderQueue();
    }
    function moveQueueItem(fromIndex,toIndex){
      if(fromIndex===toIndex||fromIndex<0||toIndex<0||fromIndex>=queue.length||toIndex>=queue.length)return;
      const current=queue[queueIndex];
      const [item]=queue.splice(fromIndex,1);
      queue.splice(toIndex,0,item);
      queueIndex=current===undefined?-1:queue.indexOf(current);
      saveMusicState({force:true});
      updateNow();
      renderQueue();
    }
    function queueDurationText(){const durations=queue.map(id=>knownDurations.get(id)); if(!queue.length||durations.some(v=>!Number.isFinite(v)))return ""; return fmt(durations.reduce((sum,v)=>sum+v,0));}
    // Dragging reorders the queue array, but keeps queueIndex attached to the
    // same currently playing track instead of the same numeric slot.
    function bindQueueDrag(listEl, moveItem){
      listEl.querySelectorAll(".queueItem[data-index]").forEach(item=>{
        item.addEventListener("dragstart",e=>{
          item.classList.add("dragging");
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", item.dataset.index);
        });
        item.addEventListener("dragend",()=>item.classList.remove("dragging"));
        item.addEventListener("dragover",e=>{
          e.preventDefault();
          item.classList.add("dropTarget");
          e.dataTransfer.dropEffect = "move";
        });
        item.addEventListener("dragleave",()=>item.classList.remove("dropTarget"));
        item.addEventListener("drop",e=>{
          e.preventDefault();
          item.classList.remove("dropTarget");
          moveItem(Number(e.dataTransfer.getData("text/plain")), Number(item.dataset.index));
        });
      });
    }
    /** @brief Render the draggable music queue drawer. */
    function renderQueue(){
      const durationText = queueDurationText();
      queueSummaryEl.textContent = queueSummaryText ? queueSummaryText(queue.length, "track", durationText) : `${queue.length} track${queue.length===1?"":"s"}${durationText?` - ${durationText}`:""}`;
      const items = queue.map((id,index)=>({index, track:tracks.find(x=>x.id===id)})).filter(item=>item.track).map(({index, track:t})=>({
        index,
        artworkHtml: t.has_artwork ? `<img src="${smallArtUrl(t)}" alt="">` : `<div class="noArt">?</div>`,
        title: t.title,
        subtitle: `${t.artist||"Unknown artist"} - ${t.album||"No album"}`,
      }));
      queueListEl.innerHTML = queueListHtml
        ? queueListHtml({items, activeIndex:queueIndex, emptyTitle:"Queue is empty"})
        : "";
      bindQueueList(queueListEl, playQueueIndex, removeQueueIndex);
      bindQueueDrag(queueListEl, moveQueueItem);
      updatePlaylistSaveAction();
    }
    const playlistRequest=playlistDomain.request;
    async function loadPlaylists(render=true){
      const data=await fetchJson("/api/playlists");
      playlists=data.playlists||[];
      if(selectedPlaylistId&&!playlistById()){
        selectedPlaylistId=null;
        if(!playlists.length)selectedGroup="All";
      }
      if(render&&mediaType==="music")renderAll();
    }
    function updatePlaylistSaveAction(){
      const button=byId("saveQueuePlaylist");
      if(!button)return;
      const playlist=playlistById(activePlaylistId);
      const label=playlist?`Update ${playlist.name} from queue`:"Save queue as playlist";
      button.title=label;
      button.setAttribute("aria-label",label);
      button.dataset.playlistId=playlist?.id||"";
    }
    async function updatePlaylistFromQueue(playlist){
      if(!appConfig.playlistEditable)return;
      const trackIds=playlistDomain.uniqueAvailableTrackIds(queue,tracks);
      if(!trackIds.length){showQueueToast("Queue is empty"); return;}
      try{
        await playlistRequest(`/api/playlists/${encodeURIComponent(playlist.id)}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({track_ids:trackIds})});
        await loadPlaylists(false);
        syncActivePlaylistContext();
        showQueueToast("Playlist updated");
        renderAll();
        renderQueue();
      }catch(error){showQueueToast(error.message);}
    }
    function saveOrUpdateQueuePlaylist(){
      const playlist=playlistById(activePlaylistId);
      if(playlist){updatePlaylistFromQueue(playlist); return;}
      openPlaylistDialog("create");
    }
    function openPlaylistDialog(mode, playlist=null){
      if(!appConfig.playlistEditable)return;
      if(mode==="create"&&!queue.length){showQueueToast("Queue is empty"); return;}
      playlistDialogMode=mode;
      playlistDialogEl.dataset.playlistId=playlist?.id||"";
      byId("playlistDialogTitle").textContent=mode==="rename"?"Rename Playlist":"Save Playlist";
      byId("confirmPlaylist").textContent=mode==="rename"?"Rename":"Save";
      playlistNameEl.value=playlist?.name||"";
      playlistMessageEl.textContent="";
      playlistMessageEl.className="message";
      playlistDialogEl.showModal();
      requestAnimationFrame(()=>playlistNameEl.focus());
    }
    async function submitPlaylistDialog(event){
      event.preventDefault();
      const name=playlistNameEl.value.trim();
      playlistMessageEl.textContent=playlistDialogMode==="rename"?"Renaming...":"Saving...";
      try{
        if(playlistDialogMode==="rename"){
          const id=playlistDialogEl.dataset.playlistId;
          await playlistRequest(`/api/playlists/${encodeURIComponent(id)}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({name})});
        }else{
          const trackIds=playlistDomain.uniqueAvailableTrackIds(queue,tracks);
          const result=await playlistRequest("/api/playlists",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,track_ids:trackIds})});
          activePlaylistId=result.id;
        }
        await loadPlaylists(false);
        syncActivePlaylistContext();
        playlistDialogEl.close();
        showQueueToast(playlistDialogMode==="rename"?"Playlist renamed":"Playlist saved");
        renderAll();
      }catch(error){
        playlistMessageEl.className="message error";
        playlistMessageEl.textContent=error.message;
      }
    }
    async function deletePlaylist(playlist){
      if(!appConfig.playlistEditable||!confirm(`Delete playlist "${playlist.name}"?`))return;
      try{
        await playlistRequest(`/api/playlists/${encodeURIComponent(playlist.id)}`,{method:"DELETE"});
        if(activePlaylistId===playlist.id)activePlaylistId=null;
        selectedPlaylistId=null;
        await loadPlaylists(false);
        showQueueToast("Playlist deleted");
        renderAll();
      }catch(error){showQueueToast(error.message);}
    }
    function updateMusicQueueLabels(){
      topQueueLabelEl.innerHTML=`${buttonIcon("queue")}<span>${queue.length}</span>`;
      [byId("npQueue"), byId("albumQueue")].forEach(btn=>{
        const count=btn?.querySelector("span");
        if(count)count.textContent=String(queue.length);
      });
      updateTopQueueCounts();
    }
    function savedVolume(){const value=Number(localStorage.getItem("playerVolume")); return Number.isFinite(value)?Math.min(1,Math.max(0,value)):Number(volumeBar.value);}
    function setPlayerVolume(value,{persist=true}={}){
      const volume=Math.min(1,Math.max(0,Number(value)));
      player.volume=volume;
      volumeBar.value=String(volume);
      const npVolume=byId("npVolumeBar");
      if(npVolume)npVolume.value=String(volume);
      if(persist)localStorage.setItem("playerVolume",String(volume));
    }
    /** @brief Remaining-time label for the full Now Playing screen. */
    function nowPlayingRemainingText(){
      return Number.isFinite(player.duration)
        ? `-${fmt(Math.max(0, player.duration - player.currentTime))}`
        : durationEl.textContent;
    }
    /** Keep both seek controls stable while the shared audio element changes files. */
    function resetPlaybackTimeline(t){
      seeking=false;
      const knownDuration=Number(knownDurations.get(t?.id)||t?.duration||0);
      currentTimeEl.textContent="0:00";
      durationEl.textContent=knownDuration>0?fmt(knownDuration):"0:00";
      seekBar.value="0";
      const npCurrent=byId("npCurrentTime"), npDuration=byId("npDuration"), npSeek=byId("npSeekBar");
      if(npCurrent)npCurrent.textContent="0:00";
      if(npDuration)npDuration.textContent=knownDuration>0?`-${fmt(knownDuration)}`:"0:00";
      if(npSeek)npSeek.value="0";
    }
    function nowPlayingArtSrc(t){return t?.has_artwork?stableAlbumArtUrl(t):"";}
    function renderLrcLyrics(box, trackId, text){
      const lines = lyricsHelpers.parseLrc ? lyricsHelpers.parseLrc(text) : [];
      if(!lines.length){
        box.textContent = text || "No lyrics found";
        currentLrcLyrics = null;
        return;
      }
      currentLrcLyrics = {trackId, lines, activeIndex:-1};
      box.classList.add("syncedLyrics");
      box.innerHTML = lyricsHelpers.syncedLyricsHtml ? lyricsHelpers.syncedLyricsHtml(lines) : "";
      box.querySelectorAll(".lrcLine").forEach(lineEl => {
        lineEl.addEventListener("click", () => {
          const seekTime = Number(lineEl.dataset.lrcTime);
          if(Number.isFinite(seekTime)){
            player.currentTime = seekTime;
            updateLrcHighlight(true);
          }
        });
      });
      updateLrcHighlight();
    }
    function updateLrcHighlight(forceScroll=false){
      if(!currentLrcLyrics || currentLrcLyrics.trackId !== playingId)return;
      const lines = currentLrcLyrics.lines;
      const activeIndex = lyricsHelpers.activeLrcIndex ? lyricsHelpers.activeLrcIndex(lines, player.currentTime) : -1;
      if(activeIndex === currentLrcLyrics.activeIndex && !forceScroll)return;
      currentLrcLyrics.activeIndex = activeIndex;
      document.querySelectorAll(".lrcLine.active").forEach(el=>el.classList.remove("active"));
      const activeLine = document.querySelector(`.lrcLine[data-lrc-index="${activeIndex}"]`);
      if(activeLine){
        activeLine.classList.add("active");
        scrollLyricIntoFocus(activeLine, forceScroll);
      }
    }
    function scrollLyricIntoFocus(activeLine, forceScroll=false){
      if(lyricsHelpers.scrollLyricIntoFocus) lyricsHelpers.scrollLyricIntoFocus(activeLine, forceScroll);
      else activeLine.scrollIntoView({block:"center", behavior:"auto"});
    }
    async function loadNowPlayingLyrics(t){
      const box = byId("lyricsContent");
      if(!box || !t || !t.has_lyrics || !t.lyrics_url)return;
      if(box.dataset.trackId === String(t.id) && box.dataset.loaded === "true")return;
      box.dataset.trackId = String(t.id);
      box.classList.remove("syncedLyrics");
      currentLrcLyrics = null;
      try{
        const data = await fetchJson(t.lyrics_url);
        if(playingId === t.id){
          const lyricsText = data.lyrics || "";
          const looksSynced = lyricsHelpers.looksLikeLrc ? lyricsHelpers.looksLikeLrc(lyricsText) : false;
          const lyricsFormat = data.format || t.lyrics_format || (looksSynced ? "lrc" : "text");
          if(lyricsFormat === "lrc")renderLrcLyrics(box, t.id, data.lyrics || "");
          else box.textContent = data.lyrics || "No lyrics found";
          box.dataset.loaded = "true";
        }
      }catch{
        if(playingId === t.id) box.textContent = "Could not load local lyrics.";
      }
    }
    function updateNowPlayingControlsOnly(){
      const npPlay=byId("npPlayPause");
      if(npPlay){
        npPlay.innerHTML = player.paused ? "&#9654;" : "&#10074;&#10074;";
        npPlay.title = player.paused ? "Play" : "Pause";
        npPlay.setAttribute("aria-label", npPlay.title);
      }
      const npQueueCount=byId("npQueue")?.querySelector("span");
      if(npQueueCount)npQueueCount.textContent=String(queue.length);
    }
    function updateTopQueueCounts(){
      statsEl.querySelectorAll("[data-top-action='musicQueue'] span").forEach(el=>el.textContent=String(queue.length));
      statsEl.querySelectorAll("[data-top-action='videoQueue'] span").forEach(el=>el.textContent=String(videoQueue.length));
    }
    // Full-screen Now Playing is rebuilt from current state so it stays in sync
    // with seek time, volume, visualizer mode, and file format.
    /**
     * @brief Render the full-screen Now Playing panel.
     * @param {object|null} t Current track record, or null when nothing is playing.
     */
    function renderNowPlaying(t){
      if(!nowPlayingBodyEl)return;
      if(!t){
        nowPlayingRenderedTrackId = null;
        nowPlayingRenderedArtSrc = "";
        nowPlayingBodyEl.classList.remove("hasLyrics");
        nowPlayingDrawerEl.classList.remove("hasLyrics");
        nowPlayingBodyEl.innerHTML = nowPlayingComponents.emptyHtml ? nowPlayingComponents.emptyHtml() : "";
        return;
      }
      nowPlayingBodyEl.classList.toggle("hasLyrics", !!t.has_lyrics);
      nowPlayingDrawerEl.classList.toggle("hasLyrics", !!t.has_lyrics);
      if(nowPlayingRenderedTrackId === t.id && nowPlayingBodyEl.children.length){
        updateNowPlayingControlsOnly();
        return;
      }
      const artSrc=nowPlayingArtSrc(t);
      if(nowPlayingBodyEl.children.length&&nowPlayingRenderedArtSrc===artSrc){
        nowPlayingRenderedTrackId = t.id;
        const text=nowPlayingBodyEl.querySelector(".nowPlayingText");
        if(text && nowPlayingComponents.metaHtml)text.outerHTML=nowPlayingComponents.metaHtml(t);
        const existingLyrics=nowPlayingBodyEl.querySelector(".lyricsBox");
        const lyricsHtml=nowPlayingComponents.lyricsHtml ? nowPlayingComponents.lyricsHtml(t) : "";
        if(existingLyrics&&lyricsHtml)existingLyrics.outerHTML=lyricsHtml;
        else if(existingLyrics&&!lyricsHtml)existingLyrics.remove();
        else if(!existingLyrics&&lyricsHtml)nowPlayingBodyEl.insertAdjacentHTML("beforeend",lyricsHtml);
        updateNowPlayingControlsOnly();
        loadNowPlayingLyrics(t);
        return;
      }
      nowPlayingRenderedTrackId = t.id;
      nowPlayingRenderedArtSrc = artSrc;
      nowPlayingBodyEl.innerHTML = nowPlayingComponents.fullHtml ? nowPlayingComponents.fullHtml({
        track:t,
        artSrc,
        visualizerEnabled:visualizerAllowed(),
        visualizerMode,
        seekValue:seekBar.value,
        currentTime:currentTimeEl.textContent,
        remainingTime:nowPlayingRemainingText(),
        paused:player.paused,
        queueCount:queue.length,
        volume:player.volume,
      }) : "";
      bindNowPlayingControls();
      loadNowPlayingLyrics(t);
    }
    /** @brief Bind controls inside the freshly rendered Now Playing panel. */
    function bindNowPlayingControls(){
      const npSeek=byId("npSeekBar"), npVolume=byId("npVolumeBar"), canvas=byId("nowPlayingVisualizer");
      if(canvas)on(canvas,"click",cycleVisualizerMode);
      if(npVolume)on(npVolume,"input",()=>setPlayerVolume(npVolume.value));
      on(byId("npPrev"),"click",()=>playQueueIndex(queueIndex-1));
      on(byId("npNext"),"click",()=>playQueueIndex(queueIndex+1));
      on(byId("npPlayPause"),"click",toggleAudioPlayback);
      on(byId("npQueue"),"click",toggleMusicQueue);
      on(npSeek,"input",()=>{seeking=true;});
      on(npSeek,"change",()=>{if(player.duration) player.currentTime=(Number(npSeek.value)/1000)*player.duration; seeking=false;});
    }
    // Media Session controls the iPhone lock screen / Dynamic Island buttons.
    // Explicitly clearing seek handlers nudges iOS toward track prev/next.
    function setupMediaSessionActions(){if(!("mediaSession" in navigator))return; const set=(action,handler)=>{try{navigator.mediaSession.setActionHandler(action,handler);}catch{}}; set("play",()=>playCurrentAudio()); set("pause",()=>player.pause()); set("previoustrack",()=>queue.length?playQueueIndex(Math.max(0,queueIndex-1)):null); set("nexttrack",()=>queue.length?playQueueIndex(Math.min(queue.length-1,queueIndex+1)):null); set("seekbackward",null); set("seekforward",null); set("seekto",null);}
    function updateMediaSession(t){if(!("mediaSession" in navigator)||!t)return; setupMediaSessionActions(); const artwork=t.has_artwork?[{src:artUrl(t),sizes:"512x512",type:"image/jpeg"}]:[]; try{navigator.mediaSession.metadata=new MediaMetadata({title:t.title||"Unknown title",artist:t.artist||"Unknown artist",album:t.album||"",artwork}); navigator.mediaSession.playbackState=player.paused?"paused":"playing";}catch{}}
    function updateNow(){
      const t=tracks.find(x=>x.id===playingId);
      playPauseBtn.textContent=player.paused?"\u25b6":"\u275a\u275a";
      playPauseBtn.title=player.paused?"Play":"Pause";
      playPauseBtn.setAttribute("aria-label",player.paused?"Play":"Pause");
      updateMusicQueueLabels();
      updatePlayingHighlights();
      updateRepeatButtons();
      if(!t){
        nowInfoEl.innerHTML=`<div class="noArt">?</div><div class="nowText"></div>`;
        renderNowPlaying(null);
        return;
      }
      updateMediaSession(t);
      applyAdaptiveTheme();
      nowInfoEl.innerHTML=`${t.has_artwork?`<img src="${smallArtUrl(t)}" alt="">`:`<div class="noArt">?</div>`}<div class="nowText"><div class="nowTitle">${esc(t.title)}</div><div class="nowSub">${esc(t.artist||"Unknown artist")}</div></div>`;
      renderNowPlaying(t);
      if(!player.paused&&!player.ended)requestAnimationFrame(startVisualizer);
    }
    function fmt(seconds){if(!Number.isFinite(seconds))return "0:00"; const m=Math.floor(seconds/60), s=Math.floor(seconds%60); return `${m}:${String(s).padStart(2,"0")}`;}
    function fmtDuration(seconds){if(!Number.isFinite(seconds)||seconds<=0)return "0m"; const h=Math.floor(seconds/3600), m=Math.floor((seconds%3600)/60); return h?`${h}h ${m}m`:`${Math.max(1,m)}m`;}
    function statsTrackKey(t){
      const norm = v => String(v || "").trim().toLowerCase();
      const duration = Math.round(Number(knownDurations.get(t.id) || t.duration || 0) || 0);
      return `${norm(t.artist)}|${norm(t.album)}|${norm(t.title)}|${duration}`;
    }
    function statsTrackPayload(t){
      return {title:t.title||"Unknown title", artist:t.artist||"Unknown artist", album:t.album||"No album", format:t.format||"", duration:knownDurations.get(t.id)||player.duration||0};
    }
    async function postListeningStats(payload){
      try{await fetchJson("/api/listening-stats",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});}
      catch(err){console.warn("[stats] record failed", err);}
    }
    function resetStatsSession(trackId=playingId){
      const t=tracks.find(x=>x.id===trackId);
      statsSession=t?{trackId:t.id,lastTime:Number.isFinite(player.currentTime)?player.currentTime:0,pendingSeconds:0,listenedSeconds:0,playCounted:false}:null;
      lastStatsSentAt=Date.now();
    }
    function playCountThreshold(){
      const duration=Number(player.duration)||0;
      return duration>0?Math.min(30,Math.max(10,duration*.5)):30;
    }
    function flushListeningStats({force=false,countPlay=false}={}){
      if(!statsSession)return;
      const t=tracks.find(x=>x.id===statsSession.trackId);
      if(!t)return;
      const seconds=Math.max(0,statsSession.pendingSeconds);
      if(!countPlay && seconds<STATS_MIN_SECONDS_TO_RECORD)return;
      statsSession.pendingSeconds=0;
      postListeningStats({track:statsTrackPayload(t),seconds,count_play:countPlay});
      if(mediaType==="statsPage")loadListeningStats();
    }
    function updateListeningStatsProgress(){
      if(playingId===null||player.paused||player.ended)return;
      if(!statsSession||statsSession.trackId!==playingId)resetStatsSession(playingId);
      if(!statsSession)return;
      const current=Number(player.currentTime)||0;
      const delta=current-statsSession.lastTime;
      statsSession.lastTime=current;
      if(delta>0&&delta<8){
        statsSession.pendingSeconds+=delta;
        statsSession.listenedSeconds+=delta;
      }
      const countPlay=!statsSession.playCounted&&statsSession.listenedSeconds>=playCountThreshold();
      if(countPlay)statsSession.playCounted=true;
      if(countPlay||statsSession.pendingSeconds>=15||Date.now()-lastStatsSentAt>30000){
        lastStatsSentAt=Date.now();
        flushListeningStats({countPlay});
      }
    }
    // Stats rendering is split: app.js owns date-range rules and playback
    // lookups, while stats-components.js owns the chart/table markup.
    function statsTimeChart(rows, unit="day"){
      return statsComponents.statsTimeChart(rows, unit, {
        period: statsPeriod,
        isFutureStatsDay,
        isFutureStatsRangeAnchor,
        rangeStart: statsRangeDates().start,
        statsMonthTitle,
      });
    }
    function statsHero(rangeOptions, summary){
      return statsHeroHtml({rangeOptionsHtml:rangeOptions, summary, fmtDuration, primaryMetricLabel:statsPrimaryMetricLabel(), rangeControlHtml:statsRangeControlHtml()});
    }
    function statsRangeOptions(){
      return STATS_RANGES.map(([value,label])=>`<option value="${value}" ${statsPeriod===value?"selected":""}>${label}</option>`).join("");
    }
    function statsTopControls(summary){
      return statsComponents.statsTopControls({
        summary,
        fmtDuration,
        primaryMetricLabel: statsPrimaryMetricLabel(),
        rangeOptionsHtml: statsRangeOptions(),
        rangeControlHtml: statsRangeControlHtml(),
      });
    }
    function statsRangeControlHtml(){
      return statsRangeControlComponentHtml({period:statsPeriod, rangeLabel:statsRangeLabel(), dayValue:clampStatsDay(statsDay), maxDay:localDateString(), currentRange:statsAtCurrentRange(), today:statsAtToday()});
    }
    function statsSongTrack(row){
      if(!row)return null;
      const key = row.track_key || "";
      if(key){
        const byKey = tracks.find(t => statsTrackKey(t) === key);
        if(byKey)return byKey;
      }
      const norm = v => String(v || "").trim().toLowerCase();
      return tracks.find(t => norm(t.title) === norm(row.title) && norm(t.artist) === norm(row.artist) && norm(t.album) === norm(row.album))
        || tracks.find(t => norm(t.title) === norm(row.title) && norm(t.artist) === norm(row.artist))
        || null;
    }
    function statsSongRows(rows){
      return rows.map(row => {
        const track = statsSongTrack(row);
        return {...row, playable_id: track ? track.id : ""};
      });
    }
    function statsTables(songs){
      const orderedSongs = [...songs].sort((a,b)=>(Number(b.seconds)||0)-(Number(a.seconds)||0));
      const shownSongs = statsSongRows(isMobileLayout() ? orderedSongs.slice(0,8) : orderedSongs);
      statsTopSongTrackIds = shownSongs.map(row => Number(row.playable_id)).filter(Number.isFinite);
      const playTopSongs = statsTopSongTrackIds.length ? `<button id="playTopSongs" class="secondary iconControl statsSectionAction" type="button" title="Play top songs" aria-label="Play top songs">&#9654;</button>` : "";
      return `<div class="statsSections">${
        statsTableSection("Top Songs", shownSongs, [
          {label:"Song", render:r=>`<div class="statsTitle">${esc(r.title)}</div><div class="statsSub">${esc(r.artist)} - ${esc(r.album)}</div>`},
          {label:"Time", render:r=>esc(fmtStatsSongTime(r.seconds))},
        ], "No top songs yet.", playTopSongs)
      }</div>`;
    }
    function playTopStatsSongs(){
      const list = statsTopSongTrackIds.map(id => tracks.find(t => t.id === id)).filter(Boolean);
      playList(list, false, null, {selectInMusic:false});
    }
    function bindStatsSongRows(){
      const playTopSongs = byId("playTopSongs");
      if(playTopSongs)on(playTopSongs, "click", playTopStatsSongs);
      listeningStatsPanelEl.querySelectorAll("tr[data-play-track]").forEach(row => {
        const id = Number(row.dataset.playTrack);
        if(!Number.isFinite(id))return;
        row.addEventListener("click", () => playSingleTrack(id, {selectInMusic:false}));
        row.addEventListener("keydown", e => {if(e.key==="Enter"||e.key===" "){e.preventDefault(); playSingleTrack(id, {selectInMusic:false});}});
      });
    }
    function drillIntoStatsCell(cell){
      const month = cell.dataset.statsMonth;
      const day = cell.dataset.statsDay;
      if(month){
        if(isFutureStatsRangeAnchor("month", month))return;
        statsPeriod = saveLocalSetting("statsPeriod", "month");
        trySetStatsRangeAnchor("month", month);
        loadListeningStats();
      } else if(day){
        if(isFutureStatsDay(day))return;
        statsPeriod = saveLocalSetting("statsPeriod", "day");
        statsDay = saveLocalSetting("statsDay", day);
        loadListeningStats();
      }
    }
    function bindStatsChartDrilldowns(){
      listeningStatsPanelEl.querySelectorAll(".statsDrillCell").forEach(cell => {
        cell.addEventListener("click", () => drillIntoStatsCell(cell));
        cell.addEventListener("keydown", e => {if(e.key==="Enter"||e.key===" "){e.preventDefault(); drillIntoStatsCell(cell);}});
      });
    }
    function renderListeningStats(){
      const data=listeningStats;
      if(!data){listeningStatsPanelEl.innerHTML=`<div class="statsEmpty">Loading listening stats...</div>`; return;}
      const summary=data.summary||{};
      const chartDaily=data.chart_daily||[], songs=data.top_songs||[];
      const chartUnit=data.chart_unit||"day";
      const chartHtml = statsPeriod === "all" ? allTimeStatsCard(summary) : statsTimeChart(chartDaily, chartUnit);
      if(isMobileLayout()){
        statsEl.innerHTML="";
        listeningStatsPanelEl.innerHTML=`${statsHero(statsRangeOptions(), summary)}${chartHtml}${statsTables(songs)}`;
      } else {
        statsEl.innerHTML=statsTopControls(summary);
        listeningStatsPanelEl.innerHTML=`${chartHtml}${statsTables(songs)}`;
      }
      bindStatsControls();
      bindStatsSongRows();
      bindStatsChartDrilldowns();
    }
    function bindStatsControls(){
      on(byId("statsRange"),"change",e=>{statsPeriod=saveLocalSetting("statsPeriod",e.target.value); if(statsSteppablePeriod()&&!statsRangeAnchors[statsPeriod])setStatsRangeAnchor(statsPeriod,localDateString()); loadListeningStats();});
      on(byId("statsPrevRange"),"click",()=>shiftStatsRange(-1));
      on(byId("statsNextRange"),"click",()=>shiftStatsRange(1));
      on(byId("statsPrevDay"),"click",()=>{statsDay=saveLocalSetting("statsDay",shiftDate(statsDay,-1)); loadListeningStats();});
      on(byId("statsNextDay"),"click",()=>{const next=shiftDate(statsDay,1); if(isFutureStatsDay(next))return; statsDay=saveLocalSetting("statsDay",next); loadListeningStats();});
      on(byId("statsDay"),"change",e=>{const next=e.target.value||localDateString(); if(isFutureStatsDay(next)){e.target.value=statsDay; return;} statsDay=saveLocalSetting("statsDay",next); if(statsPeriod==="day")loadListeningStats();});
    }
    function listeningStatsUrl(){
      const params = new URLSearchParams({period:statsPeriod});
      if(statsPeriod==="day"){
        params.set("start", statsDay || localDateString());
        params.set("end", statsDay || localDateString());
      }else if(statsSteppablePeriod()){
        const {start,end}=statsRangeDates();
        params.set("start", start);
          params.set("end", end);
        }
      params.set("_", String(Date.now()));
      return `/api/listening-stats?${params}`;
    }
    async function loadListeningStats(){
      try{
        listeningStats = await fetchJson(listeningStatsUrl());
        if(mediaType==="statsPage")renderListeningStats();
      }catch(err){
        console.warn("[stats] load failed", err);
        listeningStats = null;
        if(mediaType==="statsPage"){
          listeningStatsPanelEl.innerHTML=`<div class="statsEmpty">Could not load listening stats. Restart the server so the new stats API is available, then refresh this page.</div>`;
        }
      }
    }
    // Theme customization. Fixed themes are simple CSS classes; adaptive themes
    // sample the current artwork so the accent can follow the album/song.
    function currentThemeChoice(){
      return THEME_CHOICES.find(theme=>theme.id===activeTheme)||THEME_CHOICES[0];
    }
    function setThemeMode(mode){
      const current=currentThemeChoice();
      const matching=THEME_CHOICES.find(theme=>theme.mode===mode&&theme.family===current.family)
        ||THEME_CHOICES.find(theme=>theme.mode===mode&&theme.family==="adaptive");
      if(matching)setAccentTheme(matching.id);
    }
    function renderCustomize(){
      if(!themeGridEl) return;
      const current=currentThemeChoice();
      const mode=current.mode||"dark";
      const visibleThemes=THEME_CHOICES.filter(theme=>theme.mode===mode);
      statsEl.innerHTML = `<div class="topTabControls"><strong>Customize</strong></div>`;
      themeGridEl.innerHTML = `<div class="themeModeToggle" role="group" aria-label="Appearance"><button type="button" data-theme-mode="light" class="${mode==="light"?"active":""}" aria-pressed="${mode==="light"}">Light</button><button type="button" data-theme-mode="dark" class="${mode==="dark"?"active":""}" aria-pressed="${mode==="dark"}">Dark</button></div><div class="themeChoiceGrid">${visibleThemes.map(theme => {
        const active = theme.id === activeTheme ? " active" : "";
        return `<button class="themeChoice${active}" data-theme="${esc(theme.id)}" type="button" style="--swatch-a:${esc(theme.swatchA)};--swatch-b:${esc(theme.swatchB)};--swatch-rgb:${esc(theme.swatchRgb)}"><span class="themeSwatch"></span><strong>${esc(theme.label)}</strong></button>`;
      }).join("")}</div>`;
      themeGridEl.querySelectorAll("[data-theme-mode]").forEach(button => {
        on(button, "click", () => setThemeMode(button.dataset.themeMode));
      });
      themeGridEl.querySelectorAll(".themeChoice").forEach(button => {
        on(button, "click", () => setAccentTheme(button.dataset.theme));
      });
    }
    function clearAdaptiveThemeVars(){
      if(themeEngine.clearAdaptiveThemeVars) themeEngine.clearAdaptiveThemeVars();
      adaptiveThemeSource = "";
    }
    function isAdaptiveTheme(){return themeEngine.isAdaptiveTheme ? themeEngine.isAdaptiveTheme(activeTheme) : false;}
    function applyAdaptiveColor(color){if(themeEngine.applyAdaptiveColor) themeEngine.applyAdaptiveColor(activeTheme, color);}
    function sampleAdaptiveColor(src){return themeEngine.sampleAdaptiveColor ? themeEngine.sampleAdaptiveColor(src) : Promise.reject(new Error("Theme engine unavailable"));}
    async function applyAdaptiveTheme(){
      if(!isAdaptiveTheme()){clearAdaptiveThemeVars(); return;}
      const track=tracks.find(t=>t.id===playingId)||tracks.find(t=>t.id===selectedId);
      const src=track ? fullArtUrl(track) : "";
      if(!src){applyAdaptiveColor(DEFAULT_ADAPTIVE_COLOR); return;}
      if(src===adaptiveThemeSource)return;
      adaptiveThemeSource=src;
      try{
        const color=adaptiveThemeCache.get(src)||await sampleAdaptiveColor(src);
        adaptiveThemeCache.set(src,color);
        if(isAdaptiveTheme()&&adaptiveThemeSource===src)applyAdaptiveColor(color);
      }catch(err){
        console.warn("[theme] adaptive color failed", err);
        applyAdaptiveColor(DEFAULT_ADAPTIVE_COLOR);
      }
    }
    function setAccentTheme(themeId){
      const theme = themeEngine.themeById ? themeEngine.themeById(themeId) : (THEME_CHOICES.find(item => item.id === themeId) || THEME_CHOICES[0]);
      clearAdaptiveThemeVars();
      if(themeEngine.applyThemeClass) themeEngine.applyThemeClass(theme);
      activeTheme = theme.id;
      localStorage.setItem("accentTheme", activeTheme);
      applyAdaptiveTheme();
      renderCustomize();
      clearVisualizer("nowPlayingVisualizer");
      if(!player.paused && !player.ended) requestAnimationFrame(startVisualizer);
      if(mediaType === "statsPage") renderListeningStats();
    }
    function applyDisplayConfig(){
      const appName=appConfig.appName||"Local Media Player";
      const textLabel=appConfig.textTabLabel||"Interviews";
      document.title=appName;
      const titleEl=document.querySelector("header h1");
      if(titleEl)titleEl.textContent=appName;
      interviewsTabEl.title=textLabel;
      interviewsTabEl.setAttribute("aria-label", textLabel);
      document.querySelectorAll("[data-text-label]").forEach(el=>{el.textContent=textLabel;});
      const emptyText=document.querySelector("[data-text-empty]");
      if(emptyText)emptyText.textContent=`Text files are loaded locally from media\\${appConfig.textDir||"Interviews"}.`;
      const savePlaylist=byId("saveQueuePlaylist");
      if(savePlaylist)savePlaylist.hidden=!appConfig.playlistEditable;
    }
    async function loadConfig(){try{appConfig={...appConfig,...await fetchJson("/api/config")};}catch{appConfig={...appConfig,editable:true};} applyDisplayConfig(); document.body.classList.toggle("readOnly",!appConfig.editable); if(!appConfig.editable&&appMode==="edit")setAppMode("listen"); if(!appConfig.editable&&mediaType==="health")setMediaType("music");}
    function renderCurrentMedia(){if(mediaType==="video")renderVideoAll(); else if(mediaType==="health")renderHealth(); else if(mediaType==="interviews")renderInterviews(); else if(mediaType==="statsPage")renderListeningStats(); else if(mediaType==="customize")renderCustomize(); else renderAll();}
    async function loadTracks(refresh=false, keepId=null){
      if(refresh) await fetchJson("/api/refresh");
      const trackData = await fetchJson("/api/tracks");
      tracks = trackData.tracks;
      tracksLoaded = true;
      await loadPlaylists(false);
      if(refresh && videosLoaded) await loadVideos();
      if(refresh && interviewsLoaded) await loadInterviews();
      if(refresh && listeningStats) await loadListeningStats();
      renderCurrentMedia();
      restoreMusicState();

      if(keepId !== null && tracks.some(t=>t.id === keepId)){
        selectTrack(keepId);
      }
    }
    async function loadVideos(){
      const videoData = await fetchJson("/api/videos");
      videos = videoData.videos || [];
      videosLoaded = true;
      restoreVideoState();
      if(mediaType==="video")renderVideoAll();
    }
    async function loadInterviews(){
      const interviewData = await fetchJson("/api/interviews");
      interviews = interviewData.interviews || [];
      interviewsLoaded = true;
      if(mediaType==="interviews")renderInterviews();
    }
    async function ensureMediaLoaded(type){
      if(type==="health"){
        if(!tracksLoaded) await loadTracks();
        if(!videosLoaded) await loadVideos();
        if(mediaType==="health") renderHealth();
        return;
      }
      if(type==="video"&&!videosLoaded) await loadVideos();
      if(type==="interviews"&&!interviewsLoaded) await loadInterviews();
      if(type==="music"&&!tracksLoaded) await loadTracks();
      if(type==="statsPage"&&!listeningStats) await loadListeningStats();
    }
    function setGroupMode(mode){groupMode=mode; resetMusicSelection(); renderAll();}
    async function unlockEditMode(){return Boolean(appConfig.editable);}
    async function enterEditMode(){if(await unlockEditMode())setAppMode("edit");}
    function closeFloatingPanels(){[navEl,interviewListEl,queueDrawerEl,videoQueueDrawerEl,nowPlayingDrawerEl].forEach(el=>setOpen(el,false));}
    function resetMusicHomeState(){resetMusicSelection(); selectedIds.clear(); searchEl.value=""; musicFilterEl.value="all"; detailEl.innerHTML=`<div class="bigCover emptyCover">Select a song</div>`; closeFloatingPanels();}
    function setModeButtons(mode){setActive(byId("listenMode"),mode==="listen"); setActive(byId("editMode"),mode==="edit");}
    function setAppMode(mode,{resetHome=false}={}){if(!appConfig.editable&&mode==="edit")mode="listen"; const leavingEdit=appMode==="edit"&&mode==="listen"; appMode=mode; if(mode==="listen"){musicFilterEl.value="all"; selectedIds.clear(); if(resetHome||leavingEdit)resetMusicHomeState();} setBodyMode("listen",mode==="listen"); setBodyMode("edit",mode==="edit"); setModeButtons(mode); if(mediaType==="music")renderAll();}
    function enterListenMode(){setMediaType("music"); setAppMode("listen",{resetHome:true}); window.scrollTo({top:0,behavior:"smooth"});}
    function isMobileLayout(){return window.innerWidth<=MOBILE_BREAKPOINT;}
    function updateBrowseToggle(){document.body.classList.toggle("browseCollapsed",browseCollapsed&&!isMobileLayout()); document.querySelectorAll(".browseToggle").forEach(btn=>{btn.innerHTML=buttonIcon("browse"); btn.title=browseCollapsed&&!isMobileLayout()?"Show browse panel":"Browse"; btn.setAttribute("aria-label", btn.title);});}
    function closeBrowsePanel(){
      setOpen(navEl,false);
      if(!isMobileLayout()){
        browseCollapsed = true;
        localStorage.setItem("browseCollapsed", "true");
        updateBrowseToggle();
      }
    }
    function closeInterviewBrowsePanel(){
      setOpen(interviewListEl,false);
      if(!isMobileLayout()){
        browseCollapsed = true;
        localStorage.setItem("browseCollapsed", "true");
        updateBrowseToggle();
      }
    }
    function toggleBrowse(){
      if(isMobileLayout()){
        toggleOpen(mediaType === "interviews" ? interviewListEl : navEl);
        return;
      }
      browseCollapsed = !browseCollapsed;
      localStorage.setItem("browseCollapsed", browseCollapsed ? "true" : "false");
      updateBrowseToggle();
    }
    function setDeviceClass(){document.body.classList.toggle("mobileUi", isMobileLayout()); updateBrowseToggle();}
    function setTheme(){document.body.classList.add("dark"); setAccentTheme(activeTheme);}
    function stopVideoPlayback(){
      if(!videoPlayerEl) return;
      saveVideoState({force:true});
      videoPlayerEl.pause();
      videoPlayerEl.removeAttribute("src");
      videoPlayerEl.load();
      selectedVideoId = null;
      videoTitleEl.textContent = VIDEO_EMPTY_TITLE;
      videoMetaEl.textContent = VIDEO_EMPTY_META;
    }
    function pauseVideoForTabSwitch(){
      if(!videoPlayerEl) return;
      saveVideoState({force:true});
      videoPlayerEl.pause();
    }
    // Switching tabs should never stop music, but video is paused so it does
    // not keep decoding in the background while the user is browsing music or stats.
    function setMediaType(type){
      if(!appConfig.editable && type === "health") type = "music";
      if(mediaType!==type)clearSearchQuery();
      mediaType = type;
      // Phones/tablets are playback-first. Editing remains desktop-only so the
      // small layout does not expose destructive metadata controls.
      if(isMobileLayout() && appMode === "edit") setAppMode("listen");

      MEDIA_TYPES.forEach(name=>setBodyMode(name, type === name));
      musicTabEl.classList.toggle("inactive", type !== "music");
      videoTabEl.classList.toggle("inactive", type !== "video");
      interviewsTabEl.classList.toggle("inactive", type !== "interviews");
      statsTabEl.classList.toggle("inactive", type !== "statsPage");
      customizeTabEl.classList.toggle("inactive", type !== "customize");
      healthTabEl.classList.toggle("inactive", type !== "health");

      searchEl.placeholder =
        type === "video" ? "Search video title or folder" :
        type === "interviews" ? "Search interviews" :
        type === "customize" ? "Customize the player" :
        type === "statsPage" ? "Stats are summary-only" :
        type === "health" ? "Search is for music, video, interviews" :
        "Search title, album, artist";

      if(type === "statsPage")loadListeningStats();
      if(type === "video"){
        setOpen(queueDrawerEl, false);
        if(!isMobileLayout()){
          browseCollapsed = true;
          localStorage.setItem("browseCollapsed", "true");
          updateBrowseToggle();
        }
      } else {
        pauseVideoForTabSwitch();
      }
      renderCurrentMedia();
      ensureMediaLoaded(type).catch(err=>console.error("[library] load failed", err));
    }
    // Event binding lives at the end so startup is easy to follow. These
    // functions mostly connect stable DOM controls to the stateful functions above.
    function bindTableEvents(){document.querySelectorAll("th.sortable").forEach(th=>th.addEventListener("click",()=>{tableSortActive=true; const key=th.dataset.sort; if(sortKey===key) sortDir=sortDir==="asc"?"desc":"asc"; else { sortKey=key; sortDir=key==="has_artwork"?"desc":"asc"; } renderRows();})); selectShownEl.addEventListener("change",()=>{for(const t of filtered()){selectShownEl.checked?selectedIds.add(t.id):selectedIds.delete(t.id);} renderRows();}); clearSelectedEl.addEventListener("click",()=>{selectedIds.clear(); renderRows();}); bulkSaveEl.addEventListener("click",bulkSave);}
    function bindMusicControls(){on(byId("playShownMusic"),"click",()=>playList(currentPlaybackList())); on(byId("shuffleShownMusic"),"click",()=>playList(currentPlaybackList(),true)); on(byId("topQueueToggle"),"click",toggleMusicQueue); on(byId("showAllAlbums"),"click",closeMusicAlbum); on(byId("listenMode"),"click",enterListenMode); on(byId("editMode"),"click",()=>enterEditMode()); on(albumViewModeEl,"change",()=>setAlbumViewMode(albumViewModeEl.value)); on(musicFilterEl,"change",renderAll);}
    function bindBrowseControls(){on(byId("browseMusic"),"click",toggleBrowse); on(byId("browseVideo"),"click",toggleBrowse); on(byId("toggleBrowsePanel"),"click",toggleBrowse); on(byId("closeBrowse"),"click",closeBrowsePanel); on(byId("browseInterviews"),"click",toggleBrowse); on(byId("shuffleInterviews"),"click",shuffleInterview); on(byId("toggleInterviewBrowsePanel"),"click",toggleBrowse); on(byId("closeInterviewBrowse"),"click",closeInterviewBrowsePanel);}
    function bindTabsAndSearch(){on(musicTabEl,"click",()=>setMediaType("music")); on(videoTabEl,"click",()=>setMediaType("video")); on(interviewsTabEl,"click",()=>setMediaType("interviews")); on(statsTabEl,"click",()=>setMediaType("statsPage")); on(customizeTabEl,"click",()=>setMediaType("customize")); on(healthTabEl,"click",()=>setMediaType("health")); on(searchEl,"input",renderCurrentMedia); on(byId("refresh"),"click",()=>loadTracks(true,selectedId)); on(window,"resize",setDeviceClass); on(window,"beforeunload",()=>flushListeningStats({force:true}));}
    function bindKeyboardShortcuts(){on(document,"keydown",e=>{if(e.code!=="Space"||isTypingTarget(e.target)||mediaType!=="music"||appMode!=="listen")return; e.preventDefault(); toggleAudioPlayback();});}
    function bindVideoControls(){on(videoSortEl,"change",()=>{videoSort=videoSortEl.value; localStorage.setItem("videoSort",videoSort); renderVideoAll();}); on(byId("prevVideo"),"click",()=>playVideoQueueIndex(videoQueueIndex-1)); on(byId("nextVideo"),"click",()=>playVideoQueueIndex(videoQueueIndex+1)); on(byId("stopVideo"),"click",()=>{stopVideoPlayback(); saveVideoState({force:true}); renderVideos(); renderVideoQueue();}); on(byId("shuffleShownVideo"),"click",()=>playVideoList(videoFiltered(),true)); on(videoRepeatBtn,"click",cycleVideoRepeat); on(byId("repeatVideoQueue"),"click",cycleVideoRepeat); on(byId("videoQueueToggle"),"click",toggleVideoQueue); on(byId("toggleVideoQueueTitle"),"click",()=>setOpen(videoQueueDrawerEl,false)); on(byId("closeVideoQueue"),"click",()=>setOpen(videoQueueDrawerEl,false)); on(byId("clearVideoQueue"),"click",()=>{videoQueue=[]; videoQueueIndex=-1; stopVideoPlayback(); saveVideoState({force:true}); updateVideoQueueLabel(); renderVideos(); renderVideoQueue();}); on(byId("shuffleVideoQueue"),"click",()=>{const current=videoQueue[videoQueueIndex]; videoQueue=shuffle(videoQueue.map(id=>videos.find(v=>v.id===id)).filter(Boolean)).map(v=>v.id); videoQueueIndex=current===undefined?-1:videoQueue.indexOf(current); saveVideoState({force:true}); updateVideoQueueLabel(); renderVideoQueue();}); on(videoPlayerEl,"play",()=>saveVideoState({force:true})); on(videoPlayerEl,"pause",()=>saveVideoState({force:true})); on(videoPlayerEl,"timeupdate",()=>saveVideoState()); on(videoPlayerEl,"seeked",()=>saveVideoState({force:true})); on(videoPlayerEl,"ended",()=>{saveVideoState({force:true}); if(videoRepeatMode==="one"){videoPlayerEl.currentTime=0; videoPlayerEl.play(); return;} if(videoQueueIndex+1<videoQueue.length) playVideoQueueIndex(videoQueueIndex+1); else if(videoRepeatMode==="all"&&videoQueue.length) playVideoQueueIndex(0);});}
    function bindQueueControls(){
      on(byId("toggleQueueTitle"),"click",()=>setOpen(queueDrawerEl,false));
      on(byId("closeQueue"),"click",()=>setOpen(queueDrawerEl,false));
      on(byId("repeatQueue"),"click",cycleMusicRepeat);
      on(byId("saveQueuePlaylist"),"click",saveOrUpdateQueuePlaylist);
      on(byId("clearQueue"),"click",()=>{
        queue=[];
        queueIndex=-1;
        player.pause();
        playingId=null;
        saveMusicState({force:true});
        updateNow();
        renderQueue();
      });
      on(byId("shuffleQueue"),"click",()=>{
        const current=queue[queueIndex];
        queue=shuffle(queue.map(id=>tracks.find(t=>t.id===id)).filter(Boolean)).map(t=>t.id);
        queueIndex=current===undefined?-1:queue.indexOf(current);
        saveMusicState({force:true});
        updateNow();
        renderQueue();
      });
    }
    function bindPlaylistDialog(){
      on(playlistFormEl,"submit",submitPlaylistDialog);
      on(byId("closePlaylistDialog"),"click",()=>playlistDialogEl.close());
      on(byId("cancelPlaylistDialog"),"click",()=>playlistDialogEl.close());
      on(playlistDialogEl,"click",event=>{if(event.target===playlistDialogEl)playlistDialogEl.close();});
    }
    /** @brief Wire mini-player, audio element events, and Now Playing sync. */
    function bindAudioPlayer(){
      on(byId("prevBtn"),"click",()=>playQueueIndex(queueIndex-1));
      on(byId("nextBtn"),"click",()=>playQueueIndex(queueIndex+1));
      on(playPauseBtn,"click",toggleAudioPlayback);
      on(repeatBtn,"click",cycleMusicRepeat);
      on(nowInfoEl,"click",()=>{
        if(playingId!==null){
          setOpen(nowPlayingDrawerEl,true);
          if(!player.paused&&!player.ended)requestAnimationFrame(startVisualizer);
        }
      });
      on(byId("closeNowPlaying"),"click",()=>setOpen(nowPlayingDrawerEl,false));
      on(player,"canplay",()=>console.debug("[audio] browser canplay", {src:player.currentSrc,currentTime:player.currentTime}));
      on(player,"playing",()=>console.debug("[audio] browser playing", {src:player.currentSrc,currentTime:player.currentTime}));
      on(player,"play",()=>{switchingAudioTrack=false; setupMediaSessionActions(); if(!statsSession||statsSession.trackId!==playingId)resetStatsSession(playingId); startVisualizer(); saveMusicState({force:true}); updateNow();});
      on(player,"pause",()=>{setupMediaSessionActions(); saveMusicState({force:true}); flushListeningStats({force:true}); if(switchingAudioTrack)return; stopVisualizer(); updateNow();});
      on(player,"ended",()=>{
        setupMediaSessionActions();
        stopVisualizer();
        flushListeningStats({force:true});
        if(repeatMode==="one"){player.currentTime=0; playCurrentAudio({retry:true}); return;}
        if(queueIndex+1<queue.length) playQueueIndex(queueIndex+1);
        else if(repeatMode==="all"&&queue.length) playQueueIndex(0);
      });
      on(player,"loadedmetadata",()=>{
        setupMediaSessionActions();
        seekBar.value=player.duration?Math.round((player.currentTime/player.duration)*1000):0;
        currentTimeEl.textContent=fmt(player.currentTime);
        durationEl.textContent=fmt(player.duration);
        const npCurrent=byId("npCurrentTime"), npDuration=byId("npDuration"), npSeek=byId("npSeekBar");
        if(npCurrent)npCurrent.textContent=currentTimeEl.textContent;
        if(npDuration)npDuration.textContent=nowPlayingRemainingText();
        if(npSeek)npSeek.value=seekBar.value;
        if(playingId!==null&&Number.isFinite(player.duration))knownDurations.set(playingId,player.duration);
        updateNow();
        renderQueue();
      });
      on(player,"error",()=>console.warn("[audio] browser audio error", {code:player.error?.code, message:player.error?.message, src:player.currentSrc, id:playingId}));
      on(player,"timeupdate",()=>{
        if(seeking)return;
        currentTimeEl.textContent=fmt(player.currentTime);
        seekBar.value=player.duration?Math.round((player.currentTime/player.duration)*1000):0;
        const npCurrent=byId("npCurrentTime"), npDuration=byId("npDuration"), npSeek=byId("npSeekBar");
        if(npCurrent)npCurrent.textContent=currentTimeEl.textContent;
        if(npDuration)npDuration.textContent=nowPlayingRemainingText();
        if(npSeek)npSeek.value=seekBar.value;
        updateLrcHighlight();
        updateListeningStatsProgress();
        saveMusicState();
      });
      on(seekBar,"input",()=>{seeking=true;});
      on(seekBar,"change",()=>{
        if(player.duration) player.currentTime=(Number(seekBar.value)/1000)*player.duration;
        seeking=false;
        saveMusicState({force:true});
      });
      on(volumeBar,"input",()=>{
        setPlayerVolume(volumeBar.value);
      });
    }
    function initializeApp(){
      bindTableEvents();
      bindMusicControls();
      bindBrowseControls();
      bindTabsAndSearch();
      bindKeyboardShortcuts();
      bindVideoControls();
      bindQueueControls();
      bindPlaylistDialog();
      bindAudioPlayer();

      videoSortEl.value = videoSort;
      videoPlayerEl.playsInline = true;
      videoPlayerEl.setAttribute("playsinline", "");
      videoPlayerEl.setAttribute("webkit-playsinline", "");

      setTheme();
      setDeviceClass();
      setupMediaSessionActions();
      setPlayerVolume(savedVolume(), {persist:false});
      updateMusicQueueLabels();
      updateVideoQueueLabel();
      updateRepeatButtons();
      on(window,"beforeunload",()=>{saveMusicState({force:true}); saveVideoState({force:true});});
      loadConfig().then(()=>loadTracks());
    }
    window.MediaPlayerStart=initializeApp;
