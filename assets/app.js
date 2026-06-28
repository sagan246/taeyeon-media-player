    // App state. Most UI functions read from these values, then call renderCurrentMedia().
    let tracks = [];
    let videos = [];
    let interviews = [];

    let selectedId = null;
    let playingId = null;
    let selectedVideoId = null;
    let selectedInterviewId = null;

    let mediaType = "music";
    let appMode = "listen";
    let groupMode = "category";
    let selectedGroup = "All";
    let selectedAlbum = "All";
    let selectedVideoGroup = "All";
    let selectedVideoAsFolder = false;

    let sortKey = "date";
    let sortDir = "desc";
    let videoSort = localStorage.getItem("videoSort") || "newest";
    let albumViewMode = localStorage.getItem("albumViewMode") || "newest";
    let appConfig = {editable:true, editRequiresPassword:false};
    let editToken = localStorage.getItem("editToken") || "";
    if(!["newest","oldest","sections"].includes(videoSort)) videoSort = "newest";
    let browseCollapsed = localStorage.getItem("browseCollapsed") === "true";
    let queue = [], queueIndex = -1, seeking = false;
    const knownDurations = new Map();
    let videoQueue = [], videoQueueIndex = -1;
    let albumClickTimer = null, queueToastTimer = null;
    let audioContext = null, analyserNode = null, audioSourceNode = null, visualizerData = null, visualizerFrame = null, visualizerMode = localStorage.getItem("visualizerMode") || "bars";
    const selectedIds = new Set();
    const MEDIA_TYPES = ["music", "video", "health", "interviews"];
    // Small DOM/API helpers keep the rest of the file readable.
    const byId = id => document.getElementById(id);
    const on = (el, event, handler) => el.addEventListener(event, handler);
    const setOpen = (el, open) => {
      el.classList.toggle("open", open);
      if(el.id === "nowPlayingDrawer"){
        document.body.classList.toggle("modalOpen", open);
      }
    };
    const toggleOpen = el => setOpen(el, !el.classList.contains("open"));
    const setActive = (el, active) => el.classList.toggle("active", active);
    const setBodyMode = (name, active) => document.body.classList.toggle(name, active);
    async function fetchJson(url, options){return (await fetch(url, options)).json();}
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
    const selectedCountEl = byId("selectedCount");
    const selectShownEl = byId("selectShown");
    const bulkSaveEl = byId("bulkSave");
    const clearSelectedEl = byId("clearSelected");
    const albumGridEl = byId("albumGrid");
    const viewTitleEl = byId("viewTitle");
    const player = byId("player");
    const nowInfoEl = byId("nowInfo");
    const playPauseBtn = byId("playPauseBtn");
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
    const musicTabEl = byId("musicTab");
    const videoTabEl = byId("videoTab");
    const interviewsTabEl = byId("interviewsTab");
    const healthTabEl = byId("healthTab");
    const videoGridEl = byId("videoGrid");
    const videoPlayerEl = byId("videoPlayer");
    const videoTitleEl = byId("videoTitle");
    const videoMetaEl = byId("videoMeta");
    const videoViewTitleEl = byId("videoViewTitle");
    const videoQueueToggleEl = byId("videoQueueToggle");
    const videoQueueDrawerEl = byId("videoQueueDrawer");
    const videoQueueListEl = byId("videoQueueList");
    const videoSortEl = byId("videoSort");
    const interviewListEl = byId("interviewList");
    const interviewItemsEl = byId("interviewItems");
    const interviewReaderEl = byId("interviewReader");
    const healthPanelEl = byId("healthPanel");
    // Text helpers and library grouping rules.
    function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
    function editHeaders(extra={}){return editToken?{...extra,"X-Edit-Token":editToken}:extra;}
    function categoryOf(t){return t.path.includes("/") ? t.path.split("/")[0] : "(root)";}
    function folderOf(t){return t.folder || (t.path.includes("/") ? t.path.split("/").slice(0,-1).join("/") : "(root)");}
    function albumOf(t){return t.album || "(No album)";}
    function groupOf(t){if(groupMode==="category") return categoryOf(t); if(groupMode==="album") return albumOf(t); return folderOf(t);}
    function searchQuery(){return String(searchEl.value||"").trim().toLowerCase();}
    function containsSearch(values){const q=searchQuery(); if(!q)return true; return values.some(value=>String(value||"").toLowerCase().includes(q));}
    function shortPathLabel(value){const text=String(value||"").replaceAll("\\\\","/"); if(!text||text==="All"||text==="(root)")return text||"(root)"; const parts=text.split("/").filter(Boolean); return parts.length?parts[parts.length-1]:text;}
    function groupLabel(name){return String(name||"").includes("/")?shortPathLabel(name):String(name||"");}
    // Keep Taeyeon-focused folders above group/side-project folders in Browse.
    function musicCategoryRank(name){const label=String(name||"").toLowerCase(); if(label==="all")return -100; if(label.includes("taeyeon official"))return 0; if(label.includes("taeyeon ost"))return 1; if(label.includes("taeyeon live")||label.includes("covers")||label.includes("radio"))return 2; if(label.includes("taeyeon concert"))return 3; if(label.includes("taeyeon features")||label.includes("collaboration"))return 4; if(label.includes("girls' generation-tts")||label.includes("girlsgeneration-tts"))return 20; if(label.includes("girls' generation")||label.includes("girls generation"))return 21; if(label.includes("got the beat"))return 22; if(label.includes("needs better copy"))return 90; return 50;}
    function musicCategoryCompare(a,b){const ar=musicCategoryRank(Array.isArray(a)?a[0]:a), br=musicCategoryRank(Array.isArray(b)?b[0]:b); if(ar!==br)return ar-br; const an=Array.isArray(a)?a[0]:a, bn=Array.isArray(b)?b[0]:b; return String(an).localeCompare(String(bn),undefined,{numeric:true,sensitivity:"base"});}
    function countLabel(count, singular, plural=`${singular}s`){return `${count} ${count===1?singular:plural}`;}
    function videoMetaSummary(v){const year=videoYear(v), format=String(v.format||"video").toUpperCase(); return `${year?`${year} - `:""}${format} - ${esc(v.size_mb)} MB`;}
    // Shared UI builders. Music, video, and interview screens should look like
    // one app, so common button/card pieces live here instead of being copied.
    function browseItemHtml(name, count, active){
      return `<button class="groupItem ${active?"active":""}" data-group="${esc(name)}" title="${esc(name)}"><span class="groupName">${esc(groupLabel(name))}</span><span class="groupCount">${count}</span></button>`;
    }
    function renderBrowseItems(items, isActive, onChoose){
      groupsEl.innerHTML = items.map(([name,count]) => browseItemHtml(name, count, isActive(name))).join("");
      groupsEl.querySelectorAll(".groupItem").forEach(btn=>btn.addEventListener("click",()=>{
        onChoose(btn.dataset.group);
        setOpen(navEl, false);
      }));
    }
    function actionButtonHtml({action, actionAttr="action", valueName, value, label, icon, primary=false, add=false}){
      const classes = `${primary?"":"secondary "}iconButton iconControl${add?" addIcon":""}`.trim();
      return `<button class="${classes}" data-${actionAttr}="${esc(action)}" data-${valueName}="${esc(value)}" title="${esc(label)}" aria-label="${esc(label)}">${icon}</button>`;
    }
    function cardActionsHtml(buttons){
      return `<div class="cardActions">${buttons.map(actionButtonHtml).join("")}</div>`;
    }
    function detailActionButtonHtml({id, label, icon, primary=false, add=false, text=""}){
      const classes = `${primary?"playButton":"secondary"} ${icon?"iconControl":""}${add?" addIcon":""}`.trim();
      return `<button id="${esc(id)}" class="${classes}" title="${esc(label)}" aria-label="${esc(label)}">${icon || esc(text)}</button>`;
    }
    function detailActionsHtml(buttons){
      return `<div class="albumActions">${buttons.map(detailActionButtonHtml).join("")}</div>`;
    }
    function sectionGroupHtml(title, countText, cardsHtml, sectionClass="", gridClass=""){
      return `<section class="albumHomeSection ${sectionClass}"><div class="albumSectionHead"><h2>${esc(groupLabel(title))}</h2><span>${esc(countText)}</span></div><div class="albumSectionGrid ${gridClass}">${cardsHtml}</div></section>`;
    }
    function statPillHtml(value, label){
      return `<span class="stat"><strong>${esc(value)}</strong> ${esc(label)}</span>`;
    }
    function renderStatsPills(items){
      statsEl.innerHTML = items.map(([value,label])=>statPillHtml(value,label)).join("");
    }
    function buttonIcon(name){
      const icons = {
        browse: `<svg class="buttonIcon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h6l2 3h10v9H3z"/><path d="M3 7v12"/></svg>`,
        queue: `<svg class="buttonIcon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/></svg>`,
      };
      return icons[name] || "";
    }
    function removeQueueButtonHtml(index){
      return `<button class="secondary iconControl" data-remove="${index}" title="Remove" aria-label="Remove">&#10005;</button>`;
    }
    function emptyQueueHtml(title, subtitle){
      return `<div class="queueItem"><div class="noArt">?</div><div><div class="queueItemTitle">${esc(title)}</div><div class="queueItemSub">${esc(subtitle)}</div></div></div>`;
    }
    function queueItemHtml({index, active, artworkHtml, title, subtitle, draggable=false}){
      return `<div class="queueItem ${active?"active":""}" data-index="${index}" ${draggable?'draggable="true"':""}>${artworkHtml}<div><div class="queueItemTitle">${index+1}. ${esc(title)}</div><div class="queueItemSub">${esc(subtitle)}</div></div>${removeQueueButtonHtml(index)}</div>`;
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
    // Named view transitions keep screen state changes in one place.
    function resetMusicSelection(){selectedGroup="All"; selectedAlbum="All";}
    function openMusicGroup(group){selectedGroup=group; selectedAlbum="All"; renderAll();}
    function openMusicAlbum(album){selectedAlbum=album; renderAll();}
    function closeMusicAlbum(){selectedAlbum="All"; renderAll();}
    function setAlbumViewMode(mode){albumViewMode=mode; localStorage.setItem("albumViewMode",albumViewMode); selectedAlbum="All"; if(albumViewMode==="sections"||albumViewMode==="years")searchEl.value=""; renderAll();}
    function openVideoGroup(group){selectedVideoGroup=group; selectedVideoAsFolder=false; renderVideoAll();}
    function openVideoFolder(folder){selectedVideoGroup=folder; selectedVideoAsFolder=true; renderVideoAll();}
    function closeVideoFolder(){selectedVideoGroup="All"; selectedVideoAsFolder=false; renderVideoAll();}
    // Music filtering/rendering. These functions decide what the current music page shows.
    function baseFiltered(){const filter=musicFilterEl.value; return tracks.filter(t=>{if(selectedGroup!=="All"&&groupOf(t)!==selectedGroup)return false; if(selectedAlbum!=="All"&&albumOf(t)!==selectedAlbum)return false; if(filter==="art:with"&&!t.has_artwork)return false; if(filter==="art:missing"&&t.has_artwork)return false; if(!passesFieldFilter(t))return false; if(!containsSearch([t.title,t.artist,t.album,t.albumartist,t.date,t.path,t.folder]))return false; return true;});}
    function filtered(){const list=baseFiltered(); return selectedAlbum!=="All"?albumTrackList(list):sortedList(list);}
    function renderGroups(){
      const counts = new Map();
      counts.set("All", tracks.length);
      for(const t of tracks){
        const group = groupOf(t);
        counts.set(group, (counts.get(group) || 0) + 1);
      }
      if(!counts.has(selectedGroup)) selectedGroup = "All";
      const groups = [...counts.entries()].sort((a,b) =>
        groupMode === "category"
          ? musicCategoryCompare(a,b)
          : (a[0] === "All" ? -1 : b[0] === "All" ? 1 : b[1] - a[1] || a[0].localeCompare(b[0]))
      );
      renderBrowseItems(groups, name=>name===selectedGroup, openMusicGroup);
    }
    function renderStats(list){const total=tracks.length; if(appMode==="listen"){const albums=new Set(list.map(albumOf)).size; renderStatsPills([[total,"tracks"],[albums,"albums shown"],[list.length,"songs shown"]]); return;} const withArt=tracks.filter(t=>t.has_artwork).length, missing=list.filter(t=>t.missing_fields.length).length, review=list.filter(t=>t.review_flags.length).length; renderStatsPills([[total,"tracks"],[withArt,"with artwork"],[total-withArt,"missing artwork"],[missing,"shown missing data"],[review,"shown review"],[list.length,"shown"]]);}
    function renderSortHeaders(){document.querySelectorAll("th.sortable").forEach(th=>{th.classList.toggle("sorted",th.dataset.sort===sortKey); th.classList.toggle("asc",th.dataset.sort===sortKey&&sortDir==="asc"); th.classList.toggle("desc",th.dataset.sort===sortKey&&sortDir==="desc");});}
    function renderSelection(){selectedCountEl.textContent=`${selectedIds.size} selected`; const shown=filtered().map(t=>t.id); selectShownEl.checked=shown.length>0&&shown.every(id=>selectedIds.has(id)); const selectedArt=byId("saveSelectedArt"); if(selectedArt){selectedArt.disabled=selectedIds.size===0; selectedArt.textContent=selectedIds.size?`Replace ${selectedIds.size} Selected`:"Replace Selected Art";}}
    function badges(t){const bits=[]; if(t.missing_fields.length) bits.push(`<span class="pill missing">Missing: ${esc(t.missing_fields.join(", "))}</span>`); if(t.review_flags.length) bits.push(`<span class="pill missing">Review</span>`); return bits.join(" ");}
    function albumSource(){return tracks.filter(t=>(selectedGroup==="All"||groupOf(t)===selectedGroup)&&containsSearch([t.title,t.artist,t.album,t.albumartist,t.date,t.path,t.folder]));}
    function albumList(name){return albumSource().filter(t=>albumOf(t)===name);}
    function albumYears(list){return [...new Set(list.map(t=>(t.date||"").slice(0,4)).filter(Boolean))].sort();}
    function albumFormats(list){return [...new Set(list.map(t=>String(t.format||"").toUpperCase()).filter(Boolean))].sort();}
    function albumArtists(list){return [...new Set(list.map(t=>t.artist).filter(Boolean))].slice(0,4);}
    function albumSizeMb(list){return list.reduce((sum,t)=>sum+(Number(t.size_mb)||0),0).toFixed(1);}
    function albumWarnings(list, formats){const warnings=[]; const missingArt=list.filter(t=>!t.has_artwork).length; const missingDate=list.filter(t=>!t.date).length; const missingTrack=list.filter(t=>!t.tracknumber).length; if(missingArt)warnings.push(`${missingArt} missing art`); if(missingDate)warnings.push(`${missingDate} missing date`); if(missingTrack)warnings.push(`${missingTrack} missing track #`); if(formats.length>1)warnings.push(`Mixed formats: ${formats.join(", ")}`); return warnings;}
    function albumCoverHtml(list){const art=list.find(t=>t.has_artwork); return art?`<img class="albumDetailCover" src="${art.artwork_url}" alt="">`:`<div class="albumDetailCover">No Art</div>`;}
    function albumWarningHtml(warnings){return warnings.length?warnings.map(w=>`<span class="pill missing">${esc(w)}</span>`).join(""):`<span class="pill">Album metadata looks tidy</span>`;}
    function renderAlbumDetail(list){if(selectedAlbum==="All"||!list.length)return ""; const years=albumYears(list), formats=albumFormats(list), artists=albumArtists(list), warnings=albumWarnings(list,formats); const actions=detailActionsHtml([{id:"albumPlay",label:"Play album",icon:"&#9654;",primary:true},{id:"albumShuffle",label:"Shuffle album",icon:"&#8644;"},{id:"albumAddQueue",label:"Add album to queue",icon:"+",add:true},{id:"albumEdit",label:"Edit Album Tracks",text:"Edit Album Tracks"}]); return `<section class="albumDetail visible"><div>${albumCoverHtml(list)}</div><div class="albumDetailInfo"><h2>${esc(selectedAlbum)}</h2><div class="albumDetailMeta">${esc(artists.join(", ")||"Unknown artist")}${years.length?` - ${esc(years.join(", "))}`:""}</div><div class="albumStats"><span class="pill">${countLabel(list.length,"track")}</span><span class="pill">${esc(formats.join(", ")||"Unknown format")}</span><span class="pill">${esc(albumSizeMb(list))} MB</span></div>${actions}<div class="albumWarnings">${albumWarningHtml(warnings)}</div></div></section>`;}
    // Albums sort by their earliest track year, so multi-year albums stay together.
    function albumSortYear(list){const years=list.map(t=>Number(String(t.date||"").slice(0,4))).filter(y=>Number.isFinite(y)&&y>0); return years.length?Math.min(...years):-1;}
    function albumEntries(source){const albums=new Map(); for(const t of source){const name=albumOf(t); if(!albums.has(name)) albums.set(name,[]); albums.get(name).push(t);} return [...albums.entries()].sort((a,b)=>albumSortYear(b[1])-albumSortYear(a[1])||a[0].localeCompare(b[0],undefined,{numeric:true,sensitivity:"base"}));}
    function albumCardHtml(name,list){const art=list.find(t=>t.has_artwork); const years=[...new Set(list.map(t=>(t.date||"").slice(0,4)).filter(Boolean))].sort(); const isPlaying=list.some(t=>t.id===playingId); const actions=cardActionsHtml([{action:"play",valueName:"album",value:name,label:"Play album",icon:"&#9654;",primary:true},{action:"add",valueName:"album",value:name,label:"Add album to queue",icon:"+",add:true},{action:"shuffle",valueName:"album",value:name,label:"Shuffle album",icon:"&#8644;"}]); return `<div class="albumCard ${isPlaying?"playingNow":""}" data-album="${esc(name)}" tabindex="0">${actions}<button class="artButton" data-action="select" data-album="${esc(name)}">${art?`<img class="albumArt" src="${art.artwork_url}" alt="">`:"No Art"}</button><div class="albumName">${esc(name)}</div><div class="albumMeta">${countLabel(list.length,"track")}${years.length?` - ${esc(years.join(", "))}`:""}</div></div>`;}
    function albumSectionName(list){const counts=new Map(); for(const t of list){const name=categoryOf(t); counts.set(name,(counts.get(name)||0)+1);} return [...counts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],undefined,{numeric:true,sensitivity:"base"}))[0]?.[0]||"(root)";}
    function albumSections(ordered){const buckets=new Map(); for(const [name,list] of ordered){const bucket=albumSectionName(list); if(!buckets.has(bucket))buckets.set(bucket,[]); buckets.get(bucket).push([name,list]);} return [...buckets.entries()].sort(musicCategoryCompare);}
    function albumYearName(list){const year=albumSortYear(list); return year>0?String(year):"Unknown Year";}
    function albumYearSections(ordered){const buckets=new Map(); for(const [name,list] of ordered){const bucket=albumYearName(list); if(!buckets.has(bucket))buckets.set(bucket,[]); buckets.get(bucket).push([name,list]);} return [...buckets.entries()].sort((a,b)=>{const ay=Number(a[0]), by=Number(b[0]); if(Number.isFinite(ay)&&Number.isFinite(by))return by-ay; if(a[0]==="Unknown Year")return 1; if(b[0]==="Unknown Year")return -1; return a[0].localeCompare(b[0]);});}
    function albumDisplayEntries(source=albumSource()){const ordered=albumEntries(source); if(albumViewMode==="oldest")return [...ordered].reverse(); if(albumViewMode==="sections"&&!searchQuery())return albumSections(ordered).flatMap(([_title,items])=>items); if(albumViewMode==="years"&&!searchQuery())return albumYearSections(ordered).flatMap(([_title,items])=>items); return ordered;}
    function currentPlaybackList(){if(selectedAlbum!=="All")return albumTrackList(albumList(selectedAlbum)); return albumDisplayEntries(albumSource()).flatMap(([_name,list])=>albumTrackList(list));}
    function renderAlbumSectionGroups(groups){return groups.map(([title,items])=>sectionGroupHtml(title, `${items.length} album${items.length===1?"":"s"}`, items.map(([name,list])=>albumCardHtml(name,list)).join(""))).join("");}
    function renderAlbumSections(ordered){if(searchQuery())return ordered.map(([name,list])=>albumCardHtml(name,list)).join(""); return renderAlbumSectionGroups(albumSections(ordered));}
    function renderAlbumYearSections(ordered){if(searchQuery())return ordered.map(([name,list])=>albumCardHtml(name,list)).join(""); return renderAlbumSectionGroups(albumYearSections(ordered));}
    function sourceAlbumList(source, album){return albumTrackList(source.filter(t=>albumOf(t)===album));}
    function bindAlbumButtons(source){albumGridEl.querySelectorAll("button[data-action]").forEach(btn=>btn.addEventListener("click",(e)=>{e.stopPropagation(); btn.blur(); const album=btn.dataset.album, action=btn.dataset.action; if(action==="select"){openMusicAlbum(album); return;} const list=sourceAlbumList(source,album); if(action==="add"){addToMusicQueue(list); return;} playList(list, action==="shuffle");}));}
    function bindAlbumCards(source){albumGridEl.querySelectorAll(".albumCard").forEach(card=>{card.addEventListener("click",e=>{if(e.target.closest(".cardActions"))return; clearTimeout(albumClickTimer); albumClickTimer=setTimeout(()=>openMusicAlbum(card.dataset.album),220);}); card.addEventListener("keydown",e=>{if(e.key==="Enter")openMusicAlbum(card.dataset.album);}); card.addEventListener("dblclick",e=>{if(e.target.closest(".cardActions"))return; clearTimeout(albumClickTimer); playList(sourceAlbumList(source,card.dataset.album));});});}
    function bindAlbumDetailActions(){const play=byId("albumPlay"), shuffleBtn=byId("albumShuffle"), addBtn=byId("albumAddQueue"), edit=byId("albumEdit"); if(play)on(play,"click",()=>playList(filtered())); if(shuffleBtn)on(shuffleBtn,"click",()=>playList(filtered(),true)); if(addBtn)on(addBtn,"click",()=>addToMusicQueue(filtered())); if(edit)on(edit,"click",()=>enterEditMode());}
    function renderAlbums(){const source=albumSource(); const ordered=albumEntries(source); const displayOrdered=albumDisplayEntries(source); const selectedList=selectedAlbum==="All"?[]:albumList(selectedAlbum); const albumOpen=selectedAlbum!=="All"; document.body.classList.toggle("albumSelected",albumOpen); const backToAlbums=byId("showAllAlbums"); if(backToAlbums)backToAlbums.hidden=!albumOpen; if(albumViewModeEl)albumViewModeEl.value=albumViewMode; albumGridEl.classList.toggle("albumFocus",albumOpen); albumGridEl.innerHTML=albumOpen?renderAlbumDetail(selectedList):(albumViewMode==="sections"?renderAlbumSections(ordered):albumViewMode==="years"?renderAlbumYearSections(ordered):displayOrdered.map(([name,list])=>albumCardHtml(name,list)).join("")); bindAlbumButtons(source); bindAlbumCards(source); bindAlbumDetailActions();}
    function renderRows(){const list=filtered(); const rowDates=list.map(t=>String(t.date||"").trim()); const albumSingleDate=selectedAlbum!=="All"&&rowDates.length>0&&rowDates.every(Boolean)&&new Set(rowDates).size===1; document.body.classList.toggle("albumSingleDate",albumSingleDate); viewTitleEl.textContent = selectedAlbum!=="All" ? (appMode==="listen"?"Album":selectedAlbum) : selectedGroup; renderStats(list); renderSortHeaders(); let lastAlbum=null; rowsEl.innerHTML=list.map(t=>{const album=albumOf(t); const divider=album!==lastAlbum?`<tr class="mobileAlbumRow"><td colspan="8">${esc(album)}</td></tr>`:""; lastAlbum=album; const trackNo=String(t.tracknumber||"").split("/")[0]; return `${divider}<tr data-id="${t.id}" class="${t.id===selectedId?"selected":""} ${t.id===playingId?"playingNow":""}"><td class="checkCell"><input class="rowCheck" type="checkbox" data-id="${t.id}" ${selectedIds.has(t.id)?"checked":""}></td><td>${t.has_artwork?`<img class="coverThumb" src="${t.artwork_url}" alt="">`:`<span class="noArt">?</span>`}</td><td class="titleCell"><span class="trackNo">${esc(trackNo||"")}</span>${esc(t.title)}<br><span class="rowBadges"><span class="pill ${t.has_artwork?"":"missing"}">${t.has_artwork?"Art":"No art"}</span> ${badges(t)}</span></td><td class="artistCell">${esc(t.artist)}</td><td class="albumCell">${esc(t.album)}</td><td>${esc(t.date)}</td><td class="pathCell">${esc(t.path)}</td><td class="rowActions"><button class="secondary playSong iconControl" data-id="${t.id}" type="button" title="Play song" aria-label="Play song">&#9654;</button><button class="secondary addSongQueue iconControl addIcon" data-id="${t.id}" type="button" title="Add to queue" aria-label="Add to queue">+</button></td></tr>`;}).join(""); rowsEl.querySelectorAll("tr[data-id]").forEach(r=>r.addEventListener("click",e=>{if(e.target.closest(".rowActions")||e.target.classList.contains("rowCheck"))return; const id=Number(r.dataset.id); if(appMode==="listen") playSingleTrack(id); else selectTrack(id);})); rowsEl.querySelectorAll(".playSong").forEach(btn=>btn.addEventListener("click",e=>{e.stopPropagation(); playSingleTrack(Number(btn.dataset.id));})); rowsEl.querySelectorAll(".addSongQueue").forEach(btn=>btn.addEventListener("click",e=>{e.stopPropagation(); const t=tracks.find(x=>x.id===Number(btn.dataset.id)); if(t)addToMusicQueue([t]);})); rowsEl.querySelectorAll(".rowCheck").forEach(c=>c.addEventListener("change",()=>{const id=Number(c.dataset.id); c.checked?selectedIds.add(id):selectedIds.delete(id); renderSelection();})); renderSelection();}
    function updatePlayingHighlights(){const t=tracks.find(x=>x.id===playingId); rowsEl.querySelectorAll("tr[data-id]").forEach(row=>row.classList.toggle("playingNow",Number(row.dataset.id)===playingId)); albumGridEl.querySelectorAll(".albumCard").forEach(card=>card.classList.toggle("playingNow",!!t&&card.dataset.album===albumOf(t)));}
    function renderAll(){renderGroups(); renderAlbums(); renderRows();}
    // Video browsing treats folders like albums. Cover images come from cover.jpg/png/webp.
    function yearFromText(text){const years=[...String(text||"").matchAll(/(?:19|20)\d{2}/g)].map(m=>Number(m[0])).filter(Boolean); return years.length?Math.max(...years):0;}
    function videoYear(v){return yearFromText(`${v.path} ${v.folder} ${v.title}`);}
    function videoFileCompare(a,b){return String(a.path||a.title||"").localeCompare(String(b.path||b.title||""),undefined,{numeric:true,sensitivity:"base"});}
    function videoCompare(a,b){const ay=videoYear(a), by=videoYear(b); if(ay!==by)return videoSort==="oldest"?ay-by:by-ay; return videoFileCompare(a,b);}
    function videoFiltered(){return videos.filter(v=>{const matchesGroup=selectedVideoGroup==="All" || (selectedVideoAsFolder?v.folder===selectedVideoGroup:(v.category===selectedVideoGroup || v.folder===selectedVideoGroup)); if(!matchesGroup)return false; return containsSearch([v.title,v.folder,v.category,v.path,v.format]);}).sort(videoFileCompare);}
    function isVideoCategory(group){return !selectedVideoAsFolder&&group!=="All"&&videos.some(v=>v.category===group);}
    function videoCategoryRank(name){const label=String(name||"").toLowerCase(); if(label==="all")return -100; if(label.includes("taeyeon concert"))return 0; if(label.includes("taeyeon"))return 1; if(label.includes("girls")||label.includes("snsd"))return 20; if(label.includes("misc"))return 80; return 50;}
    function videoNameCompare(a,b){const ar=videoCategoryRank(a), br=videoCategoryRank(b); if(ar!==br)return ar-br; return String(a).localeCompare(String(b),undefined,{numeric:true,sensitivity:"base"});}
    function videoFolderSort(a,b){const ar=videoCategoryRank(a[0]), br=videoCategoryRank(b[0]); if(ar!==br)return ar-br; const ay=Math.max(...a[1].map(videoYear).filter(Boolean),0), by=Math.max(...b[1].map(videoYear).filter(Boolean),0); if(ay!==by)return videoSort==="oldest"?ay-by:by-ay; return a[0].localeCompare(b[0],undefined,{numeric:true,sensitivity:"base"});}
    function videoFolderGroups(category){const groups=new Map(); const source=category==="All"?videos:videos.filter(v=>v.category===category); for(const v of source){const name=v.folder||"(root)"; if(!groups.has(name))groups.set(name,[]); groups.get(name).push(v);} return [...groups.entries()].filter(([name])=>name!=="(root)").sort(videoFolderSort);}
    function videoFolderActionsHtml(folder){return cardActionsHtml([{action:"play",actionAttr:"folder-action",valueName:"folder",value:folder,label:"Play folder",icon:"&#9654;",primary:true},{action:"add",actionAttr:"folder-action",valueName:"folder",value:folder,label:"Add folder to queue",icon:"+",add:true},{action:"shuffle",actionAttr:"folder-action",valueName:"folder",value:folder,label:"Shuffle folder",icon:"&#8644;"}]);}
    function videoActionsHtml(id){return cardActionsHtml([{action:"play",actionAttr:"video-action",valueName:"id",value:id,label:"Play video",icon:"&#9654;",primary:true},{action:"add",actionAttr:"video-action",valueName:"id",value:id,label:"Add video to queue",icon:"+",add:true}]);}
    function videoGroupActionsHtml(group){return cardActionsHtml([{action:"play",actionAttr:"video-group-action",valueName:"group",value:group,label:"Play section",icon:"&#9654;",primary:true},{action:"add",actionAttr:"video-group-action",valueName:"group",value:group,label:"Add section to queue",icon:"+",add:true},{action:"shuffle",actionAttr:"video-group-action",valueName:"group",value:group,label:"Shuffle section",icon:"&#8644;"}]);}
    function setVideoGridMode(mode){videoGridEl.classList.toggle("videoFileMode",mode==="files"); videoGridEl.classList.toggle("videoCollectionMode",mode==="collections"); if(mode!=="files")videoGridEl.classList.remove("videoFolderOpen");}
    function videoFolderCoverHtml(list, className="videoThumb"){const cover=list.find(v=>v.has_folder_cover); return `<div class="${className} videoCoverThumb">${cover?`<img src="${cover.folder_cover_url}" alt="">`:""}</div>`;}
    function videoCollectionCardHtml(name,list,kind="folder"){const years=[...new Set(list.map(videoYear).filter(Boolean))].sort((a,b)=>b-a); const actions=kind==="section"?videoGroupActionsHtml(name):videoFolderActionsHtml(name); return `<div class="videoCard videoFolderCard" data-${kind}="${esc(name)}" title="${esc(name)}" role="button" tabindex="0">${actions}${videoFolderCoverHtml(list)}<div class="videoName">${esc(groupLabel(name))}</div><div class="videoMeta">${list.length} video${list.length===1?"":"s"}${years.length?` - ${esc(years.slice(0,3).join(", "))}`:""}</div></div>`;}
    function videoFolderDetailHtml(name,list){const years=[...new Set(list.map(videoYear).filter(Boolean))].sort((a,b)=>b-a); const size=list.reduce((sum,v)=>sum+(Number(v.size_mb)||0),0).toFixed(1); const actions=detailActionsHtml([{id:"videoFolderPlay",label:"Play folder",icon:"&#9654;",primary:true},{id:"videoFolderShuffle",label:"Shuffle folder",icon:"&#8644;"},{id:"videoFolderAdd",label:"Add folder to queue",icon:"+",add:true}]); return `<section class="videoAlbumDetail noCover"><button id="videoBackToAlbums" class="secondary iconControl albumClose" title="Back to video albums" aria-label="Back to video albums">&#10005;</button><div class="videoAlbumInfo"><h2>${esc(groupLabel(name))}</h2><div class="videoAlbumMeta">${list.length} video${list.length===1?"":"s"}${years.length?` - ${esc(years.slice(0,3).join(", "))}`:""} - ${esc(size)} MB</div>${actions}</div></section>`;}
    function videoSectionGroups(){const groups=new Map(); for(const v of videos){const name=v.category||"(root)"; if(!groups.has(name))groups.set(name,[]); groups.get(name).push(v);} return [...groups.entries()].sort(videoFolderSort);}
    function bindVideoFolderCards(){videoGridEl.querySelectorAll("button[data-folder-action]").forEach(btn=>btn.addEventListener("click",e=>{e.stopPropagation(); const folder=btn.dataset.folder, action=btn.dataset.folderAction; const list=videos.filter(v=>v.folder===folder).sort(videoFileCompare); if(action==="add"){addToVideoQueue(list); return;} playVideoList(list, action==="shuffle");})); videoGridEl.querySelectorAll(".videoFolderCard[data-folder]").forEach(card=>{card.addEventListener("click",e=>{if(e.target.closest(".cardActions"))return; openVideoFolder(card.dataset.folder);}); card.addEventListener("keydown",e=>{if(e.key==="Enter")openVideoFolder(card.dataset.folder);});});}
    function bindVideoGroupActions(){videoGridEl.querySelectorAll("button[data-video-group-action]").forEach(btn=>btn.addEventListener("click",e=>{e.stopPropagation(); const group=btn.dataset.group, action=btn.dataset.videoGroupAction; const list=videos.filter(v=>v.category===group).sort(videoFileCompare); if(action==="add"){addToVideoQueue(list); return;} playVideoList(list, action==="shuffle");})); videoGridEl.querySelectorAll(".videoFolderCard[data-section]").forEach(card=>{card.addEventListener("click",e=>{if(e.target.closest(".cardActions"))return; openVideoGroup(card.dataset.section);}); card.addEventListener("keydown",e=>{if(e.key==="Enter")openVideoGroup(card.dataset.section);});});}
    function renderVideoSections(){if(selectedVideoGroup!=="All"||searchQuery()||videoSort!=="sections")return false; setVideoGridMode("collections"); const sections=videoSectionGroups(); const list=videoFiltered(); videoViewTitleEl.textContent="Video Sections"; renderVideoStats(list); videoGridEl.innerHTML=sections.map(([sectionName,items])=>{const folders=videoFolderGroups(sectionName); const cards=folders.length?folders.map(([folder,folderList])=>videoCollectionCardHtml(folder,folderList,"folder")).join(""):videoCollectionCardHtml(sectionName,items,"section"); return sectionGroupHtml(sectionName, `${items.length} video${items.length===1?"":"s"}`, cards, "videoHomeSection", "videoSectionGrid");}).join(""); bindVideoFolderCards(); bindVideoGroupActions(); return true;}
    function renderVideoFolderCards(category){if(searchQuery())return false; const folders=videoFolderGroups(category); if(!folders.length)return false; setVideoGridMode("collections"); const allList=videoFiltered(); videoViewTitleEl.textContent=category==="All"?"Video Albums":groupLabel(category); renderVideoStats(allList); videoGridEl.innerHTML=folders.map(([folder,list])=>videoCollectionCardHtml(folder,list,"folder")).join(""); bindVideoFolderCards(); return true;}
    function renderVideoGroups(){
      const counts = new Map();
      counts.set("All", videos.length);
      for(const v of videos){
        const category = v.category || "(root)";
        counts.set(category, (counts.get(category) || 0) + 1);
      }
      if(!counts.has(selectedVideoGroup) && !isVideoFolder(selectedVideoGroup)) selectedVideoGroup = "All";
      const groups = [...counts.entries()].sort((a,b)=>videoNameCompare(a[0],b[0]));
      renderBrowseItems(groups, name=>!selectedVideoAsFolder&&name===selectedVideoGroup, openVideoGroup);
    }
    function renderVideoStats(list){const playable=videos.filter(v=>v.browser_friendly).length; const shownPlayable=list.filter(v=>v.browser_friendly).length; renderStatsPills([[videos.length,"videos"],[playable,"browser-friendly"],[videos.length-playable,"may need conversion"],[list.length,"shown"],[shownPlayable,"shown playable"]]);}
    // Health is only for real cleanup issues, not personal preference warnings.
    function renderHealthStats(summary){renderStatsPills([[summary.tracks,"tracks"],[summary.albums,"albums"],[summary.missingArt,"tracks missing art"],[summary.missingDate,"missing dates"],[summary.review,"review flags"],[summary.albumsMissingArt,"albums missing some art"]]);}
    function renderInterviewStats(){renderStatsPills([[interviews.length,"interviews"],[new Set(interviews.map(i=>i.year).filter(Boolean)).size,"years"]]);}
    function groupByAlbum(){const albums=new Map(); for(const t of tracks){const key=`${albumOf(t)}||${t.albumartist||t.artist||""}`; if(!albums.has(key))albums.set(key,{name:albumOf(t), artist:t.albumartist||t.artist||"", tracks:[]}); albums.get(key).tracks.push(t);} return [...albums.values()].sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:"base"}));}
    function healthItem(title,sub,action,label="Review"){return `<div class="healthItem"><div><div class="healthItemTitle">${esc(title)}</div><div class="healthItemSub">${esc(sub)}</div></div><button class="secondary" data-health-action="${esc(action)}">${esc(label)}</button></div>`;}
    function healthTrackList(list,empty){return list.length?list.slice(0,10).map(t=>healthItem(t.title,`${t.artist||"Unknown artist"} - ${t.album||"No album"}`,`track:${t.id}`)).join(""):`<div class="healthItem"><div><div class="healthItemTitle">${esc(empty)}</div><div class="healthItemSub">Nice and tidy here.</div></div></div>`;}
    function renderHealth(){const albums=groupByAlbum(); const missingArt=tracks.filter(t=>!t.has_artwork); const missingDate=tracks.filter(t=>!t.date); const needsReview=tracks.filter(t=>(t.review_flags||[]).length); const nonEnglish=tracks.filter(t=>(t.review_flags||[]).includes("non-English title")); const albumsMissingArt=albums.map(a=>{const missing=a.tracks.filter(t=>!t.has_artwork); return {...a, missingArt:missing.length};}).filter(a=>a.missingArt>0); const summary={tracks:tracks.length, albums:albums.length, missingArt:missingArt.length, missingDate:missingDate.length, review:needsReview.length, albumsMissingArt:albumsMissingArt.length}; renderHealthStats(summary); healthPanelEl.innerHTML=`<div class="healthHero"><div><h2>Library Health</h2><p>Cleanup overview for actual library problems. Review buttons open Edit Mode on the right album or track.</p></div><button id="healthRefresh" class="secondary">Refresh</button></div><div class="healthGrid"><div class="healthCard"><div class="healthNumber">${summary.missingArt}</div><div class="healthLabel">tracks missing artwork</div></div><div class="healthCard"><div class="healthNumber">${summary.missingDate}</div><div class="healthLabel">tracks missing dates</div></div><div class="healthCard"><div class="healthNumber">${summary.review}</div><div class="healthLabel">tracks needing review</div></div><div class="healthCard"><div class="healthNumber">${summary.albumsMissingArt}</div><div class="healthLabel">albums missing some artwork</div></div><div class="healthCard"><div class="healthNumber">${nonEnglish.length}</div><div class="healthLabel">non-English title flags</div></div></div><div class="healthSections"><section class="healthSection"><h3>Missing Artwork</h3><div class="healthList">${healthTrackList(missingArt,"No missing artwork found")}</div></section><section class="healthSection"><h3>Albums Missing Some Artwork</h3><div class="healthList">${albumsMissingArt.slice(0,12).map(a=>healthItem(a.name,`${a.missingArt} of ${a.tracks.length} tracks missing embedded artwork`, `album:${a.name}`,"Review")).join("")||`<div class="healthItem"><div><div class="healthItemTitle">No albums with missing artwork found</div><div class="healthItemSub">Every track appears to have embedded artwork.</div></div></div>`}</div></section><section class="healthSection"><h3>Missing Dates</h3><div class="healthList">${healthTrackList(missingDate,"No missing dates found")}</div></section><section class="healthSection"><h3>Needs Review</h3><div class="healthList">${healthTrackList(needsReview,"No review flags found")}</div></section><section class="healthSection"><h3>Non-English Title Flags</h3><div class="healthList">${healthTrackList(nonEnglish,"No non-English title flags found")}</div></section></div>`; on(byId("healthRefresh"),"click",()=>loadTracks(true,selectedId)); healthPanelEl.querySelectorAll("button[data-health-action]").forEach(btn=>on(btn,"click",()=>openHealthAction(btn.dataset.healthAction)));}
    async function openMusicReview(albumName, trackId=null){if(!(await unlockEditMode()))return; selectedGroup="All"; selectedAlbum=albumName||"All"; searchEl.value=""; musicFilterEl.value="all"; setAppMode("edit"); setMediaType("music"); if(trackId!==null){selectTrack(trackId); const row=rowsEl.querySelector(`tr[data-id="${trackId}"]`); if(row)row.scrollIntoView({block:"center",behavior:"smooth"});}else{albumGridEl.scrollIntoView({block:"start",behavior:"smooth"});}}
    function openHealthAction(action){if(action.startsWith("track:")){const id=Number(action.slice(6)); const t=tracks.find(x=>x.id===id); if(t)openMusicReview(albumOf(t),id); return;} if(action.startsWith("album:")){openMusicReview(action.slice(6)); return;}}
    // Interviews are plain text files, grouped by their cleaned source/title.
    function renderInterviews(){renderInterviewStats(); const ordered=[...interviews].filter(i=>containsSearch([i.source,i.year,i.filename,i.content])).sort((a,b)=>(Number(b.year)||0)-(Number(a.year)||0)||a.source.localeCompare(b.source,undefined,{numeric:true,sensitivity:"base"})); if((selectedInterviewId===null||!ordered.some(i=>i.id===selectedInterviewId))&&ordered.length)selectedInterviewId=ordered[0].id; interviewItemsEl.innerHTML=ordered.length?ordered.map(i=>`<button class="interviewItem ${i.id===selectedInterviewId?"active":""}" data-id="${i.id}" title="${esc(i.filename)}"><span class="interviewItemTitle">${esc(i.source)}</span><span class="interviewItemSub">${esc(i.year||"Unknown year")}</span></button>`).join(""):`<div class="interviewItem"><span class="interviewItemTitle">No interviews found</span><span class="interviewItemSub">Try a different search.</span></div>`; interviewItemsEl.querySelectorAll(".interviewItem[data-id]").forEach(btn=>btn.addEventListener("click",()=>{selectedInterviewId=Number(btn.dataset.id); setOpen(interviewListEl,false); renderInterviews();})); const current=interviews.find(i=>i.id===selectedInterviewId&&ordered.some(match=>match.id===i.id))||ordered[0]; if(!current){interviewReaderEl.innerHTML=`<h2>Interviews</h2><div class="interviewReaderMeta">No matching text files found.</div>`; return;} interviewReaderEl.innerHTML=`<h2>${esc(current.source)}</h2><div class="interviewReaderMeta">${esc(current.year||"Unknown year")}</div><div class="interviewText">${esc(current.content)}</div>`;}
    function videoThumb(v){if(v.has_thumbnail)return `<img src="${v.thumbnail_url}" alt="">`; return v.browser_friendly?"Preview":esc(String(v.format||"video").toUpperCase());}
    function isVideoFolder(group){return group!=="All"&&(selectedVideoAsFolder||!isVideoCategory(group))&&videos.some(v=>v.folder===group);}
    function bindVideoFolderDetail(list){const play=byId("videoFolderPlay"), shuffleBtn=byId("videoFolderShuffle"), add=byId("videoFolderAdd"), back=byId("videoBackToAlbums"); if(play)on(play,"click",()=>playVideoList(list)); if(shuffleBtn)on(shuffleBtn,"click",()=>playVideoList(list,true)); if(add)on(add,"click",()=>addToVideoQueue(list)); if(back)on(back,"click",closeVideoFolder);}
    function renderVideos(){if(renderVideoSections())return; if((selectedVideoGroup==="All"||isVideoCategory(selectedVideoGroup))&&renderVideoFolderCards(selectedVideoGroup))return; setVideoGridMode("files"); const list=videoFiltered(); const folderOpen=isVideoFolder(selectedVideoGroup); videoGridEl.classList.toggle("videoFolderOpen",folderOpen); videoViewTitleEl.textContent=selectedVideoGroup==="All"?"All Videos":groupLabel(selectedVideoGroup); renderVideoStats(list); const detail=folderOpen?videoFolderDetailHtml(selectedVideoGroup,list):""; videoGridEl.innerHTML=detail+(list.length?list.map(v=>`<div class="videoCard ${v.id===selectedVideoId?"active":""}" data-id="${v.id}" title="${esc(v.path)}" role="button" tabindex="0">${videoActionsHtml(v.id)}<div class="videoName">${esc(v.title)}</div><div class="videoMeta">${videoMetaSummary(v)}</div>${v.browser_friendly?"":`<div class="videoWarn">Browser may not play this format</div>`}</div>`).join(""):`<div class="videoCard"><div class="videoName">Nothing matched</div><div class="videoMeta">Try a different folder.</div></div>`); if(folderOpen)bindVideoFolderDetail(list); videoGridEl.querySelectorAll("button[data-video-action]").forEach(btn=>btn.addEventListener("click",e=>{e.stopPropagation(); const id=Number(btn.dataset.id), action=btn.dataset.videoAction; if(action==="add"){const v=videos.find(x=>x.id===id); if(v)addToVideoQueue([v]); return;} playVideoList(list,false,id);})); videoGridEl.querySelectorAll(".videoCard[data-id]").forEach(card=>{card.addEventListener("click",e=>{if(e.target.closest(".cardActions"))return; playVideoList(list,false,Number(card.dataset.id));}); card.addEventListener("keydown",e=>{if(e.key==="Enter")playVideoList(list,false,Number(card.dataset.id));});});}
    function renderVideoAll(){renderVideoGroups(); renderVideos();}
    function playVideoList(list, randomize=false, startId=null){const playable=randomize?shuffle(list):[...list]; if(!playable.length)return; videoQueue=playable.map(v=>v.id); videoQueueIndex=startId===null?0:Math.max(0,videoQueue.indexOf(startId)); playVideoQueueIndex(videoQueueIndex);}
    function addToVideoQueue(list){const ids=list.map(v=>v.id).filter(id=>!videoQueue.includes(id)); if(!ids.length)return; const wasEmpty=videoQueue.length===0; videoQueue.push(...ids); showQueueToast(ids.length===1?"Added video to queue":`Added ${ids.length} videos to queue`); pulseQueueButton(videoQueueToggleEl); if(wasEmpty){videoQueueIndex=0; playVideoQueueIndex(0);} else {updateVideoQueueLabel(); renderVideoQueue();}}
    function playVideoQueueIndex(index){if(index<0||index>=videoQueue.length)return; videoQueueIndex=index; selectVideo(videoQueue[videoQueueIndex]); renderVideoQueue();}
    function selectVideo(id){const v=videos.find(x=>x.id===id); if(!v)return; player.pause(); selectedVideoId=id; videoPlayerEl.src=v.video_url; videoPlayerEl.play(); videoTitleEl.textContent=v.title; videoMetaEl.textContent=`${videoMetaSummary(v)}${v.browser_friendly?"":" - may need conversion for browser playback"}`; updateVideoQueueLabel(); renderVideos();}
    function removeVideoQueueIndex(index){if(index<0||index>=videoQueue.length)return; videoQueue.splice(index,1); if(index<videoQueueIndex)videoQueueIndex--; else if(index===videoQueueIndex){if(videoQueue.length){videoQueueIndex=Math.min(index,videoQueue.length-1); playVideoQueueIndex(videoQueueIndex);}else{videoQueueIndex=-1; videoPlayerEl.pause(); videoPlayerEl.removeAttribute("src"); selectedVideoId=null; videoTitleEl.textContent="Select a video"; videoMetaEl.textContent="Videos play locally from media\\\\Video."; renderVideos();}} updateVideoQueueLabel(); renderVideoQueue();}
    function moveVideoQueueItem(fromIndex,toIndex){if(fromIndex===toIndex||fromIndex<0||toIndex<0||fromIndex>=videoQueue.length||toIndex>=videoQueue.length)return; const current=videoQueue[videoQueueIndex]; const [item]=videoQueue.splice(fromIndex,1); videoQueue.splice(toIndex,0,item); videoQueueIndex=current===undefined?-1:videoQueue.indexOf(current); updateVideoQueueLabel(); renderVideoQueue();}
    function updateVideoQueueLabel(){videoQueueToggleEl.innerHTML=`${buttonIcon("queue")}<span>${videoQueue.length}</span>`;}
    function videoQueueArtHtml(v){
      return v.has_folder_cover
        ? `<img src="${v.folder_cover_url}" alt="">`
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
      videoQueueListEl.innerHTML = videoQueue.length
        ? videoQueue.map((id,index)=>{
            const v = videos.find(x=>x.id===id);
            if(!v) return "";
            return queueItemHtml({
              index,
              active:index===videoQueueIndex,
              draggable:true,
              artworkHtml:videoQueueArtHtml(v),
              title:v.title,
              subtitle:videoQueueSubtitle(v),
            });
          }).join("")
        : emptyQueueHtml("Video queue is empty", "Use Play Shown or click a video.");
      bindQueueList(videoQueueListEl, playVideoQueueIndex, removeVideoQueueIndex);
      bindQueueDrag(videoQueueListEl, moveVideoQueueItem);
    }
    function isIOSDevice(){return /iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);}
    function visualizerAllowed(){return !isIOSDevice();}
    // Audio visualizer. iOS disables this so lock-screen playback keeps working.
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
    function drawBars(canvas, count){const state=prepVisualizer(canvas); if(!state)return; const {ctx,dpr,width,height}=state; const gap=Math.max(2*dpr, width/(count*5)); const barWidth=(width-gap*(count-1))/count; for(let i=0;i<count;i++){const start=Math.floor((i/count)*visualizerData.length*.72); const end=Math.max(start+1,Math.floor(((i+1)/count)*visualizerData.length*.72)); const value=visualizerValue(start,end); const barHeight=Math.max(3*dpr, value*height*.92); const x=i*(barWidth+gap); const y=height-barHeight; const gradient=ctx.createLinearGradient(0,y,0,height); gradient.addColorStop(0,"#8db7ff"); gradient.addColorStop(1,"#3f6fd8"); ctx.fillStyle=gradient; fillRounded(ctx,x,y,barWidth,barHeight,Math.min(barWidth/2,4*dpr));}}
    function drawWave(canvas, count){const state=prepVisualizer(canvas); if(!state)return; const {ctx,dpr,width,height}=state; const mid=height*.55; ctx.lineWidth=3*dpr; ctx.lineCap="round"; const gradient=ctx.createLinearGradient(0,0,width,0); gradient.addColorStop(0,"#3f6fd8"); gradient.addColorStop(.5,"#9cc4ff"); gradient.addColorStop(1,"#3f6fd8"); ctx.strokeStyle=gradient; ctx.beginPath(); for(let i=0;i<count;i++){const start=Math.floor((i/count)*visualizerData.length*.72); const end=Math.max(start+1,Math.floor(((i+1)/count)*visualizerData.length*.72)); const value=visualizerValue(start,end); const x=(i/(count-1))*width; const y=mid-Math.sin(i*.55+performance.now()/260)*value*height*.32-value*height*.22; if(i===0)ctx.moveTo(x,y); else ctx.lineTo(x,y);} ctx.stroke();}
    function drawDots(canvas, count){const state=prepVisualizer(canvas); if(!state)return; const {ctx,dpr,width,height}=state; const cols=count, rows=4, gap=width/(cols+1); for(let i=0;i<cols;i++){const start=Math.floor((i/cols)*visualizerData.length*.72); const end=Math.max(start+1,Math.floor(((i+1)/cols)*visualizerData.length*.72)); const value=visualizerValue(start,end); const lit=Math.max(1,Math.round(value*rows)); for(let row=0;row<rows;row++){const alpha=row<lit?.35+value*.65:.08; ctx.fillStyle=`rgba(141,183,255,${alpha})`; ctx.beginPath(); ctx.arc((i+1)*gap,height-(row+1)*(height/(rows+1)),Math.max(2.5*dpr,4*dpr*value),0,Math.PI*2); ctx.fill();}}}
    function drawMirror(canvas, count){const state=prepVisualizer(canvas); if(!state)return; const {ctx,dpr,width,height}=state; const mid=height*.5, gap=Math.max(2*dpr,width/(count*5)), barWidth=(width-gap*(count-1))/count; for(let i=0;i<count;i++){const start=Math.floor((i/count)*visualizerData.length*.72); const end=Math.max(start+1,Math.floor(((i+1)/count)*visualizerData.length*.72)); const value=visualizerValue(start,end); const barHeight=Math.max(2*dpr,value*height*.45); const x=i*(barWidth+gap); const gradient=ctx.createLinearGradient(0,mid-barHeight,0,mid+barHeight); gradient.addColorStop(0,"rgba(156,196,255,.95)"); gradient.addColorStop(.5,"rgba(63,111,216,.45)"); gradient.addColorStop(1,"rgba(156,196,255,.95)"); ctx.fillStyle=gradient; fillRounded(ctx,x,mid-barHeight,barWidth,barHeight*2,Math.min(barWidth/2,4*dpr));}}
    function drawRing(canvas, count){const state=prepVisualizer(canvas); if(!state)return; const {ctx,dpr,width,height}=state; const cx=width/2, cy=height/2, base=Math.min(width,height)*.18; let total=0; for(let i=0;i<visualizerData.length*.72;i++)total+=visualizerData[i]; const avg=total/(visualizerData.length*.72)/255; ctx.lineCap="round"; for(let i=0;i<count;i++){const start=Math.floor((i/count)*visualizerData.length*.72); const end=Math.max(start+1,Math.floor(((i+1)/count)*visualizerData.length*.72)); const value=visualizerValue(start,end); const angle=(i/count)*Math.PI*2+performance.now()/2400; const inner=base+avg*height*.12; const outer=inner+value*height*.26; ctx.strokeStyle=`rgba(141,183,255,${.22+value*.72})`; ctx.lineWidth=Math.max(2*dpr,3*dpr*value); ctx.beginPath(); ctx.moveTo(cx+Math.cos(angle)*inner,cy+Math.sin(angle)*inner); ctx.lineTo(cx+Math.cos(angle)*outer,cy+Math.sin(angle)*outer); ctx.stroke();} ctx.strokeStyle="rgba(63,111,216,.28)"; ctx.lineWidth=1*dpr; ctx.beginPath(); ctx.arc(cx,cy,base+avg*height*.12,0,Math.PI*2); ctx.stroke();}
    function drawMountain(canvas, count){const state=prepVisualizer(canvas); if(!state)return; const {ctx,width,height}=state; const ground=height*.9; const gradient=ctx.createLinearGradient(0,height*.12,0,ground); gradient.addColorStop(0,"rgba(156,196,255,.55)"); gradient.addColorStop(.55,"rgba(63,111,216,.26)"); gradient.addColorStop(1,"rgba(63,111,216,.02)"); ctx.fillStyle=gradient; ctx.beginPath(); ctx.moveTo(0,ground); for(let i=0;i<count;i++){const start=Math.floor((i/count)*visualizerData.length*.72); const end=Math.max(start+1,Math.floor(((i+1)/count)*visualizerData.length*.72)); const value=visualizerValue(start,end); const x=(i/(count-1))*width; const y=ground-value*height*.78-Math.sin(i*.5+performance.now()/500)*height*.035; ctx.lineTo(x,y);} ctx.lineTo(width,ground); ctx.closePath(); ctx.fill();}
    function drawOrbit(canvas, count){const state=prepVisualizer(canvas); if(!state)return; const {ctx,dpr,width,height}=state; const cx=width/2, cy=height/2; let bass=0; for(let i=0;i<10&&i<visualizerData.length;i++)bass+=visualizerData[i]; bass=bass/Math.min(10,visualizerData.length)/255; const base=Math.min(width,height)*(.18+bass*.18), time=performance.now()/900; for(let i=0;i<count;i++){const start=Math.floor((i/count)*visualizerData.length*.72); const end=Math.max(start+1,Math.floor(((i+1)/count)*visualizerData.length*.72)); const value=visualizerValue(start,end); const angle=(i/count)*Math.PI*2+time*(i%2?1:-.7); const radius=base+value*height*.23; ctx.fillStyle=`rgba(141,183,255,${.18+value*.65})`; ctx.beginPath(); ctx.arc(cx+Math.cos(angle)*radius,cy+Math.sin(angle)*radius,Math.max(2*dpr,5*dpr*value),0,Math.PI*2); ctx.fill();}}
    function drawRain(canvas, count){const state=prepVisualizer(canvas); if(!state)return; const {ctx,dpr,width,height}=state; const time=performance.now()/38; for(let i=0;i<count;i++){const start=Math.floor((i/count)*visualizerData.length*.72); const end=Math.max(start+1,Math.floor(((i+1)/count)*visualizerData.length*.72)); const value=visualizerValue(start,end); const x=(i+.5)*(width/count); const drops=Math.max(1,Math.round(value*4)); for(let d=0;d<drops;d++){const y=(time*(.45+value)+i*17+d*29)%height; ctx.fillStyle=`rgba(141,183,255,${.12+value*.55})`; fillRounded(ctx,x-1.5*dpr,y,3*dpr,Math.max(5*dpr,18*dpr*value),2*dpr);}}}
    function drawVisualizers(){visualizerFrame=null; if(player.paused||player.ended){stopVisualizer(); return;} const big=byId("nowPlayingVisualizer"); if(big){if(visualizerMode==="wave")drawWave(big,44); else if(visualizerMode==="dots")drawDots(big,32); else if(visualizerMode==="mirror")drawMirror(big,32); else if(visualizerMode==="ring")drawRing(big,48); else if(visualizerMode==="mountain")drawMountain(big,48); else if(visualizerMode==="orbit")drawOrbit(big,28); else if(visualizerMode==="rain")drawRain(big,40); else drawBars(big,32);} visualizerFrame=requestAnimationFrame(drawVisualizers);}
    // Edit mode writes directly to MP3/FLAC files, so keep these handlers boring.
    function field(name,label,t){return `<label>${label}<input name="${name}" value="${esc(t[name]||"")}"></label>`;}
    function artworkPanel(t){const supported=["mp3","flac"].includes(String(t.format||"").toLowerCase()); return `<div class="artworkPanel"><strong>Artwork</strong><input id="artworkFile" type="file" accept="image/jpeg,image/png,image/webp" ${supported?"":"disabled"}><img id="artworkPreview" class="artworkPreview" alt=""><div class="actions artworkActions"><button type="button" id="saveSongArt" ${supported?"":"disabled"}>Replace Song Art</button><button type="button" class="secondary" id="saveAlbumArt" ${supported?"":"disabled"}>Replace Album Art</button></div><div class="message" id="artworkMsg">${supported?"MP3/FLAC only. Changes write directly to the file. Album art uses the selected song's album tag.":"Artwork editing is only enabled for MP3 and FLAC."}</div></div>`;}
    function selectTrack(id){selectedId=id; const t=tracks.find(x=>x.id===id); if(!t)return; detailEl.innerHTML=`${t.has_artwork?`<img class="bigCover" src="${t.artwork_url}" alt="">`:`<div class="bigCover emptyCover">No Artwork</div>`}<div class="detailTitle">${esc(t.title)}</div><div class="detailSub">${esc(t.artist||"Unknown artist")} - ${esc(t.album||"No album")} ${t.date?`(${esc(t.date)})`:""}</div>${artworkPanel(t)}<form id="editForm">${field("title","Title",t)}${field("artist","Artist",t)}${field("album","Album",t)}${field("albumartist","Album Artist",t)}${field("date","Date",t)}${field("tracknumber","Track Number",t)}${field("genre","Genre",t)}<label>Path<input value="${esc(t.path)}" disabled></label><div class="actions"><button type="submit">Save Metadata</button><button type="button" class="secondary" id="resetBtn">Reset</button></div><div class="message" id="msg"></div></form>`; const form=byId("editForm"); if(form){on(form,"submit", saveSelected); on(byId("resetBtn"),"click",()=>selectTrack(id));} const artInput=byId("artworkFile"), artPreview=byId("artworkPreview"); if(artInput){const songArt=byId("saveSongArt"), albumArt=byId("saveAlbumArt"), selectedArt=byId("saveSelectedArt"); on(artInput,"change",()=>{const file=artInput.files&&artInput.files[0]; if(!file)return; const url=URL.createObjectURL(file); artPreview.src=url; artPreview.style.display="block";}); if(songArt)on(songArt,"click",()=>saveArtwork("song")); if(albumArt)on(albumArt,"click",()=>saveArtwork("album")); if(selectedArt)on(selectedArt,"click",()=>saveArtwork("selected"));} renderRows();}
    function readArtworkFile(){return new Promise((resolve,reject)=>{const input=byId("artworkFile"); const file=input&&input.files&&input.files[0]; if(!file){reject(new Error("Choose an artwork image first")); return;} if(!["image/jpeg","image/png","image/webp"].includes(file.type)){reject(new Error("Artwork must be JPG, PNG, or WEBP")); return;} const reader=new FileReader(); reader.onload=()=>resolve(reader.result); reader.onerror=()=>reject(new Error("Could not read artwork image")); reader.readAsDataURL(file);});}
    async function saveArtwork(scope){const msg=byId("artworkMsg"); try{if(scope==="selected"&&selectedIds.size===0){msg.className="message error"; msg.textContent="Select tracks first."; return;} msg.className="message"; msg.textContent=scope==="album"?"Saving album artwork...":scope==="selected"?"Saving selected artwork...":"Saving song artwork..."; const imageData=await readArtworkFile(); const result=await fetchJson(`/api/track/${selectedId}/artwork`,{method:"POST",headers:editHeaders({"Content-Type":"application/json"}),body:JSON.stringify({scope,image_data:imageData,ids:[...selectedIds]})}); if(!result.ok){msg.className="message error"; msg.textContent=result.error||"Artwork save failed"; return;} msg.className="message ok"; msg.textContent=`Saved artwork to ${result.changed} file${result.changed===1?"":"s"}.`; if(scope==="album"||scope==="selected")selectedIds.clear(); await loadTracks(true, selectedId);}catch(err){msg.className="message error"; msg.textContent=err.message||String(err);}}
    async function saveSelected(event){event.preventDefault(); const msg=byId("msg"), form=event.currentTarget, data=Object.fromEntries(new FormData(form).entries()); msg.className="message"; msg.textContent="Saving..."; const result=await fetchJson(`/api/track/${selectedId}/metadata`,{method:"POST",headers:editHeaders({"Content-Type":"application/json"}),body:JSON.stringify(data)}); if(!result.ok){msg.className="message error"; msg.textContent=result.error||"Save failed"; return;} msg.className="message ok"; msg.textContent=result.changed.length?`Saved: ${result.changed.join(", ")}.`:"No changes."; await loadTracks(false, selectedId);}
    async function bulkSave(){const values={artist:bulkArtist.value, album:bulkAlbum.value, albumartist:bulkAlbumArtist.value, date:bulkDate.value, genre:bulkGenre.value}; const result=await fetchJson("/api/bulk/metadata",{method:"POST",headers:editHeaders({"Content-Type":"application/json"}),body:JSON.stringify({ids:[...selectedIds],values})}); if(!result.ok){alert(result.error||"Bulk save failed"); return;} const changed=result.results.filter(r=>r.ok).length; selectedIds.clear(); alert(`Bulk save complete for ${changed} files. Selection cleared.`); await loadTracks(false, selectedId);}
    // Music queue and playback. The queue is just an ordered list of track IDs.
    function shuffle(list){const copy=[...list]; for(let i=copy.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1)); [copy[i],copy[j]]=[copy[j],copy[i]];} return copy;}
    function playList(list, randomize=false, startId=null){const playable=randomize?shuffle(list):[...list]; if(!playable.length)return; queue=playable.map(t=>t.id); queueIndex=startId===null?0:Math.max(0,queue.indexOf(startId)); playQueueIndex(queueIndex);}
    // When a track is opened from an album page, Next should continue through
    // the album and then later albums in the current browse order.
    function albumPlaybackContext(startId){const current=tracks.find(t=>t.id===startId); if(!current||selectedAlbum==="All")return [current].filter(Boolean); const source=albumSource(); const albums=new Map(); for(const t of source){const name=albumOf(t); if(!albums.has(name))albums.set(name,[]); albums.get(name).push(t);} const ordered=[...albums.entries()].sort((a,b)=>albumSortYear(b[1])-albumSortYear(a[1])||a[0].localeCompare(b[0],undefined,{numeric:true,sensitivity:"base"})); const albumIndex=ordered.findIndex(([name])=>name===selectedAlbum); if(albumIndex<0)return albumTrackList(albumList(selectedAlbum)); const list=[]; for(const [_name,tracksForAlbum] of ordered.slice(albumIndex)){list.push(...albumTrackList(tracksForAlbum));} return list.length?list:[current];}
    function playSingleTrack(id){const t=tracks.find(x=>x.id===id); if(!t)return; if(appMode==="listen"&&selectedAlbum!=="All"){playList(albumPlaybackContext(id), false, id); return;} playList([t], false, id);}
    // If the queue was empty, adding songs starts playback immediately. If
    // something is already playing, additions are non-disruptive.
    function addToMusicQueue(list){const ids=list.map(t=>t.id).filter(id=>!queue.includes(id)); if(!ids.length)return; const wasEmpty=queue.length===0; queue.push(...ids); showQueueToast(ids.length===1?"Added to queue":`Added ${ids.length} to queue`); pulseQueueButton(topQueueLabelEl); if(wasEmpty){queueIndex=0; playQueueIndex(0);} else {updateNow(); renderQueue();}}
    function playQueueIndex(index){if(index<0||index>=queue.length)return; queueIndex=index; const t=tracks.find(x=>x.id===queue[queueIndex]); if(!t)return; console.debug("[audio] play button tapped", {id:t.id,title:t.title,format:t.format,size_mb:t.size_mb}); resumeVisualizerContext(); playingId=t.id; selectedId=t.id; player.src=t.audio_url; player.load(); console.debug("[audio] audio url requested", t.audio_url); const playPromise=player.play(); if(playPromise&&typeof playPromise.catch==="function"){playPromise.then(startVisualizer).catch(err=>{console.warn("[audio] play failed", err); updateNow();});} else startVisualizer(); selectTrack(t.id); updateNow(); requestAnimationFrame(startVisualizer); renderQueue();}
    function removeQueueIndex(index){if(index<0||index>=queue.length)return; queue.splice(index,1); if(index<queueIndex)queueIndex--; else if(index===queueIndex){if(queue.length){queueIndex=Math.min(index,queue.length-1); playQueueIndex(queueIndex);}else{queueIndex=-1; player.pause(); player.removeAttribute("src"); playingId=null; updateNow(); renderRows();}} updateNow(); renderQueue();}
    function moveQueueItem(fromIndex,toIndex){if(fromIndex===toIndex||fromIndex<0||toIndex<0||fromIndex>=queue.length||toIndex>=queue.length)return; const current=queue[queueIndex]; const [item]=queue.splice(fromIndex,1); queue.splice(toIndex,0,item); queueIndex=current===undefined?-1:queue.indexOf(current); updateNow(); renderQueue();}
    function queueDurationText(){const known=queue.map(id=>knownDurations.get(id)).filter(v=>Number.isFinite(v)); if(!known.length)return "duration loading"; const total=known.reduce((sum,v)=>sum+v,0); return `${fmt(total)}${known.length<queue.length?" known":""}`;}
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
    function renderQueue(){
      queueSummaryEl.textContent = `${queue.length} track${queue.length===1?"":"s"} - ${queueDurationText()}`;
      queueListEl.innerHTML = queue.length
        ? queue.map((id,index)=>{
            const t = tracks.find(x=>x.id===id);
            if(!t) return "";
            const label = index===queueIndex ? `<div class="queueSectionLabel">Now Playing</div>` : index===queueIndex+1 ? `<div class="queueSectionLabel">Up Next</div>` : "";
            return label + queueItemHtml({
              index,
              active:index===queueIndex,
              draggable:true,
              artworkHtml:t.has_artwork ? `<img src="${t.artwork_url}" alt="">` : `<div class="noArt">?</div>`,
              title:t.title,
              subtitle:`${t.artist||"Unknown artist"} - ${t.album||"No album"}`,
            });
          }).join("")
        : emptyQueueHtml("Queue is empty", "Play an album or shown list to fill it.");
      bindQueueList(queueListEl, playQueueIndex, removeQueueIndex);
      bindQueueDrag(queueListEl, moveQueueItem);
    }
    function updateMusicQueueLabels(){topQueueLabelEl.innerHTML=`${buttonIcon("queue")}<span>${queue.length}</span>`;}
    function nowPlayingRemainingText(){
      return Number.isFinite(player.duration)
        ? `-${fmt(Math.max(0, player.duration - player.currentTime))}`
        : durationEl.textContent;
    }
    function nowPlayingArtworkHtml(t){
      return t.has_artwork
        ? `<img class="nowPlayingArt" src="${t.artwork_url}" alt="">`
        : `<div class="nowPlayingArt">No Artwork</div>`;
    }
    function nowPlayingMetaHtml(t){
      const year = String(t.date || "").slice(0, 4);
      const format = String(t.format || "").toUpperCase();
      return `<div class="nowPlayingText"><div class="nowPlayingTitle">${esc(t.title)}</div><div class="nowPlayingMeta">${esc(t.album || "No album")} - ${esc(t.artist || "Unknown artist")}${year ? ` - ${esc(year)}` : ""}${format ? ` - ${esc(format)}` : ""}</div></div>`;
    }
    function nowPlayingVisualizerHtml(){
      return visualizerAllowed()
        ? `<canvas id="nowPlayingVisualizer" class="nowPlayingVisualizer" width="560" height="96" aria-hidden="true" title="Visualizer: ${esc(visualizerMode)}. Click to switch."></canvas>`
        : "";
    }
    function nowPlayingSeekHtml(){
      return `<div class="nowPlayingSeek"><input id="npSeekBar" type="range" min="0" max="1000" value="${esc(seekBar.value)}"><span id="npCurrentTime">${esc(currentTimeEl.textContent)}</span><span id="npDuration">${esc(nowPlayingRemainingText())}</span></div>`;
    }
    function nowPlayingControlsHtml(){
      const playIcon = player.paused ? "&#9654;" : "&#10074;&#10074;";
      return `<div class="nowPlayingControls"><div class="nowPlayingTransport"><button id="npPrev" class="secondary iconControl" title="Previous" aria-label="Previous">&#9664;&#9664;</button><button id="npPlayPause" class="playButton iconControl" title="Play/Pause" aria-label="Play/Pause">${playIcon}</button><button id="npNext" class="secondary iconControl" title="Next" aria-label="Next">&#9654;&#9654;</button></div><label class="nowPlayingVolume"><span>Vol</span><input id="npVolumeBar" type="range" min="0" max="1" step="0.01" value="${esc(player.volume)}"></label></div>`;
    }
    // Full-screen Now Playing is rebuilt from current state so it stays in sync
    // with seek time, volume, visualizer mode, and file format.
    function renderNowPlaying(t){
      if(!nowPlayingBodyEl)return;
      if(!t){
        nowPlayingBodyEl.innerHTML=`<div class="nowPlayingArt">No Song</div><div><div class="nowPlayingTitle">Nothing playing</div><div class="nowPlayingMeta">Choose a song, album, or category.</div></div>`;
        return;
      }
      nowPlayingBodyEl.innerHTML = [
        nowPlayingArtworkHtml(t),
        nowPlayingMetaHtml(t),
        nowPlayingVisualizerHtml(),
        nowPlayingSeekHtml(),
        nowPlayingControlsHtml(),
        `<div class="lyricsBox"><strong>Lyrics</strong><br>English lyrics can go here later.</div>`
      ].join("");
      bindNowPlayingControls();
    }
    function bindNowPlayingControls(){
      const npSeek=byId("npSeekBar"), npVolume=byId("npVolumeBar"), canvas=byId("nowPlayingVisualizer");
      if(canvas)on(canvas,"click",cycleVisualizerMode);
      if(npVolume)on(npVolume,"input",()=>{player.volume=Number(npVolume.value); volumeBar.value=npVolume.value;});
      on(byId("npPrev"),"click",()=>playQueueIndex(queueIndex-1));
      on(byId("npNext"),"click",()=>playQueueIndex(queueIndex+1));
      on(byId("npPlayPause"),"click",()=>{if(player.paused){const p=player.play(); if(p&&typeof p.then==="function")p.then(startVisualizer).catch(()=>{}); else startVisualizer();}else player.pause();});
      on(npSeek,"input",()=>{seeking=true;});
      on(npSeek,"change",()=>{if(player.duration) player.currentTime=(Number(npSeek.value)/1000)*player.duration; seeking=false;});
    }
    // Media Session controls the iPhone lock screen / Dynamic Island buttons.
    // Explicitly clearing seek handlers nudges iOS toward track prev/next.
    function setupMediaSessionActions(){if(!("mediaSession" in navigator))return; const set=(action,handler)=>{try{navigator.mediaSession.setActionHandler(action,handler);}catch{}}; set("play",()=>player.play()); set("pause",()=>player.pause()); set("previoustrack",()=>queue.length?playQueueIndex(Math.max(0,queueIndex-1)):null); set("nexttrack",()=>queue.length?playQueueIndex(Math.min(queue.length-1,queueIndex+1)):null); set("seekbackward",null); set("seekforward",null); set("seekto",null);}
    function updateMediaSession(t){if(!("mediaSession" in navigator)||!t)return; setupMediaSessionActions(); const artwork=t.has_artwork?[{src:t.artwork_url,sizes:"512x512",type:"image/jpeg"}]:[]; try{navigator.mediaSession.metadata=new MediaMetadata({title:t.title||"Unknown title",artist:t.artist||"Unknown artist",album:t.album||"",artwork}); navigator.mediaSession.playbackState=player.paused?"paused":"playing";}catch{}}
    function updateNow(){const t=tracks.find(x=>x.id===playingId); playPauseBtn.textContent=player.paused?"\u25b6":"\u275a\u275a"; playPauseBtn.title=player.paused?"Play":"Pause"; playPauseBtn.setAttribute("aria-label",player.paused?"Play":"Pause"); updateMusicQueueLabels(); updatePlayingHighlights(); if(!t){nowInfoEl.innerHTML=`<div class="noArt">?</div><div class="nowText"><div class="nowTitle">Nothing playing</div><div class="nowSub">Choose a song, album, or category</div></div>`; renderNowPlaying(null); return;} updateMediaSession(t); nowInfoEl.innerHTML=`${t.has_artwork?`<img src="${t.artwork_url}" alt="">`:`<div class="noArt">?</div>`}<div class="nowText"><div class="nowTitle">${esc(t.title)}</div><div class="nowSub">${esc(t.artist||"Unknown artist")}</div></div>`; renderNowPlaying(t); if(!player.paused&&!player.ended)requestAnimationFrame(startVisualizer);}
    function fmt(seconds){if(!Number.isFinite(seconds))return "0:00"; const m=Math.floor(seconds/60), s=Math.floor(seconds%60); return `${m}:${String(s).padStart(2,"0")}`;}
    // App mode and data loading.
    async function loadConfig(){try{appConfig=await fetchJson("/api/config");}catch{appConfig={editable:true,editRequiresPassword:false};} if(appConfig.editRequiresPassword&&editToken){try{const status=await fetchJson("/api/edit-status",{headers:editHeaders()}); if(!status.unlocked){editToken=""; localStorage.removeItem("editToken");}}catch{editToken=""; localStorage.removeItem("editToken");}} document.body.classList.toggle("readOnly",!appConfig.editable); if(!appConfig.editable&&appMode==="edit")setAppMode("listen"); if(!appConfig.editable&&mediaType==="health")setMediaType("music");}
    function renderCurrentMedia(){if(mediaType==="video")renderVideoAll(); else if(mediaType==="health")renderHealth(); else if(mediaType==="interviews")renderInterviews(); else renderAll();}
    async function loadTracks(refresh=false, keepId=null){
      if(refresh) await fetchJson("/api/refresh");

      // Load each media type together so Refresh feels snappy even with a large library.
      const [trackData, videoData, interviewData] = await Promise.all([
        fetchJson("/api/tracks"),
        fetchJson("/api/videos"),
        fetchJson("/api/interviews"),
      ]);

      tracks = trackData.tracks;
      videos = videoData.videos;
      interviews = interviewData.interviews || [];
      renderCurrentMedia();

      if(keepId !== null && tracks.some(t=>t.id === keepId)){
        selectTrack(keepId);
      }
    }
    function setGroupMode(mode){groupMode=mode; resetMusicSelection(); renderAll();}
    async function unlockEditMode(){if(!appConfig.editable)return false; if(!appConfig.editRequiresPassword||editToken)return true; const password=prompt("Edit metadata password"); if(!password)return false; try{const result=await fetchJson("/api/edit-login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password})}); if(!result.ok){alert(result.error||"Wrong edit password."); return false;} editToken=result.token||""; if(editToken)localStorage.setItem("editToken",editToken); return true;}catch(err){alert(err.message||"Could not unlock Edit Mode."); return false;}}
    async function enterEditMode(){if(await unlockEditMode())setAppMode("edit");}
    function closeFloatingPanels(){[navEl,interviewListEl,queueDrawerEl,videoQueueDrawerEl,nowPlayingDrawerEl].forEach(el=>setOpen(el,false));}
    function resetMusicHomeState(){resetMusicSelection(); selectedIds.clear(); searchEl.value=""; musicFilterEl.value="all"; detailEl.innerHTML=`<div class="bigCover emptyCover">Select a song</div>`; closeFloatingPanels();}
    function setModeButtons(mode){setActive(byId("listenMode"),mode==="listen"); setActive(byId("editMode"),mode==="edit");}
    function setAppMode(mode,{resetHome=false}={}){if(!appConfig.editable&&mode==="edit")mode="listen"; if(mode==="edit"&&appConfig.editRequiresPassword&&!editToken){mode="listen";} const leavingEdit=appMode==="edit"&&mode==="listen"; appMode=mode; if(mode==="listen"){musicFilterEl.value="all"; selectedIds.clear(); if(resetHome||leavingEdit)resetMusicHomeState();} setBodyMode("listen",mode==="listen"); setBodyMode("edit",mode==="edit"); setModeButtons(mode); if(mediaType==="music")renderAll();}
    function enterListenMode(){setMediaType("music"); setAppMode("listen",{resetHome:true}); window.scrollTo({top:0,behavior:"smooth"});}
    function isMobileLayout(){return window.innerWidth<=860;}
    function updateBrowseToggle(){document.body.classList.toggle("browseCollapsed",browseCollapsed&&!isMobileLayout()); document.querySelectorAll(".browseToggle").forEach(btn=>{btn.innerHTML=buttonIcon("browse"); btn.title=browseCollapsed&&!isMobileLayout()?"Show browse panel":"Browse"; btn.setAttribute("aria-label", btn.title);});}
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
    function setTheme(){document.body.classList.add("dark");}
    function setMediaType(type){
      if(!appConfig.editable && type === "health") type = "music";
      mediaType = type;
      // Phones/tablets are playback-first. Editing remains desktop-only so the
      // small layout does not expose destructive metadata controls.
      if(window.matchMedia("(max-width:860px)").matches && appMode === "edit") setAppMode("listen");

      MEDIA_TYPES.forEach(name=>setBodyMode(name, type === name));
      musicTabEl.classList.toggle("inactive", type !== "music");
      videoTabEl.classList.toggle("inactive", type !== "video");
      interviewsTabEl.classList.toggle("inactive", type !== "interviews");
      healthTabEl.classList.toggle("inactive", type !== "health");

      searchEl.placeholder =
        type === "video" ? "Search video title or folder" :
        type === "interviews" ? "Search interviews" :
        type === "health" ? "Search is for music, video, interviews" :
        "Search title, album, artist";

      if(type === "video"){
        setOpen(queueDrawerEl, false);
      } else {
        videoPlayerEl.pause();
      }
      renderCurrentMedia();
    }
    // Event binding lives at the end so startup is easy to follow.
    function bindTableEvents(){document.querySelectorAll("th.sortable").forEach(th=>th.addEventListener("click",()=>{const key=th.dataset.sort; if(sortKey===key) sortDir=sortDir==="asc"?"desc":"asc"; else { sortKey=key; sortDir=key==="has_artwork"?"desc":"asc"; } renderRows();})); selectShownEl.addEventListener("change",()=>{for(const t of filtered()){selectShownEl.checked?selectedIds.add(t.id):selectedIds.delete(t.id);} renderRows();}); clearSelectedEl.addEventListener("click",()=>{selectedIds.clear(); renderRows();}); bulkSaveEl.addEventListener("click",bulkSave);}
    function bindMusicControls(){on(byId("playShownMusic"),"click",()=>playList(currentPlaybackList())); on(byId("shuffleShownMusic"),"click",()=>playList(currentPlaybackList(),true)); on(byId("topQueueToggle"),"click",()=>{toggleOpen(queueDrawerEl); renderQueue();}); on(byId("showAllAlbums"),"click",closeMusicAlbum); on(byId("listenMode"),"click",enterListenMode); on(byId("editMode"),"click",()=>enterEditMode()); on(albumViewModeEl,"change",()=>setAlbumViewMode(albumViewModeEl.value)); on(musicFilterEl,"change",renderAll);}
    function bindBrowseControls(){on(byId("browseMusic"),"click",toggleBrowse); on(byId("browseVideo"),"click",toggleBrowse); on(byId("toggleBrowsePanel"),"click",toggleBrowse); on(byId("closeBrowse"),"click",()=>setOpen(navEl,false)); on(byId("browseInterviews"),"click",toggleBrowse); on(byId("toggleInterviewBrowsePanel"),"click",toggleBrowse); on(byId("closeInterviewBrowse"),"click",()=>setOpen(interviewListEl,false));}
    function bindTabsAndSearch(){on(musicTabEl,"click",()=>setMediaType("music")); on(videoTabEl,"click",()=>setMediaType("video")); on(interviewsTabEl,"click",()=>setMediaType("interviews")); on(healthTabEl,"click",()=>setMediaType("health")); on(searchEl,"input",renderCurrentMedia); on(byId("refresh"),"click",()=>loadTracks(true,selectedId)); on(window,"resize",setDeviceClass);}
    function bindVideoControls(){on(videoSortEl,"change",()=>{videoSort=videoSortEl.value; localStorage.setItem("videoSort",videoSort); renderVideoAll();}); on(byId("prevVideo"),"click",()=>playVideoQueueIndex(videoQueueIndex-1)); on(byId("nextVideo"),"click",()=>playVideoQueueIndex(videoQueueIndex+1)); on(byId("playShownVideo"),"click",()=>playVideoList(videoFiltered())); on(byId("shuffleShownVideo"),"click",()=>playVideoList(videoFiltered(),true)); on(byId("videoQueueToggle"),"click",()=>{toggleOpen(videoQueueDrawerEl); renderVideoQueue();}); on(byId("closeVideoQueue"),"click",()=>setOpen(videoQueueDrawerEl,false)); on(byId("clearVideoQueue"),"click",()=>{videoQueue=[]; videoQueueIndex=-1; updateVideoQueueLabel(); renderVideoQueue();}); on(byId("shuffleVideoQueue"),"click",()=>{const current=videoQueue[videoQueueIndex]; videoQueue=shuffle(videoQueue.map(id=>videos.find(v=>v.id===id)).filter(Boolean)).map(v=>v.id); videoQueueIndex=current===undefined?-1:videoQueue.indexOf(current); updateVideoQueueLabel(); renderVideoQueue();}); on(videoPlayerEl,"ended",()=>{if(videoQueueIndex+1<videoQueue.length) playVideoQueueIndex(videoQueueIndex+1);});}
    function bindQueueControls(){on(byId("closeQueue"),"click",()=>setOpen(queueDrawerEl,false)); on(byId("clearQueue"),"click",()=>{queue=[]; queueIndex=-1; player.pause(); playingId=null; updateNow(); renderQueue();}); on(byId("shuffleQueue"),"click",()=>{const current=queue[queueIndex]; queue=shuffle(queue.map(id=>tracks.find(t=>t.id===id)).filter(Boolean)).map(t=>t.id); queueIndex=current===undefined?-1:queue.indexOf(current); updateNow(); renderQueue();});}
    function bindAudioPlayer(){
      on(byId("prevBtn"),"click",()=>playQueueIndex(queueIndex-1));
      on(byId("nextBtn"),"click",()=>playQueueIndex(queueIndex+1));
      on(playPauseBtn,"click",()=>{
        if(!player.src){playList(filtered()); return;}
        if(player.paused){
          const p=player.play();
          if(p&&typeof p.then==="function")p.then(startVisualizer).catch(()=>{});
          else startVisualizer();
        }else player.pause();
      });
      on(nowInfoEl,"click",()=>{
        if(playingId!==null){
          setOpen(nowPlayingDrawerEl,true);
          if(!player.paused&&!player.ended)requestAnimationFrame(startVisualizer);
        }
      });
      on(byId("closeNowPlaying"),"click",()=>setOpen(nowPlayingDrawerEl,false));
      on(player,"canplay",()=>console.debug("[audio] browser canplay", {src:player.currentSrc,currentTime:player.currentTime}));
      on(player,"playing",()=>console.debug("[audio] browser playing", {src:player.currentSrc,currentTime:player.currentTime}));
      on(player,"play",()=>{setupMediaSessionActions(); startVisualizer(); updateNow();});
      on(player,"pause",()=>{setupMediaSessionActions(); stopVisualizer(); updateNow();});
      on(player,"ended",()=>{
        setupMediaSessionActions();
        stopVisualizer();
        if(queueIndex+1<queue.length) playQueueIndex(queueIndex+1);
      });
      on(player,"loadedmetadata",()=>{
        setupMediaSessionActions();
        durationEl.textContent=fmt(player.duration);
        if(playingId!==null&&Number.isFinite(player.duration))knownDurations.set(playingId,player.duration);
        updateNow();
        renderQueue();
      });
      on(player,"timeupdate",()=>{
        if(seeking)return;
        currentTimeEl.textContent=fmt(player.currentTime);
        seekBar.value=player.duration?Math.round((player.currentTime/player.duration)*1000):0;
        const npCurrent=byId("npCurrentTime"), npDuration=byId("npDuration"), npSeek=byId("npSeekBar");
        if(npCurrent)npCurrent.textContent=currentTimeEl.textContent;
        if(npDuration)npDuration.textContent=nowPlayingRemainingText();
        if(npSeek)npSeek.value=seekBar.value;
      });
      on(seekBar,"input",()=>{seeking=true;});
      on(seekBar,"change",()=>{
        if(player.duration) player.currentTime=(Number(seekBar.value)/1000)*player.duration;
        seeking=false;
      });
      on(volumeBar,"input",()=>{
        player.volume=Number(volumeBar.value);
        const npVolume=byId("npVolumeBar");
        if(npVolume)npVolume.value=volumeBar.value;
      });
    }
    function initializeApp(){
      bindTableEvents();
      bindMusicControls();
      bindBrowseControls();
      bindTabsAndSearch();
      bindVideoControls();
      bindQueueControls();
      bindAudioPlayer();

      videoSortEl.value = videoSort;
      videoPlayerEl.playsInline = true;
      videoPlayerEl.setAttribute("playsinline", "");
      videoPlayerEl.setAttribute("webkit-playsinline", "");

      setTheme();
      setDeviceClass();
      setupMediaSessionActions();
      player.volume = Number(volumeBar.value);
      updateMusicQueueLabels();
      updateVideoQueueLabel();
      loadConfig().then(()=>loadTracks());
    }
    initializeApp();
